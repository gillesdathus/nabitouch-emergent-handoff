import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { ArrowLeft, KeyRound, ShieldCheck, Smartphone, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { AuthenticatorSetup } from "@/components/AuthenticatorSetup";
import { SectionHead } from "@/components/ui-kit";
import { api, apiError } from "@/lib/api";
import { useDemo } from "@/store/DemoStore";
import { AppBuildLabel } from "@/components/PwaUpdateBanner";

function RecoveryCodesOnce({ codes, onDone }) {
  return (
    <div className="nb-card space-y-3 p-5" data-testid="security-recovery-codes-once">
      <p className="text-sm font-semibold">Save these recovery codes now</p>
      <p className="text-xs text-nb-mute">They are shown once. Store them offline. Nabitouch will not show them again.</p>
      <ul className="font-mono text-xs" data-testid="security-recovery-code-list">
        {codes.map((code) => <li key={code}>{code}</li>)}
      </ul>
      <button type="button" className="nb-btn-primary h-10 w-full" data-testid="security-recovery-codes-done" onClick={onDone}>I saved these codes</button>
    </div>
  );
}

export default function AccountSecurity() {
  const { user } = useDemo();
  const [status, setStatus] = useState(null);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const [pw, setPw] = useState({ current: "", next: "" });
  const [verifyCode, setVerifyCode] = useState("");
  const [replaceSetup, setReplaceSetup] = useState(null);
  const [replaceCode, setReplaceCode] = useState("");
  const [freshCodes, setFreshCodes] = useState(null);
  const [regenCode, setRegenCode] = useState("");

  const load = useCallback(() => {
    setErr("");
    return api.securityStatus()
      .then(setStatus)
      .catch((error) => setErr(apiError(error) || "Could not load account security."));
  }, []);

  useEffect(() => { load(); }, [load]);

  if (!user) {
    return (
      <div className="mx-auto max-w-lg px-5 py-16 text-center" data-testid="security-signed-out">
        <h1 className="text-2xl font-semibold">Account &amp; security</h1>
        <p className="mt-2 text-sm text-nb-mute">Sign in to manage your password and authenticator.</p>
        <Link to="/login?next=/account/security" className="nb-btn-primary mt-6 inline-flex" data-testid="security-signin">Sign in</Link>
      </div>
    );
  }

  const staff = ["owner", "practitioner", "desk"].includes(user.role);
  const back = user.role === "owner" ? "/owner/manage" : user.role === "practitioner" ? "/pro" : user.role === "desk" ? "/desk" : "/me";

  const changePassword = async (event) => {
    event.preventDefault();
    setBusy(true); setErr("");
    try {
      await api.changePassword(pw.current, pw.next);
      toast.success("Password updated. Other devices were signed out.");
      setPw({ current: "", next: "" });
      load();
    } catch (error) {
      setErr(apiError(error));
    } finally {
      setBusy(false);
    }
  };

  const startReplace = async (event) => {
    event.preventDefault();
    setBusy(true); setErr("");
    try {
      const setup = await api.mfaReplaceStart(verifyCode);
      setReplaceSetup(setup);
      setFreshCodes(setup.recoveryCodes || []);
      setVerifyCode("");
      load();
    } catch (error) {
      setErr(apiError(error));
    } finally {
      setBusy(false);
    }
  };

  const confirmReplace = async (event) => {
    event.preventDefault();
    setBusy(true); setErr("");
    try {
      await api.mfaReplaceConfirm(replaceCode);
      toast.success("Authenticator replaced. Your previous authenticator no longer works.");
      setReplaceSetup(null);
      setReplaceCode("");
      load();
    } catch (error) {
      setErr(apiError(error));
    } finally {
      setBusy(false);
    }
  };

  const cancelReplace = async () => {
    setBusy(true); setErr("");
    try {
      await api.mfaReplaceCancel();
      setReplaceSetup(null);
      setFreshCodes(null);
      setReplaceCode("");
      toast.message("Replacement cancelled. Your previous authenticator is still active.");
      load();
    } catch (error) {
      setErr(apiError(error));
    } finally {
      setBusy(false);
    }
  };

  const regenerate = async (event) => {
    event.preventDefault();
    setBusy(true); setErr("");
    try {
      const body = await api.mfaRecoveryRegenerate(regenCode);
      setFreshCodes(body.recoveryCodes || []);
      setRegenCode("");
      load();
    } catch (error) {
      setErr(apiError(error));
    } finally {
      setBusy(false);
    }
  };

  const revokeOthers = async () => {
    setBusy(true); setErr("");
    try {
      const body = await api.revokeOtherSessions();
      toast.success(`Signed out ${body.revoked || 0} other session${body.revoked === 1 ? "" : "s"}.`);
      load();
    } catch (error) {
      setErr(apiError(error));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mx-auto max-w-xl space-y-6 px-5 py-8" data-testid="account-security-page">
      <Link to={back} className="inline-flex items-center gap-1 text-sm text-nb-mute" data-testid="security-back"><ArrowLeft className="h-4 w-4" />Back</Link>
      <SectionHead eyebrow="Account" title="Account & security" />
      <p className="text-sm text-nb-mute">Manage your password, authenticator, and signed-in devices. Recovery codes are shown only once.</p>
      {err && <p className="rounded-2xl bg-rose-50 px-4 py-3 text-sm text-rose-900" data-testid="security-error">{err}</p>}

      <section className="nb-card space-y-2 p-5" data-testid="security-account-card">
        <p className="nb-eyebrow flex items-center gap-1.5"><KeyRound className="h-3.5 w-3.5" />Signed in as</p>
        <p className="text-sm font-semibold" data-testid="security-email">{status?.email || user.email}</p>
        <p className="text-xs capitalize text-nb-mute" data-testid="security-role">{status?.role || user.role}</p>
      </section>

      <section className="nb-card space-y-3 p-5" data-testid="security-password-card">
        <p className="nb-eyebrow">Password</p>
        <p className="text-sm text-nb-mute">Change your password while signed in, or use email recovery if you cannot sign in.</p>
        <form onSubmit={changePassword} className="space-y-3">
          <label className="block"><span className="nb-label">Current password</span><input type="password" required autoComplete="current-password" className="nb-input" value={pw.current} onChange={(e) => setPw({ ...pw, current: e.target.value })} data-testid="security-current-password" /></label>
          <label className="block"><span className="nb-label">New password</span><input type="password" required minLength={8} autoComplete="new-password" className="nb-input" value={pw.next} onChange={(e) => setPw({ ...pw, next: e.target.value })} data-testid="security-new-password" /></label>
          <button disabled={busy} className="nb-btn-primary h-10 w-full" data-testid="security-change-password">Update password</button>
        </form>
        <Link to="/forgot-password" className="text-sm font-semibold text-nb-blue" data-testid="security-forgot-link">Email me a reset link instead</Link>
      </section>

      {staff && (
        <section className="nb-card space-y-3 p-5" data-testid="security-mfa-card">
          <p className="nb-eyebrow flex items-center gap-1.5"><Smartphone className="h-3.5 w-3.5" />Authenticator</p>
          <p className="text-sm" data-testid="security-mfa-status">
            {status?.mfaEnabled ? <span className="inline-flex items-center gap-1 font-semibold text-emerald-800"><ShieldCheck className="h-4 w-4" />On</span> : "Off"}
            {status?.mfaEnforced ? <span className="ml-2 text-xs text-nb-mute">Required for staff</span> : null}
          </p>
          <p className="text-xs text-nb-mute" data-testid="security-recovery-remaining">
            {status?.mfaEnabled ? `${status.recoveryCodesRemaining} recovery code${status.recoveryCodesRemaining === 1 ? "" : "s"} remaining` : "No authenticator enrolled"}
          </p>
          {status?.replacePending && !replaceSetup && (
            <p className="rounded-2xl bg-amber-50 px-3 py-2 text-xs text-amber-900" data-testid="security-replace-pending">A replacement was started. Confirm the new authenticator below, or cancel to keep the current one.</p>
          )}

          {freshCodes && !replaceSetup && (
            <RecoveryCodesOnce codes={freshCodes} onDone={() => setFreshCodes(null)} />
          )}

          {status?.mfaEnabled && !replaceSetup && (
            <form onSubmit={startReplace} className="space-y-3 border-t border-sky-100 pt-3">
              <p className="text-sm font-semibold">Replace authenticator</p>
              <p className="text-xs text-nb-mute">Your current authenticator stays active until the new one is confirmed. Enter a current code or a recovery code to begin.</p>
              <label className="block"><span className="nb-label">Current code</span><input inputMode="numeric" autoComplete="one-time-code" required className="nb-input" value={verifyCode} onChange={(e) => setVerifyCode(e.target.value)} data-testid="security-replace-verify-code" /></label>
              <button disabled={busy || !status?.sessionMfaVerified} className="nb-btn-primary h-10 w-full" data-testid="security-replace-start">Start replacement</button>
              {!status?.sessionMfaVerified && <p className="text-xs text-amber-800">Sign out and sign in with your authenticator before replacing it.</p>}
            </form>
          )}

          {replaceSetup && (
            <div className="space-y-3 border-t border-sky-100 pt-3" data-testid="security-replace-setup">
              {freshCodes && <RecoveryCodesOnce codes={freshCodes} onDone={() => setFreshCodes(null)} />}
              <AuthenticatorSetup
                otpauth={replaceSetup.otpauth}
                secret={replaceSetup.secret}
                recoveryCodes={[]}
                code={replaceCode}
                onCode={setReplaceCode}
                onVerify={confirmReplace}
                onCancel={cancelReplace}
                busy={busy}
                error={err}
              />
            </div>
          )}

          {status?.mfaEnabled && !replaceSetup && (
            <form onSubmit={regenerate} className="space-y-3 border-t border-sky-100 pt-3">
              <p className="text-sm font-semibold flex items-center gap-1.5"><RefreshCw className="h-4 w-4" />Regenerate recovery codes</p>
              <p className="text-xs text-nb-mute">Invalidates previous recovery codes. Requires a current authenticator or recovery code.</p>
              <label className="block"><span className="nb-label">Current code</span><input inputMode="numeric" autoComplete="one-time-code" required className="nb-input" value={regenCode} onChange={(e) => setRegenCode(e.target.value)} data-testid="security-regen-code" /></label>
              <button disabled={busy || !status?.sessionMfaVerified} className="nb-btn-ghost h-10 w-full" data-testid="security-regen-submit">Issue new recovery codes</button>
            </form>
          )}

          {status?.mfaEnforced && (
            <p className="text-xs text-nb-mute" data-testid="security-disable-blocked">Turning authenticator off is not available while staff MFA is required. Use replace instead.</p>
          )}
        </section>
      )}

      <section className="nb-card space-y-3 p-5" data-testid="security-sessions-card">
        <p className="nb-eyebrow">Sessions</p>
        <p className="text-sm" data-testid="security-active-sessions">{status ? `${status.activeSessions} active session${status.activeSessions === 1 ? "" : "s"}` : "—"}</p>
        <button type="button" disabled={busy} onClick={revokeOthers} className="nb-btn-ghost h-10 w-full" data-testid="security-revoke-others">Sign out other devices</button>
      </section>
      <AppBuildLabel className="text-center" />
    </div>
  );
}
