import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Plus } from "lucide-react";
import { Pill } from "@/components/ui-kit";
import { GiftCardArt, GIFT_DESIGNS } from "@/components/giftcards/GiftCardArt";
import { api, apiError } from "@/lib/api";
import { formatCents } from "@/lib/billing";
import { EmptyState, SaveFeedback } from "@/components/tide";

const blank = { name: "", description: "", design: "lagoon", amounts: "50, 100, 150", active: false, order: 0 };

function ProductForm({ initial, onSaved, onCancel }) {
  const [f, setF] = useState(initial ? { ...initial, amounts: initial.amountsCents.map((c) => c / 100).join(", ") } : blank);
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState({ state: "idle", message: "" });
  const save = async (e) => {
    e.preventDefault();
    if (busy) return;
    const amountsCents = f.amounts.split(",").map((s) => Math.round(Number(s.trim()) * 100)).filter((n) => n > 0);
    const body = { name: f.name, description: f.description, design: f.design, amountsCents, active: f.active, order: Number(f.order) || 0 };
    setBusy(true);
    setFeedback({ state: "saving", message: "Saving product…" });
    try {
      await (initial ? api.giftUpdateProduct(initial.id, body) : api.giftCreateProduct(body));
      toast.success("Product saved");
      setFeedback({ state: "success", message: "Product saved." });
      onSaved();
    } catch (err) {
      setFeedback({ state: "error", message: apiError(err) });
      toast.error(apiError(err));
    } finally {
      setBusy(false);
    }
  };
  return (
    <form onSubmit={save} className="nb-card grid gap-3 p-4 sm:grid-cols-2" data-testid="gift-product-form">
      <div className="sm:col-span-2"><SaveFeedback state={feedback.state} message={feedback.message} testid="gift-product-feedback" /></div>
      <input required className="nb-input h-11" placeholder="Name" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} data-testid="gift-product-name" />
      <input required className="nb-input h-11" placeholder="Amounts, e.g. 50, 100" value={f.amounts} onChange={(e) => setF({ ...f, amounts: e.target.value })} data-testid="gift-product-amounts" />
      <input className="nb-input h-11 sm:col-span-2" placeholder="Description" value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} data-testid="gift-product-description" />
      <select className="nb-input h-11 capitalize" value={f.design} onChange={(e) => setF({ ...f, design: e.target.value })} data-testid="gift-product-design">{GIFT_DESIGNS.map((d) => <option key={d}>{d}</option>)}</select>
      <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={f.active} onChange={(e) => setF({ ...f, active: e.target.checked })} data-testid="gift-product-active" />Visible to clients</label>
      <div className="flex gap-2 sm:col-span-2"><button disabled={busy} className="nb-btn-primary h-10 text-sm" data-testid="gift-product-save">{busy ? "Saving…" : "Save product"}</button><button type="button" disabled={busy} onClick={onCancel} className="nb-btn-ghost h-10 text-sm" data-testid="gift-product-cancel">Cancel</button></div>
    </form>
  );
}

export function GiftProducts() {
  const [rows, setRows] = useState([]);
  const [editing, setEditing] = useState(null);
  const load = () => api.giftProducts().then(setRows).catch(() => setRows([]));
  useEffect(() => { load(); }, []);
  return (
    <section data-testid="gift-products">
      <div className="mb-4 flex items-center justify-between"><h2 className="text-lg font-semibold">Products</h2><button type="button" onClick={() => setEditing("new")} data-testid="gift-product-new" className="nb-btn-ghost h-10 text-sm"><Plus className="h-4 w-4" />New product</button></div>
      {editing && <div className="mb-4"><ProductForm initial={editing === "new" ? null : editing} onSaved={() => { setEditing(null); load(); }} onCancel={() => setEditing(null)} /></div>}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {rows.map((p) => (
          <button key={p.id} type="button" onClick={() => setEditing(p)} className="text-left" data-testid={`gift-product-card-${p.id}`}>
            <GiftCardArt design={p.design} amount={p.amountsCents.map((c) => formatCents(c)).join(" · ")} compact />
            <p className="mt-2 flex items-center gap-2 text-sm font-semibold">{p.name}<Pill tone={p.active ? "teal" : "slate"}>{p.active ? "Visible" : "Hidden"}</Pill></p>
          </button>
        ))}
        {rows.length === 0 && !editing && (
          <EmptyState
            title="No products yet"
            body="Create one so clients can request cards."
            action={<button type="button" onClick={() => setEditing("new")} className="nb-btn-primary h-11 px-5" data-testid="gift-product-empty-new"><Plus className="mr-1 inline h-4 w-4" />New product</button>}
            testid="gift-products-empty"
          />
        )}
      </div>
    </section>
  );
}
