import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { toast } from "sonner";
import { Car, FileBadge, LifeBuoy, MapPinned, RefreshCw, Shield } from "lucide-react";
import { api, apiError } from "@/lib/api";
import { useDemo } from "@/store/DemoStore";
import { restrictedFlag } from "@/lib/feature-flags";
import { EmptyState, Notice, Segmented } from "@/components/tide";
import { ShieldChrome } from "@/components/shield/ShieldChrome";

const STATUS_FILTERS = [
  { value: "", label: "All" },
  { value: "verified", label: "Valid" },
  { value: "expiring_soon", label: "Expiring soon" },
  { value: "expired", label: "Expired" },
  { value: "pending_review", label: "Pending" },
  { value: "missing_expiry", label: "Missing date" },
];

export function ActiveVisits() {
  const [data, setData] = useState(null);
  const load = useCallback(() => api.shieldActiveVisits().then(setData).catch((e) => setData({ error: apiError(e), visits: [] })), []);
  useEffect(() => { load(); const t = setInterval(load, 15000); return () => clearInterval(t); }, [load]);
  if (!data) return <p className="text-sm text-nb-mute">Loading active visits…</p>;
  if (data.error) return <Notice>{data.error}</Notice>;
  return (
    <div className="space-y-3" data-testid="shield-active-visits">
      <Notice testid="shield-active-disclaimer">{data.disclaimer || data.assistLabel}</Notice>
      {(data.visits || []).length === 0 && <EmptyState title="No active mobile visits" body="Visits appear here after they are preparing, on the way, on site, or in session." />}
      {(data.visits || []).map((v) => (
        <div key={v.id} className="nb-card p-4" data-testid={`shield-active-${v.id}`}>
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div>
              <p className="font-semibold">{v.ref} · {v.status.replace(/_/g, " ")}</p>
              <p className="text-xs text-nb-mute">{v.vehiclePublic?.label || "No vehicle assigned"}{v.destination ? ` · ${v.destination}` : ""}</p>
              {v.lastKnown && <p className="mt-1 text-xs text-nb-mute">Last known GPS · accuracy {v.lastKnown.accuracy ?? "—"}m · {new Date(v.lastKnown.at).toLocaleTimeString("en-CA", { timeZone: "America/Edmonton" })}</p>}
              {v.clientVerifiedAt && <p className="mt-1 text-xs text-teal-700">Arrival verified</p>}
            </div>
            <Link to="/owner/schedule" className="nb-btn-ghost h-9 px-3 text-xs">Open schedule</Link>
          </div>
          <Link to={`/owner/shield/timeline/${v.id}`} className="mt-3 inline-flex text-xs font-semibold text-nb-blue" data-testid={`shield-timeline-link-${v.id}`}>Visit timeline</Link>
        </div>
      ))}
    </div>
  );
}

export function Renewals() {
  const [status, setStatus] = useState("");
  const [items, setItems] = useState(null);
  const load = useCallback(() => api.shieldRenewals({ status }).then((r) => setItems(r.items || [])).catch((e) => toast.error(apiError(e))), [status]);
  useEffect(() => { load(); }, [load]);
  const scan = () => api.shieldRenewalScan().then((r) => { toast.success(`Reminders recorded: ${r.sent || 0}`); load(); }).catch((e) => toast.error(apiError(e)));
  return (
    <div className="space-y-3" data-testid="shield-renewals">
      <div className="flex flex-wrap items-center gap-2">
        <Segmented value={status} onChange={setStatus} options={STATUS_FILTERS} testid="shield-renewal-filter" />
        <button type="button" onClick={scan} className="nb-btn-ghost h-10 px-3 text-sm" data-testid="shield-renewal-scan"><RefreshCw className="mr-1 inline h-3.5 w-3.5" />Run reminder scan</button>
      </div>
      <Notice>Reminders never include licence or policy numbers. Expiry does not auto-cancel visits or disable practitioners.</Notice>
      {items && items.length === 0 && <EmptyState title="Nothing in this filter" body="Submit driver's licences and vehicle documents to populate renewals." />}
      {(items || []).map((row) => (
        <div key={row.id} className="nb-card flex items-center justify-between gap-3 p-4" data-testid={`shield-renewal-${row.id}`}>
          <div>
            <p className="font-semibold">{row.label}</p>
            <p className="text-xs text-nb-mute">{row.dashboardStatus.replace(/_/g, " ")}{row.expiresOn ? ` · expires ${row.expiresOn}` : " · no expiry on file"}</p>
          </div>
          <span className="rounded-full bg-slate-100 px-2.5 py-1 text-[11px] font-semibold">{row.docType.replace(/_/g, " ")}</span>
        </div>
      ))}
    </div>
  );
}

export function ShieldVisitsPage() {
  return (
    <ShieldChrome title="Active visits" sub="Current mobile visits, arrival verification, and visit timelines." testid="shield-visits-page">
      <ActiveVisits />
    </ShieldChrome>
  );
}

export function ShieldRenewalsPage() {
  const { idx } = useDemo();
  const docs = restrictedFlag(idx?.settings, "securityShieldDocsEnabled");
  return (
    <ShieldChrome title="Renewals" sub="Driver and vehicle document expiry. Professional RMT credentials stay under Credentials." testid="shield-renewals-page">
      {docs ? <Renewals /> : <Notice>Document management is turned off in this environment.</Notice>}
    </ShieldChrome>
  );
}

export default function SecurityShield() {
  const { idx } = useDemo();
  const fleet = restrictedFlag(idx?.settings, "securityShieldFleetEnabled");
  const docs = restrictedFlag(idx?.settings, "securityShieldDocsEnabled");
  const arrival = restrictedFlag(idx?.settings, "securityShieldArrivalCodeEnabled");

  if (!fleet && !docs && !arrival) {
    return (
      <ShieldChrome title="Security Shield" testid="shield-hub-off">
        <Notice>Security Shield flags are off in this environment.</Notice>
      </ShieldChrome>
    );
  }

  return (
    <ShieldChrome
      title="Visit safety & verification"
      sub="Fleet, driving documents, renewals, active mobile visits, and safety alerts — without dispatch complexity."
      testid="shield-hub"
    >
      <Notice testid="shield-overview">
        Fleet {fleet ? "on" : "off"} · Documents {docs ? "on" : "off"} · Arrival codes {arrival ? "on" : "off"}.
        Clinical document uploads stay separate and remain off. Vehicle insurance is not professional liability insurance.
      </Notice>
      <div className="grid gap-2 sm:grid-cols-2">
        {fleet && (
          <Link to="/owner/fleet" className="nb-card flex items-center gap-3 p-4" data-testid="shield-link-fleet">
            <Car className="h-5 w-5 text-nb-blue" />
            <span><b>Fleet</b><span className="block text-xs text-nb-mute">Vehicles and assignments</span></span>
          </Link>
        )}
        <Link to="/owner/shield/drivers" className="nb-card flex items-center gap-3 p-4" data-testid="shield-tab-drivers">
          <FileBadge className="h-5 w-5 text-nb-teal" />
          <span><b>Driver credentials</b><span className="block text-xs text-nb-mute">Licence review</span></span>
        </Link>
        <Link to="/owner/shield/renewals" className="nb-card flex items-center gap-3 p-4" data-testid="shield-tab-renewals">
          <RefreshCw className="h-5 w-5 text-nb-blue" />
          <span><b>Renewals</b><span className="block text-xs text-nb-mute">Expiry dashboard</span></span>
        </Link>
        <Link to="/owner/shield/visits" className="nb-card flex items-center gap-3 p-4" data-testid="shield-tab-active">
          <MapPinned className="h-5 w-5 text-nb-blue" />
          <span><b>Active visits</b><span className="block text-xs text-nb-mute">Safety board</span></span>
        </Link>
        <Link to="/owner/safety" className="nb-card flex items-center gap-3 p-4" data-testid="shield-link-safety">
          <LifeBuoy className="h-5 w-5 text-rose-600" />
          <span><b>Safety alerts</b><span className="block text-xs text-nb-mute">Assist & holds</span></span>
        </Link>
        <div className="nb-card flex items-center gap-3 p-4" data-testid="shield-tab-overview">
          <Shield className="h-5 w-5 text-nb-navy" />
          <span><b>Overview</b><span className="block text-xs text-nb-mute">You are here · flags & scope</span></span>
        </div>
      </div>
    </ShieldChrome>
  );
}
