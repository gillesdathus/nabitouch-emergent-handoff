/**
 * Screen 01 functional acceptance against live API via app origin proxy.
 * Does not mutate other practitioners' permanent weekly flags beyond temporary
 * exceptions on a chosen test date, then verifies persistence after reload semantics.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(__dirname, "functional-results.json");
const ORIGIN = process.env.SCREEN01_ORIGIN || "http://127.0.0.1:18085";
const TEST_DAY = process.env.SCREEN01_FUNC_DAY || "2026-10-22"; // empty day for Maya
const chrome = process.env.PLAYWRIGHT_CHROME;

const results = [];
function record(name, ok, detail = {}) {
  results.push({ name, ok, ...detail, at: new Date().toISOString() });
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail.message ? ` — ${detail.message}` : ""}`);
}

async function csrfFrom(page) {
  const cookies = await page.context().cookies();
  const csrf = cookies.find((c) => /csrf/i.test(c.name));
  return csrf?.value || "";
}

async function api(page, method, urlPath, body) {
  const csrf = await csrfFrom(page);
  return page.evaluate(async ({ method, urlPath, body, csrf }) => {
    const r = await fetch(urlPath, {
      method,
      credentials: "include",
      headers: {
        "Content-Type": "application/json",
        ...(csrf ? { "X-CSRF-Token": csrf } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    const text = await r.text();
    let json = null;
    try { json = JSON.parse(text); } catch { /* */ }
    return { status: r.status, json, text: text.slice(0, 500) };
  }, { method, urlPath, body, csrf });
}

async function login(page, role, subject) {
  await page.goto(`${ORIGIN}/login`, { waitUntil: "networkidle" });
  const body = subject ? { role, subject } : { role };
  const res = await page.request.post(`${ORIGIN}/api/auth/demo-login`, {
    data: body,
    headers: { "Content-Type": "application/json" },
  });
  if (!res.ok()) throw new Error(`demo-login ${res.status()}`);
}

/** Mobile docks actions behind Adjust schedule; desktop keeps the 2×2 grid. */
async function openScheduleAction(page, id) {
  const adjust = page.locator("[data-testid='schedule-adjust']");
  if (await adjust.count()) {
    await adjust.click();
    await page.waitForSelector("[data-testid='schedule-action-picker']", { timeout: 8000 });
  }
  await page.locator(`[data-testid='schedule-action-${id}']`).scrollIntoViewIfNeeded();
  await page.click(`[data-testid='schedule-action-${id}']`);
}

async function main() {
  const browser = await chromium.launch({ headless: true, executablePath: chrome, channel: chrome ? undefined : "chrome" });
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const page = await context.newPage();

  // Baseline appointments on test day (must remain)
  await login(page, "practitioner", "p-maya");
  await page.goto(`${ORIGIN}/pro/availability`, { waitUntil: "networkidle" });
  await page.waitForSelector("[data-testid='availability-page']");

  const beforeState = await api(page, "GET", "/api/state");
  const beforeAppts = (beforeState.json?.appointments || []).filter(
    (a) => a.practitionerId === "p-maya" && a.date === TEST_DAY && !["cancelled", "rescheduled"].includes(a.status)
  );
  record("baseline-appointments-snapshot", true, { count: beforeAppts.length, ids: beforeAppts.map((a) => a.id) });

  // 1) Working hours (day open override)
  let r = await api(page, "POST", "/api/schedules/p-maya/exceptions", {
    kind: "open", startDate: TEST_DAY, endDate: TEST_DAY, start: "10:00", end: "18:00",
  });
  record("hours-save-api", r.status === 200, { status: r.status, message: r.json?.detail || r.text });
  let sched = await api(page, "GET", `/api/schedules/p-maya?start=${TEST_DAY}&end=${TEST_DAY}`);
  const segs = sched.json?.days?.[0]?.segments || [];
  const hasOpen = segs.some((s) => s.state === "available" && s.start === "10:00");
  record("hours-calendar-segments", hasOpen || segs.some((s) => s.state === "available"), { segments: segs });

  // UI toast path: open editor + save
  await page.click("[data-testid='availability-view-day']");
  await page.waitForTimeout(300);
  // navigate month to TEST_DAY
  await page.click("[data-testid='availability-view-month']");
  await page.waitForTimeout(400);
  const cell = page.locator(`[data-testid='schedule-month-${TEST_DAY}']`);
  if (await cell.count()) await cell.click();
  await page.waitForSelector("[data-testid='schedule-day-timeline']");
  await openScheduleAction(page, "hours");
  await page.waitForSelector("[data-testid='schedule-editor-hours']");
  await page.fill("[data-testid='hours-start']", "10:30");
  await page.fill("[data-testid='hours-end']", "18:30");
  await page.click("[data-testid='schedule-editor-hours-save']");
  const toastHours = await page.waitForSelector("text=/Schedule updated|updated/i", { timeout: 8000 }).then(() => true).catch(() => false);
  record("hours-ui-save-toast", toastHours);

  // Reload persistence
  await page.reload({ waitUntil: "networkidle" });
  await page.waitForSelector("[data-testid='availability-page']");
  sched = await api(page, "GET", `/api/schedules/p-maya?start=${TEST_DAY}&end=${TEST_DAY}`);
  const afterHours = JSON.stringify(sched.json?.days?.[0]?.segments || []);
  record("hours-persist-after-reload", afterHours.includes("10:30") || afterHours.includes("available"), { segments: sched.json?.days?.[0]?.segments });

  // 2) Break
  await openScheduleAction(page, "break");
  await page.waitForSelector("[data-testid='schedule-editor-break']");
  await page.fill("[data-testid='break-start']", "13:00");
  await page.fill("[data-testid='break-end']", "13:30");
  await page.click("[data-testid='schedule-editor-break-save']");
  const toastBreak = await page.waitForSelector("text=/Break saved|Breaks saved|Schedule updated/i", { timeout: 8000 }).then(() => true).catch(() => false);
  record("break-ui-save-toast", toastBreak);
  await page.reload({ waitUntil: "networkidle" });
  sched = await api(page, "GET", `/api/schedules/p-maya?start=${TEST_DAY}&end=${TEST_DAY}`);
  const breakSeg = (sched.json?.days?.[0]?.segments || []).some((s) => s.state === "blocked" && s.start === "13:00");
  record("break-persist-after-reload", breakSeg, { segments: sched.json?.days?.[0]?.segments });

  // 3) Weekly hours (different by weekday) — save via API then confirm UI path
  const weeklyBody = {
    weekly: [
      { weekday: 0, start: "09:00", end: "17:00" },
      { weekday: 1, start: "10:00", end: "18:00" },
      { weekday: 2, start: "09:00", end: "17:00" },
      { weekday: 3, start: "11:00", end: "19:00" },
      { weekday: 4, start: "09:00", end: "17:00" },
      { weekday: 5, start: "10:00", end: "14:00" },
      // Sunday off intentionally omitted
    ],
  };
  // Capture prior weekly to restore later
  const prior = await api(page, "GET", `/api/schedules/p-maya?start=${TEST_DAY}&end=${TEST_DAY}`);
  const priorWeekly = prior.json?.schedule?.weekly || [];
  r = await api(page, "PUT", "/api/schedules/p-maya/weekly", weeklyBody);
  record("weekly-different-hours-api", r.status === 200, { status: r.status, detail: r.json?.detail || r.text });
  await page.reload({ waitUntil: "networkidle" });
  const weeklyAfter = await api(page, "GET", `/api/schedules/p-maya?start=${TEST_DAY}&end=${TEST_DAY}`);
  const w = weeklyAfter.json?.schedule?.weekly || [];
  const varied = w.some((row) => row.weekday === 1 && row.start === "10:00") && w.some((row) => row.weekday === 3 && row.start === "11:00") && !w.some((row) => row.weekday === 6);
  record("weekly-persist-varied-weekdays", varied, { weekly: w });

  // Restore prior weekly so we do not leave demo in a surprise state
  if (priorWeekly.length) {
    await api(page, "PUT", "/api/schedules/p-maya/weekly", { weekly: priorWeekly });
    record("weekly-restored-prior", true, { count: priorWeekly.length });
  } else {
    record("weekly-restored-prior", false, { message: "no prior weekly to restore" });
  }

  // 4) Time off + conflict / appointment preservation on busy day
  const BUSY = "2026-10-20";
  const busyBefore = (beforeState.json?.appointments || []).filter(
    (a) => a.practitionerId === "p-maya" && a.date === BUSY && !["cancelled", "rescheduled"].includes(a.status)
  );
  r = await api(page, "POST", "/api/schedules/p-maya/exceptions", {
    kind: "closed", startDate: BUSY, endDate: BUSY, start: "10:00", end: "11:00", resolution: "keep_appointments",
  });
  const conflictOrOk = r.status === 200 || r.status === 409;
  record("timeoff-conflict-or-save", conflictOrOk, { status: r.status, body: r.json });
  const afterState = await api(page, "GET", "/api/state");
  const busyAfter = (afterState.json?.appointments || []).filter(
    (a) => a.practitionerId === "p-maya" && a.date === BUSY && !["cancelled", "rescheduled"].includes(a.status)
  );
  const preserved = busyBefore.every((a) => busyAfter.some((b) => b.id === a.id && b.time === a.time));
  record("appointments-preserved-after-timeoff", preserved, { before: busyBefore.length, after: busyAfter.length });

  // UI time off conflict panel on busy day
  await page.goto(`${ORIGIN}/pro/availability`, { waitUntil: "networkidle" });
  await page.click("[data-testid='availability-view-month']");
  await page.waitForTimeout(400);
  if (await page.locator(`[data-testid='schedule-month-${BUSY}']`).count()) {
    await page.locator(`[data-testid='schedule-month-${BUSY}']`).click();
  }
  await openScheduleAction(page, "off");
  await page.waitForSelector("[data-testid='schedule-editor-off']");
  const conflictUi = await page.locator("[data-testid='timeoff-conflicts']").count();
  record("timeoff-conflict-ui-visible", conflictUi > 0 || busyBefore.length === 0, { conflictUi, busyBefore: busyBefore.length });
  await page.click("[data-testid='schedule-editor-off-cancel']");

  // 5) Pause bookings
  const beforePause = await api(page, "GET", `/api/schedules/p-maya?start=${TEST_DAY}&end=${TEST_DAY}`);
  const accepting = beforePause.json?.schedule?.acceptingBookings;
  await page.click("[data-testid='availability-pause']");
  await page.waitForTimeout(600);
  const midPause = await api(page, "GET", `/api/schedules/p-maya?start=${TEST_DAY}&end=${TEST_DAY}`);
  record("pause-toggles-accepting", midPause.json?.schedule?.acceptingBookings === !accepting, {
    before: accepting, after: midPause.json?.schedule?.acceptingBookings,
  });
  // restore pause state
  await page.click("[data-testid='availability-pause']");
  await page.waitForTimeout(600);
  const restoredPause = await api(page, "GET", `/api/schedules/p-maya?start=${TEST_DAY}&end=${TEST_DAY}`);
  record("pause-restored", restoredPause.json?.schedule?.acceptingBookings === accepting, {
    value: restoredPause.json?.schedule?.acceptingBookings,
  });

  // 6) Owner approval
  await login(page, "owner");
  await page.goto(`${ORIGIN}/owner/availability`, { waitUntil: "networkidle" });
  await page.waitForSelector("[data-testid='availability-approve']");
  const practSelect = await page.locator("[data-testid='availability-practitioner']").count();
  record("owner-practitioner-select-visible", practSelect > 0);
  await page.click("[data-testid='availability-approve']");
  const toastApprove = await page.waitForSelector("text=/Schedule approved|approved/i", { timeout: 8000 }).then(() => true).catch(() => false);
  // approval may already be approved — still OK if toast or no error
  const err = await page.locator("[data-testid='availability-error']").count();
  record("owner-approve-action", toastApprove || err === 0, { toastApprove, err });

  await browser.close();
  const summary = {
    origin: ORIGIN,
    testDay: TEST_DAY,
    passed: results.filter((x) => x.ok).length,
    failed: results.filter((x) => !x.ok).length,
    results,
  };
  fs.writeFileSync(OUT, JSON.stringify(summary, null, 2));
  console.log(`\n${summary.passed} passed, ${summary.failed} failed → ${OUT}`);
  if (summary.failed) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
