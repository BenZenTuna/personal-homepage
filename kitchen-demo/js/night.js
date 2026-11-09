/* Night mode, on the wall: a dim clock instead of a bright photograph.

   The wall woke at 03:03 and at 05:24 for somebody passing through and lit the
   kitchen with a photograph. From 22:00 until 08:00 (the hours are the
   server's, backend/app/night.py) this puts a black screen with a big, warm,
   dim clock over the wall — the date, the temperature outside, any kitchen
   timer running — and the agent on the wall turns the backlight down to a
   fifth for the whole night, so the normal wall a touch brings back is a
   dimmed one.

   When it shows:
   - at once when the page starts, and at once when the screen comes back
     from a suspend — its own one-second clock notices the jump, because
     wake.js only reloads the page some ten seconds later, and until then the
     frozen frame from before the suspend is a photograph;
   - otherwise only over the resting view (the one the wall goes home to)
     after a minute untouched, and never over an open sheet: never over
     Cooking, House, TV or Birds while somebody is using them.

   A touch takes it away. That touch is remembered across wake.js's reload,
   or the page would put it straight back as it started again. A timer that
   runs out takes it away too — the alarm is under it — but only for a few
   minutes after its end: a timer nobody pressed Stop on stays on Done for
   days, and until 2026-09-28 that kept the clock away all night, every
   night. The end is the one this page saw while the timer was running; a
   timer already on Done when the page starts (every wake reloads it) is old
   news, as it is to the timers' own alarm. While it covers the wall the
   photographs and the camera pause, as they do for a hidden page.

   Only on the wall: the server says which screen that is (`wall`, the sleep
   agent's address); `?night=1` forces it anywhere, for trying. A server older
   than this — or the demo — answers 404 and nothing here does anything.

   By day too, since 2026-10-01: people kept looking at the photographs, so
   the same clock covers the wall at the hours of the day chosen in the sheet
   (`day_hours`), and a tap gives the pictures back for `day_idle_min`
   untouched minutes before it returns. The sheet is now "Screen dimming",
   opened from its card on House → Automation (ha.js, buildAuto) as well as
   from the 🌙; this keeps the settings and tells the tile when they change.
   By day only the page dims — the backlight is the night's alone — and the
   clock carries a day's forecast in one line under the time.

   In cycles (`day_cycle`, the same day, Alex's second ask): within the
   chosen hours the photographs for `cycle_show_min`, then the clock for
   `cycle_dim_min`, and again — counted from the hour each stretch of chosen
   hours begins, photographs first, so every screen agrees and a reload
   changes nothing (cycleAt). A tap on the clock still gives the photographs
   back for `day_idle_min`.

   With the weather drawn around it (`wx_art`, Alex's ask of 2026-10-13):
   the forecast's weather this hour — the sun or the stars, clouds, fog, drizzle,
   rain, snow, wind, thunder, as heavy as the forecast says — around the
   clock, the date and the forecast row, which stay as they were. How much it
   moves is `wx_motion`, from Still to Lively. The drawing is wxart.js's,
   loaded on its own so a clock never waits for it (nor fails with it); the
   sheet's Show me puts any one weather on the screen it was tapped on for a
   minute, whatever screen and whatever the hour, to choose by.

   And SMHI's warnings (the same evening; backend/app/smhi.py hands over those
   whose area holds the house): above the time, each in its own colour —
   yellow, orange, red, or a message's grey-blue — blinking while it is on
   (slowly for yellow, quicker for orange, fast for red), an outline saying
   from when for one that begins within a day. `wx_warn` is the lowest level
   shown (0 none, 1 messages too, 2 yellow, 3 orange, 4 red only),
   `wx_warn_blink` the blinking. A warning on now for wind, rain, snow,
   thunder or freezing rain also makes the picture at least as heavy as it
   says (wxart.js withWarnings).

   What it shows is the sheet's to choose (2026-10-22, Alex: "all items
   shown in the dimmed screen can optionally be visible or removed"): the
   time, the date, the temperature outside, the forecast row, a timer
   running, the moon — and the two he asked for with it: the day's sunrise
   and sunset top left, the forecast's own times, and the countdown's next
   events in one line at the very bottom. An item left out takes no room;
   the rest close up around the middle.

   And how it looks (`look`, the same day, Alex: "add the current animation
   and visuals as option 1, and please generate new illustrations and make
   them as option 2. So dimming screen can be customized"): 1 is all of the
   above as it was; 2 puts a painted picture behind the clock — a still
   forest lake, a small red cottage with a lit window on the left shore, the
   spruce forest across the water — in the weather outside now and at the
   time of day it is, one of 33 that Ideogram 4 painted on the house's GPU for
   this wall (scripts/dim-art/make-art.py draws them again; illuKey() picks
   one). The next one is decoded before it fades in over the last, so the wall
   never shows half a picture; one that will not load gives that paint back to
   the drawings. Over the picture the weather drawing keeps only what falls,
   and the lightning (overScene()); the picture drifts slowly unless Movement
   is Still. */

/* The sunrise and sunset the dim clock shows top left: today's — or, once
   today's sun has set, tomorrow's — from the forecast's days
   ({sunrise, sunset}, read with weather.js's ms()); `now` in ms. `up` while
   the sun is between them, `today` false for tomorrow's, and `len` the day's
   length from the two minutes shown — the times are said without their
   seconds, as everywhere on the wall, and 08:00:42 to 17:39:05 is 9 h 39 min
   to anyone who subtracts them. Null for a forecast with no day still to
   come that has both, the right way round. */
export function sunDay(daily, now, ms) {
  for (const d of Array.isArray(daily) ? daily : []) {
    const rise = d ? ms(d.sunrise) : NaN;
    const set = d ? ms(d.sunset) : NaN;
    if (!Number.isFinite(rise) || !Number.isFinite(set) || set <= rise || set <= now) continue;
    const min = (t) => Math.floor(t / 60000) * 60000;
    return { rise, set, up: now >= rise, today: new Date(rise).toDateString() === new Date(now).toDateString(),
      len: min(set) - min(rise) };
  }
  return null;
}

/* "9 h 59 min" — how long a day is, from its sunrise to its sunset (ms). */
export function dayLength(ms) {
  const min = Math.round(ms / 60000);
  return `${Math.floor(min / 60)} h ${min % 60} min`;
}

/* The second look's pictures (make-art.py's KEYS, which this must equal —
   dim-look-test.mjs asks the script): <ground>-<time>-<weather>, the ground
   green or under snow, the time night, twilight or day, and the weathers
   each ground has — no rain on a frozen lake, no thunder over one. */
const ILLU_WEATHERS = {
  green: ['clear', 'partly', 'overcast', 'rain', 'fog', 'storm'],
  snow: ['clear', 'partly', 'overcast', 'snow', 'fog'],
};
export const ILLU_KEYS = Object.entries(ILLU_WEATHERS)
  .flatMap(([g, ws]) => ['night', 'twilight', 'day'].flatMap((t) => ws.map((w) => `${g}-${t}-${w}`)));
const TWILIGHT_MS = 50 * 60 * 1000;   // either side of a sunrise or a sunset: the dusk picture
const SNOW_LYING_M = 0.01;            // a centimetre of snow on the ground whitens the shore
const WINTER = new Set([11, 0, 1]);   // ...and with no depth in the forecast, these months do
const finite = (v) => (v == null || v === '' || !Number.isFinite(Number(v)) ? null : Number(v));

/* Which picture, from wxart.js's scene of the hour (`sc`) and ctx {row: the
   forecast's row — its `snow`, metres lying, and `temp` — now in ms, daily:
   the forecast's days with their sunrise and sunset, ms: weather.js's
   reading of those}:
   - time: twilight within 50 minutes either side of a sunrise or a sunset,
     otherwise night or day by the scene (the hour's is_day); with no sun
     times, by the scene alone;
   - ground: snow from a centimetre lying, green below it; with no depth, snow
     in December, January and February. Snow or snow grains falling, or sleet
     at 1° or less, is snow whatever the depth says — the lake has no green
     picture with snow falling on it;
   - weather: a thunderstorm on green (on snow, its clouds); snow and grains
     snowing; sleet raining on green and snowing on snow; rain and drizzle
     raining on green and grey on snow; fog from wxart's level 2; then the sky
     — clear or a few clouds clear, partly cloudy partly, the rest overcast.
   No scene at all is a night under cloud, on the month's ground. Always one
   of ILLU_KEYS. */
export function illuKey(sc, ctx = {}) {
  const now = Number.isFinite(ctx.now) ? ctx.now : Date.now();
  const row = ctx.row || null;
  const read = ctx.ms || ((t) => (typeof t === 'number' ? t * 1000 : Date.parse(t)));
  const f = sc?.fall || null;
  const temp = finite(row?.temp);
  const depth = finite(row?.snow);
  const snowing = !!f && (f.kind === 'snow' || f.kind === 'grains'
    || (f.kind === 'sleet' && temp !== null && temp <= 1));
  const snowy = snowing || (depth !== null ? depth >= SNOW_LYING_M : WINTER.has(new Date(now).getMonth()));
  const ground = snowy ? 'snow' : 'green';
  if (!sc) return `${ground}-night-overcast`;
  let time = sc.night ? 'night' : 'day';
  const near = (t) => {
    const at = t == null ? NaN : read(t);
    return Number.isFinite(at) && Math.abs(now - at) <= TWILIGHT_MS;
  };
  if ((Array.isArray(ctx.daily) ? ctx.daily : []).some((d) => d && (near(d.sunrise) || near(d.sunset)))) {
    time = 'twilight';
  }
  let weather;
  if (sc.storm) weather = snowy ? 'overcast' : 'storm';
  else if (f && (f.kind === 'snow' || f.kind === 'grains')) weather = 'snow';
  else if (f && f.kind === 'sleet') weather = snowy ? 'snow' : 'rain';
  else if (f && (f.kind === 'rain' || f.kind === 'drizzle')) weather = snowy ? 'overcast' : 'rain';
  else if ((Number(sc.fog) || 0) >= 2) weather = 'fog';
  else weather = sc.sky === 'clear' || sc.sky === 'few' ? 'clear' : sc.sky === 'partly' ? 'partly' : 'overcast';
  const key = `${ground}-${time}-${weather}`;
  return ILLU_KEYS.includes(key) ? key : `${ground}-${time}-overcast`;
}

/* What the weather drawing (wxart.js) puts over the picture: only what
   falls, and a thunderstorm's lightning — the picture has its own sky, its
   clouds, its fog and its sun or moon, so the scene goes with its sky as
   'none', no fog, and `over`, which leaves out the rest. Null when nothing
   falls: then there is only the picture. */
export function overScene(sc) {
  if (!sc || (!sc.fall && !sc.storm)) return null;
  return { ...sc, sky: 'none', fog: 0, over: true };
}

/* "the frozen lake by day in falling snow" — a picture's key in words, for
   the sheet. */
const ILLU_WORDS = {
  night: 'at night', twilight: 'in the twilight', day: 'by day',
  clear: 'under a clear sky', partly: 'with clouds passing', overcast: 'under cloud', rain: 'in the rain',
  fog: 'in fog', storm: 'in a thunderstorm', snow: 'in falling snow',
};
export function illuWords(key) {
  const [ground, time, weather] = String(key || '').split('-');
  if (!ILLU_WORDS[time] || !ILLU_WORDS[weather]) return '';
  return `${ground === 'snow' ? 'the frozen lake' : 'the lake'} ${ILLU_WORDS[time]} ${ILLU_WORDS[weather]}`;
}

/* The countdown's next events for the line at the bottom, nearest first, in
   the words of the chips over a picture (app.js paintNextEvents), from the
   same calendar.js: {when: "3 days" | "Today" | "Day 3 of 7" | "2 h 15 min",
   what: the title, a family event's time after it on its first day}. */
export function countdownItems(cal, events, d, max = CD_MAX) {
  if (!cal) return [];
  return cal.upcoming(events, cal.isoDay(d)).slice(0, max).map((e) => {
    const w = cal.countWords(e.occ, d);
    const t = e.occ.n >= 0 ? cal.familyTime(e.occ) : '';
    return { when: w.num ? `${w.num} ${w.unit}` : w.unit, what: cal.shownTitle(e, e.occ) + (t ? ` · ${t}` : '') };
  });
}

/* When each running timer is due to end, in seconds, by id — kept as numbers
   because the rows themselves are shared with the timers panel, which turns
   a row to Done in place and clears its end the moment it runs out. */
export function noteEnds(rows, ends) {
  for (const t of rows || []) if (t && t.state === 'running' && t.ends_at) ends[t.id] = t.ends_at;
}

/* A timer ran out less than RING_HOLDS_MS ago (at is now, in the server's
   milliseconds): still running past its end, because the dials have not
   said Done yet, or Done with an end this page saw. */
export function timerRinging(rows, ends, at) {
  return (rows || []).some((t) => {
    const end = t?.state === 'running' ? t.ends_at : t?.state === 'done' ? ends[t.id] : null;
    return !!end && end * 1000 <= at && at - end * 1000 < RING_HOLDS_MS;
  });
}

export function isNight(s, d) {
  // Settings from a server older than the day's hours have no `night`: on.
  if (!s || !s.enabled || s.night === false) return false;
  const f = Number(s.from_h);
  const t = Number(s.to_h);
  const h = d.getHours();
  if (f === t) return false;
  return f < t ? (f <= h && h < t) : (h >= f || h < t);
}

/* 'night', 'day' or null: which dimming the hour of `d` falls in — the same
   rule as night.py's dim_now(), pinned by the table's `dim_cases`. Night wins
   an hour that is both; by day it is the whole hour, in `day_hours`. */
export function dimMode(s, d) {
  if (isNight(s, d)) return 'night';
  if (s && s.enabled && Array.isArray(s.day_hours) && s.day_hours.includes(d.getHours())) return 'day';
  return null;
}

/* The chosen hours as spans, [from, to) — [[9, 12], [14, 16]] for
   9, 10, 11, 14, 15 — joined across midnight; all twenty-four is [[0, 0]]. */
export function daySpans(hours) {
  const on = new Set((hours || []).filter((h) => Number.isInteger(h) && h >= 0 && h <= 23));
  if (on.size === 24) return [[0, 0]];
  const spans = [];
  for (let h = 0; h < 24; h++) {
    if (!on.has(h) || on.has(h - 1)) continue;
    let t = h;
    while (on.has(t + 1)) t++;
    spans.push([h, (t + 1) % 24]);
  }
  // 22, 23 and 0, 1 are one span, 22:00–02:00, not two.
  if (spans.length > 1 && spans[0][0] === 0 && spans[spans.length - 1][1] === 0) {
    const last = spans.pop();
    spans[0][0] = last[0];
  }
  return spans;
}

/* The chosen day hours that are day hours: one inside the night (while the
   night is on) stays stored — it was chosen with the night off, or Until was
   moved over it — but it is the night's, and the tile and the sheet both
   leave it out, as dimMode() does. */
export function dayOnly(s) {
  return (s?.day_hours || []).filter((h) => !isNight(s, new Date(2026, 0, 1, h)));
}

/* In cycles: where `d` falls in the turns of photographs and clock, or null
   when it is not in a chosen day hour with cycles on. The turns count from
   the hour the stretch of chosen hours began (back across midnight if it ran
   over), photographs first; all twenty-four chosen counts from midnight.
   `until` is when this turn ends, in ms — the stretch's own end can come
   first, and then dimMode() decides. */
export function cycleAt(s, d) {
  if (!s || !s.day_cycle || dimMode(s, d) !== 'day') return null;
  const show = Number(s.cycle_show_min) || 10;
  const period = show + (Number(s.cycle_dim_min) || 15);
  const start = new Date(d);
  start.setMinutes(0, 0, 0);
  let k = 0;
  for (; k < 24; k++) {
    const before = new Date(start.getTime() - 3600000);
    if (dimMode(s, before) !== 'day') break;
    start.setTime(before.getTime());
  }
  // All twenty-four: the count starts again at every midnight, so the turn
  // running into one is cut there (a photographs turn runs straight on into
  // the new day's first).
  let midnight = Infinity;
  if (k === 24) {
    start.setTime(d.getTime());
    start.setHours(0, 0, 0, 0);
    midnight = new Date(start.getFullYear(), start.getMonth(), start.getDate() + 1).getTime();
  }
  const t = (d.getTime() - start.getTime()) / 60000;
  const into = t % period;
  const showing = into < show;
  let until = d.getTime() + ((showing ? show : period) - into) * 60000;
  if (until > midnight) until = showing ? midnight + show * 60000 : midnight;
  return { showing, until };
}

const STORE = 'kitchen-night';             // the last answer, for the first paint
const TOUCHED = 'kitchen-night-touched';   // a touch, surviving wake.js's reload
const TOUCH_KEEPS_MS = 60 * 1000;
const JUMP_MS = 4000;                      // a one-second tick this late: a resume
const RING_HOLDS_MS = 5 * 60 * 1000;       // a timer that ran out keeps the clock away this long
const FORECAST_SLOTS = 12;                 // now, then every second hour: a day ahead
const PREVIEW_MS = 60 * 1000;              // Show me: one weather this long, or until a tap
const UPCOMING_MS = 24 * 3600 * 1000;      // a warning beginning within this is shown, as coming
const WARN_MAX = 3;                        // warnings over the clock at once
const CD_MAX = 8;                          // countdown events tried on the bottom line, before fitting
const SUN_R = 62;                          // the sun's arc top left, in its drawing's units
const CD_GAP = 16;                         // the countdown line keeps this far below the column, or goes
const CORNER_GAP = 24;                     // the warnings keep this far from the sun and the moon
const WARN_MIN_W = 240;                    // ...but are never squeezed narrower than this (a phone)
const WARN_WORDS = { message: 'Message', yellow: 'Yellow warning', orange: 'Orange warning', red: 'Red warning' };
// The sheet's card notes: the parts of the dim clock it shows or leaves out,
// the weather's movement and the lowest warning shown, in a word or two.
const SHOW_PARTS = ['show_sun', 'moon', 'show_clock', 'show_forecast', 'show_date', 'show_temp', 'show_timer',
  'show_countdown'];
const MOTION_WORDS = ['still', 'slight', 'medium', 'lively'];
const WARN_LEVELS = ['off', 'messages too', 'yellow and up', 'orange and up', 'red only'];
const ILLU_RETRY_MS = 10 * 60 * 1000;      // a picture that would not load is tried again after this
const ILLU_AHEAD_MS = 2 * 3600 * 1000;     // the next dim stretch's picture is fetched this far ahead
const ILLU_KEEP = 4;                       // pictures fetched ahead and kept decoded
// A server older than the day's hours (or the weather) sends none of these.
const DAY_DEFAULTS = {
  night: true, day_hours: [], day_idle_min: 5, day_cycle: false, cycle_show_min: 10, cycle_dim_min: 15,
  wx_art: false, wx_motion: 1, wx_warn: 2, wx_warn_blink: true, moon: true,
  show_clock: true, show_date: true, show_temp: true, show_forecast: true, show_timer: true,
  show_sun: true, show_countdown: true, look: 1, look_auto: false, look_days: 1, look_pool: [1, 2, 3, 4],
};
// The build stamp this file was loaded with, for the drawing it loads itself.
const V = new URL(import.meta.url).search;

const esc = (s) => String(s ?? '').replace(/[&<>"]/g,
  (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const hh = (h) => `${String(h).padStart(2, '0')}:00`;
/* The looks there are, and the one chosen by hand (anything else is 1). */
export const LOOKS = [1, 2, 3, 4];
const chosenLook = (s) => (LOOKS.includes(Number(s?.look)) ? Number(s.look) : 1);

/* The day number of a local date: the same for every screen in the house. */
const dayNumber = (now) => {
  const d = new Date(now);
  return Math.round(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) / 86400000);
};

/* The look of the day (Alex, 2026-11-05: "the dimming screen themes will
   automatically change, for how long days to have the same and which ones
   to appear after the change"): with look_auto, each look of look_pool in
   turn, look_days days each, counted from the calendar — so every screen
   agrees, and a reload changes nothing. Without it, the one chosen.
   `next`: the day it changes and to which. */
export function lookToday(s, now = Date.now()) {
  const pool = (Array.isArray(s?.look_pool) ? s.look_pool : []).map(Number).filter((v) => LOOKS.includes(v));
  if (!s?.look_auto || !pool.length) return { look: chosenLook(s), next: null };
  const days = Math.max(1, Number(s.look_days) || 1);
  const n = dayNumber(now);
  const turn = Math.floor(n / days);
  const look = pool[((turn % pool.length) + pool.length) % pool.length];
  const left = (turn + 1) * days - n;
  const nextLook = pool[(((turn + 1) % pool.length) + pool.length) % pool.length];
  return { look, next: pool.length > 1 ? { inDays: left, look: nextLook } : null };
}

const lookOf = (s) => lookToday(s).look;
const LOOK_NAMES = ['', 'Weather drawings', 'Illustrations', 'A family photo', 'Living landscape'];
const hm = (ms) => new Date(ms).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false });
const spanText = ([f, t]) => (f === t ? 'all day' : `${hh(f)}–${hh(t)}`);
const andList = (xs) => (xs.length < 2 ? xs.join('') : `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`);

export default {
  data: null,
  covered: false,
  lastTouch: 0,
  timers: [],
  ends: {},
  skew: 0,
  testShown: 0,
  subs: [],
  putSeq: 0,           // the newest settings change this page has sent
  putting: 0,          // ...and how many are still on their way
  fcKey: '',
  wx: null,            // wxart.js, once loaded
  art: null,           // its drawing over this overlay, made the first time it is wanted
  preview: null,       // Show me: {key, until, and for a warning's: warning, scene}
  warnings: [],        // SMHI's for here (smhi.py), as the `wx_warnings` key brings them
  warnData: null,      // ...the whole answer, null from a server without them
  warnKey: '',
  events: [],          // the countdown's, for its line at the bottom
  cdSeq: 0,            // ...counted up whenever they change
  cdKey: '',
  sunKey: '',
  illu: null,          // look 2: the picture's layer, two <img> taking turns
  illuFront: 0,        // ...which of them is in front
  illuWant: '',        // ...the key asked for last
  illuShown: '',       // ...the key in front, decoded and faded in ('' for none)
  illuSeq: 0,          // ...counted up with every picture asked for
  illuBad: {},         // ...key: when it would not load
  illuOpening: false,  // ...the overlay has just opened: what is in front may be stale
  illuAhead: new Map(), // ...pictures fetched ahead, by key, oldest first
  aheadMin: -1,        // ...the minute they were last worked out
  photoNow: '',        // look 3: the family photograph behind this dimming
  photoNext: '',       // ...the next one, fetched and decoded ahead
  photoAsking: null,   // ...a pick on its way

  init(ctx, hooks = {}) {
    this.ctx = ctx;
    this.hooks = hooks;
    this.force = new URLSearchParams(location.search).has('night');
    try { this.data = JSON.parse(localStorage.getItem(STORE) || 'null'); } catch { this.data = null; }
    try { this.lastTouch = Number(sessionStorage.getItem(TOUCHED)) || 0; } catch { /* private */ }
    this.buildOverlay();
    this.buildSheet();
    // Look 4, the living landscape (dimscape.js), loaded the first time it is wanted.
    this.scapeMod = null;
    this.scape = null;
    import(`./wxart.js${V}`).then((m) => {
      this.wx = m;
      if (this.sheetIsOpen()) this.renderSheet();
    }).catch((e) => console.error('wxart.js did not load: the clock without the weather', e));

    addEventListener('pointerdown', () => this.touched(), { capture: true, passive: true });
    // Every snapshot carries the `night` key, and a snapshot comes with every
    // reconnect — a backend deploy reconnects the stream without reloading the
    // page — so this is also how a wall learns again that it is the wall.
    ctx.bus.on('night', () => this.refresh());
    ctx.bus.on('wx_warnings', (d) => {
      this.warnData = d && typeof d === 'object' ? d : null;
      this.warnings = Array.isArray(d?.warnings) ? d.warnings : [];
      if (this.covered) this.paint(Date.now());
      if (this.sheetIsOpen()) this.renderSheet();
    });
    ctx.bus.on('timers', (rows) => {
      if (Array.isArray(rows)) { this.timers = rows; noteEnds(rows, this.ends); this.tick(); }
    });
    // The moon as it is now from the house (moon.py), every five minutes.
    ctx.bus.on('moon', (d) => {
      if (!d || typeof d !== 'object' || !Number.isFinite(d.phase)) return;
      this.sky = d;
      if (this.covered) this.paintMoon();
      if (this.sheetIsOpen()) this.renderSheet();
    });
    // The countdown's events, for the line at the very bottom: the same
    // list the chips over a picture read, said the same way (calendar.js,
    // handed over by app.js).
    ctx.bus.on('countdown', (events) => {
      this.events = Array.isArray(events) ? events.filter((e) => e && e.title && e.date) : [];
      this.cdSeq += 1;
      if (this.covered) this.paint(Date.now());
    });
    // The server's own rows, not the bus's shared ones: a timer that ran out
    // a moment before this page started is still `running` here, with its
    // end, even after the timers panel has already turned it to Done.
    fetch('/api/timers', { cache: 'no-store' }).then((r) => r.json()).then((d) => {
      if (typeof d?.now === 'number') this.skew = d.now * 1000 - Date.now();
      noteEnds(d?.timers, this.ends);
    }).catch(() => {});

    this.booting = true;
    this.lastTick = Date.now();
    setInterval(() => this.tick(), 1000);
    // And every quarter of an hour regardless: an answer that went missing
    // (asked before the server knew the wall) must not last all night.
    setInterval(() => this.refresh(), 15 * 60 * 1000);
    this.refresh();
  },

  async refresh() {
    let r;
    try { r = await fetch('/api/night', { cache: 'no-store' }); } catch { return; }
    if (r.status === 404 || r.status === 405) { this.gone(); return; }
    if (!r.ok) return;
    const d = await r.json().catch(() => null);
    if (!d || !d.settings) return;
    // An answer read while a change of this page's own was still on its way
    // would put the sheet back as it was for a moment; the `night` that
    // change publishes asks again.
    if (this.putting) return;
    this.data = d;
    try { localStorage.setItem(STORE, JSON.stringify(d)); } catch { /* full, or private */ }
    this.addMoon();
    this.changed();
    if (this.sheetIsOpen()) this.renderSheet();
    this.tick();
  },

  /* No night mode on this server: nothing of it on the page. */
  gone() {
    this.data = null;
    this.preview = null;
    try { localStorage.removeItem(STORE); } catch { /* nothing to remove */ }
    this.cover(false);
    this.moon?.remove();
    this.moon = null;
    this.closeSheet();
    this.changed();
  },

  /* ---------------------------------------------- for its card on Automation */

  onChange(fn) { this.subs.push(fn); },

  changed() {
    for (const fn of this.subs) {
      try { fn(this.data); } catch (e) { console.error('screen dimming subscriber failed', e); }
    }
  },

  /* The settings, with what an older server leaves out filled in. */
  settings() { return { ...DAY_DEFAULTS, ...(this.data?.settings || {}) }; },

  /* The tile's second line, short enough for one line of a tile a third of
     the House panel wide (250px, measured): "on · night 22–08 · day 13–15,
     17–18"; past two stretches "day 09–12 +2"; in cycles "day 18–21 ·
     cycles", or "day ×2 · cycles" for more than one. The sheet says it in
     full. */
  summary() {
    if (!this.data) return '';
    const s = this.settings();
    if (!s.enabled) return 'off';
    const two = (h) => String(h).padStart(2, '0');
    const short = ([f, t]) => (f === t ? 'all day' : `${two(f)}–${two(t)}`);
    const parts = [];
    if (s.night) parts.push(`night ${two(s.from_h)}–${two(s.to_h)}`);
    const spans = daySpans(dayOnly(s));
    if (s.day_cycle && spans.length > 1) parts.push(`day ×${spans.length} · cycles`);
    else if (s.day_cycle && spans.length) parts.push(`day ${short(spans[0])} · cycles`);
    else if (spans.length > 2) parts.push(`day ${short(spans[0])} +${spans.length - 1}`);
    else if (spans.length) parts.push(`day ${spans.map(short).join(', ')}`);
    return `on · ${parts.length ? parts.join(' · ') : 'no hours chosen'}`;
  },

  toggle() { this.put({ enabled: !this.settings().enabled }); },

  open() { this.openSheet(); },

  onWall() { return this.force || !!this.data?.wall; },

  testing(now) { return ((this.data?.test_until || 0) * 1000) > now + this.skew; },

  /* 'night', 'day' or null now — Try it is night, whatever the hour, and a
     photographs turn in cycles is no dimming. */
  modeNow(now) {
    if (this.testing(now)) return 'night';
    const s = this.settings();
    const d = new Date(now);
    const mode = dimMode(s, d);
    return mode === 'day' && cycleAt(s, d)?.showing ? null : mode;
  },

  /* A timer that has just run out: the alarm is ringing under whatever
     covers the wall. */
  timerDone(now) { return timerRinging(this.timers, this.ends, now + this.skew); },

  touched() {
    this.lastTouch = Date.now();
    try { sessionStorage.setItem(TOUCHED, String(this.lastTouch)); } catch { /* private */ }
  },

  tick() {
    const now = Date.now();
    const jumped = now - this.lastTick > JUMP_MS;
    this.lastTick = now;
    // By day too: a timer that ends at 21:59 still holds the clock at 22:00.
    noteEnds(this.timers, this.ends);
    this.preloadIllu(now);
    if (this.sheetIsOpen()) this.renderNow();
    // Show me: on this screen, whichever it is and whatever the hour, until
    // its minute is up or a tap (the overlay's click) ends it — or a kitchen
    // timer runs out, whose alarm is under it.
    if (this.preview) {
      if (now < this.preview.until && !this.timerDone(now)) {
        if (this.covered) this.paint(now); else this.cover(true);
        return;
      }
      this.endPreview();
    }
    // Dimmed by the header's 🌙: until a tap (the overlay's click) or a timer.
    if (this.manual) {
      if (!this.timerDone(now)) {
        if (this.covered) this.paint(now); else this.cover(true);
        return;
      }
      this.manual = false;
    }
    const mode = this.data ? this.modeNow(now) : null;
    if (!this.data || !this.onWall() || !mode || this.timerDone(now)) {
      this.cover(false);
      this.booting = false;
      return;
    }
    if (this.covered) { this.paint(now); return; }
    // Try it on the wall: at once, over whatever is up — its sheet included.
    const test = this.data.test_until || 0;
    if (this.testing(now) && this.testShown !== test) {
      this.testShown = test;
      this.closeSheet();
      this.cover(true);
      return;
    }
    // How long a touch keeps the clock away: by day the sheet's own choice,
    // and not only for the view the wall rests on — a page reloaded by a
    // deploy while somebody is cooking is not a screen nobody is using.
    const s = this.settings();
    const idleMs = mode === 'day'
      ? (Number(s.day_idle_min) || DAY_DEFAULTS.day_idle_min) * 60000
      : (Number(s.idle_min) || 1) * 60000;
    const recent = now - this.lastTouch < (mode === 'day' ? idleMs : TOUCH_KEEPS_MS);
    if ((this.booting || jumped) && !recent) {
      this.booting = false;
      this.cover(true);
      return;
    }
    this.booting = false;
    const idle = now - this.lastTouch >= idleMs;
    const resting = this.hooks.presetName?.() === this.hooks.restingView?.();
    if (idle && resting && !this.hooks.sheetOpen?.() && !this.sheetIsOpen()) this.cover(true);
  },

  cover(on) {
    if (!this.overlay || on === this.covered) return;
    this.covered = on;
    this.overlay.classList.toggle('open', on);
    this.hooks.setCovered?.(on);
    this.illuOpening = on;
    // Look 3: a new family photograph each time the clock covers the wall,
    // kept until the next time (Alex, 2026-11-05).
    if (on && lookOf(this.settings()) === 3) this.nextPhoto();
    if (on) this.paint(Date.now());
    else {
      this.art?.stop();
      this.scape?.stop();
    }
  },

  /* ---------------------------------------------------------- the clock -- */

  buildOverlay() {
    this.overlay = document.createElement('div');
    this.overlay.id = 'nt-overlay';
    // The picture of look 2 first, behind everything (wxart's canvas is moved
    // in after it): two <img>, the next fading in over the last.
    this.overlay.innerHTML = `
      <div class="nl-illu" hidden aria-hidden="true"><div class="nl-pan">
        <img alt="" decoding="async" draggable="false"><img alt="" decoding="async" draggable="false">
      </div></div>
      <div class="nt-moon" hidden></div>
      <div class="nt-sun" hidden></div>
      <div class="nt-warn"></div>
      <div class="nt-clock"></div>
      <div class="nt-fc"></div>
      <div class="nt-date"></div>
      <div class="nt-wx"></div>
      <div class="nt-timer" hidden></div>
      <div class="nt-cd"></div>`;
    // On the click, not the pointerdown: the overlay has to still be there
    // when the finger lifts, or the tap would land on whatever is under it.
    this.overlay.addEventListener('click', () => {
      if (this.preview) this.endPreview();
      else { this.manual = false; this.cover(false); }
    });
    document.body.appendChild(this.overlay);
    this.illu = this.overlay.querySelector('.nl-illu');
  },

  paint(now) {
    const d = new Date(now);
    const s = this.settings();
    const q = (sel) => this.overlay.querySelector(sel);
    // Each part as the sheet says: one left out is hidden, and takes no room.
    const part = (sel, on) => {
      const el = q(sel);
      if (el.hidden === !!on) el.hidden = !on;
      return el;
    };
    part('.nt-clock', s.show_clock).textContent = d.toLocaleTimeString('en-GB',
      { hour: '2-digit', minute: '2-digit', hour12: false });
    part('.nt-date', s.show_date).textContent = d.toLocaleDateString('en-GB',
      { weekday: 'long', day: 'numeric', month: 'long' });
    const w = this.hooks.weather;
    const hours = w?.data?.hourly;
    const cur = hours?.length ? hours[Math.max(0, w.nowIndex(hours))] : null;
    part('.nt-wx', s.show_temp).textContent = cur && Number.isFinite(cur.temp) ? `${Math.round(cur.temp)}° outside` : '';
    this.paintForecast(part('.nt-fc', s.show_forecast));
    const running = this.timers.filter((t) => t.state === 'running' && t.ends_at)
      .sort((a, b) => a.ends_at - b.ends_at)[0];
    const el = part('.nt-timer', s.show_timer && running);
    if (running && s.show_timer) {
      const s = Math.max(0, Math.ceil((running.ends_at * 1000 - now - this.skew) / 1000));
      const mm = Math.floor(s / 60);
      el.textContent = `${running.label ? `${running.label} · ` : 'Timer · '}${mm >= 60
        ? `${Math.floor(mm / 60)}:${String(mm % 60).padStart(2, '0')}` : mm}:${String(s % 60).padStart(2, '0')}`;
    }
    this.paintWarnings(now);
    this.paintMoon();
    this.paintSun(now);
    this.fitWarnings();
    this.paintCountdown(now);
    this.paintArt(now);
  },

  /* SMHI's pills stay between the corners: the row, centred, is kept as much
     narrower than the screen as the wider of the shown sun and moon leaves
     on either side, so a second pill wraps under the first rather than
     running in under sunrise and sunset or the moon (two warnings at once,
     an autumn storm's usual, did). Measured in the overlay's own pixels — the
     page is zoomed on a screen smaller than the wall, and a rect is not. */
  fitWarnings() {
    const o = this.overlay;
    const box = o.getBoundingClientRect();
    if (!box.width) return;
    const k = o.offsetWidth / box.width;
    let side = 0;
    for (const sel of ['.nt-sun', '.nt-moon']) {
      const el = o.querySelector(sel);
      const r = el.hidden ? null : el.getBoundingClientRect();
      if (r && r.width) side = Math.max(side, sel === '.nt-sun' ? r.right - box.left : box.right - r.left);
    }
    const max = side ? `${Math.max(WARN_MIN_W, Math.round(o.offsetWidth - 2 * (side * k + CORNER_GAP)))}px` : '';
    const warn = o.querySelector('.nt-warn');
    if (warn.style.maxWidth !== max) warn.style.maxWidth = max;
  },

  /* Where the centred column — the warnings down to a timer — ends, in the
     overlay's own pixels. */
  columnBottom() {
    let bottom = 0;
    for (const sel of ['.nt-warn', '.nt-clock', '.nt-fc', '.nt-date', '.nt-wx', '.nt-timer']) {
      const el = this.overlay.querySelector(sel);
      if (!el.hidden && el.offsetHeight) bottom = Math.max(bottom, el.offsetTop + el.offsetHeight);
    }
    return bottom;
  },

  /* Sunrise and sunset, top left (Alex, 2026-10-22: "sunrise and sunset
     times for <the town> for the left upper corner"): the forecast's own
     times, so for its place — today's, or tomorrow's once today's sun has
     set, and then it says so — and how long that day is. Over them the
     day's path, an arc from the horizon to the horizon, with the sun on it
     where it is in its day by the clock (not by its height); no sun on it
     while it is down, and the arc fainter. The moon's twin across the
     screen, and as quiet. Drawn again only when what it shows changed: the
     sun moves on along its arc in sixty steps a day. */
  paintSun(now) {
    const el = this.overlay.querySelector('.nt-sun');
    const w = this.hooks.weather;
    const day = this.settings().show_sun && w?.ms ? sunDay(w.data?.daily, now, w.ms) : null;
    if (el.hidden === !!day) el.hidden = !day;
    if (!day) { this.sunKey = ''; return; }
    const up = day.up && now < day.set;
    const f = up ? (now - day.rise) / (day.set - day.rise) : 0;
    const key = `${day.rise}|${day.set}|${up ? Math.round(f * 60) : -1}|${new Date(now).toDateString()}`;
    if (key === this.sunKey) return;
    this.sunKey = key;
    const r = SUN_R;
    const a = Math.PI * (1 - f);
    const disc = up ? `<circle class="nt-sun-disc" cx="${(r * Math.cos(a)).toFixed(1)}"
      cy="${(-r * Math.sin(a)).toFixed(1)}" r="10"/>` : '';
    el.classList.toggle('nt-sun-down', !up);
    el.innerHTML = `
      <svg class="nt-sun-svg" viewBox="${-r - 14} ${-r - 14} ${2 * r + 28} ${r + 18}" aria-hidden="true">
        <path class="nt-sun-arc" d="M${-r} 0A${r} ${r} 0 0 1 ${r} 0"/>
        <line class="nt-sun-hz" x1="${-r - 12}" y1="0" x2="${r + 12}" y2="0"/>${disc}
      </svg>
      <div class="nt-sun-times"><span>Sunrise</span><b>${hm(day.rise)}</b>
        <span>Sunset</span><b>${hm(day.set)}</b></div>
      <div class="nt-sun-len">${day.today ? '' : 'tomorrow · '}${esc(dayLength(day.len))} of daylight</div>`;
  },

  /* The countdown at the very bottom, in one line (Alex, 2026-10-22): its
     next events, nearest first, the way the chips over a picture say them —
     "3 days Halloween", "Today Kempo", "Day 3 of 7 Lesjön" — as many as fit
     the width whole: the rest are left off rather than cut, and one alone
     too long for the line ends in "…". Left off altogether while the column
     above reaches down to it — three rows of warnings and a timer can. Drawn
     and fitted again only when the events, the minute (a timed event counts
     its minutes on its day), the screen's width or the column's foot change. */
  paintCountdown(now) {
    const el = this.overlay.querySelector('.nt-cd');
    const on = !!this.settings().show_countdown && !!this.hooks.calendar;
    const foot = on ? this.columnBottom() : 0;
    const key = on ? `${this.cdSeq}|${Math.floor(now / 60000)}|${this.overlay.clientWidth}|${foot}` : '';
    if (key === this.cdKey) return;
    this.cdKey = key;
    el.textContent = '';
    el.classList.remove('nt-cd-one');
    if (!on) return;
    for (const { when, what } of countdownItems(this.hooks.calendar, this.events, new Date(now))) {
      const item = document.createElement('span');
      item.className = 'nt-cd-e';
      item.append(document.createElement('b'), document.createElement('span'));
      // textContent: a title is typed by hand in the countdown editor.
      item.firstChild.textContent = when;
      item.lastChild.textContent = what;
      el.appendChild(item);
    }
    while (el.children.length > 1 && el.scrollWidth > el.clientWidth) el.lastElementChild.remove();
    el.classList.toggle('nt-cd-one', el.children.length === 1 && el.scrollWidth > el.clientWidth);
    if (el.children.length && el.offsetTop - foot < CD_GAP) el.textContent = '';
  },

  /* The moon, top right (Alex, 2026-10-14: "the current state of the moon
     phase how it is" here). The lit part drawn as it is — a half disc on the
     bright side and the terminator as half an ellipse, |1 − 2·lit| wide,
     bulging into the dark for a crescent and out of it for a gibbous — then
     turned so its bright side points where it points in the sky here now:
     moon.py's `tilt`, degrees anticlockwise from straight up. The rest of
     the disc faint, so the whole moon reads. Dimmer while it is below the
     horizon. Under it its name, how much is lit, and when it next rises or
     sets. Drawn again only when what it shows has changed. */
  paintMoon() {
    const el = this.overlay.querySelector('.nt-moon');
    const d = this.sky;
    const show = !!d && !!this.settings().moon;
    if (el.hidden === show) el.hidden = !show;
    if (!show) { this.moonKey = ''; return; }
    const key = `${d.at}|${this.settings().moon}`;
    if (key === this.moonKey) return;
    this.moonKey = key;
    const r = 60;
    const f = Math.min(1, Math.max(0, Number(d.lit) || 0));
    const rx = r * Math.abs(1 - 2 * f);
    const lit = f < 0.004 ? ''
      : f > 0.996 ? `<circle r="${r}"/>`
      : `<path d="M0 ${-r}A${r} ${r} 0 0 1 0 ${r}A${rx.toFixed(2)} ${r} 0 0 ${f < 0.5 ? 0 : 1} 0 ${-r}Z"/>`;
    // Without a place, upright as it is seen from the north: waxing lit on the right.
    const tilt = Number.isFinite(d.tilt) ? d.tilt : (d.waxing ? -90 : 90);
    const when = (t) => hm(t * 1000);
    const next = d.up === undefined ? ''
      : d.up ? (d.set ? `in the sky · sets ${when(d.set)}` : 'in the sky')
      : (d.rise ? `below the horizon · rises ${when(d.rise)}` : 'below the horizon');
    el.classList.toggle('nt-moon-down', d.up === false);
    el.innerHTML = `
      <svg class="nt-moon-svg" viewBox="${-r - 4} ${-r - 4} ${2 * r + 8} ${2 * r + 8}" aria-hidden="true">
        <circle class="nt-moon-dark" r="${r}"/>
        <g class="nt-moon-lit" transform="rotate(${(-(tilt + 90)).toFixed(1)})">${lit}</g>
      </svg>
      <div class="nt-moon-name">${esc(d.name)} · ${Math.round(f * 100)} %</div>
      ${next ? `<div class="nt-moon-when">${esc(next)}</div>` : ''}`;
  },

  /* The warnings over the clock: Show me's own, or SMHI's for here at the
     sheet's levels — those on now and those beginning within a day; the ones
     on now first, then the most serious, then the soonest, and messages after
     every warning; three at most. A weather's Show me shows its weather
     alone, but Now is now, and so is Show me the clock. */
  warningsShown(now) {
    const rank = this.wx?.WARN_RANK;
    if (!rank) return [];
    if (this.preview?.warning) return [{ ...this.preview.warning, on: true }];
    if (this.preview && this.preview.key !== 'now' && this.preview.key !== 'clock') return [];
    const min = Number(this.settings().wx_warn) || 0;
    if (!min) return [];
    return this.warnings
      .filter((w) => (rank[w?.level] || 0) >= min && !(w.end && w.end * 1000 <= now)
        && !(w.start && w.start * 1000 - now > UPCOMING_MS))
      .map((w) => ({ ...w, on: !(w.start && w.start * 1000 > now) }))
      .sort((a, b) => ((a.level === 'message') - (b.level === 'message')) || (b.on - a.on)
        || (rank[b.level] - rank[a.level]) || ((a.start || 0) - (b.start || 0)))
      .slice(0, WARN_MAX);
  },

  /* "03:00" today, "Wed 03:00" on another day. */
  dayTime(ms, now) {
    const d = new Date(ms);
    return d.toDateString() === new Date(now).toDateString() ? hm(ms)
      : `${d.toLocaleDateString('en-GB', { weekday: 'short' })} ${hm(ms)}`;
  },

  /* What a warning says, short: "Wind · Gale 18-24 m/s", or "Snow" when the
     detail only says the same again. */
  warnWhat(w) {
    const what = w.what || 'Weather';
    const d = w.detail || '';
    return d && d !== what && d.length <= 32 && !d.startsWith(what) ? `${what} · ${d}` : what;
  },

  warnWhen(w, now) {
    if (!w.on) return w.start ? `from ${this.dayTime(w.start * 1000, now)}` : '';
    return w.end ? `until ${this.dayTime(w.end * 1000, now)}` : '';
  },

  /* Each warning a pill in its own colour, a triangle in front: filled and
     blinking while it is on (a message never blinks), an outline while it
     is still to come. Drawn again only when what it says changed. */
  paintWarnings(now) {
    const el = this.overlay.querySelector('.nt-warn');
    const shown = this.warningsShown(now);
    const blink = this.settings().wx_warn_blink !== false;
    const key = JSON.stringify([blink, new Date(now).toDateString(),
      shown.map((w) => [w.id, w.level, w.on, w.start, w.end, w.what, w.detail])]);
    if (key === this.warnKey) return;
    this.warnKey = key;
    el.innerHTML = shown.map((w) => {
      const when = this.warnWhen(w, now);
      const cls = `nt-wn nt-wn-${w.level}${w.on ? '' : ' nt-wn-soon'}`
        + `${w.on && blink && w.level !== 'message' ? ' blink' : ''}`;
      return `<div class="${cls}">
        <svg class="nt-wn-ico" viewBox="0 0 24 24" aria-hidden="true"><path fill-rule="evenodd"
          d="M12 2.6 1.4 21.2h21.2zM10.85 9h2.3v6.4h-2.3zM10.85 17.1h2.3v2.3h-2.3z"/></svg>
        <b>${esc(WARN_WORDS[w.level] || 'Warning')}</b><span>${esc(this.warnWhat(w))}</span>
        ${when ? `<span class="nt-wn-when">${esc(when)}</span>` : ''}</div>`;
    }).join('');
  },

  /* The forecast's row for the hour it is now, or null: no forecast that
     reaches now draws no weather. */
  nowRow() {
    const w = this.hooks.weather;
    const hours = w?.data?.hourly;
    const i = hours?.length && w.nowIndex ? w.nowIndex(hours) : -1;
    return i >= 0 ? hours[i] : null;
  },

  /* The weather around the clock: this hour's, or the one Show me asked
     for, at the sheet's movement — and in look 2 the picture it picks behind
     the clock, with only what falls drawn over it. Asked every second with
     the clock, but the drawing starts again only when what it shows has
     changed, and the holes around the words are made again only when one of
     them moved. */
  paintArt(now) {
    const wx = this.wx;
    const s = this.settings();
    const row = this.nowRow();
    const p = this.preview;
    const own = !!p && p.key !== 'clock';
    // The weather: Show me's own, or this hour's (Show me the clock is the hour's).
    let hour = null;
    if (wx) {
      hour = own && p.scene !== undefined ? p.scene
        : own && p.key !== 'now' ? wx.sample(p.key, row)
        : wx.withWarnings(wx.scene(row), this.warnings, now);
    }
    // Look 2's picture; false while look 1 is chosen, and for a picture that
    // would not load — that paint is then look 1's. Show me's Sun and Stars
    // are day and night whatever the hour: no dusk for them.
    const fixed = own && !!wx && wx.SAMPLES.find(([k]) => k === p.key)?.[2]?.day !== undefined;
    const pic = this.paintIllu(now, hour, s, fixed);
    // Look 4: the living landscape draws the weather itself, sky and all.
    if (lookOf(s) === 4) {
      this.art?.stop();
      this.paintScape(now, hour, s);
      return;
    }
    this.scape?.stop();
    // Show me the clock is the clock as chosen: the pictures only if they are on.
    let sc = own || s.wx_art ? hour : null;
    if (pic) sc = overScene(sc);
    if (!sc) { this.art?.stop(); return; }
    if (!pic) {
      // The real moon is in the top right: the picture leaves its own out.
      if (s.moon && this.sky && sc.night) sc = { ...sc, noMoon: true };
      // Sunrise and sunset hold the top left, where the picture keeps its sun
      // (or moon): it goes lower down that side, under them.
      if (!this.overlay.querySelector('.nt-sun').hidden) sc = { ...sc, orbLow: true };
    }
    if (!this.art) {
      this.art = new wx.Art(this.overlay);
      // Over look 2's picture, not under it.
      this.illu.after(this.art.cv);
    }
    const motion = Number(s.wx_motion);
    this.art.set(sc, Number.isInteger(motion) ? motion : DAY_DEFAULTS.wx_motion);
    this.art.start();
    // The countdown's line is the screen's width: its holes are its words,
    // or a downpour would stop short of the whole bottom edge.
    this.art.hole(['.nt-moon', '.nt-warn', '.nt-clock', '.nt-fc', '.nt-date', '.nt-wx', '.nt-timer',
      '.nt-sun'].map((sel) => this.overlay.querySelector(sel)).concat([...this.overlay.querySelectorAll('.nt-cd-e')]));
  },

  /* ------------------------------------- look 4: the living landscape -- */

  /* The landscape (dimscape.js) for this hour: the weather of the hour (or
     Show me's), the day's sunrise and sunset, the temperature and the snow
     lying, our moon only while the real one is not shown top right, the
     northern lights while the Aurora alert says they are possible. */
  paintScape(now, sc, s) {
    if (!this.scapeMod) {
      if (!this.scapeLoading) {
        this.scapeLoading = true;
        import(`./dimscape.js${V}`).then((m) => {
          this.scapeMod = m;
          if (this.covered) this.paint(Date.now());
        }).catch((e) => console.error('dimscape.js did not load: look 4 shows the clock alone', e));
      }
      return;
    }
    if (!this.scape) this.scape = new this.scapeMod.Scape(this.overlay);
    const w = this.hooks.weather;
    const d0 = new Date(now);
    const iso = `${d0.getFullYear()}-${String(d0.getMonth() + 1).padStart(2, '0')}-${String(d0.getDate()).padStart(2, '0')}`;
    const day = (w?.data?.daily || []).find((d) => d?.d === iso) || (w?.data?.daily || [])[0];
    const ms = (t) => (t == null || !w?.ms ? NaN : w.ms(t));
    const row = this.rowAt(now) || this.nowRow();
    const env = {
      now, rise: ms(day?.sunrise), set: ms(day?.sunset),
      temp: Number.isFinite(row?.temp) ? row.temp : null,
      snow: Number(row?.snow) || 0,
      moon: !(s.moon && this.sky),
      aurora: !!this.ctx?.automation?.auroraPossible?.(),
      seed: this.scapeMod.daySeed(now),
    };
    const motion = Number(s.wx_motion);
    this.scape.set(sc, env, Number.isInteger(motion) ? motion : DAY_DEFAULTS.wx_motion);
    this.scape.start();
    this.overlay.classList.add('nl-pic');
  },

  /* ---------------------------------------------- look 2: the picture -- */

  /* The picture's address: next to this file's folder, with its build stamp,
     so a wall that wakes keeps it from its cache without asking. */
  illuSrc(key) {
    if (key.startsWith('photo:')) return key.slice(6);
    return new URL(`../img/dim/${key}.webp${V}`, import.meta.url).href;
  },

  /* Look 3: the next dimming's photograph. The one fetched ahead becomes
     this dimming's, and the one after is asked for and decoded at once, so
     the change is instant next time. Nothing liked yet: no photograph, and
     the clock shows the weather drawings. */
  nextPhoto() {
    if (this.photoNext) {
      this.photoNow = this.photoNext;
      this.photoNext = '';
      this.askPhoto();
      return;
    }
    this.askPhoto().then((url) => {
      if (!url || this.photoNow) return;
      this.photoNow = url;
      this.photoNext = '';
      if (this.covered) this.paint(Date.now());
      this.askPhoto();
    });
  },

  askPhoto() {
    if (this.photoAsking) return this.photoAsking;
    this.photoAsking = (async () => {
      try {
        const r = await fetch('/api/night/photo', { cache: 'no-store' });
        if (!r.ok) return '';
        const { url } = await r.json();
        if (typeof url !== 'string' || !url.startsWith('/')) return '';
        const im = new Image();
        im.src = url;
        try { await im.decode(); } catch { /* loaded is enough */ }
        this.photoNext = url;
        return url;
      } catch {
        return '';
      } finally {
        this.photoAsking = null;
      }
    })();
    return this.photoAsking;
  },

  /* The forecast's row for the hour `t` (ms) falls in, or null. */
  rowAt(t) {
    const w = this.hooks.weather;
    const hours = w?.data?.hourly;
    if (!hours?.length || !w.ms) return null;
    return hours.find((h) => {
      const at = w.ms(h.t);
      return at <= t && t < at + 3600000;
    }) || null;
  },

  /* The key for the weather `sc` at `t`: the ground and the hour's
     temperature from the forecast's row for then, the time of day by the
     forecast's sunrises and sunsets (none for a Show me with its own). */
  illuFor(t, sc, fixed = false) {
    const w = this.hooks.weather;
    return illuKey(sc, { row: this.rowAt(t), now: t, daily: fixed ? null : w?.data?.daily, ms: w?.ms });
  },

  bad(key, now) { return now - (this.illuBad[key] ?? -Infinity) < ILLU_RETRY_MS; },

  /* Look 2 on the overlay: the layer shown, the picture asked for, the drift
     on unless Movement is Still. True while a picture is (or is about to be)
     behind the clock. False for look 1, before wxart.js is there to say what
     the weather is, and for a picture that would not load in the last ten
     minutes — the layer goes and the drawings come back for it. */
  paintIllu(now, sc, s, fixed) {
    const layer = this.illu;
    const look = lookOf(s);
    // Look 3 chosen while the clock was already up: its first photograph now.
    if (look === 3 && !this.photoNow && !this.photoAsking && this.covered) this.nextPhoto();
    const key = look === 3 ? (this.photoNow ? `photo:${this.photoNow}` : '')
      : look === 2 && this.wx ? this.illuFor(now, sc, fixed) : '';
    const on = !!key && !this.bad(key, now);
    if (layer.hidden === on) layer.hidden = !on;
    layer.classList.toggle('nl-drift', on && Number(s.wx_motion) > 0);
    if (!on) {
      this.illuOpening = false;
      this.overlay.classList.remove('nl-pic');
      return false;
    }
    // Just opened over the wall: a picture left in front from the last time
    // is not this one, and is dropped before anybody sees it — the right one
    // fades in from black, not out of the wrong one.
    if (this.illuOpening) {
      this.illuOpening = false;
      if (key !== this.illuShown) this.dropIllu();
    }
    this.overlay.classList.toggle('nl-pic', !!this.illuShown);
    this.loadIllu(key);
    return true;
  },

  dropIllu() {
    for (const im of this.illu.querySelectorAll('img')) im.classList.remove('nl-on');
    this.illuShown = '';
    this.overlay.classList.remove('nl-pic');
  },

  /* The next picture into the <img> behind, decoded, then faded in over the
     one in front (app.css: four seconds; one second from black). Asked again
     for another key before it is ready, the newer one wins. One that will
     not load is noted, and the paint that follows is the drawings'. */
  async loadIllu(key) {
    if (key === this.illuWant) return;
    this.illuWant = key;
    const seq = ++this.illuSeq;
    const imgs = this.illu.querySelectorAll('img');
    const front = imgs[this.illuFront];
    const next = imgs[1 - this.illuFront];
    next.classList.remove('nl-on');
    // Back to the one in front before the other was ready: it stays.
    if (key === this.illuShown) return;
    next.classList.toggle('nl-quick', !this.illuShown);
    next.dataset.time = key.startsWith('photo:') ? 'photo' : key.split('-')[1];
    next.src = this.illuSrc(key);
    let ok = true;
    try {
      await next.decode();
    } catch {
      // A decode can be refused for a picture that loaded (Chrome, now and
      // then): loaded is good enough, it draws in a frame.
      ok = next.complete && next.naturalWidth > 0;
    }
    if (seq !== this.illuSeq) return;           // another picture was asked for meanwhile
    if (!ok) {
      this.illuBad[key] = Date.now();
      this.illuWant = '';
      this.dropIllu();
      console.error(`dim clock: the picture ${key} did not load — the weather drawing instead`);
      if (this.covered) this.paint(Date.now());
      return;
    }
    next.classList.add('nl-on');
    // The one going fades out as slowly as the next fades in. The first
    // picture after the clock opens came in quickly, from black; leaving that
    // quickly too, it would be gone in a second while the next took four —
    // the change dipping through black at its middle.
    front.classList.remove('nl-on', 'nl-quick');
    this.illuFront = 1 - this.illuFront;
    this.illuShown = key;
    delete this.illuBad[key];
    if (!this.illu.hidden) this.overlay.classList.add('nl-pic');
  },

  /* On the wall, with look 2: the pictures the next changes will want,
     fetched and decoded ahead so the change is instant — now's (for the next
     time the clock covers the wall), the next hour's, the one just past the
     next dusk or dawn edge, and the next dim stretch's: the next clock turn
     in cycles, or the hour the dimming next begins. Worked out once a
     minute, kept to the last few. */
  preloadIllu(now) {
    const s = this.settings();
    const wx = this.wx;
    if (!wx || !this.data || lookOf(s) !== 2 || !s.enabled || !this.onWall()) return;
    const minute = Math.floor(now / 60000);
    if (minute === this.aheadMin) return;
    this.aheadMin = minute;
    const hour = new Date(now);
    hour.setMinutes(0, 0, 0);
    const at = [now, hour.getTime() + 3600000];
    const w = this.hooks.weather;
    for (const d of (w?.ms && w.data?.daily) || []) {
      for (const t of [d?.sunrise, d?.sunset]) {
        const sun = t == null ? NaN : w.ms(t);
        for (const edge of [sun - TWILIGHT_MS, sun + TWILIGHT_MS]) {
          if (edge + 60000 > now && edge - now < ILLU_AHEAD_MS) at.push(edge + 60000);
        }
      }
    }
    const turn = cycleAt(s, new Date(now));
    if (turn?.showing) at.push(turn.until);
    else if (!this.modeNow(now)) {
      const h = this.changesAt(s, false, now);
      const next = new Date(hour);
      for (let k = 0; h !== null && k < 24 && next.getTime() - now < ILLU_AHEAD_MS; k++) {
        next.setTime(next.getTime() + 3600000);
        if (next.getHours() === h) { at.push(next.getTime()); break; }
      }
    }
    for (const t of at) {
      const key = this.illuFor(t, wx.withWarnings(wx.scene(this.rowAt(t)), this.warnings, t));
      if (this.bad(key, now)) continue;
      const had = this.illuAhead.get(key);
      this.illuAhead.delete(key);
      if (had) { this.illuAhead.set(key, had); continue; }
      const im = new Image();
      im.decoding = 'async';
      im.src = this.illuSrc(key);
      im.decode().catch(() => {});   // found again, and noted, when it is wanted
      this.illuAhead.set(key, im);
    }
    while (this.illuAhead.size > ILLU_KEEP) this.illuAhead.delete(this.illuAhead.keys().next().value);
  },

  /* The header's 🌙 (2026-10-18): the clock over this screen now, whatever
     the hour and the settings, until a tap — or a kitchen timer running out,
     whose alarm would be under it. */
  dimNow() {
    this.preview = null;
    this.manual = true;
    this.closeSheet();
    this.cover(true);
  },

  /* Show me: one weather on this screen for a minute, or until a tap; then
     the sheet again, to try the next. */
  show(key) {
    const now = Date.now();
    this.preview = { key, until: now + PREVIEW_MS };
    if (key.startsWith('warn:') && this.wx) {
      const w = this.wx.warnSample(key.slice(5), now, this.nowRow());
      if (w) Object.assign(this.preview, w);
    }
    this.closeSheet();
    this.cover(true);
  },

  endPreview() {
    this.preview = null;
    this.cover(false);
    this.openSheet();
  },

  /* A day ahead in one line under the time: now, then every second hour on
     the even hours, so midnight is always one of them and carries the new
     day's name. Hour, glyph, temperature — the glyphs in the clock's colour
     (app.css), not the header's sun-yellow. Drawn again only when the hour
     or the forecast changes, not every second. */
  paintForecast(el) {
    const w = this.hooks.weather;
    const hours = w?.data?.hourly;
    const i = hours?.length && w.nowIndex ? w.nowIndex(hours) : -1;
    const key = i < 0 ? '' : `${hours[i].t}|${w.data.fetched_at ?? ''}`;
    if (key === this.fcKey) return;
    this.fcKey = key;
    if (i < 0) { el.innerHTML = ''; return; }   // no forecast that reaches now: none
    // The hours by their instants (weather.js's ms(): epoch seconds), so the
    // night the clocks go back has its 02:00 twice in the forecast — and the
    // row shows it once, not "02 02".
    const at = (h) => new Date(w.ms(h.t));
    const picked = [hours[i]];
    for (let j = i + 1; j < hours.length && picked.length < FORECAST_SLOTS; j++) {
      const hr = at(hours[j]).getHours();
      if (hr % 2 === 0 && hr !== at(picked[picked.length - 1]).getHours()) picked.push(hours[j]);
    }
    el.innerHTML = picked.map((h, n) => {
      const dt = at(h);
      const label = n === 0 ? 'now'
        : dt.getHours() === 0 ? dt.toLocaleDateString('en-GB', { weekday: 'short' })
        : String(dt.getHours()).padStart(2, '0');
      return `<div class="nt-fh">
        <span class="nt-fh-t">${esc(label)}</span>
        <span class="nt-fh-ico">${this.glyph(h.code, h.day)}</span>
        <span class="nt-fh-temp">${Number.isFinite(h.temp) ? `${Math.round(h.temp)}°` : ''}</span>
      </div>`;
    }).join('');
  },

  glyph(code, day) {
    try { return this.hooks.weather?.icon?.(code, day) || ''; } catch { return ''; }
  },

  /* --------------------------------------------------------- the sheet -- */

  addMoon() {
    if (this.moon || !this.hooks.timeSheet?.addHeaderButton) return;
    this.moon = this.hooks.timeSheet.addHeaderButton({
      glyph: '🌙', title: 'screen dimming', onClick: () => this.openSheet(),
    });
  },

  buildSheet() {
    const el = document.createElement('div');
    el.id = 'nt-sheet';
    el.className = 'sheet sheet-full';   // the settings window kit (app.css); its picture picks want the wall's width
    el.innerHTML = `
      <header>
        <span class="sheet-icon" aria-hidden="true">🌙</span>
        <div class="sheet-title">
          <h2>Screen dimming</h2>
          <span class="sheet-status nt-now"></span>
        </div>
        <span class="spacer"></span>
        <button class="ls-close">Close</button>
      </header>
      <div class="ls-body"></div>`;
    el.querySelector('.ls-close').onclick = () => this.closeSheet();
    document.body.appendChild(el);
    this.sheet = el;
  },

  sheetIsOpen() { return !!this.sheet?.classList.contains('open'); },

  openSheet() {
    if (!this.data) return;
    this.sheet.classList.add('open');
    this.renderSheet();
  },

  closeSheet() { this.sheet?.classList.remove('open'); },

  /* The first hour after `now` that is dimmed when `now` is not, or not
     dimmed when `now` is — within a day. Night running on into chosen day
     hours (or day hours into the night) is one stretch of dim wall, so the
     line names when the photographs really come back — unless the hours are
     in cycles, which begin with the photographs. */
  changesAt(s, dimmed, now) {
    const d = new Date(now);
    d.setMinutes(0, 0, 0);
    for (let k = 1; k <= 24; k++) {
      const at = new Date(d.getTime() + k * 3600000);
      const mode = dimMode(s, at);
      // In cycles a stretch of chosen hours begins with the photographs: for
      // a dimmed wall, that is when they come back.
      const opens = dimmed && s.day_cycle && mode === 'day'
        && dimMode(s, new Date(at.getTime() - 3600000)) !== 'day';
      if (!!mode !== dimmed || opens) return at.getHours();
    }
    return null;
  },

  /* When the chosen day hours `now` is in stop being day hours, in ms. */
  dayEndsAt(s, now) {
    const d = new Date(now);
    d.setMinutes(0, 0, 0);
    for (let k = 1; k <= 24; k++) {
      const at = new Date(d.getTime() + k * 3600000);
      if (dimMode(s, at) !== 'day') return at.getTime();
    }
    return Infinity;
  },

  nowLine() {
    const s = this.settings();
    const now = Date.now();
    if (!s.enabled) return 'switched off';
    if (this.testing(now)) return 'trying it: night for a minute';
    const mode = dimMode(s, new Date(now));
    const at = this.changesAt(s, !!mode, now);
    const turn = mode === 'day' ? cycleAt(s, new Date(now)) : null;
    if (turn) {
      // When this stretch of chosen hours ends: the night, or nothing.
      const end = this.dayEndsAt(s, now);
      if (turn.until < end) {
        return turn.showing ? `in cycles: photographs, the clock at ${hm(turn.until)}`
          : `in cycles: dimmed, photographs at ${hm(turn.until)}`;
      }
      if (turn.showing) {
        return `in cycles: photographs, ${dimMode(s, new Date(end)) === 'night' ? 'night' : 'not dimmed'}`
          + ` from ${hm(end)}`;
      }
    }
    if (mode && at === null) return 'dimmed all day';
    if (mode === 'night') return at === s.to_h ? `night, until ${hh(at)}` : `night, dimmed until ${hh(at)}`;
    if (mode === 'day') return `dimmed, until ${hh(at)}`;
    if (at === null) return 'no hours chosen';
    return s.day_cycle && dimMode(s, new Date(2026, 0, 1, at)) === 'day'
      ? `not dimmed now — in cycles from ${hh(at)}` : `not dimmed now — from ${hh(at)}`;
  },

  /* The header's line (the settings window kit): "On · night, until 08:00",
     or "Off" — and its tone: dimmed or trying it now is live, on with no
     hour chosen at all wants somebody, switched off is off. */
  headLine() {
    return this.settings().enabled ? `<b>On</b> · ${esc(this.nowLine())}` : '<b>Off</b>';
  },

  headTone() {
    const s = this.settings();
    if (!s.enabled) return 'off';
    const now = Date.now();
    if (this.testing(now) || this.modeNow(now)) return 'live';
    if (!dimMode(s, new Date(now)) && this.changesAt(s, false, now) === null) return 'warn';
    return 'ok';
  },

  /* The state sentence's second line: what the wall does now, its times in
     bold — "Not dimmed now — from 22:00." */
  sumNow() {
    const line = this.nowLine();
    return `${esc(line.charAt(0).toUpperCase() + line.slice(1)).replace(/\d\d:\d\d/g, '<b>$&</b>')}.`;
  },

  /* The header's line and the state sentence's "now", every second: the
     hour turns, a turn of the cycles ends, Try it runs out. */
  renderNow() {
    if (!this.sheetIsOpen() || !this.data) return;
    this.ctx.sheetkit.status(this.sheet.querySelector('.nt-now'), this.headLine(), this.headTone());
    const now = this.sheet.querySelector('.nt-sumnow');
    const html = this.sumNow();
    if (now && now.innerHTML !== html) now.innerHTML = html;
  },

  /* The state sentence at the top of the sheet (the settings window kit):
     when the dim clock covers the wall, with the master switch beside it. */
  sumCard(s) {
    const kit = this.ctx.sheetkit;
    const ctl = kit.toggle(!!s.enabled, `data-put="enabled" data-v="${s.enabled ? 'false' : 'true'}"`);
    const spans = daySpans(dayOnly(s));
    const night = s.night ? `at night, <b>${hh(s.from_h)}–${hh(s.to_h)}</b>, with the screen at
      <b>${esc(s.screen_pct)} %</b>` : '';
    let day = '';
    if (spans.length) {
      day = spans.length === 1 && spans[0][0] === spans[0][1] ? '<b>all day</b>'
        : `by day <b>${esc(andList(spans.map(spanText)))}</b>`;
      if (s.day_cycle) day += ', in cycles';
    }
    // Night off is not "not at night": the hours by day can run into the
    // night, or be all twenty-four. What is off is the night's own dimming,
    // the one that turns the screen down.
    const what = night && day ? `${night} — and ${day}` : night ? `${night}; not by day`
      : day ? `${day}; the night's own hours, with the screen turned down, are off` : '';
    if (!s.enabled) {
      return kit.sum('Off — never dimmed, night or day.', {
        next: what ? `When it is on: the dim clock covers the wall ${what}.` : '', ctl, cap: 'Screen dimming', off: true,
      });
    }
    if (!what) {
      return kit.sum('On, but no hours are chosen: the night is off and no hour of the day is dimmed.', {
        next: 'Next: <b>nothing</b>, until the night or an hour by day is chosen.', ctl, cap: 'Screen dimming',
      });
    }
    return kit.sum(`The dim clock covers the wall ${what}.`, {
      next: `<span class="nt-sumnow">${this.sumNow()}</span>`, ctl, cap: 'Screen dimming',
    });
  },

  /* Each card's live note: beside its heading and under its name on the
     rail. While it is switched off, a note of what a card does says what it
     would do — "when on: …" — or "off". */
  notes(s) {
    const whenOn = s.enabled ? '' : 'when on: ';
    const on = whenOn || 'on · ';
    const spans = daySpans(dayOnly(s));
    const shown = SHOW_PARTS.filter((k) => s[k]).length;
    return {
      night: s.night ? `${whenOn}${hh(s.from_h)}–${hh(s.to_h)} · screen ${s.screen_pct} %` : 'off',
      day: spans.length ? `${whenOn}${spans.map(spanText).join(', ')}` : 'no hours',
      cycles: !s.day_cycle ? 'off' : spans.length
        ? `${whenOn}photographs ${Number(s.cycle_show_min) || 10} min · clock ${Number(s.cycle_dim_min) || 15} min`
        : `${on}no hours by day`,
      look: `${s.look_auto ? 'changes by itself · today ' : ''}${LOOK_NAMES[lookOf(s)]}`,
      lookAuto: !s.look_auto ? 'off' : `every ${Number(s.look_days) === 1 ? 'day' : `${s.look_days} days`} · ${
        (s.look_pool || []).join(', ')}`,
      parts: shown === SHOW_PARTS.length ? `${whenOn}all ${shown} shown`
        : shown ? `${whenOn}${shown} of ${SHOW_PARTS.length} shown` : 'nothing shown',
      weather: s.wx_art ? `${on}${MOTION_WORDS[Number(s.wx_motion)] || ''}` : 'off',
      warn: Number(s.wx_warn)
        ? `${whenOn}${WARN_LEVELS[Number(s.wx_warn)] || ''}${s.wx_warn_blink ? ' · blinking' : ''}` : 'off',
    };
  },

  /* By day: the twenty-four hours, twelve a line, each a button. An hour of
     the night (while the night is on) is dim already, dashed on the dark of
     the night, and cannot be chosen. */
  hourStrip(s, nightOn) {
    const day = new Set(s.day_hours || []);
    const night = (h) => nightOn && isNight(s, new Date(2026, 0, 1, h));
    const cells = Array.from({ length: 24 }, (_, h) => {
      const isN = night(h);
      const cls = isN ? ' nt-hn' : day.has(h) ? ' on' : '';
      return `<button class="ls-btn nt-h${cls}" data-hour="${h}"${isN ? ' disabled' : ''}
        aria-pressed="${!isN && day.has(h)}" aria-label="${hh(h)}">${String(h).padStart(2, '0')}</button>`;
    }).join('');
    return `<div class="nt-hours sheet-grid sheet-hours">${cells}</div>`;
  },

  /* "From 18:00: photographs until 18:10, the clock until 18:25, then
     again." — the first stretch of chosen hours, as cycleAt counts it; a
     stretch too short for a second cycle says where its clock stops. Its
     length from the span itself (all twenty-four is a whole day): show is at
     most 30 minutes and a stretch at least an hour, so the photographs fit. */
  turnsLine(s) {
    const spans = daySpans(dayOnly(s));
    if (!s.day_cycle || !spans.length) return '';
    const [f, t] = spans[0];
    const d = new Date();
    d.setHours(f, 0, 0, 0);
    const show = Number(s.cycle_show_min) || 10;
    const dim = Number(s.cycle_dim_min) || 15;
    const a = d.getTime() + show * 60000;
    const b = a + dim * 60000;
    const len = ((((t - f) % 24) + 24) % 24 || 24) * 60;
    if (show + dim >= len) return `From ${hh(f)}: photographs until ${hm(a)}, the clock until ${hh(t)}.`;
    return `From ${hh(f)}: photographs until ${hm(a)}, the clock until ${hm(b)}, then again.`;
  },

  /* "from <the forecast's city>", or plainly from here. */
  moonWhere() {
    const p = this.sky?.place || this.hooks.weather?.data?.city;
    return p ? `from ${p}` : 'from here';
  },

  /* "Now: waxing crescent, 17 % lit, below the horizon, rises 13:30." */
  moonNowLine() {
    const d = this.sky;
    if (!d) return 'No word from the server about it yet.';
    const parts = [d.name.toLowerCase(), `${Math.round(d.lit * 100)} % lit`];
    if (d.up === true) parts.push(d.set ? `in the sky, sets ${hm(d.set * 1000)}` : 'in the sky');
    if (d.up === false) parts.push(d.rise ? `below the horizon, rises ${hm(d.rise * 1000)}` : 'below the horizon');
    return `Now: ${parts.join(', ')}.`;
  },

  /* "in <the forecast's city>", or nothing: the sun's times are the forecast's. */
  sunWhere() {
    const city = this.hooks.weather?.data?.city;
    return city ? `in ${city}` : '';
  },

  /* "Today: sunrise 07:40, sunset 17:39 — 9 h 59 min of daylight." */
  sunNowLine() {
    const w = this.hooks.weather;
    const day = w?.ms ? sunDay(w.data?.daily, Date.now(), w.ms) : null;
    if (!day) return 'No sunrise and sunset in the forecast yet.';
    return `${day.today ? 'Today' : 'Tomorrow'}: sunrise ${hm(day.rise)}, sunset ${hm(day.set)} — `
      + `${dayLength(day.len)} of daylight.`;
  },

  /* "Now: 3 days Halloween, 5 days Lesjön, …" — the first three, as the
     line would start, and the "…" only when more are coming. */
  countdownNowLine() {
    const items = countdownItems(this.hooks.calendar, this.events, new Date(), 4);
    if (!items.length) return 'Nothing coming up in the countdown now.';
    return `Now: ${items.slice(0, 3).map((i) => `${i.when} ${i.what}`).join(', ')}${items.length > 3 ? ', …' : '.'}`;
  },

  /* "The weather in <the forecast's city>", or plainly the weather. */
  weatherOf() {
    const city = this.hooks.weather?.data?.city;
    return city ? `The weather in ${city}` : 'The weather';
  },

  /* What the pictures would be now, in words — "Now: rain · windy." Over
     an illustration only what falls is drawn, so a dry hour says so. */
  artNowLine() {
    if (!this.wx) return '';
    const sc = this.wx.withWarnings(this.wx.scene(this.nowRow()), this.warnings, Date.now());
    if (!sc) return 'No forecast for this hour: nothing to draw.';
    if (lookOf(this.settings()) >= 2 && !overScene(sc)) {
      return `Now: ${this.wx.describe(sc).toLowerCase()} — nothing falling, only the picture.`;
    }
    return `Now: ${this.wx.describe(sc).toLowerCase()}.`;
  },

  /* SMHI's warnings for here, in words, whatever the levels chosen: "Now:
     yellow warning — wind, <its area>, until 03:00." */
  warnNowLine() {
    const d = this.warnData;
    if (!d) return '';
    const now = Date.now();
    const list = this.warnings.filter((w) => !(w.end && w.end * 1000 <= now))
      .map((w) => ({ ...w, on: !(w.start && w.start * 1000 > now) }));
    if (!list.length) {
      if (d.fetched_at) return 'Now: no warning here.';
      return d.error ? `SMHI has not answered yet (${d.error}).` : 'SMHI has not been asked yet.';
    }
    return `Now: ${list.map((w) => `${(WARN_WORDS[w.level] || 'warning').toLowerCase()} — `
      + [this.warnWhat(w).toLowerCase(), w.area, this.warnWhen(w, now)].filter(Boolean).join(', ')).join('; ')}.`;
  },

  dayLine(s) {
    const spans = daySpans(dayOnly(s));
    return spans.length
      ? `Dimmed by day ${andList(spans.map(spanText))}.`
      : 'No hours chosen: by day the wall is not dimmed.';
  },

  /* The look (Alex, 2026-10-22: "add the current animation and visuals as
     option 1 … new illustrations … as option 2"): the two side by side, each
     a big button with a small picture of itself and what it is in a line,
     the chosen one ticked and outlined, Show me beside them — and, with the
     second, the picture it would be now in words. The picks take both
     columns of the card's row (sheet-wide), the words come under them. */
  lookRow(s) {
    const look = lookOf(s);
    const mini = `<span class="nl-mini">${esc(hm(Date.now()))}</span>`;
    // Changing by itself, a tap on a look chooses it and stops the turns.
    const pick = (v, thumb, name, words) => `<button class="nl-pick${look === v ? ' on' : ''}"
        data-look="${v}" aria-pressed="${look === v}">
        <span class="nl-thumb">${thumb}${mini}</span>
        <span class="nl-what"><b>${name}</b><span>${words}</span></span>
      </button>`;
    // Look 1 in small: a crescent and a few strokes of rain in the clock's
    // own colour, on black — drawn here, no picture to fetch — kept off the
    // little clock across its middle.
    const rain = [[14, 14], [26, 30], [12, 60], [30, 70], [56, 66], [84, 72], [108, 64], [134, 68], [150, 54]]
      .map(([x, y]) => `<line x1="${x}" y1="${y}" x2="${x - 3}" y2="${y + 12}"/>`).join('');
    const drawing = `<svg class="nl-draw" viewBox="0 0 160 90" aria-hidden="true">
        <path class="nl-cres" d="M140 5A15 15 0 1 0 140 35A11.5 15 0 1 1 140 5Z"/>
        <g class="nl-rain">${rain}</g></svg>`;
    const picture = `<img src="${esc(this.illuSrc('green-night-clear'))}" alt="" draggable="false">`;
    let now = '';
    if (look === 2 && this.wx) {
      const t = Date.now();
      now = illuWords(this.illuFor(t, this.wx.withWarnings(this.wx.scene(this.nowRow()), this.warnings, t)));
    }
    return `<div class="ls-row nl-row">
        <div class="nl-picks sheet-wide">
          ${pick(1, drawing, '1 · Weather drawings',
            'the weather drawn around the clock in its own warm colour, moving as you set below')}
          ${pick(2, picture, '2 · Illustrations',
            'a painted lake and cottage in the weather outside and the time of day — 33 pictures painted for this wall')}
          ${pick(3, this.photoNow || this.photoNext
            ? `<img src="${esc(this.photoNow || this.photoNext)}" alt="" draggable="false">`
            : '<span class="nl-photo-ico" aria-hidden="true">🖼️</span>', '3 · A family photo',
            'one of the family’s liked photographs, as it is — a new one each time the screen dims, kept until the next')}
          ${pick(4, `<svg class="nl-scape" viewBox="0 0 160 90" aria-hidden="true">
              <defs><linearGradient id="nlsk" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#0b1426"/>
              <stop offset="1" stop-color="#3a3350"/></linearGradient></defs>
              <rect width="160" height="90" fill="url(#nlsk)"/>
              <circle cx="122" cy="20" r="6" fill="#e2dcc4"/><circle cx="125" cy="18" r="5.4" fill="#0f1a30"/>
              <path d="M0 52 L20 44 L44 50 L70 40 L98 49 L126 42 L160 50 L160 90 L0 90Z" fill="#1c2633"/>
              <rect y="56" width="160" height="22" fill="#18233a"/>
              <path d="M0 78 Q50 72 96 77 T160 74 L160 90 L0 90Z" fill="#0a0f14"/>
              <path d="M12 80 L19 56 L26 80Z M30 82 L36 62 L42 82Z M140 80 L147 58 L154 80Z" fill="#05080b"/>
              <rect x="100" y="66" width="16" height="10" fill="#4a1d17"/><path d="M98 66 L108 59 L118 66Z" fill="#0d0d10"/>
              <rect x="103" y="69" width="3" height="3" fill="#ffc278"/></svg>`, '4 · Living landscape',
            'drawn and animated live: lake, forest and cottage under the sky and the weather outside — rain on the water, snow, fog, wind in the trees, stars, northern lights')}
          <span class="ls-set"><button class="ls-btn nt-look" data-show="clock">Show me</button></span>
        </div>
        ${now ? `<span class="ls-label"><span class="db-hint">Now it is ${esc(now)}.</span></span>` : ''}
      </div>`;
  },

  /* The looks taking turns (2026-11-05): On/Off, how many days each, and
     which of the four — in this order, from today's on. */
  lookAutoRow(s) {
    const kit = this.ctx.sheetkit;
    const on = !!s.look_auto;
    const pool = new Set((s.look_pool || []).map(Number));
    const t = lookToday(s);
    const days = [1, 2, 3, 5, 7, 14];
    const when = (n) => {
      if (n === 1) return 'tomorrow';
      const d = new Date();
      d.setDate(d.getDate() + n);
      return d.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'short' });
    };
    const said = !on ? 'Off — the look chosen above stays.'
      : `Today: <b>${LOOK_NAMES[t.look]}</b>.${t.next ? ` From ${esc(when(t.next.inDays))}: <b>${LOOK_NAMES[t.next.look]}</b>.`
        : ' Only one look is chosen below, so it stays.'}`;
    return `
      <div class="ls-row"><span class="ls-label"><span class="db-hint sheet-lead">the looks take turns by
        themselves, each for the days set, at midnight — every screen the same. Choosing a look above by
        hand stops the turns.</span><span class="db-hint">${said}</span></span>
        ${kit.toggle(on, `data-put="look_auto" data-v="${on ? 'false' : 'true'}"`)}</div>
      <div class="ls-row${on ? '' : ' nt-off'}"><span class="ls-label">Each one for</span>
        <span class="ls-set sheet-seg">${days.map((d) => `<button class="ls-btn${Number(s.look_days) === d ? ' on' : ''}"
          data-put="look_days" data-v="${d}" aria-pressed="${Number(s.look_days) === d}">${d === 1 ? '1 day' : `${d} days`}</button>`).join('')}</span></div>
      <div class="ls-row${on ? '' : ' nt-off'}"><span class="ls-label">Taking turns</span>
        <span class="ls-set sheet-chips">${LOOKS.map((v) => `<button class="ls-btn${pool.has(v) ? ' on' : ''}"
          data-pool="${v}" aria-pressed="${pool.has(v)}">${v} · ${LOOK_NAMES[v]}</button>`).join('')}</span></div>`;
  },

  renderSheet() {
    if (!this.sheetIsOpen() || !this.data) return;
    const kit = this.ctx.sheetkit;
    const s = this.settings();
    const nightOn = !!(s.enabled && s.night);
    const pick = (v, want) => (v === want ? ' on' : '');
    const onOff = [[true, 'On'], [false, 'Off']];
    /* One setting: its name and hint, then an On/Off pair as one switch (a
       tap turns it the other way) or the choices as one bar — `none` is the
       choice that is "none" (Off, Still), chosen in the kit's quiet fill;
       `bar` adds to the bar's class; `line` goes under the hint. An empty
       label is a row whose card heading names it: the hint leads. */
    const row = (label, hint, key, opts, extra = '', { none, bar = '', line = '' } = {}) => {
      const sw = opts.length === 2 && opts[0][0] === true && opts[1][0] === false;
      const ctl = sw ? kit.toggle(!!s[key], `data-put="${key}" data-v="${s[key] ? 'false' : 'true'}"`)
        : `<span class="ls-set sheet-seg${bar ? ` ${bar}` : ''}">${opts.map(([v, text]) => `<button
          class="ls-btn${pick(s[key], v)}${v === none ? ' sheet-none' : ''}" data-put="${key}"
          data-v="${esc(JSON.stringify(v))}" aria-pressed="${s[key] === v}">${text}</button>`).join('')}</span>`;
      return `
      <div class="ls-row${extra}">
        <span class="ls-label">${label}<span class="db-hint${label ? '' : ' sheet-lead'}">${hint}</span>${line}</span>
        ${ctl}
      </div>`;
    };
    const b = this.data.backlight;
    const light = b && b.max
      ? `the screen's backlight is at ${b.level} of ${b.max} (${Math.round((100 * b.level) / b.max)} %),
         as the wall said at ${new Date(b.at * 1000).toLocaleTimeString('en-GB',
           { hour: '2-digit', minute: '2-digit', hour12: false })}`
      : 'the wall has not reported its backlight: the dimming waits for the update of the '
        + 'small program on the wall that puts it to sleep. Until then there is only the clock.';
    // The screen's backlight now, under how bright it stays at night: a
    // line of its own, a warning while the wall has not said.
    const said = light.charAt(0).toUpperCase() + light.slice(1);
    const screen = `<span class="${b && b.max ? 'sheet-line' : 'db-warn'}">${esc(said)}${said.endsWith('.') ? '' : '.'}</span>`;
    const nightOff = !s.night ? ' nt-off' : '';
    const turnsOff = !s.day_cycle ? ' nt-off' : '';
    const two = lookOf(s) >= 2;            // a picture behind the clock (2 or 3)
    const n = this.notes(s);
    this.renderNow();
    this.sheet.querySelector('.ls-body').innerHTML = `
      ${this.sumCard(s)}

      ${kit.sec('At night', `
        <p class="sheet-note">A dim clock over the wall instead of the photographs, at the hours
          below — on the wall screen only.</p>
        ${row('Night', `from the hour below until the one after it, with the screen itself
          turned down too`, 'night', [[true, 'On'], [false, 'Off']])}
        ${row('From', 'when night begins', 'from_h',
          [20, 21, 22, 23, 0].map((h) => [h, hh(h)]), nightOff, { bar: 'sheet-hourbar' })}
        ${row('Until', 'the first hour of the day', 'to_h', [5, 6, 7, 8, 9].map((h) => [h, hh(h)]), nightOff,
          { bar: 'sheet-hourbar' })}
        ${row('Screen at night', 'how bright the screen stays all night, of its brightest', 'screen_pct',
          [5, 10, 20, 30, 50].map((p) => [p, `${p} %`]), nightOff, { line: screen })}
        ${row('Show the clock after', `untouched this long on the view the wall rests on. When the
          screen wakes at night the clock is there at once; a touch always gives the wall back.`,
          'idle_min', [[1, '1 min'], [2, '2 min'], [5, '5 min'], [10, '10 min']], nightOff)}`, { note: n.night })}

      ${kit.sec('By day', `
        <div class="ls-row">
          <span class="ls-label">Dimmed hours<span class="db-hint">tap an hour to dim it, tap it
            again to give it back; each is the whole hour, 13 is 13:00 until 14:00. The dashed
            ones are the night's, dim already. ${esc(this.dayLine(s))}</span></span>
          <div class="sheet-ctl nt-dayset">
            ${this.hourStrip(s, nightOn)}
            ${(s.day_hours || []).length
              ? '<span class="ls-set"><button class="ls-btn nt-clear">No hours by day</button></span>' : ''}
          </div>
        </div>
        ${row('After a tap', `a tap on the clock gives the photographs back for this long, and every
          touch starts it again; then the clock is back. Over the view the wall rests on only — never
          over Cooking, House, TV or Birds while somebody is using them. By day the screen's own light
          is left as it is, so the pictures come back at once.`,
          'day_idle_min', [[1, '1 min'], [2, '2 min'], [5, '5 min'], [10, '10 min'],
            [15, '15 min'], [30, '30 min']])}`, { note: n.day })}

      ${kit.sec('In cycles', `
        ${row('', `Off: the clock covers the chosen hours all through. On: within them the
          photographs for a while, then the clock for a while, and again — from the hour each
          stretch begins, the photographs first. ${esc(this.turnsLine(s))}`,
          'day_cycle', [[true, 'On'], [false, 'Off']])}
        ${row('Photographs for', 'each time the photographs show', 'cycle_show_min',
          [5, 10, 15, 20, 30].map((m) => [m, `${m} min`]), turnsOff)}
        ${row('Then the clock for', 'each time the clock covers them', 'cycle_dim_min',
          [5, 10, 15, 20, 30, 45, 60].map((m) => [m, `${m} min`]), turnsOff)}`, { note: n.cycles })}

      ${kit.sec('The look', this.lookRow(s), { note: n.look })}

      ${kit.sec('Change the look by itself', this.lookAutoRow(s), { note: n.lookAuto })}

      ${kit.sec('What the dim clock shows', `
        ${row('Sunrise and sunset', `in the top left corner: today's sunrise and sunset ${esc(this.sunWhere())}
          — tomorrow's once the sun has set — and how long the day is, under the day's arc with the sun
          on it while it is up. ${esc(this.sunNowLine())}`, 'show_sun', onOff)}
        ${row('The moon', `in the top right corner of the dim clock, as it is now ${esc(this.moonWhere())}:
          how much of it is lit and which way, leaning in the sky as it leans there now — a waxing moon
          in the evening tips its bright side down towards the set sun — fainter while it is below the
          horizon, and when it next rises or sets. With the weather pictures on, their own moon gives
          way to it. ${esc(this.moonNowLine())}`, 'moon', [[true, 'On'], [false, 'Off']])}
        ${row('The time', 'the big clock in the middle', 'show_clock', onOff)}
        ${row('Forecast', 'the day ahead in one line under the time: now, then every second hour',
          'show_forecast', onOff)}
        ${row('The date', 'the weekday and the date', 'show_date', onOff)}
        ${row('Temperature outside', 'the temperature now, under the date', 'show_temp', onOff)}
        ${row('Kitchen timer', `a timer that is running, counting down under the rest. Its alarm rings
          whether it is shown or not, and the clock steps aside for it.`, 'show_timer', onOff)}
        ${row('Countdown', `at the very bottom, in one line: the countdown's next events, nearest first,
          in the same words as its cards — as many as fit. ${esc(this.countdownNowLine())}`,
          'show_countdown', onOff)}
        <div class="ls-row">
          <span class="ls-label">Show me the clock<span class="db-hint">on this screen for a minute, with
            what is chosen here, whatever the hour; a tap ends it and brings this sheet back. The weather
            pictures and SMHI's warnings are below, each with its own Off.</span></span>
          <span class="ls-set"><button class="ls-btn nt-look" data-show="clock">Show me</button></span>
        </div>`, { note: n.parts })}

      ${kit.sec('Weather around the clock', `
        ${row('Weather pictures', two ? `${esc(this.weatherOf())} this hour over the illustration:
          rain and snow falling over the picture — drizzle, rain, a downpour, sleet, hail, a few small
          flakes or a crowd of big ones, as heavy as the forecast says — and a thunderstorm's
          lightning. The picture has the sky, the clouds and the fog already. Off: only the picture.
          ${esc(this.artNowLine())}` : `${esc(this.weatherOf())} this hour, drawn around the dim
          clock: the sun or the stars, clouds, fog, drizzle, rain, snow, sleet, wind and thunder, as
          heavy as the forecast says — a few small flakes or a crowd of big ones, a breeze or a gale.
          The time, the date and the forecast stay as they are. ${esc(this.artNowLine())}`,
          'wx_art', [[true, 'On'], [false, 'Off']])}
        ${row('Movement', two ? `How much the picture and the rain move. Still: the picture holds
          still and nothing falling moves, nothing to catch the eye. Slight, Medium and Lively: the
          picture drifts slowly, a little closer and back over a couple of minutes, and the rain falls
          and the snow drifts — slowly, or at the weather's own pace.`
          : `Still: a picture that never moves, nothing to catch the eye. Slight,
          Medium and Lively: the rain falls, the snow drifts and the clouds pass — slowly, or at the
          weather's own pace.`, 'wx_motion', [[0, 'Still'], [1, 'Slight'], [2, 'Medium'], [3, 'Lively']], '',
          { none: 0 })}
        ${this.wx ? `<div class="ls-row">
          <span class="ls-label">Show me<span class="db-hint">one weather on this screen for a minute,
            with the movement above, whatever the hour and whether the pictures are on or not; a tap
            ends it and brings this sheet back</span></span>
          <span class="ls-set nt-show">${[['now', 'Now'], ...this.wx.SAMPLES].map(([k, label]) =>
            `<button class="ls-btn" data-show="${esc(k)}">${esc(label)}</button>`).join('')}</span>
        </div>` : ''}`, { note: n.weather })}

      ${kit.sec('Weather warnings', `
        ${row('Warnings', `SMHI's warnings for the place of the forecast, above the time on the dim
          clock in their own colour — yellow, orange or red. One that has begun is filled in and blinks;
          one beginning within a day is an outline that says from when. Messages are SMHI's lowest step,
          often weeks long (water shortage, fire risk), in grey-blue and never blinking. A warning on now
          for wind, rain, snow or thunder also makes the weather pictures at least as heavy as it says.
          ${esc(this.warnNowLine())}`,
          'wx_warn', [[0, 'Off'], [1, 'Messages too'], [2, 'Yellow and up'], [3, 'Orange and up'],
            [4, 'Red only']], '', { none: 0 })}
        ${row('Blinking', `while a warning is on: slowly for yellow, quicker for orange, fast for red.
          Off: it stays lit.`, 'wx_warn_blink', [[true, 'On'], [false, 'Off']])}
        ${this.wx ? `<div class="ls-row">
          <span class="ls-label">Show me a warning<span class="db-hint">on this screen for a minute,
            with the weather it might come with, whatever the levels chosen above; a tap ends it</span></span>
          <span class="ls-set nt-show">${['yellow', 'orange', 'red'].map((l) =>
            `<button class="ls-btn nt-show-${l}" data-show="warn:${l}">${esc(WARN_WORDS[l])}</button>`).join('')}</span>
        </div>` : ''}`, { note: n.warn })}

      ${kit.sec('Try it', `
        <div class="ls-row">
          <span class="ls-label"><span class="db-hint sheet-lead">night on the wall for a minute, whatever
            the hour: the clock at once, and the screen turned down within a quarter of a minute</span></span>
          <span class="ls-set"><button class="ls-btn sheet-primary nt-test">Night for a minute</button></span>
        </div>`)}`;
    this.sheet.querySelectorAll('[data-put]').forEach((btn) => {
      btn.onclick = () => this.put({ [btn.dataset.put]: JSON.parse(btn.dataset.v) });
    });
    // A look chosen by hand stops the turns: it is the one wanted now.
    this.sheet.querySelectorAll('[data-look]').forEach((btn) => {
      btn.onclick = () => this.put({ look: Number(btn.dataset.look), look_auto: false });
    });
    this.sheet.querySelectorAll('[data-pool]').forEach((btn) => {
      btn.onclick = () => {
        const v = Number(btn.dataset.pool);
        const pool = new Set(this.settings().look_pool || []);
        if (pool.has(v)) pool.delete(v); else pool.add(v);
        if (pool.size) this.put({ look_pool: [...pool].sort() });
      };
    });
    this.sheet.querySelectorAll('[data-hour]').forEach((btn) => {
      btn.onclick = () => {
        const h = Number(btn.dataset.hour);
        const on = new Set(this.settings().day_hours || []);
        if (on.has(h)) on.delete(h); else on.add(h);
        this.put({ day_hours: [...on].sort((a, b) => a - b) });
      };
    });
    const clear = this.sheet.querySelector('.nt-clear');
    if (clear) clear.onclick = () => this.put({ day_hours: [] });
    this.sheet.querySelectorAll('[data-show]').forEach((btn) => {
      btn.onclick = () => this.show(btn.dataset.show);
    });
    this.sheet.querySelector('.nt-test').onclick = () => this.test();
    this.sheet.querySelectorAll('.nl-thumb img').forEach((im) => { im.onerror = () => im.remove(); });
    kit.sync(this.sheet);
  },

  /* Shown at once, then sent; the server's answer is kept only if it is the
     answer to the newest change, so hours tapped quickly one after another
     never come back as fewer than were tapped. */
  async put(patch) {
    if (!this.data) return;
    const seq = ++this.putSeq;
    this.data = { ...this.data, settings: { ...this.settings(), ...patch } };
    this.changed();
    this.renderSheet();
    this.tick();
    this.putting += 1;
    try {
      const r = await fetch('/api/night/settings', {
        method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(patch),
      });
      const body = r.ok ? await r.json().catch(() => null) : null;
      if (body?.settings && seq === this.putSeq) this.data = { ...this.data, ...body };
    } catch { /* the next snapshot puts the sheet right */ }
    this.putting -= 1;
    if (seq === this.putSeq) {
      this.changed();
      this.renderSheet();
      this.tick();
    }
  },

  async test() {
    try {
      const r = await fetch('/api/night/test', { method: 'POST' });
      if (r.ok) this.data = { ...this.data, ...(await r.json()) };
    } catch { /* nothing tried; nothing shown */ }
    this.renderSheet();
    this.tick();
  },
};
