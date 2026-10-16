import { useCallback, useEffect, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { ArrowLeft, Lock, MessageSquareHeart, Pencil } from "lucide-react";
import { GoogleReviewButton, RatingForm, StarDisplay } from "@/components/reviews/Reviews";
import { api } from "@/lib/api";
import { fmtDate, fmtTime } from "@/lib/domain";
import { useDemo } from "@/store/DemoStore";

function Eligible({ appt, idx, open, onOpen, onSaved }) {
  return (
    <div className="nb-card p-5" data-testid={`review-eligible-${appt.id}`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div><p className="text-sm font-semibold">{idx.services[appt.serviceSlug]?.name || "Visit"}</p><p className="text-xs text-nb-mute">{fmtDate(appt.date)} · {fmtTime(appt.time)} · {idx.practitioners[appt.practitionerId]?.name || ""}</p></div>
        {!open && <button type="button" onClick={onOpen} className="nb-btn-primary h-10 px-4 text-sm" data-testid={`review-open-${appt.id}`}>Rate this visit</button>}
      </div>
      {open && <div className="mt-4"><RatingForm save={(body) => api.submitReview({ ...body, appointmentId: appt.id })} onSaved={onSaved} testid={`review-form-${appt.id}`} /></div>}
    </div>
  );
}

function Mine({ row, idx, onSaved }) {
  const [editing, setEditing] = useState(false);
  return (
    <div className="nb-card p-5" data-testid={`review-row-${row.id}`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div><p className="text-sm font-semibold">{idx.services[row.serviceSlug]?.name || "Visit"} · {fmtDate(row.apptDate)}</p><p className="text-[11px] text-nb-mute">Sent {new Date(row.at).toLocaleDateString("en-CA")}{row.editedAt ? ` · edited ${new Date(row.editedAt).toLocaleDateString("en-CA")}` : ""}</p></div>
        <StarDisplay value={row.rating} testid={`review-stars-${row.id}`} />
      </div>
      {editing ? <div className="mt-4"><RatingForm initial={row} submitLabel="Save my one edit" save={(body) => api.editReview(row.id, body)} onSaved={() => { setEditing(false); onSaved(); }} testid={`review-edit-form-${row.id}`} /></div>
        : <>{row.comment && <p className="mt-3 text-sm text-nb-ink/80" data-testid={`review-comment-${row.id}`}>“{row.comment}”</p>}
          {row.editable && <button type="button" onClick={() => setEditing(true)} className="mt-3 inline-flex items-center gap-1 text-xs font-semibold text-nb-blue" data-testid={`review-edit-${row.id}`}><Pencil className="h-3.5 w-3.5" />Edit once (until {new Date(row.editableUntil).toLocaleDateString("en-CA")})</button>}</>}
    </div>
  );
}

export default function Reviews() {
  const { idx, me } = useDemo();
  const nav = useNavigate();
  const [params] = useSearchParams();
  const [data, setData] = useState(null);
  const [open, setOpen] = useState(params.get("appt"));
  const load = useCallback(() => api.myReviews().then(setData).catch(() => setData({ reviews: [], eligible: [] })), []);
  useEffect(() => { if (me) load(); }, [me, load]);
  if (!me) return <div className="mx-auto max-w-xl px-5 py-16 text-center"><Link to="/login?next=/me/reviews" className="nb-btn-primary">Sign in</Link></div>;
  return (
    <div className="mx-auto max-w-2xl space-y-6 px-5 pb-32 pt-4" data-testid="client-reviews-page">
      <div className="flex items-center gap-3">
        <button type="button" onClick={() => nav("/me")} className="grid h-11 w-11 place-items-center rounded-full bg-white ring-1 ring-sky-100" data-testid="reviews-back"><ArrowLeft className="h-4 w-4" /></button>
        <div><p className="nb-eyebrow">My Nabitouch</p><h1 className="text-2xl font-semibold">Reviews & feedback</h1></div>
      </div>
      <section className="grid gap-3 sm:grid-cols-2">
        <div className="rounded-3xl bg-sky-50/70 p-5 ring-1 ring-sky-100"><p className="flex items-center gap-2 text-sm font-semibold"><Lock className="h-4 w-4 text-nb-blue" />Private feedback</p><p className="mt-1 text-xs text-nb-mute">Goes only to the Nabitouch team. It is never published.</p></div>
        <div className="rounded-3xl bg-white p-5 ring-1 ring-sky-100" data-testid="reviews-google-card"><p className="text-sm font-semibold">Public Google review</p><p className="mb-3 mt-1 text-xs text-nb-mute">Optional and separate. Opens Google in a new tab.</p><GoogleReviewButton /></div>
      </section>
      {!data ? <div className="nb-card h-32 animate-pulse" /> : (
        <>
          <section className="space-y-3" data-testid="reviews-eligible">
            <p className="nb-label">Visits waiting for your feedback</p>
            {data.eligible.length ? data.eligible.map((appt) => <Eligible key={appt.id} appt={appt} idx={idx} open={open === appt.id} onOpen={() => setOpen(appt.id)} onSaved={() => { setOpen(null); load(); }} />)
              : <p className="text-sm text-nb-mute" data-testid="reviews-eligible-empty">No completed visits are waiting for feedback.</p>}
          </section>
          <section className="space-y-3" data-testid="reviews-mine">
            <p className="nb-label">Your feedback</p>
            {data.reviews.length ? data.reviews.map((row) => <Mine key={row.id} row={row} idx={idx} onSaved={load} />)
              : <p className="flex items-center gap-2 text-sm text-nb-mute" data-testid="reviews-mine-empty"><MessageSquareHeart className="h-4 w-4" />You have not left feedback yet.</p>}
          </section>
        </>
      )}
    </div>
  );
}
