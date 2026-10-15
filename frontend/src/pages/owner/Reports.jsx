import { useState } from "react";
import { useSearchParams } from "react-router-dom";
import { Layers, BadgeDollarSign, Banknote, Clock4, Gift, HeartHandshake, ShieldCheck, Sparkles, Undo2, Users } from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { PayRules } from "@/components/reports/PayRules";
import { Statements } from "@/components/reports/Statements";
import { PageHeader } from "@/components/tide";
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
  return (
    <div className="mx-auto max-w-7xl px-5 py-8 nb-page" data-testid="owner-reports-page">
      <PageHeader eyebrow="Reports" title="Financial reports" sub="Branded PDF and CSV exports built from issued invoices and confirmed ledger entries." />
      <Tabs defaultValue="reports">
        <TabsList className="mb-6 h-11 rounded-full bg-white p-1 ring-1 ring-sky-100" data-testid="reports-tabs">
          <TabsTrigger value="reports" className="rounded-full px-5 data-[state=active]:bg-nb-navy data-[state=active]:text-white" data-testid="reports-tab-reports">Reports</TabsTrigger>
          <TabsTrigger value="pay" className="rounded-full px-5 data-[state=active]:bg-nb-navy data-[state=active]:text-white" data-testid="reports-tab-pay">Practitioner pay</TabsTrigger>
        </TabsList>
        <TabsContent value="pay" className="grid gap-6 lg:grid-cols-[1.3fr_1fr]">
          <Statements practitioners={state.practitioners || []} />
          <PayRules practitioners={state.practitioners || []} />
        </TabsContent>
        <TabsContent value="reports">
      <div className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-2" data-testid="report-kinds">
        {KINDS.map(([k, label, Icon, tint]) => (
          <button key={k} type="button" onClick={() => setKind(k)} data-testid={`report-kind-${k}`} className={`flex shrink-0 items-center gap-2.5 rounded-2xl px-4 py-3 text-sm font-medium ring-1 transition-[background-color,transform] duration-200 hover:-translate-y-0.5 ${kind === k ? "bg-nb-navy text-white ring-nb-navy" : "bg-white ring-sky-100"}`}>
            <span className={`grid h-8 w-8 place-items-center rounded-xl ${kind === k ? "bg-white/15" : tint}`}><Icon className={`h-4 w-4 ${kind === k ? "text-white" : "text-nb-blue"}`} /></span>{label}
          </button>
        ))}
      </div>
      <div className="my-5 flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <RangePicker range={range} setRange={setRange} />
          {!["giftcards", "plans"].includes(kind) && <select value={pid} onChange={(e) => setPid(e.target.value)} className="nb-input h-9 w-auto text-xs" data-testid="report-practitioner"><option value="">All practitioners</option>{(state.practitioners || []).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select>}
        </div>
        <DownloadButtons kind={kind} params={report.params} />
      </div>
      <ReportBody report={report} />
        </TabsContent>
      </Tabs>
    </div>
  );
}
