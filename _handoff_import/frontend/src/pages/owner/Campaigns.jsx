import { useEffect, useMemo, useState } from "react";
import { MoreHorizontal, Plus, Search } from "lucide-react";
import { toast } from "sonner";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { useDemo } from "@/store/DemoStore";
import { money } from "@/lib/domain";

const EMPTY = {
  title: "", description: "", serviceSlug: "", bookingStart: "", bookingEnd: "",
  windowStart: "14:00", windowEnd: "17:00", expiresLocal: "", discountPercent: 20, maxRedemptions: 5,
  perClientLimit: 1, audience: "all", minDuration: 60, public: true, stackable: false, code: "",
};
const FILTERS = ["all", "draft", "scheduled", "active", "completed", "archived"];
const STEPS = ["Details", "Offer", "Schedule", "Audience", "Review"];

function edmontonLabel(value) {
  if (!value) return "—";
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Edmonton", dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
}

function toEdmontonInput(value) {
  if (!value) return "";
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Edmonton", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(new Date(value));
  const read = (type) => parts.find((part) => part.type === type)?.value || "";
  const hour = read("hour") === "24" ? "00" : read("hour");
  return `${read("year")}-${read("month")}-${read("day")}T${hour}:${read("minute")}`;
}

function edmontonToUtc(value) {
  if (!value) return "";
  const [date, time] = value.split("T");
  const [year, month, day] = date.split("-").map(Number);
  const [hour, minute] = time.split(":").map(Number);
  const desired = Date.UTC(year, month - 1, day, hour, minute);
  let guess = desired;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Edmonton", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(new Date(guess));
    const read = (type) => Number(parts.find((part) => part.type === type)?.value || 0);
    const shown = Date.UTC(read("year"), read("month") - 1, read("day"), read("hour") === 24 ? 0 : read("hour"), read("minute"));
    guess += desired - shown;
  }
  return new Date(guess).toISOString();
}

function displayStatus(row) {
  if (row.status === "archived" || row.status === "cancelled") return "archived";
  if (row.status === "live" && row.expiresAt && new Date(row.expiresAt).getTime() <= Date.now()) return "completed";
  if (row.status === "live") return "active";
  if (row.status === "draft" && row.publishAt && new Date(row.publishAt).getTime() > Date.now()) return "scheduled";
  return "draft";
}

export default function Campaigns() {
  const { api, state } = useDemo();
  const [rows, setRows] = useState([]);
  const [sending, setSending] = useState(false);
  const [metrics, setMetrics] = useState(null);
  const [filter, setFilter] = useState("all");
  const [query, setQuery] = useState("");
  const [editor, setEditor] = useState(null);
  const [step, setStep] = useState(0);
  const [menu, setMenu] = useState(null);
  const [preview, setPreview] = useState(null);
  const [performance, setPerformance] = useState(false);
  const services = state.services || [];
  const serviceName = (slug) => services.find((item) => item.slug === slug)?.name || (slug === "all" ? "All services" : slug || "No service");

  const load = async () => {
    const [campaigns, analytics] = await Promise.all([api.campaigns(), api.marketingAnalytics()]);
    setRows(campaigns.campaigns || []);
    setSending(Boolean(campaigns.promotionalSending));
    setMetrics(analytics);
  };
  useEffect(() => { load().catch((error) => toast.error(error?.response?.data?.detail || "Campaigns could not be loaded")); }, []); // eslint-disable-line

  const visible = useMemo(() => rows.filter((row) => {
    const status = displayStatus(row);
    const matches = filter === "all" || status === filter || (filter === "draft" && row.status === "paused");
    const text = `${row.title} ${serviceName(row.serviceSlug)}`.toLowerCase();
    return matches && text.includes(query.trim().toLowerCase());
  }), [rows, filter, query, services]);

  const openNew = () => {
    setEditor({ ...EMPTY, serviceSlug: services[0]?.slug || "" });
    setStep(0);
  };
  const openEdit = (row) => {
    setEditor({
      ...EMPTY,
      ...row,
      expiresLocal: toEdmontonInput(row.expiresAt),
    });
    setStep(0);
    setMenu(null);
  };
  const payload = (form) => ({
    ...form,
    bookingEnd: form.bookingEnd || form.bookingStart,
    expiresAt: edmontonToUtc(form.expiresLocal),
    publishAt: new Date().toISOString(),
    sendNow: false,
  });
  const save = async () => {
    const form = editor;
    if (!form.title || !form.serviceSlug || !form.bookingStart || !form.expiresLocal) {
      toast.error("Add a name, service, appointment date, and expiration.");
      return;
    }
    try {
      const body = payload(form);
      if (form.id) await api.updateCampaign(form.id, body);
      else await api.saveCampaign(body);
      toast.success(form.id ? "Campaign updated." : "Campaign saved as a draft.");
      setEditor(null);
      await load();
    } catch (error) {
      toast.error(error?.response?.data?.detail || "The campaign was not saved");
    }
  };
  const setStatus = async (id, status) => {
    try { await api.campaignStatus(id, status); setMenu(null); await load(); }
    catch (error) { toast.error(error?.response?.data?.detail || "The campaign was not updated"); }
  };
  const duplicate = async (id) => {
    try { await api.duplicateCampaign(id); setMenu(null); toast.success("Draft copy saved."); await load(); }
    catch (error) { toast.error(error?.response?.data?.detail || "The campaign was not copied"); }
  };
  const priceFor = (form) => {
    const service = services.find((item) => item.slug === form.serviceSlug);
    const prices = service?.prices || {};
    const base = Number(prices[form.minDuration] || prices[60] || Object.values(prices)[0] || 0);
    return { base, offer: Math.round(base * (100 - Number(form.discountPercent || 0))) / 100 };
  };

  return (
    <div className="mx-auto max-w-5xl space-y-5 px-1 py-2" data-testid="campaign-manager">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="nb-eyebrow">Flash booking</p>
          <h1 className="text-3xl font-semibold tracking-tight">Flash Campaigns</h1>
          <p className="mt-1 text-sm text-nb-mute" data-testid="campaign-sending">{sending ? "Promotional sending is on." : "Promotional sending is off. A live campaign can be booked in the app, and no commercial message is sent."}</p>
        </div>
        <button type="button" className="nb-btn-primary h-11 px-4" onClick={openNew} data-testid="campaign-create"><Plus className="h-4 w-4" />Create campaign</button>
      </header>
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex gap-1 overflow-x-auto" role="tablist" aria-label="Campaign status">
          {FILTERS.map((item) => <button key={item} type="button" role="tab" aria-selected={filter === item} className={`rounded-full px-3 py-2 text-xs font-semibold capitalize ${filter === item ? "bg-nb-ink text-white" : "bg-white text-nb-mute ring-1 ring-sky-100"}`} onClick={() => setFilter(item)} data-testid={`campaign-filter-${item}`}>{item}</button>)}
        </div>
        <label className="relative min-w-[180px] flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-nb-mute" />
          <input className="nb-input h-11 pl-9" placeholder="Search campaigns" value={query} onChange={(event) => setQuery(event.target.value)} aria-label="Search campaigns" data-testid="campaign-search" />
        </label>
      </div>
      {!visible.length && <p className="rounded-3xl bg-white p-6 text-sm text-nb-mute ring-1 ring-sky-100" data-testid="campaign-empty">{rows.length ? "No campaigns match this filter." : "No flash campaigns yet. Create one when you are ready to offer a limited booking window."}</p>}
      <div className="grid gap-3">
        {visible.map((row) => {
          const status = displayStatus(row);
          return (
            <article key={row.id} className="rounded-3xl bg-white p-4 shadow-sm ring-1 ring-sky-100" data-testid={`campaign-${row.id}`}>
              <div className="flex items-start gap-3">
                <div className="min-w-0 flex-1">
                  <p className="font-semibold">{row.title}</p>
                  <p className="text-sm text-nb-mute">{serviceName(row.serviceSlug)} · {row.discountPercent}% off the treatment</p>
                  <p className="mt-1 text-sm">Appointment {row.bookingStart} · {row.windowStart}–{row.windowEnd} Edmonton</p>
                  <p className="text-sm text-nb-mute">Expires {edmontonLabel(row.expiresAt)} · {row.redemptions || 0} booked of {row.maxRedemptions}</p>
                </div>
                <span className="rounded-full bg-sky-50 px-3 py-1 text-xs font-semibold capitalize">{row.status === "paused" ? "paused" : status}</span>
                <button type="button" className="nb-btn-ghost h-10 w-10 px-0" aria-label={`Actions for ${row.title}`} data-testid={`campaign-actions-${row.id}`} onClick={() => setMenu(row)}><MoreHorizontal className="h-4 w-4" /></button>
              </div>
            </article>
          );
        })}
      </div>
      <button type="button" className="text-sm font-semibold text-nb-blue" onClick={() => setPerformance((value) => !value)} data-testid="campaign-performance-toggle">{performance ? "Hide performance" : "Campaign performance"}</button>
      {performance && metrics && (
        <section className="rounded-3xl bg-white p-5 ring-1 ring-sky-100" data-testid="marketing-analytics">
          <p className="font-semibold">Recorded campaign results</p>
          <p className="mt-1 text-sm text-nb-mute">{metrics.campaignBookings} campaign bookings · discount cost ${metrics.discountCost} · gross ${metrics.grossRevenue}</p>
          <p className="text-sm text-nb-mute">{metrics.recovered} recovered openings · conversion {metrics.conversion}</p>
        </section>
      )}

      {menu && (
        <div className="fixed inset-x-0 bottom-0 z-50 rounded-t-3xl bg-white p-4 shadow-2xl ring-1 ring-sky-100 md:inset-auto md:right-6 md:top-24 md:w-64 md:rounded-3xl" data-testid="campaign-action-menu">
          <p className="mb-2 font-semibold">{menu.title}</p>
          {[["View", () => { setPreview(menu); setMenu(null); }], ["Edit", () => openEdit(menu)], ["Duplicate", () => duplicate(menu.id)], ["Preview", () => { setPreview(menu); setMenu(null); }]].map(([label, action]) => <button key={label} type="button" className="block w-full rounded-2xl px-3 py-3 text-left text-sm font-semibold hover:bg-sky-50" onClick={action}>{label}</button>)}
          {menu.status !== "live" && menu.status !== "archived" && <button type="button" className="block w-full rounded-2xl px-3 py-3 text-left text-sm font-semibold hover:bg-sky-50" onClick={() => setStatus(menu.id, "live")}>Activate</button>}
          {menu.status === "live" && <button type="button" className="block w-full rounded-2xl px-3 py-3 text-left text-sm font-semibold hover:bg-sky-50" onClick={() => setStatus(menu.id, "paused")}>Deactivate</button>}
          {menu.status !== "archived" && <button type="button" className="block w-full rounded-2xl px-3 py-3 text-left text-sm font-semibold hover:bg-sky-50" onClick={() => setStatus(menu.id, "archived")}>Archive</button>}
          <button type="button" className="mt-1 text-sm text-nb-mute" onClick={() => setMenu(null)}>Close</button>
        </div>
      )}

      <Sheet open={!!editor} onOpenChange={(open) => { if (!open) setEditor(null); }}>
        <SheetContent side="right" className="w-full overflow-y-auto sm:max-w-lg" data-testid="campaign-editor">
          <SheetTitle>{editor?.id ? "Edit campaign" : "Create campaign"}</SheetTitle>
          {editor && (
            <div className="mt-4 space-y-4">
              <div className="flex gap-1" aria-label="Campaign steps">
                {STEPS.map((label, index) => <button key={label} type="button" className={`rounded-full px-2 py-1 text-[11px] font-semibold ${step === index ? "bg-nb-ink text-white" : "text-nb-mute"}`} onClick={() => setStep(index)}>{label}</button>)}
              </div>
              {step === 0 && <div className="space-y-3">
                <label className="block text-sm">Campaign name<input className="nb-input" value={editor.title} onChange={(event) => setEditor({ ...editor, title: event.target.value })} data-testid="campaign-title" /></label>
                <label className="block text-sm">Description<textarea className="nb-input h-auto py-3" value={editor.description} onChange={(event) => setEditor({ ...editor, description: event.target.value })} /></label>
              </div>}
              {step === 1 && <div className="space-y-3">
                <label className="block text-sm">Service
                  <select className="nb-input" value={editor.serviceSlug} onChange={(event) => setEditor({ ...editor, serviceSlug: event.target.value })} data-testid="campaign-service">
                    {services.map((service) => <option key={service.slug} value={service.slug}>{service.name}</option>)}
                  </select>
                </label>
                <label className="block text-sm">Discount percent<input className="nb-input" type="number" min="1" max="80" value={editor.discountPercent} onChange={(event) => setEditor({ ...editor, discountPercent: Number(event.target.value) })} data-testid="campaign-discount" /></label>
                <label className="block text-sm">Minimum duration (minutes)<input className="nb-input" type="number" min="30" step="15" value={editor.minDuration} onChange={(event) => setEditor({ ...editor, minDuration: Number(event.target.value) })} /></label>
                <p className="text-sm text-nb-mute">Treatment price {money(priceFor(editor).base)} · with this offer {money(priceFor(editor).offer)}. Travel and GST stay separate.</p>
              </div>}
              {step === 2 && <div className="space-y-3">
                <label className="block text-sm">Appointment date, Edmonton<input className="nb-input" type="date" value={editor.bookingStart} onChange={(event) => setEditor({ ...editor, bookingStart: event.target.value, bookingEnd: event.target.value })} data-testid="campaign-date" /></label>
                <label className="block text-sm">Window start<input className="nb-input" type="time" value={editor.windowStart} onChange={(event) => setEditor({ ...editor, windowStart: event.target.value })} /></label>
                <label className="block text-sm">Window end<input className="nb-input" type="time" value={editor.windowEnd} onChange={(event) => setEditor({ ...editor, windowEnd: event.target.value })} /></label>
                <label className="block text-sm">Offer expires, Edmonton<input className="nb-input" type="datetime-local" value={editor.expiresLocal} onChange={(event) => setEditor({ ...editor, expiresLocal: event.target.value })} data-testid="campaign-expires" /></label>
                <label className="block text-sm">Booking capacity<input className="nb-input" type="number" min="1" value={editor.maxRedemptions} onChange={(event) => setEditor({ ...editor, maxRedemptions: Number(event.target.value) })} /></label>
              </div>}
              {step === 3 && <div className="space-y-3">
                <label className="block text-sm">Who can book
                  <select className="nb-input" value={editor.audience} onChange={(event) => setEditor({ ...editor, audience: event.target.value })}>
                    <option value="all">All eligible clients</option>
                    <option value="new">New clients</option>
                    <option value="returning">Returning clients</option>
                  </select>
                </label>
                <label className="block text-sm">Uses per client<input className="nb-input" type="number" min="1" value={editor.perClientLimit} onChange={(event) => setEditor({ ...editor, perClientLimit: Number(event.target.value) })} /></label>
              </div>}
              {step === 4 && <div className="space-y-2 rounded-3xl bg-sky-50 p-4 text-sm" data-testid="campaign-review">
                <p className="text-lg font-semibold">{editor.title || "Untitled campaign"}</p>
                <p>{serviceName(editor.serviceSlug)} · {editor.discountPercent}% off</p>
                <p>Treatment {money(priceFor(editor).base)} → {money(priceFor(editor).offer)}</p>
                <p>Appointments {editor.bookingStart || "date not set"} · {editor.windowStart}–{editor.windowEnd} Edmonton</p>
                <p>Expires {editor.expiresLocal ? edmontonLabel(edmontonToUtc(editor.expiresLocal)) : "not set"} · {editor.maxRedemptions} spots</p>
                <p className="text-xs text-nb-mute">This preview uses the values in this draft. It does not create a booking.</p>
              </div>}
              <div className="flex gap-2">
                {step > 0 && <button type="button" className="nb-btn-ghost h-11 px-4" onClick={() => setStep(step - 1)}>Back</button>}
                {step < 4 && <button type="button" className="nb-btn-primary h-11 px-4" onClick={() => setStep(step + 1)} data-testid="campaign-next">Continue</button>}
                {step === 4 && <button type="button" className="nb-btn-primary h-11 px-4" onClick={save} data-testid="campaign-save">{editor.id ? "Save changes" : "Save draft"}</button>}
              </div>
            </div>
          )}
        </SheetContent>
      </Sheet>

      <Sheet open={!!preview} onOpenChange={(open) => { if (!open) setPreview(null); }}>
        <SheetContent side="right" className="w-full overflow-y-auto sm:max-w-lg" data-testid="campaign-preview">
          <SheetTitle>Customer preview</SheetTitle>
          {preview && <div className="mt-4 space-y-2 text-sm">
            <p className="text-2xl font-semibold">{preview.title}</p>
            <p>{serviceName(preview.serviceSlug)}</p>
            <p>{preview.discountPercent}% off the treatment price. Travel and GST are calculated separately.</p>
            <p>Valid for appointments on {preview.bookingStart}, {preview.windowStart}–{preview.windowEnd} Edmonton.</p>
            <p>Offer expires {edmontonLabel(preview.expiresAt)}.</p>
            <p>{preview.audience === "all" ? "Open to eligible clients." : preview.audience === "new" ? "New clients only." : "Returning clients only."}</p>
            <p className="text-xs text-nb-mute">{preview.redemptions || 0} recorded redemptions. No estimated performance is shown.</p>
          </div>}
        </SheetContent>
      </Sheet>
    </div>
  );
}
