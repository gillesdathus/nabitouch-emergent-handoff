import { useState } from "react";
import { toast } from "sonner";
import { BadgeCheck, Coins, Link2, Loader2 } from "lucide-react";
import { api, apiError } from "@/lib/api";
import { newKey } from "@/lib/useInvoices";
import { formatCents } from "@/lib/billing";
import { payableCents } from "@/components/billing/PayOptions";

export function StaffInvoiceActions({ invoice, onChange }) {
  const [busy, setBusy] = useState("");
  const [link, setLink] = useState("");
  const [tip, setTip] = useState({ amount: "", method: "cash", reference: "" });
  const run = (what, fn) => async () => { setBusy(what); try { await fn(); } catch (e) { toast.error(apiError(e)); } setBusy(""); };
  const makeLink = run("link", async () => {
    const res = await api.invoiceCheckout(invoice.id, { amountCents: payableCents(invoice) });
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
  return (
    <section className="space-y-3" data-testid="staff-invoice-actions">
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
