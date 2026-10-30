import { useEffect, useMemo, useState } from "react";
import { useDemo } from "@/store/DemoStore";
import { apiError } from "@/lib/api";

const STATUS_FILTERS = [
  "", "imported", "needs_contact_review", "ready_to_invite", "invited",
  "invitation_expired", "onboarding_in_progress", "submitted", "needs_review", "activated",
];

const emptyPreview = () => ({
  ready: [], blocked: [], recipients: [], excluded: [], confirmCount: 0,
  requestedCount: 0, template: null, willSend: false,
});

function statusLabel(value) {
  return String(value || "").replaceAll("_", " ") || "—";
}

function InviteConfirmModal({
  mode, preview, busy, error, onClose, onConfirm,
}) {
  if (!preview) return null;
  const recipients = preview.recipients || [];
  const excluded = preview.excluded || [];
  const count = preview.confirmCount || recipients.length;
  const template = preview.template || {};
  const title = mode === "batch" ? "Confirm batch invitations" : "Confirm invitation";
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-slate-950/45 p-3 sm:items-center" data-testid="invite-confirm-modal" role="dialog" aria-modal="true">
      <div className="max-h-[92vh] w-full max-w-lg overflow-auto rounded-2xl bg-white p-5 shadow-xl">
        <p className="nb-eyebrow">Patients · Invitations</p>
        <h2 className="text-xl font-semibold tracking-tight">{title}</h2>
        <p className="mt-1 text-sm text-nb-mute">
          Account setup only. No clinical details and no marketing consent are included.
        </p>

        <div className="mt-4 space-y-3 text-sm">
          {recipients.map((row) => (
            <div key={row.id} className="rounded-xl border border-slate-200 px-3 py-3" data-testid={`invite-recipient-${row.id}`}>
              <p className="font-medium">{row.firstName} {row.lastName}</p>
              <p className="text-nb-mute">Destination: {row.destination || "—"}</p>
              <p className="text-nb-mute">Channel: {statusLabel(row.channel)}</p>
            </div>
          ))}
          {template.subject && (
            <div className="rounded-xl bg-slate-50 px-3 py-3" data-testid="invite-template-preview">
              <p className="text-xs uppercase tracking-wide text-nb-mute">Template preview</p>
              <p className="mt-1 font-medium">{template.subject}</p>
              <p className="mt-1 text-nb-mute">{template.previewText}</p>
            </div>
          )}
          {excluded.length > 0 && (
            <div className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-3" data-testid="invite-excluded">
              <p className="font-medium text-amber-950">{excluded.length} excluded</p>
              <ul className="mt-2 space-y-1 text-amber-900">
                {excluded.map((row) => (
                  <li key={row.id}>{row.firstName} {row.lastName || row.id} — {statusLabel(row.reason)}</li>
                ))}
              </ul>
            </div>
          )}
          <p className="font-medium" data-testid="invite-confirm-count">
            {count === 1 ? "1 invitation will be sent." : `${count} invitations will be sent.`}
          </p>
          {error && <p className="text-rose-700">{error}</p>}
        </div>

        <div className="mt-5 flex flex-wrap gap-2">
          <button type="button" className="nb-btn-ghost h-11" onClick={onClose} disabled={busy} data-testid="invite-cancel">Cancel</button>
          <button
            type="button"
            className="nb-btn-primary h-11"
            disabled={busy || count < 1}
            onClick={onConfirm}
            data-testid="invite-confirm-send"
          >
            {busy ? "Sending…" : count === 1 ? "Send invitation" : `Send ${count} invitations`}
          </button>
        </div>
      </div>
    </div>
  );
}

export default function LegacyClients() {
  const { api, run } = useDemo();
  const [summary, setSummary] = useState(null);
  const [page, setPage] = useState({ items: [], total: 0, page: 1, pageSize: 25, invoicesMessage: "" });
  const [invites, setInvites] = useState({ items: [], total: 0, openCount: 0, autoSendOnImport: false });
  const [q, setQ] = useState("");
  const [status, setStatus] = useState("");
  const [pageNum, setPageNum] = useState(1);
  const [selected, setSelected] = useState(null);
  const [selectedIds, setSelectedIds] = useState([]);
  const [error, setError] = useState("");
  const [tab, setTab] = useState("patients");
  const [modal, setModal] = useState(null);
  const [preview, setPreview] = useState(null);
  const [busy, setBusy] = useState(false);
  const [modalError, setModalError] = useState("");

  const selectedSet = useMemo(() => new Set(selectedIds), [selectedIds]);
  const pageIds = useMemo(() => page.items.map((row) => row.id), [page.items]);
  const pageSelectedCount = pageIds.filter((id) => selectedSet.has(id)).length;

  const load = () => {
    api.legacySummary().then(setSummary).catch(() => setSummary(null));
    api.legacyPatients({ q, status, sort: "lastName", page: pageNum, pageSize: 25 })
      .then(setPage)
      .catch((err) => setError(apiError(err)));
    api.legacyInvitations({})
      .then(setInvites)
      .catch(() => setInvites({ items: [], total: 0, openCount: 0, autoSendOnImport: false }));
  };

  useEffect(() => { load(); }, [q, status, pageNum]); // eslint-disable-line

  const toggleSelect = (id) => {
    setSelectedIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  };

  const clearSelection = () => setSelectedIds([]);

  const selectAllEligibleFiltered = async () => {
    setError("");
    try {
      const result = await api.legacyInviteEligible({ q, status });
      // Exact eligible set for the current filter — never silent expansion.
      setSelectedIds(result.ids || []);
    } catch (err) {
      setError(apiError(err));
    }
  };

  const openIndividualConfirm = async (row) => {
    setModalError("");
    setBusy(true);
    setError("");
    try {
      const detail = row.email || row.phone ? row : await api.legacyPatient(row.id);
      const next = await api.legacyInvitePreview([detail.id]);
      setPreview(next);
      setModal({ mode: "individual", ids: next.ready });
      setSelected(detail);
    } catch (err) {
      setError(apiError(err));
    } finally {
      setBusy(false);
    }
  };

  const openBatchConfirm = async () => {
    if (!selectedIds.length) return;
    setModalError("");
    setBusy(true);
    setError("");
    try {
      const next = await api.legacyInvitePreview(selectedIds);
      setPreview(next);
      setModal({ mode: "batch", ids: next.ready });
    } catch (err) {
      setError(apiError(err));
    } finally {
      setBusy(false);
    }
  };

  const confirmSend = async () => {
    const ids = modal?.ids || preview?.ready || [];
    if (!ids.length) return;
    setBusy(true);
    setModalError("");
    try {
      if (modal?.mode === "individual" && ids.length === 1) {
        await run(() => api.legacyInvite(ids[0], {}), "Invitation sent");
      } else {
        await run(() => api.legacyInvitationsSend(ids), "Invitations sent");
      }
      setModal(null);
      setPreview(null);
      setSelectedIds((prev) => prev.filter((id) => !ids.includes(id)));
      load();
    } catch (err) {
      setModalError(apiError(err));
    } finally {
      setBusy(false);
    }
  };

  const sample = () => run(() => api.legacyImport({
    backupConfirmed: true,
    authorize: true,
    records: [
      {
        id: `sample-${Date.now()}`,
        first_name: "Sample",
        last_name: "Client",
        email: "sample.legacy@example.com",
        phone: "7805550199",
        address: "10150 104 St NW, Edmonton, AB",
        source: "synthetic",
      },
    ],
  }), "Sample legacy record staged");

  return (
    <div className="mx-auto max-w-5xl space-y-5" data-testid="legacy-clients">
      <div>
        <p className="nb-eyebrow">Patients</p>
        <h1 className="text-2xl font-semibold tracking-tight">Invitations</h1>
        <p className="text-sm text-nb-mute">
          Manually invite imported patients to claim an account. Nothing is sent until you confirm each recipient set.
        </p>
      </div>

      <div className="flex flex-wrap gap-2" data-testid="invite-tabs">
        <button type="button" className={tab === "patients" ? "nb-btn-primary h-10" : "nb-btn-ghost h-10"} onClick={() => setTab("patients")} data-testid="invite-tab-patients">Patients</button>
        <button type="button" className={tab === "history" ? "nb-btn-primary h-10" : "nb-btn-ghost h-10"} onClick={() => setTab("history")} data-testid="invite-tab-history">Invitation status</button>
      </div>

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3" data-testid="legacy-counts">
        {summary && Object.entries(summary.counts).filter(([, count]) => count).map(([key, count]) => (
          <button key={key} type="button" className="nb-card px-3 py-2 text-left text-sm" onClick={() => { setStatus(key); setPageNum(1); setTab("patients"); }}>
            <span className="block text-lg font-semibold">{count}</span>{statusLabel(key)}
          </button>
        ))}
      </div>

      {tab === "history" && (
        <section className="nb-card space-y-3 p-4 text-sm" data-testid="legacy-invite-dashboard">
          <div>
            <h2 className="font-semibold">Invitation status</h2>
            <p className="text-nb-mute">
              {invites.openCount} open · {invites.total} recorded · auto-send on import: {invites.autoSendOnImport ? "on" : "off"}
            </p>
          </div>
          <ul className="max-h-96 space-y-2 overflow-auto">
            {invites.items.map((row) => (
              <li key={row.id} className="flex flex-wrap items-center justify-between gap-2 border-b border-sky-50 py-2" data-testid={`invite-history-${row.id}`}>
                <span>
                  <b>{row.firstName || "Patient"} {row.lastName || ""}</b>
                  <span className="mt-1 block text-xs text-nb-mute">
                    {row.delivery || "—"} · {statusLabel(row.channel)} · {row.createdBy || "—"} · {row.createdAt || ""}
                  </span>
                </span>
                <span className="flex items-center gap-2">
                  <span className="rounded-full bg-sky-50 px-3 py-1 text-xs">{statusLabel(row.outcome)}</span>
                  {row.outcome === "open" && (
                    <button
                      type="button"
                      className="nb-btn-ghost h-8 px-2"
                      data-testid={`legacy-revoke-${row.id}`}
                      onClick={async () => { await api.legacyInviteRevoke(row.id); load(); }}
                    >
                      Revoke
                    </button>
                  )}
                </span>
              </li>
            ))}
            {invites.items.length === 0 && <li className="text-nb-mute">No invitations yet.</li>}
          </ul>
        </section>
      )}

      {tab === "patients" && (
        <>
          <div className="flex flex-wrap gap-2">
            <input className="nb-input max-w-xs" placeholder="Search name, phone, or source id" value={q} onChange={(e) => { setQ(e.target.value); setPageNum(1); }} data-testid="legacy-search" />
            <select className="nb-input max-w-xs" value={status} onChange={(e) => { setStatus(e.target.value); setPageNum(1); }} data-testid="legacy-filter">
              {STATUS_FILTERS.map((item) => <option key={item || "all"} value={item}>{item ? statusLabel(item) : "All statuses"}</option>)}
            </select>
            <button type="button" className="nb-btn-ghost h-12" data-testid="legacy-sample" onClick={async () => { await sample(); load(); }}>Stage a sample</button>
          </div>

          <div className="nb-card flex flex-wrap items-center gap-2 p-3 text-sm" data-testid="invite-selection-bar">
            <span data-testid="invite-selection-count">{selectedIds.length} selected</span>
            <span className="text-nb-mute">· {pageSelectedCount} on this page</span>
            <button type="button" className="nb-btn-ghost h-10" data-testid="invite-select-eligible" onClick={selectAllEligibleFiltered}>Select all eligible in filter</button>
            <button type="button" className="nb-btn-ghost h-10" data-testid="invite-clear-selection" onClick={clearSelection} disabled={!selectedIds.length}>Clear selection</button>
            <button type="button" className="nb-btn-ghost h-10" data-testid="legacy-batch-preview" disabled={!selectedIds.length || busy} onClick={openBatchConfirm}>Preview selected</button>
            <button type="button" className="nb-btn-primary h-10" data-testid="legacy-batch-send" disabled={!selectedIds.length || busy} onClick={openBatchConfirm}>Send selected…</button>
          </div>

          {error && <p className="text-sm text-rose-700">{error}</p>}
          <p className="text-sm text-nb-mute" data-testid="legacy-invoice-note">{page.invoicesMessage || summary?.invoicesMessage}</p>

          <ul className="space-y-2">
            {page.items.map((row) => {
              const eligible = !row.duplicateOf && !row.clientId && row.contactComplete
                && !["requires_identity_reconciliation", "requires_contact_verification"].includes(row.invitationReadiness)
                && ["imported", "ready_to_invite", "invitation_expired", "invited"].includes(row.status);
              return (
                <li key={row.id}>
                  <div className="nb-card flex w-full flex-wrap items-center gap-2 p-4 text-sm">
                    <input
                      type="checkbox"
                      checked={selectedSet.has(row.id)}
                      onChange={() => toggleSelect(row.id)}
                      data-testid={`legacy-select-${row.sourceId}`}
                      aria-label={`Select ${row.firstName} ${row.lastName}`}
                    />
                    <button
                      type="button"
                      className="flex min-w-0 flex-1 flex-wrap items-center justify-between gap-2 text-left"
                      data-testid={`legacy-row-${row.sourceId}`}
                      onClick={() => api.legacyPatient(row.id).then(setSelected)}
                    >
                      <span>
                        <b>{row.firstName} {row.lastName}</b>
                        <span className="mt-1 block text-nb-mute">{row.email || "No email"} · {row.phone || "No phone"} · {row.sourceId}</span>
                      </span>
                      <span className="rounded-full bg-sky-50 px-3 py-1 text-xs">
                        {statusLabel(row.status)}
                        {row.duplicateOf ? " · duplicate" : ""}
                        {row.invitationReadiness ? ` · ${statusLabel(row.invitationReadiness)}` : ""}
                        {row.contactComplete ? "" : " · contact incomplete"}
                        {row.clientId ? " · activated" : ""}
                      </span>
                    </button>
                    <button
                      type="button"
                      className="nb-btn-primary h-10"
                      data-testid={`legacy-invite-row-${row.sourceId}`}
                      disabled={!eligible || busy}
                      onClick={() => openIndividualConfirm(row)}
                    >
                      {row.status === "invited" || row.status === "invitation_expired" ? "Resend" : "Invite"}
                    </button>
                  </div>
                </li>
              );
            })}
            {page.items.length === 0 && <li className="text-sm text-nb-mute">No patient records in this view.</li>}
          </ul>

          <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
            <p className="text-xs text-nb-mute" data-testid="legacy-total">{page.total} record{page.total === 1 ? "" : "s"}</p>
            <div className="flex gap-2">
              <button type="button" className="nb-btn-ghost h-10" disabled={pageNum <= 1} onClick={() => setPageNum((n) => Math.max(1, n - 1))} data-testid="invite-page-prev">Previous</button>
              <span className="self-center text-nb-mute">Page {page.page || pageNum}</span>
              <button type="button" className="nb-btn-ghost h-10" disabled={(page.page || pageNum) * (page.pageSize || 25) >= page.total} onClick={() => setPageNum((n) => n + 1)} data-testid="invite-page-next">Next</button>
            </div>
          </div>

          {selected && (
            <section className="nb-card space-y-2 p-5 text-sm" data-testid="legacy-detail">
              <h2 className="font-semibold">{selected.firstName} {selected.lastName}</h2>
              <p>Source {selected.sourceId} · batch {selected.batchId}</p>
              <p>{selected.address || "No postal address on the source record"}</p>
              <p data-testid="legacy-detail-invoices">
                {selected.invoices?.length
                  ? `${selected.invoices.length} historical invoice${selected.invoices.length === 1 ? "" : "s"}`
                  : selected.invoicesMessage}
              </p>
              <p>Linked account: {selected.clientId || "Not linked"}</p>
              <p>Invitation readiness: {statusLabel(selected.invitationReadiness || "not set")}</p>
              <div className="flex flex-wrap gap-2">
                <button type="button" className="nb-btn-primary h-10" data-testid="legacy-invite" onClick={() => openIndividualConfirm(selected)}>
                  {selected.status === "invited" || selected.status === "invitation_expired" ? "Resend invitation…" : "Invite…"}
                </button>
                {selected.status !== "ready_to_invite" && !selected.clientId && (
                  <button
                    type="button"
                    className="nb-btn-ghost h-10"
                    data-testid="legacy-mark-ready"
                    onClick={async () => {
                      const next = await api.legacyReview(selected.id, { status: "ready_to_invite" });
                      setSelected(next);
                      load();
                    }}
                  >
                    Mark ready to invite
                  </button>
                )}
              </div>
              <p className="text-nb-mute">Legacy consent flag: {selected.legacyConsentSigned || "not recorded"}. It is not applied as treatment consent or marketing consent.</p>
            </section>
          )}
        </>
      )}

      {modal && (
        <InviteConfirmModal
          mode={modal.mode}
          preview={preview || emptyPreview()}
          busy={busy}
          error={modalError}
          onClose={() => { if (!busy) { setModal(null); setPreview(null); setModalError(""); } }}
          onConfirm={confirmSend}
        />
      )}
    </div>
  );
}
