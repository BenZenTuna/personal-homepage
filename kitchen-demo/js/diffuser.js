/* The aroma diffuser in the entrance — its document, its card's words and
   its settings sheet (Alex, 2026-10-14).

   The running is the server's (backend/app/diffuser.py): it switches the mist
   and the light, ends a run on time, keeps the schedule and answers the
   entrance's motion sensor. Here is the card's 5, 10 and 20 minutes and Stop,
   and behind its gear the light's colour, the schedule — how often, for how
   long, in which hours and on which days — and motion: on or off, how long,
   how long it rests between, all day or only in the schedule's hours.

   The water is an estimate (diffuser.py says why): misting time since it
   was filled, against how long a full tank lasts — 8 h from the box until it
   has learned its own. The card shows it as a small tank and "≈ 70 %"; the
   sheet has Filled up, and asks "did it run dry?" when the mist stopped by
   itself.

   Mist strength (2026-10-15): light or strong, on the card as one button
   that flips it and in the sheet, set through the diffuser's own Meross
   connection (backend/app/meross.py — it needs the Meross key, and the card
   shows the button only once it has one). The tank is learned per strength:
   every "it ran dry" is a calibration run, listed in the sheet with its
   hours at each strength, and the server fits a full tank's hours at each
   from all of them.

   The card is drawn by the House panel on Automation (ha.js, buildAuto).
   This is ctx.diffuser. */

const esc = (s) => String(s ?? '').replace(/[&<>"]/g,
  (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

const pad = (n) => String(n).padStart(2, '0');
const hm = (ts) => { const d = new Date(ts * 1000); return `${pad(d.getHours())}:${pad(d.getMinutes())}`; };
const minText = (m) => (m < 60 ? `${m} min` : `${Math.floor(m / 60)} h${m % 60 ? ` ${m % 60} min` : ''}`);

/* How often, and for how long: any value in the server's range (2026-10-14,
   "adjustable, not fixed values"), stepped with − and + along these rungs —
   fine where a minute matters, coarser where it does not. A value set some
   other way, off the rungs, steps to the next rung either side. */
const RUNGS = {
  every: [10, 15, 20, 25, 30, 35, 40, 45, 50, 55, 60, 75, 90, 105, 120, 150, 180, 210, 240,
          300, 360, 420, 480, 540, 600, 660, 720],
  run: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 12, 15, 20, 25, 30, 35, 40, 45, 50, 55, 60, 75, 90, 105, 120],
  // Guest mode, welcome home (2026-10-15): the same − / +, their own ranges.
  guest_min: [15, 30, 45, 60, 75, 90, 105, 120, 150, 180, 210, 240],
  guest_every: [5, 10, 15, 20, 25, 30, 40, 45, 50, 60],
  guest_run: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 12, 15],
  welcome_min: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 12, 15],
  welcome_after: [30, 45, 60, 90, 120, 150, 180, 240, 300, 360, 480, 600, 720],
};
const nextRung = (rungs, v, dir) => (dir > 0
  ? rungs.find((x) => x > v) ?? rungs[rungs.length - 1]
  : [...rungs].reverse().find((x) => x < v) ?? rungs[0]);
const STEP_WORDS = {
  every: (v) => `every ${minText(v)}`, run: (v) => minText(v),
  guest_min: (v) => `for ${minText(v)}`, guest_every: (v) => `every ${minText(v)}`,
  guest_run: (v) => `${minText(v)} each`, welcome_min: (v) => minText(v),
  welcome_after: (v) => `quiet ${minText(v)}`,
};
const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const INTENSITY_BTNS = (s, ok) => ['light', 'strong'].map((v) => `
  <button class="ls-btn df-int-pick${s.intensity === v ? ' on' : ''}" data-put="intensity" data-v='"${v}"'
    aria-pressed="${s.intensity === v}"${ok ? '' : ' disabled'}>
    ${v === 'light' ? '🌫️ Light' : '💨 Strong'}</button>`).join('');
/* On or off (the settings window kit's switch): one button saying its state;
   a tap turns it the other way. */
const SWITCH = (key, on) => `<button class="ls-btn sheet-switch${on ? ' on' : ''}" role="switch" aria-checked="${on}"
  data-put="${key}" data-v="${on ? 'false' : 'true'}">${on ? 'On' : 'Off'}</button>`;
const SOURCE = { card: '', schedule: 'schedule', motion: 'motion', guest: 'guests', welcome: 'welcome home',
  button: 'its own button' };
const hours = (s) => { const m = Math.round(s / 60); return m < 60 ? `${m} min` : `${Math.floor(m / 60)} h ${m % 60 ? `${m % 60} min` : ''}`.trim(); };
const h1 = (s) => `${(s / 3600).toFixed(1)} h`;
const STRENGTH = { light: 'Light', strong: 'Strong', unknown: 'unknown', off: 'off' };
const dayTime = (ts) => {
  const d = new Date(ts * 1000);
  return `${d.getDate()} ${d.toLocaleString('en-GB', { month: 'short' })} ${hm(ts)}`;
};

/* Unbroken stretches of chosen hours, "07–09, 18–21" — the hour after the
   last, as a time range reads. */
function hoursText(hours) {
  const hs = [...new Set(hours || [])].sort((a, b) => a - b);
  const out = [];
  for (const h of hs) {
    const last = out[out.length - 1];
    if (last && last[1] === h) last[1] = h + 1; else out.push([h, h + 1]);
  }
  return out.map(([a, b]) => `${pad(a)}–${pad(b % 24)}`).join(', ');
}

function daysText(days) {
  const d = [...(days || [])].sort((a, b) => a - b);
  if (d.length === 7) return 'every day';
  if (d.join() === '0,1,2,3,4') return 'weekdays';
  if (d.join() === '5,6') return 'weekends';
  return d.map((x) => DAYS[x]).join(' ');
}

export default {
  doc: null,
  subs: [],
  busy: false,
  err: '',
  pending: {},      // stepped values not yet sent (see nudge)
  holding: false,   // a − or + held down: the sheet is not redrawn under it

  init(ctx) {
    this.ctx = ctx;
    this.buildSheet();
    ctx.bus.on('diffuser', (doc) => {
      if (!doc || typeof doc !== 'object' || !doc.settings) return;
      // A value being stepped wins over the server's until it has been sent.
      if (Object.keys(this.pending).length) doc = { ...doc, settings: { ...doc.settings, ...this.pending } };
      this.doc = doc;
      this.changed();
      this.render();
    });
    // Minutes left move on by themselves: the header's line, and the Now
    // card's note beside its heading and on the rail.
    setInterval(() => { if (this.running()) { this.changed(); this.renderNow(); this.renderNowNote(); } }, 20000);
  },

  onDoc(fn) { this.subs.push(fn); },

  changed() {
    for (const fn of this.subs) {
      try { fn(this.doc); } catch (e) { console.error('diffuser subscriber failed', e); }
    }
  },

  settings() { return (this.doc && this.doc.settings) || {}; },

  running() { return !!this.doc?.run; },

  /* Somebody else has it misting — the Meross app, its own button. */
  onElsewhere() { return !this.running() && this.doc?.device?.mist === 'on'; },

  minutesLeft() {
    const r = this.doc?.run;
    return r ? Math.max(1, Math.ceil((r.until - Date.now() / 1000) / 60)) : 0;
  },

  /* The water, for the card: {pct, text, cls}. */
  waterGauge() {
    const w = this.doc?.water;
    if (!w || !w.known) return { pct: null, text: '?', cls: 'df-wunknown' };
    if (w.empty) return { pct: 0, text: 'Empty', cls: 'df-wempty' };
    return { pct: w.pct, text: `≈${w.pct}%`, cls: w.pct <= 15 ? 'df-wlow' : '' };
  },

  waterLine() {
    const w = this.doc?.water;
    if (!w) return '';
    const t = w.tanks || {};
    const tank = `a full tank ≈ ${h1(t.strong)} strong, ${h1(t.light)} light${w.learned
      ? ` (learned from ${w.runs.length} run${w.runs.length === 1 ? '' : 's'} — see Calibrating below)`
      : ' (Meross: 400 ml, 7–9 h strong, 12–14 h light — until it learns its own)'}`;
    if (w.empty) return `empty since it ran dry — fill it and press the diffuser's own button, or tap Filled up. ${tank}.`;
    if (!w.known) return `not known yet: tap Filled up the next time it is filled, and from then on it counts. ${tank}.`;
    const s = this.settings();
    const by = Object.entries(w.by || {}).filter(([, x]) => x >= 60)
      .map(([k, x]) => `${hours(x)} ${STRENGTH[k]}`).join(', ');
    const left = w.left_s ? ` About ${h1(w.left_s.strong)} left at strong, ${h1(w.left_s.light)} at light.` : '';
    return `${hours(w.used_s)} of mist since it was filled${by ? ` (${by})` : ''} — ${tank}.${left}
      An estimate: nothing in the diffuser measures it.
      Needs attention warns under ${s.water_low} % and ${s.water_very_low} %, and once the diffuser itself
      stops empty (House → Automation → House alerts).`;
  },

  /* The strength through Meross: there, and what the diffuser said last. */
  strengthOk() { return !!this.doc?.intensity?.available; },

  strengthLine() {
    const i = this.doc?.intensity || {};
    if (!i.available) {
      return `not set up yet: the strength is not in HomeKit, only in the diffuser's own Meross connection,
        which needs the key of the Meross account it is in. Alex runs, on the workstation:
        ~/claude_code_projects/the wall-Kitchen/kitchen/scripts/meross-key.py`;
    }
    if (i.error) return `the diffuser did not answer about it: ${i.error}`;
    const said = i.device ? ` The diffuser said ${STRENGTH[i.device] || i.device}${i.at ? ` at ${hm(i.at)}` : ''}.` : '';
    return `set at the start of each run, and changed at once while one runs — runs started from the
      Meross app or its own button keep theirs. Meross: a tank lasts 7–9 h strong, 12–14 h light.${said}`;
  },

  flipStrength() {
    const now = this.settings().intensity;
    return this.put({ intensity: now === 'light' ? 'strong' : 'light' });
  },

  forgetRun(at) { return this.post('/api/diffuser/water', { action: 'forget', at }); },

  async water(action) {
    await this.post('/api/diffuser/water', { action });
  },

  /* Under the name: what it does by itself. */
  summary() {
    const s = this.settings();
    if (!this.doc) return '';
    const motion = s.motion ? `motion ${s.motion_min} min` : 'motion off';
    const sched = s.schedule && (s.hours || []).length
      ? `every ${minText(s.every)}, ${hoursText(s.hours)}` : 'no schedule';
    return `${motion} · ${sched}`;
  },

  /* The bold line: what it is doing now. */
  status() {
    const d = this.doc;
    if (!d) return '';
    if (!d.configured) return 'not in entities.json';
    if (this.err) return this.err;
    const guests = this.guestOn() ? ` · guests until ${hm(d.guest.until)}` : '';
    if (d.run) {
      const why = SOURCE[d.run.source] && d.run.source !== 'guest' ? ` · ${SOURCE[d.run.source]}` : '';
      return `Misting · ${this.minutesLeft()} min left${d.answering ? why + guests : ' · not answering'}`;
    }
    if (guests) return `Guests until ${hm(d.guest.until)} · next run ${hm(d.guest.next)}`;
    const p = this.pausedFor();
    if (p) return p.until != null ? `Paused until ${hm(p.until)}` : 'Paused until you resume';
    // Off its HomeKit link: it does this for a minute at a time.
    if (!d.answering) return 'Not answering';
    if (this.onElsewhere()) return 'Misting (from the diffuser or its app)';
    const last = d.last;
    if (last && /by itself|out of water|did not answer/.test(last.why || '')
        && Date.now() / 1000 - last.at < 3 * 3600) {
      return /did not answer/.test(last.why) ? `No answer at ${hm(last.at)}`
        : `Stopped by itself at ${hm(last.at)} — water?`;
    }
    if (d.water?.empty) return 'Empty — fill it, then press its button';
    if (d.next) return `Resting · next ${d.next.slice(11, 16)}`;
    return 'Resting';
  },

  async post(path, body) {
    this.busy = true;
    this.err = '';
    this.changed();
    try {
      const r = await fetch(path, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: body ? JSON.stringify(body) : undefined,
      });
      const ans = await r.json().catch(() => ({}));
      if (!r.ok) this.err = ans.error || `the server answered ${r.status}`;
      else if (ans.settings) this.doc = ans;
    } catch {
      this.err = 'the kitchen did not answer';
    }
    this.busy = false;
    this.changed();
    this.render();
  },

  run(minutes) { return this.post('/api/diffuser/run', { minutes }); },

  /* Guest mode: 🥂 on the card, on for guest_min or until tapped again. */
  guestOn() { return !!this.doc?.guest && this.doc.guest.until > Date.now() / 1000; },

  guest() { return this.post('/api/diffuser/guest', { on: !this.guestOn() }); },

  /* Pause (2026-10-21): ⏸ alone = until tapped again, 1–4 h = that long;
     nothing starts it by itself meanwhile. The lit button again resumes. */
  pausedFor() {
    const p = this.doc?.pause;
    if (!p) return null;
    if (p.until != null && p.until <= Date.now() / 1000) return null;
    return p;
  },

  pause(hours) {
    const p = this.pausedFor();
    const same = p && (p.hours ?? null) === (hours ?? null);
    return this.post('/api/diffuser/pause', same ? { on: false } : { on: true, hours: hours ?? null });
  },

  async refillTest() {
    this.reminderBusy = true;
    this.render();
    try { await fetch('/api/diffuser/refill-test', { method: 'POST' }); } catch { /* said below */ }
    this.reminderBusy = false;
    this.render();
  },

  stop() { return this.post('/api/diffuser/stop'); },

  async put(patch) {
    if (this.doc) {
      this.doc = { ...this.doc, settings: { ...this.settings(), ...patch } };
      this.changed();
      this.render();
    }
    try {
      const r = await fetch('/api/diffuser/settings', {
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

  buildSheet() {
    const el = document.createElement('div');
    el.id = 'df-sheet';
    el.className = 'sheet';   // the settings window kit (app.css)
    el.innerHTML = `
      <header>
        <span class="sheet-icon" aria-hidden="true">🌸</span>
        <div class="sheet-title">
          <h2>Aroma diffuser</h2>
          <span class="sheet-status df-now"></span>
        </div>
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
    if (!this.doc) return;
    this.sheet.classList.add('open');
    this.render();
  },

  close() { this.sheet.classList.remove('open'); },

  isOpen() { return !!this.sheet && this.sheet.classList.contains('open'); },

  renderNow() {
    if (!this.isOpen() || !this.doc) return;
    const h = this.doc.device?.humidity;
    const hum = h != null && h !== 'unavailable' && h !== 'unknown' ? ` · entrance ${h} %` : '';
    const g = this.waterGauge();
    const water = g.pct != null && !this.doc.water?.empty ? ` · water ${g.text}` : '';
    this.ctx.sheetkit.status(this.sheet.querySelector('.df-now'), esc(`${this.status()}${water}${hum}`), this.tone());
  },

  /* The Now card's note alone (its minutes left), without redrawing the
     sheet — which would take a button out from under a finger. */
  renderNowNote() {
    if (!this.isOpen() || !this.doc || this.holding) return;
    const sec = this.bodyEl.querySelector(':scope > section[data-rail="Now"]');
    const sub = sec?.querySelector(':scope > .sheet-h > .sheet-sub');
    if (!sec || !sub) return;
    const note = this.notes().now;
    if (sec.dataset.note === note) return;
    sec.dataset.note = note;
    sub.textContent = note;
    this.ctx.sheetkit.sync(this.sheet);
  },

  /* The header line's tone (the settings window kit): misting is live; not
     answering, an error, a stop by itself or an empty tank want somebody;
     paused is off. */
  tone() {
    const d = this.doc;
    if (!d) return '';
    if (!d.configured || this.err || !d.answering || d.water?.empty) return 'warn';
    if (d.run || this.onElsewhere()) return 'live';
    if (this.pausedFor()) return 'off';
    const last = d.last;
    if (last && /by itself|out of water|did not answer/.test(last.why || '')
        && Date.now() / 1000 - last.at < 3 * 3600) return 'warn';
    return 'ok';
  },

  /* Each card's live note: beside its heading and under its name on the rail. */
  notes() {
    const d = this.doc;
    const s = this.settings();
    const ch = d.choices || {};
    const w = d.water || {};
    const g = this.waterGauge();
    const colour = (ch.colours || []).find((c) => c.id === s.colour)?.label || s.colour;
    const white = (ch.whites || []).find((x) => x.id === s.white)?.label || s.white;
    const light = { colour, cycle: '🌈 Changing', white, off: 'No light' }[s.light] || '';
    const runs = (w.runs || []).length;
    const told = (d.phones || []).filter((p) => (s.refill_phones || []).includes(p.id)).map((p) => p.label);
    return {
      now: [this.running() ? `misting · ${this.minutesLeft()} min left` : '',
        w.empty ? 'tank empty' : g.pct != null ? `water ${g.text}` : 'water not known'].filter(Boolean).join(' · '),
      strength: this.strengthOk() ? (STRENGTH[s.intensity] || '') : 'not set up',
      light: s.light === 'off' ? light : `${light}${s.brightness != null ? ` · ${s.brightness} %` : ''}`,
      sched: s.schedule ? [`every ${minText(s.every)}`, hoursText(s.hours) || 'no hours', daysText(s.days)].join(' · ') : 'off',
      motion: s.motion ? `${s.motion_min} min · ${s.motion_when === 'hours' ? 'in those hours' : 'all day'}` : 'off',
      welcome: s.welcome ? `on · quiet ${minText(s.welcome_after)}` : 'off',
      guest: this.guestOn() ? `on until ${hm(d.guest.until)}` : 'off',
      calib: runs ? `${runs} ${runs === 1 ? 'run' : 'runs'}` : 'no runs yet',
      refill: s.refill_notify ? `on${told.length ? ` · ${told.join(', ')}` : ''}` : 'off',
    };
  },

  /* − or + on How often or For how long: the next rung, shown at once in
     its own line only — redrawing the sheet would take the button out from
     under a finger holding it — and sent once the taps have stopped. */
  nudge(key, dir, row) {
    const now = this.pending[key] ?? this.settings()[key];
    const v = nextRung(RUNGS[key], now, dir);
    if (v === now) return;
    this.pending[key] = v;
    this.doc = { ...this.doc, settings: { ...this.settings(), [key]: v } };
    const val = row.querySelector('.df-val');
    if (val) val.textContent = STEP_WORDS[key](v);
    clearTimeout(this.putTimer);
    this.putTimer = setTimeout(() => this.flush(), 700);
  },

  flush() {
    if (this.holding) return;
    const patch = this.pending;
    this.pending = {};
    if (Object.keys(patch).length) this.put(patch);
  },

  stepper(key, value) {
    return `
      <span class="ls-set sheet-step df-step" data-key="${key}">
        <button class="ls-btn df-dir" data-dir="-1" aria-label="less">−</button>
        <b class="sheet-val df-val">${esc(STEP_WORDS[key](value))}</b>
        <button class="ls-btn df-dir" data-dir="1" aria-label="more">+</button>
      </span>`;
  },

  /* The runs that went dry, newest first, and what they make a full tank. */
  calibrationRows(w) {
    const runs = [...(w.runs || [])].reverse();
    const t = w.tanks || {};
    const m = w.meross || {};
    const learned = `
      <div class="ls-row">
        <span class="ls-label">A full tank
          <span class="db-hint">${runs.length ? `from ${runs.length} run${runs.length === 1 ? '' : 's'} below`
            : 'no runs yet — Meross\'s numbers until the first'}${runs.length && !runs.some((r) => r.s.light >= 60)
            ? '; light has not been run yet, so it follows strong\'s correction' : ''}${runs.length
            && !runs.some((r) => r.s.strong + r.s.unknown >= 60)
            ? '; strong has not been run yet, so it follows light\'s correction' : ''}.</span></span>
        <span class="ls-set df-tanks">
          <span><b>${h1(t.strong)}</b> strong <small>Meross ${h1(m.strong)}</small></span>
          <span><b>${h1(t.light)}</b> light <small>Meross ${h1(m.light)}</small></span>
        </span>
      </div>`;
    if (!runs.length) return learned;
    const part = (r) => ['strong', 'light', 'unknown'].filter((k) => r.s[k] >= 60)
      .map((k) => `${h1(r.s[k])} ${STRENGTH[k]}`).join(' + ');
    return learned + runs.map((r) => {
      const total = r.s.strong + r.s.light + r.s.unknown;
      return `
      <div class="ls-row df-calrun">
        <span class="ls-label">${r.filled_at ? `${esc(dayTime(r.filled_at))} → ` : ''}${esc(dayTime(r.dry_at))}
          <span class="db-hint">${h1(total)} of mist: ${esc(part(r) || 'none')}</span></span>
        <span class="ls-set"><button class="ls-btn sheet-danger df-forget" data-at="${r.dry_at}">Remove</button></span>
      </div>`;
    }).join('');
  },

  render() {
    if (!this.isOpen() || !this.doc || this.holding) return;
    const kit = this.ctx.sheetkit;
    const d = this.doc;
    const s = this.settings();
    const ch = d.choices || {};
    const pick = (v, want) => (v === want ? ' on' : '');
    // A row of one-of-N; `none` says which choice is "none" (No light, No
    // rest), chosen in the kit's quiet fill rather than the accent.
    const btns = (key, list, label, none = () => false) => list.map((v) => `
      <button class="ls-btn${pick(s[key], v)}${none(v) ? ' sheet-none' : ''}" data-put="${key}" data-v='${esc(JSON.stringify(v))}'
        aria-pressed="${s[key] === v}">${esc(label(v))}</button>`).join('');
    const on = this.running();
    this.renderNow();
    const hours = new Set(s.hours || []);
    const days = new Set(s.days || []);
    const cells = Array.from({ length: 24 }, (_, h) => `
      <button class="ls-btn nt-h${hours.has(h) ? ' on' : ''}" data-hour="${h}" aria-pressed="${hours.has(h)}">${pad(h)}</button>`).join('');
    const w = d.water || {};
    const g = this.waterGauge();
    const n = this.notes();
    this.bodyEl.innerHTML = `
      ${kit.sec('Now', `
        <div class="ls-row">
          <span class="ls-label">Run it now
            <span class="db-hint">mist and the light below, then both off by themselves. A tap while it
              runs sets the time left to what was tapped.</span></span>
          <span class="ls-set">
            ${(ch.card || []).map((m) => `<button class="ls-btn df-go" data-min="${m}">${m} min</button>`).join('')}
            <button class="ls-btn sheet-danger df-stop${on || this.onElsewhere() ? ' on' : ''}"${on || this.onElsewhere() ? '' : ' disabled'}>■ Stop</button>
          </span>
        </div>
        <div class="ls-row${w.dry_at && !w.empty ? ' df-ask' : ''}">
          <span class="ls-label">Water <b class="df-wtext ${g.cls}">${esc(g.text)}</b><span
            class="df-gauge ${g.cls}" style="--lvl: ${Number(g.pct) || 0}%" aria-hidden="true"><i></i></span>
            <span class="db-hint">${esc(this.waterLine())}</span>
            ${w.dry_at && !w.empty ? `<span class="db-warn">It stopped by itself at ${hm(w.dry_at)}. Did it run dry?
              Yes teaches it how long a tank lasts${w.used_s >= 1800 ? '' : ' (not this time: under half an hour since filling)'}.</span>` : ''}</span>
          <span class="ls-set">
            <button class="ls-btn df-water-act" data-act="filled">💧 Filled up</button>
            ${w.dry_at && !w.empty ? `
            <button class="ls-btn df-water-act" data-act="dry">Yes, it ran dry</button>
            <button class="ls-btn df-water-act" data-act="wet">No, something else</button>` : ''}
          </span>
        </div>`, { note: n.now })}

      ${kit.sec('Mist strength', `
        <div class="ls-row${this.strengthOk() ? '' : ' nt-off'}">
          <span class="ls-label">How strong it mists
            <span class="db-hint">${esc(this.strengthLine())}</span></span>
          <span class="ls-set sheet-seg">${INTENSITY_BTNS(s, this.strengthOk())}</span>
        </div>`, { note: n.strength })}

      ${kit.sec('The light', `
        <div class="ls-row">
          <span class="ls-label">While it mists
            <span class="db-hint">the diffuser's own lamp — one colour, all of them in turn, a white, or
              dark. Changes a run that is going at once.</span></span>
          <span class="ls-set sheet-seg">${btns('light', ['colour', 'cycle', 'white', 'off'],
            (v) => ({ colour: 'Colour', cycle: '🌈 Changing', white: 'White', off: 'No light' }[v]), (v) => v === 'off')}</span>
        </div>
        <div class="ls-row"${s.light === 'colour' ? '' : ' hidden'}>
          <span class="ls-label">Colour</span>
          <span class="ls-set sheet-seg">${(ch.colours || []).map((c) => `
            <button class="ls-btn df-col${pick(s.colour, c.id)}" data-put="colour" data-v='"${esc(c.id)}"'
              aria-pressed="${s.colour === c.id}">
              <i style="background:hsl(${c.hs[0]} ${c.hs[1]}% 55%)"></i>${esc(c.label)}</button>`).join('')}</span>
        </div>
        <div class="ls-row"${s.light === 'cycle' ? '' : ' hidden'}>
          <span class="ls-label">How fast it changes
            <span class="db-hint">round the whole rainbow, a step every five seconds.</span></span>
          <span class="ls-set sheet-seg">${btns('cycle', ch.cycle || [], (v) => ({ slow: 'Slow — about 6 min',
            medium: 'Medium — about 2 min', fast: 'Fast — about 45 s' }[v] || v))}</span>
        </div>
        <div class="ls-row"${s.light === 'white' ? '' : ' hidden'}>
          <span class="ls-label">White</span>
          <span class="ls-set sheet-seg">${(ch.whites || []).map((x) => `
            <button class="ls-btn${pick(s.white, x.id)}" data-put="white" data-v='"${esc(x.id)}"'
              aria-pressed="${s.white === x.id}">${esc(x.label)}
              <small>${x.k} K</small></button>`).join('')}</span>
        </div>
        <div class="ls-row"${s.light === 'off' ? ' hidden' : ''}>
          <span class="ls-label">Brightness</span>
          <span class="ls-set sheet-seg">${btns('brightness', ch.brightness || [], (v) => `${v} %`)}</span>
        </div>`, { note: n.light })}

      ${kit.sec('By itself', `
        <div class="ls-row">
          <span class="ls-label">On a schedule
            <span class="db-hint">${s.schedule
              ? `every ${esc(minText(s.every))} for ${s.run} min, ${esc(hoursText(s.hours) || 'no hours chosen')},
                 ${esc(daysText(s.days))}${d.next ? ` — next ${d.next.slice(11, 16)}` : ''}`
              : 'off: it runs only when told to, or for motion'}</span></span>
          ${SWITCH('schedule', !!s.schedule)}
        </div>
        <div class="ls-row">
          <span class="ls-label">Started on the diffuser
            <span class="db-hint">its own button or the Meross app: after a minute it becomes a run of
              ${s.run} min (For how long each time, below), then off, and the schedule goes on — or it keeps going
              until somebody switches it off. On an empty tank, that press is also 💧 Filled up.</span></span>
          <span class="ls-set sheet-seg">${btns('button_runs', [true, false],
            (v) => (v ? `Runs ${s.run} min` : 'Keeps going'))}</span>
        </div>
        <div class="df-sched${s.schedule ? '' : ' nt-off'}">
          <div class="ls-row">
            <span class="ls-label">How often
              <span class="db-hint">from the start of each stretch of chosen hours, as long as it is inside it.
                − and + step it; hold one to run through them.</span></span>
            ${this.stepper('every', s.every)}
          </div>
          <div class="ls-row">
            <span class="ls-label">For how long each time</span>
            ${this.stepper('run', s.run)}
          </div>
          <div class="ls-row">
            <span class="ls-label">In which hours
              <span class="db-hint">tap the hours it may run in: ${esc(hoursText(s.hours) || 'none chosen yet')}.</span></span>
            <div class="nt-hours sheet-grid sheet-hours">${cells}</div>
          </div>
          <div class="ls-row">
            <span class="ls-label">On which days</span>
            <span class="ls-set sheet-grid sheet-days">${DAYS.map((x, i) => `
              <button class="ls-btn sc-day${days.has(i) ? ' on' : ''}" data-day="${i}" aria-pressed="${days.has(i)}">${x}</button>`).join('')}</span>
          </div>
        </div>`, { note: n.sched })}

      ${kit.sec('Motion at the entrance', `
        <div class="ls-row">
          <span class="ls-label">When somebody comes by
            <span class="db-hint">the entrance's motion sensor starts it while it is resting — and, if chosen
              below, keeps a run that is going on for as long again.</span></span>
          ${SWITCH('motion', !!s.motion)}
        </div>
        <div class="df-motion${s.motion ? '' : ' nt-off'}">
          <div class="ls-row">
            <span class="ls-label">It runs for</span>
            <span class="ls-set sheet-seg">${btns('motion_min', ch.motion_min || [], (v) => `${v} min`)}</span>
          </div>
          <div class="ls-row">
            <span class="ls-label">Each motion
              <span class="db-hint">only starts it when it rests, or also, while a run is going (the schedule's,
                guests', the card's), makes sure it mists at least that long more from the motion.</span></span>
            <span class="ls-set sheet-seg">${btns('motion_every', [false, true],
              (v) => (v ? 'Also keeps a run going' : 'Only when resting'))}</span>
          </div>
          <div class="ls-row">
            <span class="ls-label">Rests at least
              <span class="db-hint">between two motion runs, so a busy hallway does not keep it going.</span></span>
            <span class="ls-set sheet-seg">${btns('motion_gap', ch.motion_gap || [],
              (v) => (v ? `${minText(v)}` : 'No rest'), (v) => !v)}</span>
          </div>
          <div class="ls-row">
            <span class="ls-label">When
              <span class="db-hint">all day and night, or only in the hours and days chosen above —
                even with the schedule itself off.</span></span>
            <span class="ls-set sheet-seg">${btns('motion_when', ['always', 'hours'],
              (v) => (v === 'always' ? 'All day' : 'Only in those hours'))}</span>
          </div>
        </div>`, { note: n.motion })}

      ${kit.sec('Welcome home', `
        <div class="ls-row">
          <span class="ls-label">When the door opens after a quiet house
            <span class="db-hint">the entrance door (the doorbell's sensor) opening after none of the motion
              sensors chosen below has seen anybody, and the door has not opened, for as long as set below — so
              whoever comes home walks into it. Only while it is resting.${d.welcome?.quiet_since
              ? ` Last sign of life: ${hm(d.welcome.quiet_since)}.` : ''}${d.welcome?.welcomed
              ? ` Last welcome: ${hm(d.welcome.welcomed)}.` : ''}</span></span>
          ${SWITCH('welcome', !!s.welcome)}
        </div>
        <div class="df-welcome${s.welcome ? '' : ' nt-off'}">
          <div class="ls-row"><span class="ls-label">The house quiet for at least</span>${this.stepper('welcome_after', s.welcome_after)}</div>
          <div class="ls-row">
            <span class="ls-label">Quiet means no motion on
              <span class="db-hint">the sensors that count as somebody being home; the door always counts.</span></span>
            <span class="ls-set sheet-chips">${(ch.life || []).map((x) => `
              <button class="ls-btn df-life${(s.life_sensors || []).includes(x.entity) ? ' on' : ''}" data-life="${esc(x.entity)}"
                aria-pressed="${(s.life_sensors || []).includes(x.entity)}"
                title="${esc(x.entity)}${x.at ? ` — last change ${esc(new Date(x.at * 1000).toLocaleString('sv-SE').slice(5, 16))}` : ''}">${esc(x.label)}${
                x.state === 'on' ? ' •' : x.state === 'unavailable' ? ' (away)' : ''}</button>`).join('')}</span>
          </div>
          <div class="ls-row"><span class="ls-label">It runs for</span>${this.stepper('welcome_min', s.welcome_min)}</div>
          <div class="ls-row">
            <span class="ls-label">When
              <span class="db-hint">all day and night, or only in the schedule's hours and days.</span></span>
            <span class="ls-set sheet-seg">${btns('welcome_when', ['always', 'hours'],
              (v) => (v === 'always' ? 'All day' : 'Only in those hours'))}</span>
          </div>
        </div>`, { note: n.welcome })}

      ${kit.sec('Guest mode', `
        <div class="ls-row">
          <span class="ls-label">🥂 Guests <b>${this.guestOn() ? `on until ${hm(d.guest.until)}` : 'off'}</b>
            <span class="db-hint">one tap on the card's 🥂 Guests: gentle runs for a while, then everything as it
              was — the schedule and motion go on as usual meanwhile. Tap it again to end it early.</span></span>
          <span class="ls-set"><button class="ls-btn df-guest${this.guestOn() ? ' sheet-danger on' : ''}">${this.guestOn()
            ? '■ End guest mode' : '🥂 Start guest mode'}</button></span>
        </div>
        <div class="ls-row"><span class="ls-label">How long it lasts</span>${this.stepper('guest_min', s.guest_min)}</div>
        <div class="ls-row"><span class="ls-label">How often</span>${this.stepper('guest_every', s.guest_every)}</div>
        <div class="ls-row"><span class="ls-label">Each run</span>${this.stepper('guest_run', s.guest_run)}</div>`,
        { note: n.guest })}

      ${kit.sec('Calibrating the tank', `
        <div class="ls-row">
          <span class="ls-label">When it is dry, tell it
            <span class="db-hint">every time the tank runs dry, tap this: how long it misted since 💧 Filled up,
              at each strength, is one calibration run, and a full tank's hours at each strength are worked out
              from all of them. Most precise: one tank all at strong, the next all at light — then mixed tanks
              sharpen both. Report it as soon as you notice; a run under half an hour after filling is not used.
              ${w.empty ? 'It is marked empty now — fill it, then 💧 Filled up.' : ''}</span></span>
          <span class="ls-set">
            <button class="ls-btn df-water-act df-dry-now" data-act="dry"${w.empty || !w.known ? ' disabled' : ''}>🏜️ It's dry now</button>
          </span>
        </div>
        ${this.calibrationRows(w)}`, { note: n.calib })}

      ${kit.sec('Tank empty message', `
        <div class="ls-row">
          <span class="ls-label">On Telegram
            <span class="db-hint">one message per tank, when the diffuser itself shows it is empty: it stops by
              itself and then refuses to start again. That stop is also the tank's calibration run, and nothing
              starts it by itself until it is filled.${d.reminder ? ` Last: ${hm(d.reminder.at)}${d.reminder.test ? ' (test)' : ''} — ${
              d.reminder.sent?.length ? `sent to ${esc(d.reminder.sent.join(', '))}`
                : d.reminder.by_alert ? 'sent as the alert on Telegram' : 'sent to nobody'}${
              d.reminder.failed?.length ? `, not to ${esc(d.reminder.failed.map((f) => f.id).join(', '))}` : ''}.` : ''}</span></span>
          ${SWITCH('refill_notify', !!s.refill_notify)}
        </div>
        <div class="ls-row${s.refill_notify ? '' : ' nt-off'}">
          <span class="ls-label">To whom</span>
          <div class="sheet-ctl sheet-across">
            <span class="ls-set sheet-chips">${(d.phones || []).map((p) => {
              const chosen = (s.refill_phones || []).includes(p.id);
              return `
              <button class="ls-btn df-phone${chosen ? ' on' : ''}${p.ready ? '' : ' sheet-na'}" data-phone="${esc(p.id)}"
                aria-pressed="${chosen}"${p.ready || chosen ? '' : ' disabled'}
                ${p.ready ? '' : 'title="link their Telegram under House → Automation → Telegram"'}>${esc(p.label)}${p.ready ? '' : ' (no Telegram)'}</button>`;
            }).join('')}</span>
            <button class="ls-btn df-rtest"${this.reminderBusy ? ' disabled' : ''}>${this.reminderBusy ? 'Sending…' : 'Send a test'}</button>
          </div>
        </div>`, { note: n.refill })}`;

    this.bodyEl.querySelectorAll('.df-go').forEach((b) => { b.onclick = () => this.run(Number(b.dataset.min)); });
    this.bodyEl.querySelectorAll('.df-water-act').forEach((b) => { b.onclick = () => this.water(b.dataset.act); });
    this.bodyEl.querySelectorAll('.df-forget').forEach((b) => {
      b.onclick = () => {
        // Two taps: the first asks, the second drops it.
        if (b.dataset.sure) { this.forgetRun(Number(b.dataset.at)); return; }
        b.dataset.sure = '1';
        b.textContent = 'Sure? Tap again';
        setTimeout(() => { if (b.isConnected) { delete b.dataset.sure; b.textContent = 'Remove'; } }, 4000);
      };
    });
    this.bodyEl.querySelector('.df-stop').onclick = () => this.stop();
    this.bodyEl.querySelector('.df-guest').onclick = () => this.guest();
    this.bodyEl.querySelector('.df-rtest').onclick = () => this.refillTest();
    this.bodyEl.querySelectorAll('[data-phone]').forEach((btn) => {
      btn.onclick = () => {
        const set = new Set(this.settings().refill_phones || []);
        if (set.has(btn.dataset.phone)) set.delete(btn.dataset.phone); else set.add(btn.dataset.phone);
        const order = (this.doc.phones || []).map((p) => p.id);
        this.put({ refill_phones: order.filter((i) => set.has(i)) });
      };
    });
    this.bodyEl.querySelectorAll('[data-life]').forEach((btn) => {
      btn.onclick = () => {
        const set = new Set(this.settings().life_sensors || []);
        if (set.has(btn.dataset.life)) set.delete(btn.dataset.life); else set.add(btn.dataset.life);
        const order = (this.doc.choices?.life || []).map((x) => x.entity);
        this.put({ life_sensors: order.filter((i) => set.has(i)) });
      };
    });
    this.bodyEl.querySelectorAll('[data-put]').forEach((btn) => {
      btn.onclick = () => this.put({ [btn.dataset.put]: JSON.parse(btn.dataset.v) });
    });
    this.bodyEl.querySelectorAll('[data-hour]').forEach((btn) => {
      btn.onclick = () => {
        const set = new Set(this.settings().hours || []);
        const h = Number(btn.dataset.hour);
        if (set.has(h)) set.delete(h); else set.add(h);
        this.put({ hours: [...set].sort((a, b) => a - b) });
      };
    });
    this.bodyEl.querySelectorAll('[data-day]').forEach((btn) => {
      btn.onclick = () => {
        const set = new Set(this.settings().days || []);
        const x = Number(btn.dataset.day);
        if (set.has(x)) set.delete(x); else set.add(x);
        this.put({ days: [...set].sort((a, b) => a - b) });
      };
    });
    /* A tap is one rung; held, it runs on after a moment, a rung every
       140 ms, until the finger lifts or leaves the button. */
    this.bodyEl.querySelectorAll('.df-step').forEach((row) => {
      row.querySelectorAll('.df-dir').forEach((b) => {
        let wait = null;
        let rep = null;
        const step = () => this.nudge(row.dataset.key, Number(b.dataset.dir), row);
        const end = () => {
          clearTimeout(wait);
          clearInterval(rep);
          wait = rep = null;
          if (this.holding) {
            this.holding = false;
            clearTimeout(this.putTimer);
            this.putTimer = setTimeout(() => this.flush(), 700);
          }
        };
        b.onpointerdown = (e) => {
          e.preventDefault();
          this.holding = true;
          step();
          wait = setTimeout(() => { rep = setInterval(step, 140); }, 450);
        };
        b.onpointerup = end;
        b.onpointerleave = end;
        b.onpointercancel = end;
        // A keyboard's Enter or Space has no pointer: one rung.
        b.onkeydown = (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); step(); } };
      });
    });
    kit.sync(this.sheet);
  },
};
