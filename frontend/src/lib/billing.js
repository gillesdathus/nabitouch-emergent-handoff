/** Display server cents. Balances are never recomputed from dollar floats. */
export function formatCents(cents) {
  const amount = Number(cents);
  if (!Number.isInteger(amount)) return "";
  const sign = amount < 0 ? "-" : "";
  const absolute = Math.abs(amount);
  return `${sign}$${Math.floor(absolute / 100).toLocaleString("en-CA")}.${String(absolute % 100).padStart(2, "0")}`;
}

export function dollarsToCents(text) {
  const match = /^(\d+)(?:\.(\d{1,2}))?$/.exec(String(text || "").trim());
  if (!match) return null;
  return Number(match[1]) * 100 + Number((match[2] || "").padEnd(2, "0"));
}

export function billingBars(invoice) {
  const total = invoice?.total?.cents;
  if (!Number.isInteger(total) || total <= 0) return { received: 0, expected: 0 };
  const received = Number.isInteger(invoice.received?.cents) ? invoice.received.cents : 0;
  const expected = Number.isInteger(invoice.expectedInsurance?.cents) ? invoice.expectedInsurance.cents : 0;
  return {
    received: Math.min(100, Math.floor((received * 100) / total)),
    expected: Math.min(100, Math.floor(((received + expected) * 100) / total)),
  };
}

export function payableNowCents(appt, invoice) {
  if (Number.isInteger(invoice?.payableNow?.cents)) return Math.max(0, invoice.payableNow.cents);
  const balance = invoice?.balance?.cents;
  if (!Number.isInteger(balance) || balance <= 0) return 0;
  const received = Number.isInteger(invoice?.received?.cents) ? invoice.received.cents : 0;
  const dueNow = appt?.paymentDue?.dueNowCents;
  if (received <= 0 && (appt?.payNow === "deposit" || appt?.payNow === "full") && Number.isInteger(dueNow) && dueNow > 0 && dueNow <= balance) return dueNow;
  return balance;
}

export function invoiceFacts(invoice) {
  if (!invoice) return null;
  return {
    total: invoice.total?.display || formatCents(invoice.total?.cents),
    balance: invoice.balance?.display || formatCents(invoice.balance?.cents),
    state: invoice.state,
    number: invoice.number,
  };
}
