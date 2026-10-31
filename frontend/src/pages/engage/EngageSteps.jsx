import { motion, useReducedMotion } from "framer-motion";
import {
  ArrowRight,
  CalendarDays,
  Check,
  MapPin,
  ShieldCheck,
  Sparkles,
  UserRound,
} from "lucide-react";
import {
  ENGAGE_CONSENT_PAGES,
  ENGAGE_FOCUS_AREAS,
  ENGAGE_PRESSURE,
  ENGAGE_SCREENING,
} from "@/fixtures/engage";
import { formatEngageDate, screeningFlags, syntheticCheckInCode } from "@/lib/engage";
import { EngageHeading, EngageYesNo } from "./EngageShell";

export function StepMotion({ stepKey, children }) {
  const reduce = useReducedMotion();
  return (
    <motion.div
      key={stepKey}
      className="flex min-h-0 flex-1 flex-col"
      initial={reduce ? false : { opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={reduce ? { duration: 0 } : { duration: 0.28, ease: [0.2, 0.7, 0.2, 1] }}
    >
      {children}
    </motion.div>
  );
}

export function IdleStart({ event, mode, onStart }) {
  return (
    <div className="engage-card" data-testid="engage-idle">
      <div className="engage-card-body flex flex-col justify-between">
        <div>
          <div className="mx-auto mb-4 grid h-20 w-20 place-items-center rounded-full bg-gradient-to-br from-[#1565F0] to-[#14D8C4] shadow-lg">
            <Sparkles className="h-9 w-9 text-white" aria-hidden="true" />
          </div>
          <EngageHeading
            title="Workplace wellness check-in"
            sub="Register in about two minutes. No account required."
            testid="engage-idle-heading"
          />
          <div className="space-y-2 rounded-2xl bg-[#E8F6F3] p-4 text-sm text-nb-ink" data-testid="engage-idle-event">
            <p className="font-semibold">{event.name}</p>
            <p className="flex items-start gap-2 text-nb-mute">
              <CalendarDays className="mt-0.5 h-4 w-4 shrink-0 text-nb-teal" aria-hidden="true" />
              {formatEngageDate(event.date)} · {event.timeWindow}
            </p>
            <p className="flex items-start gap-2 text-nb-mute">
              <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-nb-teal" aria-hidden="true" />
              {event.place}
            </p>
            <p className="text-xs text-nb-mute">{event.org} · {event.durationMinutes}-minute {event.serviceLabel.toLowerCase()}</p>
          </div>
        </div>
        <div className="mt-6 space-y-3">
          <button type="button" className="engage-primary text-base" data-testid="engage-start" onClick={onStart}>
            Start check-in
            <ArrowRight className="h-5 w-5" aria-hidden="true" />
          </button>
          {mode === "tablet" ? (
            <p className="text-center text-xs text-nb-mute" data-testid="engage-tablet-privacy-note">
              Shared tablet · your answers clear after you finish or after idle timeout.
            </p>
          ) : (
            <p className="text-center text-xs text-nb-mute">Phone mode · progress for contact and slot only is kept in this browser tab.</p>
          )}
          <p className="text-center text-[11px] font-medium uppercase tracking-wider text-amber-700/90">Synthetic demo — no real booking</p>
        </div>
      </div>
    </div>
  );
}

export function PrivacyReset({ onReady }) {
  return (
    <div className="engage-card" data-testid="engage-reset">
      <div className="engage-card-body flex flex-col items-center justify-center text-center">
        <div className="mb-4 grid h-16 w-16 place-items-center rounded-full bg-[#E8F6F3]">
          <ShieldCheck className="h-8 w-8 text-nb-teal" aria-hidden="true" />
        </div>
        <h1 className="font-display text-2xl font-semibold text-nb-ink">Ready for the next guest</h1>
        <p className="mt-2 max-w-sm text-sm text-nb-mute">
          Previous answers were cleared from this tablet. Nothing from the last person is visible.
        </p>
        <button type="button" className="engage-primary mt-8 max-w-xs" data-testid="engage-reset-continue" onClick={onReady}>
          Continue
        </button>
      </div>
    </div>
  );
}

export function StepWelcome({ event, mode, onContinue }) {
  return (
    <div className="engage-card" data-testid="engage-step-welcome">
      <div className="engage-card-body flex flex-col">
        <EngageHeading
          title={`Hi — welcome to ${event.org.split(" ")[0]}’s wellness day`}
          sub="We’ll confirm your contact details, pick a time, screen for safe treatment, and show your check-in code."
          testid="engage-welcome-heading"
        />
        <ul className="mt-2 space-y-3 text-sm text-nb-ink">
          {[
            "No account creation",
            "Health answers stay private from your employer",
            `${event.durationMinutes}-minute ${event.serviceLabel.toLowerCase()} with ${event.therapist}`,
          ].map((line) => (
            <li key={line} className="flex gap-2">
              <Check className="mt-0.5 h-4 w-4 shrink-0 text-nb-teal" aria-hidden="true" />
              <span>{line}</span>
            </li>
          ))}
        </ul>
        <div className="mt-auto pt-6">
          <button type="button" className="engage-primary" data-testid="engage-welcome-continue" onClick={onContinue}>
            Continue
            <ArrowRight className="h-4 w-4" aria-hidden="true" />
          </button>
          {mode === "tablet" ? (
            <p className="mt-3 text-center text-xs text-nb-mute">Tap Start on the idle screen between guests.</p>
          ) : null}
        </div>
      </div>
    </div>
  );
}

export function StepContact({ answers, setAnswers, errors }) {
  const set = (key) => (e) => setAnswers({ ...answers, [key]: e.target.value });
  return (
    <div className="engage-card" data-testid="engage-step-contact">
      <div className="engage-card-body engage-card-body--scroll">
        <EngageHeading
          title="Your contact details"
          sub="Used only for this event check-in and therapist safety — not for creating an account."
          testid="engage-contact-heading"
        />
        <div className="grid gap-3">
          <label className="block text-sm">
            <span className="nb-label">First name</span>
            <input
              className="engage-input"
              autoComplete="off"
              autoCorrect="off"
              spellCheck={false}
              name="engage-first-name"
              value={answers.firstName}
              onChange={set("firstName")}
              aria-invalid={Boolean(errors.firstName)}
              aria-describedby={errors.firstName ? "engage-err-first" : undefined}
              data-testid="engage-first-name"
              placeholder="First name"
            />
            {errors.firstName ? (
              <span id="engage-err-first" className="mt-1 block text-xs text-red-700" role="alert">
                {errors.firstName}
              </span>
            ) : null}
          </label>
          <label className="block text-sm">
            <span className="nb-label">Last name</span>
            <input
              className="engage-input"
              autoComplete="off"
              name="engage-last-name"
              value={answers.lastName}
              onChange={set("lastName")}
              aria-invalid={Boolean(errors.lastName)}
              data-testid="engage-last-name"
              placeholder="Last name"
            />
          </label>
          <label className="block text-sm">
            <span className="nb-label">Work email</span>
            <input
              type="email"
              inputMode="email"
              className="engage-input"
              autoComplete="off"
              name="engage-email"
              value={answers.email}
              onChange={set("email")}
              aria-invalid={Boolean(errors.email)}
              aria-describedby={errors.email ? "engage-err-email" : undefined}
              data-testid="engage-email"
              placeholder="you@company.com"
            />
            {errors.email ? (
              <span id="engage-err-email" className="mt-1 block text-xs text-red-700" role="alert">
                {errors.email}
              </span>
            ) : null}
          </label>
          <label className="block text-sm">
            <span className="nb-label">Mobile phone</span>
            <input
              type="tel"
              inputMode="tel"
              className="engage-input"
              autoComplete="off"
              name="engage-phone"
              value={answers.phone}
              onChange={set("phone")}
              aria-invalid={Boolean(errors.phone)}
              aria-describedby={errors.phone ? "engage-err-phone" : undefined}
              data-testid="engage-phone"
              placeholder="(780) 555-0100"
            />
            {errors.phone ? (
              <span id="engage-err-phone" className="mt-1 block text-xs text-red-700" role="alert">
                {errors.phone}
              </span>
            ) : null}
          </label>
        </div>
      </div>
    </div>
  );
}

export function StepSlot({ event, answers, setAnswers }) {
  return (
    <div className="engage-card" data-testid="engage-step-slot">
      <div className="engage-card-body engage-card-body--scroll">
        <EngageHeading
          title="Choose your time"
          sub={`${event.durationMinutes}-minute session · ${event.seatsRemaining} seats left today (demo).`}
          testid="engage-slot-heading"
        />
        <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3" role="listbox" aria-label="Available time slots">
          {event.slots.map((slot) => {
            const full = slot.remaining <= 0;
            const on = answers.slotId === slot.id;
            return (
              <button
                key={slot.id}
                type="button"
                role="option"
                aria-selected={on}
                disabled={full}
                data-testid={`engage-slot-${slot.id}`}
                onClick={() => setAnswers({ ...answers, slotId: slot.id })}
                className={`min-h-[3.75rem] rounded-2xl border-2 px-3 py-2 text-left transition-[border-color,background-color,transform] duration-200 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-40 ${
                  on ? "border-nb-teal bg-[#E3FAF5]" : "border-sky-100 bg-white hover:border-sky-200"
                }`}
              >
                <span className="block text-base font-semibold text-nb-ink">{slot.label}</span>
                <span className="text-[11px] text-nb-mute">{full ? "Full" : `${slot.remaining} open`}</span>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

export function StepScreening({ answers, setAnswers, questionIndex }) {
  const q = ENGAGE_SCREENING[questionIndex] || ENGAGE_SCREENING[0];
  const value = answers.screening[q.id] || "";
  const setValue = (v) =>
    setAnswers({
      ...answers,
      screening: { ...answers.screening, [q.id]: v },
    });

  return (
    <div className="engage-card" data-testid="engage-step-screening">
      <div className="engage-card-body flex flex-col">
        <p className="nb-eyebrow mb-2">
          Health screening · {questionIndex + 1} of {ENGAGE_SCREENING.length}
        </p>
        <EngageHeading title={q.label} sub={q.hint || "Answer honestly so we can treat you safely."} testid="engage-screening-heading" />
        <EngageYesNo
          name={q.label}
          value={value}
          onChange={setValue}
          testid={`engage-screen-${q.id}`}
        />
        {value === q.flagOn && q.followUp ? (
          <p className="mt-4 rounded-2xl bg-sky-50 px-3 py-2 text-xs text-nb-ink" role="status" data-testid="engage-screening-followup">
            {q.followUp}
          </p>
        ) : null}
        <p className="mt-auto pt-4 text-[11px] leading-snug text-nb-mute">
          Screening answers are not shared with your employer. Hard stops route to a private therapist conversation.
        </p>
      </div>
    </div>
  );
}

export function StepFocus({ answers, setAnswers }) {
  const toggle = (id) => {
    const has = answers.focusAreas.includes(id);
    setAnswers({
      ...answers,
      focusAreas: has ? answers.focusAreas.filter((x) => x !== id) : [...answers.focusAreas, id],
    });
  };
  const allergyOn = answers.screening.allergy === "yes";

  return (
    <div className="engage-card" data-testid="engage-step-focus">
      <div className="engage-card-body engage-card-body--scroll">
        <EngageHeading
          title="Where should we focus?"
          sub="Pick the areas that need the most attention today."
          testid="engage-focus-heading"
        />
        <div className="grid grid-cols-2 gap-2.5" role="group" aria-label="Focus areas">
          {ENGAGE_FOCUS_AREAS.map((area) => {
            const on = answers.focusAreas.includes(area.id);
            return (
              <button
                key={area.id}
                type="button"
                aria-pressed={on}
                data-testid={`engage-focus-${area.id}`}
                onClick={() => toggle(area.id)}
                className={`flex min-h-[4.25rem] flex-col items-center justify-center gap-1.5 rounded-2xl border-2 px-2 py-3 text-sm font-semibold transition-[border-color,background-color,transform] duration-200 active:scale-[0.98] ${
                  on ? "border-nb-teal bg-[#E3FAF5]" : "border-sky-100 bg-white hover:border-sky-200"
                }`}
              >
                <span
                  className={`grid h-8 w-8 place-items-center rounded-full ${on ? "bg-nb-teal text-white" : "bg-sky-50 text-nb-mute"}`}
                  aria-hidden="true"
                >
                  {on ? <Check className="h-4 w-4" /> : <UserRound className="h-4 w-4" />}
                </span>
                {area.label}
              </button>
            );
          })}
        </div>
        <p className="nb-label mt-5">Preferred pressure</p>
        <div className="grid grid-cols-3 gap-2" role="radiogroup" aria-label="Preferred pressure">
          {ENGAGE_PRESSURE.map((p) => {
            const on = answers.pressure === p.id;
            return (
              <button
                key={p.id}
                type="button"
                role="radio"
                aria-checked={on}
                data-testid={`engage-pressure-${p.id}`}
                onClick={() => setAnswers({ ...answers, pressure: p.id })}
                className={`h-11 rounded-2xl border-2 text-sm font-semibold ${
                  on ? "border-nb-teal bg-[#E3FAF5]" : "border-sky-100 bg-white"
                }`}
              >
                {p.label}
              </button>
            );
          })}
        </div>
        {allergyOn ? (
          <label className="mt-4 block text-sm">
            <span className="nb-label">Allergy note for the therapist</span>
            <input
              className="engage-input"
              autoComplete="off"
              value={answers.allergyNote}
              onChange={(e) => setAnswers({ ...answers, allergyNote: e.target.value })}
              placeholder="e.g. fragrance-free only"
              data-testid="engage-allergy-note"
            />
          </label>
        ) : null}
      </div>
    </div>
  );
}

export function StepConsent({ answers, setAnswers }) {
  const page = ENGAGE_CONSENT_PAGES[answers.consentPage] || ENGAGE_CONSENT_PAGES[0];
  const last = answers.consentPage >= ENGAGE_CONSENT_PAGES.length - 1;

  return (
    <div className="engage-card" data-testid="engage-step-consent">
      <div className="engage-card-body flex flex-col !overflow-hidden p-0 sm:p-0">
        <div className="shrink-0 border-b border-sky-50 px-4 pt-4 sm:px-5">
          <EngageHeading
            title="Disclosures & consent"
            sub={`Page ${answers.consentPage + 1} of ${ENGAGE_CONSENT_PAGES.length} — please read fully.`}
            testid="engage-consent-heading"
          />
        </div>
        <div
          className="engage-card-body--scroll min-h-0 flex-1 px-4 py-3 sm:px-5"
          data-testid="engage-consent-viewer"
          tabIndex={0}
          role="region"
          aria-label={page.title}
        >
          <h2 className="text-base font-semibold text-nb-ink">{page.title}</h2>
          <div className="mt-3 space-y-3 text-sm leading-relaxed text-nb-ink/90">
            {page.body.map((para) => (
              <p key={para.slice(0, 24)}>{para}</p>
            ))}
          </div>
        </div>
        <div className="shrink-0 space-y-3 border-t border-sky-50 px-4 py-3 sm:px-5">
          <div className="flex gap-2">
            <button
              type="button"
              className="engage-secondary flex-1"
              disabled={answers.consentPage <= 0}
              data-testid="engage-consent-prev"
              onClick={() => setAnswers({ ...answers, consentPage: Math.max(0, answers.consentPage - 1), consentAccepted: false })}
            >
              Previous page
            </button>
            {!last ? (
              <button
                type="button"
                className="engage-primary flex-1"
                data-testid="engage-consent-next-page"
                onClick={() => setAnswers({ ...answers, consentPage: answers.consentPage + 1 })}
              >
                Next page
              </button>
            ) : null}
          </div>
          {last ? (
            <label className="flex items-start gap-3 rounded-2xl bg-[#E8F6F3] p-3 text-sm text-nb-ink">
              <input
                type="checkbox"
                className="mt-1 h-5 w-5 rounded border-sky-300 text-nb-teal focus:ring-nb-teal"
                checked={answers.consentAccepted}
                onChange={(e) => setAnswers({ ...answers, consentAccepted: e.target.checked })}
                data-testid="engage-consent-check"
              />
              <span>
                I have read these disclosures and consent to today’s short therapeutic massage. I understand health details are not shared with my employer.
              </span>
            </label>
          ) : null}
        </div>
      </div>
    </div>
  );
}

export function StepPrivateFollowUp({ event, result, onDone }) {
  const code = result?.checkIn?.checkInCode;
  return (
    <div className="engage-card" data-testid="engage-step-private">
      <div className="engage-card-body flex flex-col text-center">
        <div className="mx-auto mb-3 grid h-14 w-14 place-items-center rounded-full bg-amber-50">
          <ShieldCheck className="h-7 w-7 text-amber-700" aria-hidden="true" />
        </div>
        <EngageHeading
          title="Private clinical follow-up"
          sub="Based on your screening, please speak with the on-site therapist before treatment. Nothing on this screen is shared with your employer."
          testid="engage-private-heading"
        />
        <div className="rounded-2xl bg-sky-50 p-4 text-left text-sm text-nb-ink">
          <p className="font-semibold">What happens next</p>
          <ul className="mt-2 list-disc space-y-1 pl-4 text-nb-mute">
            <li>Tell the therapist you need a private check before the chair session.</li>
            <li>They may adapt, postpone, or help you book a full clinical visit.</li>
            <li>Your employer only sees that you started check-in — not why.</li>
          </ul>
          {code ? <p className="mt-3 font-mono text-sm font-semibold text-nb-ink">Ref {code}</p> : null}
          <p className="mt-3 text-xs text-nb-mute">{event.therapist} · {event.place}</p>
        </div>
        <button type="button" className="engage-primary mt-auto" data-testid="engage-private-done" onClick={onDone}>
          Done — clear this tablet
        </button>
      </div>
    </div>
  );
}

export function StepConfirm({ event, answers, result, onDone }) {
  const code = result?.checkIn?.checkInCode || syntheticCheckInCode(answers, event);
  const slot = event.slots.find((s) => s.id === answers.slotId);
  const flags = screeningFlags(answers);
  const writeMode = result?.checkIn?.writeMode || result?.writesEnabled;
  const sub =
    result?.message ||
    (writeMode === "live"
      ? "Show this code to the therapist. Your slot is on the NabiTouch schedule."
      : "Show this code to the therapist. Prototype check-in — no appointment was created.");

  return (
    <div className="engage-card" data-testid="engage-step-confirm">
      <div className="engage-card-body engage-card-body--scroll text-center">
        <div className="mx-auto mb-2 grid h-12 w-12 place-items-center rounded-full bg-[#E3FAF5]">
          <Check className="h-6 w-6 text-nb-teal" aria-hidden="true" />
        </div>
        <EngageHeading title="You’re checked in" sub={sub} testid="engage-confirm-heading" />
        <div
          className="mx-auto max-w-[14rem] rounded-2xl border-2 border-dashed border-nb-teal/40 bg-white p-4"
          data-testid="engage-checkin-code"
          aria-label={`Check-in code ${code}`}
        >
          <div className="mx-auto grid h-28 w-28 place-items-center rounded-xl bg-[repeating-linear-gradient(90deg,#0B1B3F_0_2px,transparent_2px_6px),repeating-linear-gradient(0deg,#0B1B3F_0_2px,transparent_2px_6px)] opacity-90" aria-hidden="true" />
          <p className="mt-3 font-mono text-lg font-bold tracking-wider text-nb-ink">{code}</p>
        </div>
        <dl className="mt-4 space-y-2 rounded-2xl bg-[#E8F6F3] p-4 text-left text-sm">
          <div className="flex justify-between gap-3">
            <dt className="text-nb-mute">Guest</dt>
            <dd className="font-semibold text-nb-ink">
              {answers.firstName} {answers.lastName}
            </dd>
          </div>
          <div className="flex justify-between gap-3">
            <dt className="text-nb-mute">Time</dt>
            <dd className="font-semibold text-nb-ink">{slot?.label || "—"}</dd>
          </div>
          <div className="flex justify-between gap-3">
            <dt className="text-nb-mute">Service</dt>
            <dd className="font-semibold text-nb-ink">{event.serviceLabel}</dd>
          </div>
          {flags.soft.length ? (
            <div className="border-t border-teal-100 pt-2 text-xs text-nb-mute">
              Therapist adaptations noted privately ({flags.soft.length}). Not shown to employer.
            </div>
          ) : null}
        </dl>
        <button type="button" className="engage-primary mt-5" data-testid="engage-confirm-done" onClick={onDone}>
          Finish &amp; clear session
        </button>
      </div>
    </div>
  );
}
