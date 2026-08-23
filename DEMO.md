# Demo script — 3 minutes

Read this once, then record. Two terminals and a browser at `http://localhost:4830`.

**Before you hit record:**

```bash
cd daily-bugle
npm run seed
npm start
```

Open the front page and scroll to the top. Nothing should be broken yet.

---

## 0:00 — The problem (25s)

> "This is The Daily Bugle. It watches eight niche developer tools — PocketBase,
> Coolify, Turso, Zed — none of which have an API, an RSS feed, or a pre-built Bright
> Data scraper. Every one is a Scraper Studio collector I generated from one sentence
> of plain English.
>
> But here's the thing about scrapers. They don't break loudly."

*Scroll the masthead and the stats strip. Eight collectors in print, fleet health 100.*

---

## 0:25 — Break it (35s)

*Scroll to THE HEALING LAB. Pick **Zed Editor**, mode **total blackout**. Hit BREAK IT.*

> "I'm simulating what happens when Zed redesigns its releases page. Watch the console."

*Let the lines land. Point at them.*

> "HTTP 200. No exception. No timeout. Nothing thrown. The collector returned an array —
> it's just empty. **This is the failure mode nobody alerts on.** No 5xx to page you, no
> stack trace in Sentry. Your dashboard just goes quiet and stays quiet.
>
> Spider-Sense catches it anyway, because it doesn't look at status codes. It looks at
> the *content* — four signals scored against what the same collector returned yesterday.
> Health went from 100 to zero."

*Point at the red card in the fleet grid and the meters dropping.*

---

## 1:00 — Heal it (50s)

*Hit HEAL IT. Let the stream run.*

> "Now the interesting part. Nobody wrote a selector here. The app takes the failure
> signature and composes a repair brief from it —"

*Point at the `composing repair brief` block.*

> "— zero records, these three fields empty on every record, at this URL. That string is
> what gets handed to `bdata scraper heal`. Scraper Studio regenerates the extraction
> logic from my original description against the new layout."

*As the verify step lands:*

> "And then it re-scrapes and re-scores. That matters — the app only claims it healed
> because a fresh payload passed Spider-Sense. Health zero back to a hundred. If it
> hadn't, it'd be logged as a failure and escalated, not quietly marked green."

*Scroll to THE CANON.*

> "Every break, detection, repair and recovery is on the timeline. That's what makes
> self-healing a claim you can check instead of a bullet on a slide."

---

## 1:50 — Why it's worth scraping at all (40s)

*Scroll to OFF THE WIRE. Click the MONEY chip.*

> "Extraction is only half of it. Eight changelogs is two hundred bullets a week, so the
> newsroom engine scores every line for what it'll actually cost you. Breaking changes and
> pricing moves lead. Chores get buried.
>
> So the lead story is Turso cutting its free-tier row reads from a billion to five
> hundred million — not 'reduced idle memory by 18%'. That's the difference between a
> scraper and something you'd actually run."

*Scroll to the fleet grid, point at a collector card.*

> "Each card shows the plain-English prompt that generated the collector, its `c_*` id —
> redacted, the token never leaves `.env` — and a fourteen-day health sparkline."

---

## 2:30 — Terminal + architecture (30s)

*Switch to the second terminal.*

```bash
npm run scrape
npm run break -- typst selector-drift
npm run heal  -- typst
```

> "The whole thing is operable from the terminal — the web page is just a view over the
> same data. `npm run scrape` exits 2 when anything is unhealthy, so in CI the entire
> integration is `npm run scrape || npm run heal`.
>
> Zero runtime dependencies, no build step, no database. Clone it, `npm run seed`,
> `npm start`, and it runs off committed snapshots with no credentials at all."

*End on the front page.*

---

## Recording notes

- **Mask secrets.** Never show `.env` on camera. `git status` should show it ignored.
- `HEAL_EXECUTE=0` is the default, so the heal narrates its stages in ~3 seconds. If you
  set `HEAL_EXECUTE=1` for a live run, expect 5–25 minutes — record that separately as
  proof and cut to it, don't wait on camera.
- If you break a target and want to reset without healing:
  `rm data/runtime/breaks.json && npm run seed`
- Show `node bin/collectors.js list` if you want to make the "reuse, don't regenerate"
  agent-rules point explicitly.
