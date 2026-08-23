# 🕷 THE DAILY BUGLE

**Self-healing competitive intelligence for the long tail of the web.**

Eight niche developer tools. Eight Bright Data Scraper Studio collectors, each generated
from one sentence of plain English. A drift detector that catches the failure mode
nobody alerts on. And an autonomous repair loop that calls `bdata scraper heal` with a
brief it wrote itself — published as a living comic newspaper.

Built for **Into the Scrape-Verse** — WeMakeDevs × Bright Data, August 2026.

---

## The problem nobody alerts on

A scraper does not break loudly. When a site ships a redesign, the collector keeps
returning **HTTP 200** and a well-formed array. The array is just full of empty strings.

```
$ npm run break -- zed total-blackout

scrape after break: status failed, health 0/100
  records: 0   missing fields: version, releasedAt, entries

note that no exception was raised.
```

Nothing in a normal alerting setup fires. No 5xx, no timeout, no thrown error. Your
dashboard goes quiet and stays quiet, and three weeks later somebody notices the
competitive-intel report has been reprinting the same numbers since March.

**That silent rot is the entire problem this project solves.**

---

## The loop

```
  describe          generate              trigger            sense
  one sentence  →   bdata scraper    →    POST /dca/     →   4 content signals
  of English        create                trigger            score the payload
                                                                   │
                                                          health < threshold
                                                                   │
                                                                   ▼
  verify        ←   heal              ←   compose
  re-scrape,        bdata scraper         a repair brief derived from
  re-score          heal                  the failure signature itself
```

The only English a human ever writes is the original description of the data they want.
The repair brief is **derived from the failure**, not authored by a person:

```
The scraper returns zero records for https://zed.dev/releases/stable. The page layout
changed and the root selector for individual release entries no longer matches. These
fields are now empty on every single record: version, releasedAt, entries. Re-locate
them on the current page. 100% of all expected values came back blank. Restore
extraction of: version, releasedAt, entries.
```

That string is what gets handed to `bdata scraper heal`. Then the loop **re-scrapes and
re-scores** — the claim "it healed" is only ever made on the strength of a fresh payload
passing Spider-Sense. A heal that does not restore health is logged as a failure and
escalated, not quietly marked green.

---

## Quick start

Requires Node 18+. No database, no Docker, **no credentials**.

```bash
cd daily-bugle
npm run seed     # builds 14 days of history from committed snapshots
npm start        # → http://localhost:4830
```

That is the whole setup. The repo ships in `fixture` mode: it runs off committed
snapshots of real Scraper Studio payload shapes, so a judge can clone it and see the
entire product — including the self-healing loop — without a token or a single credit.

### Drive the demo from the terminal

```bash
npm run scrape                          # run every collector, score each payload
npm run break -- typst selector-drift   # simulate a site redesign
npm run heal  -- typst                  # autonomous repair, with verification
node bin/collectors.js list             # the collector registry
```

Or drive it from the **Healing Lab** on the front page — break a collector and watch the
repair stream into the browser line by line over Server-Sent Events.

---

## Going live against real collectors

```bash
# 1. authenticate once
npx -p @brightdata/cli bdata login

# 2. print the exact create command for a target
#    (the description comes verbatim from data/targets.json)
node bin/collectors.js create zed

# 3. run it — 5-15 min, up to 25 for complex pages
bdata scraper create https://zed.dev/releases/stable "Extract each stable release entry: …"

# 4. paste the returned c_* id into .env and flip the mode
#    COLLECTOR_ZED=c_xxxxxxxxxxxx
#    BUGLE_MODE=live
```

Then `npm run scrape` triggers the real production endpoint Scraper Studio provisions for
every collector — `POST /dca/trigger?collector=c_*` — with no infrastructure of our own
to deploy. Set `HEAL_EXECUTE=1` and healing really shells out to the `bdata` CLI.

`.env.example` documents every variable. **The real `.env` is gitignored**, and
`lib/config.js` is the only module that reads the token — everything else receives it
already redacted (`brd_••••••••••••a91f`).

---

## Spider-Sense — detecting a silent failure

Detection cannot rely on error codes, because there are none. `lib/spider-sense.js`
scores four independent **content** signals against what the same collector produced
yesterday, and folds them into one 0–100 health number:

| Signal | Weight | Catches |
|---|---|---|
| **Records returned** | 0.30 | Root selector stopped matching — zero or collapsed record count |
| **Expected fields present** | 0.30 | A field named in the collector prompt is now empty on *every* record |
| **Value density** | 0.25 | Partial drift — the share of all expected values that came back blank |
| **Changelog depth** | 0.15 | Records found but the nested bullet list drifted, so they are hollow |

A field empty on *some* records is not drift — partial coverage is normal. A field empty
on **every** record is. That distinction is why this catches real breakage without crying
wolf on a release that simply has no migration note.

Health ≥ 85 is `ok`, ≥ 40 is `degraded`, below 40 is `failed`.

The **decision to heal** is made on that status — anything not `ok` gets repaired.
`HEAL_THRESHOLD` (default 60) is the separate bar a payload must clear *after* healing for
the repair to count as verified. Conflating the two is a trap: gating the repair itself on
the threshold means a collector scored `degraded` at 63 is selected by the sweep and then
immediately skipped, so it stays broken forever. `CLAUDE.md` documents this as an
invariant because it is easy to reintroduce.

---

## The newsroom — why extraction is only half the value

Watching eight changelogs is useless if it hands you two hundred bullets a week.
`lib/newsroom.js` scores every bullet for what it will actually **cost** you:

- a **breaking change** outranks a feature (62 vs 34 base)
- anything touching **price, quota or free tier** gets +20 and goes to the *Money desk*
- migration language (`removed`, `renamed`, `no longer`, `drop support`) gets +12
- auth/TLS/cookie changes get +8 and a *Security desk* flag
- chores are filler and get buried

Base scores sit well below 100 on purpose: an earlier pass used a base of 80 for
`breaking`, the bonuses pushed everything into the clamp, and a pricing change and an
ordinary breaking change both came out at exactly 100. Headroom is what keeps the ranking
real — there is a test for it.

So the front page leads with `Turso — free plan row reads cut from 1B to 500M`, not with
`reduced idle memory by roughly 18%`. Consecutive runs are diffed on `version` + bullet
text, so re-running a healthy collector produces an empty diff — which is exactly what
you want from a monitor.

---

## Targets — the long tail, deliberately

Bright Data already ships 800+ pre-built scrapers for Amazon, LinkedIn and friends. None
of these eight have one, and none have an API or an RSS feed either. Scraping them is the
*only* way to get this data.

| Target | Category | Why it earns a collector |
|---|---|---|
| **PocketBase** | Backend / BaaS | Fast pre-1.0 cadence, frequent breaking changes. No API, no RSS. |
| **Coolify** | Self-hosted PaaS | Open-source Vercel competitor, ships several times a week. |
| **Umami** | Analytics | Privacy-first GA alternative; a live pricing-pressure signal. |
| **Meilisearch** | Search | Competes with Algolia on price; breaking minors are real migration cost. |
| **Typst** | Publishing / DX | Deeply nested custom-rendered changelog — the layout-drift stress test. |
| **Caddy** | Infrastructure | Slow high-signal releases; the healthy control target. |
| **Turso** | Database | Edge SQLite whose free-tier quotas have moved repeatedly. |
| **Zed** | Developer tools | Weekly, heavily client-rendered releases page that redesigns often. |

All eight are **public changelogs**. No logins, no paywalls, no personal data.

---

## Architecture

```
daily-bugle/
├── CLAUDE.md              agent rules — stops an agent regenerating existing collectors
├── server.js              node:http server + SSE heal stream. Zero dependencies.
├── data/
│   ├── targets.json       the 8 targets, each with its plain-language prompt
│   └── snapshots.json     committed payload shapes, so fixture mode is real data
├── lib/
│   ├── config.js          .env parsing + the ONLY module that reads the token
│   ├── brightdata.js      POST /dca/trigger, the bdata CLI bridge, payload normalising
│   ├── fixtures.js        fixture source + the three break modes
│   ├── spider-sense.js    drift detection — 4 content signals → one health score
│   ├── newsroom.js        newsworthiness scoring + run-over-run diffing
│   ├── pipeline.js        one scrape: trigger → score → persist a Run
│   ├── heal.js            the autonomous repair loop, with verification
│   └── store.js           atomic flat-file JSON persistence
├── bin/                   seed · scrape · simulate-break · heal · collectors
├── public/                the comic newspaper (no framework, no build step)
└── test/                  node:test — no test runner dependency either
```

**Zero runtime dependencies.** `package.json` has an empty `dependencies` block, and
that is not a stunt: it means `git clone && npm run seed && npm start` cannot fail on a
transitive install, which is the single most common way a hackathon judge fails to run
your project.

### Design notes worth calling out

- **`normaliseReleases()`** tolerates the field-name variance a generated collector
  actually returns (`tag_name` / `tag` / `version`, wrapped or bare arrays). The fields it
  *fails* to find are precisely the drift signal Spider-Sense then scores.
- **Atomic writes** — `store.js` writes to a temp file then renames, so a crash mid-write
  cannot leave a truncated database behind.
- **Sequential scraping** — a burst of parallel triggers is the fastest way to get
  rate-limited mid-demo, so `runAll` is deliberately serial.
- **Detection is edge-triggered** — a target that stays broken logs one `detect` event,
  not one per cycle.
- **Path traversal** is blocked in the static handler by normalising then prefix-checking.
- **`HEAL_EXECUTE=0` is the default** so a demo run can never unexpectedly burn credits.
  The verification re-scrape afterwards is real in both modes.

---

## Reliability & self-healing, demonstrated

Three break modes, each mirroring a real way a generated scraper fails:

| Mode | What the collector returns | Health |
|---|---|---|
| `selector-drift` | Container matches, fields inside are empty — hollow records | ~20 |
| `field-renamed` | Records fine, the bullet list is gone from every one | ~55 |
| `total-blackout` | Root selector matches nothing. Zero records. | 0 |

Every one is caught by content inspection alone, repaired autonomously, and **verified**
before the loop closes. The full break → detect → heal → recovered arc is written to the
canon timeline on the front page, which is what makes "self-healing" a claim you can
check rather than a bullet on a slide.

### In CI

```yaml
- run: npm run scrape || npm run heal    # heal only when scoring says it is needed
```

`npm run scrape` exits `2` when any collector is unhealthy, so the shell short-circuit
above is the entire integration. `npm run heal` with no target sweeps every collector
whose last run was unhealthy — the same command a cron entry calls.

---

## Agent rule file

`CLAUDE.md` exists so that any coding agent working in this repo **reuses the existing
collectors instead of regenerating them.** Generating a collector costs 5–25 minutes and
burns credits; `node bin/collectors.js list` answers "does this already exist?" in
milliseconds. The same rules apply to `.cursor/rules` and `CODEX.md`.

---

## Tests

```bash
npm test        # node:test — drift detection, scoring, diffing, redaction
npm run typecheck   # tsc --noEmit over JSDoc types. No TypeScript build step.
```

---

## Security

- `.env` is gitignored; only `.env.example` is committed.
- `lib/config.js` is the sole reader of `BRIGHTDATA_API_TOKEN`. Every other consumer gets
  `redact()`ed output, so the token cannot leak into the UI, the API, the logs, or a
  demo video.
- Collector ids are redacted in the web UI too.
- Public data only — eight public changelog pages, no auth, no paywalls, no personal data.

---

## License

MIT © Nitin Patidar
