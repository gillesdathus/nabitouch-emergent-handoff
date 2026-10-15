import { useEffect, useState } from "react";
import { useDemo } from "@/store/DemoStore";
import { apiError } from "@/lib/api";

const FILTERS = ["", "imported", "needs_contact_review", "ready_to_invite", "invited", "invitation_expired", "onboarding_in_progress", "submitted", "needs_review", "activated"];

export default function LegacyClients() {
  const { api, run } = useDemo();
  const [summary, setSummary] = useState(null);
  const [page, setPage] = useState({ items: [], total: 0, invoicesMessage: "" });
  const [q, setQ] = useState("");
  const [status, setStatus] = useState("");
  const [selected, setSelected] = useState(null);
  const [error, setError] = useState("");

  const load = () => {
    api.legacySummary().then(setSummary).catch(() => setSummary(null));
    api.legacyPatients({ q, status, sort: "lastName", page: 1, pageSize: 25 }).then(setPage).catch((err) => setError(apiError(err)));
  };
  useEffect(() => { load(); }, [q, status]); // eslint-disable-line

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
        <p className="text-sm text-nb-mute">Imported patients stay separate from active accounts until onboarding links them. A legacy consent flag is not current consent.</p>
      </div>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3" data-testid="legacy-counts">
        {summary && Object.entries(summary.counts).filter(([, count]) => count).map(([key, count]) => (
          <button key={key} type="button" className="nb-card px-3 py-2 text-left text-sm" onClick={() => setStatus(key)}><span className="block text-lg font-semibold">{count}</span>{key.replaceAll("_", " ")}</button>
        ))}
      </div>
      <div className="flex flex-wrap gap-2">
        <input className="nb-input max-w-xs" placeholder="Search name, phone, or source id" value={q} onChange={(e) => setQ(e.target.value)} data-testid="legacy-search" />
        <select className="nb-input max-w-xs" value={status} onChange={(e) => setStatus(e.target.value)} data-testid="legacy-filter">
          {FILTERS.map((item) => <option key={item || "all"} value={item}>{item ? item.replaceAll("_", " ") : "All statuses"}</option>)}
        </select>
        <button type="button" className="nb-btn-primary h-12" data-testid="legacy-sample" onClick={async () => { await sample(); load(); }}>Stage a sample</button>
      </div>
      {error && <p className="text-sm text-rose-700">{error}</p>}
      <p className="text-sm text-nb-mute" data-testid="legacy-invoice-note">{page.invoicesMessage || summary?.invoicesMessage}</p>
      <ul className="space-y-2">
        {page.items.map((row) => (
          <li key={row.id}>
            <button type="button" className="nb-card flex w-full flex-wrap items-center justify-between gap-2 p-4 text-left text-sm" data-testid={`legacy-row-${row.sourceId}`} onClick={() => api.legacyPatient(row.id).then(setSelected)}>
              <span><b>{row.firstName} {row.lastName}</b><span className="mt-1 block text-nb-mute">{row.email || "No email"} · {row.phone || "No phone"} · {row.sourceId}</span></span>
              <span className="rounded-full bg-sky-50 px-3 py-1 text-xs">{row.status.replaceAll("_", " ")}{row.duplicateOf ? " · duplicate" : ""}{row.contactComplete ? "" : " · contact incomplete"}</span>
            </button>
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
          <button type="button" className="nb-btn-primary h-10" data-testid="legacy-invite" onClick={async () => { const sent = await run(() => api.legacyInvite(selected.id, {}), "Invitation prepared"); if (sent?.link) setSelected({ ...selected, link: sent.link, status: "invited" }); }}>Prepare invitation</button>
          {selected.link && <p className="break-all text-xs" data-testid="legacy-invite-link">{selected.link}</p>}
          <p>Legacy consent flag: {selected.legacyConsentSigned || "not recorded"}. It is not applied as treatment consent.</p>
          {selected.status !== "ready_to_invite" && <button type="button" className="nb-btn-ghost h-10" data-testid="legacy-mark-ready" onClick={async () => { const next = await api.legacyReview(selected.id, { status: "ready_to_invite" }); setSelected(next); load(); }}>Mark ready to invite</button>}
        </section>
      )}
    </div>
  );
}
