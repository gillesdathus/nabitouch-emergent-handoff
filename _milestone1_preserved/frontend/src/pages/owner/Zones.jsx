import { useState } from "react";
import { MapPinned, Pencil, Receipt, ScrollText, Banknote, Plus, Undo2, Trash2, Check } from "lucide-react";
import { usePreview } from "@/store/PreviewStore";
import { PageHeader, BottomSheet, Field, Notice, Reveal, SectionHead, Stepper, Pill, cx } from "@/components/ui-kit";
import { MapView } from "@/components/MapView";
import { TopIcons } from "@/components/shells";
import { money0 } from "@/lib/domain";
import { zoneCoords, hasMapbox } from "@/lib/geo";

const COLORS = ["#1565F0", "#12C9EF", "#14D8C4", "#0E9E9A", "#7BC74D", "#0B2E8A"];

function ZoneEditor({ open, onOpenChange }) {
  const { db, api } = usePreview();
  const [step, setStep] = useState(0);
  const [pts, setPts] = useState([]);
  const [f, setF] = useState({ name: "", color: COLORS[0], fee: 20 });
  const ok = [pts.length >= 3, f.name.trim(), true][step];
  const save = async () => {
    await api.create("zones", { id: `z${Date.now()}`, name: f.name, color: f.color, fee: +f.fee, coords: pts, draft: true }, "Draft zone added — not saved to server");
    setStep(0); setPts([]); setF({ name: "", color: COLORS[0], fee: 20 }); onOpenChange(false);
  };
  return (
    <BottomSheet open={open} onOpenChange={onOpenChange} title="New service zone" testid="zone-editor" full
      footer={<div className="flex gap-2">{step > 0 && <button data-testid="ze-back" onClick={() => setStep(step - 1)} className="nb-btn-ghost h-12">Back</button>}<button data-testid="ze-next" disabled={!ok} onClick={() => (step === 2 ? save() : setStep(step + 1))} className="nb-btn-primary flex-1">{step === 2 ? "Save draft zone" : "Continue"}</button></div>}>
      <div className="mb-5"><Stepper steps={["Draw area", "Details", "Review"]} current={step} testid="ze-stepper" /></div>
      {step === 0 && (
        <>
          <MapView className="h-[44vh] rounded-3xl" zones={db.zones.map((z) => ({ ...z, coords: zoneCoords(z) }))} draft={pts} markers={pts.map((p, i) => ({ id: `v${i}`, kind: "me", lngLat: p }))} onMapClick={(p) => setPts((x) => [...x, p])} testid="ze-map" />
          <div className="flex items-center justify-between mt-3"><p className="text-sm text-nb-mute"><span className="font-semibold text-nb-ink nb-num">{pts.length}</span> points · tap the map to add</p><div className="flex gap-2"><button data-testid="ze-undo" onClick={() => setPts((x) => x.slice(0, -1))} className="nb-btn-ghost h-10 px-3"><Undo2 className="h-4 w-4" /></button><button data-testid="ze-clear" onClick={() => setPts([])} className="nb-btn-ghost h-10 px-3"><Trash2 className="h-4 w-4" /></button></div></div>
          {!hasMapbox && <Notice className="mt-3">Drawing needs the interactive Mapbox map. Add a public token to enable it.</Notice>}
        </>
      )}
      {step === 1 && (
        <>
          <Field label="Zone name"><input data-testid="ze-name" className="nb-input" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="e.g. St. Albert" /></Field>
          <p className="nb-label">Colour</p>
          <div className="flex gap-2 mb-4">{COLORS.map((c) => <button key={c} data-testid={`ze-color-${c.slice(1)}`} onClick={() => setF({ ...f, color: c })} className={cx("h-10 w-10 rounded-full grid place-items-center transition-transform", f.color === c && "scale-110 ring-4 ring-offset-2 ring-sky-100")} style={{ background: c }}>{f.color === c && <Check className="h-4 w-4 text-white" />}</button>)}</div>
          <Field label="Travel fee ($)" hint="Shown separately from treatment at checkout. GST applies."><input data-testid="ze-fee" type="number" min={0} className="nb-input" value={f.fee} onChange={(e) => setF({ ...f, fee: e.target.value })} /></Field>
        </>
      )}
      {step === 2 && (
        <div className="space-y-3">
          <MapView className="h-56 rounded-3xl" zones={[{ id: "new", color: f.color, coords: pts, active: true }]} fit={pts} testid="ze-review-map" />
          <div className="rounded-3xl ring-1 ring-sky-100 divide-y divide-sky-100 text-sm">{[["Name", f.name], ["Travel fee", money0(f.fee)], ["Boundary", `${pts.length} points`]].map(([k, v]) => <div key={k} className="flex justify-between px-4 py-3"><span className="text-nb-mute">{k}</span><span className="font-medium">{v}</span></div>)}</div>
          <Notice>Preview only: saved as a local draft. The real save calls the zone update endpoint.</Notice>
        </div>
      )}
    </BottomSheet>
  );
}

export default function Zones() {
  const { db, api } = usePreview();
  const [sel, setSel] = useState(null);
  const [edit, setEdit] = useState(null);
  const [fee, setFee] = useState(0);
  const [biz, setBiz] = useState(null);
  const [draw, setDraw] = useState(false);
  const z = db.zones.find((x) => x.id === edit);
  const zones = db.zones.map((x) => ({ ...x, coords: zoneCoords(x), active: x.id === sel }));
  return (
    <div className="max-w-6xl mx-auto px-5 pt-12 lg:pt-14">
      <PageHeader eyebrow="Manage" title="Zones & settings" sub="Coverage, travel fees and business policies" right={<TopIcons base="/owner" />} />
      <div className="flex justify-end mb-3"><button data-testid="new-zone-btn" onClick={() => setDraw(true)} className="nb-btn-primary h-11 text-sm"><Plus className="h-4 w-4" />New zone</button></div>
      <div className="grid lg:grid-cols-[1.3fr_1fr] gap-5">
        <MapView className="h-80 lg:h-[480px] rounded-[28px]" zones={zones} fit={sel ? zones.find((x) => x.id === sel).coords : undefined} testid="zones-map" />
        <div className="space-y-2">
          {db.zones.map((x, i) => (
            <Reveal key={x.id} i={i}>
              <div data-testid={`zone-row-${x.id}`} onClick={() => setSel(x.id)} className={cx("nb-card p-4 flex items-center gap-3 cursor-pointer transition-shadow", sel === x.id && "ring-2 ring-nb-blue/40")}>
                <span className="h-10 w-10 rounded-2xl grid place-items-center" style={{ background: `${x.color}22`, color: x.color }}><MapPinned className="h-5 w-5" /></span>
                <div className="flex-1"><p className="font-semibold text-sm flex items-center gap-2">{x.name}{x.draft && <Pill>Draft</Pill>}</p><p className="text-xs text-nb-mute">Travel fee {x.fee ? money0(x.fee) : "none"}</p></div>
                <button data-testid={`zone-edit-${x.id}`} onClick={(e) => { e.stopPropagation(); setEdit(x.id); setFee(x.fee); }} className="h-10 w-10 grid place-items-center rounded-full bg-sky-50 text-nb-blue"><Pencil className="h-4 w-4" /></button>
              </div>
            </Reveal>
          ))}
        </div>
      </div>
      <SectionHead title="Business settings" className="mt-8" />
      <div className="grid sm:grid-cols-3 gap-3">
        {[["gst", Receipt, "GST", "5% on treatment and travel"], ["payment", Banknote, "Payment policy", db.settings.paymentPolicy], ["cancel", ScrollText, "Cancellation policy", db.settings.cancellation]].map(([k, I, t, v]) => (
          <button key={k} data-testid={`setting-${k}`} onClick={() => k !== "gst" && setBiz(k)} className="nb-card p-4 text-left"><I className="h-5 w-5 text-nb-teal" /><p className="font-semibold text-sm mt-2">{t}</p><p className="text-xs text-nb-mute mt-1 line-clamp-2">{v}</p></button>
        ))}
      </div>
      <ZoneEditor open={draw} onOpenChange={setDraw} />
      <BottomSheet open={!!z} onOpenChange={(o) => !o && setEdit(null)} title={z ? `${z.name} zone` : ""} testid="zone-sheet" footer={<button data-testid="zone-save" onClick={async () => { await api.save("zones", z.id, { fee: +fee }, "Zone updated"); setEdit(null); }} className="nb-btn-primary w-full">Save zone</button>}>
        <Field label="Travel fee ($)" hint="Shown separately from the treatment price at checkout."><input data-testid="zone-fee-input" type="number" min={0} className="nb-input" value={fee} onChange={(e) => setFee(e.target.value)} /></Field>
      </BottomSheet>
      <BottomSheet open={!!biz} onOpenChange={(o) => !o && setBiz(null)} title={biz === "cancel" ? "Cancellation policy" : "Payment policy"} testid="biz-sheet" footer={<button data-testid="biz-save" onClick={async () => { const v = document.getElementById("biz-text").value; await api.settings(biz === "cancel" ? { cancellation: v } : { paymentPolicy: v }, "Settings saved"); setBiz(null); }} className="nb-btn-primary w-full">Save</button>}>
        <textarea id="biz-text" data-testid="biz-text" rows={4} className="nb-input h-auto py-3" defaultValue={biz === "cancel" ? db.settings.cancellation : db.settings.paymentPolicy} />
      </BottomSheet>
    </div>
  );
}
