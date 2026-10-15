import { BarChart, Bar, XAxis, Tooltip, ResponsiveContainer, PieChart, Pie, Cell } from "recharts";
import { SectionHead } from "@/components/ui-kit";
import { useDemo } from "@/store/DemoStore";
import { fmtStamp } from "@/lib/domain";

const COLORS = ["#0B2E8A", "#1565F0", "#12C9EF", "#14D8C4", "#7BC74D", "#0E9E9A"];

export default function Insights() {
  const { state, idx } = useDemo();
  const mix = Object.entries(state.appointments.reduce((m, a) => ({ ...m, [a.serviceSlug]: (m[a.serviceSlug] || 0) + 1 }), {})).map(([k, v]) => ({ name: idx.services[k].name, value: v }));
  const util = state.practitioners.map((p) => ({ name: p.name.split(" ")[0], hours: state.appointments.filter((a) => a.practitionerId === p.id && !["cancelled", "no_show"].includes(a.status)).reduce((s, a) => s + a.duration / 60, 0) }));
  return (
    <div className="space-y-8" data-testid="owner-insights">
      <SectionHead eyebrow="Analytics" title="Business insights" />
      <div className="grid gap-6 lg:grid-cols-2">
        <div className="nb-card p-5"><p className="mb-3 font-semibold">Service mix</p><div className="h-64"><ResponsiveContainer><PieChart><Pie data={mix} dataKey="value" nameKey="name" innerRadius={55} outerRadius={95} paddingAngle={3}>{mix.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}</Pie><Tooltip /></PieChart></ResponsiveContainer></div></div>
        <div className="nb-card p-5"><p className="mb-3 font-semibold">Booked hours by practitioner</p><div className="h-64"><ResponsiveContainer><BarChart data={util}><XAxis dataKey="name" axisLine={false} tickLine={false} /><Tooltip /><Bar dataKey="hours" radius={[10, 10, 0, 0]} fill="#14D8C4" /></BarChart></ResponsiveContainer></div></div>
      </div>
      <div className="nb-card p-5" data-testid="audit-timeline">
        <p className="mb-4 font-semibold">Audit & activity timeline</p>
        <ol className="relative space-y-3 pl-5 before:absolute before:left-[6px] before:top-1 before:bottom-1 before:w-px before:bg-sky-200">
          {state.audit.map((x) => <li key={x.id} className="relative text-sm"><span className="absolute -left-5 top-1.5 h-3 w-3 rounded-full bg-sky-300 ring-2 ring-white" /><span className="mr-3 text-xs tabular-nums text-nb-mute">{fmtStamp(x.at)}</span>{x.action}<span className="ml-2 text-xs text-nb-mute">— {x.actor}</span></li>)}
        </ol>
        <p className="mt-4 text-[11px] text-nb-mute">Recent activity recorded for the owner workspace.</p>
      </div>
    </div>
  );
}
