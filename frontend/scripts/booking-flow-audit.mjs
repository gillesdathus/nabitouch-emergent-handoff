/**
 * Slice C — booking progressive flow validation + screenshots.
 * Find→Confirm→Details → Service → Duration → When → You → Pay → Review → Confirmation
 */
import { chromium } from "playwright";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BASE = process.env.BASE_URL || "http://localhost:3025";
const OUT = path.resolve(process.env.OUT_DIR || path.join(__dirname, "../../test_reports/booking-flow"));
fs.mkdirSync(OUT, { recursive: true });

async function typeReact(page, testid, value) {
  const el = page.getByTestId(testid);
  await el.click();
  await el.fill("");
  await el.pressSequentially(value, { delay: 12 });
}

async function shot(page, name) {
  const file = path.join(OUT, `${name}.png`);
  await page.screenshot({ path: file, fullPage: false });
  return file;
}

async function run(viewport, label) {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport, locale: "en-CA", hasTouch: true, isMobile: true });
  const page = await context.newPage();
  const result = { label, viewport, shots: [], checks: [], auto: {} };
  try {
    await page.evaluate(() => { try { localStorage.removeItem("nt_booking_draft_v1"); } catch { /* ignore */ } });
    await page.goto(`${BASE}/book`, { waitUntil: "networkidle", timeout: 60000 });
    await page.getByTestId("booking-regular-flow").waitFor({ state: "visible", timeout: 20000 });
    await page.getByTestId("step-where-home").click();

    await typeReact(page, "step-where-address-input", "10150 104");
    await page.waitForTimeout(900);
    await page.getByTestId("step-where-address-option-0").click();
    await page.getByTestId("step-where-address-confirm-card").waitFor({ state: "visible", timeout: 15000 });
    result.shots.push(await shot(page, `${label}-01-address-confirm`));
    if (await page.getByTestId("step-where-address-postal-input").count()) {
      await typeReact(page, "step-where-address-postal-input", "T5J 2R4");
      await page.waitForFunction(() => {
        const btn = document.querySelector("[data-testid=step-where-address-confirm]");
        return btn && !btn.disabled;
      }, null, { timeout: 5000 });
    }
    await page.getByTestId("step-where-address-confirm").click();
    await page.getByTestId("step-where-address-details-ask").waitFor({ state: "visible", timeout: 20000 });
    result.shots.push(await shot(page, `${label}-02-details-ask`));
    await page.getByTestId("step-where-address-details-no").click();

    await page.getByTestId("step-service").waitFor({ state: "visible", timeout: 15000 });
    result.auto.addressToService = true;
    result.shots.push(await shot(page, `${label}-03-service`));
    // Shell Continue must not cover service tiles
    if (await page.getByTestId("booking-sticky-actions").count()) {
      const bar = await page.getByTestId("booking-sticky-actions").boundingBox();
      const tile = await page.getByTestId("step-service-swedish").boundingBox();
      if (bar && tile && tile.bottom > bar.top + 1) result.checks.push("service tile covered by sticky bar");
    }
    await page.getByTestId("step-service-swedish").click();

    await page.getByTestId("step-duration").waitFor({ state: "visible", timeout: 10000 });
    result.auto.serviceToDuration = true;
    result.shots.push(await shot(page, `${label}-04-duration`));
    await page.getByTestId("step-duration-60").click();

    await page.getByTestId("step-when").waitFor({ state: "visible", timeout: 10000 });
    result.auto.durationToWhen = true;
    await page.waitForTimeout(800);
    await page.getByTestId("step-pract-any").click().catch(() => {});
    const dateChips = page.locator("[data-testid^='step-date-']");
    await dateChips.first().waitFor({ state: "visible", timeout: 20000 });
    let picked = false;
    for (let i = 0; i < await dateChips.count(); i += 1) {
      await dateChips.nth(i).click();
      await page.waitForTimeout(700);
      await page.getByTestId("step-pract-any").click().catch(() => {});
      const timeBtn = page.locator("[data-testid^='step-time-']").first();
      if (await timeBtn.count()) {
        result.shots.push(await shot(page, `${label}-05-when`));
        await timeBtn.click();
        picked = true;
        break;
      }
    }
    if (!picked) throw new Error("no time slots");

    await page.getByTestId("step-you-contact").waitFor({ state: "visible", timeout: 15000 });
    result.auto.whenToYou = true;
    result.shots.push(await shot(page, `${label}-06-you`));
    const stamp = Date.now();
    await page.getByTestId("guest-firstName-input").fill("Flow");
    await page.getByTestId("guest-lastName-input").fill("Audit");
    await page.getByTestId("guest-email-input").fill(`flow.audit.${stamp}@nabitouch.test`);
    await page.getByTestId("guest-phone-input").fill("7805550177");
    if (await page.getByTestId("guest-create-profile-checkbox").count()) {
      if (await page.getByTestId("guest-create-profile-checkbox").isChecked()) {
        await page.getByTestId("guest-create-profile-checkbox").uncheck();
      }
    }
    await page.getByTestId("booking-next-btn").click();

    await page.getByTestId("step-pay-cash").waitFor({ state: "visible", timeout: 15000 });
    result.shots.push(await shot(page, `${label}-07-pay`));
    await page.getByTestId("step-pay-cash").click();

    await page.getByTestId("step-review").waitFor({ state: "visible", timeout: 15000 });
    result.auto.payToReview = true;
    result.shots.push(await shot(page, `${label}-08-review`));
    // Primary confirm in viewport
    const confirm = page.getByTestId("booking-confirm-btn");
    await confirm.waitFor({ state: "visible", timeout: 10000 });
    const box = await confirm.boundingBox();
    if (!box || box.bottom > viewport.height + 1) result.checks.push(`confirm out of viewport bottom=${box?.bottom}`);
    await confirm.click();

    await page.getByTestId("booking-confirmation").waitFor({ state: "visible", timeout: 30000 });
    result.shots.push(await shot(page, `${label}-09-confirmation`));
    const viewVisit = page.getByTestId("confirmation-view-visit-btn");
    await viewVisit.waitFor({ state: "visible", timeout: 5000 });
    const vbox = await viewVisit.boundingBox();
    if (!vbox || vbox.bottom > viewport.height + 1) result.checks.push(`view-visit out of viewport bottom=${vbox?.bottom}`);
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
    { label: "book-375x667", viewport: { width: 375, height: 667 } },
    { label: "book-390x844", viewport: { width: 390, height: 844 } },
  ]) {
    const row = await run(vp.viewport, vp.label);
    if (row.checks.length) report.fail.push(row);
    else report.ok.push(row);
  }
  report.finishedAt = new Date().toISOString();
  fs.writeFileSync(path.join(OUT, "booking-flow-results.json"), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
  if (report.fail.length) process.exit(1);
}

main().catch((e) => { console.error(e); process.exit(1); });
