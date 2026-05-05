use anyhow::Result;
use axum::{Router, routing::get};
use std::sync::Arc;
use tokio::sync::{Mutex, broadcast};
use tracing::info;
use tracing_subscriber::EnvFilter;

use mk_core::server;

#[tokio::main]
async fn main() -> Result<()> {
    tracing_subscriber::fmt()
        .with_env_filter(EnvFilter::from_default_env())
        .init();

    let port: u16 = std::env::var("MK_PORT")
        .ok()
        .and_then(|v| v.parse().ok())
        .unwrap_or(35831);

    // MK_OPEN_BROWSER=1 → Rust tự mở browser sau khi bind xong
    let open_browser = std::env::var("MK_OPEN_BROWSER")
        .map(|v| v == "1")
        .unwrap_or(false);

    let (tx, _rx) = broadcast::channel(64);
    let state = Arc::new(server::AppState {
        tx: tx.clone(),
        last_html: Mutex::new(None),
    });

    tokio::spawn(server::stdin_loop(tx, state.clone()));

    let app = Router::new()
        .route("/ws", get(server::ws_handler))
        .merge(server::static_routes())
        .with_state(state);

    let addr = format!("127.0.0.1:{port}");
    info!("mk-core listening on http://{addr}");

    let listener = tokio::net::TcpListener::bind(&addr).await?;

    // In ra stdout để Lua biết server đã sẵn sàng
    // Lua đọc dòng này rồi mới gửi content lần đầu — không cần defer_fn nữa
    println!("mk-core:ready:{port}");

    if open_browser {
        let url = std::env::var("MK_BROWSER_URL").unwrap_or_else(|_| format!("http://{addr}/"));
        tokio::spawn(async move {
            open_url(&url);
        });
    }

    axum::serve(listener, app).await?;
    Ok(())
}

fn open_url(url: &str) {
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
