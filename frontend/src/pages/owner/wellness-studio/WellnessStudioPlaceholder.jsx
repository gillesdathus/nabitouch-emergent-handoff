import { useMemo } from "react";
import { Link, useLocation } from "react-router-dom";
import { ArrowLeft, Construction } from "lucide-react";
import { EmptyState, PageHeader, Notice } from "@/components/tide";
import { DemoTag } from "@/components/ui-kit";
import { WellnessStudioNav } from "@/components/wellness/WellnessStudioNav";
import { WELLNESS_STUDIO_SECTIONS } from "@/fixtures/wellnessStudio";

/** Lightweight Phase 1 stub so Overview navigation can be reviewed without building full pages. */
export default function WellnessStudioPlaceholder() {
  const { pathname } = useLocation();
  const sectionKey = useMemo(() => {
    const part = pathname.split("/").filter(Boolean).pop();
    return WELLNESS_STUDIO_SECTIONS[part] ? part : null;
  }, [pathname]);
  const section = sectionKey ? WELLNESS_STUDIO_SECTIONS[sectionKey] : { title: "Wellness Studio", blurb: "This section arrives in a later phase." };

  return (
    <div className="mx-auto max-w-6xl space-y-5" data-testid="wellness-studio-placeholder">
      <PageHeader
        eyebrow="Corporate Wellness Studio"
        title={section.title}
        sub={section.blurb}
        right={<DemoTag>Phase 1 · Overview only</DemoTag>}
      />
      <WellnessStudioNav />
      <Notice tone="off" testid="wellness-placeholder-notice">
        Page 1 (Overview) is ready for UI review. This section is intentionally empty — no emails, publishes, or production writes.
      </Notice>
      <div className="nb-card p-2">
        <EmptyState
          icon={Construction}
          title={`${section.title} comes next`}
          body="Continue the Wellness Studio after Overview is approved. Navigation is wired so you can preview the workspace structure."
          testid="wellness-placeholder-empty"
          action={(
            <Link to="/owner/wellness-studio" className="nb-btn-primary h-10 px-4 text-sm" data-testid="wellness-placeholder-back">
              <ArrowLeft className="h-4 w-4" aria-hidden="true" /> Back to Overview
            </Link>
          )}
        />
      </div>
    </div>
  );
}
