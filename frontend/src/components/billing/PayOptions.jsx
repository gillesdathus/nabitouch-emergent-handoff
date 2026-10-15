import { useEffect, useState } from "react";
import { toast } from "sonner";
import { CreditCard, Landmark, Loader2, Copy, Clock3 } from "lucide-react";
import { api, apiError } from "@/lib/api";
import { GiftCardApply } from "@/components/billing/GiftCardApply";

const TIPS = [0, 10, 15, 20];

function TipPicker({ invoice, tip, setTip }) {
  const pct = (p) => Math.round((invoice.total.cents * p) / 100);
  return (
    <div className="mb-3" data-testid="billing-tip-picker">
      <p className="mb-2 text-xs text-nb-mute">Add a tip? 100% goes to your practitioner.</p>
      <div className="flex flex-wrap gap-2">
        {TIPS.map((p) => <button key={p} type="button" onClick={() => setTip(pct(p))} data-testid={`billing-tip-${p}`} className={`h-9 rounded-full px-4 text-xs font-semibold ring-1 transition-colors ${tip === pct(p) ? "bg-nb-navy text-white ring-nb-navy" : "bg-white ring-sky-100"}`}>{p ? `${p}% · $${(pct(p) / 100).toFixed(2)}` : "No tip"}</button>)}
      </div>
    </div>
  );
}

function CardPay({ invoice, enabled }) {
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");
  const [tip, setTip] = useState(0);
  if (!enabled) return <p className="text-xs text-nb-mute" data-testid="billing-card-off">Card checkout is turned off for now. e-Transfer and cash at the visit remain available.</p>;
  const start = async () => {
    setBusy(true);
    try {
      const started = await api.invoiceCheckout(invoice.id, { amountCents: invoice.balance.cents, tipCents: tip });
      if (started.url) window.location.assign(started.url);
      else setNote(`Checkout started for ${started.amount?.display}. Nothing is paid until Stripe confirms it.`);
    } catch (e) { setNote(apiError(e)); }
    setBusy(false);
  };
  return (
    <div>
      <TipPicker invoice={invoice} tip={tip} setTip={setTip} />
      <button type="button" onClick={start} disabled={busy} data-testid="billing-pay-card-btn" className="nb-btn-primary h-12 w-full">
        {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <CreditCard className="h-4 w-4" />}Pay ${((invoice.balance.cents + tip) / 100).toFixed(2)} by card
      </button>
      {note && <p className="mt-2 text-xs text-nb-mute" data-testid="billing-card-note">{note}</p>}
    </div>
  );
}

function Transfer({ invoice, onChange }) {
  const [cfg, setCfg] = useState(undefined);
  useEffect(() => { api.etransferSettings().then(setCfg).catch(() => setCfg(null)); }, []);
  if (cfg === undefined) return <div className="h-24 rounded-2xl nb-skeleton" />;
  if (!cfg?.recipientEmail) return <p className="text-xs text-nb-mute" data-testid="billing-etransfer-off">e-Transfer instructions are not configured yet.</p>;
  const ref = invoice.number || invoice.id;
  const report = async () => {
    try { onChange(await api.reportTransfer(invoice.id, `sent-${invoice.id}`.slice(0, 80))); toast.success("Thanks. Reception will verify the transfer."); }
    catch (e) { toast.error(apiError(e)); }
  };
  return (
    <div className="rounded-2xl p-4 tint-ice" data-testid="billing-etransfer">
      <p className="flex items-center gap-2 text-sm font-semibold text-nb-navy"><Landmark className="h-4 w-4" />Interac e-Transfer</p>
      <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-sm">
        <dt className="text-nb-mute">Send to</dt><dd className="font-medium" data-testid="billing-etransfer-email">{cfg.recipientName ? `${cfg.recipientName} · ` : ""}{cfg.recipientEmail}</dd>
        <dt className="text-nb-mute">Amount</dt><dd className="nb-num font-medium">{invoice.balance.display}</dd>
        <dt className="text-nb-mute">Message</dt><dd className="flex items-center gap-2 font-mono text-[13px]" data-testid="billing-etransfer-ref">{ref}<button type="button" aria-label="Copy reference" data-testid="billing-copy-ref" onClick={() => navigator.clipboard?.writeText(ref).then(() => toast.success("Reference copied"))}><Copy className="h-3.5 w-3.5 text-nb-blue" /></button></dd>
      </dl>
      {cfg.instructions && <p className="mt-2 text-xs text-nb-mute">{cfg.instructions}</p>}
      {invoice.clientReportedTransfer
        ? <p className="mt-3 flex items-center gap-2 text-xs font-medium text-cyan-800" data-testid="billing-etransfer-reported"><Clock3 className="h-3.5 w-3.5" />You reported a transfer. It counts as paid only after reception verifies it.</p>
        : <button type="button" onClick={report} data-testid="billing-etransfer-sent-btn" className="nb-btn-ghost mt-3 h-10 text-sm">I've sent the e-Transfer</button>}
    </div>
  );
}

export function PayOptions({ invoice, cardsOn, giftOn, onChange }) {
  if (!invoice || invoice.balance.cents <= 0 || invoice.state === "voided" || invoice.state === "draft") return null;
  return (
    <section className="space-y-3" data-testid="billing-pay-options">
      <p className="nb-eyebrow">Pay remaining balance</p>
      <CardPay invoice={invoice} enabled={cardsOn} />
      {giftOn && <GiftCardApply invoice={invoice} onChange={onChange} />}
      <Transfer invoice={invoice} onChange={onChange} />
    </section>
  );
}
