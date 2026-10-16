import { useEffect, useState } from "react";
import { ArrowDownUp, Lock, Mail, Star } from "lucide-react";
import { StarDisplay } from "@/components/reviews/Reviews";
import { PageHeader, Segmented } from "@/components/tide";
import { api } from "@/lib/api";
import { fmtDate } from "@/lib/domain";

const YMD = { year: "numeric", month: "short", day: "numeric" };
const FILTERS = [{ value: "0", label: "All" }, ...[5, 4, 3, 2, 1].map((n) => ({ value: String(n), label: `${n}★` }))];

function Row({ row, testid }) {
  return (
    <tr className="border-t border-sky-50 align-top [&>td]:py-3" data-testid={testid}>
      <td className="py-3 pr-3 font-medium">{row.clientName}</td>
      {row.practitionerName !== undefined && <td className="pr-3">{row.practitionerName}</td>}
      <td className="pr-3 whitespace-nowrap">{fmtDate(row.apptDate, YMD)}</td>
      <td className="pr-3">{row.serviceName}</td>
      <td className="pr-3"><StarDisplay value={row.rating} size="h-3.5 w-3.5" /></td>
      <td className="max-w-xs pr-3 text-nb-ink/80">{row.comment || <span className="text-nb-mute">No comment</span>}{row.edited && <span className="ml-1 rounded-full bg-amber-50 px-1.5 text-[10px] font-semibold text-amber-800">edited</span>}</td>
      <td className="whitespace-nowrap text-nb-mute">{fmtDate(row.at.slice(0, 10), YMD)}</td>
    </tr>
  );
}

function Table({ rows, practitioner, testid }) {
  if (!rows.length) return <p className="py-6 text-center text-sm text-nb-mute" data-testid={`${testid}-empty`}>Nothing matches this filter.</p>;
  return (
    <div className="overflow-x-auto"><table className="w-full min-w-[640px] text-left text-xs sm:text-sm" data-testid={testid}>
      <thead className="text-[11px] uppercase tracking-wider text-nb-mute"><tr><th className="py-2">Client</th>{practitioner && <th>Practitioner</th>}<th>Visit</th><th>Service</th><th>Rating</th><th>Feedback</th><th>Submitted</th></tr></thead>
      <tbody>{rows.map((row) => <Row key={row.id} row={practitioner ? row : { ...row, practitionerName: undefined }} testid={`${testid}-row-${row.id}`} />)}</tbody>
    </table></div>
  );
}

export default function Feedback() {
  const [tab, setTab] = useState("clients");
  const [rating, setRating] = useState("0");
  const [sort, setSort] = useState("newest");
  const [data, setData] = useState(null);
  const [ratings, setRatings] = useState(null);
  useEffect(() => {
    const params = { rating: Number(rating), sort };
    if (tab === "clients") api.ownerReviews(params).then(setData).catch(() => setData({ reviews: [], counts: {}, invites: {} }));
    else api.ownerClientRatings(params).then(setRatings).catch(() => setRatings({ ratings: [] }));
  }, [tab, rating, sort]);
  return (
    <div className="space-y-6" data-testid="owner-feedback">
      <PageHeader eyebrow="Clients" title="Client feedback" sub="Private feedback from clients and practitioner ratings of client visits. Never published or sent to Google." />
      {data && tab === "clients" && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <div className="nb-card p-4"><p className="text-[11px] text-nb-mute">Average</p><p className="nb-num flex items-center gap-1 text-2xl font-semibold" data-testid="feedback-average">{data.average ?? "—"}<Star className="h-5 w-5 fill-amber-400 text-amber-400" /></p></div>
          <div className="nb-card p-4"><p className="text-[11px] text-nb-mute">Reviews</p><p className="nb-num text-2xl font-semibold" data-testid="feedback-total">{data.total ?? 0}</p></div>
          <div className="nb-card p-4"><p className="flex items-center gap-1 text-[11px] text-nb-mute"><Mail className="h-3.5 w-3.5" />Invitations</p><p className="text-sm font-semibold" data-testid="feedback-invites">{data.invites?.prepared ?? 0} prepared · {data.invites?.sendingEnabled ? `${data.invites.sent} sent` : "sending disabled"}</p></div>
          <div className="nb-card p-4"><p className="text-[11px] text-nb-mute">Google link</p><p className="text-sm font-semibold" data-testid="feedback-google-status">{data.googleConfigured ? "Configured" : "Not configured"}</p></div>
        </div>
      )}
      <div className="nb-card space-y-4 rounded-[28px] p-5">
        <div className="flex flex-wrap items-center gap-3">
          <Segmented testid="feedback-tab" value={tab} onChange={setTab} options={[{ value: "clients", label: "From clients" }, { value: "practitioners", label: "Practitioner ratings" }]} />
          <Segmented testid="feedback-filter" value={rating} onChange={setRating} options={FILTERS} />
          <button type="button" onClick={() => setSort(sort === "newest" ? "oldest" : "newest")} className="nb-btn-ghost h-10 px-4 text-sm" data-testid="feedback-sort"><ArrowDownUp className="h-4 w-4" />{sort === "newest" ? "Newest first" : "Oldest first"}</button>
        </div>
        {tab === "clients" ? (data ? <Table rows={data.reviews} testid="feedback-table" /> : <div className="h-24 animate-pulse" />)
          : (ratings ? <Table rows={ratings.ratings} practitioner testid="client-ratings-table" /> : <div className="h-24 animate-pulse" />)}
        <p className="flex items-center gap-1.5 text-[11px] text-nb-mute"><Lock className="h-3.5 w-3.5" />Owner-only. Practitioner ratings are never shown to clients.</p>
      </div>
    </div>
  );
}
