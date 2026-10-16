import { useEffect, useState } from "react";
import { Link, useLocation, useSearchParams } from "react-router-dom";
import { CheckCircle2, Clock3, RefreshCw, ShieldCheck } from "lucide-react";
import { api } from "@/lib/api";
import { useDemo } from "@/store/DemoStore";
import { homeFor } from "@/lib/workspaces";

const STATES = {
  confirmed: ["Payment confirmed", "Your verified payment is recorded. Thank you."],
  pending: ["Payment pending", "We are waiting for verified payment confirmation. You can check again safely."],
  failed: ["Payment failed or checkout expired", "This checkout did not complete. Check your billing balance before starting another payment."],
  cancelled: ["Checkout cancelled", "Stripe confirmed this checkout is closed. Your appointment has not been cancelled."],
  refunded: ["Payment refunded", "The verified refund is recorded in your billing account."],
  partially_refunded: ["Payment partially refunded", "A verified partial refund is recorded in your billing account."],
  unavailable: ["Payment verification temporarily unavailable", "We could not verify this payment. Check again or contact Nabitouch before making another payment."],
};

export default function PaymentResult() {
  const { user } = useDemo();
  const [params] = useSearchParams();
  const location = useLocation();
  const sid = params.get("session_id") || "";
  const [result, setResult] = useState(null);
  const [attempt, setAttempt] = useState(0);
  const [busy, setBusy] = useState(false);
  const [needsLogin, setNeedsLogin] = useState(false);
  useEffect(() => {
    let stopped = false, timer, tries = 0;
    setResult(null); setNeedsLogin(false);
    if (!user || !sid) return;
    const check = async () => {
      setBusy(true);
      try {
        const verified = await api.stripeReturn(sid);
        if (stopped) return;
        setResult(verified);
        if (verified.status === "pending" && ++tries < 12) timer = setTimeout(check, 2500);
      } catch (error) {
        if (stopped) return;
        setNeedsLogin(error?.response?.status === 401);
        setResult({ status: "unavailable" });
      } finally { if (!stopped) setBusy(false); }
    };
    check();
    return () => { stopped = true; clearTimeout(timer); };
  }, [sid, Boolean(user), attempt]);
  const login = "/login?next=" + encodeURIComponent(location.pathname + location.search);
  if (!user || needsLogin) return <div className="mx-auto max-w-xl px-5 py-14 text-center"><h1 className="text-2xl font-semibold">Sign in to verify your payment</h1><p className="mt-3 text-sm text-nb-mute">Payment details are available only through your authenticated account.</p><Link className="nb-btn-primary mt-6" to={login}>Sign in</Link></div>;
  const state = result ? (STATES[result.status] ? result.status : "unavailable") : sid ? "pending" : "unavailable";
  const [title, detail] = STATES[state];
  const cancel = async () => {
    setBusy(true);
    try { setResult(await api.cancelStripeCheckout(sid)); }
    catch { setResult({ status: "unavailable" }); }
    finally { setBusy(false); }
  };
  return <div className="mx-auto max-w-xl px-5 py-14 nb-page" data-testid="payment-result-page">
    <div className="nb-card rounded-3xl p-6 sm:p-8" role="status" aria-live="polite" data-testid={`payment-result-${state}`}>
      <div className="mb-5 grid h-14 w-14 place-items-center rounded-2xl tint-lagoon text-nb-teal">{state === "confirmed" ? <CheckCircle2 /> : state === "pending" ? <Clock3 /> : <ShieldCheck />}</div>
      <h1 className="text-2xl font-semibold tracking-tight">{title}</h1><p className="mt-3 text-sm text-nb-mute">{detail}</p>
      {result?.amount && <p className="mt-5 text-sm">Payment amount <b className="nb-num">{result.amount.display}</b></p>}
      {result?.balance && <p className="mt-2 text-sm">Invoice balance <b className="nb-num">{result.balance.display}</b></p>}
      <div className="mt-6 flex flex-wrap gap-3">
        {sid && <button type="button" className="nb-btn-primary" disabled={busy} onClick={() => setAttempt((n) => n + 1)}><RefreshCw className={busy ? "h-4 w-4 animate-spin" : "h-4 w-4"} />Check again</button>}
        <Link className="nb-btn-ghost" to={user.role === "client" ? "/me/billing" : homeFor(user)}>Back to my account</Link>
        {state === "pending" && sid && <button type="button" className="nb-btn-ghost" disabled={busy} onClick={cancel}>Cancel this checkout</button>}
      </div>
    </div>
  </div>;
}
