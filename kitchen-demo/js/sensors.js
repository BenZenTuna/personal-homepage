/* Sensors — every temperature, humidity and soil sensor, and the room each
   is in (backend/app/sensors.py, 2026-10-21).

   Alex: "I have different temp sensors which I am changing their place in
   different rooms. In the automatization tab I would like to have a card for
   temperature, humidity sensors options. I can choose which one and replace
   easily to any choosen room. … Then statistics will stop for the kitchen
   and start a new one for the tv room, and tv room automatization card show
   the temp for tv room."

   One card on House → Automation, under Sensors: where the readings are
   shown now, and how many sensors are new. Its sheet (#sn-sheet) lists every
   sensor Home Assistant has — found there, so a new one appears by itself
   (New, until it is given a place) — with a chip per room on House, "No
   room" (shown under its own name, on no light card) and "Not used". A tap
   moves it: the server keeps the move with its time, so the room it left
   keeps its history up to now and the room it went to starts its own. Under
   the sensors: each place's name on the wall and its column in the top bar,
   which holds `max_bar`.

   The list the readings are drawn from (`climate` in the snapshot) is
   swapped into ctx.config by app.js before anybody else hears the event, so
   the light cards, the top bar and the chart all follow a move at once.
   And alerts (2026-10-21): under each sensor 🔔 opens them. The rule is
   the server's (sensors.py); how an alert looks on the wall (Needs
   attention's alarm or chip, banner, sound) is the House alerts sheet's
   "A room too warm…" row, one tap away.

   Since 2026-10-22 they are rules Alex defines ("users can choose for
   defined temperatures or humidity to alert via telegram HA and/or kitchen
   dashboard. Users can choose in which temperature humidity levels and for
   how long time if the temp is measured that it would start to alert"): a
   row each — warmer than, colder than, more humid than or drier than a level
   (− / +), past it for how long (at once up to 24 h), and where it goes:
   🖥 on the wall, ✈ a person's Telegram, 📱 a phone through Home Assistant,
   or "As House alerts", which is that row's choice and shows it. Two rules
   may watch one figure — "warmer than 26° for 2 h" on the wall beside
   "warmer than 30° at once" on the phones. The whole list goes to the server
   (PUT …/alerts {rules}) and the sheet repaints from its answer; until then
   the change is a draft here (`drafts`), so an update arriving meanwhile
   never undoes a level being stepped.

   This is ctx.sensors. */

const esc = (s) => String(s ?? '').replace(/[&<>"]/g,
  (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const hm = (t) => {
  const d = new Date(t * 1000);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
};
const day = (t) => new Date(t * 1000).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
const KIND_EMOJI = { air: '🌡️', temp: '🌡️', hum: '💧', appliance: '🌸', soil: '🌷' };
/* The four kinds of rule: what each is called, its figure and side, its
   step, and where a new one starts (from the reading now, else a fixed
   figure). */
export const KINDS = [
  { metric: 'temp', side: 'above', label: 'Warmer than', words: 'too warm', step: 0.5,
    start: (v) => (v == null ? 28 : Math.round(v) + 3) },
  { metric: 'temp', side: 'below', label: 'Colder than', words: 'too cold', step: 0.5,
    start: (v) => (v == null ? 16 : Math.round(v) - 3) },
  { metric: 'hum', side: 'above', label: 'More humid than', words: 'too humid', step: 5,
    start: (v) => (v == null ? 70 : Math.min(95, Math.round(v / 5) * 5 + 15)) },
  { metric: 'hum', side: 'below', label: 'Drier than', words: 'too dry', step: 5,
    start: (v) => (v == null ? 30 : Math.max(5, Math.round(v / 5) * 5 - 15)) },
];
const BOUNDS = { temp: [-30, 80], hum: [0, 100] };     // sensors.py LIMITS
export const AFTER = [0, 5, 15, 30, 60, 120, 360, 720, 1440];
export const MAX_RULES = 8;                             // sensors.py MAX_RULES
const AFTER_DEFAULT = 10;
const SEND_AFTER_STEP_MS = 700;   // a run of − / + taps is one save
const fig = (metric, v) => (metric === 'temp' ? `${Number(v).toFixed(1)}°` : `${Math.round(v)} %`);

export const kindOf = (r) => KINDS.find((k) => k.metric === r?.metric && k.side === r?.side) || null;

/* How long a rule waits, as sensors.py's after_words says it: "" for at
   once, "45 min", "1 h", "1 h 30 min", "24 h". */
export function afterWords(minutes) {
  const m = Math.round(Number(minutes) || 0);
  if (m <= 0) return '';
  if (m < 60) return `${m} min`;
  return `${Math.floor(m / 60)} h${m % 60 ? ` ${m % 60} min` : ''}`;
}

/* The "Past it for" chips: the usual ones, and a stored value between them
   as a chip of its own (the 10 minutes every limit had before rules), so
   what is set is never hidden. */
export function afterChoices(cur) {
  const m = Number(cur);
  const out = AFTER.slice();
  if (Number.isFinite(m) && !out.includes(m)) out.push(m);
  return out.sort((a, b) => a - b);
}

/* A level as a sentence says it: 28°, 28.5°, 30 %. */
const short = (metric, v) => (metric === 'temp' ? `${Math.round(Number(v) * 10) / 10}°` : `${Math.round(v)} %`);

/* One rule in the closed line's words: "warmer than 28° · 10 min". */
export function ruleLine(r) {
  const k = kindOf(r);
  if (!k) return '';
  return `${k.label.toLowerCase()} ${short(r.metric, r.level)} · ${afterWords(r.after_min) || 'at once'}`;
}

/* The line under a sensor: "2 alerts: warmer than 28° · 10 min, drier than
   30 % · 1 h", or "no alerts". */
export function rulesSummary(rules) {
  const list = (rules || []).filter(kindOf);
  if (!list.length) return 'no alerts';
  return `${list.length} alert${list.length > 1 ? 's' : ''}: ${list.map(ruleLine).join(', ')}`;
}

/* Where a rule goes, part by part: its own `tell` where it says, the House
   alerts row's (`house`: the climate type's style) where it does not — so
   while a rule is "As House alerts" its toggles show what that row does.
   `wall` is null when neither is known yet.

   What the row does, not only what it has ticked: a row set to Off sends an
   alert that follows it nowhere — attention.py _stamp sends Telegram and the
   phones only when the type is not Off, or for a rule with its own `tell` —
   so its ✈ and 📱 still chosen there are nobody here, and the rule says it
   goes nowhere. A part an own `tell` leaves out still takes the row's people,
   Off or not: an own tell is always sent. */
export function reach(rule, house) {
  const t = rule?.tell && typeof rule.tell === 'object' ? rule.tell : null;
  const wall = typeof t?.wall === 'boolean' ? t.wall : house ? house.show !== 'off' : null;
  const muted = !t && house?.show === 'off';
  const part = (k) => (Array.isArray(t?.[k]) ? t[k] : muted ? [] : (house?.[k] || []));
  return { own: !!t, wall, telegram: part('telegram'), phones: part('phones') };
}

/* A rule as the server takes it, and nothing else of ours with it. */
export function forServer(r) {
  return {
    ...(r.id ? { id: r.id } : {}),
    metric: r.metric, side: r.side, level: r.level, after_min: r.after_min, tell: r.tell ?? null,
  };
}

function num(st) {
  if (!st || st.s == null) return null;
  const v = Number(st.s);
  return Number.isFinite(v) ? v : null;
}

export default {
  doc: null,
  states: {},
  subs: [],
  said: null,         // { text, warn }: Look for new sensors' answer, beside its button
  pending: false,     // a render held back while a name is being typed
  openAlerts: new Set(),   // the sensors whose alerts are open in the sheet
  /* A sensor's rules being changed and not yet answered by the server:
     sid → { rules, seq, timer, busy }. While one is here the sheet draws it,
     not the snapshot's, whatever arrives meanwhile. */
  drafts: new Map(),
  alertSaid: new Map(),    // sid → the server's refusal of its last change
  /* A refused move, name, top-bar switch or "Use this one", said in the row
     it was tapped in: 'place:<sid>' (the rooms' bar), 'own:<sid>' (its own
     name and column), 'room:<rid>' (a room's name and column). */
  putSaid: new Map(),
  moreOpen: false,         // "Where each sensor is" unfolded, kept across redraws
  stepWait: SEND_AFTER_STEP_MS,
  houseSig: '',

  init(ctx) {
    this.ctx = ctx;
    this.buildSheet();
    ctx.bus.on('sensors', (doc) => {
      if (!doc || !Array.isArray(doc.sensors)) return;
      this.doc = doc;
      this.changed();
      this.render();
    });
    ctx.bus.on('ha_states', (s) => { this.states = s || {}; this.paintNow(); });
    // "As House alerts" shows that row's choice, and the ✈ chips follow who
    // has linked Telegram: redrawn when either changes, not on every
    // snapshot of Needs attention.
    ctx.automation?.onChange?.(() => {
      const sig = JSON.stringify([this.houseStyle(), this.ctx.automation?.tg?.configured,
        this.ctx.automation?.tg?.people]);
      if (sig === this.houseSig) return;
      this.houseSig = sig;
      this.render();
    });
  },

  /* The climate type's style in House alerts — where a rule with no `tell`
     of its own goes — or null before Needs attention has answered. */
  houseStyle() {
    return this.ctx?.automation?.type?.('climate')?.style || null;
  },

  sensor(sid) { return (this.doc?.sensors || []).find((x) => x.id === sid) || null; },

  /* A sensor's rules as the sheet draws them: its draft, else the server's. */
  rulesOf(s) {
    const d = this.drafts.get(s.id);
    return d ? d.rules : (Array.isArray(s.alerts?.rules) ? s.alerts.rules : []);
  },

  onDoc(fn) { this.subs.push(fn); },

  changed() {
    for (const fn of this.subs) {
      try { fn(this.doc); } catch (e) { console.error('sensors subscriber failed', e); }
    }
  },

  /* ---------------------------------------------------------- the card -- */

  /* The card's two lines: where readings are shown, and what is waiting. */
  summary() {
    const d = this.doc;
    if (!d) return null;
    const live = (d.sensors || []).filter((s) => !s.gone);
    const fresh = live.filter((s) => s.new).length;
    const used = live.filter((s) => s.room !== null).length;
    const places = (d.climate || []).map((c) => c.short || c.label).filter(Boolean);
    const hot = d.alerts_on || [];
    // The alerts set, on the sensors in use: a sensor not used never alerts.
    const rules = live.filter((s) => s.room !== null)
      .reduce((n, s) => n + (Array.isArray(s.alerts?.rules) ? s.alerts.rules.length : 0), 0);
    return {
      fresh,
      hot: hot.length,
      status: hot.length ? `${hot[0].place}: ${hot[0].words}${hot.length > 1 ? ` · ${hot.length - 1} more` : ''}`
        : fresh ? `${fresh} new — choose ${fresh > 1 ? 'their rooms' : 'its room'}`
          : `${used} in use · ${live.length - used} not used${rules ? ` · ${rules} alert${rules > 1 ? 's' : ''}` : ''}`,
      sub: places.join(' · ') || 'no sensor placed yet',
    };
  },

  /* "22.4° · 48 %", or "soil 46 % · 22.5°", from the sensor's own entities. */
  now(s) {
    const t = num(this.states[s.temp]);
    const h = num(this.states[s.hum]);
    const w = num(this.states[s.soil]);
    const parts = [];
    if (w != null) parts.push(`soil ${Math.round(w)} %`);
    if (t != null) parts.push(`${t.toFixed(1)}°`);
    if (h != null && s.kind !== 'soil') parts.push(`${Math.round(h)} %`);
    return parts.join(' · ') || 'no reading';
  },

  /* ---------------------------------------------------------- the sheet --

     The settings window kit (app.css, js/sheetkit.js): a card per sensor —
     its name, what it reads now, the room it is in as one bar of choices
     (Not used, No room, every room on House), and its alerts — then the
     rooms' names and the top bar, looking for new sensors, and how a move
     splits a room's history, folded at the foot. More than five cards: the
     rail lists them, each with where it is. A sensor's alert, opened under
     🔔, is a framed block of its own: the level (− value +), how long, and
     where it goes. Full width on the wall (.sheet-full): the rooms' bar and
     the rules want it. */

  buildSheet() {
    const el = document.createElement('div');
    el.id = 'sn-sheet';
    el.className = 'sheet sheet-full';   // the settings window kit (app.css); its rows want the wall's width
    el.innerHTML = `
      <header>
        <span class="sheet-icon" aria-hidden="true">🌡️</span>
        <div class="sheet-title">
          <h2>Sensors</h2>
          <span class="sheet-status sn-head"></span>
        </div>
        <span class="spacer"></span>
        <button class="ls-close">Close</button>
      </header>
      <div class="ls-body"></div>`;
    document.body.appendChild(el);
    this.sheet = el;
    this.bodyEl = el.querySelector('.ls-body');
    el.querySelector('.ls-close').onclick = () => this.close();
    // A name is sent when it is done, and the sheet catches up after it.
    this.bodyEl.addEventListener('focusout', () => {
      setTimeout(() => { if (this.pending && !this.typing()) this.render(); }, 0);
    });
  },

  open() {
    this.said = null;
    this.putSaid.clear();
    this.sheet.classList.add('open');
    this.render();
  },

  close() { this.sheet.classList.remove('open'); },

  isOpen() { return this.sheet.classList.contains('open'); },

  typing() {
    const a = document.activeElement;
    return !!a && a.tagName === 'INPUT' && this.sheet.contains(a);
  },

  roomName(id) {
    const r = (this.doc?.rooms || []).find((x) => x.id === id);
    return r ? r.name : id;
  },

  /* A refusal for one row, under the controls tapped (so nothing above them
     moves), or nothing. */
  refusal(key) {
    const t = this.putSaid.get(key);
    return t ? `<span class="sheet-line sheet-warn sn-said">${esc(t)}</span>` : '';
  },

  /* The room a sensor is in: one of N in a bar. "Not used" is the chosen
     none (the kit's quiet fill); "No room" is a place like the rooms — the
     sensor shown under its own name. The room Home Assistant suggests is
     outlined while the sensor is new. */
  chips(s) {
    const rooms = this.doc.rooms || [];
    const chip = (val, label, extra = '', cls = '') => {
      const on = s.room === val;
      const sug = s.new && val && val === s.suggest;
      return `<button class="ls-btn sn-chip${on ? ' on' : ''}${sug ? ' sn-suggest' : ''}${cls}" data-sid="${esc(s.id)}"
        data-room="${val === null ? 'null' : esc(val)}" aria-pressed="${on}"${
        sug ? ' title="Home Assistant has it in this area"' : ''}>${extra}${esc(label)}</button>`;
    };
    return chip(null, 'Not used', '', ' sheet-none') + chip('', 'No room')
      + rooms.map((r) => chip(r.id, r.tile, r.emoji ? `<span aria-hidden="true">${esc(r.emoji)}</span> ` : '')).join('');
  },

  /* A sensor card's note — beside its name, and under it on the rail: where
     it is, what it alerts on, and what wants somebody first. */
  noteOf(s) {
    const rules = this.rulesOf(s);
    const on = new Set(s.alerting || []);
    const hot = [...new Set(rules.filter((r) => r.id && on.has(r.id)).map((r) => kindOf(r)?.words).filter(Boolean))];
    if (s.gone) return 'gone from Home Assistant';
    if (hot.length) return `${hot.join(', ')} now`;
    if (s.new) return 'new — choose its room';
    if (s.room === null) return 'not used';
    const where = s.room === '' ? 'no room' : this.roomName(s.room);
    return rules.length ? `${where} · ${rules.length} alert${rules.length > 1 ? 's' : ''}` : where;
  },

  sensorRow(s) {
    const d = this.doc;
    const kit = this.ctx.sheetkit;
    const where = s.room === null ? 'not used' : s.room === '' ? 'no room — shown under its own name'
      : `in ${esc(this.roomName(s.room))}${s.since ? ` since ${esc(day(s.since))} ${esc(hm(s.since))}` : ''}`;
    const facts = [s.model, s.words].filter(Boolean).map(esc).join(' · ');
    const lines = [];
    if (s.gone) lines.push('<b class="fa-warn">Home Assistant no longer has it</b> — re-paired, it comes back here as new.');
    if (s.kind === 'soil') {
      lines.push('A soil sensor: wherever it is put, it is the pot it is in — its moisture is the Flower alarm\'s, and its history goes with it.');
    }
    const shared = s.shared && s.room;
    if (shared && s.main) lines.push(`${esc(this.roomName(s.room))}'s reading comes from this one.`);
    const rows = [`
      <div class="ls-row sn-placed">
        <span class="ls-label"><b class="sn-v" data-now="${esc(s.id)}">${esc(this.now(s))}</b>
          ${s.new ? '<em class="sn-badge">New</em>' : ''}
          <span class="db-hint">${facts}${facts ? ' · ' : ''}${where}</span>
          ${lines.map((l) => `<span class="sheet-line">${l}</span>`).join('')}</span>
        <div class="sheet-ctl">
          <span class="ls-set sheet-seg sn-places">${this.chips(s)}</span>
          ${shared && !s.main ? `<button class="ls-btn sn-main" data-main="${esc(s.id)}" data-room="${esc(s.room)}">Use this one for ${
            esc(this.roomName(s.room))}'s reading</button>` : ''}
          ${this.refusal(`place:${s.id}`)}
        </div>
      </div>`];
    // A sensor with no room, and a pot, has a name and a column of its own.
    if (s.room === '' || (s.kind === 'soil' && s.room !== null)) {
      const full = !s.bar && d.in_bar >= d.max_bar;
      rows.push(`
      <div class="ls-row">
        <span class="ls-label">Its name on the wall and the top bar</span>
        <div class="sheet-ctl sheet-across sn-own">
          <input class="sn-name" data-sid="${esc(s.id)}" maxlength="28" value="${esc(s.label)}"
            placeholder="${esc(s.kind === 'soil' ? 'Flowers' : s.name)}" aria-label="its name on the wall">
          ${kit.toggle(!!s.bar, `data-sbar="${esc(s.id)}"${full ? ` title="the top bar holds ${d.max_bar}"` : ''}`,
            { words: ['In the top bar', 'Not in the top bar'], cls: `sn-bar${full ? ' sn-full' : ''}` })}
          ${this.refusal(`own:${s.id}`)}
        </div>
      </div>`);
    }
    if (s.room !== null && (s.temp || s.hum)) rows.push(this.alertLine(s));
    const cls = `sn-row${s.new ? ' sn-new' : ''}${s.room === null ? ' sn-off' : ''}${
      (s.alerting || []).length ? ' sn-alerting' : ''}`;
    return kit.sec(`${KIND_EMOJI[s.kind] || '🌡️'} ${s.name}`, rows.join(''),
      { note: this.noteOf(s), cls, attrs: `data-sensor="${esc(s.id)}"` });
  },

  /* A sensor's alerts, as a row of its card: what they are and 🔔 to open
     them; opened, a framed block per rule under both columns, then a ＋ for
     each kind the sensor's figures allow. */
  alertLine(s) {
    const rules = this.rulesOf(s);
    const on = new Set(s.alerting || []);
    const hot = [...new Set(rules.filter((r) => r.id && on.has(r.id)).map((r) => kindOf(r)?.words).filter(Boolean))];
    const open = this.openAlerts.has(s.id);
    const said = this.alertSaid.get(s.id);
    let html = `<div class="ls-row sn-al">
      <span class="ls-label"><span class="sn-alsum">${hot.length ? `<b class="fa-warn">${esc(hot.join(', '))} now</b> · ` : ''}${
        esc(rulesSummary(rules))}</span>${said ? `<b class="fa-warn">${esc(said)}</b>` : ''}</span>
      <button class="ls-btn sn-bell${open ? ' on' : ''}${rules.length ? ' set' : ''}" data-bell="${esc(s.id)}"
        aria-expanded="${open}">🔔 Alerts</button>`;
    if (!open) return `${html}</div>`;
    const kinds = KINDS.filter((k) => s[k.metric]);
    html += `<div class="sheet-wide sn-lims">
      <p class="sa-intro">Past a level for as long as you choose, then where you choose: on the wall, on
        somebody's Telegram, on a phone. "As House alerts" goes where that row sends this kind of alert.</p>
      ${rules.map((r, i) => this.ruleRow(s, r, i, on)).join('') || '<p class="sa-intro">No alerts yet — add one:</p>'}
      <div class="sn-lim sa-add">${rules.length >= MAX_RULES
        ? `<span class="sheet-line">${MAX_RULES} alerts is the most a sensor has — take one off to add another.</span>`
        : kinds.map((k) => `<button class="ls-btn sa-new" data-sa-add="${esc(s.id)}" data-metric="${k.metric}"
            data-side="${k.side}">＋ ${k.label}</button>`).join('')}
        <button class="ls-btn sn-how" data-how="1">How the alerts look (alarm or chip, banner, sound) › House alerts</button></div>
    </div>`;
    return `${html}</div>`;
  },

  /* One rule, a framed block read from across the kitchen: what (− level +,
     and the reading now), for how long (one of N), and where it goes —
     "As House alerts" ticked while it has no `tell` of its own, and then the
     wall, a ✈ per person and a 📱 per phone dashed, showing what that row
     does; ticked by hand once it has. ✕ takes it off. */
  ruleRow(s, r, i, on) {
    const k = kindOf(r);
    if (!k) return '';
    const at = `data-sid="${esc(s.id)}" data-i="${i}"`;
    const hot = !!(r.id && on.has(r.id));
    const now = num(this.states[s[r.metric]]);
    const where = reach(r, this.houseStyle());
    const tg = this.ctx?.automation?.tg;
    const folk = tg?.configured ? (tg.people || []) : [];
    const phones = this.ctx?.config?.phones || [];
    const tel = new Set(where.telegram);
    const ph = new Set(where.phones);
    // Inherited (As House alerts) or not to be reached (no Telegram linked,
    // no app): dashed. One who cannot be reached cannot be ticked, but can
    // always be taken out.
    const to = (attrs, text, pressed, dim = false, title = '', inherit = !where.own) => `<button class="ls-btn${
      inherit || dim ? ' sheet-na' : ''} sa-to${pressed ? ' on' : ''}${dim ? ' sa-dim' : ''}" ${at} ${attrs} aria-pressed="${pressed}"${
      dim && !pressed ? ' disabled' : ''}${title ? ` title="${esc(title)}"` : ''}>${text}</button>`;
    const nowhere = where.wall === false && !where.telegram.length && !where.phones.length;
    return `<span class="sa-rule${hot ? ' hot' : ''}">
      <span class="sn-lim">
        <span class="sn-ll">${k.label}</span>
        <span class="sa-ctl">
          <span class="ls-set sheet-step">
            <button class="ls-btn sn-step" ${at} data-step="${-k.step}" aria-label="lower">−</button>
            <span class="sheet-val"><b class="sn-lv">${fig(r.metric, r.level)}</b></span>
            <button class="ls-btn sn-step" ${at} data-step="${k.step}" aria-label="higher">+</button>
          </span>
          <small data-fig="${esc(s.id)}" data-metric="${r.metric}">${now != null ? `now ${fig(r.metric, now)}` : ''}</small>
          ${hot ? `<b class="fa-warn">${esc(k.words)} now</b>` : ''}
          <span class="sa-gap"></span>
          <button class="ls-btn sheet-danger sa-x" ${at} data-rm="1" aria-label="remove this alert">✕</button>
        </span>
      </span>
      <span class="sn-lim"><span class="sn-ll">Past it for</span><span class="ls-set sheet-seg sa-after">${afterChoices(r.after_min).map((m) =>
        `<button class="ls-btn sn-step${r.after_min === m ? ' on' : ''}" ${at} data-after="${m}">${afterWords(m) || 'At once'}</button>`).join('')}</span></span>
      <span class="sn-lim"><span class="sn-ll">Goes to</span>
        <span class="sa-ctl"><span class="ls-set sheet-chips">
          ${to('data-to="house"', 'As House alerts', !where.own, false, 'wherever the House alerts row sends a room too warm, too cold, too humid or too dry', false)}
          ${to('data-to="wall"', '🖥️ On the wall', where.wall === true)}
          ${folk.map((p) => to(`data-to="tg" data-who="${esc(p.id)}"`, `✈ ${esc(p.name)}`, tel.has(p.id), !p.chat,
            p.chat ? `on ${p.name}'s Telegram` : `${p.name} has not linked Telegram yet — House → Automation → Telegram`)).join('')}
          ${phones.map((p) => to(`data-to="ph" data-who="${esc(p.id)}"`, `📱 ${esc(p.label)}`, ph.has(p.id), !p.ready,
            p.ready ? `on ${p.label}, through Home Assistant's app` : `${p.label}: Home Assistant's app is not set up`)).join('')}
        </span>
        ${nowhere ? `<b class="fa-warn sa-none">goes nowhere — ${where.own ? 'not on the wall, and nobody told'
          : 'the House alerts row is set to Off'}</b>` : ''}</span>
      </span>
    </span>`;
  },

  /* A tap on a rule's row. */
  ruleTap(el) {
    const ds = el.dataset;
    const sid = ds.sid;
    const i = Number(ds.i);
    const s = this.sensor(sid);
    if (!s || !this.rulesOf(s)[i]) return;
    const clamp = (metric, v) => Math.min(BOUNDS[metric][1], Math.max(BOUNDS[metric][0], v));
    if (ds.step) {
      this.edit(sid, (rules) => {
        const r = rules[i];
        r.level = clamp(r.metric, Math.round((Number(r.level) + Number(ds.step)) * 10) / 10);
      }, this.stepWait);
    } else if (ds.rm) {
      this.edit(sid, (rules) => { rules.splice(i, 1); });
    } else if (ds.after != null) {
      this.edit(sid, (rules) => { rules[i].after_min = Number(ds.after); });
    } else if (ds.to === 'house') {
      this.edit(sid, (rules) => { rules[i].tell = null; });
    } else if (ds.to) {
      // From "As House alerts" the first tap starts from what that row
      // does now, so only the part tapped changes.
      const house = this.houseStyle();
      this.edit(sid, (rules) => {
        const r = rules[i];
        const w = reach(r, house);
        // While that row is not known yet (Needs attention has not answered)
        // the wall is unknown and drawn unpressed: a tap on it is "on the
        // wall", never a toggle off from an "on" nobody saw; a tap on anyone
        // else keeps the alert on the wall, where the type's default
        // (an alarm) has it.
        const t = { wall: w.wall ?? true, telegram: w.telegram.slice(), phones: w.phones.slice() };
        if (ds.to === 'wall') t.wall = w.wall === null ? true : !w.wall;
        else {
          const part = ds.to === 'tg' ? 'telegram' : 'phones';
          const set = new Set(t[part]);
          if (set.has(ds.who)) set.delete(ds.who); else set.add(ds.who);
          const order = ds.to === 'tg' ? (this.ctx?.automation?.tg?.people || []) : (this.ctx?.config?.phones || []);
          t[part] = order.map((p) => p.id).filter((x) => set.has(x));
        }
        r.tell = t;
      });
    }
  },

  /* ＋ Warmer than…: a new rule from the reading now, for ten minutes, as
     House alerts says. */
  addRule(sid, metric, side) {
    const s = this.sensor(sid);
    const k = KINDS.find((x) => x.metric === metric && x.side === side);
    if (!s || !k || !s[metric]) return;
    const [lo, hi] = BOUNDS[metric];
    const level = Math.min(hi, Math.max(lo, k.start(num(this.states[s[metric]]))));
    this.edit(sid, (rules) => {
      if (rules.length < MAX_RULES) rules.push({ metric, side, level, after_min: AFTER_DEFAULT, tell: null });
    });
  },

  /* Change a sensor's rules: in its draft at once, on the server after
     `wait` ms — so a run of − / + taps is one save. */
  edit(sid, fn, wait = 0) {
    const s = this.sensor(sid);
    if (!s) return;
    let d = this.drafts.get(sid);
    if (!d) {
      d = { rules: JSON.parse(JSON.stringify(this.rulesOf(s))), seq: 0, timer: null, busy: false };
      this.drafts.set(sid, d);
    }
    fn(d.rules);
    d.seq += 1;
    this.alertSaid.delete(sid);
    clearTimeout(d.timer);
    d.timer = setTimeout(() => { d.timer = null; this.send(sid); }, wait);
    this.render();
  },

  /* The draft to the server, the whole list. Answered, the sheet is the
     server's again — unless it was changed meanwhile, which then goes too. */
  async send(sid) {
    const d = this.drafts.get(sid);
    if (!d || d.busy) return;       // one on its way: this goes when it is answered
    d.busy = true;
    const seq = d.seq;
    const sent = d.rules.slice();
    let ans = null;
    let said = '';
    try {
      const r = await fetch(`/api/sensors/${encodeURIComponent(sid)}/alerts`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rules: sent.map(forServer) }),
      });
      const j = await r.json().catch(() => ({}));
      if (r.ok && Array.isArray(j.sensors)) ans = j;
      else said = `Not saved: ${j.error || r.status}`;
    } catch {
      said = 'Not saved: the kitchen server did not answer';
    }
    d.busy = false;
    if (ans) {
      // A rule added here has its id now, given to the draft's own copy: a
      // change made while this was on its way stays that rule (and its
      // alert, if on) rather than replacing it with another.
      const got = ans.sensors.find((x) => x.id === sid)?.alerts?.rules || [];
      sent.forEach((r, i) => { if (!r.id && got[i]) r.id = got[i].id; });
      this.doc = ans;
      this.changed();
    }
    if (d.seq === seq) {
      this.drafts.delete(sid);
      if (said) this.alertSaid.set(sid, said);
    } else if (!d.timer) {
      this.send(sid);
    }
    this.render();
  },

  /* The header's line and its tone: an alert on wants somebody, and so does
     an error; a new sensor waiting for its room is "ok" — its words in bold
     in the hue, as the card on Automation lights them, with no dot (that is
     "live", something being done this minute). The first part of the line
     in bold. */
  headLine() {
    const d = this.doc;
    const v = this.summary();
    if (!v) return ['', ''];
    const [first, ...rest] = v.status.split(' · ');
    const html = [`<b>${esc(first)}</b>`, ...rest.map(esc)].join(' · ');
    const tone = v.hot || d.error ? 'warn' : d.started || v.fresh ? 'ok' : '';
    return [html, tone];
  },

  render() {
    if (!this.isOpen() || !this.doc) return;
    if (this.typing()) { this.pending = true; return; }
    this.pending = false;
    const kit = this.ctx.sheetkit;
    const d = this.doc;
    const live = (d.sensors || []);
    const [line, tone] = this.headLine();
    kit.status(this.sheet.querySelector('.sn-head'), line, tone);
    const cards = [];
    if (!d.started) {
      cards.push(`<p class="sheet-line sn-wait">Reading the sensors from Home Assistant…
        ${d.error ? `<b class="fa-warn">${esc(d.error)}</b>` : ''}</p>`);
    }
    cards.push(...live.map((s) => this.sensorRow(s)));
    const used = (d.rooms || []).filter((r) => (d.climate || []).some((c) => c.room === r.id && !c.soil_entity));
    if (used.length) {
      cards.push(kit.sec("The rooms' names and the top bar", `
        <p class="sheet-note">The name over a room's readings in the top bar and the chart — empty is the
          room's own — and whether it has a column in the top bar, which holds ${d.max_bar}
          (${d.in_bar} now).</p>
        ${used.map((r) => {
          const full = !r.bar && d.in_bar >= d.max_bar;
          return `
          <div class="ls-row sn-roomset">
            <span class="ls-label sn-rname">${esc(r.emoji)} ${esc(r.tile)}</span>
            <div class="sheet-ctl sheet-across sn-own">
              <input class="sn-name" data-rid="${esc(r.id)}" maxlength="28" value="${esc(r.label)}"
                placeholder="${esc(r.tile)}" aria-label="${esc(r.tile)}: its name on the wall">
              ${kit.toggle(!!r.bar, `data-rbar="${esc(r.id)}"${full ? ` title="the top bar holds ${d.max_bar}"` : ''}`,
                { words: ['In the top bar', 'Not in the top bar'], cls: `sn-bar${full ? ' sn-full' : ''}` })}
              ${this.refusal(`room:${r.id}`)}
            </div>
          </div>`;
        }).join('')}`, { note: `${d.in_bar} of ${d.max_bar} in the top bar` }));
    }
    const fresh = live.filter((s) => s.new && !s.gone).length;
    cards.push(kit.sec('New sensors', `
      <div class="ls-row">
        <span class="ls-label"><span class="db-hint sheet-lead">a sensor paired into Home Assistant shows up
          here by itself within a minute, marked New. Looked for every half hour as well, and now with the
          button.</span>
          <span class="sheet-line">${d.found_at ? `Last looked ${esc(hm(d.found_at))}.` : ''}
            ${d.error ? `<b class="fa-warn">${esc(d.error)}</b>` : ''}</span>
          </span>
        <div class="sheet-ctl">
          <span class="ls-set"><button class="ls-btn" data-act="discover">Look for new sensors</button></span>
          <span class="sheet-line fa-said${this.said?.warn ? ' sheet-warn' : ''}">${esc(this.said?.text || '')}</span>
        </div>
      </div>`, { note: fresh ? `${fresh} new` : d.found_at ? `last looked ${hm(d.found_at)}` : '' }));
    // How a move splits a room's history: reference, folded at the foot.
    cards.push(kit.more('where', 'Where each sensor is', `
      <p class="sheet-note">Tap the room a sensor is in now. Its readings go to that room's card on House,
        the top bar and the chart. The chart keeps each room's history: moved out, a room's line stops at the
        move; moved in, the new room's starts there. A room with two sensors shows one with a temperature and
        humidity before one with only a temperature, and an appliance's own last — or the one chosen with
        "Use this one" above.</p>`, !!this.moreOpen));
    this.bodyEl.innerHTML = cards.join('');
    this.wire();
    this.bodyEl.querySelectorAll('details[data-more]').forEach((el) => {
      el.ontoggle = () => { this.moreOpen = el.open; kit.sync(this.sheet); };
    });
    kit.sync(this.sheet);
  },

  /* Only the figures, as Home Assistant moves them: nothing is rebuilt. */
  paintNow() {
    if (!this.isOpen() || !this.doc) return;
    for (const el of this.bodyEl.querySelectorAll('[data-now]')) {
      const s = (this.doc.sensors || []).find((x) => x.id === el.dataset.now);
      const txt = s ? this.now(s) : '';
      if (el.textContent !== txt) el.textContent = txt;
    }
    // ...and the "now" beside each open alert's level.
    for (const el of this.bodyEl.querySelectorAll('[data-fig]')) {
      const s = this.sensor(el.dataset.fig);
      const m = el.dataset.metric;
      const v = s && (m === 'temp' || m === 'hum') ? num(this.states[s[m]]) : null;
      const txt = v != null ? `now ${fig(m, v)}` : '';
      if (el.textContent !== txt) el.textContent = txt;
    }
  },

  wire() {
    const b = this.bodyEl;
    b.querySelectorAll('.sn-chip').forEach((el) => {
      el.onclick = () => {
        const room = el.dataset.room === 'null' ? null : el.dataset.room;
        this.put(`/api/sensors/${encodeURIComponent(el.dataset.sid)}`, { room }, `place:${el.dataset.sid}`);
      };
    });
    b.querySelectorAll('.sn-main').forEach((el) => {
      el.onclick = () => this.put(`/api/sensors/rooms/${encodeURIComponent(el.dataset.room)}`,
        { main: el.dataset.main }, `place:${el.dataset.main}`);
    });
    b.querySelectorAll('[data-sbar]').forEach((el) => {
      el.onclick = () => this.put(`/api/sensors/${encodeURIComponent(el.dataset.sbar)}`,
        { bar: !el.classList.contains('on') }, `own:${el.dataset.sbar}`);
    });
    b.querySelectorAll('[data-rbar]').forEach((el) => {
      el.onclick = () => this.put(`/api/sensors/rooms/${encodeURIComponent(el.dataset.rbar)}`,
        { bar: !el.classList.contains('on') }, `room:${el.dataset.rbar}`);
    });
    b.querySelectorAll('.sn-name').forEach((el) => {
      el.onkeydown = (e) => { if (e.key === 'Enter') el.blur(); };
      el.onchange = () => {
        const url = el.dataset.rid ? `/api/sensors/rooms/${encodeURIComponent(el.dataset.rid)}`
          : `/api/sensors/${encodeURIComponent(el.dataset.sid)}`;
        this.put(url, { label: el.value }, el.dataset.rid ? `room:${el.dataset.rid}` : `own:${el.dataset.sid}`);
      };
    });
    b.querySelectorAll('[data-bell]').forEach((el) => {
      el.onclick = () => {
        const id = el.dataset.bell;
        if (this.openAlerts.has(id)) this.openAlerts.delete(id); else this.openAlerts.add(id);
        this.render();
      };
    });
    b.querySelectorAll('[data-i]').forEach((el) => { el.onclick = () => this.ruleTap(el); });
    b.querySelectorAll('[data-sa-add]').forEach((el) => {
      el.onclick = () => this.addRule(el.dataset.saAdd, el.dataset.metric, el.dataset.side);
    });
    b.querySelectorAll('[data-how]').forEach((el) => {
      el.onclick = () => { this.close(); this.ctx.automation?.open('house'); };
    });
    b.querySelector('[data-act="discover"]').onclick = async () => {
      this.said = { text: 'Looking…', warn: false };
      this.render();
      try {
        const r = await fetch('/api/sensors/discover', { method: 'POST' });
        const j = await r.json().catch(() => ({}));
        const fresh = (j.sensors || []).filter((s) => s.new && !s.gone).length;
        this.said = r.ok ? { text: fresh ? `${fresh} new.` : 'Nothing new.', warn: false }
          : { text: `It did not look: ${j.error || r.status}`, warn: true };
      } catch {
        this.said = { text: 'It did not look: the kitchen server did not answer', warn: true };
      }
      this.render();
    };
  },

  /* A change to a sensor or a room; `key` is the row it was made in, where
     a refusal is said (putSaid). */
  async put(url, body, key) {
    const had = this.putSaid.has(key);
    let refused = '';
    try {
      const r = await fetch(url, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
      });
      const j = await r.json().catch(() => ({}));
      refused = r.ok ? '' : `Not saved: ${j.error || r.status}`;
    } catch {
      refused = 'Not saved: the kitchen server did not answer';
    }
    if (refused) this.putSaid.set(key, refused); else this.putSaid.delete(key);
    // The move itself arrives over SSE and redraws the sheet; this is for the
    // refusal, which does not — and for taking an old one away.
    if (refused || had) this.render();
  },
};
