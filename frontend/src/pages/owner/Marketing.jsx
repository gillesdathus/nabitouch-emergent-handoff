import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Gift, Tag, Zap } from "lucide-react";
import { toast } from "sonner";
import { useDemo } from "@/store/DemoStore";
import { money, welcomeOfferListed } from "@/lib/domain";
import { PageHeader } from "@/components/tide";

const TABS = [
  { id: "welcome", label: "Welcome offer" },
  { id: "campaigns", label: "Flash & acquisition" },
  { id: "followups", label: "Follow-up coupons" },
  { id: "report", label: "Reporting" },
];

export default function Marketing() {
  const { state, api } = useDemo();
  const [tab, setTab] = useState("welcome");
  const [metrics, setMetrics] = useState(null);
  const [followups, setFollowups] = useState([]);
  const welcome = state.promotions?.find((p) => p.id === "promo-welcome");

  const load = async () => {
    const [analytics, coupons] = await Promise.all([
      api.marketingAnalytics().catch(() => null),
      api.followupCoupons().catch(() => []),
    ]);
    setMetrics(analytics);
    setFollowups(Array.isArray(coupons) ? coupons : []);
  };
  useEffect(() => { load().catch((error) => toast.error(error?.response?.data?.detail || "Marketing data could not be loaded")); }, []); // eslint-disable-line

  const voidCoupon = async (id) => {
    try {
      await api.voidFollowup(id);
      toast.success("Follow-up code voided");
      await load();
    } catch (error) {
      toast.error(error?.response?.data?.detail || "Could not void code");
    }
  };

  return (
    <div className="mx-auto max-w-5xl space-y-6" data-testid="owner-marketing">
      <PageHeader
        eyebrow="Growth"
        title="Marketing"
        sub="Welcome offer, flash and acquisition campaigns, and follow-up coupons. Nothing goes live until you activate it."
        right={<Link to="/owner/campaigns" className="nb-btn-primary h-10 px-4 text-sm" data-testid="marketing-open-campaigns"><Zap className="mr-1 inline h-4 w-4" />Flash campaigns</Link>}
      />
      <div className="flex flex-wrap gap-2" role="tablist">
        {TABS.map((item) => (
          <button key={item.id} type="button" role="tab" aria-selected={tab === item.id} className={`rounded-full px-3 py-2 text-xs font-semibold ${tab === item.id ? "bg-nb-ink text-white" : "bg-white text-nb-mute ring-1 ring-sky-100"}`} onClick={() => setTab(item.id)} data-testid={`marketing-tab-${item.id}`}>{item.label}</button>
        ))}
      </div>

      {tab === "welcome" && (
        <section className="nb-card space-y-3 p-5" data-testid="marketing-welcome">
          <div className="flex items-start gap-3">
            <Tag className="h-5 w-5 text-nb-blue" />
            <div className="flex-1">
              <p className="font-semibold">{welcome?.name || "Welcome offer"}</p>
              <p className="text-sm text-nb-mute">{welcome ? `${welcome.code} · ${welcome.type === "percent" ? `${welcome.value}%` : money(welcome.value)}${welcome.maxDiscount != null ? ` · cap ${money(welcome.maxDiscount)}` : ""}` : "Not loaded"}</p>
              <p className="mt-1 text-xs text-nb-mute">{welcomeOfferListed(welcome) ? "Listed for eligible first bookings" : "Not currently listed"} · placements {(welcome?.placements || ["home", "account"]).join(", ")}</p>
            </div>
            <Link to="/owner/promos" className="nb-btn-primary h-10 px-4 text-sm" data-testid="marketing-open-promos">Edit welcome offer</Link>
          </div>
        </section>
      )}

      {tab === "campaigns" && (
        <section className="nb-card space-y-3 p-5" data-testid="marketing-campaigns">
          <div className="flex items-start gap-3">
            <Zap className="h-5 w-5 text-nb-coral" />
            <div className="flex-1">
              <p className="font-semibold">Flash & acquisition campaigns</p>
              <p className="text-sm text-nb-mute">Flash openings use percent or fixed discounts. Create “10 Minutes. On Us.” as a separate free standalone trial draft from the campaigns desk — it is not a flash add-on.</p>
            </div>
            <Link to="/owner/campaigns" className="nb-btn-primary h-10 px-4 text-sm" data-testid="marketing-open-campaigns">Open campaigns</Link>
          </div>
          {metrics?.campaigns?.length > 0 && (
            <ul className="divide-y divide-sky-100 text-sm">
              {metrics.campaigns.map((row) => (
                <li key={row.id} className="flex flex-wrap justify-between gap-2 py-2" data-testid={`marketing-campaign-row-${row.id}`}>
                  <span>{row.title} · {row.status} · {row.offerKind || "percent"}</span>
                  <span className="text-nb-mute">{row.redemptions}/{row.maxRedemptions} used · {row.remaining} left</span>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      {tab === "followups" && (
        <section className="nb-card space-y-3 p-5" data-testid="marketing-followups">
          <div className="flex items-start gap-3">
            <Gift className="h-5 w-5 text-nb-teal" />
            <div className="flex-1">
              <p className="font-semibold">Follow-up coupons</p>
              <p className="text-sm text-nb-mute">Issued after a completed acquisition visit when the campaign follow-up is enabled. Codes never stack with WELCOME20 or flash offers.</p>
            </div>
          </div>
          {!followups.length && <p className="text-sm text-nb-mute" data-testid="marketing-followups-empty">No follow-up coupons yet.</p>}
          <ul className="divide-y divide-sky-100 text-sm">
            {followups.slice(0, 40).map((row) => (
              <li key={row.id} className="flex flex-wrap items-center gap-3 py-2" data-testid={`marketing-followup-${row.id}`}>
                <span className="font-mono text-xs">{row.code}</span>
                <span>{row.clientName}</span>
                <span className="text-nb-mute">{row.percent}% · {row.status}</span>
                {row.status === "issued" && <button type="button" className="nb-btn-ghost h-8 px-3 text-xs" onClick={() => voidCoupon(row.id)}>Void</button>}
              </li>
            ))}
          </ul>
        </section>
      )}

      {tab === "report" && (
        <section className="nb-card space-y-2 p-5" data-testid="marketing-report">
          <p className="font-semibold">Light reporting</p>
          {!metrics && <p className="text-sm text-nb-mute">No analytics loaded.</p>}
          {metrics && (
            <>
              <p className="text-sm">{metrics.campaignBookings || 0} campaign bookings · discount cost {money(metrics.discountCost)} · gross {money(metrics.grossRevenue)}</p>
              <p className="text-sm text-nb-mute">Follow-ups issued {metrics.followUpIssued || 0} · redeemed {metrics.followUpRedeemed || 0}</p>
              <p className="text-xs text-nb-mute">{metrics.incrementalNote}</p>
            </>
          )}
        </section>
      )}
    </div>
  );
}
