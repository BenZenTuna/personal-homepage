/* Look 5 of the dim clock: a calm pond (night.js; Alex, 2026-11-13: "make a
   such relaxing random movements illustration for the screen dimmer. That
   would make people relax, according to research").

   What the research says relaxes, and so what is here:
   - "soft fascination" (Kaplan): slow, nature-like motion with no story, no
     cuts, no faces, no text — attention held without effort. Everything here
     moves slowly and keeps moving; nothing happens.
   - living, varied motion (the aquarium studies: more fish held attention
     longer and lifted mood): koi seen from above, each wandering on its own,
     gliding, turning, now and then rising to touch the surface.
   - fractal patterns of medium complexity (Taylor, D 1.3–1.5, the stress
     recovery of looking at trees): the reflection of overhanging branches,
     a recursive tree, swaying on the water.
   - randomness, so the loop never visibly repeats: every fish steers by its
     own chance, ripples come when they come, leaves land now and then.
   - muted natural colours, dark enough for a dim kitchen at night.

   The pond follows the weather outside without spoiling the calm: rain is
   rings on the water (as many as it rains), snow is flakes settling and
   melting into it, wind drifts the leaves and sways the branches, fog lies
   over it; no lightning on purpose. The season gives what floats: blossom
   petals in spring, water lilies in flower in summer, autumn leaves, a few
   brown leaves and browner pads in winter. Day or night by the forecast's
   sunrise and sunset.

   Laid out from a seed of the day (the stones, the branches, the pads, the
   koi's colours: the same pond all day, another tomorrow); how they move is
   chance. The still part is drawn once into a picture of its own and made
   again only when the light or the weather changes. Movement (wx_motion) is
   its pace; Still draws one frame. Thirty frames a second at most. */

const TAU = Math.PI * 2;
const SPEEDS = [0, 0.6, 0.8, 1];
const N = 11;                                   // points along a koi's spine
const PROFILE = [0.62, 0.9, 1, 0.98, 0.9, 0.78, 0.63, 0.47, 0.33, 0.21, 0.12];

const hex = (s) => [parseInt(s.slice(1, 3), 16), parseInt(s.slice(3, 5), 16), parseInt(s.slice(5, 7), 16)];
const mix = (a, b, t) => a.map((v, i) => v + (b[i] - v) * t);
const css = (c, a = 1) => `rgba(${Math.round(c[0])},${Math.round(c[1])},${Math.round(c[2])},${a})`;
const clamp = (v, lo = 0, hi = 1) => Math.max(lo, Math.min(hi, v));
const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));
const rnd = (a, b) => a + Math.random() * (b - a);

/* The water: deep, middle and the dark rim, by night and by day; greyer
   under a grey sky. */
const WATER = {
  night: [hex('#07161d'), hex('#0d2a33'), hex('#03090c')],
  day: [hex('#103a3a'), hex('#1d554f'), hex('#081f20')],
  grey: [hex('#152224'), hex('#26393a'), hex('#0a1213')],
};

/* Koi, muted: a body colour, patches on it, and the fins. */
const KOI = [
  { body: '#e6ddd0', fin: '#efe6da', spots: ['#bf4a2e', '#bf4a2e', '#c9562f'] },            // kohaku
  { body: '#e8e0d4', fin: '#f0e8dc', spots: ['#c4492c'], head: true },                       // tancho
  { body: '#1f1d1c', fin: '#3a3533', spots: ['#b5452d', '#e2d9cc', '#b5452d'] },            // showa
  { body: '#d39b3c', fin: '#e2b866', spots: [] },                                            // ogon
  { body: '#cf7431', fin: '#e3a167', spots: ['#e8dfd2', '#e8dfd2'] },                        // orange
  { body: '#e4dcd0', fin: '#ece4d8', spots: ['#242120', '#242120'] },                        // shiro utsuri
  { body: '#6d8594', fin: '#93a7b2', spots: ['#c4683a', '#c4683a'] },                        // asagi
  { body: '#d9a54a', fin: '#e8c47c', spots: ['#e9e1d4'] },                                   // yamabuki
];

const SEASON_FLOAT = {
  spring: { n: 9, kind: 'petal', cols: ['#e3b6c2', '#f0d5dc', '#d697a9'] },
  summer: { n: 4, kind: 'leaf', cols: ['#4d6d36', '#5f7d3d', '#6b7a3a'] },
  autumn: { n: 11, kind: 'leaf', cols: ['#b5532a', '#c98a2e', '#8f3a22', '#a8742c', '#9c5a26'] },
  winter: { n: 3, kind: 'leaf', cols: ['#6b5338', '#7a6446'] },
};

/* A seeded random: the same pond all day, another tomorrow. */
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
  return d.getFullYear() * 1000 + d.getMonth() * 40 + d.getDate() + 7;
}

/* Daylight 0 (night) to 1 (day), a three-quarter-hour twilight either side
   of sunrise and sunset; without them, 07:00 and 17:00. */
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

export function seasonOf(now) {
  const m = new Date(now).getMonth();
  return m >= 2 && m <= 4 ? 'spring' : m >= 5 && m <= 7 ? 'summer' : m >= 8 && m <= 10 ? 'autumn' : 'winter';
}

/* A small canvas. */
function sprite(w, h) {
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.ceil(w));
  c.height = Math.max(1, Math.ceil(h));
  return c;
}

/* Through points, smoothly: quadratic curves via the midpoints. */
function smooth(g, pts, start = true) {
  if (start) g.moveTo(pts[0][0], pts[0][1]);
  else g.lineTo(pts[0][0], pts[0][1]);
  for (let i = 1; i < pts.length - 1; i++) {
    const mx = (pts[i][0] + pts[i + 1][0]) / 2;
    const my = (pts[i][1] + pts[i + 1][1]) / 2;
    g.quadraticCurveTo(pts[i][0], pts[i][1], mx, my);
  }
  const l = pts[pts.length - 1];
  g.lineTo(l[0], l[1]);
}

export class Pond {
  constructor(host) {
    this.host = host;
    this.cv = document.createElement('canvas');
    this.cv.className = 'nt-scape nt-pond';
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
    this.frame = (ts) => this.loop(ts);
    this.ro = new ResizeObserver(() => { if (this.running && this.fit()) this.redraw(); });
    this.ro.observe(host);
  }

  /* sc: wxart.js's scene of the hour (null: calm). env: {now, rise, set, seed}. */
  set(sc, env, motion) {
    this.sc = sc || { sky: 'clear', night: false, fall: null, wind: 0, fog: 0, storm: false };
    this.env = env;
    const speed = SPEEDS[motion] ?? SPEEDS[1];
    if (this.world && this.world.seed !== env.seed) this.world = null;
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
    this.draw();
    if (this.speed > 0) this.raf = requestAnimationFrame(this.frame);
  }

  loop(ts) {
    if (!this.running || !(this.speed > 0)) return;
    this.raf = requestAnimationFrame(this.frame);
    if (this.last && ts - this.last < 1000 / 30 - 2) return;        // thirty a second
    const dt = this.last ? Math.min(0.1, (ts - this.last) / 1000) : 0;
    this.last = ts;
    this.step(dt * this.speed);
    this.draw();
  }

  /* --------------------------------------------------------- the world -- */

  build() {
    const { W, H, u } = this;
    const env = this.env;
    const R = rng(env.seed || 1);
    const season = seasonOf(env.now);
    const w = {
      seed: env.seed, season, R,
      stones: [], weeds: [], koi: [], pads: [], floats: [], ripples: [], flakes: [], blobs: [], fogs: [],
      glints: [], nextBug: rnd(2, 6), nextLand: rnd(15, 40), rainAcc: 0, snowAcc: 0,
    };
    // Stones on the bottom, more of them towards the banks.
    for (let i = 0; i < 170; i++) {
      const edge = R() < 0.6;
      let x = R() * W;
      let y = R() * H;
      if (edge) {
        const side = Math.floor(R() * 4);
        const d = Math.pow(R(), 2) * 0.16;
        if (side === 0) y = d * H; else if (side === 1) y = H - d * H;
        else if (side === 2) x = d * W; else x = W - d * W;
      }
      w.stones.push({ x, y, rx: (8 + R() * R() * 46) * u, ry: (6 + R() * R() * 34) * u, a: R() * TAU,
        tone: R(), al: 0.1 + R() * 0.18 });
    }
    // Weeds swaying near the banks.
    for (let i = 0; i < 9; i++) {
      const side = R() < 0.5;
      const x = side ? R() * W * 0.18 : W - R() * W * 0.18;
      const y = H * (0.1 + R() * 0.8);
      const strands = [];
      for (let k = 0; k < 4 + Math.floor(R() * 5); k++) {
        strands.push({ a: R() * TAU, len: (60 + R() * 120) * u, ph: R() * TAU, curl: 0.4 + R() * 0.8 });
      }
      w.weeds.push({ x, y, strands });
    }
    // The branches' reflections: a tree from the top left, a smaller one
    // from the bottom right — one sprite, the size of the screen.
    w.tree = sprite(W, H);
    const tg = w.tree.getContext('2d');
    tg.lineCap = 'round';
    tg.strokeStyle = tg.fillStyle = '#000';
    const branch = (x, y, ang, len, lw, depth) => {
      const x2 = x + Math.cos(ang) * len;
      const y2 = y + Math.sin(ang) * len;
      tg.lineWidth = lw;
      tg.beginPath();
      tg.moveTo(x, y);
      tg.quadraticCurveTo((x + x2) / 2 + (R() - 0.5) * len * 0.25, (y + y2) / 2 + (R() - 0.5) * len * 0.25, x2, y2);
      tg.stroke();
      if (depth <= 2) {
        for (let k = 0; k < 3 + Math.floor(R() * 4); k++) {
          tg.beginPath();
          tg.ellipse(x2 + (R() - 0.5) * 26 * u, y2 + (R() - 0.5) * 26 * u, (3 + R() * 6) * u, (2 + R() * 3) * u,
            R() * TAU, 0, TAU);
          tg.fill();
        }
      }
      if (depth <= 0) return;
      const n = R() < 0.3 ? 3 : 2;
      for (let k = 0; k < n; k++) {
        const spread = (0.28 + R() * 0.32) * (n === 3 ? (k - 1) : (k ? 1 : -1));
        branch(x2, y2, ang + spread + (R() - 0.5) * 0.15, len * (0.68 + R() * 0.14), lw * 0.68, depth - 1);
      }
    };
    branch(-0.04 * W, -0.06 * H, 0.55 + R() * 0.2, 0.11 * H, 26 * u, 8);
    branch(1.04 * W, 1.07 * H, Math.PI + 0.5 + R() * 0.2, 0.08 * H, 18 * u, 7);
    // The koi: seven, each its own colours and size, somewhere in the pond.
    const order = [...KOI.keys()].sort(() => R() - 0.5);
    for (let i = 0; i < 7; i++) {
      const kind = KOI[order[i % KOI.length]];
      const len = (125 + R() * 105) * u;
      const x = W * (0.15 + R() * 0.7);
      const y = H * (0.15 + R() * 0.7);
      const ang = R() * TAU;
      const pts = [];
      for (let k = 0; k < N; k++) {
        pts.push([x - Math.cos(ang) * (len / (N - 1)) * k, y - Math.sin(ang) * (len / (N - 1)) * k]);
      }
      const spots = kind.spots.map((c, k) => ({
        c, at: 0.8 + k * 2.4 + R() * 1.6, side: (R() - 0.5) * 0.9, r: 0.55 + R() * 0.55, s: 1.2 + R() * 0.8,
      }));
      if (kind.head) spots.splice(0, spots.length, { c: kind.spots[0], at: 0.7, side: 0, r: 0.75, s: 1 });
      w.koi.push({
        kind, len, pts, ang, spots,
        base: len * (0.22 + R() * 0.12), sp: len * 0.25, spWant: len * 0.25,
        turn: 0, turnWant: 0, tt: R() * 3, phase: R() * TAU,
        dph: R() * TAU, dsp: 0.02 + R() * 0.04, depth: 0.5, goal: null, gt: 0,
      });
    }
    // Lily pads, away from the middle where the clock is.
    const nPads = season === 'winter' ? 4 : 7;
    for (let i = 0; i < nPads; i++) {
      let x, y;
      for (let tries = 0; tries < 20; tries++) {
        x = W * (0.04 + R() * 0.92);
        y = H * (0.06 + R() * 0.88);
        if (Math.abs(x - W / 2) > W * 0.24 || Math.abs(y - H / 2) > H * 0.3) break;
      }
      const r = (38 + R() * 52) * u;
      const flower = season === 'summer' && i < 3 && R() < 0.85;
      w.pads.push({ x, y, r, a: R() * TAU, va: (R() - 0.5) * 0.02, vx: 0, vy: 0, ph: R() * TAU,
        img: this.padSprite(r, R, season, flower) });
    }
    // What floats: by the season.
    const fl = SEASON_FLOAT[season];
    for (let i = 0; i < fl.n; i++) w.floats.push(this.newFloat(w, true));
    // Soft light moving over the bottom: sunlight by day, faint by night.
    w.blob = sprite(256, 256);
    const bg2 = w.blob.getContext('2d');
    const rg = bg2.createRadialGradient(128, 128, 0, 128, 128, 128);
    rg.addColorStop(0, 'rgba(255,255,255,1)');
    rg.addColorStop(0.5, 'rgba(255,255,255,0.35)');
    rg.addColorStop(1, 'rgba(255,255,255,0)');
    bg2.fillStyle = rg;
    bg2.fillRect(0, 0, 256, 256);
    for (let i = 0; i < 9; i++) {
      w.blobs.push({ cx: R() * W, cy: R() * H, ax: (80 + R() * 240) * u, ay: (60 + R() * 180) * u,
        fx: 0.01 + R() * 0.03, fy: 0.01 + R() * 0.03, px: R() * TAU, py: R() * TAU, s: (220 + R() * 320) * u });
    }
    for (let i = 0; i < 4; i++) {
      w.fogs.push({ x: R() * W, y: R() * H, w: (700 + R() * 600) * u, h: (180 + R() * 160) * u, v: (5 + R() * 9) * u });
    }
    // Specks of light on the surface, twinkling.
    for (let i = 0; i < 40; i++) {
      w.glints.push({ x: R() * W, y: R() * H, ph: R() * TAU, sp: 0.3 + R() * 0.9, r: (1 + R() * 1.6) * u });
    }
    // Where the drift goes, turning slowly.
    w.current = R() * TAU;
    this.world = w;
    this.bgKey = '';
  }

  /* A pad, drawn once: the green leaf with its notch and veins, a lily on
     a summer one. */
  padSprite(r, R, season, flower) {
    const s = sprite(r * 2.6, r * 2.6);
    const g = s.getContext('2d');
    const c = s.width / 2;
    const notch = 0.22;
    const base = season === 'winter' ? hex('#4a4a2c') : season === 'autumn' ? hex('#465a2c') : hex('#2d5530');
    const tone = mix(base, hex('#56763a'), R() * 0.4);
    g.translate(c, c);
    const path = () => {
      g.beginPath();
      g.moveTo(0, 0);
      g.arc(0, 0, r, notch / 2, TAU - notch / 2);
      g.closePath();
    };
    const gr = g.createRadialGradient(-r * 0.2, -r * 0.2, r * 0.1, 0, 0, r);
    gr.addColorStop(0, css(mix(tone, [200, 220, 160], 0.12)));
    gr.addColorStop(1, css(mix(tone, [0, 0, 0], 0.25)));
    path();
    g.fillStyle = gr;
    g.fill();
    g.lineWidth = Math.max(1, r * 0.035);
    g.strokeStyle = css(mix(tone, [220, 235, 170], 0.25), 0.55);
    g.stroke();
    g.strokeStyle = css(mix(tone, [0, 0, 0], 0.35), 0.35);
    g.lineWidth = Math.max(0.8, r * 0.015);
    for (let k = 1; k < 10; k++) {
      const a = notch / 2 + (TAU - notch) * (k / 10);
      g.beginPath();
      g.moveTo(0, 0);
      g.quadraticCurveTo(Math.cos(a - 0.08) * r * 0.5, Math.sin(a - 0.08) * r * 0.5, Math.cos(a) * r * 0.92,
        Math.sin(a) * r * 0.92);
      g.stroke();
    }
    if (flower) {
      const fr = r * (0.38 + R() * 0.12);
      const fx = r * 0.15;
      const fy = -r * 0.2;
      const pink = R() < 0.5;
      const outer = pink ? '#d9a3b5' : '#e6dfd6';
      const inner = pink ? '#ecc8d3' : '#f3eee8';
      for (const [rad, col, n, off] of [[fr, outer, 10, 0], [fr * 0.72, inner, 8, 0.3], [fr * 0.45, inner, 6, 0.1]]) {
        for (let k = 0; k < n; k++) {
          const a = off + (TAU * k) / n;
          g.save();
          g.translate(fx, fy);
          g.rotate(a);
          g.beginPath();
          g.ellipse(rad * 0.55, 0, rad * 0.55, rad * 0.2, 0, 0, TAU);
          g.fillStyle = col;
          g.globalAlpha = 0.92;
          g.fill();
          g.strokeStyle = 'rgba(80,40,50,0.18)';
          g.lineWidth = 1;
          g.stroke();
          g.restore();
        }
      }
      g.globalAlpha = 1;
      g.beginPath();
      g.arc(fx, fy, fr * 0.18, 0, TAU);
      g.fillStyle = '#d8b04a';
      g.fill();
    }
    return s;
  }

  /* Something floating: a leaf or a petal by the season. `anywhere` places
     it on the water; otherwise it comes in from where the drift comes. */
  newFloat(w, anywhere) {
    const { W, H, u } = this;
    const fl = SEASON_FLOAT[w.season];
    const size = (fl.kind === 'petal' ? 9 + Math.random() * 7 : 16 + Math.random() * 16) * u;
    let x = Math.random() * W;
    let y = Math.random() * H;
    if (!anywhere) {
      const a = (w.current ?? 0) + Math.PI + (Math.random() - 0.5) * 1.2;
      x = W / 2 + Math.cos(a) * W * 0.62;
      y = H / 2 + Math.sin(a) * H * 0.62;
    }
    const col = fl.cols[Math.floor(Math.random() * fl.cols.length)];
    return { x, y, a: Math.random() * TAU, va: (Math.random() - 0.5) * 0.08, size, kind: fl.kind, col,
      ph: Math.random() * TAU, fade: anywhere ? 1 : 0 };
  }

  /* ------------------------------------------------------------ moving -- */

  step(dt) {
    if (!this.world || !dt) return;
    const { W, H, u } = this;
    const w = this.world;
    const sc = this.sc;
    this.t += dt;
    const wind = sc.wind || 0;
    // The drift: slow, turning slowly, a little faster with wind.
    w.current = wrap(w.current + (Math.random() - 0.5) * 0.02 * dt + 0.004 * dt);
    const drift = (3 + wind * 7) * u;
    const cx = Math.cos(w.current) * drift;
    const cy = Math.sin(w.current) * drift;
    // The koi.
    for (const f of w.koi) this.swim(f, dt);
    // Pads: drifting very slowly, kept on the water, turning a little.
    for (const p of w.pads) {
      p.vx += (cx * 0.25 - p.vx) * dt * 0.1;
      p.vy += (cy * 0.25 - p.vy) * dt * 0.1;
      const m = p.r * 0.6;
      if (p.x < m) p.vx += 2 * u * dt; else if (p.x > W - m) p.vx -= 2 * u * dt;
      if (p.y < m) p.vy += 2 * u * dt; else if (p.y > H - m) p.vy -= 2 * u * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.a += p.va * dt;
    }
    // What floats: with the drift, turning; off the water, one comes in again.
    for (let i = 0; i < w.floats.length; i++) {
      const l = w.floats[i];
      l.fade = Math.min(1, l.fade + dt * 0.3);
      l.ph += dt * 0.5;
      l.x += (cx + Math.sin(l.ph) * 1.5 * u) * dt;
      l.y += (cy + Math.cos(l.ph * 0.7) * 1.5 * u) * dt;
      l.a += l.va * dt * (1 + wind);
      const m = 60 * u;
      if (l.x < -m || l.x > W + m || l.y < -m || l.y > H + m) w.floats[i] = this.newFloat(w, false);
    }
    // Now and then a leaf lands on the water (autumn the most).
    w.nextLand -= dt;
    if (w.nextLand <= 0) {
      w.nextLand = { autumn: rnd(12, 35), spring: rnd(15, 40), summer: rnd(40, 90), winter: rnd(60, 120) }[w.season];
      const l = this.newFloat(w, true);
      l.fade = 0;
      if (w.floats.length < SEASON_FLOAT[w.season].n + 6) w.floats.push(l);
      else w.floats[Math.floor(Math.random() * w.floats.length)] = l;
      this.ripple(l.x, l.y, 1.1);
    }
    // An insect touching the water: a small ring, at random.
    w.nextBug -= dt;
    if (w.nextBug <= 0) {
      w.nextBug = rnd(3, 11);
      this.ripple(Math.random() * W, Math.random() * H, 0.6);
    }
    // Rain: rings, as many as it rains.
    const f = sc.fall;
    if (f && !['snow', 'grains'].includes(f.kind)) {
      const rate = ({ drizzle: 4, rain: 9, showers: 9, sleet: 7, hail: 6 }[f.kind] ?? 8) * [0.6, 0.7, 1, 1.8][f.level || 2];
      w.rainAcc += rate * dt;
      while (w.rainAcc >= 1) {
        w.rainAcc -= 1;
        this.ripple(Math.random() * W, Math.random() * H, f.kind === 'drizzle' ? 0.45 : 0.75, true);
      }
    }
    // Snow: flakes settling onto the water and melting into it.
    if (f && ['snow', 'grains', 'sleet'].includes(f.kind)) {
      const rate = [1.5, 2, 4, 8][f.level || 2];
      w.snowAcc += rate * dt;
      while (w.snowAcc >= 1 && w.flakes.length < 160) {
        w.snowAcc -= 1;
        w.flakes.push({ x: Math.random() * W, y: Math.random() * H, age: 0, life: rnd(2.5, 4.5),
          r: (f.kind === 'grains' ? 2.5 : rnd(3.5, 7)) * u });
      }
    }
    for (const k of w.flakes) {
      k.age += dt;
      k.x += (wind * 6 * u + Math.sin(k.age * 2 + k.y) * 4 * u) * dt;
      if (k.age >= k.life && !k.landed) { k.landed = true; this.ripple(k.x, k.y, 0.35, true); }
    }
    w.flakes = w.flakes.filter((k) => k.age < k.life + 0.6);
    // Rings growing and fading.
    for (const r of w.ripples) r.age += dt;
    w.ripples = w.ripples.filter((r) => r.age < r.life);
    // Fog drifting.
    for (const g of w.fogs) {
      g.x += (g.v + wind * 4 * u) * dt;
      if (g.x - g.w > W) g.x = -g.w;
    }
  }

  ripple(x, y, size = 1, quick = false) {
    const w = this.world;
    if (!w || w.ripples.length > 140) return;
    w.ripples.push({ x, y, age: 0, life: quick ? rnd(1.2, 1.8) : rnd(3, 4.5), size: size * rnd(0.8, 1.2) });
  }

  /* Somewhere to swim to: anywhere on the water, mostly not the middle
     where the clock is, so the koi spread over the whole pond. */
  newGoal() {
    const { W, H } = this;
    for (let k = 0; k < 8; k++) {
      const x = W * rnd(0.1, 0.9);
      const y = H * rnd(0.12, 0.88);
      if (Math.random() < 0.2 || Math.abs(x - W / 2) > W * 0.2 || Math.abs(y - H / 2) > H * 0.22) return [x, y];
    }
    return [W * rnd(0.1, 0.9), H * rnd(0.12, 0.88)];
  }

  /* One koi: wandering by chance towards a place of its own, chosen again
     every so often — a new turn and pace every few seconds on the way,
     sometimes a little burst, mostly a slow glide — kept off the banks and
     out of the others' way, rising and sinking slowly; near the top now and
     then it touches the surface. Its body follows its head. */
  swim(f, dt) {
    const { W, H } = this;
    const h = f.pts[0];
    f.gt -= dt;
    if (!f.goal || f.gt <= 0 || Math.hypot(f.goal[0] - h[0], f.goal[1] - h[1]) < f.len) {
      f.goal = this.newGoal();
      f.gt = rnd(12, 30);
    }
    f.tt -= dt;
    if (f.tt <= 0) {
      f.tt = rnd(2, 7);
      f.turnWant = (Math.random() * 2 - 1) * (Math.random() < 0.25 ? 0.7 : 0.3);
      f.spWant = f.base * (Math.random() < 0.12 ? rnd(1.6, 2.2) : rnd(0.45, 1.1));
    }
    const toGoal = wrap(Math.atan2(f.goal[1] - h[1], f.goal[0] - h[0]) - f.ang);
    let want = f.turnWant + clamp(toGoal * 0.35, -0.4, 0.4);
    const look = f.len * 1.6;
    const ax = h[0] + Math.cos(f.ang) * look;
    const ay = h[1] + Math.sin(f.ang) * look;
    const m = Math.min(W, H) * 0.08;
    if (ax < m || ax > W - m || ay < m || ay > H - m) want = Math.sign(toGoal || 1) * 0.95;
    for (const o of this.world.koi) {
      if (o === f || Math.abs(o.depth - f.depth) > 0.45) continue;
      const dx = o.pts[0][0] - f.pts[0][0];
      const dy = o.pts[0][1] - f.pts[0][1];
      const d = Math.hypot(dx, dy);
      if (d < f.len * 0.9) {
        const rel = wrap(Math.atan2(dy, dx) - f.ang);
        if (Math.abs(rel) < 1.4) want -= Math.sign(rel || 1) * 0.6;
      }
    }
    f.turn += (want - f.turn) * Math.min(1, dt * 1.1);
    f.ang = wrap(f.ang + f.turn * dt);
    f.sp += (f.spWant - f.sp) * Math.min(1, dt * 0.45);
    h[0] += Math.cos(f.ang) * f.sp * dt;
    h[1] += Math.sin(f.ang) * f.sp * dt;
    const seg = f.len / (N - 1);
    for (let i = 1; i < N; i++) {
      const p = f.pts[i];
      const q = f.pts[i - 1];
      const dx = q[0] - p[0];
      const dy = q[1] - p[1];
      const d = Math.hypot(dx, dy) || 1;
      p[0] = q[0] - (dx / d) * seg;
      p[1] = q[1] - (dy / d) * seg;
    }
    f.phase += dt * (1.6 + (f.sp / f.len) * 7);
    f.depth = clamp(0.5 + 0.55 * Math.sin(this.t * f.dsp * TAU + f.dph));
    if (f.depth < 0.04 && Math.random() < dt * 0.25) this.ripple(h[0], h[1], 0.7);
    if (!Number.isFinite(h[0]) || h[0] < -W || h[0] > 2 * W || h[1] < -H || h[1] > 2 * H) {
      // Never lost: one gone far off comes back to the middle.
      for (const p of f.pts) { p[0] = W / 2; p[1] = H / 2; }
    }
  }

  /* ----------------------------------------------------------- drawing -- */

  palette() {
    const env = this.env;
    const sc = this.sc;
    const light = lightAt(env.now, env.rise, env.set);
    const grey = sc.storm ? 0.85 : { overcast: 0.55, storm: 0.85, none: 0.5, partly: 0.2 }[sc.sky] ?? 0;
    const water = WATER.night.map((c, i) => mix(mix(c, WATER.day[i], light), WATER.grey[i], grey * (0.4 + 0.6 * light)));
    return { light, grey, water };
  }

  paintBg(P) {
    const { W, H } = this;
    const w = this.world;
    const g = this.bg.getContext('2d');
    g.setTransform(1, 0, 0, 1, 0, 0);
    const [deep, mid, rim] = P.water;
    const gr = g.createRadialGradient(W * 0.48, H * 0.52, 0, W / 2, H / 2, Math.hypot(W, H) * 0.6);
    gr.addColorStop(0, css(mid));
    gr.addColorStop(0.55, css(deep));
    gr.addColorStop(1, css(rim));
    g.fillStyle = gr;
    g.fillRect(0, 0, W, H);
    // The sky's glare where the branches hang over: lighter water under them.
    const sky = mix(mid, [150, 180, 190], 0.18 + P.light * 0.12);
    const gl = g.createRadialGradient(W * 0.08, H * 0.1, 0, W * 0.08, H * 0.1, W * 0.42);
    gl.addColorStop(0, css(sky, 0.55));
    gl.addColorStop(1, css(sky, 0));
    g.fillStyle = gl;
    g.fillRect(0, 0, W, H);
    // Stones on the bottom.
    for (const s of w.stones) {
      g.beginPath();
      g.ellipse(s.x, s.y, s.rx, s.ry, s.a, 0, TAU);
      g.fillStyle = css(mix(mix(deep, [120, 110, 90], 0.35), [40, 45, 40], s.tone), s.al);
      g.fill();
    }
    // The middle a little darker, so the clock reads over the water — or the
    // top, when the words sit there (night.js's place: Top).
    const box = this.env.boxes?.[0];
    const k = W / (this.host.offsetWidth || W);
    const cy = box ? (box.y + box.h / 2) * k : this.env.top ? H * 0.2 : H / 2;
    const sm = g.createRadialGradient(W / 2, cy, 0, W / 2, cy, Math.min(W, H) * 0.55);
    sm.addColorStop(0, 'rgba(0,0,0,0.32)');
    sm.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = sm;
    g.fillRect(0, 0, W, H);
    // The banks: darker all round.
    const vg = g.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.45, W / 2, H / 2, Math.hypot(W, H) * 0.56);
    vg.addColorStop(0, 'rgba(0,0,0,0)');
    vg.addColorStop(1, 'rgba(0,0,0,0.55)');
    g.fillStyle = vg;
    g.fillRect(0, 0, W, H);
  }

  draw() {
    if (!this.W) return;
    if (!this.world) this.build();
    const { W, H, u } = this;
    const w = this.world;
    const g = this.g;
    const P = this.palette();
    const b0 = this.env.boxes?.[0];
    const key = `${Math.round(P.light * 10)}|${Math.round(P.grey * 10)}|${!!this.env.top}|${
      b0 ? Math.round((b0.y + b0.h / 2) / 16) : ''}`;
    if (key !== this.bgKey) { this.paintBg(P); this.bgKey = key; }
    this.cv.style.opacity = (0.72 + 0.14 * P.light).toFixed(2);
    const t = this.t;
    const wind = this.sc.wind || 0;
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.globalAlpha = 1;
    g.globalCompositeOperation = 'source-over';
    g.drawImage(this.bg, 0, 0);
    // Weeds near the banks, swaying.
    g.lineCap = 'round';
    g.strokeStyle = css(mix(P.water[0], [60, 100, 50], 0.45), 0.4);
    for (const wd of w.weeds) {
      for (const s of wd.strands) {
        const sw = Math.sin(t * 0.5 + s.ph) * 0.25;
        g.lineWidth = 4 * u;
        g.beginPath();
        g.moveTo(wd.x, wd.y);
        const a = s.a + sw;
        g.quadraticCurveTo(wd.x + Math.cos(a + s.curl) * s.len * 0.6, wd.y + Math.sin(a + s.curl) * s.len * 0.6,
          wd.x + Math.cos(a) * s.len, wd.y + Math.sin(a) * s.len);
        g.stroke();
      }
    }
    // Light moving over the bottom.
    g.globalCompositeOperation = 'lighter';
    const bl = 0.035 + 0.05 * P.light * (1 - P.grey * 0.7);
    for (const b of w.blobs) {
      const x = b.cx + Math.sin(t * b.fx * TAU + b.px) * b.ax;
      const y = b.cy + Math.cos(t * b.fy * TAU + b.py) * b.ay;
      g.globalAlpha = bl * (0.6 + 0.4 * Math.sin(t * 0.3 + b.px));
      g.drawImage(w.blob, x - b.s / 2, y - b.s / 2, b.s, b.s);
    }
    g.globalCompositeOperation = 'source-over';
    g.globalAlpha = 1;
    // The koi's shadows on the bottom, then the koi, the deepest first.
    const fish = [...w.koi].sort((a, b) => b.depth - a.depth);
    for (const f of fish) this.koi(g, f, true, P);
    for (const f of fish) this.koi(g, f, false, P);
    // The branches' reflections, wavering on the water.
    g.globalAlpha = 0.34 + 0.18 * P.light;
    const strip = Math.max(4, Math.round(6 * u));
    const sway = Math.sin(t * 0.21) * (2 + wind * 5) * u;
    for (let y = 0; y < H; y += strip) {
      const off = Math.sin(y * 0.018 / u + t * 0.9) * 2.6 * u + Math.sin(y * 0.006 / u - t * 0.45) * 3.5 * u + sway;
      g.drawImage(w.tree, 0, y, W, strip, off, y, W, strip);
    }
    g.globalAlpha = 1;
    // Pads and their shadows, then what floats.
    const dimNight = 0.6 + 0.4 * P.light;
    g.globalAlpha = dimNight;
    for (const p of w.pads) {
      const bob = Math.sin(t * 0.6 + p.ph) * 0.015;
      const s = p.img.width * (1 + bob);
      g.save();
      g.translate(p.x + 8 * u, p.y + 11 * u);
      g.rotate(p.a);
      g.beginPath();
      g.arc(0, 0, p.r * (1 + bob), 0.11, TAU - 0.11);
      g.lineTo(0, 0);
      g.fillStyle = 'rgba(0,0,0,0.28)';
      g.fill();
      g.restore();
      g.save();
      g.translate(p.x, p.y);
      g.rotate(p.a);
      g.drawImage(p.img, -s / 2, -s / 2, s, s);
      g.restore();
    }
    for (const l of w.floats) this.float(g, l, dimNight);
    g.globalAlpha = 1;
    // Snow settling.
    for (const k of w.flakes) {
      const f = clamp(k.age / k.life);
      const a = k.landed ? 0.7 * (1 - (k.age - k.life) / 0.6) : 0.15 + 0.55 * f;
      g.beginPath();
      g.arc(k.x, k.y, k.r * (1.6 - 0.9 * f), 0, TAU);
      g.fillStyle = `rgba(235,240,245,${clamp(a).toFixed(3)})`;
      g.fill();
    }
    // Rings on the water.
    g.lineWidth = 1.6 * u;
    for (const r of w.ripples) {
      const f = r.age / r.life;
      const rad = (6 + f * 70 * r.size) * u;
      const a = (1 - f) * (1 - f) * 0.45;
      g.strokeStyle = `rgba(210,230,235,${a.toFixed(3)})`;
      g.beginPath();
      g.arc(r.x, r.y, rad, 0, TAU);
      g.stroke();
      if (rad > 16 * u) {
        g.strokeStyle = `rgba(210,230,235,${(a * 0.55).toFixed(3)})`;
        g.beginPath();
        g.arc(r.x, r.y, rad * 0.62, 0, TAU);
        g.stroke();
      }
    }
    // Specks of light on the surface: sun by day, the sky by night.
    for (const s of w.glints) {
      const a = Math.max(0, Math.sin(t * s.sp + s.ph)) ** 6 * (0.25 + 0.3 * P.light) * (1 - P.grey * 0.6);
      if (a < 0.01) continue;
      g.fillStyle = `rgba(235,240,230,${a.toFixed(3)})`;
      g.fillRect(s.x, s.y, s.r * 2.2, s.r * 0.9);
    }
    // Fog over the water.
    const fog = this.sc.fog || 0;
    if (fog) {
      for (const f of w.fogs) {
        g.globalAlpha = 0.07 * fog;
        g.drawImage(w.blob, f.x - f.w / 2, f.y - f.h / 2, f.w, f.h);
      }
      g.globalAlpha = 1;
    }
  }

  /* A floating leaf or petal, turning slowly. */
  float(g, l, dim = 1) {
    const u = this.u;
    g.save();
    g.translate(l.x, l.y);
    g.rotate(l.a);
    g.globalAlpha = 0.85 * l.fade * dim;
    const s = l.size;
    // Its shadow.
    g.beginPath();
    g.ellipse(4 * u, 6 * u, s, s * (l.kind === 'petal' ? 0.6 : 0.42), 0, 0, TAU);
    g.fillStyle = 'rgba(0,0,0,0.25)';
    g.fill();
    g.beginPath();
    if (l.kind === 'petal') {
      g.moveTo(-s, 0);
      g.quadraticCurveTo(-s * 0.2, -s * 0.75, s * 0.85, -s * 0.18);
      g.lineTo(s * 0.6, 0);
      g.lineTo(s * 0.85, s * 0.18);
      g.quadraticCurveTo(-s * 0.2, s * 0.75, -s, 0);
    } else {
      g.moveTo(-s, 0);
      g.quadraticCurveTo(0, -s * 0.62, s, 0);
      g.quadraticCurveTo(0, s * 0.62, -s, 0);
    }
    g.fillStyle = l.col;
    g.fill();
    if (l.kind === 'leaf') {
      g.beginPath();
      g.moveTo(-s * 1.25, 0);
      g.lineTo(s * 0.9, 0);
      g.strokeStyle = 'rgba(0,0,0,0.25)';
      g.lineWidth = Math.max(1, s * 0.06);
      g.stroke();
    }
    g.restore();
  }

  /* One koi, from above: the body round the spine with its swim's wave, the
     patches on it, the fins and the tail fanning; or only its shadow on the
     bottom. Deeper is fainter and a little smaller. */
  koi(g, f, shadow, P) {
    const u = this.u;
    const scale = 1 - f.depth * 0.16;
    const amp = f.len * 0.055;
    const pts = [];
    const dirs = [];
    for (let i = 0; i < N; i++) {
      const p = f.pts[i];
      const a = f.pts[Math.max(0, i - 1)];
      const b = f.pts[Math.min(N - 1, i + 1)];
      let dx = a[0] - b[0];
      let dy = a[1] - b[1];
      const d = Math.hypot(dx, dy) || 1;
      dx /= d; dy /= d;
      const lat = Math.sin(f.phase - i * 0.7) * amp * Math.pow(i / (N - 1), 1.4);
      pts.push([p[0] - dy * lat, p[1] + dx * lat]);
      dirs.push([dx, dy]);
    }
    const hw = (i) => f.len * 0.12 * PROFILE[i] * scale;
    const L = pts.map((p, i) => [p[0] - dirs[i][1] * hw(i), p[1] + dirs[i][0] * hw(i)]);
    const Rr = pts.map((p, i) => [p[0] + dirs[i][1] * hw(i), p[1] - dirs[i][0] * hw(i)]);
    const head = [pts[0][0] + dirs[0][0] * hw(0) * 1.5, pts[0][1] + dirs[0][1] * hw(0) * 1.5];
    const body = () => {
      g.beginPath();
      g.moveTo(Rr[0][0], Rr[0][1]);
      g.quadraticCurveTo(head[0] + dirs[0][1] * hw(0) * 0.2, head[1] - dirs[0][0] * hw(0) * 0.2, head[0], head[1]);
      g.quadraticCurveTo(head[0] - dirs[0][1] * hw(0) * 0.2, head[1] + dirs[0][0] * hw(0) * 0.2, L[0][0], L[0][1]);
      smooth(g, L, false);
      smooth(g, Rr.slice().reverse(), false);
      g.closePath();
    };
    const tb = pts[N - 1];
    const td = dirs[N - 1];
    const tn = [-td[1], td[0]];
    const sway = Math.sin(f.phase - N * 0.7) * 0.45;
    const tl = f.len * 0.24 * scale;
    const tw = f.len * 0.14 * scale;
    const tail = () => {
      const tip1 = [tb[0] - td[0] * tl + tn[0] * tw * (1 + sway), tb[1] - td[1] * tl + tn[1] * tw * (1 + sway)];
      const tip2 = [tb[0] - td[0] * tl - tn[0] * tw * (1 - sway), tb[1] - td[1] * tl - tn[1] * tw * (1 - sway)];
      const notch = [tb[0] - td[0] * tl * 0.55 + tn[0] * tw * sway * 0.4, tb[1] - td[1] * tl * 0.55 + tn[1] * tw * sway * 0.4];
      g.beginPath();
      g.moveTo(tb[0], tb[1]);
      g.quadraticCurveTo(tb[0] - td[0] * tl * 0.3 + tn[0] * tw * 0.9, tb[1] - td[1] * tl * 0.3 + tn[1] * tw * 0.9,
        tip1[0], tip1[1]);
      g.quadraticCurveTo(notch[0] + tn[0] * tw * 0.2, notch[1] + tn[1] * tw * 0.2, notch[0], notch[1]);
      g.quadraticCurveTo(notch[0] - tn[0] * tw * 0.2, notch[1] - tn[1] * tw * 0.2, tip2[0], tip2[1]);
      g.quadraticCurveTo(tb[0] - td[0] * tl * 0.3 - tn[0] * tw * 0.9, tb[1] - td[1] * tl * 0.3 - tn[1] * tw * 0.9,
        tb[0], tb[1]);
    };
    if (shadow) {
      const off = (10 + 26 * (1 - f.depth)) * u;
      g.save();
      g.translate(off * 0.7, off);
      g.globalAlpha = (0.16 + 0.14 * P.light) * (1 - f.depth * 0.5);
      g.fillStyle = '#000';
      body();
      g.fill();
      tail();
      g.fill();
      g.restore();
      g.globalAlpha = 1;
      return;
    }
    const alpha = (0.95 - f.depth * 0.5) * (0.8 + 0.2 * P.light);
    // Pectoral fins, slowly paddling, under the body's edge.
    g.globalAlpha = alpha * 0.5;
    g.fillStyle = f.kind.fin;
    const ang0 = Math.atan2(dirs[1][1], dirs[1][0]);
    for (const side of [-1, 1]) {
      const c = [pts[2][0] - dirs[2][1] * hw(2) * side * 1.05 - dirs[2][0] * f.len * 0.02,
        pts[2][1] + dirs[2][0] * hw(2) * side * 1.05 - dirs[2][1] * f.len * 0.02];
      g.beginPath();
      g.ellipse(c[0], c[1], f.len * 0.085 * scale, f.len * 0.04 * scale,
        ang0 + side * (2.25 + 0.3 * Math.sin(f.phase * 0.55 + side)), 0, TAU);
      g.fill();
    }
    // The tail, see-through.
    g.globalAlpha = alpha * 0.55;
    tail();
    g.fill();
    // The body and its patches.
    g.globalAlpha = alpha;
    body();
    g.fillStyle = f.kind.body;
    g.fill();
    g.save();
    body();
    g.clip();
    for (const s of f.spots) {
      const i0 = Math.min(N - 2, Math.floor(s.at));
      const fr = s.at - i0;
      const px = pts[i0][0] + (pts[i0 + 1][0] - pts[i0][0]) * fr;
      const py = pts[i0][1] + (pts[i0 + 1][1] - pts[i0][1]) * fr;
      const d = dirs[i0];
      const w0 = hw(i0);
      g.beginPath();
      g.ellipse(px - d[1] * w0 * s.side, py + d[0] * w0 * s.side, w0 * s.r * s.s, w0 * s.r,
        Math.atan2(d[1], d[0]), 0, TAU);
      g.fillStyle = s.c;
      g.fill();
    }
    // Light along the back, shade along the sides: a round body.
    g.lineCap = 'round';
    g.lineWidth = hw(2) * 0.7;
    g.strokeStyle = 'rgba(255,255,255,0.09)';
    g.beginPath();
    smooth(g, pts.slice(0, 8));
    g.stroke();
    g.lineWidth = hw(2) * 0.5;
    g.strokeStyle = 'rgba(0,0,0,0.16)';
    for (const side of [-1, 1]) {
      g.beginPath();
      smooth(g, pts.slice(0, 9).map((p, i) => [p[0] - dirs[i][1] * hw(i) * side, p[1] + dirs[i][0] * hw(i) * side]));
      g.stroke();
    }
    g.restore();
    // The eyes.
    g.fillStyle = 'rgba(10,10,10,0.55)';
    for (const side of [-1, 1]) {
      g.beginPath();
      g.arc(pts[0][0] + dirs[0][0] * hw(0) * 0.6 - dirs[0][1] * hw(0) * 0.62 * side,
        pts[0][1] + dirs[0][1] * hw(0) * 0.6 + dirs[0][0] * hw(0) * 0.62 * side, Math.max(1, hw(0) * 0.12), 0, TAU);
      g.fill();
    }
    g.globalAlpha = 1;
  }
}
