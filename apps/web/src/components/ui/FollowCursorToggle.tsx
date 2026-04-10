type FollowCursorToggleProps = {
  enabled: boolean;
  onToggle: () => void;
};

export function FollowCursorToggle({ enabled, onToggle }: FollowCursorToggleProps) {
  return (
    <button
      type="button"
      onClick={onToggle}
      className="inline-flex h-8 shrink-0 select-none items-center gap-2 border border-transparent bg-(--glass-soft) px-3 text-[0.68rem] font-semibold uppercase tracking-[0.045em] text-(--fg-muted) backdrop-blur-sm transition-[background-color,border-color,color] duration-200 hover:border-(--border-soft) hover:bg-(--glass) hover:text-(--fg) focus-visible:outline-2 focus-visible:outline-(--accent) focus-visible:outline-offset-2"
      aria-label={`${enabled ? "Disable" : "Enable"} follow cursor scroll`}
      aria-pressed={enabled}
      title={enabled ? "Follow cursor: ON" : "Follow cursor: OFF"}
    >
      <span className={`relative h-4 w-8 shrink-0 border border-(--border-soft) ${enabled ? "bg-[color-mix(in_srgb,var(--fg)_14%,transparent)]" : "bg-[color-mix(in_srgb,var(--fg)_7%,transparent)]"}`} aria-hidden="true">
        <span
          className={`absolute top-px h-[calc(100%-2px)] w-[12px] border border-(--border-soft) bg-(--fg) transition-transform duration-200 ${enabled ? "left-px translate-x-[14px]" : "left-px translate-x-0"}`}
        />
      </span>
      Follow
    </button>
  );
}
