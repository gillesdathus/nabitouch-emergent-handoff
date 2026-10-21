/**
 * Slice C — sequential booking funnel + Back unwind (no sticky / no tap auto-advance).
 * Usage: BASE_URL=http://localhost:3025 node scripts/slice-c-acceptance.mjs
 */
import { chromium } from "playwright";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BASE = process.env.BASE_URL || "http://localhost:3025";
const OUT = path.resolve(process.env.OUT_DIR || path.join(__dirname, "../../test_reports/slice-c-acceptance"));
fs.mkdirSync(OUT, { recursive: true });

const report = { ok: [], fail: [], auto: {}, shots: [], startedAt: new Date().toISOString(), baseUrl: BASE };

function pass(name, detail = {}) {
  report.ok.push({ name, ...detail });
  console.log(`PASS ${name}`);
}
function fail(name, message) {
  report.fail.push({ name, message });
  console.log(`FAIL ${name} — ${message}`);
}

async function typeReact(page, testid, value) {
  const el = page.getByTestId(testid);
  await el.click();
  await el.fill("");
  await el.pressSequentially(value, { delay: 10 });
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

async function stillOnBook(page) {
  if (!/\/book/.test(page.url())) throw new Error(`left /book → ${page.url()}`);
}

async function pickTime(page) {
  await page.getByTestId("step-pract-any").click().catch(() => {});
  const dateChips = page.locator("[data-testid^='step-date-']");
  await dateChips.first().waitFor({ state: "visible", timeout: 20000 });
  for (let i = 0; i < await dateChips.count(); i += 1) {
    await dateChips.nth(i).click();
    await page.waitForTimeout(650);
    await page.getByTestId("step-pract-any").click().catch(() => {});
    const timeBtn = page.locator("[data-testid^='step-time-']").first();
    if (await timeBtn.count()) {
      await timeBtn.click();
      return true;
    }
  }
  return false;
}

async function continueStep(page) {
  await page.getByTestId("booking-next-btn").click();
  await page.waitForTimeout(250);
}

async function main() {
  const viewport = { width: 390, height: 844 };
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport, locale: "en-CA", hasTouch: true, isMobile: true });
  const page = await context.newPage();

  try {
    await gotoStable(page, `${BASE}/`);
    await page.evaluate(() => { try { localStorage.removeItem("nt_booking_draft_v1"); } catch { /* ignore */ } });
    await gotoStable(page, `${BASE}/book`);
    await page.getByTestId("booking-regular-flow").waitFor({ state: "visible", timeout: 20000 });

    if (await page.locator("[data-testid=booking-sticky-actions]").count()) {
      throw new Error("sticky booking actions still present");
    }
    if (await page.getByTestId("client-bottom").count()) {
      throw new Error("bottom nav visible during booking");
    }
    pass("focused-chrome-no-sticky");

    // —— Where → Service (Continue after address settles)
    await page.getByTestId("step-where-home").click();
    await typeReact(page, "step-where-address-input", "10150 104");
    await page.waitForTimeout(850);
    await page.getByTestId("step-where-address-option-0").click();
    await page.getByTestId("step-where-address-confirm-card").waitFor({ state: "visible", timeout: 15000 });
    if (await page.getByTestId("step-where-address-postal-input").count()) {
      await typeReact(page, "step-where-address-postal-input", "T5J 2R4");
      await page.waitForFunction(() => {
        const btn = document.querySelector("[data-testid=step-where-address-confirm]");
        return btn && !btn.disabled;
      }, null, { timeout: 5000 });
    }
    await page.getByTestId("step-where-address-confirm").click();
    await page.getByTestId("step-where-address-details-ask").waitFor({ state: "visible", timeout: 20000 });
    await page.getByTestId("step-where-address-details-no").click();
    await page.getByTestId("booking-next-btn").waitFor({ state: "visible", timeout: 15000 });
    await continueStep(page);
    await page.getByTestId("step-service").waitFor({ state: "visible", timeout: 15000 });
    report.auto.addressToService = true;
    await shot(page, "c-01-service");
    pass("where-to-service");

    // —— Service → Duration (Continue)
    await page.getByTestId("step-service-swedish").click();
    await continueStep(page);
    await page.getByTestId("step-duration").waitFor({ state: "visible", timeout: 15000 });
    report.auto.serviceToDuration = true;
    await shot(page, "c-02-duration");
    pass("service-to-duration");

    // —— Duration → When (Continue)
    await page.getByTestId("step-duration-60").click();
    await continueStep(page);
    await page.getByTestId("step-when").waitFor({ state: "visible", timeout: 15000 });
    report.auto.durationToWhen = true;
    await shot(page, "c-03-when");
    pass("duration-to-when");

    // —— When → Preferences (Continue after time)
    if (!(await pickTime(page))) throw new Error("no time slots");
    await continueStep(page);
    await page.getByTestId("step-preferences").waitFor({ state: "visible", timeout: 15000 });
    report.auto.whenToPreferences = true;
    await shot(page, "c-04-preferences");
    pass("when-to-preferences");

    // —— Preferences → Details (Continue; optional step)
    await continueStep(page);
    await page.getByTestId("step-you-contact").waitFor({ state: "visible", timeout: 15000 });
    report.auto.preferencesToDetails = true;
    await shot(page, "c-05-details");
    pass("preferences-to-details");

    // —— Details → Review & payment (Continue)
    const stamp = Date.now();
    await page.getByTestId("guest-firstName-input").fill("Slice");
    await page.getByTestId("guest-lastName-input").fill("Charlie");
    await page.getByTestId("guest-email-input").fill(`slice.c.${stamp}@nabitouch.test`);
    await page.getByTestId("guest-phone-input").fill("7805550199");
    if (await page.getByTestId("guest-create-profile-details").count()) {
      // Profile creation stays collapsed by default for guest booking.
      const open = await page.getByTestId("guest-create-profile-details").evaluate((el) => el.open);
      if (open && await page.getByTestId("guest-create-profile-checkbox").count()) {
        if (await page.getByTestId("guest-create-profile-checkbox").isChecked()) {
          await page.getByTestId("guest-create-profile-checkbox").uncheck();
        }
      }
    }
    await continueStep(page);
    await page.getByTestId("step-review").waitFor({ state: "visible", timeout: 15000 });
    await page.getByTestId("step-pay-cash").waitFor({ state: "visible", timeout: 15000 });
    await shot(page, "c-06-review");
    pass("details-to-review-payment");

    await page.getByTestId("step-pay-cash").click();
    report.auto.payOnReview = true;
    pass("pay-choice-on-review");

    // —— UI Back unwind: Review → Details → Preferences → When
    await page.getByTestId("booking-back-btn").click();
    await page.getByTestId("step-you-contact").waitFor({ state: "visible", timeout: 10000 });
    await stillOnBook(page);
    pass("back-review-to-details");

    await page.getByTestId("booking-back-btn").click();
    await page.getByTestId("step-preferences").waitFor({ state: "visible", timeout: 10000 });
    await stillOnBook(page);
    pass("back-details-to-preferences");

    await page.getByTestId("booking-back-btn").click();
    await page.getByTestId("step-when").waitFor({ state: "visible", timeout: 10000 });
    await stillOnBook(page);
    await shot(page, "c-07-back-to-when");
    pass("back-preferences-to-when");

    await page.goBack();
    await page.waitForTimeout(500);
    await stillOnBook(page);
    const onBookingStep = (await page.getByTestId("step-you-contact").count())
      || (await page.getByTestId("step-when").count())
      || (await page.getByTestId("step-preferences").count())
      || (await page.getByTestId("step-review").count())
      || (await page.getByTestId("step-duration").count());
    if (!onBookingStep) throw new Error("history Back left the booking step content");
    pass("history-back-stays-on-book");

    // Re-advance to Review from wherever history left us.
    for (let guard = 0; guard < 12; guard += 1) {
      if (await page.getByTestId("step-review").count()) break;
      if (await page.getByTestId("step-when").count()) {
        if (!(await pickTime(page))) throw new Error("no slots while recovering to review");
        await continueStep(page);
        continue;
      }
      if (await page.getByTestId("step-preferences").count()) {
        await continueStep(page);
        continue;
      }
      if (await page.getByTestId("step-you-contact").count()) {
        const next = page.getByTestId("booking-next-btn");
        if (!(await next.count()) || !(await next.isEnabled())) {
          await page.getByTestId("guest-firstName-input").fill("Slice");
          await page.getByTestId("guest-lastName-input").fill("Charlie");
          await page.getByTestId("guest-email-input").fill(`slice.c2.${stamp}@nabitouch.test`);
          await page.getByTestId("guest-phone-input").fill("7805550199");
        }
        await continueStep(page);
        continue;
      }
      if (await page.getByTestId("step-duration").count()) {
        await page.getByTestId("step-duration-60").click({ force: true });
        await continueStep(page);
        continue;
      }
      await page.waitForTimeout(300);
    }
    await page.getByTestId("step-review").waitFor({ state: "visible", timeout: 20000 });
    if (await page.getByTestId("step-pay-cash").count()) {
      await page.getByTestId("step-pay-cash").click({ force: true });
    }
    const confirm = page.getByTestId("booking-confirm-btn");
    await confirm.waitFor({ state: "visible", timeout: 15000 });
    if (!(await page.locator("[data-testid=booking-flow-shell]").locator("[data-testid=booking-confirm-btn]").count())) {
      throw new Error("confirm button not in-flow");
    }
    await shot(page, "c-08-review-ready");
    pass("review-confirm-in-flow");
  } catch (err) {
    await shot(page, "c-ERROR").catch(() => {});
    fail("slice-c", String(err?.message || err));
  } finally {
    await browser.close();
  }

  report.finishedAt = new Date().toISOString();
  const outFile = path.join(OUT, "slice-c-acceptance.json");
  fs.writeFileSync(outFile, JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ ok: report.ok.length, fail: report.fail.length, outFile, auto: report.auto }, null, 2));
  if (report.fail.length) process.exit(1);
}

main().catch((e) => { console.error(e); process.exit(1); });
