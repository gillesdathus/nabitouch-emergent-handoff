/**
 * Slice A — Find → Confirm → Details address UX screenshots.
 * Usage: node scripts/address-flow-audit.mjs
 */
import { chromium } from "playwright";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BASE = process.env.BASE_URL || "http://localhost:3025";
const OUT = path.resolve(process.env.OUT_DIR || path.join(__dirname, "../../test_reports/address-flow"));
fs.mkdirSync(OUT, { recursive: true });

async function typeReact(page, testid, value) {
  const el = page.getByTestId(testid);
  await el.click();
  await el.fill("");
  await el.pressSequentially(value, { delay: 15 });
}

async function shot(page, name) {
  const file = path.join(OUT, `${name}.png`);
  await page.screenshot({ path: file, fullPage: false });
  return file;
}

async function run(viewport, label) {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport, locale: "en-CA", hasTouch: true, isMobile: viewport.width < 768 });
  const page = await context.newPage();
  const result = { label, viewport, shots: [], checks: [] };
  try {
    await page.goto(`${BASE}/book`, { waitUntil: "networkidle", timeout: 60000 });
    await page.getByTestId("booking-regular-flow").waitFor({ state: "visible", timeout: 20000 });
    await page.getByTestId("step-where-home").click();
    await page.getByTestId("booking-next-btn").click().catch(() => {});

    // Find
    await page.getByTestId("step-where-address-find").waitFor({ state: "visible", timeout: 10000 }).catch(() => {});
    result.shots.push(await shot(page, `${label}-01-find`));

    await typeReact(page, "step-where-address-input", "10150 104");
    await page.waitForTimeout(900);
    await page.getByTestId("step-where-address-option-0").waitFor({ state: "visible", timeout: 15000 });
    await page.getByTestId("step-where-address-option-0").click();
    await page.getByTestId("step-where-address-confirm-card").waitFor({ state: "visible", timeout: 15000 });

    // Confirm — no unit/postal fields when postal is known
    const unitVisible = await page.getByTestId("step-where-address-unit-input").count();
    const searchVisible = await page.getByTestId("step-where-address-input").count();
    if (unitVisible) result.checks.push("unit field still visible on confirm");
    if (searchVisible) result.checks.push("search field still visible on confirm");
    result.shots.push(await shot(page, `${label}-02-confirm`));

    const postal = page.getByTestId("step-where-address-postal-input");
    if (await postal.count()) {
      await typeReact(page, "step-where-address-postal-input", "T5J 2R4");
      await page.waitForFunction(() => {
        const btn = document.querySelector("[data-testid=step-where-address-confirm]");
        return btn && !btn.disabled;
      }, null, { timeout: 5000 });
    }
    await page.getByTestId("step-where-address-confirm").click();
    await page.getByTestId("step-where-address-details-ask").waitFor({ state: "visible", timeout: 20000 });
    result.shots.push(await shot(page, `${label}-03-details-ask`));

    await page.getByTestId("step-where-address-details-yes").click();
    await page.getByTestId("step-where-address-details-form").waitFor({ state: "visible", timeout: 10000 });
    result.shots.push(await shot(page, `${label}-04-details-form`));

    const continueBox = await page.getByTestId("step-where-address-details-continue").boundingBox();
    if (!continueBox || continueBox.bottom > viewport.height + 1) {
      result.checks.push(`details Continue out of viewport bottom=${continueBox?.bottom}`);
    }

    await typeReact(page, "step-where-address-unit-input", "4");
    await typeReact(page, "step-where-address-access-input", "Buzz 12");
    await typeReact(page, "step-where-address-notes-input", "Visitor parking");
    await page.getByTestId("step-where-address-details-continue").click();
    await page.getByTestId("step-service").waitFor({ state: "visible", timeout: 15000 });
    result.shots.push(await shot(page, `${label}-05-service`));

  } catch (err) {
    result.checks.push(String(err && err.message || err));
    await page.screenshot({ path: path.join(OUT, `${label}-ERROR.png`), fullPage: true }).catch(() => {});
  } finally {
    await browser.close();
  }
  return result;
}

async function main() {
  const report = { ok: [], fail: [], startedAt: new Date().toISOString(), baseUrl: BASE };
  for (const vp of [
    { label: "addr-375x667", viewport: { width: 375, height: 667 } },
    { label: "addr-390x844", viewport: { width: 390, height: 844 } },
  ]) {
    const row = await run(vp.viewport, vp.label);
    if (row.checks.length) report.fail.push(row);
    else report.ok.push(row);
  }
  report.finishedAt = new Date().toISOString();
  fs.writeFileSync(path.join(OUT, "address-flow-results.json"), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
  if (report.fail.length) process.exit(1);
}

main().catch((e) => { console.error(e); process.exit(1); });
