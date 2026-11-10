import { useState } from "react";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { AddressPicker } from "@/components/AddressPicker";
import { api, apiError } from "@/lib/api";
import { useDemo } from "@/store/DemoStore";

const empty = {
  firstName: "",
  lastName: "",
  preferredName: "",
  dob: "",
  phone: "",
  altPhone: "",
  email: "",
  language: "English",
  contactMethod: "Text",
  emergencyContact: "",
};

function buildAddressPayload(addr, { addrLabel, unit, access }) {
  if (addr?.clientConfirmed !== true || !String(addr?.line || "").trim()) {
    return null;
  }
  return {
    ...addr,
    id: `ad-${Date.now()}`,
    label: addrLabel,
    purpose: addrLabel === "Mailing" ? "mailing" : "home",
    unit: unit || addr.unit || "",
    access: access || addr.access || "",
    isDefault: true,
    verificationState: addr.verificationState || "verified",
  };
}

export function CreateClientDialog({ open, onClose, onCreated }) {
  const { refresh } = useDemo();
  const [form, setForm] = useState(empty);
  const [addrQuery, setAddrQuery] = useState("");
  const [addr, setAddr] = useState(null);
  const [addrLabel, setAddrLabel] = useState("Home");
  const [unit, setUnit] = useState("");
  const [access, setAccess] = useState("");
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState("");

  const set = (key) => (e) => setForm((prev) => ({ ...prev, [key]: e.target.value }));

  const save = async () => {
    setErr("");
    const startedAddress = Boolean(addrQuery.trim()) || Boolean(addr?.line);
    const addressRow = buildAddressPayload(addr, { addrLabel, unit, access });
    if (startedAddress && !addressRow) {
      setErr("Confirm the service address before saving, or clear the address search.");
      return;
    }
    setSaving(true);
    try {
      const addresses = addressRow ? [addressRow] : [];
      const created = await api.createClient({ ...form, addresses });
      if (addresses.length) {
        const persisted = (created?.addresses || []).find((row) => String(row.line || "").trim());
        if (!persisted) {
          throw new Error("Client was created but the address did not persist. Open the profile and add it again.");
        }
        // Confirm the detail API returns the same saved address before success UI.
        const workspace = await api.clientWorkspace(created.id);
        const reloaded = (workspace?.client?.addresses || []).find((row) => row.id === persisted.id)
          || (workspace?.client?.addresses || []).find((row) => String(row.line || "").trim());
        if (!reloaded?.line) {
          throw new Error("Address save could not be confirmed. Open the client profile and verify before booking.");
        }
      }
      await refresh?.();
      toast.success(addresses.length ? "Client created with saved address" : "Client created");
      onCreated?.(created);
      setForm(empty);
      setAddr(null);
      setAddrQuery("");
      setUnit("");
      setAccess("");
      onClose?.();
    } catch (error) {
      setErr(apiError(error));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose?.()}>
      <DialogContent className="max-h-[92vh] overflow-y-auto rounded-3xl sm:max-w-lg" data-testid="create-client-dialog">
        <DialogTitle>Create client</DialogTitle>
        <p className="text-sm text-nb-mute">No email, online account, or booking required.</p>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <label><span className="nb-label">Legal first name</span><input className="nb-input" value={form.firstName} onChange={set("firstName")} data-testid="cc-first" /></label>
          <label><span className="nb-label">Legal last name</span><input className="nb-input" value={form.lastName} onChange={set("lastName")} data-testid="cc-last" /></label>
          <label><span className="nb-label">Preferred name</span><input className="nb-input" value={form.preferredName} onChange={set("preferredName")} data-testid="cc-preferred" /></label>
          <label><span className="nb-label">Date of birth</span><input type="date" className="nb-input" value={form.dob} onChange={set("dob")} data-testid="cc-dob" /></label>
          <label><span className="nb-label">Phone</span><input className="nb-input" value={form.phone} onChange={set("phone")} data-testid="cc-phone" /></label>
          <label><span className="nb-label">Alternative phone</span><input className="nb-input" value={form.altPhone} onChange={set("altPhone")} data-testid="cc-alt-phone" /></label>
          <label className="sm:col-span-2"><span className="nb-label">Email (optional)</span><input type="email" className="nb-input" value={form.email} onChange={set("email")} data-testid="cc-email" /></label>
          <label><span className="nb-label">Language</span><select className="nb-input" value={form.language} onChange={set("language")} data-testid="cc-language">{["English", "Français", "Other"].map((x) => <option key={x}>{x}</option>)}</select></label>
          <label><span className="nb-label">Contact method</span><select className="nb-input" value={form.contactMethod} onChange={set("contactMethod")} data-testid="cc-contact">{["Text", "Email", "Phone"].map((x) => <option key={x}>{x}</option>)}</select></label>
          <label className="sm:col-span-2"><span className="nb-label">Emergency contact</span><input className="nb-input" value={form.emergencyContact} onChange={set("emergencyContact")} data-testid="cc-emergency" placeholder="Name · phone" /></label>
        </div>
        <div className="mt-4 space-y-2 rounded-2xl bg-sky-50/70 p-3" data-testid="cc-address">
          <p className="text-sm font-semibold">Address (optional)</p>
          <div className="flex flex-wrap gap-2">
            {["Home", "Mailing", "Office", "Other"].map((label) => (
              <button key={label} type="button" className={addrLabel === label ? "nb-chip-on" : "nb-chip-off"} onClick={() => setAddrLabel(label)} data-testid={`cc-label-${label.toLowerCase()}`}>{label}</button>
            ))}
          </div>
          <AddressPicker query={addrQuery} onQuery={setAddrQuery} value={addr} onChange={setAddr} testid="cc-address-picker" />
          <div className="grid gap-2 sm:grid-cols-2">
            <label><span className="nb-label">Unit / apt</span><input className="nb-input" value={unit} onChange={(e) => setUnit(e.target.value)} data-testid="cc-unit" /></label>
            <label><span className="nb-label">Access instructions</span><input className="nb-input" value={access} onChange={(e) => setAccess(e.target.value)} data-testid="cc-access" /></label>
          </div>
        </div>
        {err && <p className="mt-3 text-sm text-rose-700" data-testid="cc-error">{err}</p>}
        <button
          type="button"
          disabled={saving || !form.firstName.trim() || !form.lastName.trim()}
          onClick={save}
          className="nb-btn-primary mt-4 w-full"
          data-testid="cc-save"
        >
          {saving ? "Creating…" : "Create client"}
        </button>
      </DialogContent>
    </Dialog>
  );
}
