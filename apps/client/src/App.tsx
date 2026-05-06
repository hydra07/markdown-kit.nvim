import {
  useCallback,
  useEffect,
  useState,
  useRef,
  useLayoutEffect,
} from "preact/hooks";
import morphdom from "morphdom";
import { ConnBadge } from "./components/ui/ConnBadge";
import { FollowCursorToggle } from "./components/ui/FollowCursorToggle";
import { LiveBadge } from "./components/ui/LiveBadge";
import { ThemeToggle } from "./components/ui/ThemeToggle";
import { IconFile } from "./components/ui/icons/IconFile";
import { MermaidModal } from "./components/preview/MermaidModal";
import { wsUrl } from "./configs/ws";
import { useDocumentTitle } from "./hooks/useDocumentTitle";
import { useMermaidModal } from "./hooks/useMermaidModal";
import { usePreviewSocket } from "./hooks/usePreviewSocket";
import {
  usePreviewCurrentBlockHighlight,
  usePreviewFollowScroll,
} from "./hooks/usePreviewViewportSync";
import type { ConnStatus, Theme } from "./types/types";
import {
  applyAdaptiveMermaidSizing,
  applyMermaidThemeToPreview,
} from "./utils/mermaid";
import "./app.css";

/* ─── App ─────────────────────────────────────────────────────────────────── */
export function App() {
  const [status, setStatus] = useState<ConnStatus>("connecting");
  const [html, setHtml] = useState("");
  const contentRef = useRef<HTMLElement>(null);
  const [fileName, setFileName] = useState("");
  const [theme, setTheme] = useState<Theme>("dark");

  const {
    modalSvgString,
    themedModalSvg,
    mermaidZoom,
    isPanning,
    mermaidPan,
    mermaidViewportRef,
    mermaidCopyState,
    openFromB64,
    closeModal,
    saveMermaidSvg,
    saveMermaidPng,
    copyMermaidSvg,
  } = useMermaidModal(theme);

  // Code copy state
  const [copiedCodeId, setCopiedCodeId] = useState<string | null>(null);

  // Follow cursor preference (persisted)
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
      /* restricted context */
    }
  }, [followCursor]);

  // ── Content rendering ──────────────────────────────────────────────────────
  useLayoutEffect(() => {
    if (!contentRef.current) return;

    const tempDiv = document.createElement("section");
    tempDiv.innerHTML = html;

    morphdom(contentRef.current, tempDiv, {
      childrenOnly: true,
      onBeforeElUpdated: (fromEl, toEl) => {
        // Preserve active cursor highlight class across diffs.
        if (fromEl.classList.contains("cursor-line-active")) {
          toEl.classList.add("cursor-line-active");
        }
        // Preserve mermaid <img> elements — they never need re-rendering.
        if (
          fromEl.classList.contains("mermaid-rendered") &&
          toEl.classList.contains("mermaid-rendered") &&
          fromEl.getAttribute("data-svg-b64") ===
            toEl.getAttribute("data-svg-b64")
        ) {
          return false;
        }
        return true;
      },
    });

    // Mermaid: adaptive width per diagram + apply current theme colors.
    applyAdaptiveMermaidSizing(contentRef.current);
    applyMermaidThemeToPreview(contentRef.current, theme);

    // Add copy buttons to code fences.
    const codeBlocks =
      contentRef.current.querySelectorAll<HTMLElement>("pre.hljs");
    codeBlocks.forEach((pre, idx) => {
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

  // Theme changes should immediately repaint existing Mermaid SVGs.
  useEffect(() => {
    if (!contentRef.current) return;
    applyMermaidThemeToPreview(contentRef.current, theme);
  }, [theme]);

  // ── Click delegation ───────────────────────────────────────────────────────
  useEffect(() => {
    const root = contentRef.current;
    if (!root) return;

    const onClick = (event: MouseEvent) => {
      const target = event.target as Element | null;

      // Code copy button
      const copyBtn = target?.closest(".mk-code-copy-btn");
      if (copyBtn instanceof HTMLButtonElement) {
        const pre = copyBtn.closest("pre.hljs");
        const text = pre?.querySelector("code")?.textContent ?? "";
        if (!text.trim()) return;
        void navigator.clipboard.writeText(text).then(() => {
          const id = (pre as HTMLElement | null)?.dataset.mkCodeId ?? "code";
          setCopiedCodeId(id);
          window.setTimeout(
            () => setCopiedCodeId((cur) => (cur === id ? null : cur)),
            1200,
          );
        });
        return;
      }

      // Mermaid diagram click → open modal
      const block = target?.closest(".mermaid-rendered");
      if (!(block instanceof HTMLElement)) return;

      // Read the SVG from the data attribute written by the BE.
      // This gives us the original, unmodified SVG string — not whatever the
      // browser may have mutated after DOM insertion.
      const b64 = block.dataset.svgB64;
      if (!b64) return;
      openFromB64(b64);
    };

    root.addEventListener("click", onClick);
    return () => root.removeEventListener("click", onClick);
  }, [openFromB64]);

  // ── Code copy button labels ────────────────────────────────────────────────
  useEffect(() => {
    contentRef.current
      ?.querySelectorAll<HTMLButtonElement>(".mk-code-copy-btn")
      .forEach((btn) => {
        const pre = btn.closest("pre.hljs") as HTMLElement | null;
        const id = pre?.dataset.mkCodeId ?? "";
        btn.textContent = copiedCodeId === id ? "Copied" : "Copy";
      });
  }, [copiedCodeId, html]);

  // ── Cursor / scroll sync ───────────────────────────────────────────────────
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

  // ── Render ─────────────────────────────────────────────────────────────────
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

      {modalSvgString && themedModalSvg && (
        <MermaidModal
          themedModalSvg={themedModalSvg}
          isPanning={isPanning}
          mermaidZoom={mermaidZoom}
          mermaidPan={mermaidPan}
          mermaidCopyState={mermaidCopyState}
          mermaidViewportRef={mermaidViewportRef}
          onClose={closeModal}
          onSaveSvg={saveMermaidSvg}
          onSavePng={() => void saveMermaidPng()}
          onCopySvg={() => void copyMermaidSvg()}
        />
      )}
    </div>
  );
}
