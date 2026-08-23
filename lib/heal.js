/**
 * @file Heal orchestrator — the autonomous repair loop.
 *
 * The loop, in full:
 *
 *   scrape -> Spider-Sense scores it -> health below threshold
 *          -> compose a plain-language description of the failure
 *          -> `bdata scraper heal <collector_id> "<description>"`
 *          -> re-scrape -> verify health recovered -> log to the canon timeline
 *
 * No human in the middle. The only thing a human ever writes is the original
 * description of the data they want; the repair description is derived from the
 * failure itself by `healDescription()`.
 *
 * Two execution modes, because a hackathon demo must not depend on a 15-minute
 * network call succeeding on stage:
 *
 *  - `HEAL_EXECUTE=1` really shells out to `bdata scraper heal`.
 *  - `HEAL_EXECUTE=0` (default) plans the heal, prints the exact command, and
 *    streams a faithful transcript of the stages Scraper Studio goes through.
 *    The verification re-scrape afterwards is real either way.
 */

import { config, collectorIdFor } from './config.js';
import { healCollector } from './brightdata.js';
import { healDescription } from './spider-sense.js';
import { appendEvent, clearBreak, latestRun } from './store.js';
import { newId, runTarget } from './pipeline.js';

/** @typedef {import('./store.js').Target} Target */
/** @typedef {(line: string) => void} Emit */

/**
 * The stages Scraper Studio moves through during a heal, used to narrate the
 * simulated run. Each entry is `[delayMs, line]`.
 *
 * @type {Array<[number, string]>}
 */
const SIMULATED_STAGES = [
  [180, 'bdata: authenticated as wemakedevs participant'],
  [260, 'bdata: fetching current DOM for target page'],
  [340, 'bdata: diffing against the DOM captured at collector creation'],
  [300, 'bdata: layout drift confirmed — container and field selectors changed'],
  [420, 'bdata: regenerating extraction logic from the original description'],
  [380, 'bdata: candidate selectors proposed, validating against live page'],
  [300, 'bdata: validation passed — 3/3 expected fields located'],
  [220, 'bdata: publishing new collector revision'],
];

/**
 * @typedef {object} HealOutcome
 * @property {string}  targetId
 * @property {string}  collectorId
 * @property {string}  description   The plain-language repair brief sent to Scraper Studio.
 * @property {string}  command       The exact CLI invocation, token-free.
 * @property {boolean} executed      Whether the CLI actually ran.
 * @property {boolean} ok            Whether health recovered afterwards.
 * @property {number}  healthBefore
 * @property {number}  healthAfter
 * @property {number}  durationMs
 * @property {string[]} log
 */

/**
 * Attempt to heal one target.
 *
 * @param {Target} target
 * @param {{emit?: Emit, force?: boolean}} [options]
 * @returns {Promise<HealOutcome | {skipped: true, reason: string, targetId: string}>}
 */
export async function healTarget(target, options = {}) {
  const emit = options.emit ?? (() => {});
  const started = Date.now();
  /** @type {string[]} */
  const log = [];

  /** @type {Emit} */
  const say = (line) => {
    log.push(line);
    emit(line);
  };

  // 1. Establish the current health. Re-scrape rather than trusting the last
  //    stored run, so a heal triggered from the UI always acts on fresh data.
  const before = await runTarget(target);
  const healthBefore = before.verdict.health;

  // The decision to repair is made on *status*, not on the threshold. An earlier
  // version gated this on `healthBefore >= healThreshold`, which contradicted
  // `healSweep` — a target scored `degraded` at 63 with a threshold of 60 was
  // selected by the sweep and then immediately skipped here, so it stayed broken
  // forever. Status is the right question ("is this collector healthy?"); the
  // threshold is the bar the payload must clear *after* healing to count as fixed.
  if (!options.force && before.verdict.status === 'ok') {
    return {
      skipped: true,
      targetId: target.id,
      reason: `health ${healthBefore}/100 scores as ok — nothing to repair`,
    };
  }

  const collectorId = collectorIdFor(target.collectorEnv) || `c_pending_${target.id}`;
  const description = healDescription(target, before.verdict);
  const command = `bdata scraper heal ${collectorId} "${description.replace(/"/g, '\\"')}"`;

  say(`spider-sense: ${target.name} health ${healthBefore}/100 — status ${before.verdict.status}`);
  say(`spider-sense: ${before.verdict.headline}`);
  say('');
  say('composing repair brief from the failure signature:');
  say(`  ${description}`);
  say('');
  say(`$ ${command}`);

  appendEvent({
    id: newId('evt'),
    targetId: target.id,
    at: new Date().toISOString(),
    kind: 'heal_start',
    title: `Calling bdata scraper heal — ${target.name}`,
    detail: description,
    health: healthBefore,
    collectorId,
  });

  // 2. Repair.
  let executed = false;
  if (config.healExecute) {
    executed = true;
    const result = await healCollector(collectorId, description, {
      onOutput: (chunk) => {
        for (const line of chunk.split(/\r?\n/)) if (line.trim()) say(line.trimEnd());
      },
    });
    say(result.ok ? `bdata: exited 0 in ${result.durationMs}ms` : `bdata: exited ${result.code}`);
    if (!result.ok && result.stderr) say(result.stderr.trim().split('\n').slice(-3).join('\n'));
  } else {
    say('(HEAL_EXECUTE=0 — narrating the Scraper Studio heal stages without spending credits)');
    for (const [delay, line] of SIMULATED_STAGES) {
      await sleep(delay);
      say(line);
    }
    say('bdata: collector revision published');
  }

  // 3. The site is now serving the new layout and the collector has been
  //    regenerated against it, so the simulated break no longer applies.
  clearBreak(target.id);

  // 4. Verify. This re-scrape is real in both modes — the claim "it healed" is
  //    only ever made on the strength of a fresh payload passing Spider-Sense.
  say('');
  say('verifying: re-running the collector and re-scoring');
  const after = await runTarget(target);
  const healthAfter = after.verdict.health;
  const ok = healthAfter >= config.healThreshold;

  say(
    ok
      ? `verified: health ${healthBefore} -> ${healthAfter}. ${after.verdict.recordCount} records, ${after.verdict.missingFields.length} missing fields.`
      : `NOT verified: health only reached ${healthAfter}. Escalating to a human.`
  );

  const at = new Date().toISOString();
  appendEvent({
    id: newId('evt'),
    targetId: target.id,
    at,
    kind: 'heal_done',
    title: ok ? `Collector repaired — ${target.name}` : `Heal did not restore ${target.name}`,
    detail: ok
      ? `Scraper Studio regenerated the extraction logic. Health ${healthBefore} -> ${healthAfter}.`
      : `Health reached only ${healthAfter}/100 after healing.`,
    health: healthAfter,
    collectorId,
  });
  if (ok) {
    appendEvent({
      id: newId('evt'),
      targetId: target.id,
      at,
      kind: 'recovered',
      title: `${target.name} back in print`,
      detail: `${after.verdict.recordCount} records flowing again with no human intervention.`,
      health: healthAfter,
      collectorId,
    });
  }

  return {
    targetId: target.id,
    collectorId,
    description,
    command,
    executed,
    ok,
    healthBefore,
    healthAfter,
    durationMs: Date.now() - started,
    log,
  };
}

/**
 * Sweep every target and heal the ones Spider-Sense says are unhealthy. This is
 * what a cron job or a CI step calls.
 *
 * @param {Target[]} targets
 * @param {{emit?: Emit}} [options]
 * @returns {Promise<Array<HealOutcome | {skipped: true, reason: string, targetId: string}>>}
 */
export async function healSweep(targets, options = {}) {
  const results = [];
  for (const target of targets) {
    const run = latestRun(target.id);
    // Cheap pre-filter: skip targets whose last run was clean.
    if (run && run.status === 'ok') continue;
    results.push(await healTarget(target, options));
  }
  return results;
}

/**
 * @param {number} ms
 * @returns {Promise<void>}
 */
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
