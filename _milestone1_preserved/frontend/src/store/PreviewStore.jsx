import { createContext, useCallback, useContext, useMemo, useState } from "react";
import { toast } from "sonner";
import * as seed from "@/mock/data";
import { wait } from "@/lib/api";
import { quote } from "@/lib/domain";

const Ctx = createContext(null);

const initial = () => ({ ...structuredClone({ ...seed }), blocks: [] });

export function PreviewProvider({ children }) {
  const [db, setDb] = useState(initial);
  const [role, setRoleState] = useState(() => localStorage.getItem("nb-preview-role") || "guest");
  const [apptId, setApptId] = useState(null);
  const [profile, setProfile] = useState(null);
  const [newBooking, setNewBooking] = useState(null);

  const setRole = useCallback((r) => {
    localStorage.setItem("nb-preview-role", r);
    setRoleState(r);
  }, []);

  const patch = useCallback((col, id, changes) => {
    setDb((d) => ({ ...d, [col]: d[col].map((x) => (x.id === id ? { ...x, ...(typeof changes === "function" ? changes(x) : changes) } : x)) }));
  }, []);

  const api = useMemo(() => {
    const ok = async (fn, msg) => {
      await wait();
      fn();
      if (msg) toast.success(msg);
    };
    return {
      save: (col, id, changes, msg) => ok(() => patch(col, id, changes), msg),
      create: (col, item, msg) => ok(() => setDb((d) => ({ ...d, [col]: [item, ...d[col]] })), msg),
      remove: (col, id, msg) => ok(() => setDb((d) => ({ ...d, [col]: d[col].filter((x) => x.id !== id) })), msg),
      settings: (changes, msg) => ok(() => setDb((d) => ({ ...d, settings: { ...d.settings, ...changes } })), msg),
      schedule: (pid, ch, msg) => ok(() => setDb((d) => ({ ...d, schedules: { ...d.schedules, [pid]: { ...d.schedules[pid], ...ch } } })), msg),
      perms: (key, val) => ok(() => setDb((d) => ({ ...d, settings: { ...d.settings, receptionPerms: { ...d.settings.receptionPerms, [key]: val } } }))),
      transition: (id, to, msg) => ok(() => patch("appointments", id, { status: to }), msg),
      recordCash: (id, amount) =>
        ok(
          () =>
            patch("appointments", id, (a) => {
              const paid = +(a.settle.clientPaid + amount).toFixed(2);
              const balance = Math.max(0, +(a.pricing.total - paid).toFixed(2));
              return { settle: { ...a.settle, clientPaid: paid, balance }, pay: balance === 0 ? "paid" : "partial" };
            }),
          "Cash recorded"
        ),
      tripEvent: (apptId, kind, extra = {}, msg) => ok(() => setDb((d) => ({ ...d, tripEvents: [...d.tripEvents, { id: `te${Date.now()}`, apptId, kind, at: new Date().toISOString(), by: "You", channels: ["In-app"], ...extra }] })), msg),
      block: (practitionerId, date, time) => ok(() => setDb((d) => ({ ...d, blocks: [...d.blocks, { practitionerId, date, time, length: 60 }] })), "One hour blocked"),
      book: async (b) => {
        await wait(600);
        const id = `a${Date.now()}`;
        setDb((d) => {
          const s = d.services.find((x) => x.id === b.serviceId);
          const z = d.zones.find((x) => x.id === b.zoneId);
          const pricing = quote(s, z, b.discountPercent || 0);
          const appt = { id, status: "requested", pay: "unpaid", method: b.method || "cash", duration: s.duration, pricing, settle: { clientPaid: 0, balance: pricing.total, tip: 0 }, soap: "none", notes: "", ...b };
          return { ...d, appointments: [...d.appointments, appt] };
        });
        return id;
      },
    };
  }, [patch]);

  const value = useMemo(() => {
    const by = (col) => (id) => db[col].find((x) => x.id === id);
    return {
      db, role, setRole, api,
      svc: by("services"), pro: by("practitioners"), cli: by("clients"), zone: by("zones"),
      apptId, openAppt: setApptId, profile, openProfile: (type, id) => { setApptId(null); setProfile({ type, id }); }, closeProfile: () => setProfile(null),
      newBooking, openNewBooking: (prefill = {}) => setNewBooking(prefill), closeNewBooking: () => setNewBooking(null),
      me: { client: "c1", pro: "p1" },
    };
  }, [db, role, setRole, api, apptId, profile, newBooking]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export const usePreview = () => useContext(Ctx);
