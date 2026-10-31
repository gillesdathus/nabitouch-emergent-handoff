import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { ExternalLink, FileText, Shield } from "lucide-react";
import { InvoiceDrawer } from "@/components/billing/InvoiceDrawer";
import { InvoiceStatePill } from "@/components/billing/InvoiceBits";
import { EClaimsWorkspace } from "@/components/billing/EClaimsWorkspace";
import { EmptyState, ErrorState, PageHeader, Panel, SearchField, SkeletonRows } from "@/components/ds";
import { fmtDate } from "@/lib/domain";
import { useInvoices } from "@/lib/useInvoices";
import { useDemo } from "@/store/DemoStore";

function matches(row, q) {
  if (!q) return true;
  return [row.number, row.clientName, row.service, row.practitionerName].filter(Boolean).join(" ").toLowerCase().includes(q);
}

export default function EClaims({ role = "owner" }) {
  const { idx } = useDemo();
  const { rows, error, reload, replace } = useInvoices({}, true, true);
  const [query, setQuery] = useState("");
  const [openId, setOpenId] = useState(null);
  const [focusId, setFocusId] = useState(null);
  const q = query.trim().toLowerCase();
  const issued = useMemo(
    () => (rows || []).filter((row) => !["draft", "voided"].includes(row.state) && matches(row, q)),
    [rows, q],
  );
  const active = (rows || []).find((row) => row.id === openId) || null;
  const focus = (rows || []).find((row) => row.id === focusId) || null;
  const staffLink = role === "owner" ? "/owner/payments" : "/desk/verify";
  const patientsLink = role === "owner" ? "/owner/clients" : "/desk/clients";
  const pathwaysHome = role === "owner" ? "/owner/zones" : null;
  const receptionPerms = idx?.settings?.receptionPerms || {};
  const deskMayEclaims = Boolean(
    receptionPerms.eclaimsView || receptionPerms.eclaimsSubmit || receptionPerms.eclaimsManage,
  );

  if (role === "desk" && idx && !deskMayEclaims) {
    return (
      <div className="min-w-0 space-y-4" data-testid="desk-eclaims-denied">
        <PageHeader
          eyebrow="Billing"
          title="eClaims"
          accent="workspace"
          description="eClaims access for reception is controlled by dedicated permissions."
        />
        <EmptyState
          icon={Shield}
          title="eClaims is not enabled for reception"
          body="Ask an owner to turn on eClaims view or submit under Permissions. Payment management alone does not grant eClaims access."
          testid="eclaims-desk-denied"
        />
      </div>
    );
  }

  return (
    <div className="min-w-0 space-y-6" data-testid={`${role}-eclaims`}>
      <PageHeader
        eyebrow="Billing"
        title="eClaims"
        accent="workspace"
        description="Copy verified claim fields and open insurer portals from an issued invoice. Nabitouch never submits claims or invents missing insurance details."
      />
      <Panel
        title="Issued invoices"
        action={<span className="text-xs text-nb-mute" data-testid="eclaims-invoice-count">{rows ? `${issued.length} shown` : ""}</span>}
        testid="eclaims-invoice-panel"
      >
        <div className="mb-3">
          <SearchField value={query} onChange={setQuery} placeholder="Search number, client, service, practitioner" testid="eclaims-search" />
        </div>
        {error && <ErrorState message={error} onRetry={reload} />}
        {rows === undefined && <SkeletonRows rows={4} />}
        {rows && !issued.length && (
          <EmptyState
            icon={Shield}
            title={rows.length ? "No matching invoices" : "No issued invoices yet"}
            body={rows.length ? "Clear the search or open Invoices to issue a draft." : "Issue an invoice first, then return here to prepare an external claim."}
            testid="eclaims-empty"
          />
        )}
        {issued.length > 0 && (
          <ul className="space-y-2" data-testid="eclaims-invoice-list">
            {issued.map((row) => (
              <li key={row.id}>
                <button
                  type="button"
                  onClick={() => { setFocusId(row.id); setOpenId(null); }}
                  className={`nb-row w-full items-start text-left ring-1 ${focusId === row.id ? "ring-nb-navy" : "ring-sky-100"}`}
                  data-testid={`eclaims-invoice-${row.id}`}
                >
                  <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl tint-ice"><FileText className="h-4 w-4 text-nb-blue" aria-hidden="true" /></span>
                  <span className="min-w-0 flex-1">
                    <span className="flex min-w-0 items-center justify-between gap-2">
                      <span className="truncate text-sm font-semibold">{row.number || "Invoice"}</span>
                      <InvoiceStatePill invoice={row} />
                    </span>
                    <span className="block truncate text-xs text-nb-mute">{row.clientName || "Client"} · {row.service}</span>
                    <span className="mt-1 block text-[11px] text-nb-mute">{row.serviceDate ? fmtDate(row.serviceDate, { month: "short", day: "numeric", year: "numeric" }) : "—"} · {row.total.display}</span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </Panel>

      {focus && (
        <Panel
          title={`Claim prep · ${focus.number || focus.id}`}
          action={(
            <button type="button" onClick={() => setOpenId(focus.id)} className="nb-btn-ghost h-9 text-xs" data-testid="eclaims-open-invoice">
              Open invoice
            </button>
          )}
          testid="eclaims-focus-panel"
        >
          <EClaimsWorkspace invoiceId={focus.id} clientId={focus.clientId} patientsLink={patientsLink} />
        </Panel>
      )}

      {!focus && rows && issued.length > 0 && (
        <p className="text-sm text-nb-mute" data-testid="eclaims-pick-hint">Select an invoice to load copyable claim fields and portal pathways.</p>
      )}

      {pathwaysHome && (
        <p className="text-xs text-nb-mute">
          Insurer API integrations stay under{" "}
          <Link to={pathwaysHome} className="font-semibold text-nb-blue" data-testid="eclaims-zones-link">Zones &amp; settings</Link>
          . Portal links open in a new tab with <span className="inline-flex items-center gap-1">noopener noreferrer <ExternalLink className="h-3 w-3" /></span>.
        </p>
      )}

      <InvoiceDrawer
        invoice={active}
        open={Boolean(active)}
        onOpenChange={(o) => !o && setOpenId(null)}
        staffLink={staffLink}
        flags={{ emailOn: idx?.settings?.invoiceEmailEnabled === true }}
        onChange={(next) => { replace(next); reload(); }}
      />
    </div>
  );
}
