import { useEffect, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { toast } from "sonner";
import { Download, Mail, Receipt, Loader2, CreditCard, Banknote, Landmark, ShieldCheck, Undo2, Gift, ArrowUpRight } from "lucide-react";
import { Drawer, DrawerContent, DrawerTitle, DrawerDescription } from "@/components/ui/drawer";
import { InvoiceStatePill, MoneyLedger, TideBar } from "@/components/billing/InvoiceBits";
import { PayOptions } from "@/components/billing/PayOptions";
import { downloadInvoicePdf, downloadReceiptPdf, newKey } from "@/lib/useInvoices";
import { api, apiError } from "@/lib/api";
import { formatCents } from "@/lib/billing";
import { StaffInvoiceActions } from "@/components/billing/StaffInvoiceActions";
import { fmtDate } from "@/lib/domain";

const METHOD_ICON = { stripe: CreditCard, cash: Banknote, etransfer: Landmark, insurance: ShieldCheck, giftcard: Gift };
const TYPE_LABEL = { client_payment: "Payment", insurance_receipt: "Insurance payment", refund: "Refund", reversal: "Reversal", adjustment: "Adjustment", credit: "Credit", void: "Voided" };

function Lines({ invoice }) {
  if (!invoice.lines?.length) return null;
  return (
    <section data-testid="invoice-lines">
      <p className="nb-eyebrow mb-2">Items</p>
      <ul className="space-y-1.5">
        {invoice.lines.map((line, i) => (
          <li key={i} className="flex justify-between gap-3 text-sm"><span className="text-nb-ink">{line.description}{line.quantity > 1 ? ` × ${line.quantity}` : ""}</span><span className="nb-num">{formatCents(line.netCents)}</span></li>
        ))}
        <li className="flex justify-between gap-3 text-sm text-nb-mute"><span>GST</span><span className="nb-num">{invoice.tax.display}</span></li>
      </ul>
    </section>
  );
}

function Payments({ invoice }) {
  const rows = (invoice.payments || []).filter((p) => p.type !== "issue");
  return (
    <section data-testid="invoice-payment-history">
      <p className="nb-eyebrow mb-2">Payment history</p>
      {rows.length === 0 && <p className="text-sm text-nb-mute">No confirmed payments yet.</p>}
      <ul className="space-y-2">
        {rows.map((p) => {
          const Icon = p.type === "refund" ? Undo2 : METHOD_ICON[p.method] || Receipt;
          return (
            <li key={p.id} className="flex items-center gap-3 rounded-2xl bg-white p-3 ring-1 ring-sky-100" data-testid={`invoice-payment-${p.id}`}>
              <span className="grid h-9 w-9 place-items-center rounded-xl tint-mint"><Icon className="h-4 w-4 text-nb-teal" /></span>
              <span className="min-w-0 flex-1"><span className="block text-sm font-medium">{TYPE_LABEL[p.type] || p.type}{p.method ? ` · ${p.method}` : ""}</span><span className="block text-xs text-nb-mute">{p.at ? new Date(p.at).toLocaleDateString("en-CA", { month: "short", day: "numeric", year: "numeric" }) : ""}{p.reference ? ` · ${p.reference}` : ""}</span></span>
              <span className="nb-num text-sm font-semibold">{p.amount.display}</span>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function Documents({ invoice, emailOn, staff }) {
  if (!staff && !invoice.releasedAt) return <p className="rounded-2xl p-4 text-xs text-nb-mute tint-ice" data-testid="invoice-pending-release">{invoice.state === "paid" ? "Paid in full. Your final invoice and receipt will be available here once Nabitouch approves them." : "Your invoice PDF and receipt become available once the balance is paid and Nabitouch approves the final invoice."}</p>;
  const [busy, setBusy] = useState("");
  const run = (what, fn) => async () => { setBusy(what); try { await fn(); } catch (e) { toast.error(apiError(e) || "That did not work."); } setBusy(""); };
  const email = run("email", async () => { const res = await api.emailInvoice(invoice.id, "invoice", newKey("mail")); toast.success(res.queued ? "Email queued. Delivery is confirmed only by the provider." : "Not queued"); });
  const hasReceipt = invoice.received.cents > 0;
  return (
    <section className="grid gap-2 sm:grid-cols-3" data-testid="invoice-documents">
      <button type="button" onClick={run("pdf", () => downloadInvoicePdf(invoice))} disabled={Boolean(busy) || invoice.state === "draft"} data-testid="invoice-download-pdf" className="nb-btn-dark h-11 text-sm">{busy === "pdf" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}Invoice PDF</button>
      <button type="button" onClick={run("receipt", () => downloadReceiptPdf(invoice))} disabled={Boolean(busy) || !hasReceipt} title={hasReceipt ? "Download receipt" : "A receipt is available after a confirmed payment"} data-testid="invoice-download-receipt" className="nb-btn-ghost h-11 text-sm">{busy === "receipt" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Receipt className="h-4 w-4" />}Receipt</button>
      <button type="button" onClick={email} disabled={Boolean(busy) || !emailOn} title={emailOn ? "Email this invoice" : "Invoice email is turned off"} data-testid="invoice-email" className="nb-btn-ghost h-11 text-sm">{busy === "email" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Mail className="h-4 w-4" />}{emailOn ? "Email" : "Email · off"}</button>
    </section>
  );
}

export function InvoiceDrawer({ invoice, open, onOpenChange, flags = {}, onChange, staffLink }) {
  const { pathname } = useLocation();
  const [detail, setDetail] = useState(invoice);
  useEffect(() => { setDetail(invoice); }, [invoice]);
  useEffect(() => {
    if (!open || !staffLink || !invoice?.id) return undefined;
    let alive = true;
    // Staff list rows omit contact + payableNow; refresh the authorized detail view for payment actions.
    api.invoice(invoice.id).then((next) => { if (alive) setDetail(next); }).catch(() => {});
    return () => { alive = false; };
  }, [open, staffLink, invoice?.id]);
  const view = detail || invoice;
  return (
    <Drawer open={open} onOpenChange={onOpenChange}>
      <DrawerContent className="mx-auto max-h-[92dvh] max-w-2xl rounded-t-[32px] border-0 bg-nb-canvas" data-testid="invoice-drawer">
        {view && (
          <div className="overflow-y-auto px-5 pb-[calc(2rem+var(--nb-safe-b))]">
            <div className="relative mt-3 overflow-hidden rounded-[28px] p-5 text-white nb-lagoon">
              <div className="absolute -right-10 -top-10 h-40 w-40 rounded-full bg-nb-turq/40 blur-2xl" />
              <div className="relative flex items-start justify-between gap-3">
                <div><DrawerTitle className="text-lg font-semibold text-white" data-testid="invoice-drawer-number">{view.number || "Draft invoice"}</DrawerTitle><DrawerDescription className="text-sm text-white/75">{view.clientName && staffLink ? `${view.clientName} · ` : ""}{view.service}{view.duration ? ` · ${view.duration} min` : ""}{view.serviceDate ? ` · ${fmtDate(view.serviceDate)}` : ""}</DrawerDescription></div>
                <InvoiceStatePill invoice={view} testid="invoice-drawer-state" />
              </div>
              <p className="relative mt-5 text-xs text-white/70">{view.state === "draft" ? "Draft total · not issued" : "Outstanding"}</p>
              <p className="nb-num relative text-4xl font-semibold" data-testid="invoice-drawer-balance">{view.state === "draft" ? view.total.display : view.balance.display}</p>
              <div className="relative mt-4"><TideBar invoice={view} dark /></div>
              <p className="relative mt-2 text-[11px] text-white/70">Solid: money received. Dashed: insurance expected, not yet received.</p>
            </div>
            <div className="mt-5 space-y-6">
              <MoneyLedger invoice={view} staff={Boolean(staffLink)} />
              {staffLink
                ? <><StaffInvoiceActions invoice={view} onChange={(next) => { setDetail(next); onChange?.(next); }} staffLink={staffLink} emailOn={flags.emailOn} />{pathname !== staffLink && <Link to={staffLink} data-testid="invoice-open-payments" className="nb-btn-ghost h-11 w-full text-sm">Open payments ledger<ArrowUpRight className="h-4 w-4" /></Link>}</>
                : <PayOptions invoice={view} cardsOn={flags.cardsOn} giftOn={flags.giftOn} onChange={(next) => { setDetail(next); onChange?.(next); }} />}
              <Lines invoice={view} />
              <Payments invoice={view} />
              <Documents invoice={view} emailOn={flags.emailOn} staff={Boolean(staffLink)} />
              {view.practitionerName && <p className="text-xs text-nb-mute">Practitioner: {view.practitionerName}{view.dueDate ? ` · Due ${fmtDate(view.dueDate.slice(0, 10))}` : ""}</p>}
            </div>
          </div>
        )}
      </DrawerContent>
    </Drawer>
  );
}
