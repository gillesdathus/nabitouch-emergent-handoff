import { useState } from "react";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Field } from "@/components/tide";
import { GiftCardArt, GIFT_DESIGNS } from "@/components/giftcards/GiftCardArt";
import { api, apiError } from "@/lib/api";
import { newKey } from "@/lib/useInvoices";

const EMPTY = { amount: "100", recipientName: "", recipientEmail: "", purchaserName: "", message: "", design: "lagoon", complimentary: false, method: "cash", reference: "" };

export function IssueGiftDialog({ open, onOpenChange, onDone }) {
  const [f, setF] = useState(EMPTY);
  const [busy, setBusy] = useState(false);
  const [key, setKey] = useState(() => newKey("gcissue"));
  const set = (k) => (e) => setF({ ...f, [k]: e.target.type === "checkbox" ? e.target.checked : e.target.value });
  const cents = Math.round(Number(f.amount || 0) * 100);
  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    try {
      const card = await api.giftIssue({ ...f, amountCents: cents, idempotencyKey: key, method: f.complimentary ? undefined : f.method });
      toast.success(`Issued ${card.code}`);
      setF(EMPTY); setKey(newKey("gcissue")); onDone?.(); onOpenChange(false);
    } catch (err) { toast.error(apiError(err)); }
    setBusy(false);
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92vh] max-w-2xl overflow-y-auto rounded-[28px]" data-testid="gift-issue-dialog">
        <DialogHeader><DialogTitle>Issue a gift card</DialogTitle><DialogDescription>Paid cards need a verified cash or e-Transfer payment and its reference.</DialogDescription></DialogHeader>
        <form onSubmit={submit} className="grid gap-5 sm:grid-cols-2">
          <div>
            <GiftCardArt design={f.design} amount={`$${Number(f.amount || 0).toFixed(2)}`} recipient={f.recipientName} />
            <div className="mt-3 flex gap-2">{GIFT_DESIGNS.map((d) => <button key={d} type="button" onClick={() => setF({ ...f, design: d })} data-testid={`gift-issue-design-${d}`} className={`flex-1 rounded-xl py-1.5 text-xs capitalize ring-1 ${f.design === d ? "bg-nb-navy text-white ring-nb-navy" : "ring-sky-100"}`}>{d}</button>)}</div>
          </div>
          <div>
            <Field label="Amount (CAD)"><input type="number" min="1" max="5000" step="0.01" required className="nb-input h-11" value={f.amount} onChange={set("amount")} data-testid="gift-issue-amount" /></Field>
            <Field label="Recipient name"><input required className="nb-input h-11" value={f.recipientName} onChange={set("recipientName")} data-testid="gift-issue-recipient" /></Field>
            <Field label="Recipient email"><input type="email" className="nb-input h-11" value={f.recipientEmail} onChange={set("recipientEmail")} data-testid="gift-issue-email" /></Field>
            <Field label="Purchaser name"><input className="nb-input h-11" value={f.purchaserName} onChange={set("purchaserName")} data-testid="gift-issue-purchaser" /></Field>
            <label className="mb-3 flex items-center gap-2 text-sm"><input type="checkbox" checked={f.complimentary} onChange={set("complimentary")} data-testid="gift-issue-complimentary" />Complimentary (no payment)</label>
            {!f.complimentary && <div className="grid grid-cols-2 gap-2">
              <select className="nb-input h-11" value={f.method} onChange={set("method")} data-testid="gift-issue-method"><option value="cash">Cash</option><option value="etransfer">e-Transfer (verified)</option></select>
              <input required className="nb-input h-11" placeholder="Reference" value={f.reference} onChange={set("reference")} data-testid="gift-issue-reference" />
            </div>}
            <Field label="Message"><input className="nb-input h-11" maxLength={240} value={f.message} onChange={set("message")} data-testid="gift-issue-message" /></Field>
            <button disabled={busy || cents <= 0} className="nb-btn-primary h-12 w-full" data-testid="gift-issue-submit">{busy && <Loader2 className="h-4 w-4 animate-spin" />}Issue card</button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
