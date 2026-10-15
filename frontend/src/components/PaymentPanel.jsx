import { useEffect, useState } from "react";
import { CreditCard, Lock, Loader2, Receipt, RotateCcw, Banknote, Undo2, ShieldCheck } from "lucide-react";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { PayPill, Pill } from "@/components/ui-kit";
import { restrictedFlag } from "@/lib/feature-flags";
import { useDemo } from "@/store/DemoStore";
import { money, CLAIM_STATUS, DONE } from "@/lib/domain";
import { formatCents } from "@/lib/billing";
import { apiError } from "@/lib/api";

function InsuranceLedger({ invoice }) {
  if (!invoice || invoice.state === "draft" || invoice.state === "voided") return null;
  const claim = (invoice.claims || [])[0];
  return (
    <div className="space-y-2 rounded-2xl border border-sky-100 p-3" data-testid="insurance-ledger">
      <p className="text-xs font-semibold text-nb-mute">Insurer connections are unavailable. Claims are not submitted from Nabitouch.</p>
      {claim && <p className="text-sm" data-testid="claim-ledger-status">{claim.provider} · claimed {claim.claimed.display} · approved {claim.approved.display} · received {claim.received.display}</p>}
    </div>
  );
}

export function StripeCheckout({ appt, invoice, open, onClose }) {
  const { api } = useDemo();
  const [phase, setPhase] = useState("form");
  const [note, setNote] = useState("");
  const received = invoice?.received?.cents || 0;
  const due = received > 0 ? (invoice?.balance?.cents || 0) : (appt.paymentDue?.dueNowCents || invoice?.balance?.cents || 0);
  const pay = async () => {
    if (!invoice?.id || invoice.state === "draft") {
      setNote("Issue the invoice first. Opening this screen does not record a payment.");
      return;
    }
    setPhase("processing");
    try {
      const body = appt.payNow === "deposit" && received === 0 ? { amountCents: due } : (received > 0 ? { amountCents: invoice.balance.cents } : {});
      const started = await api.invoiceCheckout(invoice.id, body);
      setNote(`Checkout started for ${started.amount?.display || formatCents(due)}. Nothing is paid until a verified Stripe webhook arrives.`);
      setPhase("pending");
    } catch (error) {
      setNote(apiError(error));
      setPhase("form");
    }
  };
  const close = () => { setPhase("form"); setNote(""); onClose(); };
  return (
    <Dialog open={open} onOpenChange={(o) => !o && close()}>
      <DialogContent className="rounded-3xl sm:max-w-md" data-testid="stripe-checkout-dialog">
        <DialogTitle>Card checkout</DialogTitle>
        <div className="space-y-4">
          <div className="flex items-baseline justify-between"><span className="text-sm text-nb-mute">Amount to start</span><span className="text-3xl font-semibold" data-testid="stripe-amount">{formatCents(due) || money(appt.settle?.payable || 0)}</span></div>
          <p className="text-xs text-nb-mute"><Lock className="mr-1 inline h-3.5 w-3.5" />Nabitouch does not collect or store card numbers. This screen does not mark the balance paid.</p>
          {note && <p className="rounded-2xl bg-slate-50 p-4 text-sm" data-testid="stripe-pending-note">{note}</p>}
          {phase !== "pending" && <button disabled={phase === "processing" || due <= 0} onClick={pay} data-testid="stripe-pay-btn" className="nb-btn-primary w-full">{phase === "processing" ? <><Loader2 className="h-4 w-4 animate-spin" />Starting…</> : "Start Stripe checkout"}</button>}
        </div>
      </DialogContent>
    </Dialog>
  );
}

const Row = ({ l, v, cls = "", testid, hint }) => <div className={`flex justify-between gap-3 ${cls}`} data-testid={testid}><span>{l}{hint && <span className="block text-[10px] text-nb-mute">{hint}</span>}</span><span className="tabular-nums">{v}</span></div>;

export function PaymentPanel({ appt, role }) {
  const { api, run, perm, idx, user } = useDemo();
  const [checkout, setCheckout] = useState(false);
  const [invoice, setInvoice] = useState(null);
  const [cardNote, setCardNote] = useState("");
  const [transfer, setTransfer] = useState(null);
  useEffect(() => {
    if (!invoice?.id) return undefined;
    let alive = true;
    api.etransferSettings().then((next) => { if (alive) setTransfer(next); }).catch(() => { if (alive) setTransfer(null); });
    return () => { alive = false; };
  }, [api, invoice?.id]);
  useEffect(() => {
    let alive = true;
    api.invoiceByAppointment(appt.id).then((next) => { if (alive) setInvoice(next); }).catch(() => { if (alive) setInvoice(null); });
    return () => { alive = false; };
  }, [api, appt.id, appt.paymentStatus]);
  const s = appt.settle || {};
  const c = appt.claim || { status: "none" };
  const cardsOn = restrictedFlag(idx?.settings, "cardCheckoutEnabled");
  const staff = role === "owner" || (role === "desk" && perm("managePayments"));
  const claims = role === "owner" || (role === "desk" && perm("viewInsuranceStatus"));
  const actor = role === "client" ? "Client" : (user?.name || user?.email || "Staff");
  const done = DONE.includes(appt.status);

  if (role === "pro") return (
    <div className="space-y-3" data-testid="pro-payment-status">
      <div className="flex flex-wrap items-center gap-2"><PayPill status={appt.paymentStatus} />{s.balance > 0 && done && <Pill tone="amber">Client balance needs attention — reception will follow up</Pill>}</div>
      {invoice && <p className="text-sm" data-testid="invoice-summary">{invoice.number || "Draft invoice"} · {invoice.total.display} · paid {invoice.received.display} · balance {invoice.balance.display}{invoice.collectionStatus ? ` · ${invoice.collectionStatus.replaceAll("_", " ")}` : ""}{invoice.expectedInsurance?.cents > 0 ? ` · insurance expected ${invoice.expectedInsurance.display}, not yet received` : ""} · {invoice.state.replaceAll("_", " ")}</p>}
      <InsuranceLedger invoice={invoice} />
    </div>
  );

  return (
    <div className="space-y-4" data-testid={`payment-panel-${appt.id}`}>
      {invoice && <p className="text-sm" data-testid="invoice-summary">{invoice.number || "Draft invoice"} · {invoice.total.display} · paid {invoice.received.display} · balance {invoice.balance.display}{invoice.collectionStatus ? ` · ${invoice.collectionStatus.replaceAll("_", " ")}` : ""}{invoice.expectedInsurance?.cents > 0 ? ` · insurance expected ${invoice.expectedInsurance.display}, not yet received` : ""} · {invoice.state.replaceAll("_", " ")}</p>}
      {staff && !invoice && <button type="button" onClick={() => run(async () => { const drafted = await api.draftInvoice(appt.id); const issued = await api.issueInvoice(drafted.id, `issue-${appt.id}`); setInvoice(issued); return issued; }, "Invoice issued")} data-testid="invoice-issue-btn" className="nb-btn-ghost h-10 text-sm">Issue invoice</button>}
      {(staff || claims) && <InsuranceLedger invoice={invoice} />}
      {invoice && invoice.balance?.cents > 0 && role === "client" && (
        <div className="space-y-2">
          {cardsOn && <button type="button" onClick={() => run(async () => { const next = await api.invoiceCheckout(invoice.id, {}); setCardNote("Card payment is not confirmed until Nabitouch receives the bank notice."); return next; }, "Checkout started")} data-testid="invoice-card-btn" className="nb-btn-primary h-10 text-sm">Pay {invoice.balance.display} by card</button>}
          {cardsOn && cardNote && <p className="text-xs text-nb-mute" data-testid="card-pending-note">{cardNote}</p>}
          {!cardsOn && <p className="text-xs text-nb-mute" data-testid="card-checkout-off">Card checkout is turned off. Cash and e-Transfer remain available.</p>}
          {transfer?.recipientEmail && <div className="rounded-2xl bg-slate-50 p-3 text-xs" data-testid="etransfer-instructions"><p>{transfer.recipientName} · {transfer.recipientEmail}</p><p>{transfer.instructions}</p><button type="button" onClick={() => run(async () => { const next = await api.reportTransfer(invoice.id, `sent-${invoice.id}`.slice(0, 80)); setInvoice(next); return next; }, "Transfer reported")} data-testid="etransfer-sent-btn" className="nb-btn-ghost mt-2 h-9 text-xs">I sent the e-Transfer</button></div>}
        </div>
      )}
      {staff && invoice && invoice.balance?.cents > 0 && <button type="button" onClick={() => run(async () => { const next = await api.confirmTransfer(invoice.id, { amountCents: invoice.balance.cents, idempotencyKey: `et-${invoice.id}-${invoice.version}`.slice(0, 80), reference: invoice.number || invoice.id }); setInvoice(next); return next; }, "e-Transfer confirmed")} data-testid="confirm-etransfer-btn" className="nb-btn-ghost h-10 text-sm">Confirm e-Transfer for {invoice.balance.display}</button>}
      <div className="flex flex-wrap items-center gap-2"><PayPill status={appt.paymentStatus} testid="payment-status-pill" />{appt.paymentMethod === "insurance" && <Pill tone={CLAIM_STATUS[c.status]?.tone} testid="claim-status-pill">{CLAIM_STATUS[c.status]?.label}</Pill>}</div>
      <div className="space-y-1.5 rounded-2xl bg-slate-50 p-4 text-sm">
        <Row l="Appointment total" v={money(s.total)} cls="font-semibold" testid="settle-total" />
        {appt.paymentMethod === "insurance" && <>
          <Row l="Eligible claim amount" hint="Demo insurer rule: discounted treatment + enhancements + GST, travel excluded" v={money(s.eligible)} cls="text-nb-mute" />
          {s.approved > 0 && <Row l="Insurance approved" v={money(s.approved)} cls="text-nb-mute" testid="settle-approved" />}
          {s.insurancePending > 0 && <Row l="Insurer payment pending" hint="Not yet received — not counted as paid" v={money(s.insurancePending)} cls="text-cyan-700" testid="settle-ins-pending" />}
          <Row l="Insurer paid (confirmed)" v={`−${money(s.insuranceConfirmed)}`} cls="text-nb-teal" testid="settle-ins-confirmed" />
        </>}
        <Row l="Client payments" v={`−${money(s.clientPaid)}`} cls="text-nb-teal" testid="settle-client-paid" />
        {s.refunded > 0 && <Row l="Refunded" v={`+${money(s.refunded)}`} cls="text-amber-700" />}
        <div className="border-t border-dashed border-sky-200 pt-1.5" />
        <Row l="Remaining balance" v={money(s.balance)} cls="text-base font-semibold text-nb-ink" testid="settle-balance" />
        {s.awaiting ? <p className="text-xs text-cyan-700" data-testid="settle-awaiting">Awaiting insurer decision — nothing to pay yet. Your share will be calculated once the insurer responds.</p>
          : s.payable > 0 && <Row l="Payable now (your responsibility)" v={money(s.payable)} cls="font-semibold text-nb-blue" testid="settle-payable" />}
        {s.overpaid > 0 && <p className="text-xs text-amber-700">Overpayment of {money(s.overpaid)} detected — refund required.</p>}
      </div>

      {role === "client" && (
        <div className="flex flex-wrap gap-2">
          {cardsOn && s.payable > 0 && <button onClick={() => setCheckout(true)} data-testid="client-pay-card-btn" className="nb-btn-primary h-11 flex-1">{appt.paymentStatus === "stripe_failed" ? <><RotateCcw className="h-4 w-4" />Retry card payment · {money(s.payable)}</> : <><CreditCard className="h-4 w-4" />Pay {money(s.payable)} with card</>}</button>}
          {s.payable > 0 && idx.settings.cashEnabled && <p className="w-full text-xs text-nb-mute" data-testid="cash-not-prepaid">Cash is payable at the visit. Choosing cash does not mark this booking prepaid.</p>}
          {s.awaiting && <button onClick={() => run(() => api.setMethod(appt.id, "self", actor), "Switched to paying yourself")} data-testid="client-switch-self-btn" className="nb-btn-ghost h-11">Pay the full amount myself instead</button>}
        </div>
      )}

      {staff && s.payable > 0 && (
        <div className="flex flex-wrap gap-2">
          {cardsOn && <button onClick={() => setCheckout(true)} data-testid="staff-card-payment-btn" className="nb-btn-dark h-10 text-sm"><CreditCard className="h-4 w-4" />Take card payment</button>}
          {idx.settings.cashEnabled && <button onClick={() => run(() => api.recordCash(appt.id, actor), "Cash payment recorded")} data-testid="staff-record-cash-btn" className="nb-btn-ghost h-10 text-sm"><Banknote className="h-4 w-4" />Record cash settlement</button>}
          <p className="w-full text-xs text-nb-mute" data-testid="staff-reminder-off">Payment reminders are not sent until email delivery is connected.</p>
        </div>
      )}

      {claims && appt.paymentMethod === "insurance" && (
        <div className="rounded-2xl border border-dashed border-sky-200 p-3" data-testid="claim-simulator">
          <p className="flex items-center gap-2 text-xs font-semibold text-nb-mute"><ShieldCheck className="h-3.5 w-3.5" />Insurance claims are unavailable. Insurer connections are waiting for official API access.</p>
        </div>
      )}

      {(appt.payments || []).length > 0 && (role === "client" || staff) && (
        <ul className="space-y-1.5 text-xs" data-testid="payment-history">
          {appt.payments.map((p) => (
            <li key={p.id} className="flex flex-wrap items-center gap-2 rounded-xl bg-white p-2.5 ring-1 ring-sky-100">
              {p.provider === "stripe" ? <CreditCard className="h-3.5 w-3.5" /> : <Banknote className="h-3.5 w-3.5" />}
              <span className="font-medium">{money(p.amount)}</span><span className="text-nb-mute">{p.provider}{p.intentId && role === "owner" ? ` · ${p.intentId}` : ""}</span>
              <Pill tone={{ succeeded: "green", failed: "red", pending: "cyan", refund_pending: "amber", refunded: "slate" }[p.status]}>{p.status.replace("_", " ")}</Pill>
              {p.receipt && <span className="flex items-center gap-1 text-nb-mute"><Receipt className="h-3 w-3" />{p.receipt}</span>}
              {role === "owner" && ["succeeded", "refund_pending"].includes(p.status) && <button onClick={() => run(() => api.refund(appt.id, p.id, actor))} data-testid={`refund-btn-${p.id}`} className="ml-auto flex items-center gap-1 font-semibold text-amber-700"><Undo2 className="h-3 w-3" />{p.status === "succeeded" ? "Refund" : "Complete refund"}</button>}
            </li>))}
        </ul>
      )}
      {appt.status === "processing" && s.balance <= 0 && (staff || role === "owner") && <button onClick={() => run(() => api.transition(appt.id, "closed", actor), "Visit closed")} data-testid="close-visit-btn" className="nb-btn-primary h-10 text-sm">Close visit</button>}
      {cardsOn && <StripeCheckout appt={appt} invoice={invoice} open={checkout} onClose={() => setCheckout(false)} />}
    </div>
  );
}
