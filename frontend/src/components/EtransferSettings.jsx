import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Landmark } from "lucide-react";
import { api, apiError } from "@/lib/api";

export function EtransferSettings() {
  const [f, setF] = useState(null);
  useEffect(() => { api.etransferSettings().then(setF).catch(() => setF({ recipientEmail: "", recipientName: "", instructions: "", referenceFormat: "Invoice {number}" })); }, []);
  if (!f) return <div className="h-40 rounded-3xl nb-skeleton md:col-span-2" />;
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const save = async () => { try { setF(await api.saveEtransfer(f)); toast.success("e-Transfer instructions saved"); } catch (e) { toast.error(apiError(e)); } };
  return (
    <div className="nb-card space-y-3 p-5 text-sm md:col-span-2" data-testid="settings-etransfer">
      <p className="flex items-center gap-2 font-semibold"><Landmark className="h-4 w-4 text-nb-blue" />Interac e-Transfer instructions</p>
      <p className="text-xs text-nb-mute">Shown to clients on open invoices. A client reporting a transfer never marks it paid; reception verifies it.</p>
      <div className="grid gap-2 sm:grid-cols-2">
        <input className="nb-input h-11" placeholder="Recipient email" value={f.recipientEmail} onChange={set("recipientEmail")} data-testid="etransfer-email" />
        <input className="nb-input h-11" placeholder="Recipient name" value={f.recipientName} onChange={set("recipientName")} data-testid="etransfer-name" />
        <textarea rows={2} className="nb-input py-2 sm:col-span-2" placeholder="Instructions, e.g. auto-deposit is on, no security question needed" value={f.instructions} onChange={set("instructions")} data-testid="etransfer-instructions" />
        <input className="nb-input h-11" placeholder="Message format" value={f.referenceFormat} onChange={set("referenceFormat")} data-testid="etransfer-reference" />
      </div>
      <button type="button" onClick={save} className="nb-btn-primary h-10 text-sm" data-testid="etransfer-save">Save instructions</button>
    </div>
  );
}
