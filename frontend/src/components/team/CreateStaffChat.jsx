import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { api, apiError } from "@/lib/api";

export function CreateStaffChat({ open, onOpenChange, onCreated }) {
  const [people, setPeople] = useState([]);
  const [kind, setKind] = useState("dm");
  const [title, setTitle] = useState("");
  const [selected, setSelected] = useState([]);
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return undefined;
    let stop = false;
    api.teamDirectory()
      .then((body) => { if (!stop) setPeople(body?.people || []); })
      .catch((err) => toast.error(apiError(err)));
    setKind("dm");
    setTitle("");
    setSelected([]);
    setQuery("");
    return () => { stop = true; };
  }, [open]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (people || []).filter((person) => {
      if (!q) return true;
      return `${person.name} ${person.email} ${person.role}`.toLowerCase().includes(q);
    });
  }, [people, query]);

  const toggle = (id) => {
    setSelected((prev) => {
      if (kind === "dm") return prev[0] === id ? [] : [id];
      return prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id];
    });
  };

  const submit = async () => {
    if (!selected.length || busy) return;
    setBusy(true);
    try {
      const body = kind === "dm"
        ? { kind: "dm", memberIds: selected.slice(0, 1) }
        : { kind: "group", title: title.trim(), memberIds: selected };
      const result = await api.teamCreateThread(body);
      toast.success(result?.created === false ? "Opened existing conversation" : "Conversation ready");
      onCreated?.(result?.thread);
      onOpenChange?.(false);
    } catch (err) {
      toast.error(apiError(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-md" data-testid="create-staff-chat">
        <DialogTitle>New conversation</DialogTitle>
        <div className="mt-3 flex gap-2" role="tablist">
          <button type="button" role="tab" aria-selected={kind === "dm"} onClick={() => { setKind("dm"); setSelected((ids) => ids.slice(0, 1)); }} className={kind === "dm" ? "nb-chip-on h-9 text-xs" : "nb-chip-off h-9 text-xs"} data-testid="create-chat-dm">Direct</button>
          <button type="button" role="tab" aria-selected={kind === "group"} onClick={() => setKind("group")} className={kind === "group" ? "nb-chip-on h-9 text-xs" : "nb-chip-off h-9 text-xs"} data-testid="create-chat-group">Group</button>
        </div>
        {kind === "group" && (
          <label className="mt-3 block text-sm">
            <span className="nb-label">Group name</span>
            <input className="nb-input" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Saturday desk" data-testid="create-chat-title" />
          </label>
        )}
        <label className="mt-3 block text-sm">
          <span className="nb-label">Invite staff</span>
          <input className="nb-input" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search name or role…" data-testid="create-chat-search" />
        </label>
        <ul className="mt-3 max-h-56 space-y-1 overflow-y-auto" data-testid="create-chat-directory">
          {filtered.map((person) => {
            const on = selected.includes(person.id);
            return (
              <li key={person.id}>
                <button
                  type="button"
                  onClick={() => toggle(person.id)}
                  className={`flex w-full items-center justify-between rounded-2xl px-3 py-2.5 text-left text-sm ring-1 ${on ? "bg-sky-50 ring-nb-blue" : "bg-white ring-sky-100"}`}
                  data-testid={`create-chat-person-${person.id}`}
                >
                  <span>
                    <span className="font-semibold text-nb-ink">{person.name}</span>
                    <span className="mt-0.5 block text-xs capitalize text-nb-mute">{person.role}</span>
                  </span>
                  <span className="text-xs font-semibold text-nb-blue">{on ? "Selected" : "Invite"}</span>
                </button>
              </li>
            );
          })}
          {filtered.length === 0 && <li className="px-2 py-4 text-sm text-nb-mute">No staff matched.</li>}
        </ul>
        <p className="mt-2 text-[11px] text-nb-mute">Only invited members can open the conversation. Any authorized staff member may create a group.</p>
        <button
          type="button"
          disabled={busy || !selected.length || (kind === "group" && title.trim().length < 2)}
          onClick={submit}
          className="nb-btn-primary mt-4 h-12 w-full"
          data-testid="create-chat-submit"
        >
          {kind === "dm" ? "Start message" : "Create group"}
        </button>
      </DialogContent>
    </Dialog>
  );
}
