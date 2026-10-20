import { Component } from "react";
import { RotateCw } from "lucide-react";

const RELOAD_KEY = "nb-chunk-reload";

export function installChunkRecovery() {
  window.addEventListener("vite:preloadError", (event) => {
    if (sessionStorage.getItem(RELOAD_KEY)) return;
    event.preventDefault();
    sessionStorage.setItem(RELOAD_KEY, "1");
    window.location.reload();
  });
  window.addEventListener("load", () => setTimeout(() => sessionStorage.removeItem(RELOAD_KEY), 10000));
}

export class AppErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  render() {
    if (!this.state.error) return this.props.children;
    const stale = /dynamically imported module|Importing a module script failed|ChunkLoadError/i.test(String(this.state.error?.message));
    return (
      <div role="alert" className="mx-auto flex min-h-[60dvh] max-w-md flex-col items-center justify-center px-6 text-center" data-testid="app-error-boundary">
        <p className="text-lg font-semibold">{stale ? "A newer version of Nabitouch is available" : "This screen could not be shown"}</p>
        <p className="mt-1 text-sm text-nb-mute">{stale ? "Reload to get the latest version." : "Your data is safe. Reload the page to try again."}</p>
        <button type="button" onClick={() => window.location.reload()} className="nb-btn-primary mt-5 h-11 px-6 text-sm" data-testid="app-error-reload"><RotateCw className="h-4 w-4" />Reload</button>
      </div>
    );
  }
}
