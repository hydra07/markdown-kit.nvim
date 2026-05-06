const params = new URLSearchParams(window.location.search);
const wsFromQuery = params.get("ws");
const wsFromLocation = window.location.protocol.startsWith("https")
  ? `wss://${window.location.host}/ws`
  : `ws://${window.location.host}/ws`;

export const wsUrl =
  wsFromQuery && wsFromQuery !== ""
    ? wsFromQuery
    : window.location.host !== ""
      ? wsFromLocation
      : `ws://127.0.0.1:${Number(import.meta.env.VITE_MK_PORT ?? 35831)}/ws`;
