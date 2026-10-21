/**
 * Slice E — availability progressive sticky CTA acceptance.
 * Usage: BASE_URL=http://localhost:3025 node scripts/slice-e-acceptance.mjs
 */
import { chromium } from "playwright";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BASE = process.env.BASE_URL || "http://localhost:3025";
const OUT = path.resolve(path.join(__dirname, "../../test_reports/slice-e-acceptance"));
fs.mkdirSync(OUT, { recursive: true });

const report = { ok: [], fail: [], shots: [], startedAt: new Date().toISOString(), baseUrl: BASE };

function pass(name, detail = {}) {
  report.ok.push({ name, ...detail });
  console.log(`PASS ${name}`);
}
function fail(name, message) {
  report.fail.push({ name, message });
  console.log(`FAIL ${name} — ${message}`);
}

async function shot(page, name) {
  const file = path.join(OUT, `${name}.png`);
  await page.screenshot({ path: file, fullPage: false });
  report.shots.push(file);
}

async function gotoStable(page, url) {
  for (let i = 0; i < 3; i += 1) {
    try {
      await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60000 });
      return;
    } catch (err) {
      if (i === 2) throw err;
      await page.waitForTimeout(350);
    }
  }
}

async function assertSticky(page, testid, vh) {
  const metrics = await page.evaluate((id) => {
    const bar = document.querySelector(`[data-testid="${id}"]`);
    if (!bar) return { missing: true };
    const box = bar.getBoundingClientRect();
    const cs = getComputedStyle(bar);
    return {
      missing: false,
      parent: bar.parentElement?.tagName || null,
      position: cs.position,
      bottom: box.bottom,
      className: bar.className,
    };
  }, testid);
  if (metrics.missing) throw new Error(`${testid} missing`);
  if (metrics.parent !== "BODY") throw new Error(`${testid} parent ${metrics.parent}`);
  if (metrics.position !== "fixed") throw new Error(`${testid} position ${metrics.position}`);
  if (!/nb-sticky-actions/.test(metrics.className)) throw new Error(`${testid} missing sticky class`);
  if (metrics.bottom > vh + 1) throw new Error(`${testid} bottom ${metrics.bottom} > vh ${vh}`);
  return metrics;
}

async function loginPractitioner(page) {
  await gotoStable(page, `${BASE}/login`);
  const res = await page.request.post(`${BASE}/api/auth/demo-login`, {
    data: { role: "practitioner", subject: "p-maya" },
    headers: { "Content-Type": "application/json" },
  });
  if (!res.ok()) throw new Error(`demo-login failed ${res.status()} via ${BASE}/api`);
  const me = await page.request.get(`${BASE}/api/auth/me`);
  if (!me.ok()) throw new Error(`auth/me failed ${me.status()} after demo-login`);
  await gotoStable(page, `${BASE}/pro/availability`);
}

async function openAction(page, id) {
  const adjust = page.getByTestId("schedule-adjust");
  await adjust.waitFor({ state: "visible", timeout: 15000 });
  await adjust.click();
  await page.getByTestId("schedule-action-picker").waitFor({ state: "visible", timeout: 8000 });
  await page.getByTestId(`schedule-action-${id}`).click();
}

async function main() {
  const viewport = { width: 390, height: 844 };
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport, locale: "en-CA", hasTouch: true, isMobile: true });
  const page = await context.newPage();

  try {
    await loginPractitioner(page);
    await page.getByTestId("availability-page").waitFor({ state: "visible", timeout: 25000 });
    await assertSticky(page, "schedule-adjust-actions", viewport.height);
    await shot(page, "e-adjust-sticky");
    pass("adjust-schedule-sticky");

    await openAction(page, "weekly");
    await page.getByTestId("schedule-editor-weekly").waitFor({ state: "visible", timeout: 10000 });
    await page.getByTestId("weekly-days-phase").waitFor({ state: "visible", timeout: 5000 });
    if (!(await page.getByTestId("schedule-editor-weekly-actions").count())) throw new Error("weekly docked actions missing");
    if (await page.getByTestId("schedule-adjust").count()) throw new Error("adjust sticky should hide while editor open");
    await page.getByTestId("schedule-editor-weekly-continue").click();
    await page.getByTestId("weekly-hours-phase").waitFor({ state: "visible", timeout: 5000 });
    if (!(await page.getByTestId("schedule-editor-weekly-save").count())) throw new Error("weekly save missing after continue");
    await shot(page, "e-weekly-hours");
    pass("weekly-progressive-docked");

    await page.getByTestId("schedule-editor-weekly-cancel").click();
    await page.getByTestId("schedule-editor-weekly").waitFor({ state: "hidden", timeout: 8000 }).catch(async () => {
      await page.keyboard.press("Escape");
    });
    await page.getByTestId("schedule-adjust").waitFor({ state: "visible", timeout: 10000 });

    await openAction(page, "off");
    await page.getByTestId("timeoff-mode-phase").waitFor({ state: "visible", timeout: 8000 });
    if (!(await page.getByTestId("schedule-editor-off-actions").count())) throw new Error("timeoff docked actions missing");
    await page.getByTestId("schedule-editor-off-continue").click();
    await page.getByTestId("timeoff-details-phase").waitFor({ state: "visible", timeout: 5000 });
    if (!(await page.getByTestId("schedule-editor-off-save").count())) throw new Error("time off save missing on details");
    await shot(page, "e-timeoff-details");
    pass("timeoff-progressive-docked");

    await page.getByTestId("schedule-editor-off-cancel").click();
    await page.getByTestId("schedule-adjust").waitFor({ state: "visible", timeout: 10000 });
    await shot(page, "e-adjust-restored");
    pass("adjust-restored-after-editor");
  } catch (err) {
    await shot(page, "e-ERROR").catch(() => {});
    fail("slice-e", String(err?.message || err));
  } finally {
    await browser.close();
  }

  report.finishedAt = new Date().toISOString();
  const outFile = path.join(OUT, "slice-e-acceptance.json");
  fs.writeFileSync(outFile, JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ ok: report.ok.length, fail: report.fail.length, outFile }, null, 2));
  if (report.fail.length) process.exit(1);
}

main().catch((e) => { console.error(e); process.exit(1); });
