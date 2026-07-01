import { useState } from "preact/hooks";
import type { ComponentChildren } from "preact";

type ToggleProps = {
  on: boolean;
  onToggle: (event?: MouseEvent) => void;
  /** Accessible label + tooltip. */
  ariaLabel: string;
  title?: string;
  /** Icon shown inside the square button. */
  icon: ComponentChildren;
};

/**
 * Toolbar toggle — a uniform square icon button. On click the glyph spins like a
 * taegeuk (½ turn forward when switching on, unwinds back when switching off)
 * and a ring ripples outward from the button. The ripple is keyed off a counter
 * so it restarts cleanly on every press.
 */
export function Toggle({ on, onToggle, ariaLabel, title, icon }: ToggleProps) {
  const [pulse, setPulse] = useState(0);

  const handleClick = (event: MouseEvent) => {
    setPulse((p) => p + 1);
    onToggle(event);
  };

  return (
    <button
      type="button"
      onClick={handleClick}
      aria-label={ariaLabel}
      aria-pressed={on}
      title={title ?? ariaLabel}
      data-on={on ? "true" : undefined}
      className="mk-icon-btn"
    >
      <span className="mk-icon-btn-glyph">{icon}</span>
      {pulse > 0 && (
        <span key={pulse} className="mk-ripple" aria-hidden="true" />
      )}
    </button>
  );
}
