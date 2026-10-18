import { useState } from "react";
import { CheckCircle2, AlertCircle, FilePlus2 } from "lucide-react";
import { AppointmentSheet } from "@/components/AppointmentSheet";
import { CreateInvoiceDialog } from "@/components/CreateInvoiceDialog";
import { Counter, PayPill, Pill } from "@/components/ui-kit";
import { KpiCard, PageHeader, Segmented } from "@/components/ds";
import { InvoiceList } from "@/components/billing/InvoiceList";
import { useDemo } from "@/store/DemoStore";
import { money, fmtDate, fmtStamp, CLAIM_STATUS, paymentQueues } from "@/lib/domain";
import { formatCents } from "@/lib/billing";

function ReportPanel({ api, run, practitioners }) {
  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [half, setHalf] = useState(1);
  const [practitionerId, setPractitionerId] = useState("");
  const [report, setReport] = useState(null);
  const snap = report?.snapshot;
  return (
    <div className="nb-card space-y-3 p-5" data-testid="report-panel">
      <p className="font-semibold">Period report</p>
      <p className="text-xs text-nb-mute">The first period is the 1st through the 15th. The second period runs through the last day of the month. Figures come from stored appointments. An approved report keeps its snapshot.</p>
      <div className="flex flex-wrap gap-2">
        <input className="nb-input h-10 w-24" type="number" value={year} onChange={(e) => setYear(e.target.value)} data-testid="report-year" />
        <input className="nb-input h-10 w-20" type="number" min="1" max="12" value={month} onChange={(e) => setMonth(e.target.value)} data-testid="report-month" />
        <select className="nb-input h-10 w-auto" value={half} onChange={(e) => setHalf(Number(e.target.value))} data-testid="report-half"><option value={1}>1st–15th</option><option value={2}>16th–month end</option></select>
        <select className="nb-input h-10 w-auto" value={practitionerId} onChange={(e) => setPractitionerId(e.target.value)} data-testid="report-practitioner"><option value="">All practitioners</option>{practitioners.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select>
        <button type="button" className="nb-btn-primary h-10 px-4 text-sm" data-testid="report-generate" onClick={() => run(() => api.createReport({ year: Number(year), month: Number(month), half, practitionerId }), "Report draft ready").then(setReport)}>Generate</button>
      </div>
      {snap && <div className="text-sm" data-testid="report-snapshot"><p>{snap.start} to {snap.end} · {snap.count} visits</p><p>Invoiced {snap.invoiced} · collected {snap.collected} · outstanding {snap.outstanding}</p><p className="text-xs text-nb-mute">{snap.basis} Status: {report.status}. This is not a payroll or tax filing.</p></div>}
      {report?.status === "draft" && <button type="button" className="nb-btn-ghost h-10 px-4 text-sm" data-testid="report-approve" onClick={() => run(() => api.approveReport(report.id), "Report approved").then(setReport)}>Approve</button>}
      {report?.status === "approved" && <button type="button" className="nb-btn-ghost h-10 px-4 text-sm" data-testid="report-publish" onClick={() => run(() => api.publishReport(report.id), "Report published").then(setReport)}>Publish to the practitioner</button>}
      {report && <a className="text-sm font-semibold text-nb-blue" href={`${process.env.REACT_APP_BACKEND_URL}/api/reports/${report.id}/pdf`} data-testid="report-pdf">Download PDF</a>}
    </div>
  );
}

export default function Payments({ role = "owner" }) {
  const { state, idx, api, run } = useDemo();
  const [sel, setSel] = useState(null);
  const [createInvoice, setCreateInvoice] = useState(false);
  const [created, setCreated] = useState(null);
  const [tab, setTab] = useState("invoices");
  const [importFile, setImportFile] = useState(null);
  const [importReport, setImportReport] = useState(null);
  const appts = state.appointments.filter((a) => a.settle);
  const sum = (f) => appts.reduce((s, a) => s + f(a), 0);
  const tx = appts.flatMap((a) => (a.payments || []).map((p) => ({ ...p, appt: a }))).sort((a, b) => b.at.localeCompare(a.at));
  const receivable = appts.filter((a) => a.settle.insurancePending > 0);
  const outstanding = appts.filter((a) => a.settle.balance > 0 && ["completed", "processing", "closed"].includes(a.status));
  const queues = paymentQueues(appts);
  const follow = (title, rows, testid) => (
    <div data-testid={testid}>
      <p className="nb-label">{title}</p>
      {rows.map((a) => <button key={a.id} onClick={() => setSel(a.id)} data-testid={`${testid}-${a.id}`} className="nb-card mb-2 flex w-full items-center gap-3 p-4 text-left text-sm"><span className="flex-1">{a.ref} · {a.payNow === "cash" ? "Cash at the visit" : a.payNow === "deposit" ? "Deposit" : "Online payment"}</span><PayPill status={a.paymentDue?.status || a.paymentStatus} /><b>{a.paymentDue ? formatCents(a.paymentDue.remainingCents) : money(a.settle.balance)}</b></button>)}
      {!rows.length && <p className="text-sm text-nb-mute">None.</p>}
    </div>
  );
  const kpis = [["Card & cash collected", sum((a) => a.settle.clientPaid - a.settle.refunded), "kpi-collected-client"], ["Insurer payments received", sum((a) => a.settle.insuranceConfirmed), "kpi-insurer-paid"], ["Insurance receivables", sum((a) => a.settle.insurancePending), "kpi-receivables"], ["Client balances due", outstanding.reduce((s, a) => s + a.settle.payable, 0), "kpi-outstanding"]];
  return (
    <div className="min-w-0 space-y-6" data-testid={`${role}-payments`}>
      <PageHeader
        eyebrow="Billing"
        title="Invoices"
        accent="& payments"
        description="Every draft and issued invoice, its payments, and its balance. Amounts come from the server ledger."
        actions={(role === "owner" || role === "desk") && (
          <button type="button" className="nb-btn-primary h-10 px-4 text-sm" data-testid="payments-create-invoice" onClick={() => setCreateInvoice(true)}>
            <FilePlus2 className="h-4 w-4" />New invoice
          </button>
        )}
      />
      <Segmented options={[["invoices", "Invoices"], ["collections", "Collections"], ["ledger", "Transactions"], ...(role === "owner" ? [["reports", "Reports"], ["import", "Import"]] : [])]} value={tab} onChange={setTab} testid="payments-tab" label="Billing sections" />
      {tab === "invoices" && <InvoiceList key={created || "list"} role={role} focusId={created} emailOn={idx?.settings?.invoiceEmailEnabled === true} />}
      {tab === "collections" && <>
      <p className="text-xs text-nb-mute" data-testid="insurance-not-connected">Visit-based follow-up queues. Insurer direct billing is not connected; claims are recorded manually.</p>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">{kpis.map(([l, v, t]) => <KpiCard key={t} label={l} value={<Counter value={v} prefix="$" decimals={2} />} testid={t} />)}</div>
      <div className="grid gap-6 lg:grid-cols-3">
        {follow("Pending payment", queues.pending, "payment-pending")}
        {follow("Deposits and partial balances", queues.deposits, "payment-deposits")}
        {follow("Needs owner review", queues.review, "payment-review")}
      </div>
      <div className="grid gap-6 lg:grid-cols-2">
        <div><p className="nb-label">Insurance receivables</p>{receivable.map((a) => <button key={a.id} onClick={() => setSel(a.id)} data-testid={`receivable-${a.id}`} className="nb-card mb-2 flex w-full items-center gap-3 p-4 text-left text-sm"><span className="flex-1">{a.ref} · {idx.clients[a.clientId]?.firstName}</span><Pill tone={CLAIM_STATUS[a.claim.status].tone}>{CLAIM_STATUS[a.claim.status].label}</Pill><b>{money(a.settle.insurancePending)}</b></button>)}{!receivable.length && <p className="text-sm text-nb-mute">None pending.</p>}</div>
        <div><p className="nb-label">Outstanding client balances</p>{outstanding.map((a) => <button key={a.id} onClick={() => setSel(a.id)} data-testid={`outstanding-${a.id}`} className="nb-card mb-2 flex w-full items-center gap-3 p-4 text-left text-sm"><span className="flex-1">{a.ref} · {idx.clients[a.clientId]?.firstName} {idx.clients[a.clientId]?.lastName}</span><PayPill status={a.paymentStatus} /><b>{a.settle.awaiting ? "awaiting" : money(a.settle.payable)}</b></button>)}{!outstanding.length && <p className="text-sm text-nb-mute">All settled.</p>}</div>
      </div>
      </>}
      {tab === "ledger" && <>
      <div className="nb-panel overflow-x-auto p-5">
        <p className="mb-3 font-semibold">Transactions</p>
        <table className="w-full min-w-[640px] text-sm" data-testid="transactions-table"><thead><tr className="text-left text-xs text-nb-mute"><th className="py-2">When</th><th>Visit</th><th>Provider</th><th>Reference</th><th>Status</th><th className="text-right">Amount</th></tr></thead>
          <tbody>{tx.map((p) => <tr key={p.id} className="cursor-pointer border-t border-sky-50 hover:bg-sky-50/50" onClick={() => setSel(p.appt.id)}><td className="py-2 text-xs">{fmtStamp(p.at)}</td><td>{p.appt.ref}</td><td className="capitalize">{p.provider}</td><td className="font-mono text-[11px] text-nb-mute">{p.intentId || p.receipt}</td><td><Pill tone={{ succeeded: "green", failed: "red", pending: "cyan", refund_pending: "amber", refunded: "slate" }[p.status]}>{p.status.replace("_", " ")}</Pill></td><td className="text-right tabular-nums">{money(p.amount)}</td></tr>)}</tbody></table>
      </div>
      <div className="nb-card p-5" data-testid="reconciliation">
        <p className="mb-3 font-semibold">Reconciliation</p>
        <div className="space-y-1.5">{appts.filter((a) => ["processing", "closed", "completed"].includes(a.status)).map((a) => { const s = a.settle; const ok = Math.abs(s.total - s.insuranceConfirmed - (s.clientPaid - s.refunded) - s.balance) < 0.01 && s.overpaid === 0; return (
          <button key={a.id} onClick={() => setSel(a.id)} className="flex w-full items-center gap-3 rounded-xl p-2 text-left text-xs hover:bg-slate-50">{ok ? <CheckCircle2 className="h-4 w-4 text-nb-teal" /> : <AlertCircle className="h-4 w-4 text-amber-600" />}<span className="w-20 font-medium">{a.ref}</span><span className="flex-1 text-nb-mute">{fmtDate(a.date)} · total {money(s.total)} = insurer {money(s.insuranceConfirmed)} + client {money(s.clientPaid - s.refunded)} + balance {money(s.balance)}</span><PayPill status={a.paymentStatus} /></button>); })}</div>
        <p className="mt-3 text-[11px] text-nb-mute">Production: balances are server-calculated; card payments settle only on verified Stripe webhooks with idempotency keys.</p>
      </div>
      </>}
      {tab === "reports" && role === "owner" && <ReportPanel api={api} run={run} practitioners={state.practitioners} />}
      {tab === "import" && role === "owner" && <div className="nb-card space-y-3 p-5" data-testid="history-import">
        <p className="font-semibold">Historical import</p>
        <p className="text-xs text-nb-mute">CSV or XLSX. Imported payments stay in the past and are not charged again.</p>
        <input type="file" accept=".csv,.xlsx" data-testid="history-import-file" aria-label="Historical file" onChange={(e) => setImportFile(e.target.files?.[0] || null)} />
        <div className="flex flex-wrap gap-2">
          <button type="button" disabled={!importFile} onClick={() => run(async () => { const report = await api.previewImport(importFile); setImportReport(report); return report; }, "Preview ready")} data-testid="history-import-preview" className="nb-btn-ghost h-10 text-sm">Preview</button>
          <button type="button" disabled={!importFile} onClick={() => run(async () => { const report = await api.runImport(importFile); setImportReport(report); return report; }, "Import finished")} data-testid="history-import-run" className="nb-btn-primary h-10 text-sm">Import</button>
        </div>
        {importReport && <p className="text-sm" data-testid="history-import-report">{importReport.rows} rows · {importReport.errors?.length || 0} errors · {importReport.created ?? 0} created</p>}
      </div>}
      {sel && <AppointmentSheet apptId={sel} role={role} onClose={() => setSel(null)} />}
      {createInvoice && <CreateInvoiceDialog open onClose={(invoice) => { setCreateInvoice(false); if (invoice?.id) { setCreated(invoice.id); setTab("invoices"); } }} />}
    </div>
  );
}
