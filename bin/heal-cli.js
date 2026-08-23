#!/usr/bin/env node
/**
 * @file `npm run heal [-- <targetId>] [--force]` — autonomous repair.
 *
 * With no target it sweeps every collector whose last run was unhealthy, which is
 * exactly what a cron entry or a CI step should call:
 *
 *   0 6 * * *  cd /srv/daily-bugle && npm run scrape && npm run heal
 */

import { getTarget, getTargets } from '../lib/store.js';
import { healTarget, healSweep } from '../lib/heal.js';
import { config } from '../lib/config.js';

const args = process.argv.slice(2);
const force = args.includes('--force');
const targetId = args.find((a) => !a.startsWith('--'));

/** @param {string} line */
const emit = (line) => console.log(line);

console.log(`heal threshold: ${config.healThreshold}/100   execute: ${config.healExecute ? 'yes (bdata CLI will run)' : 'no (HEAL_EXECUTE=0)'}\n`);

if (targetId) {
  const target = getTarget(targetId);
  if (!target) {
    console.error(`unknown target "${targetId}"\ntargets: ${getTargets().map((t) => t.id).join(', ')}`);
    process.exit(1);
  }
  const outcome = await healTarget(target, { emit, force });
  if ('skipped' in outcome) {
    console.log(`skipped ${target.name}: ${outcome.reason}`);
    console.log('pass --force to heal anyway.');
  } else {
    process.exit(outcome.ok ? 0 : 1);
  }
} else {
  const outcomes = await healSweep(getTargets(), { emit });
  const healed = outcomes.filter((o) => !('skipped' in o) && o.ok).length;
  if (!outcomes.length) console.log('every collector is healthy. Nothing to repair.');
  else console.log(`\nhealed ${healed}/${outcomes.length} unhealthy collector(s).`);
}
