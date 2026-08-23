/**
 * @file Spider-Sense unit tests.
 *
 * Detection is the load-bearing claim of this project, so it is the part that gets
 * tested. Every signal is a pure function of a payload, which makes this cheap.
 *
 * Run with `npm test` — node:test, no test-runner dependency.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { evaluate, findMissingFields, nullRate, entryCount, healDescription, OK_AT } from '../lib/spider-sense.js';
import { degrade, healthySnapshot, describeBreak, BREAK_MODES } from '../lib/fixtures.js';
import { scoreEntry, storiesFor, diffReleases, tallies } from '../lib/newsroom.js';
import { redact, parseEnv } from '../lib/config.js';
import { normaliseReleases } from '../lib/brightdata.js';
import { getTargets, getTarget } from '../lib/store.js';

/** A target fixture standing in for one loaded from data/targets.json. */
const target = /** @type {import('../lib/store.js').Target} */ ({
  id: 'zed',
  name: 'Zed Editor',
  category: 'Developer tools',
  url: 'https://zed.dev/releases/stable',
  collectorEnv: 'COLLECTOR_ZED',
  prompt: 'Extract each stable release entry.',
  expectedFields: ['version', 'releasedAt', 'entries'],
  signal: 'high',
  why: 'Redesigns often.',
});

/** @type {import('../lib/store.js').Release[]} */
const healthy = [
  { version: '0.212.0', releasedAt: '2026-08-22', entries: [{ type: 'feature', text: 'Debugger is GA.' }, { type: 'fix', text: 'Fixed a hang.' }] },
  { version: '0.211.0', releasedAt: '2026-08-15', entries: [{ type: 'breaking', text: 'Settings resolution changed.' }] },
];

test('a healthy payload scores as ok', () => {
  const v = evaluate({ releases: healthy, target });
  assert.equal(v.status, 'ok');
  assert.ok(v.health >= OK_AT, `expected health >= ${OK_AT}, got ${v.health}`);
  assert.deepEqual(v.missingFields, []);
});

test('an empty payload is a total failure, not an ok run', () => {
  const v = evaluate({ releases: [], target });
  assert.equal(v.health, 0);
  assert.equal(v.status, 'failed');
  assert.deepEqual(v.missingFields.sort(), ['entries', 'releasedAt', 'version']);
});

test('hollow records are caught even though the record count is unchanged', () => {
  // This is the silent failure: same number of records, HTTP 200, no exception.
  const drifted = degrade(healthy, 'selector-drift');
  assert.equal(drifted.length, healthy.length, 'record count is deliberately preserved');
  const v = evaluate({ releases: drifted, target });
  assert.notEqual(v.status, 'ok');
  assert.ok(v.missingFields.includes('version'));
  assert.ok(v.missingFields.includes('releasedAt'));
});

test('a missing nested bullet list is caught by changelog depth', () => {
  const drifted = degrade(healthy, 'field-renamed');
  const v = evaluate({ releases: drifted, target });
  assert.notEqual(v.status, 'ok');
  assert.equal(entryCount(drifted), 0);
  assert.ok(v.missingFields.includes('entries'));
});

test('a field empty on only SOME records is not drift', () => {
  // Partial coverage is normal — not every release has every field.
  const partial = [healthy[0], { ...healthy[1], version: '' }];
  assert.deepEqual(findMissingFields(partial, target.expectedFields), []);
});

test('nullRate is 1 for an empty payload and 0 for a full one', () => {
  assert.equal(nullRate([], target.expectedFields), 1);
  assert.equal(nullRate(healthy, target.expectedFields), 0);
});

test('health degrades relative to the previous run, not an absolute baseline', () => {
  /** @type {import('../lib/store.js').Run} */
  const previous = {
    id: 'run_1', targetId: 'zed', collectorId: 'c_x', startedAt: '2026-08-22T06:00:00.000Z',
    durationMs: 1000, status: 'ok', releases: healthy, missingFields: [], recordCount: 2,
    nullRate: 0, source: 'fixture',
  };
  const halved = evaluate({ releases: [healthy[0]], target, previous });
  const full = evaluate({ releases: healthy, target, previous });
  assert.ok(halved.health < full.health, 'losing half the records must lower health');
});

test('every break mode produces an unhealthy verdict and a human description', () => {
  for (const mode of BREAK_MODES) {
    const v = evaluate({ releases: degrade(healthy, mode), target });
    assert.notEqual(v.status, 'ok', `${mode} should not score as ok`);
    assert.ok(describeBreak(mode).length > 20, `${mode} needs a description`);
  }
});

test('the heal description names the target, the URL and the missing fields', () => {
  const v = evaluate({ releases: [], target });
  const description = healDescription(target, v);
  assert.ok(description.includes(target.url));
  for (const field of target.expectedFields) assert.ok(description.includes(field), `missing ${field}`);
  assert.ok(description.length > 80, 'a useful repair brief is not a one-liner');
});

/* ------------------------------------------------------------------
   Newsroom
   ------------------------------------------------------------------ */

test('a breaking change outranks a feature, and pricing outranks both', () => {
  const breaking = scoreEntry({ type: 'breaking', text: 'The style() function is removed.' }, target);
  const feature = scoreEntry({ type: 'feature', text: 'Added a new panel.' }, target);
  const pricing = scoreEntry({ type: 'breaking', text: 'Free plan quota reduced to 500M row reads per month.' }, target);
  assert.ok(breaking.score > feature.score);
  assert.ok(pricing.score > breaking.score);
  assert.equal(pricing.desk, 'Money desk');
  assert.equal(feature.desk, 'Features desk');
});

test('stories come back sorted by newsworthiness', () => {
  const stories = storiesFor(target, healthy);
  assert.ok(stories.length > 0);
  for (let i = 1; i < stories.length; i += 1) {
    assert.ok(stories[i - 1].score >= stories[i].score, 'stories must be descending by score');
  }
});

test('re-running a healthy collector produces an empty diff', () => {
  const diff = diffReleases(healthy, healthy);
  assert.deepEqual(diff.added, []);
  assert.deepEqual(diff.removed, []);
  assert.deepEqual(diff.newVersions, []);
});

test('a genuinely new release shows up as added', () => {
  const after = [{ version: '0.213.0', releasedAt: '2026-08-29', entries: [{ type: /** @type {const} */ ('feature'), text: 'New thing.' }] }, ...healthy];
  const diff = diffReleases(healthy, after);
  assert.deepEqual(diff.newVersions, ['0.213.0']);
  assert.equal(diff.added.length, 1);
  assert.equal(diff.added[0].text, 'New thing.');
});

test('tallies count each change type', () => {
  const t = tallies(storiesFor(target, healthy));
  assert.equal(t.breaking, 1);
  assert.equal(t.features, 1);
  assert.equal(t.fixes, 1);
});

/* ------------------------------------------------------------------
   Payload normalising — tolerate what a generated collector really returns
   ------------------------------------------------------------------ */

test('normaliseReleases accepts GitHub-style field names and a wrapped array', () => {
  const releases = normaliseReleases({
    results: [{ tag_name: 'v1.2.3', published_at: '2026-08-01', changes: ['One thing', { type: 'fix', text: 'Another' }] }],
  });
  assert.equal(releases.length, 1);
  assert.equal(releases[0].version, 'v1.2.3');
  assert.equal(releases[0].releasedAt, '2026-08-01');
  assert.equal(releases[0].entries.length, 2);
  assert.equal(releases[0].entries[1].type, 'fix');
});

test('normaliseReleases survives garbage without throwing', () => {
  for (const junk of [null, undefined, 42, 'a string', {}, [null, 3, 'x']]) {
    assert.doesNotThrow(() => normaliseReleases(junk));
  }
  assert.deepEqual(normaliseReleases(null), []);
});

/* ------------------------------------------------------------------
   Secrets
   ------------------------------------------------------------------ */

test('redact never returns the raw secret', () => {
  const secret = 'brd_supersecrettoken_a91f';
  const masked = redact(secret);
  assert.ok(!masked.includes('supersecret'));
  assert.ok(masked.includes('•'));
  assert.equal(redact(''), '(unset)');
  assert.ok(!redact('short').includes('short'));
});

test('parseEnv handles comments, quotes and blank lines', () => {
  const parsed = parseEnv('# comment\n\nA=1\nB="two"\nC=\'three\'\nBAD_LINE\nD=has=equals');
  assert.deepEqual(parsed, { A: '1', B: 'two', C: 'three', D: 'has=equals' });
});

/* ------------------------------------------------------------------
   Registry integrity — a broken targets.json breaks everything downstream
   ------------------------------------------------------------------ */

test('every target is well formed and has a snapshot to run against', () => {
  const targets = getTargets();
  assert.ok(targets.length >= 8, 'expected at least 8 long-tail targets');
  const ids = new Set();
  for (const t of targets) {
    assert.ok(t.id && !ids.has(t.id), `duplicate or missing id: ${t.id}`);
    ids.add(t.id);
    assert.match(t.url, /^https:\/\//, `${t.id} must have an https url`);
    assert.match(t.collectorEnv, /^COLLECTOR_[A-Z_]+$/, `${t.id} needs a COLLECTOR_* env key`);
    assert.ok(t.prompt.length > 60, `${t.id} needs a real plain-language prompt`);
    assert.ok(t.expectedFields.length >= 3, `${t.id} needs expected fields to score against`);
    assert.ok(['low', 'medium', 'high'].includes(t.signal), `${t.id} has a bad signal value`);
    assert.ok(healthySnapshot(t.id).length > 0, `${t.id} has no snapshot — fixture mode would be empty`);
  }
  assert.ok(getTarget('zed'), 'getTarget should find a known id');
  assert.equal(getTarget('nope'), undefined);
});
