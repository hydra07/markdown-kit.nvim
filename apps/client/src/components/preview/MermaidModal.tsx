import type { RefObject } from "preact";

type MermaidModalProps = {
  themedModalSvg: string;
  isPanning: boolean;
  mermaidZoom: number;
  mermaidPan: { x: number; y: number };
  mermaidCopyState: "idle" | "done";
  mermaidViewportRef: RefObject<HTMLDivElement>;
  onClose: () => void;
  onSaveSvg: () => void;
  onSavePng: () => void;
  onCopySvg: () => void;
};

export function MermaidModal({
  themedModalSvg,
  isPanning,
  mermaidZoom,
  mermaidPan,
  mermaidCopyState,
  mermaidViewportRef,
  onClose,
  onSaveSvg,
  onSavePng,
  onCopySvg,
}: MermaidModalProps) {
  return (
    <div
      className="mermaid-modal"
      role="dialog"
      aria-modal="true"
      aria-label="Mermaid diagram detail"
      onClick={onClose}
    >
      <div className="mermaid-modal-panel" onClick={(e) => e.stopPropagation()}>
        <div className="mermaid-modal-toolbar">
          <span className="mermaid-modal-hint">Ctrl + scroll to zoom · Drag to pan</span>
          <button type="button" className="mermaid-modal-btn" onClick={onSaveSvg}>
            Save SVG
          </button>
          <button type="button" className="mermaid-modal-btn" onClick={onSavePng}>
            Save PNG
          </button>
          <button type="button" className="mermaid-modal-btn" onClick={onCopySvg}>
            {mermaidCopyState === "done" ? "Copied" : "Copy SVG"}
          </button>
          <button
            type="button"
            className="mermaid-modal-close"
            onClick={onClose}
            aria-label="Close mermaid detail"
          >
            Close
          </button>
        </div>

        <div
          className={`mermaid-modal-viewport${isPanning ? " is-panning" : ""}`}
          ref={mermaidViewportRef}
        >
          <div
            className="mermaid-modal-content"
            // biome-ignore lint/security/noDangerouslySetInnerHtml: trusted local preview SVG
            dangerouslySetInnerHTML={{ __html: themedModalSvg }}
            style={{
              transform: `translate(${mermaidPan.x}px, ${mermaidPan.y}px) scale(${mermaidZoom})`,
            }}
          />
        </div>
      </div>
    </div>
  );
}
