import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Clock, Zap } from "lucide-react";
import { toast } from "sonner";
import { CatalogueImage } from "@/components/ui-kit";
import { EmptyState, PageHeader, Reveal } from "@/components/tide";
import { useDemo } from "@/store/DemoStore";
import { promoBannerCopy, trialCampaignListed, welcomeOfferListed } from "@/lib/domain";

function left(expiresAt, serverTime, fetchedAt) {
  if (!expiresAt || !serverTime) return 0;
  const skew = fetchedAt - new Date(serverTime).getTime();
  return Math.max(0, new Date(expiresAt).getTime() - (Date.now() - skew));
}

function clock(ms) {
  const total = Math.floor(ms / 1000);
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

export default function Offers() {
  const { api, patchDraft, user, state } = useDemo();
  const [campaigns, setCampaigns] = useState([]);
  const [offers, setOffers] = useState([]);
  const [serverTime, setServerTime] = useState("");
  const [fetchedAt, setFetchedAt] = useState(Date.now());
  const [tick, setTick] = useState(0);

  const load = async () => {
    const body = await api.publicCampaigns();
    setCampaigns(body.campaigns || []);
    setServerTime(body.serverTime || "");
    setFetchedAt(Date.now());
    if (user?.role === "client") {
      const mine = await api.myOffers();
      setOffers(mine.offers || []);
    }
  };
  useEffect(() => { load().catch(() => toast.error("Offers could not be loaded")); }, [user?.role]); // eslint-disable-line
  useEffect(() => {
    const timer = setInterval(() => setTick((value) => value + 1), 1000);
    const refresh = setInterval(() => { load().catch(() => {}); }, 15000);
    return () => { clearInterval(timer); clearInterval(refresh); };
  }, []); // eslint-disable-line

  const respond = async (id, decision) => {
    try {
      const body = await api.respondOffer(id, decision);
      if (body.status === "held") toast.message("Hold started. Complete booking to confirm. Opening this page does not reserve the time.");
      else toast.success(decision === "decline" ? "Offer declined" : "Earlier time confirmed");
      await load();
    } catch (error) {
      toast.error(error?.response?.data?.detail || "That offer is no longer available");
    }
  };

  const welcome = (state.promotions || []).find((promo) => promo.id === "promo-welcome");
  const welcomeVisible = welcomeOfferListed(welcome, "offers");
  const welcomeCopy = promoBannerCopy(welcome);
  const trialOffers = campaigns.filter((row) => trialCampaignListed(row, "offers"));
  const flashOffers = campaigns.filter((row) => row.offerKind !== "trial" && row.showOffers !== false);
  const empty = trialOffers.length === 0 && flashOffers.length === 0 && !welcomeVisible && offers.length === 0;

  return (
    <div className="mx-auto max-w-3xl space-y-4 px-5 pt-6" data-testid="client-offers">
      <PageHeader eyebrow="Offers" title="Ways to start with Nabitouch" sub="Free introductory trial and first-booking savings appear here when they are live." />

      {welcomeVisible && (
        <Reveal className="nb-card overflow-hidden" data-testid="welcome-offer-card">
          <article className="p-5">
            <p className="text-[11px] font-bold uppercase tracking-[0.16em] text-nb-blue">20% off</p>
            <p className="mt-1 text-lg font-semibold" data-testid="welcome-offer-title">{welcomeCopy.headline}</p>
            <p className="mt-1 text-sm text-nb-mute" data-testid="welcome-offer-body">{welcomeCopy.body}</p>
            <p className="mt-2 text-sm text-nb-mute">Applies to your first eligible regular app booking. The 10-minute trial does not use this offer.</p>
            <Link to="/book" className="nb-btn-primary mt-4 inline-flex h-11 px-5 text-sm" data-testid="welcome-offer-cta">{welcomeCopy.cta}</Link>
          </article>
        </Reveal>
      )}

      {trialOffers.length > 0 && (
        <section className="space-y-3" data-testid="trial-offers">
          {trialOffers.map((row, index) => {
            const ms = left(row.expiresAt, serverTime, fetchedAt);
            const expired = ms <= 0;
            return (
              <Reveal key={row.id} i={index} className="nb-card overflow-hidden">
                <article data-testid={`offer-${row.id}`} className="p-5">
                  <p className="text-[11px] font-bold uppercase tracking-[0.16em] text-nb-teal">Free trial</p>
                  <p className="mt-1 text-lg font-semibold" data-testid={`trial-title-${row.id}`}>{row.headline || "Try Nabitouch. 10 Minutes. On Us."}</p>
                  <p className="text-sm text-nb-mute" data-testid={`trial-subhead-${row.id}`}>{row.subhead || "Experience a free 10-minute neck-and-shoulder massage."}</p>
                  <p className="mt-1 text-sm text-nb-mute">{row.body || row.description || "Meet your therapist, feel the difference, and discover Nabitouch."}</p>
                  <p className="mt-2 text-sm text-nb-mute">$0 · {row.durationMinutes || row.complimentaryMinutes || 10} min · neck and shoulders · {(row.locationTypes || ["clinic"]).join(", ")}</p>
                  <p className="text-sm" data-testid={`offer-spots-${row.id}`}>{row.soldOut ? "Fully booked" : expired ? "Offer ended" : `${row.remaining} openings left`}</p>
                  {!expired && !row.soldOut ? (
                    <Link
                      to="/book"
                      className="nb-btn-primary mt-4 inline-flex h-11 px-5 text-sm"
                      data-testid={`offer-book-${row.id}`}
                      onClick={() => patchDraft({
                        campaignId: row.id,
                        serviceSlug: row.serviceSlug || "ten-minutes-on-us",
                        duration: row.durationMinutes || row.complimentaryMinutes || 10,
                        locationType: (row.locationTypes || ["clinic"])[0] || "clinic",
                        practitionerId: row.practitionerId || undefined,
                        date: row.bookingStart,
                        step: 0,
                        idempotencyKey: `cmp-${row.id}-${Date.now()}`,
                      })}
                    >{row.ctaLabel || "Claim my free 10 minutes"}</Link>
                  ) : (
                    <p className="mt-3 text-sm text-nb-mute" data-testid={`offer-unavailable-${row.id}`}>
                      This trial is not available right now. <Link to="/book" className="font-semibold text-nb-blue underline">Book a regular massage</Link>
                    </p>
                  )}
                </article>
              </Reveal>
            );
          })}
        </section>
      )}

      {(flashOffers.length > 0 || (trialOffers.length === 0 && !welcomeVisible)) && (
        <PageHeader eyebrow="Flash booking" title="Last-minute openings" sub="Times and remaining spots come from Nabitouch. The countdown displays the server expiry." />
      )}
      {empty && <EmptyState icon={Zap} title="No live offers right now" body="When an opening is published it appears here first." testid="offers-empty" />}
      {flashOffers.length === 0 && (trialOffers.length > 0 || welcomeVisible) && <p className="text-sm text-nb-mute" data-testid="flash-offers-empty">No flash openings right now.</p>}
      {flashOffers.map((row, index) => {
        const ms = left(row.expiresAt, serverTime, fetchedAt);
        const expired = ms <= 0;
        return (
          <Reveal key={row.id} i={index} className="nb-card overflow-hidden">
            <article data-testid={`offer-${row.id}`} className="grid sm:grid-cols-[180px_1fr]">
              <div className="relative h-36 sm:h-full">
                <CatalogueImage src={row.image} alt="" className="absolute inset-0 h-full w-full object-cover" />
                <span className="absolute left-3 top-3 grid h-8 place-items-center rounded-full px-3 font-display text-lg text-white nb-lagoon">
                  {row.offerKind === "complimentary" ? "Free" : row.offerKind === "fixed" ? `−$${row.discountFixed}` : `−${row.discountPercent}%`}
                </span>
              </div>
              <div className="p-5">
                <span className="inline-flex h-6 items-center gap-1 rounded-full bg-nb-coral/10 px-2.5 text-[11px] font-semibold text-nb-coral ring-1 ring-inset ring-nb-coral/25"><Clock className="h-3 w-3" />{expired ? "Expired" : "Ends in"} <span className="nb-num" data-tick={tick}>{expired ? "" : clock(ms)}</span></span>
                <p className="mt-2 text-lg font-semibold">{row.title}</p>
                <p className="text-sm text-nb-mute">{row.description}</p>
                <p className="mt-2 text-sm text-nb-mute">
                  {row.offerKind === "complimentary"
                    ? `Complimentary ${row.complimentaryMinutes || 10} min in-clinic`
                    : row.offerKind === "fixed"
                      ? `$${row.discountFixed} off`
                      : `${row.discountPercent}% off`}
                  {" · "}{row.bookingStart} · {row.windowStart}–{row.windowEnd}
                </p>
                <p className="text-sm" data-testid={`offer-spots-${row.id}`}>{row.soldOut ? "Sold out" : `${row.remaining} spots left`}</p>
                {!expired && !row.soldOut && (
                  <Link
                    to="/book"
                    className="nb-btn-primary mt-4 inline-flex h-11 px-5 text-sm"
                    data-testid={`offer-book-${row.id}`}
                    onClick={() => patchDraft({
                      campaignId: row.id,
                      serviceSlug: row.serviceSlug === "all" ? "swedish" : row.serviceSlug,
                      duration: row.offerKind === "complimentary" ? (row.complimentaryMinutes || 10) : (row.minDuration || 60),
                      locationType: row.offerKind === "complimentary" || (row.locationTypes || []).includes("clinic") ? "clinic" : undefined,
                      date: row.bookingStart,
                      idempotencyKey: `cmp-${row.id}-${Date.now()}`,
                    })}
                  ><Zap className="h-4 w-4" />See route-feasible times</Link>
                )}
              </div>
            </article>
          </Reveal>
        );
      })}
      {offers.length > 0 && (
        <section className="mt-8 space-y-3" data-testid="earlier-offers">
          <h2 className="text-lg font-semibold">Earlier openings</h2>
          {offers.map((offer) => (
            <article key={offer.caseId} className="nb-card p-5">
              <p className="font-semibold">{offer.date} at {offer.time} · {offer.duration} min</p>
              <p className="text-sm text-nb-mute">{offer.kind === "exclusive" ? "This offer is only for you until it expires." : "The first completed booking gets this opening."}</p>
              <div className="mt-3 flex gap-2">
                <button type="button" className="nb-btn-primary h-10 px-4 text-sm" onClick={() => respond(offer.caseId, "accept")}>Accept</button>
                <button type="button" className="nb-btn-ghost h-10 px-4 text-sm" onClick={() => respond(offer.caseId, "decline")}>Decline</button>
              </div>
            </article>
          ))}
        </section>
      )}
    </div>
  );
}
