import type { Theme } from "../types/types";

const DARK_COLOR_MAP: Record<string, string> = {
  "#FFFFFF": "var(--bg-code)",
  "#F8FAFC": "color-mix(in srgb, var(--bg-code) 74%, #ffffff 26%)",
  "#0F172A": "var(--fg)",
  "#64748B": "color-mix(in srgb, var(--fg-muted) 82%, #9aa9c4 18%)",
  "#94A3B8": "color-mix(in srgb, var(--border-soft) 80%, #9aa9c4 20%)",
  "#E2E8F0": "color-mix(in srgb, var(--border-soft) 88%, #9aa9c4 12%)",
};

export function applyMermaidTheme(root: SVGSVGElement, theme: Theme) {
  root.querySelectorAll("[data-mk-themed]").forEach((node) => {
    const el = node as SVGElement;
    const fill = el.getAttribute("data-mk-fill");
    const stroke = el.getAttribute("data-mk-stroke");
    if (fill !== null) el.setAttribute("fill", fill);
    if (stroke !== null) el.setAttribute("stroke", stroke);
    el.removeAttribute("data-mk-fill");
    el.removeAttribute("data-mk-stroke");
    el.removeAttribute("data-mk-themed");
  });

  if (theme !== "dark") return;

  root.querySelectorAll("[fill], [stroke]").forEach((node) => {
    const el = node as SVGElement;
    const fill = el.getAttribute("fill");
    const stroke = el.getAttribute("stroke");
    let changed = false;
    if (fill && DARK_COLOR_MAP[fill]) {
      el.setAttribute("data-mk-fill", fill);
      el.setAttribute("fill", DARK_COLOR_MAP[fill]);
      changed = true;
    }
    if (stroke && DARK_COLOR_MAP[stroke]) {
      el.setAttribute("data-mk-stroke", stroke);
      el.setAttribute("stroke", DARK_COLOR_MAP[stroke]);
      changed = true;
    }
    if (changed) el.setAttribute("data-mk-themed", "1");
  });
}

function parseViewBoxSize(svg: SVGSVGElement): { w: number; h: number } | null {
  const viewBox = svg.getAttribute("viewBox");
  if (!viewBox) return null;
  const parts = viewBox
    .trim()
    .split(/[\s,]+/)
    .map((n) => Number(n));
  if (parts.length !== 4) return null;
  const w = parts[2];
  const h = parts[3];
  if (!Number.isFinite(w) || !Number.isFinite(h) || w <= 0 || h <= 0) return null;
  return { w, h };
}

export function applyAdaptiveMermaidSizing(root: HTMLElement) {
  const blocks = root.querySelectorAll<HTMLElement>(".mermaid-rendered");
  blocks.forEach((block) => {
    // Sizing is purely geometric (depends on the SVG viewBox/shape counts, not
    // on theme or cursor), so it only needs to run once per diagram. morphdom
    // drops this marker by replacing the node when the diagram actually changes.
    if (block.dataset.mkSized === "1") return;

    const svg = block.querySelector("svg");
    if (!(svg instanceof SVGSVGElement)) return;

    const box = parseViewBoxSize(svg);
    const intrinsicW = box ? box.w : 360;
    const intrinsicH = box ? box.h : 240;
    const aspect = intrinsicW / intrinsicH;

    // Complexity proxy: node-like shapes (boxes/actors) plus text labels.
    // Raw shape count (including <path>) over-counts — a single arrow with
    // an arrowhead and a rounded-corner box can contribute half a dozen
    // <path>s on their own, which previously misclassified a genuinely
    // trivial 2-3-box diagram as "medium" and let it claim a much bigger
    // size budget than the content warranted (a plain "A -> B" sequence
    // diagram rendered at 422px tall for two boxes and one arrow).
    const nodeCount = svg.querySelectorAll(
      "rect,circle,ellipse,polygon",
    ).length;
    const textCount = svg.querySelectorAll("text").length;
    const complexity = nodeCount + textCount;

    // Bounding box the diagram must fit inside ("contain" — scale by
    // whichever of width/height binds first). Simple diagrams get a small
    // box so a couple of nodes can't dominate the page just because their
    // native SVG happens to be tall and narrow (sequence diagrams reserve
    // lifeline height regardless of message count); denser diagrams get
    // more room to stay legible. Click-to-zoom exists for when you need
    // more detail than the inline size gives you.
    let capWidth: number;
    let capHeight: number;
    if (complexity <= 6) {
      capWidth = 220;
      capHeight = 200;
    } else if (complexity <= 14) {
      capWidth = 380;
      capHeight = 280;
    } else if (complexity <= 26) {
      capWidth = 540;
      capHeight = 380;
    } else {
      capWidth = 700;
      capHeight = 460;
    }

    // Fit inside the box; never upscale more than 2× intrinsic so a tiny
    // diagram stays small and crisp instead of being blown up to fill the
    // budget.
    const scale = Math.min(capWidth / intrinsicW, capHeight / intrinsicH, 2);
    let targetW = intrinsicW * scale;

    // Floor so a diagram never shrinks to an unreadable sliver — but the
    // floor itself is capped by the height budget too, so an extreme
    // portrait aspect (like the sequence-diagram case above) shrinks in
    // width right along with height instead of being forced wide enough to
    // blow past capHeight again.
    const minWidth = Math.min(90, capHeight * aspect);
    targetW = Math.max(minWidth, targetW);

    const targetPx = Math.round(targetW);

    block.style.width = "fit-content";
    block.style.maxWidth = "100%";
    block.style.minWidth = "";
    svg.style.width = `${targetPx}px`;
    svg.style.maxWidth = "100%";
    svg.style.height = "auto";
    block.dataset.mkSized = "1";
  });
}

export function applyMermaidThemeToPreview(root: HTMLElement, theme: Theme) {
  root.querySelectorAll<SVGSVGElement>(".mermaid-rendered svg").forEach((svg) => {
    applyMermaidTheme(svg, theme);
  });
}
