/**
 * Slice F — cross-flow regression orchestrator (A–E acceptance + shared Vitest).
 * Usage: BASE_URL=http://localhost:3025 node scripts/slice-f-acceptance.mjs
 * Optional: SKIP_VITEST=1  INCLUDE_AUDITS=1
 */
import { spawn } from "child_process";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const BASE = process.env.BASE_URL || "http://localhost:3025";
const OUT = path.resolve(path.join(__dirname, "../../test_reports/slice-f-acceptance"));
fs.mkdirSync(OUT, { recursive: true });

const report = {
  ok: [],
  fail: [],
  steps: [],
  startedAt: new Date().toISOString(),
  baseUrl: BASE,
  notes: [
    "Installed PWA checklist (DEVICE_PWA_CHECKLIST.md) remains a deployment blocker — browser emulation does not clear it.",
  ],
};

function pass(name, detail = {}) {
  report.ok.push({ name, ...detail });
  console.log(`PASS ${name}`);
}
function fail(name, message) {
  report.fail.push({ name, message });
  console.log(`FAIL ${name} — ${message}`);
}

function run(cmd, args, extraEnv = {}) {
  return new Promise((resolve) => {
    const env = { ...process.env, ...extraEnv };
    if (!Object.prototype.hasOwnProperty.call(extraEnv, "OUT_DIR")) delete env.OUT_DIR;
    const child = spawn(cmd, args, {
      cwd: ROOT,
      env,
      shell: process.platform === "win32",
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      const text = String(chunk);
      stdout += text;
      process.stdout.write(text);
    });
    child.stderr.on("data", (chunk) => {
      const text = String(chunk);
      stderr += text;
      process.stderr.write(text);
    });
    child.on("close", (code) => resolve({ code: code ?? 1, stdout, stderr }));
  });
}

const SLICES = [
  { id: "slice-a", script: "scripts/slice-a-acceptance.mjs" },
  { id: "slice-b", script: "scripts/slice-b-acceptance.mjs" },
  { id: "slice-c", script: "scripts/slice-c-acceptance.mjs" },
  { id: "slice-d", script: "scripts/slice-d-acceptance.mjs" },
  { id: "slice-e", script: "scripts/slice-e-acceptance.mjs" },
];

const VITEST_FILES = [
  "src/components/FlowStepShell.test.jsx",
  "src/components/StickyActionBar.test.jsx",
  "src/components/AddressPicker.test.js",
  "src/pages/client/BookingSteps.navigation.test.jsx",
  "src/pages/client/Booking.journey.test.jsx",
  "src/pages/client/Booking.review.test.jsx",
  "src/pages/client/SessionPrep.test.jsx",
  "src/pages/client/Welcome.test.jsx",
  "src/pages/Join.test.jsx",
  "src/components/schedule/ScheduleEditor.test.jsx",
  "src/components/schedule/ScheduleQuickActions.test.jsx",
  "src/components/schedule/DayTimeline.test.jsx",
  "src/components/schedule/scheduleUtils.test.js",
  "src/lib/booking-selection.test.js",
];

const AUDITS = [
  { id: "address-flow-audit", script: "scripts/address-flow-audit.mjs", out: path.join(OUT, "address-flow") },
  { id: "booking-flow-audit", script: "scripts/booking-flow-audit.mjs", out: path.join(OUT, "booking-flow") },
  { id: "confirm-viewport-audit", script: "scripts/confirm-viewport-audit.mjs", out: path.join(OUT, "confirm-viewport") },
];

async function main() {
  console.log(`Slice F regression BASE_URL=${BASE}`);

  if (process.env.SKIP_VITEST !== "1") {
    console.log("\n—— Vitest cross-flow ——");
    const vitest = await run("npm", ["test", "--", "--run", ...VITEST_FILES], { BASE_URL: BASE });
    report.steps.push({ name: "vitest-cross-flow", code: vitest.code });
    if (vitest.code === 0) pass("vitest-cross-flow");
    else fail("vitest-cross-flow", `exit ${vitest.code}`);
  } else {
    report.steps.push({ name: "vitest-cross-flow", skipped: true });
  }

  for (const slice of SLICES) {
    console.log(`\n—— ${slice.id} ——`);
    const result = await run("node", [slice.script], { BASE_URL: BASE });
    report.steps.push({ name: slice.id, code: result.code, script: slice.script });
    if (result.code === 0) pass(slice.id);
    else fail(slice.id, `exit ${result.code}`);
  }

  if (process.env.INCLUDE_AUDITS === "1") {
    for (const audit of AUDITS) {
      console.log(`\n—— ${audit.id} ——`);
      fs.mkdirSync(audit.out, { recursive: true });
      const result = await run("node", [audit.script], { BASE_URL: BASE, OUT_DIR: audit.out });
      report.steps.push({ name: audit.id, code: result.code, out: audit.out });
      if (result.code === 0) pass(audit.id);
      else fail(audit.id, `exit ${result.code}`);
    }
  } else {
    report.notes.push("Legacy audits skipped (set INCLUDE_AUDITS=1 to run address/booking/confirm audits).");
  }

  report.finishedAt = new Date().toISOString();
  const outFile = path.join(OUT, "slice-f-acceptance.json");
  fs.writeFileSync(outFile, JSON.stringify(report, null, 2));
  console.log("\n" + JSON.stringify({ ok: report.ok.length, fail: report.fail.length, outFile }, null, 2));
  if (report.fail.length) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
