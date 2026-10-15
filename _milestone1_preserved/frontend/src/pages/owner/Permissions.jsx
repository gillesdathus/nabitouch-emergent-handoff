import { useState } from "react";
import { UserPlus, KeyRound, FileSignature, History } from "lucide-react";
import { usePreview } from "@/store/PreviewStore";
import { PageHeader, Avatar, Pill, BottomSheet, Field, Notice, SectionHead, CountUp, Reveal } from "@/components/ui-kit";
import { Switch } from "@/components/ui/switch";
import { TopIcons } from "@/components/shells";
import { RECEPTION_PERMS } from "@/lib/domain";

export default function Permissions() {
  const { db, api } = usePreview();
  const [open, setOpen] = useState(false);
  const [f, setF] = useState({ name: "", email: "" });
  const perms = db.settings.receptionPerms;
  return (
    <div className="max-w-4xl mx-auto px-5 pt-12 lg:pt-14">
      <PageHeader eyebrow="Admin" title="Reception access" sub="The server enforces these; hiding a control is not the check." right={<TopIcons base="/owner" />} />
      <div className="nb-card divide-y divide-sky-100">
        {RECEPTION_PERMS.map((p) => (
          <div key={p.key} className="flex items-center gap-3 px-4 py-3.5">
            <div className="flex-1"><p className="text-sm font-medium">{p.label}</p>{p.note && <p className="text-xs text-nb-mute">{p.note}</p>}</div>
            <Switch data-testid={`perm-${p.key}`} checked={perms[p.key]} onCheckedChange={(v) => api.perms(p.key, v)} />
          </div>
        ))}
      </div>
      <div className="flex items-center justify-between mt-8 mb-3"><SectionHead title="Staff" className="!mb-0" /><button data-testid="invite-staff-btn" onClick={() => setOpen(true)} className="nb-btn-primary h-11 text-sm"><UserPlus className="h-4 w-4" />Invite staff</button></div>
      <div className="space-y-2">{db.staff.map((s) => <div key={s.id} className="nb-card p-3 flex items-center gap-3"><Avatar name={s.name} size={40} /><div className="flex-1"><p className="text-sm font-semibold">{s.name}</p><p className="text-xs text-nb-mute">{s.role === "desk" ? "Reception" : "Practitioner"} · {s.email}</p></div><Pill>{s.status}</Pill></div>)}</div>
      <BottomSheet open={open} onOpenChange={setOpen} title="Invite reception staff" testid="staff-invite-sheet" footer={<button data-testid="staff-invite-submit" disabled={!f.name || !f.email.includes("@")} onClick={async () => { await api.create("staff", { id: `st${Date.now()}`, ...f, role: "desk", status: "invited" }, "Invite sent"); setOpen(false); }} className="nb-btn-primary w-full">Send invite</button>}>
        <Field label="Name"><input data-testid="staff-name" className="nb-input" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
        <Field label="Email"><input data-testid="staff-email" type="email" className="nb-input" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} /></Field>
        <Notice icon={KeyRound} tone="info">No password field: the person sets their own password from the invite, then enrolls an authenticator.</Notice>
      </BottomSheet>
    </div>
  );
}

export function Insights() {
  const { db } = usePreview();
  const done = db.appointments.filter((a) => a.status === "completed");
  const signed = done.filter((a) => a.soap === "signed").length;
  return (
    <div className="max-w-4xl mx-auto px-5 pt-12 lg:pt-14">
      <PageHeader eyebrow="Admin" title="Insights" sub="Audit trail and clinical summary" right={<TopIcons base="/owner" />} />
      <div className="grid grid-cols-3 gap-3 mb-6">
        {[["Completed", done.length], ["SOAP signed", signed], ["Drafts", done.filter((a) => a.soap === "draft").length]].map(([l, v], i) => <Reveal key={l} i={i} className="nb-card p-4"><FileSignature className="h-4 w-4 text-nb-teal" /><p className="text-2xl font-semibold mt-2"><CountUp value={v} format={(x) => Math.round(x)} /></p><p className="text-xs text-nb-mute">{l}</p></Reveal>)}
      </div>
      <SectionHead title="Audit log" />
      <div className="nb-card divide-y divide-sky-100">{db.audit.map((e) => <div key={e.id} data-testid={`audit-${e.id}`} className="flex items-center gap-3 px-4 py-3"><History className="h-4 w-4 text-nb-mute" /><div className="flex-1"><p className="text-sm"><span className="font-semibold">{e.who}</span> · {e.what}</p></div><span className="text-xs text-nb-mute">{e.at}</span></div>)}</div>
    </div>
  );
}
