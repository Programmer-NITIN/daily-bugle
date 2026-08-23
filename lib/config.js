/**
 * @file Environment + configuration.
 *
 * Loads `.env` with a tiny hand-rolled parser so the project keeps its
 * zero-dependency guarantee (no `dotenv`). Also owns secret redaction: nothing
 * outside this module should read `BRIGHTDATA_API_TOKEN` directly.
 */

import { readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/** Absolute path to the repository root. */
export const ROOT = process.cwd();

/**
 * Parse a dotenv-style file. Supports `KEY=value`, `#` comments, blank lines,
 * and single/double quoted values. Deliberately minimal.
 *
 * @param {string} text
 * @returns {Record<string, string>}
 */
export function parseEnv(text) {
  /** @type {Record<string, string>} */
  const out = {};
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"') && value.length > 1) ||
      (value.startsWith("'") && value.endsWith("'") && value.length > 1)
    ) {
      value = value.slice(1, -1);
    }
    if (key) out[key] = value;
  }
  return out;
}

/**
 * Load `.env` into `process.env` without overwriting variables that are already
 * set (real environment always wins over the file).
 *
 * @param {string} [file]
 * @returns {void}
 */
function loadDotEnv(file = join(ROOT, '.env')) {
  if (!existsSync(file)) return;
  const parsed = parseEnv(readFileSync(file, 'utf8'));
  for (const [key, value] of Object.entries(parsed)) {
    if (process.env[key] === undefined) process.env[key] = value;
  }
}

loadDotEnv();

/**
 * @typedef {'fixture' | 'live'} BugleMode
 */

/**
 * @typedef {object} Config
 * @property {BugleMode} mode              Data source: committed fixtures or the live API.
 * @property {string}    apiToken          Bright Data API token. Empty string when unset.
 * @property {string}    apiBase           Scraper Studio API base URL.
 * @property {number}    healThreshold     Health score (0-100) below which healing fires.
 * @property {boolean}   healExecute       Whether the orchestrator may shell out to `bdata`.
 * @property {number}    port              HTTP port.
 */

const rawMode = (process.env.BUGLE_MODE || 'fixture').toLowerCase();

/** @type {Config} */
export const config = {
  mode: rawMode === 'live' ? 'live' : 'fixture',
  apiToken: process.env.BRIGHTDATA_API_TOKEN || '',
  apiBase: (process.env.BRIGHTDATA_API_BASE || 'https://api.brightdata.com').replace(/\/+$/, ''),
  healThreshold: Number.parseInt(process.env.HEAL_THRESHOLD || '60', 10),
  healExecute: process.env.HEAL_EXECUTE === '1',
  port: Number.parseInt(process.env.PORT || '4830', 10),
};

/**
 * Resolve the collector id for a target from the environment.
 *
 * @param {string} collectorEnv The `.env` key, e.g. `COLLECTOR_ZED`.
 * @returns {string} The `c_*` id, or an empty string if not configured.
 */
export function collectorIdFor(collectorEnv) {
  return (process.env[collectorEnv] || '').trim();
}

/**
 * True when live mode is actually usable: a token plus at least one collector.
 *
 * @returns {boolean}
 */
export function liveReady() {
  if (config.mode !== 'live') return false;
  if (!config.apiToken) return false;
  return Object.keys(process.env).some(
    (k) => k.startsWith('COLLECTOR_') && (process.env[k] || '').trim().startsWith('c_')
  );
}

/**
 * Mask a secret for display. Never return the raw value from here.
 *
 * @param {string} secret
 * @returns {string}
 */
export function redact(secret) {
  if (!secret) return '(unset)';
  if (secret.length <= 8) return '•'.repeat(secret.length);
  return `${secret.slice(0, 4)}${'•'.repeat(12)}${secret.slice(-4)}`;
}

/**
 * A safe snapshot of configuration for the UI / API. Contains no secrets.
 *
 * @returns {{mode: BugleMode, apiBase: string, healThreshold: number, healExecute: boolean, liveReady: boolean, tokenPresent: boolean, tokenPreview: string}}
 */
export function publicConfig() {
  return {
    mode: config.mode,
    apiBase: config.apiBase,
    healThreshold: config.healThreshold,
    healExecute: config.healExecute,
    liveReady: liveReady(),
    tokenPresent: Boolean(config.apiToken),
    tokenPreview: redact(config.apiToken),
  };
}
