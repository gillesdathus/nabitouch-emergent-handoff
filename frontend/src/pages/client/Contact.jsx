import { useState } from "react";
import { Link } from "react-router-dom";
import { Loader2 } from "lucide-react";
import { useDemo } from "@/store/DemoStore";
import { api, apiError } from "@/lib/api";

function publishedClinic(settings) {
  const line = settings?.clinic?.address || "";
  if (!line || line.includes("[") || /to be supplied/i.test(line)) return "";
  return line;
}

export default function Contact() {
  const { idx } = useDemo();
  const clinic = publishedClinic(idx.settings);
  const [form, setForm] = useState({ name: "", email: "", message: "" });
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [err, setErr] = useState("");
  const set = (key) => (event) => setForm((current) => ({ ...current, [key]: event.target.value }));
  const send = async (event) => {
    event.preventDefault();
    setBusy(true);
    setErr("");
    try {
      await api.contact(form);
      setDone(true);
    } catch (error) {
      setErr(apiError(error));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="mx-auto grid max-w-5xl gap-8 px-5 py-10 lg:grid-cols-[1fr_1.1fr]" data-testid="contact-page">
      <div>
        <p className="nb-eyebrow">Edmonton</p>
        <h1 className="mt-2 text-4xl font-semibold tracking-tight text-nb-ink">Say <span className="font-display font-normal italic nb-gradient-text">hello</span></h1>
        <p className="mt-3 text-nb-mute">Questions about a visit, a zone, or a treatment can come through here. Booking itself stays in the appointment flow, including guest booking.</p>
        <div className="mt-6 space-y-3 text-sm">
          <p className="nb-card p-4"><b>Book a visit.</b> <Link to="/book" className="font-semibold text-nb-blue" data-testid="contact-book-link">Start a booking</Link></p>
          <p className="nb-card p-4"><b>Already have an account?</b> <Link to="/login" className="font-semibold text-nb-blue">Sign in</Link></p>
          {clinic && <p className="nb-card p-4" data-testid="contact-clinic"><b>Clinic.</b> {clinic}</p>}
          {!clinic && <p className="nb-card p-4" data-testid="contact-mobile">Visits are mobile across the Edmonton service area. An in-clinic address appears here once Nabitouch publishes one.</p>}
          {idx.settings?.clinic?.phoneTel && <p className="nb-card p-4" data-testid="contact-phone"><b>Phone.</b> <a className="font-semibold text-nb-blue" href={`tel:${idx.settings.clinic.phoneTel}`}>{idx.settings.clinic.phoneDisplay || idx.settings.clinic.phone}</a></p>}
          {idx.settings?.clinic?.email && <p className="nb-card p-4" data-testid="contact-email"><b>Email.</b> <a className="font-semibold text-nb-blue" href={`mailto:${idx.settings.clinic.email}`}>{idx.settings.clinic.email}</a></p>}
          {idx.settings?.clinic?.hours && <p className="nb-card p-4" data-testid="contact-hours"><b>Hours.</b> {idx.settings.clinic.hours}</p>}
          {idx.settings?.cancellationPolicy?.status === "approved" && <p className="nb-card p-4" data-testid="contact-policy">{idx.settings.cancellationPolicy.text}</p>}
        </div>
      </div>
      {done ? (
        <div className="nb-card p-6" data-testid="contact-sent"><h2 className="text-xl font-semibold">Message received</h2><p className="mt-2 text-sm text-nb-mute">Nabitouch has your note. For an appointment time, continue with booking.</p></div>
      ) : (
        <form onSubmit={send} className="nb-card space-y-4 p-6" data-testid="contact-form">
          <label className="block"><span className="nb-label">Name</span><input required minLength={2} className="nb-input" value={form.name} onChange={set("name")} data-testid="contact-name-input" /></label>
          <label className="block"><span className="nb-label">Email</span><input required type="email" className="nb-input" value={form.email} onChange={set("email")} data-testid="contact-email-input" /></label>
          <label className="block"><span className="nb-label">Message</span><textarea required minLength={8} rows={5} className="nb-input h-auto py-3" value={form.message} onChange={set("message")} data-testid="contact-message-input" /></label>
          {err && <p className="rounded-2xl bg-rose-50 p-3 text-sm text-rose-700" data-testid="contact-error">{err}</p>}
          <button disabled={busy} className="nb-btn-primary w-full" data-testid="contact-submit-btn">{busy ? <Loader2 className="h-4 w-4 animate-spin" /> : "Send message"}</button>
        </form>
      )}
    </div>
  );
}
