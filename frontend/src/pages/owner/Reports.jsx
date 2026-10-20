import { useState } from "react";
import { useSearchParams } from "react-router-dom";
import { Layers, BadgeDollarSign, Banknote, Clock4, Gift, HeartHandshake, ShieldCheck, Sparkles, Undo2, Users } from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { PayRules } from "@/components/reports/PayRules";
import { Statements } from "@/components/reports/Statements";
import { PageHeader } from "@/components/ds";
import { DownloadButtons, RangePicker, ReportBody, presetRange, useReport } from "@/components/reports/ReportView";
import { useDemo } from "@/store/DemoStore";

const KINDS = [
  ["revenue", "Revenue", BadgeDollarSign, "tint-lagoon"],
  ["collections", "Collections", Banknote, "tint-mint"],
  ["outstanding", "Outstanding", Clock4, "tint-ice"],
  ["insurance", "Insurance", ShieldCheck, "tint-lagoon"],
  ["giftcards", "Gift-card liability", Gift, "tint-meadow"],
  ["earnings", "Practitioner earnings", Users, "tint-mint"],
  ["retention", "Client retention", HeartHandshake, "tint-lagoon"],
  ["services", "Service performance", Sparkles, "tint-ice"],
  ["refunds", "Refunds & discounts", Undo2, "tint-meadow"],
  ["plans", "Wellness plans", Layers, "tint-mint"],
];

export default function Reports() {
  const { state } = useDemo();
  const [params] = useSearchParams();
  const [kind, setKind] = useState(KINDS.some(([k]) => k === params.get("kind")) ? params.get("kind") : "revenue");
  const [range, setRange] = useState(presetRange("month"));
  const [pid, setPid] = useState("");
  const report = useReport(kind, range, ["giftcards", "plans"].includes(kind) ? "" : pid);
  const people = state.practitioners || [];
  const byPerson = !["giftcards", "plans"].includes(kind);
  const current = KINDS.find(([k]) => k === kind);
  return (
    <div className="min-w-0 space-y-5" data-testid="owner-reports-page">
      <PageHeader eyebrow="Reports" title="Financial" accent="reports" description="Built from issued invoices and confirmed ledger entries. Download a branded PDF or CSV for the selected filters." />
      <Tabs defaultValue="reports">
        <TabsList className="mb-5 h-11 rounded-full bg-white p-1 ring-1 ring-sky-100" data-testid="reports-tabs">
          <TabsTrigger value="reports" className="rounded-full px-5 data-[state=active]:bg-nb-navy data-[state=active]:text-white" data-testid="reports-tab-reports">Reports</TabsTrigger>
          <TabsTrigger value="pay" className="rounded-full px-5 data-[state=active]:bg-nb-navy data-[state=active]:text-white" data-testid="reports-tab-pay">Practitioner pay</TabsTrigger>
        </TabsList>
        <TabsContent value="pay" className="grid gap-6 lg:grid-cols-[1.3fr_1fr]">
          <Statements practitioners={people} />
          <PayRules practitioners={people} />
        </TabsContent>
        <TabsContent value="reports" className="min-w-0 space-y-4">
          <label className="block md:hidden"><span className="sr-only">Report</span>
            <select value={kind} onChange={(e) => setKind(e.target.value)} className="nb-input h-11 font-semibold" data-testid="report-kind-select">{KINDS.map(([k, label]) => <option key={k} value={k}>{label}</option>)}</select>
          </label>
          <div className="-mx-1 hidden gap-2 overflow-x-auto px-1 pb-1 md:flex" data-testid="report-kinds">
            {KINDS.map(([k, label, Icon, tint]) => (
              <button key={k} type="button" aria-pressed={kind === k} onClick={() => setKind(k)} data-testid={`report-kind-${k}`} className={`flex shrink-0 items-center gap-2 rounded-2xl px-3.5 py-2.5 text-sm font-medium ring-1 transition-colors duration-200 ${kind === k ? "bg-nb-navy text-white ring-nb-navy" : "bg-white ring-sky-100 hover:ring-sky-300"}`}>
                <span className={`grid h-7 w-7 place-items-center rounded-xl ${kind === k ? "bg-white/15" : tint}`}><Icon className={`h-4 w-4 ${kind === k ? "text-white" : "text-nb-blue"}`} /></span>{label}
              </button>
            ))}
          </div>
          <div className="nb-panel space-y-3 p-4" data-testid="report-filters">
            <RangePicker range={range} setRange={setRange} />
            {byPerson && (
              <div className="flex min-w-0 gap-1.5 overflow-x-auto pb-1 no-scrollbar" role="group" aria-label="Practitioner" data-testid="report-practitioner">
                {[["", "All practitioners"], ...people.map((p) => [p.id, p.name])].map(([id, name]) => <button key={id || "all"} type="button" aria-pressed={pid === id} onClick={() => setPid(id)} className={`h-8 shrink-0 rounded-full px-3 text-xs font-semibold ring-1 ${pid === id ? "bg-nb-ink text-white ring-nb-ink" : "bg-white ring-sky-100"}`} data-testid={`report-practitioner-${id || "all"}`}>{name}</button>)}
              </div>
            )}
            <div className="flex flex-wrap items-center justify-between gap-2 border-t border-sky-50 pt-3">
              <p className="min-w-0 text-xs text-nb-mute" data-testid="report-filter-summary"><b className="text-nb-ink">{current?.[1]}</b> · {range[0]} to {range[1]}{byPerson ? ` · ${pid ? people.find((p) => p.id === pid)?.name : "All practitioners"}` : ""}</p>
              <DownloadButtons kind={kind} params={report.params} />
            </div>
          </div>
          <ReportBody report={report} />
        </TabsContent>
      </Tabs>
    </div>
  );
}
