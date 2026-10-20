// A narrow CI baseline, not release approval: no patched braces version exists.
const fs = require('node:fs');
const rows = fs.readFileSync(process.argv[2], 'utf8').trim().split(/\r?\n/).filter(Boolean).map(JSON.parse);
if (rows.some(row => row.type === 'error') || !rows.some(row => row.type === 'auditSummary')) {
  throw new Error('Registry audit did not complete');
}
const allowedId = 'GHSA-vfj7-8cjw-p6xm';
const expiry = Date.parse('2026-11-15T00:00:00Z');
let known = 0;
for (const row of rows.filter(row => row.type === 'auditAdvisory')) {
  const { advisory, resolution } = row.data;
  if (advisory.github_advisory_id !== allowedId || advisory.module_name !== 'braces' ||
      !resolution.path.startsWith('tailwindcss>') || Date.now() >= expiry) {
    throw new Error(`Unreviewed or expired advisory: ${advisory.github_advisory_id || advisory.id}`);
  }
  known++;
}
console.log(`Frontend audit completed: ${known} known Tailwind build-tool paths; no unreviewed advisories.`);
if (known) console.log(`::warning::${allowedId} remains OPEN, build tooling only; baseline expires 2026-11-15. No release approval.`);
