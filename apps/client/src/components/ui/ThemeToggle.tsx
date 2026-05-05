import type { Theme } from "../../types/types";
import { IconMoon } from "./icons/IconMoon";
import { IconSun } from "./icons/IconSun";

type ThemeToggleProps = {
  theme: Theme;
  onToggle: () => void;
};

export function ThemeToggle({ theme, onToggle }: ThemeToggleProps) {
  const isDark = theme === "dark";
  return (
    <button
      type="button"
      onClick={onToggle}
      className="inline-flex h-8 shrink-0 select-none items-center gap-2 border border-transparent bg-(--glass-soft) px-3 text-[0.68rem] font-semibold uppercase tracking-[0.045em] text-(--fg-muted) backdrop-blur-sm transition-[background-color,border-color,color] duration-200 hover:border-(--border-soft) hover:bg-(--glass) hover:text-(--fg) focus-visible:outline-2 focus-visible:outline-(--accent) focus-visible:outline-offset-2"
      aria-label={`Switch to ${isDark ? "light" : "dark"} mode`}
      aria-pressed={isDark}
    >
      <span
        className={`relative h-4 w-8 shrink-0 border border-(--border-soft) transition-colors duration-300 ${
          isDark ? "bg-[color-mix(in_srgb,var(--fg)_16%,transparent)]" : "bg-[color-mix(in_srgb,var(--fg)_10%,transparent)]"
        }`}
        role="presentation"
      >
        <span
          className={`absolute left-[1px] top-[1px] h-[calc(100%-2px)] w-[12px] border border-(--border-soft) shadow-[0_1px_2px_rgba(0,0,0,0.2)] transition-[transform,background-color] duration-300 ${
            isDark ? "translate-x-[14px] bg-(--fg)" : "translate-x-0 bg-(--bg)"
          }`}
        />
      </span>
      {isDark ? <IconMoon /> : <IconSun />}
      <span className="pointer-events-none min-w-[2.1rem] text-left">
        {isDark ? "Dark" : "Light"}
      </span>
    </button>
  );
}
