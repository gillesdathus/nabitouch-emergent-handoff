import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { AlertTriangle, Car, Clock, HelpCircle, MapPin, Package, ShieldAlert } from "lucide-react";
import { toast } from "sonner";
import { ModuleNavigation } from "@/components/tide";
import { api, apiError } from "@/lib/api";
import { QUICK_HELP_CATEGORIES, teamNavFor, teamPath } from "@/lib/team-connect";
import { useDemo } from "@/store/DemoStore";
import { OPEN } from "@/lib/domain";

const ICONS = {
  running_late: Clock,
  vehicle_issue: Car,
  safety_concern: ShieldAlert,
  address_problem: MapPin,
  need_supplies: Package,
  other: HelpCircle,
};

const DRAFT_KEY = "nt.team.help.draft";

function loadDraft() {
  try {
    return JSON.parse(localStorage.getItem(DRAFT_KEY) || "null") || {};
  } catch {
    return {};
  }
}

function saveDraft(draft) {
  try {
    localStorage.setItem(DRAFT_KEY, JSON.stringify(draft));
  } catch { /* offline quota */ }
}

export default function TeamHelp({ role = "pro" }) {
  const { state, practitionerId } = useDemo();
  const nav = useNavigate();
  const [params] = useSearchParams();
  const draft = loadDraft();
  const paramCategory = params.get("category") || "";
  const paramAppointment = params.get("appointmentId") || "";
  const [category, setCategory] = useState(paramCategory || draft.category || "");
  const [note, setNote] = useState(draft.note || "");
  const [appointmentId, setAppointmentId] = useState(paramAppointment || draft.appointmentId || "");
  const [shareLocation, setShareLocation] = useState(false);
  const [consent, setConsent] = useState(false);
  const [coords, setCoords] = useState(null);
  const [delayMinutes, setDelayMinutes] = useState(10);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (paramCategory) setCategory(paramCategory);
    if (paramAppointment) setAppointmentId(paramAppointment);
  }, [paramCategory, paramAppointment]);

  useEffect(() => {
    saveDraft({ category, note, appointmentId });
  }, [category, note, appointmentId]);

  const visits = useMemo(() => {
    const rows = (state.appointments || []).filter((row) => OPEN.includes(row.status));
    if (role === "pro") return rows.filter((row) => row.practitionerId === practitionerId);
    return rows.slice(0, 40);
  }, [state.appointments, practitionerId, role]);

  const selected = QUICK_HELP_CATEGORIES.find((c) => c.id === category);

  const requestLocation = () => {
    if (!navigator.geolocation) {
      toast.error("Location is not available on this device");
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setCoords({ lat: pos.coords.latitude, lng: pos.coords.longitude });
        setShareLocation(true);
        toast.success("Location ready for this request only");
      },
      () => {
        setShareLocation(false);
        setCoords(null);
        toast.message("Location denied — you can still submit without it");
      },
      { enableHighAccuracy: true, timeout: 12000 },
    );
  };

  const submit = async () => {
    if (!category || busy) return;
    setBusy(true);
    try {
      const delayNote = category === "running_late" && !note.trim()
        ? `Running about ${delayMinutes} minutes late.`
        : note;
      const body = {
        category,
        note: category === "running_late" && note.trim() && !note.includes(`${delayMinutes}`)
          ? `${note.trim()} (${delayMinutes} min)`
          : delayNote,
        appointmentId: appointmentId || undefined,
        locationShare: !!(shareLocation && consent && coords),
        locationConsent: !!(shareLocation && consent && coords),
        location: shareLocation && consent && coords ? coords : undefined,
        idempotencyKey: `${category}:${appointmentId || "none"}:${Date.now().toString(36)}`,
      };
      const result = await api.teamCreateRequest(body);
      localStorage.removeItem(DRAFT_KEY);
      toast.success(result?.duplicate ? "Request already submitted" : "Help request sent");
      nav(teamPath(role, `requests/${result.request.id}`));
    } catch (err) {
      toast.error(apiError(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mx-auto max-w-3xl space-y-5" data-testid="team-help">
      <ModuleNavigation items={teamNavFor(role)} testid="team-module-nav" />
      <div>
        <p className="nb-eyebrow">Team Connect</p>
        <h1 className="text-3xl font-semibold tracking-tight">Quick Help</h1>
        <p className="mt-1 text-sm text-nb-mute">Routes to on-duty staff first, then authorized backup. Not bookability.</p>
      </div>

      {!category && (
        <div className="grid grid-cols-2 gap-3" data-testid="team-help-grid">
          {QUICK_HELP_CATEGORIES.map((cat) => {
            const Icon = ICONS[cat.id] || HelpCircle;
            return (
              <button
                key={cat.id}
                type="button"
                onClick={() => setCategory(cat.id)}
                className="nb-card flex flex-col gap-2 p-4 text-left transition-colors hover:border-nb-sky"
                data-testid={`team-help-card-${cat.id}`}
              >
                <Icon className="h-5 w-5 text-nb-navy" aria-hidden="true" />
                <p className="text-sm font-semibold text-nb-ink">{cat.title}</p>
                <p className="text-xs text-nb-mute">{cat.detail}</p>
              </button>
            );
          })}
        </div>
      )}

      {category && (
        <div className="space-y-4" data-testid="team-help-form">
          <button type="button" className="text-sm font-semibold text-nb-blue" onClick={() => setCategory("")}>← Categories</button>
          <div className="nb-card space-y-4 p-5">
            <p className="font-semibold">{selected?.title}</p>
            {category === "safety_concern" && (
              <div className="rounded-2xl bg-rose-50 p-4 text-sm text-rose-900" data-testid="team-help-safety-banner">
                <p className="font-semibold"><AlertTriangle className="mr-1 inline h-4 w-4" />Emergency?</p>
                <p className="mt-1 text-xs">Call 911 first from the visit Safety Center. This form never delays emergency action for an escalation timer.</p>
                {role === "pro" && <Link to="/pro" className="mt-2 inline-block font-semibold text-nb-blue">Open Today / visit Safety Center</Link>}
              </div>
            )}
            <label className="block text-sm">
              <span className="nb-label">Related visit (optional)</span>
              <select className="nb-input" value={appointmentId} onChange={(e) => setAppointmentId(e.target.value)} data-testid="team-help-appointment">
                <option value="">None</option>
                {visits.map((row) => (
                  <option key={row.id} value={row.id}>{row.ref} · {row.date} {row.time}</option>
                ))}
              </select>
            </label>
            {category === "running_late" && (
              <div data-testid="team-help-delay-minutes">
                <p className="nb-label">Estimated delay</p>
                <div className="mt-1 flex flex-wrap gap-2">
                  {[5, 10, 15, 20, 30].map((value) => (
                    <button
                      key={value}
                      type="button"
                      className={delayMinutes === value ? "nb-chip-on" : "nb-chip-off"}
                      onClick={() => setDelayMinutes(value)}
                      data-testid={`team-help-delay-${value}`}
                    >
                      {value} min
                    </button>
                  ))}
                </div>
                <p className="mt-2 text-xs text-nb-mute">Desk can draft an in-app client update from the request. No SMS from Quick Help.</p>
              </div>
            )}
            <label className="block text-sm">
              <span className="nb-label">Details {category === "other" ? "(required)" : "(optional)"}</span>
              <textarea
                className="nb-input min-h-[96px] py-3"
                maxLength={1000}
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder={category === "running_late" ? `Running about ${delayMinutes} minutes late…` : "What do you need?"}
                data-testid="team-help-note"
              />
            </label>
            <div className="rounded-2xl bg-sky-50 p-4 text-sm" data-testid="team-help-location">
              <p className="font-semibold text-nb-ink">Share location for this request?</p>
              <p className="mt-1 text-xs text-nb-mute">Off by default. Consent is only for this request. You can submit without it.</p>
              <div className="mt-3 flex flex-wrap gap-2">
                <button type="button" className="nb-btn-ghost h-10 text-xs" onClick={requestLocation} data-testid="team-help-locate">Use current location</button>
                {shareLocation && coords && (
                  <label className="flex items-center gap-2 text-xs">
                    <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} data-testid="team-help-consent" />
                    I consent to share this location with authorized responders for this request only
                  </label>
                )}
              </div>
            </div>
            <button type="button" disabled={busy || (category === "other" && !note.trim())} onClick={submit} className="nb-btn-primary h-12 w-full" data-testid="team-help-submit">
              Send to on-duty staff
            </button>
          </div>
        </div>
      )}

      <Link to={teamPath(role)} className="block text-sm text-nb-mute">Back to Team Connect</Link>
    </div>
  );
}
