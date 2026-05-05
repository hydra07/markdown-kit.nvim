export type Theme = "light" | "dark";
export type ConnStatus = "connecting" | "connected" | "closed" | "error";

export interface CursorUpdatePayload {
  cursorLine?: number;
  lineCount?: number;
}

export interface PreviewUpdatePayload extends CursorUpdatePayload {
  markdown?: string;
  fileName?: string;
  theme?: Theme;
  contentTick?: number;
}
