import { useState } from "react";
import { toast } from "sonner";
import { Download, Mail, Receipt, Loader2, CreditCard, Banknote, Landmark, ShieldCheck, Undo2 } from "lucide-react";
import { Drawer, DrawerContent, DrawerTitle, DrawerDescription } from "@/components/ui/drawer";
import { InvoiceStatePill, MoneyLedger, TideBar } from "@/components/billing/InvoiceBits";
import { PayOptions } from "@/components/billing/PayOptions";
import { downloadInvoicePdf } from "@/lib/useInvoices";
import { formatCents } from "@/lib/billing";
import { fmtDate } from "@/lib/domain";

const METHOD_ICON = { stripe: CreditCard, cash: Banknote, etransfer: Landmark, insurance: ShieldCheck };
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
              <span className="min-w-0 flex-1"><span className="block text-sm font-medium">{TYPE_LABEL[p.type] || p.type}{p.method ? ` · ${p.method}` : ""}</span><span className="block text-xs text-nb-mute">{p.at ? new Date(p.at).toLocaleDateString("en-CA", { month: "short", day: "numeric", year: "numeric" }) : ""}</span></span>
              <span className="nb-num text-sm font-semibold">{p.amount.display}</span>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function Documents({ invoice }) {
  const [busy, setBusy] = useState(false);
  const pdf = async () => { setBusy(true); try { await downloadInvoicePdf(invoice); } catch { toast.error("The PDF could not be downloaded."); } setBusy(false); };
  return (
    <section className="grid gap-2 sm:grid-cols-3" data-testid="invoice-documents">
      <button type="button" onClick={pdf} disabled={busy || invoice.state === "draft"} data-testid="invoice-download-pdf" className="nb-btn-dark h-11 text-sm">{busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}Invoice PDF</button>
      <button type="button" disabled data-testid="invoice-download-receipt" title="Receipt PDF is not available yet" className="nb-btn-ghost h-11 text-sm"><Receipt className="h-4 w-4" />Receipt · soon</button>
      <button type="button" disabled data-testid="invoice-email" title="Email delivery is not enabled" className="nb-btn-ghost h-11 text-sm"><Mail className="h-4 w-4" />Email · off</button>
    </section>
  );
}

export function InvoiceDrawer({ invoice, open, onOpenChange, cardsOn, onChange }) {
  return (
    <Drawer open={open} onOpenChange={onOpenChange}>
      <DrawerContent className="mx-auto max-h-[92vh] max-w-2xl rounded-t-[32px] border-0 bg-nb-canvas" data-testid="invoice-drawer">
        {invoice && (
          <div className="overflow-y-auto px-5 pb-8">
            <div className="relative mt-3 overflow-hidden rounded-[28px] p-5 text-white nb-lagoon">
              <div className="absolute -right-10 -top-10 h-40 w-40 rounded-full bg-nb-turq/40 blur-2xl" />
              <div className="relative flex items-start justify-between gap-3">
                <div><DrawerTitle className="text-lg font-semibold text-white" data-testid="invoice-drawer-number">{invoice.number || "Draft invoice"}</DrawerTitle><DrawerDescription className="text-sm text-white/75">{invoice.service}{invoice.duration ? ` · ${invoice.duration} min` : ""}{invoice.serviceDate ? ` · ${fmtDate(invoice.serviceDate)}` : ""}</DrawerDescription></div>
                <InvoiceStatePill invoice={invoice} testid="invoice-drawer-state" />
              </div>
              <p className="relative mt-5 text-xs text-white/70">Outstanding</p>
              <p className="nb-num relative text-4xl font-semibold" data-testid="invoice-drawer-balance">{invoice.balance.display}</p>
              <div className="relative mt-4"><TideBar invoice={invoice} dark /></div>
              <p className="relative mt-2 text-[11px] text-white/70">Solid: money received. Dashed: insurance expected, not yet received.</p>
            </div>
            <div className="mt-5 space-y-6">
              <MoneyLedger invoice={invoice} />
              <PayOptions invoice={invoice} cardsOn={cardsOn} onChange={onChange} />
              <Lines invoice={invoice} />
              <Payments invoice={invoice} />
              <Documents invoice={invoice} />
              {invoice.practitionerName && <p className="text-xs text-nb-mute">Practitioner: {invoice.practitionerName}{invoice.dueDate ? ` · Due ${fmtDate(invoice.dueDate.slice(0, 10))}` : ""}</p>}
            </div>
          </div>
        )}
      </DrawerContent>
    </Drawer>
  );
}
