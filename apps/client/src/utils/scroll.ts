/**
 * Continuous follow-scroller.
 *
 * The previous approach called a fresh tween (fixed start → end over a fixed
 * duration) on every cursor update. Cursor updates arrive as often as every
 * ~16ms while moving/typing, so each one cancelled the in-flight tween and
 * restarted a brand new ease-out from the current position — visually that
 * reads as a stutter/bounce chain rather than one fluid motion, since the
 * deceleration curve resets on every retarget instead of continuing.
 *
 * This instead keeps a single persistent rAF loop that eases the *current*
 * scroll position toward a continuously-updated target. Retargeting mid-
 * flight blends smoothly (it's just a new target for the same ongoing ease)
 * instead of visibly restarting.
 *
 * IMPORTANT: every scrollTo call here passes `behavior: "instant"` even
 * though this file *is* the animation. `html` has `scroll-behavior: smooth`
 * globally (nice for anchor-link clicks); a bare `window.scrollTo(0, y)`
 * inherits that via `behavior: "auto"`, which means each of our own
 * per-frame steps used to *also* kick off the browser's native smooth-scroll
 * on top of our explicit easing — two animation systems fighting over the
 * same scroll offset every 16ms. Compounded across a long document that
 * showed up as the tab pegging its render thread and going unresponsive.
 * `instant` makes each step apply immediately, so our easing is the only
 * thing driving the motion.
 */
export function createFollowScroller() {
  let target: number | null = null;
  let rafId: number | null = null;

  function tick() {
    if (target === null) {
      rafId = null;
      return;
    }
    const current = window.scrollY;
    const delta = target - current;
    if (Math.abs(delta) < 0.5) {
      window.scrollTo({ top: target, left: 0, behavior: "instant" });
      rafId = null;
      target = null;
      return;
    }
    // Exponential ease with an *adaptive* rate: a fixed 22%/frame felt right
    // for nearby retargets (cursor nudging a few lines while typing) but
    // reads as a slow crawl when the cursor teleports far in one jump (`G`,
    // a search match, `:120`) — the viewport should visibly snap toward a
    // big jump, not glide at the same gentle pace as a small one. Scale the
    // rate up with how far away the target is, relative to viewport height.
    const vh = window.innerHeight || 1;
    const urgency = Math.min(1, Math.abs(delta) / (vh * 1.2));
    const rate = 0.2 + urgency * 0.55; // 0.2 (nearby) .. 0.75 (far/teleport)
    const next = current + delta * rate;
    window.scrollTo({ top: next, left: 0, behavior: "instant" });

    // Guard against a target the browser can never actually reach — e.g. a
    // stale target computed just before the document got shorter, now
    // beyond the max scroll offset. Without this the loop above never sees
    // |delta| < 0.5 and runs forever, calling scrollTo (a forced layout)
    // every frame indefinitely.
    if (Math.abs(window.scrollY - current) < 0.05 && Math.abs(delta) > 1) {
      rafId = null;
      target = null;
      return;
    }
    rafId = requestAnimationFrame(tick);
  }

  return {
    /** Ease toward `value`, blending with any animation already in flight. */
    scrollTo(value: number) {
      target = value;
      if (rafId === null) rafId = requestAnimationFrame(tick);
    },
    /** Snap instantly (used for jumps far outside the viewport). */
    jumpTo(value: number) {
      if (rafId !== null) {
        cancelAnimationFrame(rafId);
        rafId = null;
      }
      target = null;
      window.scrollTo({ top: value, left: 0, behavior: "instant" });
    },
    stop() {
      if (rafId !== null) {
        cancelAnimationFrame(rafId);
        rafId = null;
      }
      target = null;
    },
  };
}

export type FollowScroller = ReturnType<typeof createFollowScroller>;
