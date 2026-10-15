import { useState } from "react";
import { Link } from "react-router-dom";
import { Loader2 } from "lucide-react";
import { ContactCards } from "@/components/ContactCards";
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
        <div className="mt-8">
          <ContactCards phoneDisplay={idx.settings?.clinic?.phoneDisplay || "+1 780-235-6508"} phoneTel={idx.settings?.clinic?.phoneTel || "+17802356508"} email={idx.settings?.clinic?.email || "info@nabitouch.com"} />
        </div>
        {(clinic || idx.settings?.clinic?.hours) && (
          <dl className="mt-6 space-y-3 border-l-2 border-nb-turq/40 pl-4 text-sm">
            {clinic && <div data-testid="contact-clinic"><dt className="text-[11px] font-semibold uppercase tracking-[0.18em] text-nb-mute">Clinic</dt><dd className="mt-0.5 text-nb-ink">{clinic}</dd></div>}
            {idx.settings?.clinic?.hours && <div data-testid="contact-hours"><dt className="text-[11px] font-semibold uppercase tracking-[0.18em] text-nb-mute">Hours</dt><dd className="mt-0.5 text-nb-ink">{idx.settings.clinic.hours}</dd></div>}
          </dl>
        )}
        <p className="mt-6 text-sm text-nb-mute">Ready to book? <Link to="/book" className="font-semibold text-nb-blue underline-offset-4 hover:underline" data-testid="contact-book-link">Start a booking</Link> · <Link to="/login" className="font-semibold text-nb-blue underline-offset-4 hover:underline" data-testid="contact-signin-link">Sign in</Link></p>
        {idx.settings?.cancellationPolicy?.status === "approved" && <p className="mt-4 text-xs text-nb-mute" data-testid="contact-policy">{idx.settings.cancellationPolicy.text}</p>}
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
