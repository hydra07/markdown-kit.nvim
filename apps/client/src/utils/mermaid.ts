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

    // Size from the diagram's intrinsic width so small diagrams stay small and
    // crisp instead of being stretched across the whole column. A gentle 1.25×
    // scale keeps text legible; we never blow a 2-node flowchart up to full
    // width. Falls back to a sensible default when there is no viewBox.
    const aspect = box ? box.w / box.h : 1;
    const shapeCount = svg.querySelectorAll(
      "rect,circle,ellipse,polygon,path,line,polyline",
    ).length;
    // Render the SVG at (close to) its intrinsic size instead of stretching it
    // to fill the column — that is what made small/portrait diagrams balloon.
    // Tall + few-node diagrams (e.g. a 2-box `A-->B`) are capped hard so a lone
    // node never grows huge; wider/denser diagrams are allowed more room.
    let cap: number;
    if (aspect < 0.85) cap = shapeCount <= 6 ? 220 : 380;
    else if (aspect > 1.6) cap = 680;
    else cap = 520;
    const intrinsic = box ? box.w : 360;
    const targetPx = Math.round(Math.min(cap, Math.max(160, intrinsic)));

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
