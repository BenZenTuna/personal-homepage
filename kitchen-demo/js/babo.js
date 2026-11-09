/* Babo Alarm — its document, its card's words, its settings sheet, the
   banner and the sound.

   The kitchen window is to be shut while the house sleeps. The server
   (backend/app/babo.py) watches the window's contact sensor and the phones,
   and while the window is open in an armed night and nobody is up yet it
   says so: `alarm` in its document. Every screen showing the dashboard then
   sounds the chosen alarm over and over and shows a banner with Stop, on
   whichever view is up; a phone's page shows the banner and stays silent.
   The alarm is a state, not an event: it sounds exactly while the document
   says so, so a wall woken for it, or reloaded, joins in at once.

   The card is drawn by the House panel on Automation (ha.js,
   buildAuto), beside the clock's. This is ctx.babo.

   Since 2026-10-18 the sheet also uploads sounds of the household's own and
   holds the Hue switches' rules (switchsound.py): a button pressed or held
   plays one of these sounds on every screen that is not a phone — its own
   banner with Stop, its own player, and never over the alarm itself. */

const esc = (s) => String(s ?? '').replace(/[&<>"]/g,
  (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];   // Monday 0, as Python counts
const FROM = ['21:00', '22:00', '23:00', '00:00', '01:00'];
const UNTIL = ['08:00', '09:00', '10:00', '11:00'];
const AWAKE_FROM = ['04:00', '05:00', '06:00', '07:00'];
// The doorbell's four flashes (blink.py STYLES), the same words.
const FLASH_STYLES = [['blink', 'Blink'], ['flash', 'Flash'], ['fade', 'Fade'], ['breathe', 'Breathe']];

const hm = (iso) => (iso ? String(iso).slice(11, 16) : '');
const clock = (t) => {
  const d = new Date(t * 1000);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
};

/* "Mon–Fri", "every day", "Sat, Sun", "no days". */
function daysText(days) {
  const on = [...new Set(days || [])].sort((a, b) => a - b);
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

export default {
  /* Every room the dashboard knows, both tabs — the doorbell's list. */
  lightRooms() {
    return (this.ctx?.config?.entities?.lights || []).filter((l) => l && l.entity);
  },

  doc: null,
  subs: [],
  audio: null,
  previewing: false,
  sw: null,            // switchsound.py's document
  bell: null,          // the player for a switch's sound
  bellId: null,        // the press this screen has played (or let pass)
  draft: null,         // a switch rule being put together in the sheet

  init(ctx) {
    this.ctx = ctx;
    this.buildSheet();
    this.buildBanner();
    ctx.voice?.onChange(() => this.render());
    ctx.bus.on('babo', (doc) => {
      if (!doc || typeof doc !== 'object' || !doc.settings) return;
      this.doc = doc;
      this.sound();
      this.paintBanner();
      this.changed();
      this.render();
    });
    ctx.bus.on('switch_sounds', (doc) => {
      if (!doc || typeof doc !== 'object' || !doc.settings) return;
      // A press while a rule is being put together is the button it is for
      // (2026-10-18: Alex held Brighter, chose a sound, and Add did nothing —
      // no button had been tapped in the sheet).
      const dr = this.draft;
      const l = doc.last;
      if (dr && l && l.at > dr.since) {
        const i = (doc.switches || []).findIndex((sw) => sw.buttons.some((b) => b.entity === l.entity));
        if (i >= 0) Object.assign(dr, { sw: i, entity: l.entity, press: l.press, since: l.at });
      }
      this.sw = doc;
      this.ring();
      this.render();
    });
  },

  onDoc(fn) { this.subs.push(fn); },

  changed() {
    for (const fn of this.subs) {
      try { fn(this.doc); } catch (e) { console.error('babo subscriber failed', e); }
    }
  },

  settings() { return (this.doc && this.doc.settings) || {}; },

  soundFile(id) {
    return ((this.doc?.sounds || []).find((x) => x.id === id) || {}).file || '';
  },

  /* ---------------------------------------------------------- the sound -- */

  /* Sounding exactly while the server says so — and never on a phone. */
  sound() {
    const on = !!this.doc?.alarm && !this.ctx.phone;
    if (on) {
      this.hushBell();                    // the alarm is louder news
      const file = this.soundFile(this.settings().sound);
      if (!file) return;
      try {
        const el = (this.audio ||= new Audio());
        if (this.previewing || !el.src.endsWith(file) || (el.paused && !this.voicing)) {
          this.previewing = false;
          // Round and round — with its text read between rounds, if it has
          // one (2026-10-18): the sound, the words, the sound…
          el.loop = !this.ctx.voice?.file('babo');
          el.onended = el.loop ? null : async () => {
            this.voicing = true;
            await this.ctx.voice?.play('babo');
            this.voicing = false;
            if (this.doc?.alarm && !this.previewing) { el.currentTime = 0; Promise.resolve(el.play()).catch(() => {}); }
          };
          el.volume = 1;
          if (!el.src.endsWith(file)) el.src = file;
          Promise.resolve(el.play()).catch(() => {});
        }
      } catch { /* no audio on this machine */ }
    } else if (!this.previewing) {
      this.hush();
    }
  },

  hush() {
    if (this.voicing) { this.voicing = false; this.ctx.voice?.stop(); }
    const el = this.audio;
    if (!el) return;
    try { el.pause(); el.currentTime = 0; } catch { /* gone */ }
  },

  /* A sound chosen in the sheet is heard once, on this screen only. */
  preview(id) {
    if (this.doc?.alarm) return;          // the alarm itself is louder news
    const file = this.soundFile(id);
    if (!file) return;
    try {
      const el = (this.audio ||= new Audio());
      el.loop = false;
      el.src = file;
      this.previewing = true;
      el.onended = null;
      el.onended = () => { this.previewing = false; };
      Promise.resolve(el.play()).catch(() => {});
    } catch { /* no audio */ }
  },

  /* ------------------------------------------------- a switch's sound -- */

  /* Playing exactly what the server says is playing: a new press starts,
     none (or another) stops it. A screen that hears of a press late — woken,
     reloaded — lets it pass; a phone never plays. */
  ring() {
    const p = this.sw?.playing;
    if (!p) { this.hushBell(); return; }
    if (p.id === this.bellId) return;
    this.hushBell();
    this.bellId = p.id;
    if (this.ctx.phone || this.doc?.alarm || p.age > (this.sw.late_s || 30)) return;
    // The rule's text, read after the sound — between rounds when it plays
    // until stopped (2026-10-18).
    const owner = Array.isArray(p.rule) ? `switch:${p.rule[0]}:${p.rule[1]}` : '';
    const speaks = owner && this.ctx.voice?.file(owner);
    try {
      const el = (this.bell ||= new Audio());
      el.loop = !!p.loop && !speaks;
      el.volume = 1;
      el.src = p.file;
      el.onended = async () => {
        if (speaks && this.bellId === p.id) {
          this.bellVoicing = true;
          await this.ctx.voice.play(owner);
          this.bellVoicing = false;
          if (p.loop && this.bellId === p.id && this.sw?.playing?.id === p.id) {
            el.currentTime = 0;
            Promise.resolve(el.play()).catch(() => {});
            return;
          }
        }
        this.paintBell();
      };
      Promise.resolve(el.play()).catch(() => {});
    } catch { /* no audio on this machine */ }
    this.paintBell(p);
  },

  hushBell() {
    if (this.bellVoicing) { this.bellVoicing = false; this.ctx.voice?.stop(); }
    const el = this.bell;
    if (el) {
      try { el.pause(); el.currentTime = 0; } catch { /* gone */ }
    }
    this.paintBell();
  },

  paintBell(p = null) {
    if (!this.bellBanner) {
      const el = document.createElement('div');
      el.id = 'sw-banner';
      el.hidden = true;
      el.setAttribute('role', 'status');
      el.innerHTML = `
        <span class="bb-icon" aria-hidden="true">🔔</span>
        <span class="bb-txt"><b class="sw-what"></b><span class="sw-who"></span></span>
        <button class="bb-stop">Stop</button>`;
      document.body.appendChild(el);
      el.querySelector('.bb-stop').onclick = () => this.stopBell();
      this.bellBanner = el;
    }
    if (p) {                              // just started here
      this.bellBanner.querySelector('.sw-what').textContent = p.name;
      this.bellBanner.querySelector('.sw-who').textContent = `${p.label}${p.loop ? ' — over and over until Stop' : ''}`;
      this.bellBanner.hidden = false;
      return;
    }
    this.bellBanner.hidden = !this.bellVoicing && !(this.bell && !this.bell.paused && !this.bell.ended);
  },

  async stopBell() {
    this.hushBell();
    try { await fetch('/api/switch-sounds/stop', { method: 'POST' }); } catch { /* next snapshot */ }
  },

  async putSw(patch) {
    if (this.sw) {
      this.sw = { ...this.sw, settings: { ...this.sw.settings, ...patch } };
      this.render();
    }
    try {
      const r = await fetch('/api/switch-sounds/settings', {
        method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(patch),
      });
      const body = await r.json().catch(() => ({}));
      if (r.ok && body.settings && this.sw) this.sw = { ...this.sw, settings: body.settings };
      else if (!r.ok) this.swError = body.error || `the kitchen said ${r.status}`;
      this.render();
    } catch { /* the next snapshot puts it right */ }
  },

  /* "Kitchen · Dimmer, held". */
  buttonText(entity, press) {
    for (const sw of this.sw?.switches || []) {
      const b = (sw.buttons || []).find((x) => x.entity === entity);
      if (b) return `${sw.label} · ${b.name}${press === 'hold' ? ', held' : ''}`;
    }
    return entity;
  },

  soundName(id) {
    return ((this.doc?.sounds || []).find((x) => x.id === id) || {}).label || id;
  },

  /* --------------------------------------------------------- the banner -- */

  buildBanner() {
    const el = document.createElement('div');
    el.id = 'bb-banner';
    el.hidden = true;
    el.setAttribute('role', 'alert');
    el.innerHTML = `
      <span class="bb-icon" aria-hidden="true">🪟</span>
      <span class="bb-txt"><b>Babo Alarm</b><span class="bb-why"></span></span>
      <button class="bb-stop">Stop</button>`;
    document.body.appendChild(el);
    this.banner = el;
    el.querySelector('.bb-stop').onclick = () => this.stop();
  },

  paintBanner() {
    const a = this.doc?.alarm;
    this.banner.hidden = !a;
    if (!a) return;
    this.banner.querySelector('.bb-why').textContent = a.test
      ? 'a test — it stops by itself in a few seconds'
      : `the kitchen window has been open since ${this.doc.window?.since ? clock(this.doc.window.since) : 'just now'} — shut it, or Stop`;
  },

  /* ---------------------------------------------------------- the card -- */

  /* "Mon–Fri 23–08": the card has the width for that and no more. */
  summary() {
    const s = this.settings();
    if (!this.doc) return '';
    const h = (t) => (String(t).endsWith(':00') ? String(t).slice(0, 2) : t);
    const days = daysText(s.days);
    return `${days.includes(', ') && days.length > 8 ? `${(s.days || []).length} days` : days} ${h(s.from)}–${h(s.until)}`;
  },

  /* The card's status line: what is true just now. */
  status() {
    const d = this.doc;
    if (!d) return '';
    if (d.alarm) return d.alarm.test ? 'Testing…' : 'ALARM · window open';
    const w = d.window || {};
    const win = !w.entity ? 'No sensor' : !w.seen ? 'No word yet'
      : w.open ? 'Window open' : 'Window shut';
    if (!d.settings.enabled) return `Off · ${win.toLowerCase()}`;
    if (d.armed) return `Watching · ${win.toLowerCase()}`;
    return win;
  },

  toggle() { this.put({ enabled: !this.settings().enabled }); },

  async put(patch) {
    if (this.doc) {
      this.doc = { ...this.doc, settings: { ...this.settings(), ...patch } };
      this.changed();
      this.render();
    }
    try {
      const r = await fetch('/api/babo/settings', {
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

  async stop() {
    this.hush();
    try { await fetch('/api/babo/stop', { method: 'POST' }); } catch { /* next snapshot */ }
  },

  async test() {
    try { await fetch('/api/babo/test', { method: 'POST' }); } catch { /* nothing sounded */ }
  },

  /* --------------------------------------------------------- the sheet -- */

  buildSheet() {
    const el = document.createElement('div');
    el.id = 'bb-sheet';
    el.className = 'sheet';   // the settings window kit (app.css)
    el.innerHTML = `
      <header>
        <span class="sheet-icon" aria-hidden="true">🪟</span>
        <div class="sheet-title">
          <h2>Babo Alarm</h2>
          <span class="sheet-status bb-now"></span>
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

  /* One phone's line: up this morning, or which sensor it is waiting on. */
  phoneLine(p) {
    const sig = p.signals || [];
    const heard = sig.filter((x) => x.state != null && x.state !== 'unavailable' && x.state !== 'unknown');
    const words = (x) => (x.entity.includes('device_locked') ? 'unlocked'
      : x.entity.includes('charger') ? 'taken off its charger' : `${x.entity} → ${x.to}`);
    const how = sig.map(words).join(' or ');
    if (!heard.length) {
      return `${esc(p.label)}: <b class="bb-warn">no word from it yet</b> — switch on "Device locked"
        in the Home Assistant app on this phone (Settings → Companion app → Manage sensors).`;
    }
    const missing = sig.filter((x) => !heard.includes(x));
    const up = p.awake ? `<b class="bb-ok">up</b> — picked up at ${clock(p.touched)}`
      : 'not picked up yet this morning';
    return `${esc(p.label)}: ${up}. Counts when ${esc(how)}.${missing.length
      ? ` <span class="bb-warn">${esc(missing.map(words).join(', '))}: no word from it yet — switch on
        "Device locked" in the Home Assistant app on this phone (Settings → Companion app →
        Manage sensors).</span>` : ''}`;
  },

  /* The window, in a sentence: shut or open, and its battery. */
  windowLine(d) {
    const w = d.window || {};
    return !w.entity ? 'No window sensor is set up (entities.json, babo).'
      : !w.seen ? 'No word from the window sensor yet — is it paired and in range?'
      : `The window is ${w.open ? '<b class="bb-warn">open</b>' : 'shut'}${w.battery != null
        ? ` · its battery ${esc(w.battery)} %` : ''}.`;
  },

  /* The sheet's header line and its tone (the settings window kit). */
  headLine(d, s) {
    if (d.alarm) return [`<b>${esc(this.status())}</b>`, d.alarm.test ? 'live' : 'warn'];
    if (!s.enabled) return ['<b>Off</b>', 'off'];
    if (d.armed) return [`<b>Watching</b> until ${esc(hm(d.night?.end))}`, 'live'];
    if (d.next) return [`<b>On</b> · next: from ${esc(hm(d.next.start))} until ${esc(hm(d.next.end))}`, 'ok'];
    return ['<b>On</b> · no days chosen', 'warn'];
  },

  /* "Fri 21:00", from the server's local "2026-10-23T21:00". */
  dayHm(iso) {
    const t = new Date(iso);
    return Number.isNaN(t.getTime()) ? hm(iso)
      : `${t.toLocaleDateString('en-GB', { weekday: 'short' })} ${hm(iso)}`;
  },

  /* The state sentence at the top (the settings window kit): what the
     window and the night are doing now, with the alarm's switch beside it. */
  sumCard(d, s) {
    const kit = this.ctx.sheetkit;
    const ctl = kit.toggle(!!s.enabled, `data-put="enabled" data-v="${s.enabled ? 'false' : 'true'}"`);
    const cap = 'Babo Alarm';
    const when = `from <b>${esc(s.from)}</b> until <b>${esc(s.until)}</b> on the nights before <b>${esc(daysText(s.days))}</b>`;
    const win = this.windowLine(d);
    if (!s.enabled) {
      return kit.sum('Off — an open kitchen window sounds no alarm.', {
        next: `When it is on: ${when}. ${win}`, ctl, cap, off: true,
      });
    }
    if (d.alarm) {
      return kit.sum(d.alarm.test ? '<b>A test</b> is sounding — it stops by itself in a few seconds.'
        : `<b class="bb-warn">The alarm is sounding</b>: the kitchen window has been open since <b>${
          d.window?.since ? clock(d.window.since) : 'just now'}</b>.`, { next: win, ctl, cap });
    }
    if (!(s.days || []).length) {
      return kit.sum('On, but no mornings are chosen, so no night is watched.', { next: win, ctl, cap });
    }
    if (d.armed) {
      return kit.sum(`Watching the kitchen window until <b>${esc(hm(d.night?.end))}</b>: open, it sounds the alarm.`, {
        next: `${d.up ? 'The house is up this morning, so an open window sounds nothing. ' : ''}${win}`, ctl, cap,
      });
    }
    return kit.sum(`An open kitchen window sounds the alarm ${when}.`, {
      next: `${d.next ? `Next: <b>${esc(this.dayHm(d.next.start))}</b> until <b>${esc(this.dayHm(d.next.end))}</b>. ` : ''}${win}`,
      ctl, cap,
    });
  },

  /* Each card's live note, beside its heading and under its name on the rail. */
  notes(d, s) {
    const people = (d.telegram_people || []).filter((p) => (s.telegram || []).includes(p.id));
    const n = (s.blink_rooms || []).length;
    return {
      when: `${daysText(s.days)} · ${s.from}–${s.until}`,
      up: `${s.phones === 'both' ? 'both phones' : 'either phone'} · after ${s.awake_from}`,
      sound: `${this.soundName(s.sound)}${this.ctx.voice?.of('babo') ? ' · then its text' : ''}`,
      tell: [people.length ? `✈ ${people.map((p) => p.label).join(', ')}` : 'no Telegram',
        !s.blink ? 'no flash' : n ? `${n} ${n === 1 ? 'room' : 'rooms'} flash` : 'flash: no rooms yet'].join(' · '),
    };
  },

  render() {
    if (!this.isOpen() || !this.doc) return;
    const kit = this.ctx.sheetkit;
    const d = this.doc;
    const s = this.settings();
    const pick = (v, want) => (v === want ? ' on' : '');
    // One of N: a joined bar; `none` marks the choice that is "none".
    const bar = (key, list, label, cls = '') => `<span class="ls-set sheet-seg${cls}">${list.map((v) => `
      <button class="ls-btn${pick(s[key], v)}" data-put="${key}" data-v='"${esc(v)}"'
              aria-pressed="${s[key] === v}">${esc(label(v))}</button>`).join('')}</span>`;
    const days = new Set(s.days || []);
    kit.status(this.sheet.querySelector('.bb-now'), ...this.headLine(d, s));
    const last = d.last ? `Last sounded ${new Date(d.last.at * 1000).toLocaleString('en-GB',
      { weekday: 'short', hour: '2-digit', minute: '2-digit' })}${d.last.test ? ' (a test)' : ''}.`
      : 'Not sounded since the kitchen last started.';
    const n = this.notes(d, s);
    const people = d.telegram_people || [];
    this.bodyEl.innerHTML = `
      ${this.sumCard(d, s)}

      ${kit.sec('When', `
        <p class="sheet-note">The kitchen window should be shut while everybody sleeps. If it
          is open between the times below, on the nights before the chosen days, the wall sounds
          an alarm — until it is shut, Stop is pressed, or the house is up: people pick up their
          phones when they wake. A sleeping wall is woken for it; phones stay silent.</p>
        <div class="ls-row">
          <span class="ls-label">From
            <span class="db-hint">the evening before a chosen morning.</span></span>
          ${bar('from', FROM, (t) => t, ' sheet-hourbar')}
        </div>
        <div class="ls-row">
          <span class="ls-label">Until
            <span class="db-hint">the morning's end: after this the window may be open.</span></span>
          ${bar('until', UNTIL, (t) => t, ' sheet-hourbar')}
        </div>
        <div class="ls-row">
          <span class="ls-label">Mornings
            <span class="db-hint">tap a day to take it in or out — ${esc(daysText(s.days))}. Monday
              chosen means Sunday night into Monday morning.</span></span>
          <span class="ls-set sheet-grid sheet-days">${DAYS.map((x, i) => `
            <button class="ls-btn${days.has(i) ? ' on' : ''}" data-day="${i}"
                    aria-pressed="${days.has(i)}">${x}</button>`).join('')}
          </span>
        </div>`, { note: n.when })}

      ${kit.sec('In the morning', `
        <div class="ls-row">
          <span class="ls-label">The house is up when
            <span class="db-hint">a phone counts once it is picked up — unlocked, or taken off its
              charger — after the time on the right, so a look at the clock at three in the morning
              does not count.</span></span>
          <div class="sheet-ctl">
            ${bar('phones', ['both', 'either'], (v) => (v === 'both' ? 'Both phones' : 'Either phone'))}
            ${bar('awake_from', AWAKE_FROM, (t) => `after ${t}`, ' sheet-hourbar bb-awake')}
          </div>
          ${(d.phones || []).length ? `<div class="sheet-wide bb-phones">${(d.phones || []).map((p) => `
            <p class="sheet-line">${this.phoneLine(p)}</p>`).join('')}</div>` : ''}
        </div>`, { note: n.up })}

      ${kit.sec('Sound', `
        <div class="ls-row">
          <span class="ls-label"><span class="db-hint sheet-lead">tap one to choose it and hear it on this
            screen. It plays over and over while the alarm is on. Quiet hours do not apply. ＋ Upload
            adds a sound file of your own (mp3, m4a, ogg, wav; up to 8 MB) — for the alarm and for the
            switches below; ✕ deletes one of yours. 🗣 reads a text between the rounds.</span></span>
          <div class="sheet-ctl">
            <span class="ls-set sheet-seg">${(d.sounds || []).map((x) => `
              <button class="ls-btn${pick(s.sound, x.id)}" data-sound="${esc(x.id)}" aria-pressed="${s.sound === x.id}">
                <span class="db-play" aria-hidden="true">▶</span> ${esc(x.label)}</button>${x.uploaded
                ? this.ctx.soundlib?.delBtn(x.id, { label: x.label }) || '' : ''}`).join('')}</span>
            <span class="sheet-acts">
              ${this.ctx.soundlib?.uploadBtn('babo') || ''}
              ${this.ctx.voice?.chip('babo') || ''}
            </span>
          </div>
          ${this.ctx.voice?.editor('babo', { hint: 'read aloud after each round of the alarm, until it stops — e.g. "Babo, please close the kitchen window"' }) || ''}
        </div>`, { note: n.sound })}

      ${kit.sec('Tell the house', `
        <div class="ls-row">
          <span class="ls-label">Also on Telegram
            <span class="db-hint">the alarm also goes to these people's phones when it starts — the test too, marked Test. A person whose Telegram is not linked yet is dashed and cannot be chosen until it is linked
              under House → Automation → Telegram.</span></span>
          ${people.length ? `<span class="ls-set sheet-chips">${people.map((p) => {
            const on = (s.telegram || []).includes(p.id);
            return `
            <button class="ls-btn${on ? ' on' : ''}${p.ready ? '' : ' sheet-na'}" data-tgp="${esc(p.id)}"
                    aria-pressed="${on}"${p.ready || on ? '' : ' disabled'}${p.ready ? ''
                      : ' title="link their Telegram under House → Automation → Telegram"'}>✈ ${esc(p.label)}</button>`;
          }).join('')}</span>` : '<span class="sheet-line">no Telegram bot set up</span>'}
        </div>
        <div class="ls-row">
          <span class="ls-label">Flash the lights while it sounds
            <span class="db-hint">the chosen rooms blink without a pause for as long as the alarm sounds —
              for a bedroom that cannot hear the kitchen. Each goes back to exactly how it was. The Hue
              switches' 💡 Flash (below) uses these rooms and this style too, for as long as its sound plays.</span>
            ${d.flash_error ? `<span class="db-warn">${esc(d.flash_error)}</span>` : ''}
            ${s.blink && !(s.blink_rooms || []).length ? '<span class="db-warn">No rooms chosen yet — '
              + 'pick one or more below, or nothing will flash.</span>' : ''}</span>
          <div class="sheet-ctl">
            ${kit.toggle(!!s.blink, `data-put="blink" data-v="${s.blink ? 'false' : 'true'}"`)}
            ${s.blink ? `<div><span class="sheet-cap">Rooms</span><span class="ls-set sheet-chips">${this.lightRooms().map((l) => `
              <button class="ls-btn bb-room${(s.blink_rooms || []).includes(l.entity) ? ' on' : ''}"
                      data-room="${esc(l.entity)}" aria-pressed="${(s.blink_rooms || []).includes(l.entity)}">
                <span aria-hidden="true">${esc(l.emoji || '💡')}</span> ${esc(l.label || l.entity)}</button>`).join('')}</span></div>
            <div><span class="sheet-cap">How they flash</span>${bar('blink_style', FLASH_STYLES.map(([v]) => v),
              (v) => (FLASH_STYLES.find(([k]) => k === v) || [v, v])[1])}</div>` : ''}
          </div>
        </div>`, { note: n.tell })}

      ${kit.sec('Try it', `
        <div class="ls-row">
          <span class="ls-label"><span class="db-hint sheet-lead">sounds it on every screen for twenty seconds,
            whatever the window and the time — and flashes the rooms, if that is on. Stop, here, on the
            banner or on any screen, ends it.</span>
            <span class="pb-last">${esc(last)}</span></span>
          <span class="ls-set">
            ${d.alarm
              ? '<button class="ls-btn sheet-danger on bb-stop2">Stop</button>'
              : '<button class="ls-btn sheet-primary bb-try">▶ Sound it on the wall now</button>'}
          </span>
        </div>`)}

      ${this.switchRows()}`;

    this.bodyEl.querySelectorAll('[data-put]').forEach((btn) => {
      btn.onclick = () => this.put({ [btn.dataset.put]: JSON.parse(btn.dataset.v) });
    });
    this.bodyEl.querySelectorAll('[data-day]').forEach((btn) => {
      btn.onclick = () => {
        const n = Number(btn.dataset.day);
        const set = new Set(s.days || []);
        if (set.has(n)) set.delete(n); else set.add(n);
        this.put({ days: [...set].sort((a, b) => a - b) });
      };
    });
    this.bodyEl.querySelectorAll('[data-sound]').forEach((btn) => {
      btn.onclick = () => { this.put({ sound: btn.dataset.sound }); this.preview(btn.dataset.sound); };
    });
    this.bodyEl.querySelectorAll('[data-tgp]').forEach((btn) => {
      btn.onclick = () => {
        const set = new Set(this.settings().telegram || []);
        if (set.has(btn.dataset.tgp)) set.delete(btn.dataset.tgp); else set.add(btn.dataset.tgp);
        this.put({ telegram: (this.doc?.telegram_people || []).map((p) => p.id).filter((i) => set.has(i)) });
      };
    });
    this.bodyEl.querySelectorAll('.bb-room').forEach((btn) => {
      btn.onclick = () => {
        const have = s.blink_rooms || [];
        const room = btn.dataset.room;
        this.put({ blink_rooms: have.includes(room) ? have.filter((r) => r !== room) : [...have, room] });
      };
    });
    // An upload is the alarm's sound at once, unless a switch rule is being made.
    this.ctx.soundlib?.wire(this.bodyEl, {
      onUploaded: (r) => { if (this.draft) { this.draft.sound = r.id; this.render(); } else this.put({ sound: r.id }); },
    });
    this.ctx.voice?.wire(this.bodyEl, () => this.render());
    this.wireSwitches();
    this.bodyEl.querySelector('.bb-try')?.addEventListener('click', () => this.test());
    this.bodyEl.querySelector('.bb-stop2')?.addEventListener('click', () => this.stop());
    kit.sync(this.sheet);
  },

  /* ------------------------------------------------ the switches' card -- */

  switchRows() {
    const w = this.sw;
    if (!w) return '';
    const kit = this.ctx.sheetkit;
    const set = w.settings || {};
    const pick = (v, want) => (v === want ? ' on' : '');
    const rules = set.rules || [];
    const last = w.last ? `Last press: <b>${esc(w.last.label)}</b> at ${clock(w.last.at)}${
      w.last.played ? ' — it played its sound' : ' — no sound for it'}.` : 'No press seen since the kitchen last started.';
    const sounds = this.doc?.sounds || [];
    const dr = this.draft;
    // A step of the builder: its caption, then its choices in one bar.
    const step = (cap, btns) => `<div class="sheet-band"><span class="snd-cap">${cap}</span>
      <span class="ls-set sheet-seg">${btns}</span></div>`;
    let builder = '';
    if (dr) {
      const sw = (w.switches || [])[dr.sw];
      const presses = sw?.kind === 'tap' ? [['short', 'Press']] : [['short', 'Press'], ['hold', 'Hold']];
      builder = `
        <div class="sw-draft sheet-wide">
          <span class="sw-step">Press or hold the switch's button now and it is filled in here — or tap them:</span>
          ${step('Switch', (w.switches || []).map((x, i) => `
            <button class="ls-btn${pick(dr.sw, i)}" data-dsw="${i}" aria-pressed="${dr.sw === i}">${esc(x.label)}</button>`).join(''))}
          ${sw ? `${step('Button', sw.buttons.map((b) => `
            <button class="ls-btn${pick(dr.entity, b.entity)}" data-dbtn="${esc(b.entity)}"
                    aria-pressed="${dr.entity === b.entity}">${esc(b.name)}</button>`).join(''))}
          ${step('How', presses.map(([v, nm]) => `
            <button class="ls-btn${pick(dr.press, v)}" data-dpress="${v}" aria-pressed="${dr.press === v}">${nm}</button>`).join(''))}` : ''}
          ${step('Sound', sounds.map((x) => `
            <button class="ls-btn${pick(dr.sound, x.id)}" data-dsound="${esc(x.id)}" aria-pressed="${dr.sound === x.id}">
              <span class="db-play" aria-hidden="true">▶</span> ${esc(x.label)}</button>`).join(''))}
          ${step('Plays', `
            <button class="ls-btn${pick(dr.repeat, 'once')}" data-drep="once" aria-pressed="${dr.repeat === 'once'}">Once</button>
            <button class="ls-btn${pick(dr.repeat, 'loop')}" data-drep="loop" aria-pressed="${dr.repeat === 'loop'}">Until stopped</button>`)}
          <span class="ls-set sw-acts">
            <button class="ls-btn sheet-primary sw-add"${dr.entity && dr.press && dr.sound ? '' : ' disabled'}>${
              !dr.entity ? 'Add — choose a button first' : !dr.sound ? 'Add — choose a sound first' : 'Add'}</button>
            <button class="ls-btn sw-cancel">Cancel</button>
          </span>
        </div>`;
    }
    return kit.sec('Hue switches', `
      <div class="ls-row">
        <span class="ls-label">A button plays a sound
          <span class="db-hint">a press or a hold of a Hue switch's button plays one of the sounds above
            on the wall and every computer showing the dashboard (never on phones), with Stop on a banner;
            the same press again stops it too. The switch still does its own job in the Hue app as well —
            a hold of Dimmer also dims the room — so pick a press the Hue app does nothing with.</span>
          <span class="pb-last">${last}</span>
          ${this.swError ? `<span class="db-warn">${esc(this.swError)}</span>` : ''}
          ${w.flash_error ? `<span class="db-warn">${esc(w.flash_error)}</span>` : ''}</span>
        ${kit.toggle(!!set.enabled, `data-swon="${set.enabled ? 'false' : 'true'}"`)}
      </div>
      <div class="sw-rules">${rules.map((r, i) => `
        <div class="ls-row sw-rule${set.enabled ? '' : ' nt-off'}">
          <span class="ls-label">${esc(this.buttonText(r.entity, r.press))}
            <span class="db-hint">→ ${esc(this.soundName(r.sound))}, ${r.repeat === 'loop' ? 'over and over until stopped' : 'once'}${
              r.flash !== false ? `, flashing ${(w.flash_rooms || []).length ? 'the rooms chosen above' : 'no rooms yet — choose them under Flash the lights above'}` : ''}</span></span>
          <div class="sheet-ctl sheet-across">
            <button class="ls-btn" data-swtry="${i}">▶ Try</button>
            ${kit.toggle(r.flash !== false, `data-swflash="${i}"
              title="flash the rooms chosen under Flash the lights, as it plays"`, { words: ['💡 Flash', '💡 Flash'] })}
            ${this.ctx.voice?.chip(`switch:${r.entity}:${r.press}`) || ''}
            <button class="ls-btn sheet-danger bb-del" data-swdel="${i}">Remove</button>
          </div>
          ${this.ctx.voice?.editor(`switch:${r.entity}:${r.press}`, { hint: 'read aloud after the sound — between the rounds when it plays until stopped' }) || ''}
        </div>`).join('')}
        <div class="ls-row">
          ${dr ? builder : `<span class="ls-set sheet-acts">
            <button class="ls-btn sw-new">＋ Add a button</button>
            ${w.last ? `<button class="ls-btn sw-new-last">＋ Use the last press (${esc(w.last.label)})</button>` : ''}
          </span>`}
        </div>
      </div>`, { note: set.enabled ? `on · ${rules.length} ${rules.length === 1 ? 'button' : 'buttons'}` : 'off' });
  },

  wireSwitches() {
    const b = this.bodyEl;
    const w = this.sw;
    if (!w) return;
    const rules = w.settings?.rules || [];
    const redraw = () => this.render();
    b.querySelectorAll('[data-swon]').forEach((x) => {
      x.onclick = () => this.putSw({ enabled: x.dataset.swon === 'true' });
    });
    b.querySelectorAll('[data-swtry]').forEach((x) => {
      x.onclick = async () => {
        const r = rules[Number(x.dataset.swtry)];
        try {
          await fetch('/api/switch-sounds/try', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ entity: r.entity, press: r.press }),
          });
        } catch { /* nothing played */ }
      };
    });
    b.querySelectorAll('[data-swflash]').forEach((x) => {
      x.onclick = () => {
        const i = Number(x.dataset.swflash);
        this.putSw({ rules: rules.map((r, j) => (j === i ? { ...r, flash: r.flash === false } : r)) });
      };
    });
    b.querySelectorAll('[data-swdel]').forEach((x) => {
      x.onclick = () => {
        if (!x.dataset.sure) {
          x.dataset.sure = '1';
          x.textContent = 'Sure? Tap again';
          setTimeout(() => { if (x.isConnected) { delete x.dataset.sure; x.textContent = 'Remove'; } }, 4000);
          return;
        }
        this.putSw({ rules: rules.filter((_, i) => i !== Number(x.dataset.swdel)) });
      };
    });
    const swOf = (entity) => (w.switches || []).findIndex((sw) => sw.buttons.some((bt) => bt.entity === entity));
    b.querySelector('.sw-new')?.addEventListener('click', () => {
      this.swError = '';
      this.draft = { sw: 0, entity: '', press: 'hold', sound: this.doc?.sounds?.[0]?.id || '', repeat: 'once',
                     since: Date.now() / 1000 };
      redraw();
    });
    b.querySelector('.sw-new-last')?.addEventListener('click', () => {
      this.swError = '';
      this.draft = { sw: swOf(w.last.entity), entity: w.last.entity, press: w.last.press,
                     sound: this.doc?.sounds?.[0]?.id || '', repeat: 'once', since: w.last.at };
      redraw();
    });
    const dr = this.draft;
    if (!dr) return;
    b.querySelectorAll('[data-dsw]').forEach((x) => {
      x.onclick = () => {
        dr.sw = Number(x.dataset.dsw);
        dr.entity = '';
        if (w.switches[dr.sw]?.kind === 'tap') dr.press = 'short';
        redraw();
      };
    });
    b.querySelectorAll('[data-dbtn]').forEach((x) => { x.onclick = () => { dr.entity = x.dataset.dbtn; redraw(); }; });
    b.querySelectorAll('[data-dpress]').forEach((x) => { x.onclick = () => { dr.press = x.dataset.dpress; redraw(); }; });
    b.querySelectorAll('[data-dsound]').forEach((x) => {
      x.onclick = () => { dr.sound = x.dataset.dsound; this.preview(dr.sound); redraw(); };
    });
    b.querySelectorAll('[data-drep]').forEach((x) => { x.onclick = () => { dr.repeat = x.dataset.drep; redraw(); }; });
    b.querySelector('.sw-cancel')?.addEventListener('click', () => { this.draft = null; redraw(); });
    b.querySelector('.sw-add')?.addEventListener('click', () => {
      const rule = { entity: dr.entity, press: dr.press, sound: dr.sound, repeat: dr.repeat, flash: true };
      // One rule per button and press: a new one for the same replaces it.
      const keep = rules.filter((r) => !(r.entity === rule.entity && r.press === rule.press));
      this.draft = null;
      this.putSw({ rules: [...keep, rule] });
    });
  },
};
