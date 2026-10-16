import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { motion } from "framer-motion";
import { LifeBuoy, LogIn, LogOut, Phone, ShieldAlert, ShieldCheck, TriangleAlert } from "lucide-react";
import { api, apiError } from "@/lib/api";
import { Confirm } from "@/components/ui-kit";

const KINDS = [["obstructed", "Space obstructed"], ["unsafe", "Unsafe"], ["unhygienic", "Unhygienic"], ["unsuitable", "Unsuitable for treatment"], ["other", "Other"]];
const FIX_TEXT = "Before we begin, the treatment area needs a few changes so the session can go ahead safely. I'll explain at the door.";
const time = (iso) => (iso ? new Date(iso).toLocaleTimeString("en-CA", { timeZone: "America/Edmonton", hour: "numeric", minute: "2-digit" }) : null);

function IncidentSheet({ appt, onDone }) {
  const [kind, setKind] = useState("obstructed");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const send = async (action) => {
    setBusy(true);
    try {
      await api.reportIncident(appt.id, { kind, action, note });
      if (action === "request_fix") await api.postMessage(appt.id, { body: FIX_TEXT }).catch(() => {});
      toast.success(action === "cannot_proceed" ? "Visit on safety hold. Managers were alerted in the app. No penalty is applied automatically." : "Reported. The client was asked in the app to fix the space.");
      onDone(action);
    } catch (e) { toast.error(apiError(e)); }
    setBusy(false);
  };
  return (
    <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="space-y-3 rounded-3xl bg-white/80 p-4 ring-1 ring-amber-200" data-testid="safety-incident-sheet">
      <p className="text-sm font-semibold">What is wrong with the space?</p>
      <div className="flex flex-wrap gap-2">{KINDS.map(([key, label]) => <button key={key} type="button" onClick={() => setKind(key)} data-testid={`safety-kind-${key}`} className={kind === key ? "nb-chip-on h-9 text-xs" : "nb-chip-off h-9 text-xs"}>{label}</button>)}</div>
      <textarea className="nb-input min-h-[72px] w-full py-2 text-sm" maxLength={500} placeholder={kind === "other" ? "Describe the issue (required)" : "Optional detail for the office"} value={note} onChange={(e) => setNote(e.target.value)} data-testid="safety-incident-note" />
      <div className="grid gap-2 sm:grid-cols-2">
        <button type="button" disabled={busy} onClick={() => send("request_fix")} data-testid="safety-request-fix-btn" className="nb-btn-ghost h-11 text-sm">Ask client to fix</button>
        <button type="button" disabled={busy} onClick={() => send("cannot_proceed")} data-testid="safety-cannot-proceed-btn" className="h-11 rounded-full bg-rose-600 px-4 text-sm font-semibold text-white transition-colors hover:bg-rose-700">I cannot proceed</button>
      </div>
      <p className="text-[11px] text-nb-mute">"I cannot proceed" puts the visit on safety hold. Any fee is decided later by the owner under the approved policy.</p>
    </motion.div>
  );
}

export function SafetyCenter({ appt }) {
  const [info, setInfo] = useState(null);
  const [report, setReport] = useState(false);
  const [ask, setAsk] = useState(null);
  const load = useCallback(() => api.visitSafety(appt.id).then(setInfo).catch(() => setInfo(null)), [appt.id]);
  useEffect(() => { load(); }, [load, appt.status]);
  const safety = info?.safety || appt.safety || {};
  const onSite = ["en_route", "arrived", "in_session", "interrupted"].includes(appt.status);
  const canOut = safety.checkinAt && !safety.checkoutAt && !["en_route", "arrived"].includes(appt.status);
  const step = (s) => api.safetyCheck(appt.id, s).then(() => { toast.success(s === "checkin" ? "Checked in" : "Checked out safely"); load(); }).catch((e) => toast.error(apiError(e)));
  const assist = () => api.requestAssist(appt.id, "").then(() => { toast.success("Managers were alerted in the app. This is not emergency dispatch."); load(); }).catch((e) => toast.error(apiError(e)));
  const call911 = () => { api.logEmergencyCall(appt.id).catch(() => {}); window.location.href = "tel:911"; };
  return (
    <section className="relative overflow-hidden rounded-[28px] p-5 tint-ice" data-testid="safety-center">
      <div className="flex items-center justify-between gap-3">
        <p className="flex items-center gap-2 font-semibold text-nb-navy"><ShieldCheck className="h-5 w-5 text-nb-teal" />Safety Center</p>
        <span className="text-[11px] text-nb-mute" data-testid="safety-status">{safety.checkoutAt ? `Checked out ${time(safety.checkoutAt)}` : safety.checkinAt ? `Checked in ${time(safety.checkinAt)}` : "Not checked in"}</span>
      </div>
      <div className="mt-4 grid gap-2 sm:grid-cols-2">
        {!safety.checkinAt && <button type="button" disabled={!onSite} onClick={() => step("checkin")} data-testid="safety-checkin-btn" className="nb-btn-primary h-12 text-sm"><LogIn className="h-4 w-4" />Arrival check-in</button>}
        {canOut && <button type="button" onClick={() => step("checkout")} data-testid="safety-checkout-btn" className="nb-btn-primary h-12 text-sm"><LogOut className="h-4 w-4" />Safe check-out</button>}
        <button type="button" onClick={() => setReport((v) => !v)} data-testid="safety-report-btn" className="nb-btn-ghost h-12 text-sm"><TriangleAlert className="h-4 w-4 text-amber-600" />Report the space</button>
        <button type="button" onClick={() => setAsk("assist")} data-testid="safety-assist-btn" className="nb-btn-ghost h-12 text-sm"><LifeBuoy className="h-4 w-4 text-nb-blue" />Request assistance</button>
      </div>
      {report && <div className="mt-3"><IncidentSheet appt={appt} onDone={() => { setReport(false); load(); }} /></div>}
      <button type="button" onClick={() => setAsk("911")} data-testid="safety-911-btn" className="mt-3 flex h-14 w-full items-center justify-center gap-2 rounded-2xl bg-rose-600 text-base font-semibold text-white shadow-[0_14px_30px_-16px_rgba(225,29,72,.9)] transition-transform active:scale-[.98]"><Phone className="h-5 w-5" />Call 911</button>
      <p className="mt-2 flex items-start gap-1.5 text-[11px] text-nb-mute" data-testid="safety-disclaimer"><ShieldAlert className="mt-px h-3.5 w-3.5 shrink-0" />{info?.assistLabel || "Request assistance alerts Nabitouch managers in the app. It is not emergency dispatch."} Calling 911 opens your phone dialer; Nabitouch sends no location or health data.</p>
      {info?.events?.length > 0 && (
        <ol className="mt-4 space-y-1.5 border-t border-sky-200/70 pt-3 text-xs" data-testid="safety-log">
          {info.events.map((e) => <li key={e.id} className="flex justify-between gap-3"><span>{e.kind.replace(/_/g, " ")}{e.incidentKind ? ` · ${e.incidentKind}` : ""}{e.action ? ` · ${e.action.replace("_", " ")}` : ""}</span><span className="text-nb-mute">{time(e.at)}{e.alert ? ` · ${e.status}` : ""}</span></li>)}
        </ol>
      )}
      <Confirm open={!!ask} onOpenChange={() => setAsk(null)} title={ask === "911" ? "Call 911?" : "Request assistance?"}
        body={ask === "911" ? "This opens your phone dialer to call 911. Nabitouch does not send your location or any health data." : "This sends an in-app alert to the owner and safety managers. It is not emergency dispatch. If you are in danger, call 911."}
        confirmLabel={ask === "911" ? "Call 911" : "Send alert"} onConfirm={() => (ask === "911" ? call911() : assist())} testid="safety-confirm" />
    </section>
  );
}
