import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { api, apiError } from "@/lib/api";
import { useDemo } from "@/store/DemoStore";
import { restrictedFlag } from "@/lib/feature-flags";
import { EmptyState, Notice, SaveFeedback, StatusBadge } from "@/components/tide";
import { ShieldChrome } from "@/components/shield/ShieldChrome";

function toneFor(status) {
  if (status === "verified" || status === "valid") return "success";
  if (status === "pending_review" || status === "expiring_soon") return "warn";
  if (status === "expired" || status === "rejected") return "danger";
  return "neutral";
}

const BLANK = { practitionerId: "", jurisdiction: "AB", licenceClass: "5", licenceNumber: "", expiresOn: "" };

export default function DriverCredentials() {
  const { state, idx } = useDemo();
  const docs = restrictedFlag(idx?.settings, "securityShieldDocsEnabled");
  const [rows, setRows] = useState(null);
  const [form, setForm] = useState(BLANK);
  const [mode, setMode] = useState("list"); // list | add
  const [feedback, setFeedback] = useState({ state: "idle", message: "" });
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    if (!docs) return Promise.resolve();
    return api.shieldDriverCredentials()
      .then((r) => setRows(r.credentials || []))
      .catch((e) => {
        setRows([]);
        toast.error(apiError(e));
      });
  }, [docs]);

  useEffect(() => { load(); }, [load]);

  const submit = async () => {
    if (busy) return;
    if (!form.practitionerId || !form.licenceNumber || !form.expiresOn) {
      setFeedback({ state: "error", message: "Choose a practitioner and enter licence number and expiry." });
      return;
    }
    setBusy(true);
    setFeedback({ state: "saving", message: "Submitting for review…" });
    try {
      await api.shieldSubmitDriverCredential(form);
      setFeedback({ state: "success", message: "Driver's licence submitted for review." });
      setForm(BLANK);
      setMode("list");
      await load();
    } catch (e) {
      setFeedback({ state: "error", message: apiError(e) });
    } finally {
      setBusy(false);
    }
  };

  const decide = async (id, approve) => {
    const reason = approve ? undefined : window.prompt("Rejection reason") || "";
    if (!approve && !reason) return;
    setBusy(true);
    try {
      await api.shieldVerifyDriverCredential(id, { approve, reason });
      setFeedback({ state: "success", message: approve ? "Credential verified." : "Credential rejected." });
      await load();
    } catch (e) {
      setFeedback({ state: "error", message: apiError(e) });
    } finally {
      setBusy(false);
    }
  };

  const nameOf = (id) => (state.practitioners || []).find((p) => p.id === id)?.name || id;

  if (!docs) {
    return (
      <ShieldChrome title="Driver credentials" sub="Driver's licences for mobile practitioners. Never shown to clients." testid="shield-drivers-off">
        <Notice>Document management is turned off in this environment.</Notice>
      </ShieldChrome>
    );
  }

  return (
    <ShieldChrome
      title="Driver credentials"
      sub="Distinct from professional RMT registration and liability insurance. Never shown to clients."
      right={mode === "list" ? (
        <button type="button" onClick={() => { setMode("add"); setFeedback({ state: "idle", message: "" }); }} className="nb-btn-primary h-10 shrink-0 px-4 text-sm" data-testid="shield-dl-add">
          Add credential
        </button>
      ) : undefined}
      testid="shield-drivers-page"
    >
      <Notice>Secure file upload stays gated until Security Shield documents are enabled for production. Typed licence details can still be submitted for review.</Notice>
      <SaveFeedback state={feedback.state} message={feedback.message} testid="shield-dl-feedback" />

      {mode === "add" && (
        <div className="nb-card space-y-3 p-4" data-testid="shield-driver-creds">
          <p className="font-semibold">Add driver's licence</p>
          <div className="grid gap-2 sm:grid-cols-2">
            <select className="nb-input h-10" value={form.practitionerId} onChange={(e) => setForm({ ...form, practitionerId: e.target.value })} data-testid="shield-dl-practitioner">
              <option value="">Practitioner</option>
              {(state.practitioners || []).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
            <input className="nb-input h-10" placeholder="Jurisdiction" value={form.jurisdiction} onChange={(e) => setForm({ ...form, jurisdiction: e.target.value })} data-testid="shield-dl-jurisdiction" />
            <input className="nb-input h-10" placeholder="Licence class" value={form.licenceClass} onChange={(e) => setForm({ ...form, licenceClass: e.target.value })} data-testid="shield-dl-class" />
            <input className="nb-input h-10" placeholder="Licence number" value={form.licenceNumber} onChange={(e) => setForm({ ...form, licenceNumber: e.target.value })} data-testid="shield-dl-number" />
            <input className="nb-input h-10" type="date" value={form.expiresOn} onChange={(e) => setForm({ ...form, expiresOn: e.target.value })} data-testid="shield-dl-expires" />
          </div>
          <div className="flex gap-2">
            <button type="button" disabled={busy} onClick={submit} className="nb-btn-primary h-10 flex-1" data-testid="shield-dl-submit">{busy ? "Submitting…" : "Submit for review"}</button>
            <button type="button" disabled={busy} onClick={() => setMode("list")} className="nb-btn-ghost h-10 px-4" data-testid="shield-dl-cancel">Cancel</button>
          </div>
        </div>
      )}

      {rows === null && <p className="text-sm text-nb-mute">Loading credentials…</p>}
      {rows && rows.length === 0 && mode === "list" && (
        <EmptyState
          title="No driver credentials yet"
          body="Add a practitioner's licence so renewals and verification stay in one place."
          action={<button type="button" onClick={() => setMode("add")} className="nb-btn-primary h-11 px-5" data-testid="shield-dl-empty-add">Add credential</button>}
          testid="shield-dl-empty"
        />
      )}
      <div className="space-y-3">
        {(rows || []).map((row) => (
          <div key={row.id} className="nb-card p-4" data-testid={`shield-dl-${row.id}`}>
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div>
                <p className="font-semibold">{nameOf(row.practitionerId)}</p>
                <p className="text-xs text-nb-mute">{row.jurisdiction} class {row.licenceClass} · {row.licenceNumberMasked} · expires {row.expiresOn || "—"}</p>
              </div>
              <StatusBadge tone={toneFor(row.dashboardStatus || row.status)} testid={`shield-dl-status-${row.id}`}>
                {(row.dashboardStatus || row.status || "").replace(/_/g, " ")}
              </StatusBadge>
            </div>
            {row.rejectReason && <p className="mt-2 text-xs text-rose-700">Rejected: {row.rejectReason}</p>}
            {row.status === "pending_review" && (
              <div className="mt-3 flex gap-2">
                <button type="button" disabled={busy} onClick={() => decide(row.id, true)} className="nb-btn-primary h-9 px-3 text-xs" data-testid={`shield-dl-approve-${row.id}`}>Approve</button>
                <button type="button" disabled={busy} onClick={() => decide(row.id, false)} className="nb-btn-ghost h-9 px-3 text-xs" data-testid={`shield-dl-reject-${row.id}`}>Reject</button>
              </div>
            )}
          </div>
        ))}
      </div>
    </ShieldChrome>
  );
}
