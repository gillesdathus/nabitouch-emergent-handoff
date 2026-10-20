import { BOOKING_SOURCES, canOpen, homeFor, postLoginPath, spacesOf, WORKSPACES } from "./workspaces";

const owner = { role: "owner", workspaces: ["owner", "practitioner"] };
const client = { role: "client", workspaces: ["client"] };
const desk = { role: "desk", workspaces: ["desk"] };
const dual = {
  role: "owner",
  roles: ["owner", "practitioner"],
  preferredWorkspace: "practitioner",
  workspaces: ["practitioner", "owner"],
};

test("sends each role to its own workspace", () => {
  expect(homeFor(client)).toBe("/me");
  expect(homeFor({ role: "practitioner", workspaces: ["practitioner"] })).toBe("/pro");
  expect(homeFor(desk)).toBe("/desk");
  expect(homeFor(owner)).toBe("/owner");
  expect(homeFor({ role: "owner", workspaces: ["owner", "practitioner"], preferredWorkspace: "practitioner" })).toBe("/pro");
  expect(WORKSPACES.owner.label).toBe("Owner / Manager");
});

test("phone booking sources stay stable", () => {
  expect(BOOKING_SOURCES.map((item) => item.id)).toEqual(["phone", "whatsapp", "sms", "walk_in", "reception", "staff"]);
});

test("a workspace switcher only lists roles the server assigned", () => {
  expect(spacesOf(owner)).toEqual(["owner", "practitioner"]);
  expect(spacesOf(client)).toEqual(["client"]);
  expect(spacesOf({ role: "client", workspaces: ["client", "owner"] }).includes("owner")).toBe(true);
  expect(spacesOf({ role: "owner" })).toEqual(["owner"]);
});

test("rejects a workspace the account was not given", () => {
  expect(canOpen(client, "/owner")).toBe(false);
  expect(canOpen(client, "/pro")).toBe(false);
  expect(canOpen(client, "/desk")).toBe(false);
  expect(canOpen(desk, "/owner")).toBe(false);
  expect(canOpen(owner, "/desk")).toBe(false);
  expect(canOpen(owner, "/pro")).toBe(true);
  expect(canOpen(owner, "/owner/zones")).toBe(true);
  expect(canOpen(null, "/services")).toBe(true);
  expect(canOpen(client, "/book")).toBe(true);
  expect(canOpen(client, "/book?service=svc-swedish")).toBe(true);
  expect(canOpen(client, "/login?next=%2Fbook%3Fservice%3Dx")).toBe(true);
});

test("client Account is not a post-login target for staff (MFA next=/me regression)", () => {
  expect(canOpen(owner, "/me")).toBe(false);
  expect(canOpen(owner, "/me/billing")).toBe(false);
  expect(canOpen(desk, "/me")).toBe(false);
  expect(canOpen({ role: "practitioner", workspaces: ["practitioner"] }, "/me")).toBe(false);
  expect(canOpen(client, "/me")).toBe(true);
  expect(canOpen(client, "/me/profile")).toBe(true);
  expect(postLoginPath(owner, "/me")).toBe("/owner");
  expect(postLoginPath(dual, "/me")).toBe("/pro");
  expect(postLoginPath(owner, "/owner/dashboard")).toBe("/owner/dashboard");
  expect(postLoginPath(desk, "/desk")).toBe("/desk");
  expect(postLoginPath(client, "/me")).toBe("/me");
  expect(postLoginPath(client, null)).toBe("/me");
  // Empty workspaces[] falls back to primary role home.
  expect(postLoginPath({ role: "owner", workspaces: [] }, "/me")).toBe("/owner");
  expect(postLoginPath({ role: "client", workspaces: [] }, "/owner")).toBe("/me");
});
