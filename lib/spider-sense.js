/**
 * @file Spider-Sense — drift detection.
 *
 * A generated scraper rarely throws when a site is redesigned. It keeps
 * returning HTTP 200 and an array of records; the records are just empty. That
 * silent failure is the problem this whole project exists to solve, so detection
 * cannot rely on error codes. It has to look at the *content* of the payload and
 * compare it against what the same collector produced yesterday.
 *
 * Spider-Sense scores four independent signals and folds them into one 0–100
 * health number. Every signal is a plain function of a payload plus the previous
 * run, which makes the whole module trivially testable.
 */

/** @typedef {import('./store.js').Release} Release */
/** @typedef {import('./store.js').Run} Run */
/** @typedef {import('./store.js').Target} Target */

/**
 * @typedef {object} Signal
 * @property {string} id
 * @property {string} label
 * @property {number} score   0..1, where 1 is perfectly healthy.
 * @property {number} weight  Relative contribution to the overall health score.
 * @property {string} detail  One line of human explanation.
 */

/**
 * @typedef {object} Verdict
 * @property {number}   health        0..100.
 * @property {'ok'|'degraded'|'failed'} status
 * @property {Signal[]} signals
 * @property {string[]} missingFields
 * @property {number}   nullRate      0..1.
 * @property {number}   recordCount
 * @property {string}   headline      Why the verdict is what it is, in one line.
 */

/** Health at or above this is healthy. */
export const OK_AT = 85;
/** Below this, the collector is considered to have failed outright. */
export const FAILED_UNDER = 40;

/**
 * Which expected fields are absent or empty across the whole payload.
 *
 * A field present on some records but not others is not "missing" — partial
 * coverage is normal (not every release has a headline). A field empty on
 * *every* record is the drift signal.
 *
 * @param {Release[]} releases
 * @param {string[]} expectedFields
 * @returns {string[]}
 */
export function findMissingFields(releases, expectedFields) {
  if (releases.length === 0) return [...expectedFields];
  return expectedFields.filter((field) =>
    releases.every((r) => {
      const value = /** @type {Record<string, unknown>} */ (r)[field];
      if (Array.isArray(value)) return value.length === 0;
      return value === undefined || value === null || String(value).trim() === '';
    })
  );
}

/**
 * Share of expected field slots that came back empty, across all records.
 *
 * @param {Release[]} releases
 * @param {string[]} expectedFields
 * @returns {number} 0..1
 */
export function nullRate(releases, expectedFields) {
  if (releases.length === 0) return 1;
  let slots = 0;
  let empty = 0;
  for (const r of releases) {
    for (const field of expectedFields) {
      slots += 1;
      const value = /** @type {Record<string, unknown>} */ (r)[field];
      const isEmpty = Array.isArray(value)
        ? value.length === 0
        : value === undefined || value === null || String(value).trim() === '';
      if (isEmpty) empty += 1;
    }
  }
  return slots === 0 ? 1 : empty / slots;
}

/**
 * Total number of changelog bullets across the payload. A collector that finds
 * releases but no bullets inside them is half-broken, and record count alone
 * would not catch it.
 *
 * @param {Release[]} releases
 * @returns {number}
 */
export function entryCount(releases) {
  return releases.reduce((sum, r) => sum + (r.entries?.length ?? 0), 0);
}

/**
 * Score a payload against the previous successful run.
 *
 * @param {object} input
 * @param {Release[]} input.releases      The payload just extracted.
 * @param {Target}    input.target        The target definition (supplies expectedFields).
 * @param {Run}       [input.previous]    The last run for this target, if any.
 * @returns {Verdict}
 */
export function evaluate({ releases, target, previous }) {
  const expected = target.expectedFields;
  const missing = findMissingFields(releases, expected);
  const nulls = nullRate(releases, expected);
  const records = releases.length;
  const bullets = entryCount(releases);

  const baselineRecords = previous?.recordCount ?? records;
  const baselineBullets = previous ? entryCount(previous.releases) : bullets;

  /** @type {Signal[]} */
  const signals = [
    {
      id: 'records',
      label: 'Records returned',
      weight: 0.3,
      score: records === 0 ? 0 : Math.min(1, baselineRecords === 0 ? 1 : records / baselineRecords),
      detail:
        records === 0
          ? 'Extraction returned nothing. The root selector no longer matches the page.'
          : `${records} record${records === 1 ? '' : 's'} against a baseline of ${baselineRecords}.`,
    },
    {
      id: 'fields',
      label: 'Expected fields present',
      weight: 0.3,
      score: expected.length === 0 ? 1 : 1 - missing.length / expected.length,
      detail: missing.length
        ? `Absent from every record: ${missing.join(', ')}.`
        : 'Every field named in the collector prompt came back populated.',
    },
    {
      id: 'nulls',
      label: 'Value density',
      weight: 0.25,
      score: 1 - nulls,
      detail: `${Math.round(nulls * 100)}% of expected values are empty.`,
    },
    {
      id: 'depth',
      label: 'Changelog depth',
      weight: 0.15,
      score: bullets === 0 ? 0 : Math.min(1, baselineBullets === 0 ? 1 : bullets / baselineBullets),
      detail:
        bullets === 0
          ? 'Records exist but contain no changelog bullets — the nested list selector drifted.'
          : `${bullets} bullet${bullets === 1 ? '' : 's'} extracted (baseline ${baselineBullets}).`,
    },
  ];

  const weighted = signals.reduce((sum, s) => sum + clamp01(s.score) * s.weight, 0);
  const health = Math.round(clamp01(weighted) * 100);

  /** @type {Verdict['status']} */
  const status = health >= OK_AT ? 'ok' : health < FAILED_UNDER ? 'failed' : 'degraded';

  const worst = [...signals].sort((a, b) => a.score - b.score)[0];
  const headline =
    status === 'ok'
      ? 'All four Spider-Sense signals nominal.'
      : `${worst.label} is the weakest signal — ${worst.detail}`;

  return { health, status, signals, missingFields: missing, nullRate: nulls, recordCount: records, headline };
}

/**
 * Turn a verdict into the plain-language description that `bdata scraper heal`
 * expects as its second argument. This is the bridge between detection and
 * repair: the more precisely we describe the failure, the better Scraper Studio
 * can regenerate the extraction logic.
 *
 * @param {Target} target
 * @param {Verdict} verdict
 * @returns {string}
 */
export function healDescription(target, verdict) {
  const parts = [];
  if (verdict.recordCount === 0) {
    parts.push(
      `The scraper returns zero records for ${target.url}. The page layout changed and the root selector for individual release entries no longer matches.`
    );
  } else {
    parts.push(`The scraper still returns ${verdict.recordCount} records from ${target.url} but the data is hollow.`);
  }
  if (verdict.missingFields.length) {
    parts.push(
      `These fields are now empty on every single record: ${verdict.missingFields.join(', ')}. Re-locate them on the current page.`
    );
  }
  if (verdict.nullRate > 0.3) {
    parts.push(`${Math.round(verdict.nullRate * 100)}% of all expected values came back blank.`);
  }
  parts.push(`Restore extraction of: ${target.expectedFields.join(', ')}.`);
  return parts.join(' ');
}

/**
 * Clamp a number into 0..1.
 *
 * @param {number} n
 * @returns {number}
 */
function clamp01(n) {
  if (Number.isNaN(n)) return 0;
  return Math.max(0, Math.min(1, n));
}
