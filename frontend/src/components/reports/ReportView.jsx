import { DateField } from "@/components/DateField";
import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { ChevronLeft, ChevronRight, Download, FileSpreadsheet, Loader2 } from "lucide-react";
import { EmptyState, Notice } from "@/components/tide";
import { KpiCard } from "@/components/ds";
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
    <div className="flex min-w-0 flex-wrap items-center gap-2" data-testid="report-range">
      <div className="nb-seg flex-wrap rounded-2xl">
        {presets.map(([k, l]) => { const [s, e] = presetRange(k); const on = chosen === k && range[0] === s && range[1] === e; return <button key={k} type="button" onClick={() => { setChosen(k); setRange([s, e]); }} data-testid={`report-preset-${k}`} aria-pressed={on} className="nb-seg-btn">{l}</button>; })}
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
    <div className="nb-panel min-w-0 p-4 sm:p-5" data-testid={`report-group-${group.title.toLowerCase().replace(/\s/g, "-")}`}>
      <p className="nb-eyebrow mb-3">{group.title}</p>
      {group.rows.length === 0 && <p className="text-sm text-nb-mute">No records.</p>}
      <ul className="space-y-2.5">
        {group.rows.map((r) => (
          <li key={r[0]}>
            <div className="flex min-w-0 justify-between gap-3 text-sm"><span className="min-w-0 truncate">{r[0]}</span><span className="nb-num shrink-0 text-right font-semibold">{r.slice(1).join(" · ")}</span></div>
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

function DetailCards({ headers, rows }) {
  return (
    <ul className="divide-y divide-sky-50 md:hidden" data-testid="report-cards">
      {rows.map((r, n) => (
        <li key={n} className="px-4 py-3" data-testid={`report-card-${n}`}>
          <div className="flex min-w-0 items-baseline justify-between gap-3"><p className="min-w-0 truncate text-sm font-semibold">{r[0] || "—"}</p><p className="nb-num shrink-0 text-sm font-semibold" title={headers[headers.length - 1]}>{r[r.length - 1] || "—"}</p></div>
          <dl className="mt-1.5 grid grid-cols-2 gap-x-3 gap-y-1 text-xs">
            {headers.slice(1, -1).map((h, i) => <div key={h} className="min-w-0"><dt className="text-[10px] uppercase tracking-wider text-nb-mute">{h}</dt><dd className="truncate">{r[i + 1] || "—"}</dd></div>)}
          </dl>
        </li>
      ))}
    </ul>
  );
}

function DetailTable({ headers, rows }) {
  const right = (i) => i >= headers.length - 3;
  return (
    <div className="hidden max-h-[60dvh] overflow-auto md:block">
      <table className="w-full min-w-[640px] text-sm" data-testid="report-table">
        <thead className="sticky top-0 z-10 bg-[#F1F8FB] text-left"><tr>{headers.map((h, i) => <th key={h} className={`nb-th ${i === 0 ? "sticky left-0 bg-[#F1F8FB]" : ""} ${right(i) ? "text-right" : ""}`}>{h}</th>)}</tr></thead>
        <tbody>{rows.map((r, n) => <tr key={n} className="border-t border-sky-50 hover:bg-sky-50/50">{r.map((c, i) => <td key={i} className={`nb-td whitespace-nowrap ${i === 0 ? "sticky left-0 bg-white font-medium" : ""} ${right(i) ? "nb-num text-right" : ""}`}>{c || "—"}</td>)}</tr>)}</tbody>
      </table>
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
    <div className="min-w-0 space-y-5" data-testid={`report-body-${data.kind}`}>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        {data.kpis.map((k, i) => <KpiCard key={k.label} label={k.label} value={k.value} tone={i === 0 ? "good" : "default"} testid={`report-kpi-${i}`} />)}
      </div>
      {data.groups.length > 0 && <div className="grid gap-4 lg:grid-cols-2">{data.groups.map((g) => <GroupBars key={g.title} group={g} />)}</div>}
      <div className="nb-panel overflow-hidden" data-testid="report-detail">
        <div className="flex items-center justify-between gap-2 border-b border-sky-50 px-4 py-3"><p className="text-sm font-semibold">Detail</p><span className="text-xs text-nb-mute" data-testid="report-count">{data.total} row{data.total === 1 ? "" : "s"}</span></div>
        {data.rows.length > 0 && <><DetailCards headers={data.headers} rows={data.rows} /><DetailTable headers={data.headers} rows={data.rows} /></>}
        {data.rows.length === 0 && <div className="p-6"><EmptyState title="No records in this period" testid="report-empty" /></div>}
        {pages > 1 && (
          <div className="flex items-center justify-end border-t border-sky-50 px-4 py-3 text-xs text-nb-mute">
            <span className="flex items-center gap-2"><button type="button" aria-label="Previous page" disabled={page <= 1} onClick={() => setPage(page - 1)} data-testid="report-prev" className="grid h-9 w-9 place-items-center rounded-full ring-1 ring-sky-100 disabled:opacity-40"><ChevronLeft className="h-4 w-4" /></button>Page {page} of {pages}<button type="button" aria-label="Next page" disabled={page >= pages} onClick={() => setPage(page + 1)} data-testid="report-next" className="grid h-9 w-9 place-items-center rounded-full ring-1 ring-sky-100 disabled:opacity-40"><ChevronRight className="h-4 w-4" /></button></span>
          </div>
        )}
      </div>
      <p className="text-[11px] text-nb-mute" data-testid="report-basis">{data.basis}</p>
    </div>
  );
}
