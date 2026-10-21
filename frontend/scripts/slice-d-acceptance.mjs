/**
 * Slice D — onboarding sticky CTA acceptance (Welcome + Join).
 * Usage: BASE_URL=http://localhost:3025 node scripts/slice-d-acceptance.mjs
 */
import { chromium } from "playwright";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BASE = process.env.BASE_URL || "http://localhost:3025";
const OUT = path.resolve(process.env.OUT_DIR || path.join(__dirname, "../../test_reports/slice-d-acceptance"));
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
      top: box.top,
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

async function typeReact(page, testid, value) {
  const el = page.getByTestId(testid);
  await el.click();
  await el.fill("");
  await el.pressSequentially(value, { delay: 12 });
}

async function main() {
  const viewport = { width: 390, height: 700 };
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport, locale: "en-CA", hasTouch: true, isMobile: true });
  const page = await context.newPage();

  try {
    await gotoStable(page, `${BASE}/welcome`);
    await page.getByTestId("legacy-welcome").waitFor({ state: "visible", timeout: 20000 });
    await assertSticky(page, "welcome-sticky-actions", viewport.height);
    await shot(page, "d-welcome-identity");
    pass("welcome-identity-sticky");

    await typeReact(page, "welcome-last-name", "Client");
    await typeReact(page, "welcome-dob", "1990-01-01");
    await page.getByTestId("welcome-identity-continue").click();
    await page.getByTestId("welcome-credentials-title").waitFor({ state: "visible", timeout: 10000 });
    await assertSticky(page, "welcome-sticky-actions", viewport.height);
    if (!(await page.getByTestId("welcome-verify").count())) throw new Error("verify CTA missing");
    if (!(await page.getByTestId("welcome-identity-back").count())) throw new Error("back CTA missing");
    await shot(page, "d-welcome-credentials");
    pass("welcome-credentials-stacked-sticky");

    await gotoStable(page, `${BASE}/join?token=invite-demo`);
    await page.getByTestId("join-page").waitFor({ state: "visible", timeout: 20000 });
    await assertSticky(page, "join-sticky-actions", viewport.height);
    const submit = page.getByTestId("join-submit");
    if (!(await submit.isDisabled())) throw new Error("join submit should start disabled");
    await typeReact(page, "join-password", "password1");
    if (await submit.isDisabled()) throw new Error("join submit stayed disabled");
    await shot(page, "d-join-sticky");
    pass("join-sticky-gated");
  } catch (err) {
    await shot(page, "d-ERROR").catch(() => {});
    fail("slice-d", String(err?.message || err));
  } finally {
    await browser.close();
  }

  report.finishedAt = new Date().toISOString();
  const outFile = path.join(OUT, "slice-d-acceptance.json");
  fs.writeFileSync(outFile, JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ ok: report.ok.length, fail: report.fail.length, outFile }, null, 2));
  if (report.fail.length) process.exit(1);
}

main().catch((e) => { console.error(e); process.exit(1); });
