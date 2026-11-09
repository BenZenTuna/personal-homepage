/* Weather around the dim clock (night.js). Alex, 2026-10-13: when the panel
   is dimmed, the weather outside drawn on the screen, as heavy as the
   weather is, with the clock, the date and the forecast where they were and
   the drawing around them.

   What to draw is scene(): one hour of the forecast (weather.py's row: the
   WMO code, is_day, wind and gusts in km/h, cloud cover, visibility) becomes
   - a sky: the sun by day, the moon and stars by night, a few clouds, sun and
     clouds, a sky full of them, or the dark clouds of a thunderstorm;
   - something falling, at three weights each: drizzle as fine short drops,
     rain from small drops to long heavy ones (a downpour splashes where it
     lands), snow from a few small flakes to a crowd of big six-armed ones,
     snow grains, sleet as rain and flakes together, hail;
   - wind, from a breeze (three slow strokes) to very windy (ten fast ones
     with leaves in them), which also slants the rain and carries the snow;
   - fog, from mist to thick fog by the visibility, in slow soft bands.
   It touches nothing but its argument; scripts/wxart-test.mjs pins it.

   How it moves is the sheet's `wx_motion` (SPEEDS): Still draws one picture
   and never touches the screen again; Slight, Medium and Lively are the same
   picture at a quarter, about half and the whole pace — the first two at
   thirty frames a second, Lively at every frame. Nothing flashes at any of
   them: a bolt of lightning brightens where it is drawn (Medium and Lively
   only), never the screen.

   In the clock's own warm colour, read off the overlay, in a few shades of
   it: at three in the morning a white sun would be the brightest thing in the
   kitchen. And around the words, not behind them: each of them (the time, the
   forecast row, the date, the temperature, a timer) cuts a soft hole in the
   drawing (hole()), so the rain stops a little short of the numbers.

   Over a picture too (2026-10-22): with the dim clock's second look — a
   painted lake behind the clock, which has its own sky, clouds and fog —
   night.js hands over the scene with `over` set (night.js overScene()), and
   then only what falls is drawn, and a thunderstorm's lightning, hung from
   the top of the sky with no cloud of ours, wherever up there no word is
   (placeBolt()): no sun, moon or stars, no clouds, no fog, no wind's strokes
   or leaves. The wind still slants the rain and carries the snow. */

const TAU = Math.PI * 2;

/* The sheet's Movement — Still, Slight, Medium, Lively — as a share of the
   weather's own pace. */
export const SPEEDS = [0, 0.25, 0.55, 1];

/* The WMO codes that fall, as [what, how heavy 1–3]. 95–99 is a
   thunderstorm, with hail at 96 and 99. */
const FALLS = {
  51: ['drizzle', 1], 53: ['drizzle', 2], 55: ['drizzle', 3],
  56: ['sleet', 1], 57: ['sleet', 2],
  61: ['rain', 1], 63: ['rain', 2], 65: ['rain', 3],
  66: ['sleet', 2], 67: ['sleet', 3],
  71: ['snow', 1], 73: ['snow', 2], 75: ['snow', 3], 77: ['grains', 1],
  80: ['rain', 1], 81: ['rain', 2], 82: ['rain', 3],
  85: ['snow', 1], 86: ['snow', 3],
  95: ['rain', 2], 96: ['rain', 3], 99: ['rain', 3],
};
const SHOWERS = new Set([80, 81, 82, 85, 86]);

const num = (v) => (v == null || v === '' || !Number.isFinite(Number(v)) ? null : Number(v));

/* 0 calm, 1 a breeze, 2 windy, 3 very windy — from the wind and its gusts in
   km/h, roughly Beaufort 3, 5 and 6 and up: a gust can lift a level the
   wind itself has not reached. */
export function windLevel(wind, gust) {
  const w = num(wind) ?? 0;
  const g = num(gust) ?? 0;
  if (w >= 40 || g >= 65) return 3;
  if (w >= 25 || g >= 45) return 2;
  if (w >= 12 || g >= 30) return 1;
  return 0;
}

/* 0 none, 1 mist, 2 fog, 3 thick fog. A fog code is fog however far the
   model says one sees, and thicker below 1000 and 200 metres; any other hour
   with nothing falling and under a kilometre is misty. */
export function fogLevel(code, vis, falling = false) {
  const v = num(vis);
  if (code === 45 || code === 48) {
    if (v === null) return 2;
    return v < 200 ? 3 : v < 1000 ? 2 : 1;
  }
  return !falling && v !== null && v < 1000 ? 1 : 0;
}

/* One hour of the forecast as what to draw, or null without one. */
export function scene(h) {
  const code = num(h?.code);
  if (code === null) return null;
  const f = FALLS[code];
  const storm = code >= 95;
  const cloud = num(h.cloud);
  let sky;
  if (code >= 0 && code <= 3) sky = ['clear', 'few', 'partly', 'overcast'][code];
  else if (storm) sky = 'storm';
  else if (code === 45 || code === 48) sky = 'none';            // the fog is the sky
  else if (SHOWERS.has(code) && (cloud === null || cloud < 85)) sky = 'partly';
  else sky = 'overcast';
  return {
    sky,
    night: h.day === 0 || h.day === false,
    fall: f ? { kind: f[0], level: f[1], hail: code === 96 || code === 99 } : null,
    wind: windLevel(h.wind, h.gust),
    fog: fogLevel(code, h.vis, !!f),
    storm,
  };
}

const HEAVY = ['', 'light ', '', 'heavy '];
const SKY_WORDS = {
  clear: ['sun', 'stars'],
  few: ['sun and a few clouds', 'stars and a few clouds'],
  partly: ['sun and clouds', 'the moon and clouds'],
  overcast: ['clouds', 'clouds'],
};

/* In words, for the sheet: "Rain · windy", "Stars and a few clouds". */
export function describe(sc) {
  if (!sc) return '';
  const parts = [];
  const f = sc.fall;
  if (f) {
    const what = f.kind === 'grains' ? 'snow grains' : `${HEAVY[f.level] || ''}${f.kind}`;
    parts.push(sc.storm ? `thunder and ${what}` : what);
    if (f.hail) parts.push('hail');
  } else if (sc.storm) parts.push('thunder');
  if (sc.fog) parts.push(['', 'mist', 'fog', 'thick fog'][sc.fog]);
  if ((!f || sc.sky === 'partly') && SKY_WORDS[sc.sky]) parts.push(SKY_WORDS[sc.sky][sc.night ? 1 : 0]);
  if (sc.wind) parts.push(['', 'a breeze', 'windy', 'very windy'][sc.wind]);
  const out = parts.join(' · ');
  return out ? out[0].toUpperCase() + out.slice(1) : '';
}

/* Show me's weathers, as forecast rows. Those without a `day` take the hour
   it is now, so the clouds come with the moon at night. */
export const SAMPLES = [
  ['sun', 'Sun', { code: 0, day: 1, cloud: 0, wind: 4, gust: 8 }],
  ['stars', 'Stars', { code: 0, day: 0, cloud: 0, wind: 4, gust: 8 }],
  ['clouds', 'Clouds', { code: 2, cloud: 55, wind: 8, gust: 16 }],
  ['overcast', 'Overcast', { code: 3, cloud: 100, wind: 8, gust: 16 }],
  ['fog', 'Fog', { code: 45, cloud: 100, wind: 3, gust: 6, vis: 400 }],
  ['drizzle', 'Drizzle', { code: 53, cloud: 100, wind: 6, gust: 12 }],
  ['rain', 'Rain', { code: 61, cloud: 100, wind: 8, gust: 16 }],
  ['downpour', 'Downpour', { code: 65, cloud: 100, wind: 18, gust: 32 }],
  ['snow', 'Light snow', { code: 71, cloud: 100, wind: 4, gust: 8 }],
  ['heavysnow', 'Heavy snow', { code: 75, cloud: 100, wind: 14, gust: 26 }],
  ['sleet', 'Sleet', { code: 67, cloud: 100, wind: 10, gust: 20 }],
  ['breeze', 'Breeze', { code: 1, cloud: 20, wind: 16, gust: 26 }],
  ['gale', 'Gale', { code: 3, cloud: 100, wind: 48, gust: 75 }],
  ['storm', 'Thunder', { code: 95, cloud: 100, wind: 30, gust: 50 }],
];

export function sample(key, now) {
  const row = SAMPLES.find(([k]) => k === key)?.[2];
  if (!row) return null;
  return scene({ ...row, day: row.day ?? (now?.day ?? 1) });
}

/* ============================ SMHI's warnings ============================
   backend/app/smhi.py hands over the warning areas that hold the house:
   {level message|yellow|orange|red, event, detail_code, start, end (unix s),
   ...}. */

export const WARN_RANK = { message: 1, yellow: 2, orange: 3, red: 4 };

/* Those on at `now` (ms): begun and not over. */
export function warningsOn(warnings, now = Date.now()) {
  return (warnings || []).filter((w) => w && WARN_RANK[w.level]
    && !(w.start && w.start * 1000 > now) && !(w.end && w.end * 1000 <= now));
}

/* The picture as heavy as SMHI says the weather is. A yellow, orange or red
   warning on now for wind, rain, snow, thunder or freezing rain raises what
   the forecast draws to at least the warning's weight — yellow the middle
   one, orange and red the heaviest — and draws it when the forecast's hour
   had nothing falling. Rain under a snow warning (or the other way round)
   is left as the forecast has it: the hour knows its own mix better. Other
   warnings (fire, heat, cold, floods, the sea, water shortage) and messages
   leave the picture alone — the very scene comes back, so nothing is drawn
   again for them. */
export function withWarnings(sc, warnings, now = Date.now()) {
  const on = warningsOn(warnings, now).filter((w) => WARN_RANK[w.level] >= 2);
  if (!sc || !on.length) return sc;
  const out = { ...sc, fall: sc.fall ? { ...sc.fall } : null };
  const raise = (kind, level) => {
    const f = out.fall;
    if (!f) {
      out.fall = { kind, level, hail: false };
      if (out.sky !== 'storm' && out.sky !== 'partly') out.sky = 'overcast';
      return;
    }
    const same = f.kind === kind
      || (kind === 'rain' && f.kind === 'drizzle') || (kind === 'snow' && f.kind === 'grains');
    if (!same) return;
    f.kind = kind;
    f.level = Math.max(f.level, level);
  };
  for (const w of on) {
    const weight = WARN_RANK[w.level] >= 3 ? 3 : 2;
    const ev = w.event;
    const d = w.detail_code;
    if (ev === 'WIND' || ev === 'WIND_MOUNTAINS' || d === 'WIND_SNOW' || d === 'WIND_MOUNTAINS_SNOW') {
      out.wind = Math.max(out.wind, weight);
    }
    if (ev === 'SNOW' || d === 'WIND_SNOW' || d === 'WIND_MOUNTAINS_SNOW') raise('snow', weight);
    if (ev === 'RAIN') raise('rain', d === 'CLOUDBURST' ? 3 : weight);
    if (ev === 'BLACK_ICE' && d === 'BLACK_ICE') raise('sleet', weight);
    if (ev === 'THUNDER') {
      out.storm = true;
      out.sky = 'storm';
      raise('rain', weight);
    }
  }
  return JSON.stringify(out) === JSON.stringify(sc) ? sc : out;
}

/* Show me's warnings: one of each colour, with the weather it would come
   with, on now — begun an hour ago, over in five. */
const WARN_SAMPLES = {
  yellow: { event: 'RAIN', what: 'Rain', detail: 'Rain', detail_code: 'RAIN', scene: 'rain' },
  orange: { event: 'SNOW', what: 'Snow', detail: 'Snow', detail_code: 'SNOW', scene: 'snow' },
  red: { event: 'WIND', what: 'Wind', detail: 'Storm', detail_code: 'STORM', scene: 'overcast' },
};

export function warnSample(level, now = Date.now(), row = null) {
  const s = WARN_SAMPLES[level];
  if (!s) return null;
  const warning = {
    id: `sample-${level}`, level, rank: WARN_RANK[level], event: s.event, what: s.what,
    detail: s.detail, detail_code: s.detail_code, area: '', texts: [],
    start: Math.floor(now / 1000) - 3600, end: Math.floor(now / 1000) + 5 * 3600,
  };
  return { warning, scene: withWarnings(sample(s.scene, row), [warning], now) };
}

/* ================================ drawing ================================ */

// A small seeded generator: the same weather draws the same picture, so a
// forecast refreshed half an hour later does not reshuffle a still one.
function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const hash = (s) => {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
};
const rgbOf = (css) => {
  const m = String(css || '').match(/[\d.]+/g);
  return m && m.length >= 3 ? m.slice(0, 3).map(Number) : [162, 106, 56];
};
const mix = (a, b, k) => a.map((v, i) => Math.round(v + (b[i] - v) * k));
const rgba = (c, a) => `rgba(${c[0]},${c[1]},${c[2]},${Math.max(0, Math.min(1, a)).toFixed(3)})`;
const canvas = (w, h) => {
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.ceil(w));
  c.height = Math.max(1, Math.ceil(h));
  return c;
};

// What falls, by weight: [count on a 1920×1080 screen, length, width, speed
// px/s, alpha]. A drop is a little teardrop, its tail up the wind.
const DROPS = {
  drizzle: [null, [90, 7, 1.7, 240, 0.40], [140, 8, 1.9, 270, 0.44], [200, 9, 2.1, 300, 0.48]],
  rain: [null, [70, 16, 2.0, 750, 0.34], [130, 24, 2.5, 950, 0.40], [230, 36, 3.1, 1200, 0.46]],
};
// [count, smallest radius, largest, speed px/s, alpha, share drawn as crystals]
const FLAKES = {
  1: [60, 2.0, 3.4, 60, 0.50, 0],
  2: [120, 2.6, 5.6, 75, 0.55, 0.2],
  3: [180, 4.0, 11, 90, 0.60, 0.45],
  grains: [130, 1.0, 1.9, 140, 0.50, 0],
};
// [strokes, length, speed px/s, alpha, wave height]
const STREAKS = [null, [3, 300, 150, 0.38, 16], [6, 380, 300, 0.44, 20], [10, 460, 540, 0.50, 24]];
const SLANT = [0.04, 0.14, 0.28, 0.45];     // the rain's dx per dy, by wind
const DRIFT = [0, 30, 90, 180];             // the snow's sideways px/s, by wind
const CLOUDS = { clear: 0, few: 2, partly: 4, overcast: 7, storm: 8, none: 0 };

export class Art {
  constructor(host) {
    this.host = host;
    this.cv = document.createElement('canvas');
    this.cv.className = 'nt-art';
    this.cv.setAttribute('aria-hidden', 'true');
    host.prepend(this.cv);
    this.g = this.cv.getContext('2d');
    this.sc = null;
    this.sceneKey = '';
    this.speed = 0;
    this.running = false;
    this.built = false;
    this.holes = [];
    this.holeKey = '';
    this.t = 0;
    this.last = 0;
    this.frame = (ts) => this.loop(ts);
    this.ro = new ResizeObserver(() => {
      if (this.running && this.fit()) this.redraw();
    });
    this.ro.observe(host);
  }

  /* What to draw and how fast; nothing starts again unless one changed. */
  set(sc, motion) {
    const key = JSON.stringify(sc);
    const speed = SPEEDS[motion] ?? SPEEDS[1];
    if (key === this.sceneKey && speed === this.speed) return;
    if (key !== this.sceneKey) {
      this.sc = sc;
      this.sceneKey = key;
      this.built = false;
    }
    this.speed = speed;
    if (this.running) this.redraw();
  }

  start() {
    if (this.running) return;
    this.running = true;
    this.fit();
    this.redraw();
  }

  stop() {
    this.running = false;
    cancelAnimationFrame(this.raf);
    this.raf = 0;
    this.g.setTransform(1, 0, 0, 1, 0, 0);
    this.g.clearRect(0, 0, this.cv.width, this.cv.height);
    this.holeKey = '';
  }

  redraw() {
    cancelAnimationFrame(this.raf);
    this.raf = 0;
    if (!this.built) this.build();
    this.last = 0;
    this.draw(performance.now());
    if (this.speed > 0) this.raf = requestAnimationFrame(this.frame);
  }

  /* The canvas the size of the overlay, in the screen's own pixels — body's
     zoom included, since the rect is. True when it changed. */
  fit() {
    const r = this.host.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    const W = Math.max(1, Math.round(r.width * dpr));
    const H = Math.max(1, Math.round(r.height * dpr));
    if (W === this.cv.width && H === this.cv.height && this.W) return false;
    this.cv.width = W;
    this.cv.height = H;
    this.W = W;
    this.H = H;
    this.u = Math.min(W / 1920, H / 1080);
    // As many of everything per screen of the design's size, on a screen of
    // another shape (a phone stood up), within reason.
    this.area = Math.min(2.5, (W * H) / (this.u * this.u * 1920 * 1080));
    this.built = false;
    this.holeKey = '';
    return true;
  }

  /* The words the drawing goes around: each element's box, cut softly out of
     every frame. Cheap to ask every second — the mask is made again only when
     a box moved (a timer appearing, the forecast row arriving). */
  hole(els) {
    if (!this.running) return;
    const hr = this.host.getBoundingClientRect();
    const k = this.cv.width / Math.max(1, hr.width);
    const rects = [];
    for (const el of els) {
      if (!el || el.hidden) continue;
      const r = el.getBoundingClientRect();
      if (!r.width || !r.height) continue;
      rects.push([(r.left - hr.left) * k, (r.top - hr.top) * k, r.width * k, r.height * k].map(Math.round));
    }
    const key = `${rects.join(';')}|${this.cv.width}x${this.cv.height}`;
    if (key === this.holeKey) return;
    this.holeKey = key;
    this.holes = rects;
    this.makeMask();
    this.placeBolt();
    if (!(this.speed > 0)) this.draw(performance.now());
  }

  /* Over a picture the bolt has no cloud of ours to hang from: it hangs from
     the top of the sky. It is drawn after the words' holes are cut, as the
     clouds' bolt is, so nothing cuts it: it keeps clear of every word itself,
     as far from each as the rain stops short of it (makeMask's margins). A
     fifth of the way in where that is clear — on the wall it is, between the
     sunrise and sunset and the time — otherwise in the middle of the clear
     stretch nearest that: on a phone stood up the sunrise's corner is there,
     and the bolt goes between it and the moon. None where no stretch up there
     is wide enough for it. Again whenever a word moves (hole()). */
  placeBolt() {
    const b = this.bolt;
    if (!b || b.home === undefined) return;
    const { W, u } = this;
    const lw = 5 * u;                                 // drawBolt's line
    const xs = b.pts.map(([x]) => b.dx + x);
    const left = Math.min(...xs) - lw;                // the bolt, from where it hangs
    const right = Math.max(...xs) + lw;
    const top = b.cloud.y + b.dy - lw;
    const bottom = b.cloud.y + b.dy + Math.max(...b.pts.map(([, y]) => y)) + lw;
    const px = 46 * u;
    const py = 30 * u;
    // Where it may hang: on the screen, and not where it would reach into a
    // word's margin.
    let free = [[-left, W - right]];
    for (const [x, y, w, h] of this.holes) {
      if (y - py >= bottom || y + h + py <= top) continue;
      const lo = x - px - right;
      const hi = x + w + px - left;
      free = free.flatMap(([a, z]) => [[a, Math.min(z, lo)], [Math.max(a, hi), z]]);
    }
    free = free.filter(([a, z]) => z >= a);
    const off = ([a, z]) => (b.home < a ? a - b.home : b.home > z ? b.home - z : 0);
    const best = free.reduce((p, q) => (p && off(p) <= off(q) ? p : q), null);
    b.off = !best;
    if (best) b.cloud.x = off(best) === 0 ? b.home : (best[0] + best[1]) / 2;
  }

  makeMask() {
    const { W, H, u } = this;
    if (!this.mask) this.mask = canvas(W, H);
    const m = this.mask;
    if (m.width !== W || m.height !== H) { m.width = W; m.height = H; }
    const g = m.getContext('2d');
    g.clearRect(0, 0, W, H);
    g.filter = `blur(${Math.round(40 * u)}px)`;
    g.fillStyle = '#000';
    const px = 46 * u;
    const py = 30 * u;
    for (const [x, y, w, h] of this.holes) {
      g.beginPath();
      g.roundRect(x - px, y - py, w + 2 * px, h + 2 * py, 34 * u);
      g.fill();
    }
    g.filter = 'none';
  }

  /* ------------------------------------------------------ the picture -- */

  build() {
    this.built = true;
    this.t = 0;
    const { W, H, u } = this;
    const sc = this.sc;
    const R = rng(hash(this.sceneKey) ^ (W * 31 + H));
    const n = (count) => Math.max(1, Math.round(count * this.area));
    const ink = rgbOf(getComputedStyle(this.host).color);
    this.ink = ink;
    this.light = mix(ink, [255, 232, 200], 0.38);
    this.pale = mix(ink, [255, 244, 228], 0.55);
    this.deep = mix(ink, [0, 0, 0], 0.6);
    // Clouds are opaque, so the one in front hides the one behind: their
    // shades are the colour already laid on black.
    this.cloudBody = mix(ink, [0, 0, 0], sc?.sky === 'storm' ? 0.8 : 0.74);
    this.cloudRim = mix(ink, [0, 0, 0], sc?.sky === 'storm' ? 0.55 : 0.45);
    this.mist = mix(ink, [205, 192, 176], 0.45);
    Object.assign(this, {
      sun: null, moon: null, stars: [], clouds: [], bolt: null, fogs: [], drops: [], pellets: [],
      flakes: [], splashes: [], streaks: [], leaves: [], flashAt: 0, boltGlow: null,
    });
    if (!sc) return;

    // The sun, or the moon, high in the left corner, clear of the clock —
    // or lower down that side, under the clock's sunrise and sunset when
    // they hold the corner (night.js, `orbLow`).
    // Over a picture, none of the sky is ours (night.js sends its sky as
    // 'none' and no fog; this keeps to it whatever it is sent).
    const bright = !sc.over && (sc.sky === 'clear' || sc.sky === 'few' || sc.sky === 'partly');
    if (bright && sc.fog < 3) {
      const at = { x: Math.min(W * 0.16, 230 * u),
        y: sc.orbLow ? Math.min(H * 0.38, 410 * u) : Math.min(H * 0.2, 190 * u) };
      // ...unless the real one is shown, top right (night.js, `moon`):
      // two moons in one sky, one of them the wrong shape.
      if (sc.night) {
        if (!sc.noMoon) this.moon = { ...at, r: 50 * u, sprite: this.moonSprite(50 * u) };
      } else this.sun = { ...at, r: 60 * u, glow: this.glowSprite(250 * u, this.light) };
    }
    if (sc.night && bright) {
      const count = n({ clear: 80, few: 55, partly: 32 }[sc.sky]);
      for (let i = 0; i < count; i++) {
        const big = R() < 0.08;
        this.stars.push({
          x: R() * W, y: H * R() ** 1.5, r: (big ? 5 + R() * 4 : 1.1 + R() * 1.5) * u, big,
          a: 0.35 + R() * 0.45, f: 0.4 + R() * 1.0, ph: R() * TAU,
        });
      }
    }

    // Clouds: in the band above the clock, their bottoms 115 to 215 px down
    // (their tops may be over the edge): any lower would sit on the clock,
    // since the clouds are drawn after the words' holes are cut. `y` is the
    // sprite's top; its body ends `bottom` below that. The lower in front.
    const nc = sc.over ? 0 : CLOUDS[sc.sky] || 0;
    const big = sc.sky === 'overcast' || sc.sky === 'storm';
    for (let i = 0; i < nc; i++) {
      const w = (big ? 300 + R() * 240 : 230 + R() * 190) * u;
      const sprite = this.cloudSprite(w, R);
      const bottom = sprite.height - 12 * u;
      const low = (115 + R() * 100) * u;
      this.clouds.push({
        x: ((i + 0.15 + R() * 0.7) / nc) * (W + w * 0.6) - w * 0.3,
        y: low - bottom, low,
        w, sprite, bottom, v: (5 + 12 * sc.wind) * (0.7 + R() * 0.6) * u,
      });
    }
    this.clouds.sort((a, b) => a.low - b.low);

    if (sc.storm && (this.clouds.length || sc.over)) {
      // The bolt hangs from the cloud nearest a fifth of the way in from
      // either side — on the screen, clear of the clock — which stays put
      // while the others pass. Over a picture there is no cloud of ours: it
      // hangs from the top of the sky, a little more than a fifth of the way
      // in — on the wall between the clock's sunrise and sunset and the time,
      // the widest gap up there, the moon's side being the narrower — or
      // wherever else up there no word is (placeBolt()).
      const off = (cl) => Math.min(Math.abs(cl.x - W * 0.2), Math.abs(cl.x - W * 0.8));
      const c = sc.over ? { x: W * 0.23, y: 0, w: 300 * u, bottom: 90 * u, v: 0 }
        : this.clouds.reduce((best, cl) => (off(cl) < off(best) ? cl : best));
      if (!sc.over) c.x = c.x < W / 2 ? W * 0.2 : W * 0.8;
      c.v = 0;
      const pts = [[0, 0]];
      let x = 0;
      let y = 0;
      for (let k = 0; k < 6; k++) {
        x += (k % 2 ? -1 : 1) * (14 + R() * 26) * u;
        y += (34 + R() * 26) * u;
        pts.push([x, y]);
      }
      this.bolt = { cloud: c, dx: (R() - 0.5) * c.w * 0.3, dy: c.bottom - 6 * u, pts };
      // Where it would hang over a picture; placeBolt() keeps it off the words.
      if (sc.over) {
        this.bolt.home = c.x;
        this.placeBolt();
      }
      this.flashAt = performance.now() + 2500;
    }

    // Fog: long soft bands, slowly drifting, more of them lower down.
    if (sc.fog && !sc.over) {
      const count = Math.round([0, 5, 8, 11][sc.fog] * Math.sqrt(this.area));
      this.fogSprite = this.fogSprite || this.glowSprite(128, this.mist, true);
      for (let i = 0; i < count; i++) {
        this.fogs.push({
          x: R() * W, y: H * (0.12 + 0.85 * R() ** 0.7), w: (900 + R() * 800) * u, h: (110 + R() * 130) * u,
          v: (6 + 10 * sc.wind + 8 * R()) * u, a: [0, 0.16, 0.25, 0.34][sc.fog] * (0.7 + R() * 0.6),
        });
      }
    }

    // What falls.
    const f = sc.fall;
    if (f) {
      const rainKind = f.kind === 'drizzle' ? 'drizzle' : (f.kind === 'rain' || f.kind === 'sleet') ? 'rain' : null;
      if (rainKind) {
        const [count, len, wd, v, a] = DROPS[rainKind][f.level];
        const share = f.kind === 'sleet' ? 0.55 : 1;
        for (let i = 0; i < n(count * share); i++) {
          const z = 0.5 + R() * 0.5;
          this.drops.push({ x: R() * W, y: R() * H, z, len: len * z * u, r: wd * z * u, v: v * z * u, a });
        }
        if (f.kind === 'rain' && f.level === 3) {
          for (let i = 0; i < n(14); i++) {
            this.splashes.push({ x: R() * W, y: H - (6 + R() * 34) * u, age: R() * 0.3, life: 0.35 });
          }
        }
      }
      const snowKind = f.kind === 'snow' ? f.level : f.kind === 'grains' ? 'grains' : f.kind === 'sleet' ? 1 : null;
      if (snowKind) {
        const [count, r0, r1, v, a, crystals] = FLAKES[snowKind];
        const share = f.kind === 'sleet' ? 0.6 : 1;
        if (crystals) this.crystal = this.crystal || this.crystalSprite();
        this.flake = this.flake || this.flakeSprite();
        for (let i = 0; i < n(count * share); i++) {
          const z = 0.55 + R() * 0.45;
          const r = (r0 + (r1 - r0) * R() ** 1.3) * z * u;
          this.flakes.push({
            bx: R() * W, y: R() * H, r, z, v: v * z * u, a,
            amp: (8 + 18 * R()) * u, f: 0.5 + R() * 0.7, ph: R() * TAU,
            crystal: R() < crystals && r > 3.4 * u, rot: R() * TAU, vr: (R() - 0.5) * 0.6,
          });
        }
      }
      if (f.hail) {
        for (let i = 0; i < n(26); i++) {
          this.pellets.push({ x: R() * W, y: R() * H, r: (2.4 + R() * 1.2) * u, v: (950 + R() * 250) * u });
        }
      }
    }

    // Wind: strokes across the screen, a curl at the end of some; leaves in
    // a strong one when nothing white is falling. Not over a picture: its
    // trees already lean, and warm squiggles across a painted sky are no
    // weather anybody has seen.
    if (sc.wind && !sc.over) {
      const [count, len, v, a, amp] = STREAKS[sc.wind];
      for (let i = 0; i < n(count); i++) {
        const z = 0.6 + R() * 0.4;
        this.streaks.push({
          x: R() * (W + len * u), y: H * (0.05 + R() * 0.9), len: len * z * u, v: v * z * u,
          amp: amp * z * u, ph: R() * TAU, a: a * z, curl: R() < 0.45, z,
        });
      }
      const white = f && f.kind !== 'drizzle' && f.kind !== 'rain';
      if (sc.wind >= 2 && !white) {
        for (let i = 0; i < n(sc.wind === 3 ? 7 : 3); i++) {
          this.leaves.push({
            x: R() * W, by: H * (0.1 + R() * 0.8), s: (16 + R() * 10) * u, rot: R() * TAU,
            vr: (R() - 0.5) * 5, ph: R() * TAU, v: STREAKS[sc.wind][2] * (0.5 + R() * 0.4) * u,
          });
        }
      }
    }
  }

  /* A soft round light, transparent at its edge; stretched, a fog band. */
  glowSprite(r, c, flat = false) {
    const s = canvas(r * 2, r * 2);
    const g = s.getContext('2d');
    const grad = g.createRadialGradient(r, r, 0, r, r, r);
    grad.addColorStop(0, rgba(c, flat ? 1 : 0.5));
    grad.addColorStop(flat ? 0.45 : 0.25, rgba(c, flat ? 0.6 : 0.16));
    grad.addColorStop(1, rgba(c, 0));
    g.fillStyle = grad;
    g.fillRect(0, 0, r * 2, r * 2);
    return s;
  }

  moonSprite(r) {
    const pad = r * 2.2;
    const s = canvas(pad * 2, pad * 2);
    const g = s.getContext('2d');
    g.drawImage(this.glowSprite(pad, this.light), 0, 0);
    // The crescent on its own canvas, so cutting it does not cut the glow.
    const m = canvas(r * 2 + 4, r * 2 + 4);
    const mg = m.getContext('2d');
    mg.fillStyle = rgba(this.pale, 1);
    mg.beginPath();
    mg.arc(r + 2, r + 2, r, 0, TAU);
    mg.fill();
    mg.globalCompositeOperation = 'destination-out';
    mg.beginPath();
    mg.arc(r + 2 + r * 0.48, r + 2 - r * 0.22, r * 0.86, 0, TAU);
    mg.fill();
    g.drawImage(m, pad - r - 2, pad - r - 2);
    return s;
  }

  /* A cloud: a flat rounded base with three to five bumps on it, its upper
     edge lit a shade lighter than its body — one shape, drawn twice. */
  cloudSprite(w, R) {
    const u = this.u;
    const pad = 6 * u;
    const h = w * 0.62;
    const baseH = w * 0.22;
    const baseY = h - baseH - pad;
    const n = 3 + Math.floor(R() * 3);
    const bumps = [];
    for (let k = 0; k < n; k++) {
      const p = n === 1 ? 0.5 : k / (n - 1);
      const r = Math.min(w * (0.12 + R() * 0.08) * (1 + 0.7 * Math.sin(Math.PI * p)), baseY + baseH * 0.6 - pad);
      bumps.push([pad + w * (0.2 + 0.6 * p) + (R() - 0.5) * w * 0.06, baseY + baseH * 0.6 - r * 0.45, r]);
    }
    const s = canvas(w + pad * 2, h + pad);
    const g = s.getContext('2d');
    const shape = (dy) => {
      g.beginPath();
      g.roundRect(pad, baseY + dy, w, baseH, baseH / 2);
      for (const [x, y, r] of bumps) {
        g.moveTo(x + r, y + dy);
        g.arc(x, y + dy, r, 0, TAU);
      }
      g.fill();
    };
    g.fillStyle = rgba(this.cloudRim, 1);
    shape(-3.5 * u);
    g.fillStyle = rgba(this.cloudBody, 1);
    shape(0);
    return s;
  }

  /* A six-armed flake, two little branches on each arm. */
  crystalSprite() {
    const R = 32;
    const s = canvas(R * 2, R * 2);
    const g = s.getContext('2d');
    g.strokeStyle = rgba(this.pale, 1);
    g.lineCap = 'round';
    g.lineWidth = 3.4;
    g.translate(R, R);
    for (let k = 0; k < 6; k++) {
      g.rotate(TAU / 6);
      g.beginPath();
      g.moveTo(0, 0);
      g.lineTo(0, -R + 3);
      for (const [at, len] of [[0.45, 0.28], [0.7, 0.2]]) {
        g.moveTo(0, -R * at);
        g.lineTo(-R * len, -R * (at + len));
        g.moveTo(0, -R * at);
        g.lineTo(R * len, -R * (at + len));
      }
      g.stroke();
    }
    return s;
  }

  /* A snowflake seen from across the kitchen: a soft round light. */
  flakeSprite() {
    const R = 32;
    const s = canvas(R * 2, R * 2);
    const g = s.getContext('2d');
    const grad = g.createRadialGradient(R, R, 0, R, R, R);
    grad.addColorStop(0, rgba(this.pale, 1));
    grad.addColorStop(0.5, rgba(this.pale, 0.9));
    grad.addColorStop(0.72, rgba(this.pale, 0.3));
    grad.addColorStop(1, rgba(this.pale, 0));
    g.fillStyle = grad;
    g.fillRect(0, 0, R * 2, R * 2);
    return s;
  }

  /* --------------------------------------------------------- the loop -- */

  loop(ts) {
    if (!this.running || !(this.speed > 0)) return;
    this.raf = requestAnimationFrame(this.frame);
    // Lively at every frame; the slower ones at thirty a second are plenty.
    const gap = this.speed >= 1 ? 0 : 1000 / 30;
    if (this.last && ts - this.last < gap - 2) return;
    const dt = this.last ? Math.min(0.1, (ts - this.last) / 1000) : 0;
    this.last = ts;
    this.step(dt * this.speed);
    this.draw(ts);
  }

  step(dt) {
    if (!dt) return;
    const { W, H, u } = this;
    const sc = this.sc;
    this.t += dt;
    for (const c of this.clouds) {
      c.x += c.v * dt;
      if (c.x - c.w / 2 > W + 20 * u) c.x = -c.w * 0.6 - 40 * u;
    }
    for (const b of this.fogs) {
      b.x += b.v * dt;
      if (b.x - b.w / 2 > W) b.x = -b.w / 2;
    }
    const slant = SLANT[sc?.wind || 0] * (sc?.fall?.kind === 'drizzle' ? 1.3 : 1);
    for (const d of this.drops) {
      d.y += d.v * dt;
      d.x += d.v * slant * dt;
      if (d.y - d.len > H) {
        if (this.splashes.length < 40 && d.z > 0.75 && sc.fall.level === 3 && sc.fall.kind === 'rain'
            && Math.random() < 0.35) {
          this.splashes.push({ x: d.x, y: H - (6 + Math.random() * 34) * u, age: 0, life: 0.35 });
        }
        d.y = -d.len - Math.random() * 60 * u;
        d.x = Math.random() * (W + H * slant) - H * slant;
      }
      if (d.x > W + 40 * u) d.x -= W + 80 * u;
    }
    for (const s of this.splashes) s.age += dt;
    this.splashes = this.splashes.filter((s) => s.age < s.life);
    for (const p of this.pellets) {
      p.y += p.v * dt;
      p.x += p.v * slant * dt;
      if (p.y > H + p.r) { p.y = -p.r; p.x = Math.random() * W; }
    }
    const drift = DRIFT[sc?.wind || 0] * u;
    for (const f of this.flakes) {
      f.y += f.v * dt;
      f.bx += drift * f.z * dt;
      f.rot += f.vr * dt;
      if (f.y - f.r > H) { f.y = -f.r - Math.random() * 40 * u; f.bx = Math.random() * W; }
      if (f.bx > W + 40 * u) f.bx -= W + 80 * u;
    }
    for (const s of this.streaks) {
      s.x += s.v * dt;
      if (s.x - s.len > W + 60 * u) {
        s.x = -Math.random() * W * 0.5;
        s.y = H * (0.05 + Math.random() * 0.9);
      }
    }
    for (const l of this.leaves) {
      l.x += l.v * dt;
      l.by += 14 * u * dt;
      l.rot += l.vr * dt;
      if (l.x - l.s > W) { l.x = -l.s * 2 - Math.random() * W * 0.3; l.by = H * (0.1 + Math.random() * 0.7); }
      if (l.by > H) l.by = H * 0.1;
    }
  }

  draw(now) {
    const g = this.g;
    const { W, H, u } = this;
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.globalAlpha = 1;
    g.globalCompositeOperation = 'source-over';
    g.clearRect(0, 0, W, H);
    const sc = this.sc;
    if (!sc || !W) return;
    const veil = 1 - 0.22 * sc.fog;     // fog dims the sky behind it
    const t = this.t;

    // The night sky: stars twinkling when it moves, still when it does not.
    if (this.stars.length) {
      g.fillStyle = rgba(this.pale, 1);
      for (const s of this.stars) {
        g.globalAlpha = s.a * veil * (this.speed > 0 ? 0.7 + 0.3 * Math.sin(t * s.f * 4 + s.ph) : 1);
        if (s.big) {
          const r = s.r;
          g.beginPath();
          g.moveTo(s.x, s.y - r);
          g.quadraticCurveTo(s.x, s.y, s.x + r, s.y);
          g.quadraticCurveTo(s.x, s.y, s.x, s.y + r);
          g.quadraticCurveTo(s.x, s.y, s.x - r, s.y);
          g.quadraticCurveTo(s.x, s.y, s.x, s.y - r);
          g.fill();
        } else {
          g.beginPath();
          g.arc(s.x, s.y, s.r, 0, TAU);
          g.fill();
        }
      }
      g.globalAlpha = 1;
    }
    if (this.moon) {
      const m = this.moon;
      g.globalAlpha = 0.62 * veil;
      g.drawImage(m.sprite, m.x - m.sprite.width / 2, m.y - m.sprite.height / 2);
      g.globalAlpha = 1;
    }
    if (this.sun) {
      const s = this.sun;
      g.globalAlpha = 0.8 * veil;
      g.drawImage(s.glow, s.x - s.glow.width / 2, s.y - s.glow.height / 2);
      g.globalAlpha = 0.5 * veil;
      g.fillStyle = rgba(this.light, 1);
      g.beginPath();
      g.arc(s.x, s.y, s.r, 0, TAU);
      g.fill();
      g.strokeStyle = rgba(this.light, 1);
      g.lineCap = 'round';
      g.lineWidth = 4.5 * u;
      g.globalAlpha = 0.4 * veil;
      const turn = t * 0.12;
      g.beginPath();
      for (let k = 0; k < 12; k++) {
        const a = turn + (k * TAU) / 12;
        const r1 = s.r * 1.35;
        const r2 = s.r * (k % 2 ? 1.75 : 2.1) * (1 + 0.04 * Math.sin(t * 1.3 + k));
        g.moveTo(s.x + Math.cos(a) * r1, s.y + Math.sin(a) * r1);
        g.lineTo(s.x + Math.cos(a) * r2, s.y + Math.sin(a) * r2);
      }
      g.stroke();
      g.globalAlpha = 1;
    }

    // Rain, hail and snow; fog over them; the wind over that.
    this.drawFalling(t);
    for (const b of this.fogs) {
      g.globalAlpha = b.a;
      // Drawn twice when it runs off the right edge, so it comes back on the left.
      g.drawImage(this.fogSprite, b.x - b.w / 2, b.y - b.h / 2, b.w, b.h);
      if (b.x + b.w / 2 > W) g.drawImage(this.fogSprite, b.x - W - b.w / 2, b.y - b.h / 2, b.w, b.h);
    }
    g.globalAlpha = 1;

    // Wind: a wavy stroke fading in from its tail, a curl at the end of some.
    if (this.streaks.length) {
      g.lineCap = 'round';
      g.lineJoin = 'round';
      for (const s of this.streaks) {
        const tail = s.x - s.len;
        if (s.x + 40 * u < 0 || tail > W) continue;
        const grad = g.createLinearGradient(tail, 0, s.x + s.amp, 0);
        grad.addColorStop(0, rgba(this.light, 0));
        grad.addColorStop(0.55, rgba(this.light, s.a));
        grad.addColorStop(1, rgba(this.light, s.a * 0.85));
        g.strokeStyle = grad;
        g.lineWidth = (2.2 + 1.4 * s.z) * u;
        g.beginPath();
        const N = 26;
        let hx = 0;
        let hy = 0;
        for (let i = 0; i <= N; i++) {
          const p = i / N;
          hx = tail + s.len * p;
          hy = s.y + Math.sin(p * TAU * 0.9 + s.ph + t * 2.2) * s.amp * Math.sin(Math.PI * Math.min(1, p * 1.15));
          if (i) g.lineTo(hx, hy); else g.moveTo(hx, hy);
        }
        if (s.curl) {
          const rc = s.amp * 0.9 + 6 * u;
          g.arc(hx, hy - rc, rc, Math.PI / 2, -Math.PI * 0.85, true);
        }
        g.stroke();
      }
    }
    if (this.leaves.length) {
      for (const l of this.leaves) {
        const y = l.by + Math.sin(t * 1.7 + l.ph) * 26 * u;
        const c = Math.cos(l.rot);
        const s = Math.sin(l.rot);
        const k = 0.45 + 0.55 * Math.abs(Math.sin(l.rot * 0.7 + l.ph));   // turning over as it tumbles
        g.setTransform(c, s, -s * k, c * k, l.x, y);
        g.globalAlpha = 0.7;
        g.fillStyle = rgba(this.ink, 1);
        g.beginPath();
        g.moveTo(-l.s, 0);
        g.quadraticCurveTo(0, -l.s, l.s, 0);
        g.quadraticCurveTo(0, l.s, -l.s, 0);
        g.fill();
        g.globalAlpha = 0.6;
        g.strokeStyle = rgba(this.deep, 1);
        g.lineWidth = 1.4 * u;
        g.beginPath();
        g.moveTo(-l.s * 1.25, 0);
        g.lineTo(l.s * 0.8, 0);
        g.stroke();
      }
      g.setTransform(1, 0, 0, 1, 0, 0);
      g.globalAlpha = 1;
    }

    // Around the words, not behind them.
    if (this.holes.length && this.mask) {
      g.globalCompositeOperation = 'destination-out';
      g.drawImage(this.mask, 0, 0);
      g.globalCompositeOperation = 'source-over';
    }

    // The clouds last, over what falls — it falls from under them — and
    // after the cut: they keep to the band above the clock, and a hole's
    // soft edge only shaded their undersides. Opaque, the lower in front.
    for (const c of this.clouds) g.drawImage(c.sprite, c.x - c.sprite.width / 2, c.y);
    if (this.bolt && !this.bolt.off) this.drawBolt(now);
  }

  /* Lightning under its cloud: brightening now and then, where it is. */
  drawBolt(now) {
    const g = this.g;
    const { u } = this;
    let k = 0.32;
    if (this.speed >= SPEEDS[2]) {
      if (now > this.flashAt + 700) this.flashAt = now + 6000 + Math.random() * 7000;
      const e = now - this.flashAt;
      if (e >= 0 && e < 90) k = 0.9;
      else if (e >= 90 && e < 170) k = 0.4;
      else if (e >= 170 && e < 300) k = 0.85;
      else if (e >= 300 && e < 700) k = 0.32 + 0.5 * (1 - (e - 300) / 400);
    }
    const b = this.bolt;
    const x0 = b.cloud.x + b.dx;
    const y0 = b.cloud.y + b.dy;
    if (k > 0.4) {
      g.globalAlpha = (k - 0.32) * 0.3;
      const glow = this.boltGlow || (this.boltGlow = this.glowSprite(220 * u, this.light));
      g.drawImage(glow, x0 - glow.width / 2, y0 + 60 * u - glow.height / 2);
    }
    g.globalAlpha = k;
    g.strokeStyle = rgba(this.pale, 1);
    g.lineWidth = 5 * u;
    g.lineJoin = 'miter';
    g.lineCap = 'butt';
    g.beginPath();
    b.pts.forEach(([x, y], i) => (i ? g.lineTo(x0 + x, y0 + y) : g.moveTo(x0 + x, y0 + y)));
    g.stroke();
    g.globalAlpha = 1;
  }

  drawFalling(t) {
    const g = this.g;
    const { u } = this;
    const sc = this.sc;
    // Rain: teardrops, the tail up the wind; the far ones fainter.
    if (this.drops.length) {
      const slant = SLANT[sc.wind] * (sc.fall.kind === 'drizzle' ? 1.3 : 1);
      const len = Math.hypot(slant, 1);
      const dx = slant / len;
      const dy = 1 / len;
      for (const near of [false, true]) {
        g.beginPath();
        let a = 0;
        for (const d of this.drops) {
          if ((d.z > 0.75) !== near) continue;
          a = d.a;
          const tx = d.x - dx * d.len;
          const ty = d.y - dy * d.len;
          const a0 = Math.atan2(dx, -dy);    // the head's left side, across the fall
          g.moveTo(tx, ty);
          g.lineTo(d.x + Math.cos(a0) * d.r, d.y + Math.sin(a0) * d.r);
          g.arc(d.x, d.y, d.r, a0, a0 + Math.PI, true);   // round the bottom
          g.closePath();
        }
        g.fillStyle = rgba(this.light, near ? a : a * 0.6);
        g.fill();
      }
    }
    if (this.splashes.length) {
      g.strokeStyle = rgba(this.light, 1);
      g.lineWidth = 2 * u;
      g.lineCap = 'round';
      for (const s of this.splashes) {
        const p = s.age / s.life;
        g.globalAlpha = 0.45 * (1 - p);
        const r = (4 + 12 * p) * u;
        g.beginPath();
        g.arc(s.x, s.y, r, Math.PI * 1.15, Math.PI * 1.4);
        g.moveTo(s.x + Math.cos(Math.PI * 1.6) * r, s.y + Math.sin(Math.PI * 1.6) * r);
        g.arc(s.x, s.y, r, Math.PI * 1.6, Math.PI * 1.85);
        g.stroke();
      }
      g.globalAlpha = 1;
    }
    if (this.pellets.length) {
      g.fillStyle = rgba(this.pale, 0.5);
      g.beginPath();
      for (const p of this.pellets) {
        g.moveTo(p.x + p.r, p.y);
        g.arc(p.x, p.y, p.r, 0, TAU);
      }
      g.fill();
    }

    // Snow: soft round flakes, the far ones fainter, and crystals.
    if (this.flakes.length) {
      for (const f of this.flakes) {
        if (f.crystal) continue;
        const x = f.bx + Math.sin(t * f.f + f.ph) * f.amp;
        const d = f.r * 3.2;
        g.globalAlpha = f.a * (f.z > 0.78 ? 1 : 0.65);
        g.drawImage(this.flake, x - d / 2, f.y - d / 2, d, d);
      }
      g.globalAlpha = 1;
      if (this.crystal) {
        for (const f of this.flakes) {
          if (!f.crystal) continue;
          const x = f.bx + Math.sin(t * f.f + f.ph) * f.amp;
          const k = (f.r * 2.3) / 32;
          const c = Math.cos(f.rot) * k;
          const s = Math.sin(f.rot) * k;
          g.globalAlpha = f.a * (f.z > 0.78 ? 1 : 0.65);
          g.setTransform(c, s, -s, c, x, f.y);
          g.drawImage(this.crystal, -32, -32);
        }
        g.setTransform(1, 0, 0, 1, 0, 0);
        g.globalAlpha = 1;
      }
    }
  }
}
