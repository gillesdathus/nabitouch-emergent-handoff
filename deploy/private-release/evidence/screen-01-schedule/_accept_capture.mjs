/**
 * Screen 01 acceptance: real screenshots from the running Vite app + API session.
 * Usage: node _accept_capture.mjs
 * Requires: frontend at ORIGIN (default http://127.0.0.1:18085) and API via that origin's /api proxy.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT = __dirname;
const ORIGIN = process.env.SCREEN01_ORIGIN || "http://127.0.0.1:18085";
const EMPTY_DAY = process.env.SCREEN01_EMPTY_DAY || "2026-10-19";
const BUSY_DAY = process.env.SCREEN01_BUSY_DAY || "2026-10-20";

const VIEWPORTS = [
  { id: "360", width: 360, height: 780, isMobile: true },
  { id: "390", width: 390, height: 844, isMobile: true },
  { id: "430", width: 430, height: 932, isMobile: true },
  { id: "768", width: 768, height: 1024, isMobile: false },
  { id: "desktop", width: 1440, height: 900, isMobile: false },
];

function shot(name) {
  return path.join(OUT, `${name}.png`);
}

async function login(page, role, subject) {
  await page.goto(`${ORIGIN}/login`, { waitUntil: "networkidle" });
  await page.waitForTimeout(400);
  const body = subject ? { role, subject } : { role };
  const res = await page.request.post(`${ORIGIN}/api/auth/demo-login`, {
    data: body,
    headers: { "Content-Type": "application/json" },
  });
  if (!res.ok()) throw new Error(`demo-login ${res.status()} ${await res.text()}`);
}

async function waitSchedule(page) {
  await page.waitForSelector("[data-testid='availability-page']", { timeout: 20000 });
  await page.waitForSelector("[data-testid='schedule-calendar'], [data-testid='schedule-loading']", { timeout: 20000 });
  await page.waitForFunction(() => !document.querySelector("[data-testid='schedule-loading']") || document.querySelector("[data-testid='schedule-calendar']"), null, { timeout: 20000 }).catch(() => {});
  await page.waitForTimeout(350);
}

async function goDay(page, date) {
  await page.click("[data-testid='availability-view-day']");
  // step via URL-less state: click today then next/prev is awkward; set cursor via week/month pick
  await page.click("[data-testid='availability-view-month']");
  await page.waitForTimeout(400);
  const cell = page.locator(`[data-testid='schedule-month-${date}']`);
  if (await cell.count()) {
    await cell.first().click();
  } else {
    await page.click("[data-testid='availability-view-day']");
  }
  await page.waitForSelector("[data-testid='schedule-day-timeline']", { timeout: 15000 });
  await page.waitForTimeout(300);
}

async function openEditor(page, id) {
  const adjust = page.locator("[data-testid='schedule-adjust']");
  if (await adjust.count()) {
    await adjust.click();
    await page.waitForSelector("[data-testid='schedule-action-picker']", { timeout: 8000 });
  }
  await page.locator(`[data-testid='schedule-action-${id}']`).scrollIntoViewIfNeeded();
  await page.click(`[data-testid='schedule-action-${id}']`);
  await page.waitForSelector(`[data-testid='schedule-editor-${id}']`, { timeout: 10000 });
  await page.waitForTimeout(250);
}

async function closeEditor(page, id) {
  const cancel = page.locator(`[data-testid='schedule-editor-${id}-cancel']`);
  if (await cancel.count()) await cancel.click();
  await page.waitForTimeout(250);
}

async function captureViewport(browser, vp) {
  const context = await browser.newContext({
    viewport: { width: vp.width, height: vp.height },
    deviceScaleFactor: vp.isMobile ? 2 : 1,
    isMobile: vp.isMobile,
    hasTouch: vp.isMobile,
  });
  const page = await context.newPage();
  page.setDefaultTimeout(20000);

  await login(page, "practitioner", "p-maya");
  await page.goto(`${ORIGIN}/pro/availability`, { waitUntil: "networkidle" });
  await waitSchedule(page);

  // Day with appointments
  await goDay(page, BUSY_DAY);
  await page.screenshot({ path: shot(`${vp.id}-day-with-appointments`), fullPage: false });

  // Day without appointments
  await goDay(page, EMPTY_DAY);
  await page.screenshot({ path: shot(`${vp.id}-day-empty`), fullPage: false });

  // Week
  await page.click("[data-testid='availability-view-week']");
  await page.waitForSelector("[data-testid='schedule-week-overview']");
  await page.waitForTimeout(500);
  await page.screenshot({ path: shot(`${vp.id}-week`), fullPage: false });

  // Month
  await page.click("[data-testid='availability-view-month']");
  await page.waitForSelector("[data-testid='schedule-month-overview']");
  await page.waitForTimeout(500);
  await page.screenshot({ path: shot(`${vp.id}-month`), fullPage: false });

  // Editors (from day view for context)
  await goDay(page, BUSY_DAY);
  for (const id of ["hours", "break", "off", "weekly"]) {
    await openEditor(page, id);
    await page.screenshot({ path: shot(`${vp.id}-editor-${id}`), fullPage: false });
    await closeEditor(page, id);
  }

  // Owner controls
  await login(page, "owner");
  await page.goto(`${ORIGIN}/owner/availability`, { waitUntil: "networkidle" });
  await waitSchedule(page);
  await page.screenshot({ path: shot(`${vp.id}-owner-approve`), fullPage: false });

  // Mobile metrics sample on one viewport
  if (vp.id === "390") {
    const metrics = await page.evaluate(() => {
      const doc = document.documentElement;
      const overflowX = doc.scrollWidth > doc.clientWidth + 1;
      const nav = document.querySelector("[data-testid='pro-bottom'], [data-testid='owner-bottom']");
      const actions = document.querySelector("[data-testid='schedule-quick-actions']");
      const headerLogoDup = !!document.querySelector("[data-testid='schedule-header'] [class*='Logo'], [data-testid='schedule-header'] img");
      return {
        overflowX,
        scrollWidth: doc.scrollWidth,
        clientWidth: doc.clientWidth,
        hasBottomNav: !!nav,
        quickActionsPresent: !!actions,
        duplicateHeaderLogo: headerLogoDup,
        clinicBadgeCount: [...document.querySelectorAll("span")].filter((el) => el.textContent?.trim() === "Clinic").length,
      };
    });
    fs.writeFileSync(path.join(OUT, "mobile-390-metrics.json"), JSON.stringify(metrics, null, 2));
  }

  await context.close();
  return vp.id;
}

async function main() {
  const candidates = [
    process.env.PLAYWRIGHT_CHROME,
    "C:\\\\Program Files\\\\Google\\\\Chrome\\\\Application\\\\chrome.exe",
    "C:\\\\Program Files (x86)\\\\Google\\\\Chrome\\\\Application\\\\chrome.exe",
    "C:\\\\Program Files\\\\Microsoft\\\\Edge\\\\Application\\\\msedge.exe",
  ].filter(Boolean);

  let executablePath = candidates.find((p) => fs.existsSync(p));
  if (!executablePath) {
    // npx playwright chromium path fallback
    executablePath = undefined;
  }

  const browser = await chromium.launch({
    headless: true,
    executablePath,
    channel: executablePath ? undefined : "chrome",
  });

  const done = [];
  for (const vp of VIEWPORTS) {
    process.stdout.write(`capture ${vp.id}… `);
    await captureViewport(browser, vp);
    done.push(vp.id);
    console.log("ok");
  }
  await browser.close();
  fs.writeFileSync(path.join(OUT, "capture-manifest.json"), JSON.stringify({ origin: ORIGIN, emptyDay: EMPTY_DAY, busyDay: BUSY_DAY, viewports: done, at: new Date().toISOString() }, null, 2));
  console.log("wrote", OUT);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
