type ReadingProgressProps = {
  progress: number;
};

export function ReadingProgress({ progress }: ReadingProgressProps) {
  return (
    <div className="app-progress" role="presentation" aria-hidden="true">
      <div
        className="app-progress-bar"
        style={{ transform: `scaleX(${progress})` }}
      />
    </div>
  );
}
