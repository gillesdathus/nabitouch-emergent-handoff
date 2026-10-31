import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { toast } from "sonner";
import { Copy, ExternalLink, Loader2, ShieldCheck } from "lucide-react";
import { api, apiError } from "@/lib/api";

function CopyField({ field }) {
  const empty = !field.value;
  const copy = async () => {
    if (empty) return;
    try {
      await navigator.clipboard?.writeText(field.value);
      toast.success(`${field.label} copied`);
    } catch {
      toast.error("Could not copy");
    }
  };
  return (
    <div className="flex items-start gap-2 rounded-xl bg-white/80 p-2.5 ring-1 ring-sky-100" data-testid={`eclaims-field-${field.id}`}>
      <div className="min-w-0 flex-1">
        <p className="text-[11px] text-nb-mute">{field.label}</p>
        <p className={`break-words text-sm font-medium ${empty ? "text-nb-mute" : "text-nb-ink"}`}>{empty ? "Not on file" : field.value}</p>
      </div>
      <button type="button" onClick={copy} disabled={empty} aria-label={`Copy ${field.label}`} data-testid={`eclaims-copy-${field.id}`} className="nb-btn-ghost h-9 shrink-0 px-2 text-xs">
        <Copy className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}

export function EClaimsWorkspace({ invoiceId, clientId }) {
  const [ctx, setCtx] = useState(undefined);
  const [error, setError] = useState("");
  const [policyId, setPolicyId] = useState("");
  const [pathwayId, setPathwayId] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!invoiceId) return undefined;
    let alive = true;
    setError("");
    setCtx(undefined);
    api.invoiceEclaims(invoiceId)
      .then((body) => {
        if (!alive) return;
        setCtx(body);
        setPolicyId(body.selectedPolicyId || "");
        setPathwayId(body.pathways?.[0]?.id || "");
      })
      .catch((e) => {
        if (!alive) return;
        setError(apiError(e) || "eClaims workspace is unavailable");
        setCtx(null);
      });
    return () => { alive = false; };
  }, [invoiceId]);

  const selectPolicy = async (id) => {
    setPolicyId(id);
    if (!id || !invoiceId) return;
    setBusy(true);
    try {
      const next = await api.invoiceEclaimsFields(invoiceId, id);
      setCtx((prev) => (prev ? { ...prev, ...next, selectedPolicyId: next.selectedPolicyId } : prev));
    } catch (e) {
      toast.error(apiError(e));
    }
    setBusy(false);
  };

  if (ctx === undefined) {
    return <div className="h-28 rounded-2xl nb-skeleton" data-testid="eclaims-loading" />;
  }
  if (error || ctx === null) {
    return <p className="rounded-2xl bg-amber-50 p-3 text-xs text-amber-900" data-testid="eclaims-forbidden">{error || "Not permitted"}</p>;
  }

  const pathway = (ctx.pathways || []).find((row) => row.id === pathwayId) || ctx.pathways?.[0];

  return (
    <div className="space-y-3 rounded-2xl border border-sky-100 bg-white p-4" data-testid="eclaims-workspace">
      <div className="flex items-start gap-2">
        <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-nb-teal" />
        <div>
          <p className="text-sm font-semibold text-nb-navy">eClaims workspace</p>
          <p className="text-xs text-nb-mute">{ctx.notice}</p>
        </div>
      </div>

      {(ctx.policies || []).length === 0 && (
        <div className="rounded-xl bg-amber-50 p-3 text-xs text-amber-900" data-testid="eclaims-no-policy">
          No insurance details are saved on this patient. Complete the insurance profile before submitting externally.
          {clientId && <Link to="/owner/clients" className="mt-2 block font-semibold text-nb-blue">Open patients</Link>}
        </div>
      )}

      {(ctx.policies || []).length > 1 && (
        <label className="block text-xs text-nb-mute">
          Insurance policy
          <select className="nb-input mt-1 h-10 w-full" value={policyId} onChange={(e) => selectPolicy(e.target.value)} data-testid="eclaims-policy-select">
            <option value="">Select a policy</option>
            {ctx.policies.map((row) => (
              <option key={row.id} value={row.id}>{row.insurer || "Unnamed"} · {row.memberId || "no member ID"}</option>
            ))}
          </select>
        </label>
      )}

      {(ctx.policies || []).length === 1 && !ctx.policies[0].complete && (
        <p className="text-xs text-amber-800" data-testid="eclaims-incomplete-policy">This policy is incomplete. Missing carrier, policy/group, or member ID stay blank — nothing is invented.</p>
      )}

      <div>
        <p className="nb-eyebrow mb-2">Copyable claim fields</p>
        <div className="grid gap-2 sm:grid-cols-2">
          {(ctx.fields || []).map((field) => <CopyField key={field.id} field={field} />)}
        </div>
      </div>

      <div>
        <p className="nb-eyebrow mb-2">Submission pathway</p>
        <p className="mb-2 text-[11px] text-nb-mute">Choose the portal used to submit. The patient&apos;s insurer stays separate from the platform.</p>
        <div className="grid gap-2 sm:grid-cols-2" data-testid="eclaims-pathways">
          {(ctx.pathways || []).map((row) => (
            <button
              key={row.id}
              type="button"
              onClick={() => setPathwayId(row.id)}
              data-testid={`eclaims-pathway-${row.id}`}
              className={`rounded-xl px-3 py-2 text-left text-xs ring-1 transition-colors ${pathwayId === row.id ? "bg-nb-navy text-white ring-nb-navy" : "bg-slate-50 text-nb-ink ring-sky-100"}`}
            >
              <span className="block font-semibold">{row.name}</span>
              <span className={`block ${pathwayId === row.id ? "text-white/70" : "text-nb-mute"}`}>{row.kind === "platform" ? "Platform" : "Carrier portal"}</span>
            </button>
          ))}
        </div>
      </div>

      {pathway && (
        <div className="rounded-xl bg-slate-50 p-3" data-testid="eclaims-portal">
          <p className="text-sm font-semibold">{pathway.name}</p>
          <p className="mt-1 text-[11px] text-nb-mute">{pathway.notes}</p>
          {ctx.canSubmit ? (
            <a
              href={pathway.url}
              target="_blank"
              rel="noopener noreferrer"
              data-testid="eclaims-open-portal"
              className="nb-btn-primary mt-3 inline-flex h-10 items-center gap-2 text-sm"
            >
              <ExternalLink className="h-4 w-4" />Open portal
            </a>
          ) : (
            <p className="mt-2 text-xs text-nb-mute" data-testid="eclaims-submit-denied">You can view claim fields, but portal submission is not permitted for your role.</p>
          )}
        </div>
      )}

      {busy && <p className="flex items-center gap-2 text-xs text-nb-mute"><Loader2 className="h-3.5 w-3.5 animate-spin" />Updating policy fields…</p>}
    </div>
  );
}
