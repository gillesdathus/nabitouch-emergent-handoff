import { billingBars, dollarsToCents, formatCents, invoiceFacts, patientShareCents, payableNowCents, STAFF_PAY_METHODS, usableClientEmail } from "./billing";

test("cents format without treating dollars as the source of truth", () => {
  expect(formatCents(12000)).toBe("$120.00");
  expect(formatCents(90)).toBe("$0.90");
  expect(formatCents(0)).toBe("$0.00");
  expect(formatCents(-250)).toBe("-$2.50");
  expect(formatCents(12.5)).toBe("");
});

test("dollar entry becomes integer cents", () => {
  expect(dollarsToCents("90")).toBe(9000);
  expect(dollarsToCents("60.5")).toBe(6050);
  expect(dollarsToCents("60.50")).toBe(6050);
  expect(dollarsToCents("12.5")).toBe(1250);
  expect(dollarsToCents("12.555")).toBe(null);
  expect(dollarsToCents("")).toBe(null);
});

test("expected coverage is drawn apart from money received", () => {
  expect(billingBars({
    total: { cents: 12000 },
    received: { cents: 6000 },
    expectedInsurance: { cents: 3000 },
  })).toEqual({ received: 50, expected: 75 });
  expect(billingBars({ total: { cents: 12000 }, received: { cents: 0 }, expectedInsurance: { cents: 9000 } }).received).toBe(0);
});

test("the displayed card amount is the saved deposit, then the remaining balance", () => {
  const invoice = { balance: { cents: 10080 }, received: { cents: 0 }, payableNow: { cents: 2520 } };
  expect(payableNowCents({ payNow: "deposit", paymentDue: { dueNowCents: 2520 } }, invoice)).toBe(2520);
  expect(payableNowCents({ payNow: "deposit", paymentDue: { dueNowCents: 2520 } }, { balance: { cents: 9080 }, received: { cents: 1000 } })).toBe(1520);
  expect(payableNowCents({ payNow: "deposit", paymentDue: { dueNowCents: 2520 } }, { balance: { cents: 7560 }, received: { cents: 2520 } })).toBe(7560);
  expect(payableNowCents({ payNow: "full", paymentDue: { dueNowCents: 10080 } }, { balance: { cents: 10080 }, received: { cents: 0 } })).toBe(10080);
  expect(payableNowCents({ payNow: "deposit", paymentDue: { dueNowCents: 2520 } }, { balance: { cents: 10080 }, received: { cents: 0 }, payableNow: { cents: 2520 } })).not.toBe(10080);
});

test("invoice facts come from the server view", () => {
  const facts = invoiceFacts({
    number: "NT-INV-00007",
    state: "partially_paid",
    total: { cents: 12000, display: "$120.00" },
    balance: { cents: 3000, display: "$30.00" },
  });
  expect(facts).toEqual({ total: "$120.00", balance: "$30.00", state: "partially_paid", number: "NT-INV-00007" });
});

test("staff pay methods stay the four primary collection paths", () => {
  expect(STAFF_PAY_METHODS).toEqual(["insurance", "stripe", "cash", "etransfer"]);
});

test("usable client email rejects empty and demo placeholders", () => {
  expect(usableClientEmail("Sarah@Example.COM")).toBe("");
  expect(usableClientEmail("")).toBe("");
  expect(usableClientEmail("client@nabitouch.com")).toBe("client@nabitouch.com");
});

test("patient share prefers payableNow then insurance remainder", () => {
  expect(patientShareCents({ payableNow: { cents: 2000 }, balance: { cents: 10000 }, expectedInsurance: { cents: 8000 } })).toBe(2000);
  expect(patientShareCents({ balance: { cents: 10000 }, expectedInsurance: { cents: 8000 } })).toBe(2000);
  expect(patientShareCents({ balance: { cents: 10000 }, expectedInsurance: { cents: 0 } })).toBe(10000);
});
