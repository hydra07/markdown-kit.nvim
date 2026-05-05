export function LiveBadge() {
  return (
    <span
      className="inline-flex h-8 shrink-0 items-center gap-1.5 border border-transparent bg-(--glass-soft) px-2.5 text-[0.62rem] font-semibold uppercase tracking-[0.05em] text-(--fg-muted) backdrop-blur-sm transition-[background-color,border-color,color] duration-200 hover:border-(--border-soft) hover:bg-(--glass) hover:text-(--fg)"
      aria-live="polite"
      aria-label="Live preview active"
    >
      <span className="h-1.5 w-1.5 shrink-0 animate-[dot-pulse_3.2s_ease-in-out_infinite] bg-current/70" />
      Live
    </span>
  );
}
