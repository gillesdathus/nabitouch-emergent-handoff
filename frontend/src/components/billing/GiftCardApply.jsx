import { useState } from "react";
import { toast } from "sonner";
import { Gift, Loader2 } from "lucide-react";
import { api, apiError } from "@/lib/api";
import { newKey } from "@/lib/useInvoices";

export function GiftCardApply({ invoice, onChange }) {
  const [code, setCode] = useState("");
  const [card, setCard] = useState(null);
  const [busy, setBusy] = useState(false);
  const [key] = useState(() => newKey("gift"));
  const check = async () => {
    setBusy(true);
    try { setCard(await api.giftLookup(code)); } catch (e) { setCard(null); toast.error(apiError(e)); }
    setBusy(false);
  };
  const amount = card ? Math.min(card.balance.cents, invoice.balance.cents) : 0;
  const apply = async () => {
    setBusy(true);
    try { onChange(await api.redeemGiftcard(invoice.id, { code, amountCents: amount, idempotencyKey: key })); toast.success("Gift card applied"); setCard(null); setCode(""); }
    catch (e) { toast.error(apiError(e)); }
    setBusy(false);
  };
  return (
    <div className="rounded-2xl p-4 tint-meadow" data-testid="billing-giftcard-apply">
      <p className="flex items-center gap-2 text-sm font-semibold text-nb-navy"><Gift className="h-4 w-4" />Use a gift card</p>
      <div className="mt-3 flex gap-2">
        <input value={code} onChange={(e) => { setCode(e.target.value.toUpperCase()); setCard(null); }} placeholder="NABI-XXXX-XXXX" data-testid="billing-giftcard-code" className="nb-input h-11 flex-1 font-mono uppercase" />
        <button type="button" onClick={check} disabled={busy || code.length < 8} data-testid="billing-giftcard-check" className="nb-btn-ghost h-11 text-sm">{busy && !card ? <Loader2 className="h-4 w-4 animate-spin" /> : "Check"}</button>
      </div>
      {card && (
        <div className="mt-3 flex items-center justify-between gap-3" data-testid="billing-giftcard-result">
          <p className="text-xs text-nb-mute">Card ••{card.last4} · {card.status} · balance <b className="text-nb-ink">{card.balance.display}</b></p>
          {card.status === "active" && amount > 0 && <button type="button" onClick={apply} disabled={busy} data-testid="billing-giftcard-apply-btn" className="nb-btn-primary h-10 text-sm">Apply ${(amount / 100).toFixed(2)}</button>}
        </div>
      )}
    </div>
  );
}
