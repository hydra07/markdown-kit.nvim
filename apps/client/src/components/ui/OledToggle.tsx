import { IconContrast } from "./icons/IconContrast";
import { Toggle } from "./Toggle";

type OledToggleProps = {
  enabled: boolean;
  onToggle: () => void;
};

/** Pure-black (OLED) toggle — only meaningful in dark mode. */
export function OledToggle({ enabled, onToggle }: OledToggleProps) {
  return (
    <Toggle
      on={enabled}
      onToggle={onToggle}
      ariaLabel={`${enabled ? "Disable" : "Enable"} OLED pure-black mode`}
      title={enabled ? "OLED: ON (true black)" : "OLED: OFF"}
      icon={<IconContrast />}
    />
  );
}
