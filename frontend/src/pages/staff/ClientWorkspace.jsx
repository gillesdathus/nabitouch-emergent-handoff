import { useEffect, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { ArrowLeft, CalendarDays, FileText, HeartHandshake, Lock, Mail, MessageSquare, Phone, ShieldCheck, Signature } from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { EmptyState, Notice, Reveal } from "@/components/tide";
import { Avatar, Pill, StatusPill } from "@/components/ui-kit";
import { InvoiceStatePill } from "@/components/billing/InvoiceBits";
import { InvoiceDrawer } from "@/components/billing/InvoiceDrawer";
import { Conversation } from "@/components/Conversation";
import { api, apiError } from "@/lib/api";
import { formatCents } from "@/lib/billing";
import { OPEN, fmtDate, fmtTime } from "@/lib/domain";
import { NewBookingDialog } from "@/components/NewBookingDialog";
import { CreateInvoiceDialog } from "@/components/CreateInvoiceDialog";
import { sumInvoices, useInvoices } from "@/lib/useInvoices";
import { useDemo } from "@/store/DemoStore";
import { cn } from "@/lib/utils";

function Hero({ c, appts, totals, canMoney, actions }) {
  const done = appts.filter((a) => ["completed", "closed"].includes(a.status)).length;
  const upcoming = appts.filter((a) => ["requested", "confirmed", "en_route", "assigned", "preparing", "arrived", "in_session"].includes(a.status)).length;
  const next = appts.filter((a) => OPEN.includes(a.status)).sort((a, b) => `${a.date}${a.time}`.localeCompare(`${b.date}${b.time}`))[0];
  return (
    <section className="rounded-3xl bg-white p-4 shadow-sm ring-1 ring-sky-100 sm:p-5" data-testid="cw-hero">
      <div className="flex min-w-0 items-start gap-3">
        <Avatar person={c} photo={c.photo} size={52} />
        <div className="min-w-0 flex-1">
          <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-nb-teal">Client record</p>
          <h1 className="mt-0.5 break-words text-xl font-semibold tracking-tight text-nb-ink sm:text-2xl" data-testid="cw-name">{c.firstName} {c.lastName}</h1>
          <div className="mt-2 space-y-1 text-sm text-nb-mute">
            {c.email && <p className="flex min-w-0 items-start gap-1.5"><Mail className="mt-0.5 h-3.5 w-3.5 shrink-0" /><span className="break-all">{c.email}</span></p>}
            {c.phone && <p className="flex min-w-0 items-center gap-1.5"><Phone className="h-3.5 w-3.5 shrink-0" /><span className="break-all">{c.phone}</span></p>}
          </div>
          {(c.tags || []).length > 0 && (
            <div className="mt-2 flex flex-wrap gap-1.5">{(c.tags || []).map((t) => <span key={t} className="rounded-full bg-sky-50 px-2 py-0.5 text-[11px] font-medium text-nb-navy ring-1 ring-sky-100">{t}</span>)}</div>
          )}
        </div>
      </div>
      {next && <p className="mt-3 rounded-2xl bg-sky-50 px-3 py-2 text-xs text-nb-navy" data-testid="cw-next-visit"><b>Next visit:</b> {fmtDate(next.date, { weekday: "short", month: "short", day: "numeric" })} · {fmtTime(next.time)} · {next.ref}</p>}
      {actions && <div className="mt-3 flex flex-wrap gap-2" data-testid="cw-actions">{actions}</div>}
      <div className="mt-4 grid grid-cols-3 gap-2 text-center">
        {[["Visits", done, "cw-stat-visits"], ["Upcoming", upcoming, "cw-stat-upcoming"], ["Owing", canMoney ? formatCents(totals.balance) : "—", "cw-stat-owing"]].map(([k, v, id]) => (
          <div key={k} className="min-w-0 rounded-2xl bg-sky-50/80 px-2 py-2.5 ring-1 ring-sky-100" data-testid={id}>
            <p className="nb-num truncate text-lg font-semibold text-nb-ink sm:text-xl">{v}</p>
            <p className="text-[11px] text-nb-mute">{k}</p>
          </div>
        ))}
      </div>
    </section>
  );
}

function Visits({ appts, idx }) {
  if (!appts.length) return <EmptyState compact icon={CalendarDays} title="No visits yet" testid="cw-visits-empty" />;
  const sorted = [...appts].sort((a, b) => `${b.date}${b.time}`.localeCompare(`${a.date}${a.time}`));
  const upcoming = sorted.filter((a) => OPEN.includes(a.status)).reverse();
  const past = sorted.filter((a) => !OPEN.includes(a.status));
  return (
    <div className="space-y-5" data-testid="cw-visits">
      {upcoming.length > 0 && <div><p className="nb-eyebrow mb-2">Upcoming</p><VisitCards rows={upcoming} idx={idx} /></div>}
      {past.length > 0 && <div><p className="nb-eyebrow mb-2">Past</p><VisitCards rows={past} idx={idx} /></div>}
    </div>
  );
}

function VisitCards({ rows, idx }) {
  return (
    <div className="space-y-2.5">
      {rows.map((a, i) => (
        <Reveal key={a.id} i={i}>
          <div className="nb-card flex min-w-0 flex-wrap items-center gap-3 p-3.5 sm:gap-4 sm:p-4" data-testid={`cw-visit-${a.id}`}>
            <div className="w-14 shrink-0 text-center sm:w-16"><p className="text-[11px] uppercase text-nb-mute">{fmtDate(a.date, { month: "short" })}</p><p className="nb-num text-xl font-semibold text-nb-navy sm:text-2xl">{a.date?.slice(8, 10)}</p></div>
            <div className="min-w-0 flex-1"><p className="break-words text-sm font-semibold">{idx.services[a.serviceSlug]?.name || a.serviceSlug} · {a.duration} min</p><p className="break-words text-xs text-nb-mute">{a.time} · {idx.practitioners[a.practitionerId]?.name || "Unassigned"} · {a.ref}</p></div>
            <StatusPill status={a.status} />
          </div>
        </Reveal>
      ))}
    </div>
  );
}

function Invoices({ rows, onOpen }) {
  const totals = sumInvoices(rows);
  if (rows === undefined) return <div className="h-32 rounded-3xl nb-skeleton" />;
  return (
    <div data-testid="cw-invoices">
      <div className="mb-3 grid grid-cols-2 gap-2 sm:gap-3 lg:grid-cols-4">
        {[["Invoiced", totals.total], ["Client paid", totals.clientPaid], ["Insurance received", totals.insuranceReceived], ["Outstanding", totals.balance]].map(([k, v]) => <div key={k} className="nb-card min-w-0 p-3 sm:p-4"><p className="text-xs text-nb-mute">{k}</p><p className="nb-num truncate text-lg font-semibold sm:text-xl">{formatCents(v)}</p></div>)}
      </div>
      {totals.insurancePending > 0 && <Notice tone="info" className="mb-3" icon={ShieldCheck}>{formatCents(totals.insurancePending)} insurance expected and not yet received. It is not counted as paid.</Notice>}
      <div className="space-y-2">{rows.map((r) => (
        <button type="button" key={r.id} onClick={() => onOpen(r.id)} data-testid={`cw-invoice-${r.id}`} className="nb-card flex w-full min-w-0 items-center gap-3 p-3.5 text-left sm:p-4">
          <FileText className="h-5 w-5 shrink-0 text-nb-blue" /><span className="min-w-0 flex-1 text-sm"><b>{r.number || "Draft"}</b> · {r.service} · {r.serviceDate ? fmtDate(r.serviceDate) : ""}</span><InvoiceStatePill invoice={r} /><span className="nb-num w-20 shrink-0 text-right text-sm font-semibold sm:w-24">{r.balance.display}</span>
        </button>
      ))}{rows.length === 0 && <EmptyState compact icon={FileText} title="No invoices" testid="cw-invoices-empty" />}</div>
    </div>
  );
}

function Insurance({ c }) {
  const list = c.insurance || [];
  if (!list.length) return <EmptyState compact icon={ShieldCheck} title="No insurance on file" testid="cw-insurance-empty" />;
  return <div className="grid gap-3 sm:grid-cols-2" data-testid="cw-insurance">{list.map((i) => <div key={i.id} className="nb-card min-w-0 p-4"><p className="break-words font-semibold">{i.insurer}</p><p className="break-words text-xs text-nb-mute">Member {i.memberId || "—"} · {i.relationship || "self"}</p><Pill tone="cyan" className="mt-2">{i.status || "on file"}</Pill></div>)}</div>;
}

function Consents({ rows }) {
  if (!rows.length) return <EmptyState compact icon={Signature} title="No consent records" testid="cw-consents-empty" />;
  return <div className="space-y-2" data-testid="cw-consents">{rows.map((r) => <div key={r.id} className="nb-card flex min-w-0 items-center gap-3 p-3.5 sm:p-4" data-testid={`cw-consent-${r.id}`}><Signature className="h-5 w-5 shrink-0 text-nb-teal" /><span className="min-w-0 flex-1 text-sm"><b className="capitalize">{(r.kind || r.purpose || "consent").replaceAll("_", " ")}</b>{r.version ? ` · v${r.version}` : ""}<span className="block text-xs text-nb-mute">{r.at ? new Date(r.at).toLocaleDateString("en-CA") : ""}</span></span><Pill tone={r.withdrawnAt ? "amber" : "teal"}>{r.withdrawnAt ? "Withdrawn" : "Active"}</Pill></div>)}</div>;
}

function Threads({ rows, onOpen }) {
  if (!rows.length) return <EmptyState compact icon={MessageSquare} title="No messages yet" testid="cw-threads-empty" />;
  return <div className="space-y-2" data-testid="cw-threads">{rows.map((t) => <button type="button" key={t.appointmentId} onClick={() => onOpen(t)} className="nb-card flex w-full min-w-0 items-center gap-3 p-3.5 text-left sm:p-4" data-testid={`cw-thread-${t.appointmentId}`}><MessageSquare className="h-5 w-5 shrink-0 text-nb-blue" /><span className="min-w-0 flex-1 text-sm"><b>{t.ref}</b> · {fmtDate(t.date)}<span className="block truncate text-xs text-nb-mute">{t.last ? `${t.last.authorLabel || t.last.authorRole || ""}: ${t.last.body || ""}` : "Trip notices only"}</span></span><span className="shrink-0 text-xs text-nb-mute">{t.messages} msg · {t.notices} notices</span></button>)}</div>;
}

function Plans({ rows }) {
  if (!rows.length) return <EmptyState compact icon={HeartHandshake} title="No care plans" testid="cw-plans-empty" />;
  return <div className="grid gap-3 sm:grid-cols-2" data-testid="cw-plans">{rows.map((p) => <div key={p.id} className="nb-card min-w-0 p-4"><p className="break-words font-semibold">{p.title || p.name || "Care plan"}</p><p className="mt-1 text-xs text-nb-mute">{p.frequency || ""} {p.status ? `· ${p.status}` : ""}</p></div>)}</div>;
}

function ScrollTabs({ tabs }) {
  const scroller = useRef(null);
  const onKey = (event) => {
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
    const buttons = [...(scroller.current?.querySelectorAll('[role="tab"]') || [])];
    if (!buttons.length) return;
    const index = buttons.indexOf(document.activeElement);
    event.preventDefault();
    let next = index;
    if (event.key === "ArrowRight") next = Math.min(buttons.length - 1, index + 1);
    if (event.key === "ArrowLeft") next = Math.max(0, index - 1);
    if (event.key === "Home") next = 0;
    if (event.key === "End") next = buttons.length - 1;
    buttons[next]?.focus();
    buttons[next]?.click();
  };
  return (
    <div className="relative min-w-0">
      <TabsList
        ref={scroller}
        onKeyDown={onKey}
        className={cn("scroll-tabs h-auto w-full justify-start rounded-full bg-white p-1 ring-1 ring-sky-100")}
        data-testid="cw-tabs"
      >
        {tabs.map(([v, l]) => (
          <TabsTrigger key={v} value={v} data-testid={`cw-tab-${v}`} className="shrink-0 rounded-full px-3.5 py-2 text-sm data-[state=active]:bg-nb-navy data-[state=active]:text-white sm:px-4">
            {l}
          </TabsTrigger>
        ))}
      </TabsList>
      <span className="pointer-events-none absolute inset-y-0 right-0 w-8 rounded-r-full bg-gradient-to-l from-white to-transparent sm:hidden" aria-hidden="true" />
    </div>
  );
}

export default function ClientWorkspace() {
  const { id } = useParams();
  const { idx, user, perm } = useDemo();
  const [book, setBook] = useState(false);
  const [invoice, setInvoice] = useState(false);
  const role = user?.role;
  const [thread, setThread] = useState(null);
  const [ws, setWs] = useState(null);
  const [error, setError] = useState("");
  const [openId, setOpenId] = useState(null);
  useEffect(() => { api.clientWorkspace(id).then(setWs).catch((e) => setError(apiError(e))); }, [id]);
  const money = ws?.access?.invoices;
  const { rows, replace, reload } = useInvoices({ clientId: id }, Boolean(money));
  if (error) return <div className="mx-auto max-w-3xl py-6"><Notice testid="cw-error">{error}</Notice></div>;
  if (!ws) return <div className="mx-auto max-w-6xl space-y-3 py-2"><div className="h-36 rounded-3xl nb-skeleton" /><div className="h-48 rounded-3xl nb-skeleton" /></div>;
  const invoiceRows = money ? rows : [];
  const active = (invoiceRows || []).find((r) => r.id === openId);
  const tabs = [["overview", "Visits"], money && ["invoices", "Invoices"], ws.access.insurance && ["insurance", "Insurance"], ["consents", "Consents"], ws.access.threads && ["messages", "Messages"], ws.access.plans && ["plans", "Care plans"]].filter(Boolean);
  return (
    <div className="mx-auto max-w-6xl min-w-0" data-testid="client-workspace">
      <Link to={role === "owner" ? "/owner/clients" : "/desk/clients"} data-testid="cw-back" className="mb-3 inline-flex min-h-10 items-center gap-1.5 rounded-full px-1 text-sm font-medium text-nb-mute hover:text-nb-ink">
        <ArrowLeft className="h-4 w-4" />Clients
      </Link>
      <Hero c={ws.client} appts={ws.appointments} totals={sumInvoices(invoiceRows)} canMoney={money} actions={<>
        {(role === "owner" || perm("createBooking")) && <button type="button" onClick={() => setBook(true)} className="nb-btn-dark h-9 px-3 text-xs" data-testid="cw-book"><CalendarDays className="h-3.5 w-3.5" />Book visit</button>}
        {money && (role === "owner" || perm("managePayments")) && <button type="button" onClick={() => setInvoice(true)} className="nb-btn-ghost h-9 px-3 text-xs" data-testid="cw-new-invoice"><FileText className="h-3.5 w-3.5" />New invoice</button>}
        {ws.client.phone && <a href={`tel:${ws.client.phone}`} className="nb-btn-ghost h-9 px-3 text-xs" data-testid="cw-call"><Phone className="h-3.5 w-3.5" />Call</a>}
        {ws.client.email && <a href={`mailto:${ws.client.email}`} className="nb-btn-ghost h-9 px-3 text-xs" data-testid="cw-email"><Mail className="h-3.5 w-3.5" />Email</a>}
      </>} />
      {ws.client.intake?.precautions && <Notice tone="info" className="mt-3" testid="cw-precautions">Precautions: {ws.client.intake.precautions}</Notice>}
      <Tabs defaultValue="overview" className="mt-4">
        <ScrollTabs tabs={tabs} />
        <TabsContent value="overview" className="mt-3"><Visits appts={ws.appointments} idx={idx} /></TabsContent>
        {money && <TabsContent value="invoices" className="mt-3"><Invoices rows={invoiceRows} onOpen={setOpenId} /></TabsContent>}
        {ws.access.insurance && <TabsContent value="insurance" className="mt-3"><Insurance c={ws.client} /></TabsContent>}
        <TabsContent value="consents" className="mt-3"><Consents rows={ws.consents} /></TabsContent>
        {ws.access.threads && <TabsContent value="messages" className="mt-3"><Threads rows={ws.threads} onOpen={setThread} />{thread && <div className="mt-4"><Conversation appointmentId={thread.appointmentId} viewerRole={role || "desk"} title={thread.ref} counterpart={`${ws.client.firstName} ${ws.client.lastName}`} /></div>}</TabsContent>}
        {ws.access.plans && <TabsContent value="plans" className="mt-3"><Plans rows={ws.plans} /></TabsContent>}
      </Tabs>
      <p className="mt-8 flex items-center gap-1.5 text-[11px] text-nb-mute" data-testid="cw-privacy-note"><Lock className="h-3 w-3 shrink-0" />Clinical notes are not shown in this record. Opening it is logged.</p>
      {book && <NewBookingDialog open clientId={id} onClose={() => setBook(false)} />}
      {invoice && <CreateInvoiceDialog open clientId={id} onClose={(created) => { setInvoice(false); if (created?.id) { reload(); setOpenId(created.id); } }} />}
      <InvoiceDrawer invoice={active} open={Boolean(active)} onOpenChange={(o) => !o && setOpenId(null)} staffLink={role === "owner" ? "/owner/payments" : "/desk/verify"} flags={{ emailOn: idx?.settings?.invoiceEmailEnabled === true }} onChange={replace} />
    </div>
  );
}
