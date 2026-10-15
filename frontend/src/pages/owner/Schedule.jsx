import { useState } from "react";
import { Link } from "react-router-dom";
import { AppointmentSheet } from "@/components/AppointmentSheet";
import { VisualCalendar } from "@/components/ops/VisualCalendar";
import { useDemo } from "@/store/DemoStore";
import { todayISO } from "@/lib/domain";

export default function Schedule() {
  const { state, idx, api } = useDemo();
  const [cursor, setCursor] = useState(todayISO());
  const [personId, setPersonId] = useState("");
  const [openId, setOpenId] = useState(null);
  const [slot, setSlot] = useState(null);
  const [note, setNote] = useState("");
  const block = async () => {
    if (!personId || !slot) {
      setNote("Choose one practitioner before blocking time.");
      return;
    }
    try {
      const hour = Number(slot.time.slice(0, 2));
      const end = `${String(Math.min(hour + 1, 23)).padStart(2, "0")}:00`;
      await api.addException(personId, { kind: "break", startDate: slot.date, endDate: slot.date, start: slot.time, end });
      setNote("Break saved.");
      setSlot(null);
    } catch (error) {
      setNote(error?.response?.data?.detail || "The time was not blocked.");
    }
  };
  return (
    <div className="space-y-5" data-testid="owner-schedule">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="nb-eyebrow">Schedule</p>
          <h1 className="text-3xl font-semibold tracking-tight">Cal<span className="font-display font-normal italic nb-gradient-text">endar</span></h1>
          <p className="text-sm text-nb-mute">Edmonton local time. A route estimate is not live GPS.</p>
        </div>
        <div className="flex gap-2 text-sm font-semibold">
          <Link to="/owner/dispatch" className="text-nb-blue" data-testid="schedule-link-dispatch">Dispatch</Link>
          <Link to="/owner/availability" className="text-nb-blue" data-testid="schedule-link-availability">Hours</Link>
          <Link to="/owner/routes" className="text-nb-blue" data-testid="schedule-link-routes">Routes</Link>
        </div>
      </div>
      <VisualCalendar appointments={state.appointments} practitioners={state.practitioners} services={idx.services} clients={idx.clients} personId={personId} onPerson={setPersonId} cursor={cursor} onCursor={setCursor} onOpen={setOpenId} onSlot={setSlot} />
      {slot && (
        <div className="rounded-[28px] bg-white p-5 shadow-xl ring-1 ring-sky-100" data-testid="calendar-slot">
          <p className="font-semibold">{slot.date} at {slot.time}</p>
          <p className="text-sm text-nb-mute">Create the visit from reception, or block this hour for the selected practitioner.</p>
          <div className="mt-3 flex gap-2">
            <button type="button" className="nb-btn-ghost h-10 px-3 text-sm" onClick={block} data-testid="calendar-block">Block time</button>
            <button type="button" className="nb-btn-ghost h-10 px-3 text-sm" onClick={() => setSlot(null)}>Close</button>
          </div>
          {note && <p className="mt-2 text-sm text-nb-mute">{note}</p>}
        </div>
      )}
      {openId && <AppointmentSheet apptId={openId} role="owner" onClose={() => setOpenId(null)} />}
    </div>
  );
}
