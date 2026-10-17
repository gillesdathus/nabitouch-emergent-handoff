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
  const [f, setF] = useState({ name: "", email: "", role: "practitioner", roles: ["practitioner"], practitionerId: "", preferredWorkspace: "practitioner" });
  const [creating, setCreating] = useState(false);
  const load = () => api.staff().then(setList).catch(() => {});
  useEffect(() => { load(); }, []); // eslint-disable-line
  const invite = async () => {
    try {
      const result = await api.inviteStaff({ ...f, roles: f.roles, role: f.role, practitionerId: f.practitionerId || null });
      toast.success(result.message || "Invitation created");
      if (result.previewInviteToken) toast.message(`Invite link: ${window.location.origin}/join?token=${result.previewInviteToken}`);
      setF({ name: "", email: "", role: "practitioner", roles: ["practitioner"], practitionerId: "", preferredWorkspace: "practitioner" });
      setCreating(false);
      load();
    } catch (e) { toast.error(apiError(e)); }
  };
  const setRoles = async (user, roles) => {
    try { await api.patchStaff(user.id, { roles }); toast.success("Roles updated"); load(); }
    catch (e) { toast.error(apiError(e)); }
  };
  const setStatus = async (user, status) => {
    try { await api.patchStaff(user.id, { roles: user.roles || [user.role], status }); toast.success(status === "suspended" ? "Account suspended" : "Account activated"); load(); }
    catch (e) { toast.error(apiError(e)); }
  };
  const revokeSessions = async (user) => {
    try { const result = await api.revokeStaffSessions(user.id); toast.success(`Revoked ${result.revoked || 0} session(s)`); }
    catch (e) { toast.error(apiError(e)); }
  };
  const toggleRole = (role) => {
    setF((current) => {
      const have = new Set(current.roles || [current.role]);
      if (have.has(role)) have.delete(role); else have.add(role);
      if (!have.size) have.add("practitioner");
      const roles = ["owner", "manager", "practitioner", "desk"].filter((item) => have.has(item));
      return { ...current, roles, role: roles[0], preferredWorkspace: roles.includes("practitioner") ? "practitioner" : (roles.includes("desk") ? "desk" : "owner") };
    });
  };
  return (
    <div className="space-y-4" data-testid="staff-accounts">
      <SectionHead eyebrow="Accounts" title="Staff accounts" />
      <p className="text-sm text-nb-mute">Prefer invitations. Administrators never choose another person&apos;s password or authenticator secret.</p>
      <div className="nb-card divide-y divide-sky-100">
        {list.map((u) => (
          <div key={u.id} className="space-y-2 p-3 text-sm" data-testid={`staff-row-${u.email}`}>
            <div className="flex flex-wrap items-center gap-3">
              <UserRound className="h-4 w-4 text-nb-teal" />
              <span className="flex-1"><b>{u.name}</b> · {u.email}</span>
              <span className="text-xs capitalize text-nb-mute">{(u.roles || [u.role]).map((role) => (role === "desk" ? "reception" : role)).join(", ")}{u.status ? ` · ${u.status}` : ""}{u.demo ? " · demo" : ""}</span>
            </div>
            <div className="flex flex-wrap gap-2">
              <button type="button" className="nb-btn-ghost h-8 px-3 text-xs" data-testid={`staff-suspend-${u.email}`} onClick={() => setStatus(u, u.status === "suspended" ? "active" : "suspended")}>{u.status === "suspended" ? "Activate" : "Suspend"}</button>
              <button type="button" className="nb-btn-ghost h-8 px-3 text-xs" data-testid={`staff-revoke-sessions-${u.email}`} onClick={() => revokeSessions(u)}>Revoke sessions</button>
              <button type="button" className="nb-btn-ghost h-8 px-3 text-xs" data-testid={`staff-add-desk-${u.email}`} onClick={() => setRoles(u, Array.from(new Set([...(u.roles || [u.role]), "desk"])))}>Add reception</button>
              <button type="button" className="nb-btn-ghost h-8 px-3 text-xs" data-testid={`staff-add-manager-${u.email}`} onClick={() => setRoles(u, Array.from(new Set([...(u.roles || [u.role]), "manager"])))}>Add manager</button>
            </div>
          </div>
        ))}
        {list.length === 0 && <p className="p-4 text-sm text-nb-mute">No staff accounts loaded.</p>}
      </div>
      <button type="button" className="nb-btn-ghost h-10 px-4 text-sm" data-testid="staff-create-open" onClick={() => setCreating((value) => !value)}>{creating ? "Close" : "Invite staff"}</button>
      {creating && <div className="nb-card grid gap-3 p-4 sm:grid-cols-2">
        <input className="nb-input" placeholder="Full name" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} data-testid="staff-name-input" />
        <input className="nb-input" type="email" placeholder="Email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} data-testid="staff-email-input" />
        <div className="sm:col-span-2 flex flex-wrap gap-3 text-sm" data-testid="staff-role-flags">
          {[["owner", "Owner"], ["manager", "Manager"], ["desk", "Reception"], ["practitioner", "Practitioner"]].map(([id, label]) => (
            <label key={id} className="inline-flex items-center gap-2"><input type="checkbox" checked={(f.roles || []).includes(id)} onChange={() => toggleRole(id)} data-testid={`staff-role-${id}`} />{label}</label>
          ))}
        </div>
        {(f.roles || []).includes("practitioner") && <select className="nb-input sm:col-span-2" value={f.practitionerId} onChange={(e) => setF({ ...f, practitionerId: e.target.value })} data-testid="staff-pract-select"><option value="">New practitioner profile</option>{state.practitioners.map((p) => <option key={p.id} value={p.id}>{`Link to ${p.name}`}</option>)}</select>}
        <button disabled={!f.name || !f.email} onClick={invite} data-testid="staff-create-btn" className="nb-btn-primary sm:col-span-2">Send invitation</button>
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
