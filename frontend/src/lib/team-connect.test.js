import {
  teamBase,
  teamPath,
  quickHelpHref,
  visibleUnreadFromInbox,
  visibleStaffUnreadFromInbox,
  TEAM_AREAS,
  QUICK_HELP_CATEGORIES,
} from "./team-connect";

test("team paths stay under staff workspaces", () => {
  expect(teamBase("pro")).toBe("/pro/team");
  expect(teamBase("desk")).toBe("/desk/team");
  expect(teamBase("owner")).toBe("/owner/team");
  expect(teamPath("pro", "help")).toBe("/pro/team/help");
  expect(teamPath("pro", "messages/sth-abc")).toBe("/pro/team/messages/sth-abc");
});

test("team areas cover the four primary modules", () => {
  expect(TEAM_AREAS.map((a) => a.id)).toEqual(["messages", "help", "requests", "supplies"]);
  expect(QUICK_HELP_CATEGORIES).toHaveLength(6);
});

test("visible unread trusts detail maps including zero after clear", () => {
  expect(visibleUnreadFromInbox({ unread: 5, byAppointment: { a: 1, b: 2 } })).toBe(3);
  expect(visibleUnreadFromInbox({ unread: 5, byAppointment: {} })).toBe(0);
  expect(visibleUnreadFromInbox({ unread: 2, threads: [{ unread: 1 }, { unread: 1 }] })).toBe(2);
  expect(visibleUnreadFromInbox({ unread: 4 })).toBe(4);
  expect(visibleUnreadFromInbox({ unread: 0, byAppointment: {} })).toBe(0);
});

test("staff unread prefers byThread including zero", () => {
  expect(visibleStaffUnreadFromInbox({ unread: 9, byThread: { t1: 2, t2: 1 } })).toBe(3);
  expect(visibleStaffUnreadFromInbox({ unread: 9, byThread: {} })).toBe(0);
  expect(visibleStaffUnreadFromInbox({ unread: 4 })).toBe(4);
});

test("quick help deep links", () => {
  expect(quickHelpHref("pro")).toBe("/pro/team/help");
  expect(quickHelpHref("pro", { category: "running_late", appointmentId: "a-1" })).toBe(
    "/pro/team/help?category=running_late&appointmentId=a-1",
  );
  expect(quickHelpHref("owner", { appointmentId: "a-9" })).toBe("/owner/team/help?appointmentId=a-9");
});
