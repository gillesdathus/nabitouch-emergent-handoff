import { useEffect, useState } from "react";
import QRCode from "qrcode";
import { KeyRound, Loader2 } from "lucide-react";

export const QR_RENDER = { margin: 1, width: 320, errorCorrectionLevel: "M" };

export function AuthenticatorSetup({ otpauth, secret, recoveryCodes, code, onCode, onVerify, onCancel, busy, error }) {
  const [qr, setQr] = useState("");
  useEffect(() => {
    const meta = document.querySelector('meta[name="referrer"]') || document.head.appendChild(Object.assign(document.createElement("meta"), { name: "referrer" }));
    const previous = meta.getAttribute("content");
    meta.setAttribute("content", "no-referrer");
    return () => {
      if (previous == null) meta.remove();
      else meta.setAttribute("content", previous);
    };
  }, []);
  useEffect(() => {
    let live = true;
    QRCode.toString(otpauth, { ...QR_RENDER, type: "svg" }).then((svg) => {
      if (live) setQr(`data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`);
    });
    return () => { live = false; };
  }, [otpauth]);
  return (
    <form onSubmit={onVerify} className="nb-card mt-8 space-y-4 p-6" data-testid="login-mfa-enroll" autoComplete="off">
      <h1 className="text-center text-3xl font-semibold tracking-tight">Secure your account</h1>
      <p className="text-center text-sm text-nb-mute">Scan this QR code with your authenticator app.</p>
      {qr && <img src={qr} alt="Authenticator QR code" width={320} height={320} className="mx-auto h-auto w-full max-w-[320px]" data-testid="login-mfa-qr" />}
      <p className="text-xs text-nb-mute">Microsoft Authenticator, Google Authenticator, and other authenticator apps can scan this code. On a phone, use the manual key when the app is on this device.</p>
      <details data-testid="login-mfa-manual">
        <summary className="cursor-pointer text-sm font-semibold text-nb-blue">Enter setup key manually</summary>
        <p className="mt-2 break-all font-mono text-sm" data-testid="login-mfa-secret">{secret}</p>
      </details>
      {recoveryCodes?.length > 0 && (
        <div>
          <p className="nb-label">Recovery codes</p>
          <p className="text-xs text-nb-mute">Store these somewhere you can open if the phone is lost. Each code works once. They will not be shown again.</p>
          <ul className="mt-2 font-mono text-xs" data-testid="login-mfa-recovery">{recoveryCodes.map((item) => <li key={item}>{item}</li>)}</ul>
        </div>
      )}
      <label className="block"><span className="nb-label">Authenticator code</span><input inputMode="numeric" autoComplete="one-time-code" maxLength={6} required className="nb-input" value={code} onChange={(e) => onCode(e.target.value)} data-testid="login-mfa-enroll-code" /></label>
      {error && <p className="rounded-2xl bg-rose-50 p-3 text-sm text-rose-700" data-testid="login-error">{error}</p>}
      <button disabled={busy} className="nb-btn-primary w-full" data-testid="login-mfa-enroll-submit">{busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <KeyRound className="h-4 w-4" />}Verify and continue</button>
      <button type="button" onClick={onCancel} className="w-full text-sm font-semibold text-nb-mute" data-testid="login-mfa-cancel">Cancel</button>
    </form>
  );
}
