/* The phone box — its document, its tile's words and its settings sheet.

   At the set time (21:30) the server sends every chosen phone a notification,
   opens the box page on it, and has it say "It is time to put your phone in
   the box" on the alarm volume, `times` times (backend/app/phonebox.py).
   Nothing here makes a sound or a schedule: the phones have to hear it whether
   or not the wall is awake, so the sending is the server's. This keeps the document
   the SSE key `phonebox` carries, and the sheet that changes it.

   The card itself is drawn by the House panel on Automation (ha.js,
   buildAuto), for the doorbell's reason: the panel owns the grid, this owns
   the thing. It is on the context as ctx.phonebox.

   **The wall's own sound is played here.** When the server marks a ring (at
   the time, if `wall` is on, or "Play on the wall now"), every screen plays
   the whole recording, sounds/phone-box.mp3, `times` times — the doorbell's
   rule for which ring is new: the first document a page sees is adopted in
   silence, and after that only a later ring plays. A phone's page never plays
   it (ctx.phone): the phones have their own. `hush` is Stop, read the same way.

   The browser never sends a word of the notification. It names phones by
   their ids, a time as HH:MM and on or off; the server writes the text.

   **Still on the phone (2026-10-28):** after the box, a phone in use for
   `watch_after` minutes in a row is told by name to put it in the box, again
   every `watch_again` minutes, until `watch_until`. The looking is the
   server's (phonebox.py, look()); this shows it, and "Check the phones now"
   asks for one look that tells nobody.

   **Pause (2026-10-31, the school alert's ⏸):** on the card (ha.js) and in
   the sheet, it holds everything the box sends — the phones' notification,
   box page and sentence, the wall's recording, the "still on the phone"
   messages — until ▶ Play. The server keeps it (`paused`, since when). */

const esc = (s) => String(s ?? '').replace(/[&<>"]/g,
  (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

const STEP_MIN = 5;   // the time moves in fives; a box does not need 21:32
const EVERY_S = 6;    // phonebox.py SAY_EVERY_S: one sentence this often
const TIMES_MAX = 20; // phonebox.py TIMES_MAX
const WALL_CLIP_S = 15;  // the whole recording
const AFTER_MIN = 3, AFTER_MAX = 30;            // phonebox.py WATCH_AFTER_*
const AGAIN = [0, 5, 10, 15, 20, 30, 45, 60];   // phonebox.py WATCH_AGAIN
const UNTIL_STEP = 15;
const hhmm = (t) => {
  const d = new Date(t * 1000);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
};
const SOUND = 'sounds/phone-box.mp3';
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

const stampOf = (x) => {
  const at = x && x.at;
  return typeof at === 'number' && Number.isFinite(at) ? at : null;
};

export default {
  doc: null,
  subs: [],
  trying: false,
  tryErr: '',
  seen: false,          // has this page had a document yet
  lastRingAt: null,     // the newest wall ring this page knows about
  lastHushAt: null,     // ...and the newest Stop
  audio: null,
  left: 0,              // plays still to come of the current ring

  init(ctx) {
    this.ctx = ctx;
    this.buildSheet();
    ctx.voice?.onChange(() => this.render());
    ctx.bus.on('phonebox', (doc) => {
      if (!doc || typeof doc !== 'object') return;
      const [ring, hush] = this.fresh(doc);
      this.doc = doc;
      if (hush) this.stopWall();
      if (ring) this.playWall(ring.times);
      this.changed();
      this.render();
    });
  },

  /* Which of this document's ring and Stop this page has not acted on yet.
     The snapshot replays the last ring for ever, so the first document is
     adopted in silence, whatever is in it. */
  fresh(doc) {
    const ringAt = stampOf(doc.ring), hushAt = stampOf(doc.hush);
    const first = !this.seen;
    this.seen = true;
    const ring = !first && ringAt !== null && (this.lastRingAt == null || ringAt > this.lastRingAt)
      ? doc.ring : null;
    const hush = !first && hushAt !== null && (this.lastHushAt == null || hushAt > this.lastHushAt);
    if (ringAt !== null) this.lastRingAt = Math.max(this.lastRingAt ?? 0, ringAt);
    if (hushAt !== null) this.lastHushAt = Math.max(this.lastHushAt ?? 0, hushAt);
    return [ring, hush];
  },

  // ---------------------------------------------------------------- wall ----
  /* The wall's sound: the recording, or one uploaded in this sheet (2026-10-18). */
  wallFile() {
    const id = this.settings().sound || 'box';
    return ((this.doc?.sounds || []).find((x) => x.id === id) || {}).file || SOUND;
  },

  playWall(times) {
    if (this.ctx.phone) return;          // a phone in a pocket is not the wall
    const n = Number.isInteger(times) && times >= 1 && times <= TIMES_MAX ? times : 1;
    this.stopWall();
    try {
      const el = (this.audio ||= new Audio());
      const file = this.wallFile();
      if (!el.src.endsWith(file)) el.src = file;
      el.volume = 1;
      el.onplaying = () => this.render();   // the sheet's Play becomes Stop
      this.left = n - 1;
      el.onended = () => {
        if (this.left-- <= 0) {
          // ...and then its text, read once (2026-10-18), if it has one.
          this.voicing = true;
          Promise.resolve(this.ctx.voice?.play('phonebox')).then(() => { this.voicing = false; this.render(); });
          this.render();
          return;
        }
        el.currentTime = 0;
        Promise.resolve(el.play()).catch(() => {});
      };
      el.currentTime = 0;
      Promise.resolve(el.play()).catch(() => {});
    } catch { /* no audio on this machine */ }
    this.render();
  },

  stopWall() {
    const el = this.audio;
    this.left = 0;
    if (this.voicing) { this.voicing = false; this.ctx.voice?.stop(); }
    if (!el) return;
    try { el.onended = null; el.pause(); el.currentTime = 0; } catch { /* gone */ }
  },

  wallPlaying() { return !!(this.audio && !this.audio.paused); },

  async wallTest() {
    try { await fetch('/api/phonebox/wall-test', { method: 'POST' }); }
    catch { /* nothing played; the button says nothing either */ }
  },

  onDoc(fn) { this.subs.push(fn); },

  changed() {
    for (const fn of this.subs) {
      try { fn(this.doc); } catch (e) { console.error('phonebox subscriber failed', e); }
    }
  },

  settings() { return (this.doc && this.doc.settings) || {}; },

  /* The phones the server will name, from the validated list in /api/config
     (phone.py public()). A phone with no companion app is listed but cannot
     be chosen: it would only ever fail. */
  phones() { return this.ctx.config.phones || []; },

  /* When the box was paused (seconds), or null while it runs. */
  paused() {
    const p = this.doc && this.doc.paused;
    return typeof p === 'number' && Number.isFinite(p) ? p : null;
  },

  /* "21:40" today, "Mon 21:40" this week, "12 Oct" before (school.js's). */
  sinceText(sec, now = new Date()) {
    const d = new Date(sec * 1000);
    if (d.toDateString() === now.toDateString()) return hhmm(sec);
    if (now - d < 6 * 86400000) return `${DAYS[d.getDay()]} ${hhmm(sec)}`;
    return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
  },

  /* ⏸ / ▶: shown at once, then sent; the answer is the whole document.
     Pausing stops the wall here at once; the server hushes the rest. */
  async setPause(on) {
    if (this.doc) {
      this.doc = { ...this.doc, paused: on ? Date.now() / 1000 : null };
      if (on) this.stopWall();
      this.changed();
      this.render();
    }
    try {
      const r = await fetch('/api/phonebox/pause', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ paused: !!on }),
      });
      const body = await r.json().catch(() => null);
      if (r.ok && body && body.settings) {
        this.doc = { ...this.doc, ...body };
        this.changed();
        this.render();
      }
    } catch { /* the next snapshot puts it right */ }
  },

  /* The tile's second line: "on · 21:30 · Alex, Sam", "paused · since
     21:40" (the card's ▶ says the rest), or "off". */
  summary() {
    const s = this.settings();
    if (!this.doc) return '';
    if (!s.enabled) return 'off';
    const p = this.paused();
    if (p !== null) return `paused · since ${this.sinceText(p)}`;
    const who = this.phones().filter((p) => (s.phones || []).includes(p.id))
      .map((p) => p.label.replace(/[’']s phone$/, ''));
    if (s.wall) who.push('the wall');
    return `on · ${s.time || ''}${who.length ? ` · ${who.join(', ')}` : ' · nobody'}`;
  },

  toggle() { this.put({ enabled: !this.settings().enabled }); },

  // ------------------------------------------------------------- server ----
  async put(patch) {
    if (this.doc) {
      this.doc = { ...this.doc, settings: { ...this.settings(), ...patch } };
      this.changed();
      this.render();
    }
    try {
      const r = await fetch('/api/phonebox/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch),
      });
      const body = await r.json().catch(() => ({}));
      if (r.ok && body.settings && this.doc) {
        this.doc = { ...this.doc, settings: body.settings };
        this.changed();
        this.render();
      }
    } catch { /* the next snapshot puts it right */ }
  },

  speaking() { return (this.doc && this.doc.speaking) || []; },

  /* Stop in the sheet: the phones' sentences, and the wall on every screen. */
  async stopAll() {
    this.stopWall();
    this.render();
    try { await fetch('/api/phonebox/stop', { method: 'POST' }); }
    catch { /* the next snapshot says whether they stopped */ }
  },

  watch() { return (this.doc && this.doc.watch) || {}; },

  async checkNow() {
    this.checkErr = '';
    this.checking = true;
    this.render();
    try {
      const r = await fetch('/api/phonebox/check', { method: 'POST' });
      if (!r.ok) {
        const body = await r.json().catch(() => ({}));
        this.checkErr = body.error || `the kitchen said ${r.status}`;
      }
    } catch {
      this.checkErr = 'the kitchen did not answer';
    }
    this.checking = false;
    this.render();
  },

  /* One phone in words: "in use", "not in use", or why there is no answer. */
  useText(x) {
    if (!x) return 'not looked at yet';
    if (x.in_use === true) return 'in use';
    if (x.in_use === false) return 'not in use';
    return x.why || 'no answer';
  },

  /* What the watch knows now, or what the last check found, one line. */
  watchLine(s) {
    const w = this.watch();
    const labels = Object.fromEntries(this.phones().map((p) => [p.id, p.label]));
    const told = (w.told || []).map((t) => `${t.label} at ${hhmm(t.at)}`);
    const parts = [];
    if (w.active) {
      const ph = Object.entries(w.phones || {}).map(([id, x]) => {
        const since = x.in_use && typeof x.since === 'number'
          ? ` for ${Math.max(0, Math.floor((Date.now() / 1000 - x.since) / 60))} min` : '';
        return `${labels[id] || id}: ${this.useText(x)}${since}`;
      });
      parts.push(`Watching until ${hhmm(w.until)}${ph.length ? ` — ${ph.join(' · ')}` : ''}.`);
    } else if (s.watch && s.enabled) {
      parts.push(`Starts with the box ${this.nextText(s.time)}, until ${s.watch_until}.`);
    }
    if (told.length) parts.push(`Told tonight: ${told.join(', ')}.`);
    return parts.join(' ');
  },

  checkLine() {
    const c = this.watch().check;
    if (this.checking || (c && c.running)) return 'Asking the phones… about 20 seconds.';
    if (!c || !Array.isArray(c.phones)) return '';
    if (!c.phones.length) return 'No phone is chosen.';
    return `At ${hhmm(c.at)}: ${c.phones.map((x) => `${x.label}: ${this.useText(x)}${
      x.in_use && typeof x.since === 'number' ? ` since ${hhmm(x.since)}` : ''}`).join(' · ')}.`;
  },

  async test() {
    this.trying = true;
    this.tryErr = '';
    this.render();
    try {
      const r = await fetch('/api/phonebox/test', { method: 'POST' });
      if (!r.ok) {
        const body = await r.json().catch(() => ({}));
        this.tryErr = body.error || `the kitchen said ${r.status}`;
      }
    } catch {
      this.tryErr = 'the kitchen did not answer';
    }
    this.trying = false;
    this.render();
  },

  /* 21:30 moved by `min` minutes, round the clock. */
  shift(time, min) {
    const [h, m] = String(time || '21:30').split(':').map(Number);
    const t = (((h * 60 + m + min) % 1440) + 1440) % 1440;
    return `${String(Math.floor(t / 60)).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`;
  },

  /* "3 times — 45 s" for the wall's whole recording */
  wallLengthText(n) {
    const s = n * WALL_CLIP_S;
    const len = s < 60 ? `${s} s` : `${Math.floor(s / 60)} min${s % 60 ? ` ${s % 60} s` : ''}`;
    return `${n} ${n === 1 ? 'time' : 'times'} — ${len}`;
  },

  /* "10 times — 1 min" */
  lengthText(n) {
    const s = (n - 1) * EVERY_S + 3;
    const len = s < 60 ? `${s} s` : `about ${Math.round(s / 60)} min`;
    return `${n} ${n === 1 ? 'time' : 'times'} — ${len}`;
  },

  /* "Sent at 21:30 to Alex's phone, Sam's phone", and what failed. */
  lastLine() {
    const last = this.doc && this.doc.last;
    if (!last || typeof last.at !== 'number') return 'Nothing sent since the kitchen last started.';
    const at = new Date(last.at * 1000);
    const when = `${String(at.getHours()).padStart(2, '0')}:${String(at.getMinutes()).padStart(2, '0')}`;
    const day = at.toDateString() === new Date().toDateString() ? 'today' : at.toLocaleDateString();
    const sent = (last.sent || []).map((p) => p.label).join(', ');
    const failed = (last.failed || []).map((p) => `${p.label} (${p.error})`).join(', ');
    return `${last.test ? 'Test' : 'Sent'} ${day} at ${when}`
      + (sent ? ` to ${sent}` : ' to nobody')
      + (failed ? `. Not sent: ${failed}` : '') + '.';
  },

  /* The phones chosen, in words: "Alex's and Sam's phones", or their
     labels as they are when a phone is not somebody's; '' for none. */
  whoText(ids) {
    const and = (xs) => (xs.length < 2 ? xs.join('') : `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`);
    const labels = this.phones().filter((p) => (ids || []).includes(p.id)).map((p) => p.label);
    if (!labels.length) return '';
    return labels.every((l) => /[’']s phone$/.test(l))
      ? `${and(labels.map((l) => l.replace(/ phone$/, '')))} ${labels.length === 1 ? 'phone' : 'phones'}`
      : and(labels);
  },

  /* The sheet header's line: "On · 21:30 · Alex's and Sam's phones and
     the wall", or "Off", and the phones speaking while they do. */
  headLine() {
    const s = this.settings();
    if (!this.doc) return '';
    const n = this.speaking().length;
    const say = n ? ` · speaking on ${n} ${n === 1 ? 'phone' : 'phones'}` : '';
    if (!s.enabled) return `<b>Off</b>${esc(say)}`;
    const p = this.paused();
    if (p !== null) return `<b>Paused</b> since ${esc(this.sinceText(p))} — nothing is sent until ▶ Play${esc(say)}`;
    const and = (xs) => (xs.length < 2 ? xs.join('') : `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`);
    const parts = [];
    const who = this.whoText(s.phones);
    if (who) parts.push(who);
    if (s.wall) parts.push('the wall');
    return `<b>On</b> · ${esc(s.time || '')} · ${esc(parts.length ? and(parts) : 'nobody')}${esc(say)}`;
  },

  /* "tonight at 21:30", or tomorrow's once today's has gone. */
  nextText(time) {
    const [h, m] = String(time || '').split(':').map(Number);
    if (!Number.isFinite(h) || !Number.isFinite(m)) return '';
    const now = new Date();
    if (h * 60 + m > now.getHours() * 60 + now.getMinutes()) return `${h >= 17 ? 'tonight' : 'today'} at ${time}`;
    return `tomorrow at ${time}`;
  },

  /* The state sentence at the top of the sheet (the settings window kit):
     what is true now and what comes next, with the master switch beside it. */
  sumCard(s) {
    const kit = this.ctx.sheetkit;
    const times = s.times || 10;
    const who = this.whoText(s.phones);
    const n = this.speaking().length;
    const now = n ? ` Speaking now on ${n} ${n === 1 ? 'phone' : 'phones'}.`
      : this.wallPlaying() ? ' Playing on the wall now.' : '';
    const ctl = kit.toggle(!!s.enabled, `data-put="enabled" data-v="${s.enabled ? 'false' : 'true'}"`);
    if (!s.enabled) {
      return kit.sum('Off — no phone is told.', {
        next: `When it is on: every evening at <b>${esc(s.time || '')}</b>${who ? ` to ${esc(who)}` : ''}.${esc(now)}`,
        ctl, cap: 'Every evening', off: true,
      });
    }
    const at = `Every evening at <b>${esc(s.time || '')}</b>`;
    // Nobody to tell — no phone chosen, the wall quiet — and nothing happens
    // at that time, so the next line says so rather than naming it.
    if (this.nobody(s)) {
      return kit.sum(`${at}, but no phone is chosen yet and the wall stays quiet.`, {
        next: `Next: <b>nothing</b>, until a phone or the wall is chosen.${esc(now)}`, ctl, cap: 'Every evening',
      });
    }
    const p = this.paused();
    return kit.sum(who
      ? `${at} to <b>${esc(who)}</b>, <b>${times} ${times === 1 ? 'time' : 'times'}</b>; ${
        s.wall ? 'the wall plays it too' : 'the wall stays quiet'}.`
      : `${at} the wall plays it; no phone is chosen yet.`, {
      next: p !== null
        ? `Paused since <b>${esc(this.sinceText(p))}</b> — nothing goes to a phone or the wall until ▶ Play.${esc(now)}`
        : `Next: <b>${esc(this.nextText(s.time))}</b>.${esc(now)}`,
      ctl, cap: 'Every evening',
    });
  },

  /* On, but nobody to tell: no phone chosen and the wall left out. */
  nobody(s) { return !this.whoText(s.phones) && !s.wall; },

  /* "Still on the phone": the settings, the words, a check and tonight. */
  watchSec(s, kit, sw, whenOn) {
    const w = this.watch();
    const after = s.watch_after || 10;
    const again = AGAIN.includes(s.watch_again) ? s.watch_again : 15;
    const off = s.watch ? '' : ' nt-off';
    const names = w.names || {};
    const name = names[(s.phones || [])[0]] || Object.values(names)[0] || 'Name';
    const words = String(w.words || '').replace('{name}', name);
    const ai = AGAIN.indexOf(again);
    const line = this.watchLine(s);
    const checkLine = this.checkLine();
    const busy = this.checking || (w.check && w.check.running);
    return kit.sec('Still on the phone', `
      <div class="ls-row">
        <span class="ls-label">Tell them if they keep using it
          <span class="db-hint">after the box time the kitchen looks at each chosen phone every
            few minutes. A phone <b>in use the whole time</b> gets a message with its owner's name.
            A quick look — the calendar, setting an alarm — is never long enough to count.</span></span>
        ${sw('watch', !!s.watch)}
      </div>
      <div class="ls-row${off}">
        <span class="ls-label">In use for
          <span class="db-hint">minutes in a row after the box time before the message goes.</span></span>
        <span class="ls-set sheet-step">
          <button class="ls-btn" data-after="-1" aria-label="fewer minutes"${after <= AFTER_MIN ? ' disabled' : ''}>−</button>
          <b class="sheet-val pb-time pb-times">${after} min</b>
          <button class="ls-btn" data-after="1" aria-label="more minutes"${after >= AFTER_MAX ? ' disabled' : ''}>+</button>
        </span>
      </div>
      <div class="ls-row${off}">
        <span class="ls-label">Again
          <span class="db-hint">while the phone stays in use. Once: one message each time it is
            picked up and kept.</span></span>
        <span class="ls-set sheet-step">
          <button class="ls-btn" data-again="-1" aria-label="sooner"${ai <= 0 ? ' disabled' : ''}>−</button>
          <b class="sheet-val pb-time pb-times">${again ? `every ${again} min` : 'once'}</b>
          <button class="ls-btn" data-again="1" aria-label="later"${ai >= AGAIN.length - 1 ? ' disabled' : ''}>+</button>
        </span>
      </div>
      <div class="ls-row${off}">
        <span class="ls-label">Until
          <span class="db-hint">the kitchen stops looking at this time.</span></span>
        <span class="ls-set sheet-step">
          <button class="ls-btn sheet-txt" data-until="-${UNTIL_STEP}" aria-label="${UNTIL_STEP} minutes earlier">−${UNTIL_STEP} min</button>
          <b class="sheet-val pb-time">${esc(s.watch_until || '')}</b>
          <button class="ls-btn sheet-txt" data-until="${UNTIL_STEP}" aria-label="${UNTIL_STEP} minutes later">+${UNTIL_STEP} min</button>
        </span>
      </div>
      <div class="ls-row${off}">
        <span class="ls-label">Say it out loud too
          <span class="db-hint">the phone also speaks the message on the alarm volume, once.</span></span>
        ${sw('watch_say', !!s.watch_say)}
      </div>
      <div class="ls-row${off}">
        <span class="ls-label">The message
          <span class="db-hint">“${esc(words)}”</span>
          ${line ? `<span class="pb-last">${esc(line)}</span>` : ''}</span>
      </div>
      <div class="ls-row">
        <span class="ls-label"><span class="db-hint sheet-lead">looks at the chosen phones once now
          and tells nobody. A phone answers only at home or on the VPN.</span>
          ${this.checkErr ? `<span class="db-warn">${esc(this.checkErr)}</span>` : ''}
          ${checkLine ? `<span class="pb-last">${esc(checkLine)}</span>` : ''}</span>
        <span class="ls-set">
          <button class="ls-btn pb-check"${busy ? ' disabled' : ''}>${busy ? 'Checking…' : 'Check the phones now'}</button>
        </span>
      </div>`, { note: s.watch ? `${whenOn || (w.active ? 'watching · ' : 'on · ')}${after} min` : 'off' });
  },

  // -------------------------------------------------------------- sheet ----
  buildSheet() {
    const el = document.createElement('div');
    el.id = 'pb-sheet';
    el.className = 'sheet';   // the settings window kit (app.css)
    el.innerHTML = `
      <header>
        <span class="sheet-icon" aria-hidden="true">📦</span>
        <div class="sheet-title">
          <h2>Phone box</h2>
          <span class="sheet-status pb-now"></span>
        </div>
        <span class="spacer"></span>
        <button class="ls-close">Close</button>
      </header>
      <div class="ls-body"></div>`;
    document.body.appendChild(el);
    this.sheet = el;
    this.bodyEl = el.querySelector('.ls-body');
    this.nowEl = el.querySelector('.pb-now');
    el.querySelector('.ls-close').onclick = () => this.close();
  },

  open() {
    this.sheet.classList.add('open');
    this.render();
  },

  close() { this.sheet.classList.remove('open'); },

  isOpen() { return !!this.sheet && this.sheet.classList.contains('open'); },

  render() {
    if (!this.isOpen()) return;
    const kit = this.ctx.sheetkit;
    const s = this.settings();
    const pick = (v, want) => (v === want ? ' on' : '');
    const chosen = new Set(s.phones || []);
    const times = s.times || 10;
    const wallTimes = s.wall_times || 3;
    const speaking = this.speaking().length;
    // On or off: one switch that says its state; a tap turns it the other way.
    const sw = (key, on) => kit.toggle(on, `data-put="${key}" data-v="${on ? 'false' : 'true'}"`);
    const paused = this.paused();
    kit.status(this.nowEl, this.headLine(), speaking || this.wallPlaying() ? 'live'
      : !s.enabled || paused !== null ? 'off' : this.nobody(s) ? 'warn' : 'ok');
    // While the box is off, a card's note says what it would do when on.
    const whenOn = s.enabled ? '' : 'when on: ';
    const nPhones = chosen.size;
    const wallOff = s.wall ? '' : ' nt-off';
    this.bodyEl.innerHTML = `
      ${this.sumCard(s)}

      ${kit.sec('Pause', `
        <div class="ls-row${paused !== null ? ' pb-paused' : ''}">
          <span class="ls-label">${paused !== null ? 'Paused' : ''}
            <span class="db-hint${paused !== null ? '' : ' sheet-lead'}">${paused !== null
              ? `since ${esc(this.sinceText(paused))}: no notification, box page or spoken line goes to a
                phone, the wall stays quiet, and nobody is told they are still on the phone — every
                evening, until ▶ Play is pressed, here or on the card. Pressed after tonight's time,
                tonight stays quiet.`
              : 'for an evening off: nothing goes to the phones or the wall — not the box, not the "still on the phone" messages — until ▶ Play is pressed again, here or on the card.'}</span></span>
          <span class="ls-set">
            <button class="ls-btn pb-pz${paused !== null ? ' on' : ''}" aria-pressed="${paused !== null}">${paused !== null
              ? '▶ Play' : '⏸ Pause'}</button>
          </span>
        </div>`, { note: paused !== null ? `paused since ${this.sinceText(paused)}` : '' })}

      ${kit.sec('Every evening', `
        <div class="ls-row">
          <span class="ls-label">Time
            <span class="db-hint">at this time each chosen phone gets a notification that it is
              time to go in the box, the box page opens on it, and it says so out loud on the alarm
              volume — through silent mode and Do not disturb.</span></span>
          <span class="ls-set sheet-step">
            <button class="ls-btn sheet-txt" data-shift="-60" aria-label="an hour earlier">−1 h</button>
            <button class="ls-btn sheet-txt" data-shift="-${STEP_MIN}" aria-label="${STEP_MIN} minutes earlier">−${STEP_MIN} min</button>
            <b class="sheet-val pb-time">${esc(s.time || '')}</b>
            <button class="ls-btn sheet-txt" data-shift="${STEP_MIN}" aria-label="${STEP_MIN} minutes later">+${STEP_MIN} min</button>
            <button class="ls-btn sheet-txt" data-shift="60" aria-label="an hour later">+1 h</button>
          </span>
        </div>`, { note: s.enabled ? (s.time || '') : 'off' })}

      ${kit.sec('Phones', `
        <div class="ls-row">
          <span class="ls-label"><span class="db-hint sheet-lead">tap a phone to take it in or out.
            A phone without the Home Assistant app cannot be chosen yet.</span></span>
          <span class="ls-set sheet-chips">${this.phones().map((p) => `
            <button class="ls-btn${chosen.has(p.id) ? ' on' : ''}${p.ready ? '' : ' sheet-na'}" data-phone="${esc(p.id)}"
                    aria-pressed="${chosen.has(p.id)}"
                    ${p.ready ? '' : 'disabled'}>${esc(p.emoji || '📱')} ${esc(p.label)}</button>`).join('')}
          </span>
        </div>
        <div class="ls-row">
          <span class="ls-label">Plays
            <span class="db-hint">how many times the phone says it, 6 seconds apart.
              <b>It's in the box</b> on the notification, or swiping it away, stops
              that phone. The recording plays this many times too, when Play is
              tapped on the box page.</span></span>
          <span class="ls-set sheet-step">
            <button class="ls-btn" data-times="-1" aria-label="fewer"${times <= 1 ? ' disabled' : ''}>−</button>
            <b class="sheet-val pb-time pb-times">${esc(this.lengthText(times))}</b>
            <button class="ls-btn" data-times="1" aria-label="more"${times >= TIMES_MAX ? ' disabled' : ''}>+</button>
          </span>
        </div>`, { note: `${whenOn}${nPhones ? `${nPhones} ${nPhones === 1 ? 'phone' : 'phones'}` : 'no phone'} · ${times} ${times === 1 ? 'time' : 'times'}` })}

      ${this.watchSec(s, kit, sw, whenOn)}

      ${kit.sec('On the wall too', `
        <div class="ls-row">
          <span class="ls-label"><span class="db-hint sheet-lead">at the same time this screen plays
            the recording itself — the whole of it, not the phones' cut — on full volume. A
            sleeping screen is woken a minute before. Quiet hours do not apply.</span></span>
          ${sw('wall', !!s.wall)}
        </div>
        <div class="ls-row${wallOff}">
          <span class="ls-label">What the wall plays
            <span class="db-hint">the recording, or a sound file of your own (＋ Upload; ✕ deletes
              one) — the phones keep their own sentence. 🗣 reads a text after it.</span></span>
          <div class="sheet-ctl">
            <span class="ls-set sheet-seg">${(this.doc?.sounds || []).map((x) => `
              <button class="ls-btn${pick(s.sound || 'box', x.id)}" data-put="sound" data-v='${esc(JSON.stringify(x.id))}'
                aria-pressed="${(s.sound || 'box') === x.id}">${esc(x.label)}</button>${
                x.uploaded ? this.ctx.soundlib?.delBtn(x.id, { label: x.label }) || '' : ''}`).join('')}
            </span>
            <span class="sheet-acts">
              ${this.ctx.soundlib?.uploadBtn('phonebox') || ''}
              ${this.ctx.voice?.chip('phonebox') || ''}
            </span>
          </div>
          ${this.ctx.voice?.editor('phonebox', { hint: 'read aloud on the wall once after the sound' }) || ''}
        </div>
        <div class="ls-row${wallOff}">
          <span class="ls-label">The wall plays it</span>
          <div class="sheet-ctl sheet-across">
            <span class="ls-set sheet-step">
              <button class="ls-btn" data-wtimes="-1" aria-label="fewer"${wallTimes <= 1 ? ' disabled' : ''}>−</button>
              <b class="sheet-val pb-time pb-times">${esc(this.wallLengthText(wallTimes))}</b>
              <button class="ls-btn" data-wtimes="1" aria-label="more"${wallTimes >= TIMES_MAX ? ' disabled' : ''}>+</button>
            </span>
            ${this.wallPlaying()
              ? '<button class="ls-btn sheet-danger on pb-wstop">Stop</button>'
              : '<button class="ls-btn pb-wtry">▶ Play on the wall now</button>'}
          </div>
        </div>`, { note: s.wall ? `${whenOn || 'on · '}${wallTimes} ${wallTimes === 1 ? 'time' : 'times'}` : 'off' })}

      ${kit.sec('Try it', `
        <div class="ls-row">
          <span class="ls-label"><span class="db-hint sheet-lead">sends it to the chosen phones now,
            whether it is on or off. Each phone needs Home Assistant allowed to <b>Appear on top</b>
            (Settings → Apps → Home Assistant) for the box page to open.</span>
            ${this.tryErr ? `<span class="db-warn">${esc(this.tryErr)}</span>` : ''}
            <span class="pb-last">${esc(this.lastLine())}</span></span>
          <span class="ls-set">
            ${speaking
              ? `<button class="ls-btn sheet-danger on pb-stop">Stop — ${esc(speaking)}
                   ${speaking === 1 ? 'phone' : 'phones'} speaking</button>`
              : `<button class="ls-btn sheet-primary pb-try"${this.trying ? ' disabled' : ''}>
                   ${this.trying ? 'Sending…' : 'Send it now'}</button>`}
          </span>
        </div>`)}`;

    this.bodyEl.querySelectorAll('[data-put]').forEach((btn) => {
      btn.onclick = () => this.put({ [btn.dataset.put]: JSON.parse(btn.dataset.v) });
    });
    // An upload is the wall's sound at once.
    this.ctx.soundlib?.wire(this.bodyEl, { onUploaded: (r) => this.put({ sound: r.id }) });
    this.ctx.voice?.wire(this.bodyEl, () => this.render());
    this.bodyEl.querySelectorAll('[data-shift]').forEach((btn) => {
      btn.onclick = () => this.put({ time: this.shift(this.settings().time, Number(btn.dataset.shift)) });
    });
    this.bodyEl.querySelectorAll('[data-times]').forEach((btn) => {
      btn.onclick = () => {
        const n = (this.settings().times || 10) + Number(btn.dataset.times);
        if (n >= 1 && n <= TIMES_MAX) this.put({ times: n });
      };
    });
    this.bodyEl.querySelectorAll('[data-wtimes]').forEach((btn) => {
      btn.onclick = () => {
        const n = (this.settings().wall_times || 3) + Number(btn.dataset.wtimes);
        if (n >= 1 && n <= TIMES_MAX) this.put({ wall_times: n });
      };
    });
    this.bodyEl.querySelectorAll('[data-after]').forEach((btn) => {
      btn.onclick = () => {
        const n = (this.settings().watch_after || 10) + Number(btn.dataset.after);
        if (n >= AFTER_MIN && n <= AFTER_MAX) this.put({ watch_after: n });
      };
    });
    this.bodyEl.querySelectorAll('[data-again]').forEach((btn) => {
      btn.onclick = () => {
        const i = AGAIN.indexOf(this.settings().watch_again ?? 15) + Number(btn.dataset.again);
        if (i >= 0 && i < AGAIN.length) this.put({ watch_again: AGAIN[i] });
      };
    });
    this.bodyEl.querySelectorAll('[data-until]').forEach((btn) => {
      btn.onclick = () => this.put({ watch_until: this.shift(this.settings().watch_until || '23:00',
        Number(btn.dataset.until)) });
    });
    const pz = this.bodyEl.querySelector('.pb-pz');
    if (pz) pz.onclick = () => this.setPause(this.paused() === null);
    const check = this.bodyEl.querySelector('.pb-check');
    if (check) check.onclick = () => this.checkNow();
    const wtry = this.bodyEl.querySelector('.pb-wtry');
    if (wtry) wtry.onclick = () => this.wallTest();
    const wstop = this.bodyEl.querySelector('.pb-wstop');
    if (wstop) wstop.onclick = () => this.stopAll();
    this.bodyEl.querySelectorAll('[data-phone]').forEach((btn) => {
      btn.onclick = () => {
        const id = btn.dataset.phone;
        const now = new Set(this.settings().phones || []);
        if (now.has(id)) now.delete(id); else now.add(id);
        // In the config's order, so the tile's line reads the same every time.
        this.put({ phones: this.phones().map((p) => p.id).filter((x) => now.has(x)) });
      };
    });
    const tryBtn = this.bodyEl.querySelector('.pb-try');
    if (tryBtn) tryBtn.onclick = () => this.test();
    const stopBtn = this.bodyEl.querySelector('.pb-stop');
    if (stopBtn) stopBtn.onclick = () => this.stopAll();
    this.ctx.sheetkit.sync(this.sheet);
  },
};
