type OledToggleProps = {
  enabled: boolean;
  onToggle: () => void;
};

/** Pure-black (OLED) switch — only meaningful in dark mode. */
export function OledToggle({ enabled, onToggle }: OledToggleProps) {
  return (
    <button
      type="button"
      onClick={onToggle}
      className="inline-flex h-8 shrink-0 select-none items-center gap-2 rounded-[var(--radius-sm)] border border-transparent bg-(--glass-soft) px-3 text-[0.68rem] font-semibold uppercase tracking-[0.045em] text-(--fg-muted) backdrop-blur-sm transition-[background-color,border-color,color] duration-200 hover:border-(--border-soft) hover:bg-(--glass) hover:text-(--fg) focus-visible:outline-2 focus-visible:outline-(--accent) focus-visible:outline-offset-2"
      aria-label={`${enabled ? "Disable" : "Enable"} OLED pure-black mode`}
      aria-pressed={enabled}
      title={enabled ? "OLED: ON (true black)" : "OLED: OFF"}
    >
      <span
        className={`relative h-4 w-8 shrink-0 rounded-full border border-(--border-soft) transition-colors duration-300 ${
          enabled ? "bg-(--accent)" : "bg-[color-mix(in_srgb,var(--fg)_10%,transparent)]"
        }`}
        aria-hidden="true"
      >
        <span
          className={`absolute top-px h-[calc(100%-2px)] w-[12px] rounded-full border border-(--border-soft) bg-(--bg) shadow-[0_1px_2px_rgba(0,0,0,0.3)] transition-transform duration-300 ${
            enabled ? "left-px translate-x-[14px]" : "left-px translate-x-0"
          }`}
        />
      </span>
      OLED
    </button>
  );
}
