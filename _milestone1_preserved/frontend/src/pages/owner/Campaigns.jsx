import { useState } from "react";
import { useSearchParams } from "react-router-dom";
import { AnimatePresence, motion } from "framer-motion";
import { Plus, Copy, Pause, Play, Zap, Megaphone, ArrowLeft, Eye } from "lucide-react";
import { usePreview } from "@/store/PreviewStore";
import { PageHeader, BottomSheet, Stepper, Field, Notice, Pill, Reveal, EmptyState, cx } from "@/components/ui-kit";
import { DayStrip } from "@/components/Calendar";
import { TopIcons } from "@/components/shells";
import { useCountdown } from "@/pages/public/Offers";
import { money, timeLabel, fmtDate, todayISO } from "@/lib/domain";

const TONE = { live: "bg-nb-turq/15 text-nb-teal ring-nb-turq/30", paused: "bg-sky-50 text-nb-blue ring-sky-200", draft: "bg-slate-100 text-nb-mute ring-slate-200", cancelled: "bg-nb-coral/10 text-nb-coral ring-nb-coral/25", archived: "bg-slate-100 text-nb-mute ring-slate-200" };

function CampaignCard({ c, i }) {
  const { svc, api } = usePreview();
  const left = useCountdown(c.expiresAt);
  const s = svc(c.serviceId);
  return (
    <Reveal i={i} className="nb-card overflow-hidden">
      <div data-testid={`campaign-card-${c.id}`}>
        <div className="relative h-28"><img src={s.img} alt="" className="absolute inset-0 h-full w-full object-cover" /><div className="absolute inset-0 bg-gradient-to-r from-nb-ink/80 to-transparent" /><div className="relative p-4 text-white"><Pill tone={TONE[c.status]}>{c.status}</Pill><p className="font-semibold mt-2">{c.name}</p><p className="text-xs text-white/70">{s.name} · −{c.discountPercent}%</p></div></div>
        <div className="p-4">
          <div className="grid grid-cols-3 text-center gap-2"><div><p className="font-semibold nb-num">{c.stats.views}</p><p className="text-[10.5px] text-nb-mute">Views</p></div><div><p className="font-semibold nb-num">{c.stats.bookings}</p><p className="text-[10.5px] text-nb-mute">Bookings</p></div><div><p className="font-semibold nb-num text-sm">{c.status === "live" ? left : "—"}</p><p className="text-[10.5px] text-nb-mute">Ends in</p></div></div>
          <p className="text-xs text-nb-mute mt-3">{fmtDate(c.bookingStart)} · {timeLabel(c.windowStart)}–{timeLabel(c.windowEnd)} · {c.audience}</p>
          <div className="flex gap-2 mt-3">
            {c.status === "live" && <button data-testid={`campaign-pause-${c.id}`} onClick={() => api.save("campaigns", c.id, { status: "paused" }, "Campaign paused")} className="nb-btn-ghost flex-1 h-10 text-sm"><Pause className="h-4 w-4" />Pause</button>}
            {(c.status === "paused" || c.status === "draft") && <button data-testid={`campaign-live-${c.id}`} onClick={() => api.save("campaigns", c.id, { status: "live" }, "Campaign is live in-app")} className="nb-btn-primary flex-1 h-10 text-sm"><Play className="h-4 w-4" />Go live</button>}
            <button data-testid={`campaign-dup-${c.id}`} onClick={() => api.create("campaigns", { ...c, id: `cp${Date.now()}`, name: `${c.name} (copy)`, status: "draft", stats: { views: 0, bookings: 0 } }, "Duplicated as draft")} className="nb-btn-ghost h-10 px-4"><Copy className="h-4 w-4" /></button>
          </div>
        </div>
      </div>
    </Reveal>
  );
}

function Wizard({ open, onOpenChange }) {
  const { db, svc, api } = usePreview();
  const [step, setStep] = useState(0);
  const [f, setF] = useState({ name: "", serviceId: "s1", discountPercent: 15, bookingStart: todayISO(), windowStart: "17:00", windowEnd: "20:00", hours: 6, audience: "Past clients" });
  const s = svc(f.serviceId);
  const ok = [f.name && f.discountPercent >= 1 && f.discountPercent <= 80, f.windowStart < f.windowEnd, true][step];
  const save = async () => {
    await api.create("campaigns", { id: `cp${Date.now()}`, ...f, discountPercent: +f.discountPercent, status: "draft", expiresAt: new Date(Date.now() + f.hours * 3600e3).toISOString(), stats: { views: 0, bookings: 0 } }, "Draft campaign saved");
    setStep(0); onOpenChange(false);
  };
  return (
    <BottomSheet open={open} onOpenChange={onOpenChange} title="Create campaign" testid="campaign-wizard" full
      footer={<div className="flex gap-2">{step > 0 && <button data-testid="wizard-back" onClick={() => setStep(step - 1)} className="nb-btn-ghost h-12 w-14 px-0"><ArrowLeft className="h-4 w-4" /></button>}<button data-testid="wizard-next" disabled={!ok} onClick={() => (step === 2 ? save() : setStep(step + 1))} className="nb-btn-primary flex-1">{step === 2 ? "Save as draft" : "Continue"}</button></div>}>
      <div className="mb-6"><Stepper steps={["Add content", "Add settings", "Preview & save"]} current={step} testid="campaign-stepper" /></div>
      <AnimatePresence mode="wait">
        <motion.div key={step} initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }} transition={{ duration: 0.2 }}>
          {step === 0 && (<>
            <Field label="Campaign name"><input data-testid="cw-name" className="nb-input" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="e.g. Friday wind-down" /></Field>
            <Field label="Service"><select data-testid="cw-service" className="nb-input" value={f.serviceId} onChange={(e) => setF({ ...f, serviceId: e.target.value })}>{db.services.filter((x) => x.published).map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select></Field>
            <Field label={`Discount · ${f.discountPercent}%`} hint="Between 1% and 80%"><input data-testid="cw-discount" type="range" min={1} max={80} value={f.discountPercent} onChange={(e) => setF({ ...f, discountPercent: +e.target.value })} className="w-full accent-[#1565F0]" /></Field>
          </>)}
          {step === 1 && (<>
            <p className="nb-label">Booking date</p>
            <DayStrip value={f.bookingStart} onChange={(d) => setF({ ...f, bookingStart: d })} start={todayISO()} testid="cw-day-strip" />
            <div className="grid grid-cols-2 gap-3 mt-4"><Field label="Window start"><input data-testid="cw-start" type="time" className="nb-input" value={f.windowStart} onChange={(e) => setF({ ...f, windowStart: e.target.value })} /></Field><Field label="Window end"><input data-testid="cw-end" type="time" className="nb-input" value={f.windowEnd} onChange={(e) => setF({ ...f, windowEnd: e.target.value })} /></Field></div>
            <Field label="Expires after (hours)"><input data-testid="cw-hours" type="number" min={1} className="nb-input" value={f.hours} onChange={(e) => setF({ ...f, hours: e.target.value })} /></Field>
            <Field label="Audience"><select data-testid="cw-audience" className="nb-input" value={f.audience} onChange={(e) => setF({ ...f, audience: e.target.value })}>{["Past clients", "All clients", "Runners", "Central zone"].map((x) => <option key={x}>{x}</option>)}</select></Field>
            <p className="text-xs text-nb-mute">Times are Edmonton local and converted to UTC on save.</p>
          </>)}
          {step === 2 && (<>
            <p className="font-semibold mb-2 flex items-center gap-2"><Eye className="h-4 w-4 text-nb-blue" />Client preview</p>
            <div className="rounded-3xl overflow-hidden ring-1 ring-sky-100">
              <div className="relative h-36"><img src={s.img} alt="" className="absolute inset-0 h-full w-full object-cover" /><span className="absolute top-3 left-3 rounded-full nb-lagoon text-white px-3 h-8 grid place-items-center font-display text-lg">−{f.discountPercent}%</span></div>
              <div className="p-4"><p className="font-semibold">{f.name}</p><p className="text-sm text-nb-mute">{s.name} · {money(s.price * (1 - f.discountPercent / 100))} <span className="line-through">{money(s.price)}</span></p><p className="text-center text-nb-blue font-semibold text-sm mt-3">Book now</p></div>
            </div>
            <div className="rounded-3xl ring-1 ring-sky-100 mt-4 divide-y divide-sky-100 text-sm">
              {[["Channel", "In-app offers"], ["Date", fmtDate(f.bookingStart)], ["Window", `${timeLabel(f.windowStart)}–${timeLabel(f.windowEnd)}`], ["Audience", f.audience], ["Expires", `in ${f.hours} h`]].map(([k, v]) => <div key={k} className="flex justify-between px-4 py-3"><span className="text-nb-mute">{k}</span><span className="font-medium">{v}</span></div>)}
            </div>
            <Notice className="mt-4" icon={Megaphone}>Promotional sending is off. The campaign is bookable in the app once live; no email or SMS is sent.</Notice>
          </>)}
        </motion.div>
      </AnimatePresence>
    </BottomSheet>
  );
}

export default function Campaigns() {
  const { db } = usePreview();
  const [sp] = useSearchParams();
  const [open, setOpen] = useState(!!sp.get("new"));
  const [f, setF] = useState("all");
  const list = db.campaigns.filter((c) => f === "all" || c.status === f);
  return (
    <div className="max-w-6xl mx-auto px-5 pt-12 lg:pt-14">
      <PageHeader eyebrow="Growth" title="Flash campaigns" sub="Fill last-minute openings with in-app offers" right={<TopIcons base="/owner" />} />
      <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
        <div className="flex gap-2 overflow-x-auto no-scrollbar">{["all", "live", "paused", "draft"].map((k) => <button key={k} data-testid={`campaign-filter-${k}`} onClick={() => setF(k)} className={cx(f === k ? "nb-chip-on" : "nb-chip-off", "capitalize")}>{k}</button>)}</div>
        <button data-testid="new-campaign-btn" onClick={() => setOpen(true)} className="nb-btn-primary h-11 text-sm"><Plus className="h-4 w-4" />New campaign</button>
      </div>
      {list.length === 0 ? <EmptyState icon={Zap} title="No campaigns here" /> : <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">{list.map((c, i) => <CampaignCard key={c.id} c={c} i={i} />)}</div>}
      <Wizard open={open} onOpenChange={setOpen} />
    </div>
  );
}
