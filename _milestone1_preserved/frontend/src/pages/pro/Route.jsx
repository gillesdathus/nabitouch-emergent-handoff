import { useState } from "react";
import { MapPin, Car, Clock } from "lucide-react";
import { usePreview } from "@/store/PreviewStore";
import { PageHeader, Notice, Avatar, StatusPill, Reveal } from "@/components/ui-kit";
import { MapView, CapBadge } from "@/components/MapView";
import { clientLngLat } from "@/lib/geo";
import { DayStrip } from "@/components/Calendar";
import { ProFilter } from "@/pages/owner/Schedule";
import { TopIcons } from "@/components/shells";
import { todayISO, timeLabel } from "@/lib/domain";


export default function RoutePage() {
  const { db, role, me, cli, svc, openAppt } = usePreview();
  const [date, setDate] = useState(todayISO());
  const [pid, setPid] = useState(role === "pro" ? me.pro : "p1");
  const list = db.appointments.filter((a) => a.practitionerId === pid && a.date === date && a.status !== "cancelled").sort((x, y) => x.time.localeCompare(y.time));
  const pts = list.map((a) => clientLngLat(a.clientId));
  return (
    <div className="max-w-5xl mx-auto px-5 pt-12 lg:pt-14">
      <PageHeader title="Day route" sub="Planned order of visits" right={<TopIcons base={`/${role}`} />} />
      {role === "owner" && <div className="mb-3"><ProFilter value={pid} onChange={(v) => v !== "all" && setPid(v)} pros={db.practitioners.filter((p) => p.status === "active")} /></div>}
      <DayStrip value={date} onChange={setDate} />
      <div className="grid lg:grid-cols-[1.2fr_1fr] gap-5 mt-4">
        <MapView className="h-64 lg:h-[440px] rounded-[28px]" route={pts.length > 1 ? pts : undefined} markers={pts.map((p, i) => ({ id: `stop${i}`, lngLat: p, kind: "pin", label: `${i + 1} · ${timeLabel(list[i].time)}` }))} fit={pts.length ? pts : undefined} testid="route-map"><span className="absolute bottom-3 left-3"><CapBadge kind="estimate" /></span></MapView>
        <div>
          <Notice className="mb-3" icon={Car}>Road travel time needs Mapbox (not configured). Times between stops below are straight-line estimates.</Notice>
          {list.length === 0 && <p className="text-sm text-nb-mute">No visits this day.</p>}
          <ol className="relative border-l-2 border-dashed border-sky-200 ml-4 space-y-3">
            {list.map((a, i) => (
              <Reveal key={a.id} i={i}>
                <li className="ml-6 relative">
                  <span className="absolute -left-[37px] top-3 h-7 w-7 rounded-full nb-lagoon text-white text-xs font-bold grid place-items-center ring-4 ring-nb-canvas">{i + 1}</span>
                  <button data-testid={`route-stop-${a.id}`} onClick={() => openAppt(a.id)} className="w-full nb-card p-3.5 text-left flex items-center gap-3">
                    <Avatar name={cli(a.clientId).name} size={38} />
                    <div className="flex-1 min-w-0"><p className="text-sm font-semibold truncate">{timeLabel(a.time)} · {cli(a.clientId).name}</p><p className="text-xs text-nb-mute truncate flex items-center gap-1"><MapPin className="h-3 w-3" />{a.address}</p><p className="text-[10.5px] text-nb-mute">{svc(a.serviceId).name}{i > 0 ? " · ~12 min straight-line" : ""}</p></div>
                    <StatusPill status={a.status} />
                  </button>
                </li>
              </Reveal>
            ))}
          </ol>
          <span className="hidden"><Clock /></span>
        </div>
      </div>
    </div>
  );
}
