import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/api";

const BILLABLE = ["completed", "processing", "closed", "confirmed", "en_route", "arrived", "in_session"];

export function useInvoices(appointments) {
  const [rows, setRows] = useState(undefined);
  const [error, setError] = useState("");
  const ids = appointments.filter((a) => BILLABLE.includes(a.status) || a.paymentStatus).map((a) => a.id).join(",");
  const load = useCallback(async () => {
    setError("");
    const list = ids ? ids.split(",") : [];
    const results = await Promise.all(list.map((id) => api.invoiceByAppointment(id).catch((e) => (e?.response?.status === 404 ? null : Promise.reject(e))))).catch((e) => { setError("Invoices could not be loaded. Please try again."); return null; });
    if (results) setRows(results.filter(Boolean).sort((a, b) => String(b.serviceDate || b.issueDate || "").localeCompare(String(a.serviceDate || a.issueDate || ""))));
    else setRows([]);
  }, [ids]);
  useEffect(() => { load(); }, [load]);
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

export async function downloadInvoicePdf(invoice) {
  const url = await api.mediaBlob(`/invoices/${invoice.id}/pdf`);
  const link = document.createElement("a");
  link.href = url;
  link.download = `${invoice.number || "invoice"}.pdf`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}
