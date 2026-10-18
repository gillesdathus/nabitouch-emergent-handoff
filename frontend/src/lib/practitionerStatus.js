export const GRACE_DAYS = 30;
export const REMINDER_DAYS = [1, 7, 14, 21, 27, 30];
const DAY = 86400000;

export const edmontonToday = () => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Edmonton" }).format(new Date());

function credentialState(credentials, attested, kind, today) {
  const mine = credentials.filter((c) => c.kind === kind);
  const current = mine.find((c) => c.status === "verified" && (!c.expiresOn || c.expiresOn >= today));
  if (current) {
    const soon = current.expiresOn && (new Date(current.expiresOn) - new Date(today)) / DAY <= 30;
    return { state: "verified", record: current, soon };
  }
  if (attested?.[kind]) return { state: "attested", attestation: attested[kind] };
  if (mine.some((c) => c.status !== "verified" && (!c.expiresOn || c.expiresOn >= today))) return { state: "submitted" };
  return { state: "missing" };
}

export function practitionerStatus({ person, credentials = [], board, schedule, today = edmontonToday() }) {
  const attested = board?.credentialAttestations || person.credentialAttestations || {};
  const gaps = board?.gaps || [];
  const mine = credentials.filter((c) => c.practitionerId === person.id);
  const reg = credentialState(mine, attested, "registration", today);
  const liab = credentialState(mine, attested, "liability", today);
  const approved = (person.onboardingStatus || "approved") === "approved";
  const credsOk = ["verified", "attested"].includes(reg.state) && ["verified", "attested"].includes(liab.state);
  const weekly = schedule ? (schedule.weekly || []).length > 0 && schedule.status === "approved" : !gaps.some((g) => ["weekly", "schedule_approval"].includes(g.id));
  const accepting = schedule ? schedule.acceptingBookings === true : !gaps.some((g) => g.id === "bookings_paused");
  const bookingReason = !approved ? "Profile not activated" : person.available === false || person.bookable === false ? "Turned off by owner" : !credsOk ? "Registration and liability insurance needed" : !weekly ? "Weekly hours not approved" : !accepting ? "New bookings paused" : "";
  const items = [
    ["photo", "Professional photo", Boolean(person.photo)],
    ["bio", "Public biography (40+ characters)", String(person.bio || "").trim().length >= 40],
    ["designation", "Designation (e.g. RMT)", Boolean(String(person.designation || "").trim())],
    ["specialties", "Services offered", (person.specialties || []).length > 0],
    ["qualifications", "Qualifications", (person.qualifications || []).length > 0],
    ["registration", "Registration document verified", reg.state === "verified"],
    ["liability", "Liability insurance verified", liab.state === "verified"],
    ["weekly", "Weekly hours approved", weekly],
  ].map(([id, label, done]) => ({ id, label, done }));
  const done = items.filter((i) => i.done).length;
  const started = board?.activatedAt || person.activatedAt || person.createdAt || "";
  const day = started ? Math.floor((new Date(today) - new Date(started.slice(0, 10))) / DAY) + 1 : null;
  const complete = done === items.length;
  return {
    account: board ? (gaps.some((g) => g.id === "login_email") ? ["amber", "No login linked"] : ["turq", board.accountStatus === "active" || !board.accountStatus ? "Login active" : `Login ${board.accountStatus}`]) : ["turq", "Login active"],
    profile: approved ? (person.profileVisibility === "hidden" ? ["slate", "Active · hidden"] : ["turq", "Profile active"]) : ["amber", `Profile ${person.onboardingStatus}`],
    booking: bookingReason ? ["red", "Not bookable", bookingReason] : ["turq", "Bookable"],
    credentials: reg.state === "verified" && liab.state === "verified" ? [reg.soon || liab.soon ? "amber" : "turq", reg.soon || liab.soon ? "Credentials expiring soon" : "Credentials verified"] : credsOk ? ["amber", "Owner attested · documents pending"] : ["red", "Credentials missing"],
    registration: reg,
    liability: liab,
    items,
    done,
    complete,
    day,
    daysLeft: day == null ? null : GRACE_DAYS - day + 1,
    overdue: !complete && day != null && day > GRACE_DAYS,
    reminderToday: !complete && day != null && REMINDER_DAYS.includes(day),
  };
}
