import { useEffect, useState } from "react";
import { Confirm } from "@/components/ui-kit";
import { Link, useNavigate, useParams } from "react-router-dom";
import { AnimatePresence, motion } from "framer-motion";
import { ArrowLeft, Check, CheckCircle2, ClipboardCheck, FileSignature, MapPin, ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import { Switch } from "@/components/ui/switch";
import { Field, Notice, Segmented, Stepper, cx } from "@/components/tide";
import { FlowStepShell } from "@/components/FlowStepShell";
import { SignaturePad } from "@/components/session/SignaturePad";
import { RestrictionList, useSessionReadiness } from "@/components/session/SessionReadiness";
import { api, apiError } from "@/lib/api";
import { fmtDate, fmtTime } from "@/lib/domain";
import { useDemo } from "@/store/DemoStore";

const AREAS = ["Neck", "Shoulders", "Upper back", "Lower back", "Glutes", "Abdomen", "Chest", "Arms", "Legs", "Feet", "Face", "Scalp"];
const EDITABLE = [["allergies", "Allergies"], ["medications", "Medications"], ["contraindications", "Health conditions & precautions"], ["surgeries", "Recent surgeries or injuries"], ["pregnancy", "Pregnancy"], ["concerns", "What would you like help with?"]];
const sha256 = async (text) => Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text)))).map((b) => b.toString(16).padStart(2, "0")).join("");
const Chip = ({ on, children, onClick, testid }) => <button type="button" data-testid={testid} onClick={onClick} className={cx(on ? "nb-chip-on" : "nb-chip-off", "h-10")}>{on && <Check className="h-3.5 w-3.5" />}{children}</button>;

function SaveError({ message, onRetry, busy, testid = "prep-save-error" }) {
  if (!message) return null;
  return (
    <div className="rounded-2xl bg-rose-50 p-3 text-left text-sm text-rose-800 ring-1 ring-rose-100" data-testid={testid}>
      <p>{message}</p>
      {onRetry && <button type="button" disabled={busy} onClick={onRetry} className="mt-2 text-sm font-semibold text-rose-900 underline" data-testid={`${testid}-retry`}>{busy ? "Retrying…" : "Try again"}</button>}
    </div>
  );
}

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
  const [error, setError] = useState("");
  const answered = data.questions.filter((q) => q.kind === "yesno").every((q) => answers[q.id]);
  const submit = async () => {
    setBusy(true);
    setError("");
    try {
      onDone(await api.confirmIntake(apptId, { changed, updates: changed ? updates : {}, answers }));
      toast.success(changed ? "Health history updated as a new version" : "Health history confirmed for this visit");
    } catch (err) {
      setError(apiError(err) || "Health check was not saved");
      toast.error(apiError(err) || "Not saved");
    } finally {
      setBusy(false);
    }
  };
  return (
    <FlowStepShell
      testid="prep-confirm-shell"
      actionsTestid="prep-confirm-actions"
      actions={(
        <button type="button" disabled={changed === null || !answered || busy} onClick={submit} className="nb-btn-primary h-12 w-full" data-testid="prep-confirm-submit">
          {busy ? "Saving…" : "Confirm health check"}
        </button>
      )}
    >
      <div className="space-y-4" data-testid="prep-confirm-step">
        <details className="rounded-2xl bg-sky-50/70 p-4 text-sm" data-testid="prep-history-summary">
          <summary className="cursor-pointer font-semibold">Your health history on file</summary>
          <p className="mt-1 text-xs text-nb-mute">Version {data.intake.version} · saved {fmtDate(data.intake.at?.slice(0, 10))}</p>
          <dl className="mt-2 grid gap-1 text-xs">{EDITABLE.map(([key, label]) => <div key={key} className="flex gap-2"><dt className="w-40 shrink-0 text-nb-mute">{label}</dt><dd>{latest[key] || "—"}</dd></div>)}<div className="flex gap-2"><dt className="w-40 shrink-0 text-nb-mute">Conditions</dt><dd>{(latest.conditions || []).join(", ") || "—"}</dd></div></dl>
        </details>
        <p className="text-sm font-semibold">Has anything changed since {fmtDate(data.intake.at?.slice(0, 10))}?</p>
        <Segmented testid="prep-changed" value={changed === null ? "" : changed ? "yes" : "no"} onChange={(value) => setChanged(value === "yes")} options={[{ value: "no", label: "Nothing changed" }, { value: "yes", label: "Something changed" }]} />
        {changed && <div className="space-y-1" data-testid="prep-updates">{EDITABLE.map(([key, label]) => <Field key={key} label={label}><input className="nb-input" value={updates[key]} onChange={(e) => setUpdates({ ...updates, [key]: e.target.value })} data-testid={`prep-update-${key}`} /></Field>)}<p className="text-[11px] text-nb-mute">Your earlier version stays on file. Changes are saved as a new version.</p></div>}
        <div><p className="nb-label">For today's visit</p><Questions questions={data.questions} answers={answers} setAnswers={setAnswers} /></div>
        <SaveError message={error} onRetry={submit} busy={busy} testid="prep-confirm-error" />
      </div>
    </FlowStepShell>
  );
}

function ConsentStep({ data, apptId, onDone, defaultName }) {
  const [acks, setAcks] = useState({});
  const [r, setR] = useState({ avoidAreas: [], pressureMax: "firm", draping: "standard", sensitiveAreas: false, notes: "" });
  const [typedName, setTypedName] = useState(defaultName || "");
  const [signature, setSignature] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const ackKeys = Object.keys(data.acknowledgements || {});
  const valid = ackKeys.every((key) => acks[key]) && typedName.trim().length >= 3 && signature;
  const submit = async () => {
    setBusy(true);
    setError("");
    try {
      onDone(await api.signSessionConsent(apptId, { acknowledgements: acks, restrictions: r, typedName, signature, textHash: await sha256(data.consentText) }));
      toast.success("Consent signed for this visit");
    } catch (err) {
      setError(apiError(err) || "Consent was not saved");
      toast.error(apiError(err) || "Consent was not saved");
    } finally {
      setBusy(false);
    }
  };
  return (
    <FlowStepShell
      testid="prep-consent-shell"
      actionsTestid="prep-consent-actions"
      actions={(
        <button type="button" disabled={!valid || busy} onClick={submit} className="nb-btn-primary h-12 w-full" data-testid="prep-consent-submit">
          <FileSignature className="h-5 w-5" />{busy ? "Signing…" : "Sign consent for this visit"}
        </button>
      )}
    >
      <div className="space-y-4" data-testid="prep-consent-step">
        <details className="rounded-2xl bg-sky-50/70 p-4 text-sm leading-relaxed" data-testid="prep-consent-text" open>
          <summary className="cursor-pointer font-semibold">Consent for this visit</summary>
          <div className="mt-2">{data.consentText}<p className="mt-2 text-[11px] text-nb-mute">Version {data.consentVersion}</p></div>
        </details>
        <div><p className="nb-label">Areas to avoid today</p><div className="flex flex-wrap gap-2">{AREAS.map((area) => <Chip key={area} testid={`prep-avoid-${area.replace(/\s/g, "-").toLowerCase()}`} on={r.avoidAreas.includes(area)} onClick={() => setR({ ...r, avoidAreas: r.avoidAreas.includes(area) ? r.avoidAreas.filter((x) => x !== area) : [...r.avoidAreas, area] })}>{area}</Chip>)}</div></div>
        <div><p className="nb-label">Maximum pressure</p><Segmented testid="prep-pressure" value={r.pressureMax} onChange={(value) => setR({ ...r, pressureMax: value })} options={[{ value: "light", label: "Light" }, { value: "medium", label: "Medium" }, { value: "firm", label: "Firm" }]} /></div>
        <div><p className="nb-label">Draping</p><Segmented testid="prep-draping" value={r.draping} onChange={(value) => setR({ ...r, draping: value })} options={[{ value: "standard", label: "Standard" }, { value: "extra", label: "Extra coverage" }, { value: "clothed", label: "Stay clothed" }]} /></div>
        <label className="flex items-start gap-3 rounded-2xl bg-slate-50 p-3"><Switch data-testid="prep-sensitive" checked={r.sensitiveAreas} onCheckedChange={(value) => setR({ ...r, sensitiveAreas: value })} /><span className="text-sm">I consent to treatment of sensitive areas (such as glutes, chest wall or inner thigh) if my therapist recommends it and asks first.</span></label>
        <Field label="Anything else your therapist must respect today"><input className="nb-input" value={r.notes} onChange={(e) => setR({ ...r, notes: e.target.value })} data-testid="prep-notes" /></Field>
        <div className="space-y-2">{ackKeys.map((key) => <label key={key} className="flex items-start gap-3"><Switch data-testid={`prep-ack-${key}`} checked={!!acks[key]} onCheckedChange={(value) => setAcks({ ...acks, [key]: value })} /><span className="text-sm">{data.acknowledgements[key]}</span></label>)}</div>
        <Field label="Type your full name"><input className="nb-input" value={typedName} onChange={(e) => setTypedName(e.target.value)} data-testid="prep-typed-name" /></Field>
        <SignaturePad onChange={setSignature} testid="prep-signature" />
        <SaveError message={error} onRetry={submit} busy={busy} testid="prep-consent-error" />
        <Notice tone="info">Your signature is stored with a timestamp for this visit only. A new visit asks again.</Notice>
      </div>
    </FlowStepShell>
  );
}

function AppointmentSummary({ appt, idx }) {
  const service = idx?.services?.[appt.serviceSlug]?.name || "Massage";
  const practitioner = idx?.practitioners?.[appt.practitionerId]?.name;
  const location = appt.address?.line || (appt.location === "clinic" || appt.locationType === "clinic" ? "Clinic visit" : null);
  return (
    <div className="rounded-2xl bg-sky-50/80 p-4 text-left text-sm ring-1 ring-sky-100" data-testid="prep-appointment-summary">
      <p className="font-semibold text-nb-ink">{service}</p>
      <p className="mt-1 text-nb-mute">{fmtDate(appt.date)} · {fmtTime(appt.time)}{appt.duration ? ` · ${appt.duration} min` : ""}</p>
      {practitioner && <p className="mt-1 text-nb-mute">with {practitioner}</p>}
      {location && <p className="mt-2 flex items-start gap-1.5 text-xs text-nb-mute"><MapPin className="mt-0.5 h-3.5 w-3.5 shrink-0" />{location}</p>}
    </div>
  );
}

function Done({ data, appt, idx, apptId, onChange }) {
  const [busy, setBusy] = useState(false);
  const [asking, setAsking] = useState(false);
  const [error, setError] = useState("");
  const record = data.consent?.record;
  const signedAt = record?.at ? new Date(record.at).toLocaleString("en-CA", { timeZone: "America/Edmonton" }) : null;
  const withdraw = async () => {
    setAsking(false);
    setBusy(true);
    setError("");
    try {
      onChange(await api.withdrawSessionConsent(apptId, ""));
      toast.success("Consent withdrawn. Your therapist will not start or continue treatment.");
    } catch (err) {
      setError(apiError(err) || "Not withdrawn");
      toast.error(apiError(err) || "Not withdrawn");
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="space-y-5 text-center" data-testid="prep-done">
      <span className="mx-auto grid h-16 w-16 place-items-center rounded-full bg-teal-50 text-teal-600" aria-hidden><ShieldCheck className="h-8 w-8" /></span>
      <div>
        <h2 className="text-xl font-semibold text-nb-ink" data-testid="prep-done-heading">You're all set!</h2>
        <p className="mt-2 text-sm text-nb-mute" data-testid="prep-done-message">Your health check and consent are complete. You're ready for your upcoming massage.</p>
      </div>
      <AppointmentSummary appt={appt} idx={idx} />
      <p className="text-xs text-nb-mute" data-testid="prep-done-saved">
        {record?.typedName && signedAt
          ? `Signed by ${record.typedName} at ${signedAt}. Your completed forms are saved on your account.`
          : "Your completed forms are saved on your account and will still be here after you leave this screen."}
      </p>
      <div className="flex justify-center"><RestrictionList restrictions={data.restrictions} /></div>
      <div className="flex flex-col gap-2 pt-1">
        <Link to="/me" className="nb-btn-primary h-12 w-full" data-testid="prep-done-home">Back to My Nabitouch</Link>
        <Link to="/me#upcoming-visit-card" className="nb-btn-ghost h-12 w-full" data-testid="prep-done-appointment">View appointment</Link>
      </div>
      <SaveError message={error} onRetry={() => setAsking(true)} busy={busy} testid="prep-withdraw-error" />
      <button type="button" disabled={busy} onClick={() => setAsking(true)} className="text-sm font-semibold text-rose-700" data-testid="prep-withdraw">Withdraw my consent</button>
      <Confirm open={asking} onOpenChange={setAsking} title="Withdraw consent for this visit?" body="Your therapist will not start, or will stop, treatment. You can sign again later if you change your mind." confirmLabel="Withdraw consent" onConfirm={withdraw} testid="prep-withdraw-confirm" />
    </div>
  );
}

export default function SessionPrep() {
  const { id } = useParams();
  const nav = useNavigate();
  const { state, idx, me } = useDemo();
  const { data, setData, error, loading, reload } = useSessionReadiness(id, { poll: 0, enabled: !!me });
  const appt = state?.appointments.find((a) => a.id === id);
  if (!me) return <div className="mx-auto max-w-xl px-5 py-16 text-center"><Link to={`/login?next=/me/visit/${id}/prepare`} className="nb-btn-primary">Sign in</Link></div>;
  if (error && !data) {
    return (
      <div className="mx-auto max-w-xl px-5 py-10" data-testid="prep-load-error">
        <div className="nb-card space-y-4 p-5 text-center">
          <p className="text-lg font-semibold">We could not load this visit</p>
          <p className="text-sm text-nb-mute">{apiError(error) || "Check your connection and try again. Your saved forms are not lost."}</p>
          <button type="button" onClick={reload} className="nb-btn-primary h-12 w-full" data-testid="prep-load-retry">Try again</button>
          <Link to="/me" className="nb-btn-ghost h-12 w-full">Back to My Nabitouch</Link>
        </div>
      </div>
    );
  }
  if (loading || !data || !appt) return <div className="mx-auto max-w-xl px-5 py-10"><div className="nb-card h-60 animate-pulse" data-testid="prep-loading" /></div>;
  const needsBaseline = ["missing", "baseline_needed"].includes(data.intake.state);
  const step = data.ready ? 2 : data.intake.state === "confirmed" ? 1 : 0;
  return <PrepBody {...{ id, nav, idx, appt, data, setData, me, needsBaseline, step }} />;
}

function PrepBody({ id, nav, idx, appt, data, setData, me, needsBaseline, step }) {
  useEffect(() => { window.scrollTo({ top: 0, behavior: "smooth" }); }, [step]);
  return (
    <div className="mx-auto max-w-xl px-5 pt-4" data-testid="session-prep">
      <div className="mb-5 flex items-center gap-3">
        <button type="button" data-testid="prep-back" onClick={() => nav("/me")} className="grid h-11 w-11 place-items-center rounded-full bg-white ring-1 ring-sky-100"><ArrowLeft className="h-4 w-4" /></button>
        <div className="flex-1 min-w-0"><p className="nb-eyebrow truncate">{idx.services[appt.serviceSlug]?.name} · {fmtDate(appt.date)} {fmtTime(appt.time)}</p><h1 className="text-2xl font-semibold">Before your visit</h1></div>
      </div>
      <div className="nb-card mb-4 rounded-[28px] p-4"><Stepper steps={["Health check", "Consent", "Ready"]} current={step} testid="prep-stepper" /></div>
      <AnimatePresence mode="wait">
        <motion.div key={`${step}-${needsBaseline}`} initial={{ opacity: 0, x: 24 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -24 }} transition={{ duration: 0.2 }}>
          {step === 0 && needsBaseline && (
            <FlowStepShell
              testid="prep-baseline-shell"
              actionsTestid="prep-baseline-actions"
              actions={<Link to={`/me/intake?appt=${id}`} className="nb-btn-primary h-12 w-full" data-testid="prep-start-baseline">Start health history</Link>}
            >
              <div className="nb-card space-y-4 p-5 text-center" data-testid="prep-baseline-needed">
                <span className="mx-auto grid h-14 w-14 place-items-center rounded-full bg-sky-50 text-nb-blue"><ClipboardCheck className="h-7 w-7" /></span>
                <p className="text-lg font-semibold">Complete your health history</p>
                <p className="text-sm text-nb-mute">Your first visit needs a full health history: conditions, medications, allergies, surgeries, pregnancy and an emergency contact. Next time you only confirm what changed.</p>
              </div>
            </FlowStepShell>
          )}
          {step === 0 && !needsBaseline && (
            <div className="nb-card p-5">
              <ConfirmStep data={data} apptId={id} onDone={setData} />
            </div>
          )}
          {step === 1 && (
            <div className="nb-card p-5">
              <ConsentStep data={data} apptId={id} onDone={setData} defaultName={`${me.firstName || ""} ${me.lastName || ""}`.trim()} />
            </div>
          )}
          {step === 2 && (
            <div className="nb-card p-5">
              <Done data={data} appt={appt} idx={idx} apptId={id} onChange={setData} />
            </div>
          )}
        </motion.div>
      </AnimatePresence>
      {data.consent.state === "withdrawn" && step !== 2 && <p className="mt-3 flex items-center gap-2 text-xs text-rose-700" data-testid="prep-withdrawn-note"><CheckCircle2 className="h-4 w-4" />You withdrew consent earlier for this visit. Sign again only if you want treatment to go ahead.</p>}
    </div>
  );
}
