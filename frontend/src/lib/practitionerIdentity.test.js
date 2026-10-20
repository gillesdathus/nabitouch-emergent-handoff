import { hasPractitionerCapability, resolvePractitionerId } from "./practitionerIdentity";
import { homeFor, spacesOf, canOpen } from "./workspaces";

test("owner+practitioner uses linked subject, never p-jordan", () => {
  const nabitu = {
    role: "owner",
    roles: ["owner", "practitioner"],
    subject: "p-f3a4279b",
    preferredWorkspace: "practitioner",
    workspaces: ["practitioner", "owner"],
  };
  expect(resolvePractitionerId(nabitu, "p-maya")).toBe("p-f3a4279b");
  expect(resolvePractitionerId(nabitu)).not.toBe("p-jordan");
  expect(homeFor(nabitu)).toBe("/pro");
  expect(spacesOf(nabitu)).toEqual(["practitioner", "owner"]);
  expect(canOpen(nabitu, "/pro")).toBe(true);
  expect(canOpen(nabitu, "/owner")).toBe(true);
});

test("practitioner-only login lands on /pro with own subject", () => {
  const pro = { role: "practitioner", roles: ["practitioner"], subject: "p-maya", workspaces: ["practitioner"] };
  expect(resolvePractitionerId(pro)).toBe("p-maya");
  expect(homeFor(pro)).toBe("/pro");
  expect(canOpen(pro, "/owner")).toBe(false);
});

test("owner without practitioner role still uses subject when present", () => {
  const owner = { role: "owner", roles: ["owner"], subject: "p-linked", workspaces: ["owner", "practitioner"] };
  expect(resolvePractitionerId(owner)).toBe("p-linked");
  expect(hasPractitionerCapability(owner)).toBe(true);
});

test("missing subject does not invent a demo practitioner id", () => {
  const broken = { role: "owner", roles: ["owner", "practitioner"], subject: null, workspaces: ["owner"] };
  expect(resolvePractitionerId(broken, "")).toBe("");
  expect(resolvePractitionerId(broken)).not.toBe("p-jordan");
  expect(hasPractitionerCapability(broken)).toBe(true);
});

test("client and desk stay unauthorized for /pro", () => {
  expect(canOpen({ role: "client", workspaces: ["client"] }, "/pro")).toBe(false);
  expect(canOpen({ role: "desk", workspaces: ["desk"] }, "/pro")).toBe(false);
  expect(resolvePractitionerId({ role: "desk", workspaces: ["desk"] }, "")).toBe("");
});

test("preferred owner workspace still reachable after practitioner default", () => {
  const dual = {
    role: "owner",
    roles: ["owner", "practitioner"],
    subject: "p-f3a4279b",
    preferredWorkspace: "practitioner",
    workspaces: ["practitioner", "owner"],
  };
  expect(homeFor(dual)).toBe("/pro");
  expect(homeFor({ ...dual, preferredWorkspace: "owner" })).toBe("/owner");
});
