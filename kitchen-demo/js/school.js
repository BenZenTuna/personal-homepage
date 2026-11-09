/* Mia's school time alert — its document, its tile's words, its sheet, and
   the song itself.

   At the set time on the chosen week days (07:57, Monday to Friday) the
   server marks a ring (backend/app/school.py) and every screen showing the
   dashboard plays it: the songs it names, in order, `times` times over. A
   ring plays once per page, only while it is at most a minute old, and not
   after a Stop that came later (`hush`) — the doorbell's minute (doorbell.js
   FRESH_S): a wall woken late reloads after the ring it was woken for and
   still plays it, while a ring missed during a long disconnect is not played
   late. A phone's page never plays it, but its sheet shows Stop while the
   wall plays.

   The songs are Alex's five (frontend/sounds/school/), and they are for
   this alert only: the doorbell's and the hour's list of sounds (sound.js)
   does not offer them. Choosing one in the sheet also plays it, on that
   screen only, because choosing a song and hearing it are one decision.

   The card is drawn by the House panel on Automation (ha.js,
   buildAuto), for the doorbell's reason: the panel owns the grid, this owns
   the thing. It is on the context as ctx.school.

   Since 2026-10-14 it plays **before school starts** by default: each
   school day's start on the school board, less the minutes chosen (23:
   08:20 → 07:57, a Wednesday's 08:00 → 07:37), and not at all on a day off
   — a lov, a study day, the summer break, a röd dag. The server works the
   mornings out (school.py `plan`, the coming three weeks); this shows them
   and says why a morning is silent. "At a fixed time" is the old way.

   And a pause (the same day, "as light automations has"): ⏸ on the card
   (ha.js) and in the sheet holds every alert until ▶ Play — a sick day, a
   holiday the board does not know. The server keeps it (`paused`, since
   when), so every screen shows it and a reload does not lose it. */

const esc = (s) => String(s ?? '').replace(/[&<>"]/g,
  (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

const SONG_S = 30;      // school.py SONG_S: every song is thirty seconds
const TIMES_MAX = 5;    // school.py TIMES_MAX
const FRESH_S = 60;     // doorbell.js FRESH_S: a ring this young still plays on a page just opened
const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];   // Python's weekday(): Monday 0
const DAY_NAMES = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
const BEFORE_MAX = 120;     // school.py BEFORE_MAX
const PLAN_SHOWN = 10;      // the coming mornings the sheet lists, a break as one

const stampOf = (x) => {
  const at = x && x.at;
  return typeof at === 'number' && Number.isFinite(at) ? at : null;
};

/* The chosen week days in a few words: "Mon–Fri", "every day", "Sat–Sun",
   "Mon, Wed, Fri", "no days". A run of three or more is a range. */
export function daysText(days) {
  const on = [...new Set((days || []).filter((d) => Number.isInteger(d) && d >= 0 && d <= 6))]
    .sort((a, b) => a - b);
  if (!on.length) return 'no days';
  if (on.length === 7) return 'every day';
  const runs = [];
  for (const d of on) {
    const last = runs[runs.length - 1];
    if (last && d === last[1] + 1) last[1] = d; else runs.push([d, d]);
  }
  return runs.map(([a, b]) => (a === b ? DAYS[a] : b - a === 1 ? `${DAYS[a]}, ${DAYS[b]}`
    : `${DAYS[a]}–${DAYS[b]}`)).join(', ');
}

/* The week days for the tile's one line: a single run in words ("Mon–Fri",
   "Sat, Sun", "every day"), anything scattered as a count ("3 days") — the
   sheet says which. Measured: "Mon, Wed, Fri" put the song off the tile. */
export function daysShort(days) {
  const text = daysText(days);
  return text.includes(', ') && !/^\w{3}, \w{3}$/.test(text) ? `${new Set(days).size} days` : text;
}

/* A plan entry's day as a Date at midnight. */
const dayOf = (iso) => {
  const [y, m, d] = String(iso).split('-').map(Number);
  return new Date(y, m - 1, d);
};

/* When it next plays, from `now` (a Date): {date, today, tomorrow, entry},
   or null when it is off or nothing is coming. From the server's `plan`
   (school.py: the coming mornings, before school or at the fixed time),
   or — from a server older than the plan — by the fixed time on the chosen
   days. The kitchen's own clock and the browser's are one zone. */
export function nextRing(s, now, plan = null) {
  if (!s || !s.enabled) return null;
  if (Array.isArray(plan)) {
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    for (const e of plan) {
      if (!e || !e.at) continue;
      const [hh, mm] = String(e.at).split(':').map(Number);
      const d = dayOf(e.date);
      d.setHours(hh, mm);
      if (d <= now) continue;
      const k = Math.round((dayOf(e.date) - today) / 86400000);
      return { date: d, today: k === 0, tomorrow: k === 1, entry: e };
    }
    return null;
  }
  if (!Array.isArray(s.days) || !s.days.length) return null;
  const [hh, mm] = String(s.time || '07:57').split(':').map(Number);
  for (let k = 0; k < 8; k++) {
    const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() + k, hh, mm);
    const wd = (d.getDay() + 6) % 7;            // Monday 0, as the server counts
    if (s.days.includes(wd) && d > now) return { date: d, today: k === 0, tomorrow: k === 1 };
  }
  return null;
}

export default {
  doc: null,
  subs: [],
  seen: false,          // has this page had a document yet
  lastRingAt: null,     // the newest ring this page knows about
  lastHushAt: null,     // ...and the newest Stop
  audio: null,
  queue: [],            // files still to play of the current ring
  previewing: null,     // the song id playing as a choice in the sheet

  init(ctx) {
    this.ctx = ctx;
    this.buildSheet();
    // Its uploaded songs come in its document; its text (2026-10-18) redraws the sheet.
    ctx.voice?.onChange(() => this.render());
    ctx.bus.on('school', (doc) => {
      if (!doc || typeof doc !== 'object') return;
      const [ring, hush] = this.fresh(doc);
      this.doc = doc;
      if (hush) this.stopPlaying();
      if (ring) this.playRing(ring);
      this.changed();
      this.render();
    });
  },

  /* Which of this document's ring and Stop this page has not acted on yet.
     The snapshot replays the last ring for ever: a ring plays only if it is
     newer than any this page has seen, at most a minute old by this clock
     (the server's and the wall's agree to the second) — first document or
     not — and no Stop came after it. `now` in seconds, for the test. */
  fresh(doc, now = Date.now() / 1000) {
    const ringAt = stampOf(doc.ring), hushAt = stampOf(doc.hush);
    const first = !this.seen;
    this.seen = true;
    const young = ringAt !== null && Math.abs(now - ringAt) <= FRESH_S;
    const stopped = ringAt !== null && hushAt !== null && hushAt >= ringAt;
    const ring = young && !stopped && (this.lastRingAt == null || ringAt > this.lastRingAt)
      ? doc.ring : null;
    const hush = !first && hushAt !== null && (this.lastHushAt == null || hushAt > this.lastHushAt);
    if (ringAt !== null) this.lastRingAt = Math.max(this.lastRingAt ?? 0, ringAt);
    if (hushAt !== null) this.lastHushAt = Math.max(this.lastHushAt ?? 0, hushAt);
    return [ring, hush];
  },

  // ------------------------------------------------------------- playing --
  songs() { return (this.doc && Array.isArray(this.doc.songs) && this.doc.songs) || []; },

  song(id) { return this.songs().find((s) => s.id === id) || null; },

  /* The ring's songs in order, `times` times over, one after another. */
  playRing(ring) {
    if (this.ctx.phone) return;          // a phone in a pocket is not the wall
    const n = Number.isInteger(ring.times) && ring.times >= 1 && ring.times <= TIMES_MAX ? ring.times : 1;
    const files = (Array.isArray(ring.songs) ? ring.songs : []).map((id) => this.song(id)?.file)
      .filter(Boolean);
    if (!files.length) return;
    // ...and then its text, read aloud once (2026-10-18), if it has one.
    this.play([].concat(...Array.from({ length: n }, () => files)), null, () => this.speak());
  },

  async speak() {
    this.voicing = true;
    await this.ctx.voice?.play('school');
    this.voicing = false;
  },

  play(files, previewing, after = null) {
    this.stopPlaying();
    this.queue = files.slice(1);
    this.previewing = previewing;
    this.after = after;
    try {
      const el = (this.audio ||= new Audio());
      el.volume = 1;
      el.onplaying = () => this.render();   // the sheet's Play becomes Stop
      el.onended = () => {
        const next = this.queue.shift();
        if (!next) {
          this.previewing = null;
          const after = this.after;
          this.after = null;
          if (after) after();
          this.render();
          return;
        }
        el.src = next;
        Promise.resolve(el.play()).catch(() => {});
      };
      el.src = files[0];
      Promise.resolve(el.play()).catch(() => {});
    } catch { /* no audio on this machine */ }
    this.render();
  },

  stopPlaying() {
    const el = this.audio;
    this.queue = [];
    this.previewing = null;
    this.after = null;
    if (this.voicing) { this.voicing = false; this.ctx.voice?.stop(); }
    if (!el) return;
    try { el.onended = null; el.pause(); el.currentTime = 0; } catch { /* gone */ }
  },

  playing() { return !!(this.audio && !this.audio.paused && !this.audio.ended); },

  /* The wall is playing a ring, by the document: not stopped since, and not
     over by its own length. So a screen that is not playing it — a phone, or
     a laptop whose browser held the sound back — still shows Stop. */
  ringLive(now = Date.now() / 1000) {
    const r = this.doc && this.doc.ring;
    const at = stampOf(r), hushAt = stampOf(this.doc && this.doc.hush);
    if (at === null || (hushAt !== null && hushAt >= at)) return 0;
    const n = (Array.isArray(r.songs) ? r.songs.length : 1)
      * (Number.isInteger(r.times) ? r.times : 1);
    const ends = at + n * SONG_S;
    return now < ends ? ends : 0;
  },

  /* A song chosen in the sheet: chosen, and heard here — tapped again while
     it plays, it stops. */
  choose(id) {
    if (this.previewing === id && this.playing()) {
      this.stopPlaying();
      this.render();
      return;
    }
    this.put({ song: id });
    const s = this.song(id);
    if (s) this.play([s.file], id);
  },

  // ------------------------------------------------------------ the tile --
  onDoc(fn) { this.subs.push(fn); },

  changed() {
    for (const fn of this.subs) {
      try { fn(this.doc); } catch (e) { console.error('school subscriber failed', e); }
    }
  },

  settings() { return (this.doc && this.doc.settings) || {}; },

  /* When the alerts were paused (seconds), or null while they play. */
  paused() {
    const p = this.doc && this.doc.paused;
    return typeof p === 'number' && Number.isFinite(p) ? p : null;
  },

  /* "08:40" today, "Mon 08:40" this week, "12 Oct" before. */
  sinceText(sec, now = new Date()) {
    const d = new Date(sec * 1000);
    const t = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
    if (d.toDateString() === now.toDateString()) return t;
    if (now - d < 6 * 86400000) return `${DAYS[(d.getDay() + 6) % 7]} ${t}`;
    return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
  },

  /* ⏸ / ▶: shown at once, then sent; the answer is the whole document. */
  async setPause(on) {
    if (this.doc) {
      this.doc = { ...this.doc, paused: on ? Date.now() / 1000 : null };
      if (on) this.stopPlaying();
      this.changed();
      this.render();
    }
    try {
      const r = await fetch('/api/school/pause', {
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

  /* Which song, in a word or two: "Song 2", "all five", or the next of "a
     different one each day". */
  songText(s) {
    if (s.song === 'all') return `all ${this.songs().length || 5}`;
    if (s.song === 'rotate') return `next ${this.song(this.doc?.next)?.label || 'song'}`;
    return this.song(s.song)?.label || '';
  },

  /* The tile's second line: before school "on · 23 min before · Thu 07:57",
     at a fixed time "on · 07:57 · Mon–Fri · next Song 2", "paused · since
     08:40" (the card's ▶ says the rest), or "off". */
  summary() {
    const s = this.settings();
    if (!this.doc) return '';
    if (!s.enabled) return 'off';
    const p = this.paused();
    if (p !== null) return `paused · since ${this.sinceText(p)}`;
    if (s.mode === 'time' || !Array.isArray(this.doc.plan)) {
      return `on · ${s.time || ''} · ${daysShort(s.days)} · ${this.songText(s)}`;
    }
    const nx = nextRing(s, new Date(), this.doc.plan);
    const when = !nx ? 'none coming' : nx.today ? `today ${nx.entry.at}` : nx.tomorrow ? `tomorrow ${nx.entry.at}`
      : `${DAYS[(nx.date.getDay() + 6) % 7]} ${nx.entry.at}`;
    return `on · ${s.before_min ?? 23} min before · ${when}`;
  },

  toggle() { this.put({ enabled: !this.settings().enabled }); },

  // -------------------------------------------------------------- server --
  async put(patch) {
    if (this.doc) {
      this.doc = { ...this.doc, settings: { ...this.settings(), ...patch } };
      this.changed();
      this.render();
    }
    try {
      const r = await fetch('/api/school/settings', {
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

  async wallTest() {
    try { await fetch('/api/school/test', { method: 'POST' }); }
    catch { /* nothing played; the button says nothing either */ }
  },

  /* Stop in the sheet: this screen at once, and every screen through the server. */
  async stopAll() {
    this.stopPlaying();
    this.render();
    try { await fetch('/api/school/stop', { method: 'POST' }); }
    catch { /* the next snapshot says whether they stopped */ }
  },

  /* 07:57 moved by `min` minutes, round the clock. */
  shift(time, min) {
    const [h, m] = String(time || '07:57').split(':').map(Number);
    const t = (((h * 60 + m + min) % 1440) + 1440) % 1440;
    return `${String(Math.floor(t / 60)).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`;
  },

  /* "1 time — 30 s", "2 times — 1 min" */
  lengthText(n, songs) {
    const s = n * songs * SONG_S;
    const len = s < 60 ? `${s} s` : `${Math.floor(s / 60)} min${s % 60 ? ` ${s % 60} s` : ''}`;
    return `${n} ${n === 1 ? 'time' : 'times'} — ${len}`;
  },

  /* The sheet's header: when it next plays, and for which start. */
  nextLine() {
    const s = this.settings();
    if (!s.enabled) return 'switched off';
    const p = this.paused();
    if (p !== null) return `paused since ${this.sinceText(p)} — nothing plays until ▶ Play`;
    const nx = nextRing(s, new Date(), this.doc?.plan);
    if (!nx) return s.mode === 'time' ? 'no days chosen' : 'no school day in the next three weeks';
    const when = nx.today ? 'today' : nx.tomorrow ? 'tomorrow' : DAY_NAMES[(nx.date.getDay() + 6) % 7];
    const at = nx.entry?.at || s.time;
    return `next: ${when} at ${at}${nx.entry?.start ? ` (school ${nx.entry.start})` : ''}`;
  },

  /* The coming mornings as lines: "Thu 15 Oct · 07:57 · school 08:20", a
     break as one line ("26–30 Oct · Höstlov — no alert"), a weekend inside
     it included. From the server's plan; [] from a server without one. */
  planLines(plan = this.doc?.plan, max = PLAN_SHOWN) {
    if (!Array.isArray(plan)) return [];
    const day = (iso) => dayOf(iso).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });
    const span = (a, b) => {
      const x = dayOf(a), y = dayOf(b);
      if (a === b) return day(a);
      const mon = (d) => d.toLocaleDateString('en-GB', { month: 'short' });
      return x.getMonth() === y.getMonth() ? `${x.getDate()}–${y.getDate()} ${mon(y)}`
        : `${x.getDate()} ${mon(x)} – ${y.getDate()} ${mon(y)}`;
    };
    const out = [];
    for (const e of plan) {
      const last = out[out.length - 1];
      const off = !e.at && e.why && e.why !== 'not chosen';
      // Rounded: the weekend the clocks go back is an hour longer, and a
      // break running Friday to Monday over it is still one break.
      if (off && last && last.off && last.why === e.why
          && Math.round((dayOf(e.date) - dayOf(last.to)) / 86400000) <= 3) {
        last.to = e.date;
        continue;
      }
      if (out.length >= max) break;
      out.push({ ...e, off, to: e.date });
    }
    return out.map((e) => {
      if (e.off) return { cls: 'off', when: span(e.date, e.to), text: `${e.why} — no alert` };
      if (!e.at) return { cls: 'skip', when: day(e.date), text: `school ${e.start} — not a chosen day` };
      if (e.why === 'fixed') return { cls: '', when: day(e.date), text: `${e.at} — the fixed time: no school week on the board` };
      if (!e.start) return { cls: '', when: day(e.date), text: e.at };
      return { cls: e.changed ? 'moved' : '', when: day(e.date),
               text: `${e.at} · school ${e.start}${e.changed ? ` (${e.changed})` : ''}` };
    });
  },

  /* "Played today at 07:57: Song 2", and whether it was a test. */
  lastLine() {
    const last = this.doc && this.doc.last;
    if (!last || typeof last.at !== 'number') return 'Not played since the kitchen last started.';
    const at = new Date(last.at * 1000);
    const when = `${String(at.getHours()).padStart(2, '0')}:${String(at.getMinutes()).padStart(2, '0')}`;
    const day = at.toDateString() === new Date().toDateString() ? 'today' : at.toLocaleDateString();
    const names = (last.songs || []).map((id) => this.song(id)?.label || id).join(', ');
    return `${last.test ? 'Tried' : 'Played'} ${day} at ${when}${names ? `: ${names}` : ''}.`;
  },

  // --------------------------------------------------------------- sheet --
  buildSheet() {
    const el = document.createElement('div');
    el.id = 'sc-sheet';
    el.className = 'sheet';   // the settings window kit (app.css)
    el.innerHTML = `
      <header>
        <span class="sheet-icon" aria-hidden="true">🎒</span>
        <div class="sheet-title">
          <h2>Mia's school time alert</h2>
          <span class="sheet-status sc-now"></span>
        </div>
        <span class="spacer"></span>
        <button class="ls-close">Close</button>
      </header>
      <div class="ls-body"></div>`;
    document.body.appendChild(el);
    this.sheet = el;
    this.bodyEl = el.querySelector('.ls-body');
    this.nowEl = el.querySelector('.sc-now');
    el.querySelector('.ls-close').onclick = () => this.close();
  },

  open() {
    if (!this.doc) return;
    this.sheet.classList.add('open');
    this.render();
  },

  close() {
    // A song chosen and still playing as a choice stops with the sheet.
    if (this.previewing) this.stopPlaying();
    this.sheet.classList.remove('open');
  },

  isOpen() { return !!this.sheet && this.sheet.classList.contains('open'); },

  /* The header's line (the settings window kit): "On · next: tomorrow at
     07:57 (school 08:20)", "Paused since 06:40 — …", "Off" — and its tone:
     playing now is live, whatever the switch (Try it plays while off or
     paused; switching off or pausing stops a real ring), no day chosen
     wants somebody, off or paused is off. */
  headLine(live) {
    const line = this.nextLine();
    const p = this.paused();
    if (live) {
      if (!this.settings().enabled) return '<b>Playing now</b> · tried while off';
      if (p !== null) return `<b>Playing now</b> · tried while paused since ${esc(this.sinceText(p))}`;
      return `<b>Playing now</b> · ${esc(line)}`;
    }
    if (!this.settings().enabled) return '<b>Off</b>';
    if (p !== null) return `<b>Paused</b>${esc(line.replace(/^paused/, ''))}`;
    return `<b>On</b> · ${esc(line)}`;
  },

  headTone(live) {
    const s = this.settings();
    if (live) return 'live';
    if (!s.enabled || this.paused() !== null) return 'off';
    return (s.days || []).length ? 'ok' : 'warn';
  },

  /* Which song, as the state sentence says it: "a different song each day",
     "all five songs in a row", or the song's name — and how many times. */
  songWords(s) {
    const times = s.times || 1;
    const what = s.song === 'rotate' ? 'a different song each day'
      : s.song === 'all' ? `all <b>${this.songs().length}</b> songs in a row`
        : `<b>${esc(this.song(s.song)?.label || s.song || '')}</b>`;
    return `${what}${times > 1 ? `, played <b>${times} times</b>` : ''}`;
  },

  /* The state sentence at the top of the sheet (the settings window kit):
     when it plays, and what comes next, with the master switch beside it. */
  sumCard(s, live) {
    const kit = this.ctx.sheetkit;
    const ctl = kit.toggle(!!s.enabled, `data-put="enabled" data-v="${s.enabled ? 'false' : 'true'}"`);
    const cap = 'School time alert';
    const before = Number.isInteger(s.before_min) ? s.before_min : 23;
    const days = esc(daysText(s.days));
    const when = s.mode !== 'time'
      ? `school mornings <b>${days}</b>, <b>${before} min</b> before school starts`
      : `at <b>${esc(s.time || '')}</b> on <b>${days}</b>, school or not`;
    // A Try it playing now: a line of its own, not part of what it would do.
    const playing = live ? '<span class="sc-sumlive">Playing on the wall now.</span>' : '';
    if (!s.enabled) {
      const would = (s.days || []).length ? when : 'no day is chosen yet';
      return kit.sum('Off — no alert plays.', { next: `When it is on: ${would}.${playing}`, ctl, cap, off: true });
    }
    if (!(s.days || []).length) {
      return kit.sum('On, but no day is chosen: it never plays.', {
        next: `Next: <b>nothing</b>, until a day is chosen.${playing}`, ctl, cap,
      });
    }
    const says = `${when.charAt(0).toUpperCase()}${when.slice(1)}: ${this.songWords(s)}.`;
    const line = this.nextLine();
    const p = this.paused();
    const next = p !== null
      ? `Paused since <b>${esc(this.sinceText(p))}</b> — nothing plays until ▶ Play.`
      : line.startsWith('next: ') ? `Next: <b>${esc(line.slice(6))}</b>.` : `Next: <b>nothing</b> — ${esc(line)}.`;
    return kit.sum(says, { next: `${next}${playing}`, ctl, cap });
  },

  /* Each card's live note: beside its heading and under its name on the
     rail. While the alert is off, a note of what a card does says what it
     would do — "when on: …" — or "off". */
  notes(s, live) {
    const whenOn = s.enabled ? '' : 'when on: ';
    const before = Number.isInteger(s.before_min) ? s.before_min : 23;
    const times = s.times || 1;
    const p = this.paused();
    const nx = nextRing(s, new Date(), this.doc?.plan);
    const day = !nx ? '' : nx.today ? 'today' : nx.tomorrow ? 'tomorrow' : DAYS[(nx.date.getDay() + 6) % 7];
    const song = s.song === 'rotate' ? `a different one each day${this.song(this.doc?.next) ? ` · next ${
      this.song(this.doc.next).label}` : ''}` : s.song === 'all' ? `all ${this.songs().length} in a row`
      : this.song(s.song)?.label || '';
    return {
      pause: p !== null ? `paused since ${this.sinceText(p)}` : '',
      mornings: !s.enabled ? 'off' : p !== null ? 'paused: none plays'
        : nx ? `next ${day} ${nx.entry?.at || s.time}` : 'none coming',
      when: `${whenOn}${s.mode !== 'time' ? `${before} min before school` : s.time || ''} · ${daysText(s.days)}`,
      song: `${whenOn}${song} · ${times} ${times === 1 ? 'time' : 'times'}`,
      test: live ? 'playing now' : '',
    };
  },

  render() {
    if (!this.isOpen() || !this.doc) return;
    const kit = this.ctx.sheetkit;
    const s = this.settings();
    const pick = (v, want) => (v === want ? ' on' : '');
    const days = new Set(s.days || []);
    const times = s.times || 1;
    const count = s.song === 'all' ? this.songs().length : 1;
    const nextLabel = this.song(this.doc.next)?.label || '';
    const school = s.mode !== 'time';
    const before = Number.isInteger(s.before_min) ? s.before_min : 23;
    const paused = this.paused();
    const lines = this.planLines();
    const playing = this.playing();
    // Stop while the wall plays, on this screen or by the document; and the
    // sheet drawn again when that ring is over, so Stop turns back into Play.
    const live = this.ringLive();
    const showStop = (playing && !this.previewing) || !!live;
    clearTimeout(this._liveT);
    if (live) this._liveT = setTimeout(() => this.render(), Math.max(1000, (live - Date.now() / 1000) * 1000 + 500));
    kit.status(this.nowEl, this.headLine(showStop), this.headTone(showStop));
    const n = this.notes(s, showStop);
    // − and + by minutes (and hours, at a fixed time): one joined stepper, the
    // value in its well; the ends disabled.
    const step = (attr, v, text, label, off = false) => `<button class="ls-btn sheet-txt" ${attr}="${v}"
      aria-label="${label}"${off ? ' disabled' : ''}>${text}</button>`;
    // The cards in the order they are used: Pause (what you do now), the
    // settings (When, Song), then the mornings those give, then Try it. The
    // mornings are listed whenever the server has them — held (dimmed) while
    // the alert is off or paused — so the master switch never adds or takes
    // away a card (and with it the rail).
    this.bodyEl.innerHTML = `
      ${this.sumCard(s, showStop)}

      ${kit.sec('Pause', `
        <div class="ls-row${paused !== null ? ' sc-paused' : ''}">
          <span class="ls-label">${paused !== null ? 'Paused' : ''}
            <span class="db-hint${paused !== null ? '' : ' sheet-lead'}">${paused !== null
              ? `since ${esc(this.sinceText(paused))}: no alert plays, on any morning, until ▶ Play is
                pressed — here or on the card. Pressed after a morning's time, that morning stays quiet.`
              : 'for a sick day or a day off the school board does not know: no alert plays until ▶ Play is pressed again — here or on the card.'}</span></span>
          <span class="ls-set">
            <button class="ls-btn sc-pz${paused !== null ? ' on' : ''}" aria-pressed="${paused !== null}">${paused !== null
              ? '▶ Play' : '⏸ Pause'}</button>
          </span>
        </div>`, { note: n.pause })}

      ${kit.sec('When', `
        <p class="sheet-note">On school mornings the wall plays one of Mia's songs — every screen
          showing the dashboard does, phones never. A sleeping wall is woken a minute before. Quiet
          hours do not apply.</p>
        <div class="ls-row">
          <span class="ls-label"><span class="db-hint sheet-lead">${school
            ? `before school starts: each school day's start as the school board has it — the
              regular week, and the days the school agent reads from the letters with another
              start — and never on a day off: a lov, a study day, the summer break, a röd dag.
              With no school week on the board it plays at ${esc(s.time || '07:57')}.`
            : 'at a fixed time on the chosen days, school or not.'}</span></span>
          <span class="ls-set sheet-seg">
            <button class="ls-btn sc-mode${pick(school, true)}" data-put="mode" data-v='"school"'
              aria-pressed="${school}">Before school starts</button>
            <button class="ls-btn sc-mode${pick(school, false)}" data-put="mode" data-v='"time"'
              aria-pressed="${!school}">At a fixed time</button>
          </span>
        </div>

        ${school ? `<div class="ls-row">
          <span class="ls-label">Before school
            <span class="db-hint">how long before the school day starts: ${before} minutes before 08:20
              is ${esc(this.shift('08:20', -before))}, before 08:00 ${esc(this.shift('08:00', -before))}.</span></span>
          <span class="ls-set sheet-step">
            ${step('data-before', -5, '−5 min', '5 minutes less', before <= 0)}
            ${step('data-before', -1, '−1 min', 'a minute less', before <= 0)}
            <b class="sheet-val pb-time pb-times">${before} min</b>
            ${step('data-before', 1, '+1 min', 'a minute more', before >= BEFORE_MAX)}
            ${step('data-before', 5, '+5 min', '5 minutes more', before >= BEFORE_MAX)}
          </span>
        </div>` : `<div class="ls-row">
          <span class="ls-label">Time</span>
          <span class="ls-set sheet-step sc-tstep">
            ${step('data-shift', -60, '−1 h', 'an hour earlier')}
            ${step('data-shift', -5, '−5 min', '5 minutes earlier')}
            ${step('data-shift', -1, '−1 min', 'a minute earlier')}
            <b class="sheet-val pb-time">${esc(s.time || '')}</b>
            ${step('data-shift', 1, '+1 min', 'a minute later')}
            ${step('data-shift', 5, '+5 min', '5 minutes later')}
            ${step('data-shift', 60, '+1 h', 'an hour later')}
          </span>
        </div>`}

        <div class="ls-row">
          <span class="ls-label">Days
            <span class="db-hint">tap a day to take it in or out — ${esc(daysText(s.days))}${school
              ? '; a school day left out stays silent' : ''}.</span></span>
          <span class="ls-set sheet-grid sheet-days">${DAYS.map((d, i) => `
            <button class="ls-btn sc-day${days.has(i) ? ' on' : ''}" data-day="${i}"
                    aria-pressed="${days.has(i)}">${d}</button>`).join('')}
          </span>
        </div>`, { note: n.when })}

      ${lines.length ? kit.sec('Coming mornings', `
        <div class="ls-row">
          <span class="ls-label"><span class="db-hint sheet-lead">${!s.enabled
            ? 'The alert is off: none of them plays. When it is on, they are as'
            : paused !== null ? 'As they would be — paused, none of them plays. As' : 'As'} the school board has them now; a letter
            the agent reads moves them at once.</span></span>
          <ul class="sc-plan${!s.enabled || paused !== null ? ' sc-held' : ''}">${lines.map((l) => `<li class="${l.cls}"><b>${esc(l.when)}</b>
            <span>${esc(l.text)}</span></li>`).join('')}</ul>
        </div>`, { note: n.mornings }) : ''}

      ${kit.sec('Song', `
        <div class="ls-row">
          <span class="ls-label"><span class="db-hint sheet-lead">tap a song to choose it and hear it on
            this screen; tap it again to stop. A different one each day goes through the five in
            order${nextLabel ? ` — next: ${esc(nextLabel)}` : ''}. ＋ Upload adds a song of your own (the
            two rows above keep to the five); ✕ deletes one. 🗣 reads a text after it.</span></span>
          <div class="sheet-ctl">
            <span class="ls-set sheet-seg">
              <button class="ls-btn sc-mode${pick(s.song, 'rotate')}" data-song-mode="rotate"
                aria-pressed="${s.song === 'rotate'}">A different one each day</button>
              <button class="ls-btn sc-mode${pick(s.song, 'all')}" data-song-mode="all"
                aria-pressed="${s.song === 'all'}">All five in a row</button>
            </span>
            <span class="ls-set sheet-seg">${this.songs().map((x) => `
              <button class="ls-btn db-room${pick(s.song, x.id)}" data-song="${esc(x.id)}" aria-pressed="${s.song === x.id}">
                <span class="db-play">${this.previewing === x.id && playing ? '■' : '▶'}</span>
                ${esc(x.label)}</button>`).join('')}
            </span>
            <span class="sheet-acts">
              ${this.songs().filter((x) => x.uploaded).map((x) => `<span class="sc-upsong">${esc(x.label)}
                ${this.ctx.soundlib?.delBtn(x.id, { label: x.label }) || ''}</span>`).join('')}
              ${this.ctx.soundlib?.uploadBtn('school', { text: '＋ Upload a song' }) || ''}
              ${this.ctx.voice?.chip('school') || ''}
            </span>
          </div>
          ${this.ctx.voice?.editor('school', { hint: 'read aloud once after the song — e.g. "Mia, time to put your shoes on"' }) || ''}
        </div>

        <div class="ls-row">
          <span class="ls-label">Plays</span>
          <span class="ls-set sheet-step">
            <button class="ls-btn" data-times="-1" aria-label="fewer"${times <= 1 ? ' disabled' : ''}>−</button>
            <b class="sheet-val pb-time pb-times">${esc(this.lengthText(times, count))}</b>
            <button class="ls-btn" data-times="1" aria-label="more"${times >= TIMES_MAX ? ' disabled' : ''}>+</button>
          </span>
        </div>`, { note: n.song })}

      ${kit.sec('Try it', `
        <div class="ls-row">
          <span class="ls-label"><span class="db-hint sheet-lead">plays it on every screen now, whatever
            the switch and the day; a different one each day plays the next one and stays on it. Stop,
            here or on any screen, ends it everywhere; so does switching the alert off.</span>
            <span class="pb-last">${esc(this.lastLine())}</span></span>
          <span class="ls-set">
            ${showStop
              ? '<button class="ls-btn sheet-danger on sc-stop">Stop</button>'
              : '<button class="ls-btn sheet-primary sc-try">▶ Play on the wall now</button>'}
          </span>
        </div>`, { note: n.test })}`;

    this.bodyEl.querySelectorAll('[data-put]').forEach((btn) => {
      btn.onclick = () => this.put({ [btn.dataset.put]: JSON.parse(btn.dataset.v) });
    });
    const pz = this.bodyEl.querySelector('.sc-pz');
    if (pz) pz.onclick = () => this.setPause(this.paused() === null);
    this.bodyEl.querySelectorAll('[data-before]').forEach((btn) => {
      btn.onclick = () => {
        const n = (Number.isInteger(this.settings().before_min) ? this.settings().before_min : 23)
          + Number(btn.dataset.before);
        this.put({ before_min: Math.max(0, Math.min(BEFORE_MAX, n)) });
      };
    });
    this.bodyEl.querySelectorAll('[data-shift]').forEach((btn) => {
      btn.onclick = () => this.put({ time: this.shift(this.settings().time, Number(btn.dataset.shift)) });
    });
    this.bodyEl.querySelectorAll('[data-day]').forEach((btn) => {
      btn.onclick = () => {
        const d = Number(btn.dataset.day);
        const on = new Set(this.settings().days || []);
        if (on.has(d)) on.delete(d); else on.add(d);
        this.put({ days: [...on].sort((a, b) => a - b) });
      };
    });
    this.bodyEl.querySelectorAll('[data-song-mode]').forEach((btn) => {
      btn.onclick = () => this.put({ song: btn.dataset.songMode });
    });
    this.bodyEl.querySelectorAll('[data-song]').forEach((btn) => {
      btn.onclick = () => this.choose(btn.dataset.song);
    });
    this.bodyEl.querySelectorAll('[data-times]').forEach((btn) => {
      btn.onclick = () => {
        const n = (this.settings().times || 1) + Number(btn.dataset.times);
        if (n >= 1 && n <= TIMES_MAX) this.put({ times: n });
      };
    });
    // An upload is the song at once.
    this.ctx.soundlib?.wire(this.bodyEl, { onUploaded: (r) => this.put({ song: r.id }) });
    this.ctx.voice?.wire(this.bodyEl, () => this.render());
    const tryBtn = this.bodyEl.querySelector('.sc-try');
    if (tryBtn) tryBtn.onclick = () => this.wallTest();
    const stopBtn = this.bodyEl.querySelector('.sc-stop');
    if (stopBtn) stopBtn.onclick = () => this.stopAll();
    kit.sync(this.sheet);
  },
};
