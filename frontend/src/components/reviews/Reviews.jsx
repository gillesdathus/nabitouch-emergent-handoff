import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { ExternalLink, Star } from "lucide-react";
import { toast } from "sonner";
import { api } from "@/lib/api";

export function StarDisplay({ value, size = "h-4 w-4", testid }) {
  return <span className="inline-flex gap-0.5" data-testid={testid} aria-label={`${value} of 5 stars`}>{[1, 2, 3, 4, 5].map((n) => <Star key={n} className={`${size} ${n <= value ? "fill-amber-400 text-amber-400" : "text-slate-300"}`} />)}</span>;
}

export function StarInput({ value, onChange, testid = "star-input" }) {
  const [hover, setHover] = useState(0);
  return (
    <div className="flex gap-1" data-testid={testid} onMouseLeave={() => setHover(0)}>
      {[1, 2, 3, 4, 5].map((n) => (
        <button key={n} type="button" aria-label={`${n} star${n > 1 ? "s" : ""}`} data-testid={`${testid}-${n}`} onMouseEnter={() => setHover(n)} onClick={() => onChange(n)}
          className="grid h-11 w-11 place-items-center rounded-full transition-transform hover:scale-110 active:scale-95">
          <Star className={`h-8 w-8 transition-colors ${n <= (hover || value) ? "fill-amber-400 text-amber-400" : "text-slate-300"}`} />
        </button>
      ))}
    </div>
  );
}

let cached = null;
export function useReviewConfig() {
  const [cfg, setCfg] = useState(cached);
  useEffect(() => { if (!cached) api.reviewsConfig().then((row) => { cached = row; setCfg(row); }).catch(() => setCfg({ googleConfigured: false })); }, []);
  return cfg;
}

export function GoogleReviewButton({ className = "", testid = "google-review-btn" }) {
  const cfg = useReviewConfig();
  if (!cfg) return null;
  if (!cfg.googleConfigured) return <p className="text-xs text-nb-mute" data-testid={`${testid}-unconfigured`}>Google review link is not configured yet.</p>;
  return (
    <a href={cfg.googleReviewUrl} target="_blank" rel="noopener noreferrer" data-testid={testid} className={`nb-btn-ghost h-11 px-4 text-sm ${className}`}>
      <svg viewBox="0 0 24 24" className="h-4 w-4" aria-hidden="true"><path fill="#4285F4" d="M23.5 12.3c0-.8-.1-1.6-.2-2.3H12v4.4h6.5a5.6 5.6 0 0 1-2.4 3.6v3h3.9c2.2-2.1 3.5-5.1 3.5-8.7z" /><path fill="#34A853" d="M12 24c3.2 0 6-1.1 8-2.9l-3.9-3c-1.1.7-2.5 1.2-4.1 1.2-3.1 0-5.8-2.1-6.7-5H1.3v3.1A12 12 0 0 0 12 24z" /><path fill="#FBBC05" d="M5.3 14.3a7.2 7.2 0 0 1 0-4.6V6.6H1.3a12 12 0 0 0 0 10.8z" /><path fill="#EA4335" d="M12 4.8c1.8 0 3.3.6 4.6 1.8l3.4-3.4A12 12 0 0 0 1.3 6.6l4 3.1c.9-2.8 3.6-4.9 6.7-4.9z" /></svg>
      Leave a Google Review<ExternalLink className="h-3.5 w-3.5 text-nb-mute" />
    </a>
  );
}

// One form for client feedback and practitioner client ratings; `save` performs the create or edit call.
export function RatingForm({ initial, save, onSaved, submitLabel = "Send private feedback", placeholder = "Anything you'd like us to know (optional)", testid = "feedback-form" }) {
  const [rating, setRating] = useState(initial?.rating || 0);
  const [comment, setComment] = useState(initial?.comment || "");
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    setBusy(true);
    try { const row = await save({ rating, comment }); toast.success("Saved privately. Thank you."); onSaved?.(row); }
    catch (err) { toast.error(err?.response?.data?.detail || "Not saved"); } finally { setBusy(false); }
  };
  return (
    <div className="space-y-3" data-testid={testid}>
      <StarInput value={rating} onChange={setRating} testid={`${testid}-stars`} />
      <textarea rows={3} maxLength={1500} className="nb-input h-auto py-3" placeholder={placeholder} value={comment} onChange={(e) => setComment(e.target.value)} data-testid={`${testid}-comment`} />
      <button type="button" disabled={!rating || busy} onClick={submit} className="nb-btn-primary h-12 w-full sm:w-auto sm:px-6" data-testid={`${testid}-submit`}>{busy ? "Saving…" : submitLabel}</button>
    </div>
  );
}

export function FeedbackPrompt({ idx }) {
  const [data, setData] = useState(null);
  useEffect(() => { api.myReviews().then(setData).catch(() => {}); }, []);
  const next = data?.eligible?.[0];
  if (!next) return null;
  return (
    <div className="relative mt-4 overflow-hidden rounded-3xl bg-gradient-to-r from-amber-50 to-sky-50 p-5 ring-1 ring-amber-100" data-testid="feedback-prompt">
      <p className="text-sm font-semibold">How was your {idx.services[next.serviceSlug]?.name || "visit"} on {new Date(`${next.date}T12:00`).toLocaleDateString("en-CA", { month: "short", day: "numeric" })}?</p>
      <p className="mt-1 text-xs text-nb-mute">Private feedback goes only to Nabitouch. A Google review is optional and separate.</p>
      <div className="mt-3 flex flex-wrap gap-2">
        <Link to={`/me/reviews?appt=${next.id}`} className="nb-btn-primary h-11 px-4 text-sm" data-testid="feedback-prompt-rate"><Star className="h-4 w-4" />Share private feedback</Link>
        <GoogleReviewButton testid="feedback-prompt-google" />
      </div>
    </div>
  );
}
