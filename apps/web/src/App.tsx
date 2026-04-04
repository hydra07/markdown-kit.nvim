import { useState } from "react";
import { useDocumentTitle } from "./hooks/useDocumentTitle";
import { usePreviewSocket } from "./hooks/usePreviewSocket";
import { usePreviewViewportSync } from "./hooks/usePreviewViewportSync";
import type { ConnStatus, Theme } from "./types/types";
import "./App.css";

/* ─── WS URL ─────────────────────────────────────────────────────── */
const params     = new URLSearchParams(window.location.search);
const wsFromQuery = params.get("ws");
const wsUrl =
  wsFromQuery && wsFromQuery !== ""
    ? wsFromQuery
    : `ws://127.0.0.1:${Number(import.meta.env.VITE_MK_PORT ?? 3030)}`;

/* ═══════════════════════════════════════════════════════════════════
   ICONS  (zero dependencies)
   ═══════════════════════════════════════════════════════════════════ */
function IconFile() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth="2"
      strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
      <polyline points="14 2 14 8 20 8"/>
    </svg>
  );
}

function IconSun() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth="2.2"
      strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="12" cy="12" r="4"/>
      <line x1="12" y1="2"  x2="12" y2="5"/>
      <line x1="12" y1="19" x2="12" y2="22"/>
      <line x1="4.22" y1="4.22"  x2="6.34" y2="6.34"/>
      <line x1="17.66" y1="17.66" x2="19.78" y2="19.78"/>
      <line x1="2"  y1="12" x2="5"  y2="12"/>
      <line x1="19" y1="12" x2="22" y2="12"/>
      <line x1="4.22"  y1="19.78" x2="6.34"  y2="17.66"/>
      <line x1="17.66" y1="6.34"  x2="19.78" y2="4.22"/>
    </svg>
  );
}

function IconMoon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth="2.2"
      strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/>
    </svg>
  );
}

/* ═══════════════════════════════════════════════════════════════════
   THEME TOGGLE  — parallelogram shape via clip-path
   ═══════════════════════════════════════════════════════════════════ */
function ThemeToggle({
  theme,
  onToggle,
}: {
  theme: Theme;
  onToggle: () => void;
}) {
  const isDark = theme === "dark";
  return (
    <button
      type="button"
      onClick={onToggle}
      className="theme-toggle"
      aria-label={`Switch to ${isDark ? "light" : "dark"} mode`}
      aria-pressed={isDark}
    >
      {/* Switch track + thumb */}
      <span className="toggle-track" role="presentation">
        <span className="toggle-thumb" />
      </span>

      {/* Icon */}
      {isDark ? <IconMoon /> : <IconSun />}

      {/* Label */}
      <span style={{ minWidth: "2.1rem", textAlign: "left", pointerEvents: "none" }}>
        {isDark ? "Dark" : "Light"}
      </span>
    </button>
  );
}

/* ═══════════════════════════════════════════════════════════════════
   LIVE BADGE — parallelogram
   ═══════════════════════════════════════════════════════════════════ */
function LiveBadge() {
  return (
    <span className="live-badge" aria-live="polite" aria-label="Live preview active">
      <span className="live-dot" />
      Live
    </span>
  );
}

/* ═══════════════════════════════════════════════════════════════════
   CONN BADGE — parallelogram, shown while not connected
   ═══════════════════════════════════════════════════════════════════ */
function ConnBadge({ wsUrl }: { wsUrl: string }) {
  return (
    <div className="conn-badge-wrap">
      <div className="conn-badge" role="status">
        <span className="conn-dot" />
        <span>
          Connecting to{" "}
          <code style={{
            fontFamily: "var(--font-mono)",
            fontSize: "0.67rem",
            color: "var(--fg)",
          }}>
            {wsUrl}
          </code>
          …
        </span>
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════
   APP ROOT
   ═══════════════════════════════════════════════════════════════════ */
export default function App() {
  const [status,   setStatus]   = useState<ConnStatus>("connecting");
  const [html,     setHtml]     = useState("");
  const [fileName, setFileName] = useState("");
  const [theme,    setTheme]    = useState<Theme>("dark");

  useDocumentTitle(fileName);

  /* ── Cursor / viewport sync hooks — fully preserved ── */
  const { setCursor, syncViewport } = usePreviewViewportSync(html);

  usePreviewSocket({
    wsUrl,
    setStatus,
    setHtml,
    setFileName,
    setTheme,
    setCursor,    // ← passed through untouched
    syncViewport, // ← passed through untouched
  });

  const shortName = fileName.split(/\\|\//).pop() || "Markdown Preview";

  return (
    <div
      data-theme={theme}
      className="app-root"
    >
      <div className="app-wrap">

        {/* ════════════════════════════
            HEADER
            ════════════════════════════ */}
        <header className="app-header">
          {/* Filename */}
          <div className="file-name">
            <IconFile />
            <span className="file-name-text" title={fileName}>
              {shortName}
            </span>
          </div>

          {/* Live indicator — only when connected */}
          {status === "connected" && <LiveBadge />}

          {/* Theme toggle */}
          <ThemeToggle
            theme={theme}
            onToggle={() => setTheme(t => t === "dark" ? "light" : "dark")}
          />
        </header>

        {/* ════════════════════════════
            MARKDOWN CONTENT
            ════════════════════════════ */}
        <section
          className="app-content markdown-body prose max-w-none"
          style={{
            flex: 1,
            border: "1px solid var(--border)",
            borderTop: "none",
            background: "var(--bg)",
            padding: "1.75rem 1.5rem",    /* overridden by responsive CSS */
            fontSize: "0.9375rem",
            lineHeight: 1.78,
            boxShadow: "var(--shadow-md)",
            borderRadius: "0 0 0.5rem 0.5rem",
            color: "var(--fg)",
            transition: "background-color 280ms ease, border-color 280ms ease",
          }}
          dangerouslySetInnerHTML={{ __html: html }}
        />

        {/* ════════════════════════════
            CONNECTION STATUS
            ════════════════════════════ */}
        {status !== "connected" && <ConnBadge wsUrl={wsUrl} />}

      </div>
    </div>
  );
}