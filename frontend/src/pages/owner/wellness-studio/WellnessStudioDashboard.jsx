import { Link } from "react-router-dom";
import { toast } from "sonner";
import {
  Building2,
  CalendarDays,
  FileImage,
  Megaphone,
  Plus,
  Sparkles,
  Activity,
} from "lucide-react";
import { PageHeader, Notice, StatusBadge, Reveal, IconTile } from "@/components/tide";
import { DemoTag, Pill } from "@/components/ui-kit";
import { WellnessStudioNav } from "@/components/wellness/WellnessStudioNav";
import { getWellnessStudioDashboard, WELLNESS_STUDIO_DEMO } from "@/fixtures/wellnessStudio";

const PHASE_NOTE = "Available in a later Wellness Studio page. Nothing is sent or published from Overview.";

function soon(label) {
  toast.message(label, { description: PHASE_NOTE });
}

function formatWhen(iso) {
  if (!iso) return "—";
  try {
    return new Intl.DateTimeFormat("en-CA", {
      timeZone: "America/Edmonton",
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    }).format(new Date(iso));
  } catch {
    return iso;
  }
}

function formatDate(value) {
  if (!value) return "—";
  try {
    return new Intl.DateTimeFormat("en-CA", {
      timeZone: "America/Edmonton",
      month: "short",
      day: "numeric",
      year: "numeric",
    }).format(new Date(`${value}T12:00:00`));
  } catch {
    return value;
  }
}

function statusTone(status) {
  const key = String(status || "").toLowerCase();
  if (key === "active" || key === "confirmed" || key === "ready" || key === "event booked") return "success";
  if (key === "draft" || key === "planning" || key === "new lead" || key === "warm lead") return "warn";
  if (key === "proposal sent") return "info";
  return "neutral";
}

export default function WellnessStudioDashboard() {
  const data = getWellnessStudioDashboard();
  const { summary } = data;

  return (
    <div className="mx-auto max-w-6xl space-y-5" data-testid="wellness-studio-dashboard">
      <PageHeader
        eyebrow="Corporate Wellness Studio"
        title="Overview"
        sub="Promote mobile massage and workplace wellness to Edmonton employers. Synthetic demo data only — no emails, publishes, or clinical records."
        right={<DemoTag>{WELLNESS_STUDIO_DEMO ? "Synthetic demo" : "Live"}</DemoTag>}
      />

      <WellnessStudioNav />

      <Reveal>
        <div
          className="relative overflow-hidden rounded-[1.75rem] bg-gradient-to-br from-[#0B2E8A] via-[#1565F0] to-[#14D8C4] p-5 text-white shadow-sm sm:p-6"
          data-testid="wellness-studio-hero"
        >
          <div className="pointer-events-none absolute -right-8 -top-10 h-40 w-40 rounded-full bg-white/15 blur-2xl" aria-hidden="true" />
          <div className="pointer-events-none absolute -bottom-12 left-1/3 h-36 w-36 rounded-full bg-[#14D8C4]/30 blur-2xl" aria-hidden="true" />
          <div className="relative flex min-w-0 flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
            <div className="min-w-0 max-w-xl">
              <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-white/75">Edmonton workplace wellness</p>
              <h2 className="mt-1 font-display text-2xl font-normal italic tracking-tight sm:text-3xl">
                Welcome teams back to calm
              </h2>
              <p className="mt-2 text-sm leading-relaxed text-white/85">
                Campaigns, assets, employer leads, and on-site events — kept separate from clinical administration.
              </p>
            </div>
            <div className="grid grid-cols-2 gap-2 sm:min-w-[14rem]" data-testid="wellness-studio-kpis">
              <Kpi label="Campaigns" value={summary.activeCampaigns} />
              <Kpi label="Open leads" value={summary.openLeads} />
              <Kpi label="Assets" value={summary.draftAssets} />
              <Kpi label="Events" value={summary.upcomingEvents} />
            </div>
          </div>
        </div>
      </Reveal>

      <Notice tone="off" testid="wellness-studio-safe-notice">
        Demonstration workspace. Quick actions do not send outreach, publish campaigns, create appointments, or open patient charts.
      </Notice>

      <section aria-label="Quick actions" data-testid="wellness-studio-quick-actions">
        <SectionTitle title="Quick actions" />
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <IconTile
            icon={Megaphone}
            label="New Campaign"
            sub="Draft only · later page"
            tint="tint-ice"
            testid="ws-action-campaign"
            onClick={() => soon("New Campaign")}
          />
          <IconTile
            icon={FileImage}
            label="Create Asset"
            sub="Library coming next"
            tint="tint-mint"
            iconClass="text-nb-teal"
            testid="ws-action-asset"
            onClick={() => soon("Create Asset")}
          />
          <IconTile
            icon={Building2}
            label="Add Organization"
            sub="Employer lead"
            tint="tint-lagoon"
            testid="ws-action-org"
            onClick={() => soon("Add Organization")}
          />
          <IconTile
            icon={CalendarDays}
            label="Create Event"
            sub="On-site day"
            tint="tint-meadow"
            iconClass="text-nb-teal"
            testid="ws-action-event"
            onClick={() => soon("Create Event")}
          />
        </div>
      </section>

      <div className="grid gap-4 lg:grid-cols-2">
        <Reveal i={1}>
          <section className="nb-card flex h-full min-w-0 flex-col p-4 sm:p-5" data-testid="ws-section-campaigns" aria-labelledby="ws-campaigns-heading">
            <SectionHead id="ws-campaigns-heading" icon={Megaphone} title="Active campaigns" meta={`${data.campaigns.filter((row) => row.status === "active").length} live · demo`} />
            <ul className="mt-3 flex-1 space-y-2.5">
              {data.campaigns.map((row) => (
                <li key={row.id} className="rounded-2xl bg-sky-50/70 px-3.5 py-3" data-testid={row.id}>
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold text-nb-ink">{row.name}</p>
                      <p className="mt-0.5 text-xs text-nb-mute">{row.audience}</p>
                      <p className="mt-1 text-xs text-nb-ink/80">{row.offer}</p>
                    </div>
                    <StatusBadge tone={statusTone(row.status)} testid={`${row.id}-status`}>{row.status}</StatusBadge>
                  </div>
                  <p className="mt-2 text-[11px] text-nb-mute">
                    {row.orgs ? `${row.orgs} organizations` : "No orgs yet"}
                    {row.nextTouch ? ` · next touch ${formatDate(row.nextTouch)}` : ""}
                  </p>
                </li>
              ))}
            </ul>
          </section>
        </Reveal>

        <Reveal i={2}>
          <section className="nb-card flex h-full min-w-0 flex-col p-4 sm:p-5" data-testid="ws-section-assets" aria-labelledby="ws-assets-heading">
            <SectionHead id="ws-assets-heading" icon={FileImage} title="Marketing assets" meta={`${data.assets.length} items · demo`} />
            <ul className="mt-3 flex-1 divide-y divide-sky-50">
              {data.assets.map((row) => (
                <li key={row.id} className="flex min-w-0 items-center justify-between gap-3 py-2.5" data-testid={row.id}>
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold text-nb-ink">{row.name}</p>
                    <p className="text-xs text-nb-mute">{row.kind} · updated {formatDate(row.updated)}</p>
                  </div>
                  <Pill tone={row.status === "ready" ? "turq" : "amber"} testid={`${row.id}-status`}>{row.status}</Pill>
                </li>
              ))}
            </ul>
          </section>
        </Reveal>

        <Reveal i={3}>
          <section className="nb-card flex h-full min-w-0 flex-col p-4 sm:p-5" data-testid="ws-section-orgs" aria-labelledby="ws-orgs-heading">
            <SectionHead id="ws-orgs-heading" icon={Building2} title="Organization leads" meta={`${data.organizations.length} employers · demo`} />
            <ul className="mt-3 flex-1 space-y-2.5">
              {data.organizations.map((row) => (
                <li key={row.id} className="rounded-2xl ring-1 ring-sky-100 px-3.5 py-3" data-testid={row.id}>
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold text-nb-ink">{row.name}</p>
                      <p className="text-xs text-nb-mute">{row.industry} · {row.city} · {row.employees}</p>
                      <p className="mt-1 text-xs text-nb-mute">Contact {row.contact}</p>
                    </div>
                    <StatusBadge tone={statusTone(row.stage)} testid={`${row.id}-stage`}>{row.stage}</StatusBadge>
                  </div>
                </li>
              ))}
            </ul>
          </section>
        </Reveal>

        <Reveal i={4}>
          <section className="nb-card flex h-full min-w-0 flex-col p-4 sm:p-5" data-testid="ws-section-events" aria-labelledby="ws-events-heading">
            <SectionHead id="ws-events-heading" icon={CalendarDays} title="Upcoming corporate events" meta={`${data.events.length} scheduled · demo`} />
            <ul className="mt-3 flex-1 space-y-2.5">
              {data.events.map((row) => (
                <li key={row.id} className="rounded-2xl bg-teal-50/50 px-3.5 py-3" data-testid={row.id}>
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold text-nb-ink">{row.name}</p>
                      <p className="mt-0.5 text-xs text-nb-mute">
                        {formatDate(row.date)} · {row.time}
                      </p>
                      <p className="text-xs text-nb-mute">{row.place} · {row.seats} seats</p>
                    </div>
                    <StatusBadge tone={statusTone(row.status)} testid={`${row.id}-status`}>{row.status}</StatusBadge>
                  </div>
                </li>
              ))}
            </ul>
          </section>
        </Reveal>
      </div>

      <Reveal i={5}>
        <section className="nb-card p-4 sm:p-5" data-testid="ws-section-activity" aria-labelledby="ws-activity-heading">
          <SectionHead id="ws-activity-heading" icon={Activity} title="Recent activity" meta="Synthetic timeline" />
          <ol className="mt-3 space-y-3">
            {data.activity.map((row) => (
              <li key={row.id} className="flex gap-3" data-testid={row.id}>
                <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-nb-turq" aria-hidden="true" />
                <div className="min-w-0">
                  <p className="text-sm text-nb-ink">{row.text}</p>
                  <p className="text-[11px] text-nb-mute">{formatWhen(row.at)}</p>
                </div>
              </li>
            ))}
          </ol>
        </section>
      </Reveal>

      <Reveal i={6}>
        <section className="nb-soft rounded-[1.5rem] p-4 sm:p-5" data-testid="ws-section-integrations" aria-labelledby="ws-integrations-heading">
          <div className="flex items-start gap-2">
            <Sparkles className="mt-0.5 h-4 w-4 shrink-0 text-nb-teal" aria-hidden="true" />
            <div className="min-w-0">
              <h2 id="ws-integrations-heading" className="text-sm font-semibold text-nb-ink">Prepared integrations</h2>
              <p className="mt-1 text-xs text-nb-mute">
                This studio will connect to the public marketing landing and employee engage experience without duplicating bookings, identity, or billing.
              </p>
              <ul className="mt-3 flex flex-wrap gap-2">
                {data.integrations.map((item) => (
                  <li key={item.id}>
                    {item.id === "engage" ? (
                      <Link to="/engage?mode=phone" data-testid={`ws-integration-${item.id}`}>
                        <Pill tone="turq">
                          {item.label}: {item.target} ({item.status})
                        </Pill>
                      </Link>
                    ) : (
                      <Pill tone={item.status === "reuse" ? "turq" : "slate"} testid={`ws-integration-${item.id}`}>
                        {item.label}: {item.target}
                      </Pill>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </section>
      </Reveal>
    </div>
  );
}

function Kpi({ label, value }) {
  return (
    <div className="rounded-2xl bg-white/15 px-3 py-2 backdrop-blur-sm">
      <p className="text-[10px] font-semibold uppercase tracking-wide text-white/70">{label}</p>
      <p className="nb-num text-xl font-semibold">{value}</p>
    </div>
  );
}

function SectionTitle({ title }) {
  return <p className="nb-eyebrow mb-2.5">{title}</p>;
}

function SectionHead({ id, icon: Icon, title, meta }) {
  return (
    <div className="flex min-w-0 items-start justify-between gap-3">
      <div className="flex min-w-0 items-center gap-2.5">
        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-2xl tint-ice">
          <Icon className="h-4 w-4 text-nb-blue" aria-hidden="true" />
        </span>
        <div className="min-w-0">
          <h2 id={id} className="text-sm font-semibold text-nb-ink sm:text-base">{title}</h2>
          {meta && <p className="text-[11px] text-nb-mute">{meta}</p>}
        </div>
      </div>
      <span className="hidden sm:inline-flex items-center gap-1 text-[11px] font-semibold text-nb-mute">
        <Plus className="h-3 w-3" aria-hidden="true" /> Review only
      </span>
    </div>
  );
}
