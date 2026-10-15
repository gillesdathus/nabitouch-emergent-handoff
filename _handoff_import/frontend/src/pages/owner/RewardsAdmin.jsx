import { useEffect, useState } from "react";
import { toast } from "sonner";
import { useDemo } from "@/store/DemoStore";

export default function RewardsAdmin() {
  const { api } = useDemo();
  const [row, setRow] = useState(null);
  const [editing, setEditing] = useState(false);
  const [baseline, setBaseline] = useState(null);

  useEffect(() => {
    api.rewardsSettings().then(setRow).catch((error) => toast.error(error?.response?.data?.detail || "Rewards settings could not be loaded"));
  }, [api]);

  const save = async (event) => {
    event.preventDefault();
    try {
      const saved = await api.saveRewardsSettings({ ...row, activationAuthorized: false, taxTreatmentConfirmed: false, nabidermEnabled: false });
      setRow(saved);
      setEditing(false);
      toast.success("Thresholds saved. Rewards stay off.");
    } catch (error) {
      toast.error(error?.response?.data?.detail || "Rewards were not changed");
    }
  };

  if (!row) return null;
  return (
    <form onSubmit={save} className="mx-auto max-w-3xl px-5 py-8" data-testid="rewards-admin">
      <p className="nb-eyebrow">Rewards</p>
      <h1 className="text-2xl font-semibold">Incentives</h1>
      <p className="mt-2 text-sm text-nb-mute">Earning, redemption, referrals, and NabiDerm commerce are off. Proposed rates are stored for a later owner decision. Tax treatment is not confirmed, so these rates are not in effect.</p>
      {editing ? <div className="nb-card mt-6 grid gap-3 p-5 sm:grid-cols-2">
        <label className="text-xs text-nb-mute">Points per $1<input className="nb-input" type="number" value={row.rules.pointsPerDollar} onChange={(event) => setRow({ ...row, rules: { ...row.rules, pointsPerDollar: Number(event.target.value) } })} /></label>
        <label className="text-xs text-nb-mute">Points for $1 off<input className="nb-input" type="number" value={row.rules.pointsPerDollarValue} onChange={(event) => setRow({ ...row, rules: { ...row.rules, pointsPerDollarValue: Number(event.target.value) } })} /></label>
        <label className="text-xs text-nb-mute">Referrer points<input className="nb-input" type="number" value={row.rules.referrerPoints} onChange={(event) => setRow({ ...row, rules: { ...row.rules, referrerPoints: Number(event.target.value) } })} /></label>
        <label className="text-xs text-nb-mute">Welcome points<input className="nb-input" type="number" value={row.rules.welcomePoints} onChange={(event) => setRow({ ...row, rules: { ...row.rules, welcomePoints: Number(event.target.value) } })} /></label>
      </div> : <div className="nb-card mt-6 flex items-center justify-between gap-3 p-5 text-sm"><p className="text-nb-mute">{row.rules.pointsPerDollar} points per $1 · {row.rules.pointsPerDollarValue} points for $1 off · referrer {row.rules.referrerPoints} · welcome {row.rules.welcomePoints}</p><button type="button" className="nb-btn-ghost h-10 px-4 text-sm" data-testid="rewards-edit" onClick={() => { setBaseline(row); setEditing(true); }}>Edit</button></div>}
      <ul className="mt-4 space-y-2">
        {row.badges.map((badge) => (
          <li key={badge.id} className="nb-card p-4 text-sm">{badge.name} · {badge.active ? "Active" : "Off"}</li>
        ))}
      </ul>
      {editing && <div className="mt-4 flex gap-2"><button type="button" className="nb-btn-ghost h-11 px-4" onClick={() => { if (baseline) setRow(baseline); setEditing(false); }}>Cancel</button><button className="nb-btn-primary h-11 px-4" data-testid="rewards-save">Save draft rules</button></div>}
    </form>
  );
}
