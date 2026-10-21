import { useEffect, useState } from "react";
import { useDemo } from "@/store/DemoStore";
import { apiError } from "@/lib/api";
import { FlowStepShell } from "@/components/FlowStepShell";

const STEPS = ["Account", "You", "Address", "Health", "Insurance", "Card", "Consent", "Review"];

export default function Welcome() {
  const { api, run } = useDemo();
  const [token, setToken] = useState("");
  const [step, setStep] = useState(0);
  /** Account step: identity (name/DOB) then credentials (email/password). */
  const [accountPhase, setAccountPhase] = useState("identity");
  const [form, setForm] = useState({ lastName: "", dateOfBirth: "", email: "", password: "", phone: "" });
  const [draft, setDraft] = useState(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const hash = window.location.hash.replace(/^#/, "");
    if (hash) setToken(hash);
  }, []);

  const verify = async () => {
    setError("");
    setBusy(true);
    try {
      await api.legacyVerify({ token, ...form });
      const saved = await api.legacyOnboarding();
      setDraft(saved.draft);
      setStep(saved.step || 2);
    } catch (err) {
      setError(apiError(err));
    } finally {
      setBusy(false);
    }
  };

  const save = async (next) => {
    setBusy(true);
    try {
      await run(() => api.legacySaveOnboarding({ step: next, ...draft }), "Progress saved");
      setStep(next);
    } finally {
      setBusy(false);
    }
  };

  const identityReady = form.lastName.trim() && form.dateOfBirth.trim();
  const credentialsReady = form.email.trim() && (form.password || "").length >= 8;

  const accountActions = accountPhase === "identity"
    ? (
      <button
        type="button"
        className="nb-btn-primary h-12 w-full"
        data-testid="welcome-identity-continue"
        disabled={!identityReady}
        onClick={() => setAccountPhase("credentials")}
      >
        Continue
      </button>
    )
    : (
      <div className="flex w-full flex-col gap-2">
        <button
          type="button"
          className="nb-btn-primary h-12 w-full"
          data-testid="welcome-verify"
          disabled={!credentialsReady || busy}
          onClick={verify}
        >
          {busy ? "Checking…" : "Verify and continue"}
        </button>
        <button
          type="button"
          className="nb-btn-ghost h-12 w-full"
          data-testid="welcome-identity-back"
          onClick={() => setAccountPhase("identity")}
        >
          Back
        </button>
      </div>
    );

  return (
    <div className="mx-auto max-w-lg space-y-5 px-4 py-8" data-testid="legacy-welcome">
      <p className="nb-eyebrow">Client app</p>
      <h1 className="text-2xl font-semibold tracking-tight">
        {step === 0
          ? (accountPhase === "identity" ? "Confirm who you are" : "Create your sign-in")
          : "Set up your account"}
      </h1>
      <p className="text-sm text-nb-mute" data-testid="welcome-step-caption">
        {step === 0
          ? (accountPhase === "identity" ? "Account · identity" : "Account · sign-in")
          : STEPS[step] || "Continue"}
      </p>
      <ol className="flex gap-2 overflow-x-auto text-xs text-nb-mute" aria-label="Onboarding progress">
        {STEPS.map((label, index) => <li key={label} className={index === step ? "font-semibold text-nb-navy" : ""}>{label}</li>)}
      </ol>
      {error && <p className="text-sm text-rose-700" role="alert" data-testid="welcome-error">{error}</p>}

      {step === 0 && (
        <FlowStepShell
          testid="welcome-flow-shell"
          actionsTestid="welcome-sticky-actions"
          stacked={accountPhase === "credentials"}
          actions={accountActions}
        >
          <div className="nb-card space-y-3 p-5">
            {accountPhase === "identity" ? (
              <>
                <p className="text-sm font-semibold" data-testid="welcome-identity-title">Confirm who you are</p>
                <p className="text-xs text-nb-mute">We match your last name and date of birth to your invitation.</p>
                <label className="block text-sm">Last name<input className="nb-input" required value={form.lastName} onChange={(e) => setForm({ ...form, lastName: e.target.value })} data-testid="welcome-last-name" /></label>
                <label className="block text-sm">Date of birth<input className="nb-input" required placeholder="YYYY-MM-DD" value={form.dateOfBirth} onChange={(e) => setForm({ ...form, dateOfBirth: e.target.value })} data-testid="welcome-dob" /></label>
              </>
            ) : (
              <>
                <p className="text-sm font-semibold" data-testid="welcome-credentials-title">Create your sign-in</p>
                <p className="text-xs text-nb-mute">Optional phone can be added later in your profile.</p>
                <label className="block text-sm">Email<input type="email" className="nb-input" required value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} data-testid="welcome-email" /></label>
                <label className="block text-sm">Password<input type="password" className="nb-input" required minLength={8} value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} data-testid="welcome-password" /></label>
              </>
            )}
          </div>
        </FlowStepShell>
      )}

      {draft && step > 0 && (
        <FlowStepShell
          testid="welcome-draft-shell"
          actionsTestid="welcome-sticky-actions"
          actions={(
            <button type="button" className="nb-btn-primary h-12 w-full" data-testid="welcome-save" disabled={busy} onClick={() => save(Math.min(step + 1, 7))}>
              {busy ? "Saving…" : "Save and continue"}
            </button>
          )}
        >
          <div className="nb-card space-y-3 p-5" data-testid="welcome-draft">
            <p className="text-sm">Welcome back, {draft.personal?.firstName || "there"}. You can leave and return to this step.</p>
            {step === 4 && <p className="text-sm text-nb-mute">Insurance is optional. Add none, one, or more than one policy. Nabitouch does not check coverage with an insurer.</p>}
          </div>
        </FlowStepShell>
      )}
    </div>
  );
}
