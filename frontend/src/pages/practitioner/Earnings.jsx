import { useEffect, useState } from "react";
import { StatementRow } from "@/components/reports/Statements";
import { api } from "@/lib/api";
import { Wallet } from "lucide-react";
import { Notice, PageHeader } from "@/components/tide";
import { Breathing } from "@/components/brand";
import { DownloadButtons, RangePicker, ReportBody, presetRange, useReport } from "@/components/reports/ReportView";
import { useDemo } from "@/store/DemoStore";

const PRO_PRESETS = [["half", "This pay period"], ["month", "This month"], ["last_month", "Last month"], ["ytd", "Year to date"]];

export default function Earnings() {
  const { me } = useDemo();
  const [range, setRange] = useState(presetRange("half"));
  const report = useReport("earnings", range, "");
  const lead = report.data?.kpis?.[0];
  const [statements, setStatements] = useState(undefined);
  useEffect(() => { api.statements().then(setStatements).catch(() => setStatements([])); }, []);
  return (
    <div className="mx-auto max-w-5xl px-5 py-8 nb-page" data-testid="pro-earnings-page">
      <PageHeader eyebrow="Earnings" title={`Your work${me?.name ? `, ${me.name.split(" ")[0]}` : ""}`} sub="Approved pay statements, plus a live estimate from your issued invoices and your pay rule." />
      <section className="relative mb-6 overflow-hidden rounded-[32px] p-6 text-white nb-lagoon" data-testid="earnings-hero">
        <Breathing leaves={false} className="opacity-60" />
        <div className="relative flex flex-wrap items-end justify-between gap-4">
          <div><p className="flex items-center gap-2 text-xs uppercase tracking-[0.18em] text-cyan-100"><Wallet className="h-4 w-4" />{range[0]} → {range[1]}</p><p className="nb-num mt-2 text-5xl font-semibold" data-testid="earnings-hero-value">{lead?.value ?? "—"}</p><p className="mt-1 text-sm text-white/75">{lead?.label || "Treatment revenue"}</p></div>
          <DownloadButtons kind="earnings" params={report.params} light />
        </div>
      </section>
      <section className="mb-8" data-testid="pro-statements">
        <h2 className="mb-3 text-lg font-semibold">Approved statements</h2>
        {statements === undefined && <div className="h-20 rounded-3xl nb-skeleton" />}
        {statements?.length === 0 && <p className="text-sm text-nb-mute" data-testid="pro-statements-empty">Your statements appear here as soon as Nabitouch approves them.</p>}
        <div className="space-y-2">{statements?.map((s) => <StatementRow key={s.id} s={s} />)}</div>
      </section>
      <h2 className="mb-3 text-lg font-semibold">Live estimate</h2>
      <div className="mb-5"><RangePicker range={range} setRange={setRange} presets={PRO_PRESETS} /></div>
      <ReportBody report={report} />
      <Notice className="mt-6" testid="earnings-note">This statement shows the revenue attributed to your visits. It is not a payroll or tax document; your compensation terms are set with Nabitouch.</Notice>
    </div>
  );
}
