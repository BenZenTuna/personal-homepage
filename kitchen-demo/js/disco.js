/* The disco — its document, its card's words and its settings sheet.

   The dancing is the server's (backend/app/disco.py): it notes the chosen
   rooms, drives them a beat at a time, and puts them back when it is
   switched off or its time runs out. Here is only the switch and the
   choices — which rooms (or the whole house), the mode, the speed, and for
   how long. Mode and speed change a disco that is running at once; other
   rooms start it again with them.

   The card is drawn by the House panel on Automation (ha.js,
   buildAuto). This is ctx.disco. */

const esc = (s) => String(s ?? '').replace(/[&<>"]/g,
  (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

const SPEED_WORDS = { slow: 'Slow', normal: 'Normal', fast: 'Fast' };
const minutesText = (m) => (!m ? 'Until switched off' : m < 60 ? `${m} min` : `${m / 60} h`);

export default {
  doc: null,
  subs: [],

  init(ctx) {
    this.ctx = ctx;
    this.buildSheet();
    ctx.bus.on('disco', (doc) => {
      if (!doc || typeof doc !== 'object' || !doc.settings) return;
      this.doc = doc;
      this.changed();
      this.render();
    });
  },

  onDoc(fn) { this.subs.push(fn); },

  changed() {
    for (const fn of this.subs) {
      try { fn(this.doc); } catch (e) { console.error('disco subscriber failed', e); }
    }
  },

  settings() { return (this.doc && this.doc.settings) || {}; },

  running() { return !!this.doc?.running; },

  modeLabel(id) { return ((this.doc?.modes || []).find((m) => m.id === id) || {}).label || id; },

  roomsText(s = this.settings()) {
    if (s.rooms === 'all' || !Array.isArray(s.rooms)) return 'whole house';
    const names = s.rooms.map((e) => ((this.doc?.rooms || []).find((r) => r.entity === e) || {}).label)
      .filter(Boolean);
    return names.length <= 2 ? names.join(', ') : `${names.length} rooms`;
  },

  /* "Party · whole house" */
  summary() {
    const s = this.settings();
    if (!this.doc) return '';
    return `${this.modeLabel(s.mode)} · ${this.roomsText(s)}`;
  },

  status() {
    const r = this.doc?.running;
    if (!r) return `${SPEED_WORDS[this.settings().speed] || ''} · ${minutesText(this.settings().minutes)}`;
    if (!r.until) return 'dancing, until switched off';
    const t = new Date(r.until * 1000);
    return `dancing until ${String(t.getHours()).padStart(2, '0')}:${String(t.getMinutes()).padStart(2, '0')}`;
  },

  async toggle() {
    const on = !this.running();
    // Painted at once; the server's answer follows over SSE.
    if (this.doc) {
      this.doc = { ...this.doc, running: on ? { since: Date.now() / 1000, until: null } : null };
      this.changed();
      this.render();
    }
    try { await fetch(`/api/disco/${on ? 'start' : 'stop'}`, { method: 'POST' }); }
    catch { /* the next snapshot puts it right */ }
  },

  async put(patch) {
    if (this.doc) {
      this.doc = { ...this.doc, settings: { ...this.settings(), ...patch } };
      this.changed();
      this.render();
    }
    try {
      const r = await fetch('/api/disco/settings', {
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
    el.id = 'dc-sheet';
    el.className = 'sheet';   // the settings window kit (app.css)
    el.innerHTML = `
      <header>
        <span class="sheet-icon" aria-hidden="true">🪩</span>
        <div class="sheet-title">
          <h2>Disco</h2>
          <span class="sheet-status dc-now"></span>
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

  /* "15:42" */
  untilText() {
    const t = new Date((this.doc?.running?.until || 0) * 1000);
    return `${String(t.getHours()).padStart(2, '0')}:${String(t.getMinutes()).padStart(2, '0')}`;
  },

  /* The state sentence at the top (the settings window kit): dancing or
     not, and where and how — with Start or Stop beside it, the one thing
     this window is for. */
  sumCard(s, on) {
    const kit = this.ctx.sheetkit;
    const where = s.rooms === 'all' || !Array.isArray(s.rooms) ? 'the whole house' : this.roomsText(s);
    const how = `<b>${esc(this.modeLabel(s.mode))}</b> at <b>${esc((SPEED_WORDS[s.speed] || s.speed || '').toLowerCase())}</b> speed`;
    const ctl = `<button class="ls-btn dc-go${on ? ' sheet-danger on' : ' sheet-primary'}">${
      on ? '■ Stop the disco' : '🪩 Start the disco'}</button>`;
    if (!on) {
      return kit.sum('Not dancing.', {
        next: `Start: ${how} in <b>${esc(where)}</b>, ${s.minutes
          ? `for <b>${esc(minutesText(s.minutes))}</b>` : '<b>until switched off</b>'}.`,
        ctl, off: true,
      });
    }
    const r = this.doc.running;
    return kit.sum(`Dancing ${r.until ? `until <b>${esc(this.untilText())}</b>` : '<b>until switched off</b>'} in <b>${
      esc(where)}</b>.`, { next: `${how}.`, ctl });
  },

  render() {
    if (!this.isOpen() || !this.doc) return;
    const kit = this.ctx.sheetkit;
    const d = this.doc;
    const s = this.settings();
    const pick = (v, want) => (v === want ? ' on' : '');
    const all = s.rooms === 'all' || !Array.isArray(s.rooms);
    const chosen = new Set(all ? [] : s.rooms);
    const on = this.running();
    const r = d.running;
    kit.status(this.sheet.querySelector('.dc-now'), on
      ? `<b>Dancing</b> ${r?.until ? `until ${esc(this.untilText())}` : 'until switched off'}`
      : '<b>Not dancing</b>', on ? 'live' : 'off');
    // The rooms' own emoji, as the doorbell's and Babo's room chips wear them.
    const emoji = (entity) => (this.ctx.config?.entities?.lights || []).find((l) => l?.entity === entity)?.emoji;
    this.bodyEl.innerHTML = `
      ${this.sumCard(s, on)}

      ${kit.sec('How it dances', `
        <div class="ls-row">
          <span class="ls-label">Mode
            <span class="db-hint">${esc(((d.modes || []).find((m) => m.id === s.mode) || {}).about || '')}.
              Changes a running disco at once.</span></span>
          <span class="ls-set sheet-seg">${(d.modes || []).map((m) => `
            <button class="ls-btn dc-mode${pick(s.mode, m.id)}" data-put="mode" data-v='"${esc(m.id)}"'
                    aria-pressed="${s.mode === m.id}">${esc(m.label)}</button>`).join('')}
          </span>
        </div>
        <div class="ls-row">
          <span class="ls-label">Speed
            <span class="db-hint">a beat every 3, 1.5 or 1 seconds — the Hue bridge takes about one
              command a second per room, so faster than that only queues.</span></span>
          <span class="ls-set sheet-seg">${(d.speeds || []).map((x) => `
            <button class="ls-btn${pick(s.speed, x)}" data-put="speed" data-v='"${esc(x)}"'
                    aria-pressed="${s.speed === x}">${esc(SPEED_WORDS[x] || x)}</button>`).join('')}
          </span>
        </div>`, { note: `${this.modeLabel(s.mode)} · ${(SPEED_WORDS[s.speed] || s.speed || '').toLowerCase()}` })}

      ${kit.sec('Rooms', `
        <p class="sheet-note">The chosen rooms come on and dance. Off — or the time running out —
          puts every room back as it was, and the evening ladder leaves them alone meanwhile.</p>
        <div class="ls-row">
          <span class="ls-label"><span class="db-hint sheet-lead">the whole house, or tap rooms to choose them.
            Rooms that cannot show a colour dance in brightness and warmth.</span></span>
          <div class="sheet-ctl">
            <span class="ls-set sheet-seg">
              <button class="ls-btn${all ? ' on' : ''}" data-all="1" aria-pressed="${all}">Whole house</button>
            </span>
            <span class="ls-set sheet-chips">${(d.rooms || []).map((rm) => `
              <button class="ls-btn db-room${chosen.has(rm.entity) ? ' on' : ''}" data-room="${esc(rm.entity)}"
                      aria-pressed="${chosen.has(rm.entity)}">${emoji(rm.entity)
                ? `<span aria-hidden="true">${esc(emoji(rm.entity))}</span> ` : ''}${esc(rm.label)}</button>`).join('')}
            </span>
          </div>
        </div>`, { note: this.roomsText(s) })}

      ${kit.sec('How long', `
        <div class="ls-row">
          <span class="ls-label"><span class="db-hint sheet-lead">then it stops by itself, so a forgotten
            disco does not dance all night.</span></span>
          <span class="ls-set sheet-seg">${(d.minutes || []).map((m) => `
            <button class="ls-btn${pick(s.minutes, m)}" data-put="minutes" data-v="${m}"
                    aria-pressed="${s.minutes === m}">${esc(minutesText(m))}</button>`).join('')}
          </span>
        </div>`, { note: minutesText(s.minutes).replace(/^Until/, 'until') })}`;

    this.bodyEl.querySelector('.dc-go').onclick = () => this.toggle();
    this.bodyEl.querySelectorAll('[data-put]').forEach((btn) => {
      btn.onclick = () => this.put({ [btn.dataset.put]: JSON.parse(btn.dataset.v) });
    });
    this.bodyEl.querySelector('[data-all]').onclick = () => this.put({ rooms: 'all' });
    this.bodyEl.querySelectorAll('[data-room]').forEach((btn) => {
      btn.onclick = () => {
        const set = new Set(all ? [] : s.rooms);
        if (set.has(btn.dataset.room)) set.delete(btn.dataset.room); else set.add(btn.dataset.room);
        const order = (d.rooms || []).map((rm) => rm.entity);
        this.put({ rooms: set.size ? order.filter((e) => set.has(e)) : 'all' });
      };
    });
    kit.sync(this.sheet);
  },
};
