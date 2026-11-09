/* House → Automation's alert cards — the Aurora alert, Radar, House alerts
   and Servers & updates — their words and the sheet behind their gears
   (2026-10-11).

   Until then how each alert showed was set in the Needs attention window,
   behind its ⚙ ("How alerts show"). Alex wanted the automations together on
   House, so those settings moved here, grouped onto cards, and the window's ⚙
   now brings the wall to this tab instead.

   - **Aurora**: on or off, how strong the aurora has to be (Kp) and how clear
     the sky, what the sky says now, and how its alert shows. The looking is
     the server's (backend/app/aurora.py); its alert is an ordinary Needs
     attention item of type `aurora`.
   - **Radar**: how TunaRadar's alerts show, and since this day each tracker's
     own, when it should differ (attention.py read_tracker_styles). Since
     2026-10-12 also when each tracker's finds alert — every new result, in
     the day's digest, or only in the Radar feed — and whether its owners'
     phones are told (radarfeed.py, PUT /api/radar/settings).
   - **House alerts** and **Servers & updates**: the other types, grouped.
   - **Telegram** (2026-10-13, moved here from the bird box's ⚙ at Alex's
     ask): the kitchen's bot and who has linked their own Telegram to it
     (telegram.py). The ✈ buttons on clips, stills and liked photos send to
     the people linked here.

   Since 2026-10-12 Aurora and Radar have quiet hours of their own, weekday
   and weekend nights apart (backend/app/alerthours.py; the clock's until
   then). In the aurora's no alert comes at all; in Radar's nothing rings,
   no phone is told and the wall is not woken — a find waits for the morning.

   The cards are drawn by the House panel (ha.js, buildAuto), for the phone
   box's reason: the panel owns the rows, this owns the things. It is on the
   context as ctx.automation. Every word the server sends is escaped here. */

const esc = (s) => String(s ?? '').replace(/[&<>"']/g,
  (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const SHOW_WORDS = [
  ['alarm', 'Alarm', 'the chip red, a sign blinking, first in the list'],
  ['chip', 'On the chip', 'counted on the chip'],
  ['list', 'In the list', 'only in the Needs attention window, under "when you have time"'],
  ['off', 'Off', 'not shown at all'],
];
const SHOW_SHORT = { alarm: 'alarm', chip: 'on the chip', list: 'in the list', off: 'off' };
const SOUND_NAMES = {
  funny: 'Funny alarm', cartoon: 'Cartoon clock', space: 'Space ambient', radar1: 'Radar 1', radar2: 'Radar 2',
};

/* The alert types on the two group cards, in the order their sheets list them. */
export const GROUPS = {
  house: { name: 'House alerts', emoji: '🏠',
           types: ['water', 'climate', 'battery', 'offline', 'camera', 'diffuser_dry', 'diffuser_low', 'diffuser_empty'],
           sub: 'flowers, rooms, batteries, devices, bird box, diffuser' },
  /* `pctemp` (2026-10-22): a computer running hot. Its look is set here like
     every other's; where it goes may be each machine's own, on the PC
     temperatures card (pctemps.js). */
  servers: { name: 'Servers & updates', emoji: '🖥️',
             types: ['services', 'pctemp', 'images', 'update', 'ha', 'weather', 'voices', 'notes'],
             sub: 'services, backups, PC heat, updates, HA, agent notes' },
};

/* The sheet's header per mode (the settings window kit): the emoji its card
   on the wall wears, and the section hue it takes, when not the House's green. */
const HEADS = {
  aurora: ['🌌', ''], radar: ['📡', 'a-radar'], house: ['🏠', ''], servers: ['🖥️', ''], telegram: ['✈️', 'a-birds'],
};

/* What each Kp level means from the house, at about 56.5° geomagnetic. */
const KP_SAYS = {
  3: 'faint, low in the north — often only a camera sees it',
  4: 'low on the northern horizon on a dark night',
  5: 'clearly in the north, sometimes with colour',
  6: 'high in the sky, perhaps overhead — rare',
};

const hh = (h) => `${String(h).padStart(2, '0')}:00`;

const hm = (t) => {
  const d = new Date(t * 1000);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
};

export default {
  snap: null,          // the Needs attention snapshot
  aurora: null,        // aurora.py's snapshot
  radar: null,         // radarfeed.py's snapshot: the feed's settings and counts
  tg: null,            // telegram.py's snapshot: the bot, the people, their chats
  subs: [],
  mode: null,          // which sheet is open: 'aurora', 'radar', 'house', 'servers'
  more: {},            // which folded parts of the sheet are open ("What the choices mean"), by name

  init(ctx) {
    this.ctx = ctx;
    this.buildSheet();
    ctx.bus.on('attention', (snap) => this.take(snap));
    ctx.bus.on('aurora', (doc) => {
      if (!doc || typeof doc !== 'object' || !doc.settings) return;
      this.aurora = doc;
      this.changed();
      this.render();
    });
    fetch('/api/attention', { cache: 'no-store' }).then((r) => (r.ok ? r.json() : null))
      .then((s) => { if (s && !this.snap) this.take(s); }).catch(() => {});
    ctx.bus.on('radar', (doc) => {
      if (!doc || typeof doc !== 'object' || !Array.isArray(doc.posts)) return;
      this.radar = doc;
      this.changed();
      this.render();
    });
    ctx.bus.on('telegram', (t) => {
      if (!t || typeof t !== 'object') return;
      this.tg = t;
      this.changed();
      this.render();
    });
    fetch('/api/telegram', { cache: 'no-store' }).then((r) => (r.ok ? r.json() : null))
      .then((t) => { if (t && !this.tg) { this.tg = t; this.changed(); this.render(); } }).catch(() => {});
    fetch('/api/aurora', { cache: 'no-store' }).then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (d && d.settings && !this.aurora) { this.aurora = d; this.changed(); this.render(); }
      }).catch(() => {});
    // The diffuser's two water levels are set in the House alerts sheet.
    ctx.diffuser?.onDoc(() => { if (this.mode === 'house') this.render(); });
    // ...and the climate row says how many sensors' alerts choose their own way.
    ctx.sensors?.onDoc?.(() => { if (this.mode === 'house') this.render(); });
    // A text made by AI, or waiting for it: the rows' 🗣 say so.
    ctx.voice?.onChange(() => this.render());
  },

  take(snap) {
    if (!snap || !Array.isArray(snap.items)) return;
    this.snap = snap;
    this.changed();
    this.render();
  },

  onChange(fn) { this.subs.push(fn); },

  changed() {
    for (const fn of this.subs) {
      try { fn(); } catch (e) { console.error('automation subscriber failed', e); }
    }
  },

  types() { return (this.snap && Array.isArray(this.snap.types)) ? this.snap.types : []; },
  type(t) { return this.types().find((x) => x.type === t) || null; },
  trackers() { return (this.snap && Array.isArray(this.snap.tracking)) ? this.snap.tracking : []; },

  /* ------------------------------------------------------- card words -- */

  /* Each card's two lines: `sub` (what it is set to) and `status` (now). */
  auroraLines() {
    const a = this.aurora;
    if (!a) return { sub: '', status: '' };
    const s = a.settings;
    const n = a.now || {};
    // Short enough for a card a third of the panel wide: what it is set to
    // under the name, what the sky is doing on the bold line. Tonight's
    // forecast and the long words are in the sheet.
    const sub = `Kp ${s.kp}+, ${s.clouds === 'clear' ? 'no clouds' : 'light clouds'}`;
    if (!s.enabled) return { sub, status: '' };
    const kp = (k) => String(Math.round(k * 10) / 10);
    let status;
    if (a.possible) status = 'Possible now — look north';
    else if (a.quiet?.now) status = a.quiet.until ? `Quiet until ${hm(a.quiet.until)}` : 'Quiet hours';
    else if (!a.where) status = 'No coordinates set';
    else if (!n.dark) status = n.dark_from ? `Dark from ${hm(n.dark_from)}` : 'Too light tonight';
    else if (n.error) status = 'NOAA not answering';
    else {
      status = [n.kp != null ? `Kp ${kp(n.kp)}` : '', n.cloud != null ? `${Math.round(n.cloud)} % cloud` : '']
        .filter(Boolean).join(' · ') || 'Looking';
    }
    return { sub, status };
  },

  radarLines() {
    const t = this.type('radar');
    const n = this.trackers().length;
    const own = this.trackers().filter((x) => x.style).length;
    const open = (this.snap?.items || []).filter((i) => i.kind === 'radar' && i.state === 'open').length;
    const r = this.radar;
    // The feed's words when it is there: what is new, and checks overdue.
    const status = r ? [r.unread ? `${r.unread} new` : 'Nothing new', r.overdue ? `${r.overdue} overdue` : '',
      r.quiet?.now ? (r.quiet.until ? `quiet till ${hm(r.quiet.until)}` : 'quiet') : '']
      .filter(Boolean).join(' · ')
      : open ? `${open} ${open === 1 ? 'alert' : 'alerts'} open` : 'Nothing right now';
    return {
      sub: `${n} ${n === 1 ? 'tracker' : 'trackers'}${t ? ` · ${SHOW_SHORT[t.style.show]}` : ''}`
        + (own ? ` · ${own} own` : ''),
      status,
    };
  },

  groupLines(key) {
    const g = GROUPS[key];
    const ts = g.types.map((t) => this.type(t)).filter(Boolean);
    const count = {};
    for (const t of ts) count[t.style.show] = (count[t.style.show] || 0) + 1;
    const status = SHOW_WORDS.filter(([v]) => count[v])
      .map(([v]) => `${count[v]} ${SHOW_SHORT[v]}`).join(' · ');
    return { sub: g.sub, status };
  },

  /* The Telegram card: the bot under the name, who is linked on the bold line. */
  telegramLines() {
    const t = this.tg;
    if (!t) return { sub: '', status: '' };
    if (!t.configured) return { sub: 'no bot yet', status: 'Not set up' };
    const linked = (t.people || []).filter((p) => p.chat).map((p) => p.name)
      .concat((t.chats || []).filter((c) => !c.person).map((c) => c.name));
    return {
      sub: t.bot ? `@${t.bot.username}` : (t.error || ''),
      status: t.linking ? `Code ${t.linking.code}` : linked.length ? `${linked.join(', ')} linked` : 'Nobody linked',
    };
  },

  auroraOn() { return !!this.aurora?.settings?.enabled; },
  auroraPossible() { return !!this.aurora?.possible; },
  ready() { return !!this.snap && this.types().length > 0; },

  /* ------------------------------------------------------------ server -- */

  async putAurora(patch) {
    if (this.aurora) {
      this.aurora = { ...this.aurora, settings: { ...this.aurora.settings, ...patch } };
      this.changed();
      this.render();
    }
    try {
      const r = await fetch('/api/aurora/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch),
      });
      // Only a document replaces the one shown (a preview answers {}).
      const d = r.ok ? await r.json().catch(() => null) : null;
      if (d && d.settings) { this.aurora = d; this.changed(); this.render(); }
    } catch { /* the next snapshot puts it right */ }
  },

  toggleAurora() { this.putAurora({ enabled: !this.auroraOn() }); },

  /* The Radar feed's settings: {digest_at} or {trackers: {key: {mode|phone}}}. */
  async putRadar(patch) {
    if (this.radar?.settings) {
      const s = this.radar.settings;
      for (const [k, v] of Object.entries(patch)) if (k !== 'trackers') s[k] = v;
      for (const [k, v] of Object.entries(patch.trackers || {})) {
        s.trackers[k] = { mode: 'every', phone: false, ...(s.trackers[k] || {}), ...v };
        const row = (this.radar.trackers || []).find((x) => x.key === k);
        if (row) Object.assign(row, v);
      }
      this.render();
    }
    try {
      const r = await fetch('/api/radar/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch),
      });
      const d = r.ok ? await r.json().catch(() => null) : null;
      if (d && Array.isArray(d.posts)) { this.radar = d; this.changed(); this.render(); }
    } catch { /* the next snapshot puts it right */ }
  },

  /* A type's style ("radar", "battery", …) or a tracker's ("tracker:3");
     null for a tracker goes back to the Radar card's own. */
  async setStyle(key, patch) {
    const t = this.type(key);
    if (t && patch) t.style = { ...t.style, ...patch };
    const trk = this.trackers().find((x) => x.key === key);
    if (trk) trk.style = patch ? { ...(trk.style || this.type('radar')?.style || {}), ...patch } : null;
    this.changed();
    this.render();
    if (patch && patch.sound) this.ctx.attention?.play(patch.sound);
    try {
      const r = await fetch('/api/attention/styles', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ [key]: patch }),
      });
      if (r.ok) {
        const snap = await r.json();
        this.take(snap);
        this.ctx.attention?.paint(snap);
      }
    } catch { /* the next snapshot puts it right */ }
  },

  /* -------------------------------------------------------------- sheet -- */

  buildSheet() {
    const el = document.createElement('div');
    el.id = 'au-sheet';
    el.className = 'sheet';   // the settings window kit (app.css)
    el.setAttribute('role', 'dialog');
    el.innerHTML = `
      <header>
        <span class="sheet-icon au-icon" aria-hidden="true"></span>
        <div class="sheet-title">
          <h2></h2>
          <span class="sheet-status au-now"></span>
        </div>
        <span class="spacer"></span>
        <button class="ls-close">Close</button>
      </header>
      <div class="ls-body"></div>`;
    document.body.appendChild(el);
    this.sheet = el;
    this.bodyEl = el.querySelector('.ls-body');
    el.querySelector('.ls-close').onclick = () => this.close();
    this.bodyEl.addEventListener('click', (e) => {
      const st = e.target.closest('button[data-style]');
      if (st) {
        const v = JSON.parse(st.dataset.v);
        const key = st.dataset.key;
        if (st.dataset.style === 'same') this.setStyle(key, null);
        else if (st.dataset.style === 'reset') this.setStyle(key, v);
        else this.setStyle(key, { [st.dataset.style]: v });
        return;
      }
      const ts = e.target.closest('button[data-tgsend]');
      if (ts) {
        const key = ts.dataset.tgsend;
        const cur = this.type(key)?.style || this.trackers().find((x) => x.key === key)?.style
          || this.type('radar')?.style || {};
        const set = new Set(cur.telegram || []);
        if (set.has(ts.dataset.person)) set.delete(ts.dataset.person); else set.add(ts.dataset.person);
        this.setStyle(key, { telegram: (this.tg?.people || []).map((p) => p.id).filter((i) => set.has(i)) });
        return;
      }
      const ph = e.target.closest('button[data-phsend]');
      if (ph) {
        const key = ph.dataset.phsend;
        const cur = this.type(key)?.style || this.trackers().find((x) => x.key === key)?.style
          || this.type('radar')?.style || {};
        const set = new Set(cur.phones || []);
        if (set.has(ph.dataset.phone)) set.delete(ph.dataset.phone); else set.add(ph.dataset.phone);
        this.setStyle(key, { phones: (this.ctx.config?.phones || []).map((p) => p.id).filter((i) => set.has(i)) });
        return;
      }
      const rm = e.target.closest('button[data-rmode]');
      if (rm) { this.putRadar({ trackers: { [rm.dataset.key]: { mode: rm.dataset.rmode } } }); return; }
      const rp = e.target.closest('button[data-rphone]');
      if (rp) { this.putRadar({ trackers: { [rp.dataset.key]: { phone: rp.dataset.rphone === 'on' } } }); return; }
      const rd = e.target.closest('button[data-digest]');
      if (rd) { this.putRadar({ digest_at: rd.dataset.digest }); return; }
      const q = e.target.closest('button[data-q]');
      if (q) {
        const patch = { [q.dataset.q]: JSON.parse(q.dataset.v) };
        if (this.mode === 'aurora') this.putAurora(patch); else if (this.mode === 'radar') this.putRadar(patch);
        else if (this.mode === 'house') this.putHours('house', patch);
        return;
      }
      const au = e.target.closest('button[data-au]');
      if (au) { this.putAurora({ [au.dataset.au]: JSON.parse(au.dataset.v) }); return; }
      const tg = e.target.closest('button[data-tg]');
      if (tg) { this.tgLink(tg, tg.dataset.tg === 'stop' ? null : tg.dataset.person); return; }
      const un = e.target.closest('button[data-tg-unlink]');
      if (un) { this.tgUnlink(un, un.dataset.tgUnlink); return; }
      const lvl = e.target.closest('button[data-wlevel]');
      if (lvl) { this.nudgeWater(lvl.dataset.wlevel, Number(lvl.dataset.dir)); return; }
      const hear = e.target.closest('button[data-hear]');
      if (hear) { this.ctx.attention?.play(hear.dataset.hear); return; }
    });
  },

  open(mode) {
    if (mode !== this.mode) this.bodyEl.scrollTop = 0;
    this.mode = mode;
    this.sheet.classList.add('open');
    this.render();
  },

  close() { this.sheet.classList.remove('open'); this.mode = null; },

  isOpen() { return !!this.sheet?.classList.contains('open'); },

  /* One alert's row of choices: how it shows, its sound, a banner and waking
     the wall, and who else is told. `key` is what the server is told; `style`
     what is chosen now; `extra` goes beside the name (Default, Same as all).
     Four captioned groups: the two one-of-N bars over the two sets of chips. */
  styleRow(key, label, style, extra = '', note = '') {
    const btn = (k, v, text, on, title = '', cls = '') => `<button class="ats-btn${on ? ' on' : ''}${cls}"
      data-key="${esc(key)}" data-style="${k}" data-v='${esc(JSON.stringify(v))}'
      ${title ? `title="${esc(title)}"` : ''} aria-pressed="${on}">${text}</button>`;
    const s = style;
    const sounds = this.type(key.startsWith('tracker:') ? 'radar' : key)?.sounds || ['funny', 'cartoon'];
    const tell = this.tgButtons(key, s) + this.phButtons(key, s);
    // Off and No sound are chosen "none"s: the kit's quiet fill, not the accent.
    return `<div class="ats-row ats-${esc(s.show)}">
        <div class="ats-name"><b>${esc(label)}</b>
          <span class="ats-look" aria-hidden="true"><span class="at-sign">!</span></span>
          ${extra}${note ? `<span class="ats-note">${esc(note)}</span>` : ''}</div>
        <div class="ats-set">
          <div class="ats-grp"><span class="sheet-cap">Shows as</span>
            <span class="ls-set sheet-seg">${SHOW_WORDS.map(([v, text, what]) =>
              btn('show', v, text, s.show === v, what, v === 'off' ? ' sheet-none' : '')).join('')}</span></div>
          <div class="ats-grp"><span class="sheet-cap">Sound</span>
            <div class="ats-sounds">
              <span class="ls-set sheet-seg sheet-two">${btn('sound', null, 'No sound', !s.sound, '', ' sheet-none')}${sounds.map((x) =>
                btn('sound', x, `🔔 ${esc(this.soundName(x))}`, s.sound === x, this.soundName(x))).join('')}</span>
              <span class="sheet-acts">
                ${this.ctx.soundlib?.uploadBtn('alerts', { cls: 'ats-btn', text: '＋ Upload', row: key }) || ''}
                ${this.ctx.voice?.chip(`alert:${key}`, { cls: 'ats-btn' }) || ''}
              </span>
            </div></div>
          <div class="ats-grp"><span class="sheet-cap">Also</span>
            <span class="ls-set sheet-chips">${btn('banner', !s.banner, 'Banner', s.banner)}${
              btn('wake', !s.wake, 'Wake the wall', s.wake)}</span></div>
          ${tell ? `<div class="ats-grp"><span class="sheet-cap">Also tell</span>
            <span class="ls-set sheet-chips">${tell}</span></div>` : ''}
        </div></div>${this.ctx.voice?.editor(`alert:${key}`, {
          hint: `read aloud after this alert's sound (or alone, with No sound) — when it first appears, not in its quiet hours`,
        }) || ''}`;
  },

  typeRow(t) {
    if (!t) return '';
    const changed = JSON.stringify(t.style) !== JSON.stringify(t.default);
    const reset = changed ? `<button class="ats-btn ats-small" data-key="${esc(t.type)}" data-style="reset"
      data-v='${esc(JSON.stringify(t.default))}' title="back to how it was">Default</button>` : '';
    return this.styleRow(t.type, t.label, t.style, reset, t.type === 'climate' ? this.ownWays() : '');
  },

  /* A sensor's alert may say where it goes itself (sensors.js, 2026-10-22):
     the climate row says how many do, so Off here is not a mystery when one
     still shows on the wall or reaches a phone. */
  ownWays() {
    const n = (this.ctx.sensors?.doc?.sensors || []).filter((s) => s.room !== null)
      .reduce((k, s) => k + (s.alerts?.rules || []).filter((r) => r && r.tell).length, 0);
    if (!n) return '';
    return `${n === 1 ? "1 of the sensors' alerts chooses where it goes itself"
      : `${n} of the sensors' alerts choose where they go themselves`} — Temperature sensors › 🔔`;
  },

  /* A folded card (the kit's .sheet-more): its heading opens it, and it stays
     as it was left across the redraws the server's updates cause. */
  folded(name, heading, body) {
    return this.ctx.sheetkit?.more(name, heading, body, !!this.more[name])
      || `<details class="sheet-sec sheet-more" data-more="${esc(name)}"${this.more[name] ? ' open' : ''}>
      <summary class="sheet-h">${esc(heading)}</summary>${body}</details>`;
  },

  /* What the choices mean: reference, folded, at the foot of each alert sheet. */
  intro() {
    return this.folded('choices', 'What the choices mean', `
      <p class="sheet-note"><b>Alarm</b> turns the Needs attention chip red with a sign
      blinking and puts it first; <b>On the chip</b> counts it; <b>In the list</b> keeps it in
      the Needs attention window only; <b>Off</b> hides it. A <b>banner</b> stands over whichever
      view is up until somebody taps Seen. A <b>sound</b> plays once when it first appears, and
      <b>Wake the wall</b> wakes a sleeping screen for it — neither in quiet hours: the clock's,
      or for Aurora, Radar and the House alerts their own (the House alerts' are in their sheet, under When they may sound).</p>
      <p class="sheet-note">🗣 on a row reads a text aloud after its sound — or instead of one, with No
      sound. AI makes each voice once and the kitchen keeps it; while AI is off a new
      text waits, and that alert plays its sound only.</p>`);
  },

  /* The sounds to hear before one is chosen for a row — a ▶ each, ✕ for one
     uploaded here — and ＋ Upload a sound. Controls, not help: in sight, at
     the top of the card whose rows choose them. */
  hearRow() {
    return `<div class="ats-hear-row"><span class="sheet-cap">Hear the sounds</span>
      <div class="ats-hear">${(this.snap?.sounds || []).map((x) =>
        `<button class="ats-btn ats-small" data-hear="${esc(x)}">▶ ${esc(this.soundName(x))}</button>${
          this.snap?.uploaded?.[x] ? `<button class="ats-btn ats-small sheet-danger sl-del" data-sl-del="${esc(x)}"
            aria-label="Delete ${esc(this.soundName(x))}">✕</button>` : ''}`).join(' ')}
      <span class="sheet-acts">${this.ctx.soundlib?.uploadBtn('alerts', { cls: 'ats-btn ats-small' }) || ''}</span></div></div>`;
  },

  /* A built-in sound's name, or one uploaded in these sheets (their own
     library, not Babo Alarm's: mp3, m4a, ogg, wav, up to 8 MB). */
  soundName(x) {
    return SOUND_NAMES[x] || this.snap?.uploaded?.[x]?.label || x;
  },

  /* The header's one line: what this sheet's alerts are set to and doing. */
  headLine() {
    if (this.mode === 'aurora') {
      if (!this.aurora?.settings) return '';
      const l = this.auroraLines();
      return this.auroraOn() ? `<b>On</b> · ${esc(l.status)} · ${esc(l.sub)}` : `<b>Off</b> · ${esc(l.sub)}`;
    }
    if (this.mode === 'radar') {
      if (!this.ready()) return '';
      const l = this.radarLines();
      return `${esc(l.sub)} · ${esc(l.status)}`;
    }
    if (this.mode === 'telegram') {
      const l = this.telegramLines();
      return [l.sub, l.status].filter(Boolean).map(esc).join(' · ');
    }
    if (GROUPS[this.mode] && this.ready()) {
      const n = GROUPS[this.mode].types.filter((t) => this.type(t)).length;
      const h = this.snap?.hours?.[this.mode];
      const quiet = !h?.settings?.quiet_on ? ''
        : h.quiet?.now ? ` · quiet${h.quiet.until ? ` until ${hm(h.quiet.until)}` : ''}`
          : ` · quiet ${hh(h.settings.quiet_from)}–${hh(h.settings.quiet_to)}`;
      return `${n} alerts · ${esc(this.groupLines(this.mode).status)}${esc(quiet)}`;
    }
    return '';
  },

  /* ...and its tone (the settings window kit): the aurora possible now is
     live; something wanting a person — checks overdue, no bot, an error —
     is warn; switched off, or nobody linked, is off. */
  headTone() {
    if (this.mode === 'aurora') {
      const a = this.aurora;
      if (!a?.settings) return '';
      if (!this.auroraOn()) return 'off';
      if (a.possible) return 'live';
      if (!a.where || a.now?.error) return 'warn';
      return 'ok';
    }
    if (this.mode === 'radar') return this.radar?.overdue ? 'warn' : 'ok';
    if (this.mode === 'telegram') {
      const t = this.tg;
      if (!t) return '';
      if (!t.configured || t.error) return 'warn';
      if (t.linking) return 'live';
      const linked = (t.people || []).some((p) => p.chat) || (t.chats || []).length;
      return linked ? 'ok' : 'off';
    }
    return GROUPS[this.mode] ? 'ok' : '';
  },

  /* Quiet hours in a few words, the weekend's after the week's when they
     differ: {week: "23:00–07:00", weekend: "to 10:00" | "00:00–10:00" | ''}. */
  quietSpan(s) {
    const fw = s.quiet_from_we ?? s.quiet_from;
    const tw = s.quiet_to_we ?? s.quiet_to;
    const week = `${hh(s.quiet_from)}–${hh(s.quiet_to)}`;
    if (fw === s.quiet_from && tw === s.quiet_to) return { week, weekend: '' };
    return { week, weekend: fw === s.quiet_from ? `to ${hh(tw)}` : `${hh(fw)}–${hh(tw)}` };
  },

  /* A quiet hours card's note. Its heading says when the alert MAY come, so
     the note names the hours for what they are: "quiet 23:00–07:00 ·
     weekends to 10:00", "quiet now, until 07:00", or "any hour". */
  quietNote(s, q) {
    if (!s || !q) return '';
    if (!s.quiet_on) return 'any hour';
    if (q.now) return `quiet now${q.until ? `, until ${hm(q.until)}` : ''}`;
    const { week, weekend } = this.quietSpan(s);
    return `quiet ${week}${weekend ? ` · weekends ${weekend}` : ''}`;
  },

  /* When the quiet hours of the night that holds `t` (epoch) start, as an
     epoch: a night begins on its own evening, and Friday's and Saturday's
     take the weekend's hours (alerthours.py, sound.is_weekend_night). */
  quietStart(s, t) {
    const d = new Date(t * 1000);
    if (d.getHours() < 12) d.setDate(d.getDate() - 1);
    const we = d.getDay() === 5 || d.getDay() === 6;
    const f = we ? (s.quiet_from_we ?? s.quiet_from) : s.quiet_from;
    d.setHours(f, 0, 0, 0);
    if (f < 12) d.setDate(d.getDate() + 1);
    return d.getTime() / 1000;
  },

  render() {
    if (!this.isOpen()) return;
    const h2 = this.sheet.querySelector('h2');
    const [icon, hue] = HEADS[this.mode] || ['', ''];
    this.sheet.querySelector('.au-icon').textContent = icon;
    for (const c of [...this.sheet.classList]) if (c.startsWith('a-')) this.sheet.classList.remove(c);
    if (hue) this.sheet.classList.add(hue);
    if (this.mode === 'aurora') {
      h2.textContent = 'Aurora alert';
      this.bodyEl.innerHTML = this.auroraBody();
    } else if (this.mode === 'radar') {
      h2.textContent = 'Radar alerts';
      this.bodyEl.innerHTML = this.radarBody();
    } else if (this.mode === 'telegram') {
      h2.textContent = 'Telegram';
      this.bodyEl.innerHTML = this.telegramBody();
    } else if (GROUPS[this.mode]) {
      const g = GROUPS[this.mode];
      h2.textContent = g.name;
      const rows = g.types.map((t) => this.typeRow(this.type(t))).join('');
      const kit = this.ctx.sheetkit;
      this.bodyEl.innerHTML = `${rows ? kit.sec('How each alert shows', this.hearRow() + rows,
        { cls: 'ats-kind', note: this.groupLines(this.mode).status })
        : '<p class="ats-intro">The kitchen has not heard from its server yet.</p>'}${
        this.mode === 'house' ? this.houseHours() + this.waterLevels() : ''}${this.intro()}`;
    }
    this.ctx.sheetkit?.status(this.sheet.querySelector('.au-now'), this.headLine(), this.headTone());
    // The alert style rows want the whole width of the wall; the Aurora's
    // and Telegram's rows read in the kit's column.
    this.sheet.classList.toggle('sheet-full', ['house', 'servers', 'radar'].includes(this.mode));
    this.bodyEl.querySelectorAll('details[data-more]').forEach((d) => {
      d.ontoggle = () => { this.more[d.dataset.more] = d.open; this.ctx.sheetkit?.sync(this.sheet); };
    });
    // ＋ Upload on a row makes the new sound that alert's at once; 🗣 opens its text.
    this.ctx.soundlib?.wire(this.bodyEl, { onUploaded: (r) => { if (r.row) this.setStyle(r.row, { sound: r.id }); } });
    this.ctx.voice?.wire(this.bodyEl, () => this.render());
    this.ctx.sheetkit?.sync(this.sheet);
  },

  /* The aroma diffuser's two water levels (2026-10-14, "levels which could
     be adjusted from the attention options"): low and very low, each a
     − / + in steps of 5 %, beside how each shows above. The water itself is
     diffuser.py's estimate; the levels live in its settings. */
  waterLevels() {
    const df = this.ctx.diffuser;
    const s = df?.settings?.();
    if (!df?.doc || !s) return '';
    const w = df.doc.water || {};
    const now = !w.known ? 'not known yet — tap 💧 Filled up in the diffuser\'s ⚙ when it is filled'
      : w.empty ? 'empty' : `≈${w.pct} % now`;
    const step = (key, label, hint) => `
      <div class="ls-row">
        <span class="ls-label">${label}<span class="db-hint">${hint}</span></span>
        <span class="ls-set sheet-step">
          <button class="ls-btn" data-wlevel="${key}" data-dir="-1" aria-label="${label}: lower">−</button>
          <b class="sheet-val">under ${s[key]} %</b>
          <button class="ls-btn" data-wlevel="${key}" data-dir="1" aria-label="${label}: higher">+</button>
        </span>
      </div>`;
    return this.ctx.sheetkit.sec("The diffuser's water: when each alert comes", `
      ${step('water_low', 'Diffuser water low', 'the first warning')}
      ${step('water_very_low', 'Very low', 'the second — empty for real is its own alert above')}`,
    { note: `${now}, an estimate from how long it has misted` });
  },

  /* One step of 5 %, kept apart: very low stays under low. */
  nudgeWater(key, dir) {
    const df = this.ctx.diffuser;
    const s = df?.settings?.();
    if (!s) return;
    let v = Math.min(90, Math.max(5, (s[key] ?? 0) + 5 * dir));
    if (key === 'water_very_low' && v >= s.water_low) v = s.water_low - 5;
    if (key === 'water_low' && v <= s.water_very_low) v = s.water_very_low + 5;
    if (v < 5 || v > 90 || v === s[key]) return;
    df.put({ [key]: v });
  },

  radarBody() {
    const base = this.type('radar');
    if (!base) return '<p class="ats-intro">The kitchen has not heard from its server yet.</p>';
    const trk = this.trackers();
    const same = (key) => `<button class="ats-btn ats-small" data-key="${esc(key)}" data-style="same"
      data-v='null' title="show as all Radar alerts do">Same as all</button>`;
    const rows = trk.map((t) => {
      const note = [t.kind, t.status, t.paused ? '' : t.alarm].filter(Boolean).join(' · ');
      return (t.style
        ? this.styleRow(t.key, t.name, t.style, same(t.key), note)
        : this.styleRow(t.key, t.name, base.style,
          '<span class="ats-tag">same as all</span>', note)) + this.feedRow(t.key);
    });
    const r = this.radar;
    const kit = this.ctx.sheetkit;
    const times = r?.digest_times || [];
    const digest = r ? kit.sec('The daily digest', `
        <div class="ls-row">
          <span class="ls-label">Digest time
            <span class="db-hint">trackers set to Daily digest ring once a day, at this time, for
              everything they found since</span></span>
          <span class="ls-set sheet-seg sheet-hourbar">${times.map((d) => `<button class="ls-btn${
            r.settings?.digest_at === d ? ' on' : ''}" data-digest="${esc(d)}"
            aria-pressed="${r.settings?.digest_at === d}">${esc(d)}</button>`).join('')}</span>
        </div>`, { note: r.settings?.digest_at || '' }) : '';
    const own = trk.filter((t) => t.style).length;
    return `${this.folded('radar', 'How Radar alerts work', `<p class="sheet-note">Everything TunaRadar
        finds goes to the <b>Radar</b> view, a post
        each. A new one rings the one line "N new on Radar" in Needs attention, the way <b>All
        Radar alerts</b> is set — or a tracker's own way: change any of its buttons, and <b>Same
        as all</b> takes it back. Under each tracker, <b>when</b> its finds alert: <b>Every new
        result</b>, once a day in the <b>Daily digest</b>, or <b>Feed only</b> (just the count on
        the Radar button); and <b>📱 Phone</b> tells its owners' phones too. Nothing rings in Radar's
        quiet hours, set just below: a find in them waits for the morning. Waking the wall happens only
        for tickets going on sale, within 15 minutes of the sale.</p>`)}
      ${r ? kit.sec('When it may ring', this.quietRows(r.settings, r.quiet,
        'No sound, no banner coming up and no phone told between these hours; what is found waits and rings when they end.'),
        { note: this.quietNote(r.settings, r.quiet) }) : ''}
      ${digest}
      ${kit.sec('All Radar alerts', this.hearRow() + this.styleRow('radar', 'All Radar alerts', base.style,
          JSON.stringify(base.style) !== JSON.stringify(base.default)
            ? `<button class="ats-btn ats-small" data-key="radar" data-style="reset"
                data-v='${esc(JSON.stringify(base.default))}'>Default</button>` : ''),
        { cls: 'ats-kind', note: SHOW_SHORT[base.style.show] || '' })}
      ${kit.sec('Each tracker', rows.join('') || '<p class="sheet-note">TunaRadar has no trackers on the kitchen screen.</p>',
        { cls: 'ats-kind', note: `${trk.length} ${trk.length === 1 ? 'tracker' : 'trackers'}${own ? ` · ${own} with their own look` : ''}` })}
      ${this.intro()}`;
  },

  /* A tracker's second row: when its finds alert, and its owners' phones. */
  feedRow(key) {
    const r = this.radar;
    if (!r) return '';
    const s = { mode: 'every', phone: false, ...(r.settings?.trackers?.[key] || {}) };
    const m = (v, text, what) => `<button class="ats-btn${s.mode === v ? ' on' : ''}" data-key="${esc(key)}"
      data-rmode="${v}" title="${esc(what)}" aria-pressed="${s.mode === v}">${text}</button>`;
    return `<div class="ats-row ats-feed"><div class="ats-name"><span class="ats-note">when it finds something</span></div>
      <div class="ats-set">
        <div class="ats-grp"><span class="ls-set sheet-seg">
          ${m('every', 'Every new result', 'rings the Needs attention line for each new find')}
          ${m('digest', 'Daily digest', 'rings once a day, at the digest time')}
          ${m('feed', 'Feed only', 'no ring: only the count on the Radar button')}</span></div>
        <div class="ats-grp"><span class="ls-set sheet-chips">
          <button class="ats-btn${s.phone ? ' on' : ''}" data-key="${esc(key)}" data-rphone="${s.phone ? 'off' : 'on'}"
            title="a notification on its owners' phones too" aria-pressed="${s.phone}">📱 Phone</button></span></div>
      </div></div>`;
  },

  /* ✈ a person: the alert also goes to their Telegram when it first appears
     — silently in its quiet hours (2026-10-18). A person whose Telegram is not
     linked yet is offered, dimmed, with where to link it. */
  tgButtons(key, s) {
    const folk = this.tg?.people || [];
    if (!this.tg?.configured || !folk.length) return '';
    const on = new Set(s.telegram || []);
    return folk.map((p) => `<button class="ats-btn${on.has(p.id) ? ' on' : ''}${p.chat ? '' : ' ats-dim sheet-na'}"
      data-tgsend="${esc(key)}" data-person="${esc(p.id)}" aria-pressed="${on.has(p.id)}"${
      p.chat || on.has(p.id) ? '' : ' disabled'}
      title="${p.chat ? `also on ${esc(p.name)}'s Telegram` : `${esc(p.name)} has not linked Telegram yet — House → Automation → Telegram`}"
      >✈ ${esc(p.name)}</button>`).join('');
  },

  /* 📱 a phone: the alert also goes to it through Home Assistant's app when it
     first appears — without a sound in its quiet hours (2026-10-21, Alex: "be
     able to alert via HA and telegram"). A phone whose app is not set up is
     offered, dimmed. Not for a Radar tracker, whose phone is its own. */
  phButtons(key, s) {
    const phones = this.ctx.config?.phones || [];
    if (!phones.length || key.startsWith('tracker:')) return '';
    const on = new Set(s.phones || []);
    return phones.map((p) => `<button class="ats-btn${on.has(p.id) ? ' on' : ''}${p.ready ? '' : ' ats-dim sheet-na'}"
      data-phsend="${esc(key)}" data-phone="${esc(p.id)}" aria-pressed="${on.has(p.id)}"${
      p.ready || on.has(p.id) ? '' : ' disabled'}
      title="${p.ready ? `also on ${esc(p.label)} — a notification through Home Assistant` : `${esc(p.label)}: Home Assistant's app is not set up`}"
      >📱 ${esc(p.label)}</button>`).join('');
  },

  /* House alerts' own quiet hours (2026-10-18): no sound and no waking the
     wall for them in these hours; they still show. */
  houseHours() {
    const h = this.snap?.hours?.house;
    if (!h) return '';
    return this.ctx.sheetkit.sec('When they may sound', this.quietRows(h.settings, h.quiet,
      'No sound and no waking the wall for these alerts between these hours — they still show on the chip and in the list.'),
    { note: this.quietNote(h.settings, h.quiet) });
  },

  async putHours(group, patch) {
    const h = this.snap?.hours?.[group];
    if (h) { h.settings = { ...h.settings, ...patch }; this.render(); }
    try {
      const r = await fetch('/api/attention/hours', {
        method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ group, ...patch }),
      });
      if (r.ok) { const snap = await r.json(); this.take(snap); this.ctx.attention?.paint(snap); }
    } catch { /* the next snapshot puts it right */ }
  },

  /* Aurora's and Radar's own quiet hours (2026-10-12): on or off, then a
     from-until pair for the week's nights and one for the weekend's. `q` is
     the server's alerthours.state: the hours on offer and whether it is
     quiet now. On or off is the kit's switch; each from and until a bar. */
  quietRows(s, q, what) {
    if (!s || !q) return '';
    const on = !!s.quiet_on;
    const btns = (key, hours) => hours.map((h) => `<button class="ls-btn${s[key] === h ? ' on' : ''}"
      data-q="${key}" data-v="${h}" aria-pressed="${s[key] === h}">${hh(h)}</button>`).join('');
    const pair = (sfx, name, days) => `
      <div class="sheet-band${sfx ? ' snd-weekend' : ''}">
        <span class="snd-cap">${name} from<span class="snd-range">${days[0]}</span></span>
        <span class="ls-set sheet-seg sheet-hourbar">${btns(`quiet_from${sfx}`, q.from_hours || [])}</span></div>
      <div class="sheet-band">
        <span class="snd-cap">${name} until<span class="snd-range">${days[1]}</span></span>
        <span class="ls-set sheet-seg sheet-hourbar">${btns(`quiet_to${sfx}`, q.to_hours || [])}</span></div>`;
    const now = !on ? 'Off: it may alert at any hour.'
      : q.now ? `Quiet now${q.until ? `, until ${hm(q.until)}` : ''}.` : 'Not quiet now.';
    return `<div class="ls-row">
        <span class="ls-label">Quiet hours
          <span class="db-hint">${esc(what)} Friday and Saturday nights are the weekend's, Sunday
            night is the week's.</span>
          <span class="sheet-line${on && q.now ? ' sheet-ok' : ''}">${esc(now)}</span></span>
        <div class="sheet-ctl">
          <button class="ls-btn sheet-switch${on ? ' on' : ''}" role="switch" aria-checked="${on}"
            data-q="quiet_on" data-v="${on ? 'false' : 'true'}">${on ? 'On' : 'Off'}</button>
          ${on ? pair('', 'Weekdays', ['Sun – Thu evening', 'Mon – Fri morning'])
            + pair('_we', 'Weekends', ['Fri – Sat evening', 'Sat – Sun morning']) : ''}
        </div>
      </div>`;
  },

  /* -------------------------------------------------------- Telegram -- */

  /* Link (a code for one person, shown ten minutes), or Cancel (person null). */
  async tgLink(btn, person) {
    btn.disabled = true;
    try {
      const r = await fetch('/api/telegram/link', person === null ? { method: 'DELETE' } : {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(person ? { person } : {}),
      });
      const ans = await r.json().catch(() => null);
      if (r.ok && ans) this.tg = ans;
      else if (ans?.error) this.tg = { ...this.tg, error: ans.error };
    } catch { /* the SSE key puts it right */ }
    this.changed();
    this.render();
  },

  async tgUnlink(btn, key) {
    btn.disabled = true;
    try {
      const r = await fetch(`/api/telegram/chats/${encodeURIComponent(key)}`, { method: 'DELETE' });
      if (r.ok) this.tg = await r.json();
    } catch { /* the SSE key puts it right */ }
    this.changed();
    this.render();
  },

  /* The bot, then a row per person — their linked Telegram with Unlink, or
     Link — and while a code is shown, the code to send the bot (or its link,
     which sends it), good for ten minutes. */
  telegramBody() {
    const t = this.tg;
    if (!t) return '<p class="ats-intro">The kitchen has not heard from its server yet.</p>';
    const intro = `<p class="sheet-note">The kitchen's own Telegram bot. Each person links their own
      Telegram to it once; after that a bird box clip or still, and a liked photo, has a
      <b>✈ name</b> button for each linked person, which sends it to them.</p>`;
    if (!t.configured) {
      return this.ctx.sheetkit.sec('The bot', `${intro}
        <div class="ls-row"><span class="ls-label">No bot yet
          <span class="db-hint">make one with @BotFather in Telegram; its token goes in the kitchen's
            .env as KITCHEN_TELEGRAM_TOKEN</span></span></div>`, { note: 'not set up' });
    }
    const l = t.linking;
    const kit = this.ctx.sheetkit;
    const btn = (attrs, text, cls = '') => `<button class="ls-btn${cls}" ${attrs}>${text}</button>`;
    const rows = (t.people || []).map((p) => `
      <div class="ls-row">
        <span class="ls-label">${esc(p.name)}
          ${p.chat
            ? `<span class="sheet-line sheet-ok">linked: Telegram's ${esc(p.chat.telegram_name)} — the ✈ ${esc(p.name)} button sends here</span>`
            : `<span class="db-hint">not linked: Link, then ${esc(p.name)} sends the bot the code from their own Telegram</span>`}</span>
        <span class="ls-set">
          ${p.chat ? btn(`data-tg-unlink="${esc(p.chat.key)}"`, 'Unlink', ' sheet-danger') : ''}
          ${btn(`data-tg="link" data-person="${esc(p.id)}"`, p.chat ? 'Link again' : `Link ${esc(p.name)}`,
            l && l.person === p.id ? ' sheet-primary' : '')}
        </span>
      </div>`).join('');
    const other = (t.chats || []).filter((c) => !c.person).map((c) => `
      <div class="ls-row">
        <span class="ls-label">${esc(c.name)}<span class="db-hint">linked before people were named</span></span>
        <span class="ls-set">${btn(`data-tg-unlink="${esc(c.key)}"`, 'Unlink', ' sheet-danger')}</span>
      </div>`).join('');
    const code = l ? kit.sec('Linking now', `
      <div class="ls-row tg-linkrow">
        <span class="ls-label">${l.person_name ? `${esc(l.person_name)}: send` : 'Send'} this code to
          ${t.bot ? `<b>@${esc(t.bot.username)}</b>` : 'the bot'} in Telegram
          <span class="db-hint">or open <a href="${esc(l.link)}" target="_blank" rel="noopener">${esc(l.link)}</a>
            on that phone and press Start — good for ten minutes</span></span>
        <span class="ls-set"><span class="tg-code">${esc(l.code)}</span>${btn('data-tg="stop"', 'Cancel')}</span>
      </div>`) : '';
    const folk = t.people || [];
    const linked = folk.filter((p) => p.chat).length;
    return `${kit.sec('The bot', `${intro}
        <div class="ls-row">
          <span class="ls-label">The bot${t.bot ? ` · @${esc(t.bot.username)}` : ''}
            <span class="${t.error ? 'db-warn' : 'db-hint'}">${t.error ? esc(t.error) : 'answers only the codes it is shown here'}</span></span>
        </div>`)}
      ${code}
      ${kit.sec('People', `${rows}${other}`, { note: `${linked} of ${folk.length} linked` })}`;
  },

  auroraBody() {
    const a = this.aurora;
    if (!a?.settings) return '<p class="ats-intro">The kitchen has not heard from its server yet.</p>';
    const kit = this.ctx.sheetkit;
    const s = a.settings;
    const n = a.now || {};
    const pick = (on) => (on ? ' on' : '');
    const b = (key, v, text, on) => `<button class="ls-btn${pick(on)}" data-au="${key}"
      data-v='${esc(JSON.stringify(v))}' aria-pressed="${!!on}">${text}</button>`;
    const sky = [];
    if (!a.where) sky.push('No coordinates are set (settings.json weather.lat/lon).');
    else if (n.dark) sky.push(`Dark now (the sun ${n.sun}°)${n.dark_until ? `, until ${hm(n.dark_until)}` : ''}.`);
    else sky.push(n.dark_from ? `Light now (the sun ${n.sun ?? '?'}°); dark enough from ${hm(n.dark_from)}.`
      : 'It does not get dark enough tonight — Lakeside\'s summer nights are too light.');
    if (s.enabled && n.dark) sky.push(n.kp != null ? `Kp ${n.kp} now.` : 'Kp not known.');
    if (n.cloud != null) sky.push(`${Math.round(n.cloud)} % cloud this hour.`);
    if (s.enabled && n.tonight_kp != null) sky.push(`NOAA expects up to Kp ${n.tonight_kp} tonight.`);
    if (n.error && s.enabled) sky.push(n.error + '.');
    const verdict = !s.enabled ? 'Switched off: nothing is checked.'
      : a.possible ? 'Possible now — the alert is up.'
        : a.quiet?.now ? 'Quiet hours: not looking now.' : 'Not now.';
    // The state sentence (the settings window kit): what it waits for, and
    // what the sky says now, with the alert's own switch beside it.
    const clouds = s.clouds === 'clear' ? `no clouds (≤ ${a.clouds?.clear ?? 20} %)`
      : `light clouds (≤ ${a.clouds?.light ?? 50} %)`;
    // Its quiet hours are part of what it waits for: no alert at all in them.
    const qs = s.quiet_on ? this.quietSpan(s) : null;
    const quiet = qs ? `, outside its quiet hours (<b>${esc(qs.week)}</b>${
      qs.weekend ? `, weekends <b>${esc(qs.weekend)}</b>` : ''})` : '';
    const waits = `an alert when the aurora is <b>Kp ${esc(s.kp)} or more</b> and the sky has
      <b>${esc(clouds)}</b>, in the dark${quiet}`;
    // ...and so what is left of tonight: from dark until the quiet hours start.
    let can = '';
    if (s.enabled && qs && a.where && !a.quiet?.now) {
      const now = Date.now() / 1000;
      if (n.dark) {
        const q = this.quietStart(s, now);
        if (q > now && (!n.dark_until || q < n.dark_until)) can = `It can alert until ${hm(q)}, when its quiet hours start.`;
      } else if (n.dark_from) {
        const q = this.quietStart(s, n.dark_from);
        if (n.dark_from < q) can = `Tonight it can alert from ${hm(n.dark_from)} until ${hm(q)}, when its quiet hours start.`;
      }
    }
    if (can) sky.splice(1, 0, can);
    const t = this.type('aurora');
    const sum = kit.sum(s.enabled ? `On: ${waits}.` : 'Off — nothing is checked.', {
      next: s.enabled ? `Now: <b>${esc(verdict)}</b> ${esc(sky[0] || '')}${can ? ` ${esc(can)}` : ''}`
        : `When it is on: ${waits}.`,
      ctl: kit.toggle(!!s.enabled, `data-au="enabled" data-v="${s.enabled ? 'false' : 'true'}"`),
      cap: 'Aurora alert', off: !s.enabled,
    });
    return `
      ${sum}
      ${kit.sec('What counts', `
        <p class="sheet-note">Tells you in Needs attention when the northern lights may be seen from
          Lakeside: dark, the aurora strong enough and the sky clear enough, all at once. Checked every
          five minutes; it stays up until they have not held for half an hour.</p>
        <div class="ls-row">
          <span class="ls-label">How strong
            <span class="db-hint">NOAA's planetary Kp, the highest of the last 15 minutes. From
              Lakeside Kp ${s.kp} means: ${esc(KP_SAYS[s.kp] || '')}.</span></span>
          <span class="ls-set sheet-seg">${(a.levels || [3, 4, 5, 6]).map((k) =>
            b('kp', k, `Kp ${k}${k === 6 ? '+' : ''}`, s.kp === k)).join('')}</span>
        </div>
        <div class="ls-row">
          <span class="ls-label">Clouds
            <span class="db-hint">the cloud cover the kitchen's forecast gives for the hour.</span></span>
          <span class="ls-set sheet-seg">
            ${b('clouds', 'clear', `No clouds (≤ ${a.clouds?.clear ?? 20} %)`, s.clouds === 'clear')}
            ${b('clouds', 'light', `Light clouds (≤ ${a.clouds?.light ?? 50} %)`, s.clouds === 'light')}
          </span>
        </div>`, { note: `Kp ${s.kp}+ · ${s.clouds === 'clear' ? 'no clouds' : 'light clouds'}` })}
      ${kit.sec('Now', `
        <div class="ls-row">
          <span class="ls-label"><span class="db-hint sheet-lead">${esc(sky.join(' '))}${
            n.checked ? ` Checked ${esc(hm(n.checked))}.` : ''}</span></span>
          <span class="ls-set"><span class="au-verdict${a.possible ? ' yes' : ''}">${esc(verdict)}</span></span>
        </div>`, { note: verdict.replace(/\.$/, '') })}
      ${kit.sec('When it may alert', this.quietRows(s, a.quiet,
        'No aurora alert at all between these hours — nothing is looked for, and one already up goes — so the northern lights never wake the house in the middle of the night.'),
        { note: this.quietNote(s, a.quiet) })}
      ${kit.sec('How the alert shows', this.hearRow() + this.typeRow(t),
        { cls: 'ats-kind', note: t ? (SHOW_SHORT[t.style.show] || '') : '' })}
      ${this.intro()}`;
  },
};
