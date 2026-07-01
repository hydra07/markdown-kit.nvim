import { IconCursor } from "./icons/IconCursor";
import { Toggle } from "./Toggle";

type FollowCursorToggleProps = {
  enabled: boolean;
  onToggle: () => void;
};

export function FollowCursorToggle({ enabled, onToggle }: FollowCursorToggleProps) {
  return (
    <Toggle
      on={enabled}
      onToggle={onToggle}
      ariaLabel={`${enabled ? "Disable" : "Enable"} follow cursor scroll`}
      title={enabled ? "Follow cursor: ON" : "Follow cursor: OFF"}
      icon={<IconCursor />}
    />
  );
}
