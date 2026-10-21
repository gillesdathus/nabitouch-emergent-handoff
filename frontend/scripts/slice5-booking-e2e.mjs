/**
 * Slice 5 — real-browser booking journey against local Vite + Docker QA API.
 * Uses cash/simulated payment only (no live Stripe).
 *
 * Usage:
 *   node scripts/slice5-booking-e2e.mjs
 * Env:
 *   BASE_URL=http://localhost:3025
 *   OUT_DIR=../test_reports/slice5-browser
 */
import { chromium, devices } from "playwright";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BASE = process.env.BASE_URL || "http://localhost:3025";
const OUT = path.resolve(process.env.OUT_DIR || path.join(__dirname, "../../test_reports/slice5-browser"));
fs.mkdirSync(OUT, { recursive: true });

const results = { ok: [], fail: [], quotes: [], bookings: [], platform: "playwright-chromium", startedAt: new Date().toISOString() };

async function shot(page, name) {
  const file = path.join(OUT, `${name}.png`);
  await page.screenshot({ path: file, fullPage: true });
  results.ok.push(`shot:${name}`);
  return file;
}

async function waitStep(page, testid, timeout = 20000) {
  await page.getByTestId(testid).waitFor({ state: "visible", timeout });
}

async function runJourney(label, viewport, setup) {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    ...viewport,
    locale: "en-CA",
  });
  const page = await context.newPage();
  const log = [];
  try {
    await page.goto(`${BASE}/book`, { waitUntil: "networkidle", timeout: 60000 });
    await waitStep(page, "booking-regular-flow");

    // Where — mobile home
    await waitStep(page, "step-where-home");
    await page.getByTestId("step-where-home").click();
    await page.getByTestId("booking-next-btn").click().catch(() => {});

    // Address search (synthetic QA fixture catalogue)
    await typeReact(page, "step-where-address-input", "10150 104");
    await page.waitForTimeout(900);
    await shot(page, `${label}-address-search`);

    const suggestion = page.getByTestId("step-where-address-option-0");
    await suggestion.waitFor({ state: "visible", timeout: 15000 });
    await suggestion.click();
    await page.waitForTimeout(600);

    await waitStep(page, "step-where-address-confirm-card");
    await shot(page, `${label}-address-confirm`);
    // Incomplete postal only: type when the incomplete field is shown.
    const postal = page.getByTestId("step-where-address-postal-input");
    if (await postal.count()) await typeReact(page, "step-where-address-postal-input", "T5J 2R4");
    await page.getByTestId("step-where-address-confirm").click();
    const addrErr = page.getByTestId("step-where-address-error");
    await Promise.race([
      page.getByTestId("step-where-address-details-ask").waitFor({ state: "visible", timeout: 20000 }),
      addrErr.waitFor({ state: "visible", timeout: 20000 }).then(async () => {
        throw new Error(`address confirm failed: ${await addrErr.innerText()}`);
      }),
    ]);
    await shot(page, `${label}-address-details-ask`);
    await page.getByTestId("step-where-address-details-yes").click();
    await waitStep(page, "step-where-address-details-form");
    await typeReact(page, "step-where-address-unit-input", "4");
    await typeReact(page, "step-where-address-access-input", "Buzz 12");
    await typeReact(page, "step-where-address-notes-input", "Park in visitor stall");
    await page.getByTestId("step-where-address-details-continue").click();
    // Details Continue advances to Service (or sticky Continue as fallback).
    await page.waitForTimeout(400);
    const onService = page.getByTestId("step-service");
    if (!(await onService.count())) {
      const continueWhere = page.getByTestId("booking-next-btn");
      await expectEnabled(continueWhere);
      await continueWhere.click();
    }
    // Service
    await waitStep(page, "step-service");
    await shot(page, `${label}-service`);
    const swedish = page.getByTestId("step-service-swedish");
    if (await swedish.count()) await swedish.click();
    else await page.locator("[data-testid^='step-service-']").first().click();

    // Duration (auto-advance after service)
    await waitStep(page, "step-duration");
    await shot(page, `${label}-duration`);
    await page.getByTestId("step-duration-60").click();

    // When — walk date chips until availability appears
    await waitStep(page, "step-when");
    await page.waitForTimeout(800);
    await page.getByTestId("step-pract-any").click().catch(() => {});
    const dateChips = page.locator("[data-testid^='step-date-']");
    await dateChips.first().waitFor({ state: "visible", timeout: 20000 });
    const dateCount = await dateChips.count();
    let picked = false;
    for (let i = 0; i < dateCount; i += 1) {
      await dateChips.nth(i).click();
      await page.waitForTimeout(900);
      await page.getByTestId("step-pract-any").click().catch(() => {});
      await page.waitForTimeout(900);
      const timeBtn = page.locator("[data-testid^='step-time-']").first();
      if (await timeBtn.count()) {
        await timeBtn.click();
        picked = true;
        break;
      }
    }
    if (!picked) throw new Error("no available date/time slots in QA schedule");
    await shot(page, `${label}-datetime`);
    await page.getByTestId("booking-next-btn").click();

    // You — guest details
    await waitStep(page, "step-you-contact");
    const stamp = Date.now();
    await page.getByTestId("guest-firstName-input").fill("Slice");
    await page.getByTestId("guest-lastName-input").fill("Five");
    await page.getByTestId("guest-email-input").fill(`slice5.${stamp}@nabitouch.test`);
    await page.getByTestId("guest-phone-input").fill("7805550199");
    // Prefer guest checkout without profile when checkbox present
    const createProfile = page.getByTestId("guest-create-profile-checkbox");
    if (await createProfile.count()) {
      const checked = await createProfile.isChecked();
      if (checked) await createProfile.uncheck();
    }
    await page.getByTestId("booking-next-btn").click();

    // Payment — cash (simulated / no live card)
    await waitStep(page, "step-pay-cash");
    await shot(page, `${label}-payment`);
    await page.getByTestId("step-pay-cash").click();
    await page.getByTestId("booking-next-btn").click();

    // Review
    await waitStep(page, "step-review");
    const review = page.getByTestId("step-review");
    await review.getByTestId("price-breakdown").waitFor({ state: "visible", timeout: 20000 });
    await shot(page, `${label}-review`);
    const totalText = await review.getByTestId("breakdown-total").innerText().catch(() => "");
    const travelText = await review.getByTestId("breakdown-travel").innerText().catch(() => "");
    results.quotes.push({ label, totalText, travelText });

    // Back navigation preserves review → payment
    await page.getByTestId("booking-back-btn").click();
    await waitStep(page, "step-pay-cash");
    await page.getByTestId("booking-next-btn").click();
    await waitStep(page, "step-review");

    // Confirm booking
    const confirm = page.getByTestId("booking-confirm-btn");
    await confirm.waitFor({ state: "visible", timeout: 20000 });
    await expectEnabled(confirm);
    await confirm.click();
    await waitStep(page, "booking-confirmation", 30000);
    const ref = await page.getByTestId("booking-ref").innerText();
    results.bookings.push({ label, ref });
    await shot(page, `${label}-confirmation`);

    // Viewport contract: sticky bar portaled + primary CTA inside first screen.
    const vh = page.viewportSize().height;
    const ctaMetrics = await page.evaluate(() => {
      const bar = document.querySelector("[data-testid=booking-confirmation-actions]");
      const btn = document.querySelector("[data-testid=confirmation-view-visit-btn]");
      const br = btn?.getBoundingClientRect();
      return {
        parent: bar?.parentElement?.tagName || null,
        position: bar ? getComputedStyle(bar).position : null,
        bottom: br?.bottom ?? null,
        top: br?.top ?? null,
      };
    });
    const ctaOk =
      ctaMetrics.parent === "BODY" &&
      (ctaMetrics.position === "fixed" || ctaMetrics.position === "static") &&
      ctaMetrics.bottom != null &&
      ctaMetrics.bottom <= vh + 1 &&
      ctaMetrics.top >= 0;
    if (!ctaOk) {
      throw new Error(`confirmation CTA out of viewport: ${JSON.stringify({ vh, ...ctaMetrics })}`);
    }
    results.ok.push(`cta-in-viewport:${label}`);
    fs.writeFileSync(path.join(OUT, `${label}-confirmation-cta.json`), JSON.stringify({ vh, ...ctaMetrics }, null, 2));

    // Duplicate submit guard — navigate back to book with same flow briefly not required;
    // idempotency covered by backend QA. Record confirmation present.
    log.push("confirmation:" + ref);
    results.ok.push(`journey:${label}`);
  } catch (err) {
    results.fail.push({ label, error: String(err && err.message || err), log });
    await shot(page, `${label}-ERROR`).catch(() => {});
  } finally {
    await browser.close();
  }
}

async function expectEnabled(locator) {
  for (let i = 0; i < 40; i += 1) {
    if (await locator.isEnabled()) return;
    await locator.page().waitForTimeout(250);
  }
  throw new Error("control stayed disabled");
}

/** Playwright fill can miss React controlled onChange; type with delay for reliability. */
async function typeReact(page, testid, value) {
  const el = page.getByTestId(testid);
  await el.click();
  await el.fill("");
  await el.pressSequentially(value, { delay: 20 });
}

async function main() {
  // Desktop
  await runJourney("desktop-1280", { viewport: { width: 1280, height: 800 } });
  // Mobile short viewport
  await runJourney("mobile-390", {
    ...devices["iPhone 12"],
    viewport: { width: 390, height: 700 },
  });

  const reportPath = path.join(OUT, "e2e-results.json");
  results.finishedAt = new Date().toISOString();
  results.baseUrl = BASE;
  fs.writeFileSync(reportPath, JSON.stringify(results, null, 2));
  console.log(JSON.stringify(results, null, 2));
  if (results.fail.length) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
