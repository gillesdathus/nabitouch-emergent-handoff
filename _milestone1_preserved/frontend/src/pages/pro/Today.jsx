import { Link, useNavigate } from "react-router-dom";
import { Navigation, MapPin, FileText, ChevronRight, Sparkles } from "lucide-react";
import { usePreview } from "@/store/PreviewStore";
import { Avatar, StatusPill, Reveal, Pill, EmptyState } from "@/components/ui-kit";
import { TopIcons } from "@/components/shells";
import { todayISO, timeLabel, fmtDate, greeting, TRIP_ACTION } from "@/lib/domain";

const TAG = { completed: "bg-nb-green/20 text-nb-lime", en_route: "bg-nb-blue/30 text-white", in_session: "bg-nb-cyan/25 text-nb-cyan", arrived: "bg-nb-cyan/25 text-nb-cyan", confirmed: "bg-white/10 text-white/80", requested: "bg-white/10 text-white/80" };

export default function Today() {
  const { db, me, pro, cli, svc } = usePreview();
  const nav = useNavigate();
  const p = pro(me.pro);
  const T = todayISO();
  const list = db.appointments.filter((a) => a.practitionerId === p.id && a.date === T && a.status !== "cancelled").sort((x, y) => x.time.localeCompare(y.time));
  const open = list.filter((a) => a.status !== "completed");
  const cur = open[0];
  const soapDue = db.appointments.filter((a) => a.practitionerId === p.id && a.status === "completed" && a.soap !== "signed");
  return (
    <div className="nb-tide min-h-[100dvh] -mb-28 lg:-mb-10 pb-32 text-white">
      <div className="max-w-3xl mx-auto px-5 pt-12 lg:pt-14">
        <div className="flex items-center gap-3">
          <Avatar src={p.photo} name={p.name} size={46} className="!ring-white/20" />
          <div className="flex-1"><p className="text-xs text-white/50">{fmtDate(T, { weekday: "long", month: "long", day: "numeric" })}</p><p className="font-semibold">{greeting()}, {p.name.split(" ")[0]}</p></div>
          <TopIcons base="/pro" dark />
        </div>
        <h1 className="mt-7 text-4xl sm:text-5xl font-semibold leading-[1.05] tracking-tight" data-testid="today-headline">You have <span className="nb-gradient-text">{open.length}</span><br />visits left today</h1>
        {cur ? (
          <Reveal className="mt-6">
            <div data-testid="today-current-card" className="relative overflow-hidden rounded-[30px] nb-lagoon p-5">
              <div className="absolute -right-10 -top-10 h-40 w-40 rounded-full bg-nb-turq/40 blur-2xl" />
              <div className="relative flex items-center justify-between"><Pill tone="bg-white/15 text-white ring-white/30">{cur.status === "confirmed" ? "Up next" : "In progress"}</Pill><span className="text-2xl font-semibold nb-num">{timeLabel(cur.time)}</span></div>
              <p className="relative text-2xl font-semibold mt-4">{cli(cur.clientId).name}</p>
              <p className="relative text-sm text-white/80">{svc(cur.serviceId).name} · {cur.duration} min</p>
              <p className="relative text-sm text-white/80 flex items-center gap-1 mt-1"><MapPin className="h-3.5 w-3.5" />{cur.address}</p>
              {cur.notes && <p className="relative text-xs text-white/70 mt-2 italic">“{cur.notes}”</p>}
              <button data-testid="today-primary-action" onClick={() => nav(`/pro/visit/${cur.id}`)} className="relative nb-btn w-full h-14 mt-5 bg-white text-nb-ink text-base"><Navigation className="h-5 w-5 text-nb-blue" />{TRIP_ACTION[cur.status] || "Open visit"}</button>
            </div>
          </Reveal>
        ) : <EmptyState icon={Sparkles} title="All done for today" body="Nice work. Notes are below." />}
        <div className="grid grid-cols-3 gap-3 mt-4">
          {[["Done", list.filter((a) => a.status === "completed").length], ["Remaining", open.length], ["SOAP due", soapDue.length]].map(([l, v]) => <div key={l} className="rounded-3xl bg-white/5 ring-1 ring-white/10 p-4"><p className="text-2xl font-semibold nb-num">{v}</p><p className="text-[11px] text-white/50">{l}</p></div>)}
        </div>
        <div className="flex items-center justify-between mt-8 mb-3"><h2 className="font-semibold text-lg">Today's activity</h2><Link to="/pro/route" className="text-sm text-nb-cyan">Route</Link></div>
        <div className="grid sm:grid-cols-2 gap-3">
          {list.map((a, i) => (
            <Reveal key={a.id} i={i}>
              <button data-testid={`today-visit-${a.id}`} onClick={() => nav(`/pro/visit/${a.id}`)} className="w-full text-left rounded-3xl bg-white/[0.06] ring-1 ring-white/10 p-4 hover:bg-white/10 transition-colors">
                <span className={`inline-flex rounded-full px-2.5 h-6 items-center text-[11px] font-semibold ${TAG[a.status]}`}>{a.status === "completed" ? "Done" : a.status === "en_route" ? "En route" : a.status === "in_session" ? "In session" : "To do"}</span>
                <p className="font-semibold mt-2 truncate">{cli(a.clientId).name}</p>
                <p className="text-xs text-white/60 truncate">{svc(a.serviceId).name}</p>
                <div className="flex items-center justify-between mt-3 text-xs text-white/60"><span className="nb-num">{timeLabel(a.time)} · {a.duration}m</span><ChevronRight className="h-4 w-4" /></div>
              </button>
            </Reveal>
          ))}
        </div>
        {soapDue.length > 0 && (
          <div className="mt-6 space-y-2">
            {soapDue.map((a) => <button key={a.id} data-testid={`soap-due-${a.id}`} onClick={() => nav(`/pro/soap/${a.id}`)} className="w-full flex items-center gap-3 rounded-3xl bg-nb-turq/10 ring-1 ring-nb-turq/30 p-4 text-left"><FileText className="h-5 w-5 text-nb-turq" /><span className="flex-1 text-sm">SOAP note · {cli(a.clientId).name} · {fmtDate(a.date)}</span><StatusPill status="completed" /></button>)}
          </div>
        )}
      </div>
    </div>
  );
}
