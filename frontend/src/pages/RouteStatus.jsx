import { Link } from "react-router-dom";
import { Home, Lock, SearchX } from "lucide-react";
import { homeFor } from "@/lib/workspaces";
import { useDemo } from "@/store/DemoStore";

/** Unknown path — never silently redirect protected URLs to the public homepage. */
export function NotFoundPage() {
  const { user } = useDemo();
  const home = user ? homeFor(user) : "/";
  return (
    <div className="mx-auto flex min-h-[60vh] max-w-lg flex-col items-center justify-center px-5 py-16 text-center" data-testid="route-not-found">
      <span className="grid h-14 w-14 place-items-center rounded-full bg-sky-50 text-nb-blue">
        <SearchX className="h-6 w-6" aria-hidden="true" />
      </span>
      <p className="nb-eyebrow mt-4">404</p>
      <h1 className="mt-1 text-2xl font-semibold tracking-tight text-nb-ink">Page not found</h1>
      <p className="mt-2 text-sm text-nb-mute">
        This address is not part of NabiTouch. If you followed a staff link, the feature may not be deployed yet.
      </p>
      <div className="mt-6 flex flex-wrap items-center justify-center gap-2">
        <Link to={home} className="nb-btn-primary h-11 px-5 text-sm" data-testid="route-not-found-home">
          <Home className="h-4 w-4" aria-hidden="true" /> Go to your workspace
        </Link>
        <Link to="/" className="nb-btn-ghost h-11 px-5 text-sm" data-testid="route-not-found-public">
          Public home
        </Link>
      </div>
    </div>
  );
}

/** Signed-in user lacks the workspace role for this area. */
export function ForbiddenPage({ requiredRole }) {
  const { user } = useDemo();
  const home = user ? homeFor(user) : "/";
  return (
    <div className="mx-auto flex min-h-[60vh] max-w-lg flex-col items-center justify-center px-5 py-16 text-center" data-testid="route-forbidden">
      <span className="grid h-14 w-14 place-items-center rounded-full bg-amber-50 text-amber-800">
        <Lock className="h-6 w-6" aria-hidden="true" />
      </span>
      <p className="nb-eyebrow mt-4">403</p>
      <h1 className="mt-1 text-2xl font-semibold tracking-tight text-nb-ink">Access denied</h1>
      <p className="mt-2 text-sm text-nb-mute">
        Your account is signed in, but it does not have {requiredRole ? `${requiredRole} ` : ""}access to this area.
      </p>
      <Link to={home} className="nb-btn-primary mt-6 h-11 px-5 text-sm" data-testid="route-forbidden-home">
        <Home className="h-4 w-4" aria-hidden="true" /> Go to your workspace
      </Link>
    </div>
  );
}

export default NotFoundPage;
