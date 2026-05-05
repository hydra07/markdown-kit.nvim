import { useCallback, useEffect, useLayoutEffect, useRef } from "preact/hooks";
import { toInt } from "../utils/number";
import { easeScroll } from "../utils/scroll";

function useSourceBlocks(markdown: string) {
  const blocksRef = useRef<HTMLElement[]>([]);
  const getDepth = useCallback((node: HTMLElement) => {
    let depth = 0;
    let p: HTMLElement | null = node.parentElement;
    while (p) {
      depth += 1;
      p = p.parentElement;
    }
    return depth;
  }, []);
  const refreshBlocks = useCallback(() => {
    const root = document.querySelector(".markdown-body");
    if (root instanceof HTMLElement) {
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_ALL);
      let pendingStart: string | null = null;
      let pendingEnd: string | null = null;
      let current: Node | null = walker.nextNode();
      while (current) {
        if (current.nodeType === Node.COMMENT_NODE) {
          const text = current.nodeValue ?? "";
          const match = text.match(/^\s*src:(\d+):(\d+)\s*$/);
          if (match) {
            pendingStart = match[1];
            pendingEnd = match[2];
          }
        } else if (
          pendingStart &&
          pendingEnd &&
          current.nodeType === Node.ELEMENT_NODE &&
          current instanceof HTMLElement
        ) {
          if (!current.hasAttribute("data-src-start")) {
            current.setAttribute("data-src-start", pendingStart);
            current.setAttribute("data-src-end", pendingEnd);
          }
          pendingStart = null;
          pendingEnd = null;
        }
        current = walker.nextNode();
      }
      blocksRef.current = Array.from(root.querySelectorAll<HTMLElement>("[data-src-start][data-src-end]"));
    } else {
      blocksRef.current = [];
    }
  }, []);

  useLayoutEffect(() => {
    refreshBlocks();
  }, [markdown, refreshBlocks]);

  const findBestBlock = useCallback((line: number) => {
    let nodes = blocksRef.current;
    if (nodes.length > 0 && !nodes[0].isConnected) {
      refreshBlocks();
      nodes = blocksRef.current;
    }
    if (nodes.length === 0) return null;

    let best: HTMLElement | null = null;
    let bestSpan = Number.POSITIVE_INFINITY;
    let bestDepth = -1;
    let nearest: HTMLElement | null = null;
    let nearestDistance = Number.POSITIVE_INFINITY;
    let nearestDepth = -1;

    for (const node of nodes) {
      const start = toInt(node.getAttribute("data-src-start"));
      const end = toInt(node.getAttribute("data-src-end"));
      if (start === null || end === null) continue;

      const distance = line < start ? start - line : line > end ? line - end : 0;
      const depth = getDepth(node);
      if (distance < nearestDistance || (distance === nearestDistance && depth > nearestDepth)) {
        nearestDistance = distance;
        nearestDepth = depth;
        nearest = node;
      }

      if (line < start || line > end) continue;
      const span = end - start;
      if (span < bestSpan || (span === bestSpan && depth > bestDepth)) {
        best = node;
        bestSpan = span;
        bestDepth = depth;
      }
    }
    // display:contents wrappers have no layout box — getBoundingClientRect() returns
    // all-zeros and CSS background/border don't render on them. Resolve to the actual
    // first child so scroll and highlight work correctly.
    const wrapper = best ?? nearest;
    if (!wrapper) return null;
    return (wrapper.style.display === "contents"
      ? (wrapper.firstElementChild as HTMLElement | null) ?? wrapper
      : wrapper);
  }, [getDepth, refreshBlocks]);

  return { findBestBlock };
}

export function usePreviewCurrentBlockHighlight(markdown: string) {
  const cursorLineRef = useRef(1);
  const lineCountRef = useRef(1);
  const lastSyncedLineRef = useRef<number | null>(null);
  const lastSyncedCountRef = useRef<number | null>(null);
  const activeBlockRef = useRef<HTMLElement | null>(null);
  const { findBestBlock } = useSourceBlocks(markdown);

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
    if (best.classList.contains("mermaid-rendered")) {
      activeBlockRef.current = null;
      return;
    }
    best.classList.add("cursor-line-active");
    activeBlockRef.current = best;
  }, [findBestBlock]);

  useLayoutEffect(() => {
    requestAnimationFrame(() => syncHighlight(true));
  }, [markdown, syncHighlight]);

  useEffect(() => () => {
    if (activeBlockRef.current) {
      activeBlockRef.current.classList.remove("cursor-line-active");
    }
  }, []);

  return { setCursorForHighlight, syncHighlight };
}

export function usePreviewFollowScroll(markdown: string, followCursor: boolean) {
  const cursorLineRef = useRef(1);
  const lineCountRef = useRef(1);
  const scrollRafRef = useRef<number | null>(null);
  const followCursorRef = useRef(followCursor);
  const { findBestBlock } = useSourceBlocks(markdown);

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
  }, [followCursor, markdown, syncFollowScroll]);

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
