import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { ArrowLeft, Gift } from "lucide-react";
import { EmptyState, Notice, PageHeader, Reveal } from "@/components/tide";
import { GiftCardArt } from "@/components/giftcards/GiftCardArt";
import { GiftCardDrawer } from "@/components/giftcards/GiftCardDrawer";
import { GiftPurchase } from "@/components/giftcards/GiftPurchase";
import { GiftCardPay } from "@/components/giftcards/GiftCardPay";
import { api } from "@/lib/api";
import { useDemo } from "@/store/DemoStore";

export default function ClientGiftCards() {
  const { me, idx } = useDemo();
  const cardsOn = idx?.settings?.giftCardsEnabled === true && idx?.settings?.cardCheckoutEnabled === true;
  const [cards, setCards] = useState(undefined);
  const [config, setConfig] = useState(null);
  const [error, setError] = useState("");
  const [openId, setOpenId] = useState(null);
  const load = useCallback(() => {
    api.giftMine().then(setCards).catch(() => { setCards([]); setError("Gift cards could not be loaded."); });
    api.giftConfig().then(setConfig).catch(() => setConfig({ enabled: false, products: [] }));
  }, []);
  useEffect(() => { if (me) load(); }, [me, load]);
  if (!me) return <div className="mx-auto max-w-xl px-5 py-16 text-center"><Link to="/login" className="nb-btn-primary" data-testid="gifts-signin-link">Sign in to see gift cards</Link></div>;
  const active = (cards || []).find((c) => c.id === openId);
  const total = (cards || []).filter((c) => c.status === "active" && !c.isPurchaser).reduce((a, c) => a + c.balance.cents, 0);
  return (
    <div className="mx-auto max-w-5xl px-5 py-8 nb-page" data-testid="client-giftcards-page">
      <Link to="/me" data-testid="gifts-back" className="mb-4 inline-flex items-center gap-1 text-sm text-nb-mute"><ArrowLeft className="h-4 w-4" />My Nabitouch</Link>
      <PageHeader eyebrow="Gift cards" title="Gifts of calm" sub={total ? `You have $${(total / 100).toFixed(2)} available to use on visits.` : "Balances and history come from the Nabitouch gift-card ledger."} />
      {error && <Notice testid="gifts-error">{error}</Notice>}
      <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3" data-testid="gift-wallet">
        {cards === undefined && [0, 1, 2].map((n) => <div key={n} className="aspect-[1.6] rounded-[28px] nb-skeleton" />)}
        {cards?.map((c, i) => (
          <Reveal key={c.id} i={i}>
            <GiftCardArt card={c} onClick={() => setOpenId(c.id)} testid={`gift-card-${c.id}`} />
            <p className="mt-2 px-1 text-xs text-nb-mute">{c.isPurchaser ? `You sent this to ${c.recipientName}` : `From ${c.purchaserName || "Nabitouch"}`}</p>
          </Reveal>
        ))}
      </section>
      {cards?.length === 0 && <EmptyState icon={Gift} testid="gifts-empty" title="No gift cards yet" body="Cards you receive or send will appear here." />}
      <section className="mt-12" data-testid="gift-send-section">
        <h2 className="mb-1 text-xl font-semibold">Send a gift card</h2>
        <p className="mb-5 text-sm text-nb-mute">Pick a design and an amount. Usable on any Nabitouch visit.</p>
        {config ? <GiftPurchase config={config} onDone={load} /> : <div className="h-64 rounded-3xl nb-skeleton" />}
      </section>
      <GiftCardDrawer card={active} open={Boolean(active)} onOpenChange={(o) => !o && setOpenId(null)}>{active && <GiftCardPay card={active} cardsOn={cardsOn} />}</GiftCardDrawer>
    </div>
  );
}
