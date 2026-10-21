import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { ArrowLeft, Check } from "lucide-react";
import { Field, Notice, Segmented, cx } from "@/components/tide";
import { useSessionReadiness } from "@/components/session/SessionReadiness";
import { apiError } from "@/lib/api";
import { useDemo } from "@/store/DemoStore";

export const INTAKE_STEPS_WITH_APPT = ["Health", "History", "Emergency", "Focus", "Today", "Confirm"];
export const INTAKE_STEPS_PROFILE = ["Health", "History", "Emergency", "Focus", "Confirm"];

const CONDITIONS = ["High blood pressure", "Diabetes", "Heart condition", "Recent surgery", "Varicose veins", "Skin condition", "Osteoporosis", "Blood clots", "Cancer (current or past)", "Epilepsy", "Arthritis", "None of these"];
const AREAS = ["Neck", "Shoulders", "Upper back", "Lower back", "Arms", "Hands", "Hips", "Legs", "Feet", "Head"];
const PREGNANCY = [{ value: "Not pregnant", label: "No" }, { value: "Pregnant", label: "Yes" }, { value: "Not applicable", label: "N/A" }];

/** Mirrors backend GENERAL_QUESTIONS — used only when readiness returns an empty list (should not happen). */
export const FALLBACK_TODAY_QUESTIONS = [
  { id: "unwell", label: "Do you have a fever, or do you feel unwell today?", kind: "yesno" },
  { id: "today", label: "Anything your therapist should know about today?", kind: "text" },
];

const emptyForm = () => ({
  allergies: "",
  medications: "",
  conditions: [],
  conditionsOther: "",
  surgeries: "",
  physician: "",
  pregnancy: "",
  weeks: "",
  emergencyName: "",
  emergencyPhone: "",
  emergencyRelation: "",
  areas: [],
  avoid: "",
  pressure: "medium",
  answers: {},
  consent: false,
});

function draftKey(apptId) {
  return `nt_intake_draft_v1:${apptId || "profile"}`;
}

function readDraft(apptId) {
  try {
    const raw = sessionStorage.getItem(draftKey(apptId));
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return null;
    return { form: { ...emptyForm(), ...parsed.form, answers: { ...(parsed.form?.answers || {}) } }, step: Number(parsed.step) || 0 };
  } catch {
    return null;
  }
}

function writeDraft(apptId, form, step) {
  try {
    sessionStorage.setItem(draftKey(apptId), JSON.stringify({ form, step, at: Date.now() }));
  } catch { /* private mode */ }
}

function clearDraft(apptId) {
  try { sessionStorage.removeItem(draftKey(apptId)); } catch { /* ignore */ }
}

const Chip = ({ on, children, onClick, testid }) => (
  <button type="button" data-testid={testid} onClick={onClick} className={cx(on ? "nb-chip-on" : "nb-chip-off", "h-10")}>{on && <Check className="h-3.5 w-3.5" />}{children}</button>
);
const Text = ({ label, value, onChange, testid, rows = 2 }) => (
  <Field label={label}><textarea data-testid={testid} rows={rows} className="nb-input h-auto py-3" value={value} onChange={(e) => onChange(e.target.value)} /></Field>
);

export function todayStepReady(questions, answers, { loading, error, readiness }) {
  if (loading) return false;
  if (error) return false;
  if (!readiness && questions.length === 0) return false;
  const yesNo = questions.filter((q) => q.kind === "yesno");
  if (!yesNo.length) return false; // never treat “no questions” as complete — required visit questions must appear
  return yesNo.every((q) => answers[q.id] === "yes" || answers[q.id] === "no");
}

export function resolveTodayQuestions(readiness, { loading, error }) {
  if (loading || error || !readiness) return [];
  const fromApi = Array.isArray(readiness.questions) ? readiness.questions : [];
  if (fromApi.length) return fromApi;
  // Readiness succeeded but omitted questions — keep required general prompts visible.
  return FALLBACK_TODAY_QUESTIONS;
}

function stepValid(name, form, todayOk) {
  return {
    Health: form.conditions.length > 0,
    History: !!form.pregnancy,
    Emergency: form.emergencyName.trim().length >= 2 && form.emergencyPhone.replace(/\D/g, "").length >= 10,
    Focus: form.areas.length > 0,
    Today: todayOk,
    Confirm: form.consent === true,
  }[name];
}

function continueHint(name, form, todayOk, { loading, error }) {
  if (stepValid(name, form, todayOk)) return "";
  if (name === "Health") return "Select at least one condition option (or “None of these”) to continue.";
  if (name === "History") return "Answer the pregnancy question to continue.";
  if (name === "Emergency") return "Enter an emergency contact name and a 10-digit phone number.";
  if (name === "Focus") return "Choose at least one focus area to continue.";
  if (name === "Today") {
    if (loading) return "Loading today’s questions…";
    if (error) return "Could not load today’s questions. Retry or go back.";
    return "Answer each yes/no question for this visit to continue.";
  }
  if (name === "Confirm") return "Review your answers below, then confirm to save.";
  return "";
}

function ReviewRow({ label, value, testid }) {
  const text = (value == null || value === "" || (Array.isArray(value) && !value.length)) ? "—" : (Array.isArray(value) ? value.join(", ") : String(value));
  return (
    <div className="flex justify-between gap-3 border-b border-sky-50 py-2 text-sm last:border-0" data-testid={testid}>
      <span className="text-nb-mute">{label}</span>
      <span className="max-w-[60%] text-right font-medium text-nb-ink">{text}</span>
    </div>
  );
}

export default function Intake() {
  const { me, api, run } = useDemo();
  const nav = useNavigate();
  const [params] = useSearchParams();
  const apptId = params.get("appt");
  const {
    data: readiness,
    error: readinessError,
    loading: readinessLoading,
    reload: reloadReadiness,
  } = useSessionReadiness(apptId, { poll: 0, enabled: !!apptId && !!me });

  const steps = apptId ? INTAKE_STEPS_WITH_APPT : INTAKE_STEPS_PROFILE;
  const restored = useRef(null);
  if (restored.current === null) restored.current = readDraft(apptId);

  const [step, setStep] = useState(() => {
    const fromUrl = Number(params.get("step"));
    if (Number.isInteger(fromUrl) && fromUrl >= 0 && fromUrl < steps.length) return fromUrl;
    const fromDraft = restored.current?.step;
    if (Number.isInteger(fromDraft) && fromDraft >= 0 && fromDraft < steps.length) return fromDraft;
    return 0;
  });
  const [form, setForm] = useState(() => restored.current?.form || emptyForm());
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const submittedRef = useRef(false);

  useEffect(() => {
    if (typeof window.scrollTo === "function") {
      try { window.scrollTo(0, 0); } catch { /* jsdom */ }
    }
  }, [step]);

  useEffect(() => {
    writeDraft(apptId, form, step);
  }, [apptId, form, step]);

  useEffect(() => {
    if (step >= steps.length) setStep(Math.max(0, steps.length - 1));
  }, [step, steps.length]);

  const set = (patch) => setForm((current) => ({ ...current, ...patch }));

  const questions = useMemo(
    () => resolveTodayQuestions(readiness, { loading: readinessLoading, error: readinessError }),
    [readiness, readinessLoading, readinessError],
  );
  const usedFallbackQuestions = Boolean(
    apptId && readiness && !readinessLoading && !readinessError
    && (!Array.isArray(readiness.questions) || readiness.questions.length === 0),
  );

  if (!me) {
    return (
      <div className="mx-auto max-w-xl px-5 py-16 text-center" data-testid="intake-signin">
        <p>Sign in to save a health intake on your account.</p>
        <Link to="/login?next=/me/intake" className="nb-btn-primary mt-4">Sign in</Link>
      </div>
    );
  }

  const name = steps[Math.min(step, steps.length - 1)];
  const todayOk = todayStepReady(questions, form.answers, {
    loading: readinessLoading,
    error: readinessError,
    readiness,
  });
  const valid = stepValid(name, form, todayOk);
  const hint = continueHint(name, form, todayOk, { loading: readinessLoading, error: readinessError });

  const submit = async () => {
    if (submitting || submittedRef.current) return;
    if (!form.consent) {
      setError("Confirm your answers before saving.");
      return;
    }
    if (apptId && !todayOk) {
      setError("Finish today’s visit questions before saving.");
      return;
    }
    setError("");
    setSubmitting(true);
    const body = {
      appointmentId: apptId || undefined,
      allergies: form.allergies.trim(),
      medications: form.medications.trim(),
      conditions: form.conditions,
      conditionsOther: form.conditionsOther.trim(),
      contraindications: [...form.conditions.filter((c) => c !== "None of these"), form.conditionsOther.trim()].filter(Boolean).join(", "),
      surgeries: form.surgeries.trim(),
      physician: form.physician.trim(),
      pregnancy: form.pregnancy === "Pregnant" && form.weeks.trim() ? `Pregnant · ${form.weeks.trim()} weeks` : form.pregnancy,
      emergencyName: form.emergencyName.trim(),
      emergencyPhone: form.emergencyPhone.trim(),
      emergencyRelation: form.emergencyRelation.trim(),
      concerns: form.areas.join(", "),
      preferences: [`Pressure: ${form.pressure}`, form.avoid.trim() ? `Avoid: ${form.avoid.trim()}` : ""].filter(Boolean).join(". "),
      answers: form.answers,
    };
    try {
      await run(() => api.submitBaseline(body), "Health history saved as a new version");
      submittedRef.current = true;
      clearDraft(apptId);
      nav(apptId ? `/me/visit/${apptId}/prepare` : "/me");
    } catch (err) {
      setError(apiError(err));
      setSubmitting(false);
    }
  };

  const toggleCondition = (item) => set({
    conditions: item === "None of these"
      ? ["None of these"]
      : [...form.conditions.filter((value) => value !== "None of these" && value !== item), ...(form.conditions.includes(item) ? [] : [item])],
  });

  const goBack = () => {
    if (step > 0) setStep(step - 1);
    else nav(apptId ? `/me/visit/${apptId}/prepare` : "/me");
  };

  const goNext = () => {
    if (!valid || submitting) return;
    if (step === steps.length - 1) submit();
    else setStep(step + 1);
  };

  const pregnancyLabel = PREGNANCY.find((p) => p.value === form.pregnancy)?.label || form.pregnancy;

  return (
    <div className="mx-auto max-w-xl px-5 pb-[calc(1.5rem+var(--nb-safe-b))] pt-4" data-testid="intake-page">
      <div className="mb-5 flex items-center gap-3">
        <button type="button" data-testid="intake-back" onClick={goBack} className="grid h-11 w-11 place-items-center rounded-full bg-white ring-1 ring-sky-100" aria-label="Back">
          <ArrowLeft className="h-4 w-4" />
        </button>
        <div className="min-w-0 flex-1">
          <p className="nb-eyebrow">Health history · {name}</p>
          <h1 className="text-2xl font-semibold">Your full health history</h1>
        </div>
        <p className="nb-num shrink-0 text-sm font-bold" data-testid="intake-step-count">{step + 1}/{steps.length}</p>
      </div>

      {/* No framer-motion here: Android PWA WebViews can leave opacity-0 enter states stuck blank. */}
      <div className="nb-card space-y-1 p-5" data-testid={`intake-step-${name.toLowerCase()}`}>
        {name === "Health" && (
          <div data-testid="intake-health-body">
            <Text label="Allergies (oils, nuts, latex, scents)" value={form.allergies} onChange={(v) => set({ allergies: v })} testid="intake-allergies" />
            <Text label="Medications" value={form.medications} onChange={(v) => set({ medications: v })} testid="intake-medications" />
            <p className="nb-label">Do any of these apply?</p>
            <div className="mb-2 flex flex-wrap gap-2">
              {CONDITIONS.map((item) => (
                <Chip key={item} testid={`intake-cond-${item.split(" ")[0].toLowerCase()}`} on={form.conditions.includes(item)} onClick={() => toggleCondition(item)}>{item}</Chip>
              ))}
            </div>
            <Field label="Other conditions"><input className="nb-input" data-testid="intake-conditions-other" value={form.conditionsOther} onChange={(e) => set({ conditionsOther: e.target.value })} /></Field>
          </div>
        )}

        {name === "History" && (
          <div data-testid="intake-history-body">
            <Text label="Surgeries or injuries in the last 2 years" value={form.surgeries} onChange={(v) => set({ surgeries: v })} testid="intake-surgeries" />
            <Field label="Family doctor or specialist (optional)"><input className="nb-input" data-testid="intake-physician" value={form.physician} onChange={(e) => set({ physician: e.target.value })} /></Field>
            <p className="nb-label">Are you pregnant?</p>
            <Segmented testid="intake-pregnancy" value={form.pregnancy} onChange={(value) => set({ pregnancy: value })} options={PREGNANCY} />
            {form.pregnancy === "Pregnant" && (
              <Field label="How many weeks?"><input className="nb-input mt-2" inputMode="numeric" data-testid="intake-weeks" value={form.weeks} onChange={(e) => set({ weeks: e.target.value })} /></Field>
            )}
          </div>
        )}

        {name === "Emergency" && (
          <div data-testid="intake-emergency-body">
            <Field label="Emergency contact name"><input className="nb-input" data-testid="intake-emergency-name" value={form.emergencyName} onChange={(e) => set({ emergencyName: e.target.value })} /></Field>
            <Field label="Phone"><input className="nb-input" inputMode="tel" data-testid="intake-emergency-phone" value={form.emergencyPhone} onChange={(e) => set({ emergencyPhone: e.target.value })} /></Field>
            <Field label="Relationship"><input className="nb-input" data-testid="intake-emergency-relation" value={form.emergencyRelation} onChange={(e) => set({ emergencyRelation: e.target.value })} /></Field>
          </div>
        )}

        {name === "Focus" && (
          <div data-testid="intake-focus-body">
            <p className="nb-label">Where should we focus?</p>
            <div className="mb-3 flex flex-wrap gap-2">
              {AREAS.map((area) => (
                <Chip
                  key={area}
                  testid={`intake-area-${area.replace(/\s/g, "-").toLowerCase()}`}
                  on={form.areas.includes(area)}
                  onClick={() => set({ areas: form.areas.includes(area) ? form.areas.filter((value) => value !== area) : [...form.areas, area] })}
                >
                  {area}
                </Chip>
              ))}
            </div>
            <Field label="Areas to avoid"><input data-testid="intake-avoid" className="nb-input" value={form.avoid} onChange={(event) => set({ avoid: event.target.value })} /></Field>
            <p className="nb-label">Preferred pressure</p>
            <Segmented testid="intake-pressure" value={form.pressure} onChange={(value) => set({ pressure: value })} options={[{ value: "light", label: "Light" }, { value: "medium", label: "Medium" }, { value: "firm", label: "Firm" }]} />
          </div>
        )}

        {name === "Today" && (
          <div data-testid="intake-today-body">
            <p className="mb-4 text-sm text-nb-mute">These questions are for this visit only.</p>
            {readinessLoading && (
              <div className="space-y-3" data-testid="intake-today-loading">
                <p className="text-sm text-nb-mute">Loading questions for this visit…</p>
                <div className="h-16 animate-pulse rounded-2xl bg-sky-50" />
                <div className="h-16 animate-pulse rounded-2xl bg-sky-50" />
              </div>
            )}
            {!readinessLoading && readinessError && (
              <div className="space-y-3" data-testid="intake-today-error">
                <p className="text-sm text-rose-700">We could not load today’s health questions. Check your connection and try again.</p>
                <button type="button" className="nb-btn-primary h-11 w-full" data-testid="intake-today-retry" onClick={() => reloadReadiness()}>
                  Retry
                </button>
              </div>
            )}
            {!readinessLoading && !readinessError && usedFallbackQuestions && (
              <p className="mb-3 rounded-2xl bg-amber-50 p-3 text-xs text-amber-900" data-testid="intake-today-fallback-note">
                Visit-specific questions were incomplete from the server. Showing the required general questions so you can continue.
              </p>
            )}
            {!readinessLoading && !readinessError && questions.map((q) => (
              <div key={q.id} className="mb-4" data-testid={`intake-q-${q.id}`}>
                <p className="mb-1.5 text-sm font-medium">{q.label}</p>
                {q.kind === "yesno" ? (
                  <Segmented
                    testid={`intake-answer-${q.id}`}
                    value={form.answers[q.id] || ""}
                    onChange={(value) => set({ answers: { ...form.answers, [q.id]: value } })}
                    options={[{ value: "no", label: "No" }, { value: "yes", label: "Yes" }]}
                  />
                ) : (
                  <input
                    className="nb-input"
                    data-testid={`intake-answer-${q.id}`}
                    value={form.answers[q.id] || ""}
                    onChange={(e) => set({ answers: { ...form.answers, [q.id]: e.target.value } })}
                  />
                )}
              </div>
            ))}
          </div>
        )}

        {name === "Confirm" && (
          <div data-testid="intake-confirm-body">
            <p className="mb-3 text-sm font-semibold text-nb-ink">Review your health history</p>
            <div className="mb-4 rounded-2xl bg-sky-50/60 px-3 py-1" data-testid="intake-confirm-review">
              <ReviewRow label="Allergies" value={form.allergies} testid="review-allergies" />
              <ReviewRow label="Medications" value={form.medications} testid="review-medications" />
              <ReviewRow label="Conditions" value={form.conditions} testid="review-conditions" />
              {form.conditionsOther ? <ReviewRow label="Other conditions" value={form.conditionsOther} testid="review-conditions-other" /> : null}
              <ReviewRow label="Surgeries / injuries" value={form.surgeries} testid="review-surgeries" />
              <ReviewRow label="Pregnancy" value={form.pregnancy === "Pregnant" && form.weeks ? `Yes · ${form.weeks} weeks` : pregnancyLabel} testid="review-pregnancy" />
              <ReviewRow label="Emergency contact" value={[form.emergencyName, form.emergencyPhone, form.emergencyRelation].filter(Boolean).join(" · ")} testid="review-emergency" />
              <ReviewRow label="Focus areas" value={form.areas} testid="review-areas" />
              <ReviewRow label="Avoid" value={form.avoid} testid="review-avoid" />
              <ReviewRow label="Pressure" value={form.pressure} testid="review-pressure" />
              {questions.filter((q) => q.kind === "yesno").map((q) => (
                <ReviewRow key={q.id} label={q.label} value={form.answers[q.id] === "yes" ? "Yes" : form.answers[q.id] === "no" ? "No" : "—"} testid={`review-answer-${q.id}`} />
              ))}
              {questions.filter((q) => q.kind === "text" && form.answers[q.id]).map((q) => (
                <ReviewRow key={q.id} label={q.label} value={form.answers[q.id]} testid={`review-answer-${q.id}`} />
              ))}
            </div>
            <div className="mb-4 rounded-2xl bg-sky-50/70 p-4 text-sm leading-relaxed text-nb-mute" data-testid="intake-confirm-ack-copy">
              I confirm this information is accurate and complete. Massage therapy is not a substitute for medical care, and I will tell my therapist about changes to my health before each visit.
            </div>
            <label className="mb-4 flex items-start gap-3 text-sm" data-testid="intake-consent-label">
              <input
                type="checkbox"
                className="mt-1 h-4 w-4 accent-[#1565F0]"
                checked={form.consent}
                onChange={(e) => set({ consent: e.target.checked })}
                data-testid="intake-consent"
              />
              <span className="font-medium text-nb-ink">I confirm these details are accurate and complete.</span>
            </label>
            <Notice tone="info" testid="intake-confirm-notice">This saves a new version on your account. Earlier versions are never overwritten. It does not submit anything to an insurer.</Notice>
          </div>
        )}
      </div>

      {error && <p className="mt-3 text-sm text-red-700" data-testid="intake-error">{error}</p>}

      <div className="mt-6 space-y-3 border-t border-sky-100 pt-5" data-testid="intake-step-nav">
        {hint && <p className="text-sm text-amber-900" data-testid="intake-continue-hint">{hint}</p>}
        <div className="flex flex-col gap-2 sm:flex-row-reverse">
          <button
            type="button"
            data-testid="intake-next"
            disabled={!valid || submitting}
            onClick={goNext}
            className="nb-btn-primary h-12 w-full text-base sm:flex-1"
          >
            {submitting ? "Saving…" : (step === steps.length - 1 ? "Save health history" : "Continue")}
          </button>
          <button type="button" data-testid="intake-nav-back" onClick={goBack} className="nb-btn-ghost h-12 w-full sm:w-auto" disabled={submitting}>
            <ArrowLeft className="h-4 w-4" />Back
          </button>
        </div>
      </div>
    </div>
  );
}
