type ConnBadgeProps = {
  wsUrl: string;
};

export function ConnBadge({ wsUrl }: ConnBadgeProps) {
  return (
    <div className="px-3 md:px-0">
      <div
        className="mt-2 flex h-8 items-center gap-2 border border-transparent bg-(--glass-soft) px-3 text-[0.7rem] text-(--fg-muted) backdrop-blur-md transition-[background-color,border-color,color] duration-200 hover:border-(--border-soft) hover:text-(--fg)"
        role="status"
      >
        <span className="h-[0.425rem] w-[0.425rem] shrink-0 animate-[dot-pulse_3.2s_ease-in-out_infinite] bg-(--fg-muted)" />
        <span>
          Connecting to{" "}
          <code className="font-mono text-[0.67rem] text-(--fg)">
            {wsUrl}
          </code>
          ...
        </span>
      </div>
    </div>
  );
}
