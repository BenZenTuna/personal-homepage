/* Room temperature and humidity — the readings on the wall, and the chart
   behind them.

   Not a panel, for the same reason the bird box's count is not one: the
   kitchen's warmth is something you glance at on whichever view is up, so it
   lives in the top bar and in the header a full-screen panel carries, and it
   is on screen all day. The House panel's light cards carry their own room's
   reading as well — that one is drawn by panels/ha.js, which owns those
   cards; the formatting comes from here so the two never disagree.

   Everything is built from the `climate` list, in its order — since
   2026-10-21 sensors.py's: the sensors are found in Home Assistant and put in
   rooms on House → Automation → Sensors, and a move arrives over SSE
   (`sensors`) and rebuilds the bar, the mini and the chart's legend here
   (setRooms) with no reload. A room's history is the server's to stitch from
   whichever sensors were in it; a place a sensor has left keeps its line in
   the chart up to the move, marked "no sensor now".

   What it shows now comes over the same SSE channel as the lights: these are
   ordinary Home Assistant entities and ha_states already carries them. Only
   the history is fetched, and only when the chart is actually opened.

   A soil sensor (2026-10-01, "Flowers") is one more entry with `soil_entity`
   where a room has `hum_entity`: its % is the soil's moisture, it has a chart
   of its own under the other two, and it wears a flower that is green, yellow
   when the pots are getting dry and red — blinking — when they need water.
   What colour it is is the server's (soil.py, over the SSE key `soil`): the
   lines and the days under them are set from the Flower alarm tile on
   House → More, and the same verdict is the Needs-attention item, so the
   flower and the chip can never disagree.

   PC temperatures (2026-10-22, Alex: "in the temperature statistics, add a
   new category and call it PC temperatures"): a tab after Soil moisture for
   the computers' own sensors — CPUs, GPUs, disks — whose history the server
   keeps in Home Assistant like a room's (backend/app/pctemps.py). It is there
   only when GET /api/pctemps names a machine with sensors (asked when the
   chart opens, then kept up over SSE `pctemps`); an answer that fails, as on
   a kitchen without it, is no tab. Its chips are the machines' sensors,
   named by the server — each machine's CPU and GPU on at first, the chipset,
   disks, RAM and the rest a tap away (isOff), because seventeen lines at once
   are a tangle; its history is /api/pctemps/history, in the shape the
   rooms' is; with one line on, its too-hot line and the level its unusual
   heat starts at are drawn across it. The PC temperatures sheet's 📈 opens the
   chart straight onto it (openPc). */

const SHEET_ID = 'cl-sheet';

// One range at a time, and the one the wall is most often asked for first.
const DEFAULT_RANGE = 'day';

/* The colour a sensor's line is drawn in. Deliberately *not* red or blue:
   those two are spoken for — red marks a temperature peak and blue a humidity
   peak, in every chart here — and a line the same colour as the marks on it
   is a chart that cannot say which is which. These are the panel hues the
   rest of the wall already uses, in the order sensors are configured, so a
   third and a fourth sensor are already dressed. */
/* Since 2026-10-21: eight hues stepped for a dark surface, in an order
   checked on this sheet's own (#1c1a16) with the dataviz validator — every
   neighbouring pair apart for each kind of colour-blindness (ΔE ≥ 8.4) and
   for everyone else (≥ 19.3), each at least 3:1 on the surface. The panel
   hues they replace were all pastel and three of them nearly one green. A
   place keeps its colour (colourOf) whatever is switched off; the peaks wear
   their line's colour, not a red and a blue of their own. */
const LINE_COLOURS = ['#3987e5', '#d95926', '#199e70', '#c98500', '#d55181', '#008300', '#9085e9', '#e66767'];
const KEEP_KEY = 'kitchen.climate.chart';

/* The flower, drawn rather than typed: an emoji is a picture with its own
   colours, and this one has to BE the colour. Five petals and a heart, in
   currentColor, so the level is one class on the element. */
const FLOWER_SVG = `<svg viewBox="0 0 24 24" aria-hidden="true"><g fill="currentColor">
  <circle cx="12" cy="6.4" r="3.7"/><circle cx="17.3" cy="10.3" r="3.7"/>
  <circle cx="15.3" cy="16.5" r="3.7"/><circle cx="8.7" cy="16.5" r="3.7"/>
  <circle cx="6.7" cy="10.3" r="3.7"/></g>
  <circle cx="12" cy="12" r="2.7" fill="#14120f" fill-opacity="0.45"/></svg>`;

const LEVEL_WORDS = { ok: 'fine', dry: 'getting dry', water: 'need water' };

/* The two metrics, and everything that differs between them in one place:
   which entity carries them, how they are printed, and how much headroom the
   chart leaves round the line. A metric is never special-cased below. */
const METRICS = [
  {
    key: 'temp',
    icon: '🌡️',
    label: 'Temperature',
    unit: '°',
    entity: (r) => r.temp_entity,
    // One decimal on a chart's axis is noise from two metres away; the
    // readings and the peak labels keep theirs, because those are read close.
    fmt: (v) => (v == null ? '—' : `${v.toFixed(1)}°`),
    axis: (v) => `${Math.round(v)}°`,
    // A room swinging between 21.4 and 22.1 all day is a flat line, and drawn
    // to fit it would be a mountain range. Never less than this many degrees
    // top to bottom, so a still day looks like a still day.
    span: 4,
  },
  {
    key: 'hum',
    icon: '💧',
    label: 'Humidity',
    unit: '%',
    entity: (r) => r.hum_entity,
    fmt: (v) => (v == null ? '—' : `${Math.round(v)}%`),
    axis: (v) => `${Math.round(v)}%`,
    span: 10,
  },
  {
    key: 'soil',
    icon: '🌷',
    label: 'Soil moisture',
    unit: '%',
    entity: (r) => r.soil_entity,
    fmt: (v) => (v == null ? '—' : `${Math.round(v)}%`),
    axis: (v) => `${Math.round(v)}%`,
    span: 10,
    // The two lines a pot is judged by, drawn across the chart — and always
    // inside it, because "how far above watering is it" is the question.
    soil: true,
  },
  {
    // The computers' sensors: a temperature each (`field`), from a history
    // and a list of their own (`pc`) rather than the rooms'.
    key: 'pc',
    icon: '🖥️',
    label: 'PC temperatures',
    unit: '°',
    field: 'temp',
    pc: true,
    entity: () => '',
    fmt: (v) => (v == null ? '—' : `${v.toFixed(1)}°`),
    axis: (v) => `${Math.round(v)}°`,
    span: 6,
  },
];
const PC = METRICS.find((m) => m.pc);
/* The computers' sensors whose lines are on until taken off: each machine's
   CPU and GPU (isOff), which take their colours first too (pcSlots). */
const startsOn = (r) => ['cpu', 'gpu'].includes(r.kind);

const PAD = { l: 52, r: 150, t: 18, b: 26 };  // inside a chart's own box; the right is the lines' names
/* A chart's viewBox is set to the pixels it is actually drawn in, measured
   when it is drawn, rather than to a round 1000. With preserveAspectRatio
   "none" — which is what lets a chart fill its width without the line going
   diagonal-thin at one end — the two axes scale independently, and a fixed
   1000 across a 1,850px sheet stretched every label 1.85 times wider than it
   was tall. Same number in both places is no scaling at all, so the type is
   the type. Redrawn on a resize, which on this wall means a panel expanding. */
/* Both a chart's dimensions are measured for the same reason, and its height
   is shared out rather than fixed: two charts and nothing else are in this
   window, so they take half of it each. At 260px apiece they sat in the top
   third of a 1080 wall with the bottom half empty. */
const VB_H_MIN = 210;
const VB_W_MIN = 320;
const HEADING_H = 38;     // a chart's own <h3>, measured once and not again
const SOURCES_SHOWN = 4;  // who drew a line: the last few, never a paragraph

function esc(s) {
  return String(s).replace(/[&<>"]/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

/* How long a sensor's alert waits, in the words of the Sensors sheet
   (sensors.js afterWords, and sensors.py after_words on the server): this
   file goes into the public demo on its own, so it cannot import that one. */
function afterWords(minutes) {
  const m = Math.round(Number(minutes) || 0);
  if (m <= 0) return 'at once';
  if (m < 60) return `${m} min`;
  return `${Math.floor(m / 60)} h${m % 60 ? ` ${m % 60} min` : ''}`;
}

/* Is this state a number we can print? Home Assistant says "unavailable" and
   "unknown" for a sensor whose battery has gone or whose Zigbee router is
   down, and both of those are strings that Number() turns into NaN. */
function num(state) {
  if (!state || state.s == null) return null;
  const v = Number(state.s);
  return Number.isFinite(v) ? v : null;
}

export default {
  rooms: [],
  barRooms: [],
  metrics: [],
  states: {},
  range: DEFAULT_RANGE,
  data: null,
  loading: false,
  sig: null,
  off: new Set(),     // the places taken off the chart on this screen
  on: new Set(),      // ...and the computers' sensors put on that start off (isOff)
  metric: 'temp',     // the figure the chart shows
  pc: null,           // GET /api/pctemps: the computers and their sensors now
  pcData: null,       // their history, for one range

  init(ctx) {
    this.ctx = ctx;
    this.soil = null;                 // soil.py's verdict per pot, from SSE
    this.bar = document.getElementById('hd-climate');
    if (this.bar) this.wireBar();
    this.buildMini();
    this.buildSheet();
    this.setRooms(ctx.config.entities.climate || []);

    ctx.bus.on('ha_states', (s) => { this.states = s || {}; this.paint(); });
    ctx.bus.on('soil', (d) => { this.soil = d && Array.isArray(d.pots) ? d : null; this.paint(); });
    // A sensor moved on the Sensors card (sensors.py): the places it is shown.
    ctx.bus.on('sensors', (d) => {
      if (!d || !Array.isArray(d.climate)) return;
      this.setRooms(d.climate);
      // The statistics name each place's sensor: redrawn if the chart is up.
      if (this.data && !this.current().pc && this.sheet?.classList.contains('open')) {
        this.statsEl.innerHTML = this.stats(this.current(), this.data);
      }
    });
    // The computers now: their chips' figures, and whether there is a tab.
    ctx.bus.on('pctemps', (d) => { if (d && Array.isArray(d.machines)) this.takePc(d); });
    /* The charts are drawn at the pixel width they were measured at, so a
       window that changes size has to draw them again — otherwise the line
       stops short of the right edge, or runs off it. Only while the sheet is
       open; nothing is measured behind a closed one. */
    addEventListener('resize', () => {
      if (this.sheet?.classList.contains('open') && this.shown()) this.draw();
    });
    this.paint();
  },

  /* The places a reading is shown, and everything drawn from them. Only when
     the list really changed: the same snapshot arrives with every reconnect. */
  setRooms(list) {
    const rooms = (list || []).filter((c) => c && (c.temp_entity || c.hum_entity || c.soil_entity));
    const sig = JSON.stringify(rooms);
    if (sig === this.sig) return;
    this.sig = sig;
    this.rooms = rooms;
    /* `bar: false` (the Entrance, 2026-10-18): in the chart and on its room's
       card, not in the top bar — three rooms fill it at 1920 — nor in the
       same readings over a picture. */
    this.barRooms = rooms.filter((r) => r.bar !== false);
    // The charts this house has: no soil sensor, no soil chart.
    this.pickMetrics();
    // Nothing for the bar: the card does not stand empty in the top bar, it
    // gives its width back to the bird box beside it.
    if (this.bar) {
      this.bar.hidden = !this.barRooms.length;
      this.fillBar();
    }
    this.fillMini();
    this.sheet.querySelector('.cl-title').innerHTML = `Temperature &amp; humidity${
      rooms.some((r) => r.soil_entity) ? ' · soil' : ''}`;
    // The history was the old places'; asked again if the chart is up. The
    // PC temperatures tab has chips and a history of its own, which a room's
    // sensor moving does not change.
    this.data = null;
    if (this.current().pc) this.buildMetrics();
    else {
      this.buildLegend(this.rooms);
      if (this.sheet.classList.contains('open')) this.load();
    }
    this.paint();
  },

  /* The tabs: the rooms' figures this house has sensors for, then the
     computers' once one has reported a sensor. */
  pickMetrics() {
    const base = METRICS.filter((m) => !m.pc && this.rooms.some((r) => m.entity(r)));
    this.metrics = this.pcRows().length ? [...base, PC] : base;
  },

  /* ---------------- the computers (PC temperatures) ---------------- */

  /* Every sensor of every machine now, as a chip: named by the server. */
  pcRows() {
    const out = [];
    for (const m of this.pc?.machines || []) {
      for (const s of m.sensors || []) {
        const label = `${m.label} ${s.label}`;
        out.push({ key: `pc:${m.id}:${s.sid}`, label, short: label, pc: true, machine: m.id, sensor: s.sid,
                   kind: s.kind });
      }
    }
    return out;
  },

  /* The tab's chips: the sensors now, then any the history has that are not
     reporting now (a disk taken out), so a line on the chart has its chip. */
  pcLegend(d) {
    const rows = this.pcRows();
    const keys = new Set(rows.map((r) => r.key));
    for (const r of d?.rooms || []) if (!keys.has(r.key)) rows.push({ ...r, pc: true });
    return rows;
  },

  pcSensor(r) {
    const m = (this.pc?.machines || []).find((x) => x.id === r.machine);
    return { m, s: (m?.sensors || []).find((x) => x.sid === r.sensor) };
  },

  /* GET /api/pctemps, when the chart opens: a failed answer is no tab. */
  async fetchPc() {
    let d = null;
    try {
      const r = await fetch('/api/pctemps', { cache: 'no-store' });
      d = r.ok ? await r.json() : null;
    } catch { d = null; }
    this.takePc(d && Array.isArray(d.machines) ? d : null);
  },

  /* The computers now: the tab comes or goes, and its chips' figures follow. */
  takePc(doc) {
    const before = this.current().key;
    this.pc = doc;
    this.pickMetrics();
    if (!this.sheet?.classList.contains('open')) return;
    if (this.current().key !== before) this.showTab();
    else {
      this.buildMetrics();
      if (this.current().pc) {
        // A sensor that came or went is a chip that comes or goes.
        const want = this.pcLegend(this.pcData).map((r) => r.key).join('|');
        if (want !== (this.legendRooms || []).map((r) => r.key).join('|')) {
          this.buildLegend(this.pcLegend(this.pcData));
          this.draw();
        }
        this.paintLegend();
      }
    }
  },

  /* The PC temperatures sheet's 📈: the chart, straight onto the tab. */
  openPc(doc) {
    if (doc && Array.isArray(doc.machines)) { this.pc = doc; this.pickMetrics(); }
    this.open('pc');
  },

  /* The history the tab up now draws from. */
  shown() {
    return this.current().pc ? this.pcData : this.data;
  },

  /* The tab up now: its chips, and its history — fetched when `fresh` (the
     chart opening) or when it is not here for this range already. */
  showTab(fresh = false) {
    const pc = !!this.current().pc;
    const d = pc ? this.pcData : this.data;
    this.buildLegend(pc ? this.pcLegend(d) : [...this.rooms, ...((d?.rooms || []).filter((x) => x.gone))]);
    this.paintLegend();
    if (!fresh && d && d.range === this.range) this.draw();
    else this.load();
  },

  /* ---------------- what they say now ---------------- */

  /* One sensor's pair of readings. Handed out to panels/ha.js as well, so a
     light card and the top bar can never round the same sensor differently.

     `states` is the caller's own copy of ha_states, and passing it is not
     optional politeness — it is what keeps the light cards correct. Every
     panel is started before this module is, so panels/ha.js is on the bus
     ahead of it and is handed each batch of states first: reading out of
     *this* module's copy meant the House tab drew every card from the states
     as they were one event ago, which on a quiet evening is an empty string
     that stays empty until somebody turns a lamp on. */
  reading(room, states) {
    // A computer's sensor: its figure from the server's snapshot, and no %.
    if (room.pc) {
      const c = this.pcSensor(room).s?.c ?? null;
      return { temp: c, hum: null, tempText: PC.fmt(c), humText: '', ok: c != null };
    }
    const src = states || this.states;
    const t = num(src[room.temp_entity]);
    // A pot's % is its soil's, in the same place a room's humidity stands.
    const h = num(src[room.soil_entity || room.hum_entity]);
    return {
      temp: t, hum: h,
      tempText: METRICS[0].fmt(t),
      humText: METRICS[1].fmt(h),
      // Both dashes means nothing has arrived — a sensor out of battery, or a
      // dashboard that has not heard from Home Assistant yet. Worth saying
      // quietly rather than printing "—° —%" as though it were a reading.
      ok: t != null || h != null,
    };
  },

  fillBar() {
    this.bar.innerHTML = this.barRooms.map((r, i) => `
      <span class="cl-cell${r.soil_entity ? ' soil' : ''}" data-k="${esc(r.key || i)}">
        <span class="cl-name">${this.flower(r)}${esc(r.short || r.label || '')}</span>
        <span class="cl-vals"><b class="cl-t">—</b><i class="cl-h">—</i></span>
      </span>`).join('');
    // A soil sensor's top-bar % is not a humidity; the tooltip says what it is.
    for (const [i, r] of this.barRooms.entries()) {
      if (r.soil_entity) this.bar.children[i].title = `${r.label || r.short}: temperature and soil moisture`;
    }
  },

  wireBar() {
    this.bar.setAttribute('role', 'button');
    this.bar.setAttribute('tabindex', '0');
    this.bar.setAttribute('aria-label', 'temperature and humidity, and their history');
    this.bar.title = 'temperature and humidity — tap for the history';
    const open = () => this.open();
    this.bar.addEventListener('click', open);
    this.bar.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(); }
    });
  },

  /* The same readings over a picture, where the top bar is covered. Built
     once and moved in and out by app.js — the bird box's mini does exactly
     this, and for the same reason: two of them would be two to keep painted. */
  buildMini() {
    this.mini = document.createElement('button');
    this.mini.className = 'hx-clim';
    this.mini.title = 'temperature and humidity — tap for the history';
    this.mini.addEventListener('click', () => this.open());
  },

  fillMini() {
    this.mini.hidden = !this.barRooms.length;
    this.mini.innerHTML = this.barRooms.map((r) => `
      <span class="hx-cl-cell">
        <span class="hx-cl-name">${this.flower(r)}${esc(r.short || r.label || '')}</span>
        <span class="hx-cl-v"><b class="cl-t">—</b><i class="cl-h">—</i></span>
      </span>`).join('');
  },

  /* The flower in front of a soil sensor's name; nothing for any other. */
  flower(r) {
    return r.soil_entity ? `<i class="cl-flower">${FLOWER_SVG}</i>` : '';
  },

  mount(header, before) {
    if (!this.mini) return;             // expanded before init()
    if (header) header.insertBefore(this.mini, before || null);
    else this.mini.remove();
  },

  /* Values only, into whichever of the three places are on screen. No markup
     is written and no handler replaced, so this can run as often as Home
     Assistant likes. */
  paint() {
    for (const [root, rooms] of [[this.bar, this.barRooms], [this.mini, this.barRooms],
                                 [this.legendEl, this.legendRooms || this.rooms]]) {
      if (!root || !root.isConnected) continue;
      const cells = root.children;
      rooms.forEach((r, i) => {
        const cell = cells[i];
        if (!cell) return;
        const v = this.reading(r);
        const t = cell.querySelector('.cl-t');
        const h = cell.querySelector('.cl-h');
        if (t && t.textContent !== v.tempText) t.textContent = v.tempText;
        if (h && h.textContent !== v.humText) h.textContent = v.humText;
        cell.classList.toggle('stale', !v.ok);
        const fl = cell.querySelector('.cl-flower');
        if (fl) {
          const pot = (this.soil?.pots || []).find((p) => p.key === r.key);
          const lvl = pot?.level || '';
          if (fl.dataset.lvl !== lvl) fl.dataset.lvl = lvl;
          const say = `${r.label || r.short}: ${LEVEL_WORDS[lvl] || 'no reading yet'}`;
          if (fl.title !== say) fl.title = say;
        }
      });
    }
    // The chart's legend carries the live figure too, so a sheet left open
    // keeps up with the room rather than freezing at the minute it was opened.
    if (this.sheet && this.sheet.classList.contains('open')) this.paintLegend();
  },

  /* ---------------- the chart ----------------

     Rebuilt 2026-10-21 (Alex: "very messy, make it more clear, user
     friendly and more developed for the statistics part, that users can add
     remove sensor from the chart for clearer view or add all, make the
     colours more contrast"):

     - One figure at a time, as big as the sheet allows: Temperature,
       Humidity, Soil moisture are tabs, not three charts squeezed one under
       another.
     - Each place is a chip — its colour, its name, what it says now — and a
       tap takes its line off the chart or puts it back; All and None beside
       them. Which are off, and which figure is up, are kept on this screen.
     - Colours from a palette checked for contrast and colour-blindness on
       the sheet's own dark surface (LINE_COLOURS), each place keeping its
       colour whatever else is on or off; the line's name at its right end,
       so a colour never has to be remembered.
     - Beside the chart, the statistics: per place on the chart, now, the
       average, the low and the high and when, and how much it changed over
       the range — read off the recorder's own buckets.
     - With one place on, the band of its lows and highs behind its line, and
       the limits its sensor alerts at (sensors.py) as dashed rules. */

  buildSheet() {
    const el = document.createElement('div');
    el.id = SHEET_ID;
    // The settings window kit's frame and header (app.css): the chart is a
    // viewer, not settings, so its body is its own — the figures' tabs and
    // the places' chips, then the chart.
    el.className = 'sheet';
    el.innerHTML = `
      <header class="cl-head">
        <span class="sheet-icon" aria-hidden="true">🌡️</span>
        <div class="sheet-title">
          <h2 class="cl-title">Temperature &amp; humidity</h2>
          <span class="sheet-status cl-state"></span>
        </div>
        <span class="spacer"></span>
        <div class="cl-ranges ls-set sheet-seg" role="group" aria-label="how far back"></div>
        <button class="ls-close cl-close">Close</button>
      </header>
      <div class="cl-bar2">
        <div class="cl-metrics" role="tablist"></div>
        <div class="cl-legend" role="group" aria-label="the places on the chart"></div>
        <div class="cl-allnone"><button class="cl-an" data-an="all">All</button><button class="cl-an" data-an="none">None</button></div>
      </div>
      <div class="cl-main">
        <div class="cl-charts"></div>
        <aside class="cl-stats" aria-label="the statistics"></aside>
      </div>
      <div class="cl-note"></div>`;
    document.body.appendChild(el);
    this.sheet = el;

    el.querySelector('.cl-close').onclick = () => this.close();
    // The ranges are the backend's, not a list typed twice; until /api/climate
    // has answered there is one button, which is the one that is selected.
    this.rangesEl = el.querySelector('.cl-ranges');
    this.legendEl = el.querySelector('.cl-legend');
    this.metricsEl = el.querySelector('.cl-metrics');
    this.chartsEl = el.querySelector('.cl-charts');
    this.statsEl = el.querySelector('.cl-stats');
    this.noteEl = el.querySelector('.cl-note');
    this.buildRanges([{ key: 'day', label: '24 hours' }, { key: 'week', label: '7 days' },
                      { key: 'month', label: '30 days' }, { key: 'year', label: '12 months' }]);
    this.legendEl.addEventListener('click', (e) => {
      const k = e.target.closest('.cl-key');
      if (!k) return;
      const key = k.dataset.k;
      if (this.isOff(key)) { this.off.delete(key); this.on.add(key); } else { this.off.add(key); this.on.delete(key); }
      this.keep();
      this.paintChips();
      this.draw();
    });
    el.querySelectorAll('.cl-an').forEach((b) => {
      b.onclick = () => {
        this.setAll(b.dataset.an === 'all');
        this.paintChips();
        this.draw();
      };
    });
    this.metricsEl.addEventListener('click', (e) => {
      const b = e.target.closest('.cl-metric');
      if (!b || b.dataset.m === this.metric) return;
      const wasPc = !!this.current().pc;
      this.metric = b.dataset.m;
      this.keep();
      this.buildMetrics();
      // To or from the computers: other chips, another history.
      if (!!this.current().pc !== wasPc) this.showTab();
      else this.draw();
    });
    // What this screen chose last: the figure, the places taken off, and the
    // computers' sensors put on.
    try {
      const saved = JSON.parse(localStorage.getItem(KEEP_KEY) || '{}');
      if (Array.isArray(saved.off)) saved.off.forEach((k) => this.off.add(String(k)));
      if (Array.isArray(saved.on)) saved.on.forEach((k) => this.on.add(String(k)));
      if (typeof saved.metric === 'string') this.metric = saved.metric;
    } catch { /* a private window: the defaults */ }
  },

  keep() {
    try {
      localStorage.setItem(KEEP_KEY, JSON.stringify({ off: [...this.off], on: [...this.on], metric: this.metric }));
    } catch { /* not kept; it still works */ }
  },

  /* Whether a chip's line is off: taken off on this screen — or, for a
     computer's sensor that is not a CPU or a GPU, not put on yet. Seventeen
     lines on one chart is a tangle; each machine's main one is what the card
     on Automation shows too, and the rest are a tap away. */
  isOff(key) {
    if (this.off.has(key)) return true;
    if (!String(key).startsWith('pc:') || this.on.has(key)) return false;
    const r = (this.legendRooms || []).find((x) => x.key === key)
      || (this.pcData?.rooms || []).find((x) => x.key === key);
    return !!r && !startsOn(r);
  },

  /* All and None: every chip of the tab up now on, or off — and only its
     own. The rooms' and the computers' chips are two legends since PC
     temperatures, and All on one of them once brought back the places taken
     off on the other. */
  setAll(on) {
    for (const k of (this.legendRooms || this.rooms).map((r) => r.key)) {
      if (on) {
        this.off.delete(k);
        if (k.startsWith('pc:')) this.on.add(k);
      } else {
        this.off.add(k);
        this.on.delete(k);
      }
    }
    this.keep();
  },

  buildRanges(ranges) {
    this.rangesEl.innerHTML = ranges.map((r) =>
      `<button class="ls-btn cl-range${r.key === this.range ? ' on' : ''}" aria-pressed="${r.key === this.range}"
               data-r="${esc(r.key)}">${esc(r.label)}</button>`).join('');
    this.rangesEl.querySelectorAll('.cl-range').forEach((b) => {
      b.onclick = () => this.setRange(b.dataset.r);
    });
    this.paintState();
  },

  /* The header's line: the figure up and how far back it goes. */
  paintState() {
    const el = this.sheet?.querySelector('.cl-state');
    if (!el) return;
    const range = this.rangesEl?.querySelector('.cl-range.on')?.textContent.trim() || '';
    const html = `<b>${esc(this.current().label)}</b>${range ? ` · ${esc(range)}` : ''}`;
    if (this.ctx?.sheetkit) this.ctx.sheetkit.status(el, html);
    else el.innerHTML = html;
  },

  /* The figure up: one of the house's (no soil sensor, no soil tab). */
  current() {
    return this.metrics.find((m) => m.key === this.metric) || this.metrics[0] || METRICS[0];
  },

  buildMetrics() {
    const cur = this.current();
    this.metricsEl.innerHTML = this.metrics.map((m) => `<button class="cl-metric${m.key === cur.key ? ' on' : ''}"
      role="tab" aria-selected="${m.key === cur.key}" data-m="${m.key}">${m.icon} ${esc(m.label)}</button>`).join('');
    this.paintState();
  },

  /* A place's colour: by its place in the list, never by what else is on —
     a line keeps its colour when another is taken off. The computers'
     sensors have theirs from pcSlots, worked out once per list. */
  colourOf(key) {
    const list = this.legendRooms || this.rooms;
    if (list.some((r) => r.pc)) {
      if (this.slotsOf !== list) { this.slots = this.pcSlots(list); this.slotsOf = list; }
      const slot = this.slots.get(key);
      if (slot != null) return LINE_COLOURS[slot];
    }
    const i = Math.max(0, list.findIndex((r) => r.key === key));
    return LINE_COLOURS[i % LINE_COLOURS.length];
  },

  /* The computers' sensors' colours. Their tab has nineteen chips for eight
     colours, and by place in the list the CPUs and GPUs that start on came
     out in pairs: one machine's CPU and another's GPU the same blue, two
     CPUs the same red. So the lines that start on are given theirs first, then
     the rest; each takes the colour given least so far that no other sensor
     of its own machine has — a machine's chipset beside its CPU is the
     comparison somebody makes. Still from the list alone, never from what
     is on, so a line keeps its colour when another is taken off or put on. */
  pcSlots(list) {
    const given = LINE_COLOURS.map(() => 0);
    const mine = new Map();               // machine -> the colours its sensors have
    const slots = new Map();
    const give = (r) => {
      const own = mine.get(r.machine) || new Set();
      const free = own.size < given.length;
      let best = -1;
      for (let i = 0; i < given.length; i += 1) {
        if (free && own.has(i)) continue;
        if (best < 0 || given[i] < given[best]) best = i;
      }
      given[best] += 1;
      own.add(best);
      mine.set(r.machine, own);
      slots.set(r.key, best);
    };
    list.filter((r) => startsOn(r)).forEach(give);
    list.filter((r) => !startsOn(r)).forEach(give);
    return slots;
  },

  /* The chips are the legend: the places shown now, then — once a history
     has arrived — any place a sensor has left in that time, whose line ends
     at the move. */
  buildLegend(list) {
    this.legendRooms = list;
    this.legendEl.innerHTML = list.map((r) => `
      <button class="cl-key${r.gone ? ' gone' : ''}" data-k="${esc(r.key)}" aria-pressed="true">
        <i class="cl-swatch" style="--c:${this.colourOf(r.key)}"></i>
        <span class="cl-key-name">${this.flower(r)}${esc(r.short || r.label || '')}${
          r.gone ? '<small> · no sensor now</small>' : ''}</span>
        <span class="cl-key-now"><b class="cl-t">—</b><i class="cl-h">—</i></span>
      </button>`).join('');
    this.buildMetrics();
    this.paintChips();
  },

  paintChips() {
    this.legendEl.querySelectorAll('.cl-key').forEach((k) => {
      const on = !this.isOff(k.dataset.k);
      k.classList.toggle('off', !on);
      k.setAttribute('aria-pressed', String(on));
    });
  },

  paintLegend() {
    const keys = this.legendEl.querySelectorAll('.cl-key');
    (this.legendRooms || this.rooms).forEach((r, i) => {
      const k = keys[i];
      if (!k) return;
      const v = this.reading(r);
      k.querySelector('.cl-t').textContent = v.tempText;
      k.querySelector('.cl-h').textContent = v.humText;
    });
  },

  /* `metric`: the tab to open on ('pc' from the PC temperatures sheet). A tab
     asked for that is not there yet — the computers not fetched — opens when
     they are: the wish is kept in this.metric, current() falls back. */
  open(metric) {
    if (!this.sheet) return;
    if (typeof metric === 'string') { this.metric = metric; this.keep(); }
    this.sheet.classList.add('open');
    this.showTab(true);
    this.fetchPc();
  },

  close() {
    if (this.sheet) this.sheet.classList.remove('open');
  },

  setRange(name) {
    if (!name || name === this.range) return;
    this.range = name;
    this.rangesEl.querySelectorAll('.cl-range').forEach((b) => {
      b.classList.toggle('on', b.dataset.r === name);
      b.setAttribute('aria-pressed', String(b.dataset.r === name));
    });
    this.paintState();
    this.load();
  },

  async load() {
    const want = this.range;
    const pc = !!this.current().pc;
    this.loading = true;
    this.note('Reading the history…');
    try {
      const r = await fetch(pc ? `/api/pctemps/history?range=${encodeURIComponent(want)}`
        : `/api/climate/history?range=${encodeURIComponent(want)}`);
      const d = await r.json();
      // A later range, or the other kind of tab, won the race.
      if (want !== this.range || pc !== !!this.current().pc) return;
      if (!r.ok) throw new Error(d.error || 'the history could not be read');
      if (pc) {
        for (const x of d.rooms || []) x.pc = true;      // read as a computer's (reading, limits)
        this.pcData = d;
        this.buildLegend(this.pcLegend(d));
      } else {
        this.data = d;
        // The places a sensor has left, after the ones shown now.
        const gone = (d.rooms || []).filter((x) => x.gone);
        this.buildLegend([...this.rooms, ...gone]);
      }
      this.paintLegend();
      this.draw();
      this.note(d.stale
        ? 'Home Assistant is not answering — this is the last history it gave.'
        : '');
    } catch (e) {
      if (want !== this.range || pc !== !!this.current().pc) return;
      if (pc) this.pcData = null;
      else this.data = null;
      this.chartsEl.innerHTML = '';
      this.statsEl.innerHTML = '';
      this.note(String(e.message || e));
    } finally {
      this.loading = false;
    }
  },

  note(text) {
    this.noteEl.textContent = text || '';
    this.noteEl.hidden = !text;
  },

  /* The places on the chart for figure m: on, and with something recorded. */
  visible(m, d) {
    return (d.rooms || []).filter((r) => !this.isOff(r.key)).map((r) => ({
      key: r.key,
      label: r.label,
      short: r.short || r.label,
      gone: !!r.gone,
      room: r,
      colour: this.colourOf(r.key),
      ...(r[m.field || m.key] || { points: [] }),
    })).filter((x) => x.points && x.points.length);
  },

  draw() {
    const d = this.shown();
    if (!d || !this.sheet.classList.contains('open')) return;
    /* The width the chart will really have: the box's content, its padding
       taken off — clientWidth includes padding, and a viewBox wider than the
       box it is painted into stretches every label. */
    const cs = getComputedStyle(this.chartsEl);
    const inner = this.chartsEl.clientWidth
      - parseFloat(cs.paddingLeft || 0) - parseFloat(cs.paddingRight || 0);
    this.vbw = Math.max(VB_W_MIN, Math.round(inner) || VB_W_MIN);
    // The room for the lines' names at the right is the chart's to work out
    // (endNames), from the names it draws.
    const room = this.chartsEl.clientHeight
      - parseFloat(cs.paddingTop || 0) - parseFloat(cs.paddingBottom || 0);
    this.vbh = Math.max(VB_H_MIN, Math.floor(room - HEADING_H) || VB_H_MIN);
    const m = this.current();
    this.chartsEl.innerHTML = this.chart(m, d);
    this.statsEl.innerHTML = this.stats(m, d);
    this.wireScrub();
  },

  /* The alerts of the sensor a place's figure comes from (sensors.py,
     through ctx.sensors), for the one place on the chart: since 2026-10-22
     a rule each — every rule on the figure shown is its own dashed line,
     with its side, level and how long past it counts, so two on one figure
     ("warmer than 26° for 2 h", "warmer than 30° at once") are two lines. */
  limitsFor(r, m) {
    if (m.pc) return this.pcLimits(r);
    if (m.soil) {
      return r.water_below == null ? [] : [{ v: r.water_below, cls: 'water', txt: `water below ${r.water_below}%` },
        { v: r.dry_below, cls: 'dry', txt: `dry below ${r.dry_below}%` }];
    }
    const now = (this.rooms || []).find((x) => x.key === r.key);
    const sid = now && (now.sensors || [])[0];
    const sensor = sid && (this.ctx?.sensors?.doc?.sensors || []).find((x) => x.id === sid);
    const rules = Array.isArray(sensor?.alerts?.rules) ? sensor.alerts.rules : [];
    return rules.filter((x) => x && x.metric === m.key && Number.isFinite(x.level)
      && (x.side === 'above' || x.side === 'below'))
      .map((x) => ({ v: x.level, cls: 'alert', txt: `alert ${x.side} ${m.fmt(x.level)} · ${afterWords(x.after_min)}` }));
  },

  /* A computer's sensor's two lines (pctemps.py): too hot above its line,
     and — once it has learnt what is usual — where unusual heat begins, its
     usual high and the machine's margin over it. */
  pcLimits(r) {
    const { m, s } = this.pcSensor(r);
    const cfg = m?.settings?.sensors?.[r.sensor];
    const out = [];
    if (cfg?.above != null) out.push({ v: cfg.above, cls: 'alert', txt: `too hot above ${Math.round(cfg.above)}°` });
    if (cfg?.unusual && s && !s.learning && s.high != null) {
      const v = s.high + (m.settings.margin ?? 10);
      out.push({ v, cls: 'unusual', txt: `unusual above ${Math.round(v)}°` });
    }
    return out;
  },

  /* Beside a computer's figures: what is usual for it, from the server. */
  pcLine(r) {
    const { s } = this.pcSensor(r);
    if (!s) return '';
    const said = s.learning
      ? `learning its usual — ${s.hours} h of ${this.pc?.learn_hours || 48}`
      : `usually ${Math.round(s.usual)}°, up to ${Math.round(s.high)}°`;
    return `<div class="cl-st-src">🖥️ ${esc(said)}</div>`;
  },

  /* The room at the chart's right for its lines' names (PAD.r), and the
     names as they fit there. A room's name ("Kitchen 21.4°") always fitted
     the 150 it had, 104 on a phone; a computer's is "<machine> <sensor>",
     and a laptop's "… Chipset 36.0°" ran off the wall's chart. So the widest
     name as it is drawn sets it: never less than before, never more than
     two fifths of the chart, and a name too long even for that — on a phone
     only — is cut with an ellipsis. */
  endNames(texts, vbw, narrow) {
    const LEAD = 12 + 6;                    // the plot's edge to a name, and its halo past the end
    const least = narrow ? 104 : 150;
    const most = Math.max(least, Math.round((vbw * 2) / 5));
    const widest = texts.reduce((w, t) => Math.max(w, this.textWidth(t)), 0);
    PAD.r = Math.min(most, Math.max(least, Math.ceil(widest + LEAD)));
    const room = PAD.r - LEAD;
    return texts.map((t) => {
      if (this.textWidth(t) <= room) return t;
      let cut = t;
      while (cut.length > 1 && this.textWidth(`${cut}…`) > room) cut = cut.slice(0, -1);
      return `${cut.trimEnd()}…`;
    });
  },

  /* How wide a line's name is drawn, in the chart's units — its viewBox is
     the pixels it is drawn in, so a unit is a pixel: a text of the names'
     own class, kept out of sight in the sheet, measured in the font the
     sheet really has. With no page to measure on (the tests), 8.6 a
     character, a little over what the wall's font takes. */
  textWidth(text) {
    if (typeof document === 'undefined' || !this.sheet) return text.length * 8.6;
    if (!this.measurer?.isConnected) {
      const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      svg.setAttribute('aria-hidden', 'true');
      svg.style.cssText = 'position:absolute;left:0;top:0;width:0;height:0;visibility:hidden;pointer-events:none';
      svg.innerHTML = '<g class="cl-end"><text></text></g>';
      this.sheet.appendChild(svg);
      this.measurer = svg.querySelector('text');
    }
    this.measurer.textContent = text;
    return this.measurer.getComputedTextLength();
  },

  /* One figure, the places that are on, one drawing.

     A line rather than the labelled bars the rest of this wall prefers: this
     answers "what shape was the day", where the between is the whole content
     — a night dropping two degrees, a cooker at six. What the bar rule is
     against is a picture with no numbers on it, and nothing here is without
     one: each line is named at its end, the axis is printed, the statistics
     stand beside it, and a finger anywhere on the chart prints every
     reading and the minute under it. */
  chart(m, d) {
    const VB_W = this.vbw;
    const VB_H = this.vbh;
    const series = this.visible(m, d);
    const shownCount = (d.rooms || []).filter((r) => (r[m.field || m.key] || {}).points?.length).length;
    const place = m.pc ? 'sensor' : 'place';

    if (!series.length) {
      return `<section class="cl-chart empty">
        <p class="cl-empty">${shownCount
          ? `Every ${place} is off — tap a ${place} above, or All.`
          : m.pc
            ? `Nothing recorded over ${esc(d.label)}. Home Assistant keeps these from a computer's first report, so this fills itself in.`
            : `Nothing recorded over ${esc(d.label)}. Home Assistant keeps these from the moment a sensor is paired, so this fills itself in.`}</p>
      </section>`;
    }

    // The scale covers every line's extremes, not its means: a high drawn
    // outside the box would be a mark with nothing under it.
    let lo = Infinity;
    let hi = -Infinity;
    for (const s of series) {
      for (const p of s.points) {
        lo = Math.min(lo, p.lo == null ? p.v : p.lo);
        hi = Math.max(hi, p.hi == null ? p.v : p.hi);
      }
    }
    const one = series.length === 1;
    const limits = one ? this.limitsFor(series[0].room, m) : [];
    for (const l of limits) { lo = Math.min(lo, l.v); hi = Math.max(hi, l.v); }
    if (hi - lo < m.span) {                 // a still day is drawn as a still day
      const mid = (hi + lo) / 2;
      lo = mid - m.span / 2;
      hi = mid + m.span / 2;
    }
    const pad = (hi - lo) * 0.1;
    lo -= pad;
    hi += pad;
    // Moisture and humidity are shares: an axis reading -4 % is padding pretending to be data.
    if (m.unit === '%') { lo = Math.max(0, lo); hi = Math.min(100, hi); }

    // A phone's chart is a third as wide: half the times along its foot, and
    // the lines' names without their figures (the chips and the statistics
    // have them).
    const narrow = VB_W < 700;
    // Each line's name for its right end, and the room they take there — set
    // before anything is placed across the chart's width.
    const names = this.endNames(series.map((s) => (narrow ? s.short
      : `${s.short} ${m.fmt(s.points[s.points.length - 1].v)}`)), VB_W, narrow);

    const t0 = d.from;
    const t1 = d.to;
    const x = (t) => PAD.l + ((t - t0) / Math.max(1, t1 - t0)) * (VB_W - PAD.l - PAD.r);
    const y = (v) => PAD.t + (1 - (v - lo) / (hi - lo)) * (VB_H - PAD.t - PAD.b);

    // Five gridlines and their figures: enough to read a value off the chart,
    // few enough that the lines stay the loudest thing on it.
    const ticks = [0, 1, 2, 3, 4, 5].map((i) => lo + ((hi - lo) * i) / 5);
    const grid = ticks.map((v) => `
      <line class="cl-grid" x1="${PAD.l}" x2="${VB_W - PAD.r}"
            y1="${y(v).toFixed(1)}" y2="${y(v).toFixed(1)}"/>
      <text class="cl-ax" x="${PAD.l - 8}" y="${(y(v) + 4).toFixed(1)}"
            text-anchor="end">${m.axis(v)}</text>`).join('');
    const xt = this.timeTicks(t0, t1, d.period, narrow ? 3 : 6);
    const xticks = xt.map((t) => `
      <line class="cl-vgrid" x1="${x(t.t).toFixed(1)}" x2="${x(t.t).toFixed(1)}" y1="${PAD.t}" y2="${VB_H - PAD.b}"/>
      <text class="cl-ax" x="${x(t.t).toFixed(1)}" y="${VB_H - 8}"
            text-anchor="middle">${esc(t.label)}</text>`).join('');

    // The band of lows and highs behind a line: where the recorder's bucket
    // hid a swing, the band is the swing. For one or two lines only — more
    // would be a fog. Not for five-minute buckets, where it is the line itself.
    const bands = series.length <= 2 && d.period !== '5minute' ? series.map((s) => {
      const top = s.points.map((p) => `${x(p.t).toFixed(1)},${y(p.hi ?? p.v).toFixed(1)}`);
      const bot = s.points.slice().reverse().map((p) => `${x(p.t).toFixed(1)},${y(p.lo ?? p.v).toFixed(1)}`);
      return `<polygon class="cl-band" style="--c:${s.colour}" points="${top.concat(bot).join(' ')}"/>`;
    }).join('') : '';

    // Each rule's words just over its line, from the top down; two rules
    // at or near one level (the point of having several) would print one
    // over the other, so a label that would touch the one above it goes
    // under it instead.
    let lastTy = -Infinity;
    const limitLines = limits.slice().sort((a, b) => b.v - a.v).map((l) => {
      const ly = y(l.v);
      const ty = Math.max(ly - 6, lastTy + 18);
      lastTy = ty;
      return `
      <line class="cl-limit ${l.cls}" x1="${PAD.l}" x2="${VB_W - PAD.r}"
            y1="${ly.toFixed(1)}" y2="${ly.toFixed(1)}"/>
      <text class="cl-limit-t ${l.cls}" x="${PAD.l + 8}" y="${ty.toFixed(1)}">${esc(l.txt)}</text>`;
    }).join('');

    // A gap in the recording (a sensor away, or moved) is a gap in the line,
    // not a straight stroke across it.
    const span = (t1 - t0) / Math.max(2, Math.max(...series.map((s) => s.points.length)));
    const pathOf = (pts) => {
      let out = '';
      let prev = null;
      for (const p of pts) {
        const cmd = prev && p.t - prev.t <= span * 3.5 ? 'L' : 'M';
        out += `${cmd}${x(p.t).toFixed(1)} ${y(p.v).toFixed(1)}`;
        prev = p;
      }
      return out;
    };
    const lines = series.map((s) => `<path class="cl-line" style="--c:${s.colour}" d="${pathOf(s.points)}"/>`).join('');

    /* Each line's name at its right end — the colour never has to be
       remembered — pushed apart where two ends meet, and the high and the
       low of each as a ▲ and a ▼ in its colour, with figures beside them
       while there are few enough lines for the figures to be read. */
    const GAP = 19;
    const top = PAD.t + 8;
    const bottom = VB_H - PAD.b - 4;
    const ends = series.map((s, i) => {
      const last = s.points[s.points.length - 1];
      return { s, ty: y(last.v), py: y(last.v), px: x(last.t), text: names[i] };
    }).sort((a, b) => a.ty - b.ty);
    for (let i = 1; i < ends.length; i += 1) if (ends[i].ty - ends[i - 1].ty < GAP) ends[i].ty = ends[i - 1].ty + GAP;
    for (let i = ends.length - 1; i >= 0; i -= 1) {
      if (ends[i].ty > bottom) ends[i].ty = bottom;
      if (i && ends[i].ty - ends[i - 1].ty < GAP) ends[i - 1].ty = ends[i].ty - GAP;
    }
    for (const e of ends) e.ty = Math.min(bottom, Math.max(top, e.ty));
    const endLabels = ends.map((e) => `
      <g class="cl-end" style="--c:${e.s.colour}">
        <circle cx="${e.px.toFixed(1)}" cy="${e.py.toFixed(1)}" r="4.5"/>
        <line x1="${(e.px + 5).toFixed(1)}" y1="${e.py.toFixed(1)}" x2="${(VB_W - PAD.r + 8).toFixed(1)}" y2="${e.ty.toFixed(1)}"/>
        <text x="${(VB_W - PAD.r + 12).toFixed(1)}" y="${(e.ty + 5).toFixed(1)}">${esc(e.text)}</text>
      </g>`).join('');

    const words = series.length <= 3;
    const marks = series.flatMap((s) => [['hi', s.peak, '▲'], ['lo', s.trough, '▼']]
      .filter(([, pt]) => pt).map(([kind, pt, sign]) => {
        const px = x(pt.t);
        const py = y(pt.v);
        const anchor = px > VB_W - PAD.r - 140 ? 'end' : px < PAD.l + 140 ? 'start' : 'middle';
        const ty = kind === 'hi' ? Math.max(top + 4, py - 12) : Math.min(bottom, py + 22);
        return `<g class="cl-mark ${kind}" style="--c:${s.colour}">
          <text class="cl-sign" x="${px.toFixed(1)}" y="${(py + (kind === 'hi' ? -2 : 8)).toFixed(1)}" text-anchor="middle">${sign}</text>
          ${words ? `<text class="cl-mt" x="${px.toFixed(1)}" y="${ty.toFixed(1)}" text-anchor="${anchor}">${
            esc(`${series.length > 1 ? `${s.short} ` : ''}${m.fmt(pt.v)} · ${this.stamp(pt.t, d.period)}`)}</text>` : ''}
        </g>`;
      })).join('');

    return `<section class="cl-chart" data-m="${m.key}">
      <h3>${m.label} <span class="cl-sub">${esc(d.label)} · ${series.length} of ${shownCount} ${place}${shownCount === 1 ? '' : 's'}${
        d.period === '5minute' ? '' : ` · each point ${d.period === 'hour' ? 'an hour' : 'a day'}'s average, the shade its low to high`}</span></h3>
      <svg viewBox="0 0 ${VB_W} ${VB_H}" style="height:${VB_H}px" preserveAspectRatio="none"
           role="img" aria-label="${m.label} over ${esc(d.label)}">
        ${grid}${xticks}${bands}${limitLines}${lines}${marks}${endLabels}
        <line class="cl-cross off" x1="0" x2="0" y1="${PAD.t}" y2="${VB_H - PAD.b}"/>
      </svg>
      <div class="cl-scrub" hidden></div>
    </section>`;
  },

  /* Which sensor a place's figure comes from now (2026-10-21, Alex: "name
     what is the current sensor for each room"): the one sensors.py ranked
     first for this figure, by its name in Home Assistant, and how many more
     are in the room. Nothing before the sensors have been read.

     A room's line over a range can be several sensors' in turn, though (the
     kitchen's Sonoff up to its move to the TV room, the heat alarm's after
     it), and then the low, the high and the average are theirs too. So a
     line that is not simply the sensor in use now — a place with no sensor
     now included — names who drew it, from the history's `sources`:
     "📡 Sonoff until 19:02 · Heat alarm since", the time for today, the day
     for any other. */
  sourceLine(place, m, sources) {
    const all = this.ctx?.sensors?.doc?.sensors || [];
    const eid = place && (m.key === 'temp' ? place.temp_entity : m.key === 'hum' ? place.hum_entity : place.soil_entity);
    const sensor = eid && all.find((x) => [x.temp, x.hum, x.soil].includes(eid));
    const runs = (sources || []).filter((r) => r && r.sensor);
    if (!runs.length || (runs.length === 1 && runs[0].to == null && (!sensor || runs[0].sensor === sensor.id))) {
      if (!place || !sensor) return '';
      const others = (place.sensors || []).filter((id) => id !== sensor.id)
        .map((id) => all.find((x) => x.id === id)?.name).filter(Boolean);
      return `<div class="cl-st-src" title="${esc(sensor.model || '')}">📡 ${esc(sensor.name)}${
        others.length ? `<small>also in the room: ${esc(others.join(', '))}</small>` : ''}</div>`;
    }
    const shown = runs.slice(-SOURCES_SHOWN);
    const cut = shown.length < runs.length;
    const text = shown.map((r, i) => `<span title="${esc(r.model || '')}">${esc(r.name)}</span>${
      r.to != null ? ` until ${esc(this.when(r.to))}` : i || cut ? ' since' : ''}`).join(' · ');
    // The room's other sensors now, the ones the line does not name already.
    const named = new Set(runs.map((r) => r.sensor));
    const others = (place?.sensors || []).filter((id) => !named.has(id))
      .map((id) => all.find((x) => x.id === id)?.name).filter(Boolean);
    return `<div class="cl-st-src">📡 ${cut ? '… · ' : ''}${text}${
      others.length ? `<small>also in the room: ${esc(others.join(', '))}</small>` : ''}</div>`;
  },

  /* A moment in the statistics' words: "19:02" today, "20 Oct" any other day. */
  when(t) {
    const d = new Date(t);
    return d.toDateString() === new Date().toDateString()
      ? d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })
      : d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
  },

  /* Beside the chart, per place on it: now, the average, the low and the
     high and when, and the change from the start of the range to its end —
     the questions a line answers only to someone who reads it closely. */
  stats(m, d) {
    const series = this.visible(m, d);
    if (!series.length) return '';
    const fmt = m.fmt;
    // A computer's figure is a temperature too.
    const deg = m.key === 'temp' || !!m.pc;
    const rows = series.map((s) => {
      const pts = s.points;
      const avg = pts.reduce((a, p) => a + p.v, 0) / pts.length;
      const place = m.pc ? s.room : (this.rooms || []).find((x) => x.key === s.key);
      const live = s.gone || !place ? null : this.reading(place);
      const nowV = deg ? live?.temp : live?.hum;
      const change = s.last != null && s.first != null ? s.last - s.first : null;
      const arrow = change == null ? '' : Math.abs(change) < (deg ? 0.3 : 2) ? '→'
        : change > 0 ? '↗' : '↘';
      const dChange = change == null ? '—' : `${arrow} ${change > 0 ? '+' : change < 0 ? '−' : ''}${
        deg ? Math.abs(change).toFixed(1) + '°' : Math.round(Math.abs(change)) + '%'}`;
      return `<div class="cl-st">
        <div class="cl-st-h"><i class="cl-swatch" style="--c:${s.colour}"></i><b>${esc(s.label)}</b>${
          s.gone ? '<small>no sensor now</small>' : ''}</div>
        ${m.pc ? this.pcLine(s.room) : this.sourceLine(place, m, s.sources)}
        <dl>
          <div><dt>Now</dt><dd class="big">${nowV != null ? fmt(nowV) : fmt(s.last)}</dd></div>
          <div><dt>Average</dt><dd>${fmt(avg)}</dd></div>
          <div><dt>Low</dt><dd>${s.trough ? `${fmt(s.trough.v)} <small>${esc(this.stamp(s.trough.t, d.period))}</small>` : '—'}</dd></div>
          <div><dt>High</dt><dd>${s.peak ? `${fmt(s.peak.v)} <small>${esc(this.stamp(s.peak.t, d.period))}</small>` : '—'}</dd></div>
          <div><dt>Over ${esc(d.label)}</dt><dd>${dChange}</dd></div>
        </dl>
      </div>`;
    }).join('');
    return `<h3>${m.icon} ${esc(m.label)} <span class="cl-sub">${esc(d.label)}</span></h3>${rows}`;
  },

  /* Five or six times along the bottom, at whole hours or whole days rather
     than at even fractions of the range: "13:00" is a time, "12:47" is an
     arithmetic result. */
  timeTicks(t0, t1, period, n = 6) {
    const span = t1 - t0;
    const out = [];
    const day = 86400000;
    const byDay = span > day * 2.5;
    const step = byDay ? Math.ceil(span / day / n) : Math.ceil(span / n / 3600000);
    const d = new Date(t1);
    if (byDay) d.setHours(0, 0, 0, 0);
    else d.setMinutes(0, 0, 0);
    /* Back by calendar days and clock hours, each tick from the first one,
       not by fixed milliseconds: a day is 25 hours the Sunday the clocks go
       back, and stepping 86 400 000 put every midnight before it at 01:00,
       while the 24 hours went "09, 05, 02, 22" across it. */
    const day0 = d.getDate();
    const hour0 = d.getHours();
    for (let k = 0; ; k++) {
      const at = new Date(d);
      if (k && byDay) at.setDate(day0 - k * step);
      else if (k) at.setHours(hour0 - k * step);
      const t = at.getTime();
      if (!(t > t0)) break;                // NaN too: a range that is not one has no ticks
      /* The night the clocks go forward has no 02:00, and JS moves an hour
         asked for there on to 03:00, which read "06, 03, 22" on a step of
         four. A tick that is not at its own hour is left out. */
      if (!byDay && at.getHours() !== (((hour0 - k * step) % 24) + 24) % 24) continue;
      out.push({
        t,
        label: byDay
          ? new Date(t).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
          : new Date(t).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }),
      });
    }
    return out;
  },

  /* When something happened, said as precisely as the bucket allows and no
     more. An hourly bucket knows the hour, not the minute inside it, so it
     prints the hour; claiming "14:37" from it would be an invention. */
  stamp(t, period) {
    const d = new Date(t);
    const date = d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
    if (period === 'day') return date;
    const time = d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
    return `${date} ${time}`;
  },

  /* A finger anywhere on a chart: a line down it, and every sensor's reading
     at that moment with the date and time it was taken. This is the answer to
     "what was it at four o'clock", which no amount of labelling the extremes
     gives you. Pointer events, so the wall's touch and a mouse are one path. */
  wireScrub() {
    const d = this.shown();
    if (!d) return;
    this.chartsEl.querySelectorAll('.cl-chart:not(.empty)').forEach((sec) => {
      const m = METRICS.find((x) => x.key === sec.dataset.m);
      const svg = sec.querySelector('svg');
      const cross = sec.querySelector('.cl-cross');
      const out = sec.querySelector('.cl-scrub');
      const VB_W = this.vbw;
      const series = this.visible(m, d).map((s) => ({ label: s.short, colour: s.colour, points: s.points }));

      const at = (ev) => {
        const box = svg.getBoundingClientRect();
        if (!box.width) return;
        // Client pixels to viewBox units. preserveAspectRatio is "none", so
        // the two axes scale independently and x is a plain ratio.
        const vx = ((ev.clientX - box.left) / box.width) * VB_W;
        const frac = (vx - PAD.l) / (VB_W - PAD.l - PAD.r);
        const t = d.from + Math.min(1, Math.max(0, frac)) * (d.to - d.from);
        cross.setAttribute('x1', vx.toFixed(1));
        cross.setAttribute('x2', vx.toFixed(1));
        // A class, not the `hidden` attribute: the UA stylesheet's [hidden]
        // rule does not reach inside an <svg>, and the line stood at x=0 down
        // the left of both charts looking like a second axis.
        cross.classList.remove('off');
        const rows = series.map((s) => {
          // The bucket the finger is over, not the nearest by value: a gap in
          // the recording must read as a gap, so a point more than one bucket
          // away from the finger counts as nothing there.
          let best = null;
          let gap = Infinity;
          for (const p of s.points) {
            const g = Math.abs(p.t - t);
            if (g < gap) { gap = g; best = p; }
          }
          const span = (d.to - d.from) / Math.max(2, s.points.length);
          const v = best && gap <= span * 1.5 ? best.v : null;
          return `<span class="cl-sc-row"><i style="--c:${s.colour}"></i>
            ${esc(s.label)} <b>${m.fmt(v)}</b></span>`;
        }).join('');
        out.innerHTML = `<span class="cl-sc-when">${esc(this.stamp(t, d.period))}</span>${rows}`;
        out.hidden = false;
      };
      const off = () => { cross.classList.add('off'); out.hidden = true; };

      svg.addEventListener('pointerdown', (e) => { svg.setPointerCapture(e.pointerId); at(e); });
      svg.addEventListener('pointermove', (e) => { if (e.buttons || e.pointerType === 'mouse') at(e); });
      svg.addEventListener('pointerup', off);
      svg.addEventListener('pointercancel', off);
      svg.addEventListener('pointerleave', off);
    });
  },
};
