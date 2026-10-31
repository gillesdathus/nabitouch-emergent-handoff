import { api, apiError } from "@/lib/api";
import { getEngageEvent } from "@/fixtures/engage";

/** Map API event payload onto the shape Engage UI already uses. */
export function normalizeEngageEvent(raw, fallbackId) {
  if (!raw || typeof raw !== "object") return getEngageEvent(fallbackId);
  return {
    id: raw.id,
    name: raw.name,
    org: raw.org,
    date: raw.date,
    timeWindow: raw.timeWindow,
    place: raw.place,
    durationMinutes: raw.durationMinutes,
    serviceLabel: raw.serviceLabel,
    serviceSlug: raw.serviceSlug,
    therapist: raw.therapist,
    seatsRemaining: raw.seatsRemaining,
    status: raw.status,
    slots: (raw.slots || []).map((s) => ({
      id: s.id,
      label: s.label,
      time: s.time,
      remaining: s.remaining,
      capacity: s.capacity,
    })),
    writesEnabled: Boolean(raw.writesEnabled),
    consentVersion: raw.consentVersion,
    source: "api",
  };
}

export async function loadEngageEvent(eventId) {
  try {
    const remote = await api.engageEvent(eventId);
    return { event: normalizeEngageEvent(remote, eventId), source: "api", error: null };
  } catch (err) {
    return {
      event: getEngageEvent(eventId),
      source: "fixture",
      error: apiError(err),
    };
  }
}

export function buildEngageCheckInPayload(answers, { mode = "phone", idempotencyKey } = {}) {
  return {
    firstName: answers.firstName,
    lastName: answers.lastName,
    email: answers.email,
    phone: answers.phone,
    slotId: answers.slotId,
    screening: answers.screening || {},
    focusAreas: answers.focusAreas || [],
    pressure: answers.pressure || "medium",
    allergyNote: answers.allergyNote || "",
    consentAccepted: answers.consentAccepted === true,
    consentVersion: answers.consentVersion,
    idempotencyKey: idempotencyKey || undefined,
    mode,
  };
}

export async function submitEngageCheckIn(eventId, answers, opts = {}) {
  const body = buildEngageCheckInPayload(answers, opts);
  try {
    const result = await api.engageCheckIn(eventId, body);
    return { ok: true, result, error: null };
  } catch (err) {
    return { ok: false, result: null, error: apiError(err) };
  }
}
