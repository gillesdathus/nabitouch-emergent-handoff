import { useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { KeyRound, Loader2, CheckCircle2 } from "lucide-react";
import { Logo, Breathing } from "@/components/brand";
import { api, apiError } from "@/lib/api";

export default function ResetPassword() {
  const [params] = useSearchParams();
  const token = params.get("token") || "";
  const [f, setF] = useState({ pw: "", confirm: "" });
  const [done, setDone] = useState(false);
  const [err, setErr] = useState(token ? "" : "This reset link is missing its code — please request a new one.");
  const [busy, setBusy] = useState(false);
  const submit = async (e) => {
    e.preventDefault(); setErr("");
    if (f.pw.length < 8) return setErr("Password must be at least 8 characters.");
    if (f.pw !== f.confirm) return setErr("Passwords don't match.");
    setBusy(true);
    try { await api.resetPassword(token, f.pw); setDone(true); } catch (x) { setErr(apiError(x)); } finally { setBusy(false); }
  };
  return (
    <div className="relative mx-auto max-w-md overflow-hidden px-5 py-14" data-testid="reset-password-page">
      <Breathing leaves={false} />
      <div className="relative">
        <Logo variant="emblem" className="mx-auto h-16 w-auto" />
        <h1 className="mt-6 text-center text-3xl font-semibold tracking-tight">Choose a new password</h1>
        {done ? (
          <div className="nb-card mt-8 space-y-3 p-6 text-center" data-testid="reset-password-done">
            <CheckCircle2 className="mx-auto h-10 w-10 text-emerald-500" />
            <p className="font-semibold">Your password has been updated</p>
            <Link to="/login" className="nb-btn-primary w-full" data-testid="reset-go-login">Sign in</Link>
          </div>
        ) : (
          <form onSubmit={submit} className="nb-card mt-8 space-y-4 p-6">
            <label className="block"><span className="nb-label">New password</span><input type="password" required autoComplete="new-password" className="nb-input" value={f.pw} onChange={(e) => setF({ ...f, pw: e.target.value })} data-testid="reset-password-input" /></label>
            <label className="block"><span className="nb-label">Confirm new password</span><input type="password" required autoComplete="new-password" className="nb-input" value={f.confirm} onChange={(e) => setF({ ...f, confirm: e.target.value })} data-testid="reset-password-confirm-input" /></label>
            {err && <p className="rounded-2xl bg-rose-50 p-3 text-sm text-rose-700" data-testid="reset-error">{err}</p>}
            <button disabled={busy || !token} className="nb-btn-primary w-full" data-testid="reset-submit-btn">{busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <KeyRound className="h-4 w-4" />}Update password</button>
            <p className="text-center text-sm text-nb-mute"><Link to="/forgot-password" className="font-semibold text-nb-blue" data-testid="reset-request-new-link">Request a new link</Link></p>
          </form>
        )}
      </div>
    </div>
  );
}
