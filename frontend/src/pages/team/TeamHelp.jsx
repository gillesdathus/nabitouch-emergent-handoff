import { Link } from "react-router-dom";
import { AlertTriangle, Car, Clock, HelpCircle, MapPin, Package, ShieldAlert } from "lucide-react";
import { ModuleNavigation } from "@/components/tide";
import { TeamComingSoon } from "@/components/team/TeamConnectUI";
import { QUICK_HELP_CATEGORIES, teamNavFor, teamPath } from "@/lib/team-connect";

const ICONS = {
  running_late: Clock,
  vehicle_issue: Car,
  safety_concern: ShieldAlert,
  address_problem: MapPin,
  need_supplies: Package,
  other: HelpCircle,
};

export default function TeamHelp({ role = "pro" }) {
  return (
    <div className="mx-auto max-w-3xl space-y-5" data-testid="team-help">
      <ModuleNavigation items={teamNavFor(role)} testid="team-module-nav" />
      <div>
        <p className="nb-eyebrow">Team Connect</p>
        <h1 className="text-3xl font-semibold tracking-tight">Quick Help</h1>
        <p className="mt-1 text-sm text-nb-mute">Operational assistance for the field. Forms and on-duty routing arrive in Phase 3.</p>
      </div>

      <div className="grid grid-cols-2 gap-3" data-testid="team-help-grid">
        {QUICK_HELP_CATEGORIES.map((cat) => {
          const Icon = ICONS[cat.id] || HelpCircle;
          return (
            <div key={cat.id} className="nb-card flex flex-col gap-2 p-4" data-testid={`team-help-card-${cat.id}`}>
              <Icon className="h-5 w-5 text-nb-navy" aria-hidden="true" />
              <p className="text-sm font-semibold text-nb-ink">{cat.title}</p>
              <p className="text-xs text-nb-mute">{cat.detail}</p>
            </div>
          );
        })}
      </div>

      {role === "pro" && (
        <Link
          to="/pro"
          className="nb-card flex items-start gap-3 p-4 text-sm ring-1 ring-rose-100"
          data-testid="team-help-safety-link"
        >
          <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-rose-600" />
          <span>
            <span className="font-semibold text-nb-ink">Safety emergency?</span>
            <span className="mt-0.5 block text-nb-mute">
              Call 911 first from the visit Safety Center. Quick Help never delays emergency action for an escalation timer.
            </span>
          </span>
        </Link>
      )}

      <TeamComingSoon
        title="Request forms next"
        body="Each category will open a short form, route to on-duty staff (not bookability flags), and support offline drafts."
      />
      <Link to={teamPath(role)} className="block text-sm text-nb-mute">Back to Team Connect</Link>
    </div>
  );
}
