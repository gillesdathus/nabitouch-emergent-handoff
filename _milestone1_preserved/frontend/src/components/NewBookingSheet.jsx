import { useEffect, useState } from "react";
import { toast } from "sonner";
import { BottomSheet, Field } from "@/components/ui-kit";
import { DayStrip } from "@/components/Calendar";
import { usePreview } from "@/store/PreviewStore";
import { freeSlots, isFree } from "@/lib/schedule";
import { timeLabel, todayISO, quote, money } from "@/lib/domain";

export function NewBookingHost() {
  const { newBooking, closeNewBooking, db, api, cli, svc, zone, openAppt } = usePreview();
  const [f, setF] = useState({});
  useEffect(() => {
    if (newBooking) setF({ clientId: "c1", serviceId: "s1", practitionerId: "p1", date: todayISO(), time: "", ...newBooking });
  }, [newBooking]);
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e.target ? e.target.value : e }));
  const pros = db.practitioners.filter((p) => p.bookable && (!f.serviceId || p.specialties.includes(f.serviceId)));
  const s = f.serviceId && svc(f.serviceId);
  const slots = s ? freeSlots(db, [f.practitionerId], f.date, s.duration) : [];
  const c = f.clientId && cli(f.clientId);
  const q = s && c ? quote(s, zone(c.zoneId)) : null;
  const submit = async () => {
    if (!isFree(db, f.practitionerId, f.date, f.time, s.duration)) {
      toast.error("409 · This slot conflicts with another visit. Nothing was booked.");
      return;
    }
    setBusy(true);
    const id = await api.book({ ...f, zoneId: c.zoneId, address: c.address, status: "confirmed" });
    setBusy(false);
    toast.success("Booking created");
    closeNewBooking();
    openAppt(id);
  };
  return (
    <BottomSheet open={!!newBooking} onOpenChange={(o) => !o && closeNewBooking()} testid="new-booking-sheet" title="New booking" sub="Staff booking · price from server quote" full
      footer={<button data-testid="new-booking-submit" disabled={!f.time || busy} onClick={submit} className="nb-btn-primary w-full">{busy ? "Booking…" : f.time ? `Book ${timeLabel(f.time)}${q ? ` · ${money(q.total)}` : ""}` : "Choose a time"}</button>}>
      <Field label="Client"><select data-testid="nb-client-select" className="nb-input" value={f.clientId || ""} onChange={set("clientId")}>{db.clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></Field>
      <Field label="Service"><select data-testid="nb-service-select" className="nb-input" value={f.serviceId || ""} onChange={(e) => setF((x) => ({ ...x, serviceId: e.target.value, time: "" }))}>{db.services.filter((s) => s.published).map((s) => <option key={s.id} value={s.id}>{s.name} · {s.duration} min</option>)}</select></Field>
      <Field label="Practitioner"><select data-testid="nb-practitioner-select" className="nb-input" value={f.practitionerId || ""} onChange={(e) => setF((x) => ({ ...x, practitionerId: e.target.value, time: "" }))}>{pros.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></Field>
      <p className="nb-label">Date</p>
      <DayStrip value={f.date} onChange={(d) => setF((x) => ({ ...x, date: d, time: "" }))} start={todayISO()} testid="nb-day-strip" />
      <p className="nb-label mt-4">Available times</p>
      <div className="grid grid-cols-3 gap-2">
        {slots.length === 0 && <p className="col-span-3 text-sm text-nb-mute">No open times this day.</p>}
        {slots.map((sl) => <button key={sl.time} data-testid={`nb-slot-${sl.time}`} onClick={() => setF((x) => ({ ...x, time: sl.time }))} className={f.time === sl.time ? "nb-chip-on justify-center" : "nb-chip-off justify-center"}>{timeLabel(sl.time)}</button>)}
      </div>
    </BottomSheet>
  );
}
