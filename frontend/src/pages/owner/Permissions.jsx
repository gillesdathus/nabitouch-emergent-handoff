import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { toast } from "sonner";
import { Switch } from "@/components/ui/switch";
import { ShieldAlert, ShieldCheck, UserRound } from "lucide-react";
import { apiError } from "@/lib/api";
import { AuthenticatorSetup } from "@/components/AuthenticatorSetup";
import { SectionHead } from "@/components/ui-kit";
import { useDemo } from "@/store/DemoStore";
import { staffActor } from "@/lib/domain";
import { PRACTITIONER_ECLAIMS_FLAGS, RECEPTION_ECLAIMS_PERMS, RECEPTION_PERMS } from "@/lib/domain";

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
      <p className="text-sm text-nb-mute">Prefer invitations. Administrators never choose another person&apos;s password or authenticator secret. Assign the manager role here; managers inherit eClaims access and cannot manage eClaims permissions.</p>
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
              {(u.roles || [u.role]).includes("manager") && (
                <button
                  type="button"
                  className="nb-btn-ghost h-8 px-3 text-xs"
                  data-testid={`staff-manage-pricing-${u.email}`}
                  onClick={() => api.patchStaff(u.id, { roles: u.roles || [u.role], managePricing: !u.staffPerms?.managePricing }).then(() => { toast.success(u.staffPerms?.managePricing ? "Pricing permission revoked" : "Pricing permission granted"); load(); }).catch((err) => toast.error(apiError(err)))}
                >
                  {u.staffPerms?.managePricing ? "Revoke pricing" : "Allow pricing"}
                </button>
              )}
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

function ReceptionPermRow({ permKey, label, perms, onToggle }) {
  return (
    <label className="flex items-center gap-4 p-4">
      {permKey === "clinical" ? <ShieldAlert className="h-5 w-5 text-amber-600" /> : <ShieldCheck className="h-5 w-5 text-nb-teal" />}
      <span className="flex-1 text-sm">
        <b className="font-medium">{label}</b>
        {permKey === "clinical" && <span className="block text-xs text-nb-mute">Off by default. Even when on, reception sees completion status only — never SOAP content.</span>}
        {permKey === "viewLocations" && <span className="block text-xs text-nb-mute">Only on-duty practitioners during authorised work trips.</span>}
        {permKey?.startsWith("eclaims") && <span className="block text-xs text-nb-mute">Separate from payment management. Opening a portal never submits a claim from Nabitouch.</span>}
      </span>
      <Switch checked={!!perms[permKey]} onCheckedChange={(value) => onToggle(permKey, value)} data-testid={`perm-${permKey}-switch`} />
    </label>
  );
}

function PractitionerEclaimsCard({ row, busy, onChange }) {
  const flags = row.flags || {};
  return (
    <div className="space-y-3 p-4" data-testid={`eclaims-pract-${row.subject}`}>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <p className="text-sm font-medium text-nb-ink">{row.name || row.email}</p>
          <p className="text-xs text-nb-mute">{row.email}{row.status ? ` · ${row.status}` : ""}</p>
        </div>
        <p className="text-[11px] text-nb-mute">Defaults to own treatments only</p>
      </div>
      <div className="divide-y divide-sky-100 rounded-xl border border-sky-100">
        {PRACTITIONER_ECLAIMS_FLAGS.map(([key, title, detail]) => (
          <label key={key} className="flex items-center gap-4 p-3">
            <ShieldCheck className="h-4 w-4 shrink-0 text-nb-teal" />
            <span className="flex-1 text-sm">
              <b className="font-medium">{title}</b>
              <span className="block text-xs text-nb-mute">{detail}</span>
            </span>
            <Switch
              checked={!!flags[key]}
              disabled={busy}
              onCheckedChange={(value) => onChange(row, key, value)}
              data-testid={`eclaims-pract-${row.subject}-${key}`}
            />
          </label>
        ))}
      </div>
    </div>
  );
}

function PractitionerEclaimsSection({ api }) {
  const [rows, setRows] = useState([]);
  const [managerNote, setManagerNote] = useState("");
  const [loading, setLoading] = useState(true);
  const [busySubject, setBusySubject] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await api.eclaimsPermissions();
      setRows(data.practitioners || []);
      setManagerNote(data.manager?.note || "");
    } catch (error) {
      toast.error(apiError(error));
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [api]);

  useEffect(() => { load(); }, [load]);

  const saveFlags = async (row, nextFlags) => {
    setBusySubject(row.subject);
    try {
      const saved = await api.setEclaimsPractitionerPermissions(row.subject, nextFlags);
      setRows((current) => current.map((item) => (
        item.subject === row.subject
          ? { ...item, grants: saved.grants || [], flags: saved.flags || nextFlags }
          : item
      )));
      toast.success((saved.grants || []).length ? "Permission updated" : "Permission revoked");
    } catch (error) {
      toast.error(apiError(error));
      await load();
    } finally {
      setBusySubject("");
    }
  };

  const onChange = async (row, key, value) => {
    const current = { ...(row.flags || {}) };
    if (key === "view" && !value) {
      await saveFlags(row, { view: false, submit: false, viewSensitive: false, allTreatments: false });
      return;
    }
    const next = { ...current, [key]: value };
    if ((key === "submit" || key === "viewSensitive" || key === "allTreatments") && value) {
      next.view = true;
    }
    await saveFlags(row, next);
  };

  return (
    <div className="space-y-4" data-testid="eclaims-practitioner-permissions">
      <SectionHead eyebrow="eClaims" title="Practitioner access" />
      <p className="text-sm text-nb-mute">Grant or revoke access per practitioner. Changes apply on the next server request — no sign-out required. Turning off View clears Submit, sensitive access, and broader treatment access.</p>
      {managerNote && (
        <div className="nb-card p-4 text-sm text-nb-mute" data-testid="eclaims-manager-note">
          <p className="font-medium text-nb-ink">Manager</p>
          <p className="mt-1">{managerNote}</p>
        </div>
      )}
      <div className="nb-card divide-y divide-sky-100">
        {loading && <p className="p-4 text-sm text-nb-mute">Loading practitioner grants…</p>}
        {!loading && rows.map((row) => (
          <PractitionerEclaimsCard key={row.subject} row={row} busy={busySubject === row.subject} onChange={onChange} />
        ))}
        {!loading && rows.length === 0 && <p className="p-4 text-sm text-nb-mute">No practitioner accounts with a linked profile yet. Invite or link a practitioner under Staff accounts.</p>}
      </div>
    </div>
  );
}

export default function Permissions() {
  const { idx, run, api, user } = useDemo();
  const perms = idx.settings.receptionPerms || {};
  const toggle = (k, v) => run(() => api.patch("settings", "app", { receptionPerms: { ...perms, [k]: v }, _audit: `Reception permission "${k}" → ${v ? "granted" : "revoked"}`, _actor: staffActor(user) }), "Permission updated");
  return (
    <div className="mx-auto max-w-3xl space-y-8" data-testid="owner-permissions">
      <div className="space-y-3">
        <SectionHead eyebrow="Access" title="Staff permissions" />
        <p className="text-sm text-nb-mute">Server-enforced access for Manager, Reception, and Practitioners. Hiding a screen does not grant the action.</p>
      </div>

      <div className="space-y-3" data-testid="permissions-manager">
        <SectionHead eyebrow="Role" title="Manager" />
        <div className="nb-card p-4 text-sm text-nb-mute">
          <p>Managers inherit full eClaims workspace access with their role. They cannot grant or revoke eClaims permissions — only the owner can. Assign or remove the manager role under Staff accounts below.</p>
        </div>
      </div>

      <div className="space-y-3" data-testid="permissions-reception">
        <SectionHead eyebrow="Role" title="Receptionist" />
        <p className="text-sm text-nb-mute">Shared reception switches. eClaims flags are separate from payment management.</p>
        <div className="nb-card divide-y divide-sky-100">
          {RECEPTION_PERMS.map(([k, l]) => (
            <ReceptionPermRow key={k} permKey={k} label={l} perms={perms} onToggle={toggle} />
          ))}
        </div>
        <div className="nb-card divide-y divide-sky-100" data-testid="permissions-reception-eclaims">
          <div className="px-4 pt-4">
            <p className="text-sm font-medium text-nb-ink">eClaims</p>
            <p className="text-xs text-nb-mute">Opening a portal never submits a claim from Nabitouch.</p>
          </div>
          {RECEPTION_ECLAIMS_PERMS.map(([k, l]) => (
            <ReceptionPermRow key={k} permKey={k} label={l} perms={perms} onToggle={toggle} />
          ))}
        </div>
      </div>

      <PractitionerEclaimsSection api={api} />

      <AuthenticatorCard />
      <StaffAccounts />
    </div>
  );
}
