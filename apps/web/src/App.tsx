import { useCallback, useEffect, useState } from "react";
import { ConnBadge } from "./components/ui/ConnBadge";
import { FollowCursorToggle } from "./components/ui/FollowCursorToggle";
import { LiveBadge } from "./components/ui/LiveBadge";
import { ThemeToggle } from "./components/ui/ThemeToggle";
import { IconFile } from "./components/ui/icons/IconFile";
import { useDocumentTitle } from "./hooks/useDocumentTitle";
import { usePreviewSocket } from "./hooks/usePreviewSocket";
import { usePreviewCurrentBlockHighlight, usePreviewFollowScroll } from "./hooks/usePreviewViewportSync";
import type { ConnStatus, Theme } from "./types/types";
import "./App.css";

/* ─── WS URL ─────────────────────────────────────────────────────── */
const params     = new URLSearchParams(window.location.search);
const wsFromQuery = params.get("ws");
const wsUrl =
  wsFromQuery && wsFromQuery !== ""
    ? wsFromQuery
    : `ws://127.0.0.1:${Number(import.meta.env.VITE_MK_PORT ?? 35831)}`;

export default function App() {
  const [status,   setStatus]   = useState<ConnStatus>("connecting");
  const [html,     setHtml]     = useState("");
  const [fileName, setFileName] = useState("");
  const [theme,    setTheme]    = useState<Theme>("dark");
  const [followCursor, setFollowCursor] = useState<boolean>(() => {
    try {
      return window.localStorage.getItem("mk_follow_cursor") !== "0";
    } catch {
      return true;
    }
  });

  useDocumentTitle(fileName);

  useEffect(() => {
    try {
      window.localStorage.setItem("mk_follow_cursor", followCursor ? "1" : "0");
    } catch {
      // ignore storage errors in restricted contexts
    }
  }, [followCursor]);

  const { setCursorForHighlight, syncHighlight } = usePreviewCurrentBlockHighlight(html);
  const { setCursorForFollow, syncFollowScroll } = usePreviewFollowScroll(html, followCursor);

  const setCursor = useCallback((cursorLine?: number, lineCount?: number) => {
    setCursorForHighlight(cursorLine, lineCount);
    setCursorForFollow(cursorLine, lineCount);
  }, [setCursorForFollow, setCursorForHighlight]);

  const syncViewport = useCallback(() => {
    syncHighlight();
    syncFollowScroll();
  }, [syncFollowScroll, syncHighlight]);

  useEffect(() => {
    syncHighlight(true);
  }, [followCursor, syncHighlight]);

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
      className="app-root min-h-dvh w-full bg-(--bg-page) text-(--fg) antialiased transition-colors duration-300"
    >
      <div className="app-wrap">
        <header className="app-header">
          <div className="file-name">
            <IconFile />
            <span className="file-name-text" title={fileName}>
              {shortName}
            </span>
          </div>

          {status === "connected" && <LiveBadge />}

          <FollowCursorToggle enabled={followCursor} onToggle={() => setFollowCursor((v) => !v)} />

          <ThemeToggle
            theme={theme}
            onToggle={() => setTheme(t => t === "dark" ? "light" : "dark")}
          />
        </header>

        <section
          className="app-content markdown-body prose max-w-none flex-1 border border-t-0 border-transparent bg-(--glass) px-6 py-7 text-[0.9375rem] leading-[1.78] text-(--fg) shadow-(--shadow-md) backdrop-blur-md transition-[background-color,border-color,color] duration-300 hover:border-(--border-soft)"
          dangerouslySetInnerHTML={{ __html: html }}
        />

        {status !== "connected" && <ConnBadge wsUrl={wsUrl} />}

      </div>
    </div>
  );
}