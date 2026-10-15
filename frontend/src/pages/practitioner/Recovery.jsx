import { useEffect, useState } from "react";
import { toast } from "sonner";
import { useDemo } from "@/store/DemoStore";

export default function Recovery() {
  const { api } = useDemo();
  const [rows, setRows] = useState([]);
  const [preview, setPreview] = useState({});
  const [note, setNote] = useState("");

  const load = async () => {
    const body = await api.recoveryCases();
    const cases = body.cases || [];
    setRows(cases);
    setNote(body.notices?.recovery ? "" : "External recovery messages stay off. Offers are prepared in the app until the client confirms.");
    const next = {};
    await Promise.all(cases.map(async (row) => {
      try { next[row.id] = await api.recoveryCandidates(row.id); } catch { next[row.id] = null; }
    }));
    setPreview(next);
  };
  useEffect(() => { load().catch((error) => toast.error(error?.response?.data?.detail || "Recovery could not be loaded")); }, []); // eslint-disable-line

  const act = async (work, ok) => {
    try { await work(); toast.success(ok); await load(); }
    catch (error) { toast.error(error?.response?.data?.detail || "That action was not saved"); }
  };

  return (
    <div className="mx-auto max-w-4xl px-5 py-8" data-testid="recovery-panel">
      <p className="nb-eyebrow">Gap recovery</p>
      <h1 className="text-2xl font-semibold">Released appointments</h1>
      <p className="mt-2 text-sm text-nb-mute" data-testid="recovery-notice">{note}</p>
      <div className="mt-6 space-y-4">
        {rows.length === 0 && <p className="nb-card p-5 text-sm text-nb-mute" data-testid="recovery-empty">No cancelled visits are waiting for recovery.</p>}
        {rows.map((row) => (
          <article key={row.id} className="nb-card p-5" data-testid={`recovery-${row.id}`}>
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="font-semibold">{row.date} at {row.time} · {row.duration} min</p>
                <p className="text-sm text-nb-mute">{row.zoneName || "Mobile service area"} · {row.status}</p>
              </div>
              <p className="text-xs uppercase tracking-wide text-nb-mute">{row.ref}</p>
            </div>
            {preview[row.id] && (
              <div className="mt-3 text-sm" data-testid={`recovery-candidates-${row.id}`}>
                <p className="text-nb-mute">{preview[row.id].exclusiveActive ? "An exclusive offer is active. The next client is not contacted yet." : "No exclusive offer is active."} {preview[row.id].optedIn} clients opted into earlier openings.</p>
                <ul className="mt-2 space-y-1">
                  {(preview[row.id].suggested || []).map((item) => (
                    <li key={item.ref}>{item.ref} · {item.date} {item.time} · about {item.travelMin} min · {item.provider}</li>
                  ))}
                </ul>
              </div>
            )}
            <ul className="mt-3 space-y-2 text-sm">
              {(row.offers || []).map((offer) => (
                <li key={offer.id} className="flex flex-wrap items-center justify-between gap-2 rounded-2xl bg-sky-50 px-3 py-2">
                  <span>{offer.kind} · {offer.status}{offer.expiresAt ? ` · until ${offer.expiresAt}` : ""}{offer.travelMin != null ? ` · about ${offer.travelMin} min drive` : ""}</span>
                  {offer.status === "pending" && <button type="button" className="text-xs text-nb-blue" onClick={() => act(() => api.recoverySkip(row.id, offer.clientId), "Candidate skipped")}>Skip</button>}
                </li>
              ))}
            </ul>
            <div className="mt-4 flex flex-wrap gap-2">
              <button type="button" className="nb-btn-primary h-10 px-4 text-sm" data-testid={`recovery-offer-${row.id}`} onClick={() => act(() => api.recoveryExclusive(row.id), "Exclusive offer prepared in the app")}>Send exclusive offer</button>
              <button type="button" className="nb-btn-ghost h-10 px-4 text-sm" data-testid={`recovery-broadcast-${row.id}`} onClick={() => act(() => api.recoveryBroadcast(row.id), "Nearby clients prepared. No message was sent.")}>Broadcast to opted-in clients</button>
            </div>
          </article>
        ))}
      </div>
    </div>
  );
}
