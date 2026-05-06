import { useCallback, useEffect, useMemo, useRef, useState } from "preact/hooks";
import type { Theme } from "../types/types";
import { applyMermaidTheme } from "../utils/mermaid";

export function useMermaidModal(theme: Theme) {
  const [modalSvgString, setModalSvgString] = useState<string | null>(null);
  const [mermaidZoom, setMermaidZoom] = useState(1);
  const [isPanning, setIsPanning] = useState(false);
  const [mermaidPan, setMermaidPan] = useState({ x: 0, y: 0 });
  const [mermaidCopyState, setMermaidCopyState] = useState<"idle" | "done">(
    "idle",
  );

  const mermaidViewportRef = useRef<HTMLDivElement>(null);
  const mermaidPanRef = useRef({ x: 0, y: 0 });
  const panStateRef = useRef<{
    startX: number;
    startY: number;
    x: number;
    y: number;
  } | null>(null);

  const closeModal = useCallback(() => setModalSvgString(null), []);

  const openFromB64 = useCallback((b64: string) => {
    try {
      const svgString = atob(b64);
      setModalSvgString(svgString);
      setMermaidZoom(1);
      setMermaidPan({ x: 0, y: 0 });
      setMermaidCopyState("idle");
    } catch {
      // malformed base64
    }
  }, []);

  useEffect(() => {
    if (!modalSvgString) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setModalSvgString(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [modalSvgString]);

  useEffect(() => {
    mermaidPanRef.current = mermaidPan;
  }, [mermaidPan]);

  useEffect(() => {
    const viewport = mermaidViewportRef.current;
    if (!viewport || !modalSvgString) return;

    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey) return;
      e.preventDefault();
      const factor = e.deltaY > 0 ? 0.92 : 1.08;
      setMermaidZoom((z) =>
        Math.max(0.4, Math.min(4, +(z * factor).toFixed(3))),
      );
    };

    const onPointerDown = (e: PointerEvent) => {
      if (e.button !== 0) return;
      panStateRef.current = {
        startX: e.clientX,
        startY: e.clientY,
        x: mermaidPanRef.current.x,
        y: mermaidPanRef.current.y,
      };
      setIsPanning(true);
      viewport.setPointerCapture(e.pointerId);
    };

    const onPointerMove = (e: PointerEvent) => {
      const pan = panStateRef.current;
      if (!pan) return;
      setMermaidPan({
        x: pan.x + (e.clientX - pan.startX),
        y: pan.y + (e.clientY - pan.startY),
      });
    };

    const endPan = (e: PointerEvent) => {
      if (!panStateRef.current) return;
      panStateRef.current = null;
      setIsPanning(false);
      if (viewport.hasPointerCapture(e.pointerId)) {
        viewport.releasePointerCapture(e.pointerId);
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
  }, [modalSvgString]);

  const themedModalSvg = useMemo<string | null>(() => {
    if (!modalSvgString) return null;
    const parser = new DOMParser();
    const doc = parser.parseFromString(modalSvgString, "image/svg+xml");
    const svgEl = doc.documentElement as unknown as SVGSVGElement;
    svgEl.removeAttribute("width");
    svgEl.removeAttribute("height");
    // Width/height must not be purely "auto" in the modal: some hosts resolve
    // intrinsic size as 0 when the wrapper is max-content-only. Fill the pane
    // and let viewBox preserve aspect ratio.
    svgEl.style.cssText =
      "width:100%;max-width:100%;height:auto;display:block";
    if (!svgEl.getAttribute("preserveAspectRatio")) {
      svgEl.setAttribute("preserveAspectRatio", "xMidYMid meet");
    }
    applyMermaidTheme(svgEl, theme);
    return new XMLSerializer().serializeToString(svgEl);
  }, [modalSvgString, theme]);

  const mermaidSvgBlobUrl = useMemo<string | null>(() => {
    if (!themedModalSvg) return null;
    return URL.createObjectURL(
      new Blob([themedModalSvg], { type: "image/svg+xml;charset=utf-8" }),
    );
  }, [themedModalSvg]);

  useEffect(
    () => () => {
      if (mermaidSvgBlobUrl) URL.revokeObjectURL(mermaidSvgBlobUrl);
    },
    [mermaidSvgBlobUrl],
  );

  const saveMermaidSvg = useCallback(() => {
    if (!mermaidSvgBlobUrl) return;
    const a = document.createElement("a");
    a.href = mermaidSvgBlobUrl;
    a.download = "mermaid-diagram.svg";
    a.click();
  }, [mermaidSvgBlobUrl]);

  const saveMermaidPng = useCallback(async () => {
    if (!themedModalSvg) return;
    const blob = new Blob([themedModalSvg], {
      type: "image/svg+xml;charset=utf-8",
    });
    const url = URL.createObjectURL(blob);
    try {
      const img = new Image();
      await new Promise<void>((resolve, reject) => {
        img.onload = () => resolve();
        img.onerror = () => reject(new Error("SVG load failed"));
        img.src = url;
      });
      const w = Math.max(img.naturalWidth || img.width, 1);
      const h = Math.max(img.naturalHeight || img.height, 1);
      const canvas = document.createElement("canvas");
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      ctx.fillStyle =
        getComputedStyle(document.documentElement).getPropertyValue("--bg") ||
        "#ffffff";
      ctx.fillRect(0, 0, w, h);
      ctx.drawImage(img, 0, 0);
      const a = document.createElement("a");
      a.href = canvas.toDataURL("image/png");
      a.download = "mermaid-diagram.png";
      a.click();
    } finally {
      URL.revokeObjectURL(url);
    }
  }, [themedModalSvg]);

  const copyMermaidSvg = useCallback(async () => {
    if (!themedModalSvg) return;
    await navigator.clipboard.writeText(themedModalSvg);
    setMermaidCopyState("done");
    window.setTimeout(() => setMermaidCopyState("idle"), 1200);
  }, [themedModalSvg]);

  return {
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
  };
}
