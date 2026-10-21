import { useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Download, Share, X, MoreVertical } from "lucide-react";
import { Logo } from "@/components/brand";
import { useInstallPrompt, isStandalone, isIOS } from "@/lib/install";

const KEY = "nt_install_card_dismissed";

/** @param {{ collapsible?: boolean }} props — collapsible keeps first-viewport CTAs free on confirmation screens. */
export function InstallCard({ collapsible = false }) {
  const { canPrompt, install } = useInstallPrompt();
  const [hidden, setHidden] = useState(() => isStandalone() || localStorage.getItem(KEY) === "1");
  const [done, setDone] = useState(false);
  const [open, setOpen] = useState(!collapsible);
  const dismiss = () => { localStorage.setItem(KEY, "1"); setHidden(true); };
  const add = async () => { if (await install()) { setDone(true); localStorage.setItem(KEY, "1"); } };

  if (hidden) return null;

  const body = (
    <>
      <div className="flex items-center gap-3 pr-6">
        <span className="nb-breathe flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-white shadow-sm"><Logo variant="emblem" className="h-8 w-auto" /></span>
        <div>
          <p className="text-sm font-semibold text-nb-ink">{done ? "Nabitouch is on your home screen" : "Add Nabitouch to your home screen"}</p>
          <p className="text-xs text-nb-mute">{done ? "Open it anytime to follow your visit and rebook in a tap." : "Follow your visit and rebook in one tap — no app store."}</p>
        </div>
      </div>
      {!done && (canPrompt ? (
        <button type="button" onClick={add} data-testid="install-card-add-btn" className="nb-btn-primary mt-3 h-10 w-full text-sm"><Download className="h-4 w-4" />Add to home screen</button>
      ) : (
        <p className="mt-3 flex items-center gap-2 rounded-2xl bg-white/80 p-3 text-xs text-nb-ink" data-testid="install-card-instructions">
          {isIOS() ? <>Tap <Share className="h-4 w-4 text-nb-blue" /> <b>Share</b>, then <b>Add to Home Screen</b>.</> : <>Open your browser menu <MoreVertical className="h-4 w-4 text-nb-blue" /> and choose <b>Install app</b> or <b>Add to Home screen</b>.</>}
        </p>
      ))}
      {!done && <button type="button" onClick={dismiss} data-testid="install-card-later-btn" className="mt-2 w-full text-center text-xs font-medium text-nb-mute">Maybe later</button>}
    </>
  );

  if (collapsible) {
    return (
      <div className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-sky-50 to-teal-50 p-3 text-left ring-1 ring-sky-100" data-testid="install-prompt-card">
        <button type="button" onClick={dismiss} aria-label="Dismiss" data-testid="install-card-dismiss-btn" className="absolute right-2 top-2 rounded-full p-1.5 text-nb-mute hover:bg-white"><X className="h-4 w-4" /></button>
        <button
          type="button"
          className="flex w-full items-center justify-between gap-2 pr-8 text-left text-sm font-semibold text-nb-ink"
          data-testid="install-card-toggle"
          aria-expanded={open}
          onClick={() => setOpen((v) => !v)}
        >
          Add to home screen
          <span className="text-xs font-medium text-nb-mute">{open ? "Hide" : "Show"}</span>
        </button>
        {open ? <div className="mt-3">{body}</div> : (
          <p className="mt-1 pr-8 text-xs text-nb-mute">Optional — install after you open your visit.</p>
        )}
      </div>
    );
  }

  return (
    <AnimatePresence>
      <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 8 }} transition={{ delay: 0.35, duration: 0.35 }}
        className="relative mt-4 overflow-hidden rounded-3xl bg-gradient-to-br from-sky-50 to-teal-50 p-4 text-left ring-1 ring-sky-100" data-testid="install-prompt-card">
        <button type="button" onClick={dismiss} aria-label="Dismiss" data-testid="install-card-dismiss-btn" className="absolute right-3 top-3 rounded-full p-1.5 text-nb-mute hover:bg-white"><X className="h-4 w-4" /></button>
        {body}
      </motion.div>
    </AnimatePresence>
  );
}
