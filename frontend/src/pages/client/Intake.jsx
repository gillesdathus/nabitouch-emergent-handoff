import { useEffect, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { AnimatePresence, motion } from "framer-motion";
import { ArrowLeft, Check } from "lucide-react";
import { Switch } from "@/components/ui/switch";
import { Field, Notice, Segmented, cx } from "@/components/tide";
import { useSessionReadiness } from "@/components/session/SessionReadiness";
import { apiError } from "@/lib/api";
import { useDemo } from "@/store/DemoStore";

const STEPS = ["Health", "History", "Emergency", "Focus", "Today", "Confirm"];
const CONDITIONS = ["High blood pressure", "Diabetes", "Heart condition", "Recent surgery", "Varicose veins", "Skin condition", "Osteoporosis", "Blood clots", "Cancer (current or past)", "Epilepsy", "Arthritis", "None of these"];
const AREAS = ["Neck", "Shoulders", "Upper back", "Lower back", "Arms", "Hands", "Hips", "Legs", "Feet", "Head"];
const PREGNANCY = [{ value: "Not pregnant", label: "No" }, { value: "Pregnant", label: "Yes" }, { value: "Not applicable", label: "N/A" }];

const Chip = ({ on, children, onClick, testid }) => (
  <button type="button" data-testid={testid} onClick={onClick} className={cx(on ? "nb-chip-on" : "nb-chip-off", "h-10")}>{on && <Check className="h-3.5 w-3.5" />}{children}</button>
);
const Text = ({ label, value, onChange, testid, rows = 2 }) => <Field label={label}><textarea data-testid={testid} rows={rows} className="nb-input h-auto py-3" value={value} onChange={(e) => onChange(e.target.value)} /></Field>;

export default function Intake() {
  const { me, api, run } = useDemo();
  const nav = useNavigate();
  const [params] = useSearchParams();
  const apptId = params.get("appt");
  const { data: readiness } = useSessionReadiness(apptId, { poll: 0, enabled: !!apptId && !!me });
  const questions = readiness?.questions || [];
  const [step, setStep] = useState(0);
  const [form, setForm] = useState({ allergies: "", medications: "", conditions: [], conditionsOther: "", surgeries: "", physician: "", pregnancy: "", weeks: "", emergencyName: "", emergencyPhone: "", emergencyRelation: "", areas: [], avoid: "", pressure: "medium", answers: {}, consent: false });
  const [error, setError] = useState("");
  useEffect(() => { window.scrollTo({ top: 0 }); }, [step]);
  const set = (patch) => setForm((current) => ({ ...current, ...patch }));
  if (!me) {
    return <div className="mx-auto max-w-xl px-5 py-16 text-center"><p>Sign in to save a health intake on your account.</p><Link to="/login?next=/me/intake" className="nb-btn-primary mt-4">Sign in</Link></div>;
  }
  const steps = apptId ? STEPS : STEPS.filter((s) => s !== "Today");
  const name = steps[step];
  const valid = {
    Health: form.conditions.length > 0,
    History: !!form.pregnancy,
    Emergency: form.emergencyName.trim().length >= 2 && form.emergencyPhone.replace(/\D/g, "").length >= 10,
    Focus: form.areas.length > 0,
    Today: !!readiness && questions.filter((q) => q.kind === "yesno").every((q) => form.answers[q.id]),
    Confirm: form.consent,
  }[name];
  const submit = async () => {
    setError("");
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
      nav(apptId ? `/me/visit/${apptId}/prepare` : "/me");
    } catch (err) {
      setError(apiError(err));
    }
  };
  const toggleCondition = (item) => set({ conditions: item === "None of these" ? ["None of these"] : [...form.conditions.filter((value) => value !== "None of these" && value !== item), ...(form.conditions.includes(item) ? [] : [item])] });
  return (
    <div className="mx-auto max-w-xl px-5 pb-32 pt-4" data-testid="intake-page">
      <div className="mb-5 flex items-center gap-3">
        <button type="button" data-testid="intake-back" onClick={() => (step ? setStep(step - 1) : nav(apptId ? `/me/visit/${apptId}/prepare` : "/me"))} className="grid h-11 w-11 place-items-center rounded-full bg-white ring-1 ring-sky-100"><ArrowLeft className="h-4 w-4" /></button>
        <div className="flex-1"><p className="nb-eyebrow">Health history · {name}</p><h1 className="text-2xl font-semibold">Your full health history</h1></div>
        <p className="nb-num text-sm font-bold">{step + 1}/{steps.length}</p>
      </div>
      <AnimatePresence mode="wait">
        <motion.div key={step} initial={{ opacity: 0, x: 24 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -24 }} transition={{ duration: 0.2 }} className="nb-card p-5">
          {name === "Health" && (
            <>
              <Text label="Allergies (oils, nuts, latex, scents)" value={form.allergies} onChange={(v) => set({ allergies: v })} testid="intake-allergies" />
              <Text label="Medications" value={form.medications} onChange={(v) => set({ medications: v })} testid="intake-medications" />
              <p className="nb-label">Do any of these apply?</p>
              <div className="mb-2 flex flex-wrap gap-2">{CONDITIONS.map((item) => <Chip key={item} testid={`intake-cond-${item.split(" ")[0].toLowerCase()}`} on={form.conditions.includes(item)} onClick={() => toggleCondition(item)}>{item}</Chip>)}</div>
              <Field label="Other conditions"><input className="nb-input" data-testid="intake-conditions-other" value={form.conditionsOther} onChange={(e) => set({ conditionsOther: e.target.value })} /></Field>
            </>
          )}
          {name === "History" && (
            <>
              <Text label="Surgeries or injuries in the last 2 years" value={form.surgeries} onChange={(v) => set({ surgeries: v })} testid="intake-surgeries" />
              <Field label="Family doctor or specialist (optional)"><input className="nb-input" data-testid="intake-physician" value={form.physician} onChange={(e) => set({ physician: e.target.value })} /></Field>
              <p className="nb-label">Are you pregnant?</p>
              <Segmented testid="intake-pregnancy" value={form.pregnancy} onChange={(value) => set({ pregnancy: value })} options={PREGNANCY} />
              {form.pregnancy === "Pregnant" && <Field label="How many weeks?"><input className="nb-input mt-2" inputMode="numeric" data-testid="intake-weeks" value={form.weeks} onChange={(e) => set({ weeks: e.target.value })} /></Field>}
            </>
          )}
          {name === "Emergency" && (
            <>
              <Field label="Emergency contact name"><input className="nb-input" data-testid="intake-emergency-name" value={form.emergencyName} onChange={(e) => set({ emergencyName: e.target.value })} /></Field>
              <Field label="Phone"><input className="nb-input" inputMode="tel" data-testid="intake-emergency-phone" value={form.emergencyPhone} onChange={(e) => set({ emergencyPhone: e.target.value })} /></Field>
              <Field label="Relationship"><input className="nb-input" data-testid="intake-emergency-relation" value={form.emergencyRelation} onChange={(e) => set({ emergencyRelation: e.target.value })} /></Field>
            </>
          )}
          {name === "Focus" && (
            <>
              <p className="nb-label">Where should we focus?</p>
              <div className="mb-3 flex flex-wrap gap-2">{AREAS.map((area) => <Chip key={area} testid={`intake-area-${area.replace(/\s/g, "-").toLowerCase()}`} on={form.areas.includes(area)} onClick={() => set({ areas: form.areas.includes(area) ? form.areas.filter((value) => value !== area) : [...form.areas, area] })}>{area}</Chip>)}</div>
              <Field label="Areas to avoid"><input data-testid="intake-avoid" className="nb-input" value={form.avoid} onChange={(event) => set({ avoid: event.target.value })} /></Field>
              <p className="nb-label">Preferred pressure</p>
              <Segmented testid="intake-pressure" value={form.pressure} onChange={(value) => set({ pressure: value })} options={[{ value: "light", label: "Light" }, { value: "medium", label: "Medium" }, { value: "firm", label: "Firm" }]} />
            </>
          )}
          {name === "Today" && questions.map((q) => (
            <div key={q.id} className="mb-3" data-testid={`intake-q-${q.id}`}>
              <p className="mb-1.5 text-sm font-medium">{q.label}</p>
              {q.kind === "yesno"
                ? <Segmented testid={`intake-answer-${q.id}`} value={form.answers[q.id] || ""} onChange={(value) => set({ answers: { ...form.answers, [q.id]: value } })} options={[{ value: "no", label: "No" }, { value: "yes", label: "Yes" }]} />
                : <input className="nb-input" data-testid={`intake-answer-${q.id}`} value={form.answers[q.id] || ""} onChange={(e) => set({ answers: { ...form.answers, [q.id]: e.target.value } })} />}
            </div>
          ))}
          {name === "Confirm" && (
            <>
              <div className="mb-4 rounded-2xl bg-sky-50/70 p-4 text-sm leading-relaxed text-nb-mute">I confirm this information is accurate and complete. Massage therapy is not a substitute for medical care, and I will tell my therapist about changes to my health before each visit.</div>
              <label className="mb-4 flex items-center gap-3"><Switch data-testid="intake-consent" checked={form.consent} onCheckedChange={(value) => set({ consent: value })} /><span className="text-sm font-medium">I confirm</span></label>
              <Notice tone="info">This saves a new version on your account. Earlier versions are never overwritten. It does not submit anything to an insurer.</Notice>
            </>
          )}
        </motion.div>
      </AnimatePresence>
      {error && <p className="mt-3 text-sm text-red-700" data-testid="intake-error">{error}</p>}
      <div className="fixed inset-x-3 bottom-24 z-40 md:bottom-5">
        <div className="mx-auto max-w-xl">
          <button type="button" data-testid="intake-next" disabled={!valid} onClick={() => (step === steps.length - 1 ? submit() : setStep(step + 1))} className="nb-btn-primary h-14 w-full text-base shadow-xl">{step === steps.length - 1 ? "Save health history" : "Continue"}</button>
        </div>
      </div>
    </div>
  );
}
