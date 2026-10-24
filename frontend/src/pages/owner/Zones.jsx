import { EtransferSettings } from "@/components/EtransferSettings";
import { WhatsAppSettings } from "@/components/WhatsAppSettings";
import { lazy, Suspense, useEffect, useMemo, useState } from "react";
import { Switch } from "@/components/ui/switch";
import { Confirm, ZoneMap, SectionHead } from "@/components/ui-kit";
import { useDemo } from "@/store/DemoStore";
import { AddressPicker } from "@/components/AddressPicker";
import { clinicBookable, clinicSavePayload, staffActor, OPEN } from "@/lib/domain";
import { dollarsToCents } from "@/lib/billing";
import { AddonsEditor, CancellationFeeEditor, CancellationPolicyEditor, ReminderDaysEditor, SchedulingEditor } from "@/components/settings/OwnerSettingsEditors";
import { MunicipalityCoverage } from "@/components/settings/MunicipalityCoverage";
import { DutyRosterPicker } from "@/components/team/DutyRosterPicker";

const ZoneStreetMap = lazy(() => import("@/components/maps/ZoneStreetMap"));
const HAS_MAPBOX = String(process.env.REACT_APP_MAPBOX_PUBLIC_TOKEN || "").startsWith("pk.");

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
  const [clinicQuery, setClinicQuery] = useState(shownAddress);
  const [clinicPick, setClinicPick] = useState(null);
  const [mode, setMode] = useState(policy.mode);
  const [depositType, setDepositType] = useState(policy.depositType || "percent");
  const [depositPercent, setDepositPercent] = useState(policy.depositPercent ?? 25);
  const [depositAmount, setDepositAmount] = useState(((policy.depositCents || 0) / 100).toFixed(2));
  const [insurers, setInsurers] = useState([]);
  const [editing, setEditing] = useState("");
  const coverage = st.serviceCoverage || { mode: "open", radiusKm: 25, travelFeesEnabled: false, municipalityIds: [], customMunicipalities: [] };
  const [coverageRadius, setCoverageRadius] = useState(coverage.radiusKm ?? 25);
  const [modeConfirm, setModeConfirm] = useState(null);
  const save = (patch, msg) => run(() => api.patch("settings", "app", { ...patch, _audit: msg, _actor: staffActor(user) }), "Settings saved");
  const finish = (patch, msg) => save(patch, msg).then(() => setEditing(""));
  useEffect(() => { api.insurers().then((body) => setInsurers(body.providers || [])).catch(() => setInsurers([])); }, [api]);
  useEffect(() => { setCoverageRadius(coverage.radiusKm ?? 25); }, [coverage.radiusKm]);
  const saveAddress = () => finish({ clinic: clinicSavePayload(clinic, clinicQuery || address, clinicPick) }, "Clinic address saved without enabling bookings");
  const savePolicy = () => {
    const fixed = dollarsToCents(depositAmount);
    finish({
      paymentPolicy: {
        mode, depositType, depositPercent: Number(depositPercent) || 0, depositCents: fixed || 0, cashAccepted: !!policy.cashAccepted,
      },
      cashEnabled: !!policy.cashAccepted,
    }, "Payment policy saved");
  };
  const pins = useMemo(() => state.appointments
    .filter((a) => OPEN.includes(a.status) && Number.isFinite(Number(a.address?.lat)) && Number.isFinite(Number(a.address?.lng)) && a.address?.clientConfirmed === true)
    .slice(0, 50)
    .map((a) => ({ lat: Number(a.address.lat), lng: Number(a.address.lng), label: `${a.ref} · ${a.date} ${a.time}`, color: idx.practitioners[a.practitionerId]?.color || "#1565F0" })), [state.appointments, idx.practitioners]);
  const policyLabel = { full: "Full online payment required", deposit: "Deposit required", choice: "Customer chooses full payment or deposit" };
  const saveCoverage = (patch) => {
    const next = {
      mode: patch.mode ?? coverage.mode ?? "open",
      radiusKm: Number(patch.radiusKm ?? coverageRadius) || 25,
      travelFeesEnabled: patch.travelFeesEnabled ?? !!coverage.travelFeesEnabled,
      municipalityIds: patch.municipalityIds ?? coverage.municipalityIds ?? [],
      customMunicipalities: patch.customMunicipalities ?? coverage.customMunicipalities ?? [],
    };
    setCoverageRadius(next.radiusKm);
    return save({ serviceCoverage: next }, "Service coverage saved");
  };
  const chooseMode = (nextMode) => {
    const current = coverage.mode || "open";
    if (nextMode === current) return;
    if (nextMode !== "open" && current === "open") {
      setModeConfirm({
        mode: nextMode,
        title: nextMode === "zones" ? "Switch to municipality / zone coverage?" : "Switch to radius coverage?",
        body: "This turns off open coverage. New bookings will be restricted. Existing appointments are not cancelled.",
      });
      return;
    }
    saveCoverage({ mode: nextMode });
  };
  return (
    <div className="space-y-6" data-testid="owner-zones">
      <SectionHead eyebrow="Booking" title="Service coverage" />
      <div className="nb-card space-y-3 p-4 text-sm" data-testid="settings-service-coverage">
        <p className="text-xs text-nb-mute">Controls which confirmed addresses can continue through booking. Open coverage is the default and is never changed silently.</p>
        <label>
          <span className="nb-label">Coverage mode</span>
          <select
            className="nb-input"
            value={coverage.mode || "open"}
            data-testid="settings-coverage-mode"
            onChange={(e) => chooseMode(e.target.value)}
          >
            <option value="open">Open coverage (default)</option>
            <option value="radius">Radius-based coverage</option>
            <option value="zones">Municipality / custom zones</option>
          </select>
        </label>
        {(coverage.mode || "open") === "radius" && (
          <label>
            <span className="nb-label">Coverage radius (km from service center)</span>
            <input
              type="number"
              min={1}
              max={200}
              className="nb-input"
              value={coverageRadius}
              data-testid="settings-coverage-radius"
              onChange={(e) => setCoverageRadius(Number(e.target.value))}
              onBlur={() => saveCoverage({ radiusKm: coverageRadius })}
            />
          </label>
        )}
        {(coverage.mode || "open") === "zones" && (
          <MunicipalityCoverage
            coverage={coverage}
            appointments={state.appointments}
            onSave={(patch) => saveCoverage(patch)}
          />
        )}
        <label className="flex items-center justify-between gap-3">
          <span><b>Travel fees</b><span className="block text-xs text-nb-mute">Off by default. When off, no travel fee is charged or shown on new bookings.</span></span>
          <Switch
            checked={!!coverage.travelFeesEnabled}
            onCheckedChange={(v) => saveCoverage({ travelFeesEnabled: v })}
            data-testid="settings-travel-fees-switch"
          />
        </label>
      </div>
      <Confirm
        open={!!modeConfirm}
        onOpenChange={(open) => !open && setModeConfirm(null)}
        title={modeConfirm?.title || ""}
        body={modeConfirm?.body || ""}
        confirmLabel="Switch mode"
        testid="settings-coverage-mode-confirm"
        onConfirm={() => {
          const next = modeConfirm?.mode;
          setModeConfirm(null);
          if (next) saveCoverage({ mode: next });
        }}
      />
      <SectionHead eyebrow="Mobile operations" title="Service zones & travel fees" className="mt-10" />
      {HAS_MAPBOX
        ? <Suspense fallback={<div className="nb-skeleton h-[340px] rounded-[var(--nb-r-lg)]" />}><ZoneStreetMap zones={state.zones} center={st.center} pins={pins} clinic={clinic.coordinatesVerified && clinic.lat ? { lat: clinic.lat, lng: clinic.lng, label: clinic.address } : null} /></Suspense>
        : <ZoneMap zones={state.zones} height={300} pins={pins} />}
      <p className="text-[11px] text-nb-mute">Pins show upcoming visits whose address the client confirmed. Rings apply when coverage mode is radius or custom zones. Practitioner locations appear only on the live fleet during an authorized trip.</p>
      <div className="space-y-3">{state.zones.map((z) => <ZoneRow key={z.id} z={z} />)}</div>
      <SectionHead eyebrow="Service locations" title="Mobile is on. In-clinic stays off until you activate it." className="mt-10" />
      <div className="grid gap-4 md:grid-cols-2">
        <label className="nb-card flex items-center justify-between p-4 text-sm"><span><b>Mobile visits</b><span className="block text-xs text-nb-mute">Zones, travel fees, and the buffers below</span></span><Switch checked={clinic.mobileEnabled !== false} onCheckedChange={(v) => save({ clinic: { ...clinic, address: shownAddress, enabled: clinicBookable(clinic), mobileEnabled: v } }, `Mobile visits ${v ? "enabled" : "disabled"}`)} data-testid="settings-mobile-switch" /></label>
        <SchedulingEditor scheduling={scheduling} />
        <div className="nb-card space-y-3 p-4 text-sm md:col-span-2">
          <b>In-clinic address</b>
          <p className="text-xs text-nb-mute">Saving an address does not turn clinic booking on. Choose a suggestion and confirm it before navigation coordinates are saved.</p>
          <p className="text-xs text-nb-mute" data-testid="settings-clinic-navigation">{clinic.coordinatesVerified ? "Navigation coordinates verified for this address." : shownAddress ? "Navigation is unavailable until this address is confirmed." : "No street address saved"}</p>
          {editing === "address" ? (
            <>
              <AddressPicker purpose="clinic" value={clinicPick} onChange={setClinicPick} query={clinicQuery} onQuery={setClinicQuery} testid="settings-clinic-address" />
              <div className="flex gap-2">
                <button type="button" onClick={() => { setAddress(shownAddress); setClinicQuery(shownAddress); setClinicPick(null); setEditing(""); }} className="nb-btn-ghost h-9 px-4 text-xs">Cancel</button>
                <button type="button" onClick={saveAddress} data-testid="settings-clinic-address-save" className="nb-btn-ghost h-9 px-4 text-xs">Save address</button>
              </div>
            </>
          ) : (
            <div className="flex items-center justify-between gap-3">
              <p data-testid="settings-clinic-address">{shownAddress || "No street address saved"}</p>
              <button type="button" onClick={() => { setAddress(shownAddress); setClinicQuery(shownAddress); setClinicPick(null); setEditing("address"); }} className="nb-btn-ghost h-9 px-4 text-xs" data-testid="settings-clinic-address-edit">Edit</button>
            </div>
          )}
        </div>
        <label className="nb-card flex items-center justify-between p-4 text-sm"><span><b>Activate in-clinic booking</b><span className="block text-xs text-nb-mute">{clinicBookable(clinic) ? clinic.address : "Needs a real street address first"}</span></span><Switch checked={clinic.enabled === true && clinicBookable(clinic)} onCheckedChange={(v) => save({ clinic: { ...clinic, address: address.trim(), enabled: v } }, `In-clinic ${v ? "enabled" : "disabled"}`)} data-testid="settings-clinic-switch" /></label>
      </div>
      <SectionHead eyebrow="Contact" title="WhatsApp on public pages" className="mt-10" />
      <div className="grid gap-4 md:grid-cols-2"><WhatsAppSettings settings={idx.settings} save={save} /></div>
      <SectionHead eyebrow="Payments" title="e-Transfer instructions" className="mt-10" />
      <div className="grid gap-4 md:grid-cols-2"><EtransferSettings /></div>
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
        <AddonsEditor addons={st.addons || []} />
      </div>
      <SectionHead eyebrow="Team Connect" title="On-duty assistance routing" className="mt-10" />
      <div className="nb-card space-y-3 p-4 text-sm" data-testid="settings-team-connect">
        <p className="text-xs text-nb-mute">Primary on-duty staff receive Quick Help first; backup is used after the server escalation window. This is not practitioner bookability.</p>
        <div className="grid gap-3 sm:grid-cols-2">
          <label>
            <span className="nb-label">Urgent ack (minutes)</span>
            <input
              type="number"
              className="nb-input"
              defaultValue={(st.teamConnect || {}).urgentAckMinutes ?? 3}
              data-testid="settings-tc-urgent"
              onBlur={(e) => save({ teamConnect: { ...(st.teamConnect || {}), urgentAckMinutes: Number(e.target.value) || 3, routineAckMinutes: (st.teamConnect || {}).routineAckMinutes ?? 15, dutyPrimaryUserIds: (st.teamConnect || {}).dutyPrimaryUserIds || [], dutyBackupUserIds: (st.teamConnect || {}).dutyBackupUserIds || [] } }, "Team Connect escalation saved")}
            />
          </label>
          <label>
            <span className="nb-label">Routine ack (minutes)</span>
            <input
              type="number"
              className="nb-input"
              defaultValue={(st.teamConnect || {}).routineAckMinutes ?? 15}
              data-testid="settings-tc-routine"
              onBlur={(e) => save({ teamConnect: { ...(st.teamConnect || {}), urgentAckMinutes: (st.teamConnect || {}).urgentAckMinutes ?? 3, routineAckMinutes: Number(e.target.value) || 15, dutyPrimaryUserIds: (st.teamConnect || {}).dutyPrimaryUserIds || [], dutyBackupUserIds: (st.teamConnect || {}).dutyBackupUserIds || [] } }, "Team Connect escalation saved")}
            />
          </label>
        </div>
        <DutyRosterPicker
          label="Primary on-duty staff"
          selectedIds={(st.teamConnect || {}).dutyPrimaryUserIds || []}
          excludeIds={(st.teamConnect || {}).dutyBackupUserIds || []}
          testid="settings-tc-primary"
          onChange={(ids) => save({
            teamConnect: {
              ...(st.teamConnect || {}),
              urgentAckMinutes: (st.teamConnect || {}).urgentAckMinutes ?? 3,
              routineAckMinutes: (st.teamConnect || {}).routineAckMinutes ?? 15,
              dutyPrimaryUserIds: ids,
              dutyBackupUserIds: ((st.teamConnect || {}).dutyBackupUserIds || []).filter((id) => !ids.includes(id)),
            },
          }, "Team Connect duty roster saved")}
        />
        <DutyRosterPicker
          label="Backup staff"
          selectedIds={(st.teamConnect || {}).dutyBackupUserIds || []}
          excludeIds={(st.teamConnect || {}).dutyPrimaryUserIds || []}
          testid="settings-tc-backup"
          onChange={(ids) => save({
            teamConnect: {
              ...(st.teamConnect || {}),
              urgentAckMinutes: (st.teamConnect || {}).urgentAckMinutes ?? 3,
              routineAckMinutes: (st.teamConnect || {}).routineAckMinutes ?? 15,
              dutyBackupUserIds: ids,
              dutyPrimaryUserIds: ((st.teamConnect || {}).dutyPrimaryUserIds || []).filter((id) => !ids.includes(id)),
            },
          }, "Team Connect backup roster saved")}
        />
      </div>
      <SectionHead eyebrow="Booking Protection" title="Insurance prepay (owner controlled)" className="mt-10" />
      <div className="nb-card space-y-3 p-4 text-sm" data-testid="settings-booking-protection">
        <p className="text-xs text-nb-mute">When enabled, insurance bookings can collect the configured prepay at checkout (requires card checkout). Self-pay deposits still follow Payment Policy.</p>
        <label className="flex items-center gap-2 text-xs">
          <input
            type="checkbox"
            checked={Boolean((st.bookingProtection || {}).insurancePrepayEnabled)}
            data-testid="settings-bp-insurance-enabled"
            onChange={(e) => save({ bookingProtection: { insurancePrepayMode: (st.bookingProtection || {}).insurancePrepayMode || "travel_only", selfPayDepositPercent: (st.bookingProtection || {}).selfPayDepositPercent ?? 25, insurancePrepayEnabled: e.target.checked } }, e.target.checked ? "Insurance prepay enabled" : "Insurance prepay disabled")}
          />
          Enable insurance prepay collection
        </label>
        <label>
          <span className="nb-label">Insurance prepay mode</span>
          <select
            className="nb-input"
            defaultValue={(st.bookingProtection || {}).insurancePrepayMode || "travel_only"}
            data-testid="settings-bp-insurance-mode"
            onChange={(e) => save({ bookingProtection: { ...(st.bookingProtection || {}), insurancePrepayMode: e.target.value, insurancePrepayEnabled: Boolean((st.bookingProtection || {}).insurancePrepayEnabled), selfPayDepositPercent: (st.bookingProtection || {}).selfPayDepositPercent ?? 25 } }, "Booking Protection settings saved")}
          >
            <option value="travel_only">Travel fee only (recommended)</option>
            <option value="higher_of">Higher of travel fee or treatment deposit</option>
            <option value="travel_plus_deposit">Travel fee plus treatment deposit</option>
            <option value="none">No upfront payment when explicitly allowed</option>
          </select>
        </label>
        <label>
          <span className="nb-label">Self-pay deposit percent</span>
          <input
            type="number"
            min={0}
            max={100}
            className="nb-input"
            defaultValue={(st.bookingProtection || {}).selfPayDepositPercent ?? 25}
            data-testid="settings-bp-deposit-percent"
            onBlur={(e) => {
              const pct = Math.max(0, Math.min(100, Number(e.target.value) || 0));
              save({
                bookingProtection: {
                  ...(st.bookingProtection || {}),
                  insurancePrepayEnabled: Boolean((st.bookingProtection || {}).insurancePrepayEnabled),
                  insurancePrepayMode: (st.bookingProtection || {}).insurancePrepayMode || "travel_only",
                  selfPayDepositPercent: pct,
                },
              }, "Self-pay deposit percent saved");
            }}
          />
          <p className="mt-1 text-[11px] text-nb-mute">Used for self-pay checkout deposits and insurance “higher of / plus deposit” modes. Staff-reviewed fees only — no auto-charge.</p>
        </label>
      </div>
      <SectionHead eyebrow="Flash Booking Protection" title="Grace windows for short-lead bookings" className="mt-10" />
      <div className="nb-card space-y-3 p-4 text-sm" data-testid="settings-flash-protection">
        <p className="text-xs text-nb-mute">When enabled, new bookings capture a grace deadline. Cancels inside the window assess $0; after that, staff-reviewed fees may apply. No automatic card charge.</p>
        <label className="flex items-center gap-2 text-xs">
          <input
            type="checkbox"
            checked={Boolean((st.flashProtection || {}).enabled)}
            data-testid="settings-fp-enabled"
            onChange={(e) => save({ flashProtection: { graceOver3hMinutes: 15, grace1to3hMinutes: 10, graceUnder1hMinutes: 5, ...(st.flashProtection || {}), enabled: e.target.checked } }, e.target.checked ? "Flash Protection enabled" : "Flash Protection disabled")}
          />
          Enable Flash Booking Protection grace windows
        </label>
        <div className="grid gap-3 sm:grid-cols-3">
          {[
            ["graceOver3hMinutes", "Over 3 hours", 15],
            ["grace1to3hMinutes", "1–3 hours", 10],
            ["graceUnder1hMinutes", "Under 1 hour", 5],
          ].map(([key, label, fallback]) => (
            <label key={key}>
              <span className="nb-label">{label}</span>
              <input
                type="number"
                className="nb-input"
                defaultValue={(st.flashProtection || {})[key] ?? fallback}
                data-testid={`settings-fp-${key}`}
                onBlur={(e) => save({ flashProtection: { enabled: Boolean((st.flashProtection || {}).enabled), graceOver3hMinutes: 15, grace1to3hMinutes: 10, graceUnder1hMinutes: 5, ...(st.flashProtection || {}), [key]: Number(e.target.value) || fallback } }, "Flash Protection grace saved")}
              />
            </label>
          ))}
        </div>
      </div>
      <div className="mt-6 grid gap-4 md:grid-cols-2">
        <CancellationPolicyEditor policy={st.cancellationPolicy || {}} />
        <CancellationFeeEditor fee={st.cancellationFee || {}} />
        <ReminderDaysEditor days={st.credentialReminderDays} />
      </div>
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
