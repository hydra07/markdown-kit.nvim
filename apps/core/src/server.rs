use axum::{
    Router,
    extract::{
        State, WebSocketUpgrade,
        ws::{Message, WebSocket},
    },
    response::IntoResponse,
};
use axum_embed::ServeEmbed;
use serde::{Deserialize, Serialize};
use std::sync::Arc;
use tokio::sync::{Mutex, broadcast};
use tokio::time::{Duration, Instant};
use tracing::{error, info};

use crate::markdown::render;

// ── Embedded client assets ──────────────────────────────────────────────────

#[derive(rust_embed::RustEmbed, Clone)]
#[folder = "$CARGO_MANIFEST_DIR/../client/dist/"]
pub struct ClientAssets;

// ── Shared state ────────────────────────────────────────────────────────────

pub struct AppState {
    pub tx: broadcast::Sender<String>,
    /// Last rendered HTML — sent immediately to any new WS subscriber so a
    /// browser refresh always shows current content without waiting for the
    /// next keystroke.
    pub last_html: Mutex<Option<String>>,
}

pub fn static_routes() -> Router<Arc<AppState>> {
    Router::new().fallback_service(ServeEmbed::<ClientAssets>::new())
}

// ── Wire protocol ───────────────────────────────────────────────────────────

#[derive(Deserialize)]
#[serde(tag = "type", content = "payload")]
enum IncomingMsg {
    #[serde(rename = "preview:update")]
    PreviewUpdate(PreviewUpdatePayload),
    #[serde(rename = "cursor:update")]
    CursorUpdate(CursorUpdatePayload),
    #[serde(rename = "preview:close")]
    PreviewClose,
    #[serde(other)]
    Other,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct PreviewUpdatePayload {
    markdown: String,
    file_name: Option<String>,
    cursor_line: Option<u32>,
    line_count: Option<u32>,
    theme: Option<String>,
    content_tick: Option<u64>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct CursorUpdatePayload {
    cursor_line: u32,
    line_count: u32,
}

#[derive(Serialize, Clone)]
#[serde(tag = "type", content = "payload", rename_all = "camelCase")]
enum OutgoingMsg {
    #[serde(rename = "preview:update")]
    PreviewUpdate(OutPreviewUpdate),
    #[serde(rename = "cursor:update")]
    CursorUpdate(OutCursorUpdate),
    #[serde(rename = "preview:close")]
    PreviewClose,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct OutPreviewUpdate {
    html: String,
    file_name: Option<String>,
    cursor_line: Option<u32>,
    line_count: Option<u32>,
    theme: Option<String>,
    content_tick: Option<u64>,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct OutCursorUpdate {
    cursor_line: u32,
    line_count: u32,
}

// ── Debounce / throttle config (from env, with sane defaults) ───────────────
// Lua không cần biết về những giá trị này nữa.

fn content_debounce_ms() -> u64 {
    std::env::var("MK_DEBOUNCE_MS")
        .ok()
        .and_then(|v| v.parse().ok())
        .unwrap_or(80)
}

fn insert_debounce_ms() -> u64 {
    std::env::var("MK_INSERT_DEBOUNCE_MS")
        .ok()
        .and_then(|v| v.parse().ok())
        .unwrap_or(35)
}

fn cursor_throttle_ms() -> u64 {
    std::env::var("MK_CURSOR_THROTTLE_MS")
        .ok()
        .and_then(|v| v.parse().ok())
        .unwrap_or(16)
}

// ── stdin loop ──────────────────────────────────────────────────────────────

pub async fn stdin_loop(tx: broadcast::Sender<String>, state: Arc<AppState>) {
    use tokio::io::{AsyncBufReadExt, BufReader};

    let stdin = tokio::io::stdin();
    let mut reader = BufReader::new(stdin);
    let mut line = String::new();

    // Debounce state — held entirely in Rust, Lua sends raw events.
    let debounce_ms = content_debounce_ms();
    let _ins_debounce_ms = insert_debounce_ms();
    let throttle_ms = cursor_throttle_ms();

    // Pending preview update (debounced).
    let pending_preview: Arc<Mutex<Option<PreviewUpdatePayload>>> = Arc::new(Mutex::new(None));
    // Pending cursor update (throttled).
    let pending_cursor: Arc<Mutex<Option<CursorUpdatePayload>>> = Arc::new(Mutex::new(None));

    // Timer handles — we cancel & restart on each new event.
    let preview_deadline: Arc<Mutex<Option<Instant>>> = Arc::new(Mutex::new(None));
    let cursor_deadline: Arc<Mutex<Option<Instant>>> = Arc::new(Mutex::new(None));

    // Spawn debounce worker for preview updates.
    {
        let tx = tx.clone();
        let state = state.clone();
        let pending = pending_preview.clone();
        let deadline_lock = preview_deadline.clone();

        tokio::spawn(async move {
            loop {
                tokio::time::sleep(Duration::from_millis(8)).await;

                let deadline = {
                    let d = deadline_lock.lock().await;
                    *d
                };

                let Some(due) = deadline else { continue };
                if Instant::now() < due {
                    continue;
                }

                // Deadline passed — take the pending payload and render.
                let payload = {
                    let mut p = pending.lock().await;
                    p.take()
                };
                {
                    let mut d = deadline_lock.lock().await;
                    *d = None;
                }

                let Some(p) = payload else { continue };

                let theme = p.theme.as_deref().unwrap_or("dark");
                let html = render(&p.markdown, theme);

                let msg = OutgoingMsg::PreviewUpdate(OutPreviewUpdate {
                    html: html.clone(),
                    file_name: p.file_name,
                    cursor_line: p.cursor_line,
                    line_count: p.line_count,
                    theme: p.theme,
                    content_tick: p.content_tick,
                });

                if let Ok(json) = serde_json::to_string(&msg) {
                    // Cache for new subscribers.
                    *state.last_html.lock().await = Some(json.clone());
                    let _ = tx.send(json);
                }
            }
        });
    }

    // Spawn throttle worker for cursor updates.
    {
        let tx = tx.clone();
        let pending = pending_cursor.clone();
        let deadline_lock = cursor_deadline.clone();

        tokio::spawn(async move {
            loop {
                tokio::time::sleep(Duration::from_millis(4)).await;

                let deadline = {
                    let d = deadline_lock.lock().await;
                    *d
                };

                let Some(due) = deadline else { continue };
                if Instant::now() < due {
                    continue;
                }

                let payload = {
                    let mut p = pending.lock().await;
                    p.take()
                };
                {
                    let mut d = deadline_lock.lock().await;
                    *d = None;
                }

                let Some(p) = payload else { continue };

                let msg = OutgoingMsg::CursorUpdate(OutCursorUpdate {
                    cursor_line: p.cursor_line,
                    line_count: p.line_count,
                });
                if let Ok(json) = serde_json::to_string(&msg) {
                    let _ = tx.send(json);
                }
            }
        });
    }

    // Main read loop — just classify and enqueue, no blocking work here.
    loop {
        line.clear();
        match reader.read_line(&mut line).await {
            Ok(0) => break, // EOF — Neovim closed stdin
            Ok(_) => {
                let msg = match serde_json::from_str::<IncomingMsg>(&line) {
                    Ok(m) => m,
                    Err(_) => continue,
                };

                match msg {
                    IncomingMsg::PreviewUpdate(p) => {
                        // Determine debounce delay from a hint Lua can send,
                        // or fall back to the normal debounce.
                        // Lua sends raw events; insert-mode hint via `insertMode` field
                        // would require schema change — for now use normal debounce.
                        // If Lua wants to hint insert mode it can set MK_INSERT_DEBOUNCE_MS.
                        let delay = Duration::from_millis(debounce_ms);

                        *pending_preview.lock().await = Some(p);
                        *preview_deadline.lock().await = Some(Instant::now() + delay);
                    }

                    IncomingMsg::CursorUpdate(p) => {
                        let delay = Duration::from_millis(throttle_ms);
                        let mut deadline = cursor_deadline.lock().await;
                        // Only update deadline if none is set (leading-edge throttle).
                        if deadline.is_none() {
                            *deadline = Some(Instant::now() + delay);
                        }
                        *pending_cursor.lock().await = Some(p);
                    }

                    IncomingMsg::PreviewClose => {
                        if let Ok(json) = serde_json::to_string(&OutgoingMsg::PreviewClose) {
                            let _ = tx.send(json);
                        }
                        break;
                    }

                    IncomingMsg::Other => {}
                }
            }
            Err(e) => {
                error!("stdin read error: {e}");
                break;
            }
        }
    }
}

// ── WebSocket handler ───────────────────────────────────────────────────────

pub async fn ws_handler(
    ws: WebSocketUpgrade,
    State(state): State<Arc<AppState>>,
) -> impl IntoResponse {
    ws.on_upgrade(move |socket| handle_socket(socket, state))
}

async fn handle_socket(mut socket: WebSocket, state: Arc<AppState>) {
    info!("WebSocket client connected");

    // Send cached last render immediately — browser refresh gets content
    // without waiting for the next keystroke.
    if let Some(cached) = state.last_html.lock().await.clone() {
        let _ = socket.send(Message::Text(cached.into())).await;
    }

    let mut rx = state.tx.subscribe();

    loop {
        tokio::select! {
            msg = rx.recv() => {
                match msg {
                    Ok(text) => {
                        if socket.send(Message::Text(text.into())).await.is_err() {
                            break;
                        }
                    }
                    Err(broadcast::error::RecvError::Closed) => break,
                    Err(broadcast::error::RecvError::Lagged(_)) => {}
                }
            }
            client_msg = socket.recv() => {
                match client_msg {
                    Some(Ok(Message::Ping(data))) => {
                        let _ = socket.send(Message::Pong(data)).await;
                    }
                    None | Some(Err(_)) => break,
                    _ => {}
                }
            }
        }
    }

    info!("WebSocket client disconnected");
}
