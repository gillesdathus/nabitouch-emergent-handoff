import { Headphones, LifeBuoy, MessageSquare, Package, ClipboardList, Shield } from "lucide-react";
import { Link } from "react-router-dom";
import { ModuleNavigation } from "@/components/tide";
import { TeamAreaTile } from "@/components/team/TeamConnectUI";
import { restrictedFlag } from "@/lib/feature-flags";
import { TEAM_AREAS, teamBase, teamNavFor, teamPath } from "@/lib/team-connect";
import { useDemo } from "@/store/DemoStore";

const ICONS = {
  messages: MessageSquare,
  help: LifeBuoy,
  requests: ClipboardList,
  supplies: Package,
};

export default function TeamHome({ role = "pro" }) {
  const { user, idx } = useDemo();
  const base = teamBase(role);
  const name = (user?.name || "there").split(" ")[0];
  const subtitle = {
    pro: "Messages, Quick Help, requests, and supplies — without leaving your practitioner workspace.",
    desk: "Coordinate assistance, client visit messages, and supply handoffs for the desk.",
    owner: "Assistance board, supply operations, and staff communication in one place.",
  }[role] || "";
  const shieldOn = (
    restrictedFlag(idx?.settings, "securityShieldFleetEnabled")
    || restrictedFlag(idx?.settings, "securityShieldDocsEnabled")
    || restrictedFlag(idx?.settings, "securityShieldArrivalCodeEnabled")
    || restrictedFlag(idx?.settings, "securityShieldSafetySamplingEnabled")
  );
  const shieldHref = role === "owner" ? "/owner/shield" : role === "pro" ? "/pro/shield" : "/owner/shield";

  return (
    <div className="mx-auto max-w-3xl space-y-5" data-testid="team-connect-home">
      <ModuleNavigation items={teamNavFor(role)} testid="team-module-nav" />
      <div>
        <p className="nb-eyebrow">Team Connect</p>
        <h1 className="text-3xl font-semibold tracking-tight">
          Hi {name}
        </h1>
        <p className="mt-1 text-sm text-nb-mute">{subtitle}</p>
      </div>
      {shieldOn && (
        <Link
          to={shieldHref}
          className="nb-card flex items-start gap-3 p-4 transition hover:ring-1 hover:ring-nb-teal/40"
          data-testid="team-shield-hook"
        >
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-nb-teal/10 text-nb-teal">
            <Shield className="h-5 w-5" />
          </span>
          <span>
            <span className="block font-semibold">Security Shield</span>
            <span className="mt-0.5 block text-xs text-nb-mute">
              Renewal alerts and vehicle or safety Quick Help route here when Shield flags are on. Vehicle Issue and Safety Concern requests stay on the assistance board.
            </span>
          </span>
        </Link>
      )}
      <div className="grid gap-3" data-testid="team-area-grid">
        {TEAM_AREAS.map((area) => (
          <TeamAreaTile
            key={area.id}
            to={teamPath(role, area.path)}
            icon={ICONS[area.id] || Headphones}
            title={area.title}
            detail={area.detail}
            tint={area.tint}
            testid={`team-area-${area.id}`}
          />
        ))}
      </div>
      <p className="text-xs text-nb-mute">
        Client bottom navigation is unchanged. Open Team Connect from your staff workspace shortcuts.
        <span className="ml-1 text-nb-teal">{base}</span>
      </p>
    </div>
  );
}
