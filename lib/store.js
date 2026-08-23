import { readFileSync, writeFileSync, mkdirSync, existsSync, renameSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT } from './config.js';
import { healthySnapshot, degrade } from './fixtures.js';
import { evaluate } from './spider-sense.js';

const DATA_DIR = join(ROOT, 'data');
const RUNTIME_DIR = join(DATA_DIR, 'runtime');

/** @type {Run[] | null} */
let inMemoryRuns = null;
/** @type {CanonEvent[] | null} */
let inMemoryEvents = null;
/** @type {Record<string, BreakState> | null} */
let inMemoryBreaks = null;

function autoSeedInMemory() {
  const DAYS = 14;
  const HISTORIC_BREAK = { targetId: 'typst', dayIndex: 5, mode: /** @type {const} */ ('selector-drift') };
  const pressTime = (daysAgo) => new Date(Date.now() - daysAgo * 86_400_000).toISOString();
  const hashUnit = (seed) => {
    let h = 2166136261;
    for (let i = 0; i < seed.length; i += 1) {
      h ^= seed.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return ((h >>> 0) % 10000) / 10000;
  };

  const targets = getTargets();
  const runs = [];
  const events = [];

  let n = 0;
  for (let daysAgo = DAYS - 1; daysAgo >= 0; daysAgo -= 1) {
    const dayIndex = DAYS - 1 - daysAgo;
    for (const target of targets) {
      const healthy = healthySnapshot(target.id);
      const isHistoricBreak =
        target.id === HISTORIC_BREAK.targetId &&
        (dayIndex === HISTORIC_BREAK.dayIndex || dayIndex === HISTORIC_BREAK.dayIndex + 1);

      const releases = isHistoricBreak ? degrade(healthy, HISTORIC_BREAK.mode) : healthy;
      const previous = [...runs].reverse().find((r) => r.targetId === target.id);
      const verdict = evaluate({ releases, target, ...(previous ? { previous } : {}) });
      const at = pressTime(daysAgo);
      n += 1;

      runs.push({
        id: `run_seed_${String(n).padStart(4, '0')}`,
        targetId: target.id,
        collectorId: `c_pending_${target.id}`,
        startedAt: at,
        durationMs: 1400 + Math.round(hashUnit(`${target.id}${daysAgo}`) * 4200),
        status: verdict.status,
        releases,
        missingFields: verdict.missingFields,
        recordCount: verdict.recordCount,
        nullRate: verdict.nullRate,
        note: isHistoricBreak ? 'layout drift on the live page' : 'nominal',
        source: 'fixture',
      });

      if (target.id === HISTORIC_BREAK.targetId && dayIndex === HISTORIC_BREAK.dayIndex) {
        events.push(
          {
            id: `evt_seed_${target.id}_break`,
            targetId: target.id,
            at,
            kind: 'break',
            title: `${target.name} redesigned its changelog`,
            detail:
              'The version headings moved out of the release container and into a sibling element. The collector kept returning HTTP 200 with hollow records — the failure mode that silently rots a data pipeline.',
            health: verdict.health,
            collectorId: `c_pending_${target.id}`,
          },
          {
            id: `evt_seed_${target.id}_detect`,
            targetId: target.id,
            at: new Date(Date.parse(at) + 90_000).toISOString(),
            kind: 'detect',
            title: `Spider-Sense tingling — ${target.name}`,
            detail: verdict.headline,
            health: verdict.health,
            collectorId: `c_pending_${target.id}`,
          }
        );
      }
      if (target.id === HISTORIC_BREAK.targetId && dayIndex === HISTORIC_BREAK.dayIndex + 2) {
        events.push(
          {
            id: `evt_seed_${target.id}_healstart`,
            targetId: target.id,
            at: new Date(Date.parse(at) - 600_000).toISOString(),
            kind: 'heal_start',
            title: `Calling bdata scraper heal — ${target.name}`,
            detail:
              'Repair brief composed from the failure signature and handed to Scraper Studio. No human wrote a selector.',
            health: 34,
            collectorId: `c_pending_${target.id}`,
          },
          {
            id: `evt_seed_${target.id}_healdone`,
            targetId: target.id,
            at: new Date(Date.parse(at) - 120_000).toISOString(),
            kind: 'heal_done',
            title: `Collector repaired — ${target.name}`,
            detail: 'Scraper Studio regenerated the extraction logic against the new layout. Health 34 -> 100.',
            health: 100,
            collectorId: `c_pending_${target.id}`,
          },
          {
            id: `evt_seed_${target.id}_recovered`,
            targetId: target.id,
            at,
            kind: 'recovered',
            title: `${target.name} back in print`,
            detail: 'Two press cycles missed. Zero engineer-hours spent.',
            health: 100,
            collectorId: `c_pending_${target.id}`,
          }
        );
      }
    }
  }

  events.sort((a, b) => a.at.localeCompare(b.at));
  inMemoryRuns = runs;
  inMemoryEvents = events;
  inMemoryBreaks = {};
}

function ensureState() {
  if (inMemoryRuns === null) {
    const diskRuns = readJson(RUNS_FILE, null);
    if (diskRuns && Array.isArray(diskRuns) && diskRuns.length > 0) {
      inMemoryRuns = diskRuns;
      inMemoryEvents = readJson(EVENTS_FILE, []);
      inMemoryBreaks = readJson(BREAKS_FILE, {});
    } else {
      autoSeedInMemory();
    }
  }
}

/**
 * @typedef {object} Target
 * @property {string}   id
 * @property {string}   name
 * @property {string}   category
 * @property {string}   url
 * @property {string}   collectorEnv
 * @property {string}   prompt
 * @property {string[]} expectedFields
 * @property {'low'|'medium'|'high'} signal
 * @property {string}   why
 */

/**
 * @typedef {object} ChangeEntry
 * @property {'feature'|'fix'|'breaking'|'chore'} type
 * @property {string} text
 */

/**
 * @typedef {object} Release
 * @property {string} version
 * @property {string} releasedAt   ISO date.
 * @property {string} [headline]
 * @property {ChangeEntry[]} entries
 */

/**
 * @typedef {object} Run
 * @property {string}  id
 * @property {string}  targetId
 * @property {string}  collectorId
 * @property {string}  startedAt      ISO timestamp.
 * @property {number}  durationMs
 * @property {'ok'|'degraded'|'failed'} status
 * @property {Release[]} releases
 * @property {string[]} missingFields  Expected fields absent from the payload.
 * @property {number}  recordCount
 * @property {number}  nullRate       0..1 — share of expected fields that came back empty.
 * @property {string}  [note]
 * @property {'fixture'|'live'} source
 */

/**
 * @typedef {object} CanonEvent
 * @property {string} id
 * @property {string} targetId
 * @property {string} at             ISO timestamp.
 * @property {'break'|'detect'|'heal_start'|'heal_done'|'recovered'} kind
 * @property {string} title
 * @property {string} detail
 * @property {number} [health]
 * @property {string} [collectorId]
 */

/**
 * @typedef {object} Database
 * @property {Run[]} runs
 * @property {CanonEvent[]} events
 */

/** @returns {void} */
function ensureRuntime() {
  try {
    if (!existsSync(RUNTIME_DIR)) mkdirSync(RUNTIME_DIR, { recursive: true });
  } catch (e) {}
}

/**
 * Read and parse a JSON file, returning a fallback when it is absent.
 *
 * @template T
 * @param {string} file
 * @param {T} fallback
 * @returns {T}
 */
function readJson(file, fallback) {
  try {
    if (!existsSync(file)) return fallback;
    return /** @type {T} */ (JSON.parse(readFileSync(file, 'utf8')));
  } catch {
    return fallback;
  }
}

/**
 * Atomically write JSON (write to a temp file, then rename) so a crash mid-write
 * can never leave a truncated database behind.
 *
 * @param {string} file
 * @param {unknown} value
 * @returns {void}
 */
function writeJson(file, value) {
  try {
    ensureRuntime();
    const tmp = `${file}.tmp`;
    writeFileSync(tmp, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
    renameSync(tmp, file);
  } catch (e) {}
}

const RUNS_FILE = join(RUNTIME_DIR, 'runs.json');
const EVENTS_FILE = join(RUNTIME_DIR, 'events.json');

/**
 * Load the committed target registry.
 *
 * @returns {Target[]}
 */
export function getTargets() {
  const parsed = readJson(join(DATA_DIR, 'targets.json'), /** @type {{targets: Target[]}} */ ({ targets: [] }));
  return parsed.targets || [];
}

/**
 * Look up a single target by id.
 *
 * @param {string} id
 * @returns {Target | undefined}
 */
export function getTarget(id) {
  return getTargets().find((t) => t.id === id);
}

/** @returns {Run[]} */
export function getRuns() {
  ensureState();
  return inMemoryRuns || [];
}

/** @returns {CanonEvent[]} */
export function getEvents() {
  ensureState();
  return inMemoryEvents || [];
}

/**
 * Replace the full run history. Used by the seeder.
 *
 * @param {Run[]} runs
 * @returns {void}
 */
export function saveRuns(runs) {
  inMemoryRuns = runs;
  writeJson(RUNS_FILE, runs);
}

/**
 * Replace the full event log. Used by the seeder.
 *
 * @param {CanonEvent[]} events
 * @returns {void}
 */
export function saveEvents(events) {
  inMemoryEvents = events;
  writeJson(EVENTS_FILE, events);
}

/**
 * Append a run, newest last.
 *
 * @param {Run} run
 * @returns {Run}
 */
export function appendRun(run) {
  const runs = getRuns();
  runs.push(run);
  saveRuns(runs);
  return run;
}

/**
 * Append a canon event, newest last.
 *
 * @param {CanonEvent} event
 * @returns {CanonEvent}
 */
export function appendEvent(event) {
  const events = getEvents();
  events.push(event);
  saveEvents(events);
  return event;
}

/**
 * All runs for one target, oldest first.
 *
 * @param {string} targetId
 * @returns {Run[]}
 */
export function runsFor(targetId) {
  return getRuns().filter((r) => r.targetId === targetId);
}

/**
 * The most recent run for a target.
 *
 * @param {string} targetId
 * @returns {Run | undefined}
 */
export function latestRun(targetId) {
  const runs = runsFor(targetId);
  return runs.length ? runs[runs.length - 1] : undefined;
}

/** @returns {boolean} True when the runtime store has been seeded. */
export function isSeeded() {
  return getRuns().length > 0;
}

/* ------------------------------------------------------------------
   Simulated breakage
   ------------------------------------------------------------------
   `npm run break <target>` records a break here. In fixture mode the
   pipeline consults this map and degrades the payload accordingly, which
   is how the self-healing loop is demonstrated without waiting for a real
   site to be redesigned. Healing clears the entry.
   ------------------------------------------------------------------ */

const BREAKS_FILE = join(RUNTIME_DIR, 'breaks.json');

/**
 * @typedef {object} BreakState
 * @property {import('./fixtures.js').BreakMode} mode
 * @property {string} at   ISO timestamp the break was introduced.
 */

/** @returns {Record<string, BreakState>} Keyed by target id. */
export function getBreaks() {
  ensureState();
  return inMemoryBreaks || {};
}

/**
 * Record a simulated layout change for a target.
 *
 * @param {string} targetId
 * @param {import('./fixtures.js').BreakMode} mode
 * @param {string} at
 * @returns {void}
 */
export function setBreak(targetId, mode, at) {
  ensureState();
  if (!inMemoryBreaks) inMemoryBreaks = {};
  inMemoryBreaks[targetId] = { mode, at };
  writeJson(BREAKS_FILE, inMemoryBreaks);
}

/**
 * Clear a target's break. Called when healing succeeds.
 *
 * @param {string} targetId
 * @returns {boolean} True if there was a break to clear.
 */
export function clearBreak(targetId) {
  ensureState();
  if (!inMemoryBreaks || !(targetId in inMemoryBreaks)) return false;
  delete inMemoryBreaks[targetId];
  writeJson(BREAKS_FILE, inMemoryBreaks);
  return true;
}

/**
 * The active break mode for a target, if any.
 *
 * @param {string} targetId
 * @returns {import('./fixtures.js').BreakMode | null}
 */
export function breakFor(targetId) {
  return getBreaks()[targetId]?.mode ?? null;
}

