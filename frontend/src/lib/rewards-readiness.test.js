/**
 * Slice 5 — frontend readiness notes for Nabitouch Rewards.
 * Documents what the booking UI can wire today vs what requires a later slice.
 */
import { describe, expect, test } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const bookingSrc = readFileSync(join(here, "../pages/client/Booking.jsx"), "utf8");
const rewardsSrc = readFileSync(join(here, "../pages/client/Rewards.jsx"), "utf8");

describe("Rewards UI readiness (static inventory)", () => {
  test("booking review wires package credit, winback, and follow-up toggles", () => {
    expect(bookingSrc).toMatch(/booking-credit-toggle/);
    expect(bookingSrc).toMatch(/booking-winback-toggle/);
    expect(bookingSrc).toMatch(/booking-followup-toggle/);
    expect(bookingSrc).toMatch(/useCredit/);
    expect(bookingSrc).toMatch(/winbackCode/);
    expect(bookingSrc).toMatch(/followupCode/);
  });

  test("booking UI does not expose points redemption or PAYG enrolment controls", () => {
    expect(bookingSrc).not.toMatch(/redeemPoints/);
    expect(bookingSrc).not.toMatch(/paygEnrolment/);
    expect(bookingSrc).not.toMatch(/referralCash/);
  });

  test("client Rewards page remains launch-aware (does not claim live cash referrals)", () => {
    // Defensive: page should not advertise an enabled $10 cash referral program in copy constants.
    expect(rewardsSrc.toLowerCase()).not.toMatch(/\$10 cash referral is live/);
  });
});
