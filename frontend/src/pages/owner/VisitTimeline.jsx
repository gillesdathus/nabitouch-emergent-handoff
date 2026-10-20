import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { ArrowLeft } from "lucide-react";
import { api, apiError } from "@/lib/api";
import { Notice } from "@/components/tide";
import { ShieldChrome } from "@/components/shield/ShieldChrome";

export default function VisitTimeline() {
  const { id } = useParams();
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  useEffect(() => {
    api.shieldTimeline(id).then(setData).catch((e) => setError(apiError(e)));
  }, [id]);
  return (
    <ShieldChrome
      title={data?.ref ? `Timeline · ${data.ref}` : "Visit timeline"}
      sub="Operational events only. Clinical notes are excluded."
      right={<Link to="/owner/shield/visits" className="nb-btn-ghost inline-flex h-10 items-center gap-1 px-3 text-sm" data-testid="shield-timeline-back"><ArrowLeft className="h-4 w-4" />Visits</Link>}
      testid="shield-timeline-page"
    >
      {error && <Notice>{error}</Notice>}
      {data?.note && <Notice testid="shield-timeline-note">{data.note}</Notice>}
      {data?.vehiclePublic && <p className="text-sm" data-testid="shield-timeline-vehicle">Vehicle: {data.vehiclePublic.label}</p>}
      <ol className="space-y-3" data-testid="shield-timeline-list">
        {(data?.events || []).map((e, i) => (
          <li key={`${e.at}-${i}`} className="nb-card p-4">
            <div className="flex justify-between gap-3 text-sm">
              <span className="font-semibold">{(e.type || e.status || "event").replace(/_/g, " ")}</span>
              <span className="text-xs text-nb-mute">{e.at ? new Date(e.at).toLocaleString("en-CA", { timeZone: "America/Edmonton" }) : ""}</span>
            </div>
            <p className="mt-1 text-xs text-nb-mute">{e.actor}{e.note ? ` · ${e.note}` : ""}{e.observed ? " · observed location/ETA" : ""}</p>
          </li>
        ))}
      </ol>
    </ShieldChrome>
  );
}
