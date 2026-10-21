/**
 * Slice B — sequential booking shell: in-flow CTAs, no sticky bar, address owns mid-flow.
 * Usage: BASE_URL=http://localhost:3025 node scripts/slice-b-acceptance.mjs
 */
import { chromium } from "playwright";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BASE = process.env.BASE_URL || "http://localhost:3025";
const OUT = path.resolve(process.env.OUT_DIR || path.join(__dirname, "../../test_reports/slice-b-acceptance"));
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
      await page.waitForTimeout(400);
    }
  }
}

async function assertNoStickyBookingBar(page) {
  const sticky = await page.evaluate(() => {
    const bar = document.querySelector("[data-testid=booking-sticky-actions]");
    const stickyClass = document.querySelector(".nb-sticky-actions");
    const nav = document.querySelector("[data-testid=booking-step-nav]");
    return {
      stickyBar: !!bar,
      stickyClass: !!stickyClass,
      inFlowNav: !!nav,
      navInMain: !!(nav && document.querySelector("[data-testid=booking-flow-shell]")?.contains(nav)),
    };
  });
  if (sticky.stickyBar || sticky.stickyClass) throw new Error("sticky booking actions still present");
  if (!sticky.inFlowNav || !sticky.navInMain) throw new Error("in-flow booking-step-nav missing");
  return sticky;
}

async function main() {
  const viewport = { width: 390, height: 700 };
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport,
    locale: "en-CA",
    hasTouch: true,
    isMobile: true,
  });
  const page = await context.newPage();
  try {
    await gotoStable(page, `${BASE}/`);
    await page.evaluate(() => { try { localStorage.removeItem("nt_booking_draft_v1"); } catch { /* ignore */ } });
    await gotoStable(page, `${BASE}/book`);
    await page.getByTestId("booking-regular-flow").waitFor({ state: "visible", timeout: 20000 });
    await page.getByTestId("booking-compact-header").waitFor({ state: "visible", timeout: 5000 }).catch(() => {});
    if (await page.getByTestId("client-bottom").count()) {
      throw new Error("bottom nav visible during booking focus");
    }
    pass("bottom-nav-hidden");

    await page.getByTestId("step-where-home").click();

    // 1) During address confirm/details, shell Continue is hidden (picker owns CTAs).
    await typeReact(page, "step-where-address-input", "10150 104");
    await page.waitForTimeout(900);
    await page.getByTestId("step-where-address-option-0").click();
    await page.getByTestId("step-where-address-confirm-card").waitFor({ state: "visible", timeout: 15000 });
    if (await page.getByTestId("booking-next-btn").count()) {
      throw new Error("shell Continue visible while address picker owns confirm");
    }
    await shot(page, "b-address-owns-actions");
    pass("address-owns-hides-shell-continue");

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
    if (await page.getByTestId("booking-next-btn").count()) {
      throw new Error("shell Continue visible on details ask");
    }
    await page.getByTestId("step-where-address-details-no").click();
    await page.getByTestId("booking-next-btn").waitFor({ state: "visible", timeout: 15000 });
    await assertNoStickyBookingBar(page);
    await page.getByTestId("booking-next-btn").click();
    await page.getByTestId("step-service").waitFor({ state: "visible", timeout: 15000 });
    pass("where-continue-to-service");

    // 2) Service: Continue stays available; selection does not auto-advance.
    await assertNoStickyBookingBar(page);
    await page.getByTestId("step-service-swedish").click();
    await page.waitForTimeout(300);
    if (!(await page.getByTestId("step-service").count())) {
      throw new Error("service step auto-advanced unexpectedly");
    }
    await page.getByTestId("booking-next-btn").click();
    await page.getByTestId("step-duration").waitFor({ state: "visible", timeout: 15000 });
    await shot(page, "b-duration");
    pass("service-continue-no-auto-advance");

    // 3) Duration → When via Continue
    await page.getByTestId("step-duration-60").click();
    await page.getByTestId("booking-next-btn").click();
    await page.getByTestId("step-when").waitFor({ state: "visible", timeout: 15000 });
    await assertNoStickyBookingBar(page);
    await shot(page, "b-when-shell");
    pass("duration-continue-to-when");

    const hint = page.getByTestId("booking-continue-hint");
    if (await hint.count()) {
      const text = await hint.innerText();
      if (/complete this step to continue/i.test(text)) {
        throw new Error("generic complete-step hint still shown");
      }
    }
    pass("no-generic-hint-on-when");
  } catch (err) {
    await shot(page, "b-ERROR").catch(() => {});
    fail("slice-b", String(err?.message || err));
  } finally {
    await browser.close();
  }

  report.finishedAt = new Date().toISOString();
  const outFile = path.join(OUT, "slice-b-acceptance.json");
  fs.writeFileSync(outFile, JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ ok: report.ok.length, fail: report.fail.length, outFile }, null, 2));
  if (report.fail.length) process.exit(1);
}

main().catch((e) => { console.error(e); process.exit(1); });
