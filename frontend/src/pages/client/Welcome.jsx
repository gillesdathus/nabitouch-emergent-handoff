import { useEffect, useState } from "react";
import { useDemo } from "@/store/DemoStore";
import { apiError } from "@/lib/api";

const STEPS = ["Account", "You", "Address", "Health", "Insurance", "Card", "Consent", "Review"];

export default function Welcome() {
  const { api, run } = useDemo();
  const [token, setToken] = useState("");
  const [step, setStep] = useState(0);
  const [form, setForm] = useState({ lastName: "", dateOfBirth: "", email: "", password: "", phone: "" });
  const [draft, setDraft] = useState(null);
  const [error, setError] = useState("");

  useEffect(() => {
    const hash = window.location.hash.replace(/^#/, "");
    if (hash) setToken(hash);
  }, []);

  const verify = async (event) => {
    event.preventDefault();
    setError("");
    try {
      await api.legacyVerify({ token, ...form });
      const saved = await api.legacyOnboarding();
      setDraft(saved.draft);
      setStep(saved.step || 2);
    } catch (err) {
      setError(apiError(err));
    }
  };

  const save = async (next) => {
    await run(() => api.legacySaveOnboarding({ step: next, ...draft }), "Progress saved");
    setStep(next);
  };

  return (
    <div className="mx-auto max-w-lg space-y-5 px-4 py-8" data-testid="legacy-welcome">
      <p className="nb-eyebrow">Client app</p>
      <h1 className="text-2xl font-semibold tracking-tight">Set up your account</h1>
      <ol className="flex gap-2 overflow-x-auto text-xs text-nb-mute" aria-label="Onboarding progress">
        {STEPS.map((label, index) => <li key={label} className={index === step ? "font-semibold text-nb-navy" : ""}>{label}</li>)}
      </ol>
      {error && <p className="text-sm text-rose-700" role="alert">{error}</p>}
      {step === 0 && (
        <form className="nb-card space-y-3 p-5" onSubmit={verify}>
          <label className="block text-sm">Last name<input className="nb-input" required value={form.lastName} onChange={(e) => setForm({ ...form, lastName: e.target.value })} data-testid="welcome-last-name" /></label>
          <label className="block text-sm">Date of birth<input className="nb-input" required placeholder="YYYY-MM-DD" value={form.dateOfBirth} onChange={(e) => setForm({ ...form, dateOfBirth: e.target.value })} data-testid="welcome-dob" /></label>
          <label className="block text-sm">Email<input type="email" className="nb-input" required value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} data-testid="welcome-email" /></label>
          <label className="block text-sm">Password<input type="password" className="nb-input" required minLength={8} value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} data-testid="welcome-password" /></label>
          <button className="nb-btn-primary h-12 w-full" data-testid="welcome-verify">Continue</button>
        </form>
      )}
      {draft && step > 0 && (
        <div className="nb-card space-y-3 p-5" data-testid="welcome-draft">
          <p className="text-sm">Welcome back, {draft.personal?.firstName || "there"}. You can leave and return to this step.</p>
          {step === 4 && <p className="text-sm text-nb-mute">Insurance is optional. Add none, one, or more than one policy. Nabitouch does not check coverage with an insurer.</p>}
          <button type="button" className="nb-btn-primary h-12 w-full" data-testid="welcome-save" onClick={() => save(Math.min(step + 1, 7))}>Save and continue</button>
        </div>
      )}
    </div>
  );
}
