#!/usr/bin/env node
// Window 5 — mechanical promotion of visual candidates.
// Approval itself is a HUMAN decision (visual-baseline-policy): this script
// only executes it — copies the captured screenshot to reference.png and
// flips meta.json status. Never bulk-approves: every id is named explicitly.
//
// Usage: node scripts/approve-visual-baseline.mjs <id> [<id>...]
//        node scripts/approve-visual-baseline.mjs --list   (show candidates)
import { existsSync, readFileSync, writeFileSync, copyFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { execSync } from 'node:child_process';
import { createHash } from 'node:crypto';

const root = new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const refsDir = join(root, 'references', 'nexus');
const shotsDir = join(root, 'e2e', 'visual', '__screenshots__', 'nexus');

const candidates = readdirSync(refsDir).filter((d) => {
  const meta = join(refsDir, d, 'meta.json');
  return existsSync(meta) && JSON.parse(readFileSync(meta, 'utf8')).status === 'candidate-awaiting-approval';
});

const ids = process.argv.slice(2).filter((a) => a !== '--list');
if (process.argv.includes('--list') || ids.length === 0) {
  console.log(`${candidates.length} candidates awaiting approval:`);
  for (const c of candidates) console.log('  ' + c);
  if (ids.length === 0 && !process.argv.includes('--list')) {
    console.log('\nPass explicit ids to approve. Approval is a human decision — no bulk mode.');
  }
}
if (ids.length === 0) process.exit(0);

const commit = (() => {
  try { return execSync('git rev-parse --short HEAD', { cwd: root }).toString().trim(); }
  catch { return 'unknown'; }
})();

let failed = false;
for (const id of ids) {
  const refDir = join(refsDir, id);
  const metaPath = join(refDir, 'meta.json');
  const shotPath = join(shotsDir, `${id}.png`);
  if (!existsSync(metaPath)) { console.error(`✗ ${id}: no meta.json — not a candidate`); failed = true; continue; }
  const meta = JSON.parse(readFileSync(metaPath, 'utf8'));
  if (meta.status !== 'candidate-awaiting-approval') {
    console.error(`✗ ${id}: status is "${meta.status}" — only candidates can be approved`); failed = true; continue;
  }
  if (!existsSync(shotPath)) { console.error(`✗ ${id}: screenshot ${shotPath} missing — recapture first`); failed = true; continue; }

  const png = readFileSync(shotPath);
  copyFileSync(shotPath, join(refDir, 'reference.png'));
  meta.status = 'approved';
  meta.approvedAt = new Date().toISOString();
  meta.approvedBy = process.env.USER || process.env.USERNAME || 'unknown-approver';
  meta.approval = {
    sha256: createHash('sha256').update(png).digest('hex'),
    commit,
    source: 'e2e/visual/__screenshots__/nexus/' + id + '.png',
  };
  writeFileSync(metaPath, JSON.stringify(meta, null, 2) + '\n');
  console.log(`✓ ${id}: approved → references/nexus/${id}/reference.png (sha256 ${meta.approval.sha256.slice(0, 12)}…)`);
}
process.exit(failed ? 1 : 0);
