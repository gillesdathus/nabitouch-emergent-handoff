import { describe, expect, test } from "vitest";
import { emptyEngageAnswers, getEngageEvent, ENGAGE_SCREENING } from "@/fixtures/engage";
import {
  emailLooksValid,
  phoneDigits,
  resolveEngageMode,
  screeningFlags,
  stepValid,
  syntheticCheckInCode,
} from "@/lib/engage";

describe("engage helpers", () => {
  test("resolveEngageMode prefers query", () => {
    const params = new URLSearchParams("mode=tablet");
    expect(resolveEngageMode(params)).toBe("tablet");
    expect(resolveEngageMode(new URLSearchParams("mode=phone"))).toBe("phone");
  });

  test("contact validation", () => {
    const event = getEngageEvent();
    const base = emptyEngageAnswers();
    expect(stepValid("contact", base, event)).toBe(false);
    expect(
      stepValid(
        "contact",
        { ...base, firstName: "Alex", lastName: "Rivera", email: "alex@aurora.test", phone: "7805550100" },
        event,
      ),
    ).toBe(true);
    expect(emailLooksValid("bad")).toBe(false);
    expect(phoneDigits("(780) 555-0100")).toBe("7805550100");
  });

  test("hard screening flags block treatment path", () => {
    const answers = emptyEngageAnswers();
    answers.screening = Object.fromEntries(ENGAGE_SCREENING.map((q) => [q.id, "no"]));
    answers.screening.unwell = "yes";
    const flags = screeningFlags(answers);
    expect(flags.blocked).toBe(true);
    expect(flags.hard.some((q) => q.id === "unwell")).toBe(true);
  });

  test("synthetic check-in code is deterministic shape", () => {
    const event = getEngageEvent();
    const answers = {
      ...emptyEngageAnswers(),
      firstName: "Alex",
      lastName: "Rivera",
      slotId: event.slots[0].id,
    };
    const code = syntheticCheckInCode(answers, event);
    expect(code).toMatch(/^NT-[A-Z]{3}-AR/);
  });
});
