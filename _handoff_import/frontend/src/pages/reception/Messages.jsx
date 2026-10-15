import { useState } from "react";
import { Copy, MessageCircle } from "lucide-react";
import { toast } from "sonner";
import { SectionHead } from "@/components/ui-kit";
import { Conversation } from "@/components/Conversation";
import { EmptyState } from "@/components/tide";
import { useDemo } from "@/store/DemoStore";
import { OPEN, fmtDate, fmtTime } from "@/lib/domain";

export default function Messages() {
  const { state, idx, user } = useDemo();
  const appts = state.appointments.filter((a) => OPEN.includes(a.status));
  const [aid, setAid] = useState(appts[0]?.id || "");
  const a = appts.find((x) => x.id === aid) || appts[0];
  const fill = (body) => !a ? body : body.replace("{name}", idx.clients[a.clientId]?.firstName || "").replace("{service}", idx.services[a.serviceSlug]?.name || "").replace("{date}", fmtDate(a.date)).replace("{time}", fmtTime(a.time));
  return (
    <div className="mx-auto max-w-3xl space-y-5" data-testid="desk-messages">
      <SectionHead eyebrow="Communication" title="Visit messages" />
      <p className="text-sm text-nb-mute">Messages here are in the app for this visit. Templates below can be copied. They are not emailed or texted from this screen.</p>
      {appts.length === 0 && <EmptyState icon={MessageCircle} title="No open visits" body="A conversation appears when a visit is still active." />}
      {appts.length > 0 && (
        <>
          <select className="nb-input" value={a?.id || ""} onChange={(e) => setAid(e.target.value)} data-testid="messages-appt-select">{appts.map((x) => <option key={x.id} value={x.id}>{x.ref} · {idx.clients[x.clientId]?.firstName} · {fmtDate(x.date)} {fmtTime(x.time)}</option>)}</select>
          {a && <Conversation appointmentId={a.id} viewerRole={user?.role || "desk"} title={a.ref} counterpart={`${idx.clients[a.clientId]?.firstName || "Client"} · ${idx.practitioners[a.practitionerId]?.name || "Unassigned"}`} />}
        </>
      )}
      <div className="space-y-3">
        <p className="text-sm font-semibold">Copy-only templates</p>
        {(state.templates || []).map((t) => (
          <div key={t.id} className="nb-card p-5" data-testid={`template-${t.id}`}>
            <div className="flex items-center justify-between"><p className="font-semibold">{t.name}</p><span className="text-xs text-nb-mute">{t.channel} · not sent</span></div>
            <p className="mt-2 rounded-2xl bg-slate-50 p-3 text-sm">{fill(t.body)}</p>
            <div className="mt-3 flex gap-2"><button onClick={() => { navigator.clipboard?.writeText(fill(t.body)); toast.success("Copied. Nothing was sent."); }} data-testid={`template-copy-${t.id}`} className="nb-btn-ghost h-9 text-xs"><Copy className="h-3.5 w-3.5" />Copy</button></div>
          </div>
        ))}
      </div>
      <p className="text-xs text-nb-mute">Operational messages are separate from marketing, which requires the client’s optional consent. SMS stays off.</p>
    </div>
  );
}
