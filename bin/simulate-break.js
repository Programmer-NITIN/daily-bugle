#!/usr/bin/env node
/**
 * @file `npm run break -- <targetId> [mode]` — simulate a site redesign.
 *
 * Waiting for a real site to be redesigned is not a demo strategy. This records a
 * break so the next scrape of that target returns the degraded payload a drifted
 * collector really produces — hollow records, missing fields, or nothing at all.
 * Spider-Sense then has to notice on the strength of the data alone.
 */

import { getTarget, getTargets, setBreak, appendEvent } from '../lib/store.js';
import { BREAK_MODES, describeBreak } from '../lib/fixtures.js';
import { newId, runTarget } from '../lib/pipeline.js';

const [, , targetId, modeArg] = process.argv;
const mode = /** @type {import('../lib/fixtures.js').BreakMode} */ (modeArg || 'selector-drift');

if (!targetId || !getTarget(targetId)) {
  console.error('usage: npm run break -- <targetId> [mode]\n');
  console.error(`targets: ${getTargets().map((t) => t.id).join(', ')}`);
  console.error(`modes:   ${BREAK_MODES.join(', ')}`);
  process.exit(1);
}
if (!BREAK_MODES.includes(mode)) {
  console.error(`unknown mode "${mode}". Choose from: ${BREAK_MODES.join(', ')}`);
  process.exit(1);
}

const target = /** @type {import('../lib/store.js').Target} */ (getTarget(targetId));
const at = new Date().toISOString();

setBreak(target.id, mode, at);
appendEvent({
  id: newId('evt'),
  targetId: target.id,
  at,
  kind: 'break',
  title: `${target.name} changed its layout`,
  detail: `Simulated ${mode}: ${describeBreak(mode)}.`,
  collectorId: target.collectorEnv,
});

console.log(`broke ${target.name} with ${mode}`);
console.log(`  ${describeBreak(mode)}\n`);

// Immediately prove the collector is now returning garbage — and that nothing
// threw. This is the silent-failure mode the project is built to catch.
const { verdict } = await runTarget(target);
console.log(`scrape after break: status ${verdict.status}, health ${verdict.health}/100`);
console.log(`  ${verdict.headline}`);
console.log(`  records: ${verdict.recordCount}   missing fields: ${verdict.missingFields.join(', ') || 'none'}`);
console.log('\nnote that no exception was raised. Repair it with:');
console.log(`  npm run heal -- ${target.id}`);
