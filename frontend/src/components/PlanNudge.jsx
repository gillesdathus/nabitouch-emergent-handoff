import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { AnimatePresence, motion } from "framer-motion";
import { Layers, X } from "lucide-react";
import { api } from "@/lib/api";

const SEEN = "nb.planNudge.dismissed";

export function PlanNudge() {
  const [nudge, setNudge] = useState(null);
  useEffect(() => {
    let live = true;
    api.planNudge().then((r) => { if (live && r.nudge && localStorage.getItem(SEEN) !== r.nudge.visitId) setNudge(r.nudge); }).catch(() => {});
    return () => { live = false; };
  }, []);
  const dismiss = () => { localStorage.setItem(SEEN, nudge.visitId); setNudge(null); };
  return (
    <AnimatePresence>
      {nudge && (
        <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }} className="relative overflow-hidden rounded-[28px] p-5 tint-mint ring-1 ring-teal-100" data-testid="plan-nudge">
          <span className="pointer-events-none absolute -right-8 -top-10 h-32 w-32 rounded-full bg-teal-200/25 nb-breathe" />
          <button type="button" onClick={dismiss} aria-label="Dismiss" data-testid="plan-nudge-dismiss" className="absolute right-3 top-3 grid h-8 w-8 place-items-center rounded-full text-nb-mute transition-colors hover:bg-white/70"><X className="h-4 w-4" /></button>
          <div className="flex items-start gap-3 pr-8">
            <span className="grid h-10 w-10 shrink-0 place-items-center rounded-2xl bg-white text-nb-teal"><Layers className="h-5 w-5" /></span>
            <div>
              <p className="text-sm font-semibold text-nb-navy" data-testid="plan-nudge-title">A {nudge.name} would have saved you {nudge.saving.display}</p>
              <p className="mt-1 text-xs text-nb-mute">That's {nudge.perVisitSaving.display} off each {nudge.serviceName} {nudge.duration} min visit, like your last one ({nudge.visitRef}). Credits work with any practitioner.</p>
              <Link to="/me/plans" data-testid="plan-nudge-link" className="nb-btn-primary mt-3 inline-flex h-10 px-5 text-sm">See wellness plans</Link>
            </div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
