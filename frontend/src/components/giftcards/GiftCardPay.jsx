import { useState } from "react";
import { toast } from "sonner";
import { CreditCard, Loader2 } from "lucide-react";
import { api, apiError } from "@/lib/api";

export function GiftCardPay({ card, cardsOn }) {
  const [busy, setBusy] = useState(false);
  if (card.status !== "pending_payment" || !card.isPurchaser) return null;
  const pay = async () => {
    setBusy(true);
    try {
      const started = await api.giftCheckout(card.id);
      if (started.url) window.location.assign(started.url);
      else toast.message("Checkout started. The card activates only after Stripe confirms payment.");
    } catch (e) { toast.error(apiError(e)); }
    setBusy(false);
  };
  return (
    <div className="mt-5 rounded-2xl p-4 tint-ice" data-testid="gift-pay">
      <p className="text-sm font-semibold text-nb-navy">Awaiting payment</p>
      <p className="mt-1 text-xs text-nb-mute">The card has no balance until payment is confirmed by Stripe or by Nabitouch for cash or e-Transfer.</p>
      {cardsOn
        ? <button type="button" onClick={pay} disabled={busy} data-testid="gift-pay-card-btn" className="nb-btn-primary mt-3 h-11 w-full text-sm">{busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <CreditCard className="h-4 w-4" />}Pay {card.amount.display} by card (test mode)</button>
        : <p className="mt-2 text-xs font-medium text-cyan-800" data-testid="gift-pay-card-off">Card payment opens once checkout is approved.</p>}
    </div>
  );
}
