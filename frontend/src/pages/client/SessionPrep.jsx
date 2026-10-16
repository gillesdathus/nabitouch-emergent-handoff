import { useEffect, useState } from "react";
import { Confirm } from "@/components/ui-kit";
import { Link, useNavigate, useParams } from "react-router-dom";
import { AnimatePresence, motion } from "framer-motion";
import { ArrowLeft, Check, CheckCircle2, ClipboardCheck, FileSignature, ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import { Switch } from "@/components/ui/switch";
import { Field, Notice, Segmented, Stepper, cx } from "@/components/tide";
import { SignaturePad } from "@/components/session/SignaturePad";
import { RestrictionList, useSessionReadiness } from "@/components/session/SessionReadiness";
import { api } from "@/lib/api";
import { fmtDate, fmtTime } from "@/lib/domain";
import { useDemo } from "@/store/DemoStore";

const AREAS = ["Neck", "Shoulders", "Upper back", "Lower back", "Glutes", "Abdomen", "Chest", "Arms", "Legs", "Feet", "Face", "Scalp"];
const EDITABLE = [["allergies", "Allergies"], ["medications", "Medications"], ["contraindications", "Health conditions & precautions"], ["surgeries", "Recent surgeries or injuries"], ["pregnancy", "Pregnancy"], ["concerns", "What would you like help with?"]];
const sha256 = async (text) => Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text)))).map((b) => b.toString(16).padStart(2, "0")).join("");
const Chip = ({ on, children, onClick, testid }) => <button type="button" data-testid={testid} onClick={onClick} className={cx(on ? "nb-chip-on" : "nb-chip-off", "h-10")}>{on && <Check className="h-3.5 w-3.5" />}{children}</button>;

function Questions({ questions, answers, setAnswers }) {
  return questions.map((q) => (
    <div key={q.id} className="mb-3" data-testid={`prep-q-${q.id}`}>
      <p className="mb-1.5 text-sm font-medium">{q.label}</p>
      {q.kind === "yesno"
        ? <Segmented testid={`prep-answer-${q.id}`} value={answers[q.id] || ""} onChange={(value) => setAnswers({ ...answers, [q.id]: value })} options={[{ value: "no", label: "No" }, { value: "yes", label: "Yes" }]} />
        : <input className="nb-input" value={answers[q.id] || ""} onChange={(e) => setAnswers({ ...answers, [q.id]: e.target.value })} data-testid={`prep-answer-${q.id}`} />}
    </div>
  ));
}

function ConfirmStep({ data, apptId, onDone }) {
  const latest = data.intake.latest || {};
  const [changed, setChanged] = useState(null);
  const [answers, setAnswers] = useState({});
  const [updates, setUpdates] = useState(() => Object.fromEntries(EDITABLE.map(([key]) => [key, latest[key] || ""])));
  const [busy, setBusy] = useState(false);
  const answered = data.questions.filter((q) => q.kind === "yesno").every((q) => answers[q.id]);
  const submit = async () => {
    setBusy(true);
    try { onDone(await api.confirmIntake(apptId, { changed, updates: changed ? updates : {}, answers })); toast.success(changed ? "Health history updated as a new version" : "Health history confirmed for this visit"); }
    catch (err) { toast.error(err?.response?.data?.detail || "Not saved"); } finally { setBusy(false); }
  };
  return (
    <div className="space-y-4" data-testid="prep-confirm-step">
      <div className="rounded-2xl bg-sky-50/70 p-4 text-sm"><p className="font-semibold">Your health history on file</p><p className="text-xs text-nb-mute">Version {data.intake.version} · saved {fmtDate(data.intake.at?.slice(0, 10))}</p>
        <dl className="mt-2 grid gap-1 text-xs">{EDITABLE.map(([key, label]) => <div key={key} className="flex gap-2"><dt className="w-40 shrink-0 text-nb-mute">{label}</dt><dd>{latest[key] || "—"}</dd></div>)}<div className="flex gap-2"><dt className="w-40 shrink-0 text-nb-mute">Conditions</dt><dd>{(latest.conditions || []).join(", ") || "—"}</dd></div></dl>
      </div>
      <p className="text-sm font-semibold">Has anything changed since {fmtDate(data.intake.at?.slice(0, 10))}?</p>
      <Segmented testid="prep-changed" value={changed === null ? "" : changed ? "yes" : "no"} onChange={(value) => setChanged(value === "yes")} options={[{ value: "no", label: "Nothing changed" }, { value: "yes", label: "Something changed" }]} />
      {changed && <div className="space-y-1" data-testid="prep-updates">{EDITABLE.map(([key, label]) => <Field key={key} label={label}><input className="nb-input" value={updates[key]} onChange={(e) => setUpdates({ ...updates, [key]: e.target.value })} data-testid={`prep-update-${key}`} /></Field>)}<p className="text-[11px] text-nb-mute">Your earlier version stays on file. Changes are saved as a new version.</p></div>}
      <div><p className="nb-label">For today's visit</p><Questions questions={data.questions} answers={answers} setAnswers={setAnswers} /></div>
      <button type="button" disabled={changed === null || !answered || busy} onClick={submit} className="nb-btn-primary h-14 w-full" data-testid="prep-confirm-submit">{busy ? "Saving…" : "Confirm health check"}</button>
    </div>
  );
}

function ConsentStep({ data, apptId, onDone, defaultName }) {
  const [acks, setAcks] = useState({});
  const [r, setR] = useState({ avoidAreas: [], pressureMax: "firm", draping: "standard", sensitiveAreas: false, notes: "" });
  const [typedName, setTypedName] = useState(defaultName || "");
  const [signature, setSignature] = useState(null);
  const [busy, setBusy] = useState(false);
  const ackKeys = Object.keys(data.acknowledgements || {});
  const valid = ackKeys.every((key) => acks[key]) && typedName.trim().length >= 3 && signature;
  const submit = async () => {
    setBusy(true);
    try { onDone(await api.signSessionConsent(apptId, { acknowledgements: acks, restrictions: r, typedName, signature, textHash: await sha256(data.consentText) })); toast.success("Consent signed for this visit"); }
    catch (err) { toast.error(err?.response?.data?.detail || "Consent was not saved"); } finally { setBusy(false); }
  };
  return (
    <div className="space-y-4" data-testid="prep-consent-step">
      <div className="rounded-2xl bg-sky-50/70 p-4 text-sm leading-relaxed" data-testid="prep-consent-text">{data.consentText}<p className="mt-2 text-[11px] text-nb-mute">Version {data.consentVersion}</p></div>
      <div><p className="nb-label">Areas to avoid today</p><div className="flex flex-wrap gap-2">{AREAS.map((area) => <Chip key={area} testid={`prep-avoid-${area.replace(/\s/g, "-").toLowerCase()}`} on={r.avoidAreas.includes(area)} onClick={() => setR({ ...r, avoidAreas: r.avoidAreas.includes(area) ? r.avoidAreas.filter((x) => x !== area) : [...r.avoidAreas, area] })}>{area}</Chip>)}</div></div>
      <div><p className="nb-label">Maximum pressure</p><Segmented testid="prep-pressure" value={r.pressureMax} onChange={(value) => setR({ ...r, pressureMax: value })} options={[{ value: "light", label: "Light" }, { value: "medium", label: "Medium" }, { value: "firm", label: "Firm" }]} /></div>
      <div><p className="nb-label">Draping</p><Segmented testid="prep-draping" value={r.draping} onChange={(value) => setR({ ...r, draping: value })} options={[{ value: "standard", label: "Standard" }, { value: "extra", label: "Extra coverage" }, { value: "clothed", label: "Stay clothed" }]} /></div>
      <label className="flex items-start gap-3 rounded-2xl bg-slate-50 p-3"><Switch data-testid="prep-sensitive" checked={r.sensitiveAreas} onCheckedChange={(value) => setR({ ...r, sensitiveAreas: value })} /><span className="text-sm">I consent to treatment of sensitive areas (such as glutes, chest wall or inner thigh) if my therapist recommends it and asks first.</span></label>
      <Field label="Anything else your therapist must respect today"><input className="nb-input" value={r.notes} onChange={(e) => setR({ ...r, notes: e.target.value })} data-testid="prep-notes" /></Field>
      <div className="space-y-2">{ackKeys.map((key) => <label key={key} className="flex items-start gap-3"><Switch data-testid={`prep-ack-${key}`} checked={!!acks[key]} onCheckedChange={(value) => setAcks({ ...acks, [key]: value })} /><span className="text-sm">{data.acknowledgements[key]}</span></label>)}</div>
      <Field label="Type your full name"><input className="nb-input" value={typedName} onChange={(e) => setTypedName(e.target.value)} data-testid="prep-typed-name" /></Field>
      <SignaturePad onChange={setSignature} testid="prep-signature" />
      <button type="button" disabled={!valid || busy} onClick={submit} className="nb-btn-primary h-14 w-full" data-testid="prep-consent-submit"><FileSignature className="h-5 w-5" />{busy ? "Signing…" : "Sign consent for this visit"}</button>
      <Notice tone="info">Your signature is stored with a timestamp for this visit only. A new visit asks again.</Notice>
    </div>
  );
}

function Done({ data, apptId, onChange }) {
  const [busy, setBusy] = useState(false);
  const [asking, setAsking] = useState(false);
  const withdraw = async () => {
    setAsking(false);
    setBusy(true);
    try { onChange(await api.withdrawSessionConsent(apptId, "")); toast.success("Consent withdrawn. Your therapist will not start or continue treatment."); }
    catch (err) { toast.error(err?.response?.data?.detail || "Not withdrawn"); } finally { setBusy(false); }
  };
  return (
    <div className="space-y-4 text-center" data-testid="prep-done">
      <span className="mx-auto grid h-16 w-16 place-items-center rounded-full bg-teal-50 text-teal-600"><ShieldCheck className="h-8 w-8" /></span>
      <p className="text-lg font-semibold">You're all set</p>
      <p className="text-sm text-nb-mute">Signed by {data.consent.record?.typedName} at {new Date(data.consent.record?.at).toLocaleString("en-CA", { timeZone: "America/Edmonton" })}</p>
      <div className="flex justify-center"><RestrictionList restrictions={data.restrictions} /></div>
      <button type="button" disabled={busy} onClick={() => setAsking(true)} className="text-sm font-semibold text-rose-700" data-testid="prep-withdraw">Withdraw my consent</button>
      <Confirm open={asking} onOpenChange={setAsking} title="Withdraw consent for this visit?" body="Your therapist will not start, or will stop, treatment. You can sign again later if you change your mind." confirmLabel="Withdraw consent" onConfirm={withdraw} testid="prep-withdraw-confirm" />
    </div>
  );
}

export default function SessionPrep() {
  const { id } = useParams();
  const nav = useNavigate();
  const { state, idx, me } = useDemo();
  const { data, setData } = useSessionReadiness(id, { poll: 0, enabled: !!me });
  const appt = state?.appointments.find((a) => a.id === id);
  if (!me) return <div className="mx-auto max-w-xl px-5 py-16 text-center"><Link to={`/login?next=/me/visit/${id}/prepare`} className="nb-btn-primary">Sign in</Link></div>;
  if (!data || !appt) return <div className="mx-auto max-w-xl px-5 py-10"><div className="nb-card h-60 animate-pulse" data-testid="prep-loading" /></div>;
  const needsBaseline = ["missing", "baseline_needed"].includes(data.intake.state);
  const step = data.ready ? 2 : data.intake.state === "confirmed" ? 1 : 0;
  return <PrepBody {...{ id, nav, idx, appt, data, setData, me, needsBaseline, step }} />;
}

function PrepBody({ id, nav, idx, appt, data, setData, me, needsBaseline, step }) {
  useEffect(() => { window.scrollTo({ top: 0, behavior: "smooth" }); }, [step]);
  return (
    <div className="mx-auto max-w-xl px-5 pb-32 pt-4" data-testid="session-prep">
      <div className="mb-5 flex items-center gap-3">
        <button type="button" data-testid="prep-back" onClick={() => nav("/me")} className="grid h-11 w-11 place-items-center rounded-full bg-white ring-1 ring-sky-100"><ArrowLeft className="h-4 w-4" /></button>
        <div className="flex-1"><p className="nb-eyebrow">{idx.services[appt.serviceSlug]?.name} · {fmtDate(appt.date)} {fmtTime(appt.time)}</p><h1 className="text-2xl font-semibold">Before your visit</h1></div>
      </div>
      <div className="nb-card mb-4 rounded-[28px] p-4"><Stepper steps={["Health check", "Consent", "Ready"]} current={step} testid="prep-stepper" /></div>
      <AnimatePresence mode="wait">
        <motion.div key={`${step}-${needsBaseline}`} initial={{ opacity: 0, x: 24 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -24 }} transition={{ duration: 0.2 }} className="nb-card p-5">
          {step === 0 && needsBaseline && (
            <div className="space-y-4 text-center" data-testid="prep-baseline-needed">
              <span className="mx-auto grid h-14 w-14 place-items-center rounded-full bg-sky-50 text-nb-blue"><ClipboardCheck className="h-7 w-7" /></span>
              <p className="text-lg font-semibold">Complete your health history</p>
              <p className="text-sm text-nb-mute">Your first visit needs a full health history: conditions, medications, allergies, surgeries, pregnancy and an emergency contact. Next time you only confirm what changed.</p>
              <Link to={`/me/intake?appt=${id}`} className="nb-btn-primary h-12 w-full" data-testid="prep-start-baseline">Start health history</Link>
            </div>
          )}
          {step === 0 && !needsBaseline && <ConfirmStep data={data} apptId={id} onDone={setData} />}
          {step === 1 && <ConsentStep data={data} apptId={id} onDone={setData} defaultName={`${me.firstName || ""} ${me.lastName || ""}`.trim()} />}
          {step === 2 && <Done data={data} apptId={id} onChange={setData} />}
        </motion.div>
      </AnimatePresence>
      {data.consent.state === "withdrawn" && step !== 2 && <p className="mt-3 flex items-center gap-2 text-xs text-rose-700" data-testid="prep-withdrawn-note"><CheckCircle2 className="h-4 w-4" />You withdrew consent earlier for this visit. Sign again only if you want treatment to go ahead.</p>}
    </div>
  );
}
