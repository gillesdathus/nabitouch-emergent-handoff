import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { toast } from "sonner";
import { Car, FileBadge, LifeBuoy, MapPinned, RefreshCw, Shield } from "lucide-react";
import { api, apiError } from "@/lib/api";
import { useDemo } from "@/store/DemoStore";
import { restrictedFlag } from "@/lib/feature-flags";
import { EmptyState, Notice, PageHeader, Segmented } from "@/components/tide";

const STATUS_FILTERS = [
  { value: "", label: "All" },
  { value: "verified", label: "Valid" },
  { value: "expiring_soon", label: "Expiring soon" },
  { value: "expired", label: "Expired" },
  { value: "pending_review", label: "Pending" },
  { value: "missing_expiry", label: "Missing date" },
];

function ActiveVisits() {
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
            <Link to={`/owner/schedule`} className="nb-btn-ghost h-9 px-3 text-xs">Open schedule</Link>
          </div>
          <Link to={`/owner/shield/timeline/${v.id}`} className="mt-3 inline-flex text-xs font-semibold text-nb-blue" data-testid={`shield-timeline-link-${v.id}`}>Visit timeline</Link>
        </div>
      ))}
    </div>
  );
}

function Renewals() {
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

function DriverCredentials() {
  const { state } = useDemo();
  const [rows, setRows] = useState([]);
  const [form, setForm] = useState({ practitionerId: "", jurisdiction: "AB", licenceClass: "5", licenceNumber: "", expiresOn: "" });
  const load = useCallback(() => api.shieldDriverCredentials().then((r) => setRows(r.credentials || [])).catch((e) => toast.error(apiError(e))), []);
  useEffect(() => { load(); }, [load]);
  const submit = async () => {
    try {
      await api.shieldSubmitDriverCredential(form);
      toast.success("Driver's licence submitted for review");
      setForm((f) => ({ ...f, licenceNumber: "", expiresOn: "" }));
      load();
    } catch (e) { toast.error(apiError(e)); }
  };
  const decide = async (id, approve) => {
    const reason = approve ? undefined : window.prompt("Rejection reason") || "";
    if (!approve && !reason) return;
    try {
      await api.shieldVerifyDriverCredential(id, { approve, reason });
      toast.success(approve ? "Verified" : "Rejected");
      load();
    } catch (e) { toast.error(apiError(e)); }
  };
  return (
    <div className="space-y-4" data-testid="shield-driver-creds">
      <Notice>Never shown to clients. Distinct from professional registration and liability insurance on Credentials.</Notice>
      <div className="nb-card grid gap-2 p-4 sm:grid-cols-2">
        <select className="nb-input h-10" value={form.practitionerId} onChange={(e) => setForm({ ...form, practitionerId: e.target.value })} data-testid="shield-dl-practitioner">
          <option value="">Practitioner</option>
          {(state.practitioners || []).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
        <input className="nb-input h-10" placeholder="Jurisdiction" value={form.jurisdiction} onChange={(e) => setForm({ ...form, jurisdiction: e.target.value })} />
        <input className="nb-input h-10" placeholder="Licence class" value={form.licenceClass} onChange={(e) => setForm({ ...form, licenceClass: e.target.value })} />
        <input className="nb-input h-10" placeholder="Licence number" value={form.licenceNumber} onChange={(e) => setForm({ ...form, licenceNumber: e.target.value })} data-testid="shield-dl-number" />
        <input className="nb-input h-10" type="date" value={form.expiresOn} onChange={(e) => setForm({ ...form, expiresOn: e.target.value })} data-testid="shield-dl-expires" />
        <button type="button" onClick={submit} className="nb-btn-primary h-10" data-testid="shield-dl-submit">Submit for review</button>
      </div>
      {rows.map((row) => (
        <div key={row.id} className="nb-card p-4" data-testid={`shield-dl-${row.id}`}>
          <p className="font-semibold">{row.practitionerId} · {row.dashboardStatus.replace(/_/g, " ")}</p>
          <p className="text-xs text-nb-mute">{row.jurisdiction} class {row.licenceClass} · {row.licenceNumberMasked} · expires {row.expiresOn || "—"}</p>
          {row.status === "pending_review" && (
            <div className="mt-2 flex gap-2">
              <button type="button" onClick={() => decide(row.id, true)} className="nb-btn-primary h-9 px-3 text-xs" data-testid={`shield-dl-approve-${row.id}`}>Approve</button>
              <button type="button" onClick={() => decide(row.id, false)} className="nb-btn-ghost h-9 px-3 text-xs" data-testid={`shield-dl-reject-${row.id}`}>Reject</button>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

export default function SecurityShield() {
  const { idx } = useDemo();
  const fleet = restrictedFlag(idx?.settings, "securityShieldFleetEnabled");
  const docs = restrictedFlag(idx?.settings, "securityShieldDocsEnabled");
  const arrival = restrictedFlag(idx?.settings, "securityShieldArrivalCodeEnabled");
  const [tab, setTab] = useState("overview");

  if (!fleet && !docs && !arrival) {
    return (
      <div className="mx-auto max-w-3xl space-y-6" data-testid="shield-hub-off">
        <PageHeader eyebrow="Security Shield" title="Security Shield" />
        <Notice>Security Shield flags are off in this environment.</Notice>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-3xl space-y-6" data-testid="shield-hub">
      <PageHeader eyebrow="Security Shield" title="Visit safety & verification" sub="Fleet, driving documents, renewals, active mobile visits, and safety alerts — without dispatch complexity." />
      <div className="grid gap-2 sm:grid-cols-2">
        {fleet && <Link to="/owner/fleet" className="nb-card flex items-center gap-3 p-4" data-testid="shield-link-fleet"><Car className="h-5 w-5 text-nb-blue" /><span><b>Fleet</b><span className="block text-xs text-nb-mute">Vehicles and assignments</span></span></Link>}
        <button type="button" onClick={() => setTab("drivers")} className="nb-card flex items-center gap-3 p-4 text-left" data-testid="shield-tab-drivers"><FileBadge className="h-5 w-5 text-nb-teal" /><span><b>Driver credentials</b><span className="block text-xs text-nb-mute">Licence review</span></span></button>
        <button type="button" onClick={() => setTab("renewals")} className="nb-card flex items-center gap-3 p-4 text-left" data-testid="shield-tab-renewals"><RefreshCw className="h-5 w-5 text-nb-blue" /><span><b>Renewals</b><span className="block text-xs text-nb-mute">Expiry dashboard</span></span></button>
        <button type="button" onClick={() => setTab("active")} className="nb-card flex items-center gap-3 p-4 text-left" data-testid="shield-tab-active"><MapPinned className="h-5 w-5 text-nb-blue" /><span><b>Active visits</b><span className="block text-xs text-nb-mute">Safety board</span></span></button>
        <Link to="/owner/safety" className="nb-card flex items-center gap-3 p-4" data-testid="shield-link-safety"><LifeBuoy className="h-5 w-5 text-rose-600" /><span><b>Safety alerts</b><span className="block text-xs text-nb-mute">Assist & holds</span></span></Link>
        <button type="button" onClick={() => setTab("overview")} className="nb-card flex items-center gap-3 p-4 text-left" data-testid="shield-tab-overview"><Shield className="h-5 w-5 text-nb-navy" /><span><b>Overview</b><span className="block text-xs text-nb-mute">Flags & scope</span></span></button>
      </div>
      {tab === "overview" && (
        <Notice testid="shield-overview">
          Fleet {fleet ? "on" : "off"} · Documents {docs ? "on" : "off"} · Arrival codes {arrival ? "on" : "off"}.
          Clinical document uploads stay separate and remain off. Vehicle insurance is not professional liability insurance.
        </Notice>
      )}
      {tab === "drivers" && (docs ? <DriverCredentials /> : <Notice>Document management is turned off.</Notice>)}
      {tab === "renewals" && (docs ? <Renewals /> : <Notice>Document management is turned off.</Notice>)}
      {tab === "active" && <ActiveVisits />}
    </div>
  );
}
