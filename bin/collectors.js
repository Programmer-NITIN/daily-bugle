#!/usr/bin/env node
/**
 * @file `node bin/collectors.js [list|create <targetId>]` — collector registry.
 *
 * The agent-facing half of `CLAUDE.md`. `list` answers the only question that
 * matters before spending five to twenty-five minutes of Scraper Studio time:
 * does this target already have a collector? `create` prints the exact command,
 * with the description taken verbatim from `data/targets.json` so the generated
 * collector matches the schema the app expects.
 */

import { getTargets, getTarget } from '../lib/store.js';
import { collectorIdFor, config } from '../lib/config.js';
import { createCommandFor, partitionByCollector } from '../lib/brightdata.js';

const [, , command = 'list', arg] = process.argv;

if (command === 'list') {
  const targets = getTargets();
  const { configured, missing } = partitionByCollector(targets);

  console.log(`mode: ${config.mode}\n`);
  console.log('TARGET             COLLECTOR                      SOURCE');
  console.log('─'.repeat(78));
  for (const t of targets) {
    const id = collectorIdFor(t.collectorEnv);
    console.log(`${t.id.padEnd(18)} ${(id || '— not created —').padEnd(30)} ${t.url}`);
  }
  console.log('');
  console.log(`${configured.length}/${targets.length} targets have a collector id.`);
  if (missing.length) {
    console.log(`\nto create the missing ones, run each of:\n`);
    for (const t of missing) console.log(`  node bin/collectors.js create ${t.id}`);
  }
} else if (command === 'create') {
  const target = arg ? getTarget(arg) : undefined;
  if (!target) {
    console.error(`usage: node bin/collectors.js create <targetId>\ntargets: ${getTargets().map((t) => t.id).join(', ')}`);
    process.exit(1);
  }
  const existing = collectorIdFor(target.collectorEnv);
  if (existing.startsWith('c_')) {
    console.log(`${target.name} already has collector ${existing}. Reuse it:\n`);
    console.log(`  bdata scraper run ${existing} ${target.url} --pretty`);
    process.exit(0);
  }
  console.log(`# 1. authenticate once`);
  console.log(`npx -p @brightdata/cli bdata login\n`);
  console.log(`# 2. generate the collector (5-15 min; up to 25 for complex pages)`);
  console.log(createCommandFor(target));
  console.log(`\n# 3. paste the returned c_* id into .env`);
  console.log(`${target.collectorEnv}=c_xxxxxxxxxxxx`);
  console.log(`\n# 4. flip to live data`);
  console.log(`BUGLE_MODE=live`);
} else {
  console.error('usage: node bin/collectors.js [list|create <targetId>]');
  process.exit(1);
}
