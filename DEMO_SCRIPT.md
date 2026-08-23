# 3-MINUTE DEMO VIDEO SCRIPT — THE DAILY BUGLE

**Before you hit record:**

```bash
cd daily-bugle
npm run seed && npm start
```

Open `http://localhost:4830`. Have a terminal side-by-side with the browser.
Make sure **no collector is broken** at the start (`npm run heal` clears everything).
Record at 1920×1080, browser zoom 80% so the masthead and the stats strip fit in one frame.

---

## 0:00 – 0:18 · THE HOOK

**SCREEN:** Terminal, full screen. Type live:
```bash
npm run break -- zed total-blackout
```
Let the output land. Cursor sits on the line `note that no exception was raised.`

**SAY:**
> "This scraper just completely broke. Zero records. And look — no error. No 5xx, no
> timeout, nothing thrown. This is how every scraper dies: silently. Your dashboard goes
> quiet, and three weeks later somebody notices the data has been stale since March."

---

## 0:18 – 0:38 · THE PITCH

**SCREEN:** Cut to the browser. The full masthead — THE DAILY BUGLE — then slow-scroll
through the stats strip and the lead story.

**SAY:**
> "So I built The Daily Bugle. Eight Bright Data Scraper Studio collectors watching the
> long tail of developer tooling — PocketBase, Coolify, Turso, Zed. No pre-built scrapers
> exist for any of them, and none of them have an API. It detects that silent failure,
> repairs itself by calling `bdata scraper heal`, and publishes the result as a
> comic newspaper."

---

## 0:38 – 1:05 · THE UI TOUR

**SCREEN:** Scroll steadily. Pause ~2s on each:
1. **Lead story** — point at `NEWSWORTHINESS 87/100`
2. **Spider-Sense dial** — the four signal percentages
3. **Collector fleet grid** — hover one card so the sparkline tooltips show
4. **Off the wire** — click the **MONEY** desk chip, then **BREAKING**

**SAY:**
> "Extraction is only half the value. Eight changelogs is two hundred bullets a week, so
> a newsroom engine scores every single line for what it will actually cost you. A pricing
> change outranks a breaking change, which outranks a feature. Chores get buried. So the
> paper leads with 'Turso cut free-tier row reads in half' — not 'reduced idle memory by
> 18 percent.' Each collector card carries its own health, a fourteen-day trend, and the
> one sentence of English that generated it."

---

## 1:05 – 2:05 · THE MONEY SHOT (do not rush this)

**SCREEN:** Scroll to **THE HEALING LAB**. Pick `Zed Editor` in the dropdown,
`selector drift — fields go hollow` in the second.

**Click 💥 BREAK IT.** Let the console fill.

**SAY (while it types):**
> "Watch this. I'm simulating a redesign — the container still matches, but the fields
> inside it come back empty. Same record count. HTTP 200. Nothing throws."

**SCREEN:** Point the cursor at `health 20/100` and the red meters.

**SAY:**
> "But Spider-Sense doesn't look at status codes, because there aren't any. It scores four
> content signals against what this same collector returned yesterday. Records, fields,
> value density, changelog depth. It caught hollow records that a try/catch never would."

**SCREEN:** **Click 🕷 HEAL IT.** Let every line stream in. Do not cut.

**SAY (over the stream):**
> "Now the important part. It writes its own repair brief — derived from the failure
> signature, not by me. That exact string goes to `bdata scraper heal`. Scraper Studio
> regenerates the extraction logic…"

**SCREEN:** Wait for the green `verified: health 20 -> 100` line. Let it sit for 2 seconds.

**SAY:**
> "…and then it re-scrapes and re-scores. It only claims it healed because a fresh payload
> passed. Twenty to a hundred. I never wrote a selector."

**SCREEN:** Scroll down to **THE CANON** — the new break → detect → heal → recovered
entries are at the top.

**SAY:**
> "And the whole arc is in the audit trail. That's what makes 'self-healing' checkable
> instead of a bullet on a slide."

---

## 2:05 – 2:35 · SCRAPER STUDIO + THE TERMINAL

**SCREEN:** Cut to terminal. Run these back to back:
```bash
node bin/collectors.js list
npm run scrape
```

> ⚠️ **BEFORE RECORDING THIS SECTION:** put your real `c_*` collector ID in `.env`
> (`COLLECTOR_ZED=c_...`) so `collectors.js list` prints a real ID, not `— not created —`.
> Judges need to see a verified Collector ID. Also show the Scraper Studio dashboard for
> 3 seconds here as proof.

**SAY:**
> "Everything runs from the terminal. This is the collector registry — and it's also why
> the repo has a CLAUDE.md: it stops a coding agent regenerating a collector that already
> exists, which costs twenty-five minutes and real credits. `npm run scrape` exits 2 when
> anything is unhealthy, so wiring this into CI is one line:
> `npm run scrape || npm run heal`."

---

## 2:35 – 3:00 · CLEAN CODE + CLOSE

**SCREEN:** Split or quick cuts:
1. `npm test` → the 19 green checkmarks
2. VS Code showing `lib/spider-sense.js` — scroll the four-signal block
3. `package.json` — highlight `"dependencies": {}`

**SAY:**
> "Nineteen tests on the detection logic, because that's the load-bearing claim. Full
> JSDoc types with `tsc --noEmit`, no build step. And zero runtime dependencies — clone it,
> `npm run seed`, `npm start`, and it works with no token and no credits, because it ships
> with committed snapshots. Flip one env var and it's live against real collectors."

**SCREEN:** Back to the top of the front page. Hold on the masthead.

**SAY:**
> "The Daily Bugle. Scrapers that fix themselves. Thanks for watching."

---

## TIMING CHEAT SHEET

| Section | In | Length |
|---|---|---|
| Hook — silent failure | 0:00 | 18s |
| Pitch | 0:18 | 20s |
| UI tour | 0:38 | 27s |
| **Break → detect → heal** | **1:05** | **60s** |
| Scraper Studio + CLI | 2:05 | 30s |
| Clean code + close | 2:35 | 25s |

**If you overrun:** cut the UI tour to 15s (keep the desk-filter click) and the clean-code
section to 15s. Never cut the heal stream.

**Three things that must be on camera to score:** the `c_*` Collector ID, the
`verified: health X -> Y` line, and the Canon timeline entries appearing after the heal.
