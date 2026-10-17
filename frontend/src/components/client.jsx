import { Link } from "react-router-dom";
import { motion } from "framer-motion";
import { ArrowRight, Gift, Home as HomeIcon, Building2 } from "lucide-react";
import { money, clinicBookable } from "@/lib/domain";
import { useDemo } from "@/store/DemoStore";
import { CatalogueImage } from "@/components/ui-kit";

export function PromoBanner({ compact, eligible = true, testid = "promo-banner" }) {
  if (!eligible) return null;
  return (
    <div data-testid={testid} className={`relative overflow-hidden rounded-3xl bg-nb-ink text-white ${compact ? "p-4" : "p-6 sm:p-8"}`}>
      <div className="nb-breathe absolute -right-16 -top-16 h-56 w-56 rounded-full bg-[radial-gradient(circle,#14D8C470,transparent_65%)]" aria-hidden="true" />
      <div className="relative flex items-center gap-4">
        <span className="nb-gradient flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl"><Gift className="h-6 w-6" /></span>
        <div className="min-w-0">
          <p className={`font-bold tracking-tight ${compact ? "text-sm" : "text-lg sm:text-xl"}`}>First-booking welcome offer</p>
          <p className={`text-cyan-100/90 ${compact ? "text-xs" : "text-sm"}`}>20% off the treatment price of a qualifying first booking, up to $40. Travel and GST are calculated separately.</p>
          {!compact && <p className="mt-1 text-[11px] text-white/60">Nabitouch confirms eligibility when you submit. This offer is not combined with other discounts, rewards, or referrals.</p>}
        </div>
      </div>
    </div>
  );
}

export function ServiceCard({ s, i = 0, eligible }) {
  const { idx } = useDemo();
  const clinicOpen = clinicBookable(idx?.settings?.clinic);
  const durs = Object.keys(s.prices);
  const from = Math.min(...Object.values(s.prices));
  return (
    <motion.div initial={{ opacity: 0, y: 16 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true, margin: "-40px" }} transition={{ delay: (i % 4) * 0.06, duration: 0.4 }}>
      <Link to={`/services/${s.slug}`} data-testid={`service-card-${s.slug}`} className="group nb-card block overflow-hidden transition-transform duration-300 hover:-translate-y-1 active:scale-[0.98]">
        <div className="relative aspect-[4/3] overflow-hidden">
          <CatalogueImage src={s.img} alt={s.name} size="thumb" className="h-full w-full object-cover transition-transform duration-700 group-hover:scale-105" />
          <div className="absolute inset-0 bg-gradient-to-t from-nb-ink/60 via-transparent to-transparent" />
          <div className="absolute bottom-3 left-3 flex gap-1.5">
            {s.mobile && <span className="flex items-center gap-1 rounded-full bg-white/90 px-2.5 py-1 text-[10px] font-semibold text-nb-navy"><HomeIcon className="h-3 w-3" />Mobile</span>}
            {s.clinic && clinicOpen && <span className="flex items-center gap-1 rounded-full bg-white/90 px-2.5 py-1 text-[10px] font-semibold text-nb-navy"><Building2 className="h-3 w-3" />Clinic</span>}
          </div>
          {eligible && <span className="absolute right-3 top-3 rounded-full bg-nb-lime px-2.5 py-1 text-[10px] font-bold text-nb-ink">Welcome offer</span>}
        </div>
        <div className="p-5">
          <h3 className="text-lg font-semibold text-nb-ink">{s.name}</h3>
          <p className="mt-1 text-sm text-nb-mute line-clamp-2">{s.short}</p>
          <div className="mt-4 flex items-center justify-between">
            <span className="text-sm text-nb-ink">From <b>{money(from)}</b></span>
            <span className="text-xs text-nb-mute">{durs.join(" / ")} min</span>
          </div>
          <span className="mt-3 inline-flex items-center gap-1 text-sm font-semibold text-nb-blue">View details <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-1" /></span>
        </div>
      </Link>
    </motion.div>
  );
}

/** Optional in-flow CTA — never fixed/floating so catalogue cards stay fully visible. */
export const StickyBook = ({ onClick, label = "Book Your Massage", sub }) => (
  <div className="mt-8 flex justify-center pb-2 md:justify-end" data-testid="sticky-book-bar">
    <button type="button" onClick={onClick} data-testid="sticky-book-btn" className="nb-btn-primary h-12 px-6 text-sm sm:h-14 sm:px-8 sm:text-base">
      {label}{sub && <span className="text-xs font-normal text-white/80">· {sub}</span>}<ArrowRight className="h-5 w-5" />
    </button>
  </div>
);
