import { bookableCatalogueService, managedMediaPath, profileVisibility, publiclyBookable, servicePublication } from "./domain";

test("disabled and archived treatments are not presented as bookable", () => {
  expect(bookableCatalogueService({ enabled: true, prices: { 60: 120 } })).toBe(true);
  expect(bookableCatalogueService({ enabled: false, prices: { 60: 120 } })).toBe(false);
  expect(bookableCatalogueService({ enabled: true, archived: true, prices: { 60: 120 } })).toBe(false);
  expect(bookableCatalogueService(null)).toBe(false);
});

test("preview and draft treatments are not bookable", () => {
  expect(servicePublication({ publication: "preview", enabled: false })).toBe("preview");
  expect(bookableCatalogueService({ publication: "preview", enabled: false })).toBe(false);
  expect(bookableCatalogueService({ publication: "published", enabled: true })).toBe(true);
  expect(bookableCatalogueService({ publication: "published", kind: "trial", slug: "ten-minutes-on-us", prices: { 10: 0 } })).toBe(false);
  expect(publiclyBookable({ available: true, profileVisibility: "hidden" })).toBe(false);
  expect(publiclyBookable({ available: true, profileVisibility: "published" })).toBe(true);
  expect(profileVisibility({ onboardingStatus: "draft" })).toBe("draft");
});

test("managed photos use the media route and static files stay on their own path", () => {
  expect(managedMediaPath("/api/media/media-abc", "thumb")).toBe("/media/media-abc?size=thumb");
  expect(managedMediaPath("/img/swedish.jpg", "thumb")).toBe("");
  expect(managedMediaPath("data:image/jpeg;base64,abc")).toBe("");
});
