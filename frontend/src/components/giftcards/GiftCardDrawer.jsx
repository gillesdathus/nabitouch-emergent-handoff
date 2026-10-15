import { Drawer, DrawerContent, DrawerDescription, DrawerTitle } from "@/components/ui/drawer";
import { GiftCardArt } from "@/components/giftcards/GiftCardArt";

const TX = { issue: "Issued", redemption: "Redeemed", void: "Voided", refund: "Refunded", reversal: "Reversed" };

export function GiftTransactions({ rows }) {
  if (!rows?.length) return <p className="text-sm text-nb-mute">No transactions yet.</p>;
  return (
    <ol className="relative space-y-3 border-l-2 border-dashed border-sky-100 pl-4" data-testid="gift-transactions">
      {rows.map((t) => (
        <li key={t.id} className="relative" data-testid={`gift-tx-${t.id}`}>
          <span className={`absolute -left-[23px] top-1 h-3 w-3 rounded-full ring-4 ring-white ${t.type === "redemption" ? "bg-nb-blue" : t.type === "issue" ? "bg-nb-teal" : "bg-amber-500"}`} />
          <div className="flex items-baseline justify-between gap-3">
            <p className="text-sm font-medium">{TX[t.type] || t.type}{t.status === "reversed" ? " (reversed)" : ""}</p>
            <p className={`nb-num text-sm font-semibold ${t.type === "redemption" ? "text-nb-ink" : "text-nb-teal"}`}>{t.type === "redemption" ? "−" : ""}{t.amount.display}</p>
          </div>
          <p className="text-xs text-nb-mute">{new Date(t.at).toLocaleString("en-CA", { dateStyle: "medium", timeStyle: "short" })}{t.reference ? ` · ${t.reference}` : ""}{t.by ? ` · ${t.by}` : ""}</p>
        </li>
      ))}
    </ol>
  );
}

export function GiftCardDrawer({ card, open, onOpenChange, children }) {
  return (
    <Drawer open={open} onOpenChange={onOpenChange}>
      <DrawerContent className="mx-auto max-h-[92vh] max-w-xl rounded-t-[32px] border-0 bg-nb-canvas" data-testid="gift-drawer">
        {card && (
          <div className="overflow-y-auto px-5 pb-8 pt-3">
            <DrawerTitle className="sr-only">Gift card ••{card.last4}</DrawerTitle>
            <DrawerDescription className="sr-only">Balance and transaction history</DrawerDescription>
            <GiftCardArt card={card} testid="gift-drawer-art" />
            <dl className="mt-5 grid grid-cols-2 gap-3 text-sm">
              {[["Recipient", card.recipientName || "—"], ["From", card.purchaserName || "Nabitouch"], ["Status", card.status.replace("_", " ")], ["Delivery", card.delivery?.status === "sent" ? "Emailed" : "Not emailed"]].map(([k, v]) => (
                <div key={k} className="rounded-2xl bg-white p-3 ring-1 ring-sky-100"><dt className="text-[11px] text-nb-mute">{k}</dt><dd className="font-medium capitalize">{v}</dd></div>
              ))}
            </dl>
            {card.message && <p className="mt-3 rounded-2xl p-3 text-sm italic text-nb-navy tint-ice">“{card.message}”</p>}
            {children}
            <p className="nb-eyebrow mb-3 mt-6">History</p>
            <GiftTransactions rows={card.transactions} />
          </div>
        )}
      </DrawerContent>
    </Drawer>
  );
}
