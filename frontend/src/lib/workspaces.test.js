import { canOpen, homeFor, spacesOf } from "./workspaces";

const owner = { role: "owner", workspaces: ["owner", "practitioner"] };
const client = { role: "client", workspaces: ["client"] };
const desk = { role: "desk", workspaces: ["desk"] };

test("sends each role to its own workspace", () => {
  expect(homeFor(client)).toBe("/me");
  expect(homeFor({ role: "practitioner", workspaces: ["practitioner"] })).toBe("/pro");
  expect(homeFor(desk)).toBe("/desk");
  expect(homeFor(owner)).toBe("/owner");
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
});
