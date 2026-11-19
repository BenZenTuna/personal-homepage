/* Look 6 of the dim clock: the butterfly tree (night.js; asked for 2026-11-15:
   "one more calming skin illustration for the dimming screen, it would be
   like the style of the calm pond but it would be about a tree in the middle
   of screen, which will have colourful leaves … even colourful butterflies
   as the tree leaves, and the tree and its leaves are moving with the
   unpredicted wind, swinging and moving").

   The calm pond's twin, made the same way and for the same reasons (pond.js
   has the research): slow living motion with no story, a fractal tree of
   medium complexity, chance everywhere so nothing visibly repeats.

   - The tree: a dark trunk flecked with colour, its branches forking into a
     dome. Every branch bends with the wind on a spring of its own, the thin
     ones most, so a gust runs through the crown and it swings back past
     still before it settles.
   - The leaves are butterflies, wings open: warm reds, oranges and yellows
     in the crown, pinks and purples down the left, blues and teals down the
     right, each riding its twig. Now and then one opens and closes its
     wings.
   - The wind is never the same: a slow mood (lulls and blowy spells), gusts
     that come when they come — how strong, how long, rising and dying away
     each their own — a restless flutter on top, and now and then it turns
     round through a lull. A gust crosses the screen from where it blows, so
     the near side of the crown moves first.
   - A strong gust lifts a few butterflies off the edge of the crown: they
     flutter about for a while and come back to their twig. A few others fly
     about on their own, fewer at night and in the rain.
   - The weather outside: its wind is how blowy the wind is, rain falls as
     fine streaks, snow drifts, fog lies over it; no lightning, on purpose.
     Darker by night (the canvas's opacity, as the pond's).
   - Where the words sit (night.js's place, middle or top) the crown is a
     little darker, so the time reads over it, and the flying butterflies
     keep out of the words' way.

   Laid out from a seed of the day (the branches, which butterfly sits where
   and its colour: the same tree all day, another tomorrow); how it moves is
   chance. The still part — the wall behind, the ground — is drawn once into
   a picture of its own. Movement (wx_motion) is its pace; Still draws one
   frame. Thirty frames a second at most, twenty if the screen cannot keep
   up.

   Lighter (env.light, night.js's `tree_draw`, 2026-11-16: the wall's fan was
   loud with this look — a whole core, nearly all of it the 572 butterflies
   on the tree drawn one by one): the tree, the butterflies resting on it and
   the shade under the words are drawn LIGHT_TREE_FPS times a second on the
   tree's canvas, and what is in the air — the butterflies flying, rain,
   snow, fog — every frame on a second, clear canvas over it (`air`), which
   the browser lays on top: no full-screen copy a frame. The wind still moves
   it all every frame; the branches are only drawn less often. */

const TAU = Math.PI * 2;
const SPEEDS = [0, 0.6, 0.8, 1];
const FLEX = [0.03, 0.14, 0.32, 0.52, 0.72, 0.92, 1.1];   // how much a branch bends, by its fork
const LAST_GEN = FLEX.length - 1;                      // the twigs
const OPEN = [1, 0.55, 0.16];                                       // the wings' frames: open, half, closed
const WIND = [0.14, 0.32, 0.56, 0.85];                               // the mean wind by the weather's level
const LIGHT_TREE_FPS = 10;                                           // Lighter: the tree's picture, a second

const hex = (s) => [parseInt(s.slice(1, 3), 16), parseInt(s.slice(3, 5), 16), parseInt(s.slice(5, 7), 16)];
const mix = (a, b, t) => a.map((v, i) => v + (b[i] - v) * t);
const css = (c, a = 1) => `rgba(${Math.round(c[0])},${Math.round(c[1])},${Math.round(c[2])},${a})`;
const clamp = (v, lo = 0, hi = 1) => Math.max(lo, Math.min(hi, v));
const rnd = (a, b) => a + Math.random() * (b - a);
const gauss = () => (Math.random() + Math.random() + Math.random() - 1.5) * 2;

export function hsl(h, s, l) {
  h = ((h % 360) + 360) % 360 / 360;
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const ch = (t) => {
    t = (t + 1) % 1;
    return 255 * (t < 1 / 6 ? p + (q - p) * 6 * t : t < 0.5 ? q : t < 2 / 3 ? p + (q - p) * (2 / 3 - t) * 6 : p);
  };
  return [ch(h + 1 / 3), ch(h), ch(h - 1 / 3)];
}

/* The wall behind and the trunk, by night and by day; greyer under a grey sky. */
const WALL = {
  night: [hex('#1c1817'), hex('#0a0909')],
  day: [hex('#3a332d'), hex('#1b1714')],
  grey: [hex('#2a2a2a'), hex('#121212')],
};
const BARK = { night: hex('#2e2a36'), day: hex('#433b48') };   // a dusky grey-violet, lighter than the wall

/* A seeded random: the same tree all day, another tomorrow. */
function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a += 0x6D2B79F5;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/* The day's seed. */
export function daySeed(now) {
  const d = new Date(now);
  return d.getFullYear() * 1000 + d.getMonth() * 40 + d.getDate() + 13;
}

/* Daylight 0 (night) to 1 (day), a three-quarter-hour twilight either side
   of sunrise and sunset; without them, 07:00 and 17:00 (as pond.js's). */
export function lightAt(now, rise, set) {
  const d = new Date(now);
  const day0 = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const r = Number.isFinite(rise) ? rise : day0 + 7 * 3600e3;
  const s = Number.isFinite(set) && set > r ? set : day0 + 17 * 3600e3;
  const TW = 45 * 60e3;
  if (now <= r - TW || now >= s + TW) return 0;
  if (now < r + TW) return (now - (r - TW)) / (2 * TW);
  if (now > s - TW) return ((s + TW) - now) / (2 * TW);
  return 1;
}

/* A butterfly's colour by where it sits in the crown (x and y from -1 to 1
   across it): warm in the crown, pink and purple down the left, blue and
   teal down the right, mixed at the seams — the picture it was asked after. Rounded,
   so a few dozen colours make every butterfly and each is drawn once. */
export function colourAt(nx, ny, R) {
  const cool = clamp((ny + 0.12) * 1.25 + (R() - 0.5) * 0.75);
  let h;
  let l;
  if (R() > cool) {
    h = 2 + R() * 50 * clamp(0.55 - ny * 0.6 + R() * 0.3);       // red to yellow, yellower higher up
    l = h > 34 ? 0.56 + R() * 0.08 : 0.5 + R() * 0.08;
  } else if (nx + (R() - 0.5) * 0.9 < 0) {
    h = 272 + R() * 76;                                            // purple to pink
    l = 0.5 + R() * 0.1;
  } else {
    h = R() < 0.14 ? 150 + R() * 26 : 186 + R() * 44;              // teal and green, or blue
    l = 0.46 + R() * 0.1;
  }
  return { h: Math.round(h / 8) * 8, s: 0.82, l: Math.round(l * 16) / 16 };
}

/* A small canvas. */
function sprite(w, h) {
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.ceil(w));
  c.height = Math.max(1, Math.ceil(h));
  return c;
}

/* The wings, the right one; the left is it mirrored. The body runs up the
   middle, the head up. Three kinds: a pointed one with a dark rim and white
   dots on it, a round one, and one with tails. */
const WINGS = {
  point: {
    fore: [[0.5, -7], [6, -24, 26, -29, 32, -20], [33, -12, 26, -4, 2, 1]],
    hind: [[0.5, 0], [16, -3, 27, 6, 24, 16], [20, 25, 8, 24, 1, 9]],
  },
  round: {
    fore: [[0.5, -7], [4, -24, 30, -28, 31, -13], [31, -4, 20, 0, 2, 1]],
    hind: [[0.5, 0], [18, -3, 30, 9, 25, 19], [19, 27, 6, 24, 1, 9]],
  },
  tail: {
    fore: [[0.5, -7], [6, -24, 28, -28, 31, -17], [31, -8, 22, -1, 2, 1]],
    hind: [[0.5, 0], [15, -1, 24, 8, 20, 17], [21, 30], [15, 24], [9, 24, 4, 18, 1, 9]],
  },
};
const SW = 80;
const SH = 74;

function wingPath(g, w) {
  g.beginPath();
  g.moveTo(w[0][0], w[0][1]);
  for (const c of w.slice(1)) {
    if (c.length === 6) g.bezierCurveTo(c[0], c[1], c[2], c[3], c[4], c[5]);
    else g.lineTo(c[0], c[1]);
  }
  g.closePath();
}

/* One butterfly, drawn once for each of its three wing frames; k draws it
   larger (hourpaint.js's painter), sharp rather than scaled up. */
export function butterfly(rgb, kind, open, k = 1) {
  const c = sprite(SW * k, SH * k);
  const g = c.getContext('2d');
  g.scale(k, k);
  const shape = WINGS[kind];
  const dark = mix(rgb, [12, 8, 10], 0.62);
  const light = mix(rgb, [255, 250, 235], 0.28);
  g.translate(SW / 2, SH / 2);
  // A soft shadow on the wall behind, as paper wings would cast.
  g.shadowColor = 'rgba(0,0,0,0.5)';
  g.shadowBlur = 3;
  g.shadowOffsetX = 1.5;
  g.shadowOffsetY = 2.5;
  for (const side of [-1, 1]) {
    g.save();
    g.scale(side * open, 1);
    for (const part of ['hind', 'fore']) {
      const gr = g.createRadialGradient(3, 0, 1, 3, 0, 32);
      gr.addColorStop(0, css(light));
      gr.addColorStop(0.5, css(rgb));
      gr.addColorStop(1, css(mix(rgb, [0, 0, 0], 0.4)));
      wingPath(g, shape[part]);
      g.fillStyle = gr;
      g.fill();
    }
    g.restore();
  }
  g.shadowColor = 'transparent';
  for (const side of [-1, 1]) {
    g.save();
    g.scale(side * open, 1);
    for (const part of ['hind', 'fore']) {
      g.save();
      wingPath(g, shape[part]);
      g.clip();
      // The rim: dark and wide on the pointed kind, a shade of its own on the rest.
      g.lineWidth = kind === 'point' ? 4.5 : 2.6;
      g.strokeStyle = kind === 'point' ? 'rgba(22,14,14,0.85)' : css(dark, 0.7);
      g.stroke();
      // Veins from the body.
      g.lineWidth = 0.8;
      g.strokeStyle = css(dark, 0.45);
      const ends = part === 'fore' ? [[29, -18], [30, -10], [22, -4], [18, -24]] : [[23, 14], [18, 22], [10, 20]];
      for (const [x, y] of ends) {
        g.beginPath();
        g.moveTo(2, part === 'fore' ? -1 : 2);
        g.quadraticCurveTo(x * 0.5, y * 0.55 - 2, x, y);
        g.stroke();
      }
      g.restore();
    }
    if (kind === 'point') {
      g.fillStyle = 'rgba(245,240,230,0.85)';
      for (const [x, y] of [[29.5, -15], [28, -20], [24, -24], [29, -10], [22, 17], [18, 21]]) {
        g.beginPath();
        g.arc(x, y, 0.95, 0, TAU);
        g.fill();
      }
    }
    g.restore();
  }
  // The body and the feelers.
  g.fillStyle = '#1a1414';
  g.beginPath();
  g.ellipse(0, 2, 2.1, 12.5, 0, 0, TAU);
  g.fill();
  g.beginPath();
  g.arc(0, -11, 2.4, 0, TAU);
  g.fill();
  g.strokeStyle = 'rgba(26,20,20,0.9)';
  g.lineWidth = 0.9;
  for (const side of [-1, 1]) {
    g.beginPath();
    g.moveTo(0, -12.5);
    g.quadraticCurveTo(side * 2.5, -20, side * 6, -23);
    g.stroke();
    g.beginPath();
    g.arc(side * 6, -23, 1.1, 0, TAU);
    g.fill();
  }
  return c;
}

export class Tree {
  constructor(host) {
    this.host = host;
    this.cv = document.createElement('canvas');
    this.cv.className = 'nt-scape nt-tree';
    this.cv.setAttribute('aria-hidden', 'true');
    host.prepend(this.cv);
    this.g = this.cv.getContext('2d');
    this.bg = document.createElement('canvas');
    this.running = false;
    this.speed = SPEEDS[1];
    this.t = 0;
    this.last = 0;
    this.world = null;
    this.bgKey = '';
    this.sprites = new Map();     // colour + kind -> its three frames
    this.slowFrames = 0;          // frames that took too long, for the twenty-a-second fallback
    this.fps = 30;
    this.frame = (ts) => this.loop(ts);
    this.ro = new ResizeObserver(() => { if (this.running && this.fit()) this.redraw(); });
    this.ro.observe(host);
  }

  /* sc: wxart.js's scene of the hour (null: calm). env: {now, rise, set, seed, top}. */
  set(sc, env, motion) {
    this.sc = sc || { sky: 'clear', night: false, fall: null, wind: 0, fog: 0, storm: false };
    this.env = env;
    if (!!env.light !== !!this.light) {
      this.light = !!env.light;
      this.treeAt = 0;
      if (this.air) this.air.hidden = true;
    }
    const speed = SPEEDS[motion] ?? SPEEDS[1];
    if (this.world && (this.world.seed !== env.seed || this.world.top !== !!env.top)) this.world = null;
    if (speed !== this.speed) {
      this.speed = speed;
      if (this.running) this.redraw();
    } else if (!this.speed && this.running && Math.floor(env.now / 300e3) !== this.slot) {
      this.redraw();                 // Still: a new picture as the light moves on
    }
    this.slot = Math.floor(env.now / 300e3);
  }

  start() {
    if (this.running) return;
    this.running = true;
    this.cv.hidden = false;
    this.fit();
    this.redraw();
  }

  stop() {
    this.running = false;
    cancelAnimationFrame(this.raf);
    this.raf = 0;
    this.cv.hidden = true;
    if (this.air) this.air.hidden = true;
  }

  fit() {
    const r = this.host.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 1.25);
    const W = Math.max(1, Math.round(r.width * dpr));
    const H = Math.max(1, Math.round(r.height * dpr));
    if (W === this.W && H === this.H) return false;
    this.cv.width = this.bg.width = this.W = W;
    this.cv.height = this.bg.height = this.H = H;
    this.u = Math.min(W / 1920, H / 1080);
    this.world = null;
    return true;
  }

  redraw() {
    cancelAnimationFrame(this.raf);
    this.raf = 0;
    this.last = 0;
    if (!this.world && this.W) this.build();
    if (!this.speed && this.world) this.settle();
    this.draw();
    if (this.speed > 0) this.raf = requestAnimationFrame(this.frame);
  }

  loop(ts) {
    if (!this.running || !(this.speed > 0)) return;
    this.raf = requestAnimationFrame(this.frame);
    if (this.last && ts - this.last < 1000 / this.fps - 2) return;
    const dt = this.last ? Math.min(0.1, (ts - this.last) / 1000) : 0;
    this.last = ts;
    const t0 = performance.now();
    this.step(dt * this.speed);
    this.draw();
    // A screen that cannot keep thirty a second gets twenty, smoothly, rather than stutters.
    if (performance.now() - t0 > 26) this.slowFrames += 1;
    else this.slowFrames = Math.max(0, this.slowFrames - 0.25);
    if (this.slowFrames > 45 && this.fps > 20) this.fps = 20;
  }

  /* Still: the wind of a calm moment, the branches where it leaves them. */
  settle() {
    for (let i = 0; i < 40; i++) this.step(0.05);
  }

  /* ------------------------------------------------------- the sprites -- */

  frames(col, kind) {
    const key = `${col.h}|${col.l}|${kind}`;
    let f = this.sprites.get(key);
    if (!f) {
      const rgb = hsl(col.h, col.s, col.l);
      f = OPEN.map((o) => butterfly(rgb, kind, o));
      this.sprites.set(key, f);
    }
    return f;
  }

  /* --------------------------------------------------------- the world -- */

  /* Where the words are, as boxes in this canvas's pixels — the column, and
     the countdown's line — from night.js; without them, the column where it
     would be. */
  wordsBoxes() {
    const { W, H } = this;
    const k = W / (this.host.offsetWidth || W);
    const got = (this.env?.boxes || []).filter((b) => b && b.w > 0 && b.h > 0)
      .map((b) => ({ cx: (b.x + b.w / 2) * k, cy: (b.y + b.h / 2) * k, hw: (b.w / 2) * k, hh: (b.h / 2) * k }));
    if (got.length) return got;
    return [{ cx: W / 2, cy: this.env?.top ? H * 0.16 : H * 0.5, hw: Math.min(W * 0.18, 360 * this.u),
      hh: H * 0.13 }];
  }

  /* The shade under the words: a soft dark box a little larger than they
     are, made again only when they move. */
  shade(g) {
    const u = this.u;
    const boxes = this.wordsBoxes();
    const key = boxes.map((b) => [b.cx, b.cy, b.hw, b.hh].map((v) => Math.round(v / 8)).join(',')).join('|');
    if (key !== this.shadeKey) {
      this.shadeKey = key;
      this.shades = boxes.map((b) => {
        const pad = clamp(b.hh * 1.5, 34 * u, 80 * u);      // a thin line's shade blurs away less
        const c = sprite(b.hw * 2 + pad * 2, b.hh * 2 + pad * 2);
        const sg = c.getContext('2d');
        sg.filter = `blur(${Math.round(pad * 0.42)}px)`;
        sg.fillStyle = 'rgba(0,0,0,0.66)';
        sg.beginPath();
        if (sg.roundRect) sg.roundRect(pad, pad, b.hw * 2, b.hh * 2, 40 * u);
        else sg.rect(pad, pad, b.hw * 2, b.hh * 2);
        sg.fill();
        return { c, x: b.cx - b.hw - pad, y: b.cy - b.hh - pad };
      });
    }
    for (const sh of this.shades) g.drawImage(sh.c, sh.x, sh.y);
  }

  build() {
    const { W, H, u } = this;
    const env = this.env;
    const R = rng(env.seed || 1);
    const cx = W / 2;
    // With the words at the top the tree stands a little lower, its crown
    // under them rather than behind them.
    const top = !!env.top;
    const crown = {
      cx, cy: H * (top ? 0.52 : 0.4),
      rx: Math.min(W * 0.38, H * 0.68), ry: Math.min(H * (top ? 0.29 : 0.33), W * 0.45),
    };
    const w = {
      seed: env.seed, top: !!env.top, R, crown,
      segs: [], flecks: [], leaves: [], fliers: [],
      rain: [], flakes: [], fogs: [],
      // The wind: its mood, its gusts, its flutter, its way, and what it was a moment ago.
      wind: 0, mood: 1, turb: 0, dir: R() < 0.5 ? -1 : 1, dirS: 0, nextTurn: rnd(40, 110),
      gusts: [], nextGust: rnd(1, 5), hist: new Float32Array(90), hi: 0, histAcc: 0,
      nextSolo: rnd(8, 20),
    };
    w.dirS = w.dir;
    this.world = w;
    const baseY = H * 0.965;
    // The branches: each a segment hanging off its parent, laid out at rest,
    // parents before their children, so a frame works them out in one pass.
    const add = (p, abs, len, w0, w1, gen) => {
      const pa = p < 0 ? null : w.segs[p];
      const x0 = pa ? pa.rx1 : cx;
      const y0 = pa ? pa.ry1 : baseY;
      const s = {
        p, rel: abs - (pa ? pa.rabs : 0), len, w0, w1, gen, rabs: abs,
        rx0: x0, ry0: y0, rx1: x0 + Math.cos(abs) * len, ry1: y0 + Math.sin(abs) * len,
        b: 0, bv: 0, ph: R() * TAU, om: 0.5 + R() * 0.9, flex: FLEX[Math.min(gen, FLEX.length - 1)],
        face: 0.4 + 0.6 * Math.max(0, -Math.sin(abs)),
        x0, y0, x1: 0, y1: 0, ang: abs,
      };
      w.segs.push(s);
      return w.segs.length - 1;
    };
    const inCrown = (x, y, k = 1) => ((x - crown.cx) / (crown.rx * k)) ** 2 + ((y - crown.cy) / (crown.ry * k)) ** 2 <= 1;
    const hub = [cx, H * (top ? 0.8 : 0.72)];
    const tk = top ? 0.72 : 1;               // the trunk's height
    const grow = (p, abs, len, wd, gen) => {
      const pa = w.segs[p];
      // Kept inside the crown: a branch that would reach out of it is cut short.
      let l = len;
      while (l > 8 * u && !inCrown(pa.rx1 + Math.cos(abs) * l, pa.ry1 + Math.sin(abs) * l, 1.02)) l *= 0.8;
      if (l <= 8 * u) return;
      const i = add(p, abs, l, wd, wd * 0.7, gen);
      if (gen >= LAST_GEN || l < 14 * u) return;
      const s = w.segs[i];
      const n = R() < 0.2 ? 3 : 2;
      for (let k = 0; k < n; k++) {
        const spread = 0.3 + R() * 0.3;
        let a = abs + (n === 3 ? (k - 1) * spread : (k ? 1 : -1) * spread * 0.85) + (R() - 0.5) * 0.2;
        // Outwards from the top of the trunk, so the crown fills as a dome.
        const out = Math.atan2(s.ry1 - hub[1], s.rx1 - hub[0]);
        a += Math.atan2(Math.sin(out - a), Math.cos(out - a)) * 0.22;
        grow(i, a, l * (0.7 + R() * 0.13), wd * 0.68, gen + 1);
      }
    };
    // The trunk, leaning a little, in three pieces.
    let t = add(-1, -Math.PI / 2 + (R() - 0.5) * 0.06, H * 0.1 * tk, 112 * u, 84 * u, 0);
    t = add(t, w.segs[t].rabs + (R() - 0.5) * 0.12, H * 0.08 * tk, 84 * u, 70 * u, 0);
    const low = t;
    t = add(t, w.segs[t].rabs + (R() - 0.5) * 0.12, H * 0.07 * tk, 70 * u, 58 * u, 0);
    // Two low limbs out to the sides, and five up into the crown.
    for (const side of [-1, 1]) grow(low, -Math.PI / 2 + side * (0.75 + R() * 0.15), H * 0.18 * (top ? 0.8 : 1), 30 * u, 2);
    const limbs = [-1.1, -0.55, 0, 0.55, 1.1];
    limbs.forEach((a, k) => grow(t, -Math.PI / 2 + a + (R() - 0.5) * 0.14, H * (0.14 + (2 - Math.abs(k - 2)) * 0.015),
      (40 - Math.abs(k - 2) * 4) * u, 1));
    // By fork, for drawing: each fork's branches in one stroke, at their mean width.
    w.byGen = FLEX.map((_, gen) => w.segs.filter((s) => s.gen === gen));
    w.genWidth = w.byGen.map((segs) => (segs.length ? segs.reduce((a, s) => a + (s.w0 + s.w1) / 2, 0) / segs.length : 1));
    // Colour in the bark, as in the picture: flecks on the trunk and the big limbs.
    for (let i = 0; i < w.segs.length; i++) {
      const s = w.segs[i];
      if (s.gen > 2) continue;
      const n = Math.round(s.len * (s.w0 / (30 * u)) * 0.16 / u);
      for (let k = 0; k < n; k++) {
        const c = colourAt((R() - 0.5) * 2, R() * 2 - 1, R);
        w.flecks.push({ s: i, at: R(), off: (R() - 0.5) * 0.85, r: (0.7 + R() * R() * 2.2) * u,
          c: css(hsl(c.h, 0.65, c.l), 0.3 + R() * 0.4) });
      }
    }
    // The butterflies of the crown: everywhere in it but low over the trunk,
    // each on the nearest twig, a third of them behind the branches.
    const area = Math.PI * crown.rx * crown.ry;
    const size = 56 * u;
    const count = Math.round(clamp(area / (size * size) * 2.5, 160, 640));
    const twigs = w.segs.map((s, i) => i).filter((i) => w.segs[i].gen >= 2);
    for (let k = 0; k < count; k++) {
      let x;
      let y;
      for (let tries = 0; tries < 30; tries++) {
        const a = R() * TAU;
        const r = Math.sqrt(R()) * (R() < 0.12 ? 1.08 : 1);
        x = crown.cx + Math.cos(a) * r * crown.rx;
        y = crown.cy + Math.sin(a) * r * crown.ry;
        if (!(Math.abs(x - cx) < W * 0.045 && y > crown.cy + crown.ry * 0.66)) break;
      }
      let best = twigs[0];
      let bd = Infinity;
      for (const i of twigs) {
        const s = w.segs[i];
        const d = (s.rx1 - x) ** 2 + (s.ry1 - y) ** 2;
        if (d < bd) { bd = d; best = i; }
      }
      const s = w.segs[best];
      const nx = (x - crown.cx) / crown.rx;
      const ny = (y - crown.cy) / crown.ry;
      const col = colourAt(nx, ny, R);
      const kind = R() < 0.45 ? 'point' : R() < 0.6 ? 'round' : 'tail';
      w.leaves.push({
        s: best, dx: x - s.rx1, dy: y - s.ry1, x, y,
        rot: (R() - 0.5) * 1.2, size: size * (0.72 + R() * 0.5) * (1.08 - 0.16 * Math.hypot(nx, ny)),
        back: R() < 0.33, col, kind, edge: Math.hypot(nx, ny) > 0.55,
        flap: 0, nextFlap: rnd(2, 40), off: false,
      });
    }
    w.leaves.sort((a, b) => a.y - b.y);
    for (let i = 0; i < 5; i++) {
      w.fogs.push({ x: R() * W, y: H * (0.2 + R() * 0.7), w: (800 + R() * 600) * u, h: (200 + R() * 180) * u,
        v: (6 + R() * 10) * u });
    }
    w.blob = sprite(256, 256);
    const bg2 = w.blob.getContext('2d');
    const rg = bg2.createRadialGradient(128, 128, 0, 128, 128, 128);
    rg.addColorStop(0, 'rgba(255,255,255,1)');
    rg.addColorStop(0.5, 'rgba(255,255,255,0.35)');
    rg.addColorStop(1, 'rgba(255,255,255,0)');
    bg2.fillStyle = rg;
    bg2.fillRect(0, 0, 256, 256);
    // The wall's brush strokes and the ground's fallen butterflies, kept for the background.
    w.strokes = [];
    for (let i = 0; i < 2200; i++) {
      w.strokes.push({ x: R() * W, y: R() * H, a: R() * TAU,
        len: (14 + R() * 60) * u, wd: (14 + R() * 34) * u, light: R() < 0.55, al: 0.012 + R() * 0.03,
        bend: (R() - 0.5) * 0.8 });
    }
    w.patches = [];
    for (let i = 0; i < 26; i++) {
      w.patches.push({ x: R() * W, y: R() * H, r: (120 + R() * 320) * u, light: R() < 0.55, al: 0.04 + R() * 0.07 });
    }
    w.cracks = [];
    for (let i = 0; i < 7; i++) {
      const pts = [[R() * W, R() * H]];
      let a = R() * TAU;
      for (let k = 0; k < 7; k++) {
        a += (R() - 0.5) * 1.1;
        const l = (20 + R() * 60) * u;
        pts.push([pts[k][0] + Math.cos(a) * l, pts[k][1] + Math.sin(a) * l]);
      }
      w.cracks.push(pts);
    }
    w.ground = [];
    const gw = Math.min(W * 0.3, 620 * u);
    for (let i = 0; i < 520; i++) {
      const gx = (R() - 0.5) * 2;
      const x = cx + gx * gw;
      // A low mound: highest at the trunk, thinning to the sides.
      const top = baseY - (1 - gx * gx) * 34 * u;
      const y = top + R() * (H - top + 8 * u);
      const col = colourAt(gx * 1.4, 0.95, R);
      w.ground.push({ x, y, rot: (R() - 0.5) * 2.4, size: (14 + R() * 20) * u * (1 - Math.abs(gx) * 0.35), col,
        kind: R() < 0.5 ? 'round' : 'point', open: R() < 0.55 ? 0 : R() < 0.5 ? 1 : 2 });
    }
    w.ground.sort((a, b) => a.y - b.y);
    // A few already flying.
    this.pose(0);
    for (let i = 0; i < 8; i++) w.fliers.push(this.newFlier(null, true));
    this.bgKey = '';
  }

  /* One flying on its own, from anywhere on the screen or in from a side,
     or one lifted off the crown (`leaf`), which comes back to its twig. */
  newFlier(leaf, anywhere = false) {
    const { W, H, u } = this;
    const w = this.world;
    let x;
    let y;
    if (leaf) { x = leaf.x; y = leaf.y; } else if (anywhere) {
      x = rnd(0.05, 0.95) * W;
      y = rnd(0.08, 0.92) * H;
    } else {
      x = Math.random() < 0.5 ? -40 * u : W + 40 * u;
      y = rnd(0.15, 0.85) * H;
    }
    const col = leaf ? leaf.col : colourAt(rnd(-1, 1), rnd(-1, 1), Math.random);
    return {
      x, y, vx: 0, vy: leaf ? -30 * u : 0, head: leaf ? -Math.PI / 2 + rnd(-0.8, 0.8) : Math.random() * TAU,
      sp: rnd(40, 75) * u, ph: Math.random() * TAU, rate: rnd(1.6, 2.4), size: leaf ? leaf.size : rnd(30, 44) * u,
      open: 1, glide: 0, nextGlide: rnd(1, 4),
      col, kind: leaf ? leaf.kind : (Math.random() < 0.5 ? 'point' : Math.random() < 0.6 ? 'round' : 'tail'),
      leaf, life: leaf ? rnd(5, 14) : rnd(25, 70), age: 0, fade: anywhere ? 1 : 0, gone: false,
    };
  }

  /* ---------------------------------------------------------- the wind -- */

  /* The wind now: a slow mood of lulls and blowy spells around the weather's
     mean, gusts that come when they come — each rising, holding and dying
     away in its own time — a restless flutter, and now and then the wind
     turning round, through a lull. Positive blows to the right. */
  blow(dt) {
    const w = this.world;
    const base = WIND[this.sc.wind || 0] ?? WIND[0];
    w.mood = clamp(w.mood + ((1 - w.mood) * 0.05 + gauss() * 0.18) * dt * 1, 0.35, 1.6);
    w.turb += (-w.turb / 1.6) * dt + gauss() * 0.32 * (0.4 + base) * Math.sqrt(dt);
    w.nextGust -= dt;
    if (w.nextGust <= 0) {
      w.nextGust = rnd(3, 16) / (0.6 + base);
      w.gusts.push({ age: 0, rise: rnd(0.7, 2.2), hold: rnd(0.3, 2.8), fall: rnd(1.8, 6),
        amp: base * rnd(0.5, 1.7) + rnd(0.08, 0.25) });
    }
    let gust = 0;
    for (const g of w.gusts) {
      g.age += dt;
      const a = g.age < g.rise ? (1 - Math.cos((g.age / g.rise) * Math.PI)) / 2
        : g.age < g.rise + g.hold ? 1
          : Math.max(0, (1 + Math.cos(((g.age - g.rise - g.hold) / g.fall) * Math.PI)) / 2);
      gust += a * g.amp;
    }
    w.gusts = w.gusts.filter((g) => g.age < g.rise + g.hold + g.fall);
    w.nextTurn -= dt;
    if (w.nextTurn <= 0) {
      w.nextTurn = rnd(40, 120);
      if (Math.random() < 0.4) w.dir = -w.dir;
    }
    w.dirS += (w.dir - w.dirS) * Math.min(1, dt * 0.25);
    w.wind = w.dirS * (base * w.mood + gust) + w.turb * 0.5;
    w.gust = Math.max(0, gust - 0.25);
    // What it was, a thirtieth of a second at a time, for the gust crossing the screen.
    w.histAcc += dt;
    while (w.histAcc >= 1 / 30) {
      w.histAcc -= 1 / 30;
      w.hi = (w.hi + 1) % w.hist.length;
      w.hist[w.hi] = w.wind;
    }
  }

  /* The wind at x: what it was a moment ago on the far side from where it blows. */
  windAt(x) {
    const w = this.world;
    const f = clamp(x / this.W);
    const lag = (w.dirS >= 0 ? f : 1 - f) * 1.3;
    const k = Math.min(w.hist.length - 1, Math.round(lag * 30));
    return w.hist[(w.hi - k + w.hist.length) % w.hist.length];
  }

  /* ---------------------------------------------------------- the step -- */

  step(dt) {
    if (!this.world || !dt) return;
    const { W, H, u } = this;
    const w = this.world;
    const sc = this.sc;
    this.t += dt;
    this.blow(dt);
    // Each branch on its spring: pushed by the wind where it is, a flutter
    // of its own on top, the thin ones the most; it swings back past still.
    for (const s of w.segs) {
      const wind = this.windAt(s.x1 || s.rx1);
      const flutter = Math.sin(this.t * s.om * TAU * 0.5 + s.ph) * 0.02 * (0.3 + Math.abs(wind));
      const want = (wind * 0.12 * s.face + flutter) * s.flex;
      s.bv += ((want - s.b) * 9 - s.bv * 3.2) * dt;
      s.b += s.bv * dt;
    }
    this.pose();
    const light = this.P?.light ?? 1;
    const wet = sc.fall ? 0.3 : 1;
    // The crown's butterflies: now and then one opens and closes its wings
    // (more often in a gust); a strong gust lifts a few off the edge.
    const off = w.fliers.filter((f) => f.leaf).length;
    for (const l of w.leaves) {
      if (l.off) continue;
      l.nextFlap -= dt * (1 + w.gust * 3);
      if (l.nextFlap <= 0) {
        l.nextFlap = rnd(10, 40) / (0.4 + 0.6 * light);
        this.fan(l);
      }
      if (l.flap > 0) l.flap = Math.max(0, l.flap - dt);
      if (l.edge && !l.held && off < 16 && w.gust > 0.2 && Math.random() < 0.05 * (w.gust - 0.2) ** 2 * dt * wet) {
        l.off = true;
        w.fliers.push(this.newFlier(l));
      }
    }
    // And one now and then on its own, wind or not, by day.
    w.nextSolo -= dt;
    if (w.nextSolo <= 0) {
      w.nextSolo = rnd(10, 30) / (0.25 + 0.75 * light);
      const edge = w.leaves.filter((l) => l.edge && !l.off && !l.held);
      if (edge.length && off < 16 && Math.random() < wet) {
        const l = edge[Math.floor(Math.random() * edge.length)];
        l.off = true;
        w.fliers.push(this.newFlier(l));
      }
    }
    // Those flying about on their own: more by day, fewer in the rain.
    const want = Math.round((5 + 15 * light) * wet);
    const free = w.fliers.filter((f) => !f.leaf && !f.gone && f.age < f.life).length;
    if (free < want && Math.random() < dt * 0.4) w.fliers.push(this.newFlier(null));
    if (free > want) {
      const f = w.fliers.find((x) => !x.leaf && !x.gone && x.age < x.life);
      if (f) f.age = f.life;
    }
    for (const f of w.fliers) this.fly(f, dt);
    w.fliers = w.fliers.filter((f) => !f.gone);
    // Rain: fine streaks, as many as it rains, slanting with the wind.
    const fall = sc.fall;
    const rainy = fall && !['snow', 'grains'].includes(fall.kind);
    const nRain = rainy ? Math.round(({ drizzle: 70, sleet: 90 }[fall.kind] ?? 140) * [0.6, 0.7, 1, 1.8][fall.level || 2]
      * (W * H) / (1920 * 1080)) : 0;
    while (w.rain.length < nRain) {
      w.rain.push({ x: Math.random() * W * 1.3 - W * 0.15, y: Math.random() * H, v: rnd(900, 1300) * u,
        len: rnd(14, 26) * u * (fall?.kind === 'drizzle' ? 0.55 : 1) });
    }
    if (w.rain.length > nRain) w.rain.length = nRain;
    for (const r of w.rain) {
      r.y += r.v * dt;
      r.x += w.wind * 260 * u * dt;
      if (r.y > H + 30 * u) { r.y = -30 * u; r.x = Math.random() * W * 1.3 - W * 0.15; }
    }
    // Snow: flakes drifting down, swaying, carried by the wind.
    const snowy = fall && ['snow', 'grains', 'sleet'].includes(fall.kind);
    const nSnow = snowy ? Math.round([40, 60, 110, 200][fall.level || 2] * (W * H) / (1920 * 1080)) : 0;
    while (w.flakes.length < nSnow) {
      w.flakes.push({ x: Math.random() * W, y: Math.random() * H, v: rnd(30, 70) * u, ph: Math.random() * TAU,
        r: (fall?.kind === 'grains' ? rnd(1.5, 2.5) : rnd(2.2, 5.5)) * u });
    }
    if (w.flakes.length > nSnow) w.flakes.length = nSnow;
    for (const k of w.flakes) {
      k.ph += dt;
      k.y += k.v * dt;
      k.x += (w.wind * 90 * u + Math.sin(k.ph * 1.3) * 14 * u) * dt;
      if (k.y > H + 10 * u) { k.y = -10 * u; k.x = Math.random() * W; }
      if (k.x < -20 * u) k.x += W + 40 * u; else if (k.x > W + 20 * u) k.x -= W + 40 * u;
    }
    // Fog drifting.
    for (const g of w.fogs) {
      g.x += (g.v + w.wind * 12 * u) * dt;
      if (g.x - g.w > W) g.x = -g.w;
      if (g.x + g.w < 0) g.x = W + g.w;
    }
  }

  /* Where every branch and every butterfly on it is now. */
  pose() {
    const w = this.world;
    for (const s of w.segs) {
      const pa = s.p < 0 ? null : w.segs[s.p];
      s.ang = (pa ? pa.ang : 0) + s.rel + s.b;
      s.x0 = pa ? pa.x1 : s.rx0;
      s.y0 = pa ? pa.y1 : s.ry0;
      s.x1 = s.x0 + Math.cos(s.ang) * s.len;
      s.y1 = s.y0 + Math.sin(s.ang) * s.len;
    }
    for (const l of w.leaves) {
      const s = w.segs[l.s];
      const d = s.ang - s.rabs;
      const c = Math.cos(d);
      const n = Math.sin(d);
      l.x = s.x1 + l.dx * c - l.dy * n;
      l.y = s.y1 + l.dx * n + l.dy * c;
      l.turn = d * 0.8;
    }
  }

  /* One butterfly in the air: wandering by chance, bobbing with its wing
     beats, pushed by the wind, kept on the screen and out of the words' way.
     One from the crown heads back to its twig when its time is up and
     settles there; one on its own drifts off the screen at the end of its
     time. */
  fly(f, dt) {
    const { W, H, u } = this;
    const w = this.world;
    f.age += dt;
    // Wing beats, slow and smooth, with glides between them: wings held open.
    f.nextGlide -= dt;
    if (f.nextGlide <= 0) { f.nextGlide = rnd(2.5, 6); f.glide = rnd(0.8, 2.2); }
    const gliding = f.glide > 0;
    if (gliding) f.glide -= dt; else f.ph += dt * TAU * f.rate;
    const beat = 0.32 + 0.68 * (0.5 + 0.5 * Math.cos(f.ph));
    f.open += ((gliding ? 0.95 : beat) - f.open) * Math.min(1, dt * 9);
    const home = f.leaf && f.age > f.life;
    if (home) {
      const dx = f.leaf.x - f.x;
      const dy = f.leaf.y - f.y;
      const d = Math.hypot(dx, dy);
      if (d < 8 * u) { f.leaf.off = false; this.fan(f.leaf); f.gone = true; return; }
      const want = Math.atan2(dy, dx);
      f.head += Math.atan2(Math.sin(want - f.head), Math.cos(want - f.head)) * Math.min(1, dt * 3);
      const sp = Math.min(f.sp * 1.2, d * 2.2 + 12 * u);
      f.vx += (Math.cos(f.head) * sp - f.vx) * Math.min(1, dt * 3);
      f.vy += (Math.sin(f.head) * sp - f.vy) * Math.min(1, dt * 3);
      if (f.age > f.life + 25) { f.leaf.off = false; f.gone = true; }   // never lost
    } else {
      f.head += gauss() * 1.6 * dt;
      // Kept on the screen while it is about, off it once its time is up.
      const leaving = !f.leaf && f.age > f.life;
      const m = 90 * u;
      if (!leaving) {
        let px = 0;
        let py = 0;
        if (f.x < m) px = 1; else if (f.x > W - m) px = -1;
        if (f.y < m) py = 1; else if (f.y > H * 0.9) py = -1;
        // Out of the words' way.
        for (const b of this.wordsBoxes()) {
          const ox = (f.x - b.cx) / (b.hw + 60 * u);
          const oy = (f.y - b.cy) / (b.hh + 60 * u);
          if (Math.abs(ox) < 1 && Math.abs(oy) < 1) {
            if (Math.abs(ox) > Math.abs(oy)) px += Math.sign(ox || 1) * 1.5; else py += Math.sign(oy || 1) * 1.5;
          }
        }
        if (px || py) {
          const want = Math.atan2(py, px);
          f.head += Math.atan2(Math.sin(want - f.head), Math.cos(want - f.head)) * Math.min(1, dt * 2.2);
        }
      } else {
        // Off by the nearer side.
        const want = f.x < W / 2 ? Math.PI : 0;
        f.head += Math.atan2(Math.sin(want - f.head), Math.cos(want - f.head)) * Math.min(1, dt * 0.8);
      }
      f.vx += (Math.cos(f.head) * f.sp + w.wind * 70 * u - f.vx) * Math.min(1, dt * 1.6);
      f.vy += (Math.sin(f.head) * f.sp * 0.7 - f.vy) * Math.min(1, dt * 1.6);
      if (leaving && (f.x < -60 * u || f.x > W + 60 * u || f.y < -60 * u || f.y > H + 60 * u)) f.gone = true;
      if (f.age > f.life + 60) f.gone = true;                          // never kept for ever
    }
    f.fade = Math.min(1, f.fade + dt * 0.6);
    f.x += f.vx * dt;
    f.y += (f.vy + (gliding ? 0 : Math.sin(f.ph) * 12 * u)) * dt;
    if (!Number.isFinite(f.x) || !Number.isFinite(f.y)) { if (f.leaf) f.leaf.off = false; f.gone = true; }
  }

  /* ----------------------------------------------------------- drawing -- */

  palette() {
    const env = this.env;
    const sc = this.sc;
    const light = lightAt(env.now, env.rise, env.set);
    const grey = sc.storm ? 0.85 : { overcast: 0.55, storm: 0.85, none: 0.5, partly: 0.2 }[sc.sky] ?? 0;
    const wall = WALL.night.map((c, i) => mix(mix(c, WALL.day[i], light), WALL.grey[i], grey * 0.35));
    const bark = mix(BARK.night, BARK.day, light);
    return { light, grey, wall, bark };
  }

  /* The wall, brushed on thick like the picture's, the light falling on it
     behind the crown; the ground, and the butterflies fallen on it. */
  paintBg(P) {
    const { W, H, u } = this;
    const w = this.world;
    const g = this.bg.getContext('2d');
    g.setTransform(1, 0, 0, 1, 0, 0);
    const [lit, dark] = P.wall;
    const gr = g.createRadialGradient(W / 2, H * 0.38, 0, W / 2, H * 0.45, Math.hypot(W, H) * 0.62);
    gr.addColorStop(0, css(lit));
    gr.addColorStop(1, css(dark));
    g.fillStyle = gr;
    g.fillRect(0, 0, W, H);
    for (const p of w.patches) {
      const pg = g.createRadialGradient(p.x, p.y, 0, p.x, p.y, p.r);
      const c = p.light ? mix(lit, [230, 215, 190], 0.35) : [0, 0, 0];
      pg.addColorStop(0, css(c, p.al * (p.light ? 0.5 + 0.7 * P.light : 1)));
      pg.addColorStop(1, css(c, 0));
      g.fillStyle = pg;
      g.fillRect(p.x - p.r, p.y - p.r, p.r * 2, p.r * 2);
    }
    g.lineCap = 'round';
    for (const s of w.strokes) {
      const c = s.light ? mix(lit, [235, 225, 205], 0.5) : [0, 0, 0];
      g.strokeStyle = css(c, s.al * (s.light ? 0.6 + 0.6 * P.light : 1.4));
      g.lineWidth = s.wd;
      const dx = Math.cos(s.a) * s.len / 2;
      const dy = Math.sin(s.a) * s.len / 2;
      g.beginPath();
      g.moveTo(s.x - dx, s.y - dy);
      g.quadraticCurveTo(s.x - dy * s.bend, s.y + dx * s.bend, s.x + dx, s.y + dy);
      g.stroke();
    }
    g.strokeStyle = 'rgba(0,0,0,0.16)';
    g.lineWidth = 1.2 * u;
    for (const pts of w.cracks) {
      g.beginPath();
      g.moveTo(pts[0][0], pts[0][1]);
      for (const p of pts.slice(1)) g.lineTo(p[0], p[1]);
      g.stroke();
    }
    // The ground: a low mound of shade, the roots going into it, and the
    // fallen butterflies on it, blues and purples as in the picture.
    const baseY = H * 0.965;
    const mound = g.createRadialGradient(W / 2, H * 1.02, 0, W / 2, H * 1.02, Math.min(W * 0.34, 700 * u));
    mound.addColorStop(0, 'rgba(0,0,0,0.55)');
    mound.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = mound;
    g.fillRect(0, 0, W, H);
    g.strokeStyle = css(P.bark);
    for (const side of [-1, 1]) {
      for (const [a, l, wd] of [[0.35, 80, 26], [0.75, 120, 18], [1.1, 90, 12]]) {
        g.lineWidth = wd * u;
        g.beginPath();
        g.moveTo(W / 2 + side * 18 * u, baseY - 30 * u);
        g.quadraticCurveTo(W / 2 + side * (30 + l * 0.4) * u, baseY - 6 * u,
          W / 2 + side * Math.sin(a) * l * 1.6 * u, baseY + Math.cos(a) * 14 * u);
        g.stroke();
      }
    }
    for (const b of w.ground) {
      const img = this.frames(b.col, b.kind)[b.open];
      const s = b.size;
      g.save();
      g.translate(b.x, b.y);
      g.rotate(b.rot);
      g.globalAlpha = 0.9;
      g.drawImage(img, -s / 2, -(s * SH) / SW / 2, s, (s * SH) / SW);
      g.restore();
    }
    g.globalAlpha = 1;
  }

  /* The trunk: one shape tapering up its pieces, its foot flaring into the
     ground, its edges a little uneven. */
  trunk(g, bark) {
    const segs = this.world.byGen[0];
    if (!segs.length) return;
    const u = this.u;
    const pts = [[segs[0].x0, segs[0].y0, segs[0].w0 * 1.7]];
    pts.push([segs[0].x0 + (segs[0].x1 - segs[0].x0) * 0.25, segs[0].y0 + (segs[0].y1 - segs[0].y0) * 0.25,
      segs[0].w0 * 1.05]);
    for (const s of segs) pts.push([s.x1, s.y1, s.w1]);
    const left = [];
    const right = [];
    for (let i = 0; i < pts.length; i++) {
      const [x, y, wd] = pts[i];
      const [nx, ny] = i < pts.length - 1 ? pts[i + 1] : [x + (x - pts[i - 1][0]), y + (y - pts[i - 1][1])];
      const a = Math.atan2(ny - y, nx - x);
      const k = 1 + Math.sin(i * 2.3) * 0.05;
      left.push([x + Math.sin(a) * wd / 2 * k, y - Math.cos(a) * wd / 2 * k]);
      right.push([x - Math.sin(a) * wd / 2 / k, y + Math.cos(a) * wd / 2 / k]);
    }
    const mid = Math.min(2, left.length - 1);
    const lg = g.createLinearGradient(left[mid][0], left[mid][1], right[mid][0], right[mid][1]);
    const rgb = bark.match(/[\d.]+/g).slice(0, 3).map(Number);
    lg.addColorStop(0, css(mix(rgb, [0, 0, 0], 0.25)));
    lg.addColorStop(0.32, css(mix(rgb, [190, 180, 200], 0.18)));
    lg.addColorStop(0.7, css(rgb));
    lg.addColorStop(1, css(mix(rgb, [0, 0, 0], 0.35)));
    g.fillStyle = lg;
    g.beginPath();
    g.moveTo(left[0][0], left[0][1] + 6 * u);
    for (let i = 1; i < left.length; i++) {
      const [px, py] = left[i - 1];
      g.quadraticCurveTo(px, py, (px + left[i][0]) / 2, (py + left[i][1]) / 2);
    }
    g.lineTo(left[left.length - 1][0], left[left.length - 1][1]);
    g.lineTo(right[right.length - 1][0], right[right.length - 1][1]);
    for (let i = right.length - 2; i >= 0; i--) {
      const [px, py] = right[i + 1];
      g.quadraticCurveTo(px, py, (px + right[i][0]) / 2, (py + right[i][1]) / 2);
    }
    g.lineTo(right[0][0], right[0][1] + 6 * u);
    g.closePath();
    g.fill();
  }

  /* A slow fan of the wings, once or twice, as a resting butterfly does. */
  fan(l) {
    l.flapLen = rnd(1.8, 3);
    l.flap = l.flapLen;
    l.fans = Math.random() < 0.6 ? 1 : 2;
  }

  /* How open its wings are now: wide open at rest; during a fan they close
     to about half and open again, smoothly — no frame jumps, nothing that
     reads as blinking. */
  openness(l) {
    if (!(l.flap > 0) || !l.flapLen) return 1;
    const p = 1 - l.flap / l.flapLen;
    return 1 - 0.5 * Math.sin(Math.PI * p * l.fans) ** 2;
  }

  /* Lending butterflies (hourpaint.js's HourFlock, 2026-11-15): the hour show
     picks some off the crown to fly off and make the time. A held one stays on
     its twig until it leaves (the flock sets its `off`) and is never lifted off
     by the wind meanwhile; giveBack() puts every one back on its twig. */
  lendable() {
    return this.world ? this.world.leaves.filter((l) => !l.off && !l.held) : [];
  }

  giveBack() {
    for (const l of this.world?.leaves || []) {
      if (!l.held) continue;
      l.held = false;
      l.off = false;
    }
  }

  leaf(g, l, alpha) {
    const s = l.size;
    const img = this.frames(l.col, l.kind)[0];
    const a = l.rot + l.turn;
    const c = Math.cos(a);
    const n = Math.sin(a);
    const o = this.openness(l);
    // Turned, then narrowed across the wings by how open they are.
    g.setTransform(c * o, n * o, -n, c, l.x, l.y);
    g.globalAlpha = alpha;
    g.drawImage(img, -s / 2, -(s * SH) / SW / 2, s, (s * SH) / SW);
  }

  draw() {
    if (!this.W) return;
    if (!this.world) this.build();
    const g = this.g;
    if (!this.light) {
      this.drawTree(g);
      this.drawAir(g);
      return;
    }
    // Lighter: the tree on its own canvas LIGHT_TREE_FPS a second, the air on
    // the clear one over it every frame.
    const now = performance.now();
    if (!this.air) {
      this.air = document.createElement('canvas');
      this.air.className = 'nt-scape nt-tree nt-air';
      this.air.setAttribute('aria-hidden', 'true');
      this.cv.after(this.air);
    }
    const a = this.air;
    if (a.width !== this.W || a.height !== this.H) {
      a.width = this.W;
      a.height = this.H;
      this.treeAt = 0;
    }
    if (!this.treeAt || now - this.treeAt >= 1000 / LIGHT_TREE_FPS - 2) {
      this.drawTree(g);
      this.treeAt = now;
    }
    const ag = a.getContext('2d');
    ag.setTransform(1, 0, 0, 1, 0, 0);
    ag.globalAlpha = 1;
    ag.clearRect(0, 0, a.width, a.height);
    this.drawAir(ag);
    a.style.opacity = this.cv.style.opacity;
    a.hidden = false;
  }

  /* The still part's picture, the butterflies resting and the branches,
     and the shade under the words. */
  drawTree(g) {
    const w = this.world;
    const P = this.palette();
    this.P = P;
    const key = `${Math.round(P.light * 10)}|${Math.round(P.grey * 10)}`;
    if (key !== this.bgKey) { this.paintBg(P); this.bgKey = key; }
    this.cv.style.opacity = (0.74 + 0.16 * P.light).toFixed(2);
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.globalAlpha = 1;
    g.drawImage(this.bg, 0, 0);
    // The butterflies behind the branches, a shade darker.
    for (const l of w.leaves) if (l.back && !l.off) this.leaf(g, l, 0.72);
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.globalAlpha = 1;
    // The branches, the thin ones first, then the trunk over them: one
    // stroke for each fork's branches (their widths are near enough), the
    // trunk's pieces each their own, tapering.
    g.lineCap = 'round';
    g.lineJoin = 'round';
    const bark = css(P.bark);
    const twig = css(mix(P.bark, [60, 60, 80], 0.25));
    for (let gen = LAST_GEN; gen >= 1; gen--) {
      const segs = w.byGen[gen];
      if (!segs.length) continue;
      g.strokeStyle = gen >= 4 ? twig : bark;
      g.lineWidth = Math.max(1, w.genWidth[gen]);
      g.beginPath();
      for (const s of segs) {
        g.moveTo(s.x0, s.y0);
        g.lineTo(s.x1, s.y1);
      }
      g.stroke();
    }
    this.trunk(g, bark);
    for (const f of w.flecks) {
      const s = w.segs[f.s];
      const x = s.x0 + (s.x1 - s.x0) * f.at;
      const y = s.y0 + (s.y1 - s.y0) * f.at;
      const half = ((s.w0 + (s.w1 - s.w0) * f.at) / 2) * f.off;
      g.fillStyle = f.c;
      g.beginPath();
      g.arc(x - Math.sin(s.ang) * half, y + Math.cos(s.ang) * half, f.r, 0, TAU);
      g.fill();
    }
    // The butterflies in front.
    for (const l of w.leaves) if (!l.back && !l.off) this.leaf(g, l, 1);
    g.setTransform(1, 0, 0, 1, 0, 0);
    // Shade where the words are, so they read over the crown.
    this.shade(g);
  }

  /* What is in the air: the butterflies flying, rain, snow and fog. */
  drawAir(g) {
    const { u } = this;
    const w = this.world;
    const P = this.P;
    // Those in the air.
    for (const f of w.fliers) {
      const img = this.frames(f.col, f.kind)[0];
      const a = clamp(f.vx / (f.sp + 1), -1, 1) * 0.4 + Math.sin(f.ph * 0.5) * 0.05;
      const c = Math.cos(a);
      const n = Math.sin(a);
      const s = f.size;
      const o = clamp(f.open, 0.3, 1);
      g.setTransform(c * o, n * o, -n, c, f.x, f.y);
      g.globalAlpha = clamp(f.fade);
      g.drawImage(img, -s / 2, -(s * SH) / SW / 2, s, (s * SH) / SW);
    }
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.globalAlpha = 1;
    // Rain and snow.
    if (w.rain.length) {
      g.strokeStyle = `rgba(200,212,228,${(0.28 + 0.1 * P.light).toFixed(3)})`;
      g.lineWidth = 1.3 * u;
      g.beginPath();
      const slant = w.wind * 0.22;
      for (const r of w.rain) {
        g.moveTo(r.x, r.y);
        g.lineTo(r.x - slant * r.len, r.y - r.len);
      }
      g.stroke();
    }
    if (w.flakes.length) {
      g.fillStyle = 'rgba(236,240,245,0.75)';
      for (const k of w.flakes) {
        g.beginPath();
        g.arc(k.x, k.y, k.r, 0, TAU);
        g.fill();
      }
    }
    // Fog over it all.
    const fog = this.sc.fog || 0;
    if (fog) {
      for (const f of w.fogs) {
        g.globalAlpha = 0.08 * fog;
        g.drawImage(w.blob, f.x - f.w / 2, f.y - f.h / 2, f.w, f.h);
      }
      g.globalAlpha = 1;
    }
  }
}
