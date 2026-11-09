/* Fire alarms — the heat alarm in the kitchen and the smoke alarm in the
   Salon (backend/app/firealarm.py, 2026-10-20).

   Alex: "Please add them separately to Automation tab. When they start
   screeming I can tab in the automation tab and they can turn to silence. In
   gear settings add their possible settings and add also send to telegram
   alarms if they detect something and HA sends also alarms to the phones."

   A card each on House → Automation, under the phones (ha.js buildAuto),
   with 🔇 Silence always on it — whether a siren sounds is the ears' to
   know, not Home Assistant's, so the button is there whatever the card
   says, and red while the alarm has gone off. On every screen a banner with
   Silence for as long as one has gone off and nobody has silenced it. The ⚙
   opens #fa-sheet: what the alarm reports, that it never goes quiet by
   itself (its siren limit held at the most and the siren started again while
   it detects — firealarm.py), who is told on Telegram and on which phones, and
   tests of the siren and the messages. This is ctx.fireAlarms. */

const esc = (s) => String(s ?? '').replace(/[&<>"]/g,
  (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const hm = (t) => {
  const d = new Date(t * 1000);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
};
const mins = (s) => (s % 60 ? `${s} s` : `${s / 60} min`);
/* Zigbee's firmware number is the version packed into bytes: 262152 is 4.0.8. */
const fw = (v) => (/^\d+$/.test(String(v)) && Number(v) > 65535
  ? `${Number(v) >> 16}.${(Number(v) >> 8) & 255}.${Number(v) & 255}` : String(v ?? '?'));

export default {
  doc: null,
  subs: [],
  openId: null,       // the alarm whose sheet is up
  said: null,         // { text, warn }: a test's answer, on the Try it card
  hushSaid: null,     // { text, warn }: Silence's answer, under the Silence button
  whoSaid: {},        // 'telegram' | 'phones' -> a refused change of who is told, in that row
  moreOpen: false,    // "It does not go quiet by itself" unfolded, kept across redraws

  init(ctx) {
    this.ctx = ctx;
    this.buildSheet();
    this.buildBanner();
    ctx.bus.on('fire_alarms', (doc) => {
      if (!doc || !Array.isArray(doc.alarms)) return;
      this.doc = doc;
      this.paintBanner();
      this.changed();
      this.render();
    });
  },

  onDoc(fn) { this.subs.push(fn); },

  changed() {
    for (const fn of this.subs) {
      try { fn(this.doc); } catch (e) { console.error('fire alarm subscriber failed', e); }
    }
  },

  get(id) { return (this.doc?.alarms || []).find((a) => a.id === id) || null; },

  /* Gone off, still detecting and not silenced: what the banner and the red
     are for. */
  loud(a) { return !!a && !!a.alarm && !a.alarm.silenced && !a.alarm.off_since; },

  /* ---------------------------------------------------------- the card -- */

  /* "Kitchen · 24.4° · 🔋 100 %" */
  sub(a) {
    if (!a) return '';
    return [a.room, a.temperature != null && `${a.temperature.toFixed(1)}°`,
      a.battery != null && `🔋 ${Math.round(a.battery)} %`].filter(Boolean).join(' · ');
  },

  /* What is true just now, the most urgent first. */
  status(a) {
    if (!a) return '';
    const found = a.kind === 'heat' ? 'HEAT' : 'SMOKE';
    if (a.alarm && a.alarm.off_since) return `Quiet since ${hm(a.alarm.off_since)} — all clear in a minute`;
    if (a.alarm && !a.alarm.silenced) return `${found} DETECTED · since ${hm(a.alarm.since)}`;
    if (a.alarm) return `Silenced ${hm(a.alarm.silenced)} · still detects ${found.toLowerCase()}`;
    if (a.siren_test) return 'Siren test — tap Silence to try it';
    if (a.test) return 'Its test button is pressed';
    if (a.fault) return 'Fault — see ⚙';
    if (a.battery_low) return 'Battery low — replace it';
    if (!a.seen) return 'No word from it yet';
    return 'All clear';
  },

  /* Silence's answer has a line of its own under the button, terracotta
     when it did not go — never at the foot of the sheet, where the banner
     covers it while the alarm still sounds. One of several that failed is
     not hidden by the next that went. */
  async silence(id) {
    const ids = id ? [id] : (this.doc?.alarms || []).filter((a) => this.loud(a)).map((a) => a.id);
    let said = null;
    for (const x of ids) {
      let now;
      try {
        const r = await fetch(`/api/fire-alarms/${encodeURIComponent(x)}/silence`, { method: 'POST' });
        const j = await r.json().catch(() => ({}));
        now = r.ok ? { text: 'Silence sent — if it still sounds, press the button on the alarm itself.', warn: false }
          : { text: `Silence did not go: ${j.error || r.status}`, warn: true };
      } catch {
        now = { text: 'Silence did not go: the kitchen server did not answer', warn: true };
      }
      if (!said?.warn) said = now;
    }
    this.hushSaid = said;
    this.render();
  },

  /* -------------------------------------------------------- the banner -- */

  buildBanner() {
    const el = document.createElement('div');
    el.id = 'fa-banner';
    el.hidden = true;
    el.setAttribute('role', 'alert');
    el.innerHTML = `
      <span class="fa-icon" aria-hidden="true">🔥</span>
      <span class="fa-txt"><b></b><span class="fa-why"></span></span>
      <button class="fa-hush">🔇 Silence</button>`;
    document.body.appendChild(el);
    this.banner = el;
    el.querySelector('.fa-hush').onclick = () => this.silence(null);
  },

  paintBanner() {
    const loud = (this.doc?.alarms || []).filter((a) => this.loud(a));
    this.banner.hidden = !loud.length;
    if (!loud.length) return;
    this.banner.querySelector('b').textContent = loud.map((a) =>
      `${a.kind === 'heat' ? 'Heat' : 'Smoke'} — ${a.room || a.label}`).join(' · ');
    this.banner.querySelector('.fa-why').textContent = `${loud.map((a) => `${a.label} since ${hm(a.alarm.since)}`).join(', ')}`
      + ' — check, then Silence';
  },

  /* --------------------------------------------------------- the sheet -- */

  /* The settings window kit (app.css, js/sheetkit.js): the alarm's own emoji
     in the header's tile, what it reports now under its name — in terracotta
     while it has gone off — and three cards: what it is doing now with
     🔇 Silence, who is told, and the tests; why it never goes quiet by
     itself is folded at the foot. */
  buildSheet() {
    const el = document.createElement('div');
    el.id = 'fa-sheet';
    el.className = 'sheet';   // the settings window kit (app.css)
    el.innerHTML = `
      <header>
        <span class="sheet-icon fa-sicon" aria-hidden="true">🔥</span>
        <div class="sheet-title">
          <h2></h2>
          <span class="sheet-status fa-now"></span>
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

  open(id) {
    if (!this.get(id)) return;
    if (this.openId !== id) this.bodyEl.scrollTop = 0;
    this.openId = id;
    this.said = null;
    this.hushSaid = null;
    this.whoSaid = {};
    this.sheet.classList.add('open');
    this.render();
  },

  close() { this.sheet.classList.remove('open'); this.openId = null; },

  isOpen() { return this.sheet.classList.contains('open'); },

  /* A person's or a phone's chip: ticked while they are told. `null` in the
     settings is everybody who can be — linked, or set up. One who cannot be
     told is dashed, and cannot be chosen until set up — but can always be
     taken out. */
  who(list, chosen, key) {
    return list.map((p) => {
      const on = chosen == null ? p.ready : chosen.includes(p.id);
      return `<button class="ls-btn${on ? ' on' : ''}${p.ready ? '' : ' sheet-na'}" data-who="${key}" data-id="${esc(p.id)}"
        aria-pressed="${on}"${p.ready || on ? '' : ' disabled'}
        ${p.ready ? '' : 'title="not set up"'}>${esc(p.label)}${p.ready ? '' : '<small>not set up</small>'}</button>`;
    }).join('');
  },

  /* Who is told, in names: everybody who can be while the setting is null,
     else the chosen who can be — one chosen but not set up is not told. */
  told(list, chosen) {
    return (list || []).filter((p) => p.ready && (chosen == null || chosen.includes(p.id))).map((p) => p.label);
  },

  /* A status line, terracotta when it says something did not go. */
  line(said, cls = '') {
    return `<span class="sheet-line${cls ? ` ${cls}` : ''}${said?.warn ? ' sheet-warn' : ''}">${esc(said?.text || '')}</span>`;
  },

  /* A refused change of who is told, under the controls of the row it was
     made in; a later answer for that row takes it away, never another's. */
  whoLine(key) {
    return this.whoSaid[key] ? this.line({ text: this.whoSaid[key], warn: true }, 'fa-whosaid') : '';
  },

  /* The header line's tone: gone off (sounding, silenced while it still
     detects, or quiet in the minute before the all clear) and trouble want
     somebody; a siren test or its test button is happening this minute. */
  tone(a) {
    if (!a) return '';
    if (a.alarm) return 'warn';
    if (a.siren_test || a.test) return 'live';
    if (a.fault || a.battery_low || !a.seen) return 'warn';
    return 'ok';
  },

  /* Each card's note: beside its heading. */
  notes(a) {
    const d = this.doc;
    const s = a.settings || {};
    const tg = this.told(d.people, s.telegram);
    const ph = this.told(d.phones, s.phones);
    const sent = a.sent;
    return {
      now: this.status(a),
      who: [tg.length ? `Telegram: ${tg.join(', ')}` : 'no Telegram',
        ph.length ? `${ph.length} ${ph.length === 1 ? 'phone' : 'phones'}${s.speak ? ', out loud' : ', notification only'}`
          : 'no phone'].join(' · '),
      tried: !sent ? 'nothing sent yet'
        : `${sent.what === 'test' ? 'test' : sent.what === 'on' ? 'alarm' : 'all clear'} sent ${hm(sent.at)}`,
    };
  },

  render() {
    if (!this.isOpen() || !this.doc) return;
    const a = this.get(this.openId);
    if (!a) { this.close(); return; }
    const kit = this.ctx.sheetkit;
    const d = this.doc;
    const s = a.settings || {};
    const found = a.kind === 'heat' ? 'heat' : 'smoke';
    const loud = this.loud(a) || !!a.siren_test;
    this.sheet.querySelector('.fa-sicon').textContent = a.emoji || '🔥';
    this.sheet.querySelector('h2').textContent = `${a.label} — ${a.room}`;
    kit.status(this.sheet.querySelector('.fa-now'), [`<b>${esc(this.status(a))}</b>`,
      a.temperature != null && `${a.temperature.toFixed(1)} °C`,
      a.battery != null && `🔋 ${Math.round(a.battery)} %`].filter(Boolean).join(' · '), this.tone(a));
    const n = this.notes(a);
    const facts = [
      a.temperature != null && `${a.temperature.toFixed(1)} °C where it hangs`,
      a.battery != null && `battery ${Math.round(a.battery)} %${a.battery_low ? ' — <b class="fa-warn">low</b>' : ''}`,
      a.fault ? '<b class="fa-warn">it reports a fault</b>' : a.reliability && a.reliability !== 'no_fault_detected'
        ? `<b class="fa-warn">${esc(a.reliability.replace(/_/g, ' '))}</b>` : 'no faults',
      a.update && (a.update.available ? `firmware ${esc(fw(a.update.installed))} — <b>${esc(fw(a.update.latest))} is
        available</b> (Zigbee2MQTT → OTA)` : `firmware ${esc(fw(a.update.installed))}, the newest`),
    ].filter(Boolean);
    /* No choice of how long it sounds (Alex: "If it silences automatically
       nobody will do something"): its limit is held at the most, and the
       server starts it again while it still detects. Said, not offered —
       the limit in sight on the Now card, the why folded at the foot. */
    const limit = a.duration ? mins(Math.round(a.duration.value)) : '?';
    const atMost = a.duration && Math.round(a.duration.value) >= a.duration.max;
    const sent = a.sent;
    const sentLine = !sent ? 'Nothing sent since the kitchen last started.'
      : `${sent.what === 'test' ? 'Test' : sent.what === 'on' ? 'Alarm' : 'All clear'} sent ${hm(sent.at)}:
        Telegram ${sent.telegram.length ? esc(sent.telegram.join(', ')) : 'nobody'},
        phones ${sent.phones.length ? esc(sent.phones.join(', ')) : 'none'}${sent.failed.length
        ? ` — <b class="fa-warn">failed: ${esc(sent.failed.map((f) => `${f.to} (${f.error})`).join(', '))}</b>` : ''}.`;
    // 🔇 Silence is the one control that must never be missed: big, in the
    // alarm's terracotta always, and filled — the live Stop — while it sounds.
    this.bodyEl.innerHTML = `
      ${kit.sec('Now', `
        <div class="ls-row fa-nowrow">
          <span class="ls-label"><span class="db-hint sheet-lead">it sounds by itself when it detects ${found}.
            Then everybody chosen below is told — on Telegram and on their phones, out loud even on silent —
            and every screen shows Silence. ${a.last ? `Last went off ${hm(a.last.since)}–${hm(a.last.until)}.` : ''}</span>
            <span class="sheet-line fa-facts">${facts.join(' · ')}.</span>
            <span class="sheet-line">Siren limit: ${limit}${a.duration ? (atMost ? ' — the most it takes.'
              : ' — <b class="fa-warn">being put back to the most</b>.') : '.'}</span></span>
          <div class="sheet-ctl fa-hushctl">
            <span class="ls-set"><button class="ls-btn sheet-danger fa-silence${loud ? ' on loud' : ''}"
              data-act="silence">🔇 Silence</button></span>
            ${this.hushSaid ? this.line(this.hushSaid, 'fa-hushsaid') : ''}
          </div>
        </div>`, { note: n.now, cls: loud ? 'fa-hot' : '' })}

      ${kit.sec('Who is told', `
        <div class="ls-row">
          <span class="ls-label">Telegram
            <span class="db-hint">a message when it goes off, and when it is quiet again. People link
              Telegram under Telegram on House → Automation.</span></span>
          <div class="sheet-ctl">
            <span class="ls-set sheet-chips">${this.who(d.people || [], s.telegram, 'telegram')}</span>
            ${this.whoLine('telegram')}
          </div>
        </div>
        <div class="ls-row">
          <span class="ls-label">Phones
            <span class="db-hint">a notification on the "Fire alarm" channel, through Home Assistant's app —
              and, with Out loud on, "${esc(a.label)} has gone off" spoken three times at full volume on the
              alarm stream, which silent mode and Do Not Disturb do not stop.</span></span>
          <div class="sheet-ctl">
            <span class="ls-set sheet-chips">${this.who(d.phones || [], s.phones, 'phones')}</span>
            <span><span class="sheet-cap">On those phones</span>
              <span class="ls-set sheet-seg">
                <button class="ls-btn${s.speak ? ' on' : ''}" data-speak="true" aria-pressed="${!!s.speak}">Out loud</button>
                <button class="ls-btn${s.speak ? '' : ' on'}" data-speak="false" aria-pressed="${!s.speak}">Notification only</button>
              </span></span>
            ${this.whoLine('phones')}
          </div>
        </div>`, { note: n.who })}

      ${kit.sec('Try it', `
        <div class="ls-row">
          <span class="ls-label"><span class="db-hint sheet-lead">the siren sounds for 10 seconds — loud — so
            Silence can be tried on it. The messages go as they would, marked a test, the words spoken once.</span>
            <span class="sheet-line">${sentLine}</span></span>
          <div class="sheet-ctl sheet-across">
            <button class="ls-btn sheet-primary" data-act="test-siren">Sound the siren</button>
            <button class="ls-btn" data-act="test-alert">Send a test message</button>
            ${this.line(this.said, 'fa-said')}
          </div>
        </div>`, { note: n.tried })}

      ${kit.more('quiet', 'It does not go quiet by itself', `
        <p class="sheet-note">While it detects ${found}, it sounds until somebody silences it — here, on a
          phone's dashboard, or with the button on the alarm — or the ${found} is gone. Its own siren limit is
          kept at the most it takes, and every ${Math.round((d.resound_s || 540) / 60)} minutes the kitchen starts
          its siren again, so the neighbours go on hearing it when nobody is home. Pressed on the alarm itself,
          it starts again if it still detects, as smoke alarms do; Silence here keeps it quiet.</p>`, !!this.moreOpen)}`;
    this.wire(a);
    this.bodyEl.querySelectorAll('details[data-more]').forEach((el) => {
      el.ontoggle = () => { this.moreOpen = el.open; kit.sync(this.sheet); };
    });
    kit.sync(this.sheet);
  },

  wire(a) {
    const b = this.bodyEl;
    b.querySelectorAll('[data-act]').forEach((el) => {
      el.onclick = () => {
        const act = el.dataset.act;
        if (act === 'silence') { this.silence(a.id); return; }
        this.post(`/api/fire-alarms/${encodeURIComponent(a.id)}/${act}`,
          act === 'test-siren' ? 'The siren sounds for 10 seconds — try Silence.' : 'Test sent.');
      };
    });
    b.querySelectorAll('[data-speak]').forEach((el) => {
      el.onclick = () => this.put(a.id, { speak: el.dataset.speak === 'true' });
    });
    b.querySelectorAll('[data-who]').forEach((el) => {
      el.onclick = () => {
        const key = el.dataset.who;
        const list = key === 'telegram' ? this.doc.people : this.doc.phones;
        const cur = a.settings[key] == null ? list.filter((p) => p.ready).map((p) => p.id) : [...a.settings[key]];
        const i = cur.indexOf(el.dataset.id);
        if (i >= 0) cur.splice(i, 1); else cur.push(el.dataset.id);
        this.put(a.id, { [key]: cur });
      };
    });
  },

  /* A refusal is said in the row of the chips or the bar tapped: Telegram's,
     or the phones' (their chips and Out loud / Notification only). */
  async put(id, patch) {
    const key = 'telegram' in patch ? 'telegram' : 'phones';
    let refused = '';
    try {
      const r = await fetch(`/api/fire-alarms/${encodeURIComponent(id)}/settings`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(patch),
      });
      const j = await r.json().catch(() => ({}));
      refused = r.ok ? '' : `Not saved: ${j.error || r.status}`;
    } catch {
      refused = 'Not saved: the kitchen server did not answer';
    }
    this.whoSaid[key] = refused;
    this.render();
  },

  async post(url, ok) {
    this.said = { text: '…', warn: false };
    this.render();
    try {
      const r = await fetch(url, { method: 'POST' });
      const j = await r.json().catch(() => ({}));
      this.said = r.ok ? { text: ok, warn: false } : { text: `It did not go: ${j.error || r.status}`, warn: true };
    } catch {
      this.said = { text: 'It did not go: the kitchen server did not answer', warn: true };
    }
    this.render();
  },
};
