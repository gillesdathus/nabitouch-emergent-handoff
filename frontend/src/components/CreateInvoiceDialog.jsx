import { useEffect, useId, useRef, useState } from "react";
import { Loader2 } from "lucide-react";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { useDemo } from "@/store/DemoStore";
import { fullName, todayISO } from "@/lib/domain";
import { apiError } from "@/lib/api";

const MIN_QUERY = 2;

function patientSecondary(client) {
  return [client?.email, client?.phone].filter(Boolean).join(" · ");
}

function PatientSelector({
  open,
  selected,
  onSelect,
  onClear,
  searchApi,
}) {
  const listId = useId();
  const inputRef = useRef(null);
  const focusAfterClear = useRef(false);
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState([]);
  const [dupIds, setDupIds] = useState(() => new Set());
  const [loading, setLoading] = useState(false);
  const [searchErr, setSearchErr] = useState("");
  const [active, setActive] = useState(-1);
  const [listOpen, setListOpen] = useState(false);
  const [retryTick, setRetryTick] = useState(0);

  useEffect(() => {
    if (!open || selected) {
      setQuery("");
      setHits([]);
      setListOpen(false);
      setSearchErr("");
      setActive(-1);
    }
  }, [open, selected]);

  useEffect(() => {
    if (!selected && focusAfterClear.current) {
      focusAfterClear.current = false;
      inputRef.current?.focus();
    }
  }, [selected]);

  useEffect(() => {
    if (!open || selected) {
      setLoading(false);
      return undefined;
    }
    const needle = query.trim();
    if (needle.length < MIN_QUERY) {
      setHits([]);
      setDupIds(new Set());
      setLoading(false);
      setSearchErr("");
      setActive(-1);
      return undefined;
    }
    let live = true;
    setLoading(true);
    setSearchErr("");
    setListOpen(true);
    const handle = setTimeout(() => {
      searchApi(needle)
        .then((body) => {
          if (!live) return;
          const clients = body.clients || [];
          setHits(clients);
          const dups = new Set();
          for (const row of body.duplicates || []) {
            if (row.clientId) dups.add(row.clientId);
            for (const id of row.matches || []) dups.add(id);
          }
          setDupIds(dups);
          setActive(clients.length ? 0 : -1);
          setLoading(false);
        })
        .catch((error) => {
          if (!live) return;
          setHits([]);
          setDupIds(new Set());
          setActive(-1);
          setSearchErr(apiError(error) || "Search failed");
          setLoading(false);
        });
    }, 250);
    return () => { live = false; clearTimeout(handle); };
  }, [open, query, selected, searchApi, retryTick]);

  const pick = (client) => {
    if (!client?.id) return;
    onSelect(client);
    setQuery("");
    setHits([]);
    setListOpen(false);
    setActive(-1);
    setSearchErr("");
  };

  const onKeyDown = (e) => {
    if (!listOpen && (e.key === "ArrowDown" || e.key === "ArrowUp") && hits.length) {
      setListOpen(true);
    }
    if (e.key === "Escape") {
      setListOpen(false);
      setActive(-1);
      return;
    }
    if (!hits.length) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setListOpen(true);
      setActive((i) => (i + 1) % hits.length);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setListOpen(true);
      setActive((i) => (i <= 0 ? hits.length - 1 : i - 1));
    } else if (e.key === "Enter" && active >= 0 && hits[active]) {
      e.preventDefault();
      pick(hits[active]);
    }
  };

  if (selected) {
    const secondary = patientSecondary(selected);
    return (
      <div className="sm:col-span-2" data-testid="inv-patient-selected">
        <span className="nb-label">Patient</span>
        <div className="mt-1 flex items-center justify-between gap-3 rounded-2xl border border-sky-100 bg-sky-50/50 px-4 py-3">
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold text-nb-ink" data-testid="inv-patient-name">{fullName(selected)}</p>
            {secondary ? <p className="truncate text-xs text-nb-mute" data-testid="inv-patient-secondary">{secondary}</p> : null}
          </div>
          <button
            type="button"
            className="nb-btn-ghost h-10 shrink-0 px-3 text-sm"
            data-testid="inv-patient-change"
            onClick={() => {
              focusAfterClear.current = true;
              setQuery("");
              setHits([]);
              setListOpen(false);
              onClear();
            }}
          >
            Change
          </button>
        </div>
      </div>
    );
  }

  const showList = listOpen && query.trim().length >= MIN_QUERY;
  const activeId = active >= 0 && hits[active] ? `${listId}-opt-${hits[active].id}` : undefined;

  return (
    <div className="sm:col-span-2" data-testid="inv-patient-selector">
      <label className="block">
        <span className="nb-label">Patient</span>
        <div className="relative mt-1">
          <input
            ref={inputRef}
            className="nb-input pr-10"
            value={query}
            onChange={(e) => { setQuery(e.target.value); setListOpen(true); }}
            onFocus={() => { if (query.trim().length >= MIN_QUERY) setListOpen(true); }}
            onKeyDown={onKeyDown}
            placeholder="Name, phone, or email"
            role="combobox"
            aria-expanded={showList}
            aria-controls={listId}
            aria-autocomplete="list"
            aria-activedescendant={activeId}
            autoComplete="off"
            data-testid="inv-client-search"
          />
          {loading ? (
            <Loader2 className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 animate-spin text-nb-mute" aria-hidden data-testid="inv-patient-loading" />
          ) : null}
        </div>
      </label>
      {showList ? (
        <div
          id={listId}
          role="listbox"
          aria-label="Matching patients"
          className="mt-2 rounded-2xl border border-sky-100 bg-white"
          data-testid="inv-patient-results"
        >
          {loading && !hits.length && !searchErr ? (
            <p className="px-4 py-3 text-sm text-nb-mute" data-testid="inv-patient-searching">Searching…</p>
          ) : null}
          {searchErr ? (
            <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-3" data-testid="inv-patient-error">
              <p className="text-sm text-rose-700">{searchErr}</p>
              <button
                type="button"
                className="nb-btn-ghost h-9 px-3 text-sm"
                data-testid="inv-patient-retry"
                onClick={() => setRetryTick((n) => n + 1)}
              >
                Retry
              </button>
            </div>
          ) : null}
          {!loading && !searchErr && hits.length === 0 ? (
            <p className="px-4 py-3 text-sm text-nb-mute" data-testid="inv-patient-empty">No matching patient found</p>
          ) : null}
          <ul className="divide-y divide-sky-50">
            {hits.map((client, i) => {
              const secondary = patientSecondary(client);
              const isDup = dupIds.has(client.id);
              const isActive = i === active;
              return (
                <li key={client.id}>
                  <button
                    type="button"
                    id={`${listId}-opt-${client.id}`}
                    role="option"
                    aria-selected={isActive}
                    data-testid={`inv-patient-option-${client.id}`}
                    onMouseEnter={() => setActive(i)}
                    onClick={() => pick(client)}
                    className={`flex min-h-12 w-full flex-col items-start gap-0.5 px-4 py-3 text-left ${isActive ? "bg-sky-50" : "hover:bg-sky-50/70"}`}
                  >
                    <span className="text-sm font-medium text-nb-ink">{fullName(client)}</span>
                    {(secondary || isDup) ? (
                      <span className="text-xs text-nb-mute">
                        {secondary}
                        {isDup ? `${secondary ? " · " : ""}Possible duplicate` : ""}
                      </span>
                    ) : null}
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      ) : null}
      {query.trim().length > 0 && query.trim().length < MIN_QUERY ? (
        <p className="mt-1 text-xs text-nb-mute">Type at least {MIN_QUERY} characters to search</p>
      ) : null}
    </div>
  );
}

export function CreateInvoiceDialog({ open, onClose, clientId }) {
  const { state, idx, api, run } = useDemo();
  const first = state.services[0];
  const seeded = clientId ? (idx.clients?.[clientId] || state.clients.find((c) => c.id === clientId) || null) : null;
  const [f, setF] = useState({
    clientId: clientId || "",
    practitionerId: "",
    serviceDate: todayISO(),
    serviceSlug: first?.slug || "",
    duration: Number(Object.keys(first?.prices || { 60: 0 })[0] || 60),
    quantity: 1,
    discount: "",
    notes: "",
  });
  const [selected, setSelected] = useState(seeded);
  const [err, setErr] = useState("");
  const service = idx.services[f.serviceSlug];
  const unit = Number(service?.prices?.[f.duration] || service?.prices?.[String(f.duration)] || 0);

  useEffect(() => {
    if (!open) return;
    const next = clientId ? (idx.clients?.[clientId] || state.clients.find((c) => c.id === clientId) || null) : null;
    setSelected(next);
    setF((prev) => ({
      ...prev,
      clientId: clientId || "",
      serviceDate: todayISO(),
      serviceSlug: first?.slug || prev.serviceSlug,
      duration: Number(Object.keys(first?.prices || { 60: 0 })[0] || prev.duration || 60),
      quantity: 1,
      discount: "",
      notes: "",
      practitionerId: "",
    }));
    setErr("");
    // Reset only when the dialog opens or the seeded patient changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentional open/clientId gate
  }, [open, clientId]);

  const save = async () => {
    setErr("");
    if (!f.clientId) {
      setErr("Select a patient before creating the invoice.");
      return;
    }
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
          <PatientSelector
            open={open}
            selected={selected}
            searchApi={api.searchClients}
            onSelect={(client) => {
              setSelected(client);
              setF((prev) => ({ ...prev, clientId: client.id }));
            }}
            onClear={() => {
              setSelected(null);
              setF((prev) => ({ ...prev, clientId: "" }));
            }}
          />
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
