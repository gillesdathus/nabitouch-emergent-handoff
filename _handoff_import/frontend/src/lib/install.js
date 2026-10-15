import { useEffect, useState } from "react";

// Shared capture of the browser's install prompt (fires once per page load).
let deferred = null;
const subs = new Set();
if (typeof window !== "undefined") {
  window.addEventListener("beforeinstallprompt", (e) => { e.preventDefault(); deferred = e; subs.forEach((f) => f(e)); });
  window.addEventListener("appinstalled", () => { deferred = null; subs.forEach((f) => f(null)); });
}

export const isStandalone = () => window.matchMedia?.("(display-mode: standalone)").matches || window.navigator.standalone === true;
export const isIOS = () => /iphone|ipad|ipod/i.test(navigator.userAgent);

export function useInstallPrompt() {
  const [prompt, setPrompt] = useState(deferred);
  useEffect(() => { subs.add(setPrompt); return () => subs.delete(setPrompt); }, []);
  const install = async () => {
    if (!prompt) return false;
    prompt.prompt();
    const { outcome } = await prompt.userChoice;
    deferred = null; setPrompt(null);
    return outcome === "accepted";
  };
  return { canPrompt: !!prompt, install };
}
