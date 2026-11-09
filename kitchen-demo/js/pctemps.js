/* PC temperatures — the computers' own sensors, and when they alert
   (backend/app/pctemps.py, 2026-10-22).

   Alex: "in the temperature statistics, add a new category and call it PC
   temperatures … it will show CPU temperatures or any other temperature
   sensors from my devices like NAS, the workstation, the home server, AI … Add PC
   temperatures to Automation tab, where users in gear settings can choose
   when the temperatures will alert in which conditions to telegram via HA or
   on protos screen if they reach some temperature for a long time or
   abnormal heating which is diffirentiating from the statistics."

   One card on House → Automation, under Sensors after Temperature sensors:
   each machine's main reading now — its hottest CPU or GPU — or "off", and on
   the bold line an alert in words, how many sensors are still learning what
   is usual for them, or "all as usual". It turns red while an alert is on.

   Its sheet (#pt-sheet) has a section per machine: on or off and when it last
   reported; each sensor with what it reads now and what is usual for it
   ("usually 41°, up to 58°", or how far into its 48 hours of learning it is),
   its Too hot line (− / + in 5°, or Off) and Unusual heat On / Off; then the
   machine's own For (how long past a line counts), how far over its usual
   high is unusual, and Tell — on the wall, ✈ each person's Telegram, 📱 each
   phone, or "As Servers & updates" (the `pctemp` type's row, which also sets
   how the alert looks: alarm or chip, banner, sound). A choice is drawn at
   once and sent a moment after the last tap (STEP_WAIT_MS), and what is sent
   and not yet answered stays drawn, so a snapshot arriving in between never
   takes a half-made choice back. 📈 History opens the temperature chart on
   its PC temperatures tab (climate.js openPc).

   Not copied into the public demo (its words name the machines; the card on
   Automation, in panels/ha.js, is generic and fills from here). This is
   ctx.pctemps. Every word the server sends is escaped. */

const esc = (s) => String(s ?? '').replace(/[&<>"']/g,
  (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const hm = (t) => {
  const d = new Date(t * 1000);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
};
/* "14:02" today, "21 Oct 14:02" any other day. */
const when = (t) => {
  const d = new Date(t * 1000);
  return d.toDateString() === new Date().toDateString() ? hm(t)
    : `${d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })} ${hm(t)}`;
};
const deg = (v) => (v == null ? '—' : `${Math.round(v)}°`);
const KIND_EMOJI = { cpu: '🧠', gpu: '🎮', igpu: '🎮', disk: '💽', board: '🔌' };
const FOR = [[0, 'At once'], [1, '1 min'], [5, '5 min'], [10, '10 min'], [15, '15 min'], [30, '30 min'], [60, '60 min']];
const ABOVE_STEP = 5;
const STEP_WAIT_MS = 700;
const RULE_WORDS = { hot: 'too hot', unusual: 'unusually hot' };

export default {
  doc: null,
  subs: [],
  drafts: {},      // machine id -> settings chosen here, not sent yet
  sending: {},     // machine id -> settings sent, not answered yet
  timers: {},
  /* "machine|s:sensor" (a sensor's row), "machine|after_min", "|margin" or
     "|tell" (the machine's own For, margin and Tell) -> the server's refusal
     of a change made there, said under those controls. A tap takes away
     only its own line, which is under the finger, so nothing above it ever
     moves. */
  said: {},
  shape: '',
  more: {},       // the folded cards opened here, kept across redraws

  init(ctx) {
    this.ctx = ctx;
    this.buildSheet();
    ctx.bus.on('pctemps', (d) => this.take(d));
    fetch('/api/pctemps', { cache: 'no-store' }).then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (d && !this.doc) this.take(d); }).catch(() => {});
    // Who can be told (Telegram's people) and what Servers & updates does now.
    ctx.automation?.onChange(() => this.render());
  },

  take(d) {
    if (!d || !Array.isArray(d.machines)) return;
    this.doc = d;
    this.changed();
    this.render();
  },

  onDoc(fn) { this.subs.push(fn); },

  changed() {
    for (const fn of this.subs) {
      try { fn(this.doc); } catch (e) { console.error('pctemps subscriber failed', e); }
    }
  },

  /* ---------------------------------------------------------- the card -- */

  /* A machine's main figure: the hottest of its CPUs and GPUs now, or of all
     it has when it has neither. */
  mainOf(m) {
    const now = (m.sensors || []).filter((s) => s.c != null);
    const main = now.filter((s) => s.kind === 'cpu' || s.kind === 'gpu');
    const pool = main.length ? main : now;
    return pool.length ? Math.max(...pool.map((s) => s.c)) : null;
  },

  /* The card's two lines: every machine that has ever reported, and the news. */
  summary() {
    const d = this.doc;
    if (!d) return null;
    const ms = d.machines || [];
    const heard = ms.filter((m) => m.at);
    const sub = heard.map((m) => `${m.label} ${m.online ? deg(this.mainOf(m)) : 'off'}`).join(' · ');
    const hot = d.alerts_on || [];
    const learning = ms.filter((m) => m.online).flatMap((m) => m.sensors || []).filter((s) => s.learning).length;
    let status;
    if (hot.length) {
      status = `${hot[0].machine} ${hot[0].sensor} ${RULE_WORDS[hot[0].rule] || 'hot'}${
        hot.length > 1 ? ` · ${hot.length - 1} more` : ''}`;
    } else if (!heard.length) status = 'no computer reporting yet';
    else if (learning) status = `${learning} ${learning === 1 ? 'sensor' : 'sensors'} still learning what is usual`;
    else status = 'all as usual';
    return { sub: sub || 'no readings yet', status, hot: hot.length };
  },

  /* ---------------------------------------------------------- the sheet --

     The settings window kit (app.css, js/sheetkit.js): a card per machine —
     its name, on or off and its main figure as the card's note — with a row
     per sensor (what it reads, what is usual, Too hot above as − value + with
     Off, Unusual heat as a switch) and the machine's own For, margin and
     Tell; then what the two alerts mean, with the way to how they look, and
     how to add a computer, folded. Five machines or more: the rail. */

  buildSheet() {
    const el = document.createElement('div');
    el.id = 'pt-sheet';
    el.className = 'sheet';   // the settings window kit (app.css)
    el.setAttribute('role', 'dialog');
    el.innerHTML = `
      <header>
        <span class="sheet-icon" aria-hidden="true">🖥️</span>
        <div class="sheet-title">
          <h2>PC temperatures</h2>
          <span class="sheet-status pt-head"></span>
        </div>
        <span class="spacer"></span>
        <button class="ls-btn pt-hist">📈 History</button>
        <button class="ls-close">Close</button>
      </header>
      <div class="ls-body"></div>`;
    document.body.appendChild(el);
    this.sheet = el;
    this.bodyEl = el.querySelector('.ls-body');
    el.querySelector('.ls-close').onclick = () => this.close();
    el.querySelector('.pt-hist').onclick = () => { this.close(); this.ctx.climate?.openPc?.(this.doc); };
    this.bodyEl.addEventListener('click', (e) => this.tap(e));
  },

  open() {
    this.said = {};
    this.shape = '';
    this.sheet.classList.add('open');
    this.render();
  },

  close() { this.sheet.classList.remove('open'); },

  isOpen() { return !!this.sheet?.classList.contains('open'); },

  /* A machine's settings as they are drawn: the server's, then what was sent
     and not answered, then what was chosen and not sent. */
  eff(m) {
    const base = m.settings || { after_min: 10, margin: 10, tell: null, sensors: {} };
    const out = { ...base, sensors: { ...(base.sensors || {}) } };
    for (const p of [this.sending[m.id], this.drafts[m.id]]) {
      if (!p) continue;
      for (const [k, v] of Object.entries(p)) {
        if (k !== 'sensors') { out[k] = v; continue; }
        for (const [sid, s] of Object.entries(v)) out.sensors[sid] = { ...(out.sensors[sid] || {}), ...s };
      }
    }
    return out;
  },

  /* What Servers & updates does with this type now, as a Tell. */
  typeTell() {
    const st = this.ctx.automation?.type?.('pctemp')?.style;
    return { wall: !st || st.show !== 'off', telegram: st?.telegram || [], phones: st?.phones || [] };
  },

  people() {
    const tg = this.ctx.automation?.tg;
    return tg?.configured ? (tg.people || []) : [];
  },

  phones() { return (this.ctx.config?.phones || []).filter((p) => p.ready); },

  seenText(m) {
    if (m.online) return `${m.local ? 'read by the kitchen itself' : 'reporting'} · last ${hm(m.at)}`;
    if (m.at) return `off — last reported ${when(m.at)}`;
    return m.local ? 'the kitchen has read nothing here yet' : 'has not reported yet — its reporter is installed as below';
  },

  usualText(s) {
    const parts = [];
    if (s.high != null && !s.learning) parts.push(`usually ${deg(s.usual)}, up to ${deg(s.high)}`);
    else {
      if (s.usual != null) parts.push(`usually ${deg(s.usual)}`);
      parts.push(`learning its usual — ${s.hours} h of ${this.doc?.learn_hours || 48}`);
    }
    if (s.crit != null) parts.push(`its own limit ${deg(s.crit)}`);
    return parts.join(' · ');
  },

  /* The header's line and its tone: an alert on wants somebody; nothing
     reporting at all is off. How many report, in bold, before the news. */
  headLine() {
    const d = this.doc;
    const v = this.summary();
    if (!v) return ['', ''];
    const ms = d.machines || [];
    const online = ms.filter((m) => m.online).length;
    const heard = ms.some((m) => m.at);
    if (v.hot || !heard) return [`<b>${esc(v.status)}</b>`, v.hot ? 'warn' : 'off'];
    return [`<b>${online} of ${ms.length} reporting</b> · ${esc(v.status)}`, 'ok'];
  },

  /* A refusal under the controls it took back, or nothing: a sensor's row
     (`s:<sid>`) or one of the machine's own (after_min, margin, tell). */
  refusal(m, part) {
    const t = this.said[`${m.id}|${part}`];
    return t ? `<span class="sheet-line sheet-warn pt-said">${esc(t)}</span>` : '';
  },

  /* The places a change touches, as keys of `said`. */
  rowsOf(id, patch) {
    return Object.keys(patch).flatMap((k) => (k === 'sensors'
      ? Object.keys(patch.sensors || {}).map((sid) => `${id}|s:${sid}`) : [`${id}|${k}`]));
  },

  /* A machine card's note — beside its name, and under it on the rail. */
  noteOf(m) {
    const hot = (m.sensors || []).filter((s) => (s.alerting || []).length);
    if (hot.length) return `${hot[0].label} ${RULE_WORDS[hot[0].alerting[0]] || 'hot'} now${hot.length > 1 ? ` · ${hot.length - 1} more` : ''}`;
    if (m.online) {
      const main = this.mainOf(m);
      return main == null ? 'on' : `on · ${deg(main)}`;
    }
    return m.at ? `off · last ${when(m.at)}` : 'not reported yet';
  },

  render() {
    if (!this.isOpen()) return;
    const kit = this.ctx.sheetkit;
    const d = this.doc;
    const [line, tone] = this.headLine();
    kit.status(this.sheet.querySelector('.pt-head'), line, tone);
    if (!d) {
      this.bodyEl.innerHTML = '<p class="sheet-line">The kitchen has not heard from its server yet.</p>';
      this.shape = '';
      kit.sync(this.sheet);
      return;
    }
    // Rebuilt only when something drawn as a button or a line changes; the
    // figures alone are painted in place (paintNow), so a finger on a button
    // never has it replaced under it by a reading.
    const shape = JSON.stringify([d.machines.map((m) => [m.id, m.label, m.online, !!m.at,
      (m.sensors || []).map((s) => [s.sid, s.label, s.kind, s.alerting, s.learning]), this.eff(m)]),
      this.people().map((p) => [p.id, p.name, !!p.chat]), this.phones().map((p) => [p.id, p.label]),
      this.typeTell(), this.said]);
    if (shape === this.shape) { this.paintNow(); return; }
    this.shape = shape;
    this.bodyEl.innerHTML = [...d.machines.map((m) => this.machineHtml(m)), this.intro(), this.howToAdd()].join('');
    this.bodyEl.querySelectorAll('details[data-more]').forEach((el) => {
      el.ontoggle = () => { this.more[el.dataset.more] = el.open; kit.sync(this.sheet); };
    });
    kit.sync(this.sheet);
  },

  /* What the two alerts mean — read once, kept at the foot — and the way to
     how they look on the wall. */
  intro() {
    return this.ctx.sheetkit.sec('When a computer alerts', `
      <p class="sheet-note"><b>Too hot</b>: a sensor above its line for the minutes under <b>For</b>.
        <b>Unusual heat</b>: its last five minutes hotter than its usual high — the level it passes one
        hour in twenty, from its own last two weeks — by more than the machine's margin. A sensor learns
        for its first 48 hours of readings and never alerts as unusual before. A computer that is off,
        asleep or in Windows never alerts, and its alerts end quietly.</p>
      <p class="sheet-note pt-howline"><button class="ls-btn pt-how" data-how="1">How these alerts look (alarm or chip, banner, sound) ›</button></p>`,
    { note: 'too hot · unusual heat' });
  },

  machineHtml(m) {
    const e = this.eff(m);
    const sensors = m.sensors || [];
    const hot = sensors.some((s) => (s.alerting || []).length);
    // A machine that is off keeps its settings to change, its controls faded.
    return this.ctx.sheetkit.sec(m.label, `
      <p class="sheet-note pt-mhead" data-seen="${esc(m.id)}">${esc(this.seenText(m))}</p>
      ${sensors.length ? `<div class="pt-rows${m.online ? '' : ' nt-off'}">
        ${sensors.map((s) => this.sensorHtml(m, s, e)).join('')}
        ${this.rulesHtml(m, e)}
      </div>` : ''}`, {
      note: this.noteOf(m),
      cls: `pt-mach${m.online ? '' : ' pt-off'}${hot ? ' pt-hot' : ''}`,
      attrs: `data-mach="${esc(m.id)}"`,
    });
  },

  sensorHtml(m, s, e) {
    const kit = this.ctx.sheetkit;
    const cfg = e.sensors?.[s.sid] || this.doc.kinds_default?.[s.kind] || { above: null, unusual: false };
    const at = `data-m="${esc(m.id)}" data-sid="${esc(s.sid)}"`;
    const on = s.alerting || [];
    // Too hot above: − line +, and Off as the bar's chosen none; while off,
    // Off chosen and Set, which puts the line back at its kind's.
    const above = cfg.above == null
      ? `<button class="ls-btn sheet-txt sheet-none pt-step on" ${at} data-above="off" aria-pressed="true">Off</button>
         <button class="ls-btn sheet-txt pt-step" ${at} data-above="set">Set</button>`
      : `<button class="ls-btn pt-step" ${at} data-above="${-ABOVE_STEP}" aria-label="${esc(s.label)}: lower">−</button>
         <b class="sheet-val pt-lv">${esc(deg(cfg.above))}</b>
         <button class="ls-btn pt-step" ${at} data-above="${ABOVE_STEP}" aria-label="${esc(s.label)}: higher">+</button>
         <button class="ls-btn sheet-txt sheet-none pt-step" ${at} data-above="off" aria-pressed="false">Off</button>`;
    return `
      <div class="ls-row pt-row${on.length ? ' pt-alerting' : ''}">
        <span class="ls-label"><span class="pt-name"><span aria-hidden="true">${KIND_EMOJI[s.kind] || '🌡️'}</span> ${esc(s.label)}</span>
          <b class="pt-v" data-now="${esc(m.id)}|${esc(s.sid)}">${esc(deg(s.c))}</b>
          <span class="db-hint" data-usual="${esc(m.id)}|${esc(s.sid)}">${esc(this.usualText(s))}</span>
          ${on.length ? `<span class="sheet-line"><b class="fa-warn">${esc(on.map((r) => RULE_WORDS[r] || r).join(' and '))} now</b></span>` : ''}</span>
        <div class="sheet-ctl sheet-across pt-set">
          <span class="pt-grp pt-abovegrp"><span class="sheet-cap pt-ll${cfg.above == null ? ' off' : ''}">Too hot above</span>
            <span class="ls-set sheet-step pt-above">${above}</span></span>
          <span class="pt-grp"><span class="sheet-cap pt-ll">Unusual heat</span>
            ${kit.toggle(!!cfg.unusual, `${at} data-unusual="${cfg.unusual ? 'off' : 'on'}"`,
              { cls: 'pt-step' })}</span>
          ${this.refusal(m, `s:${s.sid}`)}
        </div>
      </div>`;
  },

  /* The machine's own: For, the margin over its usual high, and Tell. */
  rulesHtml(m, e) {
    const id = `data-m="${esc(m.id)}"`;
    const fr = FOR.map(([v, w]) => `<button class="ls-btn pt-step${e.after_min === v ? ' on' : ''}" ${id}
      data-after="${v}" aria-pressed="${e.after_min === v}">${w}</button>`).join('');
    const own = !!e.tell;
    const t = e.tell || this.typeTell();
    // As Servers & updates, the chips show what that row does now, dashed —
    // it is what happens, but not chosen here. A person who has not linked
    // Telegram is dashed too, and cannot be ticked (but can be taken out).
    const soft = own ? '' : ' pt-inherit';
    const chip = (attrs, on, text, title = '', dim = false) => `<button class="ls-btn${!own || dim ? ' sheet-na' : ''} pt-tell${
      on ? ' on' : ''}${soft}${dim ? ' pt-dim' : ''}" ${id} ${attrs} aria-pressed="${on}"${dim && !on ? ' disabled' : ''}${
      title ? ` title="${esc(title)}"` : ''}>${text}</button>`;
    const folk = this.people().map((p) => chip(`data-tg="${esc(p.id)}"`, t.telegram.includes(p.id), `✈ ${esc(p.name)}`,
      p.chat ? `on ${p.name}'s Telegram` : `${p.name} has not linked Telegram yet — House → Automation → Telegram`, !p.chat))
      .join('');
    const phones = this.phones().map((p) => chip(`data-ph="${esc(p.id)}"`, t.phones.includes(p.id), `📱 ${esc(p.label)}`,
      `a notification on ${p.label} through Home Assistant`)).join('');
    return `
      <div class="ls-row pt-mset">
        <span class="ls-label">${esc(m.label)}'s alerts
          <span class="db-hint">how long a sensor is past its line before it alerts, how far over its usual
            high is unusual, and where an alert goes.</span></span>
        <div class="sheet-ctl">
          <span class="pt-grp"><span class="sheet-cap pt-ll">For</span>
            <span class="ls-set sheet-seg pt-set">${fr}</span>${this.refusal(m, 'after_min')}</span>
          <span class="pt-grp"><span class="sheet-cap pt-ll">More than its usual high by</span>
            <span class="ls-set sheet-step pt-set">
              <button class="ls-btn pt-step" ${id} data-margin="-1" aria-label="margin: less"${e.margin <= (this.doc.limits?.margin?.[0] ?? 3) ? ' disabled' : ''}>−</button>
              <b class="sheet-val pt-lv">${esc(deg(e.margin))}</b>
              <button class="ls-btn pt-step" ${id} data-margin="1" aria-label="margin: more"${e.margin >= (this.doc.limits?.margin?.[1] ?? 30) ? ' disabled' : ''}>+</button></span>${
              this.refusal(m, 'margin')}</span>
          <span class="pt-grp"><span class="sheet-cap pt-ll">Tell</span>
            <span class="ls-set sheet-chips pt-set">
              <button class="ls-btn pt-tell${own ? '' : ' on'}" ${id} data-tell="same" aria-pressed="${!own}"
                title="as the 'A computer running hot' row in Servers &amp; updates">As Servers &amp; updates</button>
              ${chip('data-tell="wall"', t.wall, '🖥️ On the wall', 'in Needs attention on the wall')}${folk}${phones}</span>${
              this.refusal(m, 'tell')}</span>
        </div>
      </div>`;
  },

  howToAdd() {
    const local = (this.doc.machines || []).find((m) => m.local);
    return this.ctx.sheetkit.more('add', 'Adding a computer', `
      <p class="sheet-note">${local ? `${esc(local.label)}'s sensors are read by the kitchen itself. ` : ''}Every
        other machine runs a small reporter that sends its readings every minute; it shows up here by
        itself. On the machine, from a checkout of the wall-Kitchen:
        <code>sh kitchen/pctemps/install.sh zerg</code> (or tunai, protos). The NAS starts the same script
        from DSM's Task Scheduler at boot — its steps, and the check its sleeping disks need first, are in
        the kitchen's README under "PC temperatures".</p>`, !!this.more.add);
  },

  /* The figures only, as reports arrive: nothing is rebuilt — but each
     machine's note follows its main figure, here and on the rail. */
  paintNow() {
    const d = this.doc;
    const find = (key) => {
      const [mid, sid] = key.split('|');
      const m = (d.machines || []).find((x) => x.id === mid);
      return [m, (m?.sensors || []).find((x) => x.sid === sid)];
    };
    const put = (el, txt) => { if (el.textContent !== txt) el.textContent = txt; };
    for (const el of this.bodyEl.querySelectorAll('[data-now]')) put(el, deg(find(el.dataset.now)[1]?.c));
    for (const el of this.bodyEl.querySelectorAll('[data-usual]')) {
      const s = find(el.dataset.usual)[1];
      if (s) put(el, this.usualText(s));
    }
    for (const el of this.bodyEl.querySelectorAll('[data-seen]')) {
      const m = (d.machines || []).find((x) => x.id === el.dataset.seen);
      if (m) put(el, this.seenText(m));
    }
    let moved = false;
    for (const sec of this.bodyEl.querySelectorAll(':scope > section[data-mach]')) {
      const m = (d.machines || []).find((x) => x.id === sec.dataset.mach);
      const note = m ? this.noteOf(m) : '';
      if (!m || sec.dataset.note === note) continue;
      sec.dataset.note = note;
      const sub = sec.querySelector(':scope > .sheet-h > .sheet-sub');
      if (sub) sub.textContent = note;
      moved = true;
    }
    if (moved) this.ctx.sheetkit?.sync(this.sheet);
  },

  tap(e) {
    const b = e.target.closest('button');
    if (!b || !this.doc) return;
    if (b.dataset.how) { this.close(); this.ctx.automation?.open('servers'); return; }
    const m = (this.doc.machines || []).find((x) => x.id === b.dataset.m);
    if (!m) return;
    const eff = this.eff(m);
    const lim = this.doc.limits || { above: [30, 120], margin: [3, 30] };
    const clamp = (v, [lo, hi]) => Math.min(hi, Math.max(lo, v));
    if (b.dataset.above) {
      const s = (m.sensors || []).find((x) => x.sid === b.dataset.sid);
      const cur = eff.sensors?.[b.dataset.sid]?.above;
      let v;
      if (b.dataset.above === 'off') {
        // Off is already the chosen none: tapping it again changes nothing.
        if ((eff.sensors?.[b.dataset.sid] || this.doc.kinds_default?.[s?.kind])?.above == null) return;
        v = null;
      }
      else if (b.dataset.above === 'set') {
        // From its kind's line, or else twenty degrees over what it reads now.
        const dflt = this.doc.kinds_default?.[s?.kind]?.above;
        v = dflt ?? clamp(Math.round(((s?.c ?? 50) + 20) / ABOVE_STEP) * ABOVE_STEP, lim.above);
      } else v = clamp((cur ?? 80) + Number(b.dataset.above), lim.above);
      this.set(m.id, { sensors: { [b.dataset.sid]: { above: v } } }, b.dataset.above === 'off' || b.dataset.above === 'set' ? 0 : STEP_WAIT_MS);
    } else if (b.dataset.unusual) {
      this.set(m.id, { sensors: { [b.dataset.sid]: { unusual: b.dataset.unusual === 'on' } } });
    } else if (b.dataset.after) {
      this.set(m.id, { after_min: Number(b.dataset.after) });
    } else if (b.dataset.margin) {
      this.set(m.id, { margin: clamp(eff.margin + Number(b.dataset.margin), lim.margin) }, STEP_WAIT_MS);
    } else if (b.dataset.tell === 'same') {
      this.set(m.id, { tell: null });
    } else if (b.dataset.tell || b.dataset.tg || b.dataset.ph) {
      // The first own choice starts from what Servers & updates does now.
      const t = eff.tell ? { ...eff.tell } : this.typeTell();
      const flip = (list, x) => (list.includes(x) ? list.filter((y) => y !== x) : [...list, x]);
      if (b.dataset.tell === 'wall') t.wall = !t.wall;
      if (b.dataset.tg) t.telegram = flip(t.telegram, b.dataset.tg);
      if (b.dataset.ph) t.phones = flip(t.phones, b.dataset.ph);
      // Only who can be told now: a person or phone gone from the config is dropped.
      const folk = new Set(this.people().map((p) => p.id));
      const phones = new Set((this.ctx.config?.phones || []).map((p) => p.id));
      this.set(m.id, { tell: { wall: t.wall, telegram: t.telegram.filter((x) => folk.has(x)),
                               phones: t.phones.filter((x) => phones.has(x)) } });
    }
  },

  /* A choice: drawn now, sent `wait` ms after the last one for this machine. */
  set(id, patch, wait = 0) {
    const dr = this.drafts[id] || (this.drafts[id] = {});
    for (const [k, v] of Object.entries(patch)) {
      if (k !== 'sensors') { dr[k] = v; continue; }
      dr.sensors = dr.sensors || {};
      for (const [sid, s] of Object.entries(v)) dr.sensors[sid] = { ...(dr.sensors[sid] || {}), ...s };
    }
    for (const k of this.rowsOf(id, patch)) delete this.said[k];
    this.render();
    clearTimeout(this.timers[id]);
    this.timers[id] = setTimeout(() => this.flush(id), wait);
  },

  async flush(id) {
    const body = this.drafts[id];
    if (!body) return;
    // One at a time per machine: the next waits for the answer to this one.
    if (this.sending[id]) { this.timers[id] = setTimeout(() => this.flush(id), 300); return; }
    delete this.drafts[id];
    this.sending[id] = body;
    try {
      const r = await fetch('/api/pctemps/settings', {
        method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ machine: id, ...body }),
      });
      const j = await r.json().catch(() => null);
      if (r.ok && j && Array.isArray(j.machines)) {
        this.doc = j;
        this.changed();
      } else this.refuse(id, body, `Not saved: ${j?.error || r.status}`);
    } catch {
      this.refuse(id, body, 'Not saved: the kitchen server did not answer');
    }
    delete this.sending[id];
    this.render();
  },

  refuse(id, body, text) {
    for (const k of this.rowsOf(id, body)) this.said[k] = text;
  },
};
