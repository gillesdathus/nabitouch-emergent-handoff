import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { UserPlus } from "lucide-react";
import { toast } from "sonner";
import { ModuleNavigation } from "@/components/tide";
import { StaffConversation } from "@/components/team/StaffConversation";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { api, apiError } from "@/lib/api";
import { teamNavFor, teamPath } from "@/lib/team-connect";
import { useDemo } from "@/store/DemoStore";

function threadTitle(thread, meId) {
  if (!thread) return "Conversation";
  if (thread.kind === "group") return thread.title || "Group";
  const other = (thread.members || []).find((m) => m.id !== meId);
  return other?.name || "Direct message";
}

function threadSubtitle(thread, meId) {
  if (!thread) return "";
  if (thread.kind === "group") {
    const names = (thread.members || []).map((m) => m.name).filter(Boolean);
    return `${names.length} members · invitation only`;
  }
  const other = (thread.members || []).find((m) => m.id !== meId);
  return other ? `${other.role || "staff"} · direct` : "Direct";
}

export default function TeamThread({ role = "pro" }) {
  const { threadId } = useParams();
  const { user } = useDemo();
  const [thread, setThread] = useState(null);
  const [error, setError] = useState("");
  const [inviteOpen, setInviteOpen] = useState(false);
  const [people, setPeople] = useState([]);
  const [pick, setPick] = useState([]);
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    if (!threadId) return;
    api.teamThread(threadId)
      .then((body) => setThread(body?.thread || null))
      .catch((err) => setError(apiError(err)));
  }, [threadId]);

  useEffect(() => { load(); }, [load]);

  const meId = user?.id;
  const title = useMemo(() => threadTitle(thread, meId), [thread, meId]);
  const subtitle = useMemo(() => threadSubtitle(thread, meId), [thread, meId]);

  useEffect(() => {
    if (!inviteOpen) return undefined;
    api.teamDirectory()
      .then((body) => {
        const memberIds = new Set(thread?.memberIds || []);
        setPeople((body?.people || []).filter((p) => !memberIds.has(p.id)));
      })
      .catch((err) => toast.error(apiError(err)));
    setPick([]);
    return undefined;
  }, [inviteOpen, thread?.memberIds]);

  const invite = async () => {
    if (!pick.length || busy) return;
    setBusy(true);
    try {
      const body = await api.teamInviteMembers(threadId, { memberIds: pick });
      setThread(body?.thread || thread);
      toast.success("Invites sent");
      setInviteOpen(false);
    } catch (err) {
      toast.error(apiError(err));
    } finally {
      setBusy(false);
    }
  };

  if (error && !thread) {
    return (
      <div className="mx-auto max-w-3xl space-y-4" data-testid="team-thread-error">
        <p className="text-sm text-rose-700">{error}</p>
        <Link to={teamPath(role, "messages")} className="text-sm font-semibold text-nb-blue">Back to messages</Link>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-3xl space-y-4" data-testid="team-thread">
      <ModuleNavigation items={teamNavFor(role)} testid="team-module-nav" />
      <div className="flex items-start justify-between gap-3">
        <div>
          <Link to={teamPath(role, "messages")} className="text-xs font-semibold text-nb-blue" data-testid="team-thread-back">← Messages</Link>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight">{title}</h1>
          <p className="text-sm text-nb-mute">{subtitle}</p>
        </div>
        {thread?.kind === "group" && (
          <button type="button" onClick={() => setInviteOpen(true)} className="nb-btn-ghost h-10 px-3 text-xs" data-testid="team-thread-invite">
            <UserPlus className="h-4 w-4" />Invite
          </button>
        )}
      </div>
      {threadId && meId && (
        <StaffConversation
          threadId={threadId}
          meId={meId}
          title={title}
          counterpart={subtitle}
          onRead={load}
        />
      )}

      <Dialog open={inviteOpen} onOpenChange={setInviteOpen}>
        <DialogContent className="sm:max-w-md" data-testid="team-invite-dialog">
          <DialogTitle>Invite members</DialogTitle>
          <ul className="mt-3 max-h-64 space-y-1 overflow-y-auto">
            {people.map((person) => {
              const on = pick.includes(person.id);
              return (
                <li key={person.id}>
                  <button
                    type="button"
                    onClick={() => setPick((prev) => (on ? prev.filter((x) => x !== person.id) : [...prev, person.id]))}
                    className={`flex w-full items-center justify-between rounded-2xl px-3 py-2.5 text-left text-sm ring-1 ${on ? "bg-sky-50 ring-nb-blue" : "ring-sky-100"}`}
                    data-testid={`team-invite-person-${person.id}`}
                  >
                    <span><span className="font-semibold">{person.name}</span><span className="mt-0.5 block text-xs capitalize text-nb-mute">{person.role}</span></span>
                    <span className="text-xs font-semibold text-nb-blue">{on ? "Selected" : "Invite"}</span>
                  </button>
                </li>
              );
            })}
            {people.length === 0 && <li className="text-sm text-nb-mute">Everyone available is already in this group.</li>}
          </ul>
          <button type="button" disabled={busy || !pick.length} onClick={invite} className="nb-btn-primary mt-4 h-12 w-full" data-testid="team-invite-submit">Add to group</button>
        </DialogContent>
      </Dialog>
    </div>
  );
}
