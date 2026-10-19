import { clientVisitProgress, CLIENT_VISIT_PHASES } from "./domain";

const base = (status, extra = {}) => ({ id: "a-1", status, ...extra });

test("confirmed stays at operational phase 0 even when space prep is complete", () => {
  const plain = clientVisitProgress(base("confirmed"));
  expect(plain.headline).toBe("Confirmed");
  expect(plain.phaseId).toBe("confirmed");
  expect(plain.stageIndex).toBe(0);
  expect(plain.detail).toMatch(/not when health check/i);

  const prepared = clientVisitProgress(base("confirmed", { readiness: { allReady: true, items: {} } }));
  expect(prepared.headline).toBe("Ready for your visit");
  expect(prepared.phaseId).toBe("confirmed");
  expect(prepared.stageIndex).toBe(0);
  expect(prepared.detail).toMatch(/still waits for your practitioner/i);
});

test("assigned and requested map to confirmed phase without inventing travel", () => {
  expect(clientVisitProgress(base("assigned")).stageIndex).toBe(0);
  expect(clientVisitProgress(base("requested")).stageIndex).toBe(0);
  expect(clientVisitProgress(base("assigned")).headline).toBe("Confirmed");
});

test("dispatched / arrived / in-progress / completed phases follow real statuses", () => {
  expect(clientVisitProgress(base("preparing"))).toMatchObject({ headline: "Practitioner preparing", stageIndex: 1, phaseId: "preparing" });
  expect(clientVisitProgress(base("en_route"))).toMatchObject({ headline: "Practitioner on the way", stageIndex: 2, phaseId: "en_route" });
  expect(clientVisitProgress(base("arrived"))).toMatchObject({ headline: "Arrived", stageIndex: 3 });
  expect(clientVisitProgress(base("in_session"))).toMatchObject({ headline: "Session in progress", stageIndex: 4 });
  expect(clientVisitProgress(base("session_ended"))).toMatchObject({ headline: "Session completed", stageIndex: 5 });
  expect(clientVisitProgress(base("completed"))).toMatchObject({ headline: "Visit completed", stageIndex: 6 });
  expect(clientVisitProgress(base("processing")).stageIndex).toBe(6);
});

test("cancelled and other terminal-like states hide the progress bar", () => {
  const cancelled = clientVisitProgress(base("cancelled"));
  expect(cancelled.headline).toBe("Cancelled");
  expect(cancelled.showBar).toBe(false);
  expect(cancelled.stageIndex).toBe(-1);

  expect(clientVisitProgress(base("no_show")).showBar).toBe(false);
  expect(clientVisitProgress(base("interrupted")).headline).toBe("Paused");
});

test("space checklist never advances past confirmed into preparing or en_route", () => {
  const ready = { readiness: { allReady: true, items: { space: true, paths: true, pets: true, entry: true, safe: true, service: true } } };
  expect(clientVisitProgress(base("confirmed", ready)).stageIndex).toBe(0);
  expect(clientVisitProgress(base("confirmed", ready)).phaseId).not.toBe("preparing");
  expect(clientVisitProgress(base("confirmed", ready)).phaseId).not.toBe("en_route");
});

test("CLIENT_VISIT_PHASES covers seven operational client phases", () => {
  expect(CLIENT_VISIT_PHASES).toHaveLength(7);
  expect(CLIENT_VISIT_PHASES.map((p) => p.id)).toEqual([
    "confirmed", "preparing", "en_route", "arrived", "in_session", "session_done", "completed",
  ]);
});
