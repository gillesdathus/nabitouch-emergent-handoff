import { clearDirty, dirtyIds, isDirty, markDirty } from "./dirtyForms";

test("dirty form registry tracks unsaved work for PWA update guard", () => {
  clearDirty("soap:a1");
  clearDirty("book:1");
  expect(isDirty()).toBe(false);
  markDirty("soap:a1");
  expect(isDirty()).toBe(true);
  expect(dirtyIds()).toContain("soap:a1");
  clearDirty("soap:a1");
  expect(isDirty()).toBe(false);
});
