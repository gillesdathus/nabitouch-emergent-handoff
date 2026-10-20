import { Link } from "react-router-dom";
import { Package } from "lucide-react";
import { ModuleNavigation, EmptyState } from "@/components/tide";
import { TeamComingSoon, TeamSearchField } from "@/components/team/TeamConnectUI";
import { teamNavFor, teamPath } from "@/lib/team-connect";
import { useState } from "react";

export default function TeamSupplies({ role = "pro" }) {
  const [query, setQuery] = useState("");
  const canAdjust = role === "owner";
  return (
    <div className="mx-auto max-w-3xl space-y-5" data-testid="team-supplies">
      <ModuleNavigation items={teamNavFor(role)} testid="team-module-nav" />
      <div>
        <p className="nb-eyebrow">{role === "owner" ? "Operations" : "Team Connect"}</p>
        <h1 className="text-3xl font-semibold tracking-tight">Supplies</h1>
        <p className="mt-1 text-sm text-nb-mute">
          {canAdjust
            ? "Main stock, practitioner stock, and transfers. Inventory ledger arrives in Phase 5."
            : "Request supplies and confirm receipt. Stock adjustments stay with Owner or Manager."}
        </p>
      </div>

      <div className="flex gap-2">
        <div className="min-w-0 flex-1">
          <TeamSearchField value={query} onChange={setQuery} placeholder="Search product, SKU…" testid="team-supplies-search" />
        </div>
      </div>

      <div className="no-scrollbar flex gap-2 overflow-x-auto" data-testid="team-supplies-filters">
        {["All items", "Low stock", "Linens", "Oils"].map((label, index) => (
          <span
            key={label}
            className={index === 0 ? "nb-chip-on h-9 text-xs" : "nb-chip-off h-9 text-xs"}
          >
            {label}
          </span>
        ))}
      </div>

      <EmptyState
        icon={Package}
        title="No inventory items yet"
        body="Phase 5 adds stock cards, request flows, next-client-location handoffs, and partial receipt confirmation."
        testid="team-supplies-empty"
      />
      <TeamComingSoon
        title="Simple supply ops"
        body="No warehouse ERP. Recipient confirmation is the approved handoff method; partial receipts stay auditable."
      />
      <Link to={teamPath(role)} className="block text-sm text-nb-mute">Back to Team Connect</Link>
    </div>
  );
}
