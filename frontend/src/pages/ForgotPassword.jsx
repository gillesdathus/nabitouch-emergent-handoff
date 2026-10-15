import { useState } from "react";
import { Link } from "react-router-dom";
import { KeyRound, Loader2, Mail, MailCheck, CheckCircle2 } from "lucide-react";
import { Logo, Breathing } from "@/components/brand";
import { api, apiError } from "@/lib/api";

export default function ForgotPassword() {
  const [email, setEmail] = useState("");
  const [step, setStep] = useState("request");
  const [token, setToken] = useState("");
  const [pw, setPw] = useState({ pw: "", confirm: "" });
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const requestReset = async (e) => {
    e.preventDefault(); setBusy(true); setErr("");
    try {
      const res = await api.forgotPassword(email);
      if (res?.previewRetry) { setErr(res.message || "Wait a few minutes, then request the reset again."); return; }
      if (res?.previewResetToken) { setToken(res.previewResetToken); setStep("choose"); return; }
      setStep("sent");
    } catch (x) { setErr(apiError(x)); } finally { setBusy(false); }
  };
  const choosePassword = async (e) => {
    e.preventDefault(); setErr("");
    if (pw.pw.length < 8) return setErr("Password must be at least 8 characters.");
    if (pw.pw !== pw.confirm) return setErr("Passwords don't match.");
    setBusy(true);
    try { await api.resetPassword(token, pw.pw); setToken(""); setStep("done"); }
    catch (x) { setErr(apiError(x)); } finally { setBusy(false); }
  };
  return (
    <div className="relative mx-auto max-w-md overflow-hidden px-5 py-14" data-testid="forgot-password-page">
      <Breathing leaves={false} />
      <div className="relative">
        <Logo variant="emblem" className="mx-auto h-16 w-auto" />
        <h1 className="mt-6 text-center text-3xl font-semibold tracking-tight">{step === "choose" || step === "done" ? "Choose a new password" : "Forgot your password?"}</h1>
        {step === "done" ? (
          <div className="nb-card mt-8 space-y-3 p-6 text-center" data-testid="forgot-preview-reset-done">
            <CheckCircle2 className="mx-auto h-10 w-10 text-emerald-500" />
            <p className="font-semibold">Your preview password has been updated</p>
            <p className="text-sm text-nb-mute">Sign in with the password you just chose. The authenticator setup opens before the owner dashboard.</p>
            <Link to="/login" className="nb-btn-primary w-full" data-testid="forgot-go-login">Sign in</Link>
          </div>
        ) : step === "choose" ? (
          <form onSubmit={choosePassword} className="nb-card mt-8 space-y-4 p-6" data-testid="forgot-preview-reset">
            <p className="text-sm text-nb-mute">This preview does not send email. Choose the password you will use to sign in on this computer.</p>
            <label className="block"><span className="nb-label">New password</span><input type="password" required autoComplete="new-password" className="nb-input" value={pw.pw} onChange={(e) => setPw({ ...pw, pw: e.target.value })} data-testid="forgot-new-password" /></label>
            <label className="block"><span className="nb-label">Confirm new password</span><input type="password" required autoComplete="new-password" className="nb-input" value={pw.confirm} onChange={(e) => setPw({ ...pw, confirm: e.target.value })} data-testid="forgot-confirm-password" /></label>
            {err && <p className="rounded-2xl bg-rose-50 p-3 text-sm text-rose-700" data-testid="forgot-error">{err}</p>}
            <button disabled={busy} className="nb-btn-primary w-full" data-testid="forgot-preview-reset-submit">{busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <KeyRound className="h-4 w-4" />}Update password</button>
          </form>
        ) : step === "sent" ? (
          <div className="nb-card mt-8 space-y-3 p-6 text-center" data-testid="forgot-password-sent">
            <MailCheck className="mx-auto h-10 w-10 text-nb-blue" />
            <p className="font-semibold">Check your inbox</p>
            <p className="text-sm text-nb-mute">If an account exists for {email}, a reset link is on its way. It expires in 30 minutes.</p>
            <Link to="/login" className="nb-btn-primary w-full" data-testid="forgot-back-to-login">Back to sign in</Link>
          </div>
        ) : (
          <form onSubmit={requestReset} className="nb-card mt-8 space-y-4 p-6">
            <p className="text-sm text-nb-mute">Enter your email and we'll send you a link to choose a new one.</p>
            <label className="block"><span className="nb-label">Email</span><input type="email" required autoComplete="email" className="nb-input" value={email} onChange={(e) => setEmail(e.target.value)} data-testid="forgot-email-input" /></label>
            {err && <p className="rounded-2xl bg-rose-50 p-3 text-sm text-rose-700" data-testid="forgot-error">{err}</p>}
            <button disabled={busy} className="nb-btn-primary w-full" data-testid="forgot-submit-btn">{busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Mail className="h-4 w-4" />}Send reset link</button>
            <p className="text-center text-sm text-nb-mute"><Link to="/login" className="font-semibold text-nb-blue" data-testid="forgot-login-link">Back to sign in</Link></p>
          </form>
        )}
      </div>
    </div>
  );
}
