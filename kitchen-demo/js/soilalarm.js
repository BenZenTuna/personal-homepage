/* The flower alarm — its document, its tile's words and its settings sheet.

   The soil sensor in the pots reads a number of its own: on the evening it
   was paired the pots read 10-12 % and were called fine. Where the alarm
   belongs is found by trying, so this sheet is for trying (2026-10-01, "fine
   tune and find the sweet spot"):

   - the line under which the pots need water, and the one under which they
     are getting dry (the flower goes yellow);
   - how many days the soil must stay under the water line before the alarm
     comes on — the flower red and blinking, and "Flowers need water" first in
     Needs attention with the chip red;
   - and, to choose them by, the pot's own history: its soil over 24 hours, 7
     or 30 days with both lines across it, the waterings found in it, how fast
     it dries since the last one, and when the alarm WOULD have come on with
     the levels on screen — replayed by the server with the live rule, so the
     answer is the alarm's, not an estimate of it.

   Every decision is the server's (backend/app/soil.py), which sends the
   verdict per pot over the SSE key `soil`; climate.js colours the flower from
   the same document. The card is drawn by the House panel on Automation
   (ha.js, buildAuto), the phone box's way. This is ctx.soil.

   Since 2026-10-30 the alarm can also be said aloud on the wall ("Please
   water the flowers", then in Turkish): soilsay.py decides when — inside the
   hours, every so often, so many times a day — and sends a ring over the SSE
   key `soilsay`; this page reads the two texts (voices.py owners flowers:1
   and flowers:2) one after the other, the school alert's way. */

const esc = (s) => String(s ?? '').replace(/[&<>"]/g,
  (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

const AFTER = [0, 0.5, 1, 2, 3, 4, 5, 7];       // the delay's choices, in days
const FRESH_S = 60;     // school.js FRESH_S: a ring this young still plays on a page just opened
const hh = (h) => `${String(h % 24).padStart(2, '0')}:00`;
const everyText = (m) => (m < 60 ? `${m} min` : `${m / 60} h`);
const RANGES = [['day', '24 hours'], ['week', '7 days'], ['month', '30 days']];
const LEVEL_WORDS = { ok: 'fine', dry: 'getting dry', water: 'need water' };
const CHART_H = 250;
const PAD = { l: 46, r: 14, t: 14, b: 26 };

const afterText = (d) => (!d ? 'at once' : d === 0.5 ? '12 hours'
  : `${d} ${d === 1 ? 'day' : 'days'}`);

/* "Tue 14:05", or "14:05" today. */
function when(t) {
  if (!t) return '';
  const d = new Date(t);
  const hm = d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false });
  if (d.toDateString() === new Date().toDateString()) return `today ${hm}`;
  const days = (Date.now() - d.getTime()) / 86400000;
  if (days > -6 && days < 6) return `${d.toLocaleDateString('en-GB', { weekday: 'short' })} ${hm}`;
  return `${d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })} ${hm}`;
}

/* "2 days 4 h" from milliseconds. */
function span(ms) {
  const h = Math.max(0, Math.round(ms / 3600000));
  if (h < 24) return `${h} h`;
  const d = Math.floor(h / 24);
  return `${d} ${d === 1 ? 'day' : 'days'}${h % 24 ? ` ${h % 24} h` : ''}`;
}

export default {
  doc: null,
  subs: [],
  key: null,          // the pot the sheet shows
  range: 'day',
  hist: null,
  histErr: '',
  _histN: 0,

  init(ctx) {
    this.ctx = ctx;
    this.buildSheet();
    ctx.voice?.onChange(() => this.render());
    ctx.bus.on('soilsay', (doc) => {
      if (!doc || typeof doc !== 'object' || !doc.settings) return;
      const ring = this.freshRing(doc);
      this.say = doc;
      if (ring) this.speak();
      this.render();
    });
    ctx.bus.on('soil', (doc) => {
      if (!doc || !Array.isArray(doc.pots)) return;
      this.doc = doc;
      if (!this.key || !doc.pots.some((p) => p.key === this.key)) this.key = doc.pots[0]?.key || null;
      this.changed();
      this.render();
    });
  },

  onDoc(fn) { this.subs.push(fn); },

  changed() {
    for (const fn of this.subs) {
      try { fn(this.doc); } catch (e) { console.error('soil subscriber failed', e); }
    }
  },

  /* Whether this document's ring is one to play: newer than any this page
     has seen and under a minute old (school.js fresh). `now` in seconds. */
  freshRing(doc, now = Date.now() / 1000) {
    const at = typeof doc.ring === 'number' ? doc.ring : null;
    const play = at !== null && Math.abs(now - at) <= FRESH_S
      && (this.lastRing == null || at > this.lastRing);
    if (at !== null) this.lastRing = Math.max(this.lastRing ?? 0, at);
    return play;
  },

  /* The texts, one after the other. Never on a phone (voice.play). */
  async speak() {
    if (this.speaking) return;
    this.speaking = true;
    try {
      for (const o of this.say?.owners || []) await this.ctx.voice?.play(o);
    } finally { this.speaking = false; }
  },

  async putSay(patch) {
    if (this.say) this.say.settings = { ...this.say.settings, ...patch };
    this.render();
    try {
      const r = await fetch('/api/soilsay/settings', {
        method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(patch),
      });
      const body = await r.json().catch(() => ({}));
      if (r.ok && body.settings) this.say = body;
      else this.ctx.soundlib?.toast(`Not saved: ${body.error || r.status}`);
    } catch { /* the next snapshot puts it right */ }
    this.render();
  },

  async trySay() {
    try {
      const r = await fetch('/api/soilsay/try', { method: 'POST' });
      const body = await r.json().catch(() => ({}));
      if (!r.ok) this.ctx.soundlib?.toast(body.error || `the kitchen said ${r.status}`);
    } catch (e) { this.ctx.soundlib?.toast(e.message); }
  },

  /* "Said 1 of 3 today · next 15:00", or why nothing is said. */
  sayLine() {
    const d = this.say;
    if (!d) return '';
    const s = d.settings;
    if (!s.enabled) return 'Off — the alarm is not said aloud.';
    const made = (d.owners || []).some((o) => this.ctx.voice?.file(o));
    if (!made) return 'Waiting for AI to make the voices — nothing is said until it has.';
    if (!d.alarm) return `The flowers do not need water — said only while the alarm is on (${d.count || 0} today).`;
    if (s.only_motion && !d.has_motion) return 'No kitchen motion sensor is set up, so nobody is ever seen — turn "Only when somebody is in the kitchen" off.';
    if (d.waiting) return `Said ${d.count || 0} of ${s.times} today · due now — waiting for somebody to come into the kitchen.`;
    const said = `Said ${d.count || 0} of ${s.times} today`;
    if (!d.next_at) return `${said} — no more today.`;
    const next = d.next_at * 1000 <= Date.now() + 15000 ? 'now' : when(d.next_at * 1000).replace('today ', '');
    return `${said} · next ${next}.`;
  },

  saySec() {
    const d = this.say;
    if (!d) return '';
    const kit = this.ctx.sheetkit;
    const s = d.settings;
    const v = this.ctx.voice;
    const step = (k, val, words) => `
      <span class="ls-set sheet-step">
        <button class="ls-btn sheet-txt" data-say-step="${k}" data-d="-1" aria-label="one less">−</button>
        <b class="sheet-val">${esc(words)}</b>
        <button class="ls-btn sheet-txt" data-say-step="${k}" data-d="1" aria-label="one more">+</button>
      </span>`;
    const off = s.enabled ? '' : ' nt-off';
    return kit.sec('Say it on the wall', `
      <div class="ls-row">
        <span class="ls-label">Read aloud<span class="db-hint">while the alarm is on, the wall reads
          the two texts below one after the other — inside the hours, as often as set, at most so many
          times a day. A watering starts the count again.</span></span>
        <div class="sheet-ctl">${kit.toggle(!!s.enabled, `data-say-en="${s.enabled ? 'false' : 'true'}"`)}</div>
      </div>
      <div class="ls-row${off}">
        <span class="ls-label">Hours<span class="db-hint">from the first hour up to the second.</span></span>
        <span class="ls-set">${step('from_h', s.from_h, `from ${hh(s.from_h)}`)}${step('to_h', s.to_h, `to ${hh(s.to_h)}`)}</span>
      </div>
      <div class="ls-row${off}">
        <span class="ls-label">Every</span>
        <span class="ls-set sheet-seg sheet-hourbar">${(d.every || []).map((m) => `
          <button class="ls-btn${s.every_min === m ? ' on' : ''}" data-say-every="${m}"
                  aria-pressed="${s.every_min === m}">${esc(everyText(m))}</button>`).join('')}</span>
      </div>
      <div class="ls-row${off}">
        <span class="ls-label">Times a day<span class="db-hint">then quiet until tomorrow or the next thirst.</span></span>
        ${step('times', s.times, `${s.times} ${s.times === 1 ? 'time' : 'times'}`)}
      </div>
      <div class="ls-row${off}">
        <span class="ls-label">Only when somebody is in the kitchen<span class="db-hint">the kitchen's
          motion sensor, or a touch on the wall, in the last minutes chosen. If nobody is there it waits
          — not counted — and says it the moment somebody walks in.</span></span>
        <div class="sheet-ctl sheet-across">${kit.toggle(!!s.only_motion, `data-say-mo="${s.only_motion ? 'false' : 'true'}"`)}
          <span class="ls-set sheet-seg${s.only_motion ? '' : ' nt-off'}">${(d.motion_choices || []).map((m) => `
            <button class="ls-btn${s.motion_min === m ? ' on' : ''}" data-say-mm="${m}"
                    aria-pressed="${s.motion_min === m}">${m} min</button>`).join('')}</span></div>
      </div>
      <div class="ls-row">
        <span class="ls-label">The words<span class="db-hint">first, then second. 🗣 to change one;
          AI makes the voice once.</span></span>
        <span class="ls-set">${(d.owners || []).map((o) => v?.chip(o) || '').join('')}
          <button class="ls-btn sl-say-try">▶ Try it on the wall</button></span>
      </div>
      ${(d.owners || []).map((o) => v?.editor(o, { hint: 'read aloud on the wall while the flowers need water' }) || '').join('')}
      <p class="sheet-note">${esc(this.sayLine())}</p>`,
    { note: s.enabled ? `${hh(s.from_h)}–${hh(s.to_h)} · every ${everyText(s.every_min)} · ${s.times}×${s.only_motion ? ' · 🚶' : ''}` : 'off' });
  },

  pot() { return (this.doc?.pots || []).find((p) => p.key === this.key) || null; },

  settings() { return this.pot()?.settings || {}; },

  /* The tile's line: "on · 11 % now · water under 8 % for 1 day", or "off". */
  summary() {
    const p = this.pot();
    if (!p) return '';
    const s = p.settings;
    const now = p.value == null ? 'no reading' : `${Math.round(p.value)} % now`;
    if (!s.enabled) return `off · ${now}`;
    if (p.alarm) return `needs water · ${now}`;
    return `on · ${now} · under ${s.water_below} %${s.after_days ? ` for ${afterText(s.after_days)}` : ''}`;
  },

  toggle() { this.put({ enabled: !this.settings().enabled }); },

  async put(patch) {
    const p = this.pot();
    if (!p) return;
    // Painted at once; the server's answer (the whole verdict) follows.
    p.settings = { ...p.settings, ...patch };
    this.changed();
    this.render();
    try {
      const r = await fetch(`/api/soil/${encodeURIComponent(p.key)}/settings`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch),
      });
      const body = await r.json().catch(() => ({}));
      if (r.ok && Array.isArray(body.pots)) {
        this.doc = body;
        this.changed();
      }
    } catch { /* the next snapshot puts it right */ }
    this.render();
    this.loadHist();
  },

  /* ------------------------------------------------------------ history -- */

  async loadHist() {
    const p = this.pot();
    if (!p || !this.isOpen()) return;
    const n = ++this._histN;
    const s = p.settings;
    const q = new URLSearchParams({ range: this.range, water_below: s.water_below,
      dry_below: s.dry_below, after_days: s.after_days });
    try {
      const r = await fetch(`/api/soil/${encodeURIComponent(p.key)}/history?${q}`, { cache: 'no-store' });
      const d = await r.json();
      if (n !== this._histN) return;           // a later ask won
      if (!r.ok) throw new Error(d.error || `the kitchen said ${r.status}`);
      this.hist = d;
      this.histErr = '';
    } catch (e) {
      if (n !== this._histN) return;
      this.histErr = String(e.message || e);
    }
    this.render();
  },

  /* The soil over the range, both lines across it, the times the alarm would
     have been on shaded red, and each watering marked. Measured to the pixel
     like climate.js's charts, for the same reason: no stretched type. */
  chart(d, width) {
    const pts = d.points || [];
    // A phone's card is about 360px across: under that the type is squeezed.
    const W = Math.max(320, Math.round(width));
    const H = CHART_H;
    if (pts.length < 2) {
      return `<p class="sl-empty">Not enough recorded over ${esc(d.label)} yet — Home Assistant
        keeps the sensor's readings from the moment it was paired, so this fills itself in.</p>`;
    }
    const s = d.settings;
    // A sensor younger than the range is drawn from its first reading, not
    // squeezed into the right-hand edge of a mostly empty week.
    d = { ...d, from: Math.max(d.from, pts[0].t) };
    let lo = Math.min(s.water_below, ...pts.map((p) => p.lo ?? p.v));
    let hi = Math.max(s.dry_below, ...pts.map((p) => p.hi ?? p.v));
    if (hi - lo < 10) { const m = (hi + lo) / 2; lo = m - 5; hi = m + 5; }
    const pad = (hi - lo) * 0.1;
    lo = Math.max(0, lo - pad);
    hi = Math.min(100, hi + pad);
    const x = (t) => PAD.l + ((t - d.from) / Math.max(1, d.to - d.from)) * (W - PAD.l - PAD.r);
    const y = (v) => PAD.t + (1 - (v - lo) / Math.max(1e-6, hi - lo)) * (H - PAD.t - PAD.b);

    const ticks = [0, 1, 2, 3].map((i) => lo + ((hi - lo) * i) / 3);
    const grid = ticks.map((v) => `
      <line class="cl-grid" x1="${PAD.l}" x2="${W - PAD.r}" y1="${y(v).toFixed(1)}" y2="${y(v).toFixed(1)}"/>
      <text class="cl-ax" x="${PAD.l - 8}" y="${(y(v) + 4).toFixed(1)}" text-anchor="end">${Math.round(v)}%</text>`).join('');
    const byDay = d.to - d.from > 2.5 * 86400000;
    // Five or six times along the foot whatever the span — a sensor an hour
    // old gets quarter hours, not one lonely label.
    const hrs = (d.to - d.from) / 3600000;
    const days = Math.ceil(hrs / 24 / 6);
    const mins = ([0.25, 0.5, 1, 2, 4].find((h) => hrs / h <= 6) || 4) * 60;
    /* Days by the calendar and hours by the clock, each tick from the first,
       not fixed milliseconds back from a multiple of the step in UTC: that
       gave 01, 05, 09 all winter, and the Sunday the clocks go back is 25
       hours long, which put every midnight before it at 01:00. Quarter and
       half hours go back in real time: a clock change moves them by a whole
       hour, and by the clock the second 02:00-03:00 would have none. */
    const start = new Date(d.to);
    const every = mins / 60;               // hours between ticks, when they are hours
    const hour0 = Math.floor(start.getHours() / every) * every;
    if (byDay) start.setHours(0, 0, 0, 0);
    else if (mins < 60) start.setTime(Math.floor(d.to / (mins * 60000)) * mins * 60000);
    else start.setHours(hour0, 0, 0, 0);
    let xt = '';
    for (let k = 0; ; k++) {
      const at = new Date(start);
      if (k && byDay) at.setDate(start.getDate() - k * days);
      else if (k && mins < 60) at.setTime(start.getTime() - k * mins * 60000);
      else if (k) at.setHours(hour0 - k * every);
      const t = at.getTime();
      if (!(t > d.from)) break;            // NaN too: no range, no ticks
      /* The night the clocks go forward has no 02:00, and JS moves an hour
         asked for there on to 03:00: a second "03:00" on the hourly ticks,
         a lone 03 among the even ones, or, as the first tick, every tick
         after it on the odd hours. So each tick is worked out from the hour
         asked for, and one that is not at it is left out. */
      if (!byDay && mins >= 60 && at.getHours() !== (((hour0 - k * every) % 24) + 24) % 24) continue;
      const label = byDay
        ? new Date(t).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
        : new Date(t).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false });
      xt += `<text class="cl-ax" x="${x(t).toFixed(1)}" y="${H - 7}" text-anchor="middle">${label}</text>`;
    }
    const eps = (d.episodes || []).map((e) => {
      const x0 = x(e.from);
      const x1 = x(e.to ?? d.to);
      return `<rect class="sl-ep" x="${x0.toFixed(1)}" y="${PAD.t}" width="${Math.max(2, x1 - x0).toFixed(1)}"
                    height="${H - PAD.t - PAD.b}"/>`;
    }).join('');
    const lines = [['water', s.water_below, `needs water below ${s.water_below}%`],
                   ['dry', s.dry_below, `getting dry below ${s.dry_below}%`]]
      .filter(([cls, v], i, all) => cls === 'water' || v !== all[0][1])
      .map(([cls, v, txt]) => `
        <line class="cl-limit ${cls}" x1="${PAD.l}" x2="${W - PAD.r}" y1="${y(v).toFixed(1)}" y2="${y(v).toFixed(1)}"/>
        ${cls === 'water'
          ? `<text class="cl-limit-t ${cls}" x="${PAD.l + 6}" y="${(y(v) - 5).toFixed(1)}">${esc(txt)}</text>`
          // The dry line's words at the other end, so two lines a point or
          // two apart never print their words over each other.
          : `<text class="cl-limit-t ${cls}" x="${W - PAD.r - 6}" y="${(y(v) - 5).toFixed(1)}" text-anchor="end">${esc(txt)}</text>`}`).join('');
    const path = pts.map((p) => `${x(p.t).toFixed(1)},${y(p.v).toFixed(1)}`).join(' ');
    const drops = (d.waterings || []).map((w) => `
      <g class="sl-drop"><line x1="${x(w.t).toFixed(1)}" x2="${x(w.t).toFixed(1)}" y1="${PAD.t}" y2="${H - PAD.b}"/>
      <text x="${x(w.t).toFixed(1)}" y="${PAD.t + 12}" text-anchor="middle">💧</text></g>`).join('');
    return `<svg class="sl-svg" viewBox="0 0 ${W} ${H}" style="height:${H}px" preserveAspectRatio="none"
                 role="img" aria-label="soil moisture over ${esc(d.label)}">
      ${grid}${xt}${eps}${lines}${drops}
      <polyline class="cl-line" style="--c:var(--soil-ok)" points="${path}"/></svg>`;
  },

  /* What the chart says, in sentences: the would-be alarms, the waterings,
     and how fast the pots dry — with how long until the water line at that
     rate, which is the number the delay is chosen by. */
  findings(d) {
    const out = [];
    const eps = d.episodes || [];
    const s = d.settings;
    const rule = `under ${s.water_below} %${s.after_days ? ` for ${afterText(s.after_days)}` : ''}`;
    if (!eps.length) {
      out.push(`With these settings (${esc(rule)}) the alarm would <b>not</b> have come on in the last ${esc(d.label)}.`);
    } else {
      const list = eps.map((e) => `${esc(when(e.from))}${e.to ? '' : ' (still on)'}, lowest ${Math.round(e.low)} %`);
      out.push(`With these settings (${esc(rule)}) the alarm would have come on <b>${eps.length}
        ${eps.length === 1 ? 'time' : 'times'}</b> in the last ${esc(d.label)}: ${list.join(' · ')}.`);
    }
    const w = d.waterings || [];
    if (w.length) {
      out.push(`Waterings seen: ${w.slice(-5).map((x) => `${esc(when(x.t))} (${Math.round(x.from)} → ${Math.round(x.to)} %)`).join(' · ')}.`);
    } else {
      out.push('No watering seen in this range — a rise of 5 points or more within a few hours counts as one.');
    }
    const v = this.pot()?.value;
    if (d.drying) {
      let line = `Since ${w.length ? 'the last watering' : 'the start of the range'} the soil dries about <b>${d.drying} % a day</b>`;
      if (v != null && v > s.water_below) {
        line += ` — at that rate it reaches ${s.water_below} % in about ${esc(span(((v - s.water_below) / d.drying) * 86400000))}`;
      }
      out.push(`${line}.`);
    }
    return out.map((t) => `<p>${t}</p>`).join('');
  },

  /* -------------------------------------------------------------- sheet -- */

  buildSheet() {
    const el = document.createElement('div');
    el.id = 'sl-sheet';
    el.className = 'sheet';   // the settings window kit (app.css)
    el.innerHTML = `
      <header>
        <span class="sheet-icon" aria-hidden="true">🌷</span>
        <div class="sheet-title">
          <h2>Flower alarm</h2>
          <span class="sheet-status sl-now"></span>
        </div>
        <span class="spacer"></span>
        <button class="ls-close">Close</button>
      </header>
      <div class="ls-body"></div>`;
    document.body.appendChild(el);
    this.sheet = el;
    this.bodyEl = el.querySelector('.ls-body');
    el.querySelector('.ls-close').onclick = () => this.close();
    addEventListener('resize', () => { if (this.isOpen()) this.render(); });
  },

  open() {
    this.sheet.classList.add('open');
    this.render();
    this.loadHist();
  },

  close() { this.sheet.classList.remove('open'); },

  isOpen() { return !!this.sheet && this.sheet.classList.contains('open'); },

  /* "Under 8 % since Tue 14:05 — the alarm comes on Wed 14:05". */
  stateLine(p) {
    const s = p.settings;
    if (p.alarm) return `Under ${s.water_below} % since ${when(p.below_since * 1000)} — the alarm is on.`;
    if (p.below_since && p.alarm_at) {
      return `Under ${s.water_below} % since ${when(p.below_since * 1000)} — the alarm comes on
        ${when(p.alarm_at * 1000)}, unless the pots are watered first.`;
    }
    if (p.below_since) return `Under ${s.water_below} % since ${when(p.below_since * 1000)} — the alarm is off.`;
    return `Over the water line (${s.water_below} %): the alarm's clock is not running.`;
  },

  /* − value +: the kit's stepper, five and one points a tap. */
  level(field, label, hint) {
    const v = this.settings()[field] ?? 0;
    return `
      <div class="ls-row">
        <span class="ls-label">${label}<span class="db-hint">${hint}</span></span>
        <span class="ls-set sheet-step">
          <button class="ls-btn sheet-txt" data-lv="${field}" data-d="-5" aria-label="5 points lower">−5</button>
          <button class="ls-btn sheet-txt" data-lv="${field}" data-d="-1" aria-label="a point lower">−1</button>
          <b class="sheet-val sl-val sl-${field}">${esc(v)} %</b>
          <button class="ls-btn sheet-txt" data-lv="${field}" data-d="1" aria-label="a point higher">+1</button>
          <button class="ls-btn sheet-txt" data-lv="${field}" data-d="5" aria-label="5 points higher">+5</button>
        </span>
      </div>`;
  },

  /* The sheet's header line and its tone (the settings window kit). */
  headLine(p) {
    const now = p.value == null ? 'no reading' : `${Math.round(p.value)} % now`;
    if (!p.settings.enabled) return [`<b>Off</b> · ${esc(now)}`, 'off'];
    if (p.alarm) return [`<b>Needs water</b> · ${esc(now)}`, 'warn'];
    return [`<b>On</b> · ${esc(now)}${p.level ? ` · ${esc(LEVEL_WORDS[p.level] || '')}` : ''}`, 'ok'];
  },

  /* The state sentence at the top (the settings window kit): when the alarm
     comes on and what comes next, with its switch beside it. */
  sumCard(p) {
    const kit = this.ctx.sheetkit;
    const s = p.settings;
    const ctl = kit.toggle(!!s.enabled, `data-en="${s.enabled ? 'false' : 'true'}"`);
    const rule = s.after_days
      ? `when the soil stays under <b>${esc(s.water_below)} %</b> for <b>${esc(afterText(s.after_days))}</b>`
      : `as soon as the soil is under <b>${esc(s.water_below)} %</b>`;
    if (!s.enabled) {
      return kit.sum('Off — no alarm; the flower in the top bar still changes colour.', {
        next: `When it is on, the alarm comes on ${rule}.`, ctl, cap: 'Alarm', off: true,
      });
    }
    if (p.alarm) {
      return kit.sum(`<b class="sl-warn">${esc(p.label)} need water</b> — the alarm is on.`, {
        next: `It goes off once the soil reads <b>${esc(s.water_below + (this.doc?.hyst || 3))} %</b> — a watering.`,
        ctl, cap: 'Alarm',
      });
    }
    const now = p.value == null ? 'No reading from the sensor yet.'
      : p.alarm_at ? `Next: the alarm at <b>${esc(when(p.alarm_at * 1000))}</b>, unless the pots are watered first.`
        : p.below_since ? `Now <b>${Math.round(p.value)} %</b>, under the line.`
          : `Now <b>${Math.round(p.value)} %</b> — over the line, so the alarm's clock is not running.`;
    return kit.sum(`The alarm comes on ${rule}.`, { next: now, ctl, cap: 'Alarm' });
  },

  render() {
    if (!this.isOpen()) return;
    const kit = this.ctx.sheetkit;
    const nowEl = this.sheet.querySelector('.sl-now');
    const p = this.pot();
    if (!p) {
      kit.status(nowEl, '');
      this.bodyEl.innerHTML = '<div class="at-none">No soil sensor is configured.</div>';
      kit.sync(this.sheet);
      return;
    }
    const s = p.settings;
    const pick = (a, b) => (a === b ? ' on' : '');
    const now = p.value == null ? '—' : `${Math.round(p.value)} %`;
    const lvl = p.level || '';
    kit.status(nowEl, ...this.headLine(p));
    const have = this.hist && this.hist.key === p.key && this.hist.range === this.range;
    this.bodyEl.innerHTML = `
      ${this.sumCard(p)}

      ${kit.sec(`${p.emoji} ${p.label} now`, `
        <div class="ls-row sl-now">
          <span class="ls-label"><span class="db-hint sheet-lead">${esc(this.stateLine(p))}</span></span>
          <div class="sheet-ctl sheet-across">
            <span class="sl-reading" data-lvl="${esc(lvl)}">${esc(now)}
              <i>${esc(LEVEL_WORDS[lvl] || 'no reading')}</i></span>
            ${p.value != null ? `<button class="ls-btn sheet-primary sl-here">They need water now — put the line at ${Math.round(p.value) + 1} %</button>` : ''}
          </div>
        </div>`, { note: p.value == null ? 'no reading' : `${now} · ${LEVEL_WORDS[lvl] || ''}` })}

      ${kit.sec('Levels', `
        ${this.level('water_below', 'Needs water below',
          'under this the clock starts. It stops again once the soil reads '
          + `${this.doc?.hyst || 3} points over it — a watering, not a sensor wobbling on the line.`)}
        ${this.level('dry_below', 'Getting dry below',
          'the flower goes yellow under this: a warning, never an alarm. Never under the water line.')}`,
        { note: `water ${s.water_below} % · dry ${s.dry_below} %` })}

      ${kit.sec('The alarm', `
        <p class="sheet-note">When it is on, the flower in the top bar goes red and
          blinks, and "${esc(p.label)} need water" comes first in Needs attention.
          Off, the flower still changes colour.</p>
        <div class="ls-row${s.enabled ? '' : ' nt-off'}">
          <span class="ls-label">Alarm after
            <span class="db-hint">how long the soil has to stay under the water line before
              the alarm comes on. Until then the flower is yellow.</span></span>
          <span class="ls-set sheet-seg sheet-hourbar">${AFTER.map((d) => `
            <button class="ls-btn${pick(s.after_days, d)}" data-after="${d}"
                    aria-pressed="${s.after_days === d}">${esc(afterText(d))}</button>`).join('')}
          </span>
        </div>`, { note: s.enabled ? `on · ${afterText(s.after_days)}` : 'off' })}

      ${this.saySec()}

      ${kit.sec('Try it on the history', `
        <div class="ls-row">
          <span class="ls-label"><span class="db-hint sheet-lead">Shaded red: when the alarm would have been on
            with the levels above. 💧 a watering. To find the line: when the pots look thirsty, tap
            <b>They need water now</b>, and let a few waterings show how fast they dry.</span></span>
          <span class="ls-set sheet-seg">${RANGES.map(([k, l]) => `
            <button class="ls-btn${pick(this.range, k)}" data-range="${k}" aria-pressed="${this.range === k}">${l}</button>`).join('')}</span>
        </div>
        <div class="sl-chart">${have ? '' : `<p class="sl-empty">${esc(this.histErr || 'Reading the history…')}</p>`}</div>
        <div class="sl-find">${have ? this.findings(this.hist) : ''}${this.histErr && this.hist
          ? `<p class="db-warn">${esc(this.histErr)}</p>` : ''}</div>`,
        { note: (RANGES.find(([k]) => k === this.range) || RANGES[0])[1] })}`;

    // The chart is measured to the pixel: drawn once its card is laid out,
    // at the width the card gives it.
    const chartEl = this.bodyEl.querySelector('.sl-chart');
    if (have && chartEl) chartEl.innerHTML = this.chart(this.hist, chartEl.clientWidth);

    this.bodyEl.querySelectorAll('[data-en]').forEach((b) => {
      b.onclick = () => this.put({ enabled: b.dataset.en === 'true' });
    });
    this.bodyEl.querySelectorAll('[data-lv]').forEach((b) => {
      b.onclick = () => {
        const f = b.dataset.lv;
        const cur = this.settings();
        let v = Math.min(100, Math.max(0, (cur[f] ?? 0) + Number(b.dataset.d)));
        const patch = { [f]: v };
        // The two lines keep their order: the dry line is never under the
        // water line, so moving one past the other takes the other along.
        if (f === 'water_below' && v > cur.dry_below) patch.dry_below = v;
        if (f === 'dry_below' && v < cur.water_below) { v = cur.water_below; patch.dry_below = v; }
        this.put(patch);
      };
    });
    this.bodyEl.querySelectorAll('[data-after]').forEach((b) => {
      b.onclick = () => this.put({ after_days: Number(b.dataset.after) });
    });
    this.bodyEl.querySelectorAll('[data-range]').forEach((b) => {
      b.onclick = () => { this.range = b.dataset.range; this.hist = null; this.render(); this.loadHist(); };
    });
    this.bodyEl.querySelectorAll('[data-say-en]').forEach((b) => {
      b.onclick = () => this.putSay({ enabled: b.dataset.sayEn === 'true' });
    });
    this.bodyEl.querySelectorAll('[data-say-mo]').forEach((b) => {
      b.onclick = () => this.putSay({ only_motion: b.dataset.sayMo === 'true' });
    });
    this.bodyEl.querySelectorAll('[data-say-mm]').forEach((b) => {
      b.onclick = () => this.putSay({ motion_min: Number(b.dataset.sayMm) });
    });
    this.bodyEl.querySelectorAll('[data-say-every]').forEach((b) => {
      b.onclick = () => this.putSay({ every_min: Number(b.dataset.sayEvery) });
    });
    this.bodyEl.querySelectorAll('[data-say-step]').forEach((b) => {
      b.onclick = () => {
        const k = b.dataset.sayStep;
        const s = this.say?.settings || {};
        const lim = { from_h: [0, 23], to_h: [1, 24], times: [1, this.say?.times_max || 10] }[k];
        this.putSay({ [k]: Math.min(lim[1], Math.max(lim[0], (s[k] ?? 0) + Number(b.dataset.d))) });
      };
    });
    const tryBtn = this.bodyEl.querySelector('.sl-say-try');
    if (tryBtn) tryBtn.onclick = () => this.trySay();
    this.ctx.voice?.wire(this.bodyEl, () => this.render());
    const here = this.bodyEl.querySelector('.sl-here');
    if (here) {
      here.onclick = () => {
        const v = Math.round(this.pot()?.value ?? 0) + 1;
        const cur = this.settings();
        this.put({ water_below: v, ...(cur.dry_below < v ? { dry_below: v } : {}) });
      };
    }
    kit.sync(this.sheet);
  },
};
