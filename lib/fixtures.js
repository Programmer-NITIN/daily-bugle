/**
 * @file Fixture data source.
 *
 * In `fixture` mode the app reads committed snapshots instead of calling Bright
 * Data, so a judge can clone the repo and see the full product — including the
 * self-healing loop — without a token or a single credit spent.
 *
 * Crucially the *shape* of what this returns is identical to what
 * `normaliseReleases()` produces from a real collector payload, and the
 * degradation modes below mirror the ways a real generated scraper actually
 * fails when a site is redesigned: fields vanish, arrays come back empty, or
 * the whole extraction returns nothing.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT } from './config.js';

/** @typedef {import('./store.js').Release} Release */

const snapshotFile = join(ROOT, 'data', 'snapshots.json');

/** @type {{snapshots: Record<string, Release[]>} | null} */
let cache = null;

/**
 * Load and memoise the snapshot corpus.
 *
 * @returns {Record<string, Release[]>}
 */
function snapshots() {
  if (!cache) cache = JSON.parse(readFileSync(snapshotFile, 'utf8'));
  return cache?.snapshots ?? {};
}

/**
 * The healthy payload for a target: exactly what a working collector returns.
 *
 * @param {string} targetId
 * @returns {Release[]}
 */
export function healthySnapshot(targetId) {
  return structuredClone(snapshots()[targetId] ?? []);
}

/**
 * How a scraper can break when the target site changes.
 *
 * - `selector-drift`  the container still matches but the field selectors inside
 *                     it do not, so records arrive with empty values.
 * - `field-renamed`   one expected key disappears entirely from every record.
 * - `total-blackout`  the root selector no longer matches; zero records.
 *
 * @typedef {'selector-drift' | 'field-renamed' | 'total-blackout'} BreakMode
 */

/** @type {BreakMode[]} */
export const BREAK_MODES = ['selector-drift', 'field-renamed', 'total-blackout'];

/**
 * Human-readable explanation of a break mode, used both in the UI and as the
 * plain-language description handed to `bdata scraper heal`.
 *
 * @param {BreakMode} mode
 * @returns {string}
 */
export function describeBreak(mode) {
  switch (mode) {
    case 'selector-drift':
      return 'the release container still matches but the version and date fields inside it now come back empty, so every record is a hollow shell';
    case 'field-renamed':
      return 'the changelog bullet list is no longer found — the entries array is missing from every record';
    case 'total-blackout':
      return 'the root selector matches nothing at all and the extraction returns zero records';
    default:
      return 'the extraction no longer matches the page';
  }
}

/**
 * Apply a break mode to a healthy payload, producing the degraded payload a
 * drifted collector would return.
 *
 * @param {Release[]} releases
 * @param {BreakMode} mode
 * @returns {Release[]}
 */
export function degrade(releases, mode) {
  if (mode === 'total-blackout') return [];
  if (mode === 'field-renamed') {
    return releases.map((r) => ({ ...r, entries: [] }));
  }
  // selector-drift
  return releases.map((r) => ({ ...r, version: '', releasedAt: '', entries: r.entries.slice(0, 1) }));
}

/**
 * Fetch a target's releases from fixtures, optionally degraded.
 *
 * @param {string} targetId
 * @param {BreakMode | null} [breakMode]
 * @returns {Release[]}
 */
export function fixtureReleases(targetId, breakMode = null) {
  const healthy = healthySnapshot(targetId);
  return breakMode ? degrade(healthy, breakMode) : healthy;
}

/**
 * All target ids present in the snapshot corpus.
 *
 * @returns {string[]}
 */
export function snapshotIds() {
  return Object.keys(snapshots());
}
