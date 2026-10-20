import { useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { Package } from "lucide-react";
import { toast } from "sonner";
import { EmptyState, ModuleNavigation } from "@/components/tide";
import { TeamSearchField } from "@/components/team/TeamConnectUI";
import { api, apiError } from "@/lib/api";
import { OPEN } from "@/lib/domain";
import { teamNavFor, teamPath } from "@/lib/team-connect";
import { useDemo } from "@/store/DemoStore";

export default function TeamSupplies({ role = "pro" }) {
  const { state, practitionerId } = useDemo();
  const [params] = useSearchParams();
  const paramAppointment = params.get("appointmentId") || "";
  const [query, setQuery] = useState("");
  const [items, setItems] = useState([]);
  const [requests, setRequests] = useState([]);
  const [name, setName] = useState("");
  const [mainQty, setMainQty] = useState("0");
  const [reqItem, setReqItem] = useState("");
  const [reqQty, setReqQty] = useState("1");
  const [fulfillment, setFulfillment] = useState("next_client");
  const [appointmentId, setAppointmentId] = useState(paramAppointment);
  const [handoffNote, setHandoffNote] = useState("");
  const canAdjust = role === "owner" || role === "manager";

  useEffect(() => {
    if (paramAppointment) setAppointmentId(paramAppointment);
  }, [paramAppointment]);

  const visits = useMemo(() => {
    const rows = (state.appointments || []).filter((row) => OPEN.includes(row.status));
    if (role === "pro") return rows.filter((row) => row.practitionerId === practitionerId);
    return rows.slice(0, 40);
  }, [state.appointments, practitionerId, role]);

  const load = () => {
    api.teamSupplyItems?.(query).then((body) => setItems(body?.items || [])).catch(() => setItems([]));
    api.teamSupplyRequests?.().then((body) => setRequests(body?.requests || [])).catch(() => setRequests([]));
  };

  useEffect(() => { load(); }, [query]); // eslint-disable-line

  const createItem = async () => {
    try {
      await api.teamCreateSupplyItem({ name, mainQty: Number(mainQty) || 0, unit: "set" });
      setName("");
      setMainQty("0");
      toast.success("Item added");
      load();
    } catch (err) {
      toast.error(apiError(err));
    }
  };

  const requestStock = async () => {
    try {
      await api.teamCreateSupplyRequest({
        itemId: reqItem,
        qty: Number(reqQty) || 1,
        fulfillment,
        appointmentId: appointmentId || undefined,
        handoffNote: handoffNote || undefined,
        idempotencyKey: `${reqItem}:${appointmentId || "none"}:${Date.now()}`,
      });
      toast.success("Supply request sent");
      load();
    } catch (err) {
      toast.error(apiError(err));
    }
  };

  return (
    <div className="mx-auto max-w-3xl space-y-5" data-testid="team-supplies">
      <ModuleNavigation items={teamNavFor(role)} testid="team-module-nav" />
      <div>
        <p className="nb-eyebrow">{role === "owner" || role === "manager" ? "Operations" : "Team Connect"}</p>
        <h1 className="text-3xl font-semibold tracking-tight">Supplies</h1>
        <p className="mt-1 text-sm text-nb-mute">
          {canAdjust
            ? "Main stock, reserved, practitioner stock, and recipient confirmation. Managers can prepare handoffs."
            : "Request supplies and confirm what you actually received. Next-client handoff uses your linked visit."}
        </p>
      </div>

      <TeamSearchField value={query} onChange={setQuery} placeholder="Search product, SKU…" testid="team-supplies-search" />

      {canAdjust && (
        <div className="nb-card grid gap-2 p-4 sm:grid-cols-[1fr_6rem_auto]" data-testid="team-supplies-create">
          <input className="nb-input" placeholder="Item name (e.g. Clean linen set)" value={name} onChange={(e) => setName(e.target.value)} data-testid="team-supplies-name" />
          <input className="nb-input" type="number" value={mainQty} onChange={(e) => setMainQty(e.target.value)} data-testid="team-supplies-qty" />
          <button type="button" className="nb-btn-primary h-12" disabled={!name.trim()} onClick={createItem} data-testid="team-supplies-add">Add</button>
        </div>
      )}

      <div className="space-y-3" data-testid="team-supplies-items">
        {items.map((item) => {
          const main = (item.balances || []).find((b) => b.bucket === "main");
          const low = (main?.qty || 0) <= 2;
          return (
            <div key={item.id} className="nb-card flex items-center gap-3 p-4" data-testid={`team-supply-item-${item.id}`}>
              <div className="grid h-12 w-12 place-items-center rounded-2xl bg-sky-50"><Package className="h-5 w-5 text-nb-navy" /></div>
              <div className="min-w-0 flex-1">
                <p className="font-semibold">{item.name}</p>
                <p className="text-xs text-nb-mute">{item.sku ? `SKU ${item.sku}` : item.unit} · stock {main?.qty ?? 0} {item.unit}</p>
              </div>
              <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${low ? "bg-amber-50 text-amber-900" : "bg-teal-50 text-teal-800"}`}>
                {low ? "Low stock" : "In stock"}
              </span>
            </div>
          );
        })}
      </div>
      {items.length === 0 && <EmptyState icon={Package} title="No inventory items yet" body="Owner or Manager can add linen sets and oils. Practitioners request and confirm receipt." testid="team-supplies-empty" />}

      <div className="nb-card space-y-3 p-4" data-testid="team-supplies-request-box">
        <p className="font-semibold">Request supplies</p>
        <select className="nb-input" value={reqItem} onChange={(e) => setReqItem(e.target.value)} data-testid="team-supplies-req-item">
          <option value="">Choose item</option>
          {items.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
        </select>
        <div className="grid gap-2 sm:grid-cols-2">
          <input className="nb-input" type="number" value={reqQty} onChange={(e) => setReqQty(e.target.value)} data-testid="team-supplies-req-qty" />
          <select className="nb-input" value={fulfillment} onChange={(e) => setFulfillment(e.target.value)} data-testid="team-supplies-fulfillment">
            <option value="next_client">Next client location / nearby handoff</option>
            <option value="manager_delivery">Manager delivery</option>
            <option value="practitioner_pickup">Practitioner pickup</option>
            <option value="meeting_point">Agreed meeting point</option>
            <option value="appointment_area">Current appointment area</option>
          </select>
        </div>
        <label className="block text-sm">
          <span className="nb-label">Linked visit {fulfillment === "next_client" ? "(recommended)" : "(optional)"}</span>
          <select className="nb-input" value={appointmentId} onChange={(e) => setAppointmentId(e.target.value)} data-testid="team-supplies-appointment">
            <option value="">None</option>
            {visits.map((row) => (
              <option key={row.id} value={row.id}>{row.ref} · {row.date} {row.time}</option>
            ))}
          </select>
        </label>
        <input
          className="nb-input"
          placeholder="Handoff note (meeting point, vehicle, etc.)"
          value={handoffNote}
          onChange={(e) => setHandoffNote(e.target.value)}
          data-testid="team-supplies-handoff-note"
        />
        <button type="button" className="nb-btn-primary h-11 w-full" disabled={!reqItem} onClick={requestStock} data-testid="team-supplies-request">Submit request</button>
      </div>

      <section className="space-y-2">
        <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-nb-teal">Open requests</p>
        {requests.map((row) => (
          <div key={row.id} className="nb-card space-y-2 p-4 text-sm" data-testid={`team-supply-req-${row.id}`}>
            <div className="flex justify-between gap-2">
              <b>{row.itemName}</b>
              <span className="text-xs capitalize text-nb-mute">{row.status}</span>
            </div>
            <p className="text-xs text-nb-mute">Requested {row.qtyRequested} · prepared {row.qtyPrepared} · received {row.qtyReceived} · outstanding {row.qtyOutstanding}</p>
            <p className="text-xs text-nb-mute">
              Fulfillment: {String(row.fulfillment || "").replace(/_/g, " ")}
              {row.appointmentId ? ` · visit ${row.appointmentId}` : ""}
              {row.requesterName ? ` · ${row.requesterName}` : ""}
            </p>
            {row.handoffNote && <p className="text-xs text-nb-mute" data-testid={`team-supply-handoff-${row.id}`}>{row.handoffNote}</p>}
            {canAdjust && row.status === "new" && (
              <button type="button" className="nb-btn-ghost h-9 text-xs" onClick={() => api.teamPrepareSupply(row.id, { qtyPrepared: row.qtyRequested, fulfillment: row.fulfillment }).then(() => { toast.success("Prepared"); load(); }).catch((e) => toast.error(apiError(e)))} data-testid={`team-supply-prepare-${row.id}`}>Prepare full qty</button>
            )}
            {(row.status === "prepared" || row.status === "partial") && (
              <button type="button" className="nb-btn-primary h-9 text-xs" onClick={() => api.teamConfirmSupply(row.id, { qtyReceived: row.qtyPrepared }).then(() => { toast.success("Receipt confirmed"); load(); }).catch((e) => toast.error(apiError(e)))} data-testid={`team-supply-confirm-${row.id}`}>Confirm received {row.qtyPrepared}</button>
            )}
          </div>
        ))}
      </section>

      <Link to={teamPath(role)} className="block text-sm text-nb-mute">Back to Team Connect</Link>
    </div>
  );
}
