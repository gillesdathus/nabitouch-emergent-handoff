import { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { useDemo } from "@/store/DemoStore";
import { todayISO } from "@/lib/domain";
import { apiError } from "@/lib/api";

export function CreateInvoiceDialog({ open, onClose, clientId }) {
  const { state, idx, api, run } = useDemo();
  const first = state.services[0];
  const [f, setF] = useState({
    clientId: clientId || "",
    practitionerId: "",
    serviceDate: todayISO(),
    serviceSlug: first?.slug || "",
    duration: Number(Object.keys(first?.prices || { 60: 0 })[0] || 60),
    quantity: 1,
    discount: "",
    notes: "",
    query: "",
  });
  const [hits, setHits] = useState([]);
  const [err, setErr] = useState("");
  const service = idx.services[f.serviceSlug];
  const unit = Number(service?.prices?.[f.duration] || service?.prices?.[String(f.duration)] || 0);

  useEffect(() => {
    if (!open || f.query.trim().length < 2) { setHits([]); return undefined; }
    let live = true;
    const handle = setTimeout(() => {
      api.searchClients(f.query).then((body) => { if (live) setHits(body.clients || []); }).catch(() => { if (live) setHits([]); });
    }, 250);
    return () => { live = false; clearTimeout(handle); };
  }, [api, f.query, open]);

  const save = async () => {
    setErr("");
    try {
      const invoice = await run(() => api.createInvoice({
        clientId: f.clientId,
        practitionerId: f.practitionerId || null,
        serviceDate: f.serviceDate,
        notes: f.notes,
        discount: f.discount ? Number(f.discount) : 0,
        idempotencyKey: `manual-${f.clientId}-${f.serviceDate}-${f.serviceSlug}-${Date.now()}`,
        lines: [{
          serviceSlug: f.serviceSlug,
          duration: Number(f.duration),
          quantity: Number(f.quantity) || 1,
          unitPrice: unit,
          description: service?.name,
        }],
      }), "Draft invoice created");
      onClose(invoice);
    } catch (error) {
      setErr(apiError(error));
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto rounded-3xl sm:max-w-lg" data-testid="create-invoice-dialog">
        <DialogTitle>Create invoice</DialogTitle>
        <p className="text-sm text-nb-mute">Standalone invoice. It does not require an appointment and does not mark a treatment complete.</p>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="sm:col-span-2"><span className="nb-label">Find patient</span><input className="nb-input" value={f.query} onChange={(e) => setF({ ...f, query: e.target.value })} data-testid="inv-client-search" /></label>
          <label className="sm:col-span-2"><span className="nb-label">Patient</span>
            <select className="nb-input" value={f.clientId} onChange={(e) => setF({ ...f, clientId: e.target.value })} data-testid="inv-client-select">
              <option value="">Select…</option>
              {(hits.length ? hits : state.clients).map((x) => <option key={x.id} value={x.id}>{x.firstName} {x.lastName}</option>)}
            </select>
          </label>
          <label><span className="nb-label">Service</span><select className="nb-input" value={f.serviceSlug} onChange={(e) => setF({ ...f, serviceSlug: e.target.value, duration: Number(Object.keys(idx.services[e.target.value].prices || { 60: 0 })[0]) })} data-testid="inv-service-select">{state.services.map((x) => <option key={x.slug} value={x.slug}>{x.name}</option>)}</select></label>
          <label><span className="nb-label">Duration</span><select className="nb-input" value={f.duration} onChange={(e) => setF({ ...f, duration: Number(e.target.value) })} data-testid="inv-duration-select">{Object.keys(service?.prices || {}).map((d) => <option key={d} value={d}>{d} min</option>)}</select></label>
          <label><span className="nb-label">Quantity</span><input type="number" min="1" className="nb-input" value={f.quantity} onChange={(e) => setF({ ...f, quantity: e.target.value })} data-testid="inv-qty-input" /></label>
          <label><span className="nb-label">Service date</span><input type="date" className="nb-input" value={f.serviceDate} onChange={(e) => setF({ ...f, serviceDate: e.target.value })} data-testid="inv-date-input" /></label>
          <label className="sm:col-span-2"><span className="nb-label">Practitioner (optional)</span><select className="nb-input" value={f.practitionerId} onChange={(e) => setF({ ...f, practitionerId: e.target.value })} data-testid="inv-pract-select"><option value="">Unassigned</option>{state.practitioners.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select></label>
          <label><span className="nb-label">Discount ($)</span><input className="nb-input" value={f.discount} onChange={(e) => setF({ ...f, discount: e.target.value })} data-testid="inv-discount-input" /></label>
          <label className="sm:col-span-2"><span className="nb-label">Notes</span><textarea className="nb-input min-h-[72px]" value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} data-testid="inv-notes-input" /></label>
        </div>
        <p className="text-sm text-nb-mute">Line total before tax: ${(unit * (Number(f.quantity) || 1)).toFixed(2)}. Catalogue price is snapshotted on the draft.</p>
        {err && <p className="text-sm text-rose-700" data-testid="inv-error">{err}</p>}
        <button type="button" disabled={!f.clientId || !f.serviceSlug} onClick={save} className="nb-btn-primary w-full" data-testid="inv-save-btn">Create draft invoice</button>
      </DialogContent>
    </Dialog>
  );
}
