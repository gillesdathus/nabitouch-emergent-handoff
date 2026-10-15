import { useState } from "react";
import { CalendarPlus, LogIn, MapPin } from "lucide-react";
import { usePreview } from "@/store/PreviewStore";
import { PageHeader, Avatar, StatusPill, PayPill, Notice } from "@/components/ui-kit";
import { DayStrip } from "@/components/Calendar";
import { TopIcons } from "@/components/shells";
import { todayISO, timeLabel, fmtDate } from "@/lib/domain";

export default function Desk() {
  const { db, svc, cli, api, openAppt, openNewBooking } = usePreview();
  const [date, setDate] = useState(todayISO());
  const perms = db.settings.receptionPerms;
  const pros = db.practitioners.filter((p) => p.status === "active");
  return (
    <div className="max-w-6xl mx-auto pt-12 lg:pt-14">
      <div className="px-5"><PageHeader eyebrow="Reception" title={`Hi, Maya`} sub={fmtDate(date, { weekday: "long", month: "long", day: "numeric" })} right={<TopIcons base="/desk" />} /></div>
      <div className="px-5"><DayStrip value={date} onChange={setDate} dots={(d) => db.appointments.some((a) => a.date === d)} /></div>
      <p className="px-5 mt-5 mb-2 text-xs text-nb-mute">Swipe between practitioners</p>
      <div data-testid="desk-lanes" className="flex gap-4 overflow-x-auto no-scrollbar snap-x snap-mandatory px-5 pb-4">
        {pros.map((p) => {
          const list = db.appointments.filter((a) => a.practitionerId === p.id && a.date === date && a.status !== "cancelled").sort((x, y) => x.time.localeCompare(y.time));
          return (
            <section key={p.id} data-testid={`desk-lane-${p.id}`} className="snap-center shrink-0 w-[86%] sm:w-[360px] nb-card p-4">
              <div className="flex items-center gap-3 mb-4"><Avatar src={p.photo} name={p.name} size={44} /><div className="flex-1"><p className="font-semibold">{p.name}</p><p className="text-xs text-nb-mute">{list.length} visits</p></div><span className="h-3 w-3 rounded-full" style={{ background: p.color }} /></div>
              {list.length === 0 && <p className="text-sm text-nb-mute py-6 text-center">No visits</p>}
              <div className="space-y-2">
                {list.map((a) => (
                  <div key={a.id} className="rounded-3xl bg-sky-50/60 p-3">
                    <button data-testid={`desk-appt-${a.id}`} onClick={() => openAppt(a.id)} className="w-full text-left">
                      <div className="flex items-center justify-between"><span className="text-sm font-semibold nb-num">{timeLabel(a.time)}</span><StatusPill status={a.status} /></div>
                      <p className="text-sm mt-1">{cli(a.clientId).name} · <span className="text-nb-mute">{svc(a.serviceId).name}</span></p>
                      <p className="text-xs text-nb-mute flex items-center gap-1 mt-0.5"><MapPin className="h-3 w-3" />{perms.viewAddresses ? a.address : "Address hidden"}</p>
                    </button>
                    <div className="flex items-center justify-between mt-2">
                      {perms.managePayments ? <PayPill pay={a.pay} /> : <span />}
                      {a.status === "confirmed" && <button data-testid={`desk-checkin-${a.id}`} onClick={() => api.transition(a.id, "arrived", "Client checked in")} className="nb-btn-dark h-9 px-4 text-xs"><LogIn className="h-3.5 w-3.5" />Check in</button>}
                    </div>
                  </div>
                ))}
              </div>
            </section>
          );
        })}
      </div>
      <div className="px-5">{!perms.createBooking && <Notice>Creating bookings is not enabled for reception.</Notice>}</div>
      {perms.createBooking && <button data-testid="desk-new-booking-fab" onClick={() => openNewBooking({ date })} className="fixed right-5 bottom-[92px] lg:bottom-8 z-40 h-14 pl-5 pr-6 rounded-full nb-lagoon text-white font-semibold flex items-center gap-2 shadow-[0_16px_30px_-12px_rgba(21,101,240,.8)] active:scale-95 transition-transform"><CalendarPlus className="h-5 w-5" />New booking</button>}
    </div>
  );
}
