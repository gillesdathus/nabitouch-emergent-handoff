import { useEffect, useRef, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { Lock, Loader2 } from "lucide-react";
import { Logo, Breathing } from "@/components/brand";
import { AuthenticatorSetup } from "@/components/AuthenticatorSetup";
import { useDemo } from "@/store/DemoStore";
import { api, apiError } from "@/lib/api";
import { postLoginPath } from "@/lib/workspaces";

export default function Login() {
  const { login, finish } = useDemo();
  const nav = useNavigate();
  const [params] = useSearchParams();
  const [f, setF] = useState({ email: "", password: "" });
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const [challenge, setChallenge] = useState("");
  const [enroll, setEnroll] = useState(null);
  const [code, setCode] = useState("");
  const enrollOnce = useRef(false);
  const clearEnrollment = () => { enrollOnce.current = false; setEnroll(null); setCode(""); setErr(""); };
  const go = (u) => {
    nav(postLoginPath(u, params.get("next")));
  };
  const submit = async (e) => {
    e.preventDefault(); setBusy(true); setErr("");
    try {
      const signed = await login(f.email, f.password);
      if (signed?.enrollmentRequired) { setEnroll({ challenge: signed.challenge }); return; }
      if (signed?.mfaRequired) { setChallenge(signed.challenge); return; }
      go(signed);
    } catch (x) { setErr(apiError(x)); } finally { setBusy(false); }
  };
  useEffect(() => {
    if (!enroll?.challenge || enroll.secret || enrollOnce.current) return;
    enrollOnce.current = true;
    setBusy(true); setErr("");
    api.mfaEnrollChallenge(enroll.challenge)
      .then((setup) => setEnroll((current) => (current ? { ...current, ...setup } : current)))
      .catch((x) => setErr(apiError(x)))
      .finally(() => setBusy(false));
  }, [enroll]);
  const confirmCode = async (e) => {
    e.preventDefault(); setBusy(true); setErr("");
    try { go(await finish(await api.mfaVerify(challenge, code))); } catch (x) { setErr(apiError(x)); } finally { setBusy(false); }
  };
  return (
    <div className="relative mx-auto max-w-md overflow-hidden px-5 py-14" data-testid="login-page">
      <Breathing leaves={false} />
      <div className="relative">
        <Logo variant="emblem" className="mx-auto h-16 w-auto" />
        {!enroll && <h1 className="mt-6 text-center text-3xl font-semibold tracking-tight">Welcome back</h1>}
        {!enroll && <p className="mt-1 text-center text-sm text-nb-mute">Sign in to your Nabitouch account.</p>}
        {enroll?.secret ? (
          <AuthenticatorSetup
            otpauth={enroll.otpauth}
            secret={enroll.secret}
            recoveryCodes={enroll.recoveryCodes || []}
            code={code}
            onCode={setCode}
            busy={busy}
            error={err}
            onCancel={clearEnrollment}
            onVerify={async (e) => {
              e.preventDefault(); setBusy(true); setErr("");
              try {
                const session = await api.mfaConfirmChallenge(enroll.challenge, code);
                clearEnrollment();
                go(await finish(session));
              } catch (x) { setErr(apiError(x)); } finally { setBusy(false); }
            }}
          />
        ) : enroll ? (
          <div className="nb-card mt-8 space-y-4 p-6 text-center" data-testid="login-mfa-enroll">
            <h1 className="text-3xl font-semibold tracking-tight">Secure your account</h1>
            <p className="text-sm text-nb-mute">Scan this QR code with your authenticator app.</p>
            {busy && <Loader2 className="mx-auto h-5 w-5 animate-spin" />}
            {err && <p className="rounded-2xl bg-rose-50 p-3 text-sm text-rose-700" data-testid="login-error">{err}</p>}
          </div>
        ) : challenge ? (
          <form onSubmit={confirmCode} className="nb-card mt-8 space-y-4 p-6" data-testid="login-mfa">
            <label className="block"><span className="nb-label">Authenticator code</span><input inputMode="numeric" autoComplete="one-time-code" required className="nb-input" value={code} onChange={(e) => setCode(e.target.value)} data-testid="login-mfa-code" /></label>
            <p className="text-xs text-nb-mute">Enter the code from your authenticator, or a recovery code.</p>
            {err && <p className="rounded-2xl bg-rose-50 p-3 text-sm text-rose-700" data-testid="login-error">{err}</p>}
            <button disabled={busy} className="nb-btn-primary w-full" data-testid="login-mfa-submit">Confirm</button>
          </form>
        ) : (
        <form onSubmit={submit} className="nb-card mt-8 space-y-4 p-6">
          <label className="block"><span className="nb-label">Email</span><input type="email" required autoComplete="email" className="nb-input" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} data-testid="login-email-input" /></label>
          <label className="block"><span className="nb-label flex items-center justify-between">Password<Link to="/forgot-password" className="text-xs font-semibold normal-case text-nb-blue" data-testid="login-forgot-password-link">Forgot password?</Link></span><input type="password" required autoComplete="current-password" className="nb-input" value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} data-testid="login-password-input" /></label>
          {err && <p className="rounded-2xl bg-rose-50 p-3 text-sm text-rose-700" data-testid="login-error">{err}</p>}
          <button disabled={busy} className="nb-btn-primary w-full" data-testid="login-submit-btn">{busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Lock className="h-4 w-4" />}Sign in</button>
          <p className="text-center text-sm text-nb-mute">New client? <Link to="/me/profile" className="font-semibold text-nb-blue" data-testid="login-register-link">Create your profile</Link></p>
          <p className="text-center text-[11px] text-nb-mute">Staff accounts are created by the Nabitouch owner.</p>
        </form>
        )}
      </div>
    </div>
  );
}
