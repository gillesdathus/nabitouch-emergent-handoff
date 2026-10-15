import React from "react";
import ReactDOM from "react-dom/client";
import "@/index.css";
import App from "@/App";
import { bootNativeShell } from "@/lib/nativeShell";

bootNativeShell().catch(() => {});
const root = ReactDOM.createRoot(document.getElementById("root"));
root.render(<App />);

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => navigator.serviceWorker.register("/sw.js").catch(() => {}));
}
