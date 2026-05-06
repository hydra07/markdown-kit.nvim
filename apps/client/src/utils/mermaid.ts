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
    const svg = block.querySelector("svg");
    if (!(svg instanceof SVGSVGElement)) return;

    const box = parseViewBoxSize(svg);
    const textCount = svg.querySelectorAll("text").length;
    const shapeCount = svg.querySelectorAll(
      "rect,circle,ellipse,polygon,path,line,polyline",
    ).length;

    const complexity = textCount + shapeCount * 0.35;
    const aspect = box ? box.w / box.h : 1;

    let targetPct = 38 + complexity * 2.2;
    if (box) {
      if (box.w < 160) targetPct += 30;
      else if (box.w < 300) targetPct += 16;
      else if (box.w > 900) targetPct -= 6;
    }
    if (aspect > 1.8) targetPct += 6;
    if (aspect < 0.7) targetPct -= 4;

    const widthPct = Math.max(46, Math.min(100, Math.round(targetPct)));
    const minWidthPx = Math.max(
      220,
      Math.min(780, Math.round(180 + complexity * 12)),
    );

    block.style.width = `${widthPct}%`;
    block.style.maxWidth = "100%";
    block.style.minWidth = `${minWidthPx}px`;
    svg.style.width = "100%";
    svg.style.height = "auto";
  });
}

export function applyMermaidThemeToPreview(root: HTMLElement, theme: Theme) {
  root.querySelectorAll<SVGSVGElement>(".mermaid-rendered svg").forEach((svg) => {
    applyMermaidTheme(svg, theme);
  });
}
