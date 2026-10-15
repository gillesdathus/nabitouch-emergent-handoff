import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { ArrowLeft, Lock, PenLine, Check, CloudUpload } from "lucide-react";
import { usePreview } from "@/store/PreviewStore";
import { PageHeader, Pill, BottomSheet, Notice, Field, cx } from "@/components/ui-kit";
import { fmtDate } from "@/lib/domain";

const SECTIONS = [["S", "Subjective", "What the client reports — pain, goals, changes since last visit"], ["O", "Objective", "What you observed — posture, range of motion, tissue findings"], ["A", "Assessment", "Your clinical impression"], ["P", "Plan", "Treatment given, home care and next visit"]];

export default function Soap() {
  const { id } = useParams();
  const nav = useNavigate();
  const { db, cli, svc, api } = usePreview();
  const a = db.appointments.find((x) => x.id === id);
  const [open, setOpen] = useState("S");
  const [notes, setNotes] = useState({ S: "", O: "", A: "", P: "" });
  const [saved, setSaved] = useState(true);
  const [confirm, setConfirm] = useState(false);
  const [amend, setAmend] = useState("");
  const [amends, setAmends] = useState([]);
  const signed = a?.soap === "signed";
  useEffect(() => {
    if (saved) return undefined;
    const t = setTimeout(() => setSaved(true), 900);
    return () => clearTimeout(t);
  }, [notes, saved]);
  if (!a) return null;
  return (
    <div className="max-w-2xl mx-auto px-5 pt-12 lg:pt-14">
      <PageHeader back={<button data-testid="soap-back" onClick={() => nav(-1)} className="h-11 w-11 grid place-items-center rounded-full bg-white ring-1 ring-sky-100 shrink-0"><ArrowLeft className="h-4 w-4" /></button>} eyebrow="Clinical note" title="SOAP" sub={`${cli(a.clientId).name} · ${svc(a.serviceId).name} · ${fmtDate(a.date)}`}
        right={signed ? <Pill tone="bg-nb-green/15 text-[#3E7A1E] ring-nb-green/30"><Lock className="h-3 w-3" />Signed</Pill> : <span data-testid="soap-autosave" className="text-xs text-nb-mute flex items-center gap-1">{saved ? <><Check className="h-3.5 w-3.5 text-nb-teal" />Saved</> : <><CloudUpload className="h-3.5 w-3.5" />Saving…</>}</span>} />
      <div className="space-y-3">
        {SECTIONS.map(([k, t, h]) => (
          <div key={k} className={cx("nb-card overflow-hidden transition-shadow", open === k && "ring-2 ring-nb-blue/25")}>
            <button data-testid={`soap-section-${k}`} onClick={() => setOpen(open === k ? "" : k)} className="w-full flex items-center gap-3 p-4 text-left">
              <span className={cx("h-10 w-10 rounded-2xl grid place-items-center font-display text-lg", notes[k] || signed ? "nb-lagoon text-white" : "tint-ice text-nb-blue")}>{k}</span>
              <div className="flex-1"><p className="font-semibold">{t}</p><p className="text-xs text-nb-mute line-clamp-1">{notes[k] || (signed ? "Recorded in signed note" : h)}</p></div>
            </button>
            {open === k && <div className="px-4 pb-4"><textarea data-testid={`soap-input-${k}`} disabled={signed} rows={4} className="nb-input h-auto py-3 disabled:bg-slate-50" placeholder={h} value={notes[k]} onChange={(e) => { setNotes({ ...notes, [k]: e.target.value }); setSaved(false); }} /></div>}
          </div>
        ))}
      </div>
      {!signed ? (
        <button data-testid="soap-sign-btn" disabled={!Object.values(notes).every((v) => v.trim())} onClick={() => setConfirm(true)} className="nb-btn-primary w-full mt-5"><PenLine className="h-4 w-4" />Sign note</button>
      ) : (
        <div className="nb-card p-4 mt-5">
          <p className="font-semibold mb-2">Amendments</p>
          {amends.map((m, i) => <p key={i} className="text-sm border-l-2 border-nb-turq pl-3 py-1 mb-2">{m}<span className="block text-xs text-nb-mute">Just now · Amira Haddad</span></p>)}
          <Field label="Add amendment" hint="Signed notes can't be edited. Amendments are appended with a timestamp."><textarea data-testid="soap-amend-input" rows={2} className="nb-input h-auto py-3" value={amend} onChange={(e) => setAmend(e.target.value)} /></Field>
          <button data-testid="soap-amend-btn" disabled={!amend.trim()} onClick={() => { setAmends([...amends, amend]); setAmend(""); }} className="nb-btn-dark w-full">Append amendment</button>
        </div>
      )}
      <BottomSheet open={confirm} onOpenChange={setConfirm} title="Sign this note?" testid="soap-sign-sheet" footer={<button data-testid="soap-sign-confirm" onClick={async () => { await api.save("appointments", a.id, { soap: "signed" }, "SOAP note signed"); setConfirm(false); }} className="nb-btn-primary w-full">Sign and lock</button>}>
        <Notice icon={Lock}>After signing, the note is locked. Changes can only be added as amendments.</Notice>
      </BottomSheet>
    </div>
  );
}
