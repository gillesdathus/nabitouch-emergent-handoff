import { useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { api, apiError } from "@/lib/api";

export default function Join() {
  const [params] = useSearchParams();
  const [password, setPassword] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const token = params.get("token") || "";
  const submit = async (event) => {
    event.preventDefault();
    setError("");
    try {
      const result = await api.acceptInvite(token, password);
      setMessage(result.message || "Password saved. Sign in and enroll your authenticator.");
      setPassword("");
    } catch (err) {
      setError(apiError(err));
    }
  };
  return (
    <div className="mx-auto max-w-md px-5 py-16" data-testid="join-page">
      <h1 className="text-3xl font-semibold tracking-tight">Accept your invitation</h1>
      <p className="mt-2 text-sm text-nb-mute">Choose your own password. Nabitouch staff do not see it. After this, sign in and enroll your authenticator.</p>
      {!token && <p className="mt-4 text-sm text-red-700">This page needs the invitation link from the owner.</p>}
      <form className="mt-6 space-y-3" onSubmit={submit}>
        <input type="password" className="nb-input" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Password, at least 8 characters" data-testid="join-password" />
        <button className="nb-btn-primary h-11 w-full" disabled={!token || password.length < 8} data-testid="join-submit">Save password</button>
      </form>
      {message && <p className="mt-4 text-sm text-teal-800" data-testid="join-done">{message} <Link to="/login" className="font-semibold text-nb-blue">Sign in</Link></p>}
      {error && <p className="mt-4 text-sm text-red-700" data-testid="join-error">{error}</p>}
    </div>
  );
}
