/**
 * Health history wizard: Today + Confirm must never strand the client on a blank step.
 * Covers Android-sized viewports and in-flow CTAs (no sticky / bottom-nav competition).
 */
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, test, vi } from "vitest";
import Intake, {
  FALLBACK_TODAY_QUESTIONS,
  resolveTodayQuestions,
  todayStepReady,
} from "./Intake";

const h = vi.hoisted(() => ({
  readiness: null,
  loading: false,
  error: null,
  reload: vi.fn(),
  me: { id: "c-1", firstName: "Ada" },
  api: { submitBaseline: vi.fn(async () => ({ id: "in-1", version: 1 })) },
  run: vi.fn((fn) => fn()),
}));

vi.mock("@/components/session/SessionReadiness", () => ({
  useSessionReadiness: () => ({
    data: h.readiness,
    loading: h.loading,
    error: h.error,
    reload: h.reload,
  }),
}));

vi.mock("@/store/DemoStore", () => ({
  useDemo: () => ({
    me: h.me,
    api: h.api,
    run: h.run,
  }),
}));

function mount(entry = "/me/intake?appt=a-1&step=4") {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  act(() => root.render(createElement(MemoryRouter, { initialEntries: [entry] }, createElement(Intake))));
  return {
    host,
    cleanup() {
      act(() => root.unmount());
      host.remove();
    },
  };
}

beforeEach(() => {
  h.readiness = null;
  h.loading = false;
  h.error = null;
  h.reload.mockClear();
  h.api.submitBaseline.mockClear();
  h.run.mockClear();
  window.scrollTo = vi.fn();
  sessionStorage.clear();
  Object.defineProperty(window, "innerWidth", { configurable: true, value: 390 });
  Object.defineProperty(window, "innerHeight", { configurable: true, value: 844 });
});

describe("today helpers", () => {
  test("todayStepReady blocks loading/error and requires yes/no answers", () => {
    const qs = [{ id: "unwell", kind: "yesno" }];
    expect(todayStepReady([], {}, { loading: true, error: null, readiness: null })).toBe(false);
    expect(todayStepReady([], {}, { loading: false, error: new Error("x"), readiness: null })).toBe(false);
    expect(todayStepReady([], {}, { loading: false, error: null, readiness: { questions: [] } })).toBe(false);
    expect(todayStepReady(qs, {}, { loading: false, error: null, readiness: { questions: qs } })).toBe(false);
    expect(todayStepReady(qs, { unwell: "no" }, { loading: false, error: null, readiness: { questions: qs } })).toBe(true);
  });

  test("resolveTodayQuestions uses API list or general fallback — never empty after success", () => {
    expect(resolveTodayQuestions(null, { loading: true, error: null })).toEqual([]);
    expect(resolveTodayQuestions({ questions: [{ id: "unwell", kind: "yesno" }] }, { loading: false, error: null })).toEqual([
      { id: "unwell", kind: "yesno" },
    ]);
    expect(resolveTodayQuestions({ questions: [] }, { loading: false, error: null })).toEqual(FALLBACK_TODAY_QUESTIONS);
  });
});

describe("Intake Today (390×844)", () => {
  test("stable step count 6 with appt; in-flow nav; no sticky bar", () => {
    h.loading = true;
    const view = mount("/me/intake?appt=a-1&step=4");
    expect(view.host.querySelector("[data-testid=intake-step-count]")?.textContent).toBe("5/6");
    expect(view.host.querySelector("[data-testid=intake-sticky-actions]")).toBeNull();
    expect(document.querySelector(".nb-sticky-actions")).toBeNull();
    expect(view.host.querySelector("[data-testid=intake-step-nav]")).toBeTruthy();
    expect(view.host.contains(view.host.querySelector("[data-testid=intake-next]"))).toBe(true);
    view.cleanup();
  });

  test("shows loading and keeps Continue disabled", () => {
    h.loading = true;
    const view = mount();
    expect(view.host.querySelector("[data-testid=intake-step-today]")).toBeTruthy();
    expect(view.host.querySelector("[data-testid=intake-today-loading]")).toBeTruthy();
    expect(view.host.querySelector("[data-testid=intake-today-body]")?.textContent).toMatch(/Loading/i);
    expect(view.host.querySelector("[data-testid=intake-next]")?.disabled).toBe(true);
    view.cleanup();
  });

  test("renders visit questions and enables Continue after yes/no", () => {
    h.readiness = {
      questions: [
        { id: "unwell", label: "Do you feel unwell today?", kind: "yesno" },
        { id: "today", label: "Anything else?", kind: "text" },
      ],
    };
    const view = mount();
    expect(view.host.querySelector("[data-testid=intake-q-unwell]")).toBeTruthy();
    expect(view.host.querySelector("[data-testid=intake-q-unwell]")?.textContent).toMatch(/unwell/i);
    expect(view.host.querySelector("[data-testid=intake-next]")?.disabled).toBe(true);
    act(() => { view.host.querySelector("[data-testid=intake-answer-unwell-no]")?.click(); });
    expect(view.host.querySelector("[data-testid=intake-next]")?.disabled).toBe(false);
    view.cleanup();
  });

  test("empty API questions still show required general prompts (no silent skip)", () => {
    h.readiness = { questions: [] };
    const view = mount();
    expect(view.host.querySelector("[data-testid=intake-step-count]")?.textContent).toBe("5/6");
    expect(view.host.querySelector("[data-testid=intake-q-unwell]")).toBeTruthy();
    expect(view.host.querySelector("[data-testid=intake-today-fallback-note]")).toBeTruthy();
    expect(view.host.querySelector("[data-testid=intake-next]")?.disabled).toBe(true);
    view.cleanup();
  });
});

describe("Intake Confirm (390×844)", () => {
  test("shows review of answers and keeps Save disabled until consent", () => {
    h.readiness = {
      questions: [{ id: "unwell", label: "Do you feel unwell today?", kind: "yesno" }],
    };
    sessionStorage.setItem("nt_intake_draft_v1:a-1", JSON.stringify({
      step: 5,
      form: {
        allergies: "Latex",
        medications: "None",
        conditions: ["None of these"],
        conditionsOther: "",
        surgeries: "",
        physician: "",
        pregnancy: "Not pregnant",
        weeks: "",
        emergencyName: "Sam Parent",
        emergencyPhone: "7805550199",
        emergencyRelation: "Spouse",
        areas: ["Neck"],
        avoid: "",
        pressure: "medium",
        answers: { unwell: "no" },
        consent: false,
      },
    }));
    const view = mount("/me/intake?appt=a-1&step=5");
    expect(view.host.querySelector("[data-testid=intake-step-count]")?.textContent).toBe("6/6");
    expect(view.host.querySelector("[data-testid=intake-step-confirm]")).toBeTruthy();
    expect(view.host.querySelector("[data-testid=intake-confirm-body]")).toBeTruthy();
    expect(view.host.querySelector("[data-testid=intake-confirm-review]")).toBeTruthy();
    expect(view.host.querySelector("[data-testid=review-allergies]")?.textContent).toMatch(/Latex/);
    expect(view.host.querySelector("[data-testid=review-emergency]")?.textContent).toMatch(/Sam Parent/);
    expect(view.host.querySelector("[data-testid=review-answer-unwell]")?.textContent).toMatch(/No/);
    expect(view.host.querySelector("[data-testid=intake-next]")?.disabled).toBe(true);
    expect(view.host.querySelector("[data-testid=intake-continue-hint]")?.textContent).toMatch(/confirm/i);
    act(() => { view.host.querySelector("[data-testid=intake-consent]")?.click(); });
    expect(view.host.querySelector("[data-testid=intake-next]")?.disabled).toBe(false);
    expect(view.host.querySelector("[data-testid=intake-next]")?.textContent).toMatch(/Save health history/);
    view.cleanup();
  });

  test("Save submits once (no duplicate baseline posts)", async () => {
    h.readiness = {
      questions: [{ id: "unwell", label: "Do you feel unwell today?", kind: "yesno" }],
    };
    sessionStorage.setItem("nt_intake_draft_v1:a-1", JSON.stringify({
      step: 5,
      form: {
        allergies: "",
        medications: "",
        conditions: ["None of these"],
        conditionsOther: "",
        surgeries: "",
        physician: "",
        pregnancy: "Not pregnant",
        weeks: "",
        emergencyName: "Sam Parent",
        emergencyPhone: "7805550199",
        emergencyRelation: "Spouse",
        areas: ["Neck"],
        avoid: "",
        pressure: "medium",
        answers: { unwell: "no" },
        consent: true,
      },
    }));
    const view = mount("/me/intake?appt=a-1&step=5");
    const btn = view.host.querySelector("[data-testid=intake-next]");
    expect(btn?.disabled).toBe(false);
    await act(async () => { btn.click(); });
    await act(async () => { btn.click(); });
    expect(h.api.submitBaseline).toHaveBeenCalledTimes(1);
    const payload = h.api.submitBaseline.mock.calls[0][0];
    expect(payload.appointmentId).toBe("a-1");
    expect(payload.conditions).toEqual(["None of these"]);
    expect(payload.answers).toEqual({ unwell: "no" });
    expect(payload.emergencyName).toBe("Sam Parent");
    view.cleanup();
  });
});
