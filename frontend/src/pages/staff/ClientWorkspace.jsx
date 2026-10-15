import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { ArrowLeft, CalendarDays, FileText, HeartHandshake, Lock, Mail, MessageSquare, Phone, ShieldCheck, Signature } from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { EmptyState, Notice, Reveal } from "@/components/tide";
import { Pill, StatusPill } from "@/components/ui-kit";
import { InvoiceStatePill } from "@/components/billing/InvoiceBits";
import { InvoiceDrawer } from "@/components/billing/InvoiceDrawer";
import { Conversation } from "@/components/Conversation";
import { api, apiError } from "@/lib/api";
import { formatCents } from "@/lib/billing";
import { fmtDate } from "@/lib/domain";
import { sumInvoices, useInvoices } from "@/lib/useInvoices";
import { useDemo } from "@/store/DemoStore";

function Hero({ c, appts, totals, canMoney }) {
  const done = appts.filter((a) => ["completed", "closed"].includes(a.status)).length;
  return (
    <section className="relative overflow-hidden rounded-[32px] p-6 text-white nb-lagoon sm:p-8" data-testid="cw-hero">
      <span className="pointer-events-none absolute -right-20 -top-20 h-64 w-64 rounded-full bg-nb-turq/30 blur-3xl" />
      <div className="relative flex flex-wrap items-end justify-between gap-6">
        <div>
          <p className="text-[11px] uppercase tracking-[0.2em] text-cyan-100">Client record</p>
          <h1 className="mt-1 text-3xl font-semibold sm:text-4xl" data-testid="cw-name">{c.firstName} {c.lastName}</h1>
          <div className="mt-3 flex flex-wrap gap-3 text-sm text-white/85">
            {c.email && <span className="flex items-center gap-1.5"><Mail className="h-4 w-4" />{c.email}</span>}
            {c.phone && <span className="flex items-center gap-1.5"><Phone className="h-4 w-4" />{c.phone}</span>}
          </div>
          <div className="mt-3 flex flex-wrap gap-1.5">{(c.tags || []).map((t) => <span key={t} className="rounded-full bg-white/15 px-2.5 py-1 text-[11px]">{t}</span>)}</div>
        </div>
        <div className="grid grid-cols-3 gap-2 text-center">
          {[["Visits", done, "cw-stat-visits"], ["Upcoming", appts.filter((a) => ["requested", "confirmed", "en_route"].includes(a.status)).length, "cw-stat-upcoming"], ["Owing", canMoney ? formatCents(totals.balance) : "—", "cw-stat-owing"]].map(([k, v, id]) => (
            <div key={k} className="min-w-[88px] rounded-2xl bg-white/10 px-3 py-2.5 backdrop-blur" data-testid={id}><p className="nb-num text-xl font-semibold">{v}</p><p className="text-[11px] text-white/70">{k}</p></div>
          ))}
        </div>
      </div>
    </section>
  );
}

function Visits({ appts, idx }) {
  if (!appts.length) return <EmptyState icon={CalendarDays} title="No visits yet" testid="cw-visits-empty" />;
  return (
    <div className="space-y-2.5" data-testid="cw-visits">
      {appts.map((a, i) => (
        <Reveal key={a.id} i={i}>
          <div className="nb-card flex flex-wrap items-center gap-4 p-4" data-testid={`cw-visit-${a.id}`}>
            <div className="w-16 text-center"><p className="text-[11px] uppercase text-nb-mute">{fmtDate(a.date, { month: "short" })}</p><p className="nb-num text-2xl font-semibold text-nb-navy">{a.date?.slice(8, 10)}</p></div>
            <div className="min-w-0 flex-1"><p className="text-sm font-semibold">{idx.services[a.serviceSlug]?.name || a.serviceSlug} · {a.duration} min</p><p className="text-xs text-nb-mute">{a.time} · {idx.practitioners[a.practitionerId]?.name || "Unassigned"} · {a.ref}</p></div>
            <StatusPill status={a.status} />
          </div>
        </Reveal>
      ))}
    </div>
  );
}

function Invoices({ rows, onOpen }) {
  const totals = sumInvoices(rows);
  if (rows === undefined) return <div className="h-40 rounded-3xl nb-skeleton" />;
  return (
    <div data-testid="cw-invoices">
      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        {[["Invoiced", totals.total], ["Client paid", totals.clientPaid], ["Insurance received", totals.insuranceReceived], ["Outstanding", totals.balance]].map(([k, v]) => <div key={k} className="nb-card p-4"><p className="text-xs text-nb-mute">{k}</p><p className="nb-num text-xl font-semibold">{formatCents(v)}</p></div>)}
      </div>
      {totals.insurancePending > 0 && <Notice tone="info" className="mb-4" icon={ShieldCheck}>{formatCents(totals.insurancePending)} insurance expected and not yet received. It is not counted as paid.</Notice>}
      <div className="space-y-2">{rows.map((r) => (
        <button type="button" key={r.id} onClick={() => onOpen(r.id)} data-testid={`cw-invoice-${r.id}`} className="nb-card flex w-full items-center gap-3 p-4 text-left">
          <FileText className="h-5 w-5 text-nb-blue" /><span className="flex-1 text-sm"><b>{r.number || "Draft"}</b> · {r.service} · {r.serviceDate ? fmtDate(r.serviceDate) : ""}</span><InvoiceStatePill invoice={r} /><span className="nb-num w-24 text-right text-sm font-semibold">{r.balance.display}</span>
        </button>
      ))}{rows.length === 0 && <EmptyState icon={FileText} title="No invoices" testid="cw-invoices-empty" />}</div>
    </div>
  );
}

function Insurance({ c }) {
  const list = c.insurance || [];
  if (!list.length) return <EmptyState icon={ShieldCheck} title="No insurance on file" testid="cw-insurance-empty" />;
  return <div className="grid gap-3 sm:grid-cols-2" data-testid="cw-insurance">{list.map((i) => <div key={i.id} className="nb-card p-4"><p className="font-semibold">{i.insurer}</p><p className="text-xs text-nb-mute">Member {i.memberId || "—"} · {i.relationship || "self"}</p><Pill tone="cyan" className="mt-2">{i.status || "on file"}</Pill></div>)}</div>;
}

function Consents({ rows }) {
  if (!rows.length) return <EmptyState icon={Signature} title="No consent records" testid="cw-consents-empty" />;
  return <div className="space-y-2" data-testid="cw-consents">{rows.map((r) => <div key={r.id} className="nb-card flex items-center gap-3 p-4" data-testid={`cw-consent-${r.id}`}><Signature className="h-5 w-5 text-nb-teal" /><span className="flex-1 text-sm"><b className="capitalize">{(r.kind || r.purpose || "consent").replaceAll("_", " ")}</b>{r.version ? ` · v${r.version}` : ""}<span className="block text-xs text-nb-mute">{r.at ? new Date(r.at).toLocaleDateString("en-CA") : ""}</span></span><Pill tone={r.withdrawnAt ? "amber" : "teal"}>{r.withdrawnAt ? "Withdrawn" : "Active"}</Pill></div>)}</div>;
}

function Threads({ rows, onOpen }) {
  if (!rows.length) return <EmptyState icon={MessageSquare} title="No messages yet" testid="cw-threads-empty" />;
  return <div className="space-y-2" data-testid="cw-threads">{rows.map((t) => <button type="button" key={t.appointmentId} onClick={() => onOpen(t)} className="nb-card flex w-full items-center gap-3 p-4 text-left" data-testid={`cw-thread-${t.appointmentId}`}><MessageSquare className="h-5 w-5 text-nb-blue" /><span className="min-w-0 flex-1 text-sm"><b>{t.ref}</b> · {fmtDate(t.date)}<span className="block truncate text-xs text-nb-mute">{t.last ? `${t.last.authorLabel || t.last.authorRole || ""}: ${t.last.body || ""}` : "Trip notices only"}</span></span><span className="text-xs text-nb-mute">{t.messages} msg · {t.notices} notices</span></button>)}</div>;
}

function Plans({ rows }) {
  if (!rows.length) return <EmptyState icon={HeartHandshake} title="No care plans" testid="cw-plans-empty" />;
  return <div className="grid gap-3 sm:grid-cols-2" data-testid="cw-plans">{rows.map((p) => <div key={p.id} className="nb-card p-4"><p className="font-semibold">{p.title || p.name || "Care plan"}</p><p className="mt-1 text-xs text-nb-mute">{p.frequency || ""} {p.status ? `· ${p.status}` : ""}</p></div>)}</div>;
}

export default function ClientWorkspace() {
  const { id } = useParams();
  const { idx, user } = useDemo();
  const role = user?.role;
  const [thread, setThread] = useState(null);
  const [ws, setWs] = useState(null);
  const [error, setError] = useState("");
  const [openId, setOpenId] = useState(null);
  useEffect(() => { api.clientWorkspace(id).then(setWs).catch((e) => setError(apiError(e))); }, [id]);
  const money = ws?.access?.invoices;
  const { rows } = useInvoices({ clientId: id }, Boolean(money));
  if (error) return <div className="mx-auto max-w-3xl px-5 py-12"><Notice testid="cw-error">{error}</Notice></div>;
  if (!ws) return <div className="mx-auto max-w-6xl space-y-4 px-5 py-8"><div className="h-48 rounded-[32px] nb-skeleton" /><div className="h-64 rounded-3xl nb-skeleton" /></div>;
  const invoiceRows = money ? rows : [];
  const active = (invoiceRows || []).find((r) => r.id === openId);
  const tabs = [["overview", "Visits"], money && ["invoices", "Invoices"], ws.access.insurance && ["insurance", "Insurance"], ["consents", "Consents"], ws.access.threads && ["messages", "Messages"], ws.access.plans && ["plans", "Care plans"]].filter(Boolean);
  return (
    <div className="mx-auto max-w-6xl px-5 py-8 nb-page" data-testid="client-workspace">
      <Link to={role === "owner" ? "/owner/manage" : "/desk/clients"} data-testid="cw-back" className="mb-4 inline-flex items-center gap-1 text-sm text-nb-mute"><ArrowLeft className="h-4 w-4" />Clients</Link>
      <Hero c={ws.client} appts={ws.appointments} totals={sumInvoices(invoiceRows)} canMoney={money} />
      {ws.client.intake?.precautions && <Notice tone="info" className="mt-4" testid="cw-precautions">Precautions: {ws.client.intake.precautions}</Notice>}
      <Tabs defaultValue="overview" className="mt-6">
        <TabsList className="h-auto flex-wrap justify-start gap-1 rounded-full bg-white p-1 ring-1 ring-sky-100" data-testid="cw-tabs">
          {tabs.map(([v, l]) => <TabsTrigger key={v} value={v} data-testid={`cw-tab-${v}`} className="rounded-full px-4 py-2 data-[state=active]:bg-nb-navy data-[state=active]:text-white">{l}</TabsTrigger>)}
        </TabsList>
        <TabsContent value="overview" className="mt-5"><Visits appts={ws.appointments} idx={idx} /></TabsContent>
        {money && <TabsContent value="invoices" className="mt-5"><Invoices rows={invoiceRows} onOpen={setOpenId} /></TabsContent>}
        {ws.access.insurance && <TabsContent value="insurance" className="mt-5"><Insurance c={ws.client} /></TabsContent>}
        <TabsContent value="consents" className="mt-5"><Consents rows={ws.consents} /></TabsContent>
        {ws.access.threads && <TabsContent value="messages" className="mt-5"><Threads rows={ws.threads} onOpen={setThread} />{thread && <div className="mt-4"><Conversation appointmentId={thread.appointmentId} viewerRole={role || "desk"} title={thread.ref} counterpart={`${ws.client.firstName} ${ws.client.lastName}`} /></div>}</TabsContent>}
        {ws.access.plans && <TabsContent value="plans" className="mt-5"><Plans rows={ws.plans} /></TabsContent>}
      </Tabs>
      <p className="mt-10 flex items-center gap-1.5 text-[11px] text-nb-mute" data-testid="cw-privacy-note"><Lock className="h-3 w-3" />Clinical notes are not shown in this record. Opening it is logged.</p>
      <InvoiceDrawer invoice={active} open={Boolean(active)} onOpenChange={(o) => !o && setOpenId(null)} staffLink={role === "owner" ? "/owner/payments" : "/desk/verify"} flags={{ emailOn: idx?.settings?.invoiceEmailEnabled === true }} />
    </div>
  );
}
