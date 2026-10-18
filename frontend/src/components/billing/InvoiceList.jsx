import { useMemo, useState } from "react";
import { FileText, ReceiptText } from "lucide-react";
import { InvoiceDrawer } from "@/components/billing/InvoiceDrawer";
import { InvoiceStatePill } from "@/components/billing/InvoiceBits";
import { EmptyState, ErrorState, KpiCard, Panel, SearchField, Segmented, SkeletonRows } from "@/components/ds";
import { formatCents } from "@/lib/billing";
import { fmtDate } from "@/lib/domain";
import { sumInvoices, useInvoices } from "@/lib/useInvoices";

const FILTERS = [["all", "All"], ["open", "Outstanding"], ["draft", "Drafts"], ["issued", "Issued"], ["partially_paid", "Partly paid"], ["paid", "Paid"], ["voided", "Voided"]];

function matches(row, filter, q) {
  if (filter === "open" && !(row.balance?.cents > 0 && !["draft", "voided"].includes(row.state))) return false;
  if (!["all", "open"].includes(filter) && row.state !== filter) return false;
  if (!q) return true;
  return [row.number, row.clientName, row.service, row.practitionerName].filter(Boolean).join(" ").toLowerCase().includes(q);
}

function InvoiceCard({ row, onOpen }) {
  return (
    <button type="button" onClick={() => onOpen(row.id)} className="nb-row items-start ring-1 ring-sky-100" data-testid={`invoice-row-${row.id}`}>
      <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl tint-ice"><FileText className="h-4 w-4 text-nb-blue" aria-hidden="true" /></span>
      <span className="min-w-0 flex-1">
        <span className="flex min-w-0 items-center justify-between gap-2"><span className="truncate text-sm font-semibold">{row.number || "Draft"}</span><span className="nb-num shrink-0 text-sm font-semibold">{row.state === "draft" ? row.total.display : row.balance.display}</span></span>
        <span className="block truncate text-xs text-nb-mute">{row.clientName || "Client"} · {row.service}</span>
        <span className="mt-1 flex items-center justify-between gap-2 text-[11px] text-nb-mute"><span>{row.serviceDate ? fmtDate(row.serviceDate) : "—"} · total {row.total.display}</span><InvoiceStatePill invoice={row} /></span>
      </span>
    </button>
  );
}

function InvoiceTable({ rows, onOpen }) {
  return (
    <div className="-mx-1 overflow-x-auto px-1">
      <table className="w-full min-w-[760px]" data-testid="invoice-table">
        <thead><tr className="border-b border-sky-100"><th className="nb-th">Invoice</th><th className="nb-th">Client</th><th className="nb-th">Service</th><th className="nb-th">Service date</th><th className="nb-th">Status</th><th className="nb-th text-right">Total</th><th className="nb-th text-right">Paid</th><th className="nb-th text-right">Balance</th></tr></thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.id} tabIndex={0} onClick={() => onOpen(row.id)} onKeyDown={(e) => e.key === "Enter" && onOpen(row.id)} className="cursor-pointer border-b border-sky-50 transition-colors hover:bg-sky-50/60 focus-visible:bg-sky-50" data-testid={`invoice-row-${row.id}`}>
              <td className="nb-td font-semibold">{row.number || <span className="text-nb-mute">Draft</span>}</td>
              <td className="nb-td max-w-[180px] truncate">{row.clientName || "—"}</td>
              <td className="nb-td max-w-[220px] truncate text-nb-mute">{row.service}</td>
              <td className="nb-td whitespace-nowrap text-nb-mute">{row.serviceDate ? fmtDate(row.serviceDate, { month: "short", day: "numeric", year: "numeric" }) : "—"}</td>
              <td className="nb-td"><InvoiceStatePill invoice={row} /></td>
              <td className="nb-td nb-num text-right">{row.total.display}</td>
              <td className="nb-td nb-num text-right text-nb-mute">{formatCents((row.clientPaid?.cents || 0) + (row.insuranceReceived?.cents || 0))}</td>
              <td className="nb-td nb-num text-right font-semibold">{row.state === "draft" ? <span className="font-normal text-nb-mute">Not issued</span> : row.balance.display}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function InvoiceList({ role = "owner", emailOn = false, focusId = null }) {
  const { rows, error, reload, replace } = useInvoices({}, true, true);
  const [filter, setFilter] = useState("all");
  const [query, setQuery] = useState("");
  const [openId, setOpenId] = useState(focusId);
  const q = query.trim().toLowerCase();
  const shown = useMemo(() => (rows || []).filter((row) => matches(row, filter, q)), [rows, filter, q]);
  const totals = sumInvoices(rows);
  const drafts = (rows || []).filter((row) => row.state === "draft").length;
  const active = (rows || []).find((row) => row.id === openId) || null;
  return (
    <div className="space-y-4" data-testid="invoice-list">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <KpiCard label="Outstanding balance" value={formatCents(totals.balance)} sub={`${totals.open} issued invoice${totals.open === 1 ? "" : "s"} with a balance`} tone={totals.balance > 0 ? "warn" : "default"} testid="inv-kpi-outstanding" />
        <KpiCard label="Client payments" value={formatCents(totals.clientPaid)} sub="Card, cash, e-Transfer on issued invoices" testid="inv-kpi-client" />
        <KpiCard label="Insurance received" value={formatCents(totals.insuranceReceived)} sub={`${formatCents(totals.insurancePending)} expected, not yet received`} testid="inv-kpi-insurance" />
        <KpiCard label="Drafts" value={drafts} sub="Not issued — the client cannot see these yet" tone={drafts ? "warn" : "default"} testid="inv-kpi-drafts" />
      </div>
      <Panel title="All invoices" action={<span className="text-xs text-nb-mute" data-testid="invoice-count">{rows ? `${shown.length} of ${rows.length}` : ""}</span>} testid="invoice-panel">
        <div className="mb-3 flex min-w-0 flex-col gap-2 lg:flex-row lg:items-center">
          <SearchField value={query} onChange={setQuery} placeholder="Search number, client, service, practitioner" testid="invoice-search" />
          <Segmented options={FILTERS} value={filter} onChange={setFilter} testid="invoice-filter" label="Invoice status" />
        </div>
        {error && <ErrorState message={error} onRetry={reload} />}
        {rows === undefined && <SkeletonRows rows={4} />}
        {rows && !shown.length && <EmptyState icon={ReceiptText} title={rows.length ? "No invoices match" : "No invoices yet"} body={rows.length ? "Clear the search or choose another status." : "Invoices you create from a visit or as standalone drafts appear here."} testid="invoice-empty" />}
        {shown.length > 0 && (
          <>
            <div className="space-y-2 md:hidden" data-testid="invoice-cards">{shown.map((row) => <InvoiceCard key={row.id} row={row} onOpen={setOpenId} />)}</div>
            <div className="hidden md:block"><InvoiceTable rows={shown} onOpen={setOpenId} /></div>
          </>
        )}
      </Panel>
      <InvoiceDrawer invoice={active} open={Boolean(active)} onOpenChange={(o) => !o && setOpenId(null)} staffLink={role === "owner" ? "/owner/payments" : "/desk/verify"} flags={{ emailOn }} onChange={(next) => { replace(next); reload(); }} />
    </div>
  );
}
