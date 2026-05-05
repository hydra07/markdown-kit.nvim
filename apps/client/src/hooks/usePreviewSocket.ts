import { useEffect, useRef } from "preact/hooks";
import type { StateUpdater } from "preact/hooks";
import type { ConnStatus, CursorUpdatePayload, Theme } from "../types/types";

type UsePreviewSocketParams = {
  wsUrl: string;
  setStatus: (val: StateUpdater<ConnStatus>) => void;
  setHtml: (val: StateUpdater<string>) => void;
  setFileName: (val: StateUpdater<string>) => void;
  setTheme: (val: StateUpdater<Theme>) => void;
  setCursor: (cursorLine?: number, lineCount?: number) => void;
  syncViewport: () => void;
};

export function usePreviewSocket({
  wsUrl,
  setStatus,
  setHtml,
  setFileName,
  setTheme,
  setCursor,
  syncViewport,
}: UsePreviewSocketParams) {
  const lastTickRef = useRef(-1);
  const lastHtmlRef = useRef("");
  const rafRef = useRef<number | null>(null);
  const syncViewportRef = useRef(syncViewport);

  useEffect(() => {
    syncViewportRef.current = syncViewport;
  }, [syncViewport]);

  useEffect(() => {
    let socket: WebSocket | null = null;
    let reconnectTimer: number | null = null;
    let stopped = false;

    const scheduleViewportSync = () => {
      if (rafRef.current !== null) return;
      rafRef.current = window.requestAnimationFrame(() => {
        rafRef.current = null;
        syncViewportRef.current();
      });
    };

    const connect = () => {
      if (stopped) return;
      setStatus("connecting");
      socket = new WebSocket(wsUrl);

      socket.onopen = () => setStatus("connected");
      socket.onerror = () => setStatus("error");
      socket.onclose = () => {
        setStatus("closed");
        if (!stopped) reconnectTimer = window.setTimeout(connect, 600);
      };

      socket.onmessage = (event) => {
        let data: Record<string, unknown>;
        try {
          data = JSON.parse(String(event.data));
        } catch {
          return;
        }

        if (data.type === "cursor:update") {
          const payload = data.payload as CursorUpdatePayload | undefined;
          if (!payload) return;
          setCursor(payload.cursorLine, payload.lineCount);
          scheduleViewportSync();
          return;
        }

        if (data.type === "preview:update") {
          // Changed to match Rust backend which sends `html` instead of `markdown`
          // (Legacy Bun sent `markdown`)
          const payload = data.payload as any;
          if (!payload) return;

          const htmlFromService = typeof payload.html === "string" ? payload.html : (typeof payload.markdown === "string" ? payload.markdown : "");
          const tick = typeof payload.contentTick === "number" ? payload.contentTick : 0;

          if (typeof payload.fileName === "string") setFileName(payload.fileName);
          setCursor(payload.cursorLine, payload.lineCount);
          setTheme(payload.theme === "light" ? "light" : "dark");

          if (tick !== lastTickRef.current || htmlFromService !== lastHtmlRef.current) {
            lastTickRef.current = tick;
            lastHtmlRef.current = htmlFromService;
            setHtml(htmlFromService);
          } else {
            scheduleViewportSync();
          }
          return;
        }

        if (data.type === "preview:close") window.close();
      };
    };

    connect();

    return () => {
      stopped = true;
      if (reconnectTimer !== null) window.clearTimeout(reconnectTimer);
      if (rafRef.current !== null) window.cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
      socket?.close();
    };
  }, [setCursor, setFileName, setHtml, setStatus, setTheme, wsUrl]);
}
