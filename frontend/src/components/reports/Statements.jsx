import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { CheckCircle2, Download, FileText, Loader2, Trash2 } from "lucide-react";
import { EmptyState } from "@/components/tide";
import { Pill } from "@/components/ui-kit";
import { RangePicker, presetRange } from "@/components/reports/ReportView";
import { api, apiError } from "@/lib/api";
import { downloadFile } from "@/lib/useInvoices";

export function StatementRow({ s, owner, onChange }) {
  const [busy, setBusy] = useState("");
  const act = (what, fn, msg) => async () => { setBusy(what); try { await fn(); if (msg) toast.success(msg); onChange?.(); } catch (e) { toast.error(apiError(e) || "That did not work."); } setBusy(""); };
  return (
    <div className="nb-card flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:gap-4" data-testid={`statement-${s.id}`}>
      <span className="hidden h-11 w-11 shrink-0 place-items-center rounded-2xl tint-lagoon sm:grid"><FileText className="h-5 w-5 text-nb-blue" /></span>
      <div className="min-w-0 flex-1">
        <p className="flex items-center gap-2 text-sm font-semibold">{owner ? s.practitionerName : "Statement"}<Pill tone={s.status === "approved" ? "teal" : "amber"}>{s.status === "approved" ? "Approved" : "Draft"}</Pill></p>
        <p className="text-xs text-nb-mute">{s.start} → {s.end} · {s.rule}{s.approvedAt ? ` · approved ${new Date(s.approvedAt).toLocaleDateString("en-CA")}` : ""}</p>
      </div>
      <p className="nb-num text-lg font-semibold" data-testid={`statement-${s.id}-pay`}>{s.kpis?.[0]?.[1]}</p>
      <div className="flex gap-2">
        <button type="button" onClick={act("pdf", () => downloadFile(`/finance/statements/${s.id}/pdf`, `statement-${s.start}-${s.end}.pdf`))} disabled={Boolean(busy)} className="nb-btn-ghost h-9 px-3 text-xs" data-testid={`statement-${s.id}-pdf`}>{busy === "pdf" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" />}PDF</button>
        {owner && s.status === "draft" && <button type="button" onClick={act("approve", () => api.approveStatement(s.id), "Approved. The practitioner can download it now.")} disabled={Boolean(busy)} className="nb-btn-primary h-9 px-3 text-xs" data-testid={`statement-${s.id}-approve`}><CheckCircle2 className="h-3.5 w-3.5" />Approve</button>}
        {owner && s.status === "draft" && <button type="button" aria-label="Delete draft" onClick={act("del", () => api.deleteStatement(s.id), "Draft deleted")} disabled={Boolean(busy)} className="grid h-9 w-9 place-items-center rounded-full ring-1 ring-sky-100" data-testid={`statement-${s.id}-delete`}><Trash2 className="h-3.5 w-3.5 text-nb-mute" /></button>}
      </div>
    </div>
  );
}

export function Statements({ practitioners }) {
  const [rows, setRows] = useState(undefined);
  const [range, setRange] = useState(presetRange("half"));
  const [pid, setPid] = useState("all");
  const [busy, setBusy] = useState(false);
  const load = useCallback(() => api.statements().then(setRows).catch(() => setRows([])), []);
  useEffect(() => { load(); }, [load]);
  const generate = async () => {
    setBusy(true);
    try { const made = await api.createStatements({ start: range[0], end: range[1], practitionerId: pid }); toast.success(`${made.length} draft statement${made.length > 1 ? "s" : ""} generated`); load(); }
    catch (e) { toast.error(apiError(e)); }
    setBusy(false);
  };
  return (
    <section className="space-y-4" data-testid="statements">
      <div className="nb-card space-y-3 p-5">
        <p className="nb-eyebrow">Generate practitioner statements</p>
        <div className="flex flex-wrap items-center gap-2">
          <RangePicker range={range} setRange={setRange} presets={[["half", "This pay period"], ["month", "This month"], ["last_month", "Last month"]]} />
          <select value={pid} onChange={(e) => setPid(e.target.value)} className="nb-input h-9 w-auto text-xs" data-testid="statement-practitioner"><option value="all">All practitioners</option>{practitioners.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select>
          <button type="button" onClick={generate} disabled={busy} className="nb-btn-primary h-9 px-4 text-xs" data-testid="statement-generate">{busy && <Loader2 className="h-3.5 w-3.5 animate-spin" />}Generate drafts</button>
        </div>
        <p className="text-xs text-nb-mute">Drafts are private. Approving one makes it downloadable by that practitioner right away.</p>
      </div>
      {rows === undefined && <div className="h-24 rounded-3xl nb-skeleton" />}
      {rows?.length === 0 && <EmptyState icon={FileText} title="No statements yet" body="Generate drafts for a pay period, review them, then approve." testid="statements-empty" />}
      {rows?.map((s) => <StatementRow key={s.id} s={s} owner onChange={load} />)}
    </section>
  );
}
