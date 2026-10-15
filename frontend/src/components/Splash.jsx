import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Logo, Breathing } from "@/components/brand";

const isStandalone = () => window.matchMedia?.("(display-mode: standalone)").matches || window.navigator.standalone === true;
const KEY = "nt_splash_seen";

// Shown once per session when launched from the home screen (or preview with ?splash=1).
export function Splash() {
  const [show, setShow] = useState(() => {
    const forced = new URLSearchParams(window.location.search).get("splash") === "1";
    return forced || (isStandalone() && !sessionStorage.getItem(KEY));
  });
  useEffect(() => {
    if (!show) return;
    sessionStorage.setItem(KEY, "1");
    const t = setTimeout(() => setShow(false), 2200);
    return () => clearTimeout(t);
  }, [show]);

  return (
    <AnimatePresence>
      {show && (
        <motion.div key="splash" initial={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.5 }} onClick={() => setShow(false)}
          className="fixed inset-0 z-[100] flex flex-col items-center justify-center bg-[#F5FBFC]" data-testid="brand-splash" role="status" aria-label="Nabitouch is loading">
          <Breathing />
          <motion.div initial={{ scale: 0.9, opacity: 0 }} animate={{ scale: [0.96, 1.04, 0.96], opacity: 1 }} transition={{ opacity: { duration: 0.5 }, scale: { duration: 4, repeat: Infinity, ease: "easeInOut" } }} className="relative">
            <span className="nb-breathe absolute inset-[-30%] rounded-full bg-[radial-gradient(circle,#14D8C440,transparent_65%)]" aria-hidden="true" />
            <Logo variant="full" className="relative h-auto w-64 max-w-[70vw]" />
          </motion.div>
          <motion.p initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.5, duration: 0.6 }} className="relative mt-8 font-display text-lg italic text-nb-navy" data-testid="brand-splash-tagline">
            Breathe. Feel. Heal. Anywhere.
          </motion.p>
          <p className="absolute bottom-10 text-xs text-nb-mute">Tap to continue</p>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
