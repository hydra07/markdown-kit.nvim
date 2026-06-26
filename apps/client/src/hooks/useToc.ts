import { useCallback, useEffect, useRef, useState } from "preact/hooks";
import type { RefObject } from "preact";

export interface TocItem {
  id: string;
  text: string;
  level: number;
}

function slugify(text: string): string {
  return text
    .toLowerCase()
    .trim()
    .replace(/[^\p{L}\p{N}\s-]/gu, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

// Distance from the top of the viewport at which a heading counts as "current".
const SPY_OFFSET = 140;

/**
 * Extracts the heading outline from the rendered preview, assigns stable ids,
 * and tracks which heading is currently in view (scroll-spy).
 */
export function useToc(html: string, contentRef: RefObject<HTMLElement>) {
  const [items, setItems] = useState<TocItem[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const headingsRef = useRef<HTMLElement[]>([]);
  const rafRef = useRef<number | null>(null);

  // Rebuild outline whenever the rendered HTML changes.
  useEffect(() => {
    const root = contentRef.current;
    if (!root) {
      setItems([]);
      return;
    }

    const heads = Array.from(
      root.querySelectorAll<HTMLElement>("h1, h2, h3, h4, h5, h6"),
    );
    const used = new Set<string>();
    const next: TocItem[] = [];

    for (let i = 0; i < heads.length; i += 1) {
      const h = heads[i];
      const text = (h.textContent ?? "").trim();
      if (!text) continue;

      let base = slugify(text) || `section-${i}`;
      let id = base;
      let n = 1;
      while (used.has(id)) {
        id = `${base}-${n}`;
        n += 1;
      }
      used.add(id);
      h.id = id;

      next.push({ id, text, level: Number(h.tagName[1]) || 1 });
    }

    headingsRef.current = heads.filter((h) => h.id);
    setItems(next);
  }, [html, contentRef]);

  // Scroll-spy — pick the lowest heading whose top is above the spy offset.
  useEffect(() => {
    const computeActive = () => {
      rafRef.current = null;
      const heads = headingsRef.current;
      if (heads.length === 0) return;

      let current = heads[0].id;
      for (const h of heads) {
        if (h.getBoundingClientRect().top - SPY_OFFSET <= 0) {
          current = h.id;
        } else {
          break;
        }
      }
      setActiveId((prev) => (prev === current ? prev : current));
    };

    const onScroll = () => {
      if (rafRef.current !== null) return;
      rafRef.current = window.requestAnimationFrame(computeActive);
    };

    computeActive();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll, { passive: true });
    return () => {
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
      if (rafRef.current !== null) window.cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    };
  }, [items]);

  const scrollToId = useCallback((id: string) => {
    const el = document.getElementById(id);
    if (!el) return;
    const top = window.scrollY + el.getBoundingClientRect().top - 84;
    window.scrollTo({ top: Math.max(0, top), behavior: "smooth" });
    setActiveId(id);
  }, []);

  return { items, activeId, scrollToId };
}
