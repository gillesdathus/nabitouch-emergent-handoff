import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Zap, Clock, Megaphone } from "lucide-react";
import { usePreview } from "@/store/PreviewStore";
import { Reveal, Pill, EmptyState, Notice, PageHeader } from "@/components/ui-kit";
import { money, timeLabel, fmtDate } from "@/lib/domain";

export function useCountdown(iso) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  if (!iso) return "";
  const ms = Math.max(0, new Date(iso).getTime() - now);
  const h = Math.floor(ms / 3600e3), m = Math.floor((ms % 3600e3) / 60e3), s = Math.floor((ms % 60e3) / 1e3);
  return h > 47 ? `${Math.floor(h / 24)}d ${h % 24}h` : `${h}h ${String(m).padStart(2, "0")}m ${String(s).padStart(2, "0")}s`;
}

function OfferCard({ c, i }) {
  const { svc } = usePreview();
  const nav = useNavigate();
  const s = svc(c.serviceId);
  const left = useCountdown(c.expiresAt);
  const now = +(s.price * (1 - c.discountPercent / 100)).toFixed(2);
  return (
    <Reveal i={i} className="nb-card overflow-hidden" >
      <div data-testid={`offer-card-${c.id}`} className="grid sm:grid-cols-[220px_1fr]">
        <div className="relative h-40 sm:h-full">
          <img src={s.img} alt={s.name} className="absolute inset-0 h-full w-full object-cover" />
          <span className="absolute top-3 left-3 rounded-full nb-lagoon text-white px-3 h-8 grid place-items-center font-display text-lg">−{c.discountPercent}%</span>
        </div>
        <div className="p-5">
          <Pill tone="bg-nb-coral/10 text-nb-coral ring-nb-coral/25"><Clock className="h-3 w-3" />Ends in <span className="nb-num" data-testid={`offer-countdown-${c.id}`}>{left}</span></Pill>
          <p className="text-lg font-semibold mt-2">{c.name}</p>
          <p className="text-sm text-nb-mute">{s.name} · {fmtDate(c.bookingStart)} · {timeLabel(c.windowStart)}–{timeLabel(c.windowEnd)}</p>
          <div className="flex items-end justify-between mt-4">
            <p><span className="text-2xl font-semibold nb-num">{money(now)}</span> <span className="text-sm text-nb-mute line-through nb-num">{money(s.price)}</span><span className="block text-[11px] text-nb-mute">+ travel and GST, shown at review</span></p>
            <button data-testid={`offer-book-${c.id}`} onClick={() => nav(`/book?campaign=${c.id}`)} className="nb-btn-primary h-11 px-5 text-sm"><Zap className="h-4 w-4" />Book now</button>
          </div>
        </div>
      </div>
    </Reveal>
  );
}

export default function Offers() {
  const { db, role } = usePreview();
  const live = db.campaigns.filter((c) => c.status === "live" && new Date(c.expiresAt) > new Date());
  return (
    <div className="max-w-3xl mx-auto px-5 pt-6 space-y-4">
      <PageHeader eyebrow="Flash booking" title="Last-minute openings" sub="Time-limited offers on real open slots." />
      {role === "guest" && <Notice tone="info" icon={Megaphone}>Offers are available to signed-in clients. <Link to="/login" className="font-semibold underline">Sign in</Link> to claim one.</Notice>}
      {live.length === 0 ? <EmptyState icon={Zap} title="No live offers right now" body="When an opening is published it appears here first." testid="offers-empty" /> : live.map((c, i) => <OfferCard key={c.id} c={c} i={i} />)}
    </div>
  );
}
