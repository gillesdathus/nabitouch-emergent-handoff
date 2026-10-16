import { DateField } from "@/components/DateField";
import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { ChevronLeft, ChevronRight, Download, FileSpreadsheet, Loader2 } from "lucide-react";
import { EmptyState, Notice, Reveal } from "@/components/tide";
import { api, apiError } from "@/lib/api";
import { downloadFile } from "@/lib/useInvoices";

const iso = (d) => d.toISOString().slice(0, 10);

export function presetRange(key) {
  // Business calendar is Edmonton; build "today" from it, not from the device or UTC.
  const [ty, tm, td] = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Edmonton" }).format(new Date()).split("-").map(Number);
  const now = new Date(Date.UTC(ty, tm - 1, td));
  const y = ty;
  const m = tm - 1;
  if (key === "last_month") return [iso(new Date(Date.UTC(y, m - 1, 1))), iso(new Date(Date.UTC(y, m, 0)))];
  if (key === "quarter") { const q = Math.floor(m / 3) * 3; return [iso(new Date(Date.UTC(y, q, 1))), iso(now)]; }
  if (key === "ytd") return [`${y}-01-01`, iso(now)];
  if (key === "half") return now.getUTCDate() <= 15 ? [iso(new Date(Date.UTC(y, m, 1))), iso(new Date(Date.UTC(y, m, 15)))] : [iso(new Date(Date.UTC(y, m, 16))), iso(new Date(Date.UTC(y, m + 1, 0)))];
  return [iso(new Date(Date.UTC(y, m, 1))), iso(now)];
}

export const PRESETS = [["month", "This month"], ["last_month", "Last month"], ["quarter", "Quarter"], ["ytd", "Year to date"]];

export function RangePicker({ range, setRange, presets = PRESETS }) {
  const [chosen, setChosen] = useState(() => presets.find(([k]) => { const [s, e] = presetRange(k); return s === range[0] && e === range[1]; })?.[0] || "");
  return (
    <div className="flex flex-wrap items-center gap-2" data-testid="report-range">
      <div className="flex flex-wrap gap-1 rounded-full bg-white p-1 ring-1 ring-sky-100">
        {presets.map(([k, l]) => { const [s, e] = presetRange(k); const on = chosen === k && range[0] === s && range[1] === e; return <button key={k} type="button" onClick={() => { setChosen(k); setRange([s, e]); }} data-testid={`report-preset-${k}`} className={`rounded-full px-3.5 py-1.5 text-xs font-medium transition-colors ${on ? "bg-nb-navy text-white" : "text-nb-mute hover:text-nb-ink"}`}>{l}</button>; })}
      </div>
      <DateField value={range[0]} max={range[1]} onChange={(v) => setRange([v, range[1]])} testid="report-start" />
      <span className="text-xs text-nb-mute">to</span>
      <DateField value={range[1]} min={range[0]} max={new Intl.DateTimeFormat("en-CA", { timeZone: "America/Edmonton" }).format(new Date())} onChange={(v) => setRange([range[0], v])} testid="report-end" />
    </div>
  );
}

function GroupBars({ group }) {
  const parse = (v) => Number(String(v).replace(/[^0-9.-]/g, "")) || 0;
  const valueCol = group.headers.length > 2 ? 2 : 1;
  const max = Math.max(1, ...group.rows.map((r) => Math.abs(parse(r[valueCol]))));
  return (
    <div className="nb-card p-5" data-testid={`report-group-${group.title.toLowerCase().replace(/\s/g, "-")}`}>
      <p className="nb-eyebrow mb-3">{group.title}</p>
      {group.rows.length === 0 && <p className="text-sm text-nb-mute">No records.</p>}
      <ul className="space-y-2.5">
        {group.rows.map((r) => (
          <li key={r[0]}>
            <div className="flex justify-between gap-3 text-sm"><span className="truncate">{r[0]}</span><span className="nb-num font-semibold">{r.slice(1).join(" · ")}</span></div>
            <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-sky-50"><div className="h-full rounded-full bg-gradient-to-r from-nb-blue via-nb-cyan to-nb-turq transition-[width] duration-700" style={{ width: `${(Math.abs(parse(r[valueCol])) / max) * 100}%` }} /></div>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function useReport(kind, range, practitionerId) {
  const [page, setPage] = useState(1);
  const [data, setData] = useState(undefined);
  const [error, setError] = useState("");
  const params = useMemo(() => ({ start: range[0], end: range[1], ...(practitionerId ? { practitionerId } : {}) }), [range, practitionerId]);
  const load = useCallback(() => {
    setData(undefined); setError("");
    api.financeReport(kind, { ...params, page, limit: 25 }).then(setData).catch((e) => { setError(apiError(e)); setData(null); });
  }, [kind, params, page]);
  useEffect(() => { setPage(1); }, [kind, params]);
  useEffect(() => { load(); }, [load]);
  return { data, error, page, setPage, params };
}

export function DownloadButtons({ kind, params, light }) {
  const [busy, setBusy] = useState("");
  const get = (format) => async () => {
    setBusy(format);
    try { await downloadFile(`/finance/reports/${kind}?${new URLSearchParams({ ...params, format })}`, `nabitouch-${kind}-${params.start}-${params.end}.${format}`); }
    catch { toast.error("The download could not be prepared."); }
    setBusy("");
  };
  return (
    <div className="flex gap-2">
      <button type="button" onClick={get("pdf")} disabled={Boolean(busy)} data-testid={`report-${kind}-pdf`} className="nb-btn-dark h-10 text-sm">{busy === "pdf" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}PDF</button>
      <button type="button" onClick={get("csv")} disabled={Boolean(busy)} data-testid={`report-${kind}-csv`} className={light ? "inline-flex h-10 items-center gap-2 rounded-full bg-white px-4 text-sm font-semibold text-nb-navy shadow-sm" : "nb-btn-ghost h-10 text-sm"}>{busy === "csv" ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileSpreadsheet className="h-4 w-4" />}CSV</button>
    </div>
  );
}

export function ReportBody({ report }) {
  const { data, error, page, setPage } = report;
  if (error) return <Notice testid="report-error">{error}</Notice>;
  if (data === undefined) return <div className="space-y-3"><div className="grid grid-cols-2 gap-3 lg:grid-cols-4">{[0, 1, 2, 3].map((n) => <div key={n} className="h-24 rounded-3xl nb-skeleton" />)}</div><div className="h-64 rounded-3xl nb-skeleton" /></div>;
  if (!data) return null;
  const pages = Math.max(1, Math.ceil(data.total / data.limit));
  return (
    <div className="space-y-6" data-testid={`report-body-${data.kind}`}>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-3 xl:grid-cols-6">
        {data.kpis.map((k, i) => (
          <Reveal key={k.label} i={i}><div className={`h-full rounded-3xl p-4 ${i === 0 ? "nb-lagoon text-white" : "nb-card"}`} data-testid={`report-kpi-${i}`}><p className={`text-[11px] ${i ? "text-nb-mute" : "text-white/75"}`}>{k.label}</p><p className="nb-num mt-1 text-xl font-semibold">{k.value}</p></div></Reveal>
        ))}
      </div>
      {data.groups.length > 0 && <div className="grid gap-4 lg:grid-cols-2">{data.groups.map((g) => <GroupBars key={g.title} group={g} />)}</div>}
      <div className="nb-card overflow-hidden" data-testid="report-detail">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] text-sm">
            <thead className="bg-nb-ice/60 text-left text-[11px] uppercase tracking-wider text-nb-mute"><tr>{data.headers.map((h, i) => <th key={h} className={`px-4 py-3 font-medium ${i >= data.headers.length - 3 ? "text-right" : ""}`}>{h}</th>)}</tr></thead>
            <tbody>{data.rows.map((r, n) => <tr key={n} className="border-t border-sky-50">{r.map((c, i) => <td key={i} className={`px-4 py-2.5 ${i >= r.length - 3 ? "nb-num text-right" : ""}`}>{c || "—"}</td>)}</tr>)}</tbody>
          </table>
        </div>
        {data.rows.length === 0 && <div className="p-6"><EmptyState title="No records in this period" testid="report-empty" /></div>}
        <div className="flex items-center justify-between border-t border-sky-50 px-4 py-3 text-xs text-nb-mute">
          <span data-testid="report-count">{data.total} rows</span>
          <span className="flex items-center gap-2"><button type="button" disabled={page <= 1} onClick={() => setPage(page - 1)} data-testid="report-prev" className="grid h-8 w-8 place-items-center rounded-full ring-1 ring-sky-100 disabled:opacity-40"><ChevronLeft className="h-4 w-4" /></button>Page {page} of {pages}<button type="button" disabled={page >= pages} onClick={() => setPage(page + 1)} data-testid="report-next" className="grid h-8 w-8 place-items-center rounded-full ring-1 ring-sky-100 disabled:opacity-40"><ChevronRight className="h-4 w-4" /></button></span>
        </div>
      </div>
      <p className="text-[11px] text-nb-mute" data-testid="report-basis">{data.basis}</p>
    </div>
  );
}
