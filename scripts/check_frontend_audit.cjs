// A narrow CI baseline, not release approval.
// Known build-tool / pinned-app advisories must be reviewed with an expiry.
const fs = require('node:fs');
const rows = fs.readFileSync(process.argv[2], 'utf8').trim().split(/\r?\n/).filter(Boolean).map(JSON.parse);
if (rows.some(row => row.type === 'error') || !rows.some(row => row.type === 'auditSummary')) {
  throw new Error('Registry audit did not complete');
}

const allowed = [
  {
    id: 'GHSA-vfj7-8cjw-p6xm',
    module: 'braces',
    pathPrefix: 'tailwindcss>',
    expiry: Date.parse('2026-11-15T00:00:00Z'),
    note: 'Tailwind build tooling only; no patched braces path in this pin.',
  },
  {
    // Advisory marks <4.6.6 including zod@3; patch exists only on zod@4.6.6+.
    // App remains on zod@3.24.4 for this CSRF hotfix (v4 is a breaking upgrade).
    id: 'GHSA-mrhx-c7xc-m3w5',
    module: 'zod',
    pathPrefix: '',
    expiry: Date.parse('2026-11-15T00:00:00Z'),
    note: 'Pinned zod@3.24.4; zod v4 upgrade tracked separately from CSRF hotfix.',
  },
];

let known = 0;
for (const row of rows.filter(row => row.type === 'auditAdvisory')) {
  const { advisory, resolution } = row.data;
  const id = advisory.github_advisory_id || advisory.id;
  const match = allowed.find((entry) => (
    entry.id === id
    && advisory.module_name === entry.module
    && String(resolution.path || '').startsWith(entry.pathPrefix)
    && Date.now() < entry.expiry
  ));
  if (!match) {
    throw new Error(`Unreviewed or expired advisory: ${id}`);
  }
  known++;
}
console.log(`Frontend audit completed: ${known} known reviewed paths; no unreviewed advisories.`);
for (const entry of allowed) {
  console.log(`::warning::${entry.id} (${entry.module}) remains OPEN until ${new Date(entry.expiry).toISOString().slice(0, 10)}. ${entry.note}`);
}
