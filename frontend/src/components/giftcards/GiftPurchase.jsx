import { useState } from "react";
import { toast } from "sonner";
import { Loader2, Send } from "lucide-react";
import { api, apiError } from "@/lib/api";
import { newKey } from "@/lib/useInvoices";
import { formatCents } from "@/lib/billing";
import { Field, Notice } from "@/components/tide";
import { GiftCardArt } from "@/components/giftcards/GiftCardArt";

export function GiftPurchase({ config, onDone }) {
  const products = config?.products || [];
  const [pid, setPid] = useState(products[0]?.id || "");
  const product = products.find((p) => p.id === pid) || products[0];
  const [amount, setAmount] = useState(product?.amountsCents?.[0] || 0);
  const [form, setForm] = useState({ recipientName: "", recipientEmail: "", message: "" });
  const [busy, setBusy] = useState(false);
  const [key, setKey] = useState(() => newKey("gcbuy"));
  if (!products.length) return <Notice testid="gift-purchase-none">Gift-card designs are being prepared. Check back soon.</Notice>;
  const enabled = config.enabled;
  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    try {
      await api.giftPurchase({ productId: product.id, amountCents: amount, ...form, idempotencyKey: key });
      toast.success("Request saved. The card activates after Nabitouch confirms payment.");
      setKey(newKey("gcbuy"));
      setForm({ recipientName: "", recipientEmail: "", message: "" });
      onDone?.();
    } catch (err) { toast.error(apiError(err)); }
    setBusy(false);
  };
  return (
    <form onSubmit={submit} className="grid gap-6 lg:grid-cols-[1fr_1.1fr]" data-testid="gift-purchase-form">
      <div className="lg:sticky lg:top-24 lg:self-start">
        <GiftCardArt design={product.design} amount={formatCents(amount)} recipient={form.recipientName} testid="gift-purchase-preview" />
        <div className="mt-3 flex gap-2" data-testid="gift-product-picker">
          {products.map((p) => <button key={p.id} type="button" onClick={() => { setPid(p.id); setAmount(p.amountsCents[0]); }} data-testid={`gift-product-${p.id}`} className={`flex-1 rounded-2xl px-3 py-2 text-xs font-medium ring-1 transition-colors ${p.id === product.id ? "bg-nb-navy text-white ring-nb-navy" : "bg-white text-nb-ink ring-sky-100"}`}>{p.name}</button>)}
        </div>
      </div>
      <div>
        <Field label="Amount">
          <div className="flex flex-wrap gap-2" data-testid="gift-amounts">
            {product.amountsCents.map((c) => <button key={c} type="button" onClick={() => setAmount(c)} data-testid={`gift-amount-${c}`} className={`nb-num h-11 rounded-full px-5 text-sm font-semibold ring-1 transition-colors ${c === amount ? "bg-gradient-to-r from-nb-blue to-nb-cyan text-white ring-transparent" : "bg-white ring-sky-100"}`}>{formatCents(c)}</button>)}
          </div>
        </Field>
        <Field label="Recipient name"><input required className="nb-input h-12" value={form.recipientName} onChange={(e) => setForm({ ...form, recipientName: e.target.value })} data-testid="gift-recipient-name" /></Field>
        <Field label="Recipient email" hint="Stored for delivery. Email sending is currently turned off."><input type="email" className="nb-input h-12" value={form.recipientEmail} onChange={(e) => setForm({ ...form, recipientEmail: e.target.value })} data-testid="gift-recipient-email" /></Field>
        <Field label="Message"><textarea rows={3} maxLength={240} className="nb-input py-3" value={form.message} onChange={(e) => setForm({ ...form, message: e.target.value })} data-testid="gift-message" /></Field>
        <button disabled={!enabled || busy} data-testid="gift-purchase-submit" className="nb-btn-primary h-12 w-full">{busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}Request {formatCents(amount)} gift card</button>
        <Notice className="mt-3" testid="gift-purchase-note">{enabled ? "Payment is confirmed by Nabitouch (cash or verified e-Transfer). The card stays inactive with no balance until then." : "Gift-card purchases are not open yet. Nothing will be charged."}</Notice>
      </div>
    </form>
  );
}
