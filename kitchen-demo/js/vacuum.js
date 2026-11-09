/* House → Vacuum Cleaner (backend/app/vacuum.py, 2026-10-20).

   Alex: "show the whole house map from Ecovacs and each coloured room can be
   choosen by tapping the room, user can choose multiple rooms and click for
   vacuum clening … 2 option 1 dry cleaning and 1 for vacuum and mopp
   cleaning". And over a screenshot the same evening: the rooms named, each
   with an emoji; "choices how deep and how powerful to suck" beside each way
   of cleaning; "a button go to home"; "Make buttons bigger, there is lots of
   space for them"; "Turn the map clockwise 90 degrees".

   On the left Siri's map as Home Assistant has it from the robot, drawn again
   here from vacuum.py's pieces so each room is a thing to tap: a tap chooses
   it (its colour full, a ✓, the others fade), another tap lets it go. The
   map is turned as entities.json says (`rotate`); the labels, the robot and
   its station are placed on the turned map and stay upright. Each label is
   the room's emoji, its name and its floor area, made smaller to fit a small
   room rather than spill out of it.

   On the right where Siri is and what it is doing, what has been chosen, and
   the two ways to send it — Dry (vacuum only, the mop lifted) and Vacuum &
   mop — each with its own Suction (the robot's four fan speeds) and Depth
   (Normal, or Deep: each room twice), kept on the server per way, so each
   comes back as it was last used, on every screen. Under them Pause / Resume
   while it is out, and Send home whenever it is not on its station.

   And: "if vacuum and mop is choosen, always first make vacuum later mop …
   you can put a gear settings button, to adjust such settings". The ⚙ by
   Siri's name opens #vc-sheet: Vacuum & mop as vacuum first, then mop (the
   robot's own "mop after vacuum", the default) or both in one go, and how
   wet the mop is (the robot's water amount).

   And on 2026-10-21: "add information when the robot clened last time when
   it was active and where it clened, show in the map where it was clened
   when the clening log is clicked." Under Siri's state, the last job (or the
   one under way) in one line; a tap opens the cleaning log in this column —
   vacuum.py's own record, newest first — and a tap on a job draws on the
   map where it went: its path, and the rooms it crossed in their colour with
   the rest faded. ‹ Back gives the column its buttons again.

   Drawn into the House panel's own pane (panels/ha.js) while its Vacuum
   Cleaner tab is up; show(el) and hide() are the contract, as tunai.js's. */

const esc = (s) => String(s ?? '').replace(/[&<>"']/g,
  (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/* Ecovacs's six room colours as deebot-client draws them (style.rs), then two
   more, so seven rooms are seven colours; vacuum.py picks which. */
const COLOURS = ['#a2bce7', '#ecd099', '#9bd4da', '#ecc6c9', '#d7bce3', '#c3e2b6', '#f4b183', '#8fd1b8'];
const MODE = {
  vacuum: 'Dry', vacuum_and_mop: 'Vacuum & mop together', mop_after_vacuum: 'Vacuum, then mop', mop: 'Mop only',
};
/* The ⚙'s water amounts, on the robot's own 0–50. */
const WATER = [[10, 'Low'], [20, 'Medium'], [30, 'High'], [40, 'Very high'], [50, 'Most']];
const WAYS = [
  ['vacuum', '🧹', 'Dry', 'vacuum only, mop lifted'],
  ['vacuum_and_mop', '💧', 'Vacuum & mop', 'both in one go'],
];
const FAN = { quiet: 'Quiet', normal: 'Normal', max: 'Max', max_plus: 'Max+' };
const STATION = { emptying_dustbin: 'Emptying its dustbin', washing_mop: 'Washing its mop', drying_mop: 'Drying its mop' };
/* The robot's charger, deebot-client's pin (mod.rs), and the dot for the robot. */
const PIN = 'M4-6.4C4-4.2 0 0 0 0s-4-4.2-4-6.4 1.8-4 4-4 4 1.8 4 4z';
/* A label's name is broken into lines of about this many letters, at spaces:
   "Alex/Sam Sleeping room" is two. */
const LINE = 12;

const hm = (iso) => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
};
const m2 = (a) => `${a >= 10 ? Math.round(a) : a} m²`;
const rooms = (n) => `${n} room${n === 1 ? '' : 's'}`;
const fanWord = (f) => FAN[f] || f;
const RESULT = { finished: 'finished', finished_with_warnings: 'finished, with a warning', manually_stopped: 'stopped' };
const BY = { wall: 'from the wall', app: 'from the app or its schedule' };
const clock = (t) => {
  const d = new Date(t * 1000);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
};
/* "Today", "Yesterday", "Mon 20 Oct". */
const dayWord = (t) => {
  const d = new Date(t * 1000);
  const today = new Date();
  const k = (x) => x.toDateString();
  const y = new Date(today);
  y.setDate(today.getDate() - 1);
  if (k(d) === k(today)) return 'Today';
  if (k(d) === k(y)) return 'Yesterday';
  return d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });
};
const mins = (j) => {
  const m = j.minutes ?? (j.end ? (j.end - j.start) / 60 : null);
  if (m == null) return '';
  return m >= 60 ? `${Math.floor(m / 60)} h ${Math.round(m % 60)} min` : `${Math.max(1, Math.round(m))} min`;
};

/* The map's own point (x, y) after turning it `rot` degrees clockwise: SVG's
   rotate(), y pointing down. */
function turn(rot, x, y) {
  if (rot === 90) return [-y, x];
  if (rot === 180) return [-x, -y];
  if (rot === 270) return [y, -x];
  return [x, y];
}

function wrap(name) {
  const lines = [];
  for (const word of String(name).split(/\s+/).filter(Boolean)) {
    const last = lines[lines.length - 1];
    if (last && (last + ' ' + word).length <= LINE) lines[lines.length - 1] = `${last} ${word}`;
    else lines.push(word);
  }
  return lines;
}

export default {
  doc: null,          // vacuum.py's snapshot: the robot's state, the job, the choices, the map's version
  geo: null,          // GET /api/vacuum/map: the rooms, the walls
  el: null,           // the pane while the tab is up
  picked: new Set(),  // the room ids chosen on the map
  said: null,         // { text, warn } under the buttons, for a few seconds
  busy: null,         // the Pause / Resume / Send home waiting for the robot
  logMode: false,     // the column shows the cleaning log instead of the buttons
  shown: null,        // the log's job drawn on the map: {id, trace, ids}

  init(ctx) {
    if (this.ctx) return;
    this.ctx = ctx;
    ctx.bus.on('vacuum', (doc) => this.absorb(doc));
    this.buildSheet();
  },

  absorb(doc) {
    if (!doc) return;
    this.doc = doc;
    if (doc.map_v && doc.map_v !== this.geo?.v) this.loadMap();
    if (this.el) this.paint();
    this.renderSheet();
  },

  async loadMap() {
    if (this.loading) return;
    this.loading = true;
    try {
      const r = await fetch('/api/vacuum/map');
      if (r.ok) {
        this.geo = await r.json();
        // A room the map no longer has cannot stay chosen.
        const ids = new Set(this.geo.rooms.map((x) => x.id));
        for (const id of [...this.picked]) if (!ids.has(id)) this.picked.delete(id);
        if (this.el) { this.drawMap(); this.paint(); }
      }
    } catch { /* the next version on the bus asks again */ }
    this.loading = false;
    if (this.doc?.map_v && this.doc.map_v !== this.geo?.v && this.geo) this.loadMap();
  },

  async load() {
    try {
      const r = await fetch('/api/vacuum');
      if (r.ok) this.absorb(await r.json());
    } catch { /* the bus brings it */ }
  },

  show(el) {
    if (this.el !== el) this.build(el);
    this.el = el;
    this.load();
    this.drawMap();
    this.paint();
  },

  hide() {
    clearTimeout(this.saidTimer);
    this.said = null;
  },

  build(el) {
    el.innerHTML = `
      <div class="vc">
        <div class="vc-map">
          <svg class="vc-svg" xmlns="http://www.w3.org/2000/svg" preserveAspectRatio="xMidYMid meet"
               role="group" aria-label="The map: tap the rooms to clean"></svg>
          <div class="vc-none"></div>
        </div>
        <div class="vc-side">
          <div class="vc-top"><div class="vc-state"></div>
            <button class="tile-gear vc-gear" title="Vacuum settings" aria-label="Vacuum settings">⚙</button></div>
          <div class="vc-sub"></div>
          <button class="vc-hist" aria-label="the cleaning log"></button>
          <div class="vc-logview">
            <div class="vc-loghead"><button class="vc-back">‹ Back</button><b>Cleaning log</b></div>
            <div class="vc-logsum"></div>
            <div class="vc-logs"></div>
          </div>
          <div class="vc-pick"></div>
          <div class="vc-quick">
            <button class="vc-q" data-q="all">All rooms</button>
            <button class="vc-q" data-q="none">Clear</button>
          </div>
          ${WAYS.map(([mode, icon, word, how]) => `
          <div class="vc-way" data-mode="${mode}">
            <button class="vc-btn" data-mode="${mode}"><span class="vc-ic">${icon}</span>
              <span class="vc-bt"><b>${esc(word)}</b><small>${esc(how)}</small></span></button>
            <div class="vc-opts">
              <div class="vc-opt"><span class="vc-ol">Suction</span><div class="vc-chips" data-k="fan"></div></div>
              <div class="vc-opt"><span class="vc-ol">Depth</span><div class="vc-chips" data-k="deep">
                <button class="vc-chip" data-v="0">Normal</button>
                <button class="vc-chip" data-v="1">Deep<small>×2</small></button></div></div>
            </div>
          </div>`).join('')}
          <div class="vc-run">
            <button class="vc-do" data-do="pause">⏸ Pause</button>
            <button class="vc-do" data-do="resume">▶ Resume</button>
          </div>
          <button class="vc-do vc-home" data-do="home">⌂ Send home</button>
          <div class="vc-job"></div>
          <div class="vc-msg" aria-live="polite"></div>
        </div>
      </div>`;
    this.svg = el.querySelector('.vc-svg');
    this.tapRoom(this.svg);
    this.tap(el.querySelector('.vc-gear'), () => this.openSheet());
    this.tap(el.querySelector('.vc-hist'), () => this.openLog());
    this.tap(el.querySelector('.vc-back'), () => this.closeLog());
    this.logsEl = el.querySelector('.vc-logs');
    this.logsEl.addEventListener('click', (e) => {
      const b = e.target.closest('.vc-entry');
      if (b) this.showJob(b.dataset.id);
    });
    el.querySelectorAll('.vc-q').forEach((b) => this.tap(b, () => this.quick(b.dataset.q)));
    el.querySelectorAll('.vc-btn').forEach((b) => this.tap(b, () => this.go(b.dataset.mode)));
    el.querySelectorAll('.vc-do').forEach((b) => this.tap(b, () => this.act(b.dataset.do)));
    el.querySelectorAll('.vc-way .vc-chips[data-k="deep"] .vc-chip').forEach((b) => this.tap(b, () =>
      this.choose(b.closest('.vc-way').dataset.mode, { deep: b.dataset.v === '1' })));
    this.fans = null;
  },

  /* Only when the rooms or walls change (vacuum.py's `v`); the robot, its
     path and the choices are painted onto it by paint(). */
  drawMap() {
    if (!this.el || !this.svg) return;
    const g = this.geo;
    const none = this.el.querySelector('.vc-none');
    if (!g) {
      this.svg.innerHTML = '';
      none.hidden = false;
      none.textContent = this.doc?.map_error ? 'The map could not be read from Home Assistant.'
        : this.doc?.configured === false ? 'No robot vacuum is set up for this wall.' : 'Waiting for the map…';
      return;
    }
    none.hidden = true;
    const rot = [90, 180, 270].includes(g.rotate) ? g.rotate : 0;
    this.rot = rot;
    const [x0, y0, w, h] = g.viewBox.split(/\s+/).map(Number);
    const corners = [[x0, y0], [x0 + w, y0], [x0, y0 + h], [x0 + w, y0 + h]].map(([x, y]) => turn(rot, x, y));
    const vx = Math.min(...corners.map((c) => c[0]));
    const vy = Math.min(...corners.map((c) => c[1]));
    this.svg.setAttribute('viewBox', `${vx} ${vy} ${Math.max(...corners.map((c) => c[0])) - vx} ${Math.max(...corners.map((c) => c[1])) - vy}`);
    const fs = Math.max(5, Math.min(w || 200, h || 200) / 30);
    this.svg.innerHTML = `
      <g class="vc-turn" transform="rotate(${rot})">
        <g class="vc-floor">${(g.floor || []).map((d) => `<path d="${esc(d)}"/>`).join('')}</g>
        <g class="vc-rooms">${g.rooms.map((r, n) => `
          <g class="vc-room${r.id == null ? ' off' : ''}" data-n="${n}" data-id="${r.id ?? ''}" style="--rc:${COLOURS[r.c % COLOURS.length]}">
            <path class="vc-ext" d="${esc(r.hit)}"/><path class="vc-flo" d="${esc(r.d)}"/>
          </g>`).join('')}</g>
        <g class="vc-walls">${g.walls.map((d) => `<path d="${esc(d)}"/>`).join('')}</g>
        <g class="vc-virtual">${(g.virtual || []).map((v) => `<path class="${v.k}" d="${esc(v.d)}"/>`).join('')}</g>
        <path class="vc-trace" d=""/>
        <path class="vc-past" d=""/>
      </g>
      <g class="vc-labels">${g.rooms.map((r, n) => r.lx == null ? '' : this.label(r, n, fs)).join('')}</g>
      <g class="vc-charger" hidden><path d="${PIN}" fill="#ffe605"/><circle cy="-6.4" r="2.8" fill="#fff"/></g>
      <g class="vc-bot" hidden><circle class="vc-glow" r="6.5"/><circle r="4" class="vc-dot"/></g>`;
    // Next frame: show() draws the map a moment before the House panel
    // unhides the pane, and a hidden label measures nothing.
    requestAnimationFrame(() => this.fit());
  },

  /* A room's label at its point on the turned map: emoji, name, area, and the
     ✓ that shows while it is chosen, as lines centred on the point. */
  label(r, n, fs) {
    const lines = [];
    if (r.emoji) lines.push(['vc-emo', r.emoji, fs * 1.25]);
    for (const l of r.name ? wrap(r.name) : []) lines.push(['vc-name', l, fs]);
    lines.push(['vc-area', m2(r.area), fs * (r.name ? 0.8 : 1)]);
    const gap = fs * 0.22;
    const total = lines.reduce((a, [, , size]) => a + size + gap, 0) - gap;
    let y = -total / 2;
    const text = lines.map(([cls, words, size]) => {
      const at = y + size / 2;
      y += size + gap;
      return `<text class="${cls}" y="${at.toFixed(2)}" font-size="${size.toFixed(2)}">${esc(words)}</text>`;
    }).join('');
    const tick = fs * 0.7;
    const [x, yy] = turn(this.rot, r.lx, r.ly);
    return `<g class="vc-lab" data-n="${n}" data-x="${x}" data-y="${yy}" transform="translate(${x} ${yy})"><g class="vc-lab-in">${text}
      <g class="vc-tick" transform="translate(0 ${(total / 2 + tick * 1.25).toFixed(2)})"><circle r="${tick.toFixed(2)}"/>
        <path d="M${-tick * 0.48} 0l${tick * 0.34} ${tick * 0.34} ${tick * 0.62}-${tick * 0.64}" stroke-width="${(tick * 0.25).toFixed(2)}"/></g></g></g>`;
  },

  /* Each label made smaller where its room is too small for it. A label is
     centred on its point, which is the room's roomiest spot and not its
     middle, so what counts is the room's box on each side of the point, on
     the turned map: the nearer edge, across and down, with a little to
     spare. Measured, since how wide a word is is the font's business. */
  fit() {
    const rooms = this.svg.querySelectorAll('.vc-room .vc-ext');
    this.svg.querySelectorAll('.vc-lab').forEach((lab) => {
      const room = rooms[Number(lab.dataset.n)];
      const inner = lab.querySelector('.vc-lab-in');
      if (!room || !inner) return;
      let rb, lb;
      try { rb = room.getBBox(); lb = inner.getBBox(); } catch { return; }
      // Drawn while the tab is hidden, everything measures 0: leave it for
      // show(), which draws the map again.
      if (!rb.width || !lb.width) return;
      const pts = [[rb.x, rb.y], [rb.x + rb.width, rb.y], [rb.x, rb.y + rb.height],
        [rb.x + rb.width, rb.y + rb.height]].map(([x, y]) => turn(this.rot, x, y));
      const xs = pts.map((p) => p[0]);
      const ys = pts.map((p) => p[1]);
      const x = Number(lab.dataset.x);
      const y = Number(lab.dataset.y);
      const across = 2 * Math.min(x - Math.min(...xs), Math.max(...xs) - x);
      const down = 2 * Math.min(y - Math.min(...ys), Math.max(...ys) - y);
      const s = Math.min(1, (across * 0.88) / lb.width, (down * 0.88) / lb.height);
      if (s < 1) inner.setAttribute('transform', `scale(${Math.max(s, 0.3).toFixed(3)})`);
    });
  },

  paint() {
    if (!this.el) return;
    const d = this.doc || {};
    const g = this.geo;
    const name = esc(d.name || 'The robot');
    const s = d.state;
    const job = d.job;
    const starting = job && ['mode', 'sent'].includes(job.phase);
    const out = ['cleaning', 'returning', 'paused'].includes(s);

    // ---- the robot, on the right
    const st = this.el.querySelector('.vc-state');
    const dot = s === 'cleaning' ? 'busy' : s === 'error' || !d.ha ? 'bad' : s === 'docked' ? 'on' : '';
    st.innerHTML = d.configured === false ? 'No robot vacuum is set up'
      : !d.ha ? '<span class="vc-dot2 bad"></span>Home Assistant is not connected'
        : `<span class="vc-dot2 ${dot}"></span><b>${name}</b><span>${esc(d.said || s || '')}</span>`
          + (d.battery != null ? `<span class="vc-bat">🔋 ${d.battery} %</span>` : '');
    const sub = this.el.querySelector('.vc-sub');
    const subs = [];
    if (d.error) subs.push(`<span class="warn">${esc(d.error)}</span>`);
    if (STATION[d.station]) subs.push(STATION[d.station]);
    if (d.mode) subs.push(`Set to <b>${esc(MODE[d.mode] || d.mode)}</b>${d.fan ? `, suction <b>${esc(fanWord(d.fan))}</b>` : ''}`);
    sub.innerHTML = subs.join(' · ');

    // ---- the map: chosen, ringed, the path and the robot
    const live = !!g && !g.mismatch;
    if (this.svg && g) {
      const ringed = new Set(job && ['running', 'sent', 'mode'].includes(job.phase) ? job.rooms : []);
      // A job from the log, on the map: its rooms in colour, the rest faded.
      // Nothing known of where it went (a job from HA's history): the map as it is.
      const past = this.logMode && this.shown && (this.shown.ids.length || this.shown.trace) ? this.shown : null;
      const was = new Set(past ? past.ids : []);
      this.svg.classList.toggle('some', !past && this.picked.size > 0);
      this.svg.classList.toggle('hist', !!past);
      this.svg.querySelectorAll('.vc-room').forEach((el) => {
        const id = el.dataset.id === '' ? null : Number(el.dataset.id);
        el.classList.toggle('on', !past && id != null && this.picked.has(id));
        el.classList.toggle('job', !past && id != null && ringed.has(id));
        el.classList.toggle('was', id != null && was.has(id));
      });
      this.svg.querySelectorAll('.vc-lab').forEach((el) => {
        const r = g.rooms[Number(el.dataset.n)];
        el.classList.toggle('on', !past && !!r && r.id != null && this.picked.has(r.id));
        el.classList.toggle('was', !!r && r.id != null && was.has(r.id));
      });
      const tr = this.svg.querySelector('.vc-trace');
      if (tr) {
        if (d.trace && !past) { tr.setAttribute('d', d.trace.d); tr.setAttribute('transform', d.trace.transform); }
        else tr.setAttribute('d', '');
      }
      const pt = this.svg.querySelector('.vc-past');
      if (pt && pt.getAttribute('d') !== (past?.trace || '')) pt.setAttribute('d', past?.trace || '');
      const place = (sel, p) => {
        const el = this.svg.querySelector(sel);
        if (!el) return;
        el.toggleAttribute('hidden', !p);     // an SVG element has no .hidden
        if (p) el.setAttribute('transform', `translate(${turn(this.rot, p.x, p.y).join(' ')})`);
      };
      place('.vc-charger', d.charger);
      place('.vc-bot', d.robot);
      this.svg.querySelector('.vc-bot')?.classList.toggle('moving', s === 'cleaning' || s === 'returning');
    }
    const none = this.el.querySelector('.vc-none');
    if (g && g.mismatch) {
      none.hidden = false;
      none.textContent = `The map and ${d.name || 'the robot'}'s room list do not agree, so rooms cannot be chosen until Home Assistant has the new map.`;
    } else if (g) none.hidden = true;

    // ---- what is chosen
    const chosen = live ? g.rooms.filter((r) => r.id != null && this.picked.has(r.id)) : [];
    const pick = this.el.querySelector('.vc-pick');
    if (!g) pick.textContent = '';
    else if (!chosen.length) pick.innerHTML = '<span class="dim">Tap the rooms you want cleaned</span>';
    else {
      const area = chosen.reduce((a, r) => a + r.area, 0);
      const named = chosen.filter((r) => r.name).map((r) => esc(r.name));
      pick.innerHTML = `<span><b>${chosen.length === g.rooms.length ? 'The whole house' : rooms(chosen.length)}</b>`
        + ` · ${m2(Math.round(area * 10) / 10)}</span>`
        + (named.length === chosen.length ? `<span class="dim">${named.join(', ')}</span>` : '');
    }
    this.el.querySelectorAll('.vc-q').forEach((b) => {
      b.disabled = !live || (b.dataset.q === 'none' ? !this.picked.size : this.picked.size === g.rooms.filter((r) => r.id != null).length);
    });

    // ---- the two ways, each with its suction and depth
    const why = !d.ha ? 'Home Assistant is not connected'
      : ['unavailable', 'unknown', null, undefined].includes(s) ? `${d.name || 'The robot'} is not reachable`
        : s === 'cleaning' ? 'Cleaning now — Pause or Send home first'
          : starting ? 'Starting…'
            : !chosen.length ? '' : null;
    this.chips(d.fans || []);
    for (const way of this.el.querySelectorAll('.vc-way')) {
      const mode = way.dataset.mode;
      const pref = (d.prefs || {})[mode] || {};
      const btn = way.querySelector('.vc-btn');
      btn.disabled = why !== null || !(d.modes || []).includes(mode);
      btn.classList.toggle('now', !!job && job.mode === mode && (starting || job.phase === 'running'));
      if (mode === 'vacuum_and_mop') {
        btn.querySelector('small').textContent = d.mop_order === 'together' ? 'both in one go' : 'vacuum first, then mop';
      }
      way.querySelectorAll('.vc-chips[data-k="fan"] .vc-chip').forEach((c) => c.classList.toggle('on', c.dataset.v === pref.fan));
      way.querySelectorAll('.vc-chips[data-k="deep"] .vc-chip').forEach((c) =>
        c.classList.toggle('on', (c.dataset.v === '1') === !!pref.deep));
    }

    // ---- Pause / Resume while it is out, Send home whenever it is not home
    const run = this.el.querySelector('.vc-run');
    const show = { pause: s === 'cleaning' || s === 'returning', resume: s === 'paused' };
    run.hidden = !show.pause && !show.resume;
    run.querySelectorAll('.vc-do').forEach((b) => {
      b.hidden = !show[b.dataset.do];
      b.disabled = !!this.busy;
    });
    const home = this.el.querySelector('.vc-home');
    home.disabled = !!this.busy || !d.ha || !['cleaning', 'paused', 'idle', 'error'].includes(s);
    home.textContent = this.busy === 'home' ? `⌂ Sending ${d.name || 'it'} home…`
      : s === 'docked' ? '⌂ On its station' : s === 'returning' ? '⌂ Going home' : '⌂ Send home';

    // ---- the job, in words. Written only when it changes: a repaint mid-tap
    // would take the OK away from under the finger.
    const jb = this.el.querySelector('.vc-job');
    let cls = 'vc-job', html = '';
    if (job && job.phase === 'failed') {
      cls = 'vc-job warn';
      html = `${esc(job.error || 'It did not start')} <button class="vc-ok">OK</button>`;
    } else if (job) {
      const how = [MODE[job.work_mode] || MODE[job.mode] || job.mode, job.fan && `suction ${fanWord(job.fan)}`,
        job.deep && 'deep'].filter(Boolean).join(', ');
      const what = `${rooms(job.rooms.length)} · ${m2(job.area)} · ${esc(how)}`;
      html = job.phase === 'mode' ? `Setting ${name} up: ${esc(how)}…`
        : job.phase === 'sent' ? `Sending ${name} out: ${what}`
          : `Sent at ${hm(job.at)}: ${what}`;
    } else if (d.last && !out) {
      cls = 'vc-job dim';
      html = esc(`Last from here: ${rooms(d.last.rooms.length)}, ${MODE[d.last.mode] || d.last.mode}, back at ${hm(d.last.done)}`);
    }
    if (jb.dataset.k !== cls + html) {
      jb.dataset.k = cls + html;
      jb.className = cls;
      jb.innerHTML = html;
      this.tap(jb.querySelector('.vc-ok'), () => this.post('/api/vacuum/dismiss', {}));
    }
    this.paintLog();
    const msg = this.el.querySelector('.vc-msg');
    // While it cleans the two ways cannot be used, so why is only worth
    // saying to somebody who has chosen rooms for the next time.
    const said = this.said || (why && (s !== 'cleaning' || this.picked.size) ? { text: why } : null);
    msg.className = `vc-msg${said?.warn ? ' warn' : ''}`;
    msg.textContent = said?.text || '';
  },

  /* ------------------------------------------------- the log ---- */

  jobs() { return this.doc?.log?.jobs || []; },

  /* A job's rooms, as words: those its path crossed (most first), or those
     it was sent to, or nothing known. */
  jobRooms(j) {
    if (j.visited && j.visited.length) return j.visited.map((v) => `${v.emoji ? `${v.emoji} ` : ''}${v.name || `room ${v.id}`}`);
    const names = new Map((this.geo?.rooms || []).map((r) => [r.id, r.name || `room ${r.id}`]));
    return (j.rooms || []).map((id) => names.get(id) || `room ${id}`);
  },

  /* The line under Siri's state: the job under way, or the last one. */
  histLine() {
    const j = this.jobs()[0];
    const s = this.doc?.state;
    if (!j) return '<span class="vc-h1">🕘 Cleaning log</span><span class="vc-h2">nothing recorded yet — the wall keeps it from 21 Oct</span>';
    const rooms = this.jobRooms(j);
    if (!j.end) {
      return `<span class="vc-h1">🧹 Out since ${clock(j.start)}</span>`
        + `<span class="vc-h2">${esc([j.area && `${m2(j.area)} so far`, BY[j.by]].filter(Boolean).join(' · '))} — the log ›</span>`;
    }
    return `<span class="vc-h1">🕘 Last cleaned ${esc(dayWord(j.start))} ${clock(j.start)}–${clock(j.end)}</span>`
      + `<span class="vc-h2">${esc([mins(j), j.area != null && m2(j.area), rooms.length && rooms.join(', ')]
        .filter(Boolean).join(' · '))}${s === 'cleaning' ? '' : ''} — the log ›</span>`;
  },

  entry(j) {
    const rooms = this.jobRooms(j);
    const how = [MODE[j.mode] || j.mode, j.fan && `suction ${fanWord(j.fan)}`].filter(Boolean).join(', ');
    const where = j.visited && j.visited.length ? 'where it went'
      : j.rooms ? 'the rooms it was sent to' : '';
    return `<button class="vc-entry${this.shown?.id === j.id ? ' on' : ''}" data-id="${esc(j.id)}">
      <span class="vc-e1"><b>${esc(dayWord(j.start))} ${clock(j.start)}${j.end ? `–${clock(j.end)}` : ' · now'}</b>
        <span>${esc([mins(j), j.area != null && m2(j.area)].filter(Boolean).join(' · '))}</span></span>
      <span class="vc-e2">${esc([how, BY[j.by], RESULT[j.result], j.legs > 1 && `${j.legs} trips out`].filter(Boolean).join(' · '))}</span>
      ${rooms.length ? `<span class="vc-e3">${j.visited && j.visited.length ? j.visited.map((v) =>
        `<i>${esc(`${v.emoji ? `${v.emoji} ` : ''}${v.name || `room ${v.id}`}`)} <small>${Math.round(v.share * 100)} %</small></i>`).join('')
        : esc(rooms.join(', '))}</span>` : ''}
      <span class="vc-e4">${j.has_trace ? `tap: ${where} on the map` : where ? `tap: ${where} on the map (no path kept)`
        : j.by ? 'no path kept' : 'from Home Assistant\'s history — before the wall kept paths'}</span>
    </button>`;
  },

  paintLog() {
    const btn = this.el.querySelector('.vc-hist');
    const side = this.el.querySelector('.vc-side');
    side.classList.toggle('logmode', this.logMode);
    const line = this.histLine();
    if (btn.dataset.k !== line) { btn.dataset.k = line; btn.innerHTML = line; }
    if (!this.logMode) return;
    const t = this.doc?.log?.totals || {};
    const sum = [t.cleanings != null && `${Math.round(t.cleanings)} cleanings`, t.area != null && `${Math.round(t.area).toLocaleString('en-GB')} m²`,
      t.hours != null && `${Math.round(t.hours)} h`].filter(Boolean).join(' · ');
    const sumEl = this.el.querySelector('.vc-logsum');
    const sumHtml = `${sum ? `${esc(this.doc?.name || 'The robot')}'s own count, all time: ${esc(sum)}.<br>` : ''}`
      + 'Below, every job since the wall started keeping them. Tap one to see it on the map.';
    if (sumEl.innerHTML !== sumHtml) sumEl.innerHTML = sumHtml;
    const html = this.jobs().map((j) => this.entry(j)).join('') || '<p class="vc-e4">Nothing yet.</p>';
    if (this.logsEl.dataset.k !== html) { this.logsEl.dataset.k = html; this.logsEl.innerHTML = html; }
  },

  openLog() {
    this.logMode = true;
    const first = this.jobs().find((j) => j.has_trace || (j.rooms && j.rooms.length)) || this.jobs()[0];
    if (first) this.showJob(first.id, true);
    this.paint();
  },

  closeLog() {
    this.logMode = false;
    this.shown = null;
    this.paint();
  },

  /* One job on the map: its path from the server (not in the snapshot), and
     its rooms. Tapped again, it goes. */
  async showJob(id, keep = false) {
    if (!keep && this.shown?.id === id) { this.shown = null; this.paint(); return; }
    const j = this.jobs().find((x) => x.id === id);
    if (!j) return;
    const ids = (j.visited && j.visited.length ? j.visited.map((v) => v.id) : j.rooms || []).filter((x) => x != null);
    this.shown = { id, ids, trace: '' };
    this.paint();
    if (!j.has_trace) return;
    try {
      const r = await fetch(`/api/vacuum/log/${encodeURIComponent(id)}`);
      const full = r.ok ? await r.json() : null;
      if (full && this.shown?.id === id) { this.shown.trace = full.trace || ''; this.paint(); }
    } catch { /* the rooms are shown already */ }
  },

  /* ------------------------------------------------- the ⚙ sheet ---- */

  /* The settings window kit (app.css, js/sheetkit.js): two cards, each with
     what the robot has now as its note, under a header that says where Siri
     is and how it will mop. */
  buildSheet() {
    const el = document.createElement('div');
    el.id = 'vc-sheet';
    el.className = 'sheet';   // the settings window kit (app.css)
    el.innerHTML = `
      <header>
        <span class="sheet-icon" aria-hidden="true">🧹</span>
        <div class="sheet-title">
          <h2>Vacuum settings</h2>
          <span class="sheet-status vc-now"></span>
        </div>
        <span class="spacer"></span>
        <button class="ls-close">Close</button>
      </header>
      <div class="ls-body"></div>`;
    document.body.appendChild(el);
    this.sheet = el;
    this.sheetBody = el.querySelector('.ls-body');
    this.sheetNow = el.querySelector('.vc-now');
    el.querySelector('.ls-close').onclick = () => this.closeSheet();
  },

  openSheet() {
    this.sheetSaid = null;
    this.sheet.classList.add('open');
    this.renderSheet();
  },

  closeSheet() { this.sheet?.classList.remove('open'); },

  /* The robot's water as the sheet says it: "31 of 50 · between High and
     Very high", or the step it is on. */
  waterNote(w) {
    if (!w || w.value == null) return 'not known yet';
    const at = WATER.find(([v]) => v === w.value);
    if (at) return `${at[1]} · ${w.value}`;
    const below = [...WATER].reverse().find(([v]) => v < w.value);
    const above = WATER.find(([v]) => v > w.value);
    const between = below && above ? ` · between ${below[1]} and ${above[1]}`
      : above ? ` · under ${above[1]}` : below ? ` · over ${below[1]}` : '';
    return `${w.value} of ${w.max}${between}`;
  },

  /* The header's line: where the robot is, its battery, and how a 💧 run goes.
     An error the robot reports (whatever its state) leads the line, so the
     terracotta says what needs somebody. */
  sheetLine(d) {
    if (d.configured === false) return ['No robot vacuum is set up', 'off'];
    if (!d.ha) return ['<b>Home Assistant is not connected</b>', 'warn'];
    const s = d.state;
    const parts = d.error ? [`<b>${esc(d.error)}</b>`, esc(d.said || s || '…')] : [`<b>${esc(d.said || s || '…')}</b>`];
    if (d.battery != null) parts.push(`🔋 ${d.battery} %`);
    parts.push(d.mop_order === 'together' ? 'mops in one go' : 'vacuums first, then mops');
    if (d.water?.value != null) parts.push(`water ${d.water.value}`);
    const tone = d.error || s === 'error' || ['unavailable', 'unknown', null, undefined].includes(s) ? 'warn'
      : ['cleaning', 'returning'].includes(s) ? 'live' : 'ok';
    return [parts.join(' · '), tone];
  },

  renderSheet() {
    if (!this.sheet?.classList.contains('open')) return;
    const kit = this.ctx.sheetkit;
    const d = this.doc || {};
    const name = esc(d.name || 'the robot');
    const order = d.mop_order || 'after';
    const w = d.water;
    const on = (a, b) => (a === b ? ' on' : '');
    const [line, tone] = this.sheetLine(d);
    kit.status(this.sheetNow, line, tone);
    const said = this.sheetSaid;
    // One of N: the order, and the water's five steps — the robot's own
    // number in small type, and the value it has now as the card's note,
    // also when it falls between two steps (set in the Ecovacs app).
    this.sheetBody.innerHTML = `
      ${kit.sec('Vacuum & mop', `
        <div class="ls-row">
          <span class="ls-label"><span class="db-hint sheet-lead">how ${name} cleans when 💧 Vacuum &amp; mop
            is tapped. Vacuum first, then mop: the chosen rooms are vacuumed dry, then mopped (Ecovacs's
            "mop after vacuum"). Both in one go: it vacuums and mops in the same pass.</span></span>
          <span class="ls-set sheet-seg">
            <button class="ls-btn${on(order, 'after')}" data-mop="after" aria-pressed="${order === 'after'}">Vacuum first, then mop</button>
            <button class="ls-btn${on(order, 'together')}" data-mop="together" aria-pressed="${order === 'together'}">Both in one go</button>
          </span>
        </div>`, { note: order === 'together' ? 'both in one go' : 'vacuum first, then mop' })}

      ${kit.sec('Water for mopping', `
        <div class="ls-row">
          <span class="ls-label"><span class="db-hint sheet-lead">how wet the mop is — ${name}'s own setting,
            ${w ? `${w.min}–${w.max}` : '0–50'}, the same as in the Ecovacs app.
            ${w ? `Set to ${w.value} now.` : 'Not known yet.'}</span></span>
          <span class="ls-set sheet-seg vc-water">${WATER.map(([v, word]) => `
            <button class="ls-btn${on(w?.value, v)}" data-water="${v}" aria-pressed="${w?.value === v}"
              ${w ? '' : 'disabled'}>${word}<small>${v}</small></button>`).join('')}
          </span>
        </div>`, { note: this.waterNote(w) })}

      <p class="sheet-line vc-sheetmsg${said?.warn ? ' sheet-warn' : ''}" aria-live="polite">${esc(said?.text || '')}</p>`;
    this.sheetBody.querySelectorAll('[data-mop]').forEach((b) => {
      b.onclick = () => this.setting({ mop: b.dataset.mop });
    });
    this.sheetBody.querySelectorAll('[data-water]').forEach((b) => {
      b.onclick = () => this.setting({ water: Number(b.dataset.water) });
    });
    kit.sync(this.sheet);
  },

  /* The line under the cards, kept across the snapshots that redraw them:
     a change on its way, or why it did not take. */
  sheetSay(text, warn = false) {
    this.sheetSaid = text ? { text, warn } : null;
    const msg = this.sheetBody.querySelector('.vc-sheetmsg');
    if (!msg) return;
    msg.textContent = text || '';
    msg.classList.toggle('sheet-warn', !!(text && warn));
  },

  async setting(change) {
    if (change.water != null) this.sheetSay('Setting the water…');
    try {
      const r = await fetch('/api/vacuum/settings', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(change),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) { this.sheetSay(j.error || `it did not work (${r.status})`, true); return; }
      this.sheetSay('');
      // The answer is the robot's settings; anything else (a preview's {})
      // leaves the sheet as it was.
      if (j.mop_order || j.water) {
        this.absorb({ ...this.doc, mop_order: j.mop_order ?? this.doc?.mop_order, water: j.water ?? this.doc?.water });
      }
    } catch {
      this.sheetSay('the kitchen server did not answer', true);
    }
  },

  /* The suction chips, from the levels the robot says it has; built again
     only if that list changes. */
  chips(fans) {
    const key = fans.join(',');
    if (this.fans === key) return;
    this.fans = key;
    for (const box of this.el.querySelectorAll('.vc-chips[data-k="fan"]')) {
      const mode = box.closest('.vc-way').dataset.mode;
      box.innerHTML = fans.map((f) => `<button class="vc-chip" data-v="${esc(f)}">${esc(fanWord(f))}</button>`).join('');
      box.querySelectorAll('.vc-chip').forEach((b) => this.tap(b, () => this.choose(mode, { fan: b.dataset.v })));
    }
  },

  async choose(mode, change) {
    const prefs = this.doc?.prefs || {};
    prefs[mode] = { ...(prefs[mode] || {}), ...change };
    if (this.doc) this.doc.prefs = prefs;
    this.paint();
    await this.post('/api/vacuum/prefs', { mode, ...change });
  },

  quick(q) {
    if (!this.geo || this.geo.mismatch) return;
    if (q === 'all') this.geo.rooms.forEach((r) => r.id != null && this.picked.add(r.id));
    else this.picked.clear();
    this.paint();
  },

  async go(mode) {
    if (!this.picked.size) return;
    const pref = (this.doc?.prefs || {})[mode] || {};
    const body = { rooms: [...this.picked], mode };
    if (pref.fan) body.fan = pref.fan;
    if (typeof pref.deep === 'boolean') body.deep = pref.deep;
    const r = await this.post('/api/vacuum/clean', body);
    if (r.ok) this.picked.clear();
    this.paint();
  },

  /* Pause, Resume, Send home: the server answers once the robot's state says
     it happened (up to 20 s), or says it did not. */
  async act(what) {
    this.busy = what;
    this.paint();
    try { await this.post('/api/vacuum/do', { do: what }); } finally {
      this.busy = null;
      this.paint();
    }
  },

  async post(url, body) {
    try {
      const r = await fetch(url, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) { this.say(j.error || `it did not work (${r.status})`, true); return { ok: false }; }
      if (j.job) this.absorb({ ...this.doc, job: j.job });
      return { ok: true };
    } catch {
      this.say('the kitchen server did not answer', true);
      return { ok: false };
    }
  },

  say(text, warn) {
    clearTimeout(this.saidTimer);
    this.said = { text, warn };
    this.saidTimer = setTimeout(() => { this.said = null; this.paint(); }, 6000);
    this.paint();
  },

  /* A tap on a room chooses it or lets it go; a finger that moves is not a tap. */
  tapRoom(svg) {
    let down = null;
    svg.addEventListener('pointerdown', (e) => {
      const room = e.target.closest?.('.vc-room');
      down = room ? { room, x: e.clientX, y: e.clientY } : null;
    });
    svg.addEventListener('pointerup', (e) => {
      const was = down;
      down = null;
      if (!was || Math.hypot(e.clientX - was.x, e.clientY - was.y) > 12) return;
      if (e.target.closest?.('.vc-room') !== was.room) return;
      if (!this.geo || this.geo.mismatch || was.room.dataset.id === '' || this.logMode) return;
      const id = Number(was.room.dataset.id);
      if (this.picked.has(id)) this.picked.delete(id); else this.picked.add(id);
      this.paint();
    });
    svg.addEventListener('pointercancel', () => { down = null; });
  },

  tap(btn, fn) {
    if (!btn) return;
    let armed = false, x0 = 0, y0 = 0;
    btn.addEventListener('pointerdown', (e) => { armed = true; x0 = e.clientX; y0 = e.clientY; });
    btn.addEventListener('pointerup', (e) => {
      if (!armed) return;
      armed = false;
      if (btn.disabled || Math.hypot(e.clientX - x0, e.clientY - y0) > 12) return;
      fn();
    });
    ['pointercancel', 'pointerleave'].forEach((ev) => btn.addEventListener(ev, () => { armed = false; }));
    btn.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); fn(); }
    });
  },
};
