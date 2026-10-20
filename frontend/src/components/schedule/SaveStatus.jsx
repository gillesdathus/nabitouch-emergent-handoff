const TONE = {
  loading: "bg-slate-50 text-nb-mute",
  saved: "bg-teal-50 text-teal-900",
  dirty: "bg-amber-50 text-amber-950",
  saving: "bg-sky-50 text-sky-950",
  success: "bg-teal-50 text-teal-900",
  error: "bg-rose-50 text-rose-800",
};

export function SaveStatus({ status, message, lastSaved, testid = "save-status" }) {
  if (!status && !message) return null;
  return (
    <div className={`rounded-2xl px-3 py-2 text-sm ${TONE[status] || TONE.saved}`} data-testid={testid} role="status">
      <p className="font-medium">{message}</p>
      {lastSaved && status !== "dirty" && status !== "saving" && (
        <p className="mt-0.5 text-xs opacity-80">Last saved {lastSaved}</p>
      )}
    </div>
  );
}

export function formatSavedAt(iso) {
  if (!iso) return "";
  try {
    return new Date(iso).toLocaleString(undefined, {
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });
  } catch {
    return "";
  }
}
