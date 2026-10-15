import { useEffect, useState } from "react";
import { toast } from "sonner";
import { useDemo } from "@/store/DemoStore";

export default function Rewards() {
  const { api } = useDemo();
  const [row, setRow] = useState(null);
  const [code, setCode] = useState("");

  const load = async () => setRow(await api.rewardsMe());
  useEffect(() => { load().catch((error) => toast.error(error?.response?.data?.detail || "Rewards could not be loaded")); }, []); // eslint-disable-line

  const apply = async (event) => {
    event.preventDefault();
    try {
      await api.attributeReferral(code);
      toast.success("Referral saved. A bonus is not awarded until the programme is on and the first paid visit is complete.");
      setCode("");
      await load();
    } catch (error) {
      toast.error(error?.response?.data?.detail || "That referral cannot be applied");
    }
  };
  const copy = async () => {
    const path = `${window.location.origin}${row.sharePath}`;
    try { await navigator.clipboard.writeText(path); toast.success("Link copied"); }
    catch { toast.message(path); }
  };

  if (!row) return <div className="mx-auto max-w-3xl px-5 py-8 text-sm text-nb-mute">Loading rewards…</div>;
  return (
    <div className="mx-auto max-w-3xl px-5 py-8" data-testid="rewards-dashboard">
      <p className="nb-eyebrow">Rewards</p>
      <h1 className="text-3xl font-semibold tracking-tight">Nabitouch <span className="font-display font-normal italic nb-gradient-text">Rewards</span></h1>
      <p className="mt-2 text-sm text-nb-mute" data-testid="rewards-status">{row.active ? "Rewards are active." : "Rewards are prepared and not active. Points are not earned or spent yet."}</p>
      <div className="mt-6 grid gap-3 sm:grid-cols-2">
        <article className="rounded-3xl p-5 tint-meadow"><p className="text-sm text-nb-mute">Available</p><p className="nb-num text-4xl font-semibold" data-testid="rewards-balance">{row.balance}</p></article>
        <article className="nb-card p-5"><p className="text-sm text-nb-mute">Pending</p><p className="nb-num text-4xl font-semibold" data-testid="rewards-pending">{row.pending}</p></article>
      </div>
      {!row.active && <p className="mt-3 rounded-2xl bg-slate-100 px-3.5 py-3 text-[13px] text-nb-mute">The rewards programme is not switched on. Codes can be saved, and no bonus is awarded until the owner activates it.</p>}
      <article className="nb-card mt-4 p-5" data-testid="referral-card">
        <p className="font-semibold">Your referral code</p>
        <p className="mt-2 font-mono text-lg">{row.referralCode}</p>
        <button type="button" className="nb-btn-primary mt-3 h-10 px-4 text-sm" onClick={copy}>Copy share link</button>
        <p className="mt-3 text-sm text-nb-mute">{row.referrals?.qualified || 0} qualified referrals. Names are not shown.</p>
      </article>
      <form onSubmit={apply} className="nb-card mt-4 flex flex-wrap gap-2 p-5">
        <input className="nb-input min-w-[12rem] flex-1" aria-label="Friend code" value={code} onChange={(event) => setCode(event.target.value)} placeholder="Friend's code" />
        <button className="nb-btn-ghost h-12 px-4" data-testid="apply-referral">Apply</button>
      </form>
      <section className="mt-6">
        <h2 className="font-semibold">Badges</h2>
        <ul className="mt-2 space-y-2">
          {row.badges.map((badge) => (
            <li key={badge.id} className="nb-card p-4 text-sm" data-testid={`badge-${badge.id}`}>{badge.name} · {badge.earned ? "Earned" : badge.active ? "In progress" : "Not active"}{badge.perk ? ` · ${badge.perk}` : ""}</li>
          ))}
        </ul>
      </section>
      <section className="mt-6">
        <h2 className="font-semibold">History</h2>
        <ul className="mt-2 space-y-2">
          {row.history.length === 0 && <li className="text-sm text-nb-mute">No points transactions yet.</li>}
          {row.history.map((item) => <li key={item.id} className="nb-card p-4 text-sm">{item.label} · {item.points}</li>)}
        </ul>
      </section>
    </div>
  );
}
