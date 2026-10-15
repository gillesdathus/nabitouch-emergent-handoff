import { BadgeCheck, Clock, AlertTriangle, ShieldCheck, Check, X } from "lucide-react";
import { usePreview } from "@/store/PreviewStore";
import { PageHeader, Avatar, Pill, Reveal, ProgressRail, cx } from "@/components/ui-kit";
import { TopIcons } from "@/components/shells";
import { fmtDate } from "@/lib/domain";

const META = { verified: [BadgeCheck, "Verified", "bg-nb-green/15 text-[#3E7A1E] ring-nb-green/30"], pending: [Clock, "Pending review", "bg-sky-50 text-nb-blue ring-sky-200"], expiring: [AlertTriangle, "Expiring", "bg-nb-coral/10 text-nb-coral ring-nb-coral/25"] };

export default function Credentials() {
  const { db, api, openProfile } = usePreview();
  return (
    <div className="max-w-5xl mx-auto px-5 pt-12 lg:pt-14">
      <PageHeader eyebrow="Admin" title="Credentials" sub="Only the owner can verify. Practitioners never self-approve." right={<TopIcons base="/owner" />} />
      <div className="space-y-4">
        {db.practitioners.map((p, i) => {
          const creds = db.credentials.filter((c) => c.practitionerId === p.id);
          const ob = db.onboarding[p.id];
          const steps = ob ? Object.entries({ ...ob, credentials: creds.every((c) => c.status === "verified") }) : null;
          const ready = steps?.every(([, v]) => v);
          return (
            <Reveal key={p.id} i={i}>
              <div data-testid={`cred-group-${p.id}`} className="nb-card p-4">
                <button onClick={() => openProfile("practitioner", p.id)} className="flex items-center gap-3 w-full text-left"><Avatar src={p.photo} name={p.name} size={44} /><div className="flex-1"><p className="font-semibold">{p.name}</p><p className="text-xs text-nb-mute">{creds.length} documents</p></div>{p.bookable ? <Pill tone="bg-nb-turq/15 text-nb-teal ring-nb-turq/30">Bookable</Pill> : <Pill tone="bg-sky-50 text-nb-blue ring-sky-200">Onboarding</Pill>}</button>
                <div className="mt-3 divide-y divide-sky-100">
                  {creds.map((c) => { const [I, l, t] = META[c.status]; return (
                    <div key={c.id} className="flex items-center gap-3 py-3">
                      <I className="h-4 w-4 text-nb-teal" /><div className="flex-1 min-w-0"><p className="text-sm font-medium truncate">{c.type}</p><p className="text-xs text-nb-mute">Expires {fmtDate(c.expires, { month: "short", day: "numeric", year: "numeric" })}</p></div>
                      {c.status === "pending" ? <button data-testid={`cred-verify-${c.id}`} onClick={() => api.save("credentials", c.id, { status: "verified" }, "Credential verified")} className="nb-btn-dark h-9 px-4 text-xs"><ShieldCheck className="h-3.5 w-3.5" />Verify</button> : <Pill tone={t}>{l}</Pill>}
                    </div>
                  ); })}
                </div>
                {steps && (
                  <div className="mt-3 rounded-3xl tint-ice p-4">
                    <div className="flex items-center justify-between mb-2"><p className="text-sm font-semibold">Onboarding checklist</p><span className="text-xs text-nb-mute nb-num">{steps.filter(([, v]) => v).length}/{steps.length}</span></div>
                    <ProgressRail value={steps.filter(([, v]) => v).length / steps.length} />
                    <div className="grid grid-cols-2 gap-2 mt-3">{steps.map(([k, v]) => <span key={k} className={cx("flex items-center gap-1.5 text-xs capitalize", v ? "text-nb-ink" : "text-nb-mute")}>{v ? <Check className="h-3.5 w-3.5 text-nb-teal" /> : <X className="h-3.5 w-3.5 text-nb-coral" />}{k}</span>)}</div>
                    <button data-testid={`onboarding-approve-${p.id}`} disabled={!ready} onClick={async () => { await api.save("practitioners", p.id, { bookable: true, status: "active", accepting: true }, `${p.name} is now bookable`); }} className="nb-btn-primary w-full h-11 mt-3 text-sm">{ready ? "Approve onboarding" : "Gaps remain before approval"}</button>
                  </div>
                )}
              </div>
            </Reveal>
          );
        })}
      </div>
    </div>
  );
}
