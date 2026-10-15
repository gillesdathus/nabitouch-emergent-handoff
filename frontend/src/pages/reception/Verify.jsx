import { useState } from "react";
import { FileImage, Lock } from "lucide-react";
import { AppointmentSheet } from "@/components/AppointmentSheet";
import { PayPill, SectionHead } from "@/components/ui-kit";
import { useDemo } from "@/store/DemoStore";
import { staffActor } from "@/lib/domain";
import Payments from "@/pages/owner/Payments";

const NEXT = [["verification_pending", "Mark verification pending"], ["info_required", "Needs more information"]];

export default function Verify() {
  const { state, run, api, perm, user } = useDemo();
  const [sel] = useState(null);
  if (!perm("viewInsuranceStatus")) return <div className="nb-soft flex flex-col items-center gap-2 p-10 text-sm text-nb-mute" data-testid="verify-restricted"><Lock className="h-6 w-6" />Insurance verification isn’t enabled for your role.</div>;
  const queue = state.clients.flatMap((c) => c.insurance.filter((i) => i.status !== "direct_billing_available").map((i) => ({ c, i })));
  const setStatus = (c, i, status) => run(() => api.patch("clients", c.id, { insurance: c.insurance.map((x) => (x.id === i.id ? { ...x, status } : x)), _audit: `Insurance for ${c.firstName} ${c.lastName} → ${status.replace(/_/g, " ")}`, _actor: staffActor(user) }), "Status recorded. Nothing was sent to an insurer.");
  return (
    <div className="space-y-10" data-testid="desk-verify">
      <div>
        <SectionHead eyebrow="Insurance" title="Document verification queue" />
        <p className="mb-3 text-sm text-nb-mute">Status updates are recorded here. They are not sent to an insurer.</p>
        <div className="space-y-3">
          {queue.map(({ c, i }) => (
            <div key={i.id} className="nb-card flex flex-wrap items-center gap-4 p-4" data-testid={`verify-item-${i.id}`}>
              <div className="flex h-14 w-20 items-center justify-center rounded-xl bg-sky-50">{i.hasCardImage ? (perm("viewInsuranceDocs") ? <FileImage className="h-6 w-6 text-nb-blue" /> : <Lock className="h-5 w-5 text-slate-400" />) : <span className="text-[10px] text-nb-mute">No card</span>}</div>
              <div className="min-w-[180px] flex-1 text-sm"><p className="font-semibold">{c.firstName} {c.lastName}</p><p className="text-xs text-nb-mute">{i.insurer || "Insurer missing"} · policy {i.policy || "—"} · member {i.memberId || "—"} · holder {i.holderName} ({i.relationship})</p>{i.hasCardImage && <p className="text-[10px] text-nb-mute">{perm("viewInsuranceDocs") ? "A card photo is attached to this profile and is not sent to an insurer from here." : "Document access not permitted"}</p>}</div>
              <PayPill status={i.status} />
              <div className="flex flex-wrap gap-1.5">{NEXT.filter(([s]) => s !== i.status).map(([s, l]) => <button key={s} onClick={() => setStatus(c, i, s)} data-testid={`verify-${i.id}-${s}`} className="nb-chip-off text-xs">{l}</button>)}</div>
            </div>))}
          {!queue.length && <p className="text-sm text-nb-mute">Queue clear.</p>}
        </div>
      </div>
      {perm("managePayments") ? <Payments role="desk" /> : <p className="text-sm text-nb-mute">Payment management not permitted.</p>}
      {sel && <AppointmentSheet apptId={sel} role="desk" onClose={() => {}} />}
    </div>
  );
}
