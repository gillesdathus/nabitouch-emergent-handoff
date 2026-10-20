import { Component } from "react";
import { Link, Outlet } from "react-router-dom";
import { AlertTriangle, RefreshCw } from "lucide-react";
import { useDemo } from "@/store/DemoStore";
import { hasPractitionerCapability } from "@/lib/practitionerIdentity";

function logProIssue(code, detail = {}) {
  try {
    // No patient data, credentials, or emails — codes only.
    console.error("[nabitouch:pro]", code, detail);
  } catch { /* ignore */ }
}

/** Setup UI when the account can open /pro but has no linked practitioner row. */
export function PractitionerSetupRequired({ reason = "missing_profile" }) {
  const { user, refresh } = useDemo();
  const canOwn = Array.isArray(user?.workspaces) && user.workspaces.includes("owner");
  logProIssue(reason, { hasSubject: Boolean(user?.subject) });
  return (
    <div className="mx-auto max-w-lg space-y-4 py-10" data-testid="pro-setup-required">
      <div className="nb-card space-y-3 p-6">
        <div className="flex items-start gap-3">
          <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-amber-600" />
          <div>
            <h1 className="text-xl font-semibold tracking-tight">Practitioner profile setup required</h1>
            <p className="mt-2 text-sm text-nb-mute">
              This account has practitioner access, but no linked practitioner profile is available yet.
              Clinical tools stay locked until an authorized owner links the correct profile.
            </p>
          </div>
        </div>
        <div className="flex flex-wrap gap-2 pt-2">
          <button type="button" className="nb-btn-ghost h-11" data-testid="pro-setup-retry" onClick={() => refresh?.()}>
            <RefreshCw className="h-4 w-4" /> Retry
          </button>
          {canOwn && (
            <Link to="/owner/permissions" className="nb-btn-primary h-11 px-5" data-testid="pro-setup-link-profile">
              Link profile (Owner)
            </Link>
          )}
          {!canOwn && (
            <Link to="/account/security" className="nb-btn-ghost h-11" data-testid="pro-setup-security">
              Account &amp; Security
            </Link>
          )}
        </div>
      </div>
    </div>
  );
}

export function PractitionerUnauthorized() {
  logProIssue("pro_unauthorized");
  return (
    <div className="mx-auto max-w-lg py-10" data-testid="pro-unauthorized">
      <div className="nb-card space-y-3 p-6">
        <h1 className="text-xl font-semibold">Practitioner workspace unavailable</h1>
        <p className="text-sm text-nb-mute">Your account is not authorized for the practitioner workspace.</p>
        <Link to="/" className="nb-btn-primary inline-flex h-11 px-5">Go home</Link>
      </div>
    </div>
  );
}

/** Safe loading / missing-profile gate used by practitioner pages. */
export function usePractitionerProfile() {
  const { idx, practitionerId, user, state, error, refresh } = useDemo();
  const loading = !state || !idx;
  const capable = hasPractitionerCapability(user) || (Array.isArray(user?.workspaces) && user.workspaces.includes("practitioner"));
  const me = !loading && practitionerId ? idx.practitioners?.[practitionerId] : null;
  return { loading, capable, me, practitionerId, user, error, refresh, idx, state };
}

export class PractitionerErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { failed: false };
  }

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error) {
    logProIssue("pro_route_crash", { name: error?.name || "Error" });
  }

  render() {
    if (this.state.failed) {
      return (
        <div className="mx-auto max-w-lg py-10" data-testid="pro-error-boundary">
          <div className="nb-card space-y-3 p-6">
            <div className="flex items-start gap-3">
              <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-rose-600" />
              <div>
                <h1 className="text-xl font-semibold">Something went wrong in the practitioner workspace</h1>
                <p className="mt-2 text-sm text-nb-mute">The page failed to render. You can retry or switch workspace without signing out.</p>
              </div>
            </div>
            <div className="flex flex-wrap gap-2 pt-2">
              <button type="button" className="nb-btn-primary h-11 px-5" data-testid="pro-error-retry" onClick={() => this.setState({ failed: false })}>
                <RefreshCw className="h-4 w-4" /> Retry
              </button>
              <Link to="/owner" className="nb-btn-ghost h-11" data-testid="pro-error-owner">Owner / Manager</Link>
            </div>
          </div>
        </div>
      );
    }
    return this.props.children ?? <Outlet />;
  }
}
