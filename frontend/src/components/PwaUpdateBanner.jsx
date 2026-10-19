import { useEffect, useState } from "react";
import { isDirty } from "@/lib/dirtyForms";

const BUILD = typeof import.meta !== "undefined" && import.meta.env?.VITE_APP_BUILD
  ? String(import.meta.env.VITE_APP_BUILD)
  : "web";

export function PwaUpdateBanner() {
  const [waiting, setWaiting] = useState(null);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    if (!("serviceWorker" in navigator)) return undefined;
    let registration;
    const onUpdate = (reg) => {
      if (reg.waiting) setWaiting(reg.waiting);
    };
    navigator.serviceWorker.getRegistration().then((reg) => {
      if (!reg) return;
      registration = reg;
      onUpdate(reg);
      reg.addEventListener("updatefound", () => {
        const worker = reg.installing;
        if (!worker) return;
        worker.addEventListener("statechange", () => {
          if (worker.state === "installed" && navigator.serviceWorker.controller) setWaiting(reg.waiting || worker);
        });
      });
    });
    const onController = () => window.location.reload();
    navigator.serviceWorker.addEventListener("controllerchange", onController);
    return () => navigator.serviceWorker.removeEventListener("controllerchange", onController);
  }, []);

  if (!waiting || dismissed) return null;

  const apply = () => {
    if (isDirty() && !window.confirm("You have unsaved changes. Update now and reload anyway?")) return;
    waiting.postMessage({ type: "SKIP_WAITING" });
  };

  return (
    <div className="fixed inset-x-0 bottom-[calc(var(--nb-nav-h)+var(--nb-safe-b)+0.75rem)] z-[60] mx-auto flex max-w-lg items-center gap-3 rounded-2xl border border-sky-100 bg-white p-3 shadow-lg lg:bottom-4" data-testid="pwa-update-banner">
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold">App update available</p>
        <p className="text-xs text-nb-mute">Build {BUILD}. Reload when you are ready.</p>
      </div>
      <button type="button" className="nb-btn-ghost h-9 px-3 text-xs" data-testid="pwa-update-later" onClick={() => setDismissed(true)}>Later</button>
      <button type="button" className="nb-btn-primary h-9 px-3 text-xs" data-testid="pwa-update-now" onClick={apply}>Update now</button>
    </div>
  );
}

export function AppBuildLabel({ className = "" }) {
  return <p className={`text-[11px] text-nb-mute ${className}`} data-testid="app-build-label">App · {BUILD}</p>;
}
