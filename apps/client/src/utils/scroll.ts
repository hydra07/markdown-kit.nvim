import type { MutableRef } from "preact/hooks";

export function easeScroll(target: number, rafRef: MutableRef<number | null>): void {
  if (rafRef.current !== null) {
    cancelAnimationFrame(rafRef.current!);
    rafRef.current = null;
  }

  const duration = 180;
  const start = window.scrollY;
  const delta = target - start;
  if (Math.abs(delta) < 2) return;

  const t0 = performance.now();

  function step(now: number) {
    const elapsed = now - t0;
    const progress = Math.min(elapsed / duration, 1);
    const ease = 1 - (1 - progress) * (1 - progress);
    window.scrollTo(0, start + delta * ease);
    if (progress < 1) {
      rafRef.current = requestAnimationFrame(step);
    } else {
      rafRef.current = null;
    }
  }

  rafRef.current = requestAnimationFrame(step);
}
