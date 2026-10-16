import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { toast } from "sonner";
import { Layers, Plus, Repeat } from "lucide-react";
import { api, apiError } from "@/lib/api";
import { useDemo } from "@/store/DemoStore";
import { Field, Notice, PageHeader, Segmented } from "@/components/tide";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

const BLANK = { kind: "package", name: "", description: "", serviceSlug: "", duration: "", credits: 5, price: "", validityDays: "" };
const NEXT = { draft: ["published"], published: ["paused", "archived"], paused: ["published", "archived"], archived: [] };
const LABEL = { published: "Publish", paused: "Pause", archived: "Archive" };
const key = () => `refund-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

function ProductForm({ onSaved }) {
  const { state } = useDemo();
  const [f, setF] = useState(BLANK);
  const services = (state.services || []).filter((s) => s.archived !== true);
  const service = services.find((s) => s.slug === f.serviceSlug);
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const save = () => api.planCreateProduct({ kind: f.kind, name: f.name, description: f.description, serviceSlug: f.serviceSlug, duration: Number(f.duration), credits: Number(f.credits),
    priceCents: Math.round(Number(f.price) * 100), validityDays: f.validityDays ? Number(f.validityDays) : undefined })
    .then(() => { toast.success("Plan saved as a draft"); setF(BLANK); onSaved(); }).catch((e) => toast.error(apiError(e)));
  return (
    <section className="nb-card space-y-4 p-5" data-testid="plan-form">
      <p className="flex items-center gap-2 font-semibold"><Plus className="h-4 w-4" />New plan</p>
      <Segmented options={[{ value: "package", label: "Prepaid package" }, { value: "membership", label: "Monthly membership" }]} value={f.kind} onChange={(kind) => setF({ ...f, kind })} testid="plan-form-kind" />
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Name"><input className="nb-input h-11 w-full" value={f.name} onChange={set("name")} data-testid="plan-form-name" placeholder="Relaxation 5-pack" /></Field>
        <Field label="Service"><Select value={f.serviceSlug} onValueChange={(v) => setF({ ...f, serviceSlug: v, duration: "" })}><SelectTrigger className="h-11 rounded-2xl" data-testid="plan-form-service"><SelectValue placeholder="Choose…" /></SelectTrigger><SelectContent>{services.map((s) => <SelectItem key={s.slug} value={s.slug} data-testid={`plan-form-service-${s.slug}`}>{s.name}</SelectItem>)}</SelectContent></Select></Field>
        <Field label="Duration"><Select value={String(f.duration)} onValueChange={(v) => setF({ ...f, duration: v })} disabled={!service}><SelectTrigger className="h-11 rounded-2xl" data-testid="plan-form-duration"><SelectValue placeholder="Choose…" /></SelectTrigger><SelectContent>{Object.entries(service?.prices || {}).map(([d, p]) => <SelectItem key={d} value={d} data-testid={`plan-form-duration-${d}`}>{d} min · ${p}</SelectItem>)}</SelectContent></Select></Field>
        <Field label={f.kind === "membership" ? "Credits per month" : "Credits"}><input type="number" min={1} max={24} className="nb-input h-11 w-full" value={f.credits} onChange={set("credits")} data-testid="plan-form-credits" /></Field>
        <Field label={f.kind === "membership" ? "Monthly price before GST ($)" : "Price before GST ($)"}><input type="number" min={1} className="nb-input h-11 w-full" value={f.price} onChange={set("price")} data-testid="plan-form-price" /></Field>
        <Field label="Credits valid for (days)" hint={f.kind === "membership" ? "Default 60" : "Default 365"}><input type="number" min={7} max={730} className="nb-input h-11 w-full" value={f.validityDays} onChange={set("validityDays")} data-testid="plan-form-validity" /></Field>
      </div>
      <Field label="Description"><input className="nb-input h-11 w-full" value={f.description} onChange={set("description")} data-testid="plan-form-description" /></Field>
      {service && f.duration && f.credits && f.price && <p className="text-xs text-nb-mute" data-testid="plan-form-preview">${(Number(f.price) / Number(f.credits)).toLocaleString("en-CA", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} per visit · regular ${(service.prices[f.duration] * f.credits).toLocaleString("en-CA", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} · practitioners are paid on the per-visit price.</p>}
      <button type="button" onClick={save} data-testid="plan-form-save" className="nb-btn-primary h-11 px-6 text-sm">Save draft</button>
    </section>
  );
}

function Products({ rows, reload }) {
  const move = (p, status) => api.planProductStatus(p.id, status).then(() => { toast.success(`Plan ${status}`); reload(); }).catch((e) => toast.error(apiError(e)));
  return (
    <section className="space-y-2" data-testid="plan-products">
      {rows.map((p) => (
        <div key={p.id} className="nb-card flex flex-wrap items-center gap-4 p-4" data-testid={`plan-product-${p.id}`}>
          {p.kind === "membership" ? <Repeat className="h-5 w-5 text-nb-teal" /> : <Layers className="h-5 w-5 text-nb-blue" />}
          <div className="min-w-[12rem] flex-1"><p className="text-sm font-semibold">{p.name}</p><p className="text-xs text-nb-mute">{p.credits} × {p.serviceName} {p.duration} min · {p.price.display}{p.kind === "membership" ? "/mo" : ""} · {p.perCredit.display}/visit</p></div>
          <span className="rounded-full bg-slate-100 px-2.5 py-1 text-[11px] font-semibold capitalize" data-testid={`plan-product-status-${p.id}`}>{p.status}</span>
          {NEXT[p.status].map((s) => <button key={s} type="button" onClick={() => move(p, s)} data-testid={`plan-product-${s}-${p.id}`} className="nb-btn-ghost h-9 px-4 text-xs">{LABEL[s]}</button>)}
        </div>
      ))}
      {rows.length === 0 && <p className="text-sm text-nb-mute">No plans yet.</p>}
    </section>
  );
}

function Purchases({ rows, reload }) {
  const refund = (p) => {
    const reason = window.prompt(`Refund unused credits on ${p.productName} for ${p.clientName}? Enter a reason:`);
    if (!reason) return;
    api.planRefund(p.id, { reason, idempotencyKey: key() }).then((r) => { toast.success(`Refunded ${r.refunded.display} (${r.refundMethod})`); reload(); }).catch((e) => toast.error(apiError(e)));
  };
  return (
    <section className="nb-card overflow-x-auto" data-testid="plan-purchases">
      <table className="w-full min-w-[640px] text-sm">
        <thead className="text-left text-xs text-nb-mute"><tr>{["Client", "Plan", "Paid", "Used", "Status", ""].map((h) => <th key={h} className="px-4 py-3 font-medium">{h}</th>)}</tr></thead>
        <tbody className="divide-y divide-sky-100">
          {rows.map((p) => (
            <tr key={p.id} data-testid={`plan-purchase-${p.id}`}>
              <td className="px-4 py-3">{p.clientName}</td><td className="px-4 py-3">{p.productName}</td><td className="px-4 py-3 tabular-nums">{p.total.display}</td>
              <td className="px-4 py-3 text-xs">{p.usage.consumed}/{p.credits} used · {p.usage.reserved} held · {p.usage.available} left</td>
              <td className="px-4 py-3 text-xs capitalize">{p.status.replace("_", " ")}{p.refunded.cents ? ` · ${p.refunded.display} back` : ""}</td>
              <td className="px-4 py-3 text-right">{p.usage.available > 0 && ["paid", "partially_refunded"].includes(p.status) && <button type="button" onClick={() => refund(p)} data-testid={`plan-refund-${p.id}`} className="nb-btn-ghost h-8 px-3 text-xs">Refund unused</button>}</td>
            </tr>
          ))}
          {rows.length === 0 && <tr><td colSpan={6} className="px-4 py-6 text-center text-xs text-nb-mute">No paid plans yet.</td></tr>}
        </tbody>
      </table>
    </section>
  );
}

export default function OwnerPlans() {
  const [tab, setTab] = useState("plans");
  const [products, setProducts] = useState([]);
  const [purchases, setPurchases] = useState([]);
  const [members, setMembers] = useState([]);
  const [showArchived, setShowArchived] = useState(false);
  const load = useCallback(() => {
    api.planProducts().then(setProducts).catch(() => {});
    api.planPurchases().then(setPurchases).catch(() => {});
    api.planMemberships().then(setMembers).catch(() => {});
  }, []);
  useEffect(() => { load(); }, [load]);
  return (
    <div className="mx-auto max-w-5xl space-y-6" data-testid="owner-plans-page">
      <PageHeader eyebrow="Wellness plans" title="Packages & memberships" sub={`${products.filter((p) => p.status === "published").length} on sale · ${members.filter((m) => m.status === "active").length} active members`} right={<Link to="/owner/reports?kind=plans" data-testid="plans-report-link" className="nb-btn-ghost h-10 text-sm">Deferred revenue report</Link>} />
      <Notice testid="plans-accounting-note">A purchase is deferred revenue. It is recognised one credit at a time when a visit is completed. Credits never combine with promotions, gift cards or rewards.</Notice>
      <Segmented options={[{ value: "plans", label: "Plans" }, { value: "sales", label: "Sales" }, { value: "members", label: "Members" }]} value={tab} onChange={setTab} testid="plans-tab" />
      {tab === "plans" && <><ProductForm onSaved={load} /><Products rows={products.filter((p) => showArchived || p.status !== "archived")} reload={load} />
        {products.some((p) => p.status === "archived") && <button type="button" onClick={() => setShowArchived((v) => !v)} data-testid="plans-toggle-archived" className="text-xs font-medium text-nb-blue">{showArchived ? "Hide archived plans" : `Show ${products.filter((p) => p.status === "archived").length} archived`}</button>}</>}
      {tab === "sales" && <Purchases rows={purchases} reload={load} />}
      {tab === "members" && (
        <section className="space-y-2" data-testid="plan-members">
          {members.map((m) => <div key={m.id} className="nb-card flex items-center gap-4 p-4 text-sm" data-testid={`plan-member-${m.id}`}><Repeat className="h-5 w-5 text-nb-teal" /><span className="flex-1">{m.productName} · {m.clientId}</span><span className="text-xs capitalize text-nb-mute">{m.status}{m.cancelAtPeriodEnd ? " · ending" : ""}</span></div>)}
          {members.length === 0 && <p className="text-sm text-nb-mute">No memberships yet.</p>}
        </section>
      )}
    </div>
  );
}
