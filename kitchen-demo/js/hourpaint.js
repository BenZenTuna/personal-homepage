/* The hour, painted (2026-11-15).

   The plain skins of the hour on screen (hourshow.js: the calm pond and the
   butterfly tree) are the screen dimming's own looks, so on them the hour
   needs something of its own that says "the hour has just turned" (asked
   for 2026-11-15: "the time … could take different colours, or a snake …
   or any animal paints the current changed full hour clock … an animal that
   would fit the same artistic style of Butterfly tree and calm pond").

   Two ways, one per skin. On the pond (HourPaint, below): a butterfly — the
   tree's own kind, drawn by tree.js — flies in from the side and paints the
   new hour, "15:00", stroke by stroke as a hand would
   write it, the paint coming off it as it goes. Each figure has a colour of
   its own from the scene's palette (which colour goes where moves on with
   the hour, so every hour looks a little different), shading along the
   stroke, and the butterfly takes on the colour it is painting with. Between
   strokes it lifts off and flies to the next one. When the hour is written
   the paint glows once, and the butterfly settles on top of the last figure
   and now and then slowly fans its wings, while the colours of the figures
   drift a little, until the show ends.

   Calm on purpose: no flicker anywhere, the wings beat slowly and open and
   close in one smooth movement (frame swaps read as blinking), the strokes
   start and end gently, and the whole hour takes about eight seconds
   however long its figures are.

   On the tree (HourFlock, at the end): no paint — the crown's own butterflies
   fly off and land in the shape of the hour.

   hourshow.js drives both from its own frame loop (frame()); the scene under
   them gets box() so it can darken the water or the crown behind the figures. */

const { butterfly, hsl } = await import(`./tree.js${new URL(import.meta.url).search}`);

const TAU = Math.PI * 2;
const clamp = (v, lo = 0, hi = 1) => Math.max(lo, Math.min(hi, v));
const rnd = (a, b) => a + Math.random() * (b - a);
const mix = (a, b, t) => a.map((v, i) => v + (b[i] - v) * t);
const css = (c, a = 1) => `rgba(${Math.round(c[0])},${Math.round(c[1])},${Math.round(c[2])},${a})`;

/* The figures, as a hand writes them: in a box one em high (y down) and
   ADV wide. M starts a stroke (the brush lifts before it), L and C draw on,
   O is a dot painted as a small round. */
const GLYPHS = {
  0: 'M .32 0 C .13 0 .05 .26 .05 .5 C .05 .76 .15 1 .32 1 C .49 1 .59 .76 .59 .5 C .59 .24 .5 0 .32 0 C .28 0 .25 .01 .22 .03',
  1: 'M .15 .2 L .37 0 L .37 1',
  2: 'M .07 .22 C .11 .06 .24 0 .33 0 C .49 0 .58 .12 .58 .26 C .58 .46 .36 .62 .06 1 L .61 1',
  3: 'M .08 .13 C .16 .04 .25 0 .33 0 C .48 0 .57 .1 .57 .23 C .57 .37 .46 .46 .28 .47 C .49 .48 .61 .59 .61 .73 C .61 .9 .47 1 .31 1 C .21 1 .11 .96 .05 .87',
  4: 'M .43 0 L .04 .68 L .63 .68 M .48 .3 L .48 1',
  5: 'M .56 0 L .14 0 L .09 .43 C .19 .37 .27 .35 .34 .35 C .51 .35 .61 .49 .61 .67 C .61 .87 .48 1 .31 1 C .21 1 .11 .96 .05 .88',
  6: 'M .53 .06 C .46 .02 .41 0 .35 0 C .15 0 .05 .25 .05 .58 C .05 .85 .16 1 .33 1 C .5 1 .59 .87 .59 .7 C .59 .52 .48 .41 .33 .41 C .2 .41 .09 .5 .06 .62',
  7: 'M .04 0 L .61 0 C .46 .25 .33 .55 .27 1',
  8: 'M .32 .47 C .15 .44 .08 .35 .08 .23 C .08 .1 .18 0 .32 0 C .46 0 .56 .1 .56 .23 C .56 .35 .49 .44 .32 .47 C .14 .5 .05 .6 .05 .74 C .05 .9 .17 1 .32 1 C .47 1 .59 .9 .59 .74 C .59 .6 .5 .5 .32 .47',
  9: 'M .57 .38 C .53 .5 .44 .57 .31 .57 C .16 .57 .06 .46 .06 .3 C .06 .13 .17 0 .32 0 C .49 0 .58 .14 .58 .36 C .58 .7 .47 1 .27 1 C .18 1 .11 .97 .07 .93',
  ':': 'O .16 .34 .045 O .16 .8 .045',
};
const ADV = { ':': 0.32 };
const ADV_FIGURE = 0.7;

/* Each scene's colours: the tree's leaves, the pond's koi, lilies and water. */
const PALETTES = {
  // In an order where neighbours differ, so two figures side by side never share a colour.
  tree: [8, 200, 50, 286, 168, 330, 32],
  pond: [22, 178, 346, 46, 206, 300],
};
const COLON_HUE = 44;

const PAINT_S = 7.6;      // the whole hour, from coming in to settling, however long its figures
const DRIFT = 26;         // how far the figures' colours drift once painted (degrees of hue)

/* A figure's path, sampled into strokes of points a small step apart (em). */
function strokesOf(ch) {
  const out = [];
  const tok = (GLYPHS[ch] || '').trim().split(/\s+/);
  let cur = null;
  let at = [0, 0];
  const step = 0.008;
  const push = (p) => cur.push(p);
  for (let i = 0; i < tok.length;) {
    const c = tok[i++];
    const n = () => parseFloat(tok[i++]);
    if (c === 'M') {
      at = [n(), n()];
      cur = [at];
      out.push(cur);
    } else if (c === 'L') {
      const b = [n(), n()];
      const k = Math.max(1, Math.ceil(Math.hypot(b[0] - at[0], b[1] - at[1]) / step));
      for (let j = 1; j <= k; j++) push([at[0] + (b[0] - at[0]) * j / k, at[1] + (b[1] - at[1]) * j / k]);
      at = b;
    } else if (c === 'C') {
      const p1 = [n(), n()];
      const p2 = [n(), n()];
      const b = [n(), n()];
      const rough = Math.hypot(p1[0] - at[0], p1[1] - at[1]) + Math.hypot(p2[0] - p1[0], p2[1] - p1[1])
        + Math.hypot(b[0] - p2[0], b[1] - p2[1]);
      const k = Math.max(2, Math.ceil(rough / step));
      const a = at;
      for (let j = 1; j <= k; j++) {
        const t = j / k;
        const m = 1 - t;
        push([
          m * m * m * a[0] + 3 * m * m * t * p1[0] + 3 * m * t * t * p2[0] + t * t * t * b[0],
          m * m * m * a[1] + 3 * m * m * t * p1[1] + 3 * m * t * t * p2[1] + t * t * t * b[1],
        ]);
      }
      at = b;
    } else if (c === 'O') {
      const [x, y, r] = [n(), n(), n()];
      // From its top, once round and a little more: a dot with no seam.
      const k = 28;
      cur = [];
      for (let j = 0; j <= k * 1.15; j++) {
        const a = -Math.PI / 2 - TAU * j / k;
        cur.push([x + Math.cos(a) * r, y + Math.sin(a) * r]);
      }
      out.push(cur);
      at = cur[cur.length - 1];
    }
  }
  return out;
}

/* A path in canvas px with its running length. */
function track(pts) {
  const len = [0];
  for (let i = 1; i < pts.length; i++) len.push(len[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
  return { pts, len, total: len[len.length - 1] || 1 };
}

/* A flight from a to b, bowed upward (screen up) by lift. */
function flight(a, b, lift) {
  const c = [(a[0] + b[0]) / 2, Math.min(a[1], b[1]) - lift];
  const pts = [];
  const k = 40;
  for (let j = 0; j <= k; j++) {
    const t = j / k;
    const m = 1 - t;
    pts.push([m * m * a[0] + 2 * m * t * c[0] + t * t * b[0], m * m * a[1] + 2 * m * t * c[1] + t * t * b[1]]);
  }
  return track(pts);
}

/* Where along a track a length s is, and which way it runs there. */
function at(tr, s, hint = 0) {
  const { pts, len } = tr;
  s = clamp(s, 0, tr.total);
  let i = Math.min(hint, len.length - 2);
  while (i > 0 && len[i] > s) i--;
  while (i < len.length - 2 && len[i + 1] < s) i++;
  const seg = len[i + 1] - len[i] || 1;
  const f = clamp((s - len[i]) / seg);
  const A = pts[i];
  const B = pts[i + 1] || A;
  return { x: A[0] + (B[0] - A[0]) * f, y: A[1] + (B[1] - A[1]) * f, i, dir: Math.atan2(B[1] - A[1], B[0] - A[0]) };
}

/* How fast along a leg: slow off and slow in, never quite stopped. */
const EASE = { paint: [0.5, 0.5], fly: [0.32, 0.68] };
const easeAt = (kind, p) => EASE[kind][0] + EASE[kind][1] * Math.sin(Math.PI * clamp(p));
const easeMean = (kind) => EASE[kind][0] + EASE[kind][1] * 2 / Math.PI;
const PACE = { paint: 1, fly: 1.45 };   // flying is quicker than painting

export class HourPaint {
  constructor(host) {
    this.host = host;
    this.cv = document.createElement('canvas');
    this.cv.className = 'hs-paint';
    this.cv.setAttribute('aria-hidden', 'true');
    host.appendChild(this.cv);
    this.g = this.cv.getContext('2d');
    this.ink = document.createElement('canvas');
    this.sprites = new Map();
    this.cv.hidden = true;
  }

  /* The hour on the clock now — the one that has just struck (a show put
     on by hand in the middle of an hour paints that hour's start). */
  static hourText(now = new Date()) {
    const d = new Date(now.getTime() + 2 * 60e3);
    return `${String(d.getHours()).padStart(2, '0')}:00`;
  }

  /* text: "15:00". skin: whose palette. night: a little softer. size: the
     figures' height, a share of the screen's. from: where the butterfly
     already is (painting it again); round: which time, for its colours. */
  start(text, { skin = 'tree', night = false, size = 0.4, from = null, round = 0 } = {}) {
    this.opts = { skin, night, size };
    this.text = text;
    if (!from) {
      this.round = 0;
      this.old = null;
    }
    const r = this.host.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 1.25);
    const W = this.cv.width = Math.max(1, Math.round(r.width * dpr));
    const H = this.cv.height = Math.max(1, Math.round(r.height * dpr));
    this.k = W / (r.width || W);
    this.W = W;
    this.H = H;
    this.night = night;
    // The figures, laid out across the middle.
    const chars = [...text];
    const advs = chars.map((c) => ADV[c] ?? ADV_FIGURE);
    const em = Math.min(H * size, W * 0.95 / advs.reduce((a, b) => a + b, 0));
    const width = advs.reduce((a, b) => a + b, 0) * em;
    const x0 = (W - width) / 2;
    const y0 = H / 2 - em / 2;
    this.em = em;
    this.rect = { x: x0, y: y0, w: width, h: em };
    this.brush = em * 0.088;
    // The ink: a picture the size of the figures (and their glow) only.
    const pad = Math.round(em * 0.22);
    this.inkAt = [Math.floor(x0 - pad), Math.floor(y0 - pad)];
    this.ink.width = Math.ceil(width + pad * 2);
    this.ink.height = Math.ceil(em + pad * 2);
    this.ig = this.ink.getContext('2d');
    this.ig.lineCap = 'round';
    this.ig.lineJoin = 'round';
    // Colours: one per figure, moving on with the hour round the palette.
    const pal = PALETTES[skin] || PALETTES.tree;
    const hour = parseInt(text, 10) || 0;
    let pi = hour + round * 3;
    const turn = Math.random() < 0.5 ? 1 : -1;
    // The legs: in from the side, a stroke, a hop, a stroke … and to its perch.
    const legs = [];
    let x = x0;
    chars.forEach((c, ci) => {
      const strokes = strokesOf(c).map((st) => st.map(([gx, gy]) => [x + gx * em, y0 + gy * em]));
      const tracks = strokes.map(track);
      const glyphLen = tracks.reduce((a, t) => a + t.total, 0) || 1;
      const h0 = c === ':' ? COLON_HUE : pal[pi % pal.length];
      if (c !== ':') pi += 1;
      let done = 0;
      for (const tr of tracks) {
        legs.push({ kind: 'paint', tr, h0, h1: h0 + turn * 34, from: done / glyphLen, span: tr.total / glyphLen, ci });
        done += tr.total;
      }
      x += advs[ci] * em;
    });
    const paints = legs.slice();
    // In from one side, low, as if it had come from the scene.
    const side = Math.random() < 0.5 ? -1 : 1;
    const enter = from ? [from.x, from.y] : [side < 0 ? -0.06 * W : 1.06 * W, H * rnd(0.62, 0.86)];
    const first = paints[0].tr.pts[0];
    const all = [{ kind: 'fly', tr: flight(enter, first, em * 0.5) }];
    paints.forEach((leg, i) => {
      if (i) {
        const a = paints[i - 1].tr.pts[paints[i - 1].tr.pts.length - 1];
        const b = leg.tr.pts[0];
        all.push({ kind: 'fly', tr: flight(a, b, em * 0.14 + Math.hypot(b[0] - a[0], b[1] - a[1]) * 0.28) });
      }
      all.push(leg);
    });
    // The perch: on top of the last figure, head up.
    const last = paints[paints.length - 1].tr.pts.slice(-1)[0];
    const lastCell = x - advs[advs.length - 1] * em;
    this.perch = [lastCell + advs[advs.length - 1] * em * 0.46, y0 - em * 0.06];
    all.push({ kind: 'fly', tr: flight(last, this.perch, em * 0.35), land: true });
    // One pace for the whole hour, so "11:00" and "00:00" both take about PAINT_S.
    const need = all.reduce((a, l) => a + l.tr.total / (easeMean(l.kind) * PACE[l.kind]), 0);
    this.pace = clamp(need / PAINT_S, em * 1.4, em * 4.2);
    this.legs = all;
    this.li = 0;
    this.s = 0;
    this.hint = 0;
    this.ig.clearRect(0, 0, this.ink.width, this.ink.height);
    // The painter: its kind, its size (a wingspan about 0.42 em), where it is.
    if (!from) {
      this.kind = ['point', 'round', 'tail'][Math.floor(Math.random() * 3)];
      this.sprites.clear();
    }
    // A wingspan of about 0.42 em, but never more than an eighth of the screen's height.
    const k = Math.max(1, Math.round((Math.min(em * 0.42, H * 0.13) / 64) * 4) / 4);
    if (k !== this.spriteK) this.sprites.clear();
    this.spriteK = k;
    this.pos = { x: enter[0], y: enter[1] };
    this.head = Math.atan2(first[1] - enter[1], first[0] - enter[0]);
    this.hue = paints[0].h0;
    this.open = 1;
    this.ph = 0;
    this.fanIn = rnd(1.5, 3);
    this.fan = 0;
    this.fanLen = 0;
    this.fans = 1;
    this.doneAt = null;
    this.t = 0;
    this.last = 0;
    this.cv.hidden = false;
    this.running = true;
  }

  stop() {
    this.running = false;
    this.cv.hidden = true;
    this.old = null;
  }

  /* Once more: the paint of last time fades as the butterfly, from where it
     sits, writes the hour again in other colours. */
  again() {
    if (!this.running) return;
    this.round = (this.round || 0) + 1;
    const old = this.old?.c || document.createElement('canvas');
    old.width = this.ink.width;
    old.height = this.ink.height;
    const og = old.getContext('2d');
    og.clearRect(0, 0, old.width, old.height);
    og.drawImage(this.ink, 0, 0);
    const at0 = this.inkAt.slice();
    this.start(this.text, { ...this.opts, from: { ...this.pos }, round: this.round });
    this.old = { c: old, at: at0 };
  }

  /* The figures' box in the host's CSS px (the scene darkens behind it). */
  box() {
    const k = this.k || 1;
    const r = this.rect;
    return r ? { x: r.x / k, y: r.y / k, w: r.w / k, h: r.h / k } : null;
  }

  sprite(hue) {
    const q = Math.round(hue / 12) * 12;
    let c = this.sprites.get(q);
    if (!c) {
      c = butterfly(hsl(q, 0.82, this.night ? 0.5 : 0.56), this.kind, 1, this.spriteK);
      this.sprites.set(q, c);
    }
    return c;
  }

  inkColour(leg, p) {
    const h = leg.h0 + (leg.h1 - leg.h0) * (leg.from + leg.span * p);
    return hsl(h, this.night ? 0.72 : 0.82, this.night ? 0.56 : 0.62);
  }

  /* Paint a leg from length a to b into the ink. */
  paint(leg, a, b) {
    const g = this.ig;
    const [ox, oy] = this.inkAt;
    const tr = leg.tr;
    const from = at(tr, a);
    let i = from.i;
    let prev = [from.x, from.y];
    const end = at(tr, b, i);
    const points = [];
    for (let j = i + 1; j <= end.i; j++) points.push([tr.pts[j], tr.len[j]]);
    points.push([[end.x, end.y], b]);
    for (const [pt, s] of points) {
      const p = s / tr.total;
      // Fuller in the middle of a stroke, finer where it starts and ends.
      const w = this.brush * (0.62 + 0.38 * Math.sin(Math.PI * clamp(p * 1.1 - 0.05)));
      const col = this.inkColour(leg, p);
      g.shadowColor = css(col, 0.4);
      g.shadowBlur = w * 0.6;
      g.strokeStyle = css(col);
      g.lineWidth = w;
      g.beginPath();
      g.moveTo(prev[0] - ox, prev[1] - oy);
      g.lineTo(pt[0] - ox, pt[1] - oy);
      g.stroke();
      // The wet sheen along the top of the stroke.
      g.shadowBlur = 0;
      g.strokeStyle = css(mix(col, [255, 248, 236], 0.42));
      g.lineWidth = w * 0.26;
      g.beginPath();
      g.moveTo(prev[0] - ox - w * 0.14, prev[1] - oy - w * 0.16);
      g.lineTo(pt[0] - ox - w * 0.14, pt[1] - oy - w * 0.16);
      g.stroke();
      prev = pt;
    }
  }

  frame(ts = performance.now()) {
    if (!this.running) return;
    const dt = this.last ? Math.min(0.05, (ts - this.last) / 1000) : 0;
    this.last = ts;
    this.t += dt;
    const leg = this.legs[this.li];
    let heading = -Math.PI / 2;
    let moving = false;
    if (leg) {
      moving = true;
      const p = this.s / leg.tr.total;
      const v = this.pace * PACE[leg.kind] * easeAt(leg.kind, p);
      const s1 = Math.min(leg.tr.total, this.s + v * dt);
      if (leg.kind === 'paint' && s1 > this.s) this.paint(leg, this.s, s1);
      this.s = s1;
      const here = at(leg.tr, this.s, this.hint);
      this.hint = here.i;
      this.pos = { x: here.x, y: here.y };
      heading = here.dir;
      if (leg.kind === 'paint') this.hue = leg.h0 + (leg.h1 - leg.h0) * (leg.from + leg.span * p);
      if (this.s >= leg.tr.total) {
        this.li += 1;
        this.s = 0;
        this.hint = 0;
        if (this.li >= this.legs.length) this.doneAt = this.t;
      }
      // Landing: it turns head up as it comes in.
      if (leg.land && p > 0.7) heading = -Math.PI / 2;
    }
    // Which way it faces follows its way gently, never snapping at a corner.
    let d = heading - this.head;
    d = Math.atan2(Math.sin(d), Math.cos(d));
    this.head += d * Math.min(1, dt * (moving ? 6 : 3));
    // The wings: a slow beat in flight, open and still on the perch, now and
    // then a slow fan.
    let want;
    if (moving) {
      this.ph += dt * TAU * (leg?.kind === 'fly' ? 2.1 : 1.7);
      want = 0.38 + 0.62 * (0.5 + 0.5 * Math.cos(this.ph));
    } else {
      want = 1;
      if (this.fan > 0) {
        this.fan -= dt;
        const p = 1 - this.fan / this.fanLen;
        want = 1 - 0.5 * Math.sin(Math.PI * clamp(p) * this.fans) ** 2;
      } else if ((this.fanIn -= dt) <= 0) {
        this.fanLen = rnd(1.8, 3);
        this.fan = this.fanLen;
        this.fans = Math.random() < 0.6 ? 1 : 2;
        this.fanIn = rnd(3, 6);
      }
    }
    this.open += (want - this.open) * Math.min(1, dt * 9);
    this.draw(moving);
  }

  draw(moving) {
    const g = this.g;
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.clearRect(0, 0, this.W, this.H);
    const [ox, oy] = this.inkAt;
    if (this.old) {
      const fade = 1 - this.t / 1.6;
      if (fade <= 0) this.old = null;
      else {
        g.globalAlpha = fade;
        g.drawImage(this.old.c, this.old.at[0], this.old.at[1]);
        g.globalAlpha = 1;
      }
    }
    // The figures: once written they glow once, then their colours drift.
    if (this.doneAt != null) {
      const since = this.t - this.doneAt;
      const drift = DRIFT * Math.sin(since * 0.45) * clamp(since / 2);
      g.filter = `hue-rotate(${drift.toFixed(1)}deg)`;
      g.drawImage(this.ink, ox, oy);
      g.filter = 'none';
      const glow = 0.55 * Math.exp(-since / 0.9) * clamp(since / 0.25);
      if (glow > 0.01) {
        g.globalCompositeOperation = 'lighter';
        g.globalAlpha = glow;
        g.drawImage(this.ink, ox, oy);
        g.globalAlpha = 1;
        g.globalCompositeOperation = 'source-over';
      }
    } else {
      g.drawImage(this.ink, ox, oy);
    }
    // The butterfly, a little lift and fall with its beat.
    const img = this.sprite(this.hue);
    const rot = this.head + Math.PI / 2;
    const c = Math.cos(rot);
    const n = Math.sin(rot);
    const o = clamp(this.open, 0.3, 1);
    const bob = moving ? Math.sin(this.ph) * this.em * 0.012 : 0;
    g.setTransform(c * o, n * o, -n, c, this.pos.x - n * bob, this.pos.y + c * bob);
    g.drawImage(img, -img.width / 2, -img.height / 2);
    g.setTransform(1, 0, 0, 1, 0, 0);
  }
}

/* The butterfly tree's hour (2026-11-15, Alex: "instead of drawing the time,
   make the butterflies fly and land on as the number shape, they will fly
   from the tree and landing to shape the time form").

   Butterflies leave their twigs in the crown (tree.js lends them) and fly to
   places along the figures of the new hour, where they land and stay, wings
   open, now and then a slow fan. Each figure is made of butterflies of one
   colour, taken from where the tree wears that colour (warm ones from the
   crown, pinks from the left, blues from the right), so the figures read as
   colours and the crown thins where they left. They go in writing order,
   figure by figure, each by a curving way of its own, so the hour gathers
   rather than appears; about eight seconds from the first to the last
   landing. They are given back to their twigs when the show ends. */

const SIT = 0.2;           // a landed butterfly's wingspan, in em
const GAP = 0.44;          // how far apart along a stroke, in wingspans: overlapping, a garland

const smooth = (t) => t * t * (3 - 2 * t);
const hueGap = (a, b) => Math.abs(((a - b + 540) % 360) - 180);

export class HourFlock {
  constructor(host) {
    this.host = host;
    this.cv = document.createElement('canvas');
    this.cv.className = 'hs-paint';
    this.cv.setAttribute('aria-hidden', 'true');
    host.appendChild(this.cv);
    this.g = this.cv.getContext('2d');
    this.cv.hidden = true;
    this.birds = [];
  }

  /* Where the figures of `text` go, in canvas px as tree.js has them; the
     box (CSS px) is for the tree's shade behind them. */
  layout(text, size = 0.4) {
    const r = this.host.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 1.25);
    const W = this.cv.width = Math.max(1, Math.round(r.width * dpr));
    const H = this.cv.height = Math.max(1, Math.round(r.height * dpr));
    this.W = W;
    this.H = H;
    this.k = W / (r.width || W);
    this.text = text;
    const chars = [...text];
    const advs = chars.map((c) => ADV[c] ?? ADV_FIGURE);
    const em = Math.min(H * size, W * 0.95 / advs.reduce((a, b) => a + b, 0));
    const x0 = (W - advs.reduce((a, b) => a + b, 0) * em) / 2;
    const y0 = H / 2 - em / 2;
    this.em = em;
    this.rect = { x: x0, y: y0, w: advs.reduce((a, b) => a + b, 0) * em, h: em };
    // Bigger figures take more butterflies rather than ever bigger ones.
    const sz = this.sz = Math.min(em * SIT, H * 0.075);
    // The places: along every stroke a step apart, a little to either side of
    // it; a dot is a small cluster.
    let x = x0;
    this.figures = chars.map((c, ci) => {
      const spots = [];
      const tracks = [];
      for (const st of strokesOf(c)) {
        const tr = track(st.map(([gx, gy]) => [x + gx * em, y0 + gy * em]));
        tracks.push(tr);
        if (tr.total < em * 0.4) {
          const cx = tr.pts.reduce((a, p) => a + p[0], 0) / tr.pts.length;
          const cy = tr.pts.reduce((a, p) => a + p[1], 0) / tr.pts.length;
          for (const a of [-Math.PI / 2, Math.PI / 6, Math.PI * 5 / 6]) {
            spots.push([cx + Math.cos(a) * sz * 0.24, cy + Math.sin(a) * sz * 0.24]);
          }
          continue;
        }
        const n = Math.max(2, Math.round(tr.total / (sz * GAP)));
        let hint = 0;
        for (let i = 0; i < n; i++) {
          const p = at(tr, (i + 0.5) * tr.total / n, hint);
          hint = p.i;
          const side = (i % 2 ? 1 : -1) * sz * rnd(0.02, 0.08);
          spots.push([p.x - Math.sin(p.dir) * side, p.y + Math.cos(p.dir) * side]);
        }
      }
      const veil = this.veil(tracks, sz, x, y0, advs[ci] * em);
      x += advs[ci] * em;
      return { c, spots, veil, seen: 0 };
    });
    return this.box();
  }

  box() {
    const k = this.k || 1;
    const r = this.rect;
    return r ? { x: r.x / k, y: r.y / k, w: r.w / k, h: r.h / k } : null;
  }

  /* A soft dark shadow along a figure's strokes, so the butterflies of the
     figure stand out from those of the crown behind it (often the same
     colours). It comes as its butterflies do. */
  veil(tracks, sz, x, y0, w) {
    const pad = Math.ceil(sz * 1.6);
    const c = document.createElement('canvas');
    c.width = Math.ceil(w + pad * 2);
    c.height = Math.ceil(this.em + pad * 2);
    const g = c.getContext('2d');
    g.filter = `blur(${Math.round(sz * 0.32)}px)`;
    g.strokeStyle = 'rgba(0,0,0,0.78)';
    g.fillStyle = 'rgba(0,0,0,0.78)';
    g.lineWidth = sz * 1.35;
    g.lineCap = 'round';
    g.lineJoin = 'round';
    for (const tr of tracks) {
      const ox = x - pad;
      const oy = y0 - pad;
      if (tr.total < this.em * 0.4) {
        const cx = tr.pts.reduce((a, p) => a + p[0], 0) / tr.pts.length;
        const cy = tr.pts.reduce((a, p) => a + p[1], 0) / tr.pts.length;
        g.beginPath();
        g.arc(cx - ox, cy - oy, sz * 0.75, 0, TAU);
        g.fill();
        continue;
      }
      g.beginPath();
      tr.pts.forEach(([px, py], i) => (i ? g.lineTo(px - ox, py - oy) : g.moveTo(px - ox, py - oy)));
      g.stroke();
    }
    return { c, x: x - pad, y: y0 - pad };
  }

  /* The tree is up: choose who goes where, and when. */
  start(tree) {
    this.stop();
    this.tree = tree;
    this.t = 0;
    this.last = 0;
    this.round = 0;
    this.birds = [];
    for (const fig of this.figures) fig.seen = 0;
    this.launch(0.25);
    this.cv.hidden = false;
    this.running = true;
  }

  /* Once more: in writing order, each butterfly of the hour flies home to its
     twig and another, of another colour, comes to take its place — a wave of
     colour through the figures, which never stop being the hour. */
  again() {
    if (!this.running) return;
    this.round += 1;
    const all = this.figures.reduce((a, f) => a + f.spots.length, 0) || 1;
    const leaves = new Map();
    for (const b of this.birds) {
      if (b.state === 'wait') {
        b.l.held = false;
        b.gone = true;
      } else if (b.state !== 'home') {
        // One still on its way turns for home at once; those sitting go in turn.
        b.hdep = b.state === 'fly' ? this.t : this.t + 0.3 + 5.0 * (b.order / all) + rnd(0, 0.3);
        b.state = 'home';
        b.hp = null;
        leaves.set(b.order, b.hdep);
      }
    }
    this.birds = this.birds.filter((b) => !b.gone);
    // The newcomer sets off in time to land just as its spot's old one lifts off.
    this.launch(0.3, (order, dur) => Math.max(this.t,
      (leaves.get(order) ?? this.t + 1 + 5.0 * (order / all)) - dur * 0.9 + rnd(-0.2, 0.3)));
    // And the old one waits for it, if it has a long way to come.
    for (const b of this.birds) {
      if (b.round !== this.round || b.state !== 'wait') continue;
      const old = this.birds.find((o) => o.state === 'home' && !o.hp && o.order === b.order && o.round !== this.round);
      if (old) old.hdep = Math.max(old.hdep, b.dep + b.dur * 0.9);
    }
  }

  /* Choose who goes where, leaving `delay` seconds from now in writing order
     (or when depOf(order) says). */
  launch(delay, depOf = null) {
    const sz = this.sz;
    const hour = parseInt(this.text, 10) || 0;
    const pal = PALETTES.tree;
    let pi = hour + this.round * 3;
    let pool = this.tree.lendable();
    const front = pool.filter((l) => !l.back);
    if (front.length > 300) pool = front;
    const taken = new Set();
    const all = this.figures.reduce((a, f) => a + f.spots.length, 0) || 1;
    let done = 0;
    for (const fig of this.figures) {
      const hue = fig.c === ':' ? COLON_HUE : pal[pi++ % pal.length];
      const need = fig.spots.length;
      // The nearest in colour, a little shuffled so they come from all over that part of the crown.
      const near = pool.filter((l) => !taken.has(l)).map((l) => [hueGap(l.col.h, hue) + Math.random() * 18, l])
        .sort((a, b) => a[0] - b[0]).slice(0, Math.ceil(need * 1.5)).map(([, l]) => l);
      for (let i = near.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [near[i], near[j]] = [near[j], near[i]];
      }
      fig.spots.forEach(([tx, ty], i) => {
        const l = near[i];
        if (!l) return;
        l.held = true;
        taken.add(l);
        const dur = clamp(1 + Math.hypot(tx - l.x, ty - l.y) / (this.em * 1.6), 1.9, 3.4);
        this.birds.push({ dur,
          fig, l, tx, ty, round: this.round, order: done + i, size: sz * rnd(0.86, 1.14), rot: rnd(-0.55, 0.55),
          // In writing order: figure by figure, along the stroke, with a little chance.
          dep: depOf ? depOf(done + i, dur) : this.t + delay + 5.0 * ((done + i) / all) + rnd(0, 0.45),
          state: 'wait', ph: Math.random() * TAU, rate: rnd(1.9, 2.5), open: 1,
          fanIn: rnd(3, 12), fan: 0, fanLen: 0, fans: 1,
        });
      });
      done += need;
    }
  }

  stop() {
    this.running = false;
    this.cv.hidden = true;
    this.tree?.giveBack();
    this.birds = [];
  }

  /* Along a flight: where (P a cubic's four points, e how far) and which way. */
  static along(P, e) {
    const m = 1 - e;
    const [A, B, C, D] = P;
    const at = (i) => m * m * m * A[i] + 3 * m * m * e * B[i] + 3 * m * e * e * C[i] + e * e * e * D[i];
    const v = (i) => 3 * m * m * (B[i] - A[i]) + 6 * m * e * (C[i] - B[i]) + 3 * e * e * (D[i] - C[i]);
    return { x: at(0), y: at(1), dir: Math.atan2(v(1), v(0)) };
  }

  /* One step of a flight: the place, the way it faces (turning to `endRot`
     as it comes in), its size and its beat. */
  fly(b, P, f, dt, endRot, size0, size1) {
    const e = smooth(f);
    const p = HourFlock.along(P, e);
    const wob = Math.sin(f * Math.PI * 3 + b.ph) * b.wob * Math.sin(Math.PI * f);
    b.x = p.x - Math.sin(p.dir) * wob;
    b.y = p.y + Math.cos(p.dir) * wob;
    let d = p.dir - b.head;
    d = Math.atan2(Math.sin(d), Math.cos(d));
    b.head += d * Math.min(1, dt * 5);
    const way = b.head + Math.PI / 2;
    const k = smooth(clamp((f - 0.72) / 0.28));
    let dr = endRot - way;
    dr = Math.atan2(Math.sin(dr), Math.cos(dr));
    b.a = way + dr * k;
    b.s = size0 + (size1 - size0) * e;
    b.ph += dt * TAU * b.rate;
    const beat = 0.36 + 0.64 * (0.5 + 0.5 * Math.cos(b.ph));
    b.open += ((f > 0.9 ? 1 : beat) - b.open) * Math.min(1, dt * 9);
  }

  /* Sitting: open and still, now and then a slow fan. */
  sit(b, dt) {
    let want = 1;
    if (b.fan > 0) {
      b.fan -= dt;
      want = 1 - 0.5 * Math.sin(Math.PI * clamp(1 - b.fan / b.fanLen) * b.fans) ** 2;
    } else if ((b.fanIn -= dt) <= 0) {
      b.fanLen = rnd(1.8, 3);
      b.fan = b.fanLen;
      b.fans = Math.random() < 0.6 ? 1 : 2;
      b.fanIn = rnd(6, 16);
    }
    b.open += (want - b.open) * Math.min(1, dt * 9);
  }

  frame(ts = performance.now()) {
    if (!this.running) return;
    const dt = this.last ? Math.min(0.05, (ts - this.last) / 1000) : 0;
    this.last = ts;
    this.t += dt;
    const em = this.em;
    // How far each figure has come: its shadow comes and goes with it.
    for (const fig of this.figures) fig.n = fig.went = 0;
    for (const b of this.birds) {
      if (b.round === this.round) {
        b.fig.n += 1;
        if (b.state === 'sit') b.fig.went += 1;
        else if (b.state === 'fly') b.fig.went += smooth(b.f);
      } else if (b.state === 'home') {
        b.fig.went += b.hp ? 1 - smooth(b.hf) : 1;
      }
    }
    for (const fig of this.figures) {
      const want = fig.n ? Math.min(1, fig.went / fig.n) : 0;
      fig.seen += (want - fig.seen) * Math.min(1, dt * 3);
    }
    for (const b of this.birds) {
      const l = b.l;
      if (b.state === 'wait') {
        if (this.t < b.dep) continue;
        // Off its twig, from where the wind has it now.
        l.off = true;
        const p0 = [l.x, l.y];
        const side = Math.random() < 0.5 ? -1 : 1;
        b.p = [
          p0,
          [p0[0] + side * rnd(0.2, 0.7) * em, p0[1] - rnd(0.3, 0.8) * em],
          [b.tx + rnd(-0.7, 0.7) * em, b.ty - rnd(0.35, 0.9) * em],
          [b.tx, b.ty],
        ];
        b.size0 = l.size;
        b.img = this.tree.frames(l.col, l.kind)[0];
        b.wob = rnd(0.03, 0.07) * em;
        b.f = 0;
        b.state = 'fly';
        b.head = (l.rot || 0) + (l.turn || 0) - Math.PI / 2;
      }
      if (b.state === 'fly') {
        b.f = Math.min(1, b.f + dt / b.dur);
        this.fly(b, b.p, b.f, dt, b.rot, b.size0, b.size);
        if (b.f >= 1) { b.state = 'sit'; b.x = b.tx; b.y = b.ty; b.a = b.rot; b.s = b.size; }
      } else if (b.state === 'sit') {
        this.sit(b, dt);
      } else if (b.state === 'home') {
        if (this.t < b.hdep) { this.sit(b, dt); continue; }
        if (!b.hp) {
          const side = Math.random() < 0.5 ? -1 : 1;
          b.hp = [[b.x, b.y], [b.x + side * rnd(0.2, 0.6) * em, b.y - rnd(0.3, 0.7) * em]];
          b.hc = [rnd(-0.5, 0.5) * em, -rnd(0.3, 0.7) * em];
          b.hf = 0;
          b.hdur = rnd(1.9, 2.9);
          b.hs = b.s;
          b.head = b.a - Math.PI / 2;
        }
        // To its twig, wherever the wind has the twig by now.
        b.hf = Math.min(1, b.hf + dt / b.hdur);
        const P = [b.hp[0], b.hp[1], [l.x + b.hc[0], l.y + b.hc[1]], [l.x, l.y]];
        this.fly(b, P, b.hf, dt, (l.rot || 0) + (l.turn || 0), b.hs, l.size);
        if (b.hf >= 1) {
          l.off = false;
          l.held = false;
          b.gone = true;
        }
      }
    }
    if (this.birds.some((b) => b.gone)) this.birds = this.birds.filter((b) => !b.gone);
    this.draw();
  }

  draw() {
    const g = this.g;
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.clearRect(0, 0, this.W, this.H);
    // As light or dark as the tree they came from.
    const op = this.tree?.cv.style.opacity || '1';
    if (this.cv.style.opacity !== op) this.cv.style.opacity = op;
    // The figures' shadows, each as far as its butterflies have come.
    for (const fig of this.figures) {
      if (fig.seen < 0.01) continue;
      g.globalAlpha = fig.seen;
      g.drawImage(fig.veil.c, fig.veil.x, fig.veil.y);
    }
    g.globalAlpha = 1;
    // Those sitting first, those in the air over them.
    const inAir = (b) => b.state === 'fly' || (b.state === 'home' && !!b.hp);
    for (const air of [false, true]) {
      for (const b of this.birds) {
        if (b.state === 'wait' || inAir(b) !== air) continue;
        const c = Math.cos(b.a);
        const n = Math.sin(b.a);
        const o = clamp(b.open, 0.3, 1);
        const h = (b.s * b.img.height) / b.img.width;
        g.setTransform(c * o, n * o, -n, c, b.x, b.y);
        g.drawImage(b.img, -b.s / 2, -h / 2, b.s, h);
      }
    }
    g.setTransform(1, 0, 0, 1, 0, 0);
  }
}
