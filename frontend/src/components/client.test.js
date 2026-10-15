import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { StickyBook } from "./client";

test("the floating book button does not cover the mobile page", () => {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  act(() => { root.render(createElement(StickyBook, { onClick() {} })); });
  const bar = host.querySelector("[data-testid='sticky-book-bar']");
  expect(bar.className).toContain("hidden");
  expect(bar.className).toContain("md:block");
  act(() => root.unmount());
  host.remove();
});
