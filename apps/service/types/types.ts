export type Theme = "light" | "dark";
export type IncomingType = "preview:update" | "cursor:update" | "browser:open" | "preview:close";

export interface PreviewState {
  markdown: string;
  fileName: string;
  theme: Theme;
  contentTick: number;
  cursorLine: number;
  lineCount: number;
}

export interface IncomingMessage {
  type?: IncomingType;
  payload?: Partial<PreviewState>;
}

export type WS = Bun.ServerWebSocket<unknown>;
