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
import { OledToggle } from "./components/ui/OledToggle";
import { ReadingProgress } from "./components/ui/ReadingProgress";
import { ThemeToggle } from "./components/ui/ThemeToggle";
import { Toc } from "./components/ui/Toc";
import { IconFile } from "./components/ui/icons/IconFile";
import { MermaidModal } from "./components/preview/MermaidModal";
import { wsUrl } from "./configs/ws";
import { useDocumentTitle } from "./hooks/useDocumentTitle";
import { useMermaidModal } from "./hooks/useMermaidModal";
import { usePreviewSocket } from "./hooks/usePreviewSocket";
import { useReadingProgress } from "./hooks/useReadingProgress";
import { useToc } from "./hooks/useToc";
import {
  usePreviewCurrentBlockHighlight,
  usePreviewFollowScroll,
} from "./hooks/usePreviewViewportSync";
import type { ConnStatus, Theme } from "./types/types";
import {
  applyAdaptiveMermaidSizing,
  applyMermaidThemeToPreview,
} from "./utils/mermaid";
import { circularReveal } from "./utils/viewTransition";
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

  // OLED pure-black preference (persisted, independent of dark/light)
  const [oled, setOled] = useState<boolean>(() => {
    try {
      return window.localStorage.getItem("mk_oled") === "1";
    } catch {
      return false;
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

  useEffect(() => {
    try {
      window.localStorage.setItem("mk_oled", oled ? "1" : "0");
    } catch {
      /* restricted context */
    }
  }, [oled]);

  // Drive theme/oled from the document root so the View Transition snapshot
  // (which is taken on the root element) reflects the active theme.
  useEffect(() => {
    const root = document.documentElement;
    root.dataset.theme = theme;
    if (theme === "dark" && oled) root.dataset.oled = "true";
    else delete root.dataset.oled;
  }, [theme, oled]);

  const pointFromEvent = (event?: MouseEvent) => ({
    x: event?.clientX ?? window.innerWidth - 40,
    y: event?.clientY ?? 40,
  });

  // Light/dark as a circular reveal from the click point: the new theme grows
  // out when going dark, and contracts back when returning to light.
  const toggleTheme = useCallback(
    (event?: MouseEvent) => {
      const next: Theme = theme === "dark" ? "light" : "dark";
      const { x, y } = pointFromEvent(event);
      circularReveal(
        () => {
          document.documentElement.dataset.theme = next;
          // Recolour Mermaid SVGs synchronously so they are captured in the new
          // snapshot — otherwise the effect repaints them a frame later and the
          // diagrams flash at the end of the wipe.
          if (contentRef.current) {
            applyMermaidThemeToPreview(contentRef.current, next);
          }
          setTheme(next);
        },
        { x, y, expand: next === "dark" },
      );
    },
    [theme],
  );

  // OLED pure-black also repaints the whole page, so it gets the same circular
  // wipe — true black grows out when enabled, contracts when disabled.
  const toggleOled = useCallback(
    (event?: MouseEvent) => {
      const next = !oled;
      const { x, y } = pointFromEvent(event);
      circularReveal(
        () => {
          const root = document.documentElement;
          if (next) root.dataset.oled = "true";
          else delete root.dataset.oled;
          setOled(next);
        },
        { x, y, expand: next },
      );
    },
    [oled],
  );

  // Follow-cursor toggles a vertical "tracking" sweep down the viewport — an
  // effect that mirrors what the feature does (drives the scroll position).
  const [followPulse, setFollowPulse] = useState(0);
  const toggleFollow = useCallback(() => {
    setFollowPulse((p) => p + 1);
    setFollowCursor((v) => !v);
  }, []);

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
        // Skip re-diffing a code block whose source is unchanged: keep the
        // existing (already-decorated, already-highlighted) DOM and only sync
        // its source-line range so cursor mapping stays correct after edits
        // above it. Avoids re-walking every <pre> on each keystroke and keeps
        // the injected copy button / language label intact.
        if (
          fromEl.classList.contains("hljs") &&
          toEl.classList.contains("hljs")
        ) {
          const fromCode = fromEl.querySelector("code")?.textContent;
          const toCode = toEl.querySelector("code")?.textContent;
          if (fromCode != null && fromCode === toCode) {
            for (const name of ["data-src-start", "data-src-end"] as const) {
              const v = toEl.getAttribute(name);
              if (v === null) fromEl.removeAttribute(name);
              else fromEl.setAttribute(name, v);
            }
            return false;
          }
        }
        return true;
      },
    });

    // Mermaid: adaptive width per diagram + apply current theme colors.
    applyAdaptiveMermaidSizing(contentRef.current);
    applyMermaidThemeToPreview(contentRef.current, theme);

    // Decorate code fences with a language label + copy button.
    const codeBlocks =
      contentRef.current.querySelectorAll<HTMLElement>("pre.hljs");
    codeBlocks.forEach((pre, idx) => {
      pre.dataset.mkCodeId = pre.dataset.mkCodeId || `code-${idx}`;
      if (pre.querySelector(".mk-code-copy-btn")) return;

      const codeEl = pre.querySelector("code");
      const langClass = Array.from(codeEl?.classList ?? []).find((c) =>
        c.startsWith("language-"),
      );
      const lang = langClass ? langClass.slice("language-".length) : "";
      if (lang) {
        const label = document.createElement("span");
        label.className = "mk-code-lang";
        label.textContent = lang;
        pre.appendChild(label);
      }

      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "mk-code-copy-btn";
      btn.textContent = "Copy";
      btn.setAttribute("aria-label", "Copy code block");
      pre.appendChild(btn);
    });

    // Virtualize once the document is large enough that off-screen paint cost
    // matters. childElementCount counts top-level blocks (display:contents
    // wrappers + lists + code/mermaid), a cheap proxy for document size.
    const VIRTUALIZE_THRESHOLD = 400;
    contentRef.current.classList.toggle(
      "mk-virtualize",
      contentRef.current.childElementCount > VIRTUALIZE_THRESHOLD,
    );
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

  // ── Outline (TOC + scroll-spy) & reading progress ───────────────────────────
  const { items: tocItems, activeId, scrollToId } = useToc(html, contentRef);
  const progress = useReadingProgress();

  const shortName = fileName.split(/\\|\//).pop() || "Markdown Preview";

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <div className="app-root min-h-dvh w-full bg-(--bg-page) text-(--fg) antialiased">

      <ReadingProgress progress={progress} />

      {followPulse > 0 && (
        <span
          key={followPulse}
          className="mk-follow-sweep"
          data-on={followCursor ? "true" : undefined}
          aria-hidden="true"
        />
      )}

      <div className="app-shell">
        <header className="app-header">
          <div className="file-name">
            <IconFile />
            <span className="file-name-text" title={fileName}>
              {shortName}
            </span>
          </div>

          <div className={`mk-live-slot${status === "connected" ? " is-open" : ""}`}>
            <LiveBadge />
          </div>

          <div className="mk-toolbar">
            <FollowCursorToggle enabled={followCursor} onToggle={toggleFollow} />
            {/* Kept mounted and collapsed (not unmounted) in light mode so
                switching theme animates smoothly instead of snapping the
                toolbar width and flickering. */}
            <div className={`mk-oled-slot${theme === "dark" ? " is-open" : ""}`}>
              <OledToggle enabled={oled} onToggle={toggleOled} />
            </div>
            <ThemeToggle theme={theme} onToggle={toggleTheme} />
          </div>
        </header>

        <div className="app-layout">
          <aside className="app-sidebar">
            <Toc items={tocItems} activeId={activeId} onSelect={scrollToId} />
          </aside>

          <main className="app-main app-main-rel">
            <section
              ref={contentRef}
              className="app-content markdown-body prose max-w-none text-[0.9375rem] leading-[1.78] text-(--fg) transition-colors duration-300"
            />
            {!html.trim() && (
              <div className="app-empty" role="status">
                <IconFile />
                <p className="app-empty-title">
                  {status === "connected"
                    ? "Waiting for content"
                    : "Connecting to preview"}
                </p>
                <p className="app-empty-hint">
                  {status === "connected"
                    ? "Start typing in Neovim — the rendered Markdown shows up here live."
                    : "Hang tight while the preview server connects…"}
                </p>
              </div>
            )}
          </main>
        </div>

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
