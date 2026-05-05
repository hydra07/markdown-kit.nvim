import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  useRef,
  useLayoutEffect,
} from "preact/hooks";
import morphdom from "morphdom";
// @ts-ignore: module doesn't export types correctly
import renderMathInElement from "katex/dist/contrib/auto-render.mjs";
import "katex/dist/katex.min.css";
import { ConnBadge } from "./components/ui/ConnBadge";
import { FollowCursorToggle } from "./components/ui/FollowCursorToggle";
import { LiveBadge } from "./components/ui/LiveBadge";
import { ThemeToggle } from "./components/ui/ThemeToggle";
import { IconFile } from "./components/ui/icons/IconFile";
import { useDocumentTitle } from "./hooks/useDocumentTitle";
import { usePreviewSocket } from "./hooks/usePreviewSocket";
import {
  usePreviewCurrentBlockHighlight,
  usePreviewFollowScroll,
} from "./hooks/usePreviewViewportSync";
import type { ConnStatus, Theme } from "./types/types";
import "./app.css";

/* ─── WS URL ─────────────────────────────────────────────────────── */
const params = new URLSearchParams(window.location.search);
const wsFromQuery = params.get("ws");
const wsFromLocation =
  window.location.protocol.startsWith("https")
    ? `wss://${window.location.host}/ws`
    : `ws://${window.location.host}/ws`;
const wsUrl =
  wsFromQuery && wsFromQuery !== ""
    ? wsFromQuery
    : (window.location.host !== ""
      ? wsFromLocation
      : `ws://127.0.0.1:${Number(import.meta.env.VITE_MK_PORT ?? 35831)}/ws`);

function themeMermaidSvg(root: HTMLElement, theme: Theme) {
  const svgs = root.querySelectorAll(".mermaid-rendered svg");
  if (svgs.length === 0) return;

  const map = theme === "dark"
    ? {
        "#FFFFFF": "var(--bg-code)",
        "#F8FAFC": "color-mix(in srgb, var(--bg-code) 74%, #ffffff 26%)",
        "#0F172A": "var(--fg)",
        "#64748B": "color-mix(in srgb, var(--fg-muted) 82%, #9aa9c4 18%)",
        "#94A3B8": "color-mix(in srgb, var(--border-soft) 80%, #9aa9c4 20%)",
        "#E2E8F0": "color-mix(in srgb, var(--border-soft) 88%, #9aa9c4 12%)",
      }
    : null;

  svgs.forEach((svgNode) => {
    const svg = svgNode as SVGSVGElement;
    const reset = () => {
      svg.querySelectorAll("[data-mk-themed]").forEach((node) => {
        const el = node as SVGElement;
        const fill = el.getAttribute("data-mk-fill");
        const stroke = el.getAttribute("data-mk-stroke");
        if (fill !== null) el.setAttribute("fill", fill);
        if (stroke !== null) el.setAttribute("stroke", stroke);
        el.removeAttribute("data-mk-fill");
        el.removeAttribute("data-mk-stroke");
        el.removeAttribute("data-mk-themed");
      });
    };

    reset();
    if (!map) return;

    svg.querySelectorAll("[fill], [stroke]").forEach((node) => {
      const el = node as SVGElement;
      const fill = el.getAttribute("fill");
      const stroke = el.getAttribute("stroke");
      let changed = false;

      if (fill && map[fill as keyof typeof map]) {
        el.setAttribute("data-mk-fill", fill);
        el.setAttribute("fill", map[fill as keyof typeof map]);
        changed = true;
      }
      if (stroke && map[stroke as keyof typeof map]) {
        el.setAttribute("data-mk-stroke", stroke);
        el.setAttribute("stroke", map[stroke as keyof typeof map]);
        changed = true;
      }
      if (changed) el.setAttribute("data-mk-themed", "1");
    });
  });
}

export function App() {
  const [status, setStatus] = useState<ConnStatus>("connecting");
  const [html, setHtml] = useState("");
  const contentRef = useRef<HTMLElement>(null);
  const [fileName, setFileName] = useState("");
  const [theme, setTheme] = useState<Theme>("dark");
  const [mermaidModalSvg, setMermaidModalSvg] = useState<string | null>(null);
  const [mermaidZoom, setMermaidZoom] = useState(1);
  const [isPanning, setIsPanning] = useState(false);
  const [mermaidPan, setMermaidPan] = useState({ x: 0, y: 0 });
  const mermaidViewportRef = useRef<HTMLDivElement>(null);
  const mermaidPanRef = useRef({ x: 0, y: 0 });
  const panStateRef = useRef<{ startX: number; startY: number; x: number; y: number } | null>(null);
  const [copiedCodeId, setCopiedCodeId] = useState<string | null>(null);
  const [mermaidCopyState, setMermaidCopyState] = useState<"idle" | "done">("idle");
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

  useLayoutEffect(() => {
    if (!contentRef.current) return;
    const tempDiv = document.createElement("section");
    tempDiv.innerHTML = html;

    morphdom(contentRef.current, tempDiv, {
      childrenOnly: true,
      onBeforeElUpdated: (fromEl, toEl) => {
        // Keep active cursor lines intact during diff
        if (fromEl.classList.contains("cursor-line-active")) {
          toEl.classList.add("cursor-line-active");
        }
        return true;
      },
    });

    // Render Math via KaTeX on the client (since it manipulates DOM)
    renderMathInElement(contentRef.current, {
      delimiters: [
        { left: "$$", right: "$$", display: true },
        { left: "$", right: "$", display: false },
        { left: "\\(", right: "\\)", display: false },
        { left: "\\[", right: "\\]", display: true },
      ],
      throwOnError: false,
    });
    themeMermaidSvg(contentRef.current, theme);

    // Add copy buttons to code fences once after each content render.
    const codeBlocks = contentRef.current.querySelectorAll("pre.hljs");
    codeBlocks.forEach((pre, idx) => {
      if (!(pre instanceof HTMLElement)) return;
      pre.dataset.mkCodeId = pre.dataset.mkCodeId || `code-${idx}`;
      if (pre.querySelector(".mk-code-copy-btn")) return;
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "mk-code-copy-btn";
      btn.textContent = "Copy";
      btn.setAttribute("aria-label", "Copy code block");
      pre.appendChild(btn);
    });
  }, [html, theme]);

  useEffect(() => {
    const root = contentRef.current;
    if (!root) return;

    const onClick = (event: MouseEvent) => {
      const target = event.target as Element | null;
      const copyButton = target?.closest(".mk-code-copy-btn");
      if (copyButton && copyButton instanceof HTMLButtonElement) {
        const pre = copyButton.closest("pre.hljs");
        const code = pre?.querySelector("code");
        const text = code?.textContent ?? "";
        if (text.trim() === "") return;
        void navigator.clipboard.writeText(text).then(() => {
          const id = (pre as HTMLElement | null)?.dataset.mkCodeId ?? "code";
          setCopiedCodeId(id);
          window.setTimeout(() => setCopiedCodeId((cur) => (cur === id ? null : cur)), 1200);
        });
        return;
      }

      const block = target?.closest(".mermaid-rendered");
      if (!block || !(block instanceof HTMLElement)) return;
      const svg = block.querySelector("svg");
      if (!svg) return;
      setMermaidModalSvg(svg.outerHTML);
      setMermaidZoom(1);
      setMermaidPan({ x: 0, y: 0 });
      setMermaidCopyState("idle");
    };

    root.addEventListener("click", onClick);
    return () => root.removeEventListener("click", onClick);
  }, []);

  useEffect(() => {
    if (!mermaidModalSvg) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setMermaidModalSvg(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [mermaidModalSvg]);

  useEffect(() => {
    mermaidPanRef.current = mermaidPan;
  }, [mermaidPan]);

  useEffect(() => {
    const viewport = mermaidViewportRef.current;
    if (!viewport || !mermaidModalSvg) return;

    const onWheel = (event: WheelEvent) => {
      if (!event.ctrlKey) return;
      event.preventDefault();
      const factor = event.deltaY > 0 ? 0.92 : 1.08;
      setMermaidZoom((z) => Math.max(0.4, Math.min(4, +(z * factor).toFixed(3))));
    };

    const onPointerDown = (event: PointerEvent) => {
      if (event.button !== 0) return;
      panStateRef.current = {
        startX: event.clientX,
        startY: event.clientY,
        x: mermaidPanRef.current.x,
        y: mermaidPanRef.current.y,
      };
      setIsPanning(true);
      viewport.setPointerCapture(event.pointerId);
    };

    const onPointerMove = (event: PointerEvent) => {
      const pan = panStateRef.current;
      if (!pan) return;
      setMermaidPan({
        x: pan.x + (event.clientX - pan.startX),
        y: pan.y + (event.clientY - pan.startY),
      });
    };

    const endPan = (event: PointerEvent) => {
      if (!panStateRef.current) return;
      panStateRef.current = null;
      setIsPanning(false);
      if (viewport.hasPointerCapture(event.pointerId)) {
        viewport.releasePointerCapture(event.pointerId);
      }
    };

    viewport.addEventListener("wheel", onWheel, { passive: false });
    viewport.addEventListener("pointerdown", onPointerDown);
    viewport.addEventListener("pointermove", onPointerMove);
    viewport.addEventListener("pointerup", endPan);
    viewport.addEventListener("pointercancel", endPan);

    return () => {
      viewport.removeEventListener("wheel", onWheel);
      viewport.removeEventListener("pointerdown", onPointerDown);
      viewport.removeEventListener("pointermove", onPointerMove);
      viewport.removeEventListener("pointerup", endPan);
      viewport.removeEventListener("pointercancel", endPan);
      panStateRef.current = null;
      setIsPanning(false);
    };
  }, [mermaidModalSvg]);

  useEffect(() => {
    const root = contentRef.current;
    if (!root) return;
    root.querySelectorAll<HTMLButtonElement>(".mk-code-copy-btn").forEach((btn) => {
      const pre = btn.closest("pre.hljs") as HTMLElement | null;
      const id = pre?.dataset.mkCodeId ?? "";
      btn.textContent = copiedCodeId === id ? "Copied" : "Copy";
    });
  }, [copiedCodeId, html]);

  const mermaidSvgBlobUrl = useMemo(() => {
    if (!mermaidModalSvg) return null;
    return URL.createObjectURL(new Blob([mermaidModalSvg], { type: "image/svg+xml;charset=utf-8" }));
  }, [mermaidModalSvg]);

  useEffect(() => () => {
    if (mermaidSvgBlobUrl) URL.revokeObjectURL(mermaidSvgBlobUrl);
  }, [mermaidSvgBlobUrl]);

  const saveMermaidSvg = useCallback(() => {
    if (!mermaidSvgBlobUrl) return;
    const link = document.createElement("a");
    link.href = mermaidSvgBlobUrl;
    link.download = "mermaid-diagram.svg";
    link.click();
  }, [mermaidSvgBlobUrl]);

  const saveMermaidPng = useCallback(async () => {
    if (!mermaidModalSvg) return;
    const svgBlob = new Blob([mermaidModalSvg], { type: "image/svg+xml;charset=utf-8" });
    const url = URL.createObjectURL(svgBlob);
    try {
      const img = new Image();
      await new Promise<void>((resolve, reject) => {
        img.onload = () => resolve();
        img.onerror = () => reject(new Error("Failed to load SVG"));
        img.src = url;
      });
      const canvas = document.createElement("canvas");
      const width = Math.max(1, img.width);
      const height = Math.max(1, img.height);
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      ctx.fillStyle = getComputedStyle(document.documentElement).getPropertyValue("--bg") || "#ffffff";
      ctx.fillRect(0, 0, width, height);
      ctx.drawImage(img, 0, 0);
      const pngUrl = canvas.toDataURL("image/png");
      const link = document.createElement("a");
      link.href = pngUrl;
      link.download = "mermaid-diagram.png";
      link.click();
    } finally {
      URL.revokeObjectURL(url);
    }
  }, [mermaidModalSvg]);

  const copyMermaidSvg = useCallback(async () => {
    if (!mermaidModalSvg) return;
    await navigator.clipboard.writeText(mermaidModalSvg);
    setMermaidCopyState("done");
    window.setTimeout(() => setMermaidCopyState("idle"), 1200);
  }, [mermaidModalSvg]);

  // Hack: the hooks expect `markdown` string as a dependency to re-run highlight logic,
  // but html is fine too since it changes whenever content changes.
  const { setCursorForHighlight, syncHighlight } =
    usePreviewCurrentBlockHighlight(html);
  const { setCursorForFollow, syncFollowScroll } = usePreviewFollowScroll(
    html,
    followCursor,
  );

  const setCursor = useCallback(
    (cursorLine?: number, lineCount?: number) => {
      setCursorForHighlight(cursorLine, lineCount);
      setCursorForFollow(cursorLine, lineCount);
    },
    [setCursorForFollow, setCursorForHighlight],
  );

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
    setCursor,
    syncViewport,
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
          <FollowCursorToggle
            enabled={followCursor}
            onToggle={() => setFollowCursor((v) => !v)}
          />

          <ThemeToggle
            theme={theme}
            onToggle={() => setTheme((t) => (t === "dark" ? "light" : "dark"))}
          />
        </header>

        <section
          ref={contentRef}
          className="app-content markdown-body prose max-w-none flex-1 border border-t-0 border-transparent bg-(--glass) px-6 py-7 text-[0.9375rem] leading-[1.78] text-(--fg) shadow-(--shadow-md) backdrop-blur-md transition-[background-color,border-color,color] duration-300 hover:border-(--border-soft)"
        />

        {status !== "connected" && <ConnBadge wsUrl={wsUrl} />}
      </div>

      {mermaidModalSvg && (
        <div
          className="mermaid-modal"
          role="dialog"
          aria-modal="true"
          aria-label="Mermaid diagram detail"
          onClick={() => setMermaidModalSvg(null)}
        >
          <div className="mermaid-modal-panel" onClick={(e) => e.stopPropagation()}>
            <div className="mermaid-modal-toolbar">
              <span className="mermaid-modal-hint">Ctrl + scroll to zoom • Drag to pan</span>
              <button type="button" className="mermaid-modal-btn" onClick={saveMermaidSvg}>
                Save SVG
              </button>
              <button type="button" className="mermaid-modal-btn" onClick={() => void saveMermaidPng()}>
                Save PNG
              </button>
              <button type="button" className="mermaid-modal-btn" onClick={() => void copyMermaidSvg()}>
                {mermaidCopyState === "done" ? "Copied" : "Copy SVG"}
              </button>
              <button
                type="button"
                className="mermaid-modal-close"
                onClick={() => setMermaidModalSvg(null)}
                aria-label="Close mermaid detail"
              >
                Close
              </button>
            </div>
            <div className={`mermaid-modal-viewport${isPanning ? " is-panning" : ""}`} ref={mermaidViewportRef}>
              <div
                className="mermaid-modal-content"
                // biome-ignore lint/security/noDangerouslySetInnerHtml: trusted local preview content
                dangerouslySetInnerHTML={{ __html: mermaidModalSvg }}
                style={{ transform: `translate(${mermaidPan.x}px, ${mermaidPan.y}px) scale(${mermaidZoom})` }}
              />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
