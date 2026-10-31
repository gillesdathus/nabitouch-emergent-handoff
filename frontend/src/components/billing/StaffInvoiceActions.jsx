import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { toast } from "sonner";
import {
  ArrowUpRight, BadgeCheck, Banknote, Coins, Copy, FileCheck2, Landmark, Link2, Loader2, Mail, ShieldCheck,
} from "lucide-react";
import { api, apiError } from "@/lib/api";
import { newKey } from "@/lib/useInvoices";
import { formatCents } from "@/lib/billing";
import { payableCents } from "@/components/billing/PayOptions";
import { EClaimsWorkspace } from "@/components/billing/EClaimsWorkspace";
import { fmtDate } from "@/lib/domain";

const METHODS = [
  { id: "insurance", label: "Insurance", Icon: ShieldCheck, hint: "Record coverage and insurer payments" },
  { id: "stripe", label: "Stripe link", Icon: Link2, hint: "Generate, copy, or email a payment link" },
  { id: "cash", label: "Cash", Icon: Banknote, hint: "Record cash received" },
  { id: "etransfer", label: "e-Transfer", Icon: Landmark, hint: "Record Interac e-Transfer" },
];

export function DraftActions({ invoice, onChange }) {
  const [busy, setBusy] = useState(false);
  const issue = async () => {
    setBusy(true);
    try { const v = await api.issueInvoice(invoice.id, newKey("issue")); onChange?.(v); toast.success(`Invoice ${v.number || ""} issued`); }
    catch (e) { toast.error(apiError(e)); }
    setBusy(false);
  };
  return (
    <section className="rounded-2xl bg-amber-50 p-4" data-testid="staff-draft-actions">
      <p className="flex items-center gap-2 text-sm font-semibold text-amber-900"><FileCheck2 className="h-4 w-4" />Draft — not yet issued</p>
      <p className="mt-1 text-xs text-amber-900/80">Issuing assigns the invoice number and opens it for payment. The client sees it only after it is issued.</p>
      <button type="button" onClick={issue} disabled={busy} data-testid="staff-issue-invoice-btn" className="nb-btn-primary mt-3 h-10 text-sm">{busy && <Loader2 className="h-4 w-4 animate-spin" />}Issue invoice</button>
    </section>
  );
}

function ManualPayment({ invoice, onChange, method }) {
  const [form, setForm] = useState({ amount: "", reference: "" });
  const [busy, setBusy] = useState(false);
  const save = async () => {
    setBusy(true);
    try {
      const body = { method, reference: form.reference || undefined, idempotencyKey: newKey("pay") };
      if (form.amount) body.amountCents = Math.round(Number(form.amount) * 100);
      const v = await api.recordInvoicePayment(invoice.id, body);
      onChange?.(v);
      setForm({ amount: "", reference: "" });
      toast.success("Payment recorded");
    } catch (e) { toast.error(apiError(e)); }
    setBusy(false);
  };
  const label = method === "cash" ? "Cash received" : method === "etransfer" ? "e-Transfer received" : "Payment received";
  return (
    <div className="rounded-2xl bg-white p-4 ring-1 ring-sky-100" data-testid={`staff-manual-payment-${method}`}>
      <p className="flex items-center gap-2 text-sm font-semibold"><Banknote className="h-4 w-4 text-nb-teal" />{label}</p>
      <p className="mt-1 text-xs text-nb-mute">Leave the amount empty to settle the full outstanding balance of {invoice.balance.display}. Confirmed payments only — this does not mark insurance as paid.</p>
      <div className="mt-3 grid gap-2 sm:grid-cols-[1fr_1.2fr_auto]">
        <input type="number" min="0.01" step="0.01" inputMode="decimal" placeholder="Amount $" aria-label="Amount" className="nb-input h-10" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} data-testid="staff-payment-amount" />
        <input placeholder="Reference (optional)" aria-label="Reference" className="nb-input h-10" value={form.reference} onChange={(e) => setForm({ ...form, reference: e.target.value })} data-testid="staff-payment-reference" />
        <button type="button" onClick={save} disabled={busy} data-testid="staff-payment-save" className="nb-btn-dark h-10 text-sm">{busy && <Loader2 className="h-4 w-4 animate-spin" />}Record</button>
      </div>
      {method === "cash" && (
        <p className="mt-2 text-[11px] text-nb-mute">Card terminal settlements stay available from the visit payment panel so this screen stays focused on the four primary collection paths.</p>
      )}
    </div>
  );
}

function InsurancePanel({ invoice, staffLink, patientsLink }) {
  const claim = (invoice.claims || [])[0];
  return (
    <div className="space-y-3 rounded-2xl p-4 tint-ice" data-testid="staff-pay-insurance">
      <p className="flex items-center gap-2 text-sm font-semibold text-nb-navy"><ShieldCheck className="h-4 w-4" />Insurance · invoice context</p>
      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-sm">
        <dt className="text-nb-mute">Patient</dt><dd data-testid="staff-ins-patient">{invoice.clientName || "—"}</dd>
        <dt className="text-nb-mute">Service date</dt><dd data-testid="staff-ins-date">{invoice.serviceDate ? fmtDate(invoice.serviceDate) : "—"}</dd>
        <dt className="text-nb-mute">Treatment</dt><dd data-testid="staff-ins-service">{invoice.service || "—"}{invoice.duration ? ` · ${invoice.duration} min` : ""}</dd>
        <dt className="text-nb-mute">Invoice amount</dt><dd className="nb-num" data-testid="staff-ins-total">{invoice.total.display}</dd>
        <dt className="text-nb-mute">Outstanding</dt><dd className="nb-num" data-testid="staff-ins-balance">{invoice.balance.display}</dd>
        <dt className="text-nb-mute">Practitioner</dt><dd data-testid="staff-ins-practitioner">{invoice.practitionerName || "—"}</dd>
        <dt className="text-nb-mute">Insurance expected</dt><dd className="nb-num" data-testid="staff-ins-expected">{invoice.expectedInsurance?.cents > 0 ? invoice.expectedInsurance.display : "None recorded"}</dd>
        <dt className="text-nb-mute">Patient share</dt><dd className="nb-num" data-testid="staff-ins-share">{formatCents(payableCents(invoice))}</dd>
      </dl>
      {claim
        ? <p className="text-xs text-nb-mute" data-testid="staff-ins-claim">{claim.provider || "Insurer"} · claimed {claim.claimed?.display} · approved {claim.approved?.display} · received {claim.received?.display}</p>
        : <p className="text-xs text-nb-mute" data-testid="staff-ins-claim-empty">No claim has been recorded on this invoice yet. Approval is not payment.</p>}
      <EClaimsWorkspace invoiceId={invoice.id} clientId={invoice.clientId} patientsLink={patientsLink} />
      {staffLink && <Link to={staffLink} data-testid="staff-ins-open-ledger" className="nb-btn-ghost inline-flex h-10 items-center gap-2 text-sm">Record insurance on the payments ledger<ArrowUpRight className="h-4 w-4" /></Link>}
    </div>
  );
}

function StripeLinkPanel({ invoice, emailOn, onLink }) {
  const [busy, setBusy] = useState("");
  const [link, setLink] = useState("");
  const [sessionId, setSessionId] = useState("");
  const [amount, setAmount] = useState(null);
  const [emailTo, setEmailTo] = useState(invoice.clientEmail || "");
  const [mailStatus, setMailStatus] = useState("");
  useEffect(() => { setEmailTo(invoice.clientEmail || ""); }, [invoice.id, invoice.clientEmail]);

  const due = payableCents(invoice);
  const run = (what, fn) => async () => {
    setBusy(what);
    try { await fn(); } catch (e) { toast.error(apiError(e)); }
    setBusy("");
  };

  const generate = run("link", async () => {
    const res = await api.invoiceCheckout(invoice.id, { forClient: true });
    setAmount(res.amount || null);
    setSessionId(res.sessionId || "");
    if (!res.url) {
      setLink("");
      toast.message("Checkout session created in simulated mode. No shareable URL.");
      return;
    }
    setLink(res.url);
    onLink?.(res.url);
    toast.success("Payment link ready. It is paid only when Stripe confirms.");
  });

  const copy = run("copy", async () => {
    let url = link;
    if (!url) {
      const res = await api.invoiceCheckout(invoice.id, { forClient: true });
      setAmount(res.amount || null);
      setSessionId(res.sessionId || "");
      if (!res.url) { toast.message("No shareable URL in simulated mode."); return; }
      url = res.url;
      setLink(url);
      onLink?.(url);
    }
    await navigator.clipboard?.writeText(url);
    toast.success("Payment link copied");
  });

  const sendEmail = run("email", async () => {
    const to = emailTo.trim();
    if (!to || !to.includes("@")) {
      toast.error("Enter a valid recipient email, or copy the link to share another way.");
      return;
    }
    const res = await api.emailInvoice(invoice.id, "payment_link", newKey("plink"), { recipientEmail: to });
    if (res.paymentUrl) {
      setLink(res.paymentUrl);
      onLink?.(res.paymentUrl);
    }
    if (res.amount) setAmount(res.amount);
    setMailStatus(res.status || (res.queued ? "queued" : "unknown"));
    if (res.queued) toast.success(res.status === "sent" || res.delivered ? "Payment link emailed" : "Payment link email queued. Delivery is confirmed only by the provider.");
    else toast.error("Email was not queued");
  });

  return (
    <div className="rounded-2xl p-4 tint-ice space-y-3" data-testid="staff-pay-stripe">
      <p className="flex items-center gap-2 text-sm font-semibold text-nb-navy">
        <Link2 className="h-4 w-4" />
        Stripe payment link · {formatCents(amount?.cents ?? due)}
        {invoice.expectedInsurance?.cents > 0 ? " (patient share)" : ""}
      </p>
      <p className="text-xs text-nb-mute" data-testid="staff-stripe-outstanding">
        Outstanding balance {invoice.balance.display}
        {invoice.expectedInsurance?.cents > 0 ? ` · insurance expected ${invoice.expectedInsurance.display} (not counted as paid)` : ""}
      </p>
      <div className="flex flex-wrap gap-2">
        <button type="button" onClick={generate} disabled={Boolean(busy)} data-testid="staff-payment-link-btn" className="nb-btn-primary h-10 text-sm">
          {busy === "link" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Link2 className="h-4 w-4" />}Generate link
        </button>
        <button type="button" onClick={copy} disabled={Boolean(busy)} data-testid="staff-payment-link-copy" className="nb-btn-ghost h-10 text-sm">
          {busy === "copy" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Copy className="h-4 w-4" />}Copy link
        </button>
      </div>
      {link && <p className="break-all font-mono text-[11px] text-nb-mute" data-testid="staff-payment-link">{link}</p>}
      <p className="text-[11px] text-nb-mute" data-testid="staff-payment-link-status">
        {link
          ? `Link ready${sessionId ? ` · session ${sessionId.slice(0, 18)}…` : ""}. Unpaid until Stripe confirms.`
          : "No active shareable link yet."}
        {mailStatus ? ` · Email ${mailStatus}` : ""}
      </p>
      <div className="rounded-xl bg-white/70 p-3 ring-1 ring-sky-100">
        <p className="text-xs font-semibold text-nb-navy">Email payment link</p>
        {!emailOn && <p className="mt-1 text-xs text-nb-mute" data-testid="staff-payment-link-email-off">Invoice email is turned off. You can still copy the link.</p>}
        <label className="mt-2 block text-[11px] text-nb-mute" htmlFor="staff-plink-email">Recipient</label>
        <input id="staff-plink-email" type="email" autoComplete="email" className="nb-input mt-1 h-10 w-full" value={emailTo} onChange={(e) => setEmailTo(e.target.value)} placeholder="client@email.com" data-testid="staff-payment-link-email" />
        {!invoice.clientEmail && <p className="mt-1 text-[11px] text-nb-mute">No saved client email on file. Enter an authorized recipient, or copy the link.</p>}
        <button type="button" onClick={sendEmail} disabled={!emailOn || Boolean(busy)} data-testid="staff-payment-link-send" className="nb-btn-dark mt-3 h-10 text-sm">
          {busy === "email" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Mail className="h-4 w-4" />}{emailOn ? "Send payment link" : "Email · off"}
        </button>
      </div>
    </div>
  );
}

export function StaffInvoiceActions({ invoice, onChange, staffLink, patientsLink, emailOn = false }) {
  const [busy, setBusy] = useState("");
  const [method, setMethod] = useState("stripe");
  const [tip, setTip] = useState({ amount: "", method: "cash", reference: "" });
  const run = (what, fn) => async () => { setBusy(what); try { await fn(); } catch (e) { toast.error(apiError(e)); } setBusy(""); };
  const release = run("release", async () => { const v = await api.releaseInvoice(invoice.id); onChange?.(v); toast.success("Final invoice released to the client"); });
  const saveTip = run("tip", async () => {
    await api.recordTip(invoice.id, { amountCents: Math.round(Number(tip.amount) * 100), method: tip.method, reference: tip.reference, idempotencyKey: newKey("tip") });
    setTip({ amount: "", method: "cash", reference: "" });
    toast.success("Tip recorded for the practitioner");
  });
  const paid = invoice.state === "paid" && invoice.balance.cents === 0;
  if (invoice.state === "draft") return <DraftActions invoice={invoice} onChange={onChange} />;
  return (
    <section className="space-y-3" data-testid="staff-invoice-actions">
      {invoice.state !== "voided" && invoice.balance.cents > 0 && (
        <div className="space-y-3" data-testid="staff-pay-methods">
          <p className="nb-eyebrow">Collect payment</p>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4" role="tablist" aria-label="Payment method">
            {METHODS.map(({ id, label, Icon, hint }) => (
              <button
                key={id}
                type="button"
                role="tab"
                aria-selected={method === id}
                title={hint}
                onClick={() => setMethod(id)}
                data-testid={`staff-pay-method-${id}`}
                className={`flex min-h-[3.25rem] flex-col items-start justify-center rounded-2xl px-3 py-2 text-left text-xs font-semibold ring-1 transition-colors ${method === id ? "bg-nb-navy text-white ring-nb-navy" : "bg-white text-nb-ink ring-sky-100"}`}
              >
                <span className="flex items-center gap-1.5"><Icon className="h-3.5 w-3.5" />{label}</span>
              </button>
            ))}
          </div>
          {method === "insurance" && <InsurancePanel invoice={invoice} staffLink={staffLink} patientsLink={patientsLink} />}
          {method === "stripe" && <StripeLinkPanel invoice={invoice} emailOn={emailOn} />}
          {method === "cash" && <ManualPayment invoice={invoice} onChange={onChange} method="cash" />}
          {method === "etransfer" && <ManualPayment invoice={invoice} onChange={onChange} method="etransfer" />}
        </div>
      )}
      <div className={`rounded-2xl p-4 ${paid ? "tint-mint" : "bg-slate-50"}`}>
        <p className="flex items-center gap-2 text-sm font-semibold"><BadgeCheck className="h-4 w-4 text-nb-teal" />Final invoice for the client</p>
        {invoice.releasedAt
          ? <p className="mt-1 text-xs text-nb-mute" data-testid="staff-invoice-released">Released {new Date(invoice.releasedAt).toLocaleDateString("en-CA")}. The client can download the invoice and receipt.</p>
          : <><p className="mt-1 text-xs text-nb-mute">{paid ? "Paid in full. Approve to make the PDF and receipt available to the client." : "Available to approve once the balance is fully paid."}</p>
            <button type="button" onClick={release} disabled={!paid || Boolean(busy)} data-testid="staff-release-btn" className="nb-btn-dark mt-3 h-10 text-sm">{busy === "release" && <Loader2 className="h-4 w-4 animate-spin" />}Approve & release</button></>}
      </div>
      <div className="rounded-2xl bg-slate-50 p-4">
        <p className="flex items-center gap-2 text-sm font-semibold"><Coins className="h-4 w-4 text-amber-600" />Record a tip (100% to practitioner)</p>
        <div className="mt-3 grid grid-cols-3 gap-2">
          <input type="number" min="1" step="0.5" placeholder="$" className="nb-input h-10" value={tip.amount} onChange={(e) => setTip({ ...tip, amount: e.target.value })} data-testid="staff-tip-amount" />
          <select className="nb-input h-10" value={tip.method} onChange={(e) => setTip({ ...tip, method: e.target.value })} data-testid="staff-tip-method"><option value="cash">Cash</option><option value="etransfer">e-Transfer</option></select>
          <button type="button" onClick={saveTip} disabled={!Number(tip.amount) || Boolean(busy)} data-testid="staff-tip-save" className="nb-btn-ghost h-10 text-sm">Save tip</button>
        </div>
      </div>
    </section>
  );
}
