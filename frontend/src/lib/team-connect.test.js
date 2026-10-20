import { teamBase, teamPath, visibleUnreadFromInbox, TEAM_AREAS, QUICK_HELP_CATEGORIES } from "./team-connect";

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

test("visible unread prefers per-thread counts over a stale total", () => {
  expect(visibleUnreadFromInbox({ unread: 5, byAppointment: { a: 1, b: 2 } })).toBe(3);
  expect(visibleUnreadFromInbox({ unread: 2, byAppointment: {}, threads: [{ unread: 1 }, { unread: 1 }] })).toBe(2);
  expect(visibleUnreadFromInbox({ unread: 0, byAppointment: {} })).toBe(0);
});
