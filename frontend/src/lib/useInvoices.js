import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/api";

export const newKey = (prefix) => `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;

export function useInvoices(params, enabled = true, live = false) {
  const [rows, setRows] = useState(undefined);
  const [error, setError] = useState("");
  const query = JSON.stringify(params || {});
  const load = useCallback(async () => {
    setError("");
    if (!enabled) { setRows(undefined); return; }
    try {
      const page = await api.invoices({ limit: 100, ...JSON.parse(query) });
      setRows(page.items);
    } catch {
      setError("Invoices could not be loaded. Please try again.");
      setRows([]);
    }
  }, [query, enabled]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    if (!live || !enabled) return undefined;
    const quiet = () => { if (document.visibilityState === "visible") api.invoices({ limit: 100, ...JSON.parse(query) }).then((p) => setRows(p.items)).catch(() => {}); };
    const timer = setInterval(quiet, 15000);
    window.addEventListener("focus", quiet);
    return () => { clearInterval(timer); window.removeEventListener("focus", quiet); };
  }, [live, enabled, query]);
  const replace = (next) => setRows((prev) => (prev || []).map((row) => (row.id === next.id ? next : row)));
  return { rows, error, reload: load, replace };
}

export function sumInvoices(rows) {
  const live = (rows || []).filter((r) => r.state !== "voided" && r.state !== "draft");
  const add = (key) => live.reduce((acc, r) => acc + (r[key]?.cents || 0), 0);
  return {
    count: live.length,
    total: add("total"),
    clientPaid: add("clientPaid"),
    insuranceReceived: add("insuranceReceived"),
    insurancePending: add("expectedInsurance"),
    approved: add("approved"),
    balance: add("balance"),
    open: live.filter((r) => (r.balance?.cents || 0) > 0).length,
  };
}

export async function downloadFile(path, filename) {
  const url = await api.mediaBlob(path);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

export const downloadInvoicePdf = (invoice) => downloadFile(`/invoices/${invoice.id}/pdf`, `${invoice.number || "invoice"}.pdf`);
export const downloadReceiptPdf = (invoice) => downloadFile(`/invoices/${invoice.id}/receipt`, `receipt-${invoice.number || invoice.id}.pdf`);
