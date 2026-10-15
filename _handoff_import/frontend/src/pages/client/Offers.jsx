import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Clock, Zap } from "lucide-react";
import { toast } from "sonner";
import { CatalogueImage } from "@/components/ui-kit";
import { EmptyState, PageHeader, Reveal } from "@/components/tide";
import { useDemo } from "@/store/DemoStore";

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
  const { api, patchDraft, user } = useDemo();
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

  return (
    <div className="mx-auto max-w-3xl space-y-4 px-5 pt-6" data-testid="client-offers">
      <PageHeader eyebrow="Flash booking" title="Last-minute openings" sub="Times and remaining spots come from Nabitouch. The countdown displays the server expiry." />
      {campaigns.length === 0 && <EmptyState icon={Zap} title="No live offers right now" body="When an opening is published it appears here first." testid="offers-empty" />}
      {campaigns.map((row, index) => {
        const ms = left(row.expiresAt, serverTime, fetchedAt);
        const expired = ms <= 0;
        return (
          <Reveal key={row.id} i={index} className="nb-card overflow-hidden">
            <article data-testid={`offer-${row.id}`} className="grid sm:grid-cols-[180px_1fr]">
              <div className="relative h-36 sm:h-full">
                <CatalogueImage src={row.image} alt="" className="absolute inset-0 h-full w-full object-cover" />
                <span className="absolute left-3 top-3 grid h-8 place-items-center rounded-full px-3 font-display text-lg text-white nb-lagoon">−{row.discountPercent}%</span>
              </div>
              <div className="p-5">
                <span className="inline-flex h-6 items-center gap-1 rounded-full bg-nb-coral/10 px-2.5 text-[11px] font-semibold text-nb-coral ring-1 ring-inset ring-nb-coral/25"><Clock className="h-3 w-3" />{expired ? "Expired" : "Ends in"} <span className="nb-num" data-tick={tick}>{expired ? "" : clock(ms)}</span></span>
                <p className="mt-2 text-lg font-semibold">{row.title}</p>
                <p className="text-sm text-nb-mute">{row.description}</p>
                <p className="mt-2 text-sm text-nb-mute">{row.discountPercent}% off · {row.bookingStart} · {row.windowStart}–{row.windowEnd}</p>
                <p className="text-sm" data-testid={`offer-spots-${row.id}`}>{row.soldOut ? "Sold out" : `${row.remaining} discounted spots left`}</p>
                {!expired && !row.soldOut && (
                  <Link to="/book" className="nb-btn-primary mt-4 inline-flex h-11 px-5 text-sm" data-testid={`offer-book-${row.id}`} onClick={() => patchDraft({ campaignId: row.id, serviceSlug: row.serviceSlug === "all" ? "swedish" : row.serviceSlug, duration: row.minDuration || 60, date: row.bookingStart, idempotencyKey: `cmp-${row.id}-${Date.now()}` })}><Zap className="h-4 w-4" />See route-feasible times</Link>
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
