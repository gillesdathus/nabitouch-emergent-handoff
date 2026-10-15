import { Link } from "react-router-dom";
import { useState } from "react";
import { Switch } from "@/components/ui/switch";
import { Gift } from "lucide-react";
import { SectionHead, Pill } from "@/components/ui-kit";
import { useDemo } from "@/store/DemoStore";
import { money, staffActor } from "@/lib/domain";

function PromoCard({ p }) {
  const { run, api, state, user } = useDemo();
  const [editing, setEditing] = useState(false);
  const [f, setF] = useState(p);
  const set = (k, num) => (e) => setF({ ...f, [k]: num ? (e.target.value === "" ? null : Number(e.target.value)) : e.target.value });
  const open = () => { setF(p); setEditing(true); };
  const save = () => { const { id, ...rest } = f; run(() => api.patch("promotions", p.id, { ...rest, _audit: `Promotion ${p.code} updated`, _actor: staffActor(user) }), "Promotion saved").then(() => setEditing(false)); };
  const F = ({ l, k, type = "number", num = true }) => <label className="text-xs"><span className="mb-1 block text-nb-mute">{l}</span><input type={type} value={f[k] ?? ""} onChange={set(k, num)} className="nb-input h-10" data-testid={`promo-${p.id}-${k}`} /></label>;
  return (
    <div className="nb-card space-y-4 p-5" data-testid={`promo-card-${p.id}`}>
      <div className="flex items-center gap-3"><div className="flex-1"><p className="font-semibold">{p.name}</p><p className="font-mono text-xs text-nb-mute">{p.code} · {p.redemptions} redeemed{p.eligibility === "first_online" ? " · First-booking welcome offer" : ""}</p>{p.eligibility === "first_online" && <p className="text-xs text-nb-mute">Eligibility is checked on the server from appointment history. This offer does not combine with other discounts, rewards, or referrals.</p>}</div><Switch checked={f.enabled} onCheckedChange={(v) => { setF({ ...f, enabled: v }); run(() => api.patch("promotions", p.id, { enabled: v, _audit: `Promotion ${p.code} ${v ? "enabled" : "disabled"}`, _actor: staffActor(user) })); }} data-testid={`promo-${p.id}-enabled`} /></div>
      {!editing && <div className="flex items-center justify-between gap-3 text-sm"><p className="text-nb-mute">{p.type === "percent" ? `${p.value}%` : money(p.value)} · {String(p.eligibility || "").replaceAll("_", " ")} · {p.start || "No start"} to {p.end || "no end"}</p><button type="button" className="nb-btn-ghost h-10 px-4 text-sm" onClick={open} data-testid={`promo-${p.id}-edit`}>Edit</button></div>}
      {editing && <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {F({ l: p.type === "percent" ? "Discount %" : "Discount $", k: "value" })}{F({ l: "Max discount $", k: "maxDiscount" })}{F({ l: "Redemption limit", k: "redemptionLimit" })}
        <label className="text-xs"><span className="mb-1 block text-nb-mute">Eligibility</span><select value={f.eligibility} onChange={set("eligibility")} className="nb-input h-10" data-testid={`promo-${p.id}-eligibility`}><option value="first_online">First online booking</option><option value="birthday_month">Birthday month (consent)</option><option value="referral">Referral</option></select></label>
        {F({ l: "Start", k: "start", type: "date", num: false })}{F({ l: "End", k: "end", type: "date", num: false })}
        <label className="text-xs sm:col-span-2"><span className="mb-1 block text-nb-mute">Applicable services</span><select value={f.services === "all" ? "all" : "some"} onChange={(e) => setF({ ...f, services: e.target.value === "all" ? "all" : (Array.isArray(f.services) ? f.services : []) })} className="nb-input h-10" data-testid={`promo-${p.id}-services`}><option value="all">All services</option><option value="some">Selected services</option></select></label>
      </div>}
      {editing && f.services !== "all" && <div className="flex flex-wrap gap-2" data-testid={`promo-${p.id}-service-list`}>{state.services.filter((s) => s.published !== false).map((s) => <label key={s.slug} className="flex items-center gap-1 text-xs"><input type="checkbox" checked={Array.isArray(f.services) && f.services.includes(s.slug)} onChange={(e) => { const current = Array.isArray(f.services) ? f.services : []; setF({ ...f, services: e.target.checked ? [...current, s.slug] : current.filter((slug) => slug !== s.slug) }); }} />{s.name}</label>)}</div>}
      {editing && <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={f.stackable} onChange={(e) => setF({ ...f, stackable: e.target.checked })} className="h-4 w-4 accent-[#1565F0]" data-testid={`promo-${p.id}-stackable`} />Can be combined with other offers</label>}
      {editing && <div className="flex items-center justify-between"><span className="text-xs text-nb-mute">Applies to treatment price only · never travel or tax</span><span className="flex gap-2"><button type="button" onClick={() => setEditing(false)} className="nb-btn-ghost h-10 px-4 text-sm">Cancel</button><button onClick={save} data-testid={`promo-${p.id}-save`} className="nb-btn-primary h-10 text-sm">Save</button></span></div>}
    </div>
  );
}

export default function Promos() {
  const { state, run, api } = useDemo();
  const [created, setCreated] = useState({ name: "", code: "", type: "percent", value: "10", start: "", end: "" });
  const [creating, setCreating] = useState(new URLSearchParams(window.location.search).get("create") === "1");
  const createPromo = () => run(() => api.create("promotions", { ...created, value: Number(created.value), eligibility: "referral", services: "all" }), "Promotion saved as a draft").then(() => { setCreated({ name: "", code: "", type: "percent", value: "10", start: "", end: "" }); setCreating(false); });
  return (
    <div className="space-y-8" data-testid="owner-promos">
      <SectionHead eyebrow="Growth" title="Promotions" />
      <button type="button" className="nb-btn-primary h-10 px-4 text-sm" onClick={() => setCreating((value) => !value)} data-testid="promo-create-open">{creating ? "Close" : "Create promotion"}</button>
      {creating && <form className="nb-card grid gap-3 p-4 sm:grid-cols-3" data-testid="promo-create" onSubmit={(event) => { event.preventDefault(); createPromo(); }}>
        <input className="nb-input h-10" placeholder="Name" value={created.name} onChange={(e) => setCreated({ ...created, name: e.target.value })} data-testid="promo-create-name" />
        <input className="nb-input h-10" placeholder="Code" value={created.code} onChange={(e) => setCreated({ ...created, code: e.target.value })} data-testid="promo-create-code" />
        <select className="nb-input h-10" value={created.type} onChange={(e) => setCreated({ ...created, type: e.target.value })} data-testid="promo-create-type"><option value="percent">Percent</option><option value="fixed">Fixed amount</option></select>
        <input className="nb-input h-10" type="number" value={created.value} onChange={(e) => setCreated({ ...created, value: e.target.value })} data-testid="promo-create-value" />
        <input className="nb-input h-10" type="date" value={created.start} onChange={(e) => setCreated({ ...created, start: e.target.value })} data-testid="promo-create-start" />
        <input className="nb-input h-10" type="date" value={created.end} onChange={(e) => setCreated({ ...created, end: e.target.value })} data-testid="promo-create-end" />
        <button className="nb-btn-primary h-10 text-sm" data-testid="promo-create-save">Create draft promotion</button>
      </form>}
      <div className="grid gap-4 xl:grid-cols-2">{state.promotions.map((p) => <PromoCard key={p.id} p={p} />)}</div>
      <div>
        <SectionHead eyebrow="Gifting" title="Gift cards" />
        <Link to="/owner/giftcards" data-testid="giftcard-console-link" className="nb-card flex items-center gap-3 p-4 text-sm"><Gift className="h-5 w-5 text-nb-teal" /><span className="flex-1">Gift cards now live in their own ledger-backed console: products, issuance, activation, redemption and voids.</span><span className="font-semibold text-nb-blue">Open</span></Link>
        
      </div>
    </div>
  );
}
