type ConnBadgeProps = {
  wsUrl: string;
};

export function ConnBadge({ wsUrl }: ConnBadgeProps) {
  return (
    <div className="px-3 md:px-0">
      <div
        className="mt-2 flex h-8 items-center gap-2 px-1 text-[0.7rem] text-(--fg-muted) transition-colors duration-200 hover:text-(--fg)"
        role="status"
      >
        <span className="mk-status-dot" />
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
