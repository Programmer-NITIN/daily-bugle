#!/usr/bin/env node
/**
 * @file `npm run scrape [-- <targetId>]` — run collectors and score the results.
 *
 * Terminal-first by design: the whole product is operable from the CLI, and the
 * web front page is a view over the same data this writes.
 */

import { getTargets, getTarget } from '../lib/store.js';
import { runTarget } from '../lib/pipeline.js';
import { config, collectorIdFor } from '../lib/config.js';

const only = process.argv[2];
const targets = only ? [getTarget(only)].filter(Boolean) : getTargets();

if (!targets.length) {
  console.error(only ? `unknown target "${only}"` : 'no targets configured');
  process.exit(1);
}

console.log(`mode: ${config.mode}   targets: ${targets.length}\n`);

let degraded = 0;
for (const target of /** @type {import('../lib/store.js').Target[]} */ (targets)) {
  const collector = collectorIdFor(target.collectorEnv) || '(no collector id — using fixtures)';
  const { run, verdict } = await runTarget(target);
  const badge = { ok: 'OK      ', degraded: 'DEGRADED', failed: 'FAILED  ' }[verdict.status];
  if (verdict.status !== 'ok') degraded += 1;

  console.log(`${badge} ${target.name.padEnd(18)} health ${String(verdict.health).padStart(3)}/100  ${run.recordCount} records  ${run.durationMs}ms`);
  console.log(`         collector ${collector}`);
  if (verdict.status !== 'ok') console.log(`         ${verdict.headline}`);
}

console.log('');
if (degraded) {
  console.log(`${degraded} collector${degraded === 1 ? '' : 's'} unhealthy. Repair with:  npm run heal`);
  process.exit(2);
}
console.log('all collectors healthy.');
