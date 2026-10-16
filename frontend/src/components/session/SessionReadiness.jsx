import { useCallback, useEffect, useState } from "react";
import { ClipboardCheck, FileSignature, ShieldAlert, ShieldCheck, Ban } from "lucide-react";
import { toast } from "sonner";
import { api } from "@/lib/api";
import { fmtClockTime } from "@/lib/turnaround";

const INTAKE_LABEL = { missing: "No health history yet", baseline_needed: "Full health history needed", confirm_needed: "Not confirmed for this visit", confirmed: "Confirmed for this visit" };
const CONSENT_LABEL = { missing: "Not signed yet", signed: "E-signed", withdrawn: "Withdrawn" };
const Dot = ({ ok }) => <span className={`h-2 w-2 shrink-0 rounded-full ${ok ? "bg-teal-500" : "bg-amber-500"}`} />;

export function RestrictionList({ restrictions, testid = "consent-restrictions" }) {
  if (!restrictions) return null;
  const items = [
    restrictions.avoidAreas?.length ? `Avoid: ${restrictions.avoidAreas.join(", ")}` : null,
    `Pressure up to ${restrictions.pressureMax}`,
    `Draping: ${restrictions.draping}`,
    restrictions.sensitiveAreas ? "Sensitive-area treatment consented" : "No sensitive-area treatment",
    restrictions.notes ? `Note: ${restrictions.notes}` : null,
  ].filter(Boolean);
  return <ul className="flex flex-wrap gap-1.5" data-testid={testid}>{items.map((item) => <li key={item} className="rounded-full bg-rose-50 px-2.5 py-1 text-[11px] font-medium text-rose-800 ring-1 ring-rose-100">{item}</li>)}</ul>;
}

export function useSessionReadiness(apptId, { poll = 10000, enabled = true } = {}) {
  const [data, setData] = useState(null);
  const load = useCallback(() => (enabled && apptId ? api.sessionReadiness(apptId).then(setData).catch(() => {}) : Promise.resolve()), [apptId, enabled]);
  useEffect(() => {
    load();
    if (!enabled || !poll) return undefined;
    const timer = setInterval(() => { if (!document.hidden) load(); }, poll);
    return () => clearInterval(timer);
  }, [load, poll, enabled]);
  return { data, reload: load, setData };
}

export function SessionReadiness({ readiness, onWithdrawn, canWithdraw }) {
  const [reason, setReason] = useState("");
  const [open, setOpen] = useState(false);
  if (!readiness) return <div className="nb-card h-28 animate-pulse p-4" data-testid="session-readiness-loading" />;
  const { intake, consent, questions = [], withdrawals = [] } = readiness;
  const flagged = questions.filter((q) => q.kind === "yesno" && intake.answers?.[q.id] === "yes");
  const notes = questions.filter((q) => q.kind === "text" && intake.answers?.[q.id]);
  const withdraw = async () => {
    try {
      const row = await api.withdrawSessionConsent(readiness.appointmentId, reason);
      toast.success("Withdrawal recorded. Treatment is stopped and the timer is paused.");
      setOpen(false);
      setReason("");
      onWithdrawn?.(row);
    } catch (err) {
      toast.error(err?.response?.data?.detail || "The withdrawal was not recorded");
    }
  };
  return (
    <div className={`nb-card space-y-3 p-4 ${readiness.ready ? "" : "ring-2 ring-amber-200"}`} data-testid="session-readiness">
      <div className="flex items-center gap-2">
        {readiness.ready ? <ShieldCheck className="h-5 w-5 text-teal-600" /> : <ShieldAlert className="h-5 w-5 text-amber-600" />}
        <p className="flex-1 text-sm font-semibold" data-testid="session-readiness-status">{readiness.ready ? "Cleared to start treatment" : "Treatment cannot start yet"}</p>
      </div>
      <div className="grid gap-2 text-sm sm:grid-cols-2">
        <p className="flex items-center gap-2 rounded-xl bg-slate-50 px-3 py-2" data-testid="readiness-intake"><Dot ok={intake.state === "confirmed"} /><ClipboardCheck className="h-4 w-4 text-nb-mute" /><span><b>Intake.</b> {INTAKE_LABEL[intake.state]}{intake.confirmedAt ? ` · ${fmtClockTime(intake.confirmedAt)}` : ""}{intake.state === "confirmed" ? (intake.changed ? " · changes reported" : " · no changes") : ""}</span></p>
        <p className="flex items-center gap-2 rounded-xl bg-slate-50 px-3 py-2" data-testid="readiness-consent"><Dot ok={consent.state === "signed"} /><FileSignature className="h-4 w-4 text-nb-mute" /><span><b>Consent.</b> {CONSENT_LABEL[consent.state]}{consent.record ? ` by ${consent.record.typedName} · ${fmtClockTime(consent.record.at)}` : ""}</span></p>
      </div>
      {!readiness.ready && <p className="text-xs text-amber-800" data-testid="readiness-blocker">The client completes the health check and signs consent for this visit in their Nabitouch app. Arriving and preparing are not blocked.</p>}
      {intake.changedFields?.length > 0 && <p className="text-xs" data-testid="readiness-changes"><b>{intake.changedFields.includes("full-history") ? "First visit:" : "Changed since last version:"}</b> {intake.changedFields.map((f) => (f === "full-history" ? "full health history submitted" : f)).join(", ")}</p>}
      {(intake.latest?.allergies || intake.latest?.medications) && <p className="text-xs text-nb-mute" data-testid="readiness-health">{intake.latest.allergies ? `Allergies: ${intake.latest.allergies}. ` : ""}{intake.latest.medications ? `Medications: ${intake.latest.medications}.` : ""}{intake.latest.pregnancy && !/^no|not/i.test(intake.latest.pregnancy) ? ` Pregnancy: ${intake.latest.pregnancy}.` : ""}</p>}
      {flagged.length > 0 && <ul className="space-y-1 text-xs text-amber-900" data-testid="readiness-flags">{flagged.map((q) => <li key={q.id}>• {q.label} <b>Yes</b></li>)}</ul>}
      {notes.map((q) => <p key={q.id} className="text-xs text-nb-mute">{q.label} “{intake.answers[q.id]}”</p>)}
      {readiness.restrictions && <RestrictionList restrictions={readiness.restrictions} />}
      {withdrawals.length > 0 && <ul className="space-y-1 text-xs text-rose-800" data-testid="readiness-withdrawals">{withdrawals.map((row) => <li key={row.id}>Withdrawn {fmtClockTime(row.at)} by {row.byRole}{row.duringSession ? " during treatment" : ""} · {row.reason}</li>)}</ul>}
      {canWithdraw && consent.state === "signed" && (open ? (
        <div className="space-y-2 rounded-2xl bg-rose-50 p-3" data-testid="withdraw-sheet">
          <p className="text-xs text-rose-900">Record the client's words. This stops treatment, pauses the timer and keeps the original consent on file.</p>
          <input className="nb-input h-10" value={reason} onChange={(event) => setReason(event.target.value)} placeholder="e.g. Client asked to stop" data-testid="withdraw-reason" />
          <div className="flex gap-2"><button type="button" onClick={withdraw} disabled={reason.trim().length < 3} className="nb-btn h-10 rounded-full bg-rose-600 px-4 text-sm text-white disabled:opacity-50" data-testid="withdraw-confirm">Record withdrawal</button><button type="button" onClick={() => setOpen(false)} className="nb-btn-ghost h-10 text-sm" data-testid="withdraw-cancel">Cancel</button></div>
        </div>
      ) : <button type="button" onClick={() => setOpen(true)} className="inline-flex items-center gap-1.5 text-xs font-semibold text-rose-700" data-testid="withdraw-open"><Ban className="h-3.5 w-3.5" />Client withdrew consent</button>)}
    </div>
  );
}
