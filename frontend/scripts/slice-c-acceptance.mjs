/**
 * Slice C — booking progressive funnel + Back unwind acceptance.
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

    // —— Where → details No → Service (auto)
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
    await page.getByTestId("step-service").waitFor({ state: "visible", timeout: 15000 });
    report.auto.addressToService = true;
    await shot(page, "c-01-service");
    pass("address-to-service");

    // —— Service → Duration (auto)
    await page.getByTestId("step-service-swedish").click();
    await page.getByTestId("step-duration").waitFor({ state: "visible", timeout: 15000 });
    report.auto.serviceToDuration = true;
    await shot(page, "c-02-duration");
    pass("service-to-duration");

    // —— Duration → When (auto)
    await page.getByTestId("step-duration-60").click();
    await page.getByTestId("step-when").waitFor({ state: "visible", timeout: 15000 });
    report.auto.durationToWhen = true;
    await shot(page, "c-03-when");
    pass("duration-to-when");

    // —— When → You (auto on time)
    if (!(await pickTime(page))) throw new Error("no time slots");
    await page.getByTestId("step-you-contact").waitFor({ state: "visible", timeout: 15000 });
    report.auto.whenToYou = true;
    await shot(page, "c-04-you");
    pass("when-to-you");

    // —— You → Pay (Continue)
    const stamp = Date.now();
    await page.getByTestId("guest-firstName-input").fill("Slice");
    await page.getByTestId("guest-lastName-input").fill("Charlie");
    await page.getByTestId("guest-email-input").fill(`slice.c.${stamp}@nabitouch.test`);
    await page.getByTestId("guest-phone-input").fill("7805550199");
    if (await page.getByTestId("guest-create-profile-checkbox").count()) {
      if (await page.getByTestId("guest-create-profile-checkbox").isChecked()) {
        await page.getByTestId("guest-create-profile-checkbox").uncheck();
      }
    }
    await page.getByTestId("booking-next-btn").click();
    await page.getByTestId("step-pay-cash").waitFor({ state: "visible", timeout: 15000 });
    await shot(page, "c-05-pay");
    pass("you-to-pay");

    // —— Pay → Review (auto on cash)
    await page.getByTestId("step-pay-cash").click();
    await page.getByTestId("step-review").waitFor({ state: "visible", timeout: 15000 });
    report.auto.payToReview = true;
    await shot(page, "c-06-review");
    pass("pay-to-review");

    // —— UI Back unwind: Review → Pay → You → When (stay on /book)
    await page.getByTestId("booking-back-btn").click();
    await page.getByTestId("step-pay-cash").waitFor({ state: "visible", timeout: 10000 });
    await stillOnBook(page);
    pass("back-review-to-pay");

    await page.getByTestId("booking-back-btn").click();
    await page.getByTestId("step-you-contact").waitFor({ state: "visible", timeout: 10000 });
    await stillOnBook(page);
    pass("back-pay-to-you");

    await page.getByTestId("booking-back-btn").click();
    await page.getByTestId("step-when").waitFor({ state: "visible", timeout: 10000 });
    await stillOnBook(page);
    await shot(page, "c-07-back-to-when");
    pass("back-you-to-when");

    // Browser history Back should also unwind a step without leaving /book early.
    await page.goBack();
    await page.waitForTimeout(500);
    await stillOnBook(page);
    // May land on You (URL history) after leaving When via prior UI backs — either is OK if still booking.
    const onBookingStep = (await page.getByTestId("step-you-contact").count())
      || (await page.getByTestId("step-when").count())
      || (await page.getByTestId("step-pay-cash").count())
      || (await page.getByTestId("step-duration").count());
    if (!onBookingStep) throw new Error("history Back left the booking step content");
    pass("history-back-stays-on-book");

    // Re-advance to Review from wherever history left us (animations can detach tiles).
    for (let guard = 0; guard < 10; guard += 1) {
      if (await page.getByTestId("step-review").count()) break;
      if (await page.getByTestId("step-when").count()) {
        if (!(await pickTime(page))) throw new Error("no slots while recovering to review");
        await page.getByTestId("step-you-contact").waitFor({ state: "visible", timeout: 15000 });
        continue;
      }
      if (await page.getByTestId("step-you-contact").count()) {
        const next = page.getByTestId("booking-next-btn");
        if (!(await next.count()) || !(await next.isEnabled())) {
          await page.getByTestId("guest-firstName-input").fill("Slice");
          await page.getByTestId("guest-lastName-input").fill("Charlie");
          await page.getByTestId("guest-email-input").fill(`slice.c2.${stamp}@nabitouch.test`);
          await page.getByTestId("guest-phone-input").fill("7805550199");
          if (await page.getByTestId("guest-create-profile-checkbox").count()) {
            if (await page.getByTestId("guest-create-profile-checkbox").isChecked()) {
              await page.getByTestId("guest-create-profile-checkbox").uncheck();
            }
          }
        }
        await page.getByTestId("booking-next-btn").click();
        await page.waitForTimeout(400);
        continue;
      }
      if (await page.getByTestId("step-pay-cash").count()) {
        await page.getByTestId("step-pay-cash").click({ force: true });
        await Promise.race([
          page.getByTestId("step-review").waitFor({ state: "visible", timeout: 12000 }),
          page.waitForTimeout(1200),
        ]);
        continue;
      }
      if (await page.getByTestId("step-duration").count()) {
        await page.getByTestId("step-duration-60").click({ force: true });
        await page.waitForTimeout(400);
        continue;
      }
      await page.waitForTimeout(300);
    }
    await page.getByTestId("step-review").waitFor({ state: "visible", timeout: 20000 });
    const confirm = page.getByTestId("booking-confirm-btn");
    await confirm.waitFor({ state: "visible", timeout: 10000 });
    for (let i = 0; i < 40 && !(await confirm.isEnabled()); i += 1) await page.waitForTimeout(250);
    if (!(await confirm.isEnabled())) throw new Error("confirm stayed disabled");
    const cbox = await confirm.boundingBox();
    if (!cbox || cbox.bottom > viewport.height + 1) throw new Error(`confirm out of viewport bottom=${cbox?.bottom}`);
    await confirm.click();

    await page.getByTestId("booking-confirmation").waitFor({ state: "visible", timeout: 30000 });
    await shot(page, "c-08-confirmation");
    const viewVisit = page.getByTestId("confirmation-view-visit-btn");
    await viewVisit.waitFor({ state: "visible", timeout: 8000 });
    const vbox = await viewVisit.boundingBox();
    if (!vbox || vbox.bottom > viewport.height + 1) throw new Error(`view-visit out of viewport bottom=${vbox?.bottom}`);
    pass("review-to-confirmation");
  } catch (err) {
    await shot(page, "c-ERROR").catch(() => {});
    fail("slice-c", String(err?.message || err));
  } finally {
    await browser.close();
  }

  report.finishedAt = new Date().toISOString();
  const outFile = path.join(OUT, "slice-c-acceptance.json");
  fs.writeFileSync(outFile, JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ ok: report.ok.length, fail: report.fail.length, auto: report.auto, outFile }, null, 2));
  if (report.fail.length) process.exit(1);
}

main().catch((e) => { console.error(e); process.exit(1); });
