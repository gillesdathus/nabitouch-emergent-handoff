import { Sparkles } from "lucide-react";
import { motion } from "framer-motion";
import { Breathing } from "@/components/brand";
import { Avatar } from "@/components/ui-kit";

export function ArrivalMoment({ appt, practitioner, service }) {
  const tips = (service?.prep || []).slice(0, 3);
  const first = practitioner?.name?.split(" ")[0] || "Your practitioner";
  return (
    <motion.section initial={{ opacity: 0, y: 16, scale: 0.98 }} animate={{ opacity: 1, y: 0, scale: 1 }} transition={{ duration: 0.7, ease: [0.22, 1, 0.36, 1] }}
      className="relative overflow-hidden rounded-[32px] p-6 text-white nb-lagoon shadow-[0_28px_70px_-28px_rgba(11,46,138,0.65)] sm:p-8" data-testid="arrival-moment" aria-live="polite">
      <Breathing leaves className="opacity-70" />
      <div className="relative">
        <div className="flex items-center gap-4">
          <motion.div animate={{ scale: [1, 1.06, 1] }} transition={{ duration: 4, repeat: Infinity, ease: "easeInOut" }} className="rounded-full ring-4 ring-white/25">
            <Avatar person={practitioner} photo={practitioner?.photo} size={64} />
          </motion.div>
          <div>
            <p className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.2em] text-cyan-100"><Sparkles className="h-3.5 w-3.5" />Welcome</p>
            <h2 className="mt-1 text-2xl font-semibold sm:text-3xl" data-testid="arrival-title">{first} has arrived</h2>
            <p className="text-sm text-white/80">{service?.name ? `${service.name} · ${appt.duration} min` : "Your visit is about to begin"}</p>
          </div>
        </div>
        <p className="mt-6 font-display text-xl italic text-white/90">Take a slow breath in… and out. We'll take it from here.</p>
        {tips.length > 0 && (
          <ul className="mt-5 grid gap-2 sm:grid-cols-3" data-testid="arrival-tips">
            {tips.map((t, i) => (
              <motion.li key={t} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.3 + i * 0.12 }} className="rounded-2xl bg-white/12 p-3.5 text-sm leading-snug backdrop-blur-md ring-1 ring-white/15" data-testid={`arrival-tip-${i}`}>{t}</motion.li>
            ))}
          </ul>
        )}
      </div>
    </motion.section>
  );
}
