import { quickHelpHref, suppliesHref, teamPath } from "./team-connect";

test("quickHelpHref preserves category and appointment deep links", () => {
  expect(quickHelpHref("pro", { category: "running_late", appointmentId: "a-1" })).toBe(
    "/pro/team/help?category=running_late&appointmentId=a-1",
  );
  expect(quickHelpHref("desk")).toBe("/desk/team/help");
});

test("suppliesHref supports next-client appointment query", () => {
  expect(suppliesHref("pro", { appointmentId: "a-9" })).toBe("/pro/team/supplies?appointmentId=a-9");
  expect(suppliesHref("owner")).toBe(teamPath("owner", "supplies"));
});
