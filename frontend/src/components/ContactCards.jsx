import { motion } from "framer-motion";
import { ArrowUpRight, Mail, Phone } from "lucide-react";

export const WhatsApp = ({ className }) => (
  <svg viewBox="0 0 24 24" className={className} fill="currentColor" aria-hidden>
    <path d="M17.47 14.38c-.3-.15-1.75-.86-2.02-.96-.27-.1-.47-.15-.67.15-.2.3-.77.96-.94 1.16-.17.2-.35.22-.64.07-.3-.15-1.25-.46-2.38-1.47-.88-.78-1.47-1.75-1.65-2.05-.17-.3-.02-.46.13-.6.13-.13.3-.35.45-.52.15-.17.2-.3.3-.5.1-.2.05-.37-.03-.52-.07-.15-.67-1.6-.92-2.2-.24-.58-.49-.5-.67-.5h-.57c-.2 0-.52.07-.8.37-.27.3-1.04 1.02-1.04 2.48s1.07 2.88 1.21 3.08c.15.2 2.1 3.2 5.08 4.49.71.3 1.26.49 1.7.63.71.22 1.36.19 1.87.12.57-.09 1.75-.72 2-1.41.25-.7.25-1.29.17-1.41-.07-.13-.27-.2-.57-.35M12.04 21.5h-.01a9.4 9.4 0 0 1-4.8-1.32l-.34-.2-3.57.94.95-3.48-.22-.36a9.43 9.43 0 0 1-1.45-5.03c0-5.2 4.24-9.44 9.45-9.44a9.38 9.38 0 0 1 6.68 2.77 9.38 9.38 0 0 1 2.76 6.68c0 5.2-4.24 9.44-9.45 9.44m8.04-17.48A11.3 11.3 0 0 0 12.04.7C5.77.7.67 5.8.67 12.07c0 2 .52 3.96 1.52 5.68L.57 23.3l5.68-1.49a11.36 11.36 0 0 0 5.79 1.47h.01c6.27 0 11.37-5.1 11.37-11.37 0-3.04-1.18-5.9-3.34-8.05" />
  </svg>
);

function ContactCard({ href, icon: Icon, label, value, note, glow, iconBg, testid, external, i }) {
  return (
    <motion.a href={href} target={external ? "_blank" : undefined} rel={external ? "noopener noreferrer" : undefined} data-testid={testid}
      initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.08 * i, duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
      className="group relative block overflow-hidden rounded-[28px] bg-white/80 p-5 ring-1 ring-sky-100 backdrop-blur-xl transition-[transform,box-shadow] duration-300 hover:-translate-y-1 hover:shadow-[0_24px_50px_-28px_rgba(11,46,138,0.45)]">
      <span className="pointer-events-none absolute -right-12 -top-12 h-36 w-36 rounded-full opacity-40 blur-2xl transition-opacity duration-500 group-hover:opacity-70" style={{ background: glow }} />
      <span className="relative flex items-start gap-4">
        <span className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl text-white shadow-lg" style={{ background: iconBg }}><Icon className="h-5 w-5" /></span>
        <span className="min-w-0 flex-1">
          <span className="block text-[11px] font-semibold uppercase tracking-[0.18em] text-nb-mute">{label}</span>
          <span className="mt-1 block truncate text-lg font-semibold text-nb-ink">{value}</span>
          <span className="mt-0.5 block text-xs text-nb-mute">{note}</span>
        </span>
        <ArrowUpRight className="relative h-4 w-4 text-sky-300 transition-transform duration-300 group-hover:-translate-y-0.5 group-hover:translate-x-0.5 group-hover:text-nb-blue" />
      </span>
    </motion.a>
  );
}

export function ContactCards({ phoneDisplay, phoneTel, email }) {
  const digits = phoneTel.replace(/[^0-9]/g, "");
  const cards = [
    { href: `tel:${phoneTel}`, icon: Phone, label: "Call us", value: phoneDisplay, note: "Speak with the Nabitouch team", glow: "#1565F0", iconBg: "linear-gradient(135deg,#0B2E8A,#1565F0)", testid: "contact-phone" },
    { href: `https://wa.me/${digits}`, icon: WhatsApp, label: "WhatsApp", value: phoneDisplay, note: "Message us anytime, we reply as soon as we can", glow: "#25D366", iconBg: "linear-gradient(135deg,#0E9E9A,#25D366)", testid: "contact-whatsapp", external: true },
    { href: `mailto:${email}`, icon: Mail, label: "Email", value: email, note: "For questions, invoices and gift cards", glow: "#14D8C4", iconBg: "linear-gradient(135deg,#1565F0,#12C9EF 60%,#14D8C4)", testid: "contact-email" },
  ];
  return <div className="grid gap-3" data-testid="contact-cards">{cards.map((c, i) => <ContactCard key={c.testid} {...c} i={i} />)}</div>;
}

export function WhatsAppFab({ phone = "+17802356508" }) {
  return (
    <motion.a href={`https://wa.me/${phone.replace(/[^0-9]/g, "")}`} target="_blank" rel="noopener noreferrer" aria-label="Chat with Nabitouch on WhatsApp" data-testid="whatsapp-fab"
      initial={{ opacity: 0, scale: 0.6, y: 20 }} animate={{ opacity: 1, scale: 1, y: 0 }} transition={{ delay: 0.8, type: "spring", stiffness: 260, damping: 20 }}
      className="group fixed bottom-28 right-4 z-40 flex items-center gap-2 lg:bottom-8 lg:right-8">
      <span className="pointer-events-none hidden translate-x-2 rounded-full bg-white/90 px-3.5 py-2 text-sm font-medium text-nb-ink opacity-0 shadow-lg ring-1 ring-sky-100 backdrop-blur transition-[opacity,transform] duration-300 group-hover:translate-x-0 group-hover:opacity-100 lg:block">Chat with us</span>
      <span className="relative grid h-14 w-14 place-items-center rounded-full text-white shadow-[0_14px_30px_-10px_rgba(14,158,154,0.7)] transition-transform duration-300 group-hover:scale-105" style={{ background: "linear-gradient(135deg,#0E9E9A,#25D366)" }}>
        <span className="absolute inset-0 animate-ping rounded-full bg-[#25D366] opacity-20 [animation-duration:2.6s]" />
        <WhatsApp className="relative h-7 w-7" />
      </span>
    </motion.a>
  );
}
