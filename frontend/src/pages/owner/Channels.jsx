import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Mail, MessageSquareText, Send } from "lucide-react";
import { api, apiError } from "@/lib/api";
import { Notice, PageHeader } from "@/components/tide";

const Row = ({ k, v, testid }) => <div className="flex justify-between gap-4 py-2 text-sm"><dt className="text-nb-mute">{k}</dt><dd className="text-right font-medium" data-testid={testid}>{v}</dd></div>;
const yes = (b) => (b ? "Ready" : "Missing");

function EmailCard() {
  const [s, setS] = useState(null);
  const load = useCallback(() => api.emailStatus().then(setS).catch(() => {}), []);
  useEffect(() => { load(); }, [load]);
  const test = () => api.emailTest().then((r) => toast.success(r.sent ? `Test sent via ${r.provider}` : `Not sent (provider: ${r.provider})`)).catch((e) => toast.error(apiError(e)));
  if (!s) return <div className="h-64 rounded-[28px] nb-skeleton" />;
  return (
    <section className="nb-card p-5" data-testid="channels-email">
      <p className="flex items-center gap-2 font-semibold"><Mail className="h-4 w-4 text-nb-blue" />Email · Resend</p>
      <dl className="mt-3 divide-y divide-sky-100">
        <Row k="Provider" v={s.provider} testid="email-provider" />
        <Row k="Resend API key" v={yes(s.resendKey)} testid="email-key" />
        <Row k="Sender" v={s.sender || "Missing"} testid="email-sender" />
        <Row k="Delivery webhook secret" v={yes(s.webhookSecret)} testid="email-webhook" />
        <Row k="Test inbox (all mail redirected)" v={s.testRecipient || "Off"} testid="email-test-recipient" />
        {Object.entries(s.types).map(([k, v]) => <Row key={k} k={`${k[0].toUpperCase()}${k.slice(1)} emails`} v={v ? "On" : "Off"} testid={`email-type-${k}`} />)}
      </dl>
      <button type="button" onClick={test} data-testid="email-test-btn" className="nb-btn-ghost mt-4 h-10 text-sm"><Send className="h-4 w-4" />Send test to {s.testRecipient || "test inbox"}</button>
    </section>
  );
}

function SmsCard() {
  const [s, setS] = useState(null);
  const load = useCallback(() => api.smsSummary().then(setS).catch(() => {}), []);
  useEffect(() => { load(); }, [load]);
  const test = () => api.smsTest().then(() => { toast.success("Test text sent"); load(); }).catch((e) => toast.error(apiError(e)));
  if (!s) return <div className="h-64 rounded-[28px] nb-skeleton" />;
  return (
    <section className="nb-card p-5" data-testid="channels-sms">
      <p className="flex items-center gap-2 font-semibold"><MessageSquareText className="h-4 w-4 text-nb-teal" />Text messages · Twilio</p>
      <dl className="mt-3 divide-y divide-sky-100">
        <Row k="Sending" v={s.sending ? "On" : `Off${s.flag ? "" : " (SMS_ENABLED=false)"}`} testid="sms-sending" />
        <Row k="Twilio credentials" v={yes(s.credentials)} testid="sms-credentials" />
        <Row k="Webhook signature (Auth Token)" v={yes(s.webhookSecret)} testid="sms-webhook" />
        <Row k="Test phone (all texts redirected)" v={s.testRecipient || "Off"} testid="sms-test-recipient" />
        <Row k="Opted out numbers" v={s.optOuts} testid="sms-optouts" />
        <Row k="Outbox" v={Object.entries(s.outbox).filter(([, n]) => n).map(([k, n]) => `${n} ${k}`).join(" · ") || "Empty"} testid="sms-outbox" />
      </dl>
      <button type="button" disabled={!s.sending} onClick={test} data-testid="sms-test-btn" className="nb-btn-ghost mt-4 h-10 text-sm"><Send className="h-4 w-4" />Send test text</button>
      {s.recent?.length > 0 && <ol className="mt-4 space-y-1 border-t border-sky-100 pt-3 text-xs" data-testid="sms-recent">{s.recent.slice(0, 8).map((r) => <li key={r.id} className="flex justify-between gap-3"><span>{r.kind.replace(/_/g, " ")} · {r.toMasked}</span><span className="text-nb-mute">{r.status}</span></li>)}</ol>}
    </section>
  );
}

export default function Channels() {
  return (
    <div className="mx-auto max-w-4xl space-y-6" data-testid="channels-page">
      <PageHeader eyebrow="Settings" title="Email & text messages" sub="Readiness for client and practitioner messages. Both stay off until you approve them." />
      <Notice testid="channels-safety-note">While a test inbox or test phone is set, every message goes only there. Texts go only to clients who opted in, and STOP replies are honoured.</Notice>
      <div className="grid gap-4 md:grid-cols-2"><EmailCard /><SmsCard /></div>
    </div>
  );
}
