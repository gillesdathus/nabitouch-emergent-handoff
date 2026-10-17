import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { toast } from "sonner";
import { Switch } from "@/components/ui/switch";
import { ShieldAlert, ShieldCheck, UserRound } from "lucide-react";
import { apiError } from "@/lib/api";
import { AuthenticatorSetup } from "@/components/AuthenticatorSetup";
import { SectionHead } from "@/components/ui-kit";
import { useDemo } from "@/store/DemoStore";
import { staffActor } from "@/lib/domain";
import { RECEPTION_PERMS } from "@/lib/domain";

function AuthenticatorCard() {
  const { api, idx, run } = useDemo();
  const [setup, setSetup] = useState(null);
  const [code, setCode] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const start = async () => { setErr(""); try { setSetup(await api.mfaEnroll()); } catch (e) { toast.error(apiError(e)); } };
  const confirm = async (event) => {
    event.preventDefault(); setBusy(true); setErr("");
    try { await api.mfaConfirm(code); toast.success("Authenticator is on. Sign out and sign in with a code before requiring it for staff."); setSetup(null); setCode(""); }
    catch (e) { setErr(apiError(e)); } finally { setBusy(false); }
  };
  return (
    <div className="nb-card space-y-3 p-4" data-testid="staff-authenticator">
      <SectionHead eyebrow="Sign-in" title="Staff authenticator" />
      <p className="text-sm text-nb-mute">Enroll the owner, each practitioner, and reception, and save the recovery codes, before requiring an authenticator. The switch accepts the change only after this session has completed an authenticator check.</p>
      {!setup && <button type="button" onClick={start} className="nb-btn-primary" data-testid="mfa-enroll-btn">Set up authenticator</button>}
      {setup && (
        <AuthenticatorSetup
          otpauth={setup.otpauth}
          secret={setup.secret}
          recoveryCodes={setup.recoveryCodes || []}
          code={code}
          onCode={setCode}
          onVerify={confirm}
          onCancel={() => { setSetup(null); setCode(""); setErr(""); }}
          busy={busy}
          error={err}
        />
      )}
      <p className="text-sm text-nb-mute">To replace an enrolled authenticator or regenerate recovery codes, use <Link to="/account/security" className="font-semibold text-nb-blue" data-testid="permissions-security-link">Account &amp; security</Link>.</p>
      <label className="flex items-center gap-3 text-sm">
        <span className="flex-1">Require authenticator for staff</span>
        <Switch checked={!!idx.settings.mfaEnforcePrivileged} onCheckedChange={(value) => run(() => api.patch("settings", "app", { mfaEnforcePrivileged: value }))} data-testid="mfa-enforce-switch" />
      </label>
    </div>
  );
}

function StaffAccounts() {
  const { api, state } = useDemo();
  const [list, setList] = useState([]);
  const [f, setF] = useState({ name: "", email: "", password: "", role: "practitioner", practitionerId: "" });
  const [creating, setCreating] = useState(false);
  const load = () => api.staff().then(setList).catch(() => {});
  useEffect(() => { load(); }, []); // eslint-disable-line
  const create = async () => { try { await api.createStaff({ ...f, practitionerId: f.practitionerId || null }); toast.success("Staff account created"); setF({ ...f, name: "", email: "", password: "" }); setCreating(false); load(); } catch (e) { toast.error(apiError(e)); } };
  return (
    <div className="space-y-4" data-testid="staff-accounts">
      <SectionHead eyebrow="Accounts" title="Staff accounts" />
      <div className="nb-card divide-y divide-sky-100">{list.map((u) => <div key={u.id} className="flex items-center gap-3 p-3 text-sm" data-testid={`staff-row-${u.email}`}><UserRound className="h-4 w-4 text-nb-teal" /><span className="flex-1"><b>{u.name}</b> · {u.email}</span><span className="text-xs capitalize text-nb-mute">{u.role === "desk" ? "reception" : u.role}{u.demo ? " · demo" : ""}</span></div>)}{list.length === 0 && <p className="p-4 text-sm text-nb-mute">No staff accounts loaded.</p>}</div>
      <button type="button" className="nb-btn-ghost h-10 px-4 text-sm" data-testid="staff-create-open" onClick={() => setCreating((value) => !value)}>{creating ? "Close" : "Add staff account"}</button>
      {creating && <div className="nb-card grid gap-3 p-4 sm:grid-cols-2">
        <input className="nb-input" placeholder="Full name" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} data-testid="staff-name-input" />
        <input className="nb-input" type="email" placeholder="Email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} data-testid="staff-email-input" />
        <input className="nb-input" type="password" placeholder="Temporary password (8+)" value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} data-testid="staff-password-input" />
        <select className="nb-input" value={f.role} onChange={(e) => setF({ ...f, role: e.target.value })} data-testid="staff-role-select"><option value="practitioner">Practitioner</option><option value="desk">Reception</option></select>
        {f.role === "practitioner" && <select className="nb-input sm:col-span-2" value={f.practitionerId} onChange={(e) => setF({ ...f, practitionerId: e.target.value })} data-testid="staff-pract-select"><option value="">New practitioner profile</option>{state.practitioners.map((p) => <option key={p.id} value={p.id}>{`Link to ${p.name}`}</option>)}</select>}
        <button disabled={!f.name || !f.email || f.password.length < 8} onClick={create} data-testid="staff-create-btn" className="nb-btn-primary sm:col-span-2">Create staff account</button>
      </div>}
    </div>
  );
}

export default function Permissions() {
  const { idx, run, api, user } = useDemo();
  const perms = idx.settings.receptionPerms;
  const toggle = (k, v) => run(() => api.patch("settings", "app", { receptionPerms: { ...perms, [k]: v }, _audit: `Reception permission "${k}" → ${v ? "granted" : "revoked"}`, _actor: staffActor(user) }), "Permission updated");
  return (
    <div className="mx-auto max-w-3xl space-y-6" data-testid="owner-permissions">
      <SectionHead eyebrow="Access" title="Receptionist permissions" />
      <p className="text-sm text-nb-mute">These switches are enforced by the server. Hiding a screen does not grant the action.</p>
      <div className="nb-card divide-y divide-sky-100">
        {RECEPTION_PERMS.map(([k, l]) => (
          <label key={k} className="flex items-center gap-4 p-4">
            {k === "clinical" ? <ShieldAlert className="h-5 w-5 text-amber-600" /> : <ShieldCheck className="h-5 w-5 text-nb-teal" />}
            <span className="flex-1 text-sm"><b className="font-medium">{l}</b>{k === "clinical" && <span className="block text-xs text-nb-mute">Off by default. Even when on, reception sees completion status only — never SOAP content.</span>}{k === "viewLocations" && <span className="block text-xs text-nb-mute">Only on-duty practitioners during authorised work trips.</span>}</span>
            <Switch checked={!!perms[k]} onCheckedChange={(v) => toggle(k, v)} data-testid={`perm-${k}-switch`} />
          </label>))}
      </div>
      <p className="text-xs text-nb-mute">Tracking, payment and clinical endpoints enforce these permissions on the server for signed-in staff.</p>
      <AuthenticatorCard />
      <StaffAccounts />
    </div>
  );
}
