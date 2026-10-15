import { Area, AreaChart, Bar, BarChart, ResponsiveContainer, Tooltip, XAxis, Cell } from "recharts";
import { money0 } from "@/lib/domain";

const Tip = ({ active, payload, label }) =>
  active && payload?.length ? (
    <div className="rounded-2xl bg-nb-ink text-white px-3 py-2 text-xs shadow-xl">
      <p className="font-semibold mb-1">{label}</p>
      {payload.map((p) => (
        <p key={p.dataKey} className="flex items-center gap-1.5 nb-num"><span className="h-2 w-2 rounded-full" style={{ background: p.color }} />{p.name}: {money0(p.value)}</p>
      ))}
    </div>
  ) : null;

export function TrendChart({ data, onPick, height = 210 }) {
  return (
    <div data-testid="trend-chart" style={{ height }}>
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data} margin={{ top: 10, right: 6, left: 6, bottom: 0 }} onClick={(e) => e?.activeLabel && onPick?.(data.find((d) => d.label === e.activeLabel))}>
          <defs>
            <linearGradient id="gBooked" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#14D8C4" stopOpacity={0.35} /><stop offset="100%" stopColor="#14D8C4" stopOpacity={0} /></linearGradient>
            <linearGradient id="gColl" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#1565F0" stopOpacity={0.25} /><stop offset="100%" stopColor="#1565F0" stopOpacity={0} /></linearGradient>
          </defs>
          <XAxis dataKey="label" axisLine={false} tickLine={false} tick={{ fontSize: 11, fill: "#4A5A7A" }} interval="preserveStartEnd" />
          <Tooltip content={<Tip />} cursor={{ stroke: "#1565F0", strokeDasharray: "4 4" }} />
          <Area type="monotone" dataKey="booked" name="Booked" stroke="#0E9E9A" strokeWidth={2.5} fill="url(#gBooked)" activeDot={{ r: 5, strokeWidth: 3, stroke: "#fff" }} animationDuration={700} />
          <Area type="monotone" dataKey="collected" name="Collected" stroke="#1565F0" strokeWidth={2.5} fill="url(#gColl)" activeDot={{ r: 5, strokeWidth: 3, stroke: "#fff" }} animationDuration={900} />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

export function Sparkline({ data, dataKey = "booked", height = 48 }) {
  return (
    <div style={{ height }}>
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data} margin={{ top: 4, right: 0, left: 0, bottom: 0 }}>
          <defs><linearGradient id="gSpark" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#fff" stopOpacity={0.45} /><stop offset="100%" stopColor="#fff" stopOpacity={0} /></linearGradient></defs>
          <Area type="monotone" dataKey={dataKey} stroke="#fff" strokeWidth={2} fill="url(#gSpark)" isAnimationActive animationDuration={900} />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

export function PractitionerBars({ data, onPick }) {
  return (
    <div data-testid="practitioner-bars" style={{ height: 170 }}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 8, right: 0, left: 0, bottom: 0 }} onClick={(e) => e?.activeLabel && onPick?.(data.find((d) => d.label === e.activeLabel))}>
          <XAxis dataKey="label" axisLine={false} tickLine={false} tick={{ fontSize: 11, fill: "#4A5A7A" }} />
          <Tooltip content={<Tip />} cursor={{ fill: "#E8F6FE", radius: 12 }} />
          <Bar dataKey="value" name="Booked" radius={[12, 12, 12, 12]} barSize={28} animationDuration={700}>
            {data.map((d) => <Cell key={d.label} fill={d.color} />)}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
