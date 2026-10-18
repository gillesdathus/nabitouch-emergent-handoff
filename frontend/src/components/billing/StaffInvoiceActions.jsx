import { useState } from "react";
import { toast } from "sonner";
import { Banknote, BadgeCheck, Coins, FileCheck2, Link2, Loader2 } from "lucide-react";
import { api, apiError } from "@/lib/api";
import { newKey } from "@/lib/useInvoices";
import { formatCents } from "@/lib/billing";
import { payableCents } from "@/components/billing/PayOptions";

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

function ManualPayment({ invoice, onChange }) {
  const [form, setForm] = useState({ amount: "", method: "cash", reference: "" });
  const [busy, setBusy] = useState(false);
  const save = async () => {
    setBusy(true);
    try {
      const body = { method: form.method, reference: form.reference || undefined, idempotencyKey: newKey("pay") };
      if (form.amount) body.amountCents = Math.round(Number(form.amount) * 100);
      const v = await api.recordInvoicePayment(invoice.id, body);
      onChange?.(v);
      setForm({ amount: "", method: "cash", reference: "" });
      toast.success("Payment recorded");
    } catch (e) { toast.error(apiError(e)); }
    setBusy(false);
  };
  return (
    <div className="rounded-2xl bg-white p-4 ring-1 ring-sky-100" data-testid="staff-manual-payment">
      <p className="flex items-center gap-2 text-sm font-semibold"><Banknote className="h-4 w-4 text-nb-teal" />Record a payment received</p>
      <p className="mt-1 text-xs text-nb-mute">Cash, e-Transfer, or terminal only. Leave the amount empty to settle the full balance of {invoice.balance.display}.</p>
      <div className="mt-3 grid gap-2 sm:grid-cols-[1fr_1fr_1.2fr_auto]">
        <input type="number" min="0.01" step="0.01" inputMode="decimal" placeholder="Amount $" aria-label="Amount" className="nb-input h-10" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} data-testid="staff-payment-amount" />
        <select aria-label="Method" className="nb-input h-10" value={form.method} onChange={(e) => setForm({ ...form, method: e.target.value })} data-testid="staff-payment-method"><option value="cash">Cash</option><option value="etransfer">e-Transfer</option><option value="terminal">Card terminal</option><option value="other">Other</option></select>
        <input placeholder="Reference (optional)" aria-label="Reference" className="nb-input h-10" value={form.reference} onChange={(e) => setForm({ ...form, reference: e.target.value })} data-testid="staff-payment-reference" />
        <button type="button" onClick={save} disabled={busy} data-testid="staff-payment-save" className="nb-btn-dark h-10 text-sm">{busy && <Loader2 className="h-4 w-4 animate-spin" />}Record</button>
      </div>
    </div>
  );
}

export function StaffInvoiceActions({ invoice, onChange }) {
  const [busy, setBusy] = useState("");
  const [link, setLink] = useState("");
  const [tip, setTip] = useState({ amount: "", method: "cash", reference: "" });
  const run = (what, fn) => async () => { setBusy(what); try { await fn(); } catch (e) { toast.error(apiError(e)); } setBusy(""); };
  const makeLink = run("link", async () => {
    const res = await api.invoiceCheckout(invoice.id, {});
    if (!res.url) { toast.message("Checkout session created in simulated mode. No shareable URL."); return; }
    setLink(res.url);
    await navigator.clipboard?.writeText(res.url);
    toast.success("Payment link copied. Share it with the client; it is paid only when Stripe confirms.");
  });
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
      {invoice.state !== "voided" && invoice.balance.cents > 0 && <ManualPayment invoice={invoice} onChange={onChange} />}
      {invoice.balance.cents > 0 && (
        <div className="rounded-2xl p-4 tint-ice">
          <p className="flex items-center gap-2 text-sm font-semibold text-nb-navy"><Link2 className="h-4 w-4" />Stripe payment link · {formatCents(payableCents(invoice))}{invoice.expectedInsurance.cents > 0 ? " (client share)" : ""}</p>
          <button type="button" onClick={makeLink} disabled={Boolean(busy)} data-testid="staff-payment-link-btn" className="nb-btn-primary mt-3 h-10 text-sm">{busy === "link" && <Loader2 className="h-4 w-4 animate-spin" />}Create & copy link</button>
          {link && <p className="mt-2 break-all font-mono text-[11px] text-nb-mute" data-testid="staff-payment-link">{link}</p>}
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
