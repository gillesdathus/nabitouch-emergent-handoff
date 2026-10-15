import { useNavigate } from "react-router-dom";
import { UserRound, LifeBuoy, ClipboardList, FileBarChart, Settings, BadgeCheck, Send, Eye, Clock, Images } from "lucide-react";
import { toast } from "sonner";
import { usePreview } from "@/store/PreviewStore";
import { PageHeader, IconTile, SectionHead, ProgressRail, Pill, Avatar, Reveal, EmptyState } from "@/components/ui-kit";
import { TopIcons } from "@/components/shells";
import { money, timeLabel, fmtDate } from "@/lib/domain";

export function Recovery() {
  const { db, role, me, pro, api } = usePreview();
  const list = db.gaps.filter((g) => role !== "pro" || g.practitionerId === me.pro);
  return (
    <div className="max-w-3xl mx-auto px-5 pt-12 lg:pt-14">
      <PageHeader eyebrow="Booking recovery" title="Open gaps" sub="Offer freed-up time to clients who opted in to openings" right={<TopIcons base={`/${role}`} />} />
      {list.length === 0 && <EmptyState icon={LifeBuoy} title="No gaps to recover" />}
      <div className="space-y-3">
        {list.map((g, i) => (
          <Reveal key={g.id} i={i}>
            <div data-testid={`gap-card-${g.id}`} className="nb-card p-4">
              <div className="flex items-center gap-3"><Avatar src={pro(g.practitionerId).photo} name="" size={42} /><div className="flex-1"><p className="font-semibold text-sm">{fmtDate(g.date)} · {timeLabel(g.time)}</p><p className="text-xs text-nb-mute">{g.length} min free · {pro(g.practitionerId).name}</p></div><Pill tone={g.state === "open" ? "bg-nb-coral/10 text-nb-coral ring-nb-coral/25" : g.state === "offered" ? "bg-sky-50 text-nb-blue ring-sky-200" : "bg-nb-green/15 text-[#3E7A1E] ring-nb-green/30"}>{g.state}</Pill></div>
              <div className="flex items-center justify-between mt-3"><p className="text-xs text-nb-mute flex items-center gap-1"><Eye className="h-3.5 w-3.5" />{g.watchers} clients watching for openings</p>
                {g.state === "open" && <button data-testid={`gap-offer-${g.id}`} onClick={() => api.save("gaps", g.id, { state: "offered" }, "Offered in-app to opted-in clients")} className="nb-btn-primary h-10 text-sm"><Send className="h-4 w-4" />Offer</button>}
              </div>
            </div>
          </Reveal>
        ))}
      </div>
    </div>
  );
}

export default function ProMe() {
  const { db, me, pro, cli, openProfile } = usePreview();
  const nav = useNavigate();
  const p = pro(me.pro);
  const plans = db.plans.filter((x) => x.practitionerId === p.id);
  const reports = db.reports.filter((r) => r.practitionerId === p.id && r.status === "published");
  return (
    <div className="max-w-3xl mx-auto px-5 pt-12 lg:pt-14">
      <PageHeader title="Me" right={<TopIcons base="/pro" />} />
      <div className="relative rounded-[30px] overflow-hidden tint-ice h-44 mb-5">
        <img src={p.photo} alt={p.name} className="absolute right-0 bottom-0 h-full w-1/2 object-cover object-top [mask-image:linear-gradient(to_left,black_70%,transparent)]" />
        <div className="relative p-5"><Pill tone="bg-white text-nb-teal ring-nb-turq/30"><BadgeCheck className="h-3 w-3" />Bookable</Pill><p className="text-2xl font-semibold mt-3 max-w-[55%] leading-tight">{p.name}</p><p className="text-xs text-nb-mute mt-1">{p.title}</p></div>
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3" data-hours={Clock.displayName}>
        <IconTile testid="pro-tile-profile" icon={UserRound} label="Profile" sub="Bio, photo, gallery" tint="tint-lagoon" onClick={() => openProfile("practitioner", p.id)} />
        <IconTile testid="pro-tile-recovery" icon={LifeBuoy} label="Recovery" sub="Open gaps" tint="tint-mint" iconClass="text-nb-teal" onClick={() => nav("/pro/recovery")} />
        <IconTile testid="pro-tile-gallery" icon={Images} label="Photos" sub="Reorder & preview" tint="tint-ice" iconClass="text-nb-sky" onClick={() => nav("/pro/gallery")} />
        <IconTile testid="pro-tile-settings" icon={Settings} label="Settings" sub="Account & nav app" tint="tint-meadow" iconClass="text-[#4E9A2B]" onClick={() => nav("/pro/settings")} />
      </div>
      <SectionHead title="Care plans" className="mt-8" />
      <div className="space-y-2">{plans.map((pl) => <div key={pl.id} data-testid={`plan-${pl.id}`} className="nb-card p-4"><div className="flex items-center gap-3 mb-3"><ClipboardList className="h-5 w-5 text-nb-teal" /><div className="flex-1"><p className="text-sm font-semibold">{pl.title}</p><p className="text-xs text-nb-mute">{cli(pl.clientId).name}</p></div><span className="text-xs font-semibold nb-num">{pl.done}/{pl.sessions}</span></div><ProgressRail value={pl.done / pl.sessions} /></div>)}</div>
      <SectionHead title="My statements" className="mt-8" />
      {reports.length === 0 ? <p className="text-sm text-nb-mute">Published statements appear here.</p> : reports.map((r) => <button key={r.id} data-testid={`pro-report-${r.id}`} onClick={() => toast("PDF export is not connected in this preview")} className="w-full nb-card p-4 flex items-center gap-3 text-left"><FileBarChart className="h-5 w-5 text-nb-blue" /><div className="flex-1"><p className="text-sm font-semibold">{new Date(r.year, r.month - 1).toLocaleString("en-CA", { month: "long" })} · {r.half === 1 ? "1st–15th" : "16th–end"}</p><p className="text-xs text-nb-mute">{r.visits} visits · {money(r.gross)}</p></div><Pill>PDF</Pill></button>)}
    </div>
  );
}
