/**
 * @file Front-page client.
 *
 * Plain ES modules, no framework, no build step: `npm start` and it runs. The
 * server hands over the entire front page in one request, so rendering is a pure
 * function of that payload. The only stateful part is the heal stream, which
 * arrives over Server-Sent Events and is appended line by line.
 */

/**
 * The whole front-page payload. Deliberately loose — the server owns the shape — but
 * the three arrays are typed as record arrays so every `.map((t) => …)` callback below
 * infers its parameter instead of tripping `noImplicitAny`.
 *
 * @type {{targets: Record<string, any>[], stories: Record<string, any>[], events: Record<string, any>[], fleet: Record<string, any>, lead: Record<string, any> | null, tallies: Record<string, number>, config: Record<string, any>, edition: Record<string, any>, seeded: boolean}}
 */
let state = /** @type {any} */ (null);
/** @type {string} */
let activeDesk = 'all';

const $ = (/** @type {string} */ sel) => /** @type {HTMLElement} */ (document.querySelector(sel));

/**
 * Escape text for interpolation into HTML.
 *
 * @param {unknown} value
 * @returns {string}
 */
const esc = (value) =>
  String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] ?? c));

/**
 * Format an ISO timestamp as newsprint date-time.
 *
 * @param {string | null} iso
 * @returns {string}
 */
function when(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  return d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

/**
 * Colour class for a 0..100 health score.
 *
 * @param {number} health
 * @returns {string}
 */
const healthClass = (health) => (health >= 85 ? '' : health >= 40 ? 'is-warn' : 'is-bad');

/* ------------------------------------------------------------------
   Boot
   ------------------------------------------------------------------ */

const PRESS_LINES = [
  'authenticating with scraper studio',
  'reading 8 long-tail collectors',
  'scoring payloads with spider-sense',
  'setting type on the front page',
];

/** Roll the preloader while the first fetch is in flight. */
async function boot() {
  const bar = $('#pressBar');
  const status = $('#pressStatus');
  let pct = 0;
  const timer = setInterval(() => {
    pct = Math.min(92, pct + 7);
    bar.style.width = `${pct}%`;
    status.textContent = PRESS_LINES[Math.min(PRESS_LINES.length - 1, Math.floor(pct / 25))];
  }, 90);

  try {
    await refresh();
  } finally {
    clearInterval(timer);
    bar.style.width = '100%';
    status.textContent = 'edition ready';
    setTimeout(() => $('#press').classList.add('is-done'), 380);
  }
}

/**
 * Fetch JSON and fail loudly on a non-2xx. Without this a 404 lands as
 * `undefined` deep inside a render function and surfaces as an opaque
 * "cannot read properties of undefined" — useless mid-demo.
 *
 * @param {string} url
 * @param {RequestInit} [init]
 * @returns {Promise<any>}
 */
async function fetchJson(url, init) {
  const res = await fetch(url, init);
  const text = await res.text();
  /** @type {any} */
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    throw new Error(`${url} returned non-JSON (${res.status}): ${text.slice(0, 120)}`);
  }
  if (!res.ok) throw new Error(`${url} → ${res.status} ${body?.error ?? ''}`.trim());
  return body;
}

/**
 * Pull the front page and render everything.
 *
 * @returns {Promise<void>}
 */
async function refresh() {
  state = await fetchJson('/api/front-page');
  renderMasthead();
  renderStrip();
  renderLead();
  renderSense();
  renderTicker();
  renderFleet();
  renderStories();
  renderCanon();
  renderLabOptions();
}

/* ------------------------------------------------------------------
   Render
   ------------------------------------------------------------------ */

function renderMasthead() {
  const { edition, config } = state;
  $('#edition').textContent = `VOL. ${edition.volume} · NO. ${edition.issue}`;
  $('#pressDate').textContent = new Date(edition.date)
    .toLocaleDateString(undefined, { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })
    .toUpperCase();
  const badge = $('#modeBadge');
  badge.textContent = config.mode === 'live' ? 'LIVE COLLECTORS' : 'FIXTURE MODE';
  badge.classList.toggle('is-live', config.mode === 'live');
  badge.title =
    config.mode === 'live'
      ? `Triggering real collectors against ${config.apiBase}`
      : 'Running from committed snapshots — clone the repo and it just works, no credentials.';
}

function renderStrip() {
  const { fleet, tallies, edition } = state;
  $('#strip').innerHTML = [
    ['COLLECTORS IN PRINT', `${fleet.healthy}/${fleet.total}`, fleet.healthy === fleet.total ? 'stat--good' : 'stat--hot'],
    ['FLEET HEALTH', `${fleet.health}`, fleet.health >= 85 ? 'stat--good' : 'stat--hot'],
    ['RECORDS ON FILE', `${fleet.totalRecords}`, ''],
    ['BREAKING CHANGES', `${tallies.breaking}`, 'stat--hot'],
    ['PRICING MOVES', `${tallies.commercial}`, 'stat--hot'],
    ['AUTONOMOUS HEALS', `${fleet.healEvents}`, 'stat--good'],
    ['PRESS RUNS', `${edition.pressRuns}`, ''],
  ]
    .map(([label, value, cls]) => `<div class="stat ${cls}"><b>${esc(value)}</b><span>${esc(label)}</span></div>`)
    .join('');
}

function renderLead() {
  const lead = /** @type {Record<string, any>} */ (state.lead);
  if (!lead) {
    $('#leadHead').textContent = 'NO STORIES ON THE WIRE';
    $('#leadBody').textContent = 'Run `npm run seed` then reload.';
    return;
  }
  $('#leadHead').textContent = `${lead.targetName} ${lead.version} — ${lead.desk.replace(' desk', '')}`;
  $('#leadBody').textContent = lead.text;
  $('#leadByline').innerHTML = [
    `<b>${esc(lead.desk)}</b>`,
    `NEWSWORTHINESS ${lead.score}/100`,
    `${esc(lead.category)}`,
    `RELEASED ${esc(lead.releasedAt)}`,
    ...lead.tags.map((/** @type {string} */ t) => `<span>${esc(t)}</span>`),
  ].join('');
}

function renderSense() {
  const { fleet, targets } = state;
  const dash = 327;
  const fill = /** @type {SVGCircleElement} */ (document.querySelector('#senseFill'));
  fill.style.strokeDashoffset = String(dash - (dash * fleet.health) / 100);
  fill.style.stroke = fleet.health >= 85 ? 'var(--green)' : fleet.health >= 40 ? 'var(--gold)' : 'var(--red)';
  $('#fleetHealth').textContent = String(fleet.health);

  // Show the four signals of the weakest collector — the one worth looking at.
  const worst = [...targets].sort((a, b) => a.health - b.health)[0];
  $('#senseLines').innerHTML = (worst?.signals ?? [])
    .map(
      (/** @type {Record<string, any>} */ s) =>
        `<li title="${esc(s.detail)}"><span>${esc(s.label)}</span><b>${Math.round(s.score * 100)}%</b></li>`
    )
    .join('') + `<li><span>WEAKEST COLLECTOR</span><b>${esc(worst?.name ?? '—')}</b></li>`;
}

function renderTicker() {
  const items = state.stories.slice(0, 14).map((s) => {
    const cls = s.type === 'breaking' ? 'hot' : '';
    return `<span class="${cls}"><b>${esc(s.targetName)} ${esc(s.version)}</b> · ${esc(s.text.slice(0, 92))}</span>`;
  });
  items.unshift(
    `<span class="hot"><b>SELF-HEALING SCRAPERS</b> · ${state.fleet.healEvents} autonomous repairs logged</span>`
  );
  $('#tickerRail').innerHTML = items.join('<span>◆</span>');
}

function renderFleet() {
  $('#fleetGrid').innerHTML = state.targets
    .map((t) => {
      const bars = t.trend
        .map((/** @type {Record<string, any>} */ p) => `<i class="${healthClass(p.health)}" style="height:${Math.max(8, p.health)}%" title="${esc(when(p.at))} · ${p.health}"></i>`)
        .join('');
      return `
      <article class="card ${t.status === 'ok' ? '' : 'card--bad'}">
        <div class="card__top">
          <div>
            <div class="card__name">${esc(t.name)}</div>
            <div class="card__cat">${esc(t.category)} · ${esc(t.signal)} signal</div>
          </div>
          <span class="badge badge--${esc(t.status)}">${esc(t.status.toUpperCase())}</span>
        </div>
        <div class="card__health"><b>${t.health}</b><span>/100 HEALTH</span></div>
        <div class="spark">${bars}</div>
        <p class="card__why">${esc(t.status === 'ok' ? t.why : t.headline)}</p>
        <div class="card__prompt">“${esc(t.prompt.slice(0, 150))}${t.prompt.length > 150 ? '…' : ''}”</div>
        <div class="card__meta">
          <div class="card__collector">${esc(t.collectorId ?? `${t.collectorEnv} — not created`)}</div>
          <div><i>records</i> ${t.recordCount} · <i>empty</i> ${Math.round(t.nullRate * 100)}% · <i>${t.durationMs}ms</i></div>
          <div><i>last press</i> ${esc(when(t.lastRunAt))} · <i>${esc(t.source)}</i></div>
        </div>
      </article>`;
    })
    .join('');
}

function renderStories() {
  const list = activeDesk === 'all' ? state.stories : state.stories.filter((s) => s.desk === activeDesk);
  $('#storyCols').innerHTML =
    list
      .map(
        (s) => `
      <article class="story">
        <span class="story__desk story__desk--${esc(s.desk.split(' ')[0].toLowerCase())}">${esc(s.desk.replace(' desk', ''))}</span>
        <h3 class="story__head">${esc(s.targetName)} ${esc(s.version)}</h3>
        <p class="story__text">${esc(s.text)}</p>
        <div class="story__foot">
          <span class="story__score">${s.score}</span>
          <span>${esc(s.type)}</span>
          <span>${esc(s.releasedAt)}</span>
          ${s.tags.map((/** @type {string} */ t) => `<span class="story__tag">${esc(t)}</span>`).join('')}
        </div>
      </article>`
      )
      .join('') || '<p>No stories on this desk today.</p>';
}

function renderCanon() {
  /** @type {Record<string, string>} */
  const labels = {
    break: 'LAYOUT CHANGED',
    detect: 'SPIDER-SENSE',
    heal_start: 'HEAL CALLED',
    heal_done: 'HEAL COMPLETE',
    recovered: 'BACK IN PRINT',
  };
  $('#canonList').innerHTML =
    state.events
      .map(
        (e) => `
      <li class="canon__item canon__item--${esc(e.kind)}">
        <div class="canon__card">
          <span class="canon__kind">${esc(labels[e.kind] ?? e.kind)}</span>
          ${e.health !== undefined ? `<span class="canon__kind">HEALTH ${e.health}</span>` : ''}
          <div class="canon__title">${esc(e.title)}</div>
          <p class="canon__detail">${esc(e.detail)}</p>
          <div class="canon__when">${esc(when(e.at))}</div>
        </div>
      </li>`
      )
      .join('') || '<p>The canon is empty. Break a collector in the lab above.</p>';
}

/* ------------------------------------------------------------------
   The Healing Lab
   ------------------------------------------------------------------ */

function renderLabOptions() {
  const select = /** @type {HTMLSelectElement} */ ($('#labTarget'));
  const keep = select.value;
  select.innerHTML = state.targets
    .map((t) => `<option value="${esc(t.id)}">${esc(t.name)} — health ${t.health}${t.broken ? ' ⚠ broken' : ''}</option>`)
    .join('');
  if (keep && state.targets.some((t) => t.id === keep)) select.value = keep;
  syncLab();
}

/** Reflect the selected target's live numbers into the meters and hint. */
function syncLab() {
  const id = /** @type {HTMLSelectElement} */ ($('#labTarget')).value;
  const t = state.targets.find((x) => x.id === id);
  if (!t) return;

  setMeter('#meterHealth', '#meterHealthVal', t.health, `${t.health}`);
  const recordPct = Math.min(100, (t.recordCount / 3) * 100);
  setMeter('#meterRecords', '#meterRecordsVal', recordPct, `${t.recordCount}`);
  const fieldPct = ((t.expectedFields.length - t.missingFields.length) / t.expectedFields.length) * 100;
  setMeter('#meterFields', '#meterFieldsVal', fieldPct, `${t.expectedFields.length - t.missingFields.length}/${t.expectedFields.length}`);

  const hint = $('#labHint');
  hint.classList.remove('is-bad', 'is-good');
  if (t.broken) {
    hint.classList.add('is-bad');
    hint.innerHTML = `<b>${esc(t.name)} is broken (${esc(t.broken.mode)}).</b> ${esc(t.broken.description)}. Note the scraper did not throw — it returned ${t.recordCount} records and no error.`;
  } else if (t.status !== 'ok') {
    hint.classList.add('is-bad');
    hint.textContent = t.headline;
  } else {
    hint.classList.add('is-good');
    hint.innerHTML = `<b>${esc(t.name)} is in print.</b> ${t.recordCount} records, every expected field populated. ${esc(t.why)}`;
  }
  /** @type {HTMLButtonElement} */ ($('#btnHeal')).disabled = t.status === 'ok';
}

/**
 * @param {string} barSel
 * @param {string} valSel
 * @param {number} pct
 * @param {string} label
 */
function setMeter(barSel, valSel, pct, label) {
  const bar = $(barSel);
  bar.style.width = `${Math.max(0, Math.min(100, pct))}%`;
  bar.className = healthClass(pct);
  $(valSel).textContent = label;
}

/**
 * Append a line to the console, classified for colour.
 *
 * @param {string} line
 */
function push(line) {
  const box = $('#console');
  box.querySelector('.console__idle')?.remove();
  const el = document.createElement('div');
  el.className = 'l';
  if (line.startsWith('$ ')) el.classList.add('l--cmd');
  else if (/^verified:/.test(line)) el.classList.add('l--ok');
  else if (/NOT verified|escalating/i.test(line)) el.classList.add('l--bad');
  else if (/^spider-sense:/.test(line)) el.classList.add('l--warn');
  else if (/^(composing|verifying)/.test(line)) el.classList.add('l--head');
  else if (line.startsWith('(') || line.startsWith('  ')) el.classList.add('l--dim');
  el.textContent = line || ' ';
  box.appendChild(el);
  box.scrollTop = box.scrollHeight;
}

/** @param {string} text */
function clearConsole(text) {
  $('#console').innerHTML = '';
  if (text) push(text);
}

/** @type {number | null} */
let tick = null;

/** @param {boolean} running */
function setBusy(running, label = 'idle') {
  $('#consoleState').textContent = label;
  /** @type {HTMLButtonElement} */ ($('#btnBreak')).disabled = running;
  /** @type {HTMLButtonElement} */ ($('#btnHeal')).disabled = running;
  if (running) {
    const t0 = Date.now();
    tick = window.setInterval(() => {
      $('#consoleTimer').textContent = `${((Date.now() - t0) / 1000).toFixed(1)}s`;
    }, 100);
  } else if (tick !== null) {
    clearInterval(tick);
    tick = null;
  }
}

$('#labTarget').addEventListener('change', syncLab);

$('#btnBreak').addEventListener('click', async () => {
  const id = /** @type {HTMLSelectElement} */ ($('#labTarget')).value;
  const mode = /** @type {HTMLSelectElement} */ ($('#labMode')).value;
  if (!id) return;
  setBusy(true, 'simulating layout change');
  clearConsole(`simulating a redesign of the target page (${mode})…`);
  try {
    const data = await fetchJson(`/api/break/${id}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mode }),
    });
    push('');
    push(`the page changed. the collector was NOT told.`);
    push(`re-ran the collector: HTTP 200, no exception thrown.`);
    push('');
    push(`spider-sense: health ${data.verdict.health}/100  (status ${data.verdict.status})`);
    push(`spider-sense: ${data.verdict.headline}`);
    push(`spider-sense: records=${data.verdict.recordCount} missing=[${data.verdict.missingFields.join(', ') || 'none'}]`);
    push('');
    push('this is the silent failure. nothing in a normal alerting setup would fire.');
    push('press HEAL IT to hand the failure signature to scraper studio.');
    await refresh();
  } catch (err) {
    push(`error: ${err instanceof Error ? err.message : String(err)}`);
  } finally {
    setBusy(false, 'break simulated');
  }
});

$('#btnHeal').addEventListener('click', () => {
  const id = /** @type {HTMLSelectElement} */ ($('#labTarget')).value;
  setBusy(true, 'healing');
  clearConsole('');
  const source = new EventSource(`/api/heal/${id}/stream?force=1`);

  source.addEventListener('line', (/** @type {MessageEvent} */ e) => push(JSON.parse(e.data).line));

  source.addEventListener('done', async (/** @type {MessageEvent} */ e) => {
    const { outcome } = JSON.parse(e.data);
    push('');
    if (outcome?.skipped) push(`skipped: ${outcome.reason}`);
    else {
      push(`── heal ${outcome.ok ? 'SUCCEEDED' : 'FAILED'} in ${(outcome.durationMs / 1000).toFixed(1)}s ──`);
      push(`health ${outcome.healthBefore} -> ${outcome.healthAfter} · cli executed: ${outcome.executed}`);
      push('no selector was written by a human at any point.');
    }
    source.close();
    setBusy(false, outcome?.ok ? 'healed' : 'finished');
    await refresh();
  });

  source.addEventListener('error', () => {
    push('stream closed');
    source.close();
    setBusy(false, 'error');
  });
});

$('#storyFilters').addEventListener('click', (e) => {
  const btn = /** @type {HTMLElement} */ (e.target).closest('.chip');
  if (!btn) return;
  activeDesk = btn.getAttribute('data-desk') ?? 'all';
  for (const chip of document.querySelectorAll('.chip')) chip.classList.toggle('is-on', chip === btn);
  renderStories();
});

boot();
