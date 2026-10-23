import { fullName } from "./domain";

test("joins first and last once", () => {
  expect(fullName({ firstName: "Fatima", lastName: "Elsayed" })).toBe("Fatima Elsayed");
});

test("dedupes when first and last store the same full name", () => {
  expect(fullName({ firstName: "Fatima Elsayed", lastName: "Fatima Elsayed" })).toBe("Fatima Elsayed");
});

test("dedupes when preferred name already includes last name", () => {
  expect(fullName({ preferredName: "Fatima Elsayed", firstName: "Fatima", lastName: "Elsayed" })).toBe("Fatima Elsayed");
});

test("prefers preferredName over firstName without duplicating last", () => {
  expect(fullName({ preferredName: "Fati", firstName: "Fatima", lastName: "Elsayed" })).toBe("Fati Elsayed");
});

test("falls back to Guest when empty", () => {
  expect(fullName(null)).toBe("Guest");
  expect(fullName({})).toBe("Guest");
});
