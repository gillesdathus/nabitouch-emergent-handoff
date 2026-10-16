import { todayISO } from "@/lib/domain";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { Copy, HeartHandshake } from "lucide-react";
import { Avatar } from "@/components/ui-kit";

const DAY = 86400000;

export function RetentionNudges({ state, idx }) {
  const [shown, setShown] = useState(6);
  const rows = useMemo(() => {
    const today = todayISO();
    const by = {};
    for (const a of state.appointments || []) {
      if (!a.clientId || ["cancelled", "no_show"].includes(a.status)) continue;
      const r = (by[a.clientId] ||= { done: [], upcoming: false });
      if (a.date >= today && !["completed", "closed"].includes(a.status)) r.upcoming = true;
      else if (["completed", "closed", "processing"].includes(a.status)) r.done.push(a);
    }
    return Object.entries(by)
      .filter(([, r]) => r.done.length >= 2 && !r.upcoming)
      .map(([cid, r]) => { const last = r.done.sort((x, y) => y.date.localeCompare(x.date))[0]; return { client: idx.clients[cid], last, visits: r.done.length, days: Math.round((Date.now() - new Date(`${last.date}T12:00:00`)) / DAY) }; })
      .filter((r) => r.client && r.days >= 60)
      .sort((a, b) => b.visits - a.visits || b.days - a.days);
  }, [state.appointments, idx.clients]);
  const draft = (r) => {
    const svc = idx.services[r.last.serviceSlug]?.name || "massage";
    const pro = idx.practitioners[r.last.practitionerId]?.name?.split(" ")[0];
    const text = `Hi ${r.client.preferredName || r.client.firstName}, it's been a little while since your last ${svc}${pro ? ` with ${pro}` : ""}. Whenever you're ready for another moment of calm, you can book here: ${window.location.origin}/book. Warmly, Nabitouch`;
    navigator.clipboard?.writeText(text);
    toast.success("Invite draft copied. Nothing was sent.");
  };
  return (
    <section className="nb-card p-5" data-testid="retention-nudges">
      <div className="mb-4 flex items-center gap-3"><span className="grid h-10 w-10 place-items-center rounded-2xl tint-mint"><HeartHandshake className="h-5 w-5 text-nb-teal" /></span><div><p className="font-semibold">Regulars to welcome back</p><p className="text-xs text-nb-mute">2+ visits, nothing booked, last visit over 60 days ago</p></div><span className="ml-auto nb-num text-2xl font-semibold text-nb-navy" data-testid="retention-nudges-count">{rows.length}</span></div>
      {rows.length === 0 && <p className="text-sm text-nb-mute">Everyone loyal has something booked. Lovely.</p>}
      <ul className="space-y-2">
        {rows.slice(0, shown).map((r) => (
          <li key={r.client.id} className="flex items-center gap-3 rounded-2xl bg-white p-3 ring-1 ring-sky-100" data-testid={`nudge-${r.client.id}`}>
            <Avatar person={r.client} size={36} />
            <span className="min-w-0 flex-1 text-sm"><b>{r.client.firstName} {r.client.lastName}</b><span className="block text-xs text-nb-mute">{r.visits} visits · last {r.days} days ago · {idx.services[r.last.serviceSlug]?.name || ""}</span></span>
            <button type="button" onClick={() => draft(r)} className="nb-btn-ghost h-9 px-3 text-xs" data-testid={`nudge-${r.client.id}-draft`}><Copy className="h-3.5 w-3.5" />Invite draft</button>
          </li>
        ))}
      </ul>
      {rows.length > shown && <button type="button" onClick={() => setShown(shown + 6)} className="mt-3 text-xs font-semibold text-nb-blue" data-testid="retention-nudges-more">Show more</button>}
    </section>
  );
}
