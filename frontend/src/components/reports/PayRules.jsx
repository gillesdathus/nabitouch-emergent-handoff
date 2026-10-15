import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Percent, Timer } from "lucide-react";
import { Switch } from "@/components/ui/switch";
import { api, apiError } from "@/lib/api";

function RuleEditor({ rule, onChange, testid }) {
  const hourly = rule?.type === "hourly";
  return (
    <div className="flex flex-wrap items-center gap-2" data-testid={testid}>
      <div className="flex rounded-full bg-white p-1 ring-1 ring-sky-100">
        {[["commission", "Split", Percent], ["hourly", "Hourly", Timer]].map(([t, l, I]) => (
          <button key={t} type="button" onClick={() => onChange(t === "hourly" ? { type: "hourly", hourlyCents: rule?.hourlyCents || 4500 } : { type: "commission", practitionerPct: rule?.practitionerPct ?? 70 })} data-testid={`${testid}-${t}`}
            className={`flex items-center gap-1 rounded-full px-3 py-1.5 text-xs font-medium transition-colors ${(hourly ? "hourly" : "commission") === t ? "bg-nb-navy text-white" : "text-nb-mute"}`}><I className="h-3 w-3" />{l}</button>
        ))}
      </div>
      {hourly
        ? <label className="flex items-center gap-1 text-sm">$<input type="number" min="1" step="0.5" className="nb-input h-9 w-24" value={(rule.hourlyCents || 0) / 100} onChange={(e) => onChange({ type: "hourly", hourlyCents: Math.round(Number(e.target.value) * 100) })} data-testid={`${testid}-rate`} />/h</label>
        : <label className="flex items-center gap-1 text-sm"><input type="number" min="0" max="100" className="nb-input h-9 w-20" value={rule?.practitionerPct ?? 70} onChange={(e) => onChange({ type: "commission", practitionerPct: Number(e.target.value) })} data-testid={`${testid}-pct`} />% practitioner · {100 - Number(rule?.practitionerPct ?? 70)}% Nabitouch</label>}
    </div>
  );
}

export function PayRules({ practitioners }) {
  const [rules, setRules] = useState(null);
  useEffect(() => { api.payRules().then(setRules).catch((e) => toast.error(apiError(e))); }, []);
  if (!rules) return <div className="h-48 rounded-3xl nb-skeleton" />;
  const save = async () => { try { setRules(await api.savePayRules(rules)); toast.success("Pay rules saved"); } catch (e) { toast.error(apiError(e)); } };
  const setOverride = (pid, rule) => setRules({ ...rules, overrides: { ...rules.overrides, [pid]: rule } });
  const clearOverride = (pid) => { const next = { ...rules.overrides }; delete next[pid]; setRules({ ...rules, overrides: next }); };
  return (
    <section className="nb-card space-y-5 p-5" data-testid="pay-rules">
      <div><p className="nb-eyebrow">Pay rules</p><p className="mt-1 text-sm text-nb-mute">Commission is calculated on treatment and enhancements after discounts, before GST.</p></div>
      <div className="rounded-2xl p-4 tint-ice"><p className="mb-2 text-sm font-semibold">Default for everyone</p><RuleEditor rule={rules.default} onChange={(r) => setRules({ ...rules, default: r })} testid="pay-rule-default" /></div>
      <label className="flex items-center justify-between rounded-2xl bg-slate-50 px-4 py-3 text-sm"><span>Include travel fees in the commission base</span><Switch checked={Boolean(rules.includeTravel)} onCheckedChange={(v) => setRules({ ...rules, includeTravel: v })} data-testid="pay-rule-travel" /></label>
      <div className="space-y-2">
        <p className="text-sm font-semibold">Per practitioner</p>
        {practitioners.map((p) => (
          <div key={p.id} className="flex flex-wrap items-center justify-between gap-3 rounded-2xl bg-white p-3 ring-1 ring-sky-100" data-testid={`pay-rule-row-${p.id}`}>
            <span className="text-sm font-medium">{p.name}</span>
            {rules.overrides?.[p.id]
              ? <span className="flex flex-wrap items-center gap-2"><RuleEditor rule={rules.overrides[p.id]} onChange={(r) => setOverride(p.id, r)} testid={`pay-rule-${p.id}`} /><button type="button" onClick={() => clearOverride(p.id)} className="text-xs text-nb-mute underline" data-testid={`pay-rule-${p.id}-reset`}>Use default</button></span>
              : <button type="button" onClick={() => setOverride(p.id, { ...rules.default })} className="text-xs font-semibold text-nb-blue" data-testid={`pay-rule-${p.id}-custom`}>Uses default · customize</button>}
          </div>
        ))}
      </div>
      <button type="button" onClick={save} className="nb-btn-primary h-11 text-sm" data-testid="pay-rules-save">Save pay rules</button>
    </section>
  );
}
