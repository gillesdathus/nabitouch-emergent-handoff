import { useCallback, useEffect, useState } from "react";
import { Lock, Pencil } from "lucide-react";
import { RatingForm, StarDisplay } from "@/components/reviews/Reviews";
import { PageHeader } from "@/components/tide";
import { api } from "@/lib/api";
import { fmtDate } from "@/lib/domain";
import { useDemo } from "@/store/DemoStore";

function clientName(idx, id) {
  const c = idx.clients[id];
  return c ? `${c.preferredName || c.firstName} ${c.lastName || ""}`.trim() : "Client";
}

export function ClientRatingCard({ appt }) {
  const [data, setData] = useState(null);
  const [editing, setEditing] = useState(false);
  const load = useCallback(() => api.myClientRatings().then(setData).catch(() => {}), []);
  useEffect(() => { load(); }, [load]);
  if (!data) return null;
  const row = data.ratings.find((r) => r.appointmentId === appt.id);
  const eligible = data.eligible.some((a) => a.id === appt.id);
  if (!row && !eligible) return null;
  return (
    <div className="nb-card space-y-3 p-5" data-testid="visit-client-rating">
      <p className="flex items-center gap-2 text-sm font-semibold"><Lock className="h-4 w-4 text-nb-blue" />Rate this client visit</p>
      <p className="text-xs text-nb-mute">Private. Visible only to you and the owner, never to the client.</p>
      {row && !editing ? (
        <div><StarDisplay value={row.rating} testid="visit-client-rating-stars" />{row.comment && <p className="mt-2 text-sm">“{row.comment}”</p>}
          {row.editable && <button type="button" onClick={() => setEditing(true)} className="mt-2 inline-flex items-center gap-1 text-xs font-semibold text-nb-blue" data-testid="visit-client-rating-edit"><Pencil className="h-3.5 w-3.5" />Edit once</button>}</div>
      ) : (
        <RatingForm initial={row} submitLabel={row ? "Save my one edit" : "Save private rating"} placeholder="Punctuality, communication, environment (optional)"
          save={(body) => (row ? api.editClientRating(row.id, body) : api.rateClient({ ...body, appointmentId: appt.id }))} onSaved={() => { setEditing(false); load(); }} testid="visit-client-rating-form" />
      )}
    </div>
  );
}

export default function ClientRatings() {
  const { idx } = useDemo();
  const [data, setData] = useState(null);
  const [open, setOpen] = useState(null);
  const load = useCallback(() => api.myClientRatings().then(setData).catch(() => setData({ ratings: [], eligible: [] })), []);
  useEffect(() => { load(); }, [load]);
  return (
    <div className="mx-auto max-w-3xl space-y-6" data-testid="pro-client-ratings">
      <PageHeader eyebrow="Practitioner" title="Client ratings" sub="Private notes on completed visits. Only you and the owner can see them." />
      {!data ? <div className="nb-card h-32 animate-pulse" /> : (
        <>
          <section className="space-y-3"><p className="nb-label">Completed visits to rate</p>
            {data.eligible.length ? data.eligible.map((a) => (
              <div key={a.id} className="nb-card p-4" data-testid={`pro-rate-eligible-${a.id}`}>
                <div className="flex flex-wrap items-center justify-between gap-2"><div><p className="text-sm font-semibold">{clientName(idx, a.clientId)}</p><p className="text-xs text-nb-mute">{a.ref} · {fmtDate(a.date)} · {idx.services[a.serviceSlug]?.name}</p></div>
                  {open !== a.id && <button type="button" onClick={() => setOpen(a.id)} className="nb-btn-ghost h-10 px-4 text-sm" data-testid={`pro-rate-open-${a.id}`}>Rate</button>}</div>
                {open === a.id && <div className="mt-3"><RatingForm submitLabel="Save private rating" placeholder="Punctuality, communication, environment (optional)" save={(body) => api.rateClient({ ...body, appointmentId: a.id })} onSaved={() => { setOpen(null); load(); }} testid={`pro-rate-form-${a.id}`} /></div>}
              </div>)) : <p className="text-sm text-nb-mute" data-testid="pro-rate-eligible-empty">Every completed visit has a rating.</p>}
          </section>
          <section className="space-y-3"><p className="nb-label">Your ratings</p>
            {data.ratings.map((r) => (
              <div key={r.id} className="nb-card flex flex-wrap items-center gap-3 p-4" data-testid={`pro-rating-${r.id}`}>
                <div className="min-w-0 flex-1"><p className="text-sm font-semibold">{clientName(idx, r.clientId)} · {fmtDate(r.apptDate)}</p>{r.comment && <p className="text-xs text-nb-mute">“{r.comment}”</p>}</div>
                <StarDisplay value={r.rating} />
              </div>))}
          </section>
        </>
      )}
    </div>
  );
}
