import type { TocItem } from "../../hooks/useToc";

type TocProps = {
  items: TocItem[];
  activeId: string | null;
  onSelect: (id: string) => void;
};

export function Toc({ items, activeId, onSelect }: TocProps) {
  if (items.length < 2) return null;

  // Normalise indentation so the shallowest heading sits flush-left even when a
  // document starts at h2/h3.
  const minLevel = items.reduce((m, it) => Math.min(m, it.level), 6);

  return (
    <nav className="app-toc" aria-label="Table of contents">
      <div className="app-toc-title">On this page</div>
      <ul className="app-toc-list">
        {items.map((it) => (
          <li key={it.id}>
            <button
              type="button"
              className={`app-toc-link${it.id === activeId ? " is-active" : ""}`}
              style={{ paddingLeft: `${(it.level - minLevel) * 0.75 + 0.6}rem` }}
              onClick={() => onSelect(it.id)}
              title={it.text}
            >
              {it.text}
            </button>
          </li>
        ))}
      </ul>
    </nav>
  );
}
