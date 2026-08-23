/**
 * @file Pipeline — one scrape, scored and persisted.
 *
 * This is the seam between Bright Data and the rest of the app. Everything
 * downstream (the newspaper, the health grid, the heal orchestrator) reads `Run`
 * records produced here and never talks to a collector directly.
 */

import { config, collectorIdFor } from './config.js';
import { triggerCollector, normaliseReleases } from './brightdata.js';
import { fixtureReleases } from './fixtures.js';
import { evaluate } from './spider-sense.js';
import { appendRun, appendEvent, breakFor, latestRun } from './store.js';

/** @typedef {import('./store.js').Target} Target */
/** @typedef {import('./store.js').Run} Run */

/** Monotonic-ish id generator. Timestamps collide under a tight loop; the counter breaks ties. */
let seq = 0;

/**
 * Generate a run id.
 *
 * @param {string} prefix
 * @returns {string}
 */
export function newId(prefix) {
  seq += 1;
  return `${prefix}_${Date.now().toString(36)}${seq.toString(36)}`;
}

/**
 * Scrape one target, score the result with Spider-Sense, persist a `Run`, and
 * log a canon event when the collector is unhealthy.
 *
 * @param {Target} target
 * @param {{at?: string, persist?: boolean}} [options]
 * @returns {Promise<{run: Run, verdict: import('./spider-sense.js').Verdict}>}
 */
export async function runTarget(target, options = {}) {
  const startedAt = options.at ?? new Date().toISOString();
  const persist = options.persist !== false;
  const collectorId = collectorIdFor(target.collectorEnv) || `c_pending_${target.id}`;
  const previous = latestRun(target.id);
  const started = Date.now();

  /** @type {import('./store.js').Release[]} */
  let releases = [];
  /** @type {string | undefined} */
  let note;
  /** @type {'fixture' | 'live'} */
  let source = 'fixture';

  if (config.mode === 'live' && collectorId.startsWith('c_')) {
    source = 'live';
    const result = await triggerCollector(collectorId, target.url);
    if (result.ok) {
      releases = normaliseReleases(result.body);
      note = `Bright Data ${result.status} in ${result.durationMs}ms`;
    } else {
      note = result.error ?? `Bright Data ${result.status}`;
    }
  } else {
    // Fixture mode: read the committed snapshot, degraded if a break is active.
    const mode = breakFor(target.id);
    releases = fixtureReleases(target.id, mode);
    note = mode ? `fixture payload degraded by simulated break: ${mode}` : 'fixture payload';
  }

  const verdict = evaluate({ releases, target, ...(previous ? { previous } : {}) });

  /** @type {Run} */
  const run = {
    id: newId('run'),
    targetId: target.id,
    collectorId,
    startedAt,
    durationMs: Date.now() - started,
    status: verdict.status,
    releases,
    missingFields: verdict.missingFields,
    recordCount: verdict.recordCount,
    nullRate: verdict.nullRate,
    ...(note ? { note } : {}),
    source,
  };

  if (persist) {
    appendRun(run);
    // Only log a detection event on the transition into unhealthy, so a target
    // that stays broken does not spam the timeline every cycle.
    const wasHealthy = !previous || previous.status === 'ok';
    if (verdict.status !== 'ok' && wasHealthy) {
      appendEvent({
        id: newId('evt'),
        targetId: target.id,
        at: startedAt,
        kind: 'detect',
        title: `Spider-Sense tingling — ${target.name}`,
        detail: verdict.headline,
        health: verdict.health,
        collectorId,
      });
    }
  }

  return { run, verdict };
}

/**
 * Scrape every target in sequence. Sequential on purpose: a real account has a
 * concurrency budget, and a burst of parallel triggers is the fastest way to get
 * rate-limited mid-demo.
 *
 * @param {Target[]} targets
 * @param {{onProgress?: (target: Target, verdict: import('./spider-sense.js').Verdict) => void}} [options]
 * @returns {Promise<Array<{run: Run, verdict: import('./spider-sense.js').Verdict}>>}
 */
export async function runAll(targets, options = {}) {
  const results = [];
  for (const target of targets) {
    const result = await runTarget(target);
    options.onProgress?.(target, result.verdict);
    results.push(result);
  }
  return results;
}
