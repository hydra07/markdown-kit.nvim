type StartViewTransition = (cb: () => void) => {
  ready: Promise<void>;
  finished: Promise<void>;
};

type RevealOpts = {
  /** Origin of the circle (usually the click point). */
  x: number;
  y: number;
  /** true → new state grows out from the point; false → old state contracts into it. */
  expand: boolean;
  durationMs?: number;
};

/**
 * Animate a page-wide visual change as a circular wipe from a point, using the
 * View Transitions API. The clip animation is driven entirely by CSS keyframes
 * (see `.vt-expand` / `.vt-contract` in app.css) parameterised through custom
 * properties — this avoids the race where attaching `element.animate()` in
 * `ready.then()` misses the (short-lived) `::view-transition-old` pseudo, which
 * made the contracting direction snap instantly instead of animating.
 *
 * Falls back to applying the change instantly where the API is unavailable
 * (Firefox/Safari/older Chrome) or the user prefers reduced motion.
 */
export function circularReveal(apply: () => void, opts: RevealOpts) {
  const root = document.documentElement;
  const start = (
    document as Document & { startViewTransition?: StartViewTransition }
  ).startViewTransition?.bind(document);
  const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  if (!start) {
    apply();
    return;
  }
  if (reduce) {
    start(apply);
    return;
  }

  const { x, y, expand, durationMs = 520 } = opts;
  const endRadius = Math.hypot(
    Math.max(x, window.innerWidth - x),
    Math.max(y, window.innerHeight - y),
  );

  root.style.setProperty("--vt-x", `${x}px`);
  root.style.setProperty("--vt-y", `${y}px`);
  root.style.setProperty("--vt-r", `${endRadius}px`);
  root.style.setProperty("--vt-dur", `${durationMs}ms`);
  root.classList.add("vt-active", expand ? "vt-expand" : "vt-contract");

  const transition = start(apply);

  transition.finished.finally(() => {
    root.classList.remove("vt-active", "vt-expand", "vt-contract");
    root.style.removeProperty("--vt-x");
    root.style.removeProperty("--vt-y");
    root.style.removeProperty("--vt-r");
    root.style.removeProperty("--vt-dur");
  });
}
