/* Zigbee switches — a room's own wall switch pauses its evening ladder.

   The holds are heard by the server (backend/app/zswitch.py): hold O on a
   room's switch pauses that room's ladder for the one time chosen here; hold
   I takes the room's pause off and puts it back on its ladder. Here is the
   card on House → Lights 2 (in the free cell after the rooms there; ha.js
   gives it the cell with mount()) and its settings sheet. The pause itself
   is the ladder's (lights.py), so the room's tile shows it as any pause.
   This is ctx.zswitch. */

const esc = (s) => String(s ?? '').replace(/[&<>"]/g,
  (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

const minutesText = (m) => (!m ? 'until I is held' : m < 60 ? `${m} min` : `${m / 60} h`);
const KIND = { hue: 'Hue dimmer', ikea: 'IKEA remote' };
const RECENT_S = 12 * 3600;     // the last hold is news on the card this long

/* "23:40" — and "Sun 01:10" only when it is more than 20 hours away: a
   pause running past midnight is still "01:10". */
function clock(iso) {
  const t = iso ? new Date(iso) : null;
  if (!t || Number.isNaN(t.getTime())) return '';
  const hm = `${String(t.getHours()).padStart(2, '0')}:${String(t.getMinutes()).padStart(2, '0')}`;
  return Math.abs(t.getTime() - Date.now()) < 20 * 3600e3 ? hm
    : `${t.toLocaleDateString('en-GB', { weekday: 'short' })} ${hm}`;
}

export default {
  doc: null,
  card: null,

  init(ctx) {
    this.ctx = ctx;
    this.buildSheet();
    ctx.bus.on('zswitch', (doc) => {
      if (!doc || typeof doc !== 'object' || !doc.settings) return;
      this.doc = doc;
      this.paintCard();
      this.render();
    });
    // The rooms' pauses are the ladder's: the card's line follows them too.
    ctx.bus.on('lights_schedule', () => { this.paintCard(); this.render(); });
  },

  settings() { return (this.doc && this.doc.settings) || {}; },

  /* {entity: {until, by}} — the pauses that end by themselves, from the
     ladder's own document. */
  timed() { return this.ctx.lightsched?.doc?.pause_until || {}; },

  paused() { return this.ctx.lightsched?.doc?.paused || {}; },

  /* ------------------------------------------------------------ card -- */
  /* ha.js calls this after every redraw of the Lights 2 grid, with the grid:
     the card is the grid's last cell. */
  mount(grid) {
    if (!grid) return;
    if (!this.card) {
      const el = document.createElement('div');
      el.className = 'phone-card au-card zs-card';
      el.innerHTML = `
        <span class="phone-emoji" aria-hidden="true">🎛️</span>
        <span class="phone-txt">
          <span class="phone-name">Zigbee switches</span>
          <span class="phone-sub au-sub"></span>
          <span class="phone-status au-status" aria-live="polite"></span>
        </span>
        <button class="phone-ring ch-btn au-btn">Off</button>
        <button class="tile-gear ch-gear au-gear" title="Zigbee switches settings"
                aria-label="Zigbee switches settings">⚙</button>`;
      el.querySelector('.au-btn').onclick = () => this.put({ enabled: !this.settings().enabled });
      el.querySelector('.au-gear').onclick = () => this.open();
      el.querySelector('.phone-txt').onclick = () => this.open();
      this.card = el;
    }
    grid.appendChild(this.card);
    this.paintCard();
  },

  /* The rooms paused from a switch now: "Kitchen until 23:40". */
  pausedLines() {
    const sched = this.ctx.lightsched;
    const paused = this.paused();
    return Object.entries(this.timed())
      .filter(([e, v]) => paused[e] && /switch$/.test(v.by || ''))
      .map(([e, v]) => `${sched ? sched.roomLabel(e) : e} till ${clock(v.until)}`);
  },

  paintCard() {
    const el = this.card;
    if (!el) return;
    el.hidden = !this.doc;
    if (!this.doc) return;
    const s = this.settings();
    const on = !!s.enabled;
    el.classList.toggle('au-on', on);
    // Short: the card is one cell of the rooms' grid, beside its switch.
    const sub = !on ? 'Off — holds do nothing'
      : [s.hold_off && `O:\u00a0pause\u00a0${(s.minutes ? minutesText(s.minutes) : 'till I').replace(' ', '\u00a0')}`,
        s.hold_on && 'I:\u00a0resume']
        .filter(Boolean).join(' · ') || 'Both holds off';
    const now = this.pausedLines();
    const last = this.doc.last;
    const status = now.length ? `⏸ ${now.join(', ')}`
      : last && Date.now() / 1000 - last.at < RECENT_S ? `${last.label}: ${last.did}`
      : `${(this.doc.switches || []).length} switches, a room each`;
    for (const [sel, txt] of [['.au-sub', sub], ['.au-status', status]]) {
      const x = el.querySelector(sel);
      if (x.textContent !== txt) x.textContent = txt;
    }
    el.classList.toggle('zs-paused', on && now.length > 0);
    const btn = el.querySelector('.au-btn');
    const w = on ? 'On' : 'Off';
    if (btn.textContent !== w) btn.textContent = w;
    btn.classList.toggle('on', on);
    btn.setAttribute('aria-label', `Zigbee switches ${on ? 'on, switch off' : 'off, switch on'}`);
  },

  async put(patch) {
    if (this.doc) {
      this.doc = { ...this.doc, settings: { ...this.settings(), ...patch } };
      this.paintCard();
      this.render();
    }
    try {
      const r = await fetch('/api/zswitch/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch),
      });
      const body = await r.json().catch(() => ({}));
      if (r.ok && body.settings && this.doc) {
        this.doc = { ...this.doc, settings: body.settings };
        this.paintCard();
        this.render();
      }
    } catch { /* the next snapshot puts it right */ }
  },

  /* ----------------------------------------------------------- sheet -- */
  buildSheet() {
    const el = document.createElement('div');
    el.id = 'zs-sheet';
    el.className = 'sheet';   // the settings window kit (app.css)
    el.innerHTML = `
      <header>
        <span class="sheet-icon" aria-hidden="true">🎛️</span>
        <div class="sheet-title">
          <h2>Zigbee switches</h2>
          <span class="sheet-status zs-now"></span>
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

  render() {
    if (!this.isOpen() || !this.doc) return;
    const kit = this.ctx.sheetkit;
    const d = this.doc;
    const s = this.settings();
    const on = !!s.enabled;
    const sched = this.ctx.lightsched;
    const housePaused = !!sched?.housePaused?.();
    const now = this.pausedLines();
    kit.status(this.sheet.querySelector('.zs-now'), !on ? '<b>Off</b>'
      : now.length ? `<b>${now.length} room${now.length === 1 ? '' : 's'} paused</b> from a switch`
      : '<b>On</b> · listening to the switches', !on ? 'off' : now.length ? 'live' : 'ok');
    const pick = (v, want) => (v === want ? ' on' : '');
    const timed = this.timed();
    const paused = this.paused();
    const roomNow = (room) => {
      if (housePaused) return 'the whole house is paused';
      if (!paused[room]) return 'follows its ladder';
      const t = timed[room];
      return t ? `paused until ${clock(t.until)}${t.by ? ` (${t.by})` : ''}` : 'paused until resumed';
    };
    const emoji = (entity) => (this.ctx.config?.entities?.lights || []).find((l) => l?.entity === entity)?.emoji;
    const last = d.last;

    this.bodyEl.innerHTML = `
      ${kit.sum(!on ? 'Off — holding a switch\'s buttons does nothing to the ladder.'
        : `Holding <b>O</b> on a room's switch pauses <b>that room's</b> evening ladder ${
          s.minutes ? `for <b>${esc(minutesText(s.minutes))}</b>` : '<b>until I is held</b>'}; holding <b>I</b>
          puts it back on its ladder.`, {
        next: on && now.length ? `Paused now: ${esc(now.join(', ').replace(/ till /g, ' until '))}.`
          : on ? 'Only that room — the rest of the house keeps following the ladder.' : '',
        ctl: kit.toggle(on, `data-put="enabled" data-v="${!on}"`), off: !on,
      })}

      ${kit.sec('Hold O — pause the room', `
        <div class="ls-row">
          <span class="ls-label">Hold O
            <span class="db-hint">a second or so on the bottom button, O. The room's tile shows ⏸
              and when it ends; the switch and Home Assistant decide its light meanwhile.</span></span>
          <span class="ls-set">${kit.toggle(!!s.hold_off, `data-put="hold_off" data-v="${!s.hold_off}"`)}</span>
        </div>
        <div class="ls-row">
          <span class="ls-label">For how long
            <span class="db-hint">one time for every room. Then the room follows its ladder again by
              itself, at the step it would be at by then.</span></span>
          <span class="ls-set sheet-seg">${(d.minutes || []).map((m) => `
            <button class="ls-btn${pick(s.minutes, m)}" data-put="minutes" data-v="${m}"
                    aria-pressed="${s.minutes === m}">${esc(m ? minutesText(m) : 'Until I')}</button>`).join('')}
          </span>
        </div>`, { note: s.hold_off ? minutesText(s.minutes) : 'off' })}

      ${kit.sec('Hold I — follow the house again', `
        <div class="ls-row">
          <span class="ls-label">Hold I
            <span class="db-hint">the top button, I: takes the room's pause off — one from its switch or
              one tapped on the wall — and sets it to its ladder's step at once. The whole house's ⏸ on
              Lights 1 is the house's, and stays.</span></span>
          <span class="ls-set">${kit.toggle(!!s.hold_on, `data-put="hold_on" data-v="${!s.hold_on}"`)}</span>
        </div>`, { note: s.hold_on ? 'resumes the room' : 'off' })}

      ${kit.sec('The switches', `
        <p class="sheet-note">Each switch pauses the room it is in. The Hue bridge and the IKEA remote still
          do their own job for the same hold, so holding O also dims the room.</p>
        ${(d.switches || []).map((sw) => `
          <div class="ls-row zs-sw">
            <span class="ls-label">${esc(sw.label)} <small class="zs-kind">${esc(KIND[sw.kind] || sw.kind)}</small>
              <span class="db-hint">${emoji(sw.room) ? `${esc(emoji(sw.room))} ` : ''}${esc(sw.room_label)}
                · ${esc(roomNow(sw.room))}</span></span>
          </div>`).join('')}
        <p class="sheet-note zs-last">${last
          ? `Last hold: <b>${esc(last.label)}</b> at ${esc(clock(new Date(last.at * 1000).toISOString()))} — ${esc(last.did)}.`
          : 'No hold heard since the dashboard last started.'}</p>`,
      { note: `${(d.switches || []).length} switches` })}`;

    this.bodyEl.querySelectorAll('[data-put]').forEach((btn) => {
      btn.onclick = () => this.put({ [btn.dataset.put]: JSON.parse(btn.dataset.v) });
    });
    kit.sync(this.sheet);
  },
};
