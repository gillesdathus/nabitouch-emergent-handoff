/**
 * Production mobile browser smoke (NOT installed PWA).
 * Usage: BASE_URL=https://nabitouch.com node scripts/prod-mobile-smoke.mjs
 */
import { chromium } from "playwright";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BASE = process.env.BASE_URL || "https://nabitouch.com";
const OUT = path.resolve(path.join(__dirname, "../../test_reports/pwa-release-gate/prod-mobile-smoke"));
fs.mkdirSync(OUT, { recursive: true });

const report = {
  kind: "production-mobile-browser-smoke",
  notInstalledPwa: true,
  baseUrl: BASE,
  viewport: { width: 390, height: 700 },
  deployedCommitHint: "2844733 (verify via ops manifest)",
  ok: [],
  fail: [],
  pending: [],
  shots: [],
  startedAt: new Date().toISOString(),
};

function pass(name, detail = {}) {
  report.ok.push({ name, ...detail });
  console.log(`PASS ${name}`);
}
function fail(name, message) {
  report.fail.push({ name, message });
  console.log(`FAIL ${name} — ${message}`);
}
function pending(name, message) {
  report.pending.push({ name, message });
  console.log(`PENDING ${name} — ${message}`);
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

async function assertInFlowNav(page) {
  const metrics = await page.evaluate(() => {
    const sticky = document.querySelector("[data-testid=booking-sticky-actions]");
    const stickyClass = document.querySelector(".nb-sticky-actions");
    const nav = document.querySelector("[data-testid=booking-step-nav]");
    const dock = document.querySelector("[data-testid=client-bottom]");
    return {
      sticky: !!sticky || !!stickyClass,
      nav: !!nav,
      dock: !!dock,
    };
  });
  if (metrics.sticky) throw new Error("sticky booking actions still present");
  if (metrics.dock) throw new Error("bottom nav visible during booking");
  if (!metrics.nav) throw new Error("in-flow booking-step-nav missing");
  return metrics;
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
  if (metrics.bottom > vh + 2) throw new Error(`${testid} bottom ${metrics.bottom} > vh ${vh}`);
  return metrics;
}

async function typeReact(page, testid, value) {
  const el = page.getByTestId(testid);
  await el.click();
  await el.fill("");
  await el.pressSequentially(value, { delay: 15 });
}

async function main() {
  const viewport = report.viewport;
  const browser = await chromium.launch({
    headless: true,
    channel: process.env.PLAYWRIGHT_CHROME ? undefined : "chrome",
    executablePath: process.env.PLAYWRIGHT_CHROME || undefined,
  });
  const context = await browser.newContext({
    viewport,
    locale: "en-CA",
    hasTouch: true,
    isMobile: true,
    userAgent:
      "Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36",
  });
  const page = await context.newPage();

  try {
    const health = await page.request.get(`${BASE}/api/health`);
    if (!health.ok()) throw new Error(`health ${health.status()}`);
    const body = await health.json();
    if (body.status !== "ok") throw new Error("health not ok");
    pass("public-health", { documentUploads: body.documentUploads, cardCheckout: body.cardCheckout });

    await gotoStable(page, `${BASE}/`);
    await page.evaluate(() => {
      try { localStorage.removeItem("nt_booking_draft_v1"); } catch { /* */ }
    });
    await gotoStable(page, `${BASE}/book`);
    await page.getByTestId("booking-regular-flow").waitFor({ state: "visible", timeout: 25000 });
    await shot(page, "01-book-land");

    // Address: Find → Confirm → details No
    await page.getByTestId("step-where-home").click();
    await typeReact(page, "step-where-address-input", "10150 104");
    await page.waitForTimeout(900);
    const opt = page.getByTestId("step-where-address-option-0");
    await opt.waitFor({ state: "visible", timeout: 20000 });
    await opt.click();
    await page.getByTestId("step-where-address-confirm-card").waitFor({ state: "visible", timeout: 15000 });
    if (await page.getByTestId("step-where-address-postal-input").count()) {
      await typeReact(page, "step-where-address-postal-input", "T5J 2R4");
      await page.waitForFunction(() => {
        const btn = document.querySelector("[data-testid=step-where-address-confirm]");
        return btn && !btn.disabled;
      }, null, { timeout: 8000 });
    }
    await page.getByTestId("step-where-address-confirm").click();
    await page.getByTestId("step-where-address-details-ask").waitFor({ state: "visible", timeout: 20000 });
    await shot(page, "02-details-ask");
    await page.getByTestId("step-where-address-details-no").click();
    await page.getByTestId("booking-next-btn").waitFor({ state: "visible", timeout: 20000 });
    await assertInFlowNav(page);
    await page.getByTestId("booking-next-btn").click();
    await page.getByTestId("step-service").waitFor({ state: "visible", timeout: 20000 });
    await assertInFlowNav(page);
    await shot(page, "03-service-after-details-no");
    pass("address-confirm-details-no-then-continue");

    // Sequential Continue: Service → Duration → When
    await page.getByTestId("step-service-swedish").click();
    await page.getByTestId("booking-next-btn").click();
    await page.getByTestId("step-duration").waitFor({ state: "visible", timeout: 15000 });
    pass("service-to-duration-continue");
    await page.getByTestId("step-duration-60").click();
    await page.getByTestId("booking-next-btn").click();
    await page.getByTestId("step-when").waitFor({ state: "visible", timeout: 15000 });
    await shot(page, "04-when");
    pass("duration-to-when-continue");
    await assertInFlowNav(page);
    pass("in-flow-ctas-on-when");

    // Details Yes path (fresh draft + new context to avoid leftover booking state)
    await context.clearCookies();
    const page2 = await context.newPage();
    await gotoStable(page2, `${BASE}/`);
    await page2.evaluate(() => {
      try {
        localStorage.clear();
        sessionStorage.clear();
      } catch { /* */ }
    });
    await gotoStable(page2, `${BASE}/book`);
    await page2.getByTestId("booking-regular-flow").waitFor({ state: "visible", timeout: 25000 });
    await page2.getByTestId("step-where").waitFor({ state: "visible", timeout: 15000 });
    if (await page2.getByTestId("step-where-home").count()) {
      await page2.getByTestId("step-where-home").click();
    }
    await page2.getByTestId("step-where-address-input").waitFor({ state: "visible", timeout: 15000 });
    await typeReact(page2, "step-where-address-input", "10060 Jasper");
    await page2.waitForTimeout(900);
    await page2.getByTestId("step-where-address-option-0").waitFor({ state: "visible", timeout: 20000 });
    await page2.getByTestId("step-where-address-option-0").click();
    await page2.getByTestId("step-where-address-confirm-card").waitFor({ state: "visible", timeout: 15000 });
    if (await page2.getByTestId("step-where-address-postal-input").count()) {
      await typeReact(page2, "step-where-address-postal-input", "T5J 3R8");
      await page2.waitForFunction(() => {
        const btn = document.querySelector("[data-testid=step-where-address-confirm]");
        return btn && !btn.disabled;
      }, null, { timeout: 8000 });
    }
    await page2.getByTestId("step-where-address-confirm").click();
    await page2.getByTestId("step-where-address-details-ask").waitFor({ state: "visible", timeout: 20000 });
    await page2.getByTestId("step-where-address-details-yes").click();
    await page2.getByTestId("step-where-address-details-form").waitFor({ state: "visible", timeout: 10000 });
    if (await page2.getByTestId("step-where-address-unit").count()) {
      await typeReact(page2, "step-where-address-unit", "1201");
    }
    await page2.getByTestId("step-where-address-details-continue").click();
    await page2.getByTestId("booking-next-btn").waitFor({ state: "visible", timeout: 20000 });
    await page2.getByTestId("booking-next-btn").click();
    await page2.getByTestId("step-service").waitFor({ state: "visible", timeout: 20000 });
    await shot(page2, "05-service-after-details-yes");
    pass("address-confirm-details-yes-continue");
    await page2.close();

    // Returning-client saved addresses require auth; demo-login disabled in production
    const demo = await page.request.post(`${BASE}/api/auth/demo-login`, {
      data: { role: "client" },
      headers: { "Content-Type": "application/json" },
    });
    if (demo.ok()) {
      await gotoStable(page, `${BASE}/book`);
      // best-effort
      const chips = await page.getByTestId("step-where-saved-addresses").count();
      if (chips) {
        await shot(page, "06-saved-addresses");
        pass("returning-client-saved-addresses");
      } else {
        pending("returning-client-saved-addresses", "demo-login ok but chips not visible");
      }
      const proDemo = await page.request.post(`${BASE}/api/auth/demo-login`, {
        data: { role: "practitioner", subject: "p-maya" },
        headers: { "Content-Type": "application/json" },
      });
      if (proDemo.ok()) {
        await gotoStable(page, `${BASE}/pro/availability`);
        await page.getByTestId("availability-page").waitFor({ state: "visible", timeout: 25000 });
        await assertSticky(page, "schedule-adjust-actions", viewport.height);
        await shot(page, "07-availability-adjust");
        pass("pro-availability-adjust-hub");
      } else {
        pending("pro-availability-adjust-hub", `demo-login practitioner ${proDemo.status()}`);
      }
    } else {
      pending("returning-client-saved-addresses", `demo-login disabled on prod (${demo.status()}) — needs real client session`);
      pending("pro-availability-adjust-hub", `demo-login disabled on prod (${demo.status()}) — needs real practitioner session`);
    }
  } catch (err) {
    await shot(page, "ERROR").catch(() => {});
    fail("prod-mobile-smoke", String(err?.message || err));
  } finally {
    await browser.close();
  }

  report.finishedAt = new Date().toISOString();
  const outFile = path.join(OUT, "prod-mobile-smoke.json");
  fs.writeFileSync(outFile, JSON.stringify(report, null, 2));
  console.log(JSON.stringify({
    ok: report.ok.length,
    fail: report.fail.length,
    pending: report.pending.length,
    outFile,
  }, null, 2));
  if (report.fail.length) process.exit(1);
}

main().catch((e) => { console.error(e); process.exit(1); });
