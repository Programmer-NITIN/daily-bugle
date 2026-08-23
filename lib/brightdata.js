/**
 * @file Bright Data Scraper Studio client.
 *
 * Two ways to reach a collector, both real:
 *
 *  1. `triggerCollector` — HTTP `POST /dca/trigger?collector=<c_*>`. This is the
 *     production endpoint that Scraper Studio provisions automatically for every
 *     scraper you generate. No infrastructure of our own to deploy.
 *  2. `cli` — shells out to `bdata` for the operations that are CLI-native,
 *     most importantly `bdata scraper heal`.
 *
 * In `fixture` mode neither is contacted; `lib/fixtures.js` supplies data so the
 * repo runs with zero credentials.
 */

import { spawn } from 'node:child_process';
import { config, collectorIdFor } from './config.js';

/**
 * @typedef {object} TriggerResult
 * @property {boolean}  ok
 * @property {number}   status        HTTP status, or 0 on transport failure.
 * @property {unknown}  body          Parsed JSON when possible, else raw text.
 * @property {number}   durationMs
 * @property {string}   [error]
 */

/**
 * Trigger a collector and return its structured output.
 *
 * @param {string} collectorId  A Scraper Studio collector id (`c_*`).
 * @param {string} url          The page to extract.
 * @param {{timeoutMs?: number}} [options]
 * @returns {Promise<TriggerResult>}
 */
export async function triggerCollector(collectorId, url, options = {}) {
  const started = Date.now();
  const timeoutMs = options.timeoutMs ?? 120_000;

  if (!config.apiToken) {
    return {
      ok: false,
      status: 0,
      body: null,
      durationMs: 0,
      error: 'BRIGHTDATA_API_TOKEN is not set. Set it in .env, or use BUGLE_MODE=fixture.',
    };
  }
  if (!collectorId.startsWith('c_')) {
    return {
      ok: false,
      status: 0,
      body: null,
      durationMs: 0,
      error: `"${collectorId}" is not a valid collector id (expected c_*). Create one with: bdata scraper create <url> "<description>"`,
    };
  }

  const endpoint = `${config.apiBase}/dca/trigger?collector=${encodeURIComponent(collectorId)}&queue_next=1`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${config.apiToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify([{ url }]),
      signal: controller.signal,
    });

    const text = await response.text();
    /** @type {unknown} */
    let body;
    try {
      body = JSON.parse(text);
    } catch {
      body = text;
    }

    return {
      ok: response.ok,
      status: response.status,
      body,
      durationMs: Date.now() - started,
      ...(response.ok ? {} : { error: `Bright Data responded ${response.status}` }),
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      ok: false,
      status: 0,
      body: null,
      durationMs: Date.now() - started,
      error: controller.signal.aborted ? `Timed out after ${timeoutMs}ms` : message,
    };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * @typedef {object} CliResult
 * @property {boolean} ok
 * @property {number|null} code
 * @property {string} stdout
 * @property {string} stderr
 * @property {number} durationMs
 * @property {string} command   The command as run, for display. Never contains the token.
 */

/**
 * Run a `bdata` CLI subcommand.
 *
 * Uses `npx -p @brightdata/cli bdata ...` so the repo needs no global install and
 * still ships zero dependencies of its own.
 *
 * @param {string[]} args              e.g. `['scraper', 'heal', 'c_abc', 'selector drifted']`
 * @param {{timeoutMs?: number, onOutput?: (chunk: string) => void}} [options]
 * @returns {Promise<CliResult>}
 */
export function cli(args, options = {}) {
  const timeoutMs = options.timeoutMs ?? 600_000;
  const command = `npx -p @brightdata/cli bdata ${args.join(' ')}`;
  const started = Date.now();

  return new Promise((resolve) => {
    const child = spawn('npx', ['-p', '@brightdata/cli', 'bdata', ...args], {
      shell: process.platform === 'win32',
      env: process.env,
    });

    let stdout = '';
    let stderr = '';
    let settled = false;

    const timer = setTimeout(() => {
      if (!settled) child.kill('SIGTERM');
    }, timeoutMs);

    child.stdout.on('data', (buf) => {
      const chunk = String(buf);
      stdout += chunk;
      options.onOutput?.(chunk);
    });
    child.stderr.on('data', (buf) => {
      const chunk = String(buf);
      stderr += chunk;
      options.onOutput?.(chunk);
    });

    child.on('error', (err) => {
      settled = true;
      clearTimeout(timer);
      resolve({
        ok: false,
        code: null,
        stdout,
        stderr: `${stderr}\n${err.message}`.trim(),
        durationMs: Date.now() - started,
        command,
      });
    });

    child.on('close', (code) => {
      settled = true;
      clearTimeout(timer);
      resolve({
        ok: code === 0,
        code,
        stdout,
        stderr,
        durationMs: Date.now() - started,
        command,
      });
    });
  });
}

/**
 * Ask Scraper Studio to repair a collector after a layout change.
 *
 * @param {string} collectorId
 * @param {string} description  What broke, in plain language.
 * @param {{onOutput?: (chunk: string) => void}} [options]
 * @returns {Promise<CliResult>}
 */
export function healCollector(collectorId, description, options = {}) {
  return cli(['scraper', 'heal', collectorId, description], {
    timeoutMs: 900_000,
    ...(options.onOutput ? { onOutput: options.onOutput } : {}),
  });
}

/**
 * Build the exact `bdata scraper create` command for a target. Surfaced in the UI
 * and by `bin/collectors.js` so the description sent to Scraper Studio always
 * matches the schema the app expects.
 *
 * @param {import('./store.js').Target} target
 * @returns {string}
 */
export function createCommandFor(target) {
  const escaped = target.prompt.replace(/"/g, '\\"');
  return `bdata scraper create ${target.url} "${escaped}"`;
}

/**
 * Which targets have a usable collector id configured.
 *
 * @param {import('./store.js').Target[]} targets
 * @returns {{configured: import('./store.js').Target[], missing: import('./store.js').Target[]}}
 */
export function partitionByCollector(targets) {
  /** @type {import('./store.js').Target[]} */
  const configured = [];
  /** @type {import('./store.js').Target[]} */
  const missing = [];
  for (const t of targets) {
    if (collectorIdFor(t.collectorEnv).startsWith('c_')) configured.push(t);
    else missing.push(t);
  }
  return { configured, missing };
}

/**
 * Normalise whatever Scraper Studio returns into our `Release[]` shape.
 *
 * Generated collectors return field names close to, but not exactly, our schema,
 * and the payload may be a bare array or wrapped. Tolerating that here keeps the
 * rest of the app working off one clean shape — and the fields this *fails* to
 * find are precisely the drift signal Spider-Sense scores.
 *
 * @param {unknown} payload
 * @returns {import('./store.js').Release[]}
 */
export function normaliseReleases(payload) {
  /** @type {unknown[]} */
  let rows = [];
  if (Array.isArray(payload)) rows = payload;
  else if (payload && typeof payload === 'object') {
    const obj = /** @type {Record<string, unknown>} */ (payload);
    for (const key of ['results', 'data', 'releases', 'items', 'entries']) {
      if (Array.isArray(obj[key])) {
        rows = /** @type {unknown[]} */ (obj[key]);
        break;
      }
    }
  }

  /** @type {import('./store.js').Release[]} */
  const releases = [];
  for (const row of rows) {
    if (!row || typeof row !== 'object') continue;
    const r = /** @type {Record<string, any>} */ (row);
    const version = String(r.version ?? r.tag ?? r.tag_name ?? r.title ?? '').trim();
    const releasedAt = String(r.releasedAt ?? r.released_at ?? r.date ?? r.published_at ?? '').trim();
    const rawEntries = r.entries ?? r.changes ?? r.bullets ?? r.notes ?? [];

    /** @type {import('./store.js').ChangeEntry[]} */
    const entries = [];
    if (Array.isArray(rawEntries)) {
      for (const e of rawEntries) {
        if (typeof e === 'string') entries.push({ type: 'feature', text: e });
        else if (e && typeof e === 'object') {
          const eo = /** @type {Record<string, any>} */ (e);
          const type = String(eo.type ?? 'feature').toLowerCase();
          entries.push({
            type: /** @type {import('./store.js').ChangeEntry['type']} */ (
              ['feature', 'fix', 'breaking', 'chore'].includes(type) ? type : 'feature'
            ),
            text: String(eo.text ?? eo.title ?? eo.description ?? '').trim(),
          });
        }
      }
    }

    releases.push({
      version,
      releasedAt,
      ...(r.headline ? { headline: String(r.headline) } : {}),
      entries: entries.filter((e) => e.text),
    });
  }
  return releases;
}
