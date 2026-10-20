import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { StickyBook } from "./client";

test("the book CTA is in document flow and never fixed over the catalogue", () => {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  act(() => { root.render(createElement(StickyBook, { onClick() {} })); });
  const bar = host.querySelector("[data-testid='sticky-book-bar']");
  expect(bar.className).not.toContain("fixed");
  expect(bar.className).not.toMatch(/\bz-\d+/);
  expect(bar.className).toContain("mt-8");
  act(() => root.unmount());
  host.remove();
});
