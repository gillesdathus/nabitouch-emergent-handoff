// DESIGN PREVIEW MOCK DATA — fictional people, prices and records. Not Nabitouch business data.
import { addDays, todayISO, quote } from "@/lib/domain";

const T = todayISO();

export const services = [
  { id: "s1", slug: "swedish", name: "Swedish Relaxation", category: "Relax", duration: 60, price: 115, img: "/img/swedish.jpg", published: true, blurb: "Long, flowing strokes that calm the nervous system.", benefits: ["Stress relief", "Better sleep", "Circulation"], prep: ["Hydrate beforehand", "Clear a 2×1 m space"] },
  { id: "s2", slug: "deep-tissue", name: "Deep Tissue", category: "Recover", duration: 60, price: 130, img: "/img/deep.jpg", published: true, blurb: "Focused pressure for chronic tension and knots.", benefits: ["Chronic tension", "Posture", "Mobility"], prep: ["Note sore areas", "Avoid a heavy meal"] },
  { id: "s3", slug: "hot-stone", name: "Hot Stone Ritual", category: "Relax", duration: 90, price: 175, img: "/img/hotstone.jpg", published: true, blurb: "Warm basalt stones melt deep muscle tension.", benefits: ["Deep warmth", "Muscle release", "Calm"], prep: ["Power outlet nearby"] },
  { id: "s4", slug: "prenatal", name: "Prenatal Care", category: "Care", duration: 60, price: 125, img: "/img/prenatal.jpg", published: true, blurb: "Side-lying support designed for every trimester.", benefits: ["Back relief", "Swelling", "Rest"], prep: ["Extra pillows welcome"] },
  { id: "s5", slug: "sports", name: "Sports Recovery", category: "Recover", duration: 75, price: 145, img: "/img/sports.jpg", published: true, blurb: "Targeted work before or after training.", benefits: ["Faster recovery", "Range of motion", "Injury prevention"], prep: ["Share your training load"] },
  { id: "s6", slug: "foot-reflexology", name: "Foot Reflexology", category: "Care", duration: 45, price: 85, img: "/img/foot.jpg", published: true, blurb: "Pressure-point work for feet that carry you all day.", benefits: ["Tired feet", "Relaxation"], prep: ["Comfortable seat"] },
  { id: "s7", slug: "scalp-neck", name: "Scalp & Neck Release", category: "Relax", duration: 30, price: 65, img: "/img/scalp.jpg", published: true, blurb: "A short reset for screen-heavy days.", benefits: ["Headache relief", "Neck tension"], prep: [] },
  { id: "s8", slug: "senior", name: "Gentle Senior Massage", category: "Care", duration: 60, price: 110, img: "", published: false, blurb: "Light, mobility-friendly massage.", benefits: ["Gentle mobility"], prep: ["Chair or bed"] },
];

export const practitioners = [
  { id: "p1", slug: "amira-haddad", name: "Amira Haddad", title: "Registered Massage Therapist", photo: "/img/team/amira.jpg", specialties: ["s1", "s2", "s4"], years: 8, languages: ["English", "Arabic", "French"], status: "active", bookable: true, accepting: true, color: "#1565F0", bio: "Calm, precise and anatomy-led. Amira blends Swedish and deep tissue work and has a special focus on prenatal care.", pos: [42, 46] },
  { id: "p2", slug: "lucas-fontaine", name: "Lucas Fontaine", title: "Sports Massage Therapist", photo: "/img/team/lucas.jpg", specialties: ["s2", "s5", "s7"], years: 6, languages: ["English", "French"], status: "active", bookable: true, accepting: true, color: "#0E9E9A", bio: "Former varsity athlete. Lucas works with runners, hockey players and desk warriors alike.", pos: [63, 30] },
  { id: "p3", slug: "priya-nair", name: "Priya Nair", title: "Registered Massage Therapist", photo: "/img/team/priya.jpg", specialties: ["s1", "s3", "s6"], years: 11, languages: ["English", "Hindi"], status: "active", bookable: true, accepting: true, color: "#7BC74D", bio: "Hot stone specialist with a warm, unhurried style. Priya's sessions feel like a retreat at home.", pos: [30, 68] },
  { id: "p4", slug: "elise-moreau", name: "Elise Moreau", title: "Massage Therapist (onboarding)", photo: "/img/team/elise.jpg", specialties: ["s1", "s6"], years: 3, languages: ["English", "French"], status: "onboarding", bookable: false, accepting: false, color: "#18A8F5", bio: "Joining the team soon.", pos: [70, 72] },
];

export const zones = [
  { id: "z1", name: "Central", fee: 0, color: "#1565F0", poly: "38,30 62,26 66,50 44,56 34,46" },
  { id: "z2", name: "South", fee: 15, color: "#14D8C4", poly: "34,56 66,50 72,78 40,84 26,70" },
  { id: "z3", name: "West", fee: 15, color: "#18A8F5", poly: "8,30 38,30 34,46 26,70 6,62" },
  { id: "z4", name: "North", fee: 20, color: "#0E9E9A", poly: "20,6 70,4 62,26 38,30 16,24" },
  { id: "z5", name: "Sherwood Park", fee: 30, color: "#7BC74D", poly: "70,22 94,20 96,52 72,56 66,50 62,26" },
];

export const clients = [
  { id: "c1", name: "Sophie Laurent", email: "sophie@example.com", phone: "780-555-0141", address: "10234 98 Ave NW", zoneId: "z1", since: "2025-03-12", insurance: "Preference saved — not connected", tags: ["Prefers evenings"], intake: "complete" },
  { id: "c2", name: "Daniel Okafor", email: "daniel@example.com", phone: "780-555-0162", address: "5520 Riverbend Rd NW", zoneId: "z2", since: "2025-07-02", insurance: "None", tags: ["Lower back"], intake: "complete" },
  { id: "c3", name: "Mei Chen", email: "mei@example.com", phone: "780-555-0173", address: "8812 Jasper Ave", zoneId: "z1", since: "2026-01-20", insurance: "Preference saved — not connected", tags: ["Prenatal · 28 wks"], intake: "pending" },
  { id: "c4", name: "Rachel Gauthier", email: "rachel@example.com", phone: "780-555-0188", address: "17 Brentwood Blvd", zoneId: "z5", since: "2024-11-05", insurance: "None", tags: [], intake: "complete" },
  { id: "c5", name: "Tomás Rivera", email: "tomas@example.com", phone: "780-555-0119", address: "15911 100A Ave NW", zoneId: "z3", since: "2026-05-14", insurance: "None", tags: ["Runner"], intake: "complete" },
  { id: "c6", name: "Hannah Becker", email: "hannah@example.com", phone: "780-555-0127", address: "13240 Fort Rd NW", zoneId: "z4", since: "2026-08-30", insurance: "None", tags: [], intake: "pending" },
];

const mk = (id, off, time, sid, pid, cid, status, pay, extra = {}) => {
  const s = services.find((x) => x.id === sid);
  const c = clients.find((x) => x.id === cid);
  const z = zones.find((x) => x.id === c.zoneId);
  const pricing = quote(s, z);
  const paid = pay === "paid" ? pricing.total : pay === "partial" ? 50 : 0;
  return {
    id, date: addDays(T, off), time, duration: s.duration, serviceId: sid, practitionerId: pid, clientId: cid,
    status, pay, method: extra.method || "cash", pricing, settle: { clientPaid: paid, balance: +(pricing.total - paid).toFixed(2), tip: extra.tip || 0 },
    address: c.address, zoneId: c.zoneId, notes: extra.notes || "", soap: extra.soap || "none", eta: extra.eta,
  };
};

export const appointments = [
  mk("a01", 0, "08:30", "s1", "p1", "c1", "completed", "paid", { soap: "signed", tip: 15 }),
  mk("a02", 0, "11:00", "s2", "p1", "c2", "en_route", "unpaid", { eta: 14 }),
  mk("a03", 0, "14:00", "s4", "p1", "c3", "confirmed", "unpaid", { notes: "Third trimester — side-lying please." }),
  mk("a04", 0, "17:30", "s1", "p1", "c4", "confirmed", "unpaid"),
  mk("a05", 0, "09:30", "s5", "p2", "c5", "in_session", "partial"),
  mk("a06", 0, "13:00", "s7", "p2", "c6", "confirmed", "unpaid"),
  mk("a07", 0, "10:00", "s3", "p3", "c4", "completed", "paid", { soap: "draft" }),
  mk("a08", 0, "15:30", "s6", "p3", "c1", "requested", "unpaid"),
  mk("a09", 1, "10:00", "s2", "p2", "c2", "confirmed", "unpaid"),
  mk("a10", 1, "16:00", "s1", "p3", "c3", "confirmed", "unpaid"),
  mk("a11", 2, "12:00", "s5", "p2", "c5", "confirmed", "unpaid"),
  mk("a12", 3, "18:00", "s1", "p1", "c1", "confirmed", "unpaid"),
  mk("a13", 4, "09:00", "s3", "p3", "c6", "requested", "unpaid"),
  mk("a14", -1, "11:00", "s2", "p1", "c5", "completed", "paid", { soap: "signed" }),
  mk("a15", -1, "15:00", "s1", "p3", "c2", "completed", "partial", { soap: "signed" }),
  mk("a16", -2, "10:30", "s5", "p2", "c4", "completed", "paid", { soap: "signed", method: "card" }),
  mk("a17", -3, "13:00", "s4", "p1", "c3", "completed", "paid", { soap: "signed" }),
  mk("a18", -4, "17:00", "s6", "p3", "c1", "completed", "unpaid", { soap: "draft" }),
  mk("a19", -5, "09:00", "s2", "p2", "c6", "cancelled", "unpaid"),
  mk("a20", -6, "14:30", "s1", "p1", "c2", "completed", "paid", { soap: "signed" }),
];

export const schedules = {
  p1: { weekly: { 1: ["08:00", "19:00"], 2: ["08:00", "19:00"], 3: ["08:00", "19:00"], 4: ["08:00", "19:00"], 5: ["09:00", "15:00"] }, breaks: [["12:30", "13:30"]], status: "approved" },
  p2: { weekly: { 1: ["09:00", "18:00"], 2: ["09:00", "18:00"], 4: ["09:00", "18:00"], 5: ["09:00", "18:00"], 6: ["10:00", "16:00"] }, breaks: [["12:00", "12:45"]], status: "approved" },
  p3: { weekly: { 0: ["10:00", "16:00"], 2: ["09:00", "19:00"], 3: ["09:00", "19:00"], 4: ["09:00", "19:00"], 6: ["10:00", "16:00"] }, breaks: [["13:00", "14:00"]], status: "approved" },
  p4: { weekly: { 1: ["10:00", "16:00"], 3: ["10:00", "16:00"] }, breaks: [], status: "pending" },
};

export const campaigns = [
  { id: "cp1", name: "Thursday evening calm", serviceId: "s1", discountPercent: 20, status: "live", bookingStart: T, windowStart: "17:00", windowEnd: "20:00", expiresAt: new Date(Date.now() + 5.5 * 3600e3).toISOString(), audience: "Past clients · Central", stats: { views: 214, bookings: 6 } },
  { id: "cp2", name: "Post-race recovery", serviceId: "s5", discountPercent: 15, status: "paused", bookingStart: addDays(T, 2), windowStart: "09:00", windowEnd: "13:00", expiresAt: new Date(Date.now() + 52 * 3600e3).toISOString(), audience: "Runners", stats: { views: 88, bookings: 2 } },
  { id: "cp3", name: "Hot stone weekend", serviceId: "s3", discountPercent: 10, status: "draft", bookingStart: addDays(T, 9), windowStart: "10:00", windowEnd: "16:00", expiresAt: new Date(Date.now() + 9 * 86400e3).toISOString(), audience: "All clients", stats: { views: 0, bookings: 0 } },
];

export const promotions = [
  { id: "pr1", name: "Welcome offer", kind: "10% off first visit", enabled: true, seeded: true, eligibility: "new_clients", uses: 31 },
  { id: "pr2", name: "Bring a friend", kind: "$20 off both visits", enabled: false, eligibility: "referral", uses: 0 },
];
export const giftCards = [
  { id: "g1", code: "NB-7Q4K-2210", value: 150, balance: 85, holder: "Rachel Gauthier" },
  { id: "g2", code: "NB-3MXP-9031", value: 100, balance: 100, holder: "Sophie Laurent" },
];

export const credentials = [
  { id: "cr1", practitionerId: "p1", type: "Massage therapist registration", status: "verified", expires: addDays(T, 220) },
  { id: "cr2", practitionerId: "p1", type: "Liability insurance", status: "expiring", expires: addDays(T, 18) },
  { id: "cr3", practitionerId: "p2", type: "Massage therapist registration", status: "verified", expires: addDays(T, 340) },
  { id: "cr4", practitionerId: "p3", type: "First aid & CPR", status: "verified", expires: addDays(T, 120) },
  { id: "cr5", practitionerId: "p4", type: "Massage therapist registration", status: "pending", expires: addDays(T, 365) },
  { id: "cr6", practitionerId: "p4", type: "Liability insurance", status: "pending", expires: addDays(T, 365) },
];
export const onboarding = { p4: { credentials: false, account: true, services: true, schedule: false } };

export const reports = [
  { id: "r1", practitionerId: "p1", year: 2026, month: 9, half: 2, status: "published", visits: 22, gross: 2915 },
  { id: "r2", practitionerId: "p2", year: 2026, month: 9, half: 2, status: "approved", visits: 18, gross: 2480 },
  { id: "r3", practitionerId: "p3", year: 2026, month: 9, half: 2, status: "draft", visits: 20, gross: 2760 },
  { id: "r4", practitionerId: "p1", year: 2026, month: 10, half: 1, status: "draft", visits: 12, gross: 1590 },
];

export const plans = [
  { id: "pl1", practitionerId: "p1", clientId: "c3", title: "Prenatal comfort plan", sessions: 6, done: 2, visible: true },
  { id: "pl2", practitionerId: "p1", clientId: "c2", title: "Lower back reset", sessions: 4, done: 3, visible: true },
];

export const gaps = [
  { id: "g1", practitionerId: "p1", date: T, time: "15:30", length: 90, state: "open", watchers: 3 },
  { id: "g2", practitionerId: "p2", date: addDays(T, 1), time: "13:00", length: 60, state: "offered", watchers: 1 },
];

export const scenarios = [
  { id: "tr1", name: "New receptionist onboarding", status: "active", createdAt: new Date(Date.now() - 2 * 86400e3).toISOString(), expiresAt: new Date(Date.now() + 5 * 86400e3).toISOString(), days: 7, progress: 0.45, tasks: ["Book a visit", "Check in a client", "Record cash", "Reschedule"] },
  { id: "tr2", name: "Practitioner SOAP practice", status: "ended", createdAt: new Date(Date.now() - 20 * 86400e3).toISOString(), expiresAt: new Date(Date.now() - 6 * 86400e3).toISOString(), days: 14, progress: 1, tasks: ["Start trip", "Write SOAP", "Sign note"] },
];

export const notifications = [
  { id: "n1", kind: "booking", title: "New booking request", body: "Foot Reflexology · today 3:30 PM with Priya", at: "8 min ago", unread: true },
  { id: "n2", kind: "credential", title: "Liability insurance expiring", body: "Amira Haddad · in 18 days", at: "1 h ago", unread: true },
  { id: "n3", kind: "payment", title: "Cash recorded", body: "$125.75 · Sophie Laurent", at: "3 h ago", unread: false },
  { id: "n4", kind: "system", title: "Promotional sending is off", body: "Live campaigns stay bookable in-app.", at: "Yesterday", unread: false },
];

export const tripEvents = [
  { id: "te1", apptId: "a02", kind: "started", at: new Date(Date.now() - 16 * 60e3).toISOString(), by: "Amira Haddad", channels: ["In-app"] },
  { id: "te2", apptId: "a02", kind: "late", delay: 5, reason: "Traffic", at: new Date(Date.now() - 6 * 60e3).toISOString(), by: "Amira Haddad", channels: ["In-app", "SMS"] },
];

export const messages = [
  { id: "m1", from: "Lucas Fontaine", body: "Running ~10 min late to Tomás — traffic on Whitemud.", at: "09:12", kind: "late" },
  { id: "m2", from: "System", body: "Mei Chen's intake form is still pending.", at: "08:40", kind: "info" },
];

export const audit = [
  { id: "au1", who: "Amira Haddad", what: "Signed SOAP note", ref: "a01", at: "08:58" },
  { id: "au2", who: "Owner", what: "Approved report Sep 16–30", ref: "r2", at: "Yesterday" },
  { id: "au3", who: "Reception", what: "Recorded cash $125.75", ref: "a01", at: "Yesterday" },
  { id: "au4", who: "Owner", what: "Paused campaign “Post-race recovery”", ref: "cp2", at: "2 days ago" },
];

export const settings = {
  clinicBookable: false,
  promotionalSending: false,
  rewardsEnabled: false,
  cardCheckout: false,
  mapbox: false,
  businessOpen: true,
  cancellation: "Free cancellation up to 24 hours before your visit.",
  paymentPolicy: "Cash or card at the visit. Cash is recorded only when received.",
  rewards: { pointsPerDollar: 1, threshold: 500, reward: "$25 credit" },
  receptionPerms: { viewLocations: true, viewEta: true, viewAddresses: true, assign: true, createBooking: true, viewInsuranceStatus: true, viewInsuranceDocs: false, managePayments: true, viewHistory: true, clinical: false },
};

export const staff = [
  { id: "st1", name: "Maya Singh", role: "desk", email: "maya@example.com", status: "active" },
  { id: "st2", name: "Elise Moreau", role: "practitioner", email: "elise@example.com", status: "invited" },
];

export const people = { owner: { name: "Alex" }, desk: { name: "Maya" } };
