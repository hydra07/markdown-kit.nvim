export function LiveBadge() {
  return (
    <span
      className="inline-flex h-8 shrink-0 items-center gap-1.5 px-1 text-[0.68rem] font-medium uppercase tracking-[0.06em] text-(--fg-subtle) transition-colors duration-200 hover:text-(--fg)"
      aria-live="polite"
      aria-label="Live preview active"
    >
      <span className="mk-status-dot" />
      Live
    </span>
  );
}
