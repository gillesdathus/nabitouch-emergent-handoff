import { useState } from "react";
import { useNavigate, Link } from "react-router-dom";
import { motion, useMotionValue, useTransform } from "framer-motion";
import { ShieldCheck, ArrowLeft, ChevronsRight, MapPin, CalendarCheck, Navigation } from "lucide-react";
import { InputOTP, InputOTPGroup, InputOTPSlot } from "@/components/ui/input-otp";
import { usePreview } from "@/store/PreviewStore";
import { Field, Notice } from "@/components/ui-kit";
import { Lockup, Attribution } from "@/components/brand";
import { wait } from "@/lib/api";

const roleFor = (email) => (/owner/.test(email) ? ["owner", "/owner"] : /pro|amira/.test(email) ? ["pro", "/pro"] : /desk|maya/.test(email) ? ["desk", "/desk"] : ["client", "/welcome"]);

export default function Login() {
  const { setRole } = usePreview();
  const nav = useNavigate();
  const [mode, setMode] = useState("signin");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    await wait();
    setBusy(false);
    if (mode === "forgot") return setMode("sent");
    const [r, path] = roleFor(email);
    if (r === "client") { setRole("client"); nav(mode === "register" ? "/welcome" : "/me"); } else setMode("mfa");
  };
  const verify = async () => { setBusy(true); await wait(); const [r, path] = roleFor(email); setRole(r); nav(path); };
  return (
    <div className="min-h-screen grid lg:grid-cols-2">
      <div className="hidden lg:block relative overflow-hidden"><img src="/img/stones.jpg" alt="" className="absolute inset-0 h-full w-full object-cover" /><div className="absolute inset-0 nb-lagoon opacity-60 mix-blend-multiply" /><p className="absolute bottom-10 left-10 right-10 text-white text-4xl font-semibold leading-tight">Relax, recover,<br /><span className="font-display italic font-normal">anywhere.</span></p></div>
      <div className="flex flex-col px-6 pt-14 pb-8 max-w-md w-full mx-auto">
        <Lockup className="mb-10" />
        {mode === "mfa" ? (
          <div data-testid="mfa-step">
            <span className="grid place-items-center h-14 w-14 rounded-2xl tint-mint text-nb-teal mb-4"><ShieldCheck className="h-6 w-6" /></span>
            <h1 className="text-3xl font-semibold">Authenticator code</h1>
            <p className="text-nb-mute mt-1 mb-6 text-sm">Staff accounts require a 6-digit code before the workspace opens.</p>
            <InputOTP maxLength={6} value={code} onChange={setCode} data-testid="mfa-otp-input"><InputOTPGroup>{[0, 1, 2, 3, 4, 5].map((i) => <InputOTPSlot key={i} index={i} className="h-14 w-12 text-lg" />)}</InputOTPGroup></InputOTP>
            <button data-testid="mfa-verify-btn" disabled={code.length < 6 || busy} onClick={verify} className="nb-btn-primary w-full mt-6">{busy ? "Verifying…" : "Verify and continue"}</button>
            <Notice className="mt-4" tone="info">Preview: any 6 digits work. The real flow calls /auth/mfa/verify.</Notice>
          </div>
        ) : mode === "sent" ? (
          <div data-testid="reset-sent"><h1 className="text-3xl font-semibold">Check your email</h1><p className="text-nb-mute mt-2">If an account exists for {email}, a reset link is on its way.</p><button onClick={() => setMode("signin")} className="nb-btn-ghost mt-6">Back to sign in</button></div>
        ) : (
          <form onSubmit={submit} data-testid="login-form">
            <h1 className="text-3xl font-semibold">{mode === "register" ? "Create your profile" : mode === "forgot" ? "Reset password" : "Welcome back"}</h1>
            <p className="text-nb-mute mt-1 mb-6 text-sm">{mode === "forgot" ? "We'll email you a secure link." : "Sign in to manage your visits."}</p>
            {mode === "register" && <Field label="Full name"><input required className="nb-input" data-testid="register-name" /></Field>}
            <Field label="Email"><input required type="email" className="nb-input" value={email} onChange={(e) => setEmail(e.target.value)} data-testid="login-email" /></Field>
            {mode !== "forgot" && <Field label="Password"><input required type="password" minLength={8} className="nb-input" data-testid="login-password" /></Field>}
            {mode === "signin" && <button type="button" data-testid="forgot-link" onClick={() => setMode("forgot")} className="text-sm text-nb-blue font-medium -mt-2 mb-5">Forgot password?</button>}
            <button disabled={busy} data-testid="login-submit" className="nb-btn-primary w-full">{busy ? "Please wait…" : mode === "register" ? "Create profile" : mode === "forgot" ? "Send reset link" : "Sign in"}</button>
            <p className="text-sm text-center text-nb-mute mt-5">{mode === "signin" ? "New to Nabitouch? " : "Have an account? "}<button type="button" data-testid="toggle-register" onClick={() => setMode(mode === "signin" ? "register" : "signin")} className="text-nb-blue font-semibold">{mode === "signin" ? "Create profile" : "Sign in"}</button></p>
            <Notice className="mt-6" tone="info">Preview hint: emails containing “owner”, “pro” or “desk” go to the staff MFA step.</Notice>
          </form>
        )}
        <div className="mt-auto pt-10 flex items-center justify-between"><Link to="/" className="text-sm text-nb-mute flex items-center gap-1"><ArrowLeft className="h-4 w-4" />Home</Link><Attribution /></div>
      </div>
    </div>
  );
}

function SwipeToStart({ onDone }) {
  const x = useMotionValue(0);
  const fill = useTransform(x, [0, 220], ["0%", "100%"]);
  return (
    <div data-testid="swipe-to-start" className="relative h-16 rounded-full bg-white/15 p-1.5 overflow-hidden">
      <motion.div style={{ width: fill }} className="absolute inset-y-0 left-0 bg-white/20" />
      <span className="absolute inset-0 grid place-items-center text-white/80 text-sm font-medium pointer-events-none">Swipe to get started</span>
      <motion.button drag="x" dragConstraints={{ left: 0, right: 230 }} dragElastic={0.05} style={{ x }} onDragEnd={(_, i) => i.offset.x > 160 && onDone()} onClick={onDone} data-testid="swipe-handle" className="relative z-10 h-13 w-28 h-[52px] rounded-full bg-white text-nb-ink font-semibold flex items-center justify-center gap-1 shadow-lg">Start<ChevronsRight className="h-5 w-5 text-nb-blue" /></motion.button>
    </div>
  );
}

export function Welcome() {
  const nav = useNavigate();
  const cards = [[MapPin, "Tell us where you are", "Home, hotel or office in Edmonton."], [CalendarCheck, "Pick a time that works", "Real openings, shown in local time."], [Navigation, "Track your therapist", "Arrival estimates on the day."]];
  return (
    <div className="min-h-screen nb-lagoon text-white flex flex-col px-6 pt-14 pb-10">
      <img src="/brand/wordmark.png" alt="Nabitouch" className="h-6 w-auto self-start brightness-0 invert" />
      <div className="flex-1 flex flex-col justify-center max-w-sm mx-auto w-full">
        <div className="relative h-64">
          {cards.map(([I, t, b], i) => (
            <motion.div key={t} initial={{ opacity: 0, y: 30, rotate: 0 }} animate={{ opacity: 1, y: i * 70, rotate: [-3, 2, -1][i] }} transition={{ delay: 0.15 + i * 0.12, type: "spring", stiffness: 200, damping: 22 }} className={`absolute inset-x-0 rounded-3xl p-4 flex items-center gap-3 shadow-xl ${i === 1 ? "bg-white text-nb-ink" : "bg-nb-ink/80 text-white"}`}>
              <span className={`grid place-items-center h-10 w-10 rounded-2xl ${i === 1 ? "tint-lagoon text-nb-blue" : "bg-white/10"}`}><I className="h-5 w-5" /></span>
              <div><p className="font-semibold text-sm">{t}</p><p className={`text-xs ${i === 1 ? "text-nb-mute" : "text-white/60"}`}>{b}</p></div>
            </motion.div>
          ))}
        </div>
        <h1 className="text-4xl font-semibold leading-tight mt-8">Calm, booked<br /><span className="font-display italic font-normal">in a minute.</span></h1>
        <p className="text-white/70 mt-3 text-sm">Your profile is ready. Let's plan your first visit.</p>
      </div>
      <div className="max-w-sm mx-auto w-full"><SwipeToStart onDone={() => nav("/me")} /></div>
    </div>
  );
}
