/* The dehumidifier in the Storage — its document, its card's words and its
   settings sheet (Alex, 2026-11-13: "a new Dehumidifier automation in the
   Automation tab … gear settings for it and adjust when the device will run
   automatically after specific detected humidity. It will be in storage room
   where I have drying my laundry as well").

   The running is the server's (backend/app/dehumidifier.py): it finds the
   Comfee in Home Assistant, starts it at one humidity and stops it at a
   lower one, ends laundry and card runs, and checks every command took.
   Here is the card — the automatic's On/Off, ⏸, 👕 Laundry, 1/2/4 h, Stop —
   and behind its gear every setting of the automatic, its hours, how it
   runs (mode and fan), quiet hours, laundry drying, pause, and the runs.

   The card is drawn by the House panel on Automation (ha.js, buildAuto).
   This is ctx.dehumidifier. */

const esc = (s) => String(s ?? '').replace(/[&<>"]/g,
  (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const pad = (n) => String(n).padStart(2, '0');
const hm = (ts) => { const d = new Date(ts * 1000); return `${pad(d.getHours())}:${pad(d.getMinutes())}`; };
const minText = (m) => (m < 60 ? `${m} min` : `${Math.floor(m / 60)} h${m % 60 ? ` ${m % 60} min` : ''}`);
const dur = (s) => minText(Math.max(0, Math.round(s / 60)));
const pct = (v) => (v == null ? '–' : `${Math.round(v)} %`);

/* − and + along these rungs (Alex does not like fixed value rows). */
const RUNGS = {
  start_at: Array.from({ length: 51 }, (_, i) => 35 + i),
  stop_at: Array.from({ length: 51 }, (_, i) => 30 + i),
  after_min: [0, 1, 2, 3, 5, 10, 15, 20, 30, 45, 60],
  min_run: [0, 5, 10, 15, 20, 30, 45, 60, 90, 120, 150, 180],
  min_rest: [0, 5, 10, 15, 20, 30, 45, 60, 90, 120],
  max_run_h: [0, 1, 2, 3, 4, 5, 6, 8, 10, 12, 16, 20, 24],
  hold_min: [0, 15, 30, 60, 90, 120, 180, 240, 360, 480, 720],
  laundry_max_h: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12],
  laundry_settle: [0, 10, 15, 20, 30, 45, 60, 90, 120],
};
const STEP_WORDS = {
  start_at: (v) => `${v} %`, stop_at: (v) => `${v} %`,
  after_min: (v) => (v ? minText(v) : 'at once'),
  min_run: (v) => (v ? minText(v) : 'no least'),
  min_rest: (v) => (v ? minText(v) : 'no rest'),
  max_run_h: (v) => (v ? `${v} h` : 'no limit'),
  hold_min: (v) => (v ? minText(v) : 'no wait'),
  laundry_max_h: (v) => `${v} h`,
  laundry_settle: (v) => (v ? minText(v) : 'at once'),
};
const nextRung = (rungs, v, dir) => (dir > 0
  ? rungs.find((x) => x > v) ?? rungs[rungs.length - 1]
  : [...rungs].reverse().find((x) => x < v) ?? rungs[0]);

const MODE_WORDS = { continuous: 'Continuous', auto: 'Its own auto', manual: 'Its own target',
  clothes_dry: '👕 Clothes dry', silent: 'Silent', shoes_dry: 'Shoes dry' };
const MODE_HINTS = { continuous: 'runs flat out; the kitchen decides when it stops',
  auto: "the device's own idea of a good humidity", manual: 'stops by itself at the "stops at" humidity',
  clothes_dry: 'its laundry programme, strong and steady', silent: 'quiet and slow', shoes_dry: 'for shoes' };
const FAN_WORDS = { auto: 'Auto', lowest: 'Lowest', low: 'Low', medium: 'Medium', high: 'High' };
const SOURCE_WORDS = { auto: 'automatic', laundry: 'laundry', card: 'from the wall', device: 'by hand' };

function hoursText(hours) {
  const hs = [...new Set(hours || [])].sort((a, b) => a - b);
  if (hs.length === 24) return 'all day';
  const out = [];
  for (const h of hs) {
    const last = out[out.length - 1];
    if (last && last[1] === h) last[1] = h + 1; else out.push([h, h + 1]);
  }
  // A stretch over midnight (22–24 and 00–07) reads as one: 22–07.
  if (out.length > 1 && out[0][0] === 0 && out[out.length - 1][1] === 24) {
    const first = out.shift();
    out[out.length - 1][1] = first[1];
  }
  return out.map(([a, b]) => `${pad(a)}–${pad(b % 24)}`).join(', ');
}

export default {
  doc: null,
  subs: [],
  busy: false,
  err: '',
  pending: {},
  holding: false,

  init(ctx) {
    this.ctx = ctx;
    this.buildSheet();
    ctx.bus.on('dehumidifier', (doc) => this.take(doc));
    setInterval(() => { if (this.doc?.run) { this.changed(); this.renderNow(); } }, 30000);
  },

  take(doc) {
    if (!doc || typeof doc !== 'object' || !doc.settings) return;
    if (Object.keys(this.pending).length) doc = { ...doc, settings: { ...doc.settings, ...this.pending } };
    this.doc = doc;
    this.changed();
    this.render();
  },

  onDoc(fn) { this.subs.push(fn); },

  changed() {
    for (const fn of this.subs) {
      try { fn(this.doc); } catch (e) { console.error('dehumidifier subscriber failed', e); }
    }
  },

  settings() { return (this.doc && this.doc.settings) || {}; },
  configured() { return !!this.doc?.configured; },
  running() { return !!this.doc?.run || this.doc?.device?.power === 'on'; },
  tankFull() { return !!this.doc?.tank?.full; },
  laundryOn() { return this.doc?.run?.source === 'laundry'; },
  hum() { return this.doc?.reading?.value ?? null; },

  pausedFor() {
    const p = this.doc?.pause;
    if (!p) return null;
    if (p.until != null && p.until <= Date.now() / 1000) return null;
    return p;
  },

  roomName() {
    const rid = this.doc?.room;
    const tile = (this.ctx.config?.entities?.lights || []).find((l) => l.entity === rid);
    return (tile?.label || tile?.name || 'Storage').split(' · ')[0];
  },

  /* Under the name: what the automatic does. */
  summary() {
    const s = this.settings();
    if (!this.doc) return '';
    if (!s.auto) return `${this.roomName()} · automatic off`;
    return `${this.roomName()} · on ${s.start_at} % · off ${s.stop_at} %`;
  },

  /* The bold line: what it is doing now. */
  status() {
    const d = this.doc;
    if (!d) return '';
    if (!d.configured) return 'Not in Home Assistant yet';
    if (this.err) return this.err;
    if (!d.answering) return 'Not answering';
    const h = pct(this.hum());
    if (this.tankFull()) return `Tank full — empty it · ${h}`;
    const r = d.run;
    if (r) {
      if (r.source === 'laundry') return `👕 Drying laundry · ${h}`;
      if (r.source === 'card' && r.until) return `Running · ${h} · ${dur(r.until - Date.now() / 1000)} left`;
      return `Running · ${h} → ${this.settings().stop_at} %`;
    }
    if (d.other) return `On by hand · ${h}`;
    const p = this.pausedFor();
    if (p) return `Paused${p.until != null ? ` until ${hm(p.until)}` : ''} · ${h}`;
    if (!this.settings().auto) return `Off · ${h}`;
    return `${h} · ${d.next || 'resting'}`;
  },

  tone() {
    const d = this.doc;
    if (!d) return '';
    if (!d.configured || this.err || !d.answering || this.tankFull()) return 'warn';
    if (this.running()) return 'live';
    if (this.pausedFor() || !this.settings().auto) return 'off';
    return 'ok';
  },

  async post(path, body) {
    this.busy = true;
    this.err = '';
    this.changed();
    try {
      const r = await fetch(path, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
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
    if (this.err) setTimeout(() => { this.err = ''; this.changed(); this.render(); }, 15000);
  },

  async put(patch) {
    if (this.doc) {
      this.doc = { ...this.doc, settings: { ...this.settings(), ...patch } };
      this.changed();
      this.render();
    }
    try {
      const r = await fetch('/api/dehumidifier/settings', {
        method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(patch),
      });
      const body = await r.json().catch(() => ({}));
      if (r.ok && body.settings && this.doc) {
        this.doc = { ...this.doc, settings: body.settings };
        this.changed();
        this.render();
      }
    } catch { /* the next snapshot puts it right */ }
  },

  toggle() { return this.put({ auto: !this.settings().auto }); },
  run(hours) { return this.post('/api/dehumidifier/run', { hours }); },
  laundry() { return this.post('/api/dehumidifier/laundry', { on: !this.laundryOn() }); },
  stop() { return this.post('/api/dehumidifier/stop'); },
  find() { return this.post('/api/dehumidifier/find'); },

  /* The card's ⏸: paused until resumed, or — lit — resumed. */
  cardPause() {
    return this.post('/api/dehumidifier/pause', this.pausedFor() ? { on: false } : { on: true, hours: null });
  },

  /* ⏸ alone = until tapped again; 1–4 h = that long. The lit one resumes. */
  pause(hours) {
    const p = this.pausedFor();
    const same = p && (p.hours ?? null) === (hours ?? null);
    return this.post('/api/dehumidifier/pause', same || (p && hours === undefined)
      ? { on: false } : { on: true, hours: hours ?? null });
  },

  /* ------------------------------------------------------------ sheet -- */

  buildSheet() {
    const el = document.createElement('div');
    el.id = 'dh-sheet';
    el.className = 'sheet';
    el.innerHTML = `
      <header>
        <span class="sheet-icon" aria-hidden="true">💧</span>
        <div class="sheet-title">
          <h2>Dehumidifier</h2>
          <span class="sheet-status dh-now"></span>
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
    this.ctx.sheetkit.status(this.sheet.querySelector('.dh-now'), esc(this.status()), this.tone());
  },

  nudge(key, dir, row) {
    const now = this.pending[key] ?? this.settings()[key];
    const v = nextRung(RUNGS[key], now, dir);
    if (v === now) return;
    this.pending[key] = v;
    this.doc = { ...this.doc, settings: { ...this.settings(), [key]: v } };
    const val = row.querySelector('.dh-val');
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
      <span class="ls-set sheet-step dh-step" data-key="${key}">
        <button class="ls-btn dh-dir" data-dir="-1" aria-label="less">−</button>
        <b class="sheet-val dh-val">${esc(STEP_WORDS[key](value))}</b>
        <button class="ls-btn dh-dir" data-dir="1" aria-label="more">+</button>
      </span>`;
  },

  hoursRow(key, chosen) {
    const set = new Set(chosen || []);
    return `<div class="nt-hours sheet-grid sheet-hours">${Array.from({ length: 24 }, (_, h) => `
      <button class="ls-btn nt-h${set.has(h) ? ' on' : ''}" data-hours="${key}" data-hour="${h}"
        aria-pressed="${set.has(h)}">${pad(h)}</button>`).join('')}</div>`;
  },

  /* Each card's live note: beside its heading and on the rail. */
  notes() {
    const d = this.doc;
    const s = this.settings();
    const t = d.today || {};
    return {
      now: this.status(),
      auto: s.auto ? `on at ${s.start_at} % · off at ${s.stop_at} %` : 'off',
      source: (d.choices?.sources || []).find((c) => c.key === s.source)?.label || 'its own sensor',
      hours: hoursText(s.hours) || 'no hours',
      how: `${MODE_WORDS[s.mode] || s.mode} · fan ${FAN_WORDS[s.fan] || s.fan}`,
      quiet: s.quiet ? `${hoursText(s.quiet_hours) || 'no hours'} · fan ${FAN_WORDS[s.quiet_fan] || s.quiet_fan}` : 'off',
      laundry: this.laundryOn() ? 'drying now' : `until dry · at most ${s.laundry_max_h} h`,
      pause: this.pausedFor() ? (this.pausedFor().until != null ? `until ${hm(this.pausedFor().until)}` : 'until resumed') : 'not paused',
      runs: `today ${dur(t.s || 0)}${t.runs ? ` · ${t.runs} run${t.runs === 1 ? '' : 's'}` : ''}`,
      device: d.configured ? (d.answering ? 'found' : 'not answering') : 'not found yet',
    };
  },

  render() {
    if (!this.isOpen() || !this.doc || this.holding) return;
    const kit = this.ctx.sheetkit;
    const d = this.doc;
    const s = this.settings();
    const dev = d.device || {};
    const ch = d.choices || {};
    const n = this.notes();
    this.renderNow();
    if (!d.configured) {
      this.bodyEl.innerHTML = `${kit.sec('Not found yet', `
        <div class="ls-row">
          <span class="ls-label">Home Assistant has no dehumidifier yet
            <span class="db-hint">the kitchen looks for a dehumidifier from Home Assistant's own Midea integration (Settings →
              Devices &amp; services → Add integration → Midea). It looks again every five minutes, and within seconds of a new
              device being added. Every setting below the line is ready meanwhile.</span></span>
          <span class="ls-set"><button class="ls-btn dh-find"${this.busy ? ' disabled' : ''}>Look again</button></span>
        </div>`, { note: n.device })}${this.settingsSecs(kit, d, s, dev, ch, n)}`;
      this.wire();
      return;
    }
    const can = d.answering && !this.busy;
    const going = this.running();
    const readings = [
      ['Humidity it goes by', `${pct(this.hum())}`, d.reading?.label || ''],
      ['Its own sensor', pct(dev.humidity), ''],
      ['Temperature', dev.temperature == null ? '–' : `${dev.temperature.toFixed(1)}°`, ''],
      ['Tank', dev.tank_full ? 'FULL' : dev.tank == null ? '–' : `${Math.round(dev.tank)} %`, ''],
      ['Mode · fan', `${MODE_WORDS[dev.mode] || dev.mode || '–'} · ${FAN_WORDS[dev.fan] || dev.fan || '–'}`, ''],
    ];
    const run = d.run;
    let says = esc(this.status());
    const byHand = Object.entries(run?.by_hand || {}).map(([k, v]) => k === 'mode' ? `mode ${MODE_WORDS[v] || v}`
      : k === 'fan' ? `fan ${FAN_WORDS[v] || v}` : `target ${v} %`);
    if (run) says = `Running since <b>${hm(run.since)}</b> — ${run.hand ? 'started on the device, in its own mode and fan'
      : esc(SOURCE_WORDS[run.source] || run.source)}${
      run.source === 'laundry' ? `, until the air has stayed at or under <b>${s.stop_at} %</b> for ${esc(minText(s.laundry_settle))}${
        run.until ? ` (at most until ${hm(run.until)})` : ''}`
        : run.source === 'card' && run.until ? `, until <b>${hm(run.until)}</b>`
          : `, until <b>${s.stop_at} %</b>${s.min_run ? ` and at least ${esc(minText(s.min_run))}` : ''}`}.${
      byHand.length && !run.hand ? ` Pressed on the device, kept for this run: ${esc(byHand.join(', '))}.` : ''}`;
    else if (d.other) says = `On since <b>${hm(d.other.since)}</b>, started on the device or in its app — left alone${
      s.auto && s.hand_runs ? ' (the automatic takes it over only inside its hours, not paused)' : ''}.`;
    else if (!this.tankFull()) says = `${this.pausedFor() ? 'Paused' : s.auto ? 'Resting' : 'Off'} — the humidity it goes by is <b>${
      esc(pct(this.hum()))}</b>.`;
    this.bodyEl.innerHTML = `
      ${kit.sec('Now', `
        ${kit.sum(says, {
          next: this.tankFull() ? 'The tank is full: it has stopped. Empty it and it carries on by itself.'
            : !run && !d.other && s.auto ? esc(`Automatic: ${d.next || 'waiting'}.`) : '',
          ctl: kit.toggle(!!s.auto, 'data-put="auto" data-v="' + (!s.auto) + '"'), cap: 'Automatic' })}
        <div class="ls-row">
          <span class="ls-label">Run it now
            <span class="db-hint">👕 Laundry runs its clothes-dry programme until the laundry is dry (below); the hours
              run it that long whatever the humidity. Stop switches it off${s.auto ? `, and the automatic leaves it off
              for ${esc(minText(s.hold_min))}` : ''}.</span></span>
          <span class="ls-set">
            <button class="ls-btn dh-laundry${this.laundryOn() ? ' on' : ''}"${can && !this.tankFull() ? '' : ' disabled'}>👕 ${this.laundryOn() ? 'Laundry on' : 'Laundry'}</button>
            ${(ch.card || []).map((h) => `<button class="ls-btn dh-go" data-h="${h}"${can && !this.tankFull() ? '' : ' disabled'}>${h} h</button>`).join('')}
            <button class="ls-btn sheet-danger dh-stop${going ? ' on' : ''}"${going && can ? '' : ' disabled'}>■ Stop</button>
          </span>
        </div>
        <div class="ls-row">
          <span class="ls-label">What it reads now</span>
          <span class="ls-set dh-readings">${readings.map(([k, v, sub]) => `
            <span><small>${esc(k)}</small><b>${esc(v)}</b>${sub ? `<small>${esc(sub)}</small>` : ''}</span>`).join('')}</span>
        </div>`, { note: n.now })}
      ${this.settingsSecs(kit, d, s, dev, ch, n)}
      ${kit.sec('Pause', `
        <div class="ls-row">
          <span class="ls-label">Nothing starts by itself
            <span class="db-hint">a pause ends an automatic run that is going; laundry and the card's hours still work.
              The card's ⏸ is "until you resume".</span></span>
          <span class="ls-set sheet-seg">
            <button class="ls-btn dh-pz${this.pausedFor() && this.pausedFor().hours == null ? ' on' : ''}" data-h="">⏸ Until resumed</button>
            ${(ch.pause || []).map((h) => `<button class="ls-btn dh-pz${this.pausedFor()?.hours === h ? ' on' : ''}" data-h="${h}">${h} h</button>`).join('')}
            ${this.pausedFor() ? '<button class="ls-btn dh-resume">▶ Resume</button>' : ''}
          </span>
        </div>`, { note: n.pause })}
      ${kit.sec('Runs', this.runRows(d), { note: n.runs })}
      ${kit.sec('The device', `
        <div class="ls-row">
          <span class="ls-label">${esc(d.found?.name || 'Dehumidifier')}${d.found?.model ? ` <small>${esc(d.found.model)}</small>` : ''}
            <span class="db-hint">through Home Assistant's Midea integration, on the house's network (no cloud once set up).
              ${['humidifier', 'humidity', 'temperature', 'tank', 'tank_full', 'fan'].map((k) => `${k.replace('_', ' ')}: ${
                d.found?.[k] ? esc(d.found[k]) : '<b>not found</b>'}`).join(' · ')}.
              A full tank goes to Needs attention — how it shows, Telegram and the phones are set on House → Automation →
              House alerts ("Dehumidifier tank full"). Child lock, beep and the tank's own level are in Home Assistant.</span></span>
          <span class="ls-set"><button class="ls-btn dh-find"${this.busy ? ' disabled' : ''}>Look again</button></span>
        </div>`, { note: n.device })}`;
    this.wire();
  },

  /* The settings cards, also shown before the device is found. */
  settingsSecs(kit, d, s, dev, ch, n) {
    const modes = dev.modes?.length ? dev.modes : ch.modes || [];
    const fans = dev.fans?.length ? dev.fans.filter((f) => f !== 'off') : ch.fans || [];
    const places = (ch.sources || []).filter((c) => c.group !== 'sensor');
    const ones = (ch.sources || []).filter((c) => c.group === 'sensor');
    const chip = (c) => `
            <button class="ls-btn${s.source === c.key ? ' on' : ''}" data-put="source" data-v='${esc(JSON.stringify(c.key))}'
              aria-pressed="${s.source === c.key}">${esc(c.label)}${c.room ? ` <small>· ${esc(c.room)}</small>` : ''} <small>${pct(c.value)}</small></button>`;
    const seg = (key, list, words) => list.map((v) => `
      <button class="ls-btn${s[key] === v ? ' on' : ''}" data-put="${key}" data-v='${esc(JSON.stringify(v))}'
        aria-pressed="${s[key] === v}" title="${esc(MODE_HINTS[v] || '')}">${esc(words[v] || v)}</button>`).join('');
    return `
      ${kit.sec('Automatic', `
        <div class="ls-row">
          <span class="ls-label">Runs by itself
            <span class="db-hint">on when the humidity reaches the first level, off again at the second — the card's
              On/Off is this switch.</span></span>
          ${kit.toggle(!!s.auto, `data-put="auto" data-v="${!s.auto}"`)}
        </div>
        <div class="dh-auto${s.auto ? '' : ' nt-off'}">
          <div class="ls-row"><span class="ls-label">Starts at
            <span class="db-hint">humidity at or over this…</span></span>${this.stepper('start_at', s.start_at)}</div>
          <div class="ls-row"><span class="ls-label">…for at least
            <span class="db-hint">so a door opened for a minute, or a shower next door, is not a start.</span></span>${this.stepper('after_min', s.after_min)}</div>
          <div class="ls-row"><span class="ls-label">Stops at
            <span class="db-hint">at or under this, it switches off. Kept at least ${d.choices?.gap || 3} points under
              "starts at" — the gap is what stops it from switching on and off all the time.</span></span>${this.stepper('stop_at', s.stop_at)}</div>
          <div class="ls-row"><span class="ls-label">Runs at least
            <span class="db-hint">once started, even if the air is dry sooner: the compressor likes long runs.</span></span>${this.stepper('min_run', s.min_run)}</div>
          <div class="ls-row"><span class="ls-label">Rests at least
            <span class="db-hint">between two automatic runs.</span></span>${this.stepper('min_rest', s.min_rest)}</div>
          <div class="ls-row"><span class="ls-label">Longest run
            <span class="db-hint">then it rests, however humid it still is — for a room that never gets dry (a window
              open). No limit: the tank is its limit.</span></span>${this.stepper('max_run_h', s.max_run_h)}</div>
          <div class="ls-row"><span class="ls-label">Switched on at the device
            <span class="db-hint">at its own button or in its app: it keeps the mode and fan it came on with, and the
              automatic switches it off at "stops at" after "runs at least", counted from when it came on — while it
              may run (not paused, inside its hours). Left alone: it runs until somebody switches it off. A mode, fan or
              target pressed on the device during any run is kept until that run ends.</span></span>
            <span class="ls-set sheet-seg">${[[true, 'Follows the automatic'], [false, 'Left alone']].map(([v, w]) => `
              <button class="ls-btn${s.hand_runs === v ? ' on' : ''}" data-put="hand_runs" data-v="${v}" aria-pressed="${s.hand_runs === v}">${w}</button>`).join('')}</span></div>
          <div class="ls-row"><span class="ls-label">Switched off by hand
            <span class="db-hint">at its own button, in its app, or Stop here: the automatic waits this long before it
              starts it again.</span></span>${this.stepper('hold_min', s.hold_min)}</div>
        </div>`, { note: n.auto })}
      ${kit.sec('Humidity from', `
        <div class="ls-row">
          <span class="ls-label">The reading it goes by
            <span class="db-hint">its own sensor (in the Storage, where it stands), or any place with a humidity on the
              wall — the figure beside each is now.</span></span>
          <span class="ls-set sheet-chips">${places.map(chip).join('')}</span>
        </div>${ones.length ? `
        <div class="ls-row">
          <span class="ls-label">Or one sensor
            <span class="db-hint">a single sensor by itself, wherever it is — not its room's reading.</span></span>
          <span class="ls-set sheet-chips">${ones.map(chip).join('')}</span>
        </div>` : ''}`, { note: n.source })}
      ${kit.sec('In which hours', `
        <div class="ls-row">
          <span class="ls-label">The automatic may run
            <span class="db-hint">tap the hours: ${esc(hoursText(s.hours) || 'none chosen')}. An automatic run stops when
              its hours end; laundry and the card's hours do not ask.</span></span>
          ${this.hoursRow('hours', s.hours)}
        </div>`, { note: n.hours })}
      ${kit.sec('How it runs', `
        <div class="ls-row">
          <span class="ls-label">Mode
            <span class="db-hint">for automatic runs. Continuous is best here: the kitchen stops it at its level.</span></span>
          <span class="ls-set sheet-seg">${seg('mode', modes.filter((m) => m !== 'clothes_dry' && m !== 'shoes_dry'), MODE_WORDS)}</span>
        </div>
        <div class="ls-row">
          <span class="ls-label">Fan</span>
          <span class="ls-set sheet-seg">${seg('fan', fans, FAN_WORDS)}</span>
        </div>
        <div class="ls-row">
          <span class="ls-label">Where it won't take Auto
            <span class="db-hint">${(d.no_auto_fan || []).length ? `it did not take the fan's Auto in ${esc((d.no_auto_fan || [])
              .map((m) => MODE_WORDS[m] || m).join(', '))}: there it goes at this speed instead`
              : 'if the device does not take the fan\'s Auto in a mode, it goes at this speed there instead'}.</span></span>
          <span class="ls-set sheet-seg">${seg('fan_fixed', fans.filter((f) => f !== 'auto'), FAN_WORDS)}</span>
        </div>`, { note: n.how })}
      ${kit.sec('Quiet hours', `
        <div class="ls-row">
          <span class="ls-label">A slower fan at night
            <span class="db-hint">every run — automatic, laundry or the card's — goes at the fan below in these hours,
              and back when they end.</span></span>
          ${kit.toggle(!!s.quiet, `data-put="quiet" data-v="${!s.quiet}"`)}
        </div>
        <div class="${s.quiet ? '' : 'nt-off'}">
          <div class="ls-row"><span class="ls-label">Hours
            <span class="db-hint">${esc(hoursText(s.quiet_hours) || 'none chosen')}</span></span>${this.hoursRow('quiet_hours', s.quiet_hours)}</div>
          <div class="ls-row"><span class="ls-label">Fan then</span>
            <span class="ls-set sheet-seg">${seg('quiet_fan', fans, FAN_WORDS)}</span></div>
        </div>`, { note: n.quiet })}
      ${kit.sec('Laundry drying', `
        <div class="ls-row">
          <span class="ls-label">👕 on the card
            <span class="db-hint">wet laundry gives off water for hours; when the air has stayed at or under
              ${s.stop_at} % (the "stops at" level) for the time below, it is dry and it switches off.</span></span>
          <span class="ls-set"><button class="ls-btn dh-laundry${this.laundryOn() ? ' on' : ''}"${d.configured && d.answering && !this.tankFull() ? '' : ' disabled'}>👕 ${this.laundryOn() ? 'End laundry' : 'Start laundry'}</button></span>
        </div>
        <div class="ls-row"><span class="ls-label">Mode</span>
          <span class="ls-set sheet-seg">${seg('laundry_mode', modes.includes('clothes_dry') || !dev.modes?.length
            ? modes.filter((m) => ['clothes_dry', 'continuous'].includes(m)) : modes, MODE_WORDS)}</span></div>
        <div class="ls-row"><span class="ls-label">Fan</span>
          <span class="ls-set sheet-seg">${seg('laundry_fan', fans, FAN_WORDS)}</span></div>
        <div class="ls-row"><span class="ls-label">Dry when it has stayed under ${s.stop_at} % for</span>${this.stepper('laundry_settle', s.laundry_settle)}</div>
        <div class="ls-row"><span class="ls-label">At most
          <span class="db-hint">then it stops whatever the air says.</span></span>${this.stepper('laundry_max_h', s.laundry_max_h)}</div>`,
      { note: n.laundry })}`;
  },

  runRows(d) {
    const rows = [...(d.log || [])].reverse().slice(0, 12);
    const t = d.today || {};
    const day = (ts) => new Date(ts * 1000).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });
    return `
      <div class="ls-row"><span class="ls-label">Today <b>${esc(dur(t.s || 0))}</b>
        <span class="db-hint">${t.runs || 0} run${t.runs === 1 ? '' : 's'}. Every day's runs are on the chart's Dehumidifier
          tab, and shaded on its humidity chart (tap a reading in the top bar).</span></span>
        <span class="ls-set"><button class="ls-btn dh-chart">📈 On the chart</button></span></div>
      ${rows.length ? rows.map((r) => `
      <div class="ls-row dh-run">
        <span class="ls-label">${esc(day(r.a))} ${hm(r.a)}–${hm(r.b)} <small>${esc(dur(r.b - r.a))}</small>
          <span class="db-hint">${esc(SOURCE_WORDS[r.src] || r.src)}${r.h0 != null ? ` · ${pct(r.h0)} → ${pct(r.h1)}` : ''} · ${esc(r.end || '')}</span></span>
      </div>`).join('') : '<p class="db-hint">No runs yet.</p>'}`;
  },

  wire() {
    const kit = this.ctx.sheetkit;
    const b = this.bodyEl;
    b.querySelectorAll('.dh-find').forEach((x) => { x.onclick = () => this.find(); });
    b.querySelectorAll('.dh-chart').forEach((x) => { x.onclick = () => { this.close(); this.ctx.climate?.open?.('dh'); }; });
    b.querySelectorAll('.dh-laundry').forEach((x) => { x.onclick = () => this.laundry(); });
    b.querySelectorAll('.dh-go').forEach((x) => { x.onclick = () => this.run(Number(x.dataset.h)); });
    b.querySelector('.dh-stop')?.addEventListener('click', () => this.stop());
    b.querySelectorAll('.dh-pz').forEach((x) => {
      x.onclick = () => this.pause(x.dataset.h ? Number(x.dataset.h) : null);
    });
    b.querySelector('.dh-resume')?.addEventListener('click', () => this.post('/api/dehumidifier/pause', { on: false }));
    b.querySelectorAll('[data-put]').forEach((x) => {
      x.onclick = () => this.put({ [x.dataset.put]: JSON.parse(x.dataset.v) });
    });
    b.querySelectorAll('[data-hours]').forEach((x) => {
      x.onclick = () => {
        const key = x.dataset.hours;
        const set = new Set(this.settings()[key] || []);
        const h = Number(x.dataset.hour);
        if (set.has(h)) set.delete(h); else set.add(h);
        this.put({ [key]: [...set].sort((p, q) => p - q) });
      };
    });
    b.querySelectorAll('.dh-step').forEach((row) => {
      row.querySelectorAll('.dh-dir').forEach((btn) => {
        let wait = null;
        let rep = null;
        const step = () => this.nudge(row.dataset.key, Number(btn.dataset.dir), row);
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
        btn.onpointerdown = (e) => {
          e.preventDefault();
          this.holding = true;
          step();
          wait = setTimeout(() => { rep = setInterval(step, 140); }, 450);
        };
        btn.onpointerup = end;
        btn.onpointerleave = end;
        btn.onpointercancel = end;
        btn.onkeydown = (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); step(); } };
      });
    });
    kit.sync(this.sheet);
  },
};
