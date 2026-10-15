import { Switch } from "@/components/ui/switch";
import { WhatsApp } from "@/components/ContactCards";

const PAGES = [["/contact", "Contact"], ["/", "Home"], ["/services", "Services"], ["/practitioners", "Therapists"], ["/offers", "Offers"], ["/track", "Visit tracking"]];

export function WhatsAppSettings({ settings, save }) {
  const wa = settings?.whatsapp || {};
  const pages = wa.pages || ["/contact"];
  const toggle = (path, on) => save({ whatsapp: { phone: wa.phone || "+17802356508", pages: on ? [...new Set([...pages, path])] : pages.filter((p) => p !== path) } }, `WhatsApp button ${on ? "shown" : "hidden"} on ${path}`);
  return (
    <div className="nb-card p-5 text-sm md:col-span-2" data-testid="settings-whatsapp">
      <div className="flex items-center gap-3">
        <span className="grid h-10 w-10 place-items-center rounded-2xl text-white" style={{ background: "linear-gradient(135deg,#0E9E9A,#25D366)" }}><WhatsApp className="h-5 w-5" /></span>
        <div><b>Floating WhatsApp button</b><p className="text-xs text-nb-mute">Number {wa.phone || "+17802356508"}. Choose the public pages where it appears.</p></div>
      </div>
      <div className="mt-4 grid gap-2 sm:grid-cols-3">
        {PAGES.map(([path, label]) => (
          <label key={path} className="flex items-center justify-between rounded-2xl bg-slate-50 px-3.5 py-2.5">
            <span>{label}</span>
            <Switch checked={pages.includes(path)} onCheckedChange={(v) => toggle(path, v)} data-testid={`settings-whatsapp-${path === "/" ? "home" : path.slice(1)}`} />
          </label>
        ))}
      </div>
    </div>
  );
}
