# CLAUDE.md — agent rules for THE DAILY BUGLE

> This file exists so that any coding agent (Claude Code, Cursor, Codex) working in
> this repo **reuses the existing Bright Data collectors instead of regenerating them.**
> Generating a collector costs 5–25 minutes and burns credits. Read this first.

## Golden rule

**Never run `bdata scraper create` for a target that already has a collector id.**

Collector ids live in `.env` (never committed) and are keyed by the `collectorEnv`
field in `data/targets.json`. To check whether a target already has one:

```bash
node bin/collectors.js list
```

If a target prints a `c_*` id, it is already built. Reuse it via
`bdata scraper run <collector_id> <url> --pretty`.

## Collector registry

| Target | `.env` key | Source URL |
|---|---|---|
| PocketBase | `COLLECTOR_POCKETBASE` | https://pocketbase.io/release-notes/ |
| Coolify | `COLLECTOR_COOLIFY` | https://coolify.io/docs/changelog |
| Umami | `COLLECTOR_UMAMI` | https://github.com/umami-software/umami/releases |
| Meilisearch | `COLLECTOR_MEILISEARCH` | https://www.meilisearch.com/docs/learn/resources/versioning |
| Typst | `COLLECTOR_TYPST` | https://typst.app/docs/changelog/ |
| Caddy | `COLLECTOR_CADDY` | https://github.com/caddyserver/caddy/releases |
| Turso | `COLLECTOR_TURSO` | https://turso.tech/changelog |
| Zed | `COLLECTOR_ZED` | https://zed.dev/releases/stable |

## Correct workflow

**1. Authenticate once**

```bash
npx -p @brightdata/cli bdata login
```

**2. Only if a target has NO collector id** — create one. The second argument is a
plain-language description; copy it verbatim from the `prompt` field of that target
in `data/targets.json` so the collector matches the schema the app expects.

```bash
bdata scraper create <url> "<prompt from data/targets.json>"
```

Write the returned `c_*` id into `.env` under the target's `collectorEnv` key.

**3. Run a collector**

```bash
bdata scraper run <collector_id> <url> --pretty
```

**4. Heal a collector when the site layout changes**

```bash
bdata scraper heal <collector_id> "<what broke>"
```

Prefer letting the app decide when to heal — it writes a precise breakage
description from live drift telemetry rather than a guess:

```bash
npm run heal -- zed      # one target
npm run heal             # sweep every unhealthy collector
```

## The commands that exist

```bash
npm run seed              # build 14 days of history from committed snapshots
npm start                 # serve the front page on PORT (default 4830)
npm run scrape            # run every collector, score each payload; exits 2 if any is unhealthy
npm run scrape -- zed     # one target
npm run break -- zed total-blackout   # simulate a layout change (modes below)
npm run heal  -- zed      # autonomous repair + verification
npm run collectors        # alias for `node bin/collectors.js list`
npm test                  # node:test
npm run typecheck         # npx -p typescript tsc --noEmit
```

Break modes: `selector-drift`, `field-renamed`, `total-blackout`.

## Architectural constraints an agent must respect

- **Zero runtime dependencies.** `dependencies` and `devDependencies` in
  `package.json` are empty and must stay empty. Use Node built-ins only
  (`node:http`, `node:fs`, `node:crypto`, `node:child_process`). Do not
  introduce Express, dotenv, node-fetch, or a bundler.
- **No build step.** `node server.js` must always be enough to run the app.
- **Types via JSDoc, not TypeScript syntax.** Files stay `.js` and are checked
  with `npx tsc --noEmit` (`checkJs: true`). Add `@typedef`/`@param`/`@returns`
  rather than converting files to `.ts`.
- **Fixture mode must keep working.** `BUGLE_MODE=fixture` is the default and must
  run with no credentials, so judges can clone and run instantly. Any new live
  code path needs a fixture counterpart.
- **Never log or commit secrets.** `BRIGHTDATA_API_TOKEN` must not appear in
  server logs, API responses, or the UI. `lib/config.js` redacts it centrally.
- **Public data only.** Do not add a target that sits behind a login, a paywall,
  or that contains personal data.

## Where things live

```
lib/config.js        env loading + secret redaction (no dotenv dependency)
lib/brightdata.js    Scraper Studio client — POST /dca/trigger + CLI wrapper + payload normalising
lib/fixtures.js      fixture data source + the three simulated break modes
lib/spider-sense.js  drift detection & health scoring (the core algorithm)
lib/newsroom.js      newsworthiness scoring + run-over-run diffing
lib/pipeline.js      one scrape: trigger -> score -> persist a Run
lib/heal.js          heal orchestrator — decides when, writes the heal brief, verifies
lib/store.js         atomic JSON persistence over data/runtime/
server.js            zero-dep HTTP + REST + SSE heal stream
bin/                 seed · scrape · simulate-break · heal-cli · collectors
public/              the comic-newspaper UI (vanilla, no framework, no build)
test/                node:test suites
```

## Two invariants that are easy to break by accident

1. **The heal decision is made on `verdict.status`, not on `HEAL_THRESHOLD`.**
   `healSweep` selects targets whose last run was not `ok`, and `healTarget` must
   agree. Gating `healTarget` on the threshold instead means a target scored
   `degraded` at 63 with a threshold of 60 is selected by the sweep and then
   immediately skipped, so it stays broken forever. The threshold is the bar the
   payload must clear *after* healing to count as repaired.
2. **Newsworthiness base scores must leave headroom under 100.** The bonuses in
   `lib/newsroom.js` stack; if the bases are too high everything saturates at the
   clamp and the ranking silently collapses. There is a test for this.
