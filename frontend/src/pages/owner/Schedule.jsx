import { useState } from "react";
import { Link } from "react-router-dom";
import { CalendarPlus, X } from "lucide-react";
import { AppointmentSheet } from "@/components/AppointmentSheet";
import { NewBookingDialog } from "@/components/NewBookingDialog";
import { VisualCalendar } from "@/components/ops/VisualCalendar";
import { PageHeader } from "@/components/ds";
import { Confirm } from "@/components/ui-kit";
import { useDemo } from "@/store/DemoStore";
import { fmtDate, fmtTime, staffActor, todayISO } from "@/lib/domain";

function SlotPanel({ slot, personId, onBlock, onBook, onClose, note }) {
  return (
    <div className="nb-panel fixed inset-x-3 bottom-[var(--nb-bottom-clear)] z-40 p-4 shadow-[var(--nb-elev-3)] sm:inset-x-auto sm:right-6 sm:w-96 lg:bottom-6" role="dialog" aria-label="Selected time" data-testid="calendar-slot">
      <div className="flex items-start justify-between gap-2">
        <div><p className="font-semibold">{fmtDate(slot.date, { weekday: "long", month: "short", day: "numeric" })} · {fmtTime(slot.time)}</p><p className="mt-0.5 text-xs text-nb-mute">{personId ? "Block one hour for the selected practitioner, or start a booking." : "Choose a practitioner filter to block time."}</p></div>
        <button type="button" onClick={onClose} aria-label="Close" className="nb-btn-ghost h-8 w-8 px-0" data-testid="calendar-slot-close"><X className="h-4 w-4" /></button>
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        <button type="button" className="nb-btn-dark h-10 px-4 text-sm" onClick={onBook} data-testid="calendar-slot-book"><CalendarPlus className="h-4 w-4" />New booking</button>
        <button type="button" className="nb-btn-ghost h-10 px-4 text-sm" onClick={onBlock} disabled={!personId} data-testid="calendar-block">Block time</button>
      </div>
      {note && <p className="mt-2 text-sm text-nb-mute" role="status">{note}</p>}
    </div>
  );
}

export default function Schedule() {
  const { state, idx, api, run, user } = useDemo();
  const [cursor, setCursor] = useState(todayISO());
  const [personId, setPersonId] = useState("");
  const [openId, setOpenId] = useState(null);
  const [slot, setSlot] = useState(null);
  const [note, setNote] = useState("");
  const [move, setMove] = useState(null);
  const [booking, setBooking] = useState(false);
  const block = async () => {
    try {
      const hour = Number(slot.time.slice(0, 2));
      const end = `${String(Math.min(hour + 1, 23)).padStart(2, "0")}:00`;
      await api.addException(personId, { kind: "break", startDate: slot.date, endDate: slot.date, start: slot.time, end });
      setNote("Break saved.");
    } catch (error) {
      setNote(error?.response?.data?.detail || "The time was not blocked.");
    }
  };
  const confirmMove = () => {
    const { appt, date, time } = move;
    setMove(null);
    run(() => api.event(appt.id, "rescheduled", staffActor(user), `Moved on calendar to ${date} ${time}`, { date, time }), "Visit rescheduled").catch(() => {});
  };
  const client = move && idx.clients[move.appt.clientId];
  return (
    <div className="min-w-0 space-y-5" data-testid="owner-schedule">
      <PageHeader
        eyebrow="Schedule"
        title="Calendar"
        description="Edmonton local time. Route estimates are not live GPS."
        actions={<>
          <Link to="/owner/availability" className="nb-btn-ghost h-10 px-4 text-sm" data-testid="schedule-link-availability">Hours</Link>
          <Link to="/owner/routes" className="nb-btn-ghost h-10 px-4 text-sm" data-testid="schedule-link-routes">Routes</Link>
          <button type="button" className="nb-btn-primary h-10 px-4 text-sm" onClick={() => setBooking(true)} data-testid="schedule-new-booking"><CalendarPlus className="h-4 w-4" />New booking</button>
        </>}
      />
      <VisualCalendar appointments={state.appointments} practitioners={state.practitioners} services={idx.services} clients={idx.clients} personId={personId} onPerson={setPersonId} cursor={cursor} onCursor={setCursor} onOpen={setOpenId} onSlot={(s) => { setSlot(s); setNote(""); }} onMove={(appt, date, time) => setMove({ appt, date, time })} />
      {slot && <SlotPanel slot={slot} personId={personId} note={note} onBlock={block} onBook={() => { setSlot(null); setBooking(true); }} onClose={() => setSlot(null)} />}
      <Confirm open={Boolean(move)} onOpenChange={(o) => !o && setMove(null)} testid="reschedule-confirm" title="Reschedule this visit?" confirmLabel="Reschedule"
        body={move ? `${move.appt.ref} · ${client ? `${client.firstName} ${client.lastName}` : "Client"}: ${fmtDate(move.appt.date)} ${fmtTime(move.appt.time)} → ${fmtDate(move.date)} ${fmtTime(move.time)}. The client is notified only if lifecycle email is enabled.` : ""}
        onConfirm={confirmMove} />
      {openId && <AppointmentSheet apptId={openId} role="owner" onClose={() => setOpenId(null)} />}
      {booking && <NewBookingDialog open onClose={() => setBooking(false)} />}
    </div>
  );
}
