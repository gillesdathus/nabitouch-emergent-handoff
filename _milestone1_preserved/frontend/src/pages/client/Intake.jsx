import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { AnimatePresence, motion } from "framer-motion";
import { ArrowLeft, Check, CloudUpload } from "lucide-react";
import { usePreview } from "@/store/PreviewStore";
import { Field, Segmented, Notice, cx } from "@/components/ui-kit";
import { Switch } from "@/components/ui/switch";

const STEPS = ["About you", "Health", "Focus", "Consent"];
const CONDITIONS = ["High blood pressure", "Diabetes", "Recent surgery", "Varicose veins", "Skin condition", "Osteoporosis", "Blood clots", "None of these"];
const AREAS = ["Neck", "Shoulders", "Upper back", "Lower back", "Arms", "Hands", "Hips", "Legs", "Feet", "Head"];
const KEY = "nb-intake-c1";
const blank = { step: 0, dob: "", emergency: "", phone: "", conditions: [], meds: "", pregnant: false, areas: [], avoid: "", pressure: "medium", consent: false, signature: "" };

const Chip = ({ on, children, onClick, testid }) => <button type="button" data-testid={testid} onClick={onClick} className={cx(on ? "nb-chip-on" : "nb-chip-off", "h-10")}>{on && <Check className="h-3.5 w-3.5" />}{children}</button>;

function Ring({ value }) {
  const r = 20, c = 2 * Math.PI * r;
  return <svg viewBox="0 0 48 48" className="h-12 w-12 -rotate-90"><circle cx="24" cy="24" r={r} stroke="#E0F2FE" strokeWidth="5" fill="none" /><circle cx="24" cy="24" r={r} stroke="url(#ig)" strokeWidth="5" fill="none" strokeLinecap="round" strokeDasharray={c} strokeDashoffset={c * (1 - value)} style={{ transition: "stroke-dashoffset .5s ease" }} /><defs><linearGradient id="ig"><stop stopColor="#1565F0" /><stop offset="1" stopColor="#14D8C4" /></linearGradient></defs></svg>;
}

export default function Intake() {
  const { api, me } = usePreview();
  const nav = useNavigate();
  const [d, setD] = useState(() => ({ ...blank, ...JSON.parse(localStorage.getItem(KEY) || "{}") }));
  const [saved, setSaved] = useState(true);
  const set = (ch) => { setD((x) => ({ ...x, ...ch })); setSaved(false); };
  const toggle = (k, v) => set({ [k]: d[k].includes(v) ? d[k].filter((x) => x !== v) : [...d[k], v] });
  useEffect(() => {
    const t = setTimeout(() => { localStorage.setItem(KEY, JSON.stringify(d)); setSaved(true); }, 600);
    return () => clearTimeout(t);
  }, [d]);
  const valid = [d.dob && d.emergency, d.conditions.length > 0, d.areas.length > 0, d.consent && d.signature.trim().length > 2][d.step];
  const pct = (d.step + (valid ? 1 : 0)) / STEPS.length;
  const submit = async () => { await api.save("clients", me.client, { intake: "complete" }, "Intake form submitted"); localStorage.removeItem(KEY); nav("/me"); };
  return (
    <div className="max-w-xl mx-auto px-5 pt-4 pb-32">
      <div className="flex items-center gap-3 mb-5">
        <button data-testid="intake-back" onClick={() => (d.step ? set({ step: d.step - 1 }) : nav("/me"))} className="h-11 w-11 grid place-items-center rounded-full bg-white ring-1 ring-sky-100"><ArrowLeft className="h-4 w-4" /></button>
        <div className="flex-1"><p className="nb-eyebrow">Health intake · {STEPS[d.step]}</p><h1 className="text-2xl font-semibold">Before your first visit</h1></div>
        <div className="relative"><Ring value={pct} /><span className="absolute inset-0 grid place-items-center text-[11px] font-bold nb-num">{Math.round(pct * 100)}%</span></div>
      </div>
      <p data-testid="intake-autosave" className="text-xs text-nb-mute mb-4 flex items-center gap-1">{saved ? <><Check className="h-3.5 w-3.5 text-nb-teal" />Progress saved on this device</> : <><CloudUpload className="h-3.5 w-3.5" />Saving…</>}</p>
      <AnimatePresence mode="wait">
        <motion.div key={d.step} initial={{ opacity: 0, x: 24 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -24 }} transition={{ duration: 0.2 }} className="nb-card p-5">
          {d.step === 0 && (<>
            <Field label="Date of birth"><input data-testid="intake-dob" type="date" className="nb-input" value={d.dob} onChange={(e) => set({ dob: e.target.value })} /></Field>
            <Field label="Emergency contact"><input data-testid="intake-emergency" className="nb-input" placeholder="Name and relationship" value={d.emergency} onChange={(e) => set({ emergency: e.target.value })} /></Field>
            <Field label="Emergency phone"><input data-testid="intake-phone" className="nb-input" value={d.phone} onChange={(e) => set({ phone: e.target.value })} /></Field>
          </>)}
          {d.step === 1 && (<>
            <p className="nb-label">Do any of these apply?</p>
            <div className="flex flex-wrap gap-2 mb-4">{CONDITIONS.map((c) => <Chip key={c} testid={`intake-cond-${c.split(" ")[0].toLowerCase()}`} on={d.conditions.includes(c)} onClick={() => set({ conditions: c === "None of these" ? ["None of these"] : [...d.conditions.filter((x) => x !== "None of these" && x !== c), ...(d.conditions.includes(c) ? [] : [c])] })}>{c}</Chip>)}</div>
            <Field label="Medications"><textarea data-testid="intake-meds" rows={2} className="nb-input h-auto py-3" value={d.meds} onChange={(e) => set({ meds: e.target.value })} /></Field>
            <div className="flex items-center justify-between rounded-2xl bg-sky-50/70 p-3"><span className="text-sm font-medium">Currently pregnant</span><Switch data-testid="intake-pregnant" checked={d.pregnant} onCheckedChange={(v) => set({ pregnant: v })} /></div>
          </>)}
          {d.step === 2 && (<>
            <p className="nb-label">Where should we focus?</p>
            <div className="flex flex-wrap gap-2 mb-4">{AREAS.map((a) => <Chip key={a} testid={`intake-area-${a.replace(/\s/g, "-").toLowerCase()}`} on={d.areas.includes(a)} onClick={() => toggle("areas", a)}>{a}</Chip>)}</div>
            <Field label="Areas to avoid"><input data-testid="intake-avoid" className="nb-input" value={d.avoid} onChange={(e) => set({ avoid: e.target.value })} /></Field>
            <p className="nb-label">Preferred pressure</p>
            <Segmented testid="intake-pressure" value={d.pressure} onChange={(v) => set({ pressure: v })} options={[{ value: "light", label: "Light" }, { value: "medium", label: "Medium" }, { value: "firm", label: "Firm" }]} />
          </>)}
          {d.step === 3 && (<>
            <div className="rounded-2xl bg-sky-50/70 p-4 text-sm text-nb-mute leading-relaxed mb-4">I confirm the information is accurate. I understand massage therapy is not a substitute for medical care, and I'll tell my therapist about any changes to my health.</div>
            <label className="flex items-center gap-3 mb-4"><Switch data-testid="intake-consent" checked={d.consent} onCheckedChange={(v) => set({ consent: v })} /><span className="text-sm font-medium">I agree</span></label>
            <Field label="Type your full name to sign"><input data-testid="intake-signature" className="nb-input font-display italic text-lg" value={d.signature} onChange={(e) => set({ signature: e.target.value })} /></Field>
            <Notice tone="info">Your answers are visible only to your practitioner and the clinic owner.</Notice>
          </>)}
        </motion.div>
      </AnimatePresence>
      <div className="fixed inset-x-3 bottom-[84px] md:bottom-5 z-40"><div className="max-w-xl mx-auto"><button data-testid="intake-next" disabled={!valid} onClick={() => (d.step === 3 ? submit() : set({ step: d.step + 1 }))} className="nb-btn-primary w-full h-14 text-base shadow-xl">{d.step === 3 ? "Submit intake" : "Continue"}</button></div></div>
    </div>
  );
}
