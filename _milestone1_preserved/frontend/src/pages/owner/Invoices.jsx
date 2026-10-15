import { useState } from "react";
import { useSearchParams } from "react-router-dom";
import { Share2, FileDown, Banknote, ChevronLeft, ChevronRight, CheckCircle2 } from "lucide-react";
import { toast } from "sonner";
import { usePreview } from "@/store/PreviewStore";
import { PageHeader, Segmented, PayPill, BottomSheet, Row, Notice, Stepper, Avatar, Reveal, CountUp, EmptyState, Pill } from "@/components/ui-kit";
import { TopIcons } from "@/components/shells";
import { money, fmtDate } from "@/lib/domain";

function InvoiceSheet({ a, onClose }) {
  const { svc, cli, pro, openAppt } = usePreview();
  if (!a) return <BottomSheet open={false} onOpenChange={onClose} title="" testid="invoice-sheet" />;
  const c = cli(a.clientId);
  return (
    <BottomSheet open onOpenChange={(o) => !o && onClose()} testid="invoice-sheet" title="Invoice details" sub={`INV-${a.id.toUpperCase()}`}
      footer={<div className="flex gap-2"><button data-testid="invoice-pdf-btn" onClick={() => toast("PDF export is not connected in this preview")} className="nb-btn-ghost flex-1"><FileDown className="h-4 w-4" />PDF</button>{a.settle.balance > 0 && <button data-testid="invoice-record-cash" onClick={() => { onClose(); openAppt(a.id); }} className="nb-btn-primary flex-1"><Banknote className="h-4 w-4" />Record cash</button>}</div>}>
      <div className="flex items-center gap-2 mb-1"><p className="text-xl font-semibold">{c.name}</p><PayPill pay={a.pay} /></div>
      <div className="rounded-3xl tint-ice p-4 mt-3"><p className="text-xs text-nb-mute">Amount due</p><p data-testid="invoice-amount-due" className="text-4xl font-semibold text-nb-blue nb-num">{money(a.settle.balance)}</p></div>
      <div className="grid grid-cols-2 gap-3 mt-4 text-sm"><div><p className="text-xs text-nb-mute">Visit date</p><p className="font-medium">{fmtDate(a.date, { month: "short", day: "numeric", year: "numeric" })}</p></div><div><p className="text-xs text-nb-mute">Practitioner</p><p className="font-medium">{pro(a.practitionerId).name}</p></div></div>
      <div className="flex items-center gap-3 mt-4 rounded-2xl ring-1 ring-sky-100 p-3"><Avatar name={c.name} size={40} /><div><p className="text-sm font-semibold">{c.name}</p><p className="text-xs text-nb-mute">{c.email}</p></div></div>
      <p className="nb-eyebrow mt-5 mb-1">Items</p>
      <Row label={`${svc(a.serviceId).name} · ${a.duration} min`} value={money(a.pricing.price)} />
      <Row label="Travel (zone fee)" value={money(a.pricing.travel)} />
      <Row label="GST 5%" value={money(a.pricing.tax)} />
      <Row label="Total" value={money(a.pricing.total)} strong className="border-t border-dashed border-sky-100 mt-1 pt-3" />
      <Row label="Paid" value={money(a.settle.clientPaid)} />
      {a.settle.tip > 0 && <Row label="Tip (to practitioner)" value={money(a.settle.tip)} />}
      <Notice className="mt-4">Insurer claim submission is not connected. Clients receive a receipt to submit themselves.</Notice>
    </BottomSheet>
  );
}

function Reports() {
  const { db, pro, api } = usePreview();
  const [ym, setYm] = useState([2026, 10]);
  const [half, setHalf] = useState("1");
  const list = db.reports.filter((r) => r.year === ym[0] && r.month === ym[1] && r.half === +half);
  const shift = (n) => setYm(([y, m]) => { const d = new Date(y, m - 1 + n); return [d.getFullYear(), d.getMonth() + 1]; });
  const last = new Date(ym[0], ym[1], 0).getDate();
  const STEPS = ["draft", "approved", "published"];
  const generate = () => db.practitioners.filter((p) => p.bookable).forEach((p) => !list.some((r) => r.practitionerId === p.id) && api.create("reports", { id: `r${p.id}${Date.now()}`, practitionerId: p.id, year: ym[0], month: ym[1], half: +half, status: "draft", visits: 0, gross: 0 }, null));
  return (
    <div>
      <div className="nb-card p-4 flex items-center gap-3 mb-4">
        <button data-testid="report-prev" onClick={() => shift(-1)} className="h-10 w-10 grid place-items-center rounded-full bg-sky-50"><ChevronLeft className="h-4 w-4" /></button>
        <p className="flex-1 text-center font-semibold">{new Date(ym[0], ym[1] - 1).toLocaleDateString("en-CA", { month: "long", year: "numeric" })}</p>
        <button data-testid="report-next" onClick={() => shift(1)} className="h-10 w-10 grid place-items-center rounded-full bg-sky-50"><ChevronRight className="h-4 w-4" /></button>
      </div>
      <Segmented testid="report-half" value={half} onChange={setHalf} options={[{ value: "1", label: "1st – 15th" }, { value: "2", label: `16th – ${last}th` }]} className="mb-4" />
      {list.length === 0 ? <EmptyState title="No statements for this period" body="Generate drafts from completed visits." action={<button data-testid="generate-reports" onClick={generate} className="nb-btn-primary">Generate drafts</button>} /> : (
        <div className="grid sm:grid-cols-2 gap-3">
          {list.map((r) => { const p = pro(r.practitionerId); const i = STEPS.indexOf(r.status); return (
            <div key={r.id} data-testid={`report-card-${r.id}`} className="nb-card p-4">
              <div className="flex items-center gap-3 mb-4"><Avatar src={p.photo} name={p.name} size={40} /><div className="flex-1"><p className="font-semibold text-sm">{p.name}</p><p className="text-xs text-nb-mute">{r.visits} visits · {money(r.gross)}</p></div></div>
              <Stepper steps={["Draft", "Approved", "Published"]} current={r.status === "published" ? 3 : i} testid={`report-stepper-${r.id}`} />
              <div className="mt-4 flex gap-2">
                {r.status === "draft" && <button data-testid={`report-approve-${r.id}`} onClick={() => api.save("reports", r.id, { status: "approved" }, "Report approved")} className="nb-btn-dark flex-1 h-10 text-sm">Approve</button>}
                {r.status === "approved" && <button data-testid={`report-publish-${r.id}`} onClick={() => api.save("reports", r.id, { status: "published" }, "Published to practitioner")} className="nb-btn-primary flex-1 h-10 text-sm">Publish</button>}
                <button data-testid={`report-pdf-${r.id}`} disabled={r.status !== "published"} onClick={() => toast("PDF export is not connected in this preview")} className="nb-btn-ghost flex-1 h-10 text-sm"><FileDown className="h-4 w-4" />PDF</button>
              </div>
            </div>
          ); })}
        </div>
      )}
      <Notice className="mt-4">Statements are drafts until approved and published. A PDF is not a payroll or tax filing.</Notice>
    </div>
  );
}

export default function Invoices() {
  const { db, cli, svc } = usePreview();
  const [sp] = useSearchParams();
  const [tab, setTab] = useState("invoices");
  const [filter, setFilter] = useState(sp.get("filter") || "all");
  const [open, setOpen] = useState(null);
  const all = db.appointments.filter((a) => a.status !== "cancelled").sort((x, y) => y.date.localeCompare(x.date));
  const list = all.filter((a) => filter === "all" || a.pay === filter);
  const due = all.filter((a) => a.status === "completed").reduce((s, a) => s + a.settle.balance, 0);
  const paid = all.reduce((s, a) => s + a.settle.clientPaid, 0);
  return (
    <div className="max-w-5xl mx-auto px-5 pt-12 lg:pt-14">
      <PageHeader title="Invoices" sub="Visit ledger and half-month statements" right={<TopIcons base="/owner" />} />
      <Segmented testid="invoice-tabs" value={tab} onChange={setTab} options={[{ value: "invoices", label: "Ledger" }, { value: "reports", label: "Statements" }]} className="mb-5" />
      {tab === "reports" ? <Reports /> : (
        <>
          <div className="grid grid-cols-2 gap-3 mb-5">
            <div className="rounded-[28px] nb-tide text-white p-4"><p className="text-xs text-white/60">Outstanding</p><p className="text-2xl font-semibold"><CountUp value={due} format={money} /></p></div>
            <div className="rounded-[28px] tint-mint p-4"><p className="text-xs text-nb-mute">Collected</p><p className="text-2xl font-semibold"><CountUp value={paid} format={money} /></p></div>
          </div>
          <Segmented testid="invoice-filter" value={filter} onChange={setFilter} options={[{ value: "all", label: "All" }, { value: "paid", label: "Paid" }, { value: "partial", label: "Partial" }, { value: "unpaid", label: "Unpaid" }]} className="mb-4" />
          <div className="nb-card divide-y divide-sky-100">
            {list.length === 0 && <EmptyState icon={CheckCircle2} title="Nothing here" />}
            {list.map((a, i) => (
              <Reveal key={a.id} i={Math.min(i, 8)}>
                <button data-testid={`invoice-row-${a.id}`} onClick={() => setOpen(a.id)} className="w-full flex items-center gap-3 px-4 py-3.5 text-left hover:bg-sky-50/50 transition-colors">
                  <div className="flex-1 min-w-0"><p className="text-sm font-semibold truncate">{cli(a.clientId).name}</p><p className="text-xs text-nb-mute truncate">INV-{a.id.toUpperCase()} · {svc(a.serviceId).name} · {fmtDate(a.date, { month: "short", day: "numeric" })}</p></div>
                  <div className="text-right"><p className="text-sm font-semibold nb-num">{money(a.pricing.total)}</p><PayPill pay={a.pay} className="mt-1" /></div>
                </button>
              </Reveal>
            ))}
          </div>
          <Notice className="mt-4" icon={Share2}>Unpaid future visits are not overdue. Cash becomes paid only when recorded.</Notice>
        </>
      )}
      <InvoiceSheet a={db.appointments.find((x) => x.id === open)} onClose={() => setOpen(null)} />
      <span className="hidden"><Pill /></span>
    </div>
  );
}
