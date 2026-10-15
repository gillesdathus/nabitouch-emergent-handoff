export const GST = 0.05;

export const money = (n) =>
  `$${Number(n || 0).toLocaleString("en-CA", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
export const money0 = (n) => `$${Math.round(Number(n || 0)).toLocaleString("en-CA")}`;

const pad = (n) => String(n).padStart(2, "0");
export const toISO = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export const fromISO = (iso) => {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, m - 1, d);
};
export const todayISO = () => toISO(new Date());
export const addDays = (iso, n) => {
  const d = fromISO(iso);
  d.setDate(d.getDate() + n);
  return toISO(d);
};
export const fmtDate = (iso, opts = { weekday: "short", month: "short", day: "numeric" }) =>
  fromISO(iso).toLocaleDateString("en-CA", opts);
export const weekdayShort = (iso) => fromISO(iso).toLocaleDateString("en-CA", { weekday: "short" });
export const dayNum = (iso) => fromISO(iso).getDate();
export const minutesOf = (hhmm) => {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
};
export const hhmm = (mins) => `${pad(Math.floor(mins / 60))}:${pad(mins % 60)}`;
export const timeLabel = (t) => {
  const m = minutesOf(t);
  const h = Math.floor(m / 60);
  return `${((h + 11) % 12) + 1}:${pad(m % 60)} ${h < 12 ? "AM" : "PM"}`;
};
export const endTime = (t, dur) => hhmm(minutesOf(t) + dur);
export const greeting = () => {
  const h = new Date().getHours();
  return h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : "Good evening";
};
export const initials = (name = "") => name.split(" ").map((p) => p[0]).slice(0, 2).join("").toUpperCase();

export const STATUS = {
  requested: { label: "Requested", tone: "bg-sky-50 text-nb-blue ring-sky-200" },
  confirmed: { label: "Confirmed", tone: "bg-nb-turq/15 text-nb-teal ring-nb-turq/30" },
  en_route: { label: "En route", tone: "bg-nb-blue/10 text-nb-blue ring-nb-blue/25" },
  arrived: { label: "Arrived", tone: "bg-nb-cyan/15 text-[#0778A0] ring-nb-cyan/30" },
  in_session: { label: "In session", tone: "bg-nb-navy/10 text-nb-navy ring-nb-navy/20" },
  completed: { label: "Completed", tone: "bg-nb-green/15 text-[#3E7A1E] ring-nb-green/30" },
  cancelled: { label: "Cancelled", tone: "bg-nb-coral/10 text-nb-coral ring-nb-coral/25" },
  no_show: { label: "No-show", tone: "bg-nb-coral/10 text-nb-coral ring-nb-coral/25" },
};

export const PAY = {
  unpaid: { label: "Unpaid", tone: "bg-nb-coral/10 text-nb-coral ring-nb-coral/25" },
  partial: { label: "Partial", tone: "bg-nb-sky/15 text-nb-navy ring-nb-sky/30" },
  paid: { label: "Paid", tone: "bg-nb-green/15 text-[#3E7A1E] ring-nb-green/30" },
};

export const TRIP_FLOW = ["confirmed", "en_route", "arrived", "in_session", "completed"];
export const nextStatus = (s) => TRIP_FLOW[TRIP_FLOW.indexOf(s) + 1];
export const TRIP_ACTION = {
  confirmed: "Start trip",
  en_route: "I've arrived",
  arrived: "Start session",
  in_session: "Complete visit",
};

export const RECEPTION_PERMS = [
  { key: "viewLocations", label: "Live location", note: "On-duty trips only" },
  { key: "viewEta", label: "ETA", note: "Arrival estimates" },
  { key: "viewAddresses", label: "Addresses", note: "Appointment and client addresses" },
  { key: "assign", label: "Assign practitioners", note: "Assign or reassign" },
  { key: "createBooking", label: "Create bookings", note: "Create or reschedule" },
  { key: "viewInsuranceStatus", label: "Insurance status", note: "" },
  { key: "viewInsuranceDocs", label: "Insurance documents", note: "" },
  { key: "managePayments", label: "Payments", note: "Status and cash recording" },
  { key: "viewHistory", label: "Operational history", note: "" },
  { key: "clinical", label: "Clinical access", note: "Completion status only — never SOAP content" },
];

export const quote = (service, zone, discountPercent = 0) => {
  const price = +(service.price * (1 - discountPercent / 100)).toFixed(2);
  const travel = zone ? zone.fee : 0;
  const tax = +((price + travel) * GST).toFixed(2);
  return { price, travel, tax, total: +(price + travel + tax).toFixed(2), discount: +(service.price - price).toFixed(2) };
};
