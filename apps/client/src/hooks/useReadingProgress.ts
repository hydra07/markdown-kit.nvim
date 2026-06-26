import { useEffect, useRef, useState } from "preact/hooks";

/** Returns document scroll progress in the range 0..1, rAF-throttled. */
export function useReadingProgress(): number {
  const [progress, setProgress] = useState(0);
  const rafRef = useRef<number | null>(null);

  useEffect(() => {
    const compute = () => {
      rafRef.current = null;
      const doc = document.documentElement;
      const max = doc.scrollHeight - window.innerHeight;
      const next = max <= 0 ? 0 : Math.min(1, Math.max(0, window.scrollY / max));
      setProgress((prev) => (Math.abs(prev - next) < 0.001 ? prev : next));
    };

    const onScroll = () => {
      if (rafRef.current !== null) return;
      rafRef.current = window.requestAnimationFrame(compute);
    };

    compute();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll, { passive: true });
    return () => {
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
      if (rafRef.current !== null) window.cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    };
  }, []);

  return progress;
}
