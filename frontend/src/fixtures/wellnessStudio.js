/**
 * Synthetic demonstration data for NabiTouch Corporate Wellness Studio.
 * No production employers, campaigns, or clinical records.
 * Future integrations (not wired here): /corporate-wellness, engage.nabitouch.com,
 * existing identity / bookings / availability / billing services.
 */

export const WELLNESS_STUDIO_DEMO = true;

export const WELLNESS_STUDIO_NAV = [
  { to: "/owner/wellness-studio", label: "Overview", end: true },
  { to: "/owner/wellness-studio/campaigns", label: "Campaigns" },
  { to: "/owner/wellness-studio/assets", label: "Asset Library" },
  { to: "/owner/wellness-studio/organizations", label: "Organizations" },
  { to: "/owner/wellness-studio/events", label: "Events" },
  { to: "/owner/wellness-studio/outreach", label: "Outreach" },
  { to: "/owner/wellness-studio/analytics", label: "Analytics" },
];

export const WELLNESS_STUDIO_SECTIONS = {
  campaigns: { title: "Campaigns", blurb: "Plan workplace wellness campaigns without publishing or sending email yet." },
  assets: { title: "Asset Library", blurb: "Brochures, posters, and digital kits for Edmonton employers." },
  organizations: { title: "Organizations", blurb: "Employer leads and accounts — separate from clinical patient records." },
  events: { title: "Events", blurb: "On-site chair massage days and wellness fairs." },
  outreach: { title: "Outreach", blurb: "Sequences stay draft-only until sending is separately authorized." },
  analytics: { title: "Analytics", blurb: "Campaign and event performance once live data is connected." },
};

export const wellnessStudioDashboard = {
  generatedAt: "2026-10-30T18:00:00-06:00",
  label: "Synthetic demonstration",
  summary: {
    activeCampaigns: 2,
    draftAssets: 5,
    openLeads: 4,
    upcomingEvents: 3,
  },
  campaigns: [
    {
      id: "ws-camp-spring-desk",
      name: "Desk Relief Spring Series",
      status: "active",
      audience: "Tech & professional offices",
      offer: "On-site chair massage intro day",
      orgs: 3,
      nextTouch: "2026-11-04",
    },
    {
      id: "ws-camp-winter-reset",
      name: "Winter Reset for Teams",
      status: "active",
      audience: "Healthcare & nonprofit HR",
      offer: "Mobile wellness afternoon package",
      orgs: 2,
      nextTouch: "2026-11-12",
    },
    {
      id: "ws-camp-draft-open-house",
      name: "Employer Open House (draft)",
      status: "draft",
      audience: "New leads · downtown Edmonton",
      offer: "Complimentary 10-min chair samples",
      orgs: 0,
      nextTouch: null,
    },
  ],
  assets: [
    { id: "ws-asset-flyer", name: "Chair massage day flyer", kind: "PDF", status: "ready", updated: "2026-10-22" },
    { id: "ws-asset-deck", name: "HR benefits one-pager", kind: "PDF", status: "ready", updated: "2026-10-18" },
    { id: "ws-asset-email", name: "Warm intro email kit", kind: "Copy", status: "draft", updated: "2026-10-28" },
    { id: "ws-asset-poster", name: "Lobby poster · square", kind: "Image", status: "ready", updated: "2026-10-12" },
    { id: "ws-asset-reel", name: "30s wellness reel script", kind: "Script", status: "draft", updated: "2026-10-29" },
  ],
  organizations: [
    { id: "ws-org-aurora", name: "Aurora North Consulting", industry: "Professional services", contact: "Priya N.", stage: "Warm lead", employees: "80–120", city: "Edmonton" },
    { id: "ws-org-riverbend", name: "Riverbend Health Co-op", industry: "Healthcare", contact: "Marcus L.", stage: "Proposal sent", employees: "200+", city: "Edmonton" },
    { id: "ws-org-summit", name: "Summit Legal LLP", industry: "Legal", contact: "Elena V.", stage: "New lead", employees: "40–60", city: "Edmonton" },
    { id: "ws-org-clearsky", name: "ClearSky Energy Ops", industry: "Energy", contact: "Jordan K.", stage: "Event booked", employees: "150–200", city: "Sherwood Park" },
  ],
  events: [
    { id: "ws-evt-aurora", name: "Aurora · Chair massage day", date: "2026-11-06", time: "11:00–15:00", place: "Downtown office", status: "confirmed", seats: 28 },
    { id: "ws-evt-clearsky", name: "ClearSky wellness afternoon", date: "2026-11-14", time: "13:00–16:00", place: "Sherwood Park HQ", status: "confirmed", seats: 36 },
    { id: "ws-evt-open", name: "Employer open-house samples", date: "2026-11-20", time: "16:00–18:00", place: "NabiTouch pop-up", status: "planning", seats: 20 },
  ],
  activity: [
    { id: "ws-act-1", at: "2026-10-30T14:20:00-06:00", text: "Draft asset “Warm intro email kit” saved (demo).", tone: "neutral" },
    { id: "ws-act-2", at: "2026-10-29T16:05:00-06:00", text: "Riverbend Health Co-op marked Proposal sent (demo).", tone: "info" },
    { id: "ws-act-3", at: "2026-10-28T11:40:00-06:00", text: "ClearSky wellness afternoon confirmed for Nov 14 (demo).", tone: "success" },
    { id: "ws-act-4", at: "2026-10-27T09:15:00-06:00", text: "Desk Relief Spring Series touched 3 organizations (demo).", tone: "info" },
    { id: "ws-act-5", at: "2026-10-25T15:50:00-06:00", text: "Lobby poster marked ready in Asset Library (demo).", tone: "success" },
  ],
  integrations: [
    { id: "public-landing", label: "Public landing", target: "/corporate-wellness", status: "planned" },
    { id: "engage", label: "Employee engage", target: "engage.nabitouch.com", status: "planned" },
    { id: "core", label: "Identity · bookings · billing", target: "Existing NabiTouch services", status: "reuse" },
  ],
};

export function getWellnessStudioDashboard() {
  return wellnessStudioDashboard;
}
