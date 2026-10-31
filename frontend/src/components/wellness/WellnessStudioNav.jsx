import { ModuleNavigation } from "@/components/tide";
import { WELLNESS_STUDIO_NAV } from "@/fixtures/wellnessStudio";

/** Corporate Wellness Studio subnav — distinct from clinical client admin. */
export function WellnessStudioNav({ testid = "wellness-studio-nav" }) {
  return <ModuleNavigation items={WELLNESS_STUDIO_NAV} testid={testid} />;
}
