import { useEffect, useState } from "react";
import { Building2, Calendar, Hotel, Home as HomeIcon, PartyPopper, CreditCard, Banknote, ShieldCheck, Check, Wallet } from "lucide-react";
import { AddressPicker } from "@/components/AddressPicker";
import { Avatar } from "@/components/ui-kit";
import { restrictedFlag } from "@/lib/feature-flags";
import { useDemo } from "@/store/DemoStore";
import { apiError } from "@/lib/api";
import { LOCATION_TYPES, GOALS, FOCUS, addDays, todayISO, fmtDate, fmtTime, money, publiclyBookable, bookableCatalogueService, clinicBookable, paymentChoice, isTrialService } from "@/lib/domain";
import { formatCents } from "@/lib/billing";
import { addressSelectionPatch, serviceSelectionPatch } from "@/lib/booking-selection";

const LOC_ICON = { home: HomeIcon, office: Building2, hotel: Hotel, event: PartyPopper, clinic: Calendar };
const Tile = ({ on, children, ...p }) => <button type="button" {...p} className={`nb-select-tile w-full min-w-0 ${on ? "border-nb-blue bg-sky-50/70" : "border-sky-100 bg-white hover:border-sky-200"}`}>{children}</button>;
const H = ({ t, s }) => <div className="mb-6"><h2 className="text-2xl font-semibold tracking-tight text-nb-ink sm:text-3xl">{t}</h2>{s && <p className="mt-1 text-sm text-nb-mute">{s}</p>}</div>;
const toggle = (arr, v) => (arr.includes(v) ? arr.filter((x) => x !== v) : [...arr, v]);

export function StepWhere() {
  const { draft, patchDraft, idx, me, state } = useDemo();
  const clinic = idx.settings.clinic;
  const trialService = state.services.find((row) => row.slug === draft.serviceSlug);
  const trialFlow = Boolean(draft.campaignId && isTrialService(trialService));
  // Clinic tiles stay off while in-clinic booking is disabled. Trial is always mobile-only.
  const clinicShown = !trialFlow && clinicBookable(clinic);
  const mobile = draft.locationType !== "clinic" || !clinicShown;
  // Once a civic pick is on the draft, focus the address phases (find/confirm/details).
  const addressFocus = mobile && Boolean(draft.address?.line);
  const selectSaved = (a) => {
    const civicOk = a.clientConfirmed === true && a.confidence === "address";
    const next = {
      ...a,
      clientConfirmed: civicOk,
      // Fresh pick always re-asks optional suite/buzzer/notes for this booking.
      detailsSettled: false,
    };
    patchDraft(addressSelectionPatch(next, { query: a.line, forceWhere: true }));
  };
  const useDifferentAddress = () => {
    patchDraft(addressSelectionPatch(null, { query: "", forceWhere: true }));
  };
  const locationLabel = LOCATION_TYPES.find((l) => l.id === draft.locationType)?.label || "My Home";
  return (
    <div data-testid="step-where">
      <H
        t={addressFocus ? "Confirm your address" : "Where should we meet you?"}
        s={addressFocus
          ? "One decision at a time — confirm the service address, then optional access details."
          : (trialFlow
            ? "Your free 10-minute trial is a mobile visit at an eligible Edmonton home, office, hotel, or event address. No payment is required."
            : (clinicShown ? "Mobile visits across Edmonton, or the clinic when it is open for booking." : "Mobile visits across Edmonton."))}
      />
      {!addressFocus && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {LOCATION_TYPES.filter((l) => l.id !== "clinic" || clinicShown).map((l) => { const I = LOC_ICON[l.id]; return (
            <Tile key={l.id} on={draft.locationType === l.id} onClick={() => patchDraft({ locationType: l.id || "home" })} data-testid={`step-where-${l.id}`} aria-pressed={draft.locationType === l.id}>
              <I className={`h-5 w-5 ${draft.locationType === l.id ? "text-nb-blue" : "text-nb-mute"}`} /><span className="mt-3 block text-sm font-semibold">{l.label}</span>
            </Tile>); })}
        </div>
      )}
      {addressFocus && (
        <p className="mb-4 text-sm text-nb-mute" data-testid="step-where-location-chip">
          Visit type: <b className="text-nb-ink">{locationLabel}</b>
          {" · "}
          <button type="button" className="font-semibold text-nb-blue" data-testid="step-where-change-location" onClick={() => patchDraft({ address: null, addressQuery: "", forceWhere: true })}>Change visit type</button>
        </p>
      )}
      {draft.locationType === "clinic" && clinicShown ? (
        <div className="nb-soft mt-6 p-5 text-sm" data-testid="step-where-clinic-info"><p className="font-semibold">In-clinic visit</p><p className="text-nb-mute">{clinic.address || "Clinic address on file"} · no travel fee</p></div>
      ) : (
        <div className={`${addressFocus ? "mt-0" : "mt-6"} space-y-4`}>
          {me?.addresses?.length > 0 && !addressFocus && (
            <div className="space-y-2" data-testid="step-where-saved-addresses">
              <div className="flex flex-wrap gap-2">{me.addresses.map((a) => (
                <button key={a.id} type="button" onClick={() => selectSaved(a)} data-testid={`saved-address-${a.id}`} className={(draft.address?.id ? draft.address.id === a.id : draft.address?.line === a.line) ? "nb-chip-on" : "nb-chip-off"}><HomeIcon className="h-3.5 w-3.5" />{a.label}: {a.line.split(",")[0]}{a.clientConfirmed === true && a.confidence === "address" ? <span className="sr-only"> (confirmed)</span> : null}</button>))}
              </div>
              <button type="button" onClick={useDifferentAddress} data-testid="step-where-different-address" className="text-xs font-semibold text-nb-blue underline-offset-2 hover:underline">Different address</button>
              <p className="text-xs text-nb-mute">A different visit address is used for this booking only. It does not change your saved home address unless you update it in Profile.</p>
            </div>
          )}
          <AddressPicker
            testid="step-where-address"
            query={draft.addressQuery}
            onQuery={(v) => patchDraft({ addressQuery: v })}
            value={draft.address}
            notes={draft.addressNotes}
            onNotes={(v) => patchDraft({ addressNotes: v })}
            onAdvance={() => patchDraft({ forceWhere: false })}
            onChange={(a) => patchDraft(a
              ? addressSelectionPatch(a, {
                query: a.line,
                // Keep the client on Where until details settle.
                forceWhere: a.detailsSettled !== true,
              })
              : addressSelectionPatch(null, { forceWhere: true, preserveQuery: true }))}
          />
        </div>
      )}
    </div>
  );
}

export function StepService() {
  const { draft, patchDraft, state, idx } = useDemo();
  const s = idx.services[draft.serviceSlug];
  const trialFlow = Boolean(draft.campaignId && isTrialService(s));
  const visible = state.services.filter((x) => {
    if (trialFlow && x.slug === draft.serviceSlug) return true;
    if (isTrialService(x)) return false;
    return bookableCatalogueService(x) && (draft.locationType === "clinic" ? x.clinic : x.mobile);
  });
  const chooseService = (x) => {
    if (trialFlow) return;
    patchDraft(serviceSelectionPatch(x, draft, { preserveDuration: true }));
  };
  return (
    <div data-testid="step-service">
      <H t={trialFlow ? "10 Minutes. On Us." : "Choose your treatment"} s={trialFlow ? "Free 10-minute neck-and-shoulder massage. Meet your massage therapist and experience Nabitouch." : "Select a treatment, then continue."} />
      <div className="grid gap-3 sm:grid-cols-2">
        {visible.map((x) => (
          <Tile key={x.slug} on={draft.serviceSlug === x.slug} data-testid={`step-service-${x.slug}`} aria-pressed={draft.serviceSlug === x.slug} onClick={() => chooseService(x)}>
            <div className="flex items-center gap-3"><img src={x.img} alt="" className="h-12 w-12 shrink-0 rounded-xl object-cover" loading="lazy" /><div className="min-w-0 flex-1"><p className="text-sm font-semibold">{x.name}</p><p className="line-clamp-2 text-xs text-nb-mute">{x.short}</p></div>{draft.serviceSlug === x.slug && <Check className="h-5 w-5 shrink-0 text-nb-blue" />}</div>
          </Tile>))}
      </div>
    </div>
  );
}

export function StepDuration() {
  const { draft, patchDraft, idx } = useDemo();
  const s = idx.services[draft.serviceSlug];
  const trialFlow = Boolean(draft.campaignId && isTrialService(s));
  if (!s) {
    return (
      <div data-testid="step-duration">
        <H t="Choose a duration" s="Pick a treatment first." />
      </div>
    );
  }
  const chooseDuration = (d) => {
    const duration = Number(d);
    patchDraft({
      duration,
      time: null,
      idempotencyKey: undefined,
      checkoutSessionId: null,
      checkoutAmountCents: null,
      depositCents: null,
      invoiceId: null,
    });
  };
  return (
    <div data-testid="step-duration">
      <H t={trialFlow ? "Confirm your free trial length" : "How long?"} s={trialFlow ? "Your trial is complimentary." : `${s.name} — optional enhancements, then choose a length and continue.`} />
      {/* Enhancements above duration so they stay reachable before Continue. */}
      {!trialFlow && idx.settings.addons?.length > 0 && (
        <div className="mb-6">
          <p className="nb-label">Enhancements <span className="font-normal text-nb-mute">(optional)</span></p>
          <div className="mt-2 flex flex-wrap gap-2">
            {idx.settings.addons.map((a) => (
              <button key={a.id} type="button" onClick={() => patchDraft({ addons: toggle(draft.addons, a.id) })} data-testid={`step-addon-${a.id}`} className={draft.addons.includes(a.id) ? "nb-chip-on" : "nb-chip-off"}>
                {a.name} · +{money(a.price)}
              </button>
            ))}
          </div>
        </div>
      )}
      <div className="grid grid-cols-3 gap-2">
        {Object.entries(s.prices).map(([d, p]) => (
          <Tile key={d} on={String(draft.duration) === d} onClick={() => chooseDuration(d)} data-testid={`step-duration-${d}`}>
            <span className="block text-center text-sm font-semibold">{d} min</span>
            <span className="block text-center text-xs text-nb-mute">{trialFlow ? "Free" : money(p)}</span>
          </Tile>
        ))}
      </div>
    </div>
  );
}

export function StepWhen() {
  const { draft, patchDraft, state, api } = useDemo();
  const days = Array.from({ length: 10 }, (_, i) => addDays(todayISO(), i));
  const firstDay = days[0];
  const trialService = state.services.find((row) => row.slug === draft.serviceSlug);
  const trialFlow = Boolean(draft.campaignId && isTrialService(trialService));
  const pros = state.practitioners.filter((person) => {
    if (draft.practitionerId && person.id === draft.practitionerId) return true;
    return publiclyBookable(person) && (!person.specialties?.length || person.specialties.includes(draft.serviceSlug) || trialFlow);
  });
  const held = state.practitioners.find((person) => person.id === draft.practitionerId);
  const date = draft.date;
  const [slots, setSlots] = useState([]);
  const [recommended, setRecommended] = useState([]);
  const [showAll, setShowAll] = useState(false);
  const [note, setNote] = useState("");
  // Keep the highlighted day and draft.date in sync (no phantom "today" selection).
  useEffect(() => {
    if (!draft.date && firstDay) patchDraft({ date: firstDay });
  }, [draft.date, firstDay, patchDraft]);
  useEffect(() => {
    let cancel = false;
    const load = async () => {
      if (!date) return;
      if (draft.locationType !== "clinic" && draft.address?.clientConfirmed !== true) {
        setSlots([]);
        setRecommended([]);
        setNote("Confirm the service address to see times that fit the route.");
        return;
      }
      if (draft.locationType !== "clinic" && draft.address?.detailsSettled !== true) {
        setSlots([]);
        setRecommended([]);
        setNote("Finish address details (suite or access) before choosing a time.");
        return;
      }
      try {
        const body = await api.recommend({
          date,
          duration: draft.duration,
          serviceSlug: draft.serviceSlug,
          practitionerId: draft.practitionerId || "",
          locationType: draft.locationType,
          address: draft.address || {},
          ...(draft.campaignId ? { campaignId: draft.campaignId } : {}),
        });
        if (cancel) return;
        setRecommended(body.recommendations || []);
        setSlots(body.slots || []);
        setNote((body.slots || []).length ? "" : "No open times on this day. Nabitouch books by appointment.");
      } catch (error) {
        if (!cancel) {
          setSlots([]);
          setRecommended([]);
          setNote(apiError(error));
        }
      }
    };
    load();
    return () => { cancel = true; };
  }, [api, date, draft.duration, draft.serviceSlug, draft.practitionerId, draft.locationType, draft.address, draft.campaignId]);
  const visible = showAll ? slots : recommended;
  return (
    <div data-testid="step-when">
      <H t="When works for you?" s="Times come from open practitioner schedules and the drive between visits. A recommendation is not a confirmed assignment." />
      <div className="no-scrollbar -mx-1 flex gap-2 overflow-x-auto px-1 pb-2">
        {days.map((d) => (
          <button key={d} type="button" onClick={() => { patchDraft({ date: d, time: null }); setShowAll(false); }} data-testid={`step-date-${d}`} className={`flex h-20 w-16 shrink-0 flex-col items-center justify-center rounded-2xl border-2 transition-colors ${date === d ? "border-transparent text-white nb-gradient" : "border-sky-100 bg-white"}`}>
            <span className={`text-[11px] uppercase ${date === d ? "text-white/80" : "text-nb-mute"}`}>{fmtDate(d, { weekday: "short" })}</span><span className="text-xl font-semibold">{fmtDate(d, { day: "numeric" })}</span><span className={`text-[10px] ${date === d ? "text-white/80" : "text-nb-mute"}`}>{fmtDate(d, { month: "short" })}</span>
          </button>))}
      </div>
      <p className="nb-label mt-6">Practitioner <span className="font-normal text-nb-mute">(optional)</span></p>
      <div className="no-scrollbar flex gap-2 overflow-x-auto pb-1">
        <button type="button" onClick={() => patchDraft({ practitionerId: "", time: null })} data-testid="step-pract-any" className={!draft.practitionerId ? "nb-chip-on" : "nb-chip-off"}>Any Available Practitioner</button>
        {pros.map((p) => <button key={p.id} type="button" onClick={() => patchDraft({ practitionerId: p.id, time: null })} data-testid={`step-pract-${p.id}`} className={draft.practitionerId === p.id ? "nb-chip-on" : "nb-chip-off"}><Avatar person={p} size={22} />{p.name}</button>)}
      </div>
      {held && !pros.some((person) => person.id === held.id) && <p className="mt-2 text-sm text-red-700" data-testid="step-pract-mismatch">{held.name} does not offer this treatment. Choose another practitioner or Any Available Practitioner.</p>}
      <p className="nb-label mt-6">{showAll ? "Open times" : "Recommended times"}{date ? ` · ${fmtDate(date)}` : ""}</p>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
        {visible.map((slot) => (
          <button
            key={slot.time}
            type="button"
            onClick={() => patchDraft({ date, time: slot.time })}
            data-testid={`step-time-${slot.time}`}
            className={`rounded-2xl border-2 px-3 py-3 text-left text-sm ${draft.time === slot.time && draft.date === date ? "border-nb-blue bg-nb-blue text-white" : "border-sky-100 bg-white"}`}
          >
            <span className="block font-semibold">{fmtTime(slot.time)}</span>
            <span className={`mt-1 block text-xs ${draft.time === slot.time && draft.date === date ? "text-white/80" : "text-nb-mute"}`}>{slot.label || "Available"}</span>
          </button>
        ))}
      </div>
      {note && <p className="mt-3 text-sm text-nb-mute" data-testid="step-when-note">{note}</p>}
      {slots.length > recommended.length && <button type="button" className="mt-3 text-sm font-semibold text-nb-blue" data-testid="step-when-all" onClick={() => setShowAll((value) => !value)}>{showAll ? "Show recommended times" : "View all open times"}</button>}
    </div>
  );
}

export function StepPreferences() {
  const { draft, patchDraft } = useDemo();
  return (
    <div data-testid="step-preferences">
      <H t="Session preferences" s="Optional — skip anytime. These notes do not change the service or price." />
      <p className="mb-4 rounded-2xl bg-sky-50 p-3 text-xs text-nb-navy" data-testid="step-pressure-note">A different treatment needs its own booking.</p>
      <p className="nb-label">Treatment goals</p>
      <div className="flex flex-wrap gap-2">{GOALS.map((x) => <button key={x} type="button" onClick={() => patchDraft({ goals: toggle(draft.goals, x) })} data-testid={`step-goal-${x.toLowerCase().replace(/\s/g, "-")}`} className={draft.goals.includes(x) ? "nb-chip-on" : "nb-chip-off"}>{x}</button>)}</div>
      <p className="nb-label mt-6">Focus areas</p>
      <div className="flex flex-wrap gap-2">{FOCUS.map((x) => <button key={x} type="button" onClick={() => patchDraft({ focus: toggle(draft.focus, x) })} data-testid={`step-focus-${x.toLowerCase().replace(/\W+/g, "-")}`} className={draft.focus.includes(x) ? "nb-chip-on" : "nb-chip-off"}>{x}</button>)}</div>
      <label className="mt-6 block"><span className="nb-label">Anything else? <span className="font-normal text-nb-mute">(optional)</span></span><textarea rows={2} className="nb-input h-auto py-3" value={draft.notes} onChange={(e) => patchDraft({ notes: e.target.value })} placeholder="Areas to avoid, music preference…" data-testid="step-notes-input" /></label>
    </div>
  );
}

export function StepDetails({ fieldErrors = {} } = {}) {
  const { draft, patchDraft, me, state } = useDemo();
  const g = draft.guest;
  const setG = (k, v) => patchDraft({ guest: { ...g, [k]: v } });
  const trialService = state.services.find((row) => row.slug === draft.serviceSlug);
  const trialFlow = Boolean(draft.campaignId && isTrialService(trialService));
  const insuranceChoices = [
    { id: "yes", label: "Yes" },
    { id: "no", label: "No" },
    { id: "unsure", label: "Not sure" },
  ];
  const err = (key) => fieldErrors[key] ? <p className="mt-1 text-xs text-rose-700" data-testid={`guest-${key}-error`}>{fieldErrors[key]}</p> : null;
  return (
    <div data-testid="step-you">
      <H
        t="Your details"
        s={trialFlow
          ? "We only need what is required to reserve your free 10-minute trial. Clinical intake and consent happen before treatment."
          : "Book as a guest with name, email, and phone. A profile is optional."}
      />
      <div className="nb-card p-5" data-testid="step-you-contact">
        {me ? (
          <div className="space-y-3">
            <p className="text-sm">Booking as <b>{me.firstName} {me.lastName}</b> · {me.email}{me.phone ? ` · ${me.phone}` : ""}</p>
            {trialFlow && !me.dob && (
              <label className="block"><span className="nb-label">Date of birth</span><input type="date" className="nb-input" value={g.dob} onChange={(e) => setG("dob", e.target.value)} data-testid="guest-dob-input" />{err("dob")}</label>
            )}
            {trialFlow && (
              <div data-testid="trial-insurance-status">
                <p className="nb-label">Do you have insurance coverage for massage?</p>
                <div className="mt-2 flex flex-wrap gap-2">
                  {insuranceChoices.map((choice) => (
                    <button key={choice.id} type="button" onClick={() => setG("insuranceStatus", choice.id)} className={g.insuranceStatus === choice.id ? "nb-chip-on" : "nb-chip-off"} data-testid={`trial-insurance-${choice.id}`}>{choice.label}</button>
                  ))}
                </div>
                {err("insuranceStatus")}
                <p className="mt-2 text-xs text-nb-mute">No policy details or proof are required for this free trial.</p>
              </div>
            )}
          </div>
        ) : (
          <>
            <p className="mb-4 text-xs text-nb-mute">{trialFlow ? "Required for your free trial reservation." : "Required for this visit. You do not need a password to continue."}</p>
            <div className="grid gap-3 sm:grid-cols-2">
              {[["firstName", "First name"], ["lastName", "Last name"], ["email", "Email"], ["phone", "Phone"]].map(([k, l]) => (
                <label key={k}><span className="nb-label">{l}</span><input className={`nb-input${fieldErrors[k] ? " border-rose-400" : ""}`} value={g[k]} onChange={(e) => setG(k, e.target.value)} type={k === "email" ? "email" : k === "phone" ? "tel" : "text"} autoComplete={k === "email" ? "email" : k === "phone" ? "tel" : "name"} data-testid={`guest-${k}-input`} />{err(k)}</label>))}
            </div>
            {trialFlow && (
              <div className="mt-4 space-y-3">
                <label className="block"><span className="nb-label">Date of birth</span><input type="date" className={`nb-input${fieldErrors.dob ? " border-rose-400" : ""}`} value={g.dob} onChange={(e) => setG("dob", e.target.value)} data-testid="guest-dob-input" />{err("dob")}</label>
                <div data-testid="trial-insurance-status">
                  <p className="nb-label">Do you have insurance coverage for massage?</p>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {insuranceChoices.map((choice) => (
                      <button key={choice.id} type="button" onClick={() => setG("insuranceStatus", choice.id)} className={g.insuranceStatus === choice.id ? "nb-chip-on" : "nb-chip-off"} data-testid={`trial-insurance-${choice.id}`}>{choice.label}</button>
                    ))}
                  </div>
                  {err("insuranceStatus")}
                  <p className="mt-2 text-xs text-nb-mute">No policy details or proof are required for this free trial.</p>
                </div>
              </div>
            )}
            {!trialFlow && (
              <details className="mt-5 rounded-2xl border border-sky-100 bg-sky-50/40 p-4" data-testid="guest-create-profile-details" defaultOpen={Boolean(g.createProfile)}>
                <summary className="cursor-pointer text-sm font-semibold text-nb-ink" data-testid="guest-create-profile-summary">
                  Optional: create a Nabitouch profile
                </summary>
                <label className="mt-3 flex items-start gap-3 text-sm">
                  <input type="checkbox" className="mt-1 h-4 w-4 accent-[#1565F0]" checked={g.createProfile} onChange={(e) => setG("createProfile", e.target.checked)} data-testid="guest-create-profile-checkbox" />
                  <span>Save my details to rebook faster. Requires a password{g.createProfile ? " and birthday" : ""}.</span>
                </label>
                {g.createProfile && (
                  <div className="mt-4 space-y-3" data-testid="guest-create-profile-fields">
                    <label className="block"><span className="nb-label">Password (min. 8 characters)</span><input type="password" autoComplete="new-password" className={`nb-input${fieldErrors.password ? " border-rose-400" : ""}`} value={g.password || ""} onChange={(e) => setG("password", e.target.value)} data-testid="guest-password-input" />{err("password")}</label>
                    <label className="block"><span className="nb-label">Birthday</span><input type="date" className={`nb-input${fieldErrors.dob ? " border-rose-400" : ""}`} value={g.dob} onChange={(e) => setG("dob", e.target.value)} data-testid="guest-dob-input" />{err("dob")}</label>
                    <p className="text-xs text-nb-mute">Birthday helps identify you for care records when you create an account. It is not required for guest booking.</p>
                    <label className="flex items-start gap-3 text-sm"><input type="checkbox" className="mt-1 h-4 w-4 accent-[#1565F0]" checked={!!g.smsConsent} onChange={(e) => setG("smsConsent", e.target.checked)} data-testid="guest-sms-consent-checkbox" /><span>Text me visit reminders and on-the-way updates. <span className="text-nb-mute">(Optional.)</span></span></label>
                    <label className="flex items-start gap-3 text-sm"><input type="checkbox" className="mt-1 h-4 w-4 accent-[#1565F0]" checked={g.marketingConsent} onChange={(e) => setG("marketingConsent", e.target.checked)} data-testid="guest-marketing-consent-checkbox" /><span>Send me offers and wellness tips. <span className="text-nb-mute">(Optional — not required to book.)</span></span></label>
                  </div>
                )}
              </details>
            )}
          </>
        )}
      </div>
    </div>
  );
}

/** @deprecated Prefer StepDetails — alias kept for existing imports. */
export const StepYou = StepDetails;

export function StepPay({ settlement } = {}) {
  const { draft, patchDraft, idx, state } = useDemo();
  const trialService = state.services.find((row) => row.slug === draft.serviceSlug);
  const trialFlow = Boolean(draft.campaignId && isTrialService(trialService));
  const policy = idx.settings.paymentPolicy || {};
  const mode = policy.mode || "none";
  const cardsOn = restrictedFlag(idx?.settings, "cardCheckoutEnabled");
  const selected = paymentChoice(draft, idx.settings);
  const dueNow = Number(settlement?.dueNowCents);
  const choose = (payNow) => patchDraft({
    paymentMethod: "self",
    payNow,
    selfMethod: payNow === "cash" ? "cash" : payNow === "none" ? undefined : "card",
  });
  if (trialFlow) {
    return (
      <div data-testid="step-pay-trial">
        <H t="No payment for this trial" s="10 Minutes. On Us. is free. Neck and shoulders only." />
        <p className="rounded-2xl bg-sky-50 p-4 text-sm text-nb-navy">$0 due now. After your trial you can book a regular massage — any eligible first-booking welcome offer is preserved.</p>
      </div>
    );
  }
  const requiresCard = mode === "deposit" || mode === "full";
  const stripeBlocked = requiresCard && !cardsOn && !policy.cashAccepted;
  return (
    <div data-testid="step-pay">
      <H
        t={mode === "none" ? "Payment for this booking" : "How would you like to pay?"}
        s={mode === "none"
          ? "No upfront payment is required. You can still pay online later if card checkout is available."
          : "The appointment total is calculated first. What you pay now depends on the payment policy."}
      />
      {Number.isInteger(dueNow) && (
        <p className="mb-4 rounded-2xl bg-sky-50 p-4 text-sm text-nb-navy" data-testid="step-pay-required-amount">
          {dueNow > 0
            ? <>Amount required before payment is satisfied: <b>{formatCents(dueNow)}</b>. Nothing is marked paid until Stripe verifies the payment.</>
            : <>No amount is required online now. Remaining balance: <b>{formatCents(settlement?.remainingCents || 0)}</b>.</>}
        </p>
      )}
      <div className="grid gap-3 sm:grid-cols-2">
        {mode === "none" && <Tile on={selected === "none"} onClick={() => choose("none")} data-testid="step-pay-none"><Wallet className="h-6 w-6 text-nb-blue" /><p className="mt-3 font-semibold">No payment now</p><p className="text-xs text-nb-mute">Book without an online payment. Optional card payment stays available after booking when Stripe is on.</p></Tile>}
        {cardsOn && (mode === "full" || mode === "choice" || mode === "none") && <Tile on={selected === "full"} onClick={() => choose("full")} data-testid="step-pay-full"><CreditCard className="h-6 w-6 text-nb-blue" /><p className="mt-3 font-semibold">{mode === "none" ? "Pay the full total online (optional)" : "Pay the full total online"}</p><p className="text-xs text-nb-mute">Card checkout through Stripe. Nothing is marked paid until the payment is verified.</p></Tile>}
        {cardsOn && (mode === "deposit" || mode === "choice") && <Tile on={selected === "deposit"} onClick={() => choose("deposit")} data-testid="step-pay-deposit"><Wallet className="h-6 w-6 text-nb-blue" /><p className="mt-3 font-semibold">Pay the deposit online</p><p className="text-xs text-nb-mute">{policy.depositType === "fixed" ? `Fixed deposit ${formatCents(policy.depositCents || 0)}.` : `${policy.depositPercent || 0}% of the appointment total.`} The rest stays on the balance.</p></Tile>}
        {policy.cashAccepted && <Tile on={selected === "cash"} onClick={() => choose("cash")} data-testid="step-pay-cash"><Banknote className="h-6 w-6 text-nb-blue" /><p className="mt-3 font-semibold">Pay cash at the visit</p><p className="text-xs text-nb-mute">Cash is not a prepayment. The visit is confirmed as unpaid until the balance is recorded.</p></Tile>}
      </div>
      {!cardsOn && requiresCard && (
        <p className="mt-4 rounded-2xl bg-amber-50 p-4 text-sm text-amber-950" data-testid="step-pay-stripe-unavailable">
          Online card checkout is unavailable, so a required {mode === "deposit" ? "deposit" : "full payment"} cannot be verified here.
          {policy.cashAccepted
            ? " Choose cash at the visit, or ask Nabitouch to turn card checkout on."
            : " Ask Nabitouch to enable Stripe checkout or accept cash — this booking will not be marked paid."}
        </p>
      )}
      {!cardsOn && !requiresCard && <p className="mt-4 text-sm text-nb-mute" data-testid="step-pay-card-off">Online card checkout is not active, so optional card payment is not offered during booking.</p>}
      {stripeBlocked && <p className="mt-3 text-sm font-medium text-rose-700" data-testid="step-pay-blocked">Booking cannot collect the required payment until Stripe or cash is available.</p>}
      <p className="mt-4 rounded-2xl bg-slate-50 p-4 text-sm text-nb-mute" data-testid="step-pay-insurance-off"><ShieldCheck className="mr-2 inline h-4 w-4" />Insurance direct billing is not connected. No insurance details are collected for this booking.</p>
    </div>
  );
}
