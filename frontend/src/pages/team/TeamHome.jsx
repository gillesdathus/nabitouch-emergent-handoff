import { Headphones, LifeBuoy, MessageSquare, Package, ClipboardList } from "lucide-react";
import { ModuleNavigation } from "@/components/tide";
import { TeamAreaTile } from "@/components/team/TeamConnectUI";
import { TEAM_AREAS, teamBase, teamNavFor, teamPath } from "@/lib/team-connect";
import { useDemo } from "@/store/DemoStore";

const ICONS = {
  messages: MessageSquare,
  help: LifeBuoy,
  requests: ClipboardList,
  supplies: Package,
};

export default function TeamHome({ role = "pro" }) {
  const { user } = useDemo();
  const base = teamBase(role);
  const name = (user?.name || "there").split(" ")[0];
  const subtitle = {
    pro: "Messages, Quick Help, requests, and supplies — without leaving your practitioner workspace.",
    desk: "Coordinate assistance, client visit messages, and supply handoffs for the desk.",
    owner: "Assistance board, supply operations, and staff communication in one place.",
  }[role] || "";

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
