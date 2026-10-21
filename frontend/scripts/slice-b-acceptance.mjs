/**
 * Slice B — FlowStepShell / sticky CTA acceptance on short mobile viewports.
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
  await el.pressSequentially(value, { delay: 12 });
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

async function assertBarInViewport(page, vh) {
  const metrics = await page.evaluate(() => {
    const bar = document.querySelector("[data-testid=booking-sticky-actions]");
    if (!bar) return { missing: true };
    const box = bar.getBoundingClientRect();
    const cs = getComputedStyle(bar);
    return {
      missing: false,
      position: cs.position,
      top: box.top,
      bottom: box.bottom,
      parent: bar.parentElement?.tagName || null,
    };
  });
  if (metrics.missing) throw new Error("sticky bar missing");
  if (metrics.parent !== "BODY") throw new Error(`bar parent ${metrics.parent}, expected BODY`);
  if (metrics.position !== "fixed") throw new Error(`position ${metrics.position}, expected fixed`);
  if (metrics.bottom > vh + 1) throw new Error(`bar.bottom ${metrics.bottom} > vh ${vh}`);
  if (metrics.top < 0) throw new Error(`bar.top ${metrics.top} < 0`);
  return metrics;
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
    await page.getByTestId("step-service").waitFor({ state: "visible", timeout: 15000 });

    // 2) Service (incomplete): Back only — no disabled Continue clutter.
    if (await page.getByTestId("booking-next-btn").count()) {
      throw new Error("Continue should stay hidden until a treatment is chosen");
    }
    if (!(await page.getByTestId("booking-back-btn").count())) {
      throw new Error("Back missing on Service");
    }
    await shot(page, "b-service-back-only");
    pass("service-hides-continue-until-ready");

    await page.getByTestId("step-service-swedish").click();
    await page.getByTestId("step-duration").waitFor({ state: "visible", timeout: 15000 });

    // 3) Duration incomplete: no Continue; after picking 60, Continue is a short-viewport fallback.
    if (await page.getByTestId("booking-next-btn").count()) {
      // Auto-advance may already be mid-flight; wait briefly.
      await page.waitForTimeout(300);
    }
    // Landed via auto-advance on prior runs; if still on duration without selection:
    if (await page.getByTestId("step-duration").count()) {
      await page.getByTestId("step-duration-60").click();
    }
    await page.getByTestId("step-when").waitFor({ state: "visible", timeout: 15000 }).catch(async () => {
      // If still on duration with selection, Continue must be in viewport.
      const next = page.getByTestId("booking-next-btn");
      if (!(await next.count())) throw new Error("Continue missing as duration fallback");
      await assertBarInViewport(page, viewport.height);
      await next.click();
      await page.getByTestId("step-when").waitFor({ state: "visible", timeout: 15000 });
    });
    await shot(page, "b-when-shell");
    const bar = await assertBarInViewport(page, viewport.height);
    pass("when-sticky-bar-in-short-viewport", bar);

    // 4) Generic "Complete this step" hint must not spam tap-advance steps.
    const hint = page.getByTestId("booking-continue-hint");
    if (await hint.count()) {
      const text = await hint.innerText();
      if (/complete this step to continue/i.test(text)) {
        throw new Error("generic complete-step hint still shown on tap-advance step");
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
