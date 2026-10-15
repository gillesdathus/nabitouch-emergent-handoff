import { Pill } from "@/components/ui-kit";
import { billingBars, formatCents } from "@/lib/billing";

const STATE = {
  issued: ["Issued", "blue"], partially_paid: ["Partly paid", "cyan"], paid: ["Paid", "teal"],
  voided: ["Voided", "slate"], draft: ["Draft", "slate"],
};

export function InvoiceStatePill({ invoice, testid }) {
  if (invoice.overdue) return <Pill tone="amber" testid={testid}>Overdue</Pill>;
  const [label, tone] = STATE[invoice.state] || [String(invoice.state || "").replaceAll("_", " "), "slate"];
  return <Pill tone={tone} testid={testid}>{label}</Pill>;
}

export function TideBar({ invoice, dark }) {
  const bars = billingBars(invoice);
  return (
    <div>
      <div className={`relative h-2 overflow-hidden rounded-full ${dark ? "bg-white/15" : "bg-sky-100"}`} role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={bars.received}>
        <div className="absolute inset-y-0 left-0 rounded-full border border-dashed border-cyan-300 transition-[width] duration-700" style={{ width: `${bars.expected}%` }} />
        <div className="absolute inset-y-0 left-0 rounded-full bg-gradient-to-r from-nb-teal to-nb-turq transition-[width] duration-700" style={{ width: `${bars.received}%` }} />
      </div>
    </div>
  );
}

export const LedgerRow = ({ label, hint, cents, tone = "", strong, testid }) => (
  <div className="flex items-start justify-between gap-3 py-2" data-testid={testid}>
    <span className="text-sm text-nb-mute">{label}{hint && <span className="block text-[11px] text-slate-400">{hint}</span>}</span>
    <span className={`nb-num text-sm ${strong ? "text-base font-semibold text-nb-ink" : "text-nb-ink"} ${tone}`}>{formatCents(cents)}</span>
  </div>
);

export function MoneyLedger({ invoice }) {
  return (
    <div className="divide-y divide-dashed divide-sky-100 rounded-2xl bg-white px-4 ring-1 ring-sky-100" data-testid="invoice-money-ledger">
      <LedgerRow label="Invoice total" cents={invoice.total.cents} strong testid="ledger-total" />
      {invoice.claimed.cents > 0 && <LedgerRow label="Insurance claimed" hint="Awaiting insurer decision" cents={invoice.claimed.cents} testid="ledger-claimed" />}
      {invoice.approved.cents > 0 && <LedgerRow label="Insurance approved" hint="Approval is not a payment" cents={invoice.approved.cents} testid="ledger-approved" />}
      {invoice.expectedInsurance.cents > 0 && <LedgerRow label="Insurance pending" hint="Expected, not yet received" cents={invoice.expectedInsurance.cents} tone="text-cyan-700" testid="ledger-ins-pending" />}
      <LedgerRow label="Insurance received" cents={invoice.insuranceReceived.cents} tone="text-nb-teal" testid="ledger-ins-received" />
      <LedgerRow label="Your payments" cents={invoice.clientPaid.cents} tone="text-nb-teal" testid="ledger-client-paid" />
      {invoice.refunded.cents > 0 && <LedgerRow label="Refunded" cents={invoice.refunded.cents} tone="text-amber-700" testid="ledger-refunded" />}
      <LedgerRow label="Outstanding balance" hint={invoice.expectedInsurance.cents > 0 ? `Your share after expected insurance ≈ ${invoice.estimatedClientShare.display}` : undefined} cents={invoice.balance.cents} strong testid="ledger-balance" />
    </div>
  );
}
