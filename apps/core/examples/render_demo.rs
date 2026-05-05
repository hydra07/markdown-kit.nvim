/// examples/render_demo.rs
///
/// Render a local Markdown file and preview it in the browser using the
/// same Rust server + Preact client as production.
///
/// Usage:
///   cargo run --example render_demo -- path/to/file.md
///   cargo run --example render_demo -- path/to/file.md --theme light
///   cargo run --example render_demo             # uses built-in kitchen-sink demo
///
/// The server stays alive so you can refresh the browser at will.
/// Press Ctrl-C to quit.
use anyhow::{Context, Result};
use axum::{Router, routing::get};
use mk_core::{markdown::render, server};
use serde::Serialize;
use std::{path::PathBuf, sync::Arc, time::Duration};
use tokio::sync::{broadcast, Mutex};
use tracing::info;
use tracing_subscriber::EnvFilter;

// ---------------------------------------------------------------------------
// CLI args — keep it dependency-free (no clap needed for 2 args)
// ---------------------------------------------------------------------------

struct Args {
    md_path: Option<PathBuf>,
    theme: String,
    port: u16,
}

fn parse_args() -> Args {
    let mut args = std::env::args().skip(1);
    let mut md_path = None;
    let mut theme = "dark".to_string();
    let mut port = 35831u16;

    while let Some(arg) = args.next() {
        match arg.as_str() {
            "--theme" => {
                if let Some(v) = args.next() {
                    theme = v;
                }
            }
            "--port" => {
                if let Some(v) = args.next() {
                    port = v.parse().unwrap_or(35831);
                }
            }
            other if !other.starts_with('-') => {
                md_path = Some(PathBuf::from(other));
            }
            _ => {}
        }
    }

    Args {
        md_path,
        theme,
        port,
    }
}

// ---------------------------------------------------------------------------
// Demo markdown — shown when no file argument is given
// ---------------------------------------------------------------------------

fn kitchen_sink_md() -> String {
    r#"
# mk-core · render demo

Render demo cho **markdown-kit.nvim** — kitchen sink edition.

---

## Code highlight

```rust
fn main() {
    let msg = "Hello from mk-core!";
    println!("{msg}");
}
```

```javascript
const ws = new WebSocket(`ws://127.0.0.1:35831/ws`);
ws.onmessage = ({ data }) => {
  const { type, payload } = JSON.parse(data);
  if (type === "preview:update") {
    document.getElementById("preview").innerHTML = payload.html;
  }
};
```

```bash
cargo run --example render_demo -- README.md --theme dark
```

---

## Table

| Feature          | Status  | Notes                        |
|------------------|---------|------------------------------|
| Syntax highlight | ✅ Done  | syntect / base16-ocean.dark  |
| Mermaid render   | ✅ Done  | mermaid_rs inline SVG        |
| Math (KaTeX)     | ✅ Done  | client-side auto-render      |
| Responsive SVG   | ✅ Fixed | max-width + overflow-x:auto  |
| Unique SVG IDs   | ✅ Fixed | scoped per diagram index     |

---

## Mermaid diagrams

```mermaid
flowchart LR
    NV[Neovim] -->|stdin JSON| RS[mk-core Rust]
    RS -->|render| HTML[HTML fragment]
    HTML -->|WebSocket| BR[Browser / Preact]
```

```mermaid
sequenceDiagram
    participant NV as Neovim
    participant RS as mk-core
    participant BR as Browser
    NV->>RS: preview:update { markdown }
    RS->>RS: render() → HTML
    RS->>BR: preview:update { html }
    BR->>BR: patch DOM
```

```mermaid
classDiagram
    class IncomingMsg {
        +PreviewUpdate
        +CursorUpdate
        +PreviewClose
    }
    class OutgoingMsg {
        +PreviewUpdate
        +CursorUpdate
        +PreviewClose
    }
    IncomingMsg --> OutgoingMsg : server transforms
```

---

## Math (KaTeX)

Inline: <span class="math-inline">E = mc^2</span>

Block:

<div class="math-block">
\int_{-\infty}^{\infty} e^{-x^2} dx = \sqrt{\pi}
</div>

Maxwell's equations:

<div class="math-block">
\nabla \cdot \vec{E} = \frac{\rho}{\varepsilon_0} \qquad
\nabla \times \vec{B} = \mu_0\vec{J} + \mu_0\varepsilon_0\frac{\partial\vec{E}}{\partial t}
</div>

---

## Image with size hint

![Placeholder](https://via.placeholder.com/400x200 =400x200)

---

## Task list

- [x] pulldown-cmark parser
- [x] syntect syntax highlight
- [x] mermaid inline SVG
- [x] responsive SVG fix
- [x] duplicate marker ID fix
- [x] plantuml preprocess
- [x] math placeholder
- [ ] watcher mode (live reload on file change)

---

## Blockquote

> "Parsing Markdown correctly is surprisingly hard.  
>  Rendering it fast is harder."  
> — everyone who has tried

---

## Strikethrough & smart punctuation

~~Old broken renderer~~ → New fixed renderer.

"Smart quotes" and em-dash — done automatically.

"#
    .trim()
    .to_string()
}

// ---------------------------------------------------------------------------
// Outgoing message shape (mirrors server.rs exactly)
// ---------------------------------------------------------------------------

#[derive(Serialize)]
#[serde(tag = "type", content = "payload", rename_all = "camelCase")]
enum OutgoingMsg {
    #[serde(rename = "preview:update")]
    PreviewUpdate(OutPreviewUpdate),
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct OutPreviewUpdate {
    html: String,
    file_name: Option<String>,
    cursor_line: Option<u32>,
    line_count: Option<u32>,
    theme: Option<String>,
    content_tick: Option<u64>,
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

#[tokio::main]
async fn main() -> Result<()> {
    tracing_subscriber::fmt()
        .with_env_filter(EnvFilter::from_default_env())
        .init();

    let args = parse_args();

    // ── Read markdown source ────────────────────────────────────────────────
    let (markdown, file_name) = match &args.md_path {
        Some(path) => {
            let content = std::fs::read_to_string(path)
                .with_context(|| format!("Cannot read {}", path.display()))?;
            let name = path
                .file_name()
                .and_then(|n| n.to_str())
                .map(|s| s.to_string());
            (content, name)
        }
        None => {
            info!("No file given — using built-in kitchen-sink demo");
            (kitchen_sink_md(), Some("demo.md".to_string()))
        }
    };

    let line_count = markdown.lines().count() as u32;

    // ── Render ─────────────────────────────────────────────────────────────
    info!("Rendering markdown ({} lines)…", line_count);
    let html = render(&markdown, &args.theme);
    info!("Render complete ({} bytes of HTML)", html.len());

    // ── Broadcast channel ──────────────────────────────────────────────────
    // Capacity of 1 is enough — we only ever send one initial message, plus
    // optional re-sends if the user refreshes.
    let (tx, _rx) = broadcast::channel::<String>(4);

    // Serialize the preview:update message once.
    let preview_json = serde_json::to_string(&OutgoingMsg::PreviewUpdate(OutPreviewUpdate {
        html,
        file_name: file_name.clone(),
        cursor_line: Some(1),
        line_count: Some(line_count),
        theme: Some(args.theme.clone()),
        content_tick: Some(1),
    }))?;

    // ── Push to every new WS subscriber ────────────────────────────────────
    // Spawn a task that watches for new subscribers on the channel and
    // immediately sends the cached preview to them.  This means refreshing
    // the browser always gets the rendered output without restarting.
    {
        let preview_json = preview_json.clone();
        let tx_clone = tx.clone();
        tokio::spawn(async move {
            loop {
                // Wait until at least one subscriber exists, then broadcast.
                // Poll every 200 ms — cheap enough for a demo tool.
                if tx_clone.receiver_count() > 0 {
                    let _ = tx_clone.send(preview_json.clone());
                }
                tokio::time::sleep(Duration::from_millis(200)).await;
            }
        });
    }

    // ── Axum server (identical structure to main.rs) ────────────────────────
    let state = Arc::new(server::AppState {
        tx: tx.clone(),
        last_html: Mutex::new(Some(preview_json.clone())),
    });

    let app = Router::new()
        .route("/ws", get(server::ws_handler))
        .merge(server::static_routes())
        .with_state(state);

    let addr = format!("127.0.0.1:{}", args.port);
    info!("mk-core render-demo listening on http://{addr}");
    info!("Open your browser at: http://{addr}");

    // ── Auto-open browser ───────────────────────────────────────────────────
    let url = format!("http://{addr}/");
    tokio::spawn(async move {
        // Give the server 300 ms to bind before opening.
        tokio::time::sleep(Duration::from_millis(300)).await;
        open_browser(&url);
    });

    let listener = tokio::net::TcpListener::bind(&addr)
        .await
        .with_context(|| format!("Cannot bind {addr} — is port {} already in use?", args.port))?;

    axum::serve(listener, app).await?;

    Ok(())
}

/// Cross-platform browser open — no extra deps.
fn open_browser(url: &str) {
    #[cfg(target_os = "windows")]
    {
        let _ = std::process::Command::new("cmd")
            .args(["/c", "start", "", url])
            .spawn();
    }

    #[cfg(target_os = "macos")]
    {
        let _ = std::process::Command::new("open").arg(url).spawn();
    }

    #[cfg(not(any(target_os = "windows", target_os = "macos")))]
    {
        let _ = std::process::Command::new("xdg-open").arg(url).spawn();
    }
}
