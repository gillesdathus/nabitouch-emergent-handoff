import { useEffect, useState } from "react";
import { Building2, Calendar, Hotel, Home as HomeIcon, PartyPopper, CreditCard, Banknote, ShieldCheck, Check, Wallet } from "lucide-react";
import { AddressPicker } from "@/components/AddressPicker";
import { Avatar } from "@/components/ui-kit";
import { restrictedFlag } from "@/lib/feature-flags";
import { useDemo } from "@/store/DemoStore";
import { apiError } from "@/lib/api";
import { LOCATION_TYPES, GOALS, FOCUS, addDays, todayISO, fmtDate, fmtTime, money, publiclyBookable, bookableCatalogueService, clinicBookable, paymentChoice } from "@/lib/domain";
import { formatCents } from "@/lib/billing";

const LOC_ICON = { home: HomeIcon, office: Building2, hotel: Hotel, event: PartyPopper, clinic: Calendar };
const Tile = ({ on, children, ...p }) => <button type="button" {...p} className={`nb-select-tile w-full min-w-0 ${on ? "border-nb-blue bg-sky-50/70" : "border-sky-100 bg-white hover:border-sky-200"}`}>{children}</button>;
const H = ({ t, s }) => <div className="mb-6"><h2 className="text-2xl font-semibold tracking-tight text-nb-ink sm:text-3xl">{t}</h2>{s && <p className="mt-1 text-sm text-nb-mute">{s}</p>}</div>;
const toggle = (arr, v) => (arr.includes(v) ? arr.filter((x) => x !== v) : [...arr, v]);

export function StepWhere() {
  const { draft, patchDraft, idx, me } = useDemo();
  const clinic = idx.settings.clinic;
  return (
    <div>
      <H t="Where should we meet you?" s={clinicBookable(clinic) ? "Mobile visits across Edmonton, or the clinic when it is open for booking." : "Mobile visits across Edmonton. In-clinic booking is turned off."} />
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {LOCATION_TYPES.filter((l) => l.id !== "clinic" || clinicBookable(clinic)).map((l) => { const I = LOC_ICON[l.id]; return (
          <Tile key={l.id} on={draft.locationType === l.id} onClick={() => patchDraft({ locationType: l.id })} data-testid={`step-where-${l.id}`} aria-pressed={draft.locationType === l.id}>
            <I className={`h-5 w-5 ${draft.locationType === l.id ? "text-nb-blue" : "text-nb-mute"}`} /><span className="mt-3 block text-sm font-semibold">{l.label}</span>
          </Tile>); })}
      </div>
      {draft.locationType === "clinic" ? (
        <div className="nb-soft mt-6 p-5 text-sm" data-testid="step-where-clinic-info"><p className="font-semibold">In-clinic visit</p><p className="text-nb-mute">{clinic.address} · no travel fee</p></div>
      ) : (
        <div className="mt-6 space-y-4">
          {me?.addresses?.length > 0 && (
            <div className="flex flex-wrap gap-2">{me.addresses.map((a) => (
              <button key={a.id} onClick={() => patchDraft({ address: { ...a, clientConfirmed: a.clientConfirmed === true && a.confidence === "address" }, addressQuery: a.line })} data-testid={`saved-address-${a.id}`} className={(draft.address?.id ? draft.address.id === a.id : draft.address?.line === a.line) ? "nb-chip-on" : "nb-chip-off"}><HomeIcon className="h-3.5 w-3.5" />{a.label}: {a.line.split(",")[0]}{a.clientConfirmed === true && a.confidence === "address" ? <span className="sr-only"> (confirmed)</span> : null}</button>))}
            </div>
          )}
          <AddressPicker testid="step-where-address" query={draft.addressQuery} onQuery={(v) => patchDraft({ addressQuery: v })} value={draft.address} onChange={(a) => patchDraft({ address: a })} />
          <label className="block"><span className="nb-label">Access notes <span className="font-normal text-nb-mute">(optional)</span></span>
            <input className="nb-input" placeholder="Buzzer, parking, pets, stairs…" value={draft.addressNotes} onChange={(e) => patchDraft({ addressNotes: e.target.value })} data-testid="step-where-notes-input" /></label>
        </div>
      )}
    </div>
  );
}

export function StepService() {
  const { draft, patchDraft, state, idx } = useDemo();
  const s = idx.services[draft.serviceSlug];
  return (
    <div>
      <H t="Choose your treatment" s="The total is confirmed before you book." />
      <div className="grid gap-3 sm:grid-cols-2">
        {state.services.filter((x) => bookableCatalogueService(x) && (draft.locationType === "clinic" ? x.clinic : x.mobile)).map((x) => (
          <Tile key={x.slug} on={draft.serviceSlug === x.slug} data-testid={`step-service-${x.slug}`} onClick={() => patchDraft({ serviceSlug: x.slug, duration: x.prices[String(draft.duration)] ? draft.duration : Number(Object.keys(x.prices)[0]) })}>
            <div className="flex items-center gap-3"><img src={x.img} alt="" className="h-12 w-12 shrink-0 rounded-xl object-cover" loading="lazy" /><div className="min-w-0 flex-1"><p className="text-sm font-semibold">{x.name}</p><p className="line-clamp-2 text-xs text-nb-mute">{x.short}</p></div>{draft.serviceSlug === x.slug && <Check className="h-5 w-5 shrink-0 text-nb-blue" />}</div>
          </Tile>))}
      </div>
      {s && (
        <div className="mt-8 space-y-6">
          <div><p className="nb-label">Duration</p><div className="grid grid-cols-3 gap-2">
            {Object.entries(s.prices).map(([d, p]) => <Tile key={d} on={String(draft.duration) === d} onClick={() => patchDraft({ duration: Number(d) })} data-testid={`step-duration-${d}`}><span className="block text-center text-sm font-semibold">{d} min</span><span className="block text-center text-xs text-nb-mute">{money(p)}</span></Tile>)}
          </div></div>
          <div><p className="nb-label">Enhancements <span className="font-normal text-nb-mute">(optional)</span></p><div className="flex flex-wrap gap-2">
            {idx.settings.addons.map((a) => <button key={a.id} onClick={() => patchDraft({ addons: toggle(draft.addons, a.id) })} data-testid={`step-addon-${a.id}`} className={draft.addons.includes(a.id) ? "nb-chip-on" : "nb-chip-off"}>{a.name} · +{money(a.price)}</button>)}
          </div></div>
        </div>
      )}
    </div>
  );
}

export function StepWhen() {
  const { draft, patchDraft, state, api } = useDemo();
  const days = Array.from({ length: 10 }, (_, i) => addDays(todayISO(), i));
  const pros = state.practitioners.filter((person) => publiclyBookable(person) && (!person.specialties?.length || person.specialties.includes(draft.serviceSlug)));
  const held = state.practitioners.find((person) => person.id === draft.practitionerId);
  const date = draft.date || days[0];
  const [slots, setSlots] = useState([]);
  const [recommended, setRecommended] = useState([]);
  const [showAll, setShowAll] = useState(false);
  const [note, setNote] = useState("");
  useEffect(() => {
    let cancel = false;
    const load = async () => {
      if (draft.locationType !== "clinic" && draft.address?.clientConfirmed !== true) {
        setSlots([]);
        setRecommended([]);
        setNote("Confirm the service address to see times that fit the route.");
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
  }, [api, date, draft.duration, draft.serviceSlug, draft.practitionerId, draft.locationType, draft.address]);
  const visible = showAll ? slots : recommended;
  return (
    <div>
      <H t="When works for you?" s="Times come from open practitioner schedules and the drive between visits. A recommendation is not a confirmed assignment." />
      <div className="no-scrollbar -mx-1 flex gap-2 overflow-x-auto px-1 pb-2">
        {days.map((d) => (
          <button key={d} onClick={() => { patchDraft({ date: d, time: null }); setShowAll(false); }} data-testid={`step-date-${d}`} className={`flex h-20 w-16 shrink-0 flex-col items-center justify-center rounded-2xl border-2 transition-colors ${date === d ? "border-transparent text-white nb-gradient" : "border-sky-100 bg-white"}`}>
            <span className={`text-[11px] uppercase ${date === d ? "text-white/80" : "text-nb-mute"}`}>{fmtDate(d, { weekday: "short" })}</span><span className="text-xl font-semibold">{fmtDate(d, { day: "numeric" })}</span><span className={`text-[10px] ${date === d ? "text-white/80" : "text-nb-mute"}`}>{fmtDate(d, { month: "short" })}</span>
          </button>))}
      </div>
      <p className="nb-label mt-6">Practitioner <span className="font-normal text-nb-mute">(optional)</span></p>
      <div className="no-scrollbar flex gap-2 overflow-x-auto pb-1">
        <button onClick={() => patchDraft({ practitionerId: "", time: null })} data-testid="step-pract-any" className={!draft.practitionerId ? "nb-chip-on" : "nb-chip-off"}>Best available</button>
        {pros.map((p) => <button key={p.id} onClick={() => patchDraft({ practitionerId: p.id, time: null })} data-testid={`step-pract-${p.id}`} className={draft.practitionerId === p.id ? "nb-chip-on" : "nb-chip-off"}><Avatar person={p} size={22} />{p.name}</button>)}
      </div>
      {held && !pros.some((person) => person.id === held.id) && <p className="mt-2 text-sm text-red-700" data-testid="step-pract-mismatch">{held.name} does not offer this treatment. Choose another practitioner or best available.</p>}
      <p className="nb-label mt-6">{showAll ? "Open times" : "Recommended times"} · {fmtDate(date)}</p>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
        {visible.map((s) => (
          <button key={s.time} onClick={() => patchDraft({ date, time: s.time })} data-testid={`step-time-${s.time}`} className={`rounded-2xl border-2 px-3 py-3 text-left text-sm ${draft.time === s.time && draft.date === date ? "border-nb-blue bg-nb-blue text-white" : "border-sky-100 bg-white"}`}>
            <span className="block font-semibold">{fmtTime(s.time)}</span>
            <span className={`mt-1 block text-xs ${draft.time === s.time && draft.date === date ? "text-white/80" : "text-nb-mute"}`}>{s.label || "Available"}</span>
          </button>
        ))}
      </div>
      {note && <p className="mt-3 text-sm text-nb-mute" data-testid="step-when-note">{note}</p>}
      {slots.length > recommended.length && <button type="button" className="mt-3 text-sm font-semibold text-nb-blue" data-testid="step-when-all" onClick={() => setShowAll((value) => !value)}>{showAll ? "Show recommended times" : "View all open times"}</button>}
    </div>
  );
}

export function StepYou() {
  const { draft, patchDraft, me } = useDemo();
  const g = draft.guest;
  const setG = (k, v) => patchDraft({ guest: { ...g, [k]: v } });
  return (
    <div>
      <H t="Make it yours" s="Share what you’d like from this session — your practitioner will tailor the treatment." />
      <p className="nb-label">Treatment goals</p>
      <div className="flex flex-wrap gap-2">{GOALS.map((x) => <button key={x} onClick={() => patchDraft({ goals: toggle(draft.goals, x) })} data-testid={`step-goal-${x.toLowerCase().replace(/\s/g, "-")}`} className={draft.goals.includes(x) ? "nb-chip-on" : "nb-chip-off"}>{x}</button>)}</div>
      <p className="mt-6 rounded-2xl bg-sky-50 p-4 text-sm text-nb-navy" data-testid="step-pressure-note">The service you select is the treatment you purchase. Notes below can mention comfort preferences. They do not change the service or its price. A different treatment needs its own booking.</p>
      <p className="nb-label mt-6">Focus areas</p>
      <div className="flex flex-wrap gap-2">{FOCUS.map((x) => <button key={x} onClick={() => patchDraft({ focus: toggle(draft.focus, x) })} data-testid={`step-focus-${x.toLowerCase().replace(/\W+/g, "-")}`} className={draft.focus.includes(x) ? "nb-chip-on" : "nb-chip-off"}>{x}</button>)}</div>
      <label className="mt-6 block"><span className="nb-label">Anything else? <span className="font-normal text-nb-mute">(optional)</span></span><textarea rows={2} className="nb-input h-auto py-3" value={draft.notes} onChange={(e) => patchDraft({ notes: e.target.value })} placeholder="Areas to avoid, music preference…" data-testid="step-notes-input" /></label>

      <div className="nb-card mt-8 p-5" data-testid="step-you-contact">
        {me ? <p className="text-sm">Booking as <b>{me.firstName} {me.lastName}</b> · {me.email}</p> : (
          <>
            <p className="font-semibold">Your details</p>
            <p className="mb-4 text-xs text-nb-mute">Guest booking is fine. Create a profile if you want to rebook faster.</p>
            <div className="grid gap-3 sm:grid-cols-2">
              {[["firstName", "First name"], ["lastName", "Last name"], ["email", "Email"], ["phone", "Phone"]].map(([k, l]) => (
                <label key={k}><span className="nb-label">{l}</span><input className="nb-input" value={g[k]} onChange={(e) => setG(k, e.target.value)} type={k === "email" ? "email" : k === "phone" ? "tel" : "text"} data-testid={`guest-${k}-input`} /></label>))}
            </div>
            <label className="mt-4 flex items-start gap-3 text-sm"><input type="checkbox" className="mt-1 h-4 w-4 accent-[#1565F0]" checked={g.createProfile} onChange={(e) => setG("createProfile", e.target.checked)} data-testid="guest-create-profile-checkbox" /><span><b>Create my Nabitouch profile</b> — rebook faster, track visits and keep your preferences.</span></label>
            {g.createProfile && (
              <div className="mt-4 space-y-3 rounded-2xl bg-sky-50/60 p-4">
                <label className="block"><span className="nb-label">Create a password (min. 8 characters)</span><input type="password" autoComplete="new-password" className="nb-input" value={g.password || ""} onChange={(e) => setG("password", e.target.value)} data-testid="guest-password-input" /></label>
                <label className="block"><span className="nb-label">When is your birthday? We’d love to send you a little birthday wish!</span><input type="date" className="nb-input" value={g.dob} onChange={(e) => setG("dob", e.target.value)} data-testid="guest-dob-input" /></label>
                <p className="text-xs text-nb-mute">Your birthdate also helps us identify you and complete care or insurance records where applicable.</p>
                <label className="flex items-start gap-3 text-sm"><input type="checkbox" className="mt-1 h-4 w-4 accent-[#1565F0]" checked={!!g.smsConsent} onChange={(e) => setG("smsConsent", e.target.checked)} data-testid="guest-sms-consent-checkbox" /><span>Text me visit reminders and on-the-way updates. <span className="text-nb-mute">(Optional. Reply STOP anytime.)</span></span></label>
                <label className="flex items-start gap-3 text-sm"><input type="checkbox" className="mt-1 h-4 w-4 accent-[#1565F0]" checked={g.marketingConsent} onChange={(e) => setG("marketingConsent", e.target.checked)} data-testid="guest-marketing-consent-checkbox" /><span>Yes, send me birthday wishes, offers and wellness tips. <span className="text-nb-mute">(Optional — not required to book. Appointment messages are sent separately.)</span></span></label>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

export function StepPay() {
  const { draft, patchDraft, idx } = useDemo();
  const policy = idx.settings.paymentPolicy || {};
  const cardsOn = restrictedFlag(idx?.settings, "cardCheckoutEnabled");
  const selected = paymentChoice(draft, idx.settings);
  const choose = (payNow) => patchDraft({ paymentMethod: "self", payNow, selfMethod: payNow === "cash" ? "cash" : "card" });
  return (
    <div>
      <H t="How would you like to pay?" s="The appointment total is calculated first. What you pay now depends on the payment policy." />
      <div className="grid gap-3 sm:grid-cols-2">
        {cardsOn && policy.mode !== "deposit" && <Tile on={selected === "full"} onClick={() => choose("full")} data-testid="step-pay-full"><CreditCard className="h-6 w-6 text-nb-blue" /><p className="mt-3 font-semibold">Pay the full total online</p><p className="text-xs text-nb-mute">Card checkout through Stripe. Nothing is marked paid until the payment is verified.</p></Tile>}
        {cardsOn && policy.mode !== "full" && <Tile on={selected === "deposit"} onClick={() => choose("deposit")} data-testid="step-pay-deposit"><Wallet className="h-6 w-6 text-nb-blue" /><p className="mt-3 font-semibold">Pay the deposit online</p><p className="text-xs text-nb-mute">{policy.depositType === "fixed" ? `Fixed deposit ${formatCents(policy.depositCents || 0)}.` : `${policy.depositPercent || 0}% of the appointment total.`} The rest stays on the balance.</p></Tile>}
        {policy.cashAccepted && <Tile on={selected === "cash"} onClick={() => choose("cash")} data-testid="step-pay-cash"><Banknote className="h-6 w-6 text-nb-blue" /><p className="mt-3 font-semibold">Pay cash at the visit</p><p className="text-xs text-nb-mute">Cash is not a prepayment. The visit is confirmed as unpaid until the balance is recorded.</p></Tile>}
      </div>
      {!cardsOn && <p className="mt-4 text-sm text-nb-mute" data-testid="step-pay-card-off">Online card checkout is not active in this preview, so a deposit or full card payment cannot be collected here.</p>}
      <p className="mt-4 rounded-2xl bg-slate-50 p-4 text-sm text-nb-mute" data-testid="step-pay-insurance-off"><ShieldCheck className="mr-2 inline h-4 w-4" />Insurance direct billing is not connected. No insurance details are collected for this booking.</p>
    </div>
  );
}
