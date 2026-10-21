/**
 * Slice A final browser UX acceptance.
 * Covers: details Yes, details No, Rebook → Where details, transition into When with slots.
 *
 * Usage: BASE_URL=http://localhost:3025 node scripts/slice-a-acceptance.mjs
 */
import { chromium } from "playwright";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BASE = process.env.BASE_URL || "http://localhost:3025";
const API = process.env.API_URL || "http://127.0.0.1:18080";
const OUT = path.resolve(process.env.OUT_DIR || path.join(__dirname, "../../test_reports/slice-a-acceptance"));
fs.mkdirSync(OUT, { recursive: true });

const report = {
  ok: [],
  fail: [],
  shots: [],
  startedAt: new Date().toISOString(),
  baseUrl: BASE,
  apiUrl: API,
};

function pass(name, detail = {}) {
  report.ok.push({ name, ...detail });
  console.log(`PASS ${name}`);
}

function fail(name, message, detail = {}) {
  report.fail.push({ name, message, ...detail });
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
  return file;
}

async function gotoStable(page, url) {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60000 });
      return;
    } catch (err) {
      const msg = String(err?.message || err);
      if (!/ERR_ABORTED|interrupted/i.test(msg) || attempt === 2) throw err;
      await page.waitForTimeout(400);
    }
  }
}

async function clearDraft(page) {
  await gotoStable(page, `${BASE}/`);
  await page.evaluate(() => {
    try { localStorage.removeItem("nt_booking_draft_v1"); } catch { /* ignore */ }
  });
}

async function confirmAddressThroughDetails(page, detailsPath) {
  await page.getByTestId("step-where-home").click();
  await typeReact(page, "step-where-address-input", "10150 104");
  await page.waitForTimeout(900);
  await page.getByTestId("step-where-address-option-0").waitFor({ state: "visible", timeout: 15000 });
  await page.getByTestId("step-where-address-option-0").click();
  await page.getByTestId("step-where-address-confirm-card").waitFor({ state: "visible", timeout: 15000 });

  // Confirm chrome: search/unit must not linger when postal is known.
  if (await page.getByTestId("step-where-address-input").count()) {
    throw new Error("search still visible on confirm");
  }
  if (await page.getByTestId("step-where-address-unit-input").count()) {
    throw new Error("unit still visible on confirm");
  }
  if (await page.getByTestId("step-where-saved-addresses").count()) {
    throw new Error("saved-address chips still visible during address focus");
  }

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

  if (detailsPath === "yes") {
    await page.getByTestId("step-where-address-details-yes").click();
    await page.getByTestId("step-where-address-details-form").waitFor({ state: "visible", timeout: 10000 });
    await typeReact(page, "step-where-address-unit-input", "4");
    await typeReact(page, "step-where-address-access-input", "Buzz 12");
    await page.getByTestId("step-where-address-details-continue").click();
  } else {
    await page.getByTestId("step-where-address-details-no").click();
  }
}

async function advanceToWhen(page) {
  await page.getByTestId("step-service").waitFor({ state: "visible", timeout: 15000 });
  const swedish = page.getByTestId("step-service-swedish");
  if (await swedish.count()) await swedish.click();
  else await page.locator("[data-testid^='step-service-']").first().click();

  await page.getByTestId("step-duration").waitFor({ state: "visible", timeout: 15000 });
  await page.getByTestId("step-duration-60").click();

  await page.getByTestId("step-when").waitFor({ state: "visible", timeout: 15000 });
  await page.waitForTimeout(900);
  await page.getByTestId("step-pract-any").click().catch(() => {});

  const note = page.getByTestId("step-when-note");
  if (await note.count()) {
    const text = (await note.innerText()).toLowerCase();
    if (text.includes("finish address details") || text.includes("confirm the service address")) {
      throw new Error(`When blocked: ${text}`);
    }
  }

  const dateChips = page.locator("[data-testid^='step-date-']");
  await dateChips.first().waitFor({ state: "visible", timeout: 20000 });
  let slots = 0;
  for (let i = 0; i < await dateChips.count(); i += 1) {
    await dateChips.nth(i).click();
    await page.waitForTimeout(700);
    await page.getByTestId("step-pract-any").click().catch(() => {});
    slots = await page.locator("[data-testid^='step-time-']").count();
    if (slots > 0) break;
  }
  if (slots < 1) throw new Error("no time slots after details settled");
  return slots;
}

async function guestDetailsPath(detailsPath) {
  const label = `guest-details-${detailsPath}`;
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    locale: "en-CA",
    hasTouch: true,
    isMobile: true,
  });
  const page = await context.newPage();
  try {
    await clearDraft(page);
    await gotoStable(page, `${BASE}/book`);
    await page.getByTestId("booking-regular-flow").waitFor({ state: "visible", timeout: 20000 });
    await confirmAddressThroughDetails(page, detailsPath);
    await shot(page, `${label}-after-details`);
    const slots = await advanceToWhen(page);
    await shot(page, `${label}-when`);
    pass(label, { slots });
  } catch (err) {
    await shot(page, `${label}-ERROR`).catch(() => {});
    fail(label, String(err?.message || err));
  } finally {
    await browser.close();
  }
}

async function loginClient(page) {
  await gotoStable(page, `${BASE}/login`);
  const res = await page.request.post(`${BASE}/api/auth/demo-login`, {
    data: { role: "client" },
    headers: { "Content-Type": "application/json" },
  });
  if (!res.ok()) throw new Error(`demo-login failed ${res.status()} via ${BASE}/api`);
  const me = await page.request.get(`${BASE}/api/auth/me`);
  if (!me.ok()) throw new Error(`auth/me failed ${me.status()} after demo-login`);
  // Reload so DemoStore/session bootstrap picks up the new cookies.
  await gotoStable(page, `${BASE}/me`);
}

async function rebookPath() {
  const label = "rebook-details-then-when";
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    locale: "en-CA",
    hasTouch: true,
    isMobile: true,
  });
  const page = await context.newPage();
  try {
    await loginClient(page);
    await clearDraft(page);
    await gotoStable(page, `${BASE}/me`);
    await page.getByTestId("client-dashboard").waitFor({ state: "visible", timeout: 25000 });

    const rebookBtn = page.locator("[data-testid^='rebook-'], [data-testid^='visit-rebook-']").first();
    await rebookBtn.waitFor({ state: "visible", timeout: 20000 });
    await rebookBtn.click();
    await page.waitForURL(/\/book/, { timeout: 15000 });
    await page.getByTestId("step-where").waitFor({ state: "visible", timeout: 20000 });
    await shot(page, `${label}-landed-where`);

    // Rebook with a saved civic address should land on details ask (or confirm if unconfirmed).
    const detailsAsk = page.getByTestId("step-where-address-details-ask");
    const confirmCard = page.getByTestId("step-where-address-confirm-card");
    await Promise.race([
      detailsAsk.waitFor({ state: "visible", timeout: 20000 }),
      confirmCard.waitFor({ state: "visible", timeout: 20000 }),
    ]);

    if (await confirmCard.count()) {
      const postal = page.getByTestId("step-where-address-postal-input");
      if (await postal.count()) {
        await typeReact(page, "step-where-address-postal-input", "T5J 2R4");
        await page.waitForFunction(() => {
          const btn = document.querySelector("[data-testid=step-where-address-confirm]");
          return btn && !btn.disabled;
        }, null, { timeout: 5000 });
      }
      await page.getByTestId("step-where-address-confirm").click();
      await detailsAsk.waitFor({ state: "visible", timeout: 20000 });
    }

    if (await page.getByTestId("step-when").count()) {
      throw new Error("rebook skipped Where and landed on When without detailsSettled");
    }

    await page.getByTestId("step-where-address-details-no").click();
    await page.waitForTimeout(600);
    // If details settled but shell still shows Where, Continue advances.
    if (await page.getByTestId("step-where").count()) {
      const next = page.getByTestId("booking-next-btn");
      if (await next.count() && await next.isEnabled()) await next.click();
    }
    await shot(page, `${label}-after-details-no`);

    // Service may already be chosen on rebook → Duration, else Service.
    if (await page.getByTestId("step-service").count()) {
      const swedish = page.getByTestId("step-service-swedish");
      if (await swedish.count()) await swedish.click();
      else await page.locator("[data-testid^='step-service-']").first().click();
      await page.waitForTimeout(400);
    }
    if (await page.getByTestId("step-duration").count()) {
      // Rebook often pre-selects 60 — re-click may not advance; use Continue when already selected.
      const selected = page.locator("[data-testid='step-duration-60'].border-nb-blue, [data-testid='step-duration-60'][aria-pressed='true']");
      const dur60 = page.getByTestId("step-duration-60");
      if (await dur60.count()) await dur60.click();
      else await page.locator("[data-testid^='step-duration-']").first().click();
      await page.waitForTimeout(500);
      if (await page.getByTestId("step-duration").count()) {
        const next = page.getByTestId("booking-next-btn");
        if (await next.count() && await next.isEnabled()) await next.click();
      }
    }

    await page.getByTestId("step-when").waitFor({ state: "visible", timeout: 20000 });
    await page.waitForTimeout(900);
    const note = page.getByTestId("step-when-note");
    if (await note.count()) {
      const text = (await note.innerText()).toLowerCase();
      if (text.includes("finish address details") || text.includes("confirm the service address")) {
        throw new Error(`When blocked after rebook details: ${text}`);
      }
    }
    await shot(page, `${label}-when`);
    pass(label, {
      landedWhere: true,
      advancedPastDetails: true,
    });
  } catch (err) {
    await shot(page, `${label}-ERROR`).catch(() => {});
    fail(label, String(err?.message || err));
  } finally {
    await browser.close();
  }
}

async function main() {
  await guestDetailsPath("no");
  await guestDetailsPath("yes");
  await rebookPath();
  report.finishedAt = new Date().toISOString();
  const outFile = path.join(OUT, "slice-a-acceptance.json");
  fs.writeFileSync(outFile, JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ ok: report.ok.length, fail: report.fail.length, outFile }, null, 2));
  if (report.fail.length) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
