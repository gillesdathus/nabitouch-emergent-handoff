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
import { ACCESS_ROLES, POSITION_OPTIONS, formatPositions, formatRoles, toggleList } from "@/lib/staffRoles";

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

const BLANK_INVITE = {
  name: "",
  email: "",
  role: "desk",
  roles: ["desk"],
  practitionerId: "",
  preferredWorkspace: "desk",
  positions: ["receptionist"],
  customPositionTitle: "",
};

function StaffEditPanel({ user, practitioners, onClose, onSaved }) {
  const { api } = useDemo();
  const [roles, setRoles] = useState(() => user.roles || [user.role].filter(Boolean));
  const [positions, setPositions] = useState(() => user.positions || []);
  const [customTitle, setCustomTitle] = useState(user.customPositionTitle || "");
  const [practitionerId, setPractitionerId] = useState(user.subject || "");
  const [busy, setBusy] = useState(false);
  const save = async () => {
    setBusy(true);
    try {
      await api.patchStaff(user.id, {
        roles,
        positions,
        customPositionTitle: customTitle,
        practitionerId: roles.includes("practitioner") ? (practitionerId || null) : null,
      });
      toast.success("Staff access updated");
      onSaved();
      onClose();
    } catch (error) {
      toast.error(apiError(error));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="mt-3 space-y-3 rounded-2xl bg-sky-50/70 p-3" data-testid={`staff-edit-${user.email}`}>
      <p className="text-xs font-semibold text-nb-ink">Access roles (permissions)</p>
      <div className="grid gap-2 sm:grid-cols-2" data-testid={`staff-edit-roles-${user.email}`}>
        {ACCESS_ROLES.map(([id, label, detail]) => (
          <label key={id} className="flex items-start gap-2 rounded-xl bg-white p-2 text-xs ring-1 ring-sky-100">
            <input type="checkbox" className="mt-0.5" checked={roles.includes(id)} onChange={() => setRoles((current) => {
              const next = toggleList(current, id);
              return next.length ? next : current;
            })} data-testid={`staff-edit-role-${id}`} />
            <span><b>{label}</b><span className="mt-0.5 block text-nb-mute">{detail}</span></span>
          </label>
        ))}
      </div>
      <p className="text-xs font-semibold text-nb-ink">Positions (display titles only)</p>
      <div className="grid gap-2 sm:grid-cols-2" data-testid={`staff-edit-positions-${user.email}`}>
        {POSITION_OPTIONS.map(([id, label]) => (
          <label key={id} className="inline-flex items-center gap-2 rounded-xl bg-white px-2 py-1.5 text-xs ring-1 ring-sky-100">
            <input type="checkbox" checked={positions.includes(id)} onChange={() => setPositions((current) => toggleList(current, id))} data-testid={`staff-edit-position-${id}`} />
            {label}
          </label>
        ))}
      </div>
      {positions.includes("other") && (
        <input className="nb-input h-10 text-sm" placeholder="Custom position title" value={customTitle} onChange={(e) => setCustomTitle(e.target.value)} data-testid="staff-edit-custom-title" />
      )}
      {roles.includes("practitioner") && (
        <label className="block text-xs text-nb-mute">
          Linked practitioner profile
          <select className="nb-input mt-1 h-10 w-full text-sm" value={practitionerId} onChange={(e) => setPractitionerId(e.target.value)} data-testid="staff-edit-pract-select">
            <option value="">Select a legitimate practitioner profile</option>
            {practitioners.map((person) => <option key={person.id} value={person.id}>{person.name}</option>)}
          </select>
        </label>
      )}
      <p className="text-[11px] text-nb-mute">Positions never grant permissions. Owner/Manager alone never open clinical SOAP access. Privileged role changes may require authenticator confirmation.</p>
      <div className="flex flex-wrap gap-2">
        <button type="button" className="nb-btn-ghost h-9 px-3 text-xs" onClick={onClose}>Cancel</button>
        <button type="button" disabled={busy || !roles.length} className="nb-btn-primary h-9 px-3 text-xs" data-testid={`staff-edit-save-${user.email}`} onClick={save}>{busy ? "Saving…" : "Save access"}</button>
      </div>
    </div>
  );
}

function StaffAccounts() {
  const { api, state } = useDemo();
  const [list, setList] = useState([]);
  const [history, setHistory] = useState([]);
  const [f, setF] = useState(BLANK_INVITE);
  const [creating, setCreating] = useState(false);
  const [editingId, setEditingId] = useState("");
  const load = async () => {
    try {
      const [staffRows, historyPayload] = await Promise.all([
        api.staff(),
        api.staffRoleHistory().catch(() => ({ history: [] })),
      ]);
      setList(staffRows || []);
      setHistory(historyPayload?.history || []);
    } catch {
      setList([]);
    }
  };
  useEffect(() => { load(); }, []); // eslint-disable-line
  const invite = async () => {
    try {
      const result = await api.inviteStaff({
        ...f,
        roles: f.roles,
        role: f.roles[0],
        practitionerId: f.roles.includes("practitioner") ? (f.practitionerId || null) : null,
        positions: f.positions,
        customPositionTitle: f.customPositionTitle,
      });
      toast.success(result.message || "Invitation created");
      if (result.previewInviteToken) toast.message(`Invite link: ${window.location.origin}/join?token=${result.previewInviteToken}`);
      setF(BLANK_INVITE);
      setCreating(false);
      load();
    } catch (e) { toast.error(apiError(e)); }
  };
  const setStatus = async (user, status) => {
    try {
      await api.patchStaff(user.id, { roles: user.roles || [user.role], status, positions: user.positions || [], customPositionTitle: user.customPositionTitle || "" });
      toast.success(status === "suspended" ? "Account deactivated" : "Account activated");
      load();
    } catch (e) { toast.error(apiError(e)); }
  };
  const revokeSessions = async (user) => {
    try { const result = await api.revokeStaffSessions(user.id); toast.success(`Revoked ${result.revoked || 0} session(s)`); }
    catch (e) { toast.error(apiError(e)); }
  };
  const people = (state.practitioners || []).filter((person) => person.profileVisibility !== "hidden" && person.onboardingStatus !== "invited");
  return (
    <div className="space-y-4" data-testid="staff-accounts">
      <SectionHead eyebrow="Staff management" title="Roles & positions" />
      <p className="text-sm text-nb-mute">Assign access roles separately from display titles. A position never grants permissions. Prefer invitations — administrators never choose another person&apos;s password or authenticator secret.</p>
      <div className="overflow-x-auto rounded-2xl ring-1 ring-sky-100" data-testid="staff-management-table">
        <table className="min-w-full text-left text-sm">
          <thead className="bg-sky-50 text-xs uppercase tracking-wide text-nb-mute">
            <tr>
              <th className="px-3 py-2 font-semibold">Staff</th>
              <th className="px-3 py-2 font-semibold">Position(s)</th>
              <th className="px-3 py-2 font-semibold">Access roles</th>
              <th className="px-3 py-2 font-semibold">Status</th>
              <th className="px-3 py-2 font-semibold">Practitioner profile</th>
              <th className="px-3 py-2 font-semibold">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-sky-100 bg-white">
            {list.map((u) => {
              const linked = (state.practitioners || []).find((person) => person.id === u.subject);
              return (
                <tr key={u.id} data-testid={`staff-row-${u.email}`}>
                  <td className="px-3 py-3 align-top">
                    <div className="flex items-start gap-2">
                      <UserRound className="mt-0.5 h-4 w-4 text-nb-teal" />
                      <span><b>{u.name}</b><span className="mt-0.5 block text-xs text-nb-mute">{u.email}</span></span>
                    </div>
                    {editingId === u.id && (
                      <StaffEditPanel
                        user={u}
                        practitioners={people}
                        onClose={() => setEditingId("")}
                        onSaved={load}
                      />
                    )}
                  </td>
                  <td className="px-3 py-3 align-top text-xs" data-testid={`staff-positions-${u.email}`}>{formatPositions(u)}</td>
                  <td className="px-3 py-3 align-top text-xs" data-testid={`staff-roles-${u.email}`}>{formatRoles(u.roles || [u.role])}</td>
                  <td className="px-3 py-3 align-top text-xs capitalize">{u.status || "active"}{u.demo ? " · demo" : ""}</td>
                  <td className="px-3 py-3 align-top text-xs">{linked ? linked.name : (u.subject ? u.subject : "—")}</td>
                  <td className="px-3 py-3 align-top">
                    <div className="flex flex-wrap gap-2">
                      <button type="button" className="nb-btn-ghost h-8 px-3 text-xs" data-testid={`staff-edit-${u.email}`} onClick={() => setEditingId((current) => current === u.id ? "" : u.id)}>Edit access</button>
                      <button type="button" className="nb-btn-ghost h-8 px-3 text-xs" data-testid={`staff-suspend-${u.email}`} onClick={() => setStatus(u, u.status === "suspended" ? "active" : "suspended")}>{u.status === "suspended" ? "Activate" : "Deactivate"}</button>
                      <button type="button" className="nb-btn-ghost h-8 px-3 text-xs" data-testid={`staff-revoke-sessions-${u.email}`} onClick={() => revokeSessions(u)}>Revoke sessions</button>
                      {(u.roles || []).includes("manager") && (
                        <button
                          type="button"
                          className="nb-btn-ghost h-8 px-3 text-xs"
                          data-testid={`staff-manage-pricing-${u.email}`}
                          onClick={() => api.patchStaff(u.id, { roles: u.roles || [u.role], positions: u.positions || [], managePricing: !u.staffPerms?.managePricing }).then(() => { toast.success(u.staffPerms?.managePricing ? "Pricing permission revoked" : "Pricing permission granted"); load(); }).catch((err) => toast.error(apiError(err)))}
                        >
                          {u.staffPerms?.managePricing ? "Revoke pricing" : "Allow pricing"}
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              );
            })}
            {list.length === 0 && (
              <tr><td colSpan={6} className="px-3 py-4 text-sm text-nb-mute">No staff accounts loaded.</td></tr>
            )}
          </tbody>
        </table>
      </div>
      <button type="button" className="nb-btn-ghost h-10 px-4 text-sm" data-testid="staff-create-open" onClick={() => setCreating((value) => !value)}>{creating ? "Close" : "Invite staff"}</button>
      {creating && (
        <div className="nb-card grid gap-3 p-4 sm:grid-cols-2" data-testid="staff-invite-form">
          <input className="nb-input" placeholder="Full name" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} data-testid="staff-name-input" />
          <input className="nb-input" type="email" placeholder="Email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} data-testid="staff-email-input" />
          <div className="sm:col-span-2 space-y-2">
            <p className="text-xs font-semibold">Access roles</p>
            <div className="flex flex-wrap gap-3 text-sm" data-testid="staff-role-flags">
              {ACCESS_ROLES.map(([id, label, detail]) => (
                <label key={id} className="inline-flex max-w-xs items-start gap-2">
                  <input type="checkbox" className="mt-1" checked={(f.roles || []).includes(id)} onChange={() => setF((current) => {
                    const roles = toggleList(current.roles || [], id);
                    const next = roles.length ? roles : current.roles;
                    return {
                      ...current,
                      roles: next,
                      role: next[0],
                      preferredWorkspace: next.includes("practitioner") ? "practitioner" : (next.includes("desk") ? "desk" : "owner"),
                    };
                  })} data-testid={`staff-role-${id}`} />
                  <span><b>{label}</b><span className="block text-xs text-nb-mute">{detail}</span></span>
                </label>
              ))}
            </div>
          </div>
          <div className="sm:col-span-2 space-y-2">
            <p className="text-xs font-semibold">Positions (titles only)</p>
            <div className="flex flex-wrap gap-3 text-sm" data-testid="staff-position-flags">
              {POSITION_OPTIONS.map(([id, label]) => (
                <label key={id} className="inline-flex items-center gap-2">
                  <input type="checkbox" checked={(f.positions || []).includes(id)} onChange={() => setF((current) => ({ ...current, positions: toggleList(current.positions || [], id) }))} data-testid={`staff-position-${id}`} />
                  {label}
                </label>
              ))}
            </div>
            {(f.positions || []).includes("other") && (
              <input className="nb-input" placeholder="Custom title" value={f.customPositionTitle} onChange={(e) => setF({ ...f, customPositionTitle: e.target.value })} data-testid="staff-custom-title" />
            )}
          </div>
          {(f.roles || []).includes("practitioner") && (
            <select className="nb-input sm:col-span-2" value={f.practitionerId} onChange={(e) => setF({ ...f, practitionerId: e.target.value })} data-testid="staff-pract-select">
              <option value="">New practitioner profile</option>
              {people.map((p) => <option key={p.id} value={p.id}>{`Link to ${p.name}`}</option>)}
            </select>
          )}
          <button disabled={!f.name || !f.email || !(f.roles || []).length} onClick={invite} data-testid="staff-create-btn" className="nb-btn-primary sm:col-span-2">Send invitation</button>
        </div>
      )}
      <div className="nb-card space-y-2 p-4" data-testid="staff-role-history">
        <h3 className="text-sm font-semibold">Role-change history</h3>
        <ul className="space-y-2 text-xs text-nb-mute">
          {history.slice(0, 12).map((row) => (
            <li key={row.id} data-testid={`staff-history-${row.id}`}>
              <span className="text-nb-ink">{row.at?.slice?.(0, 19)?.replace("T", " ") || row.at}</span>
              {" · "}{row.actorName} → {row.targetName || row.targetEmail}
              {" · "}{(row.afterRoles || []).join(", ") || "—"}
              {row.note ? ` · ${row.note}` : ""}
            </li>
          ))}
          {!history.length && <li>No role changes recorded yet.</li>}
        </ul>
      </div>
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
