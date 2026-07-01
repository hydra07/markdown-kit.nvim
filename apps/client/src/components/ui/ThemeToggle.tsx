import type { Theme } from "../../types/types";
import { IconMoon } from "./icons/IconMoon";
import { IconSun } from "./icons/IconSun";
import { Toggle } from "./Toggle";

type ThemeToggleProps = {
  theme: Theme;
  onToggle: (event?: MouseEvent) => void;
};

export function ThemeToggle({ theme, onToggle }: ThemeToggleProps) {
  const isDark = theme === "dark";
  return (
    <Toggle
      on={false}
      onToggle={onToggle}
      ariaLabel={`Switch to ${isDark ? "light" : "dark"} mode`}
      title={isDark ? "Theme: Dark" : "Theme: Light"}
      icon={
        <span className={`mk-theme-swap${isDark ? " is-dark" : ""}`}>
          <span className="mk-theme-sun">
            <IconSun />
          </span>
          <span className="mk-theme-moon">
            <IconMoon />
          </span>
        </span>
      }
    />
  );
}
