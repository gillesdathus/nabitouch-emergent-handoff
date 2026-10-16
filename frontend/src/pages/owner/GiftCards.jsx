import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Gift, Plus, Search } from "lucide-react";
import { EmptyState, Notice, PageHeader, Reveal, Segmented } from "@/components/tide";
import { Pill } from "@/components/ui-kit";
import { GiftCardArt } from "@/components/giftcards/GiftCardArt";
import { GiftCardDrawer } from "@/components/giftcards/GiftCardDrawer";
import { GiftProducts } from "@/components/giftcards/GiftProducts";
import { IssueGiftDialog } from "@/components/giftcards/IssueGiftDialog";
import { api, apiError } from "@/lib/api";
import { newKey } from "@/lib/useInvoices";
import { useDemo } from "@/store/DemoStore";

const FILTERS = [{ value: "", label: "All" }, { value: "pending_payment", label: "Awaiting payment" }, { value: "active", label: "Active" }, { value: "redeemed", label: "Redeemed" }, { value: "voided", label: "Voided" }];

function Liability({ data }) {
  const tiles = [["Outstanding liability", data?.outstanding?.display, "gift-liability-outstanding"], ["Issued (paid + comp)", data?.issued?.display, "gift-liability-issued"], ["Redeemed", data?.redeemed?.display, "gift-liability-redeemed"], ["Awaiting payment", data ? `${data.pendingCount} ${data.pendingCount === 1 ? "card" : "cards"}` : "", "gift-liability-pending"]];
  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4" data-testid="gift-liability">
      {tiles.map(([label, value, id], i) => <div key={id} data-testid={id} className={`rounded-3xl p-4 ${i === 0 ? "nb-lagoon text-white" : "nb-card"}`}><p className={`text-xs ${i ? "text-nb-mute" : "text-white/75"}`}>{label}</p><p className="nb-num mt-1 text-2xl font-semibold">{value ?? "—"}</p></div>)}
    </div>
  );
}

function StaffActions({ card, isOwner, onChange }) {
  const [ref, setRef] = useState({ method: "etransfer", reference: "", reason: "" });
  const act = async (fn, msg) => { try { await fn(); toast.success(msg); onChange(); } catch (e) { toast.error(apiError(e)); } };
  return (
    <div className="mt-5 space-y-3" data-testid="gift-staff-actions">
      {card.status === "pending_payment" && (
        <div className="rounded-2xl p-4 tint-ice">
          <p className="text-sm font-semibold">Confirm payment to activate</p>
          <div className="mt-2 grid grid-cols-2 gap-2">
            <select className="nb-input h-10" value={ref.method} onChange={(e) => setRef({ ...ref, method: e.target.value })} data-testid="gift-activate-method"><option value="etransfer">e-Transfer (verified)</option><option value="cash">Cash</option></select>
            <input className="nb-input h-10" placeholder="Reference" value={ref.reference} onChange={(e) => setRef({ ...ref, reference: e.target.value })} data-testid="gift-activate-reference" />
          </div>
          <button type="button" disabled={!ref.reference} onClick={() => act(() => api.giftActivate(card.id, { method: ref.method, reference: ref.reference, idempotencyKey: newKey("gcact") }), "Card activated")} data-testid="gift-activate-btn" className="nb-btn-primary mt-3 h-10 text-sm">Activate {card.amount.display}</button>
        </div>
      )}
      {isOwner && ["active", "pending_payment"].includes(card.status) && (
        <div className="rounded-2xl bg-amber-50 p-4">
          <p className="text-sm font-semibold text-amber-900">Void or refund</p>
          <input className="nb-input mt-2 h-10" placeholder="Reason (required)" value={ref.reason} onChange={(e) => setRef({ ...ref, reason: e.target.value })} data-testid="gift-void-reason" />
          <div className="mt-2 flex gap-2">
            <button type="button" disabled={!ref.reason} onClick={() => act(() => api.giftVoid(card.id, { reason: ref.reason, idempotencyKey: newKey("gcvoid") }), "Card voided")} data-testid="gift-void-btn" className="nb-btn-ghost h-10 text-sm">Void</button>
            <button type="button" disabled={!ref.reason} onClick={() => act(() => api.giftVoid(card.id, { reason: ref.reason, refund: true, idempotencyKey: newKey("gcref") }), "Refund recorded")} data-testid="gift-refund-btn" className="nb-btn-ghost h-10 text-sm">Refund remaining</button>
          </div>
          <p className="mt-2 text-[11px] text-amber-800">Refunds are recorded here; return the money through the original method.</p>
        </div>
      )}
    </div>
  );
}

export default function GiftCardsAdmin() {
  const { user, idx } = useDemo();
  const role = user?.role;
  const isOwner = role === "owner";
  const [status, setStatus] = useState("");
  const [q, setQ] = useState("");
  const [rows, setRows] = useState(undefined);
  const [liability, setLiability] = useState(null);
  const [detail, setDetail] = useState(null);
  const [issuing, setIssuing] = useState(false);
  const enabled = idx?.settings?.giftCardsEnabled === true;
  const load = useCallback(() => {
    api.giftList({ status, q }).then(setRows).catch((e) => { setRows([]); toast.error(apiError(e)); });
    if (isOwner) api.giftLiability().then(setLiability).catch(() => {});
  }, [status, q, isOwner]);
  useEffect(() => { load(); }, [load]);
  const open = (id) => api.giftDetail(id).then(setDetail).catch((e) => toast.error(apiError(e)));
  return (
    <div className="mx-auto max-w-6xl px-5 py-8 nb-page" data-testid="owner-giftcards-page">
      <PageHeader eyebrow="Gifting" title="Gift cards" sub="Every balance change is a ledger transaction. Redemption is atomic and idempotent." right={isOwner && <button type="button" disabled={!enabled} onClick={() => setIssuing(true)} data-testid="gift-issue-open" className="nb-btn-primary h-11 text-sm"><Plus className="h-4 w-4" />Issue card</button>} />
      {!enabled && <Notice className="mb-5" testid="gift-disabled-notice">Gift-card transactions are turned off (GIFTCARDS_ENABLED). You can review records and prepare products; issuing, activation, redemption and voids stay blocked.</Notice>}
      {isOwner && <Liability data={liability} />}
      <div className="mt-8 flex flex-wrap items-center gap-3">
        <Segmented testid="gift-filter" value={status} onChange={setStatus} options={FILTERS} />
        <label className="relative ml-auto"><Search className="absolute left-3 top-3 h-4 w-4 text-nb-mute" /><input className="nb-input h-10 pl-9" placeholder="Name or last 4" value={q} onChange={(e) => setQ(e.target.value)} data-testid="gift-search" /></label>
      </div>
      <div className="mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-4" data-testid="gift-admin-list">
        {rows === undefined && [0, 1, 2, 3].map((n) => <div key={n} className="aspect-[1.7] rounded-2xl nb-skeleton" />)}
        {rows?.map((c, i) => (
          <Reveal key={c.id} i={i}>
            <GiftCardArt card={c} compact onClick={() => open(c.id)} testid={`gift-admin-card-${c.id}`} />
            <p className="mt-1.5 flex items-center justify-between px-1 text-xs text-nb-mute"><span className="truncate">{c.purchaserName || "Nabitouch"} → {c.recipientName}</span><Pill tone={c.status === "active" ? "teal" : c.status === "pending_payment" ? "amber" : "slate"}>{c.status.replace("_", " ")}</Pill></p>
          </Reveal>
        ))}
      </div>
      {rows?.length === 0 && <EmptyState icon={Gift} testid="gift-admin-empty" title="No gift cards" body="Issued and requested cards appear here." />}
      {isOwner && <div className="mt-12"><GiftProducts /></div>}
      <GiftCardDrawer card={detail} open={Boolean(detail)} onOpenChange={(o) => !o && setDetail(null)}>
        {detail && enabled && <StaffActions card={detail} isOwner={isOwner} onChange={() => { open(detail.id); load(); }} />}
      </GiftCardDrawer>
      <IssueGiftDialog open={issuing} onOpenChange={setIssuing} onDone={load} />
    </div>
  );
}
