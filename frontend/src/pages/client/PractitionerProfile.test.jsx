import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import PractitionerProfile from "./PractitionerProfile";

const state = {
  practitioners: [{
    id: "p-f3a4279b",
    slug: "nabitu-kahindo",
    name: "Nabitu Kahindo",
    designation: "RMT",
    bio: "Therapeutic care.",
    profileVisibility: "published",
    specialties: ["swedish", "deep-tissue"],
    qualifications: ["RMT"],
    careerCompletedTreatments: 1714,
    treatmentsOffered: 2,
    available: true,
    bookable: true,
    onboardingStatus: "approved",
  }],
  services: [
    { slug: "swedish", name: "Swedish" },
    { slug: "deep-tissue", name: "Deep Tissue" },
  ],
};

vi.mock("@/store/DemoStore", () => ({
  useDemo: () => ({
    state,
    idx: {
      services: Object.fromEntries(state.services.map((row) => [row.slug, row])),
    },
    patchDraft: vi.fn(),
    user: null,
  }),
}));

vi.mock("@/lib/domain", async () => {
  const actual = await vi.importActual("@/lib/domain");
  return {
    ...actual,
    publiclyBookable: () => true,
  };
});

let container;

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
});

afterEach(() => {
  act(() => {
    createRoot(container).unmount();
  });
  container.remove();
  container = null;
});

test("shows career treatments completed separately from treatments offered", () => {
  act(() => {
    createRoot(container).render(
      createElement(
        MemoryRouter,
        { initialEntries: ["/practitioners/nabitu-kahindo"] },
        createElement(
          Routes,
          null,
          createElement(Route, { path: "/practitioners/:slug", element: createElement(PractitionerProfile) }),
        ),
      ),
    );
  });
  expect(container.querySelector("[data-testid='profile-treatment-count']")?.textContent).toBe("1,714");
  expect(container.textContent).toContain("Career Treatments Completed");
  expect(container.querySelector("[data-testid='profile-treatments-offered']")?.textContent).toContain("2");
  expect(container.textContent).toContain("Treatments Offered");
  expect(container.textContent).not.toMatch(/\b12\b.*Treatments(?! Offered)/);
});
