import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { AnimatePresence, motion } from "framer-motion";
import { ArrowLeft, Check } from "lucide-react";
import { Switch } from "@/components/ui/switch";
import { Field, Notice, Segmented, cx } from "@/components/tide";
import { apiError } from "@/lib/api";
import { useDemo } from "@/store/DemoStore";

const STEPS = ["Health", "Focus", "Preferences", "Consent"];
const CONDITIONS = ["High blood pressure", "Diabetes", "Recent surgery", "Varicose veins", "Skin condition", "Osteoporosis", "Blood clots", "None of these"];
const AREAS = ["Neck", "Shoulders", "Upper back", "Lower back", "Arms", "Hands", "Hips", "Legs", "Feet", "Head"];

const Chip = ({ on, children, onClick, testid }) => (
  <button type="button" data-testid={testid} onClick={onClick} className={cx(on ? "nb-chip-on" : "nb-chip-off", "h-10")}>{on && <Check className="h-3.5 w-3.5" />}{children}</button>
);

export default function Intake() {
  const { me, api, run } = useDemo();
  const nav = useNavigate();
  const [step, setStep] = useState(0);
  const [form, setForm] = useState({ allergies: "", medications: "", conditions: [], areas: [], avoid: "", pressure: "medium", consent: false });
  const [error, setError] = useState("");
  const set = (patch) => setForm((current) => ({ ...current, ...patch }));
  if (!me) {
    return <div className="mx-auto max-w-xl px-5 py-16 text-center"><p>Sign in to save a health intake on your account.</p><Link to="/login?next=/me/intake" className="nb-btn-primary mt-4">Sign in</Link></div>;
  }
  const valid = [
    form.allergies.trim() || form.medications.trim() || form.conditions.length > 0,
    form.areas.length > 0,
    !!form.pressure,
    form.consent,
  ][step];
  const submit = async () => {
    setError("");
    const body = {
      allergies: form.allergies.trim(),
      medications: form.medications.trim(),
      contraindications: form.conditions.join(", "),
      concerns: form.areas.join(", "),
      preferences: [`Pressure: ${form.pressure}`, form.avoid.trim() ? `Avoid: ${form.avoid.trim()}` : ""].filter(Boolean).join(". "),
    };
    try {
      await run(() => api.submitIntake(body), "Health history saved as a new version");
      try { await api.recordConsent({ kind: "treatment", version: "2026-1", acknowledged: true }); } catch { /* profile can record consent again */ }
      nav("/me");
    } catch (err) {
      setError(apiError(err));
    }
  };
  return (
    <div className="mx-auto max-w-xl px-5 pb-32 pt-4">
      <div className="mb-5 flex items-center gap-3">
        <button type="button" data-testid="intake-back" onClick={() => (step ? setStep(step - 1) : nav("/me"))} className="grid h-11 w-11 place-items-center rounded-full bg-white ring-1 ring-sky-100"><ArrowLeft className="h-4 w-4" /></button>
        <div className="flex-1"><p className="nb-eyebrow">Health intake · {STEPS[step]}</p><h1 className="text-2xl font-semibold">Before your first visit</h1></div>
        <p className="nb-num text-sm font-bold">{step + 1}/{STEPS.length}</p>
      </div>
      <AnimatePresence mode="wait">
        <motion.div key={step} initial={{ opacity: 0, x: 24 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -24 }} transition={{ duration: 0.2 }} className="nb-card p-5">
          {step === 0 && (
            <>
              <Field label="Allergies"><textarea data-testid="intake-allergies" rows={2} className="nb-input h-auto py-3" value={form.allergies} onChange={(event) => set({ allergies: event.target.value })} /></Field>
              <Field label="Medications"><textarea data-testid="intake-medications" rows={2} className="nb-input h-auto py-3" value={form.medications} onChange={(event) => set({ medications: event.target.value })} /></Field>
              <p className="nb-label">Do any of these apply?</p>
              <div className="mb-2 flex flex-wrap gap-2">{CONDITIONS.map((item) => <Chip key={item} testid={`intake-cond-${item.split(" ")[0].toLowerCase()}`} on={form.conditions.includes(item)} onClick={() => set({ conditions: item === "None of these" ? ["None of these"] : [...form.conditions.filter((value) => value !== "None of these" && value !== item), ...(form.conditions.includes(item) ? [] : [item])] })}>{item}</Chip>)}</div>
            </>
          )}
          {step === 1 && (
            <>
              <p className="nb-label">Where should we focus?</p>
              <div className="flex flex-wrap gap-2">{AREAS.map((area) => <Chip key={area} testid={`intake-area-${area.replace(/\s/g, "-").toLowerCase()}`} on={form.areas.includes(area)} onClick={() => set({ areas: form.areas.includes(area) ? form.areas.filter((value) => value !== area) : [...form.areas, area] })}>{area}</Chip>)}</div>
            </>
          )}
          {step === 2 && (
            <>
              <Field label="Areas to avoid"><input data-testid="intake-avoid" className="nb-input" value={form.avoid} onChange={(event) => set({ avoid: event.target.value })} /></Field>
              <p className="nb-label">Preferred pressure</p>
              <Segmented testid="intake-pressure" value={form.pressure} onChange={(value) => set({ pressure: value })} options={[{ value: "light", label: "Light" }, { value: "medium", label: "Medium" }, { value: "firm", label: "Firm" }]} />
            </>
          )}
          {step === 3 && (
            <>
              <div className="mb-4 rounded-2xl bg-sky-50/70 p-4 text-sm leading-relaxed text-nb-mute">I confirm this information is accurate. Massage therapy is not a substitute for medical care, and I will tell my therapist about changes to my health.</div>
              <label className="mb-4 flex items-center gap-3"><Switch data-testid="intake-consent" checked={form.consent} onCheckedChange={(value) => set({ consent: value })} /><span className="text-sm font-medium">I agree</span></label>
              <Notice tone="info">This saves a new intake version on your account. It does not upload documents, and it does not submit a claim to an insurer.</Notice>
            </>
          )}
        </motion.div>
      </AnimatePresence>
      {error && <p className="mt-3 text-sm text-red-700" data-testid="intake-error">{error}</p>}
      <div className="fixed inset-x-3 bottom-24 z-40 md:bottom-5">
        <div className="mx-auto max-w-xl">
          <button type="button" data-testid="intake-next" disabled={!valid} onClick={() => (step === 3 ? submit() : setStep(step + 1))} className="nb-btn-primary h-14 w-full text-base shadow-xl">{step === 3 ? "Submit intake" : "Continue"}</button>
        </div>
      </div>
    </div>
  );
}
