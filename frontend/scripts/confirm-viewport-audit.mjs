/**
 * Booking confirmation — primary CTA must sit inside the initial viewport
 * above bottom nav + safe area (StickyActionBar portaled to document.body).
 *
 * Usage: node scripts/confirm-viewport-audit.mjs
 * Env: BASE_URL=http://localhost:3025  OUT_DIR=../test_reports/confirm-viewport
 */
import { chromium, devices } from "playwright";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BASE = process.env.BASE_URL || "http://localhost:3025";
const OUT = path.resolve(process.env.OUT_DIR || path.join(__dirname, "../../test_reports/confirm-viewport"));
fs.mkdirSync(OUT, { recursive: true });

const report = { ok: [], fail: [], shots: [], startedAt: new Date().toISOString(), baseUrl: BASE };

async function typeReact(page, testid, value) {
  const el = page.getByTestId(testid);
  await el.click();
  await el.fill("");
  await el.pressSequentially(value, { delay: 15 });
}

async function expectEnabled(locator) {
  for (let i = 0; i < 40; i += 1) {
    if (await locator.isEnabled()) return;
    await locator.page().waitForTimeout(250);
  }
  throw new Error("control stayed disabled");
}

async function bookToConfirmation(page) {
  await page.goto(`${BASE}/book`, { waitUntil: "networkidle", timeout: 60000 });
  await page.evaluate(() => { try { localStorage.removeItem("nt_booking_draft_v1"); } catch { /* ignore */ } });
  await page.goto(`${BASE}/book`, { waitUntil: "networkidle", timeout: 60000 });
  await page.getByTestId("booking-regular-flow").waitFor({ state: "visible", timeout: 20000 });
  await page.getByTestId("step-where-home").click();
  await typeReact(page, "step-where-address-input", "10150 104");
  await page.waitForTimeout(900);
  await page.getByTestId("step-where-address-option-0").waitFor({ state: "visible", timeout: 15000 });
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
  const swedish = page.getByTestId("step-service-swedish");
  if (await swedish.count()) await swedish.click();
  else await page.locator("[data-testid^='step-service-']").first().click();
  await page.getByTestId("step-duration").waitFor({ state: "visible", timeout: 15000 });
  await page.getByTestId("step-duration-60").click();
  await page.getByTestId("step-when").waitFor({ state: "visible", timeout: 15000 });
  await page.waitForTimeout(600);
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
      await timeBtn.click();
      picked = true;
      break;
    }
  }
  if (!picked) throw new Error("no slots");
  // Time selection auto-advances to You.
  await page.getByTestId("step-you-contact").waitFor({ state: "visible", timeout: 15000 });
  const stamp = Date.now();
  await page.getByTestId("guest-firstName-input").fill("Confirm");
  await page.getByTestId("guest-lastName-input").fill("Viewport");
  await page.getByTestId("guest-email-input").fill(`confirm.vp.${stamp}@nabitouch.test`);
  await page.getByTestId("guest-phone-input").fill("7805550188");
  const createProfile = page.getByTestId("guest-create-profile-checkbox");
  if (await createProfile.count() && await createProfile.isChecked()) await createProfile.uncheck();
  await expectEnabled(page.getByTestId("booking-next-btn"));
  await page.getByTestId("booking-next-btn").click();
  await page.getByTestId("step-pay-cash").waitFor({ state: "visible", timeout: 15000 });
  // Cash selection auto-advances to Review.
  await page.getByTestId("step-pay-cash").click();
  await page.getByTestId("step-review").waitFor({ state: "visible", timeout: 20000 });
  const confirm = page.getByTestId("booking-confirm-btn");
  await expectEnabled(confirm);
  await confirm.click();
  await page.getByTestId("booking-confirmation").waitFor({ state: "visible", timeout: 30000 });
}

async function assertPrimaryInViewport(page, label, viewport) {
  const vh = viewport.height;
  const vw = viewport.width;
  const actions = page.getByTestId("booking-confirmation-actions");
  await actions.waitFor({ state: "visible", timeout: 10000 });
  const btn = page.getByTestId("confirmation-view-visit-btn");
  await btn.waitFor({ state: "visible", timeout: 10000 });

  const metrics = await page.evaluate(() => {
    const bar = document.querySelector("[data-testid=booking-confirmation-actions]");
    const primary = document.querySelector("[data-testid=confirmation-view-visit-btn]");
    const home = document.querySelector("[data-testid=confirmation-home-btn]");
    const install = document.querySelector("[data-testid=install-prompt-card]");
    const total = document.querySelector("[data-testid=breakdown-total]");
    const due = document.querySelector("[data-testid=breakdown-due-now]");
    const cs = bar ? getComputedStyle(bar) : null;
    const br = primary ? primary.getBoundingClientRect() : null;
    const hr = home ? home.getBoundingClientRect() : null;
    const barBox = bar ? bar.getBoundingClientRect() : null;
    const totalBox = total ? total.getBoundingClientRect() : null;
    const dueBox = due ? due.getBoundingClientRect() : null;
    return {
      position: cs?.position || null,
      bottom: cs?.bottom || null,
      barParent: bar?.parentElement?.tagName || null,
      primary: br ? { top: br.top, bottom: br.bottom, height: br.height } : null,
      home: hr ? { top: hr.top, bottom: hr.bottom } : null,
      barTop: barBox?.top ?? null,
      totalBottom: totalBox?.bottom ?? null,
      dueBottom: dueBox?.bottom ?? null,
      installInDom: Boolean(install),
      installExpanded: install ? !install.querySelector("[data-testid=install-card-toggle]") || install.getAttribute("data-collapsed") === "false" : null,
      scrollY: window.scrollY,
      innerHeight: window.innerHeight,
      stickyBottom: getComputedStyle(document.documentElement).getPropertyValue("--nb-sticky-bottom").trim(),
    };
  });

  const shotPath = path.join(OUT, `${label}.png`);
  await page.screenshot({ path: shotPath, fullPage: false });
  report.shots.push(shotPath);

  const checks = [];
  if (metrics.barParent !== "BODY") checks.push(`barParent=${metrics.barParent} (expected BODY portal)`);
  if (metrics.position !== "fixed") checks.push(`position=${metrics.position} (expected fixed)`);
  if (!metrics.primary) checks.push("primary missing");
  else {
    if (metrics.primary.bottom > vh + 1) checks.push(`primary.bottom=${metrics.primary.bottom} > vh=${vh}`);
    if (metrics.primary.top < 0) checks.push(`primary.top=${metrics.primary.top} < 0`);
  }
  if (metrics.home && metrics.home.bottom > vh + 1) checks.push(`home.bottom=${metrics.home.bottom} > vh=${vh}`);
  if (metrics.scrollY > 2) checks.push(`scrollY=${metrics.scrollY} (should not need scroll for CTA)`);
  // Portrait phones: payment rows must clear the dock without scrolling.
  // Short landscape: CTAs stay fixed; totals may sit below the fold and scroll above the spacer.
  const portrait = vh >= vw;
  if (portrait) {
    if (metrics.totalBottom != null && metrics.barTop != null && metrics.totalBottom > metrics.barTop + 1) {
      checks.push(`breakdown-total covered (totalBottom=${metrics.totalBottom} > barTop=${metrics.barTop})`);
    }
    if (metrics.dueBottom != null && metrics.barTop != null && metrics.dueBottom > metrics.barTop + 1) {
      checks.push(`breakdown-due-now covered (dueBottom=${metrics.dueBottom} > barTop=${metrics.barTop})`);
    }
  }

  const row = { label, viewport: { width: vw, height: vh }, metrics, checks };
  if (checks.length) {
    report.fail.push(row);
    fs.writeFileSync(path.join(OUT, `${label}.json`), JSON.stringify(row, null, 2));
    throw new Error(`${label}: ${checks.join("; ")}`);
  }
  report.ok.push(row);
  fs.writeFileSync(path.join(OUT, `${label}.json`), JSON.stringify(row, null, 2));
}

const VIEWPORTS = [
  { label: "confirm-375x667", viewport: { width: 375, height: 667 }, device: null },
  { label: "confirm-390x844", viewport: { width: 390, height: 844 }, device: devices["iPhone 12"] },
  { label: "confirm-390x700-short", viewport: { width: 390, height: 700 }, device: null },
  { label: "confirm-667x375-landscape", viewport: { width: 667, height: 375 }, device: null },
];

async function runOne({ label, viewport, device }) {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    ...(device || {}),
    viewport,
    locale: "en-CA",
    // Simulate notched device safe area via CSS env if page supports it.
    hasTouch: true,
    isMobile: viewport.width < 768,
  });
  const page = await context.newPage();
  try {
    await bookToConfirmation(page);
    // Ensure install stays collapsed so it cannot steal first-viewport space.
    const toggle = page.getByTestId("install-card-toggle");
    if (await toggle.count()) {
      const expanded = await page.locator("[data-testid=install-prompt-card][data-expanded=true]").count();
      if (expanded) await toggle.click();
    }
    await assertPrimaryInViewport(page, label, viewport);
  } catch (err) {
    report.fail.push({ label, error: String(err && err.message || err) });
    await page.screenshot({ path: path.join(OUT, `${label}-ERROR.png`), fullPage: true }).catch(() => {});
  } finally {
    await browser.close();
  }
}

async function main() {
  for (const vp of VIEWPORTS) {
    await runOne(vp);
  }
  report.finishedAt = new Date().toISOString();
  const reportPath = path.join(OUT, "confirm-viewport-results.json");
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
  if (report.fail.length) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
