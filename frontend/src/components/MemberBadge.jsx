import { useEffect, useState } from "react";
import { Repeat } from "lucide-react";
import { api } from "@/lib/api";

export function MemberBadge({ apptId }) {
  const [rows, setRows] = useState([]);
  useEffect(() => {
    let live = true;
    api.visitMember(apptId).then((r) => { if (live) setRows(r.memberships || []); }).catch(() => {});
    return () => { live = false; };
  }, [apptId]);
  return rows.map((m) => (
    <span key={m.id} className="inline-flex max-w-full flex-wrap items-center gap-x-1.5 gap-y-0.5 rounded-2xl px-3 py-1.5 text-xs font-semibold text-nb-navy ring-1 ring-teal-200 tint-mint" data-testid={`member-badge-${m.id}`}>
      <span className="inline-flex items-center gap-1.5 whitespace-nowrap"><Repeat className="h-3.5 w-3.5 text-nb-teal" />Member · {m.name}</span><span className="whitespace-nowrap font-normal text-nb-mute" data-testid="member-credits-left">{m.creditsLeft} credit{m.creditsLeft === 1 ? "" : "s"} left this month</span>{m.status === "past_due" ? " · payment overdue" : ""}{m.endingSoon ? " · ending" : ""}
    </span>
  ));
}
