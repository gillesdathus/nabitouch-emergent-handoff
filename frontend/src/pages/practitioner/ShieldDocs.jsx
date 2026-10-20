import { useEffect, useState } from "react";
import { toast } from "sonner";
import { api, apiError } from "@/lib/api";
import { restrictedFlag } from "@/lib/feature-flags";
import { useDemo } from "@/store/DemoStore";
import { Notice, PageHeader } from "@/components/tide";

export default function ShieldDocs() {
  const { idx } = useDemo();
  const enabled = restrictedFlag(idx?.settings, "securityShieldDocsEnabled");
  const [rows, setRows] = useState([]);
  const [form, setForm] = useState({ jurisdiction: "AB", licenceClass: "5", licenceNumber: "", expiresOn: "" });

  const load = () => api.shieldDriverCredentials().then((r) => setRows(r.credentials || [])).catch((e) => toast.error(apiError(e)));
  useEffect(() => { if (enabled) load(); }, [enabled]); // eslint-disable-line

  if (!enabled) {
    return (
      <div className="mx-auto max-w-lg space-y-6" data-testid="pro-shield-docs-off">
        <PageHeader eyebrow="Security Shield" title="My driver's licence" />
        <Notice>Document management is turned off in this environment.</Notice>
      </div>
    );
  }

  const submit = async () => {
    try {
      await api.shieldSubmitDriverCredential(form);
      toast.success("Submitted for owner review");
      setForm((f) => ({ ...f, licenceNumber: "", expiresOn: "" }));
      load();
    } catch (e) { toast.error(apiError(e)); }
  };

  return (
    <div className="mx-auto max-w-lg space-y-6" data-testid="pro-shield-docs">
      <PageHeader eyebrow="Security Shield" title="My driver's licence" sub="Clients never see your licence number or document. Auto insurance for your assigned vehicle is managed by the owner under Fleet." />
      <div className="nb-card space-y-2 p-4">
        <input className="nb-input h-10" placeholder="Jurisdiction" value={form.jurisdiction} onChange={(e) => setForm({ ...form, jurisdiction: e.target.value })} />
        <input className="nb-input h-10" placeholder="Licence class" value={form.licenceClass} onChange={(e) => setForm({ ...form, licenceClass: e.target.value })} />
        <input className="nb-input h-10" placeholder="Licence number" value={form.licenceNumber} onChange={(e) => setForm({ ...form, licenceNumber: e.target.value })} data-testid="pro-dl-number" />
        <input className="nb-input h-10" type="date" value={form.expiresOn} onChange={(e) => setForm({ ...form, expiresOn: e.target.value })} data-testid="pro-dl-expires" />
        <button type="button" onClick={submit} className="nb-btn-primary h-11 w-full" data-testid="pro-dl-submit">Submit for review</button>
      </div>
      {rows.map((row) => (
        <div key={row.id} className="nb-card p-4" data-testid={`pro-dl-${row.id}`}>
          <p className="font-semibold">{row.dashboardStatus.replace(/_/g, " ")}</p>
          <p className="text-xs text-nb-mute">{row.jurisdiction} · class {row.licenceClass} · {row.licenceNumberMasked} · expires {row.expiresOn || "—"}</p>
          {row.rejectReason && <p className="mt-2 text-xs text-rose-700">{row.rejectReason}</p>}
        </div>
      ))}
      <Notice>Professional liability insurance stays under Profile → Licence & insurance. That is not auto insurance.</Notice>
    </div>
  );
}
