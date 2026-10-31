/**
 * Synthetic demonstration data for NabiTouch Engage (engage.nabitouch.com).
 * Phase 1 UI prototype only — no real bookings, PHI collection, messages, or deploy.
 * Reuses conceptual links to Wellness Studio events; not a second booking/clinical DB.
 */

export const ENGAGE_DEMO = true;

/** Idle timeout on shared tablets before privacy reset (ms). */
export const ENGAGE_TABLET_IDLE_MS = 90_000;

export const ENGAGE_STEPS = [
  { id: "welcome", label: "Welcome" },
  { id: "contact", label: "Contact" },
  { id: "slot", label: "Time" },
  { id: "screening", label: "Health" },
  { id: "focus", label: "Focus" },
  { id: "consent", label: "Consent" },
  { id: "confirm", label: "Check-in" },
];

/** Clinical gate questions — chair massage event screening (not a substitute for full intake). */
export const ENGAGE_SCREENING = [
  {
    id: "unwell",
    label: "Do you have a fever, cough, or feel unwell today?",
    kind: "yesno",
    flagOn: "yes",
    severity: "hard",
    hint: "If yes, we will pause and help you speak privately with the therapist.",
  },
  {
    id: "contagious",
    label: "Do you have a known contagious skin condition or open wound in areas we would touch?",
    kind: "yesno",
    flagOn: "yes",
    severity: "hard",
  },
  {
    id: "clot",
    label: "Have you been diagnosed with a blood clot (DVT), active thrombosis, or been told to avoid massage?",
    kind: "yesno",
    flagOn: "yes",
    severity: "hard",
  },
  {
    id: "injury",
    label: "Do you have a recent fracture, sprain, or acute injury in your neck, back, or arms?",
    kind: "yesno",
    flagOn: "yes",
    severity: "soft",
    followUp: "Your therapist will adapt pressure and avoid injured areas.",
  },
  {
    id: "pregnancy",
    label: "Are you currently pregnant?",
    kind: "yesno",
    flagOn: "yes",
    severity: "soft",
    followUp: "We use pregnancy-safe positioning and pressure only.",
  },
  {
    id: "allergy",
    label: "Do you have allergies to massage lotion, oils, nuts, or fragrances?",
    kind: "yesno",
    flagOn: "yes",
    severity: "soft",
    followUp: "We can use fragrance-free product or no lotion.",
  },
];

export const ENGAGE_FOCUS_AREAS = [
  { id: "neck", label: "Neck" },
  { id: "shoulders", label: "Shoulders" },
  { id: "upper_back", label: "Upper back" },
  { id: "lower_back", label: "Lower back" },
  { id: "arms", label: "Arms / hands" },
  { id: "hips", label: "Hips" },
];

export const ENGAGE_PRESSURE = [
  { id: "light", label: "Light" },
  { id: "medium", label: "Medium" },
  { id: "firm", label: "Firm" },
];

export const ENGAGE_CONSENT_PAGES = [
  {
    title: "What today’s session includes",
    body: [
      "You are registering for a short, clothed chair or seated massage provided by a NabiTouch registered massage therapist at a workplace wellness event.",
      "Sessions are typically 10–15 minutes. Treatment focuses on neck, shoulders, back, and arms unless you ask us to avoid an area.",
      "This is not a substitute for medical care. If you need a full clinical assessment, ask the therapist about a private follow-up booking.",
    ],
  },
  {
    title: "Privacy & your employer",
    body: [
      "Your employer can see that you checked in for the event and which time slot you used. They do not receive your health screening answers, focus areas, or clinical notes.",
      "Health answers stay with NabiTouch for safe treatment. If a private clinical follow-up is needed, that conversation is between you and NabiTouch — not shared with HR or managers.",
      "On shared tablets, your answers are cleared when you finish or after a short idle timeout so the next person cannot see them.",
    ],
  },
  {
    title: "Informed consent",
    body: [
      "By continuing you confirm the screening answers you provided are accurate to the best of your knowledge, and you consent to a brief therapeutic massage today.",
      "You may stop the session at any time. Tell the therapist immediately if pressure is uncomfortable or if you feel dizzy, numb, or unwell.",
      "NabiTouch may refuse or modify treatment when screening suggests a contraindication. That decision protects you and is not reported as a performance or attendance issue to your employer.",
    ],
  },
];

const EVENTS = {
  "aurora-chair-day": {
    id: "aurora-chair-day",
    name: "Aurora · Chair massage day",
    org: "Aurora North Consulting",
    date: "2026-11-06",
    timeWindow: "11:00–15:00",
    place: "Downtown office · Floor 12 lounge",
    durationMinutes: 12,
    serviceLabel: "Workplace chair massage",
    serviceSlug: "workplace-chair",
    therapist: "Nabitu · RMT (on-site)",
    seatsRemaining: 18,
    slots: [
      { id: "s-1100", label: "11:00", remaining: 2 },
      { id: "s-1115", label: "11:15", remaining: 1 },
      { id: "s-1130", label: "11:30", remaining: 2 },
      { id: "s-1145", label: "11:45", remaining: 0 },
      { id: "s-1300", label: "1:00", remaining: 2 },
      { id: "s-1315", label: "1:15", remaining: 2 },
      { id: "s-1330", label: "1:30", remaining: 1 },
      { id: "s-1345", label: "1:45", remaining: 2 },
    ],
  },
  "clearsky-afternoon": {
    id: "clearsky-afternoon",
    name: "ClearSky wellness afternoon",
    org: "ClearSky Energy Ops",
    date: "2026-11-14",
    timeWindow: "13:00–16:00",
    place: "Sherwood Park HQ · Atrium",
    durationMinutes: 12,
    serviceLabel: "Workplace chair massage",
    serviceSlug: "workplace-chair",
    therapist: "Nabitu · RMT (on-site)",
    seatsRemaining: 24,
    slots: [
      { id: "c-1300", label: "1:00", remaining: 3 },
      { id: "c-1315", label: "1:15", remaining: 2 },
      { id: "c-1330", label: "1:30", remaining: 3 },
      { id: "c-1445", label: "2:45", remaining: 1 },
      { id: "c-1500", label: "3:00", remaining: 2 },
      { id: "c-1515", label: "3:15", remaining: 2 },
    ],
  },
};

export const DEFAULT_ENGAGE_EVENT_ID = "aurora-chair-day";

export function getEngageEvent(eventId) {
  return EVENTS[eventId] || EVENTS[DEFAULT_ENGAGE_EVENT_ID];
}

export function listEngageEvents() {
  return Object.values(EVENTS);
}

export function emptyEngageAnswers() {
  return {
    firstName: "",
    lastName: "",
    email: "",
    phone: "",
    slotId: "",
    screening: {},
    focusAreas: [],
    pressure: "medium",
    allergyNote: "",
    consentAccepted: false,
    consentPage: 0,
    privateFollowUpRequested: false,
  };
}
