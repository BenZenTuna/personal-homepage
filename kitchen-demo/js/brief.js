/* The morning brief (backend/app/brief.py) — on the wall, and its card.

   Alex, 2026-11-05: the wall says what the day holds — the weather, school
   and what to bring, today's events, the to-dos, any warning — the first
   time somebody comes into the kitchen after the time chosen, on the days
   chosen. "make this as an automation card so users can choose the time,
   days and can pause and turn it on and off and even can choose languages".

   The server decides when and makes the speech (AI, voices.py owner
   "brief"); this page shows the "Good morning" card with the same lines and
   plays the voice, on the wall only (night.js onWall): a laptop open in
   another room says nothing. `ring` is a timestamp-ed document: shown if it
   is under two minutes old and this page has not shown it (kept across the
   reload a wake makes, in localStorage).

   The card on House → Automation (panels/ha.js draws it): On/Off, ⏸ Pause
   (school alert's), ⚙ this sheet — time, until, days, language and voice,
   what it would say now, and Say it now. */

const esc = (s) => String(s ?? '').replace(/[&<>"]/g,
  (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

const FRESH_S = 120;
const SHOWN_KEY = 'brief-shown';
const CARD_MS = 3 * 60 * 1000;
const HOURS = ['05', '06', '07', '08', '09', '10'];
const MINUTES = ['00', '10', '20', '30', '40', '50'];
const LANG_NAMES = { en: 'English', sv: 'Svenska', tr: 'Türkçe' };
const DAY_NAMES = { school: 'School days', weekdays: 'Weekdays', every: 'Every day', custom: 'Choose days' };
const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

export default {
  doc: null,
  subs: [],
  preview: null,
  trying: false,

  init(ctx) {
    this.ctx = ctx;
    this.buildSheet();
    this.buildShow();
    ctx.bus.on('brief', (doc) => {
      if (!doc || typeof doc !== 'object') return;
      this.doc = doc;
      this.maybeShow(doc.ring);
      this.changed();
      this.render();
    });
  },

  onDoc(fn) { this.subs.push(fn); },

  changed() {
    for (const fn of this.subs) {
      try { fn(this.doc); } catch (e) { console.error('brief subscriber failed', e); }
    }
  },

  settings() { return (this.doc && this.doc.settings) || {}; },

  paused() {
    const p = this.doc && this.doc.paused;
    return typeof p === 'number' && Number.isFinite(p) ? p : null;
  },

  daysText(s) {
    if (s.days === 'custom') {
      const d = (s.weekdays || []).map((i) => WEEKDAYS[i]);
      return d.length ? d.join(' ') : 'no days';
    }
    return (DAY_NAMES[s.days] || 'School days').toLowerCase();
  },

  /* The card's lines: "on · 07:20 · school days · English", "paused · since
     07:31", or "off". */
  summary() {
    const s = this.settings();
    if (!this.doc) return '';
    if (!s.enabled) return 'off';
    const p = this.paused();
    if (p !== null) {
      const d = new Date(p * 1000);
      return `paused · since ${d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}`;
    }
    return `on · ${s.time} · ${this.daysText(s)} · ${LANG_NAMES[s.lang] || 'English'}`;
  },

  toggle() { this.put({ enabled: !this.settings().enabled }); },

  async put(patch) {
    if (this.doc) {
      this.doc = { ...this.doc, settings: { ...this.settings(), ...patch } };
      this.changed();
      this.render();
    }
    try {
      const r = await fetch('/api/brief/settings', {
        method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(patch),
      });
      const body = await r.json().catch(() => null);
      if (r.ok && body && body.settings) {
        this.doc = body;
        this.changed();
        this.render();
        if ('lang' in patch || 'days' in patch) this.loadPreview();
      }
    } catch { /* the next snapshot puts it right */ }
  },

  async setPause(on) {
    if (this.doc) {
      this.doc = { ...this.doc, paused: on ? Date.now() / 1000 : null };
      this.changed();
      this.render();
    }
    try {
      const r = await fetch('/api/brief/pause', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ paused: !!on }),
      });
      const body = await r.json().catch(() => null);
      if (r.ok && body && body.settings) {
        this.doc = body;
        this.changed();
        this.render();
      }
    } catch { /* the next snapshot puts it right */ }
  },

  // ------------------------------------------------- the card on the wall ----

  onWall() {
    const n = this.ctx.night;
    return !n?.onWall || n.onWall();
  },

  maybeShow(ring) {
    if (!ring || typeof ring.at !== 'number' || this.ctx.phone || !this.onWall()) return;
    if (Math.abs(Date.now() / 1000 - ring.at) > FRESH_S) return;
    let shown = 0;
    try { shown = Number(localStorage.getItem(SHOWN_KEY)) || 0; } catch { /* private */ }
    if (ring.at <= shown) return;
    try { localStorage.setItem(SHOWN_KEY, String(ring.at)); } catch { /* private */ }
    this.show(ring);
  },

  buildShow() {
    const el = document.createElement('div');
    el.id = 'bf-show';
    el.setAttribute('role', 'dialog');
    el.setAttribute('aria-live', 'polite');
    el.innerHTML = `<div class="bf-box">
        <div class="bf-head"><span class="bf-sun" aria-hidden="true">🌅</span><h2></h2>
          <button class="ls-btn bf-close">Close</button></div>
        <ul class="bf-lines"></ul></div>`;
    el.querySelector('.bf-close').onclick = (e) => { e.stopPropagation(); this.hide(); };
    el.onclick = () => this.hide();
    document.body.appendChild(el);
    this.showEl = el;
  },

  show(ring) {
    const el = this.showEl;
    el.querySelector('h2').textContent = ring.title || 'Good morning';
    el.querySelector('.bf-lines').innerHTML = (ring.lines || []).map((l) =>
      `<li><span class="bf-ico" aria-hidden="true">${esc(l.icon)}</span><span>${esc(l.text)}</span></li>`).join('');
    // Last in the page, over the dim clock and any window.
    document.body.appendChild(el);
    el.classList.add('open');
    clearTimeout(this.hideTimer);
    this.hideTimer = setTimeout(() => this.hide(), CARD_MS);
    if (ring.owner) this.ctx.voice?.play(ring.owner);
  },

  hide() {
    clearTimeout(this.hideTimer);
    this.showEl?.classList.remove('open');
    this.ctx.voice?.stop?.();
  },

  // -------------------------------------------------------------- sheet ----

  buildSheet() {
    const el = document.createElement('div');
    el.id = 'bf-sheet';
    el.className = 'sheet';
    el.innerHTML = `
      <header>
        <span class="sheet-icon" aria-hidden="true">🌅</span>
        <div class="sheet-title"><h2>Morning brief</h2><span class="sheet-status bf-now"></span></div>
        <span class="spacer"></span>
        <button class="ls-close">Close</button>
      </header>
      <div class="ls-body"></div>`;
    document.body.appendChild(el);
    this.sheet = el;
    this.bodyEl = el.querySelector('.ls-body');
    el.querySelector('.ls-close').onclick = () => this.close();
  },

  open() {
    this.sheet.classList.add('open');
    this.render();
    this.loadPreview();
  },

  close() { this.sheet.classList.remove('open'); },

  isOpen() { return this.sheet.classList.contains('open'); },

  async loadPreview() {
    try {
      const r = await fetch('/api/brief/preview', { cache: 'no-store' });
      if (r.ok) this.preview = await r.json();
    } catch { /* the sheet says nothing about it */ }
    this.render();
  },

  async tryIt() {
    if (this.trying) return;
    this.trying = true;
    this.render();
    try {
      // The wall shows it by its ring, like the real one; this waits for the voice.
      await fetch('/api/brief/try', { method: 'POST' });
    } catch { /* nothing to say */ }
    this.trying = false;
    this.render();
  },

  sumCard(s) {
    const kit = this.ctx.sheetkit;
    const ctl = kit.toggle(!!s.enabled, `data-put="enabled" data-v="${s.enabled ? 'false' : 'true'}"`);
    const t = this.doc?.today || {};
    const what = `on <b>${esc(this.daysText(s))}</b>, the first time somebody comes into the kitchen
      from <b>${esc(s.time)}</b> until <b>${esc(s.until)}</b>, in <b>${esc(LANG_NAMES[s.lang] || 'English')}</b>`;
    if (!s.enabled) {
      return kit.sum('Off — no morning brief.', { next: `When it is on: ${what}.`, ctl, cap: 'Morning brief', off: true });
    }
    if (this.paused() !== null) {
      return kit.sum('Paused — nothing is said until ▶ Play on its card.', { next: `Then: ${what}.`, ctl, cap: 'Morning brief' });
    }
    const today = t.done ? 'Said today.' : t.for_today ? 'Today: yes, at the first movement.'
      : `Not today${t.why ? ` — ${esc(t.why)}` : ''}.`;
    return kit.sum(`The wall says the day's brief ${what}.`, { next: today, ctl, cap: 'Morning brief' });
  },

  render() {
    if (!this.sheet || !this.isOpen() || !this.doc) return;
    const kit = this.ctx.sheetkit;
    const s = this.settings();
    const pick = (on) => (on ? ' on' : '');
    kit.status(this.sheet.querySelector('.bf-now'),
      !s.enabled ? '<b>Off</b>' : this.paused() !== null ? '<b>Paused</b>' : `<b>On</b> · ${esc(s.time)}`,
      !s.enabled ? 'off' : this.paused() !== null ? 'warn' : 'ok');
    const [h, m] = String(s.time || '07:20').split(':');
    const seg = (key, values, now, words = (v) => v) => `<span class="ls-set sheet-seg">${values.map((v) =>
      `<button class="ls-btn${pick(v === now)}" data-${key}="${esc(v)}" aria-pressed="${v === now}">${esc(words(v))}</button>`)
      .join('')}</span>`;
    const ch = this.doc.choices || {};
    const lines = this.preview?.lines || [];
    this.bodyEl.innerHTML = `
      ${this.sumCard(s)}

      ${kit.sec('When', `
        <p class="sheet-note">From this time, the first movement in the kitchen or touch on the wall
          starts it — once a day. Nobody by the end time: nothing that day.</p>
        <div class="ls-row"><span class="ls-label">Hour</span>${seg('hh', HOURS, h)}</div>
        <div class="ls-row"><span class="ls-label">Minute</span>${seg('mm', MINUTES, m, (v) => `:${v}`)}</div>
        <div class="ls-row"><span class="ls-label">Until</span>${seg('until', ch.until || [], s.until)}</div>`,
      { note: `${s.time}–${s.until}` })}

      ${kit.sec('Days', `
        <div class="ls-row"><span class="ls-label"><span class="db-hint sheet-lead">School days follow the
          school board: no brief on a holiday, a study day or a red day.</span></span>
          ${seg('days', ch.days || Object.keys(DAY_NAMES), s.days, (v) => DAY_NAMES[v] || v)}</div>
        ${s.days === 'custom' ? `<div class="ls-row"><span class="ls-label">On</span>
          <span class="ls-set sheet-chips">${WEEKDAYS.map((d, i) => {
            const on = (s.weekdays || []).includes(i);
            return `<button class="ls-btn${pick(on)}" data-wd="${i}" aria-pressed="${on}">${d}</button>`;
          }).join('')}</span></div>` : ''}`, { note: this.daysText(s) })}

      ${kit.sec('Language and voice', `
        <div class="ls-row"><span class="ls-label">Language</span>
          ${seg('lang', ch.langs || ['en', 'sv', 'tr'], s.lang, (v) => LANG_NAMES[v] || v)}</div>
        <div class="ls-row"><span class="ls-label">Voice</span>
          ${seg('voice', ch.voices || ['female', 'male'], s.voice, (v) => (v === 'male' ? 'Male' : 'Female'))}</div>
        <p class="sheet-note">The voice is made on AI. While AI is away the card is shown without it.</p>`,
      { note: `${LANG_NAMES[s.lang] || 'English'} · ${s.voice === 'male' ? 'male' : 'female'}` })}

      ${kit.sec('What it says', `
        <p class="sheet-note">As it would be said now — each part only when it has something to say.</p>
        <ul class="bf-lines bf-prev">${lines.map((l) =>
          `<li><span class="bf-ico" aria-hidden="true">${esc(l.icon)}</span><span>${esc(l.text)}</span></li>`).join('')
          || '<li>…</li>'}</ul>
        <div class="ls-row"><span class="ls-label"><span class="db-hint sheet-lead">on the wall now, with its
          voice — it takes AI a few seconds to make</span></span>
          <span class="ls-set"><button class="ls-btn sheet-primary bf-try"${this.trying ? ' disabled' : ''}>${
            this.trying ? 'Making the voice…' : 'Say it now'}</button></span></div>`)}`;

    this.bodyEl.querySelectorAll('[data-put]').forEach((b) => {
      b.onclick = () => this.put({ [b.dataset.put]: JSON.parse(b.dataset.v) });
    });
    this.bodyEl.querySelectorAll('[data-hh]').forEach((b) => { b.onclick = () => this.put({ time: `${b.dataset.hh}:${m}` }); });
    this.bodyEl.querySelectorAll('[data-mm]').forEach((b) => { b.onclick = () => this.put({ time: `${h}:${b.dataset.mm}` }); });
    for (const key of ['until', 'days', 'lang', 'voice']) {
      this.bodyEl.querySelectorAll(`[data-${key}]`).forEach((b) => { b.onclick = () => this.put({ [key]: b.dataset[key] }); });
    }
    this.bodyEl.querySelectorAll('[data-wd]').forEach((b) => {
      b.onclick = () => {
        const i = Number(b.dataset.wd);
        const now = new Set(s.weekdays || []);
        if (now.has(i)) now.delete(i); else now.add(i);
        this.put({ weekdays: [...now].sort() });
      };
    });
    const t = this.bodyEl.querySelector('.bf-try');
    if (t) t.onclick = () => this.tryIt();
    kit.sync(this.sheet);
  },
};
