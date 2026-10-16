import { useEffect, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { ArrowLeft, Check, Mic, MicOff, History, FileSignature, Save, Lock } from "lucide-react";
import { Slider } from "@/components/ui/slider";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Pill } from "@/components/ui-kit";
import { useDemo } from "@/store/DemoStore";
import { RestrictionList, useSessionReadiness } from "@/components/session/SessionReadiness";

function SoapConsentBanner({ apptId, enabled }) {
  const { data } = useSessionReadiness(apptId, { poll: 0, enabled });
  if (!data) return null;
  const record = data.consent.record;
  return (
    <div className="nb-card space-y-2 p-4" data-testid="soap-consent-banner">
      <p className="text-sm"><b>Session consent.</b> {record ? `E-signed by ${record.typedName} · linked to this note (${record.id})` : data.consent.state === "withdrawn" ? "Withdrawn during this visit. Document what was performed before withdrawal." : "No signed consent on file for this visit."}</p>
      {data.restrictions && <RestrictionList restrictions={data.restrictions} testid="soap-consent-restrictions" />}
      {data.withdrawals?.length > 0 && <p className="text-xs text-rose-700" data-testid="soap-consent-withdrawals">{data.withdrawals.map((w) => `Withdrawn ${new Date(w.at).toLocaleTimeString("en-CA", { timeZone: "America/Edmonton" })}: ${w.reason}`).join(" · ")}</p>}
    </div>
  );
}
import { SOAP_LIBRARY, SOAP_TEMPLATES, BODY_AREAS, fmtStamp } from "@/lib/domain";

const SECTIONS = [["S", "Subjective", "What the client reports"], ["O", "Objective", "What you observe & palpate"], ["A", "Assessment", "Response & progress"], ["P", "Plan", "Home care & follow-up"]];
const empty = { S: { chips: [], pain: 0, text: "" }, O: { chips: [], areas: [], text: "" }, A: { chips: [], text: "" }, P: { chips: [], text: "" } };

function BodyMap({ areas, onToggle, readOnly }) {
  return (
    <div className="relative mx-auto aspect-[1/1.6] w-full max-w-[220px]" data-testid="soap-body-map">
      <svg viewBox="0 0 100 160" className="absolute inset-0 h-full w-full" aria-hidden="true">
        <g fill="#E0F2FE" stroke="#9FD8F5" strokeWidth="1"><circle cx="50" cy="12" r="9" /><rect x="35" y="24" width="30" height="60" rx="12" /><rect x="20" y="28" width="11" height="52" rx="5" /><rect x="69" y="28" width="11" height="52" rx="5" /><rect x="37" y="82" width="11" height="68" rx="5" /><rect x="52" y="82" width="11" height="68" rx="5" /></g>
      </svg>
      {BODY_AREAS.map((a) => { const on = areas.includes(a.id); return (
        <button key={a.id} type="button" disabled={readOnly} onClick={() => onToggle(a.id)} aria-pressed={on} aria-label={a.label} data-testid={`body-area-${a.id}`}
          className={`absolute -translate-x-1/2 -translate-y-1/2 rounded-full px-2 py-0.5 text-[10px] font-semibold transition-colors ${on ? "nb-gradient text-white shadow" : "bg-white/90 text-nb-mute ring-1 ring-sky-200"}`} style={{ left: `${a.x}%`, top: `${a.y}%` }}>{a.label}</button>); })}
    </div>
  );
}

export default function Soap() {
  const { id } = useParams();
  const nav = useNavigate();
  const { state, idx, api, run, practitionerId, training } = useDemo();
  const appt = state.appointments.find((a) => a.id === id);
  const existing = idx.soap[id];
  const [note, setNote] = useState(() => ({ ...empty, ...(existing || {}) }));
  const [tab, setTab] = useState("S");
  const [saved, setSaved] = useState(existing?.updatedAt || null);
  const [review, setReview] = useState(false);
  const [ack, setAck] = useState(false);
  const [listening, setListening] = useState(false);
  const [amendment, setAmendment] = useState({ reason: "", treatmentPerformed: "" });
  const [amending, setAmending] = useState(false);
  const dirty = useRef(false);
  const rec = useRef(null);
  const signed = existing?.status === "signed";
  const prior = state.soap.filter((n) => n.clientId === appt?.clientId && n.status === "signed" && n.appointmentId !== id);

  useEffect(() => {
    const warn = (event) => { if (!dirty.current) return; event.preventDefault(); event.returnValue = ""; };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, []);
  useEffect(() => {
    if (!dirty.current || signed) return;
    const t = setTimeout(async () => { const r = await api.saveSoap(id, { ...note, clientId: appt.clientId, practitionerId: appt.practitionerId }); setSaved(r.updatedAt); dirty.current = false; }, 900);
    return () => clearTimeout(t);
  }, [note]); // eslint-disable-line
  if (!appt) return <p>Not found</p>;

  const upd = (sec, patch) => { dirty.current = true; setNote((n) => ({ ...n, [sec]: { ...n[sec], ...patch } })); };
  const chip = (sec, c) => upd(sec, { chips: note[sec].chips.includes(c) ? note[sec].chips.filter((x) => x !== c) : [...note[sec].chips, c] });
  const applyTpl = (t) => { dirty.current = true; setNote((n) => Object.fromEntries(["S", "O", "A", "P"].map((k) => [k, { ...n[k], chips: [...new Set([...n[k].chips, ...t[k]])] }]))); };
  const carry = () => { const p = prior[prior.length - 1]; if (!p) return; dirty.current = true; setNote((n) => ({ ...n, S: { ...n.S, chips: [...new Set([...n.S.chips, ...p.S.chips])] }, O: { ...n.O, areas: [...new Set([...(n.O.areas || []), ...(p.O.areas || [])])] } })); };
  const dictate = () => {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) return alert("Dictation isn’t supported in this browser.");
    if (listening) { rec.current?.stop(); return; }
    const r = new SR(); r.lang = "en-CA"; r.interimResults = false;
    r.onresult = (e) => upd(tab, { text: `${note[tab].text} ${e.results[0][0].transcript}`.trim() });
    r.onend = () => setListening(false); rec.current = r; r.start(); setListening(true);
  };
  const sign = async () => {
    await api.saveSoap(id, { ...note, clientId: appt.clientId, practitionerId: appt.practitionerId });
    await run(() => api.signSoap(id, idx.practitioners[practitionerId]?.name || "Practitioner"), "SOAP notes signed");
    setReview(false); nav(`/pro/visit/${id}`);
  };
  const sec = note[tab];

  return (
    <div className="mx-auto max-w-3xl space-y-5" data-testid="soap-editor">
      <Link to={`/pro/visit/${id}`} data-testid="soap-back-link" className="inline-flex items-center gap-1 text-sm text-nb-mute"><ArrowLeft className="h-4 w-4" />Visit</Link>
      <SoapConsentBanner apptId={id} enabled={!training} />
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div><p className="nb-eyebrow">SOAP notes · {appt.ref}</p><h1 className="text-2xl font-semibold tracking-tight">{idx.clients[appt.clientId]?.firstName} {idx.clients[appt.clientId]?.lastName}</h1></div>
        {signed ? <Pill tone="green" testid="soap-status">Signed {fmtStamp(existing.signedAt)} · {existing.signedBy}</Pill> : <Pill tone="amber" testid="soap-status">Unsigned draft{saved ? ` · autosaved ${fmtStamp(saved)}` : ""}</Pill>}
      </div>
      {!signed && (
        <div className="no-scrollbar flex gap-2 overflow-x-auto">
          {SOAP_TEMPLATES.map((t) => <button key={t.id} onClick={() => applyTpl(t)} data-testid={`soap-template-${t.id}`} className="nb-chip-off whitespace-nowrap">+ {t.name}</button>)}
          {prior.length > 0 && <button onClick={carry} data-testid="soap-carry-forward-btn" className="nb-chip-off whitespace-nowrap"><History className="h-4 w-4" />Carry forward last visit</button>}
        </div>
      )}
      <div className="grid grid-cols-4 gap-1 rounded-full bg-white p-1 ring-1 ring-sky-100" role="tablist">
        {SECTIONS.map(([k, l]) => <button key={k} role="tab" aria-selected={tab === k} onClick={() => setTab(k)} data-testid={`soap-tab-${k}`} className={`relative h-11 rounded-full text-sm font-semibold transition-colors ${tab === k ? "bg-nb-ink text-white" : "text-nb-mute"}`}>{k}<span className="hidden sm:inline"> · {l}</span>{(note[k].chips.length > 0 || note[k].text) && <Check className="absolute right-2 top-1 h-3 w-3 text-nb-turq" />}</button>)}
      </div>
      <div className="nb-card space-y-5 p-5">
        <p className="text-sm text-nb-mute">{SECTIONS.find((x) => x[0] === tab)[2]}</p>
        <div className="flex flex-wrap gap-2">{SOAP_LIBRARY[tab].map((c) => <button key={c} disabled={signed} onClick={() => chip(tab, c)} data-testid={`soap-chip-${tab}-${c.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`} className={sec.chips.includes(c) ? "nb-chip-on" : "nb-chip-off"}>{c}</button>)}</div>
        {tab === "S" && <div data-testid="soap-pain-scale"><p className="nb-label">Pain (client-reported): <b className="text-nb-blue">{sec.pain}/10</b></p><Slider disabled={signed} value={[sec.pain]} min={0} max={10} step={1} onValueChange={([v]) => upd("S", { pain: v })} /><div className="mt-2 flex justify-between gap-1">{Array.from({ length: 11 }, (_, n) => <button key={n} disabled={signed} onClick={() => upd("S", { pain: n })} data-testid={`soap-pain-${n}`} className={`h-8 w-8 rounded-full text-xs font-semibold ${sec.pain === n ? "nb-gradient text-white" : "bg-sky-50 text-nb-mute"}`}>{n}</button>)}</div></div>}
        {tab === "O" && <BodyMap areas={sec.areas || []} readOnly={signed} onToggle={(a) => upd("O", { areas: (sec.areas || []).includes(a) ? sec.areas.filter((x) => x !== a) : [...(sec.areas || []), a] })} />}
        <div className="relative">
          <textarea disabled={signed} rows={4} value={sec.text} onChange={(e) => upd(tab, { text: e.target.value })} placeholder="Add your own words — only record what you observed or the client reported." className="nb-input h-auto py-3 pr-14" data-testid={`soap-text-${tab}`} />
          {!signed && <button onClick={dictate} data-testid="soap-dictate-btn" aria-label="Dictate" className={`absolute right-3 top-3 rounded-full p-2 ${listening ? "bg-rose-100 text-rose-600" : "bg-sky-50 text-nb-blue"}`}>{listening ? <MicOff className="h-4 w-4" /> : <Mic className="h-4 w-4" />}</button>}
        </div>
      </div>
      {prior.length > 0 && <details className="nb-card p-4 text-sm" data-testid="soap-history"><summary className="cursor-pointer font-semibold">Treatment history ({prior.length})</summary>{prior.map((p) => <div key={p.id} className="mt-3 rounded-xl bg-slate-50 p-3 text-xs"><p className="font-semibold">{fmtStamp(p.signedAt)} · {p.signedBy}</p>{["S", "O", "A", "P"].map((k) => <p key={k}><b>{k}:</b> {[...p[k].chips, p[k].text].filter(Boolean).join(" · ")}{k === "S" && ` · pain ${p.S.pain}/10`}</p>)}</div>)}</details>}
      {signed && !amending ? (
        <div className="nb-card flex items-center justify-between gap-3 p-5">
          <p className="flex items-center gap-2 text-sm font-semibold"><Lock className="h-4 w-4" />Signed note stays as written.</p>
          <button type="button" className="nb-btn-ghost h-10 px-4 text-sm" data-testid="soap-amendment-edit" onClick={() => setAmending(true)}>Add a correction</button>
        </div>
      ) : signed ? (
        <form className="nb-card space-y-3 p-5" data-testid="soap-amendment" onSubmit={async (event) => { event.preventDefault(); await run(() => api.amendSoap(id, amendment), "Amendment recorded"); setAmendment({ reason: "", treatmentPerformed: "" }); setAmending(false); }}>
          <p className="flex items-center gap-2 text-sm font-semibold"><Lock className="h-4 w-4" />Signed note stays as written. A correction is added underneath.</p>
          <label className="block text-sm"><span className="nb-label">Reason</span><input required className="nb-input" value={amendment.reason} onChange={(e) => setAmendment({ ...amendment, reason: e.target.value })} data-testid="soap-amendment-reason" /></label>
          <label className="block text-sm"><span className="nb-label">Treatment performed</span><textarea required rows={3} className="nb-input h-auto py-3" value={amendment.treatmentPerformed} onChange={(e) => setAmendment({ ...amendment, treatmentPerformed: e.target.value })} data-testid="soap-amendment-treatment" placeholder="Record only what you performed." /></label>
          <div className="flex gap-2"><button type="button" className="nb-btn-ghost h-12 px-4" onClick={() => { setAmendment({ reason: "", treatmentPerformed: "" }); setAmending(false); }}>Cancel</button><button className="nb-btn-primary h-12" data-testid="soap-amendment-save">Record amendment</button></div>
        </form>
      ) : (
        <div className="safe-bottom sticky bottom-[72px] flex gap-2 lg:static">
          <button onClick={async () => { await api.saveSoap(id, { ...note, clientId: appt.clientId, practitionerId: appt.practitionerId }); setSaved(new Date().toISOString()); }} data-testid="soap-save-draft-btn" className="nb-btn-ghost h-14"><Save className="h-4 w-4" />Save draft</button>
          <button onClick={() => { setAck(false); setReview(true); }} data-testid="soap-review-sign-btn" className="nb-btn-primary h-14 flex-1"><FileSignature className="h-5 w-5" />Review & Sign</button>
        </div>
      )}
      <Dialog open={review} onOpenChange={setReview}>
        <DialogContent className="max-h-[90vh] overflow-y-auto rounded-3xl sm:max-w-lg" data-testid="soap-review-dialog">
          <DialogTitle>Review SOAP notes</DialogTitle>
          <div className="space-y-3 text-sm">{SECTIONS.map(([k, l]) => <div key={k} className="rounded-2xl bg-slate-50 p-3"><p className="text-xs font-semibold text-nb-mute">{k} · {l}</p><p>{[...note[k].chips, note[k].text].filter(Boolean).join(" · ") || <span className="text-rose-600">Nothing recorded</span>}</p>{k === "S" && <p className="text-xs">Pain {note.S.pain}/10</p>}{k === "O" && note.O.areas?.length > 0 && <p className="text-xs">Areas: {note.O.areas.map((a) => BODY_AREAS.find((b) => b.id === a)?.label).join(", ")}</p>}</div>)}</div>
          <label className="flex items-start gap-3 text-sm"><input type="checkbox" checked={ack} onChange={(e) => setAck(e.target.checked)} className="mt-1 h-4 w-4 accent-[#1565F0]" data-testid="soap-ack-checkbox" />I have reviewed these notes and confirm they accurately reflect this treatment.</label>
          <button disabled={!ack} onClick={sign} data-testid="soap-sign-btn" className="nb-btn-primary w-full">Sign notes</button>
        </DialogContent>
      </Dialog>
    </div>
  );
}
