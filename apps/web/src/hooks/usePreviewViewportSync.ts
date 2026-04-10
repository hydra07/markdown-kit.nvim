import { useCallback, useEffect, useLayoutEffect, useRef } from "react";
import { toInt } from "../utils/number";
import { easeScroll } from "../utils/scroll";

function useSourceBlocks(html: string) {
  const blocksRef = useRef<HTMLElement[]>([]);
  const refreshBlocks = useCallback(() => {
    const root = document.querySelector(".markdown-body");
    if (root instanceof HTMLElement) {
      blocksRef.current = Array.from(root.querySelectorAll<HTMLElement>("[data-src-start][data-src-end]"));
    } else {
      blocksRef.current = [];
    }
  }, []);

  useLayoutEffect(() => {
    refreshBlocks();
  }, [html, refreshBlocks]);

  const findBestBlock = useCallback((line: number) => {
    let nodes = blocksRef.current;
    if (nodes.length > 0 && !nodes[0].isConnected) {
      refreshBlocks();
      nodes = blocksRef.current;
    }
    if (nodes.length === 0) return null;

    let best: HTMLElement | null = null;
    let bestSpan = Number.POSITIVE_INFINITY;
    let nearest: HTMLElement | null = null;
    let nearestDistance = Number.POSITIVE_INFINITY;

    for (const node of nodes) {
      const start = toInt(node.getAttribute("data-src-start"));
      const end = toInt(node.getAttribute("data-src-end"));
      if (start === null || end === null) continue;

      const distance = line < start ? start - line : line > end ? line - end : 0;
      if (distance < nearestDistance) {
        nearestDistance = distance;
        nearest = node;
      }

      if (line < start || line > end) continue;
      const span = end - start;
      if (span < bestSpan) {
        best = node;
        bestSpan = span;
      }
    }
    return best ?? nearest;
  }, [refreshBlocks]);

  return { findBestBlock };
}

export function usePreviewCurrentBlockHighlight(html: string) {
  const cursorLineRef = useRef(1);
  const lineCountRef = useRef(1);
  const lastSyncedLineRef = useRef<number | null>(null);
  const lastSyncedCountRef = useRef<number | null>(null);
  const activeBlockRef = useRef<HTMLElement | null>(null);
  const { findBestBlock } = useSourceBlocks(html);

  const setCursorForHighlight = useCallback((cursorLine?: number, lineCount?: number) => {
    if (typeof cursorLine === "number") cursorLineRef.current = cursorLine;
    if (typeof lineCount === "number") lineCountRef.current = lineCount;
  }, []);

  const syncHighlight = useCallback((force?: boolean) => {
    const line = cursorLineRef.current;
    const count = lineCountRef.current;
    const active = activeBlockRef.current;
    const activeStillVisible = !!active && active.isConnected && active.classList.contains("cursor-line-active");
    if (!force && lastSyncedLineRef.current === line && lastSyncedCountRef.current === count && activeStillVisible) return;

    lastSyncedLineRef.current = line;
    lastSyncedCountRef.current = count;

    const best = findBestBlock(line);
    if (!best) return;

    if (activeBlockRef.current && activeBlockRef.current !== best) {
      activeBlockRef.current.classList.remove("cursor-line-active");
    }
    best.classList.add("cursor-line-active");
    activeBlockRef.current = best;
  }, [findBestBlock]);

  useLayoutEffect(() => {
    requestAnimationFrame(() => syncHighlight(true));
  }, [html, syncHighlight]);

  useEffect(() => () => {
    if (activeBlockRef.current) activeBlockRef.current.classList.remove("cursor-line-active");
  }, []);

  return { setCursorForHighlight, syncHighlight };
}

export function usePreviewFollowScroll(html: string, followCursor: boolean) {
  const cursorLineRef = useRef(1);
  const lineCountRef = useRef(1);
  const scrollRafRef = useRef<number | null>(null);
  const followCursorRef = useRef(followCursor);
  const { findBestBlock } = useSourceBlocks(html);

  useEffect(() => {
    followCursorRef.current = followCursor;
  }, [followCursor]);

  const setCursorForFollow = useCallback((cursorLine?: number, lineCount?: number) => {
    if (typeof cursorLine === "number") cursorLineRef.current = cursorLine;
    if (typeof lineCount === "number") lineCountRef.current = lineCount;
  }, []);

  const scrollByRatio = useCallback(() => {
    const line = cursorLineRef.current;
    const count = lineCountRef.current;
    if (count <= 1) return;
    const ratio = Math.max(0, Math.min(1, (line - 1) / (count - 1)));
    const maxScroll = document.documentElement.scrollHeight - window.innerHeight;
    if (maxScroll <= 0) return;
    easeScroll(Math.round(maxScroll * ratio), scrollRafRef);
  }, []);

  const scrollToBlock = useCallback(
    (block: HTMLElement | null) => {
      if (!block) {
        scrollByRatio();
        return;
      }

      const rect = block.getBoundingClientRect();
      const absoluteTop = window.scrollY + rect.top;
      const viewportAnchor = window.innerHeight * 0.28;
      const target = Math.max(0, Math.round(absoluteTop - viewportAnchor));

      if (Math.abs(target - window.scrollY) > window.innerHeight * 1.8) {
        if (scrollRafRef.current !== null) {
          cancelAnimationFrame(scrollRafRef.current);
          scrollRafRef.current = null;
        }
        window.scrollTo(0, target);
        return;
      }
      easeScroll(target, scrollRafRef);
    },
    [scrollByRatio]
  );

  const syncFollowScroll = useCallback(() => {
    if (!followCursorRef.current) return;
    const best = findBestBlock(cursorLineRef.current);
    scrollToBlock(best);
  }, [findBestBlock, scrollToBlock]);

  useLayoutEffect(() => {
    if (!followCursor) return;
    requestAnimationFrame(syncFollowScroll);
  }, [followCursor, html, syncFollowScroll]);

  useEffect(() => {
    if (followCursor) return;
    if (scrollRafRef.current !== null) {
      cancelAnimationFrame(scrollRafRef.current);
      scrollRafRef.current = null;
    }
  }, [followCursor]);

  useEffect(() => () => {
    if (scrollRafRef.current !== null) cancelAnimationFrame(scrollRafRef.current);
  }, []);

  return { setCursorForFollow, syncFollowScroll };
}
