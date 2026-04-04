interface OpenBrowserOptions {
  host: string;
  webPort: number;
  servicePort: number;
}

function getOpenBrowserArgv(url: string): string[] {
  const customBrowser = Bun.env.MK_BROWSER?.trim();
  if (customBrowser) return [customBrowser, url];

  if (process.platform === "win32") {
    return ["powershell", "-NoProfile", "-NonInteractive", "-Command", `Start-Process '${url}'`];
  }

  if (process.platform === "darwin") return ["open", url];

  const hasSensible = typeof Bun.which === "function" && Bun.which("sensible-browser");
  return [hasSensible ? "sensible-browser" : "xdg-open", url];
}

export function openBrowser(opts: OpenBrowserOptions): void {
  const url = `http://${opts.host}:${opts.webPort}/?ws=ws://${opts.host}:${opts.servicePort}`;
  try {
    Bun.spawn(getOpenBrowserArgv(url), {
      stdin: "ignore",
      stdout: "ignore",
      stderr: "ignore",
    });
  } catch (err) {
    console.error("[service] Failed to open browser:", err);
  }
}
