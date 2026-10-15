import { publiclyBookable } from "./domain";

test("a draft practitioner is not offered as bookable", () => {
  expect(publiclyBookable({ available: false, bookable: false, onboardingStatus: "draft", specialties: [] })).toBe(false);
  expect(publiclyBookable({ available: true, bookable: false, onboardingStatus: "draft", specialties: ["swedish"] })).toBe(false);
  expect(publiclyBookable({ available: true, onboardingStatus: "approved", specialties: ["swedish"] })).toBe(true);
  expect(publiclyBookable({ available: true, specialties: ["swedish"] })).toBe(true);
});
