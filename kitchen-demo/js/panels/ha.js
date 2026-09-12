// House: room light tiles, whole-house scenes and dimming under them, a
// settings sheet per room, and a link to the service index.
//
// States arrive over SSE; taps go through the backend's allowlisted
// /api/ha/call. Home Assistant being down greys only this panel.
//
// The shell is built once and only the tile grid is re-rendered, because
// states arrive continuously and rebuilding the whole body would throw away
// the whole-house slider under a finger several times a minute.

const COLOURS = [
  ['Warm white', 30, 25],
  ['Peach', 20, 55],
  ['Red', 0, 90],
  ['Amber', 40, 85],
  ['Green', 120, 70],
  ['Teal', 175, 70],
  ['Blue', 220, 80],
  ['Violet', 275, 70],
  ['Pink', 320, 70],
];

/* Named white scenes, for the whole house and for one room. Brightness and
   warmth together, because "evening" is both — a dim daylight-white room reads
   as a lamp about to die rather than as evening. */
const SCENES = [
  ['Bright', 100, 4000],
  ['Warm', 75, 2700],
  ['Evening', 40, 2200],
  ['Night', 10, 2000],
];

const COLOUR_MODES = ['xy', 'hs', 'rgb', 'rgbw', 'rgbww', 'rgbcw'];

/* How often a dragged slider is allowed to reach Home Assistant, and how long
   the lamp is told to take getting there.

   A bridge is the scarce resource, not the network: Philips' own guidance is
   about ten commands a second to one light and roughly one a second to a
   group. Sent faster than that the commands queue behind each other and the
   room answers a second or two after the finger has stopped — the same lag as
   sending nothing at all, arrived at from the opposite direction.

   So the rate is modest and the smoothness comes from `transition` instead:
   each command tells the lamp to glide to the new brightness over about the
   time until the next one, which reads as continuous dimming rather than as
   four steps a second. Letting go sends the final value immediately, so the
   drag ends where the finger did without waiting on the throttle.

   This is the fixed rate for one room, which is a fixed amount of work. The
   whole-house slider cannot use one — its cost depends on how many rooms are
   lit — and paces itself instead; see houseDim(). */
const PUSH_MS = 250;      // one room
const RELEASE_MS = 0.15;  // the settle after letting go: short, it is the last word

/* A scene's warmth has to land inside what the lamp can actually do: some
   bulbs stop at 2200K, and asking one for 2000K is an error rather than a
   warmer light. */
const clampK = (k, caps) =>
  Math.round(Math.min(Math.max(k, caps.minK || 2200), caps.maxK || 6500));

export default {
  id: 'ha',
  title: 'House',

  init(body, ctx) {
    this.ctx = ctx;
    this.body = body;
    this.states = {};
    this.connected = false;
    this.open = null;          // entity id whose sheet is showing

    /* The service index was the last thing in this panel — first framed, then
       as a link along the bottom. It is its own panel now (panels/services.js),
       in the corner under the countdown, and this panel is lights only. */
    body.innerHTML = `
      <div class="ha-tiles"></div>
      <div class="ha-house"></div>`;

    this.tiles = body.querySelector('.ha-tiles');
    this.house = body.querySelector('.ha-house');

    this.buildHouse();
    this.buildSheet();
    this.render();
    ctx.bus.on('ha_states', (states) => { this.states = states; this.render(); });
    ctx.bus.on('ha_connected', (ok) => { this.connected = ok; this.render(); });

    // Asked once rather than discovered on the first drag: whether the bridge
    // can be dimmed as one zone decides how the house slider behaves.
    this.zoneOk = false;
    fetch('/api/hue/status').then((r) => r.json()).then((s) => {
      this.zoneOk = !!s.ok;
      this.paintHouse();
    }).catch(() => {});
  },

  esc(s) {
    return String(s ?? '').replace(/[&<>"']/g,
      (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  },

  isOn(item) {
    return (item.entities || [item.entity])
      .some((e) => this.states[e] && this.states[e].s === 'on');
  },

  /* What a room can actually do, read off the state Home Assistant already
     sends us. A gear on a plug that can only be on or off would be a button
     that opens an empty box. */
  caps(item) {
    if (item.entities || !item.entity) return null;          // action tiles
    const a = (this.states[item.entity] || {}).a || {};
    const modes = a.supported_color_modes || [];
    const dim = modes.some((m) => m !== 'onoff');
    if (!dim) return null;
    return {
      temp: modes.includes('color_temp'),
      colour: modes.some((m) => COLOUR_MODES.includes(m)),
      minK: a.min_color_temp_kelvin || 2200,
      maxK: a.max_color_temp_kelvin || 6500,
    };
  },

  /* "on · 60%" reads better than a bare "on" when the lamp reports brightness */
  subtitle(item) {
    if (item.entities) return `${item.entities.length} rooms`;
    const st = this.states[item.entity];
    if (!st) return '—';
    if (st.s !== 'on') return 'off';
    const b = st.a && st.a.brightness;
    return b ? `on · ${Math.round((b / 255) * 100)}%` : 'on';
  },

  /* Split so paint() can refresh the numbers without rewriting the card. */
  _ok(s) { return s && s.s != null && s.s !== 'unavailable' && s.s !== 'unknown'; },

  readingValue(item) {
    const t = this.states[item.temp_entity];
    return this._ok(t) ? `${Number(t.s).toFixed(1)}°` : '—';
  },

  readingCap(item) {
    const h = this.states[item.hum_entity];
    return item.label + (this._ok(h) ? ` · ${Math.round(Number(h.s))}% rh` : '');
  },

  reading(item) {
    return `<div class="reading">
      <span class="val${item.outside ? ' out' : ''}">${this.readingValue(item)}</span>
      <span class="cap">${this.esc(this.readingCap(item))}</span></div>`;
  },

  /* `wait` asks the backend to hold the response until Home Assistant has
     actually finished, which is the only way this side can know how long a
     command really took. Taps never use it — a button must not wait on a
     bridge — but the house dimmer does, because that is what paces it.
     A backend too old to know the flag ignores it and answers immediately;
     the floor in houseDim() covers that case. */
  async call(entity, service, data, wait = false) {
    try {
      const r = await fetch('/api/ha/call', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ domain: 'light', service, entity_id: entity, data, wait }),
      });
      if (!r.ok) throw new Error();
      return true;
    } catch {
      return false;
    }
  },

  /* ---------------- the whole house ----------------
     One tap for the room you are standing in is the tile above; one tap for
     the house you are leaving, or coming home to, is here. Targets are worked
     out per capability from the states Home Assistant already sends: colour
     goes only to the lamps that have it, warmth only to the ones that report
     it, and a plug that can only be on or off is left out rather than sent a
     field it would refuse. */

  rooms() {
    // Real rooms only: the "All off" tile is an action, not a lamp.
    return (this.ctx.config.entities.lights || []).filter((l) => l.entity && !l.entities);
  },

  lit(item) { return this.states[item.entity]?.s === 'on'; },

  /* Everything under "Whole house" acts on the rooms that are lit, and only
     those. Two reasons, and they turn out to be the same reason.

     It is what the control means: setting the house to Evening is a thing you
     do to the rooms you are in, not an instruction to light every empty one —
     and a house-wide dim that switched on nine rooms was a thing you then had
     to go and undo.

     And it is what makes it quick. A service call costs Home Assistant about
     eighty milliseconds per room group it names: nine rooms measured at 0.71s,
     four at 0.23s. At nine, a call was still being worked through when the
     next one arrived, and the queue never drained — the lag on the whole-house
     controls that the per-room ones never had. Naming only the lit rooms is
     usually two or three, which lands well inside the window between calls.

     Several of the rooms are unreachable lamps besides — bulbs switched off at
     the wall, which no bridge can reach — and they report off, so this drops
     them too. */
  targets(kind) {
    const out = [];
    for (const item of this.rooms()) {
      const caps = this.caps(item);
      if (!caps) continue;                        // on/off only — nothing to set
      if (!this.lit(item)) continue;              // dark rooms stay dark
      if (kind === 'colour' && !caps.colour) continue;
      if (kind === 'temp' && !caps.temp) continue;
      out.push(item.entity);
    }
    return out;
  },

  /* Both halves of a scene go at once. Sent one after the other, the second
     waited on the first, and the wall sat there through both. */
  houseScene(pct, kelvin) {
    // One call carries one warmth, so it has to be a value every lamp in the
    // call can reach: the narrowest range wins.
    const warm = [];
    let lo = 0, hi = Infinity;
    for (const item of this.rooms()) {
      const caps = this.caps(item);
      if (!caps || !caps.temp || !this.lit(item)) continue;
      warm.push(item.entity);
      lo = Math.max(lo, caps.minK);
      hi = Math.min(hi, caps.maxK);
    }
    const rest = this.targets('dim').filter((e) => !warm.includes(e));
    const k = clampK(kelvin, { minK: lo, maxK: Number.isFinite(hi) ? hi : 6500 });
    this.expect([...warm, ...rest], true, pct);
    if (warm.length) this.call(warm, 'turn_on', { brightness_pct: pct, color_temp_kelvin: k });
    if (rest.length) this.call(rest, 'turn_on', { brightness_pct: pct });
  },

  houseColour(h, s) {
    const ids = this.targets('colour');
    if (!ids.length) return;
    this.expect(ids, true);
    this.call(ids, 'turn_on', { hs_color: [h, s] });
  },

  /* One room, one scene — from the tile or from the sheet, the same call, so
     "Evening" means one thing wherever it is asked from. */
  roomScene(item, pct, kelvin) {
    const caps = this.caps(item);
    if (!caps) return;
    this.expect([item.entity], true, pct);
    this.call(item.entity, 'turn_on', caps.temp
      ? { brightness_pct: pct, color_temp_kelvin: clampK(kelvin, caps) }
      : { brightness_pct: pct });
  },

  /* Paint the answer before it arrives. Home Assistant sends the truth over
     SSE a moment later and it wins; until then the wall has already moved,
     which is the difference between a dashboard and a form. */
  expect(ids, on, pct) {
    for (const id of ids) {
      const st = this.states[id] || (this.states[id] = { s: 'off', a: {} });
      st.s = on ? 'on' : 'off';
      if (on && pct != null) st.a = { ...st.a, brightness: Math.round(pct * 2.55) };
    }
    this.render();
  },

  /* Only the rooms that are already lit — see targets(). */
  litTargets() { return this.targets('dim'); },

  /* What one room's slider should read. A lamp that is on but has never
     reported a brightness is at full, which is what "on" means to a bulb that
     cannot dim itself down. */
  briOf(item) {
    const st = this.states[item.entity] || {};
    const b = st.a && st.a.brightness;
    return b ? Math.max(1, Math.round((b / 255) * 100)) : 100;
  },

  /* One room, dragged. The same throttle push() keeps, but per entity rather
     than for whichever room the sheet has open: nine tiles share this panel and
     one shared timer would mean the last room touched swallowed the others'
     commands. A fixed rate is right here in a way it is not for the whole
     house — one room is one command's worth of work whatever else is lit, which
     is the whole reason houseDim() has to pace itself and this does not. */
  roomDim(item, pct, now = false) {
    const id = item.entity;
    this._rooms ||= {};
    const st = (this._rooms[id] ||= { pending: null, timer: null, sentAt: 0 });
    st.pending = pct;
    const send = () => {
      st.timer = null;
      const value = st.pending;
      st.pending = null;
      if (value == null) return;
      st.sentAt = Date.now();
      // Paint the answer before it arrives, exactly as every other control in
      // this panel does; SSE corrects us a moment later either way.
      this.expect([id], true, value);
      this.call(id, 'turn_on',
        { brightness_pct: value, transition: now ? RELEASE_MS : PUSH_MS / 1000 });
    };
    if (now) { clearTimeout(st.timer); st.timer = null; return send(); }
    if (st.timer) return;                    // one is already on its way
    const since = st.sentAt ? Date.now() - st.sentAt : Infinity;
    if (since >= PUSH_MS) send();
    else st.timer = setTimeout(send, PUSH_MS - since);
  },

  /* The house dimmer, paced by what the house can actually keep up with.

     A fixed interval was the wrong shape for this. One room lit was fine; each
     further room adds its own cost to every command, so at three or four the
     work took longer than the gap between commands, they piled up behind each
     other, and the house answered seconds after the finger stopped. That is
     exactly the "fine with one room, laggy with several" this had.

     So there is no interval. There is one command in the air at a time, and
     the next is composed only once the last has landed — with whatever the
     slider says by then, which may be several steps further on. A drag over a
     lit house sends as many commands as the house can absorb and not one more,
     whether that is six or two, and the queue can never grow.

     The gap between commands is therefore not a constant but a measurement:
     however long the last one took is how long this one may take too, so the
     next is composed for that moment. A backend too old to have been asked to
     wait answers in a millisecond and measures nothing, and the estimate below
     — a room's worth of cost per room named — stands in until one lands. */
  houseGap(n) {
    if (this._houseRtt > 120) return Math.min(2500, this._houseRtt);
    return Math.max(250, n * 150);
  },

  /* The fast path: one dimming command to the bridge's whole-house zone, which
     moves every lamp that is on and leaves the dark ones dark. 0.18s whatever
     the house is doing, against 0.35s per lit room through Home Assistant — so
     with this available the slider can follow a finger across the whole house,
     and without it, it cannot. See backend/app/hue.py. */
  async houseZoneDim(pct) {
    try {
      const r = await fetch('/api/hue/house-dim', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pct }),
      });
      if (!r.ok) throw new Error();
      return true;
    } catch {
      this.zoneOk = false;             // fall back for the rest of this session
      return false;
    }
  },

  async houseDim(pct, now = false) {
    this._housePct = pct;
    if (now) this._houseFinal = true;

    /* With the bridge's zone, one command covers the house and the slider can
       stream. Throttled only to what a bridge will take from one group. */
    if (this.zoneOk) {
      if (this._zoneBusy) return;
      this._zoneBusy = true;
      try {
        let last = null;
        while (this._housePct !== last || this._houseFinal) {
          last = this._housePct;
          this._houseFinal = false;
          const ids = this.litTargets();
          if (ids.length) this.expect(ids, true, last);
          this._houseSent = last;
          if (!await this.houseZoneDim(last)) break;   // fell back mid-drag
          await new Promise((r) => setTimeout(r, 200));
        }
      } finally {
        this._zoneBusy = false;
      }
      if (this.zoneOk) return;
    }

    /* Without it: above one lit room, nothing is sent until the finger comes
       off. Measured end to end — command in, lamp's own confirmation back —
       one room takes between 0.12s and 0.54s, and that cost is *per room*, so
       four lit rooms is a couple of seconds for one change of brightness
       however the commands are paced. There is no rate at which a drag across
       four rooms keeps up with a finger; pacing only decides whether the house
       is a second behind or ten. So it does not try. */
    if (!now && this.litTargets().length > 1) return;

    if (this._housePumping) return;      // the loop below will pick this up

    this._housePumping = true;
    try {
      while (true) {
        const ids = this.litTargets();
        if (!ids.length) break;
        const target = this._housePct;
        const final = this._houseFinal;
        // Nothing to say if the house is already being told this. That also
        // makes the release safe to raise twice — `change` and the pointer
        // both do it, because with several rooms the release is the only
        // command there is and it must not depend on one event firing.
        if (target === this._houseSent) break;

        this._houseSent = target;
        this._houseFinal = false;
        this.expect(ids, true, target);

        // Glide over roughly the gap until the next command can go, so a
        // sparse stream still reads as continuous dimming.
        const gap = this.houseGap(ids.length);
        // A single jump across several rooms glides rather than snaps; a
        // stream of small steps to one room wants the short settle.
        const secs = final ? (ids.length > 1 ? 0.4 : RELEASE_MS)
          : Math.max(0.2, Math.min(1.5, gap / 1000));
        const t0 = Date.now();
        await this.call(ids, 'turn_on',
          { brightness_pct: target, transition: secs }, true);

        const took = Date.now() - t0;
        this._houseRtt = took;
        // Only ever idles when the command came back faster than the house can
        // really take; when it waited, it is already time for the next.
        const rest = gap - took;
        if (rest > 0) await new Promise((r) => setTimeout(r, rest));
        if (target === this._housePct && !this._houseFinal) break;
      }
    } finally {
      this._housePumping = false;
    }
  },

  buildHouse() {
    this.house.innerHTML = `
      <div class="hh-row">
        <span class="hh-cap">Whole house <i class="hh-lit"></i></span>
        <div class="hh-set">
          ${SCENES.map(([name, pct, k]) =>
            `<button class="hh-scene" data-pct="${pct}" data-k="${k}">${name}</button>`).join('')}
          <button class="hh-scene hh-on">All on</button>
          <button class="hh-scene hh-off">All off</button>
        </div>
      </div>
      <div class="hh-row">
        <span class="hh-cap">Colour</span>
        <div class="hh-set hh-swatches">
          ${COLOURS.map(([name, h, s]) =>
            `<button class="hh-sw" data-h="${h}" data-s="${s}" title="${name}"
                     aria-label="${name}" style="--sw:hsl(${h} ${s}% 60%)"></button>`).join('')}
        </div>
      </div>
      <div class="hh-row">
        <span class="hh-cap">Brightness <b class="hh-val">70%</b></span>
        <input class="ls-slider hh-bri" type="range" min="1" max="100" step="1" value="70">
      </div>`;

    this.house.querySelectorAll('.hh-scene').forEach((btn) => {
      btn.onclick = () => {
        /* Only the rooms that have to move. Naming a room that is already in
           the state being asked for costs the same eighty milliseconds as one
           that isn't, and does nothing with them — which on a nine-room house
           is most of the wait. */
        if (btn.classList.contains('hh-off')) {
          const on = this.rooms().filter((r) => this.lit(r)).map((r) => r.entity);
          if (!on.length) return;
          this.expect(on, false);
          this.call(on, 'turn_off');
          return;
        }
        if (btn.classList.contains('hh-on')) {
          // No brightness or warmth with it: every lamp comes back as it last
          // was, which is what "on" means to somebody walking in.
          const off = this.rooms().filter((r) => !this.lit(r)).map((r) => r.entity);
          if (!off.length) return;
          this.expect(off, true);
          this.call(off, 'turn_on');
          return;
        }
        const pct = Number(btn.dataset.pct);
        this.houseScene(pct, Number(btn.dataset.k));
        this.setHouseVal(pct);
      };
    });
    this.house.querySelectorAll('.hh-sw').forEach((sw) => {
      sw.onclick = () => this.houseColour(Number(sw.dataset.h), Number(sw.dataset.s));
    });
    const bri = this.house.querySelector('.hh-bri');
    bri.oninput = () => {
      this.house.querySelector('.hh-val').textContent = `${bri.value}%`;
      this.houseDim(Number(bri.value));
    };
    // The finger coming off. What was sent during the drag was an
    // approximation — with more than one room lit, nothing was sent at all —
    // so this is the value that was actually asked for. Both events raise it:
    // `change` does not fire when a drag ends where it began, and a pointer
    // released off the edge of the slider is still a release.
    bri.onchange = () => this.houseDim(Number(bri.value), true);
    ['pointerup', 'pointercancel'].forEach((e) =>
      bri.addEventListener(e, () => this.houseDim(Number(bri.value), true)));
  },

  /* The slider follows a scene button, but never a light's own state: ten
     rooms at different brightnesses have no single number, and a slider that
     jumps every time somebody dims one lamp is worse than one that waits. */
  /* The slider now only moves what is lit, so it has to say what that is —
     otherwise a house with everything off is a slider that does nothing, and a
     control that ignores you is indistinguishable from a broken one. */
  paintHouse() {
    const lit = this.rooms().filter((r) => this.lit(r)).length;
    const el = this.house.querySelector('.hh-lit');
    if (el) {
      const txt = !lit ? '· nothing is on — use All on first'
        : lit === 1 ? '· acts on the 1 room that is on'
        // Without the zone the slider deliberately does not follow the finger,
        // and a control that lags without explaining itself reads as broken.
        : this.zoneOk ? `· acts on the ${lit} rooms that are on`
        : `· acts on the ${lit} rooms that are on — the dimmer applies when you let go`;
      if (el.textContent !== txt) el.textContent = txt;
    }
    // The scenes, the colours and the slider all act on lit rooms now, so with
    // a dark house they have nothing to act on and should look like it. All on
    // and All off are the way out and stay lit themselves.
    for (const sel of ['.hh-scene:not(.hh-on):not(.hh-off)', '.hh-sw', '.hh-bri']) {
      this.house.querySelectorAll(sel).forEach((b) => b.classList.toggle('idle', !lit));
    }
    const on = this.house.querySelector('.hh-on');
    const off = this.house.querySelector('.hh-off');
    if (on) on.classList.toggle('idle', lit === this.rooms().length);
    if (off) off.classList.toggle('idle', !lit);
  },

  setHouseVal(pct) {
    const bri = this.house.querySelector('.hh-bri');
    if (!bri || document.activeElement === bri) return;
    bri.value = String(pct);
    this.house.querySelector('.hh-val').textContent = `${pct}%`;
  },

  /* ---------------- drawing the grid ----------------
     Two jobs kept apart, because they cost very differently. Building the
     tiles writes markup and hangs a handler on every button in it; painting
     them changes a class and a line of text.

     They used to be one, and every state Home Assistant sent rebuilt the whole
     grid. One room changing is one event and nobody noticed. A whole-house
     scene is nine lamps reporting their way through a fade — dozens of events
     in a couple of seconds — and the panel spent them all throwing away the
     buttons under your finger and building new ones. That is what made the
     whole-house controls feel broken while the per-room ones felt fine: the
     tap landed on a button that no longer existed by the time it finished. */

  render() {
    const { lights = [], climate = [] } = this.ctx.config.entities;
    if (!lights.length && !climate.length) {
      this.tiles.innerHTML = `<div class="placeholder"><span class="big">◍</span>
        Lights appear once entities.json is filled in</div>`;
      return;
    }
    // What a lamp can do arrives with its first state, so the shape of a tile
    // can change once, early. After that only the values move.
    const sig = lights.map((l) => `${l.entity || l.label}:${this.caps(l) ? 'd' : 'o'}`
      + (this.caps(l)?.colour ? 'c' : '')).join('|')
      + `|${climate.length}|${this.connected}`;
    if (sig !== this._sig) {
      this._sig = sig;
      this.buildTiles(lights, climate);
    }
    this.paint(lights, climate);
    if (this.open) this.syncSheet();
  },

  buildTiles(lights, climate) {
    this.tiles.innerHTML = `
      <div class="tiles">
        ${lights.map((item, i) => {
          const on = this.isOn(item);
          const caps = this.caps(item);
          // A tile is a container, not a button: the gear inside it is its own
          // target, and a button cannot legally hold another button.
          /* The four scenes sit in the tile itself, so setting one room is one
             tap from the grid rather than a trip through the gear. They are
             deliberately quiet — a room is still mostly its name and whether
             it is on, and forty loud buttons would be a control panel. */
          return `<div class="tile${on ? ' on' : ''}" data-t="${i}">
            <button class="tile-main" data-i="${i}">
              <span class="lbl">${this.esc(item.label)}</span>
              <span class="sub">${this.subtitle(item)}</span>
            </button>
            ${caps ? `<button class="tile-gear" data-i="${i}" title="light settings"
                              aria-label="${this.esc(item.label)} settings">⚙</button>` : ''}
            ${caps ? `<div class="tile-scenes">${SCENES.map(([name], s) =>
              `<button class="tile-scene" data-i="${i}" data-s="${s}"
                       aria-label="${this.esc(item.label)} ${name}">${name}</button>`).join('')}
            </div>` : ''}
            ${caps && caps.colour ? `<div class="tile-sws">${COLOURS.map(([name, h, s]) =>
              `<button class="tile-sw" data-i="${i}" data-h="${h}" data-s="${s}"
                       title="${name}" aria-label="${this.esc(item.label)} ${name}"
                       style="--sw:hsl(${h} ${s}% 60%)"></button>`).join('')}
            </div>` : ''}
            ${caps ? `<div class="tile-bri">
              <input class="ls-slider tile-bri-in" type="range" min="1" max="100" step="1"
                     value="${this.briOf(item)}" data-i="${i}"
                     aria-label="${this.esc(item.label)} brightness">
              <span class="tile-bri-val">${this.briOf(item)}%</span>
            </div>` : ''}
          </div>`;
        }).join('')}
        ${climate.map((c) => this.reading(c)).join('')}
      </div>
      ${this.connected ? '' :
        '<p class="ha-note">Home Assistant unreachable — showing the last known states</p>'}`;
    this.tiles.classList.toggle('ha-stale', !this.connected);

    this.tiles.querySelectorAll('button.tile-main').forEach((btn) => {
      const item = lights[Number(btn.dataset.i)];
      btn.onclick = () => {
        // Optimistic: SSE corrects us a moment later either way. An action tile
        // ("All off") moves every room it names, not just its own colour.
        if (item.entities) this.expect(item.entities, (item.service || 'toggle') !== 'turn_off');
        else btn.parentElement.classList.toggle('on');
        this.call(item.entities || item.entity, item.service || 'toggle');
      };
    });
    this.tiles.querySelectorAll('button.tile-gear').forEach((btn) => {
      btn.onclick = () => this.openSheet(lights[Number(btn.dataset.i)]);
    });
    this.tiles.querySelectorAll('button.tile-scene').forEach((btn) => {
      btn.onclick = () => {
        const [, pct, k] = SCENES[Number(btn.dataset.s)];
        this.roomScene(lights[Number(btn.dataset.i)], pct, k);
      };
    });
    /* A colour is one tap from the grid now, not a trip through the gear. The
       gear keeps the sliders — a swatch is a decision, a slider is a fiddle. */
    this.tiles.querySelectorAll('button.tile-sw').forEach((sw) => {
      sw.onclick = () => {
        const item = lights[Number(sw.dataset.i)];
        this.expect([item.entity], true);
        this.call(item.entity, 'turn_on',
          { hs_color: [Number(sw.dataset.h), Number(sw.dataset.s)] });
      };
    });
    /* One room's brightness, on the tile itself. The house has had a dimmer
       along the bottom since the beginning and every room has had one behind
       its gear; what was missing was the obvious one — the room you are
       standing in, on the tile with its name on it, without a trip through a
       sheet to turn the kitchen down while something is in the oven.
       `_dragId` is what keeps the state arriving over SSE from yanking the
       slider out from under the finger holding it; see paint(). */
    this.tiles.querySelectorAll('input.tile-bri-in').forEach((sl) => {
      const item = lights[Number(sl.dataset.i)];
      const val = sl.parentElement.querySelector('.tile-bri-val');
      sl.oninput = () => {
        this._dragId = item.entity;
        val.textContent = `${sl.value}%`;
        this.roomDim(item, Number(sl.value));
      };
      // The finger coming off is the value actually asked for — and both
      // events raise it, because `change` does not fire when a drag ends where
      // it began, and a pointer released off the edge is still a release.
      const done = () => { this._dragId = null; this.roomDim(item, Number(sl.value), true); };
      sl.onchange = done;
      ['pointerup', 'pointercancel'].forEach((e) => sl.addEventListener(e, done));
    });
  },

  /* Values only: no markup is written and no handler is replaced, so this can
     run as often as Home Assistant likes without ever moving a target. */
  paint(lights, climate) {
    for (const el of this.tiles.querySelectorAll('.tile')) {
      const item = lights[Number(el.dataset.t)];
      if (!item) continue;
      el.classList.toggle('on', this.isOn(item));
      const sub = el.querySelector('.sub');
      const txt = this.subtitle(item);
      if (sub && sub.textContent !== txt) sub.textContent = txt;
      /* The room's own slider follows the lamp — somebody may have moved it in
         the Hue app — but never while a finger is on this one. A whole-house
         scene is nine lamps reporting their way through a fade, which without
         this would drag the handle out from under a hand mid-adjustment. */
      const sl = el.querySelector('.tile-bri-in');
      if (sl && this._dragId !== item.entity && document.activeElement !== sl) {
        const pct = this.briOf(item);
        if (Number(sl.value) !== pct) {
          sl.value = String(pct);
          const val = el.querySelector('.tile-bri-val');
          if (val) val.textContent = `${pct}%`;
        }
      }
    }
    const cards = this.tiles.querySelectorAll('.reading');
    climate.forEach((c, i) => {
      const card = cards[i];
      if (!card) return;
      for (const [sel, txt] of [['.val', this.readingValue(c)], ['.cap', this.readingCap(c)]]) {
        const el = card.querySelector(sel);
        if (el && el.textContent !== txt) el.textContent = txt;
      }
    });
    this.paintHouse();
  },

  /* ---------------- the light settings sheet ----------------
     A fixed overlay rather than something inside the panel: these are sliders
     dragged with a fingertip, and the panel is not always big enough to give
     them a target worth aiming at. */

  buildSheet() {
    const el = document.createElement('div');
    el.id = 'light-sheet';
    el.innerHTML = `
      <header>
        <h2 class="ls-name"></h2>
        <span class="spacer"></span>
        <button class="ls-close">Close</button>
      </header>
      <div class="ls-body">
        <div class="ls-row ls-power">
          <span class="ls-label">Power</span>
          <div class="ls-set">
            <button class="ls-btn ls-on">On</button>
            <button class="ls-btn ls-off">Off</button>
          </div>
        </div>
        <div class="ls-row ls-scenes">
          <span class="ls-label">Scenes</span>
          <div class="ls-set">
            ${SCENES.map(([name, pct, k]) =>
              `<button class="ls-btn ls-scene" data-pct="${pct}" data-k="${k}">${name}</button>`).join('')}
          </div>
        </div>
        <div class="ls-row ls-dim">
          <span class="ls-label">Brightness <b class="ls-bri-val"></b></span>
          <input class="ls-slider ls-bri" type="range" min="1" max="100" step="1">
        </div>
        <div class="ls-row ls-temp">
          <span class="ls-label">Warmth <b class="ls-temp-val"></b></span>
          <input class="ls-slider ls-kelvin" type="range" step="50">
        </div>
        <!-- The swatches and the wheel are one row, side by side. On its own
             row underneath, the wheel pushed the sheet past the height of the
             screen and became a control you had to scroll to reach — on a wall
             with no scrollbar to speak of and wet hands, that is a control
             that is not there. Beside them it costs no height at all: the
             right-hand half of this row was empty. -->
        <div class="ls-row ls-colour">
          <span class="ls-label">Colour <b class="ls-wheel-val"></b></span>
          <div class="ls-colour-set">
            <div class="ls-swatches"></div>
            <div class="ls-wheel" role="slider" tabindex="0"
                 aria-label="pick a colour: hue around, strength outwards">
              <span class="ls-wheel-dot"></span>
            </div>
          </div>
        </div>
      </div>`;
    document.body.appendChild(el);
    this.sheet = el;
    el.querySelector('.ls-close').onclick = () => this.closeSheet();

    el.querySelector('.ls-on').onclick = () => this.call(this.open, 'turn_on');
    el.querySelector('.ls-off').onclick = () => this.call(this.open, 'turn_off');

    const bri = el.querySelector('.ls-bri');
    bri.oninput = () => {
      el.querySelector('.ls-bri-val').textContent = `${bri.value}%`;
      this.push({ brightness_pct: Number(bri.value) });
    };
    bri.onchange = () => this.push({ brightness_pct: Number(bri.value) }, true);
    const kel = el.querySelector('.ls-kelvin');
    kel.oninput = () => {
      el.querySelector('.ls-temp-val').textContent = `${kel.value}K`;
      this.push({ color_temp_kelvin: Number(kel.value) });
    };
    kel.onchange = () => this.push({ color_temp_kelvin: Number(kel.value) }, true);

    /* The same four scenes as the whole house, so "Evening" means one thing in
       this kitchen whether it is asked of one room or of all of them. A room
       with no warmth control still gets the brightness half. */
    el.querySelectorAll('.ls-scene').forEach((btn) => {
      btn.onclick = () => {
        const caps = this.caps(this.sheetItem) || {};
        const pct = Number(btn.dataset.pct);
        const k = clampK(Number(btn.dataset.k), caps);
        this.roomScene(this.sheetItem, pct, Number(btn.dataset.k));
        const bri = el.querySelector('.ls-bri');
        bri.value = String(pct);
        el.querySelector('.ls-bri-val').textContent = `${pct}%`;
        if (caps.temp) {
          el.querySelector('.ls-kelvin').value = String(k);
          el.querySelector('.ls-temp-val').textContent = `${k}K`;
        }
      };
    });

    el.querySelector('.ls-swatches').innerHTML = COLOURS.map(([name, h, s]) =>
      `<button class="ls-sw" data-h="${h}" data-s="${s}" title="${name}"
               style="--sw:hsl(${h} ${s}% 60%)"></button>`).join('');
    el.querySelectorAll('.ls-sw').forEach((sw) => {
      sw.onclick = () => this.push(
        { hs_color: [Number(sw.dataset.h), Number(sw.dataset.s)] }, true);
    });
    this.wireWheel(el.querySelector('.ls-wheel'));
  },

  /* ---------------- the colour wheel ----------------
     The nine swatches are the decisions; this is the fiddle, and both belong
     in the sheet for the same reason the brightness slider does. Hue runs
     around it and strength outwards, so the middle is white and the rim is as
     saturated as the lamp can manage — which is the shape of the thing being
     chosen rather than two sliders somebody has to combine in their head.

     One finger, dragged: pointer capture, so a hand that slides off the disc
     mid-choice keeps setting the colour instead of dropping it. Throttled
     through the same push() the sliders use — a bridge takes about ten
     commands a second to one lamp, and a drag would otherwise send hundreds. */
  wheelAt(el, ev) {
    const r = el.getBoundingClientRect();
    const radius = r.width / 2;
    const dx = ev.clientX - (r.left + radius);
    const dy = ev.clientY - (r.top + radius);
    // Measured from the top, clockwise — the same direction and origin the
    // conic gradient behind it is painted in, or the colour under the finger
    // would not be the colour that arrives.
    const hue = Math.round((Math.atan2(dx, -dy) * 180 / Math.PI + 360) % 360);
    const sat = Math.round(Math.min(1, Math.hypot(dx, dy) / radius) * 100);
    return [hue, sat];
  },

  paintWheel(hue, sat) {
    const el = this.sheet?.querySelector('.ls-wheel');
    if (!el) return;
    const dot = el.querySelector('.ls-wheel-dot');
    const th = (hue * Math.PI) / 180;
    const d = (sat / 100) * 50;
    dot.style.left = `${50 + Math.sin(th) * d}%`;
    dot.style.top = `${50 - Math.cos(th) * d}%`;
    dot.style.background = `hsl(${hue} ${sat}% 55%)`;
    const val = this.sheet.querySelector('.ls-wheel-val');
    if (val) val.textContent = sat < 4 ? 'white' : `${hue}° · ${sat}%`;
  },

  wireWheel(el) {
    if (!el) return;
    const move = (ev) => {
      const [hue, sat] = this.wheelAt(el, ev);
      this.paintWheel(hue, sat);
      this.push({ hs_color: [hue, sat] });
    };
    el.addEventListener('pointerdown', (ev) => {
      ev.preventDefault();
      // Capture is what keeps a hand that slides off the disc mid-choice still
      // choosing. It throws for a pointer the browser does not own, and an
      // exception here would take the colour with it — the drag matters more
      // than the capture, so the capture is the part allowed to fail.
      try { el.setPointerCapture(ev.pointerId); } catch { /* drag on without it */ }
      el.dataset.drag = '1';
      move(ev);
    });
    el.addEventListener('pointermove', (ev) => { if (el.dataset.drag) move(ev); });
    const end = (ev) => {
      if (!el.dataset.drag) return;
      delete el.dataset.drag;
      const [hue, sat] = this.wheelAt(el, ev);
      this.paintWheel(hue, sat);
      // The last word, sent at once rather than waiting on the throttle.
      this.push({ hs_color: [hue, sat] }, true);
    };
    el.addEventListener('pointerup', end);
    el.addEventListener('pointercancel', end);
  },

  /* A slider dragged across its range fires a call per pixel; Home Assistant
     and the Hue bridge behind it both hate that. So: at most one call every
     PUSH_MS, and always the newest value.

     This has to be a throttle and not a debounce, which is what it was: every
     `input` event cleared the queued call and set a fresh timer PUSH_MS into
     the future, so a finger that kept moving kept pushing the deadline out and
     nothing was sent until it stopped. The room went on looking exactly as it
     had all the way through the drag, then jumped once — the lag people
     reported on dimming but never on scenes, which are one tap and go straight
     out. A queued call is now left alone to fire on time; it reads `_pending`
     when it does, so it always carries the latest value anyway. */
  push(data, now = false) {
    this._pending = { ...this._pending, ...data };
    const send = () => {
      this._pushTimer = null;
      const payload = this._pending;
      this._pending = null;
      if (!payload) return;
      // A slider dragged back to where it already was, or a finger resting
      // mid-drag, must not spend a command saying nothing.
      const sig = JSON.stringify(payload) + String(this.open);
      if (sig === this._lastSig && !now) return;
      this._lastSig = sig;
      this._sentAt = Date.now();
      this.call(this.open, 'turn_on',
        { ...payload, transition: now ? RELEASE_MS : PUSH_MS / 1000 });
    };
    if (now) {
      clearTimeout(this._pushTimer);
      return send();
    }
    if (this._pushTimer) return;              // one is already on its way
    const since = this._sentAt ? Date.now() - this._sentAt : Infinity;
    if (since >= PUSH_MS) send();
    else this._pushTimer = setTimeout(send, PUSH_MS - since);
  },

  openSheet(item) {
    this.open = item.entity;
    this.sheetItem = item;
    this.sheet.querySelector('.ls-name').textContent = item.label;
    this.syncSheet(true);
    this.sheet.classList.add('open');
  },

  closeSheet() {
    this.open = null;
    this.sheet.classList.remove('open');
  },

  /* Follow the light's real state — someone may flip it in the Hue app — but
     never yank a slider out from under a finger that is still on it. */
  syncSheet(force = false) {
    const item = this.sheetItem;
    if (!item) return;
    const caps = this.caps(item) || { temp: false, colour: false, minK: 2200, maxK: 6500 };
    const st = this.states[item.entity] || {};
    const a = st.a || {};
    const el = this.sheet;

    el.querySelector('.ls-temp').hidden = !caps.temp;
    // The wheel lives inside this row, so hiding it for a lamp with no colour
    // takes the wheel with it — one rule, not two that can disagree.
    el.querySelector('.ls-colour').hidden = !caps.colour;
    // Where the lamp actually is, so the dot is on the colour in the room
    // rather than wherever it was last dragged to. A lamp on white reports no
    // hue at all, which is the middle of the wheel and not an absence.
    if (caps.colour && !el.querySelector('.ls-wheel')?.dataset.drag) {
      const hs = a.hs_color;
      this.paintWheel(Array.isArray(hs) ? Math.round(hs[0]) : 0,
                      Array.isArray(hs) ? Math.round(hs[1]) : 0);
    }
    el.querySelector('.ls-on').classList.toggle('on', st.s === 'on');
    el.querySelector('.ls-off').classList.toggle('on', st.s !== 'on');

    const bri = el.querySelector('.ls-bri');
    if (force || document.activeElement !== bri) {
      const pct = a.brightness ? Math.round((a.brightness / 255) * 100) : 100;
      bri.value = String(pct);
      el.querySelector('.ls-bri-val').textContent = `${pct}%`;
    }
    const kel = el.querySelector('.ls-kelvin');
    kel.min = String(caps.minK);
    kel.max = String(caps.maxK);
    if (force || document.activeElement !== kel) {
      const k = a.color_temp_kelvin || Math.round((caps.minK + caps.maxK) / 2);
      kel.value = String(k);
      el.querySelector('.ls-temp-val').textContent = `${k}K`;
    }
  },
};
