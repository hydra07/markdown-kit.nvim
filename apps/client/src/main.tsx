import "@fontsource-variable/inter";
import "@fontsource-variable/jetbrains-mono";
import "@fontsource-variable/fraunces/opsz.css";
import "@fontsource-variable/fraunces/opsz-italic.css";
import { render } from "preact";
import { App } from "./App";

// Set the initial theme before first paint so there is no light→dark flash
// (the live theme then arrives over the WebSocket).
document.documentElement.dataset.theme = "dark";

render(<App />, document.getElementById("root")!);
