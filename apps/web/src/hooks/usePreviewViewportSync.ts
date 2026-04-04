import { useCallback, useEffect, useLayoutEffect, useRef } from "react";
import { toInt } from "../utils/number";
import { easeScroll } from "../utils/scroll";

export function usePreviewViewportSync(html: string) {
  const cursorLineRef = useRef(1);
  const lineCountRef = useRef(1);
  const scrollRafRef = useRef<number | null>(null);
  const activeBlockRef = useRef<HTMLElement | null>(null);

  const scrollNow = useCallback(() => {
    const line = cursorLineRef.current;
    const count = lineCountRef.current;
    if (count <= 1) return;
    const ratio = Math.max(0, Math.min(1, (line - 1) / (count - 1)));
    const maxScroll = document.documentElement.scrollHeight - window.innerHeight;
    if (maxScroll <= 0) return;
    easeScroll(Math.round(maxScroll * ratio), scrollRafRef);
  }, []);

  const highlightCurrentBlock = useCallback(() => {
    const root = document.querySelector(".markdown-body");
    if (!(root instanceof HTMLElement)) return;

    const line = cursorLineRef.current;
    const nodes = root.querySelectorAll<HTMLElement>("[data-src-start][data-src-end]");

    let best: HTMLElement | null = null;
    let bestSpan = Number.POSITIVE_INFINITY;

    for (const node of nodes) {
      const start = toInt(node.getAttribute("data-src-start"));
      const end = toInt(node.getAttribute("data-src-end"));
      if (start === null || end === null) continue;
      if (line < start || line > end) continue;
      const span = end - start;
      if (span < bestSpan) {
        best = node;
        bestSpan = span;
      }
    }

    if (activeBlockRef.current && activeBlockRef.current !== best) {
      activeBlockRef.current.classList.remove("cursor-line-active");
    }
    if (best) best.classList.add("cursor-line-active");
    activeBlockRef.current = best;
  }, []);

  const syncViewport = useCallback(() => {
    highlightCurrentBlock();
    scrollNow();
  }, [highlightCurrentBlock, scrollNow]);

  const setCursor = useCallback((cursorLine?: number, lineCount?: number) => {
    if (typeof cursorLine === "number") cursorLineRef.current = cursorLine;
    if (typeof lineCount === "number") lineCountRef.current = lineCount;
  }, []);

  useLayoutEffect(() => {
    syncViewport();
  }, [html, syncViewport]);

  useEffect(() => () => {
    if (scrollRafRef.current !== null) cancelAnimationFrame(scrollRafRef.current);
    if (activeBlockRef.current) activeBlockRef.current.classList.remove("cursor-line-active");
  }, []);

  return { setCursor, syncViewport };
}
