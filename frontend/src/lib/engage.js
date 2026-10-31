import {
  ENGAGE_SCREENING,
  ENGAGE_STEPS,
  emptyEngageAnswers,
  getEngageEvent,
} from "@/fixtures/engage";

export function engageStepIndex(stepId) {
  const i = ENGAGE_STEPS.findIndex((s) => s.id === stepId);
  return i < 0 ? 0 : i;
}

export function engageProgress(stepId) {
  const i = engageStepIndex(stepId);
  const total = ENGAGE_STEPS.length;
  return { index: i, total, pct: Math.round(((i + 1) / total) * 100) };
}

/** Resolve tablet vs phone from query or coarse pointer. */
export function resolveEngageMode(searchParams, { coarsePointer } = {}) {
  const q = (searchParams?.get?.("mode") || "").toLowerCase();
  if (q === "tablet" || q === "kiosk") return "tablet";
  if (q === "phone" || q === "mobile") return "phone";
  if (coarsePointer) return "tablet";
  return "phone";
}

export function phoneDigits(value) {
  return String(value || "").replace(/\D/g, "");
}

export function emailLooksValid(value) {
  const v = String(value || "").trim();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);
}

export function screeningFlags(answers) {
  const screening = answers?.screening || {};
  const hard = [];
  const soft = [];
  for (const q of ENGAGE_SCREENING) {
    if (screening[q.id] === q.flagOn) {
      if (q.severity === "hard") hard.push(q);
      else soft.push(q);
    }
  }
  return { hard, soft, blocked: hard.length > 0 };
}

export function screeningComplete(answers) {
  const screening = answers?.screening || {};
  return ENGAGE_SCREENING.every((q) => screening[q.id] === "yes" || screening[q.id] === "no");
}

export function stepValid(stepId, answers, event) {
  const a = answers || emptyEngageAnswers();
  switch (stepId) {
    case "welcome":
      return true;
    case "contact": {
      const nameOk = a.firstName.trim().length >= 1 && a.lastName.trim().length >= 1;
      const emailOk = emailLooksValid(a.email);
      const phoneOk = phoneDigits(a.phone).length >= 10;
      return nameOk && emailOk && phoneOk;
    }
    case "slot": {
      const slot = (event?.slots || []).find((s) => s.id === a.slotId);
      return Boolean(slot && slot.remaining > 0);
    }
    case "screening":
      return screeningComplete(a);
    case "focus":
      return a.focusAreas.length > 0 && Boolean(a.pressure);
    case "consent":
      return a.consentAccepted === true && a.consentPage >= 2;
    case "confirm":
      return true;
    case "private":
      return true;
    default:
      return false;
  }
}

export function continueHint(stepId, answers, event) {
  if (stepValid(stepId, answers, event)) return "";
  if (stepId === "contact") return "Enter your name, work email, and a 10-digit mobile number.";
  if (stepId === "slot") return "Choose an open time slot to continue.";
  if (stepId === "screening") return "Answer each health question to continue.";
  if (stepId === "focus") return "Pick at least one focus area and a pressure preference.";
  if (stepId === "consent") return "Read each page, then confirm consent to continue.";
  return "";
}

/** Non-sensitive progress only — never persist screening/consent answers. */
export function readEngageProgress(eventId) {
  try {
    const raw = sessionStorage.getItem(`nt_engage_progress_v1:${eventId}`);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return null;
    return {
      stepId: typeof parsed.stepId === "string" ? parsed.stepId : "welcome",
      firstName: String(parsed.firstName || ""),
      lastName: String(parsed.lastName || ""),
      email: String(parsed.email || ""),
      phone: String(parsed.phone || ""),
      slotId: String(parsed.slotId || ""),
    };
  } catch {
    return null;
  }
}

export function writeEngageProgress(eventId, payload) {
  try {
    sessionStorage.setItem(
      `nt_engage_progress_v1:${eventId}`,
      JSON.stringify({
        stepId: payload.stepId,
        firstName: payload.firstName || "",
        lastName: payload.lastName || "",
        email: payload.email || "",
        phone: payload.phone || "",
        slotId: payload.slotId || "",
        at: Date.now(),
      }),
    );
  } catch {
    /* private mode */
  }
}

export function clearEngageProgress(eventId) {
  try {
    sessionStorage.removeItem(`nt_engage_progress_v1:${eventId}`);
  } catch {
    /* ignore */
  }
}

export function syntheticCheckInCode(answers, event) {
  const ev = event || getEngageEvent();
  const initials = `${(answers.firstName || "A")[0]}${(answers.lastName || "Z")[0]}`.toUpperCase();
  const slot = (ev.slots || []).find((s) => s.id === answers.slotId);
  const time = (slot?.label || "00").replace(":", "");
  return `NT-${ev.id.slice(0, 3).toUpperCase()}-${initials}${time}`;
}

export function formatEngageDate(value) {
  if (!value) return "—";
  try {
    return new Intl.DateTimeFormat("en-CA", {
      timeZone: "America/Edmonton",
      weekday: "short",
      month: "short",
      day: "numeric",
      year: "numeric",
    }).format(new Date(`${value}T12:00:00`));
  } catch {
    return value;
  }
}
