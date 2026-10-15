import { useState } from "react";
import { Plus, Gift, Percent, Lock, Award } from "lucide-react";
import { usePreview } from "@/store/PreviewStore";
import { PageHeader, Segmented, BottomSheet, Field, Notice, Pill, Reveal } from "@/components/ui-kit";
import { Switch } from "@/components/ui/switch";
import { TopIcons } from "@/components/shells";
import { money0 } from "@/lib/domain";

export default function Promotions() {
  const { db, api } = usePreview();
  const [tab, setTab] = useState("promos");
  const [open, setOpen] = useState(false);
  const [f, setF] = useState({ name: "", kind: "" });
  const [rw, setRw] = useState(db.settings.rewards);
  return (
    <div className="max-w-5xl mx-auto px-5 pt-12 lg:pt-14">
      <PageHeader eyebrow="Growth" title="Promotions & rewards" right={<TopIcons base="/owner" />} />
      <Segmented testid="promo-tabs" value={tab} onChange={setTab} options={[{ value: "promos", label: "Promotions" }, { value: "gift", label: "Gift cards" }, { value: "rewards", label: "Rewards" }]} className="mb-5" />
      {tab === "promos" && (<>
        <div className="flex justify-end mb-3"><button data-testid="new-promo-btn" onClick={() => setOpen(true)} className="nb-btn-primary h-11 text-sm"><Plus className="h-4 w-4" />New promotion</button></div>
        <div className="grid sm:grid-cols-2 gap-3">
          {db.promotions.map((p, i) => (
            <Reveal key={p.id} i={i}>
              <div data-testid={`promo-card-${p.id}`} className="nb-card p-4 flex items-center gap-3">
                <span className="h-12 w-12 rounded-2xl tint-lagoon grid place-items-center text-nb-blue"><Percent className="h-5 w-5" /></span>
                <div className="flex-1"><p className="font-semibold text-sm">{p.name}</p><p className="text-xs text-nb-mute">{p.kind} · {p.uses} uses{p.seeded ? " · seeded" : ""}</p></div>
                <Switch data-testid={`promo-toggle-${p.id}`} checked={p.enabled} onCheckedChange={(v) => api.save("promotions", p.id, { enabled: v }, v ? "Promotion enabled" : "Promotion disabled")} />
              </div>
            </Reveal>
          ))}
        </div>
      </>)}
      {tab === "gift" && (<>
        <div className="grid sm:grid-cols-2 gap-4">
          {db.giftCards.map((g, i) => (
            <Reveal key={g.id} i={i}>
              <div data-testid={`gift-card-${g.id}`} className="relative overflow-hidden rounded-[28px] nb-gradient text-white p-5 h-44 flex flex-col">
                <div className="absolute -right-6 -top-6 h-32 w-32 rounded-full bg-white/15" />
                <div className="flex justify-between"><Gift className="h-6 w-6" /><img src="/brand/emblem.png" alt="" className="h-7 brightness-0 invert" /></div>
                <p className="mt-auto text-3xl font-semibold nb-num">{money0(g.balance)} <span className="text-sm font-normal text-white/70">of {money0(g.value)}</span></p>
                <p className="text-xs text-white/80 nb-num">{g.code} · {g.holder}</p>
              </div>
            </Reveal>
          ))}
        </div>
        <button data-testid="issue-gift-disabled" disabled className="nb-btn-ghost w-full mt-4"><Lock className="h-4 w-4" />Issue gift card</button>
        <Notice className="mt-3">Issuing new gift cards is not enabled. Existing cards are listed for reference.</Notice>
      </>)}
      {tab === "rewards" && (
        <div className="max-w-lg">
          <div className="rounded-3xl tint-meadow p-5 flex items-center gap-3 mb-4"><Award className="h-6 w-6 text-[#4E9A2B]" /><div className="flex-1"><p className="font-semibold">Rewards programme</p><p className="text-xs text-nb-mute">Earning stays off until you authorize it</p></div><Pill>Not authorized</Pill></div>
          <Field label="Points per dollar"><input data-testid="rw-points" type="number" className="nb-input" value={rw.pointsPerDollar} onChange={(e) => setRw({ ...rw, pointsPerDollar: +e.target.value })} /></Field>
          <Field label="Reward threshold (points)"><input data-testid="rw-threshold" type="number" className="nb-input" value={rw.threshold} onChange={(e) => setRw({ ...rw, threshold: +e.target.value })} /></Field>
          <Field label="Reward"><input data-testid="rw-reward" className="nb-input" value={rw.reward} onChange={(e) => setRw({ ...rw, reward: e.target.value })} /></Field>
          <button data-testid="rw-save" onClick={() => api.settings({ rewards: rw }, "Thresholds saved — programme still off")} className="nb-btn-primary w-full">Save thresholds</button>
        </div>
      )}
      <BottomSheet open={open} onOpenChange={setOpen} title="New promotion" sub="Created as a disabled draft" testid="promo-sheet" footer={<button data-testid="promo-submit" disabled={!f.name || !f.kind} onClick={async () => { await api.create("promotions", { id: `pr${Date.now()}`, ...f, enabled: false, eligibility: "all", uses: 0 }, "Draft promotion created"); setOpen(false); setF({ name: "", kind: "" }); }} className="nb-btn-primary w-full">Create draft</button>}>
        <Field label="Name"><input data-testid="promo-name" className="nb-input" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
        <Field label="Offer"><input data-testid="promo-kind" className="nb-input" placeholder="e.g. 15% off 90-minute visits" value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value })} /></Field>
        <Notice>“First online booking” eligibility is reserved for the seeded welcome offer.</Notice>
      </BottomSheet>
    </div>
  );
}
