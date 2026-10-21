import { useEffect, useState } from "react";
import { Link, useLocation, useSearchParams } from "react-router-dom";
import { CheckCircle2, Clock3, RefreshCw, ShieldCheck, XCircle } from "lucide-react";
import { api } from "@/lib/api";
import { useDemo } from "@/store/DemoStore";
import { homeFor } from "@/lib/workspaces";
import { CompletionHero, CompletionScreen } from "@/components/CompletionScreen";

const STATES = {
  confirmed: ["Payment confirmed", "Your verified payment is recorded. Thank you."],
  pending: ["Payment pending", "We are waiting for verified payment confirmation. You can check again safely."],
  failed: ["Payment failed or checkout expired", "This checkout did not complete. Check your billing balance before starting another payment."],
  cancelled: ["Checkout cancelled", "Stripe confirmed this checkout is closed. Your appointment has not been cancelled."],
  refunded: ["Payment refunded", "The verified refund is recorded in your billing account."],
  partially_refunded: ["Payment partially refunded", "A verified partial refund is recorded in your billing account."],
  unavailable: ["Payment verification temporarily unavailable", "We could not verify this payment. Check again or contact Nabitouch before making another payment."],
};

function ResultIcon({ state }) {
  if (state === "confirmed") return <CheckCircle2 className="h-7 w-7" />;
  if (state === "pending") return <Clock3 className="h-7 w-7" />;
  if (state === "failed" || state === "cancelled") return <XCircle className="h-7 w-7" />;
  return <ShieldCheck className="h-7 w-7" />;
}

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
  if (!user || needsLogin) {
    return (
      <CompletionScreen
        testid="payment-result-signin"
        actionsTestid="payment-result-actions"
        actions={<Link className="nb-btn-primary h-12 w-full" to={login} data-testid="payment-result-signin-btn">Sign in</Link>}
      >
        <CompletionHero
          mark={<span className="grid h-12 w-12 place-items-center rounded-2xl tint-lagoon text-nb-teal"><ShieldCheck className="h-7 w-7" /></span>}
          title="Sign in to verify your payment"
          subtitle="Payment details are available only through your authenticated account."
        />
      </CompletionScreen>
    );
  }
  const state = result ? (STATES[result.status] ? result.status : "unavailable") : sid ? "pending" : "unavailable";
  const [title, detail] = STATES[state];
  const cancel = async () => {
    setBusy(true);
    try { setResult(await api.cancelStripeCheckout(sid)); }
    catch { setResult({ status: "unavailable" }); }
    finally { setBusy(false); }
  };
  const accountHref = user.role === "client" ? "/me/billing" : homeFor(user);
  return (
    <CompletionScreen
      testid="payment-result-page"
      actionsTestid="payment-result-actions"
      actions={(
        <div className="flex w-full flex-col gap-2 sm:flex-row">
          {sid && (
            <button type="button" className="nb-btn-primary h-12 flex-1" disabled={busy} onClick={() => setAttempt((n) => n + 1)} data-testid="payment-result-retry">
              <RefreshCw className={busy ? "h-4 w-4 animate-spin" : "h-4 w-4"} />Check again
            </button>
          )}
          <Link className="nb-btn-ghost h-12 flex-1" to={accountHref} data-testid="payment-result-account">Back to my account</Link>
          {state === "pending" && sid && (
            <button type="button" className="nb-btn-ghost h-12 flex-1" disabled={busy} onClick={cancel} data-testid="payment-result-cancel-checkout">Cancel this checkout</button>
          )}
        </div>
      )}
    >
      <div className="nb-card rounded-3xl p-5 text-left sm:p-6" role="status" aria-live="polite" data-testid={`payment-result-${state}`}>
        <CompletionHero
          mark={<span className="grid h-12 w-12 place-items-center rounded-2xl tint-lagoon text-nb-teal"><ResultIcon state={state} /></span>}
          title={title}
          subtitle={detail}
        />
        {result?.amount && <p className="mt-4 text-sm">Payment amount <b className="nb-num">{result.amount.display}</b></p>}
        {result?.balance && <p className="mt-1 text-sm">Invoice balance <b className="nb-num">{result.balance.display}</b></p>}
      </div>
    </CompletionScreen>
  );
}
