import { useCallback, useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { toast } from "sonner";
import { ArrowLeft, CalendarCheck, Layers, Loader2, Repeat, Sparkles } from "lucide-react";
import { api, apiError } from "@/lib/api";
import { useDemo } from "@/store/DemoStore";
import { EmptyState, Notice, PageHeader, Reveal } from "@/components/tide";
const fmtDate = (iso) => new Date(`${iso}T12:00:00`).toLocaleDateString("en-CA", { month: "short", day: "numeric", year: "numeric" });

const key = () => `plan-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

function CreditCardTile({ g, i }) {
  const total = g.available + g.reserved + g.consumed;
  return (
    <Reveal i={i}>
      <div className="relative overflow-hidden rounded-[28px] p-5 text-white nb-lagoon" data-testid={`plan-wallet-${g.serviceSlug}-${g.duration}`}>
        <span className="absolute -right-10 -top-10 h-36 w-36 rounded-full bg-white/10 nb-breathe" />
        <p className="text-xs font-semibold uppercase tracking-widest text-white/70">{g.duration} min</p>
        <p className="mt-1 text-lg font-semibold">{g.serviceName}</p>
        <p className="mt-6 text-4xl font-semibold tabular-nums" data-testid={`plan-available-${g.serviceSlug}-${g.duration}`}>{g.available}<span className="text-base font-normal text-white/70"> credit{g.available === 1 ? "" : "s"} left</span></p>
        <div className="mt-3 flex gap-1">{Array.from({ length: Math.min(total, 24) }).map((_, n) => <span key={n} className={`h-1.5 flex-1 rounded-full ${n < g.consumed ? "bg-white/25" : n < g.consumed + g.reserved ? "bg-amber-200" : "bg-white"}`} />)}</div>
        <p className="mt-3 text-xs text-white/80">{g.reserved ? `${g.reserved} held for a booked visit · ` : ""}{g.nextExpiry ? `Next expiry ${fmtDate(g.nextExpiry.slice(0, 10))}` : "No unused credits"}</p>
      </div>
    </Reveal>
  );
}

function PlanOffer({ p, enabled, onBuy, busy }) {
  const saving = p.regularCents > p.priceCents ? p.regularCents - p.priceCents : 0;
  const member = p.kind === "membership";
  return (
    <div className="nb-card flex flex-col p-5" data-testid={`plan-offer-${p.id}`}>
      <div className="flex items-center gap-2"><span className={`grid h-9 w-9 place-items-center rounded-2xl ${member ? "tint-mint text-nb-teal" : "tint-lagoon text-nb-blue"}`}>{member ? <Repeat className="h-4 w-4" /> : <Layers className="h-4 w-4" />}</span><p className="text-xs font-semibold uppercase tracking-widest text-nb-mute">{member ? "Monthly membership" : "Prepaid package"}</p></div>
      <p className="mt-3 text-lg font-semibold">{p.name}</p>
      <p className="text-sm text-nb-mute">{p.credits} × {p.serviceName} {p.duration} min{member ? " every month" : ""}</p>
      {p.description && <p className="mt-2 text-xs text-nb-mute">{p.description}</p>}
      <p className="mt-4 text-3xl font-semibold tabular-nums">{p.price.display}<span className="text-sm font-normal text-nb-mute">{member ? " / month" : ""} + GST</span></p>
      <p className="text-xs text-nb-mute">{p.perCredit.display} per visit{saving ? <b className="ml-1 text-nb-teal">· save ${(saving / 100).toFixed(2)}</b> : null} · valid {p.validityDays} days</p>
      <button type="button" disabled={!enabled || busy} onClick={() => onBuy(p)} data-testid={`plan-buy-${p.id}`} className="nb-btn-primary mt-5 h-11 text-sm">{busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}{member ? "Subscribe (test mode)" : "Buy package (test mode)"}</button>
    </div>
  );
}

function Memberships({ rows, onCancel }) {
  if (!rows.length) return null;
  return (
    <section className="space-y-2" data-testid="plan-memberships">
      <h2 className="text-lg font-semibold">Memberships</h2>
      {rows.map((m) => (
        <div key={m.id} className="nb-card flex items-center gap-4 p-4" data-testid={`plan-membership-${m.id}`}>
          <Repeat className="h-5 w-5 text-nb-teal" />
          <div className="min-w-0 flex-1"><p className="text-sm font-semibold">{m.productName}</p><p className="text-xs text-nb-mute">{m.creditsPerCycle} × {m.serviceName} {m.duration} min each month · {m.status}{m.status === "canceled" ? "" : m.cancelAtPeriodEnd ? " · ends at period end" : m.currentPeriodEnd ? ` · renews ${fmtDate(m.currentPeriodEnd.slice(0, 10))}` : ""}</p></div>
          {["active", "past_due"].includes(m.status) && !m.cancelAtPeriodEnd && <button type="button" onClick={() => onCancel(m)} data-testid={`plan-cancel-${m.id}`} className="nb-btn-ghost h-9 px-4 text-xs">Cancel</button>}
        </div>
      ))}
    </section>
  );
}

export default function ClientPlans() {
  const { me } = useDemo();
  const [params, setParams] = useSearchParams();
  const [mine, setMine] = useState(undefined);
  const [offers, setOffers] = useState(null);
  const [busy, setBusy] = useState(null);
  const load = useCallback(() => {
    api.plansMine().then(setMine).catch(() => setMine({ wallet: [], purchases: [], memberships: [], history: [], totals: {} }));
    api.plansPublished().then(setOffers).catch(() => setOffers({ products: [], checkoutEnabled: false }));
  }, []);
  useEffect(() => { if (me) load(); }, [me, load]);
  useEffect(() => {
    const sid = params.get("session_id");
    if (params.get("plan") === "cancel") { toast.message("Checkout cancelled. Nothing was charged."); setParams({}, { replace: true }); }
    if (params.get("plan") !== "return" || !sid) return;
    let tries = 0;
    const poll = () => api.planReturn(sid).then((r) => {
      if (r.confirmed) { toast.success("Payment confirmed. Your credits are ready."); setParams({}, { replace: true }); load(); }
      else if (++tries < 6) setTimeout(poll, 2000);
      else toast.message("Stripe has not confirmed the payment yet. Credits appear once it does.");
    }).catch(() => {});
    poll();
  }, [params, setParams, load]);
  if (!me) return <div className="mx-auto max-w-xl px-5 py-16 text-center"><Link to="/login?next=/me/plans" className="nb-btn-primary" data-testid="plans-signin-link">Sign in to see wellness plans</Link></div>;
  const buy = async (p) => {
    setBusy(p.id);
    try {
      const res = p.kind === "membership" ? await api.planSubscribe(p.id, key()) : await api.planCheckout(p.id, key());
      if (res.url) window.location.assign(res.url); else { toast.message("Checkout started. Credits are issued only after Stripe confirms payment."); load(); }
    } catch (e) { toast.error(apiError(e)); }
    setBusy(null);
  };
  const cancel = (m) => api.planCancelMembership(m.id).then(() => { toast.success("Membership will end at the close of this period. Unused credits stay until they expire."); load(); }).catch((e) => toast.error(apiError(e)));
  return (
    <div className="mx-auto max-w-5xl space-y-10 px-5 py-8 nb-page" data-testid="client-plans-page">
      <div>
        <Link to="/me" data-testid="plans-back" className="mb-4 inline-flex items-center gap-1 text-sm text-nb-mute"><ArrowLeft className="h-4 w-4" />My Nabitouch</Link>
        <PageHeader eyebrow="Wellness plans" title="Your treatment credits" sub={mine?.totals?.available ? `${mine.totals.available} credit${mine.totals.available === 1 ? "" : "s"} ready to book.` : "Prepaid packages and memberships, used one visit at a time."} />
      </div>
      <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3" data-testid="plan-wallet">
        {mine === undefined && [0, 1, 2].map((n) => <div key={n} className="h-48 rounded-[28px] nb-skeleton" />)}
        {mine?.wallet.map((g, i) => <CreditCardTile key={`${g.serviceSlug}-${g.duration}`} g={g} i={i} />)}
      </section>
      {mine?.wallet.length === 0 && <EmptyState icon={Sparkles} testid="plans-empty" title="No credits yet" body="Choose a package or membership below. Credits are held when you book and used when the visit is completed." />}
      {mine?.totals?.available > 0 && <Link to="/book" data-testid="plans-book-link" className="nb-btn-primary inline-flex h-12 px-6"><CalendarCheck className="h-4 w-4" />Book with a credit</Link>}
      <Memberships rows={mine?.memberships || []} onCancel={cancel} />
      <section data-testid="plan-offers">
        <h2 className="mb-1 text-xl font-semibold">Plans you can start</h2>
        <p className="mb-5 text-sm text-nb-mute">Credits cover the treatment price. Enhancements and travel are paid at the visit. Plans do not combine with other discounts.</p>
        {!offers?.checkoutEnabled && offers && <Notice testid="plans-checkout-off">Card checkout is turned off right now.</Notice>}
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">{offers?.products.map((p) => <PlanOffer key={p.id} p={p} enabled={offers.checkoutEnabled} onBuy={buy} busy={busy === p.id} />)}</div>
        {offers?.products.length === 0 && <p className="text-sm text-nb-mute">No plans are on offer right now.</p>}
      </section>
      {mine?.history?.length > 0 && (
        <section data-testid="plan-history"><h2 className="mb-3 text-lg font-semibold">Credit history</h2>
          <div className="nb-card divide-y divide-sky-100">{mine.history.map((h) => <div key={h.id} className="flex justify-between gap-3 px-4 py-3 text-sm"><span className="capitalize">{h.type.replace("_", " ")}{h.note ? <span className="text-xs text-nb-mute"> · {h.note}</span> : null}</span><span className="text-xs text-nb-mute">{fmtDate(h.at.slice(0, 10))}</span></div>)}</div>
        </section>
      )}
      <p className="text-[11px] text-nb-mute">Stripe test mode. A plan is prepaid for future visits; it is not a gift card, reward or insurance benefit.</p>
    </div>
  );
}
