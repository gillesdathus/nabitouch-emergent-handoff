import { Link } from "react-router-dom";
import { UserRound } from "lucide-react";
import { EmptyState, PageHeader } from "@/components/ds";
import { Avatar, Pill } from "@/components/ui-kit";
import { practitionerStatus } from "@/lib/practitionerStatus";
import { usePractitionerData } from "@/pages/staff/PractitionerProfile";
import { useDemo } from "@/store/DemoStore";

export default function Practitioners() {
  const { state } = useDemo();
  const { credentials, board, loaded } = usePractitionerData(null, true);
  const people = state.practitioners || [];
  return (
    <div className="min-w-0 space-y-5" data-testid="owner-practitioners">
      <PageHeader eyebrow="People" title="Practitioners" description="Account, profile, booking and credential status are tracked separately. Open a practitioner to edit their profile or credentials." actions={<Link to="/owner/manage?invite=1" className="nb-btn-primary h-10 px-4 text-sm" data-testid="pr-invite">Invite practitioner</Link>} />
      {!people.length && <EmptyState icon={UserRound} title="No practitioners yet" body="Invite a practitioner to create their profile." />}
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {people.map((person) => {
          const row = board?.practitioners?.find((p) => p.practitionerId === person.id);
          const s = practitionerStatus({ person, credentials, board: row });
          return (
            <Link key={person.id} to={`/owner/practitioners/${person.id}`} className="nb-panel flex min-w-0 flex-col gap-3 p-4 transition-shadow hover:shadow-[var(--nb-elev-3)]" data-testid={`pr-card-${person.id}`}>
              <div className="flex min-w-0 items-center gap-3">
                <Avatar person={person} photo={person.photo} size={48} />
                <div className="min-w-0 flex-1"><p className="truncate font-semibold">{person.name}</p><p className="truncate text-xs text-nb-mute">{person.designation || "No designation"}</p></div>
              </div>
              <div className="flex flex-wrap gap-1.5">{loaded ? ["account", "profile", "booking", "credentials"].map((k) => <Pill key={k} tone={s[k][0]} testid={`pr-card-${person.id}-${k}`}>{s[k][1]}</Pill>) : <span className="nb-skeleton h-6 w-48 rounded-full" />}</div>
              <div>
                <div className="flex justify-between text-[11px] text-nb-mute"><span>Profile {s.done}/{s.items.length}</span><span className={s.overdue ? "font-semibold text-rose-700" : ""}>{s.complete ? "Complete" : s.daysLeft == null ? "Not activated" : s.overdue ? "30-day window passed" : `${s.daysLeft} days left`}</span></div>
                <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-sky-50"><div className="h-full rounded-full bg-gradient-to-r from-nb-blue to-nb-turq" style={{ width: `${(s.done / s.items.length) * 100}%` }} /></div>
              </div>
            </Link>
          );
        })}
      </div>
    </div>
  );
}
