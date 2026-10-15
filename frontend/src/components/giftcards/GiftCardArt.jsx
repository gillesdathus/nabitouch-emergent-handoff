import { motion } from "framer-motion";

const DESIGNS = {
  lagoon: { bg: "linear-gradient(135deg,#0B2E8A 0%,#1565F0 45%,#12C9EF 80%,#14D8C4 100%)", glow: "#14D8C4", name: "Lagoon" },
  tide: { bg: "linear-gradient(140deg,#071B52 0%,#0B2E8A 50%,#1565F0 100%)", glow: "#12C9EF", name: "Tide" },
  meadow: { bg: "linear-gradient(135deg,#0E9E9A 0%,#14D8C4 50%,#7BC74D 100%)", glow: "#E8F7D9", name: "Meadow" },
  coral: { bg: "linear-gradient(135deg,#0B2E8A 0%,#7A4FD6 50%,#FF8A7A 100%)", glow: "#FFD3C9", name: "Coral" },
};

export const giftDesign = (key) => DESIGNS[key] || DESIGNS.lagoon;
export const GIFT_DESIGNS = Object.keys(DESIGNS);

function Waves() {
  return (
    <svg className="absolute inset-x-0 bottom-0 h-1/2 w-full opacity-30" viewBox="0 0 400 120" preserveAspectRatio="none" aria-hidden>
      <path d="M0 60 C 80 20, 160 100, 240 60 S 360 30, 400 50 L400 120 L0 120 Z" fill="white" fillOpacity="0.35" />
      <path d="M0 85 C 90 55, 170 115, 260 80 S 370 60, 400 75 L400 120 L0 120 Z" fill="white" fillOpacity="0.5" />
    </svg>
  );
}

export function GiftCardArt({ card, design, amount, recipient, compact, testid, onClick }) {
  const d = giftDesign(design || card?.design);
  const Tag = onClick ? motion.button : motion.div;
  return (
    <Tag type={onClick ? "button" : undefined} onClick={onClick} data-testid={testid} whileHover={onClick ? { y: -4, rotate: -0.6 } : undefined} transition={{ type: "spring", stiffness: 300, damping: 22 }}
      className={`relative block w-full overflow-hidden text-left text-white shadow-[0_18px_40px_-18px_rgba(11,46,138,0.55)] ${compact ? "aspect-[1.7] rounded-2xl" : "aspect-[1.6] rounded-[28px]"}`} style={{ background: d.bg }}>
      <span className="absolute -right-10 -top-12 h-40 w-40 rounded-full blur-2xl" style={{ background: d.glow, opacity: 0.45 }} />
      <Waves />
      <span className={`relative flex h-full flex-col justify-between ${compact ? "p-3.5" : "p-5"}`}>
        <span className="flex items-start justify-between">
          <span>
            <img src="/brand/emblem.png" alt="" className={compact ? "h-6 w-6" : "h-9 w-9"} />
            {!compact && <span className="mt-1 block text-[10px] uppercase tracking-[0.2em] text-white/80">Gift card</span>}
          </span>
          {card?.status && card.status !== "active" && <span className="rounded-full bg-white/20 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wider backdrop-blur" data-testid={testid ? `${testid}-status` : undefined}>{card.status.replace("_", " ")}</span>}
        </span>
        <span>
          <span className={`nb-num block font-semibold ${compact ? "text-xl" : "text-3xl"}`}>{card ? card.balance.display : amount}</span>
          {card && <span className="block text-[11px] text-white/75">of {card.amount.display}</span>}
          <span className={`mt-1 flex items-end justify-between gap-2 ${compact ? "text-[10px]" : "text-xs"}`}>
            <span className="truncate text-white/85">{recipient || card?.recipientName ? `For ${recipient || card.recipientName}` : "Nabitouch"}</span>
            {card && <span className="font-mono tracking-wider text-white/90">{card.code}</span>}
          </span>
        </span>
      </span>
    </Tag>
  );
}
