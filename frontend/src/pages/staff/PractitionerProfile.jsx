import { useCallback, useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { ArrowLeft, CalendarClock } from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { PageHeader, Panel } from "@/components/ds";
import { CompletenessCard, CredentialPanel, StatusChips } from "@/components/practitioner/ProfileParts";
import { PhotoEditor, ProfileFields } from "@/pages/practitioner/Profile";
import { practitionerStatus } from "@/lib/practitionerStatus";
import { useDemo } from "@/store/DemoStore";

const TAB = "rounded-full px-4 data-[state=active]:bg-nb-navy data-[state=active]:text-white";

export function usePractitionerData(id, owner) {
  const { api } = useDemo();
  const [credentials, setCredentials] = useState([]);
  const [board, setBoard] = useState(null);
  const [schedule, setSchedule] = useState(null);
  const [loaded, setLoaded] = useState(false);
  const load = useCallback(() => Promise.all([
    api.credentials().catch(() => []),
    owner ? api.onboarding().catch(() => null) : Promise.resolve(null),
    id ? api.schedule(id).catch(() => null) : Promise.resolve(null),
  ]).then(([c, b, s]) => { setCredentials(c || []); setBoard(b); setSchedule(s?.schedule || s); setLoaded(true); }), [api, id, owner]);
  useEffect(() => { load(); }, [load]);
  return { credentials, board, schedule, load, loaded };
}

export default function PractitionerProfile({ self = false }) {
  const params = useParams();
  const { state, practitionerId, refresh, user } = useDemo();
  const owner = !self && user?.role === "owner";
  const id = self ? practitionerId : params.id;
  const person = (state.practitioners || []).find((p) => p.id === id);
  const { credentials, board, schedule, load, loaded } = usePractitionerData(id, owner);
  const [editing, setEditing] = useState(false);
  if (!person) return <p className="text-sm text-nb-mute" data-testid="pr-missing">This practitioner profile is not available.</p>;
  const row = board?.practitioners?.find((p) => p.practitionerId === id);
  const status = practitionerStatus({ person, credentials, board: row, schedule });
  const changed = () => { load(); refresh?.(); };
  return (
    <div className="min-w-0 space-y-5" data-testid="practitioner-profile">
      {owner && <Link to="/owner/practitioners" className="inline-flex items-center gap-1 text-sm font-semibold text-nb-blue" data-testid="pr-back"><ArrowLeft className="h-4 w-4" />Practitioners</Link>}
      <PageHeader eyebrow={self ? "My profile" : "Practitioner"} title={person.name} description={person.designation || "No designation yet"} />
      <section className="nb-panel space-y-4 p-4 sm:p-5" data-testid="pr-hero">
        <PhotoEditor person={person} onChanged={changed} />
        {loaded ? <StatusChips status={status} /> : <div className="grid grid-cols-2 gap-2 sm:grid-cols-4" aria-busy="true" data-testid="pr-status-loading">{[0, 1, 2, 3].map((n) => <div key={n} className="nb-skeleton h-16 rounded-2xl" />)}</div>}
      </section>
      <div className="grid min-w-0 gap-4 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
        <Tabs defaultValue="profile" className="min-w-0">
          <TabsList className="mb-4 h-11 max-w-full justify-start overflow-x-auto rounded-full bg-white p-1 ring-1 ring-sky-100 no-scrollbar" data-testid="pr-tabs">
            <TabsTrigger value="profile" className={TAB} data-testid="pr-tab-profile">Public profile</TabsTrigger>
            <TabsTrigger value="credentials" className={TAB} data-testid="pr-tab-credentials">Licence & insurance</TabsTrigger>
            <TabsTrigger value="hours" className={TAB} data-testid="pr-tab-hours">Hours</TabsTrigger>
          </TabsList>
          <TabsContent value="profile">
            <Panel title="What clients see" action={!editing && <button type="button" onClick={() => setEditing(true)} className="nb-btn-ghost h-9 px-3 text-xs" data-testid={`profile-edit-${person.id}`}>Edit</button>} testid="pr-public">
              {editing ? <ProfileFields person={person} owner={owner} onSaved={() => { setEditing(false); changed(); }} onCancel={() => setEditing(false)} /> : (
                <div className="space-y-3 text-sm" data-testid={`profile-summary-${person.id}`}>
                  <p className="whitespace-pre-line">{person.bio || <span className="text-nb-mute">No biography yet.</span>}</p>
                  {person.experience && <p className="text-nb-mute">{person.experience}</p>}
                  <div className="flex flex-wrap gap-1.5">{(person.specialties || []).map((slug) => <span key={slug} className="rounded-full bg-sky-50 px-2.5 py-1 text-xs">{state.services.find((s) => s.slug === slug)?.name || slug}</span>)}{!(person.specialties || []).length && <span className="text-xs text-nb-mute">No services selected.</span>}</div>
                  {(person.qualifications || []).length > 0 && <ul className="list-disc pl-5 text-xs text-nb-mute">{person.qualifications.map((q) => <li key={q}>{q}</li>)}</ul>}
                </div>
              )}
            </Panel>
          </TabsContent>
          <TabsContent value="credentials">{loaded && <CredentialPanel person={person} status={status} credentials={credentials} owner={owner} onChanged={changed} />}</TabsContent>
          <TabsContent value="hours">
            <Panel title="Weekly hours" testid="pr-hours">
              <p className="text-sm">{(schedule?.weekly || []).length ? `${schedule.weekly.length} weekly window${schedule.weekly.length === 1 ? "" : "s"} · ${schedule.status === "approved" ? "approved" : "awaiting owner approval"} · new bookings ${schedule.acceptingBookings ? "open" : "paused"}` : "No weekly hours yet."}</p>
              <Link to={self ? "/pro/availability" : "/owner/availability"} className="nb-btn-ghost mt-3 h-10 px-4 text-sm" data-testid="pr-hours-link"><CalendarClock className="h-4 w-4" />{self ? "Edit my hours" : "Review hours"}</Link>
            </Panel>
          </TabsContent>
        </Tabs>
        {loaded ? <CompletenessCard status={status} self={self} /> : <div className="nb-skeleton h-72 rounded-[var(--nb-r-lg)]" />}
      </div>
    </div>
  );
}
