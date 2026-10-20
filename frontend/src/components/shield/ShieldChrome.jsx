import { ModuleNavigation, PageHeader } from "@/components/tide";

export const SHIELD_NAV = [
  { to: "/owner/shield", label: "Overview", end: true },
  { to: "/owner/fleet", label: "Fleet", match: ["/owner/fleet"] },
  {
    to: "/owner/shield/drivers",
    label: "Documents",
    match: ["/owner/shield/drivers", "/owner/shield/renewals", "/owner/shield/documents"],
  },
  {
    to: "/owner/shield/visits",
    label: "Visits",
    match: ["/owner/shield/visits", "/owner/shield/timeline"],
  },
  { to: "/owner/safety", label: "Safety" },
];

export function ShieldChrome({ title, sub, right, children, testid = "shield-chrome" }) {
  return (
    <div className="mx-auto max-w-3xl space-y-5" data-testid={testid}>
      <PageHeader eyebrow="Security Shield" title={title} sub={sub} right={right} />
      <ModuleNavigation items={SHIELD_NAV} testid="shield-module-nav" />
      {children}
    </div>
  );
}
