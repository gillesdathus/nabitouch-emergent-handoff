import { useState } from "react";
import { Link } from "react-router-dom";
import { Search, Banknote, MessageSquare, Settings, ChevronRight, Lock } from "lucide-react";
import { usePreview } from "@/store/PreviewStore";
import { PageHeader, Avatar, Segmented, Notice, PayPill, EmptyState } from "@/components/ui-kit";
import { TopIcons } from "@/components/shells";
import { money, fmtDate, timeLabel } from "@/lib/domain";

export default function DeskClients() {
  const { db, openProfile } = usePreview();
  const [q, setQ] = useState("");
  const list = db.clients.filter((c) => c.name.toLowerCase().includes(q.toLowerCase()));
  return (
    <div className="max-w-3xl mx-auto px-5 pt-12 lg:pt-14">
      <PageHeader title="Clients" right={<TopIcons base="/desk" />} />
      <div className="relative mb-4"><Search className="absolute left-4 top-1/2 -translate-y-1/2 h-4 w-4 text-nb-mute" /><input data-testid="desk-client-search" className="nb-input pl-11 rounded-full" placeholder="Search by name" value={q} onChange={(e) => setQ(e.target.value)} /></div>
      {list.length === 0 && <EmptyState title="No matching clients" />}
      <div className="space-y-2">{list.map((c) => <button key={c.id} data-testid={`desk-client-${c.id}`} onClick={() => openProfile("client", c.id)} className="w-full nb-card p-3 flex items-center gap-3 text-left"><Avatar name={c.name} size={44} /><div className="flex-1"><p className="font-semibold text-sm">{c.name}</p><p className="text-xs text-nb-mute">{db.settings.receptionPerms.viewAddresses ? c.address : c.phone}</p></div><ChevronRight className="h-4 w-4 text-nb-mute" /></button>)}</div>
    </div>
  );
}

export function DeskMore() {
  const { db, cli, svc, openAppt } = usePreview();
  const [tab, setTab] = useState("payments");
  const perms = db.settings.receptionPerms;
  const due = db.appointments.filter((a) => a.settle.balance > 0 && ["completed", "in_session", "arrived"].includes(a.status));
  return (
    <div className="max-w-3xl mx-auto px-5 pt-12 lg:pt-14">
      <PageHeader title="More" right={<TopIcons base="/desk" />} />
      <Segmented testid="desk-more-tabs" value={tab} onChange={setTab} options={[{ value: "payments", label: "Payments" }, { value: "messages", label: "Messages" }]} className="mb-4" />
      {tab === "payments" && (!perms.managePayments ? <Notice icon={Lock}>Payments are not enabled for reception.</Notice> : (
        <div className="space-y-2">
          {due.map((a) => <button key={a.id} data-testid={`desk-due-${a.id}`} onClick={() => openAppt(a.id)} className="w-full nb-card p-3.5 flex items-center gap-3 text-left"><span className="h-10 w-10 rounded-2xl tint-meadow grid place-items-center text-[#4E9A2B]"><Banknote className="h-5 w-5" /></span><div className="flex-1"><p className="text-sm font-semibold">{cli(a.clientId).name}</p><p className="text-xs text-nb-mute">{svc(a.serviceId).name} · {fmtDate(a.date)} {timeLabel(a.time)}</p></div><div className="text-right"><p className="text-sm font-semibold nb-num">{money(a.settle.balance)}</p><PayPill pay={a.pay} /></div></button>)}
          {due.length === 0 && <EmptyState title="Nothing to collect" />}
        </div>
      ))}
      {tab === "messages" && (
        <div className="space-y-2">
          {db.messages.map((m) => <div key={m.id} data-testid={`desk-msg-${m.id}`} className="nb-card p-4 flex gap-3"><MessageSquare className="h-5 w-5 text-nb-blue shrink-0" /><div className="flex-1"><p className="text-sm"><span className="font-semibold">{m.from}</span> · <span className="text-nb-mute text-xs">{m.at}</span></p><p className="text-sm text-nb-mute mt-0.5">{m.body}</p></div></div>)}
          <Notice>Sending messages to clients is unavailable until delivery is connected.</Notice>
        </div>
      )}
      <Link to="/desk/settings" data-testid="desk-settings-link" className="mt-6 nb-card p-4 flex items-center gap-3"><Settings className="h-5 w-5 text-nb-mute" /><span className="flex-1 text-sm font-medium">Settings</span><ChevronRight className="h-4 w-4 text-nb-mute" /></Link>
    </div>
  );
}
