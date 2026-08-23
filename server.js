/**
 * @file HTTP server — the newsroom API and the static front page.
 *
 * Zero dependencies: `node:http` plus a small router. The interesting endpoint is
 * `GET /api/heal/:id/stream`, a Server-Sent Events channel that pipes the heal
 * orchestrator's output to the browser line by line, so the front page shows the
 * actual repair happening rather than a spinner and a result.
 */

import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { config, publicConfig, collectorIdFor, redact } from './lib/config.js';
import {
  getTargets, getTarget, getRuns, getEvents, runsFor, latestRun, getBreaks, isSeeded,
} from './lib/store.js';
import { evaluate } from './lib/spider-sense.js';
import { storiesFor, leadStory, tallies, diffReleases } from './lib/newsroom.js';
import { runTarget } from './lib/pipeline.js';
import { healTarget } from './lib/heal.js';
import { createCommandFor } from './lib/brightdata.js';
import { describeBreak } from './lib/fixtures.js';

const PUBLIC_DIR = join(import.meta.dirname, 'public');

/** @type {Record<string, string>} */
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.woff2': 'font/woff2',
  '.ico': 'image/x-icon',
};

/**
 * Send a JSON response.
 *
 * @param {import('node:http').ServerResponse} res
 * @param {unknown} body
 * @param {number} [status]
 * @returns {void}
 */
function json(res, body, status = 200) {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(payload),
    'Cache-Control': 'no-store',
  });
  res.end(payload);
}

/* ------------------------------------------------------------------
   View models
   ------------------------------------------------------------------ */

/**
 * Everything the front page needs about one target: its current health, the
 * fourteen-day trend, its collector, and its stories.
 *
 * @param {import('./lib/store.js').Target} target
 */
function targetView(target) {
  const runs = runsFor(target.id);
  const last = runs[runs.length - 1];
  const releases = last?.releases ?? [];
  const previous = runs.length > 1 ? runs[runs.length - 2] : undefined;
  const verdict = last ? evaluate({ releases, target, ...(previous ? { previous } : {}) }) : null;
  const collectorId = collectorIdFor(target.collectorEnv);
  const breaks = getBreaks();

  return {
    id: target.id,
    name: target.name,
    category: target.category,
    url: target.url,
    why: target.why,
    signal: target.signal,
    prompt: target.prompt,
    expectedFields: target.expectedFields,
    collectorEnv: target.collectorEnv,
    collectorId: collectorId ? redact(collectorId) : null,
    collectorConfigured: collectorId.startsWith('c_'),
    createCommand: createCommandFor(target),
    status: last?.status ?? 'unknown',
    health: verdict?.health ?? 0,
    headline: verdict?.headline ?? 'No runs yet. Run `npm run seed`.',
    signals: verdict?.signals ?? [],
    missingFields: last?.missingFields ?? [],
    recordCount: last?.recordCount ?? 0,
    nullRate: last?.nullRate ?? 1,
    lastRunAt: last?.startedAt ?? null,
    durationMs: last?.durationMs ?? 0,
    source: last?.source ?? 'fixture',
    trend: runs.slice(-14).map((r) => {
      const v = evaluate({ releases: r.releases, target });
      return { at: r.startedAt, health: v.health, status: r.status };
    }),
    broken: breaks[target.id] ? { ...breaks[target.id], description: describeBreak(breaks[target.id].mode) } : null,
    stories: storiesFor(target, releases).slice(0, 8),
    releases: releases.slice(0, 4),
  };
}

/**
 * The whole front page in one payload. One request, one render — no waterfall.
 *
 */
function frontPage() {
  const targets = getTargets().map(targetView);
  const allStories = targets.flatMap((t) => t.stories).sort((a, b) => b.score - a.score);
  const events = getEvents().slice(-40).reverse();
  const runs = getRuns();

  const healthy = targets.filter((t) => t.status === 'ok').length;
  const fleetHealth = targets.length
    ? Math.round(targets.reduce((sum, t) => sum + t.health, 0) / targets.length)
    : 0;

  return {
    config: publicConfig(),
    seeded: isSeeded(),
    edition: {
      date: new Date().toISOString(),
      volume: 1,
      issue: runs.length,
      pressRuns: runs.length,
    },
    fleet: {
      total: targets.length,
      healthy,
      unhealthy: targets.length - healthy,
      health: fleetHealth,
      collectorsConfigured: targets.filter((t) => t.collectorConfigured).length,
      totalRecords: targets.reduce((s, t) => s + t.recordCount, 0),
      healEvents: getEvents().filter((e) => e.kind === 'heal_done').length,
    },
    lead: leadStory(allStories) ?? null,
    tallies: tallies(allStories),
    stories: allStories.slice(0, 24),
    targets,
    events,
  };
}

/* ------------------------------------------------------------------
   Routes
   ------------------------------------------------------------------ */

/**
 * @param {import('node:http').IncomingMessage} req
 * @param {import('node:http').ServerResponse} res
 * @returns {Promise<boolean>} Whether the request was handled as an API route.
 */
async function api(req, res) {
  const url = new URL(req.url ?? '/', `http://${req.headers.host}`);
  const path = url.pathname;

  if (path === '/api/front-page') {
    json(res, frontPage());
    return true;
  }

  if (path === '/api/targets') {
    json(res, { targets: getTargets().map(targetView) });
    return true;
  }

  const targetMatch = path.match(/^\/api\/targets\/([\w-]+)$/);
  if (targetMatch) {
    const target = getTarget(targetMatch[1]);
    if (!target) return json(res, { error: 'unknown target' }, 404), true;
    json(res, targetView(target));
    return true;
  }

  if (path === '/api/events') {
    json(res, { events: getEvents().slice(-100).reverse() });
    return true;
  }

  // Re-scrape one target on demand.
  const scrapeMatch = path.match(/^\/api\/scrape\/([\w-]+)$/);
  if (scrapeMatch && req.method === 'POST') {
    const target = getTarget(scrapeMatch[1]);
    if (!target) return json(res, { error: 'unknown target' }, 404), true;
    const { run, verdict } = await runTarget(target);
    json(res, { run: { ...run, releases: run.releases.length }, verdict, target: targetView(target) });
    return true;
  }

  // Simulate a layout change from the UI so the demo needs no second terminal.
  const breakMatch = path.match(/^\/api\/break\/([\w-]+)$/);
  if (breakMatch && req.method === 'POST') {
    const target = getTarget(breakMatch[1]);
    if (!target) return json(res, { error: 'unknown target' }, 404), true;
    const body = await readBody(req);
    const mode = /** @type {import('./lib/fixtures.js').BreakMode} */ (body.mode || 'selector-drift');
    const { setBreak, appendEvent } = await import('./lib/store.js');
    const { newId } = await import('./lib/pipeline.js');
    const at = new Date().toISOString();
    setBreak(target.id, mode, at);
    appendEvent({
      id: newId('evt'),
      targetId: target.id,
      at,
      kind: 'break',
      title: `${target.name} changed its layout`,
      detail: `Simulated ${mode}: ${describeBreak(mode)}.`,
    });
    const { verdict } = await runTarget(target);
    json(res, { ok: true, mode, verdict, target: targetView(target) });
    return true;
  }

  // The centrepiece: stream a heal to the browser as it happens.
  const healMatch = path.match(/^\/api\/heal\/([\w-]+)\/stream$/);
  if (healMatch) {
    const target = getTarget(healMatch[1]);
    if (!target) return json(res, { error: 'unknown target' }, 404), true;

    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });

    /**
     * @param {string} event
     * @param {unknown} data
     */
    const send = (event, data) => {
      res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    };

    send('open', { target: target.id, name: target.name });
    try {
      const outcome = await healTarget(target, {
        emit: (line) => send('line', { line }),
        force: url.searchParams.get('force') === '1',
      });
      send('done', { outcome, target: targetView(target) });
    } catch (err) {
      send('error', { message: err instanceof Error ? err.message : String(err) });
    }
    res.end();
    return true;
  }

  // Diff the last two runs for a target — "what changed since yesterday".
  const diffMatch = path.match(/^\/api\/diff\/([\w-]+)$/);
  if (diffMatch) {
    const target = getTarget(diffMatch[1]);
    if (!target) return json(res, { error: 'unknown target' }, 404), true;
    const runs = runsFor(target.id);
    const before = runs.length > 1 ? runs[runs.length - 2].releases : [];
    const after = latestRun(target.id)?.releases ?? [];
    json(res, diffReleases(before, after));
    return true;
  }

  if (path.startsWith('/api/')) {
    json(res, { error: 'not found' }, 404);
    return true;
  }
  return false;
}

/**
 * Read and JSON-parse a request body, tolerating an empty one.
 *
 * @param {import('node:http').IncomingMessage} req
 * @returns {Promise<Record<string, any>>}
 */
async function readBody(req) {
  /** @type {Buffer[]} */
  const chunks = [];
  for await (const chunk of req) chunks.push(Buffer.from(chunk));
  const raw = Buffer.concat(chunks).toString('utf8').trim();
  if (!raw) return {};
  try {
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

/**
 * Serve a file from `public/`, defaulting to the front page. Path traversal is
 * blocked by normalising and then checking the prefix.
 *
 * @param {import('node:http').ServerResponse} res
 * @param {string} pathname
 * @returns {Promise<void>}
 */
async function serveStatic(res, pathname) {
  const rel = pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, '');
  const file = normalize(join(PUBLIC_DIR, rel));
  if (!file.startsWith(PUBLIC_DIR)) {
    res.writeHead(403).end('forbidden');
    return;
  }
  try {
    const info = await stat(file);
    if (!info.isFile()) throw new Error('not a file');
    const body = await readFile(file);
    res.writeHead(200, {
      'Content-Type': MIME[extname(file).toLowerCase()] ?? 'application/octet-stream',
      'Content-Length': body.length,
      'Cache-Control': 'no-cache',
    });
    res.end(body);
  } catch {
    // Single-page app: unknown paths fall through to the front page.
    try {
      const body = await readFile(join(PUBLIC_DIR, 'index.html'));
      res.writeHead(200, { 'Content-Type': MIME['.html'], 'Content-Length': body.length });
      res.end(body);
    } catch {
      res.writeHead(404).end('not found');
    }
  }
}

const server = createServer(async (req, res) => {
  try {
    if (await api(req, res)) return;
    await serveStatic(res, new URL(req.url ?? '/', `http://${req.headers.host}`).pathname);
  } catch (err) {
    console.error(err);
    if (!res.headersSent) json(res, { error: 'internal error' }, 500);
    else res.end();
  }
});

server.listen(config.port, () => {
  const targets = getTargets();
  console.log('');
  console.log('  ╔══════════════════════════════════════════════════╗');
  console.log('  ║   T H E   D A I L Y   B U G L E                   ║');
  console.log('  ║   self-healing intel on the long tail of the web  ║');
  console.log('  ╚══════════════════════════════════════════════════╝');
  console.log('');
  console.log(`  front page   http://localhost:${config.port}`);
  console.log(`  mode         ${config.mode}${config.mode === 'fixture' ? '  (no credentials needed)' : ''}`);
  console.log(`  targets      ${targets.length}`);
  console.log(`  seeded       ${isSeeded() ? 'yes' : 'no — run `npm run seed`'}`);
  console.log('');
});
