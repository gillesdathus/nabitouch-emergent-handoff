import { useState } from "react";
import { CalendarDays } from "lucide-react";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

const toIso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const fromIso = (s) => (s ? new Date(`${s}T12:00:00`) : undefined);
const label = (s) => (s ? fromIso(s).toLocaleDateString("en-CA", { month: "short", day: "numeric", year: "numeric" }) : "Pick a date");

export function DateField({ value, onChange, testid, min, max, className = "" }) {
  const [open, setOpen] = useState(false);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button type="button" data-testid={testid} data-value={value || ""} className={`nb-input inline-flex h-9 w-auto items-center gap-2 text-xs transition-colors hover:border-nb-sky ${className}`}>
          <CalendarDays className="h-3.5 w-3.5 text-nb-teal" />{label(value)}
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-auto rounded-3xl border-sky-100 p-2 shadow-[0_24px_60px_-30px_rgba(11,27,63,.45)]">
        <Calendar mode="single" selected={fromIso(value)} defaultMonth={fromIso(value)} onSelect={(d) => { if (d) { onChange(toIso(d)); setOpen(false); } }}
          disabled={(d) => (min && toIso(d) < min) || (max && toIso(d) > max)} data-testid={`${testid}-calendar`} />
      </PopoverContent>
    </Popover>
  );
}
