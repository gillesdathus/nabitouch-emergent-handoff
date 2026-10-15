import { useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Download, Share, X, MoreVertical } from "lucide-react";
import { Logo } from "@/components/brand";
import { useInstallPrompt, isStandalone, isIOS } from "@/lib/install";

const KEY = "nt_install_card_dismissed";

export function InstallCard() {
  const { canPrompt, install } = useInstallPrompt();
  const [hidden, setHidden] = useState(() => isStandalone() || localStorage.getItem(KEY) === "1");
  const [done, setDone] = useState(false);
  const dismiss = () => { localStorage.setItem(KEY, "1"); setHidden(true); };
  const add = async () => { if (await install()) { setDone(true); localStorage.setItem(KEY, "1"); } };

  return (
    <AnimatePresence>
      {!hidden && (
        <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 8 }} transition={{ delay: 0.6, duration: 0.45 }}
          className="relative mt-8 overflow-hidden rounded-3xl bg-gradient-to-br from-sky-50 to-teal-50 p-5 text-left ring-1 ring-sky-100" data-testid="install-prompt-card">
          <button onClick={dismiss} aria-label="Dismiss" data-testid="install-card-dismiss-btn" className="absolute right-3 top-3 rounded-full p-1.5 text-nb-mute hover:bg-white"><X className="h-4 w-4" /></button>
          <div className="flex items-center gap-4 pr-6">
            <span className="nb-breathe flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-white shadow-sm"><Logo variant="emblem" className="h-10 w-auto" /></span>
            <div>
              <p className="font-semibold text-nb-ink">{done ? "Nabitouch is on your home screen" : "Add Nabitouch to your home screen"}</p>
              <p className="text-sm text-nb-mute">{done ? "Open it anytime to follow your visit and rebook in a tap." : "Follow your practitioner live and rebook in one tap, like an app, with no app store needed."}</p>
            </div>
          </div>
          {!done && (canPrompt ? (
            <button onClick={add} data-testid="install-card-add-btn" className="nb-btn-primary mt-4 h-11 w-full"><Download className="h-4 w-4" />Add to home screen</button>
          ) : (
            <p className="mt-4 flex items-center gap-2 rounded-2xl bg-white/80 p-3 text-xs text-nb-ink" data-testid="install-card-instructions">
              {isIOS() ? <>Tap <Share className="h-4 w-4 text-nb-blue" /> <b>Share</b>, then <b>Add to Home Screen</b>.</> : <>Open your browser menu <MoreVertical className="h-4 w-4 text-nb-blue" /> and choose <b>Install app</b> or <b>Add to Home screen</b>.</>}
            </p>
          ))}
          {!done && <button onClick={dismiss} data-testid="install-card-later-btn" className="mt-2 w-full text-center text-xs font-medium text-nb-mute">Maybe later</button>}
        </motion.div>
      )}
    </AnimatePresence>
  );
}
