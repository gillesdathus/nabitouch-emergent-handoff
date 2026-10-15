import { useEffect, useState } from "react";
import { Switch } from "@/components/ui/switch";
import { ZoneMap, SectionHead } from "@/components/ui-kit";
import { useDemo } from "@/store/DemoStore";
import { clinicBookable, staffActor } from "@/lib/domain";
import { dollarsToCents } from "@/lib/billing";

function ZoneRow({ z }) {
  const { run, api, user } = useDemo();
  const [editing, setEditing] = useState(false);
  const [f, setF] = useState({ radiusKm: z.radiusKm, fee: z.fee, perKm: z.perKm || 0 });
  const open = () => { setF({ radiusKm: z.radiusKm, fee: z.fee, perKm: z.perKm || 0 }); setEditing(true); };
  return (
    <div className="nb-card flex flex-wrap items-center gap-3 p-4" data-testid={`zone-row-${z.id}`}>
      <span className="h-4 w-4 rounded-full" style={{ background: z.color }} /><p className="min-w-[140px] flex-1 font-semibold">{z.name}</p>
      {editing ? (
        <>
          <label className="text-xs">Radius km <input type="number" value={f.radiusKm} onChange={(e) => setF({ ...f, radiusKm: Number(e.target.value) })} className="ml-1 h-9 w-20 rounded-xl border border-sky-200 px-2" data-testid={`zone-${z.id}-radius`} /></label>
          <label className="text-xs">Fee $ <input type="number" value={f.fee} onChange={(e) => setF({ ...f, fee: Number(e.target.value) })} className="ml-1 h-9 w-20 rounded-xl border border-sky-200 px-2" data-testid={`zone-${z.id}-fee`} /></label>
          <label className="text-xs">Per km $ <input type="number" value={f.perKm} onChange={(e) => setF({ ...f, perKm: Number(e.target.value) })} className="ml-1 h-9 w-20 rounded-xl border border-sky-200 px-2" data-testid={`zone-${z.id}-per-km`} /></label>
          <button type="button" onClick={() => setEditing(false)} className="nb-btn-ghost h-9 px-4 text-xs" data-testid={`zone-${z.id}-cancel`}>Cancel</button>
          <button type="button" onClick={() => run(() => api.patch("zones", z.id, { ...f, _audit: `Zone ${z.name}: ${f.radiusKm} km / $${f.fee}`, _actor: staffActor(user) }), "Zone saved").then(() => setEditing(false))} data-testid={`zone-${z.id}-save`} className="nb-btn-primary h-9 px-4 text-xs">Save</button>
        </>
      ) : (
        <>
          <p className="text-sm text-nb-mute" data-testid={`zone-${z.id}-summary`}>{z.radiusKm} km · Fee ${z.fee} · ${z.perKm || 0} per km</p>
          <button type="button" onClick={open} className="nb-btn-ghost h-9 px-4 text-xs" data-testid={`zone-${z.id}-edit`}>Edit</button>
        </>
      )}
      <Switch checked={z.enabled} onCheckedChange={(v) => run(() => api.patch("zones", z.id, { enabled: v }))} data-testid={`zone-${z.id}-enabled`} />
    </div>
  );
}

export default function Zones() {
  const { state, idx, run, api, user } = useDemo();
  const st = idx.settings;
  const policy = st.paymentPolicy || { mode: "choice", depositType: "percent", depositPercent: 25, depositCents: 0, cashAccepted: true };
  const scheduling = st.scheduling || {};
  const clinic = st.clinic || {};
  const shownAddress = clinicBookable(clinic) || (clinic.address && !String(clinic.address).includes("[")) ? clinic.address : "";
  const [gst, setGst] = useState(st.gst * 100);
  const [address, setAddress] = useState(shownAddress);
  const [mode, setMode] = useState(policy.mode);
  const [depositType, setDepositType] = useState(policy.depositType || "percent");
  const [depositPercent, setDepositPercent] = useState(policy.depositPercent ?? 25);
  const [depositAmount, setDepositAmount] = useState(((policy.depositCents || 0) / 100).toFixed(2));
  const [insurers, setInsurers] = useState([]);
  const [editing, setEditing] = useState("");
  const save = (patch, msg) => run(() => api.patch("settings", "app", { ...patch, _audit: msg, _actor: staffActor(user) }), "Settings saved");
  const finish = (patch, msg) => save(patch, msg).then(() => setEditing(""));
  useEffect(() => { api.insurers().then((body) => setInsurers(body.providers || [])).catch(() => setInsurers([])); }, [api]);
  const saveAddress = () => finish({ clinic: { ...clinic, address: address.trim(), enabled: false } }, "Clinic address saved without enabling bookings");
  const savePolicy = () => {
    const fixed = dollarsToCents(depositAmount);
    finish({
      paymentPolicy: {
        mode, depositType, depositPercent: Number(depositPercent) || 0, depositCents: fixed || 0, cashAccepted: !!policy.cashAccepted,
      },
      cashEnabled: !!policy.cashAccepted,
    }, "Payment policy saved");
  };
  const policyLabel = { full: "Full online payment required", deposit: "Deposit required", choice: "Customer chooses full payment or deposit" };
  return (
    <div className="space-y-6" data-testid="owner-zones">
      <SectionHead eyebrow="Mobile operations" title="Service zones & travel fees" />
      <ZoneMap zones={state.zones} height={300} pins={state.appointments.slice(0, 12).map((a) => a.address)} />
      <div className="space-y-3">{state.zones.map((z) => <ZoneRow key={z.id} z={z} />)}</div>
      <SectionHead eyebrow="Service locations" title="Mobile is on. In-clinic stays off until you activate it." className="mt-10" />
      <div className="grid gap-4 md:grid-cols-2">
        <label className="nb-card flex items-center justify-between p-4 text-sm"><span><b>Mobile visits</b><span className="block text-xs text-nb-mute">Zones, travel fees, and the buffers below</span></span><Switch checked={clinic.mobileEnabled !== false} onCheckedChange={(v) => save({ clinic: { ...clinic, address: shownAddress, enabled: clinicBookable(clinic), mobileEnabled: v } }, `Mobile visits ${v ? "enabled" : "disabled"}`)} data-testid="settings-mobile-switch" /></label>
        <div className="nb-card p-4 text-sm" data-testid="settings-scheduling">
          <b>Scheduling buffers</b>
          <p className="text-xs text-nb-mute">Setup {scheduling.setupMin ?? 0} min · cleanup {scheduling.cleanupMin ?? 0} min · travel buffer {scheduling.travelBufferMin ?? 0} min · lead time {scheduling.leadMin ?? 0} min</p>
        </div>
        <div className="nb-card space-y-3 p-4 text-sm md:col-span-2">
          <b>In-clinic address</b>
          <p className="text-xs text-nb-mute">Saving an address does not turn clinic booking on.</p>
          {editing === "address" ? (
            <>
              <input value={address} onChange={(e) => setAddress(e.target.value)} className="nb-input" placeholder="Street address" data-testid="settings-clinic-address" />
              <div className="flex gap-2">
                <button type="button" onClick={() => { setAddress(shownAddress); setEditing(""); }} className="nb-btn-ghost h-9 px-4 text-xs">Cancel</button>
                <button type="button" onClick={saveAddress} data-testid="settings-clinic-address-save" className="nb-btn-ghost h-9 px-4 text-xs">Save address</button>
              </div>
            </>
          ) : (
            <div className="flex items-center justify-between gap-3">
              <p data-testid="settings-clinic-address">{shownAddress || "No street address saved"}</p>
              <button type="button" onClick={() => { setAddress(shownAddress); setEditing("address"); }} className="nb-btn-ghost h-9 px-4 text-xs" data-testid="settings-clinic-address-edit">Edit</button>
            </div>
          )}
        </div>
        <label className="nb-card flex items-center justify-between p-4 text-sm"><span><b>Activate in-clinic booking</b><span className="block text-xs text-nb-mute">{clinicBookable(clinic) ? clinic.address : "Needs a real street address first"}</span></span><Switch checked={clinic.enabled === true && clinicBookable(clinic)} onCheckedChange={(v) => save({ clinic: { ...clinic, address: address.trim(), enabled: v } }, `In-clinic ${v ? "enabled" : "disabled"}`)} data-testid="settings-clinic-switch" /></label>
      </div>
      <SectionHead eyebrow="Payments" title="What the customer pays now" className="mt-10" />
      <div className="grid gap-4 md:grid-cols-2">
        <label className="nb-card flex items-center justify-between p-4 text-sm"><span><b>Accept cash</b><span className="block text-xs text-nb-mute">Cash is recorded at the visit. It is not a prepayment.</span></span><Switch checked={!!policy.cashAccepted} onCheckedChange={(v) => save({ cashEnabled: v, paymentPolicy: { ...policy, cashAccepted: v } }, `Cash ${v ? "accepted" : "turned off"}`)} data-testid="settings-cash-switch" /></label>
        <div className="nb-card space-y-3 p-4 text-sm" data-testid="settings-payment-policy">
          <b>Online payment</b>
          {editing !== "payment" && (
            <div className="flex items-center justify-between gap-3">
              <p data-testid="settings-payment-summary">{policyLabel[policy.mode] || "Customer chooses full payment or deposit"}{policy.mode !== "full" ? ` · ${policy.depositType === "fixed" ? `$${(policy.depositCents || 0) / 100}` : `${policy.depositPercent ?? 25}%`}` : ""}</p>
              <button type="button" className="nb-btn-ghost h-9 px-4 text-xs" data-testid="settings-payment-edit" onClick={() => { setMode(policy.mode); setDepositType(policy.depositType || "percent"); setDepositPercent(policy.depositPercent ?? 25); setDepositAmount(((policy.depositCents || 0) / 100).toFixed(2)); setEditing("payment"); }}>Edit</button>
            </div>
          )}
          {editing === "payment" && <>
          <select value={mode} onChange={(e) => setMode(e.target.value)} className="nb-input" data-testid="settings-payment-mode" aria-label="Payment policy">
            <option value="full">Full online payment required</option>
            <option value="deposit">Deposit required</option>
            <option value="choice">Customer chooses full payment or deposit</option>
          </select>
          <select value={depositType} onChange={(e) => setDepositType(e.target.value)} className="nb-input" data-testid="settings-deposit-type" aria-label="Deposit type">
            <option value="percent">Percentage of the booking total</option>
            <option value="fixed">Fixed CAD amount</option>
          </select>
          {depositType === "fixed" ? <input value={depositAmount} onChange={(e) => setDepositAmount(e.target.value)} className="nb-input" data-testid="settings-deposit-amount" aria-label="Deposit amount" /> : <input type="number" value={depositPercent} onChange={(e) => setDepositPercent(e.target.value)} className="nb-input" data-testid="settings-deposit-percent" aria-label="Deposit percent" />}
          <div className="flex gap-2">
            <button type="button" onClick={() => setEditing("")} className="nb-btn-ghost h-9 px-4 text-xs">Cancel</button>
            <button type="button" onClick={savePolicy} data-testid="settings-payment-save" className="nb-btn-primary h-9 px-4 text-xs">Save payment policy</button>
          </div>
          </>}
          <p className="text-xs text-nb-mute">The server calculates the deposit from the booking total. Cash stays unpaid until it is recorded at the visit.</p>
        </div>
        <div className="nb-card flex items-center gap-3 p-4 text-sm"><span className="flex-1"><b>GST rate</b><span className="block text-xs text-nb-mute">Confirm tax treatment with your accountant</span></span>{editing === "gst" ? <><input type="number" value={gst} onChange={(e) => setGst(e.target.value)} className="h-9 w-20 rounded-xl border border-sky-200 px-2" data-testid="settings-gst-input" /><button type="button" onClick={() => { setGst(st.gst * 100); setEditing(""); }} className="nb-btn-ghost h-9 px-4 text-xs">Cancel</button><button onClick={() => finish({ gst: Number(gst) / 100 }, `GST set to ${gst}%`)} data-testid="settings-gst-save" className="nb-btn-primary h-9 px-4 text-xs">Save</button></> : <><span data-testid="settings-gst-value">{st.gst * 100}%</span><button type="button" onClick={() => { setGst(st.gst * 100); setEditing("gst"); }} className="nb-btn-ghost h-9 px-4 text-xs" data-testid="settings-gst-edit">Edit</button></>}</div>
        <div className="nb-card p-4 text-sm"><b>Enhancements</b>{st.addons.map((a) => <p key={a.id} className="text-xs text-nb-mute">{a.name} · ${a.price}</p>)}</div>
      </div>
      <section className="nb-card mt-6 p-5" data-testid="cancellation-fee">
        <p className="font-semibold">Cancellation policy</p>
        <p className="mt-1 text-sm text-nb-mute">Off. No-show fee off. Automatic collection off. No notice penalty. No fee applies to visits already booked.</p>
        <p className="mt-2 text-sm">We understand that plans can change. If you need to cancel or reschedule your massage appointment, please contact Nabitouch as soon as possible. We currently do not charge an automatic cancellation fee.</p>
      </section>
      <SectionHead eyebrow="Insurance integrations" title="Not connected" className="mt-10" />
      <div className="space-y-3" data-testid="insurance-integrations">
        {(insurers.length ? insurers : [
          { id: "telus-eclaims", name: "TELUS Health eClaims" },
          { id: "alberta-blue-cross", name: "Alberta Blue Cross" },
          { id: "sun-life", name: "Sun Life" },
          { id: "canada-life", name: "Canada Life" },
        ]).map((item) => (
          <div key={item.id} className="nb-card p-4 text-sm" data-testid={`insurer-${item.id}`}>
            <b>{item.name}</b>
            <p className="text-xs text-nb-mute">{item.message || "Not connected — awaiting insurer API access and credentials."}</p>
            <p className="text-xs text-nb-mute">Credentials configured: no · Last connection test: none · Activation: off</p>
          </div>
        ))}
      </div>
    </div>
  );
}
