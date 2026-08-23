/**
 * @file Front-page client with GSAP, ScrollTrigger, Lenis smooth scroll, physics hanging spider, scroll spider progress, and self-healing stream logic.
 */

let state = /** @type {any} */ (null);
let activeDesk = 'all';

const $ = (/** @type {string} */ sel) => /** @type {HTMLElement} */ (document.querySelector(sel));

const esc = (value) =>
  String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] ?? c));

function when(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  return d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

const healthClass = (health) => (health >= 85 ? '' : health >= 40 ? 'is-warn' : 'is-bad');

/* ------------------------------------------------------------------
   Boot & Data Fetching
   ------------------------------------------------------------------ */

const PRESS_LINES = [
  'authenticating with scraper studio',
  'reading 8 long-tail collectors',
  'scoring payloads with spider-sense',
  'setting type on the front page',
];

async function boot() {
  const bar = $('#pressBar');
  const status = $('#pressStatus');
  let pct = 0;
  const timer = setInterval(() => {
    pct = Math.min(92, pct + 7);
    if (bar) bar.style.width = `${pct}%`;
    if (status) status.textContent = PRESS_LINES[Math.min(PRESS_LINES.length - 1, Math.floor(pct / 25))];
  }, 90);

  try {
    await refresh();
    initAnimations();
  } finally {
    clearInterval(timer);
    if (bar) bar.style.width = '100%';
    if (status) status.textContent = 'edition ready';
    setTimeout(() => $('#press')?.classList.add('is-done'), 380);
  }
}

async function fetchJson(url, init) {
  const res = await fetch(url, init);
  const text = await res.text();
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    throw new Error(`${url} returned non-JSON (${res.status}): ${text.slice(0, 120)}`);
  }
  if (!res.ok) throw new Error(`${url} → ${res.status} ${body?.error ?? ''}`.trim());
  return body;
}

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
   Render Functions
   ------------------------------------------------------------------ */

function renderMasthead() {
  const { edition, config } = state;
  const edEl = $('#edition');
  if (edEl) edEl.textContent = `VOL. ${edition.volume} · NO. ${edition.issue}`;
  const dateEl = $('#pressDate');
  if (dateEl) {
    dateEl.textContent = new Date(edition.date)
      .toLocaleDateString(undefined, { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })
      .toUpperCase();
  }
  const badge = $('#modeBadge');
  if (badge) {
    badge.textContent = config.mode === 'live' ? 'LIVE COLLECTORS' : 'FIXTURE MODE';
    badge.classList.toggle('is-live', config.mode === 'live');
    badge.title =
      config.mode === 'live'
        ? `Triggering real collectors against ${config.apiBase}`
        : 'Running from committed snapshots — clone the repo and it just works, no credentials.';
  }
}

function renderStrip() {
  const { fleet, tallies, edition } = state;
  const strip = $('#strip');
  if (!strip) return;
  strip.innerHTML = [
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
  const lead = state.lead;
  if (!lead) {
    if ($('#leadHead')) $('#leadHead').textContent = 'NO STORIES ON THE WIRE';
    if ($('#leadBody')) $('#leadBody').textContent = 'Run `npm run seed` then reload.';
    return;
  }
  if ($('#leadHead')) $('#leadHead').textContent = `${lead.targetName} ${lead.version} — ${lead.desk.replace(' desk', '')}`;
  if ($('#leadBody')) $('#leadBody').textContent = lead.text;
  if ($('#leadByline')) {
    $('#leadByline').innerHTML = [
      `<b>${esc(lead.desk)}</b>`,
      `NEWSWORTHINESS ${lead.score}/100`,
      `${esc(lead.category)}`,
      `RELEASED ${esc(lead.releasedAt)}`,
      ...lead.tags.map((t) => `<span>${esc(t)}</span>`),
    ].join('');
  }
}

function renderSense() {
  const { fleet, targets } = state;
  const dash = 327;
  const fill = /** @type {SVGCircleElement} */ (document.querySelector('#senseFill'));
  if (fill) {
    fill.style.strokeDashoffset = String(dash - (dash * fleet.health) / 100);
    fill.style.stroke = fleet.health >= 85 ? 'var(--green)' : fleet.health >= 40 ? 'var(--gold)' : 'var(--red)';
  }
  if ($('#fleetHealth')) $('#fleetHealth').textContent = String(fleet.health);

  const worst = [...targets].sort((a, b) => a.health - b.health)[0];
  if ($('#senseLines')) {
    $('#senseLines').innerHTML = (worst?.signals ?? [])
      .map(
        (s) => `<li title="${esc(s.detail)}"><span>${esc(s.label)}</span><b>${Math.round(s.score * 100)}%</b></li>`
      )
      .join('') + `<li><span>WEAKEST COLLECTOR</span><b>${esc(worst?.name ?? '—')}</b></li>`;
  }
}

function renderTicker() {
  const items = state.stories.slice(0, 14).map((s) => {
    const cls = s.type === 'breaking' ? 'hot' : '';
    return `<span class="${cls}"><b>${esc(s.targetName)} ${esc(s.version)}</b> · ${esc(s.text.slice(0, 92))}</span>`;
  });
  items.unshift(
    `<span class="hot"><b>SELF-HEALING SCRAPERS</b> · ${state.fleet.healEvents} autonomous repairs logged</span>`
  );
  if ($('#tickerRail')) $('#tickerRail').innerHTML = items.join('<span>◆</span>');
}

function renderFleet() {
  const fleetGrid = $('#fleetGrid');
  if (!fleetGrid) return;
  fleetGrid.innerHTML = state.targets
    .map((t) => {
      const bars = t.trend
        .map((p) => `<i class="${healthClass(p.health)}" style="height:${Math.max(8, p.health)}%" title="${esc(when(p.at))} · ${p.health}"></i>`)
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
  const storyCols = $('#storyCols');
  if (!storyCols) return;
  const list = activeDesk === 'all' ? state.stories : state.stories.filter((s) => s.desk === activeDesk);
  storyCols.innerHTML =
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
          ${s.tags.map((t) => `<span class="story__tag">${esc(t)}</span>`).join('')}
        </div>
      </article>`
      )
      .join('') || '<p>No stories on this desk today.</p>';
}

function renderCanon() {
  const canonList = $('#canonList');
  if (!canonList) return;
  const labels = {
    break: 'LAYOUT CHANGED',
    detect: 'SPIDER-SENSE',
    heal_start: 'HEAL CALLED',
    heal_done: 'HEAL COMPLETE',
    recovered: 'BACK IN PRINT',
  };
  canonList.innerHTML =
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
   The Healing Lab Controls
   ------------------------------------------------------------------ */

function renderLabOptions() {
  const select = /** @type {HTMLSelectElement} */ ($('#labTarget'));
  if (!select) return;
  const keep = select.value;
  select.innerHTML = state.targets
    .map((t) => `<option value="${esc(t.id)}">${esc(t.name)} — health ${t.health}${t.broken ? ' ⚠ broken' : ''}</option>`)
    .join('');
  if (keep && state.targets.some((t) => t.id === keep)) select.value = keep;
  syncLab();
}

function syncLab() {
  const targetSelect = /** @type {HTMLSelectElement} */ ($('#labTarget'));
  if (!targetSelect) return;
  const id = targetSelect.value;
  const t = state.targets.find((x) => x.id === id);
  if (!t) return;

  setMeter('#meterHealth', '#meterHealthVal', t.health, `${t.health}`);
  const recordPct = Math.min(100, (t.recordCount / 3) * 100);
  setMeter('#meterRecords', '#meterRecordsVal', recordPct, `${t.recordCount}`);
  const fieldPct = ((t.expectedFields.length - t.missingFields.length) / t.expectedFields.length) * 100;
  setMeter('#meterFields', '#meterFieldsVal', fieldPct, `${t.expectedFields.length - t.missingFields.length}/${t.expectedFields.length}`);

  const hint = $('#labHint');
  if (hint) {
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
  }
  const btnHeal = /** @type {HTMLButtonElement} */ ($('#btnHeal'));
  if (btnHeal) btnHeal.disabled = t.status === 'ok';
}

function setMeter(barSel, valSel, pct, label) {
  const bar = $(barSel);
  if (bar) {
    bar.style.width = `${Math.max(0, Math.min(100, pct))}%`;
    bar.className = healthClass(pct);
  }
  const val = $(valSel);
  if (val) val.textContent = label;
}

function push(line) {
  const box = $('#console');
  if (!box) return;
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

function clearConsole(text) {
  const box = $('#console');
  if (!box) return;
  box.innerHTML = '';
  if (text) push(text);
}

let tick = null;

function setBusy(running, label = 'idle') {
  if ($('#consoleState')) $('#consoleState').textContent = label;
  const btnBreak = /** @type {HTMLButtonElement} */ ($('#btnBreak'));
  const btnHeal = /** @type {HTMLButtonElement} */ ($('#btnHeal'));
  if (btnBreak) btnBreak.disabled = running;
  if (btnHeal) btnHeal.disabled = running;
  if (running) {
    const t0 = Date.now();
    tick = window.setInterval(() => {
      if ($('#consoleTimer')) $('#consoleTimer').textContent = `${((Date.now() - t0) / 1000).toFixed(1)}s`;
    }, 100);
  } else if (tick !== null) {
    clearInterval(tick);
    tick = null;
  }
}

/* ------------------------------------------------------------------
   GSAP, ScrollTrigger, Lenis Smooth Scroll & Spiders Motion Logic
   ------------------------------------------------------------------ */

function initAnimations() {
  if (typeof gsap === 'undefined') return;

  gsap.registerPlugin(ScrollTrigger);

  // 1. Lenis Smooth Scrolling (Lag-free lerp interpolation)
  let lenis = null;
  if (typeof Lenis !== 'undefined') {
    lenis = new Lenis({
      lerp: 0.09,
      wheelMultiplier: 1.0,
      touchMultiplier: 1.2,
      smoothTouch: false,
    });
    window.lenisInstance = lenis;
    lenis.on('scroll', ScrollTrigger.update);
    gsap.ticker.add((time) => lenis.raf(time * 1000));
    gsap.ticker.lagSmoothing(500, 33);
  }

  // 2. Hero Animations
  const heroTl = gsap.timeline({ defaults: { ease: 'power4.out' } });
  heroTl.from('.hero__word', { yPercent: 110, duration: 1.1, stagger: 0.12 })
        .from('.hero__kicker', { opacity: 0, y: 16, duration: 0.6 }, '-=0.6')
        .from('.hero__sub', { opacity: 0, y: 20, duration: 0.6 }, '-=0.45')
        .from('.hero__badge', { opacity: 0, scale: 0.85, duration: 0.5, stagger: 0.1 }, '-=0.4')
        .from('.hero__sticker', { scale: 0, rotation: () => gsap.utils.random(-40, 40), duration: 0.7, ease: 'elastic.out(1, 0.45)', stagger: 0.1 }, '-=0.5')
        .from('.hero__scrollhint', { opacity: 0, duration: 0.5 }, '-=0.3')
        .from('.header', { y: -60, opacity: 0, duration: 0.7 }, '-=0.8');

  // Parallax stickers on scroll
  gsap.utils.toArray('.hero__sticker').forEach((el) => {
    gsap.to(el, {
      y: () => -120 * (parseFloat(el.dataset.speed) || 1),
      ease: 'none',
      scrollTrigger: { trigger: '#hero', start: 'top top', end: 'bottom top', scrub: true },
    });
  });

  // Hero text background pan
  gsap.to('.hero__word--fill', {
    backgroundPosition: '50% 85%',
    ease: 'none',
    scrollTrigger: { trigger: '#hero', start: 'top top', end: 'bottom top', scrub: true },
  });

  // 3. Scroll Spider Progress (High-frequency quickTo rotation)
  (function initScrollSpider() {
    const thread = $('#spiderThread');
    const bug = $('#spiderBug');
    if (!thread || !bug) return;

    const setBugRotation = gsap.quickTo(bug, 'rotation', { duration: 0.25, ease: 'power2.out' });

    ScrollTrigger.create({
      start: 0,
      end: () => document.documentElement.scrollHeight - window.innerHeight,
      onUpdate(self) {
        const h = self.progress * (window.innerHeight - 90) + 50;
        thread.style.height = `${h}px`;
        bug.style.top = `${h}px`;
        setBugRotation(gsap.utils.clamp(-26, 26, self.getVelocity() / 90));
      },
    });
  })();

  // 4. Hero Hanging Physics Spider Canvas
  (function initPhysicsSpider() {
    const canvas = /** @type {HTMLCanvasElement} */ ($('#heroCanvas'));
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    let W = 0, H = 0;

    function resize() {
      W = canvas.offsetWidth;
      H = canvas.offsetHeight;
      canvas.width = W * dpr;
      canvas.height = H * dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }
    resize();
    window.addEventListener('resize', resize);

    const SEGMENTS = 20;
    const ropeLen = () => H * 0.45;
    const anchor = { x: W * 0.78, tx: W * 0.78 };
    const pts = Array.from({ length: SEGMENTS }, (_, i) => ({
      x: W * 0.78,
      y: (ropeLen() / (SEGMENTS - 1)) * i,
      px: W * 0.78 + (i ? Math.random() * 6 - 3 : 0),
      py: (ropeLen() / (SEGMENTS - 1)) * i,
    }));

    const mouse = { x: W / 2, y: H / 2, inHero: false };
    window.addEventListener('mousemove', (e) => {
      const r = canvas.getBoundingClientRect();
      mouse.x = e.clientX - r.left;
      mouse.y = e.clientY - r.top;
      mouse.inHero = e.clientY >= r.top && e.clientY <= r.bottom;
    });

    canvas.addEventListener('click', () => {
      const tip = pts[SEGMENTS - 1];
      tip.px = tip.x + (Math.random() * 120 - 60);
      tip.py = tip.y + (Math.random() * 40 + 20);
    });

    let legPhase = 0;
    let heroInView = true;
    let rafRunning = true;

    if ('IntersectionObserver' in window) {
      new IntersectionObserver((entries) => {
        heroInView = entries[0].isIntersecting;
        if (heroInView && !rafRunning) {
          rafRunning = true;
          step();
        }
      }, { threshold: 0 }).observe(canvas);
    }

    function step() {
      if (!heroInView) {
        rafRunning = false;
        return;
      }

      anchor.tx = mouse.inHero ? Math.max(W * 0.15, Math.min(W * 0.85, mouse.x)) : W * 0.78;
      anchor.x += (anchor.tx - anchor.x) * 0.035;

      const seg = ropeLen() / (SEGMENTS - 1);

      for (let i = 1; i < SEGMENTS; i++) {
        const p = pts[i];
        const vx = (p.x - p.px) * 0.985;
        const vy = (p.y - p.py) * 0.985;
        p.px = p.x;
        p.py = p.y;
        p.x += vx;
        p.y += vy + 0.55;
      }

      pts[0].x = anchor.x;
      pts[0].y = 0;

      for (let k = 0; k < 5; k++) {
        for (let i = 0; i < SEGMENTS - 1; i++) {
          const a = pts[i], b = pts[i + 1];
          const dx = b.x - a.x, dy = b.y - a.y;
          const d = Math.hypot(dx, dy) || 0.0001;
          const diff = ((d - seg) / d) * 0.5;
          const ox = dx * diff, oy = dy * diff;
          if (i === 0) { b.x -= ox * 2; b.y -= oy * 2; }
          else { a.x += ox; a.y += oy; b.x -= ox; b.y -= oy; }
        }
      }

      draw();
      requestAnimationFrame(step);
    }

    function draw() {
      ctx.clearRect(0, 0, W, H);
      const ink = '#131015';

      // Thread line
      ctx.beginPath();
      ctx.moveTo(pts[0].x, pts[0].y);
      for (let i = 1; i < SEGMENTS; i++) {
        const prev = pts[i - 1], p = pts[i];
        ctx.quadraticCurveTo(prev.x, prev.y, (prev.x + p.x) / 2, (prev.y + p.y) / 2);
      }
      ctx.strokeStyle = ink;
      ctx.lineWidth = 1.8;
      ctx.stroke();

      // Spider Body at tip
      const tip = pts[SEGMENTS - 1];
      const prev = pts[SEGMENTS - 2];
      const ang = Math.atan2(tip.y - prev.y, tip.x - prev.x) - Math.PI / 2;
      const speed = Math.hypot(tip.x - tip.px, tip.y - tip.py);
      legPhase += 0.08 + speed * 0.03;

      ctx.save();
      ctx.translate(tip.x, tip.y);
      ctx.rotate(ang + Math.PI);
      const s = Math.min(W, H) / 18;

      ctx.strokeStyle = ink;
      ctx.lineWidth = s * 0.14;
      ctx.lineCap = 'round';
      for (let side = -1; side <= 1; side += 2) {
        for (let i = 0; i < 4; i++) {
          const wob = Math.sin(legPhase + i * 1.3 + (side > 0 ? 0.7 : 0)) * s * 0.09;
          const hipX = side * s * 0.2;
          const hipY = -s * 0.06 + i * s * 0.16;
          const kneeX = side * s * 0.62;
          const kneeY = hipY - s * 0.32 + i * s * 0.1 + wob;
          const footX = side * s * 0.95;
          const footY = hipY + s * 0.22 + i * s * 0.14 + wob * 1.6;
          ctx.beginPath();
          ctx.moveTo(hipX, hipY);
          ctx.quadraticCurveTo(kneeX, kneeY, footX, footY);
          ctx.stroke();
        }
      }

      // Body & Head
      ctx.fillStyle = ink;
      ctx.beginPath();
      ctx.ellipse(0, s * 0.32, s * 0.34, s * 0.5, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.beginPath();
      ctx.arc(0, -s * 0.28, s * 0.24, 0, Math.PI * 2);
      ctx.fill();

      // Eyes
      ctx.fillStyle = '#e62429';
      ctx.beginPath();
      ctx.arc(-s * 0.1, -s * 0.36, s * 0.06, 0, Math.PI * 2);
      ctx.arc(s * 0.1, -s * 0.36, s * 0.06, 0, Math.PI * 2);
      ctx.fill();

      ctx.restore();
    }

    step();
  })();

  // 5. Web Splat on Click
  (function initWebSplat() {
    window.addEventListener('click', (e) => {
      const target = /** @type {HTMLElement} */ (e.target);
      if (target.closest('button, a, input, select, option')) return;

      const splat = document.createElement('div');
      splat.className = 'websplat';
      splat.style.left = `${e.clientX}px`;
      splat.style.top = `${e.clientY}px`;
      splat.innerHTML = `
        <svg viewBox="0 0 100 100" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round">
          ${Array.from({ length: 8 }, (_, i) => {
            const a = (i * Math.PI) / 4;
            return `<line x1="50" y1="50" x2="${50 + Math.cos(a) * 46}" y2="${50 + Math.sin(a) * 46}"/>`;
          }).join('')}
          <polygon points="50,18 73,27 82,50 73,73 50,82 27,73 18,50 27,27" />
          <polygon points="50,33 62,38 67,50 62,62 50,67 38,62 33,50 38,38" />
        </svg>`;
      document.body.appendChild(splat);
      if (typeof gsap !== 'undefined') {
        gsap.fromTo(splat,
          { scale: 0, rotation: gsap.utils.random(-40, 40) },
          { scale: 1, rotation: 0, duration: 0.35, ease: 'back.out(2.5)' });
        gsap.to(splat, { opacity: 0, duration: 0.5, delay: 0.8, onComplete: () => splat.remove() });
      } else {
        setTimeout(() => splat.remove(), 1200);
      }
    });
  })();

  // 6. Marquees Infinite Scroll Loop
  function marquee(sel, dir) {
    const track = document.querySelector(sel + ' .marquee__track');
    if (!track) return;
    const tween = gsap.to(track, { xPercent: -50 * dir, duration: 20, ease: 'none', repeat: -1 });
    if (dir < 0) gsap.set(track, { xPercent: -50 });

    ScrollTrigger.create({
      trigger: sel,
      start: 'top bottom',
      end: 'bottom top',
      onUpdate(self) {
        const v = self.getVelocity() / 1000;
        tween.timeScale(gsap.utils.clamp(-4, 4, dir * (dir + v)) || dir * 0.2);
      },
    });
  }
  marquee('#marquee1', 1);
  marquee('#marquee2', -1);

  // 7. Pinned Origin Story Sequence
  (function initOrigin() {
    const scenes = gsap.utils.toArray('.origin__scene');
    const num = $('#originNum');
    if (!scenes.length || !num) return;

    const storyTl = gsap.timeline({
      scrollTrigger: {
        trigger: '#origin',
        start: 'top top',
        end: '+=' + (scenes.length * 90) + '%',
        pin: '#originPin',
        anticipatePin: 1,
        scrub: 0.4,
        onUpdate(self) {
          const idx = Math.min(scenes.length - 1, Math.floor(self.progress * scenes.length));
          num.textContent = String(idx + 1).padStart(2, '0');
        },
      },
    });

    scenes.forEach((scene, i) => {
      const img = scene.querySelector('img');
      const cap = scene.querySelector('.origin__caption');

      if (img) storyTl.to(img, { scale: 1, duration: 1, ease: 'none' }, i);
      if (i === 0 && cap) {
        storyTl.from(cap, { y: 40, opacity: 0, duration: 0.3 }, 0.05);
      }
      if (i < scenes.length - 1) {
        const next = scenes[i + 1];
        storyTl.set(next, { visibility: 'visible' }, i + 0.55)
               .fromTo(next,
                 { clipPath: 'circle(0% at 50% 50%)' },
                 { clipPath: 'circle(150% at 50% 50%)', duration: 0.45, ease: 'power2.inOut' },
                 i + 0.55);
        if (next.querySelector('.origin__caption')) {
          storyTl.from(next.querySelector('.origin__caption'), { y: 40, opacity: 0, duration: 0.25 }, i + 0.85);
        }
      }
    });
  })();

  // 8. Manifesto Character Scrub Reveal
  (function initManifesto() {
    const el = $('#manifestoText');
    if (!el) return;
    const text = el.textContent || '';
    el.innerHTML = text.trim().split(' ').map((w) =>
      `<span class="word">${[...w].map((c) => `<span class="char">${c}</span>`).join('')}</span>`
    ).join(' ');

    gsap.fromTo(el.querySelectorAll('.char'),
      { opacity: 0.15, y: 32, rotateX: -60 },
      {
        opacity: 1, y: 0, rotateX: 0,
        stagger: 0.5, ease: 'power2.out',
        scrollTrigger: {
          trigger: '#manifesto',
          start: 'top 75%',
          end: 'center 45%',
          scrub: 0.5,
        },
      });
  })();

  // 9. Section Entrance Animations
  gsap.utils.toArray('.panel, .section-head').forEach((el) => {
    gsap.from(el, {
      y: 40, opacity: 0, duration: 0.8, ease: 'power3.out',
      scrollTrigger: { trigger: el, start: 'top 88%' },
    });
  });

  // 10. Adaptive Top Header
  (function initAdaptiveHeader() {
    const header = document.querySelector('.header');
    if (!header) return;
    let darkCount = 0;
    const syncHeader = () => header.classList.toggle('is-over-dark', darkCount > 0);

    ['#origin', '#marquee2'].forEach((sel) => {
      const el = document.querySelector(sel);
      if (!el) return;
      ScrollTrigger.create({
        trigger: sel,
        start: 'top 52px',
        end: 'bottom 20px',
        onEnter: () => { darkCount++; syncHeader(); },
        onEnterBack: () => { darkCount++; syncHeader(); },
        onLeave: () => { darkCount--; syncHeader(); },
        onLeaveBack: () => { darkCount--; syncHeader(); },
      });
    });
  })();
}

/* ------------------------------------------------------------------
   Event Listeners
   ------------------------------------------------------------------ */

document.addEventListener('DOMContentLoaded', () => {
  const labTarget = $('#labTarget');
  if (labTarget) labTarget.addEventListener('change', syncLab);

  const btnBreak = $('#btnBreak');
  if (btnBreak) {
    btnBreak.addEventListener('click', async () => {
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
  }

  const btnHeal = $('#btnHeal');
  if (btnHeal) {
    btnHeal.addEventListener('click', () => {
      const id = /** @type {HTMLSelectElement} */ ($('#labTarget')).value;
      setBusy(true, 'healing');
      clearConsole('');
      const source = new EventSource(`/api/heal/${id}/stream?force=1`);

      source.addEventListener('line', (e) => push(JSON.parse(e.data).line));

      source.addEventListener('done', async (e) => {
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
  }

  const storyFilters = $('#storyFilters');
  if (storyFilters) {
    storyFilters.addEventListener('click', (e) => {
      const btn = /** @type {HTMLElement} */ (e.target).closest('.chip');
      if (!btn) return;
      activeDesk = btn.getAttribute('data-desk') ?? 'all';
      for (const chip of document.querySelectorAll('.chip')) chip.classList.toggle('is-on', chip === btn);
      renderStories();
    });
});

boot();
