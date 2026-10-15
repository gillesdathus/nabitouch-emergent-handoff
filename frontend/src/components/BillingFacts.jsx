import { useEffect, useState } from "react";
import { useReducedMotion } from "framer-motion";
import { useDemo } from "@/store/DemoStore";
import { billingBars } from "@/lib/billing";

const Fact = ({ label, value, testid, hint }) => (
  <div className="rounded-2xl bg-white p-3 ring-1 ring-sky-100" data-testid={testid}>
    <p className="text-[11px] text-nb-mute">{label}</p>
    <p className="mt-1 text-lg font-semibold tabular-nums">{value}</p>
    {hint && <p className="text-[10px] text-nb-mute">{hint}</p>}
  </div>
);

export function BillingFacts({ appointmentId }) {
  const { api } = useDemo();
  const reduce = useReducedMotion();
  const [invoice, setInvoice] = useState(undefined);
  useEffect(() => {
    let alive = true;
    setInvoice(undefined);
    api.invoiceByAppointment(appointmentId).then((next) => { if (alive) setInvoice(next); }).catch(() => { if (alive) setInvoice(null); });
    return () => { alive = false; };
  }, [api, appointmentId]);
  if (invoice === undefined) {
    return <div className="grid grid-cols-2 gap-2 motion-reduce:animate-none" data-testid="billing-skeleton">{[0, 1, 2, 3].map((n) => <div key={n} className="h-16 animate-pulse rounded-2xl bg-sky-50 motion-reduce:animate-none" />)}</div>;
  }
  if (!invoice) return null;
  const bars = billingBars(invoice);
  const claim = (invoice.claims || [])[0];
  return (
    <div className="space-y-3" data-testid="billing-facts">
      <div className="grid grid-cols-2 gap-2">
        <Fact label="Invoice" value={invoice.total.display} testid="fact-total" />
        <Fact label="Confirmed outstanding" value={invoice.balance.display} testid="fact-balance" hint="Money still owed" />
        <Fact label="Insurance claimed" value={invoice.claimed.display} testid="fact-claimed" />
        <Fact label="Insurance approved" value={invoice.approved.display} testid="fact-approved" hint="Not a payment" />
        <Fact label="Insurance received" value={invoice.insuranceReceived.display} testid="fact-insurance-received" />
        <Fact label="Client payments" value={invoice.clientPaid.display} testid="fact-client-paid" />
        <Fact label="Expected additional insurance" value={invoice.expectedInsurance.display} testid="fact-expected" hint="Not yet received" />
        <Fact label="Estimated your share" value={invoice.estimatedClientShare.display} testid="fact-share" hint="After expected insurance" />
      </div>
      <div>
        <div className="relative h-2 overflow-hidden rounded-full bg-sky-100" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={bars.received} aria-valuetext={`${invoice.received.display} received. ${invoice.expectedInsurance.display} expected and not yet received.`} data-testid="billing-progress">
          <div className={`absolute inset-y-0 left-0 rounded-full border border-dashed border-cyan-400 ${reduce ? "" : "transition-[width] duration-500 motion-reduce:transition-none"}`} style={{ width: `${bars.expected}%` }} />
          <div className={`absolute inset-y-0 left-0 rounded-full bg-nb-teal ${reduce ? "" : "transition-[width] duration-500 motion-reduce:transition-none"}`} style={{ width: `${bars.received}%` }} />
        </div>
        <p className="mt-1 text-[10px] text-nb-mute">Solid bar is money received. The dashed bar is expected insurance and is not a payment.</p>
      </div>
      {claim && (
        <ol className="space-y-1 text-xs" data-testid="claim-timeline">
          <li>{claim.provider} · {claim.status.replaceAll("_", " ")}{claim.status === "approved" || claim.status === "partially_approved" ? " — approval is not a completed payment" : ""}</li>
          {(claim.history || []).map((item, index) => <li key={`${item.at}-${index}`}>{item.status.replaceAll("_", " ")}</li>)}
        </ol>
      )}
    </div>
  );
}
