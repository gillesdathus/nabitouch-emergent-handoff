import { useEffect, useState } from "react";
import { useDemo } from "@/store/DemoStore";
import { apiError } from "@/lib/api";

const FILTERS = ["", "imported", "needs_contact_review", "ready_to_invite", "invited", "invitation_expired", "onboarding_in_progress", "submitted", "needs_review", "activated"];

export default function LegacyClients() {
  const { api, run } = useDemo();
  const [summary, setSummary] = useState(null);
  const [page, setPage] = useState({ items: [], total: 0, invoicesMessage: "" });
  const [invites, setInvites] = useState({ items: [], total: 0, openCount: 0, autoSendOnImport: false });
  const [q, setQ] = useState("");
  const [status, setStatus] = useState("");
  const [selected, setSelected] = useState(null);
  const [selectedIds, setSelectedIds] = useState([]);
  const [error, setError] = useState("");

  const load = () => {
    api.legacySummary().then(setSummary).catch(() => setSummary(null));
    api.legacyPatients({ q, status, sort: "lastName", page: 1, pageSize: 25 }).then(setPage).catch((err) => setError(apiError(err)));
    api.legacyInvitations({}).then(setInvites).catch(() => setInvites({ items: [], total: 0, openCount: 0, autoSendOnImport: false }));
  };
  useEffect(() => { load(); }, [q, status]); // eslint-disable-line

  const toggleSelect = (id) => {
    setSelectedIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  };

  const sample = () => run(() => api.legacyImport({
    backupConfirmed: true,
    authorize: true,
    records: [
      { id: `sample-${Date.now()}`, first_name: "Sample", last_name: "Client", email: "sample.legacy@example.com", phone: "7805550199", address: "10150 104 St NW, Edmonton, AB", source: "synthetic" },
    ],
  }), "Sample legacy record staged");

  return (
    <div className="mx-auto max-w-5xl space-y-5" data-testid="legacy-clients">
      <div>
        <p className="nb-eyebrow">Clients</p>
        <h1 className="text-2xl font-semibold tracking-tight">Legacy Clients</h1>
        <p className="text-sm text-nb-mute">Imported patients stay separate from active accounts until onboarding links them. Import never sends invitations automatically.</p>
      </div>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3" data-testid="legacy-counts">
        {summary && Object.entries(summary.counts).filter(([, count]) => count).map(([key, count]) => (
          <button key={key} type="button" className="nb-card px-3 py-2 text-left text-sm" onClick={() => setStatus(key)}><span className="block text-lg font-semibold">{count}</span>{key.replaceAll("_", " ")}</button>
        ))}
      </div>
      <section className="nb-card space-y-2 p-4 text-sm" data-testid="legacy-invite-dashboard">
        <h2 className="font-semibold">Invitation status</h2>
        <p className="text-nb-mute">{invites.openCount} open · {invites.total} total recorded · auto-send on import: {invites.autoSendOnImport ? "on" : "off"}</p>
        <ul className="max-h-40 space-y-1 overflow-auto text-xs">
          {invites.items.slice(0, 12).map((row) => (
            <li key={row.id} className="flex flex-wrap items-center justify-between gap-2 border-b border-sky-50 py-1">
              <span>{row.patientId} · {row.delivery || "—"} · {row.channel || "email"}</span>
              <span>
                {row.revokedAt ? "revoked" : row.usedAt ? "used" : "open"}
                {!row.usedAt && !row.revokedAt && (
                  <button type="button" className="nb-btn-ghost ml-2 h-8 px-2" data-testid={`legacy-revoke-${row.id}`} onClick={async () => { await api.legacyInviteRevoke(row.id); load(); }}>Revoke</button>
                )}
              </span>
            </li>
          ))}
          {invites.items.length === 0 && <li className="text-nb-mute">No invitations yet.</li>}
        </ul>
      </section>
      <div className="flex flex-wrap gap-2">
        <input className="nb-input max-w-xs" placeholder="Search name, phone, or source id" value={q} onChange={(e) => setQ(e.target.value)} data-testid="legacy-search" />
        <select className="nb-input max-w-xs" value={status} onChange={(e) => setStatus(e.target.value)} data-testid="legacy-filter">
          {FILTERS.map((item) => <option key={item || "all"} value={item}>{item ? item.replaceAll("_", " ") : "All statuses"}</option>)}
        </select>
        <button type="button" className="nb-btn-primary h-12" data-testid="legacy-sample" onClick={async () => { await sample(); load(); }}>Stage a sample</button>
        <button
          type="button"
          className="nb-btn-ghost h-12"
          data-testid="legacy-batch-preview"
          disabled={!selectedIds.length}
          onClick={async () => {
            const preview = await api.legacyInvitePreview(selectedIds);
            setError(preview.blocked?.length ? `${preview.blocked.length} blocked · ${preview.ready.length} ready (will not send until confirmed)` : `${preview.ready.length} ready (preview only)`);
          }}
        >
          Preview selected invites
        </button>
        <button
          type="button"
          className="nb-btn-primary h-12"
          data-testid="legacy-batch-send"
          disabled={!selectedIds.length}
          onClick={async () => {
            if (!window.confirm(`Send invitations to ${selectedIds.length} selected record(s)?`)) return;
            await run(() => api.legacyInvitationsSend(selectedIds), "Invitations sent");
            setSelectedIds([]);
            load();
          }}
        >
          Send selected invites
        </button>
      </div>
      {error && <p className="text-sm text-rose-700">{error}</p>}
      <p className="text-sm text-nb-mute" data-testid="legacy-invoice-note">{page.invoicesMessage || summary?.invoicesMessage}</p>
      <ul className="space-y-2">
        {page.items.map((row) => (
          <li key={row.id}>
            <div className="nb-card flex w-full flex-wrap items-center gap-2 p-4 text-sm">
              <input type="checkbox" checked={selectedIds.includes(row.id)} onChange={() => toggleSelect(row.id)} data-testid={`legacy-select-${row.sourceId}`} aria-label={`Select ${row.firstName}`} />
              <button type="button" className="flex flex-1 flex-wrap items-center justify-between gap-2 text-left" data-testid={`legacy-row-${row.sourceId}`} onClick={() => api.legacyPatient(row.id).then(setSelected)}>
                <span><b>{row.firstName} {row.lastName}</b><span className="mt-1 block text-nb-mute">{row.email || "No email"} · {row.phone || "No phone"} · {row.sourceId}</span></span>
                <span className="rounded-full bg-sky-50 px-3 py-1 text-xs">{row.status.replaceAll("_", " ")}{row.duplicateOf ? " · duplicate" : ""}{row.invitationReadiness ? ` · ${row.invitationReadiness.replaceAll("_", " ")}` : ""}{row.contactComplete ? "" : " · contact incomplete"}</span>
              </button>
            </div>
          </li>
        ))}
        {page.items.length === 0 && <li className="text-sm text-nb-mute">No legacy records in this view.</li>}
      </ul>
      <p className="text-xs text-nb-mute">{page.total} record{page.total === 1 ? "" : "s"}</p>
      {selected && (
        <section className="nb-card space-y-2 p-5 text-sm" data-testid="legacy-detail">
          <h2 className="font-semibold">{selected.firstName} {selected.lastName}</h2>
          <p>Source {selected.sourceId} · batch {selected.batchId}</p>
          <p>{selected.address || "No postal address on the source record"}</p>
          <p data-testid="legacy-detail-invoices">{selected.invoices?.length ? `${selected.invoices.length} historical invoice${selected.invoices.length === 1 ? "" : "s"}` : selected.invoicesMessage}</p>
          <p>Linked account: {selected.clientId || "Not linked"}</p>
          <p>Invitation readiness: {(selected.invitationReadiness || "not set").replaceAll("_", " ")}</p>
          <button type="button" className="nb-btn-primary h-10" data-testid="legacy-invite" onClick={async () => { const sent = await run(() => api.legacyInvite(selected.id, {}), "Invitation prepared"); if (sent?.link) setSelected({ ...selected, link: sent.link, status: "invited" }); load(); }}>Prepare invitation</button>
          {selected.link && <p className="break-all text-xs" data-testid="legacy-invite-link">{selected.link}</p>}
          <p>Legacy consent flag: {selected.legacyConsentSigned || "not recorded"}. It is not applied as treatment consent.</p>
          {selected.status !== "ready_to_invite" && <button type="button" className="nb-btn-ghost h-10" data-testid="legacy-mark-ready" onClick={async () => { const next = await api.legacyReview(selected.id, { status: "ready_to_invite" }); setSelected(next); load(); }}>Mark ready to invite</button>}
        </section>
      )}
    </div>
  );
}
