import { useEffect, useMemo, useState } from "react";
import { todayISO } from "@/lib/domain";

const WEEKDAYS = [
  { id: 0, label: "Mon" },
  { id: 1, label: "Tue" },
  { id: 2, label: "Wed" },
  { id: 3, label: "Thu" },
  { id: 4, label: "Fri" },
  { id: 5, label: "Sat" },
  { id: 6, label: "Sun" },
];

const TRIAL_CAMPAIGN = {
  id: "cmp-ten-minutes-on-us",
  title: "10 Minutes. On Us.",
};

function emptyDraft() {
  return {
    id: "",
    campaignId: TRIAL_CAMPAIGN.id,
    mode: "recurring",
    weekdays: [],
    startDate: todayISO(),
    endDate: todayISO(),
    start: "10:00",
    end: "14:00",
    fullDay: false,
    open: true,
  };
}

function cloneBlock(block) {
  return {
    ...block,
    id: "",
    weekdays: [...(block.weekdays || [])],
  };
}

function weekdayLabels(weekdays) {
  const set = new Set(weekdays || []);
  return WEEKDAYS.filter((day) => set.has(day.id)).map((day) => day.label).join(", ") || "—";
}

function describeBlock(block) {
  const hours = block.fullDay ? "Full day (weekly hours)" : `${block.start || "—"}–${block.end || "—"}`;
  if (block.mode === "one_time") return `${block.startDate} · ${hours}`;
  if (block.mode === "range") {
    const days = (block.weekdays || []).length ? ` · ${weekdayLabels(block.weekdays)}` : "";
    return `${block.startDate} → ${block.endDate}${days} · ${hours}`;
  }
  return `${weekdayLabels(block.weekdays)} · ${hours}`;
}

/**
 * Campaign Slots editor for Practitioner Schedule.
 * Saves the full campaignBlocks list in one action. Closing never cancels visits.
 */
export default function CampaignSlotsEditor({
  blocks: savedBlocks = [],
  onSave,
  campaigns = [TRIAL_CAMPAIGN],
}) {
  const [drafts, setDrafts] = useState(() => (savedBlocks.length ? savedBlocks.map((row) => ({ ...row, weekdays: [...(row.weekdays || [])] })) : []));
  const [editingId, setEditingId] = useState(null);
  const [form, setForm] = useState(emptyDraft());
  const [saveState, setSaveState] = useState("saved");
  const [message, setMessage] = useState("");

  useEffect(() => {
    setDrafts(savedBlocks.map((row) => ({ ...row, weekdays: [...(row.weekdays || [])] })));
    setSaveState("saved");
    setMessage("");
    setEditingId(null);
  }, [savedBlocks]);

  const dirty = useMemo(() => JSON.stringify(drafts) !== JSON.stringify(savedBlocks.map((row) => ({
    ...row,
    weekdays: [...(row.weekdays || [])],
  }))), [drafts, savedBlocks]);

  useEffect(() => {
    if (saveState === "saving" || saveState === "error" || saveState === "success") return;
    setSaveState(dirty ? "unsaved" : "saved");
  }, [dirty, saveState]);

  const campaignOptions = campaigns.length ? campaigns : [TRIAL_CAMPAIGN];

  const beginAdd = () => {
    setForm(emptyDraft());
    setEditingId("new");
  };

  const beginEdit = (block) => {
    setForm({
      ...emptyDraft(),
      ...block,
      weekdays: [...(block.weekdays || [])],
      startDate: block.startDate || todayISO(),
      endDate: block.endDate || block.startDate || todayISO(),
      start: block.start || "10:00",
      end: block.end || "14:00",
    });
    setEditingId(block.id);
  };

  const toggleWeekday = (id) => {
    setForm((current) => {
      const has = current.weekdays.includes(id);
      return { ...current, weekdays: has ? current.weekdays.filter((day) => day !== id) : [...current.weekdays, id].sort((a, b) => a - b) };
    });
  };

  const applyForm = () => {
    if (!form.campaignId) {
      setSaveState("error");
      setMessage("Choose a campaign.");
      return;
    }
    if (form.mode === "recurring" && !form.weekdays.length) {
      setSaveState("error");
      setMessage("Select at least one weekday.");
      return;
    }
    if (!form.fullDay && (!form.start || !form.end || form.end <= form.start)) {
      setSaveState("error");
      setMessage("Choose a start and end time.");
      return;
    }
    const row = {
      id: editingId && editingId !== "new" ? editingId : form.id || `cb-local-${Date.now()}`,
      campaignId: form.campaignId,
      mode: form.mode,
      weekdays: form.mode === "one_time" ? [] : [...form.weekdays],
      startDate: form.mode === "recurring" ? null : form.startDate,
      endDate: form.mode === "recurring" ? null : (form.mode === "one_time" ? form.startDate : form.endDate),
      start: form.fullDay ? "" : form.start,
      end: form.fullDay ? "" : form.end,
      fullDay: Boolean(form.fullDay),
      open: Boolean(form.open),
      timezone: "America/Edmonton",
    };
    setDrafts((current) => {
      const index = current.findIndex((item) => item.id === row.id);
      if (index >= 0) {
        const next = [...current];
        next[index] = row;
        return next;
      }
      return [...current, row];
    });
    setEditingId(null);
    setForm(emptyDraft());
    setSaveState("unsaved");
    setMessage("");
  };

  const copyBlock = (block) => {
    const copy = cloneBlock(block);
    copy.id = `cb-local-${Date.now()}`;
    setDrafts((current) => [...current, copy]);
    setSaveState("unsaved");
  };

  const removeBlock = (id) => {
    setDrafts((current) => current.filter((row) => row.id !== id));
    if (editingId === id) setEditingId(null);
    setSaveState("unsaved");
  };

  const toggleOpen = (id) => {
    setDrafts((current) => current.map((row) => (row.id === id ? { ...row, open: !row.open } : row)));
    setSaveState("unsaved");
  };

  const saveAll = async () => {
    setSaveState("saving");
    setMessage("");
    try {
      await onSave(drafts);
      setSaveState("success");
      setMessage("Campaign schedule saved.");
    } catch (err) {
      const detail = err?.response?.data?.detail;
      setSaveState("error");
      setMessage(typeof detail === "string" ? detail : detail?.message || "Campaign schedule was not saved.");
    }
  };

  const statusLabel = {
    saved: "Saved",
    unsaved: "Unsaved changes",
    saving: "Saving…",
    success: "Success",
    error: "Error",
  }[saveState] || "Saved";

  return (
    <div className="space-y-4" data-testid="campaign-slots-editor">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="text-sm font-semibold">Campaign Slots</p>
          <p className="text-xs text-nb-mute">Reserve time for “10 Minutes. On Us.” Open blocks are trial-only. Closing stops new trial bookings and does not cancel confirmed visits.</p>
        </div>
        <p
          className={`rounded-full px-3 py-1 text-xs font-medium ${
            saveState === "error" ? "bg-rose-50 text-rose-700" :
            saveState === "success" || saveState === "saved" ? "bg-teal-50 text-teal-800" :
            saveState === "saving" ? "bg-sky-50 text-sky-800" :
            "bg-amber-50 text-amber-900"
          }`}
          data-testid="campaign-slots-status"
        >
          {statusLabel}
        </p>
      </div>

      {message && (
        <p className={`rounded-2xl p-3 text-sm ${saveState === "error" ? "bg-rose-50 text-rose-700" : "bg-teal-50 text-teal-900"}`} data-testid="campaign-slots-message">
          {message}
        </p>
      )}

      <ul className="space-y-2" data-testid="campaign-slots-list">
        {!drafts.length && <li className="rounded-2xl border border-dashed border-nb-line p-4 text-sm text-nb-mute">No campaign blocks yet. Add hours when you want to offer the trial.</li>}
        {drafts.map((block) => {
          const campaign = campaignOptions.find((row) => row.id === block.campaignId) || TRIAL_CAMPAIGN;
          return (
            <li key={block.id} className="nb-card flex flex-wrap items-center gap-3 p-3" data-testid={`campaign-block-${block.id}`}>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium">{campaign.title || block.campaignId}</p>
                <p className="text-xs text-nb-mute">{describeBlock(block)}</p>
              </div>
              <label className="inline-flex items-center gap-2 text-sm">
                <span className="text-nb-mute">{block.open ? "Open" : "Closed"}</span>
                <input
                  type="checkbox"
                  role="switch"
                  checked={Boolean(block.open)}
                  onChange={() => toggleOpen(block.id)}
                  data-testid={`campaign-block-open-${block.id}`}
                />
              </label>
              <button type="button" className="nb-btn-ghost h-9 text-sm" onClick={() => beginEdit(block)} data-testid={`campaign-block-edit-${block.id}`}>Edit</button>
              <button type="button" className="nb-btn-ghost h-9 text-sm" onClick={() => copyBlock(block)} data-testid={`campaign-block-copy-${block.id}`}>Copy</button>
              <button type="button" className="nb-btn-ghost h-9 text-sm text-rose-700" onClick={() => removeBlock(block.id)} data-testid={`campaign-block-delete-${block.id}`}>Delete</button>
            </li>
          );
        })}
      </ul>

      {editingId ? (
        <div className="nb-card grid gap-3 p-4 sm:grid-cols-2" data-testid="campaign-slots-form">
          <label className="text-sm sm:col-span-2">
            <span className="nb-label">Campaign</span>
            <select className="nb-input" value={form.campaignId} onChange={(event) => setForm({ ...form, campaignId: event.target.value })} data-testid="campaign-slots-campaign">
              {campaignOptions.map((row) => <option key={row.id} value={row.id}>{row.title || row.id}</option>)}
            </select>
          </label>
          <label className="text-sm">
            <span className="nb-label">Recurrence</span>
            <select className="nb-input" value={form.mode} onChange={(event) => setForm({ ...form, mode: event.target.value })} data-testid="campaign-slots-mode">
              <option value="recurring">Recurring weekly</option>
              <option value="one_time">One-time date</option>
              <option value="range">Date range</option>
            </select>
          </label>
          <label className="inline-flex items-center gap-2 self-end text-sm">
            <input type="checkbox" checked={form.fullDay} onChange={(event) => setForm({ ...form, fullDay: event.target.checked })} data-testid="campaign-slots-fullday" />
            Full day (use weekly hours)
          </label>
          {form.mode !== "recurring" && (
            <label className="text-sm">
              <span className="nb-label">{form.mode === "range" ? "Start date" : "Date"}</span>
              <input className="nb-input" type="date" value={form.startDate} onChange={(event) => setForm({ ...form, startDate: event.target.value })} data-testid="campaign-slots-start-date" />
            </label>
          )}
          {form.mode === "range" && (
            <label className="text-sm">
              <span className="nb-label">End date</span>
              <input className="nb-input" type="date" value={form.endDate} onChange={(event) => setForm({ ...form, endDate: event.target.value })} data-testid="campaign-slots-end-date" />
            </label>
          )}
          {form.mode !== "one_time" && (
            <div className="sm:col-span-2">
              <p className="nb-label mb-2">Weekdays</p>
              <div className="flex flex-wrap gap-2">
                {WEEKDAYS.map((day) => (
                  <button
                    key={day.id}
                    type="button"
                    className={form.weekdays.includes(day.id) ? "nb-chip-on" : "nb-chip-off"}
                    onClick={() => toggleWeekday(day.id)}
                    data-testid={`campaign-slots-day-${day.id}`}
                  >
                    {day.label}
                  </button>
                ))}
              </div>
            </div>
          )}
          {!form.fullDay && (
            <>
              <label className="text-sm">
                <span className="nb-label">Start</span>
                <input className="nb-input" type="time" value={form.start} onChange={(event) => setForm({ ...form, start: event.target.value })} data-testid="campaign-slots-start" />
              </label>
              <label className="text-sm">
                <span className="nb-label">End</span>
                <input className="nb-input" type="time" value={form.end} onChange={(event) => setForm({ ...form, end: event.target.value })} data-testid="campaign-slots-end" />
              </label>
            </>
          )}
          <label className="inline-flex items-center gap-2 text-sm sm:col-span-2">
            <input type="checkbox" checked={form.open} onChange={(event) => setForm({ ...form, open: event.target.checked })} data-testid="campaign-slots-open" />
            Open for new campaign bookings
          </label>
          <p className="sm:col-span-2 text-xs text-nb-mute">A block outside your usual weekly hours is intentional extra working time for this campaign only. It does not open paid regular bookings.</p>
          <div className="flex flex-wrap gap-2 sm:col-span-2">
            <button type="button" className="nb-btn-primary h-11" onClick={applyForm} data-testid="campaign-slots-apply">{editingId === "new" ? "Add block" : "Update block"}</button>
            <button type="button" className="nb-btn-ghost h-11" onClick={() => { setEditingId(null); setForm(emptyDraft()); }} data-testid="campaign-slots-cancel">Cancel</button>
          </div>
        </div>
      ) : (
        <button type="button" className="nb-btn-ghost h-11" onClick={beginAdd} data-testid="campaign-slots-add">Add campaign block</button>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          className="nb-btn-primary h-11"
          disabled={saveState === "saving" || (!dirty && saveState !== "error")}
          onClick={saveAll}
          data-testid="campaign-slots-save"
        >
          {saveState === "saving" ? "Saving…" : "Save campaign schedule"}
        </button>
        {dirty && <span className="text-xs text-nb-mute">Save to apply open/closed and hour changes together.</span>}
      </div>
    </div>
  );
}
