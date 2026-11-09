// House: room light tiles, whole-house scenes and dimming under them, a
// settings sheet per room, and a link to the service index.
//
// States arrive over SSE; taps go through the backend's allowlisted
// /api/ha/call. Home Assistant being down greys only this panel.
//
// The shell is built once and only the tile grid is re-rendered, because
// states arrive continuously and rebuilding the whole body would throw away
// the whole-house slider under a finger several times a minute.
//
// Three tabs in the header (2026-10-11): Lights 1, the rooms and the whole
// house; Lights 2, the rooms that are hardly ever tapped (`tab: "more"` in
// entities.json); and Automation, everything that is not a light — the flower
// plugs' hours, Find my phone and the doorbell, the routines, and the alerts,
// how Needs attention shows each kind among them.

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

/* How long a colour just chosen on the wheel outranks the state coming back.
   Long enough to cover the bridge and a mixed group's disagreement, short
   enough that a lamp somebody changed elsewhere is not misreported for long. */
const WHEEL_HOLD_MS = 8000;
// Strength under this on the colour wheel reads as white, in words and rings.
const WHITE_SAT = 10;

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

/* The tabs, words rather than icons — the header's convention for anything
   that is not a setting. Until 2026-10-11 the first two were Lights and More;
   More was a room's tab with the phone box and the rest at its foot. AI
   since 2026-10-19 (Alex: "a new tab in the House tab for generating Video,
   LLM, Music, Image, transcription with AI"): tunai.js draws its pane.
   Vacuum Cleaner since 2026-10-20 ("next to AI tab"): Siri's map, room by
   room, drawn by vacuum.js; only there when entities.json has a robot. */
const TABS = [['lights', 'Lights 1'], ['more', 'Lights 2'], ['auto', 'Automation'], ['tunai', 'AI'],
  ['vacuum', 'Vacuum Cleaner']];

/* How long Lights 2 or Automation stays up with nobody touching the panel.
   The six rooms of Lights 1 are what this panel is for; the others are
   somewhere you go to switch the hall light off or set something, and come
   back from, and the next person to walk up to the wall should find the
   kitchen, not the cupboard somebody left open at lunchtime. */
const TAB_BACK_MIN = 10;

/* The tab House opens on, and comes back to. Lights 1 until 2026-10-18, when
   Alex asked for Automation — the routines and the diffuser are what he goes
   to House for. */
const HOME_TAB = 'auto';

/* How long the answer to a Pause or Resume tapped in a room's settings stands
   in for the ladder's summary line there — the same six seconds the ladder's
   own sheet keeps its note up. */
const SCHED_SAID_MS = 6000;

/* What a ring does, said once under the row rather than twice on every card:
   two phones each repeating three lines of explanation would be most of the
   row. The server's own constant is the two minutes (phone.py RING_S); this
   is only the sentence. */
const PHONE_HOW = 'Rings at full alarm volume, even on silent — <b>Found it</b> on the phone, '
  + '<b>Stop</b> here, or after 2 minutes. Away from home? google.com/android/find';

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
       in the corner under the countdown, and this panel is the house's own
       controls: the rooms, the flowers and the whole house on Lights 1, the
       rooms marked `tab: "more"` on Lights 2, and the rest on Automation.

       The flowers sit directly under the rooms because they ARE rooms as far
       as the eye reading this panel is concerned — more lights on the same
       width, which is why they line up with them. On 2026-10-11 they went to
       Automation with everything that is not a light, and came back the same
       evening at Alex's word. The phones and the doorbell stayed there, with
       the routines and the alerts (buildAuto). */
    body.innerHTML = `
      <div class="ha-tiles"></div>
      <div class="ha-flowers"></div>
      <div class="ha-house"></div>
      <div class="ha-more" hidden></div>
      <div class="ha-auto" hidden>
        <div class="ha-phones"></div>
      </div>
      <div class="ha-tunai" hidden></div>
      <div class="ha-vacuum" hidden></div>`;

    this.tiles = body.querySelector('.ha-tiles');
    this.phonesEl = body.querySelector('.ha-phones');
    this.flowers = body.querySelector('.ha-flowers');
    this.house = body.querySelector('.ha-house');
    this.more = body.querySelector('.ha-more');
    this.auto = body.querySelector('.ha-auto');
    this.tunaiEl = body.querySelector('.ha-tunai');
    this.tunai = ctx.tunai;
    this.tunai?.init(ctx);
    this.vacuumEl = body.querySelector('.ha-vacuum');
    this.vacuum = ctx.vacuum;
    this.vacuum?.init(ctx);
    this.flowerDoc = null;

    this.buildFlowers();
    this.buildHouse();
    this.buildSheet();
    this.buildPhones();
    this.buildAuto();
    this.render();
    this.buildTabs(body);
    // A sensor moved (sensors.py): app.js has the new list in the config
    // already, and the cards carrying a reading are redrawn from it.
    ctx.bus.on('sensors', () => this.render());
    ctx.bus.on('ha_states', (states) => {
      this.states = states;
      this.render();
      this.paintPhones();
    });
    ctx.bus.on('ha_connected', (ok) => {
      this.connected = ok;
      this.render();
      this.paintPhones();
    });
    /* Rebuilt only when the schedule itself changes, which is a tap every few
       weeks — never on a state event. The plugs' on/off arrives with every
       other entity over ha_states and is painted in place, for exactly the
       reason the tile grid is; see the note above render(). */
    ctx.bus.on('flowers', (doc) => { this.flowerDoc = doc; this.buildFlowers(); });
    /* A room whose ladder is paused carries a mark on its tile and says so
       in its settings. After a microtask: the ladder's own module keeps the
       document and subscribes after this panel does, so reading it at once
       would read the one before. */
    ctx.bus.on('lights_schedule', () => queueMicrotask(() => {
      this.paint();
      if (this.open) this.syncSheet();
    }));

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

  /* The lamps a command for this room goes to.

     A room is usually one entity — a Hue room group, which is already every
     bulb in it. Big WC is the exception the household has: one room, two
     IKEA bulbs on Zigbee2MQTT with no group behind them (the shower one and
     the one over the tap). Listing both here makes it one room to everything
     that works a room at a time — one tile, one slider, one rung of the
     evening ladder — without a group having to exist in Home Assistant.

     `entity` stays the one whose *state* is read: what the tile says it is at,
     and what its capabilities are. Two identical bulbs switched together
     always agree, and the alternative is reconciling two answers to "what
     brightness is this room". Commands go to all of them. */
  bulbs(item) {
    return item.entities && item.entities.length ? item.entities : [item.entity];
  },

  isOn(item) {
    return (item.entities || [item.entity])
      .some((e) => this.states[e] && this.states[e].s === 'on');
  },

  /* What a room can actually do, read off the state Home Assistant already
     sends us. A gear on a plug that can only be on or off would be a button
     that opens an empty box. */
  caps(item) {
    // An action tile ("All off") is entities with no entity of its own, and
    // has nothing to set. A room that happens to be several bulbs has both,
    // and is as dimmable as any other room.
    if (!item.entity) return null;
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
    // "3 rooms" belongs to an action tile, which is a button over several
    // rooms and has no state of its own. A room that is several bulbs does
    // have one, and saying "2 rooms" on the Big WC named it wrongly twice:
    // it is one room, and what the line is for is whether it is lit.
    if (item.entities && !item.entity) return `${item.entities.length} rooms`;
    const st = this.states[item.entity];
    if (!st) return '—';
    if (st.s !== 'on') return 'off';
    const b = st.a && st.a.brightness;
    return b ? `on · ${Math.round((b / 255) * 100)}%` : 'on';
  },

  /* Split so paint() can refresh the numbers without rewriting the card. */
  _ok(s) { return s && s.s != null && s.s !== 'unavailable' && s.s !== 'unknown'; },

  /* ---------------- the room's own reading ----------------
     A temperature and a humidity printed on the light card of the room they
     were measured in, because that card already has the room's name on it and
     a second card saying "Kitchen 23.0°" beside one saying "Kitchen" would be
     two cards for one room. Which sensor belongs to which card is `tile` in
     the climate list — since 2026-10-21 sensors.py's, where a sensor is put on
     Automation's Sensors card — and a sensor with no room simply has no card
     to sit on, and shows in the top bar like the rest.

     Printed, not tappable: the card it is on is the light switch, and a
     button inside a button is not legal markup besides. The chart is one tap
     away on the top bar, which is on screen in every view.

     The formatting comes from climate.js through the context rather than
     being repeated here; the wall must not round the kitchen two ways. */
  climateFor(item) {
    if (!item.entity) return null;
    return (this.ctx.config.entities.climate || [])
      .find((c) => c && c.tile === item.entity) || null;
  },

  climateText(item) {
    const c = this.climateFor(item);
    if (!c) return '';
    // This panel's own states, not climate.js's: see reading() there.
    const v = this.ctx.climate?.reading(c, this.states);
    // Only what the room has: a smoke alarm's room has a temperature alone.
    return v && v.ok ? [v.temp != null && v.tempText, v.hum != null && v.humText]
      .filter(Boolean).join(' · ') : '';
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

  /* ---------------- the flowers ----------------
     The Tuya plugs under the plants: one button per group, and the two hours
     the group keeps to by itself. They sit between the rooms and the whole
     house because that is what they are — not a tenth room, since a plug has
     no brightness, no warmth and no colour and a tile of one would be four
     fifths empty, but not a house-wide control either.

     A group is one or two sockets and always switches together: the two plugs
     behind Alex's flowers are one thing to whoever is tapping, and the pair
     being two rows on the wall would only ever be two taps for one intention.

     The hours go through the backend rather than being kept here. A wall that
     is asleep, or a browser that is showing the photographs, must still get
     the flowers on at eight — a timer in this file would only run while
     somebody was looking at this panel. */

  flowerState(g) {
    // On if ANY of the group's plugs is on, which is what the row is claiming
    // when it says "on": something under those plants is lit.
    return (g.entities || []).some((e) => this.states[e] && this.states[e].s === 'on');
  },

  async flowerSet(g, on) {
    // Paint first — SSE brings the truth back a moment later, exactly as the
    // light tiles do. Tuya goes out over the internet and back, so this one is
    // slower than a lamp and the wait would be the whole interaction.
    for (const e of g.entities) {
      const st = this.states[e] || (this.states[e] = { s: 'off', a: {} });
      st.s = on ? 'on' : 'off';
    }
    this.paintFlowers();
    try {
      const r = await fetch('/api/flowers/set', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: g.id, on }),
      });
      if (!r.ok) throw new Error();
    } catch {
      // Put it back rather than leave the wall asserting something that never
      // happened; the plugs are on the far side of a cloud and do refuse.
      for (const e of g.entities) {
        const st = this.states[e];
        if (st) st.s = on ? 'off' : 'on';
      }
      this.paintFlowers();
    }
  },

  /* One tap sets an hour, tapping the lit one again clears it. There is no
     separate "off" switch for the timer because an hour nobody has chosen is
     already that, and a third state to explain would be worse than the two. */
  async flowerHour(g, key, hour) {
    const cur = g[key];
    const val = cur === hour ? null : hour;
    g[key] = val;                       // the answer is on the wall at once
    this.buildFlowers();
    try {
      const r = await fetch('/api/flowers/schedule', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: g.id, [key]: val }),
      });
      if (!r.ok) throw new Error();
    } catch {
      g[key] = cur;
      this.buildFlowers();
    }
  },

  /* Just what the plugs are doing. This used to carry the schedule as well —
     "on · 08→22" — because with the two rows of hours stacked under the name
     there was no way to read one against the other. Side by side as a block
     they say it themselves, two lit buttons one above the other, and repeating
     it in words only took width off the name. */
  flowerSub(g) {
    return this.flowerState(g) ? 'on' : 'off';
  },

  buildFlowers() {
    const doc = this.flowerDoc;
    const gs = (doc && doc.groups) || [];
    if (!gs.length) { this.flowers.innerHTML = ''; return; }
    const onH = (doc.on_hours || []);
    const offH = (doc.off_hours || []);
    const pad = (h) => String(h).padStart(2, '0');

    // One row however many groups there are: a wrapped card would cost the
    // House panel a row of height it does not have.
    this.flowers.style.setProperty('--fl-n', gs.length);
    this.flowers.classList.toggle('many', gs.length > 3);
    this.flowers.innerHTML = gs.map((g, i) => `
      <div class="fl${this.flowerState(g) ? ' on' : ''}" data-f="${i}">
        <button class="fl-main" data-i="${i}"
                aria-label="${this.esc(g.label)} flowers on or off">
          <span class="fl-emoji" aria-hidden="true">${this.esc(g.emoji)}</span>
          <span class="fl-txt">
            <span class="lbl">${this.esc(g.label)} flowers</span>
            <span class="sub">${this.esc(this.flowerSub(g))}</span>
          </span>
        </button>
        <div class="fl-times">
          ${[['on_h', onH, 'On'], ['off_h', offH, 'Off']].map(([key, hours, cap]) => `
            <div class="fl-when">
              <span class="fl-cap">${cap}</span>
              ${hours.map((h) => `
                <button class="fl-h${g[key] === h ? ' on' : ''}" data-i="${i}"
                        data-k="${key}" data-h="${h}"
                        aria-pressed="${g[key] === h}"
                        aria-label="${this.esc(g.label)} ${cap.toLowerCase()} at ${pad(h)}:00">
                  ${pad(h)}</button>`).join('')}
            </div>`).join('')}
        </div>
      </div>`).join('');

    this.flowers.querySelectorAll('button.fl-main').forEach((btn) => {
      const g = gs[Number(btn.dataset.i)];
      btn.onclick = () => this.flowerSet(g, !this.flowerState(g));
    });
    this.flowers.querySelectorAll('button.fl-h').forEach((btn) => {
      const g = gs[Number(btn.dataset.i)];
      btn.onclick = () => this.flowerHour(g, btn.dataset.k, Number(btn.dataset.h));
    });
  },

  /* Values only, like paint(): no markup written and no handler replaced, so
     it is safe to run on every state Home Assistant sends. */
  paintFlowers() {
    const gs = (this.flowerDoc && this.flowerDoc.groups) || [];
    for (const el of this.flowers.querySelectorAll('.fl')) {
      const g = gs[Number(el.dataset.f)];
      if (!g) continue;
      el.classList.toggle('on', this.flowerState(g));
      const sub = el.querySelector('.sub');
      const txt = this.flowerSub(g);
      if (sub && sub.textContent !== txt) sub.textContent = txt;
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

     Four of the rooms here are unreachable lamps besides (Bath, Entrance,
     Guest room, Storage are IKEA bulbs that are dead at the wall), and they are off,
     so this drops them too. */
  targets(kind) {
    const out = [];
    for (const item of this.rooms()) {
      const caps = this.caps(item);
      if (!caps) continue;                        // on/off only — nothing to set
      if (!this.lit(item)) continue;              // dark rooms stay dark
      if (kind === 'colour' && !caps.colour) continue;
      if (kind === 'temp' && !caps.temp) continue;
      out.push(...this.bulbs(item));
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
      warm.push(...this.bulbs(item));
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
    const ids = this.bulbs(item);
    this.expect(ids, true, pct);
    this.call(ids, 'turn_on', caps.temp
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
    // Throttled per room, sent to every bulb in it: the key is the room's
    // own entity so two bulbs share one timer rather than racing each other.
    const id = item.entity;
    const ids = this.bulbs(item);
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
      this.expect(ids, true, value);
      this.call(ids, 'turn_on',
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
        <!-- The evening ladder, behind a gear like every other set of
             settings on this wall. It belongs on this row because it is the
             same idea as the buttons beside it — how bright the house is —
             only decided by the clock rather than by a finger. Its own class
             rather than .hh-scene: paintHouse() dims the scenes when nothing
             is lit, and a ladder you cannot open because the house is dark
             would be exactly the wrong time to lock it. -->
        <!-- The whole house's pause, the same toggle as each room's: every
             room is left to its switch and Home Assistant until it is
             tapped again. Beside the gear because it is the ladder's. -->
        <button class="hh-pause" aria-pressed="false"
                title="pause the evening ladder in every room"><b>⏸</b><span>Pause all</span></button>
        <button class="hh-gear" title="evening dimming — the ladder through the day"
                aria-label="evening dimming settings">⚙</button>
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

    this.house.querySelector('.hh-gear').onclick = () => this.ctx.lightsched?.open(null);
    this.house.querySelector('.hh-pause').onclick = async (ev) => {
      const b = ev.currentTarget;
      const sched = this.ctx.lightsched;
      if (!sched || b.disabled) return;
      const on = !!sched.pausedSince('__house__');
      b.disabled = true;
      b.classList.toggle('on', !on);
      await sched.setPause('__house__', !on);
      b.disabled = false;
      this.paint();
    };

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
    const hp = this.house.querySelector('.hh-pause');
    const sched = this.ctx.lightsched;
    if (hp) {
      hp.hidden = !sched;
      if (sched && !hp.disabled) {
        const since = sched.pausedSince('__house__');
        hp.classList.toggle('on', !!since);
        hp.setAttribute('aria-pressed', String(!!since));
        const txt = since ? 'All paused' : 'Pause all';
        const sp = hp.querySelector('span');
        if (sp.textContent !== txt) sp.textContent = txt;
        hp.title = since ? `the evening ladder is paused in every room since ${sched.sinceText(since)} — tap to resume it`
          : 'pause the evening ladder in every room';
      }
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

  /* Which tab a room's tile is drawn on. Anything not marked lives on Lights,
     so a room added to entities.json without a thought for tabs appears where
     the household expects it. Only the drawing is split: rooms() — and with it
     the whole-house row and everything it acts on — is still every room. */
  roomsOn(tab) {
    return (this.ctx.config.entities.lights || [])
      .filter((l) => (l.tab === 'more' ? 'more' : 'lights') === tab);
  },

  render() {
    const { lights = [] } = this.ctx.config.entities;
    if (!lights.length) {
      this.tiles.innerHTML = `<div class="placeholder"><span class="big">◍</span>
        Lights appear once entities.json is filled in</div>`;
      return;
    }
    // What a lamp can do arrives with its first state, so the shape of a tile
    // can change once, early. After that only the values move. Both grids are
    // in the one signature: they are built from the same config and a room
    // moving between the tabs is a change to both.
    const sig = lights.map((l) => `${l.entity || l.label}:${l.tab === 'more' ? 'm' : 'l'}`
      + `${this.caps(l) ? 'd' : 'o'}${this.caps(l)?.colour ? 'c' : ''}`
      + `${this.climateFor(l) ? 's' : ''}`).join('|')
      + `|${this.connected}`;
    if (sig !== this._sig) {
      this._sig = sig;
      const onLights = this.roomsOn('lights');
      const onMore = this.roomsOn('more');
      // Which rooms are drawn in which scroller, for paint() to follow.
      this.grids = [[this.tiles, onLights], [this.more, onMore]];
      // Each room's reading goes on that room's own tile, so both tabs carry
      // whichever of them their rooms have.
      this.buildTiles(this.tiles, onLights);
      this.buildTiles(this.more, onMore);
    }
    this.paint();
    if (this.open) this.syncSheet();
  },

  /* One grid, drawn into whichever scroller it belongs to — `.ha-tiles` for
     Lights, `.ha-more` for More. Same markup and the same handlers either
     way: a room is a room, and the tab it is on is a line in the config, not
     a different kind of tile. Each scroller carries its own list, so a tile's
     data-i is an index into that list and nothing else. */
  buildTiles(root, lights) {
    if (!root) return;
    root.innerHTML = `
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
              <span class="tile-txt">
                <span class="lbl">${this.esc(item.label)}<span class="tile-pause"
                      title="the evening ladder is paused here" hidden> ⏸</span></span>
                <span class="sub">${this.subtitle(item)}</span>
              </span>
              ${this.climateFor(item)
                ? `<span class="tile-clim">${this.esc(this.climateText(item))}</span>` : ''}
              ${item.emoji ? `<span class="tile-emoji" aria-hidden="true"
                                    >${this.esc(item.emoji)}</span>` : ''}
            </button>
            ${caps ? `<div class="tile-side">
              <button class="tile-gear" data-i="${i}" title="light settings"
                      aria-label="${this.esc(item.label)} settings">⚙</button>
              ${item.entity ? `<button class="tile-pz" data-i="${i}" hidden aria-pressed="false"
                      aria-label="${this.esc(item.label)}: pause the evening ladder"
                      ><b>⏸</b><small>Pause</small></button>` : ''}
            </div>` : ''}
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
      </div>
      ${this.connected ? '' :
        '<p class="ha-note">Home Assistant unreachable — showing the last known states</p>'}`;
    root.classList.toggle('ha-stale', !this.connected);

    root.querySelectorAll('button.tile-main').forEach((btn) => {
      const item = lights[Number(btn.dataset.i)];
      btn.onclick = () => {
        // Optimistic: SSE corrects us a moment later either way. An action tile
        // ("All off") moves every room it names, not just its own colour.
        if (item.entities) this.expect(item.entities, (item.service || 'toggle') !== 'turn_off');
        else btn.parentElement.classList.toggle('on');
        this.call(item.entities || item.entity, item.service || 'toggle');
      };
    });
    root.querySelectorAll('button.tile-gear').forEach((btn) => {
      btn.onclick = () => this.openSheet(lights[Number(btn.dataset.i)]);
    });
    /* The ladder's pause, beside the gear: a toggle, lit amber while this
       room is left to its switch and Home Assistant. Held by somebody else's
       pause — the whole house's, or the room a lamp is part of — it shows
       whose and does nothing here: that pause comes off where it was put. */
    root.querySelectorAll('button.tile-pz').forEach((btn) => {
      btn.onclick = async () => {
        const sched = this.ctx.lightsched;
        const item = lights[Number(btn.dataset.i)];
        if (!sched || !item || btn.disabled || btn.classList.contains('held')) return;
        const own = sched.pausedBy(item.entity) === item.entity;
        btn.disabled = true;
        btn.classList.toggle('on', !own);            // at once; the answer corrects it
        await sched.setPause(item.entity, !own);
        btn.disabled = false;
        this.paint();
      };
    });
    root.querySelectorAll('button.tile-scene').forEach((btn) => {
      btn.onclick = () => {
        const [, pct, k] = SCENES[Number(btn.dataset.s)];
        this.roomScene(lights[Number(btn.dataset.i)], pct, k);
      };
    });
    /* A colour is one tap from the grid now, not a trip through the gear. The
       gear keeps the sliders — a swatch is a decision, a slider is a fiddle. */
    root.querySelectorAll('button.tile-sw').forEach((sw) => {
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
    root.querySelectorAll('input.tile-bri-in').forEach((sl) => {
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
     run as often as Home Assistant likes without ever moving a target. Both
     grids are painted, the hidden one included: a tab change then shows the
     rooms as they are rather than as they were when it was last looked at,
     and painting three tiles nobody is looking at costs a class and a word. */
  /* One room's pause toggle: off, on (its own pause), or held — lit in
     outline only, naming whose pause it is. */
  paintPauseToggle(pz, item, pb) {
    const sched = this.ctx.lightsched;
    const known = !!(sched && sched.known(item.entity));
    if (pz.hidden === known) pz.hidden = !known;
    if (!known || pz.disabled) return;
    const own = pb === item.entity;
    const held = !!pb && !own;
    pz.classList.toggle('on', own);
    pz.classList.toggle('held', held);
    pz.setAttribute('aria-pressed', String(!!pb));
    const word = own ? 'Paused' : !held ? 'Pause' : pb === '__house__' ? 'House' : 'Room';
    const small = pz.querySelector('small');
    if (small.textContent !== word) small.textContent = word;
    pz.title = own ? 'the evening ladder is paused here — tap to resume it'
      : held ? `paused with ${sched.roomLabel(pb)} — resume it there`
      : 'pause the evening ladder in this room';
  },

  paint() {
    for (const [root, rooms] of this.grids || []) this.paintTiles(root, rooms);
    this.paintFlowers();
    this.paintHouse();
  },

  paintTiles(root, lights) {
    for (const el of root.querySelectorAll('.tile')) {
      const item = lights[Number(el.dataset.t)];
      if (!item) continue;
      el.classList.toggle('on', this.isOn(item));
      const sub = el.querySelector('.sub');
      const txt = this.subtitle(item);
      if (sub && sub.textContent !== txt) sub.textContent = txt;
      // Paused: its switch and Home Assistant decide, and the pause stays
      // until somebody takes it off — so the tile does not let it be forgotten.
      const sched = this.ctx.lightsched;
      const pb = (item.entity && sched?.pausedBy(item.entity)) || null;
      const pz = el.querySelector('.tile-pz');
      if (pz) this.paintPauseToggle(pz, item, pb);
      // The mark after the name, for a tile with no toggle to say it.
      const mark = el.querySelector('.tile-pause');
      if (mark) {
        const show = !!pb && !(pz && !pz.hidden);
        if (mark.hidden === show) mark.hidden = !show;
      }
      // The room's temperature and humidity, if it has a sensor. Text only,
      // beside the state line, so nothing here can move a target.
      const clim = el.querySelector('.tile-clim');
      if (clim) {
        const ct = this.climateText(item);
        if (clim.textContent !== ct) clim.textContent = ct;
      }
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
  },

  /* ---------------- the light settings sheet ----------------
     A fixed overlay rather than something inside the panel: these are sliders
     dragged with a fingertip, and the panel is not always big enough to give
     them a target worth aiming at. */

  buildSheet() {
    const el = document.createElement('div');
    el.id = 'light-sheet';
    el.className = 'sheet';   // the settings window kit (app.css)
    /* The settings window kit: Power is the state sentence at the top (what
       the room is at now, and its place in the evening ladder), then a card
       for the light, one for the colour, one for the ladder, and the room's
       colour lamps. Static markup, built once: syncSheet() fills it in on
       every state that arrives, so nothing here is rebuilt under a finger. */
    el.innerHTML = `
      <header>
        <span class="sheet-icon ls-icon" aria-hidden="true"></span>
        <div class="sheet-title">
          <h2 class="ls-name"></h2>
          <span class="sheet-status ls-now"></span>
        </div>
        <span class="spacer"></span>
        <button class="ls-close">Close</button>
      </header>
      <div class="ls-body">
        <!-- Power and the sentence beside it: drawn by syncSheet(). -->
        <div class="sheet-sum"></div>

        <section class="sheet-sec ls-light" data-rail="Light">
          <h3 class="sheet-h">Light</h3>
          <div class="ls-row ls-scenes">
            <span class="ls-label">Scenes</span>
            <div class="ls-set">
              ${SCENES.map(([name, pct, k]) =>
                `<button class="ls-btn ls-scene" data-pct="${pct}" data-k="${k}">${name}</button>`).join('')}
            </div>
          </div>
          <div class="ls-row ls-dim">
            <span class="ls-label">Brightness <b class="ls-bri-val"></b></span>
            <input class="ls-slider ls-fill ls-bri" type="range" min="1" max="100" step="1" aria-label="brightness">
          </div>
          <div class="ls-row ls-temp">
            <span class="ls-label">Warmth <b class="ls-temp-val"></b></span>
            <input class="ls-slider ls-kelvin" type="range" step="50" aria-label="warmth">
          </div>
        </section>

        <!-- The swatches and the wheel are one card, side by side. Under
             them, the wheel pushed the sheet past the height of the screen
             and became a control you had to scroll to reach — on a wall with
             no scrollbar to speak of and wet hands, that is a control that is
             not there. What it is at stands beside the heading. -->
        <section class="sheet-sec ls-colour" data-rail="Colour">
          <h3 class="sheet-h">Colour <b class="sheet-sub ls-wheel-val"></b></h3>
          <div class="ls-row ls-colour-set">
            <div class="ls-swatches"></div>
            <div class="ls-wheel" role="slider" tabindex="0"
                 aria-label="pick a colour: hue around, strength outwards">
              <span class="ls-wheel-dot"></span>
            </div>
          </div>
        </section>

        <!-- ...and this room's place in the evening ladder. A summary and a
             way in, not the editor itself: the ladder is a list of steps with
             two sliders each, and inlining it here would bury the controls
             above it that somebody opened this sheet to reach. The sheet it
             opens is the same one the Whole house gear opens, on this room
             instead of on the house — so the card is called what it is. -->
        <section class="sheet-sec ls-sched" data-rail="Lights by the clock">
          <h3 class="sheet-h">Lights by the clock</h3>
          <div class="ls-row">
            <span class="ls-label"><span class="ls-sched-name">Evening dimming</span>
              <b class="ls-sched-val"></b></span>
            <div class="sheet-ctl sheet-across">
              <button class="ls-btn ls-sched-open">Set this room's dimming</button>
              <!-- The same pause as the ladder sheet's, where somebody turning
                   a room up to work already is. -->
              <button class="ls-btn ls-sched-pause"></button>
            </div>
          </div>
          <!-- A room whose big light the ladder may switch off (entities.json
               dim_off): the TV room's Jetström. -->
          <div class="ls-row ls-dimoff" hidden>
            <span class="ls-label">Big light off when the evening dims
              <b class="ls-dimoff-name"></b>
              <span class="db-hint ls-dimoff-hint"></span></span>
            <button class="ls-btn sheet-switch ls-dimoff-sw" role="switch" aria-checked="false" data-v="1">Off</button>
          </div>
        </section>

        <!-- The lamps inside this room that keep colours of their own: the
             Salon's spots and its colour lamp. In a room's own settings
             because the room is where anybody looking for the Salon's colours
             looks — and for a while the only way to them was a tile on More
             that nothing here mentioned. The colour above sets the room's
             colour now; these are what each lamp comes on at by the clock.
             Each one opens that lamp's steps. -->
        <section class="sheet-sec ls-lamps" data-rail="Evening and night, lamp by lamp" hidden>
          <h3 class="sheet-h">Evening and night, lamp by lamp <span class="sheet-sub ls-lamps-n"></span></h3>
          <p class="sheet-note ls-lamps-note">The colour and brightness each colour lamp
            comes on at when the motion sensor or a switch lights the room.</p>
          <div class="ls-set ls-lamp-set"></div>
        </section>
      </div>`;
    document.body.appendChild(el);
    this.sheet = el;
    el.querySelector('.ls-close').onclick = () => this.closeSheet();
    // One switch: its data-v is what a tap makes it (syncSheet keeps it so).
    el.querySelectorAll('.ls-dimoff button').forEach((b) => {
      b.onclick = async () => {
        const sched = this.ctx.lightsched;
        const item = this.sheetItem;
        if (!sched?.doc || !item) return;
        const all = { ...(sched.doc.dim_off || {}) };
        if (b.dataset.v === '1') all[item.entity] = true; else delete all[item.entity];
        sched.doc.dim_off = all;                 // painted at once
        this.syncSheet();
        await sched.save({ dim_off: all }, true);
        if (this.open) this.syncSheet();
      };
    });
    el.querySelector('.ls-sched-open').onclick = () => {
      // The two sheets are both fixed overlays at the same depth, so the
      // light settings step out of the way rather than sitting under it.
      const item = this.sheetItem;
      this.closeSheet();
      this.ctx.lightsched?.open(item && item.entity);
    };

    /* The ladder's own sheet is shut while this one is open, so what the
       pause answers — above all a failure — is said here: in place of the
       summary beside the button for a few seconds, then the summary is back. */
    el.querySelector('.ls-sched-pause').onclick = async (ev) => {
      const b = ev.currentTarget;
      const sched = this.ctx.lightsched;
      if (!b.dataset.e || !sched || b.disabled) return;
      b.disabled = true;
      const { text } = await sched.setPause(b.dataset.e, b.dataset.v === '1');
      b.disabled = false;
      this.schedSaid = text ? { text, until: Date.now() + SCHED_SAID_MS } : null;
      this.paint();
      if (this.open) this.syncSheet();
      if (text) setTimeout(() => { if (this.open) this.syncSheet(); }, SCHED_SAID_MS + 100);
    };

    /* Power is the switch in the state sentence, which syncSheet() redraws
       when what it says changes — so it is listened for on the body, and
       its data-v is what a tap makes it: 1 on, 0 off. */
    el.querySelector('.ls-body').addEventListener('click', (ev) => {
      const p = ev.target.closest('.ls-power');
      if (p) this.call(this.open, p.dataset.v === '1' ? 'turn_on' : 'turn_off');
    });

    const bri = el.querySelector('.ls-bri');
    bri.oninput = () => {
      el.querySelector('.ls-bri-val').textContent = `${bri.value}%`;
      this.briFill(bri);
      this.push({ brightness_pct: Number(bri.value) });
    };
    bri.onchange = () => this.push({ brightness_pct: Number(bri.value) }, true);
    const kel = el.querySelector('.ls-kelvin');
    kel.oninput = () => {
      el.querySelector('.ls-temp-val').textContent = `${kel.value} K`;
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
        this.briFill(bri);
        el.querySelector('.ls-bri-val').textContent = `${pct}%`;
        if (caps.temp) {
          el.querySelector('.ls-kelvin').value = String(k);
          el.querySelector('.ls-temp-val').textContent = `${k} K`;
        }
      };
    });

    el.querySelector('.ls-swatches').innerHTML = COLOURS.map(([name, h, s]) =>
      `<button class="ls-sw" data-h="${h}" data-s="${s}" title="${name}" aria-label="${name}"
               style="--sw:hsl(${h} ${s}% 60%)"></button>`).join('');
    el.querySelectorAll('.ls-sw').forEach((sw) => {
      sw.onclick = () => {
        const h = Number(sw.dataset.h);
        const s = Number(sw.dataset.s);
        // Same promise the wheel makes, for the same reason.
        this._wheelWant = { h, s, at: Date.now(), id: String(this.open) };
        this.paintWheel(h, s);
        this.push({ hs_color: [h, s] }, true);
      };
    });
    this.wireWheel(el.querySelector('.ls-wheel'));
  },

  // The lit part of the brightness track (--fill, app.css "light settings").
  briFill(sl) {
    const f = (Number(sl.value) - Number(sl.min || 1)) / ((Number(sl.max) || 100) - Number(sl.min || 1));
    sl.style.setProperty('--fill', String(Math.max(0, Math.min(1, f)).toFixed(3)));
  },

  /* A colour in words: one of the nine swatches by its name (within a step
     of it — a bridge hands back 174° for the 175° it was sent), white near
     the middle of the wheel, and degrees and strength for anything else.
     The evening ladder's nine count too (lightsched.js): its Blue is 240° at
     100%, not the swatches' 220° at 80%, and a lamp the ladder made blue is
     called Blue here as it is on the ladder's line in this same sheet. */
  palette() {
    return [...COLOURS, ...(this.ctx.lightsched?.colours || [])];
  },

  /* Under a tenth of the way out from the middle the wheel is white to the
     eye (a Salon at 333° · 7% looks white, not pink), so it is called white. */
  colourWord(hue, sat) {
    if (sat < WHITE_SAT) return 'white';
    const hit = this.swatchAt(hue, sat, this.palette());
    return hit ? hit[0] : `${hue}° · ${sat}%`;
  },

  // The entry of `list` a colour is (within a step of), or none.
  swatchAt(hue, sat, list = COLOURS) {
    return list.find(([, h, s]) => Math.min(Math.abs(hue - h), 360 - Math.abs(hue - h)) <= 3
      && Math.abs(sat - s) <= 4) || null;
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
    const word = this.colourWord(hue, sat);
    if (val && val.textContent !== word) val.textContent = word;
    /* The swatch the lamp is on, ringed — by the swatches' own values only:
       the ladder's Blue (240° · 100%) is called Blue in words, but tapping
       this sheet's Blue (220° · 80%) would move the lamp, so it is not ringed. */
    const own = sat < WHITE_SAT ? null : this.swatchAt(hue, sat);
    this.sheet.querySelectorAll('.ls-sw').forEach((sw) => {
      const on = !!own && own[0] === sw.title;
      if (sw.classList.contains('on') !== on) {
        sw.classList.toggle('on', on);
        sw.setAttribute('aria-pressed', String(on));
      }
    });
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
      // Remember it, so the state arriving a moment later cannot argue — see
      // syncSheet(). Per room, so a different room's sheet starts honest.
      this._wheelWant = { h: hue, s: sat, at: Date.now(), id: String(this.open) };
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
    // The lamps this sheet's controls act on — every bulb in the room, not
    // just the one whose state it reads.
    this.open = this.bulbs(item);
    this.sheetItem = item;
    this.schedSaid = null;
    this.sheet.querySelector('.ls-name').textContent = item.label;
    this.sheet.querySelector('.ls-icon').textContent = item.emoji || '💡';
    this._sumHtml = null;
    this.buildLampRow(item);
    this.syncSheet(true);
    this.sheet.classList.add('open');
    /* The ladder on the bus is the boot's snapshot, and the server does not
       push a new one when a step ends, so a wall up overnight would state
       last night's step as "now". Ask for a fresh one on the way in. */
    const want = this.open;
    this.ctx.lightsched?.refresh().then(() => {
      if (this.open === want && this.sheet.classList.contains('open')) this.syncSheet();
    });
    // Its top, whichever room's sheet was left scrolled.
    this.sheet.querySelector('.ls-body').scrollTop = 0;
    this.ctx.sheetkit?.sync(this.sheet);
  },

  /* The room's own colour lamps, one button each — the tiles in
     entities.json that say they are `part_of` this one. Built when the sheet
     opens; what each says it is doing tonight is filled in by syncSheet(). */
  buildLampRow(item) {
    const row = this.sheet.querySelector('.ls-lamps');
    const kids = (this.ctx.config.entities.lights || [])
      .filter((l) => l.entity && l.part_of === item.entity);
    // Shown with the colour, as it always was (syncSheet): a room that
    // cannot show a colour has no colour lamps to list.
    this.lampKids = kids.length;
    row.hidden = !kids.length;
    row.querySelector('.ls-lamps-n').textContent = kids.length
      ? `${kids.length} ${kids.length === 1 ? 'lamp' : 'lamps'}` : '';
    const set = row.querySelector('.ls-lamp-set');
    set.innerHTML = kids.map((k) => `
      <button class="ls-btn ls-lamp" data-e="${this.esc(k.entity)}">
        <span>${this.esc(k.emoji || '')} ${this.esc(k.label)}</span>
        <small class="ls-lamp-plan"></small>
      </button>`).join('');
    set.querySelectorAll('.ls-lamp').forEach((b) => {
      b.onclick = () => {
        // Same hand-over as "Set this room's dimming": both sheets are
        // fixed overlays at one depth, so this one steps out of the way.
        this.closeSheet();
        this.ctx.lightsched?.open(b.dataset.e);
      };
    });
  },

  closeSheet() {
    this.open = null;
    this.schedSaid = null;
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

    // Whether this room is on the house ladder or one of its own, in the
    // row that offers to change it. Read from the schedule module so there
    // is one answer to the question and not two.
    const sched = el.querySelector('.ls-sched-val');
    const said = this.schedSaid && Date.now() < this.schedSaid.until ? this.schedSaid.text : '';
    if (sched) sched.textContent = said || this.ctx.lightsched?.summaryFor(item.entity) || '';
    // A lamp inside a room is there for its colour, and says so.
    el.querySelector('.ls-sched-name').textContent = item.part_of ? 'Evening colour' : 'Evening dimming';
    el.querySelector('.ls-sched-open').textContent =
      item.part_of ? "Set this lamp's evening colours" : "Set this room's dimming";
    // Pause here, or Resume whichever pause holds it (a lamp's may be its
    // room's).
    const dz = el.querySelector('.ls-dimoff');
    const room = this.ctx.lightsched?.known(item.entity);
    const can = !!(room && room.dim_off && room.dim_off.length);
    dz.hidden = !can;
    if (can) {
      const on = !!(this.ctx.lightsched.doc.dim_off || {})[item.entity];
      dz.querySelector('.ls-dimoff-name').textContent = room.dim_off_label;
      // One switch saying its state; a tap makes it the other way.
      const sw = dz.querySelector('.ls-dimoff-sw');
      sw.classList.toggle('on', on);
      sw.setAttribute('aria-checked', String(on));
      sw.dataset.v = on ? '0' : '1';
      sw.textContent = on ? 'On' : 'Off';
      dz.querySelector('.ls-dimoff-hint').textContent = on
        ? `Where the evening ladder starts to dim this room, ${room.dim_off_label} is switched off, and while it dims the room comes on without it. Switched on by itself, it stays on.`
        : `${room.dim_off_label} stays as it is, and dims with the room.`;
    }
    const pz = el.querySelector('.ls-sched-pause');
    const pb = this.ctx.lightsched?.pausedBy(item.entity) || null;
    pz.hidden = !this.ctx.lightsched || !item.entity;
    pz.dataset.e = pb || item.entity || '';
    pz.dataset.v = pb ? '0' : '1';
    pz.classList.toggle('on', !!pb);
    pz.textContent = !pb ? '⏸ Pause the ladder'
      : pb === item.entity ? '▶ Resume the ladder'
      : `▶ Resume ${this.ctx.lightsched.roomLabel(pb)}`;
    el.querySelectorAll('.ls-lamp').forEach((b) => {
      const plan = b.querySelector('.ls-lamp-plan');
      const txt = this.ctx.lightsched?.planFor(b.dataset.e) || '';
      if (plan && plan.textContent !== txt) plan.textContent = txt;
    });

    el.querySelector('.ls-temp').hidden = !caps.temp;
    // The wheel lives inside this card, so hiding it for a lamp with no colour
    // takes the wheel with it — one rule, not two that can disagree. The
    // room's colour lamps go with it, as they did in the colour row.
    el.querySelector('.ls-colour').hidden = !caps.colour;
    el.querySelector('.ls-lamps').hidden = !(this.lampKids && caps.colour);
    /* Where the lamp actually is, so the dot is on the colour in the room
       rather than wherever it was last dragged to. A lamp on white reports no
       hue at all, which is the middle of the wheel and not an absence.

       Two things had to be added before that was true of the Salon, whose
       group is three colour-temperature lamps and two colour ones:

       `color_mode` decides whether there is a colour at all. A group sitting
       on white still reports an `hs_color` — the hue its warm white happens
       to be, around 28° — so reading that field alone put the dot on orange
       and called it the room's colour. If the lamp is not in a colour mode
       there is no colour, whatever that field says.

       And a colour just chosen is held for a moment. Setting one on a mixed
       group cannot change the group's mode, because the temperature-only
       lamps in it stay where they are; the state that comes back therefore
       contradicts the choice, and the dot used to snap home the instant a
       finger lifted. The lamps did go the colour asked for — the wheel was
       simply disbelieving them. */
    const drag = el.querySelector('.ls-wheel')?.dataset.drag;
    const held = this._wheelWant && Date.now() - this._wheelWant.at < WHEEL_HOLD_MS
      && this._wheelWant.id === String(this.open);
    if (caps.colour && !drag) {
      const hs = COLOUR_MODES.includes(a.color_mode) ? a.hs_color : null;
      if (held) this.paintWheel(this._wheelWant.h, this._wheelWant.s);
      else {
        this.paintWheel(Array.isArray(hs) ? Math.round(hs[0]) : 0,
                        Array.isArray(hs) ? Math.round(hs[1]) : 0);
      }
    }
    this.paintPower(item, st, caps, pb, said);

    const bri = el.querySelector('.ls-bri');
    if (force || document.activeElement !== bri) {
      const pct = a.brightness ? Math.round((a.brightness / 255) * 100) : 100;
      bri.value = String(pct);
      el.querySelector('.ls-bri-val').textContent = `${pct}%`;
      this.briFill(bri);
    }
    const kel = el.querySelector('.ls-kelvin');
    kel.min = String(caps.minK);
    kel.max = String(caps.maxK);
    if (force || document.activeElement !== kel) {
      const k = a.color_temp_kelvin || Math.round((caps.minK + caps.maxK) / 2);
      kel.value = String(k);
      el.querySelector('.ls-temp-val').textContent = `${k} K`;
    }
    if (el.classList.contains('open')) this.ctx.sheetkit?.sync(el);
  },

  /* Power, as the settings window kit's state sentence — what the room is
     at now, in the words its rows use, and where the evening ladder has it
     — with the switch beside it; and the header's line. Both from the state
     Home Assistant sent and the ladder's own summary, nothing new. The
     sentence is drawn again only when what it says has changed. */
  paintPower(item, st, caps, pb, said) {
    const kit = this.ctx.sheetkit;
    const sched = this.ctx.lightsched;
    const el = this.sheet;
    if (!kit) return;
    const esc = (s) => this.esc(s);
    const a = st.a || {};
    const answering = this._ok(st);
    const on = st.s === 'on';
    const pct = on && a.brightness ? Math.round((a.brightness / 255) * 100) : null;
    // A colour just chosen outranks the state coming back, as on the wheel.
    const want = this._wheelWant && Date.now() - this._wheelWant.at < WHEEL_HOLD_MS
      && this._wheelWant.id === String(this.open) ? this._wheelWant : null;
    const hs = !on || !caps.colour ? null : want ? [want.h, want.s]
      : COLOUR_MODES.includes(a.color_mode) && Array.isArray(a.hs_color) ? a.hs_color : null;
    const tint = hs ? this.colourWord(Math.round(hs[0]), Math.round(hs[1])) : '';
    // A swatch's colour by its name; one of the wheel's own only as "in
    // colour" — degrees are for the wheel's note, where the dot shows them.
    const named = this.palette().some(([n]) => n === tint) ? tint : '';
    const coloured = !!tint && tint !== 'white';
    const k = on && !coloured && caps.temp && a.color_temp_kelvin ? a.color_temp_kelvin : null;
    const paused = pb && sched ? sched.pauseText(item.entity) : '';

    kit.status(el.querySelector('.ls-now'), !answering ? '<b>Not answering</b>'
      : [`<b>${on ? 'On' : 'Off'}</b>`, pct != null ? `${pct}%` : '', k ? `${k} K` : '',
        named ? esc(named) : coloured ? 'in colour' : tint === 'white' && !k ? 'white' : '', esc(paused)].filter(Boolean).join(' · '),
    !answering ? 'warn' : on ? 'ok' : 'off');
    // Off, the light's own rows are still there to set — a tap on any of
    // them turns it on — but they are not what the room is at: the kit's
    // off group, the controls faded and their words kept.
    el.querySelectorAll('.ls-light, .ls-colour').forEach((c) => c.classList.toggle('nt-off', !on));

    const name = esc(item.label);
    const says = !answering ? `${name} is not answering.`
      : !on ? `${name} is off.`
      : `${name} is <b>on</b>${pct != null ? ` at <b>${pct}%</b>` : ''}${
        named ? `, in <b>${esc(named)}</b>` : coloured ? ', in colour' : k ? `, <b>${k} K</b>` : tint === 'white' ? ', in white' : ''}.`;
    const summary = (said || sched?.summaryFor(item.entity) || '').replace(/\.$/, '');
    /* Not answering, nobody knows whether it is on, and a switch states a
       fact: so Power draws no state — a dashed switch with its knob in the
       middle, saying what a tap tries — and that tap still sends turn_on. */
    const ctl = answering
      ? kit.toggle(on, `data-v="${on ? '0' : '1'}" aria-label="power"`, { cls: 'ls-power' })
      : `<button class="ls-btn sheet-switch ls-power ls-power-unknown" data-v="1"
          aria-label="power, not known: try to turn it on">Turn on</button>`;
    const html = kit.sum(says, {
      next: summary ? `${item.part_of ? 'Evening colour' : 'Evening dimming'}: <b>${esc(summary)}</b>.` : '',
      ctl, cap: 'Power', off: !on,
    });
    if (html !== this._sumHtml) {
      const box = el.querySelector('.ls-body > .sheet-sum');
      if (box) box.outerHTML = html;
      this._sumHtml = html;
    }
  },

  /* ---------------- the tabs, and More ----------------
     Lights is the house as the kitchen uses it: the six rooms that are tapped,
     the phones, the flowers and the whole house. More is the three that are
     not — the bathroom, the entrance and the storage cupboard — as ordinary
     room tiles, and whatever else is put there later.

     The tabs live in the header, not in the body. The rooms, the flowers and
     the whole house are cut to the panel's height exactly, so there is no row
     to put them in; the header has width to spare and no height to take.
     Beside the name, where the household drew them: there they read as the
     panel's own rather than as one more button along the right. In the
     full-screen header too, before the clock — the six views are laid out
     from the right-hand edge, so nothing here can move them, and the event
     chips are what gives way (fitNextEvents() in app.js).

     More is a pane of its own in the same body. While it shows, the four
     blocks of Lights are hidden and come back exactly as they were — nothing
     is rebuilt, because nothing about them changed.

     Which tab shows is this screen's business and nobody else's, so it is
     kept here in memory and not in ui-state: HOME_TAB (Automation) on every
     load, again whenever House leaves the screen, and after TAB_BACK_MIN
     minutes of nobody touching the panel. Nothing on More has to be watched,
     so nothing holds that way back open. */

  buildTabs(body) {
    this.tab = HOME_TAB;
    this.shown = false;
    const name = body.parentElement?.querySelector(':scope > header .name');
    if (!name) return;

    // Nothing marked for Lights 2, no Lights 2: a tab with nothing behind it
    // is a button that leads nowhere.
    const tabs = TABS.filter(([key]) => (key !== 'more' || this.roomsOn('more').length)
      && (key !== 'vacuum' || (this.vacuum && this.ctx.config?.entities?.vacuum)));
    this.tabsEl = document.createElement('span');
    this.tabsEl.className = 'ha-tabs';
    this.tabsEl.setAttribute('role', 'tablist');
    this.tabsEl.innerHTML = tabs.map(([key, label]) =>
      `<button class="ha-tab" role="tab" data-tab="${key}">${label}</button>`).join('');
    name.after(this.tabsEl);
    this.tabsEl.querySelectorAll('.ha-tab').forEach((b) => {
      b.onclick = (e) => { e.stopPropagation(); this.setTab(b.dataset.tab); };
    });

    // ?tabafter=<seconds> shortens the way back, for checking it in a browser
    // without waiting ten minutes — the same idea as app.js's ?homeafter.
    const secs = Number(new URLSearchParams(location.search).get('tabafter'));
    this.tabBackMs = secs > 0 ? secs * 1000 : TAB_BACK_MIN * 60 * 1000;
    // A touch anywhere in this panel is somebody using the tab; a touch
    // anywhere else on the wall is not. Capture and passive, as app.js's own
    // idle watch is, so this can never take a gesture off a slider.
    body.parentElement.addEventListener('pointerdown', () => {
      if (this.tab !== HOME_TAB) this.armTabBack();
    }, { capture: true, passive: true });
    this.setTab(HOME_TAB);
  },

  setTab(tab) {
    if (!this.tabsEl) return;
    const have = [...this.tabsEl.querySelectorAll('.ha-tab')].map((b) => b.dataset.tab);
    this.tab = have.includes(tab) ? tab : HOME_TAB;
    const lights = this.tab === 'lights';
    // The attribute alone does not hide these: .ha-flowers is display:grid
    // and .ha-house display:flex, and either beats the browser's own [hidden].
    // app.css has the explicit rule that makes it stick.
    this.tiles.hidden = !lights;
    this.flowers.hidden = !lights;
    this.house.hidden = !lights;
    this.more.hidden = this.tab !== 'more';
    this.auto.hidden = this.tab !== 'auto';
    const tunai = this.tab === 'tunai';
    if (this.tunaiEl) {
      if (tunai && this.tunaiEl.hidden) this.tunai?.show(this.tunaiEl);
      if (!tunai && !this.tunaiEl.hidden) this.tunai?.hide();
      this.tunaiEl.hidden = !tunai;
    }
    const vacuum = this.tab === 'vacuum';
    if (this.vacuumEl) {
      if (vacuum && this.vacuumEl.hidden) this.vacuum?.show(this.vacuumEl);
      if (!vacuum && !this.vacuumEl.hidden) this.vacuum?.hide();
      this.vacuumEl.hidden = !vacuum;
    }
    for (const b of this.tabsEl.querySelectorAll('.ha-tab')) {
      const on = b.dataset.tab === this.tab;
      b.classList.toggle('on', on);
      b.setAttribute('aria-selected', String(on));
    }
    if (this.tab === 'auto') {
      this.paintPhones();
      this.paintAuto();         // "Next at" is worked out now, not when drawn
    }
    this.syncPhoneTick();
    this.armTabBack();
  },

  armTabBack() {
    clearTimeout(this._tabBack);
    this._tabBack = null;
    if (this.tab === HOME_TAB || !this.shown) return;
    this._tabBack = setTimeout(() => {
      this._tabBack = null;
      this.setTab(HOME_TAB);
    }, this.tabBackMs);
  },

  /* The panel's own timers — the way back to Lights and the ring's second
     hand — run only while House is on the screen; init() starts neither. */
  onShow() {
    this.shown = true;
    this.syncPhoneTick();
    this.armTabBack();
  },

  onHide() {
    this.shown = false;
    this.setTab(HOME_TAB);
    this.syncPhoneTick();
  },

  /* ---------------- Find my phone ----------------
     A row of its own under the rooms, on the tab the wall is already showing,
     because a phone is lost at the moment somebody walks into the kitchen
     without it — not two taps later. One card per phone the server hands over
     in `config.phones`: the validated list, not the raw config, so a `notify`
     somebody has mistyped arrives as ready:false and says so instead of
     offering a Ring that cannot work.

     The ring belongs to the server (backend/app/phone.py): it sends the
     notification, repeats the spoken line and ends it, whether or not any
     screen is still looking. The card asks it to start or stop, paints the
     answer before it arrives, and follows the SSE key `phone` — which is how
     a phone found on the far side of the house turns this button back to
     Ring.

     The card never sends a word of what the phone shows or says. It names a
     phone by id, and that is all the server takes from it. */

  buildPhones() {
    this.phones = (this.ctx.config.phones || [])
      .filter((p) => p && typeof p.id === 'string' && p.id);
    this.phone = { ringing: null, last: null };   // the SSE key `phone`
    this.phoneMissing = false;                    // the server has no ring yet
    this.phoneErr = {};                           // id → what the last tap was told
    // The doorbell shares this row, so the row exists for either of them.
    // Its card is always in the markup and hidden until the server says there
    // is a door sensor behind it — the paint contract here is that build*()
    // writes the nodes once and paint*() only ever changes what they say.
    if (!this.phones.length && !this.ctx.doorbell) return;

    /* The card is a row, not a poster: emoji, who it is, what it is doing,
       and the button — because it shares the panel with the rooms now
       instead of having a tab to itself. Everything it could say before it
       still says; the two lines of explanation are one line under the row,
       said once for both phones rather than twice each. */
    this.phonesEl.innerHTML = `
      <div class="phone-row">${this.phones.map((p, i) => `
        <div class="phone-card" data-p="${i}">
          <span class="phone-emoji" aria-hidden="true">${this.esc(p.emoji || '📱')}</span>
          <span class="phone-txt">
            <span class="phone-name">${this.esc(p.label || p.id)}</span>
            <span class="phone-sub">
              ${p.device ? `<span class="phone-dev">${this.esc(p.device)}</span>` : ''}
              <span class="phone-bat"></span>
            </span>
            <span class="phone-status" aria-live="polite"></span>
          </span>
          <button class="phone-ring" data-i="${i}">Ring</button>
        </div>`).join('')}${this.doorCard()}</div>
      <p class="phone-how">${PHONE_HOW}</p>`;
    this.phonesEl.querySelectorAll('button.phone-ring').forEach((btn) => {
      const p = this.phones[Number(btn.dataset.i)];
      btn.onclick = () => this.phoneTap(p);
    });
    this.wireDoor();

    this.ctx.bus.on('phone', (st) => {
      if (!st || typeof st !== 'object') return;
      this.phone = { ringing: st.ringing || null, last: st.last || null };
      this.phoneMissing = false;       // it answered, so it is there
      this.phoneErr = {};              // the server's word is newer than a tap's
      this.paintPhones();
    });
    // Asked once, so a backend without the ring says so on the card before
    // anybody taps it rather than after: the frontend is routinely deployed
    // ahead of the backend, and a 404 here means exactly that.
    fetch('/api/phone').then((r) => {
      if (r.status === 404) { this.phoneMissing = true; this.paintPhones(); }
    }).catch(() => {});
    this.paintPhones();
  },

  /* ------------------------------------------------------ Automation ----
     The third tab (2026-10-11, Alex: everything that is not purely about
     lights moves off Lights 1 and Lights 2; the flower plugs went back to
     Lights 1 the same evening). Under the phone row, moved here as it was,
     two rows of cards:

     - Routines: the phone box, screen dimming, Mia's school time alert,
       the clock's sounds, the disco and Babo Alarm;
     - Alerts: the flower alarm, the Aurora alert, Radar, House alerts and
       Servers & updates — the last three how Needs attention shows each kind
       of alert, which until that day was set behind the ⚙ in its window
       (automation.js, ctx.automation);
     - Telegram (2026-10-13): the kitchen's bot and who is linked to it,
       until then in the bird box's ⚙.

     Every card is the clock's card — a .phone-card: name, two lines, an
     On/Off and a gear. The phone box, screen dimming, the school alert and
     the flower alarm were room-shaped tiles on More; as cards the whole tab
     fits a 1920×1080 wall without scrolling. Built once: nothing here
     depends on what a lamp can do, so nothing has to be rebuilt with the
     rooms. Each thing's document, settings and sheet are its own module's;
     this only draws them. */
  buildAuto() {
    const c = this.ctx;
    /* `pause`: the light tiles' ⏸ toggle (2026-10-14, the school alert's —
       "as light automations has"), between the card's switch and its gear. */
    const card = (cls, emoji, name, btn = true, pause = false, extra = '') => `
      <div class="phone-card au-card ${cls}" hidden>
        <span class="phone-emoji" aria-hidden="true">${emoji}</span>
        <span class="phone-txt">
          <span class="phone-name">${this.esc(name)}</span>
          <span class="phone-sub au-sub"></span>
          <span class="phone-status au-status" aria-live="polite"></span>
        </span>
        ${pause ? `<button class="tile-pz au-pz" hidden aria-pressed="false"
                  aria-label="${this.esc(name)}: pause"><b>⏸</b><small>Pause</small></button>` : ''}
        ${btn ? '<button class="phone-ring ch-btn au-btn">Off</button>' : ''}
        ${extra}
        <button class="tile-gear ch-gear au-gear" title="${this.esc(name)} settings"
                aria-label="${this.esc(name)} settings">⚙</button>
      </div>`;
    const au = c.automation;
    const routines = [
      c.phonebox && card('pb-card', '📦', 'Phone box', true, true),
      c.night && card('sd-card', '🌙', 'Screen dimming'),
      c.school && card('sc-card', '🎒', 'School alert', true, true),
      c.brief && card('bf-card', '🌅', 'Morning brief', true, true),
      c.chime && card('ch-card', '🕰️', 'Clock sounds'),
      c.disco && card('dc-card', '🪩', 'Disco'),
      c.babo && card('bb-card', '🪟', 'Babo Alarm'),
      /* The aroma diffuser (2026-10-14): two columns wide, for its three
         times and Stop — the run is the card's job, the rest is its gear. */
      c.diffuser && card('df-card', '🌸', 'Diffuser', false, false, `
        <span class="df-pause" role="group" aria-label="pause the diffuser">
          <button class="df-pz df-pz-on" aria-label="pause until tapped again"><b>⏸</b><small>Pause</small></button>
          ${[1, 2, 3, 4].map((h) => `
          <button class="df-pz df-pz-h" data-h="${h}" aria-label="pause ${h} hours">${h}<small>h</small></button>`).join('')}
        </span>
        <button class="df-water" aria-label="water left — open the diffuser's settings">
          <span class="df-tank"><i></i></span><b></b></button>
        <span class="df-runs">${[5, 10, 20].map((m) => `
          <button class="phone-ring df-run" data-min="${m}" aria-label="run the diffuser ${m} minutes">${m}<small>min</small></button>`).join('')}
          <button class="phone-ring stop df-stop" hidden aria-label="stop the diffuser">Stop</button>
          <button class="phone-ring df-int" hidden aria-label="mist strength — tap to change"><span></span><small></small></button>
          <button class="phone-ring df-guest" aria-label="guest mode">🥂<small>Guests</small></button>
        </span>`),
    ].filter(Boolean);
    const alerts = [
      c.soil && card('sl-card', '🌷', 'Flower alarm'),
      au && card('au-aurora', '🌌', 'Aurora alert'),
      au && card('au-radar', '📡', 'Radar', false),
      au && card('au-house', '🏠', 'House alerts', false),
      au && card('au-servers', '🖥️', 'Servers & updates', false),
    ].filter(Boolean);
    /* The smoke and heat alarms (2026-10-20, Alex: "add them separately to
       Automation tab … When they start screeming I can tab in the automation
       tab and they can turn to silence"): a card each, first under the
       phones, 🔇 Silence always on it. */
    const fa = c.fireAlarms;
    const fires = fa ? (c.config.entities.fire_alarms || [])
      .filter((a) => a && typeof a.id === 'string' && /^[a-z][a-z0-9_-]{0,23}$/.test(a.id))
      .map((a) => card(`fa-card fa-${a.id}`, a.emoji || '🔥', `${a.label || a.id}`)) : [];
    // Telegram (2026-10-13): the bot and who is linked, moved here from the
    // bird box's ⚙ — its own section, as Alex asked.
    const messaging = [au && card('au-telegram', '✈️', 'Telegram', false)].filter(Boolean);
    /* The temperature, humidity and soil sensors (2026-10-21, Alex: "I can
       choose which one and replace easily to any choosen room"): one card,
       where the readings are shown now and what is new; its sheet moves them.
       Beside it since 2026-10-22, the computers' own (Alex: "Add PC
       temperatures to Automation tab"): each machine's main reading, and its
       sheet sets when they alert. The names on it are the server's. */
    const sensing = [c.sensors && card('sn-card', '🌡️', 'Temperature sensors', false),
      c.pctemps && card('pt-card', '🖥️', 'PC temperatures', false)].filter(Boolean);
    this.auto.insertAdjacentHTML('beforeend', `
      ${fires.length ? `<h3 class="au-h">Fire alarms</h3>
        <div class="phone-row au-cards fa-row">${fires.join('')}</div>` : ''}
      ${routines.length ? `<h3 class="au-h">Routines</h3>
        <div class="phone-row au-cards">${routines.join('')}</div>` : ''}
      ${alerts.length ? `<h3 class="au-h">Alerts</h3>
        <div class="phone-row au-cards">${alerts.join('')}</div>` : ''}
      ${sensing.length ? `<h3 class="au-h">Sensors</h3>
        <div class="phone-row au-cards">${sensing.join('')}</div>` : ''}
      ${messaging.length ? `<h3 class="au-h">Telegram</h3>
        <div class="phone-row au-cards">${messaging.join('')}</div>` : ''}`);
    const wire = (cls, toggle, open) => {
      const el = this.auto.querySelector(`.${cls}`);
      if (!el) return;
      const btn = el.querySelector('.au-btn');
      if (btn) btn.onclick = toggle;
      el.querySelector('.au-gear').onclick = open;
      // A card with no switch of its own opens its sheet from anywhere on it.
      if (!btn) {
        el.classList.add('au-tap');
        el.querySelector('.phone-txt').onclick = open;
      }
    };
    const { phonebox: pb, night: nt, school: sc, chime: ch, disco: dc, babo: bb, soil: sl } = c;
    const paint = () => this.paintAuto();
    if (pb) {
      wire('pb-card', () => pb.toggle(), () => pb.open());
      // The same ⏸ as the school alert's (2026-10-31): it holds the phones too.
      const pz = this.auto.querySelector('.pb-card .au-pz');
      if (pz) pz.onclick = () => pb.setPause(pb.paused() === null);
      pb.onDoc(paint);
    }
    if (nt) { wire('sd-card', () => nt.toggle(), () => nt.open()); nt.onChange(paint); }
    if (sc) {
      wire('sc-card', () => sc.toggle(), () => sc.open());
      const pz = this.auto.querySelector('.sc-card .au-pz');
      if (pz) pz.onclick = () => sc.setPause(sc.paused() === null);
      sc.onDoc(paint);
    }
    if (ch) { wire('ch-card', () => ch.toggle(), () => ch.open()); ch.onDoc(paint); }
    const bf = c.brief;
    if (bf) {
      wire('bf-card', () => bf.toggle(), () => bf.open());
      const pz = this.auto.querySelector('.bf-card .au-pz');
      if (pz) pz.onclick = () => bf.setPause(bf.paused() === null);
      bf.onDoc(paint);
    }
    if (dc) { wire('dc-card', () => dc.toggle(), () => dc.open()); dc.onDoc(paint); }
    // During an alarm Babo's button is Stop; otherwise On/Off.
    if (bb) {
      wire('bb-card', () => (bb.doc?.alarm ? bb.stop() : bb.toggle()), () => bb.open());
      /* The window's lamp (2026-10-18, Alex: "if it is green window is
         closed, if it is red the window is open"), before the switch: what
         the sensor says now, at any hour — grey while it has said nothing. */
      this.auto.querySelector('.bb-card .au-btn')?.insertAdjacentHTML('beforebegin',
        '<span class="bb-lamp" role="img"></span>');
      bb.onDoc(paint);
    }
    if (sl) { wire('sl-card', () => sl.toggle(), () => sl.open()); sl.onDoc(paint); }
    if (fa) {
      for (const el of this.auto.querySelectorAll('.fa-card')) {
        const id = [...el.classList].find((k) => k.startsWith('fa-') && k !== 'fa-card').slice(3);
        el.dataset.alarm = id;
        wire(`fa-${id}`, () => fa.silence(id), () => fa.open(id));
        // The card itself opens the sheet too; Silence is its one button.
        el.querySelector('.phone-txt').onclick = () => fa.open(id);
      }
      fa.onDoc(paint);
    }
    const sn = c.sensors;
    if (sn) { wire('sn-card', null, () => sn.open()); sn.onDoc(paint); }
    const pt = c.pctemps;
    if (pt) { wire('pt-card', null, () => pt.open()); pt.onDoc(paint); }
    const df = c.diffuser;
    if (df) {
      wire('df-card', null, () => df.open());
      const el = this.auto.querySelector('.df-card');
      el.querySelectorAll('.df-run').forEach((b) => { b.onclick = () => df.run(Number(b.dataset.min)); });
      el.querySelector('.df-stop').onclick = () => df.stop();
      el.querySelector('.df-guest').onclick = () => df.guest();
      el.querySelector('.df-pz-on').onclick = () => df.pause(null);
      el.querySelectorAll('.df-pz-h').forEach((b) => { b.onclick = () => df.pause(Number(b.dataset.h)); });
      el.querySelector('.df-int').onclick = () => df.flipStrength();
      el.querySelector('.df-water').onclick = () => df.open();
      df.onDoc(paint);
    }
    if (au) {
      wire('au-aurora', () => au.toggleAurora(), () => au.open('aurora'));
      wire('au-radar', null, () => au.open('radar'));
      wire('au-house', null, () => au.open('house'));
      wire('au-servers', null, () => au.open('servers'));
      wire('au-telegram', null, () => au.open('telegram'));
      au.onChange(paint);
    }
    this.paintAuto();
  },

  /* A routine's own one-line summary, "on · 21:30 · Alex, Sam, the wall",
     as a card's two lines: the first fact on the bold line (21:30), the rest
     under the name. The card's button already says On or Off. */
  splitSummary(txt) {
    const parts = String(txt || '').split(' · ');
    if (parts[0] === 'off') return { sub: 'switched off', status: '' };
    if (parts[0] === 'on') parts.shift();
    return { status: parts[0] || '', sub: parts.slice(1).join(' · ') };
  },

  /* One card: shown or not, its two lines, its button, and the classes that
     colour it (Babo's alarm, the disco dancing, the pots needing water, the
     aurora being out). */
  paintCard(cls, { show, on = false, sub = '', status = '', word, label, flags = {} }) {
    const el = this.auto && this.auto.querySelector(`.${cls}`);
    if (!el) return;
    if (el.hidden === !!show) el.hidden = !show;
    if (!show) return;
    el.classList.toggle('au-on', !!on);
    for (const [k, v] of Object.entries(flags)) el.classList.toggle(k, !!v);
    for (const [sel, txt] of [['.au-sub', sub], ['.au-status', status]]) {
      const x = el.querySelector(sel);
      if (x.textContent !== txt) x.textContent = txt;
    }
    const btn = el.querySelector('.au-btn');
    if (!btn) return;
    const w = word || (on ? 'On' : 'Off');
    if (btn.textContent !== w) btn.textContent = w;
    btn.classList.toggle('on', !!on && !word);
    if (label) btn.setAttribute('aria-label', label);
  },

  /* A routine's ⏸ on its card — the school alert's, and since 2026-10-31
     the phone box's: Pause while it runs, ▶ Play lit amber while it is held,
     and the card outlined in the same amber so a paused alarm is seen from
     across the kitchen. Hidden while it is switched off — unless it is
     paused, which must never be out of sight. */
  paintPause(cls, m, what) {
    const el = this.auto && this.auto.querySelector(`.${cls}`);
    const pz = el && el.querySelector('.au-pz');
    if (!m || !pz) return;
    const paused = m.paused() !== null;
    const show = !!m.doc && (paused || !!m.settings().enabled);
    if (pz.hidden === show) pz.hidden = !show;
    el.classList.toggle('au-paused', paused);
    pz.classList.toggle('on', paused);
    pz.setAttribute('aria-pressed', String(paused));
    const [icon, word] = paused ? ['▶', 'Play'] : ['⏸', 'Pause'];
    if (pz.querySelector('b').textContent !== icon) pz.querySelector('b').textContent = icon;
    if (pz.querySelector('small').textContent !== word) pz.querySelector('small').textContent = word;
    pz.title = paused ? `${what} paused — tap to play again`
      : `pause ${what} until Play is pressed`;
  },

  paintAuto() {
    if (!this.auto) return;
    const c = this.ctx;
    const fa = c.fireAlarms;
    for (const el of fa ? this.auto.querySelectorAll('.fa-card') : []) {
      const a = fa.get(el.dataset.alarm);
      const loud = fa.loud(a) || !!a?.siren_test;
      this.paintCard(`fa-${el.dataset.alarm}`, { show: !!a, word: '🔇 Silence',
        flags: { 'fa-loud': loud, 'fa-trouble': !!a && !loud && (a.fault || a.battery_low) },
        sub: fa.sub(a), status: fa.status(a), label: `${a?.label || 'Alarm'}: silence it` });
    }
    const sw = (name, on) => `${name} ${on ? 'on, switch it off' : 'off, switch it on'}`;
    const routine = (cls, m, name, show) => {
      if (!m) return;
      const on = show && !!m.settings().enabled;
      this.paintCard(cls, { show, on, ...(show ? this.splitSummary(m.summary()) : {}), label: sw(name, on) });
    };
    routine('pb-card', c.phonebox, 'Phone box', !!c.phonebox?.doc);
    routine('sd-card', c.night, 'Screen dimming', !!c.night?.data);
    routine('sc-card', c.school, "Mia's school time alert", !!c.school?.doc);
    this.paintPause('pb-card', c.phonebox, 'everything the phone box sends, the phones included, is');
    this.paintPause('sc-card', c.school, 'the school alerts are');
    routine('bf-card', c.brief, 'Morning brief', !!c.brief?.doc);
    this.paintPause('bf-card', c.brief, 'the morning brief is');
    const sn = c.sensors;
    if (sn) {
      const v = sn.summary();
      this.paintCard('sn-card', { show: !!v, sub: v?.sub || '', status: v?.status || '',
        flags: { 'sn-has-new': !!v?.fresh && !v?.hot, 'sn-hot': !!v?.hot } });
    }
    const pt = c.pctemps;
    if (pt) {
      const v = pt.summary();
      this.paintCard('pt-card', { show: !!v, sub: v?.sub || '', status: v?.status || '',
        flags: { 'pt-hot': !!v?.hot } });
    }
    const sl = c.soil;
    if (sl) {
      const pot = sl.pot();
      const on = !!pot && !!sl.settings().enabled;
      this.paintCard('sl-card', { show: !!pot, on, ...(pot ? this.splitSummary(sl.summary()) : {}),
        label: sw('Flower alarm', on), flags: { 'sl-alarm': !!pot?.alarm } });
    }
    const ch = c.chime;
    if (ch) {
      const on = !!ch.doc && !!ch.settings().enabled;
      this.paintCard('ch-card', { show: !!ch.doc, on, label: sw('Clock sounds', on),
        sub: ch.doc ? ch.soundName() : '', status: ch.doc ? ch.cardLine() : '' });
    }
    const dc = c.disco;
    if (dc) {
      const on = !!dc.doc && dc.running();
      this.paintCard('dc-card', { show: !!dc.doc, on, flags: { 'dc-on': on },
        label: `Disco ${on ? 'on, stop it' : 'off, start it'}`,
        sub: dc.doc ? dc.summary() : '', status: dc.doc ? dc.status() : '' });
    }
    const bb = c.babo;
    if (bb) {
      const alarm = !!bb.doc?.alarm;
      const on = !!bb.doc && !!bb.settings().enabled;
      const open = bb.doc?.window?.open;
      const lamp = this.auto.querySelector('.bb-lamp');
      if (lamp) {
        const said = open === true ? 'the window is open' : open === false ? 'the window is shut'
          : 'the window sensor has not said yet';
        if (lamp.getAttribute('aria-label') !== said) {
          lamp.setAttribute('aria-label', said);
          lamp.title = said;
        }
      }
      this.paintCard('bb-card', { show: !!bb.doc, on, word: alarm ? 'Stop' : undefined,
        flags: { 'bb-alarm': alarm, 'bb-open': open === true, 'bb-shut': open === false },
        label: alarm ? 'Stop the alarm' : sw('Babo Alarm', on),
        sub: bb.doc ? bb.summary() : '', status: bb.doc ? bb.status() : '' });
    }
    const df = c.diffuser;
    if (df) {
      const show = !!df.doc;
      const on = show && df.running();
      this.paintCard('df-card', { show, on, flags: { 'df-on': on, 'df-dry': !!df.doc?.water?.empty },
        sub: show ? df.summary() : '', status: show ? df.status() : '' });
      const el = this.auto.querySelector('.df-card');
      if (el && show) {
        const stop = el.querySelector('.df-stop');
        const stoppable = on || df.onElsewhere();
        if (stop.hidden === stoppable) stop.hidden = !stoppable;
        const off = !df.doc.configured || df.busy || (!df.doc.answering && !on);
        const g = df.waterGauge();
        const wb = el.querySelector('.df-water');
        wb.className = `df-water ${g.cls}`;
        wb.style.setProperty('--lvl', g.pct == null ? '0%' : `${g.pct}%`);
        if (wb.querySelector('b').textContent !== g.text) wb.querySelector('b').textContent = g.text;
        wb.title = g.pct == null ? 'water: not known yet — tap, then Filled up'
          : `water left, estimated from how long it has misted: ${g.text}`;
        el.querySelectorAll('.df-run, .df-stop').forEach((b) => { b.disabled = off; });
        const gb = el.querySelector('.df-guest');
        gb.classList.toggle('on', df.guestOn());
        gb.disabled = !df.doc.configured || df.busy;
        gb.title = df.guestOn() ? 'guest mode is on — tap to end it' : 'guest mode: gentle runs for a while';
        const pz = df.pausedFor();
        el.classList.toggle('df-paused', !!pz);
        const pb = el.querySelector('.df-pz-on');
        pb.classList.toggle('on', !!pz);
        pb.querySelector('b').textContent = pz ? '▶' : '⏸';
        pb.querySelector('small').textContent = pz ? 'Resume' : 'Pause';
        pb.title = pz ? 'paused — tap to resume' : 'pause until tapped again';
        el.querySelectorAll('.df-pz-h').forEach((b) => {
          const lit = !!pz && pz.hours === Number(b.dataset.h);
          b.classList.toggle('on', lit);
          b.title = lit ? `paused ${b.dataset.h} h — tap to resume` : `pause ${b.dataset.h} hours`;
        });
        el.querySelectorAll('.df-pz').forEach((b) => { b.disabled = !df.doc.configured || df.busy; });
        // Mist strength (2026-10-15): one button that flips it, once the
        // Meross key is there to set it with.
        const ib = el.querySelector('.df-int');
        const strong = df.settings().intensity !== 'light';
        if (ib.hidden === df.strengthOk()) ib.hidden = !df.strengthOk();
        const face = strong ? '💨' : '🌫️';
        if (ib.querySelector('span').textContent !== face) {
          ib.querySelector('span').textContent = face;
          ib.querySelector('small').textContent = strong ? 'Strong' : 'Light';
        }
        ib.title = `mist: ${strong ? 'strong' : 'light'} — tap for ${strong ? 'light' : 'strong'}`;
      }
    }
    const au = c.automation;
    if (au) {
      const on = au.auroraOn();
      this.paintCard('au-aurora', { show: !!au.aurora, on, ...au.auroraLines(),
        label: sw('Aurora alert', on), flags: { 'ar-out': au.auroraPossible() } });
      const ready = au.ready();
      this.paintCard('au-radar', { show: ready, ...(ready ? au.radarLines() : {}) });
      this.paintCard('au-house', { show: ready, ...(ready ? au.groupLines('house') : {}) });
      this.paintCard('au-servers', { show: ready, ...(ready ? au.groupLines('servers') : {}) });
      this.paintCard('au-telegram', { show: !!au.tg, ...au.telegramLines() });
    }
  },

  /* ---------------------------------------------------- the doorbell ----
     The entrance door, in the phone row rather than under it: a doorbell is
     the same kind of thing as Find my phone — one household fact and one big
     button — and the row had width for a third card without costing the rooms
     a pixel of the height budget.

     The card is the only part of the doorbell that lives in this panel. The
     sound, the settings sheet and the document they both read are doorbell.js
     (ctx.doorbell), because the bell has to ring on whichever view is up and
     a panel only exists while its own view is on screen. */

  doorCard() {
    if (!this.ctx.doorbell) return '';
    return `
      <div class="phone-card db-card" hidden>
        <span class="phone-emoji" aria-hidden="true">🔔</span>
        <span class="phone-txt">
          <span class="phone-name">Doorbell</span>
          <span class="phone-sub">
            <span class="phone-bat db-bat"></span>
          </span>
          <span class="phone-status db-status" aria-live="polite"></span>
        </span>
        <button class="phone-ring db-btn">Off</button>
        <button class="tile-gear db-gear" title="doorbell settings"
                aria-label="Doorbell settings">⚙</button>
      </div>`;
  },

  wireDoor() {
    const db = this.ctx.doorbell;
    if (!db) return;
    const card = this.phonesEl.querySelector('.db-card');
    if (!card) return;
    card.querySelector('.db-btn').onclick = () => db.toggle();
    card.querySelector('.db-gear').onclick = () => db.open();
    db.onDoc(() => this.paintDoor());
    this.paintDoor();
  },

  /* What the card says about the door, in one line that must not wrap — the
     row's height is the flowers' height, and a card that grew by a line would
     take it off them.

     "Off" first and on its own: with the doorbell switched off, whether the
     door happens to be open is not what anybody is reading this card for. */
  doorStatus(doc) {
    const s = doc.settings || {};
    if (doc.error) return doc.error;
    if (!s.enabled) return 'Won’t ring';
    if (doc.open === null || doc.open === undefined) return 'No reading yet';
    if (doc.open) {
      const mins = Math.max(0, Math.floor((Date.now() / 1000 - (doc.since || 0)) / 60));
      const how = mins < 1 ? 'just now' : mins < 60 ? `${mins} min`
        : `${Math.floor(mins / 60)}h ${mins % 60}m`;
      return doc.alerting ? `Open ${how} · lights on it` : `Open · ${how}`;
    }
    const at = doc.ring && doc.ring.at;
    return at ? `Rang at ${this.clockAt(at)}` : 'Closed';
  },

  paintDoor() {
    const db = this.ctx.doorbell;
    if (!this.phonesEl || !db) return;
    const card = this.phonesEl.querySelector('.db-card');
    if (!card) return;
    const doc = db.doc;
    // A server with no door sensor in it, or one too old to have a doorbell
    // at all: no card, rather than a card that can do nothing. The phones
    // then have the row to themselves exactly as they did before.
    const show = !!(doc && doc.configured);
    if (card.hidden === show) card.hidden = !show;
    if (!show) return;

    const s = doc.settings || {};
    const on = !!s.enabled;
    card.classList.toggle('phone-stale', !this.connected);
    card.classList.toggle('ringing', on && doc.open === true);
    const btn = card.querySelector('.db-btn');
    const word = on ? 'On' : 'Off';
    if (btn.textContent !== word) btn.textContent = word;
    btn.classList.toggle('on', on);
    btn.setAttribute('aria-label', `Doorbell ${on ? 'on, switch it off' : 'off, switch it on'}`);
    const bat = card.querySelector('.db-bat');
    // The coin cell in the sensor. Shown only once it is worth knowing about:
    // a door that says "Battery 100%" at every glance for two years is two
    // years of nobody reading the line that will one day say 9%.
    // No reading is not an empty battery: Number(null) is 0, and the card said
    // "Battery 0%" until the sensor first reported.
    const pct = typeof doc.battery === 'number' ? doc.battery : NaN;
    const low = Number.isFinite(pct) && pct <= 25;
    const txt = low ? `Battery ${Math.round(pct)}%` : '';
    if (bat.textContent !== txt) bat.textContent = txt;
    bat.classList.toggle('low', low);
    this.paintDoorStatus();
  },

  paintDoorStatus() {
    const db = this.ctx.doorbell;
    if (!this.phonesEl || !db || !db.doc) return;
    const el = this.phonesEl.querySelector('.db-status');
    if (!el) return;
    const txt = this.doorStatus(db.doc);
    if (el.textContent !== txt) el.textContent = txt;
    this.syncDoorTick();
  },

  /* The minute hand of "Open · 12 min". A minute, not a second: the phone's
     ring is counted in seconds because it lasts two minutes, and a door left
     open is counted in minutes because it lasts hours. Like that one it runs
     only while somebody can see it, and it lands just after the door's own
     minute turns over so that two screens agree on the number. */
  syncDoorTick() {
    const doc = this.ctx.doorbell?.doc;
    const want = !!(this.phonesEl && this.shown && this.tab === 'auto'
                    && doc?.configured && doc.settings?.enabled && doc.open === true);
    if (!want) {
      clearTimeout(this._doorTick);
      this._doorTick = null;
    } else if (!this._doorTick) {
      const since = Number(doc.since) || 0;
      const frac = (((Date.now() / 1000 - since) % 60) + 60) % 60;
      this._doorTick = setTimeout(() => {
        this._doorTick = null;
        this.paintDoorStatus();
      }, Math.round((60 - frac) * 1000) + 25);
    }
  },

  /* "Battery 58% · charging", or nothing: a sensor that is unavailable is a
     phone that has not reported, and a stale number would be a guess. */
  phoneBattery(p) {
    const lvl = p.battery && this.states[p.battery];
    if (!this._ok(lvl) || !Number.isFinite(Number(lvl.s))) return null;
    const pct = Math.round(Number(lvl.s));
    const st = p.battery_state && this.states[p.battery_state];
    const how = this._ok(st) && st.s === 'charging' ? ' · charging'
      : this._ok(st) && st.s === 'full' ? ' · full' : '';
    return { text: `Battery ${pct}%${how}`, low: pct <= 15 && !how };
  },

  /* The time a ring ended, as the kitchen would say it. The result stays on
     the card until the next ring, so a line from yesterday says so. */
  clockAt(sec) {
    const d = new Date(sec * 1000);
    const hm = d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false });
    const day = new Date();
    if (d.toDateString() === day.toDateString()) return hm;
    day.setDate(day.getDate() - 1);
    if (d.toDateString() === day.toDateString()) return `${hm} yesterday`;
    return `${hm} on ${d.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' })}`;
  },

  phoneStatus(p) {
    // A phone with no companion app behind it yet. Said before anything else,
    // because nothing else on this card is going to happen until it is done.
    if (!p.ready) return 'Not set up yet — no app on this phone';
    const ring = this.phone.ringing;
    if (ring && ring.id === p.id) {
      // Counted from the server's start, so every screen shows the same
      // second, and never past its end: the server says when it has ended.
      const s = Math.max(0, Math.floor(Math.min(Date.now() / 1000, ring.until) - ring.started));
      return `Ringing · ${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
    }
    if (this.phoneMissing) return 'The ring isn’t installed on the server yet';
    if (this.phoneErr[p.id]) return this.phoneErr[p.id];
    const last = this.phone.last;
    if (!last || last.id !== p.id) return '';
    const at = this.clockAt(last.at);
    if (last.result === 'found') return `Found it — stopped from the phone at ${at}`;
    if (last.result === 'stopped') return `Stopped at ${at}`;
    if (last.result === 'timeout') {
      // Two minutes, unless somebody rang it again part-way and moved the end.
      const min = Math.max(1, Math.round((last.at - (last.started || last.at - 120)) / 60));
      return `Rang for ${min} minute${min === 1 ? '' : 's'} — until ${at}`;
    }
    if (last.result === 'failed') return `Couldn’t ring it: ${last.error || 'no reason given'}`;
    return '';
  },

  /* Values only, like paint(): runs on every state Home Assistant sends and
     every `phone` event, and never replaces the button under a finger. */
  paintPhones() {
    if (!this.phonesEl) return;
    const ring = this.phone.ringing;
    for (const card of this.phonesEl.querySelectorAll('.phone-card')) {
      const p = this.phones[Number(card.dataset.p)];
      if (!p) continue;
      const ringing = !!ring && ring.id === p.id;
      card.classList.toggle('ringing', ringing);
      // Greyed on its own, like the tiles' .ha-stale: HA down is this card's
      // problem and nobody else's. Still tappable — the server says why not.
      card.classList.toggle('phone-stale', !this.connected);
      card.classList.toggle('phone-unset', !p.ready);
      const btn = card.querySelector('.phone-ring');
      const word = ringing ? 'Stop' : 'Ring';
      if (btn.textContent !== word) btn.textContent = word;
      btn.classList.toggle('stop', ringing);
      // A phone with nothing to ring is the one case where the button is dead
      // rather than optimistic: the server would only answer 409, and a
      // button that always fails is worse than one that says it is not ready.
      btn.disabled = this.phoneMissing || !p.ready;
      btn.setAttribute('aria-label', `${word} ${p.label || p.id}`);
      const bat = this.phoneBattery(p);
      const batEl = card.querySelector('.phone-bat');
      const txt = bat ? bat.text : '';
      if (batEl.textContent !== txt) batEl.textContent = txt;
      batEl.classList.toggle('low', !!(bat && bat.low));
    }
    this.paintPhoneStatus();
    this.syncPhoneTick();
  },

  paintPhoneStatus() {
    if (!this.phonesEl) return;
    for (const card of this.phonesEl.querySelectorAll('.phone-card')) {
      const p = this.phones[Number(card.dataset.p)];
      const el = card.querySelector('.phone-status');
      const txt = p ? this.phoneStatus(p) : '';
      if (el.textContent !== txt) el.textContent = txt;
    }
  },

  /* The second hand of "Ringing · 0:37". Only while a ring is on and somebody
     can see it — a one-second timer is the most expensive thing a panel can
     leave running on a wall that is on all day.

     Each tick lands just after the ring's own second turns over rather than
     on a second of its own: a free-running interval started at the tap shows
     a count anything up to a second behind, and two screens side by side then
     disagree about how long the phone has been ringing. */
  syncPhoneTick() {
    // The door's own minute hand asks the same question of the same row, and
    // is answered from here so that the four places that drive this one —
    // setTab, onShow, onHide and paintPhones — drive both.
    this.syncDoorTick();
    const want = !!(this.phonesEl && this.shown && this.tab === 'auto'
                    && this.phone.ringing);
    if (!want) {
      clearTimeout(this._phoneTick);
      this._phoneTick = null;
    } else if (!this._phoneTick) {
      const r = this.phone.ringing;
      const frac = (((Date.now() / 1000 - r.started) % 1) + 1) % 1;
      this._phoneTick = setTimeout(() => {
        this._phoneTick = null;
        this.paintPhoneStatus();
        this.syncPhoneTick();
      }, Math.round((1 - frac) * 1000) + 25);
    }
  },

  async phoneTap(p) {
    const stop = this.phone.ringing?.id === p.id;
    const before = this.phone;
    const now = Date.now() / 1000;
    // The answer first, as every control in this panel does. The server's
    // own version arrives over SSE a moment later and wins.
    const guess = stop
      ? { ringing: null, last: { id: p.id, result: 'stopped', at: now,
                                 started: before.ringing.started } }
      : { ringing: { id: p.id, started: now, until: now + 120 }, last: before.last };
    this.phone = guess;
    delete this.phoneErr[p.id];
    this.paintPhones();

    let res = null;
    let body = {};
    try {
      res = await fetch(`/api/phone/${stop ? 'stop' : 'ring'}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: p.id }),
      });
      body = await res.json().catch(() => ({}));
    } catch { /* the kitchen server itself is not answering */ }
    if (res && res.ok) return;

    // Put back what was there — unless the server has spoken since, in which
    // case its word is newer than both.
    if (this.phone === guess) this.phone = before;
    const status = res ? res.status : 0;
    const err = typeof body?.error === 'string' ? body.error : '';
    if (status === 404 && !err) {
      // No route at all: the frontend is ahead of the backend (README,
      // "Editing and seeing your changes"). Not an error to show and retry.
      this.phoneMissing = true;
    } else if (status === 503) {
      this.phoneErr[p.id] = 'Home Assistant is not answering';
    } else if (status === 409) {
      // The phone is not set up. The button is disabled for that, so this is
      // a config that changed under a screen that has not reloaded yet — the
      // server's own sentence, which is the one the card would have said.
      this.phoneErr[p.id] = err || 'This phone is not set up yet';
    } else if (!res) {
      this.phoneErr[p.id] = 'The kitchen server is not answering';
    } else {
      this.phoneErr[p.id] = `Couldn’t ${stop ? 'stop' : 'ring'} it: ${err || `error ${status}`}`;
    }
    this.paintPhones();
  },
};
