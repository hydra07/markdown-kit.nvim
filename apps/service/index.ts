import { openBrowser } from "./utils/browser";
import type { IncomingMessage, PreviewState, WS } from "./types/types";
import { join } from "path";
const SERVICE_PORT = Number(Bun.env.MK_PORT ?? 35831);
const HOST = "127.0.0.1";
const BROWSER_OPEN_DELAY_MS = Math.max(0, Number(Bun.env.MK_BROWSER_OPEN_DELAY_MS ?? 0));

const current: PreviewState = {
  markdown: "",
  fileName: "",
  theme: "dark",
  contentTick: 0,
  cursorLine: 1,
  lineCount: 1,
};

const clients = new Set<WS>();
let autoOpenTimer: ReturnType<typeof setTimeout> | null = null;

function safeSend(ws: WS, raw: string): void {
  try {
    ws.send(raw);
  } catch {
    clients.delete(ws);
  }
}

function broadcast(msg: unknown): void {
  const raw = JSON.stringify(msg);
  for (const ws of clients) safeSend(ws, raw);
}

function broadcastPreview(): void {
  broadcast({ type: "preview:update", payload: current });
}

function broadcastCursor(): void {
  broadcast({
    type: "cursor:update",
    payload: { cursorLine: current.cursorLine, lineCount: current.lineCount },
  });
}

function cancelAutoOpen(): void {
  if (autoOpenTimer === null) return;
  clearTimeout(autoOpenTimer);
  autoOpenTimer = null;
}

function handleBrowserOpen(): void {
  if (clients.size > 0) return;
  cancelAutoOpen();
  const open = () => {
    autoOpenTimer = null;
    if (clients.size === 0) openBrowser({ host: HOST, webPort: SERVICE_PORT, servicePort: SERVICE_PORT });
  };
  if (BROWSER_OPEN_DELAY_MS === 0) {
    open();
    return;
  }
  autoOpenTimer = setTimeout(open, BROWSER_OPEN_DELAY_MS);
}

function applyPreview(payload: Partial<PreviewState>): void {
  if (typeof payload.markdown === "string") {
    current.markdown = payload.markdown;
  }
  if (typeof payload.fileName === "string") current.fileName = payload.fileName;
  if (payload.theme === "dark" || payload.theme === "light") current.theme = payload.theme;
  if (typeof payload.contentTick === "number") current.contentTick = payload.contentTick;
  if (typeof payload.cursorLine === "number") current.cursorLine = payload.cursorLine;
  if (typeof payload.lineCount === "number") current.lineCount = payload.lineCount;
  broadcastPreview();
}

function applyCursor(payload: Partial<PreviewState>): void {
  if (typeof payload.cursorLine === "number") current.cursorLine = payload.cursorLine;
  if (typeof payload.lineCount === "number") current.lineCount = payload.lineCount;
  broadcastCursor();
}

function applyMessage(raw: string): void {
  let message: IncomingMessage;
  try {
    message = JSON.parse(raw) as IncomingMessage;
  } catch {
    return;
  }

  if (!message.type) return;

  switch (message.type) {
    case "preview:update":
      if (message.payload) applyPreview(message.payload);
      return;
    case "cursor:update":
      if (message.payload) applyCursor(message.payload);
      return;
    case "browser:open":
      handleBrowserOpen();
      return;
    case "preview:close":
      broadcast({ type: "preview:close" });
      return;
  }
}

async function readStdin(): Promise<void> {
  const decoder = new TextDecoder();
  const reader = Bun.stdin.stream().getReader();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      if (line.trim() !== "") applyMessage(line);
    }
  }

  if (buffer.trim() !== "") applyMessage(buffer);
  process.exit(0);
}

Bun.serve({
  hostname: HOST,
  port: SERVICE_PORT,
  fetch(req, server) {
    if (server.upgrade(req)) return undefined as unknown as Response;
    
    // Serve static files from web/dist
    const url = new URL(req.url);
    let pathname = url.pathname;
    if (pathname === "/") pathname = "/index.html";
    
    // Resolve relative to the current file (either src/ or dist/)
    const distPath = join(import.meta.dir, "../../web/dist");
    const filePath = join(distPath, pathname);
    
    const file = Bun.file(filePath);
    return new Response(file);
  },
  websocket: {
    open(ws) {
      clients.add(ws);
      cancelAutoOpen();
      safeSend(ws, JSON.stringify({ type: "service:ready", payload: { message: "markdown-kit connected" } }));
      safeSend(ws, JSON.stringify({ type: "preview:update", payload: current }));
    },
    close(ws) {
      clients.delete(ws);
    },
    message() {
      // reserved
    },
  },
});

void readStdin();
console.log(`[service] ws://${HOST}:${SERVICE_PORT}`);