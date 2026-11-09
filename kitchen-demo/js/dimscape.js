/* Look 4 of the dim clock: a living landscape (night.js; Alex, 2026-11-05:
   "another visual rich animative dimming theme, which collaborates with the
   weather events. No need to have a background image but rich illustration
   animations").

   Everything is drawn here, live, on one canvas behind the clock: a lake in
   a valley of spruce forest under layered hills, a red cottage on the near
   shore. What is in it is the hour outside (wxart.js scene(): the sky, what
   falls and how hard, the wind, fog, a thunderstorm) and the time of day by
   the forecast's own sunrise and sunset:

   - the sky from night through dawn and day to dusk, darkened for a kitchen
     at night, grey under overcast, near black in a storm; the sun on its arc,
     the moon on hers (left out while the dim clock shows the real one), stars
     that twinkle and now and then a shooting star, the northern lights when
     the Aurora alert says they are possible;
   - clouds drifting with the wind, few to a full sky; fog in bands over the
     water; lightning from the storm's clouds, brightening where it strikes;
   - rain slanting with the wind and ringing the lake, snow drifting down,
     lying on the ground and the trees when there is snow, ice on the lake in
     hard frost; drizzle, sleet;
   - the forest swaying as hard as the wind blows, reeds in the foreground,
     the cottage's window lit from dusk, smoke from its chimney when it is
     cold, carried off by the wind; birds crossing on a calm day, fireflies on
     a warm summer night, leaves blowing past in an autumn wind.

   Laid out from a seed of the day, so the forest and the hills are a little
   different every day and the same all day. The still part (sky, hills, far
   forest, the water's ground, the cottage) is drawn once into a picture of its
   own and only made again when the light has moved on (every five minutes) or
   the weather changes; each frame is that picture and what moves. The
   Movement setting (wx_motion) is its pace: Still draws one frame. */

const TAU = Math.PI * 2;
const SPEEDS = [0, 0.25, 0.55, 1];

/* ----------------------------------------------------------- colours ---- */

const hex = (s) => [parseInt(s.slice(1, 3), 16), parseInt(s.slice(3, 5), 16), parseInt(s.slice(5, 7), 16)];
const mix = (a, b, t) => a.map((v, i) => v + (b[i] - v) * t);
const mul = (a, k) => a.map((v) => v * k);
const css = (c, a = 1) => `rgba(${Math.round(c[0])},${Math.round(c[1])},${Math.round(c[2])},${a})`;
const clamp = (v, lo = 0, hi = 1) => Math.max(lo, Math.min(hi, v));

const SKY = {
  night: [hex('#081328'), hex('#24406a')],
  dawn: [hex('#24305e'), hex('#d4834c')],
  day: [hex('#3f72a6'), hex('#a7c6dc')],
};
const GREY = [hex('#2a2f38'), hex('#5c6470')];
const STORM = [hex('#101318'), hex('#2b3038')];

/* A seeded random: the same landscape all day, another tomorrow. */
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

/* Where the sun is: light 0 (night) to 1 (day), glow 0..1 near sunrise and
   sunset, the sun's place along its arc (0..1) by day and the moon's by
   night. `rise`/`set` in ms; without them, 07:00 and 17:00. */
export function sunAt(now, rise, set) {
  const d = new Date(now);
  const day0 = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const r = Number.isFinite(rise) ? rise : day0 + 7 * 3600e3;
  const s = Number.isFinite(set) && set > r ? set : day0 + 17 * 3600e3;
  const TW = 45 * 60e3;
  let light;
  if (now <= r - TW || now >= s + TW) light = 0;
  else if (now < r + TW) light = (now - (r - TW)) / (2 * TW);
  else if (now > s - TW) light = ((s + TW) - now) / (2 * TW);
  else light = 1;
  const edge = Math.min(Math.abs(now - r), Math.abs(now - s));
  const glow = clamp(1 - edge / (70 * 60e3));
  const arc = clamp((now - r) / (s - r));
  // The night's own arc, sunset to the next sunrise.
  const nightLen = 24 * 3600e3 - (s - r);
  const since = now >= s ? now - s : now + 24 * 3600e3 - s;
  const moonArc = clamp(since / nightLen);
  return { light: clamp(light), glow: light > 0 && light < 1 ? Math.max(glow, 0.4) : glow * 0.5,
    arc, moonArc, up: now > r && now < s };
}

/* -------------------------------------------------------------- scene ---- */

export class Scape {
  constructor(host) {
    this.host = host;
    this.cv = document.createElement('canvas');
    this.cv.className = 'nt-scape';
    this.cv.setAttribute('aria-hidden', 'true');
    host.prepend(this.cv);
    this.g = this.cv.getContext('2d');
    this.bg = document.createElement('canvas');
    this.running = false;
    this.key = '';
    this.bgKey = '';
    this.speed = SPEEDS[1];
    this.t = 0;
    this.last = 0;
    this.frame = (ts) => this.loop(ts);
    this.ro = new ResizeObserver(() => { if (this.running && this.fit()) this.redraw(); });
    this.ro.observe(host);
  }

  /* sc: wxart.js's scene of the hour (null: a clear sky). env: {now, rise,
     set, temp, snow (m lying), moon (draw ours), aurora, seed}. */
  set(sc, env, motion) {
    this.sc = sc || { sky: 'clear', night: false, fall: null, wind: 0, fog: 0, storm: false };
    this.env = env;
    const speed = SPEEDS[motion] ?? SPEEDS[1];
    const key = JSON.stringify([this.sc, env.temp != null ? Math.round(env.temp) : null, env.snow > 0.01,
      env.moon, env.aurora, env.seed]);
    const changed = key !== this.key;
    this.key = key;
    if (changed) this.layout = null;
    if (speed !== this.speed || changed) {
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
    const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
    const W = Math.max(1, Math.round(r.width * dpr));
    const H = Math.max(1, Math.round(r.height * dpr));
    if (W === this.W && H === this.H) return false;
    this.cv.width = this.bg.width = this.W = W;
    this.cv.height = this.bg.height = this.H = H;
    this.u = Math.min(W / 1920, H / 1080);
    this.layout = null;
    return true;
  }

  redraw() {
    cancelAnimationFrame(this.raf);
    this.raf = 0;
    this.last = 0;
    this.draw(performance.now());
    if (this.speed > 0) this.raf = requestAnimationFrame(this.frame);
  }

  loop(ts) {
    if (!this.running || !(this.speed > 0)) return;
    this.raf = requestAnimationFrame(this.frame);
    if (this.last && ts - this.last < 1000 / 30 - 2) return;        // thirty a second
    const dt = this.last ? Math.min(0.1, (ts - this.last) / 1000) : 0;
    this.last = ts;
    this.step(dt * this.speed);
    this.draw(ts);
  }

  /* ---------------------------------------------------------- the world -- */

  /* Where everything stands, from the day's seed: made again with a new
     weather, a new day or another size. */
  build() {
    const { W, H, u } = this;
    const env = this.env;
    const sc = this.sc;
    const R = rng(env.seed || 1);
    const d = new Date(env.now);
    const month = d.getMonth();
    const snowy = env.snow > 0.01 || (sc.fall && ['snow', 'grains'].includes(sc.fall.kind) && (env.temp ?? 0) <= 1);
    const icy = (env.temp ?? 5) <= -6 || (env.snow > 0.15 && month <= 2) || (snowy && (env.temp ?? 5) <= -3);
    const L = {
      horizon: H * 0.6,
      lakeTop: H * 0.63,
      lakeBottom: H * 0.86,
      snowy, icy,
      autumn: month >= 8 && month <= 10,
      summer: month >= 5 && month <= 7,
      ridges: [], far: [], near: [], reeds: [], stars: [], clouds: [], drops: [], ripples: [],
      smoke: [], fogs: [], birds: null, flies: [], leaves: [], bolt: null, shooting: null,
    };
    // Three ridges of hills, far to near.
    for (let k = 0; k < 3; k++) {
      const pts = [];
      const base = H * (0.47 + k * 0.045);
      const amp = H * (0.07 - k * 0.012);
      const f1 = 1.5 + R() * 2, f2 = 4 + R() * 4, p1 = R() * TAU, p2 = R() * TAU;
      for (let x = 0; x <= W; x += 16 * u) {
        const s = x / W;
        pts.push([x, base - amp * (0.55 + 0.3 * Math.sin(s * f1 * TAU + p1) + 0.15 * Math.sin(s * f2 * TAU + p2))]);
      }
      L.ridges.push(pts);
    }
    // The far forest along the far shore: small spruces, still.
    for (let x = -10 * u; x < W + 10 * u; x += (7 + R() * 9) * u) {
      L.far.push({ x, h: (26 + R() * 34) * u, w: (9 + R() * 6) * u, birch: L.autumn && R() < 0.12 });
    }
    // The near forest on both sides of the cottage, swaying.
    const nearSpots = [];
    for (let x = -20 * u; x < W * 0.26; x += (34 + R() * 40) * u) nearSpots.push(x);
    for (let x = W * 0.78; x < W + 20 * u; x += (34 + R() * 40) * u) nearSpots.push(x);
    for (const x of nearSpots) {
      L.near.push({ x, h: (150 + R() * 140) * u, w: (46 + R() * 30) * u, ph: R() * TAU,
        birch: (L.autumn || L.summer) && R() < 0.18 });
    }
    // Reeds along the near shore.
    for (let x = W * 0.28; x < W * 0.62; x += (5 + R() * 9) * u) {
      if (R() < 0.55) L.reeds.push({ x, h: (16 + R() * 34) * u, ph: R() * TAU });
    }
    // Stars, over the sky.
    for (let i = 0; i < 240; i++) {
      L.stars.push({ x: R() * W, y: R() * L.horizon * 0.95, r: (0.9 + R() * R() * 2.2) * u,
        tw: R() < 0.35, ph: R() * TAU, sp: 0.6 + R() * 2.4 });
    }
    // Clouds: how many by the sky.
    const nCloud = { clear: 0, few: 3, partly: 6, overcast: 11, storm: 12, none: 2 }[sc.sky] ?? 3;
    for (let i = 0; i < nCloud; i++) L.clouds.push(this.newCloud(R, true));
    // Fog bands over the water.
    for (let i = 0; i < (sc.fog || 0) * 3; i++) {
      L.fogs.push({ x: R() * W, y: L.lakeTop - 20 * u + R() * (L.lakeBottom - L.lakeTop) * 0.7,
        w: (500 + R() * 600) * u, h: (40 + R() * 50) * u, v: (6 + R() * 10) * u });
    }
    // The cottage: on the near shore, right of the middle, clear of the clock.
    L.cottage = { x: W * 0.69, y: L.lakeBottom + 6 * u, w: 120 * u, h: 72 * u };
    this.R = R;
    this.layout = L;
    this.bgKey = '';
  }

  newCloud(R, anywhere = false) {
    const { W, u } = this;
    const L = this.layout || { horizon: this.H * 0.6 };
    const w = (220 + R() * 360) * u;
    return { x: anywhere ? R() * (W + w) - w / 2 : -w * 0.7, y: (30 + R() * (L.horizon * 0.55)) ,
      w, h: w * (0.28 + R() * 0.12), seed: Math.floor(R() * 1e9), v: (4 + R() * 8) * u, a: 0.55 + R() * 0.35 };
  }

  /* The palette of now: sky top and horizon, how light, the land's colours. */
  palette() {
    const env = this.env;
    const sc = this.sc;
    const sun = sunAt(env.now, env.rise, env.set);
    let [top, low] = sun.light <= 0.5
      ? [mix(SKY.night[0], SKY.dawn[0], sun.light * 2), mix(SKY.night[1], SKY.dawn[1], sun.light * 2 * sun.glow)]
      : [mix(SKY.dawn[0], SKY.day[0], (sun.light - 0.5) * 2), mix(mix(SKY.dawn[1], SKY.day[1], (sun.light - 0.5) * 2),
        SKY.dawn[1], sun.glow * 0.6)];
    const grey = { overcast: 0.75, storm: 0.95, none: 0.6, partly: 0.25, few: 0.1, clear: 0 }[sc.sky] ?? 0;
    const g = sc.storm ? STORM : GREY;
    top = mix(top, mul(g[0], 0.4 + sun.light * 0.8), grey);
    low = mix(low, mul(g[1], 0.35 + sun.light * 0.75), grey);
    // A kitchen at night: the whole picture a little darker than the world.
    const dim = 0.78 + sun.light * 0.1;
    top = mul(top, dim);
    low = mul(low, dim);
    const land = mix(hex('#0b1320'), hex('#2a3a30'), sun.light * 0.85 * (1 - grey * 0.4));
    return { sun, top, low, grey, land, light: sun.light };
  }

  /* The picture that does not move: sky, hills, far forest, the water's
     ground, the near shore and the cottage. */
  paintBg(P) {
    const { W, H, u } = this;
    const L = this.layout;
    const b = this.bg.getContext('2d');
    b.setTransform(1, 0, 0, 1, 0, 0);
    const sky = b.createLinearGradient(0, 0, 0, L.horizon);
    sky.addColorStop(0, css(P.top));
    sky.addColorStop(1, css(P.low));
    b.fillStyle = sky;
    b.fillRect(0, 0, W, L.lakeTop + 2);
    // The hills: far ones paler with the air, near ones darker.
    // Each ridge darker and nearer, the farthest almost the sky's own haze.
    L.ridges.forEach((pts, k) => {
      const c = mix(mix(P.low, P.top, 0.25), P.land, [0.32, 0.6, 0.84][k]);
      b.fillStyle = css(L.snowy && k === 0 ? mix(c, [200, 210, 225], 0.25 * (0.4 + P.light)) : c);
      b.beginPath();
      b.moveTo(0, H);
      for (const [x, y] of pts) b.lineTo(x, y);
      b.lineTo(W, H);
      b.closePath();
      b.fill();
    });
    // The far shore's forest.
    const farC = mix(P.land, P.low, 0.18);
    for (const t of L.far) {
      b.fillStyle = css(t.birch ? mix(farC, [150, 95, 40], 0.35 * (0.3 + P.light)) : farC);
      this.spruce(b, t.x, L.lakeTop + 2 * u, t.w, t.h, 0, L.snowy ? P : null);
    }
    // The water: the sky upside down, darker, with the far shore mirrored.
    const lake = b.createLinearGradient(0, L.lakeTop, 0, L.lakeBottom);
    const ice = L.icy ? [150, 165, 185] : null;
    lake.addColorStop(0, css(ice ? mul(ice, 0.35 + P.light * 0.4) : mul(P.low, 0.75)));
    lake.addColorStop(1, css(ice ? mul(ice, 0.2 + P.light * 0.3) : mul(P.top, 0.7)));
    b.fillStyle = lake;
    b.fillRect(0, L.lakeTop, W, L.lakeBottom - L.lakeTop);
    if (!L.icy) {
      b.save();
      b.globalAlpha = 0.35;
      b.translate(0, L.lakeTop * 2 + 4 * u);
      b.scale(1, -0.55);
      b.fillStyle = css(mul(farC, 0.8));
      for (const t of L.far) this.spruce(b, t.x, L.lakeTop * 0.98, t.w, t.h, 0, null);
      b.restore();
    }
    // The near shore.
    const shore = mix(P.land, [0, 0, 0], 0.35);
    b.fillStyle = css(L.snowy ? mix(shore, [205, 214, 228], 0.32 + P.light * 0.3) : shore);
    b.beginPath();
    b.moveTo(0, H);
    b.lineTo(0, L.lakeBottom - 30 * u);
    b.bezierCurveTo(W * 0.2, L.lakeBottom + 10 * u, W * 0.45, L.lakeBottom - 6 * u, W * 0.6, L.lakeBottom + 4 * u);
    b.bezierCurveTo(W * 0.75, L.lakeBottom + 12 * u, W * 0.9, L.lakeBottom - 22 * u, W, L.lakeBottom - 40 * u);
    b.lineTo(W, H);
    b.closePath();
    b.fill();
    this.cottage(b, P);
  }

  spruce(g, x, y, w, h, lean, snowP) {
    // A spruce in tiers; `lean` bends the top with the wind.
    const tiers = 4;
    g.beginPath();
    for (let i = 0; i < tiers; i++) {
      const t0 = i / tiers;
      const yy = y - h * t0 * 0.92;
      const ww = w * (1 - t0 * 0.78) / 2;
      const top = y - h * (t0 + 0.42) * 0.92;
      const lx = lean * (t0 + 0.42) * (t0 + 0.42);
      g.moveTo(x - ww + lean * t0 * t0, yy);
      g.lineTo(x + lx, Math.max(top, y - h));
      g.lineTo(x + ww + lean * t0 * t0, yy);
    }
    g.fill();
    if (snowP) {
      const f = g.fillStyle;
      g.fillStyle = css([210, 220, 235], 0.25 + snowP.light * 0.35);
      for (let i = 0; i < tiers; i++) {
        const t0 = i / tiers;
        const yy = y - h * t0 * 0.92 - h * 0.05;
        const ww = w * (1 - t0 * 0.78) / 2;
        g.fillRect(x - ww * 0.5 + lean * t0 * t0, yy - 2, ww, 3);
      }
      g.fillStyle = f;
    }
  }

  cottage(b, P) {
    const { u } = this;
    const c = this.layout.cottage;
    const red = mul(hex('#7a2a20'), 0.35 + P.light * 0.55);
    b.fillStyle = css(red);
    b.fillRect(c.x - c.w / 2, c.y - c.h, c.w, c.h);
    // White corners and the roof.
    b.fillStyle = css(mul([200, 195, 185], 0.3 + P.light * 0.5));
    b.fillRect(c.x - c.w / 2, c.y - c.h, 4 * u, c.h);
    b.fillRect(c.x + c.w / 2 - 4 * u, c.y - c.h, 4 * u, c.h);
    b.fillStyle = css(this.layout.snowy ? mix(mul([40, 40, 45], 1), [210, 220, 235], 0.4 + P.light * 0.3) : [22, 22, 26]);
    b.beginPath();
    b.moveTo(c.x - c.w / 2 - 10 * u, c.y - c.h);
    b.lineTo(c.x, c.y - c.h - 48 * u);
    b.lineTo(c.x + c.w / 2 + 10 * u, c.y - c.h);
    b.closePath();
    b.fill();
    b.fillStyle = css([24, 22, 22]);
    b.fillRect(c.x + c.w * 0.22, c.y - c.h - 42 * u, 11 * u, 24 * u);     // the chimney
    b.fillRect(c.x - 11 * u, c.y - 34 * u, 22 * u, 34 * u);                // the door
  }

  /* ------------------------------------------------------------- moving -- */

  step(dt) {
    if (!dt || !this.layout) return;
    const { W, H, u } = this;
    const L = this.layout;
    const sc = this.sc;
    const R = this.R;
    this.t += dt;
    const wind = sc.wind || 0;
    const push = [0.4, 1, 2.2, 3.8][wind];
    for (const c of L.clouds) {
      c.x += c.v * push * dt;
      if (c.x - c.w / 2 > W + 30 * u) Object.assign(c, this.newCloud(R), { slot: '' });
    }
    for (const f of L.fogs) {
      f.x += f.v * dt;
      if (f.x - f.w / 2 > W) f.x = -f.w / 2;
    }
    // What falls.
    const fall = sc.fall;
    if (fall) {
      const snow = ['snow', 'grains'].includes(fall.kind);
      const want = (snow ? [0, 140, 300, 520] : fall.kind === 'drizzle' ? [0, 160, 260, 360] : [0, 220, 420, 700])[fall.level]
        * (fall.kind === 'sleet' ? 0.8 : 1);
      while (L.drops.length < want) L.drops.push(this.newDrop(true));
      if (L.drops.length > want) L.drops.length = want;
      const slant = [0.05, 0.15, 0.3, 0.5][wind];
      for (const d of L.drops) {
        if (d.snow) {
          d.y += d.v * dt;
          d.x += (Math.sin(this.t * d.f + d.ph) * 18 + wind * 40) * u * dt;
        } else {
          d.y += d.v * dt;
          d.x += d.v * slant * dt;
        }
        if (d.y > d.end) {
          if (!d.snow && !L.icy && d.end < L.lakeBottom && d.end > L.lakeTop && L.ripples.length < 90) {
            L.ripples.push({ x: d.x, y: d.end, r: 1, max: (6 + R() * 10) * u * (fall.level / 2 + 0.5) });
          }
          Object.assign(d, this.newDrop(false));
        }
        if (d.x > W + 20) d.x -= W + 40;
        if (d.x < -20) d.x += W + 40;
      }
    } else L.drops.length = 0;
    for (const r of L.ripples) r.r += 16 * u * dt;
    L.ripples = L.ripples.filter((r) => r.r < r.max);
    // Smoke from the chimney when it is cold, carried by the wind.
    const cold = (this.env.temp ?? 10) < 12;
    if (cold && L.smoke.length < 26 && R() < dt * 4) {
      const c = L.cottage;
      L.smoke.push({ x: c.x + c.w * 0.22 + 5 * u, y: c.y - c.h - 44 * u, r: 6 * u, a: 0.3, life: 0 });
    }
    for (const s of L.smoke) {
      s.life += dt;
      s.y -= (18 - wind * 3) * u * dt;
      s.x += (6 + wind * 26) * u * dt;
      s.r += 5 * u * dt;
      s.a = Math.max(0, 0.3 - s.life * 0.045);
    }
    L.smoke = L.smoke.filter((s) => s.a > 0);
    // Birds on a calm, dry day; fireflies on a warm summer night; leaves in an autumn wind.
    const P = this.P;
    if (P && P.light > 0.6 && !fall && wind <= 1 && !sc.storm) {
      if (!L.birds && R() < dt / 25) {
        const n = 3 + Math.floor(R() * 5);
        L.birds = { x: -60 * u, y: H * (0.12 + R() * 0.25), v: (60 + R() * 40) * u,
          b: Array.from({ length: n }, (_, i) => ({ dx: -i * 26 * u, dy: (i % 2 ? 1 : -1) * Math.ceil(i / 2) * 14 * u, ph: R() * TAU })) };
      }
    }
    if (L.birds) {
      L.birds.x += L.birds.v * dt;
      if (L.birds.x > W + 200 * u) L.birds = null;
    }
    if (P && P.light < 0.2 && L.summer && !fall && (this.env.temp ?? 0) > 12) {
      while (L.flies.length < 26) L.flies.push({ x: W * (0.2 + R() * 0.6), y: L.lakeBottom - R() * 80 * u, ph: R() * TAU, s: 0.5 + R() });
    } else L.flies.length = 0;
    if (L.autumn && wind >= 2 && !snowFall(sc)) {
      while (L.leaves.length < 10 + wind * 6) L.leaves.push(this.newLeaf(true));
      for (const l of L.leaves) {
        l.x += (90 + wind * 70) * u * dt;
        l.y += (20 + Math.sin(this.t * 2 + l.ph) * 40) * u * dt;
        l.rot += l.spin * dt;
        if (l.x > W + 20 || l.y > H) Object.assign(l, this.newLeaf(false));
      }
    } else L.leaves.length = 0;
    // A shooting star, now and then, on a clear night.
    if (P && P.light < 0.1 && ['clear', 'few'].includes(sc.sky) && !L.shooting && R() < dt / 40) {
      L.shooting = { x: W * (0.1 + R() * 0.7), y: H * (0.05 + R() * 0.2), vx: (500 + R() * 300) * u, vy: (160 + R() * 120) * u, life: 0 };
    }
    if (L.shooting) {
      const s = L.shooting;
      s.life += dt;
      s.x += s.vx * dt;
      s.y += s.vy * dt;
      if (s.life > 0.9) L.shooting = null;
    }
    // Lightning in a storm, from the clouds, every few seconds.
    if (sc.storm) {
      if (!L.bolt && R() < dt / 6) L.bolt = this.newBolt(R);
      if (L.bolt) {
        L.bolt.life += dt;
        if (L.bolt.life > 0.6) L.bolt = null;
      }
    }
  }

  newDrop(anywhere) {
    const { W, H, u } = this;
    const R = this.R;
    const L = this.layout;
    const fall = this.sc.fall;
    const snow = ['snow', 'grains'].includes(fall.kind) || (fall.kind === 'sleet' && R() < 0.5);
    const end = L.lakeTop + R() * (H - L.lakeTop);
    return { x: R() * W, y: anywhere ? R() * end : -R() * 60 * u, end, snow,
      v: (snow ? 45 + R() * 50 : fall.kind === 'drizzle' ? 380 + R() * 160 : 700 + R() * 400) * u,
      len: (fall.kind === 'drizzle' ? 6 : 12 + fall.level * 7) * u * (0.7 + R() * 0.6),
      r: (snow ? (1.2 + R() * 2.4) * (fall.kind === 'grains' ? 0.6 : 1) : 0) * u,
      f: 0.5 + R(), ph: R() * TAU };
  }

  newLeaf(anywhere) {
    const { W, H, u } = this;
    const R = this.R;
    return { x: anywhere ? R() * W : -20 * u, y: R() * H * 0.8, ph: R() * TAU, rot: R() * TAU,
      spin: (R() - 0.5) * 8, c: [hex('#b5651d'), hex('#c9952c'), hex('#8c3b1e')][Math.floor(R() * 3)] };
  }

  newBolt(R) {
    const { W, H, u } = this;
    const x0 = W * (R() < 0.5 ? 0.08 + R() * 0.2 : 0.72 + R() * 0.2);
    const pts = [[x0, H * 0.08]];
    let x = x0, y = H * 0.08;
    const end = this.layout.horizon - 20 * u;
    while (y < end) {
      y += (30 + R() * 50) * u;
      x += (R() - 0.5) * 70 * u;
      pts.push([x, Math.min(y, end)]);
    }
    return { pts, life: 0 };
  }

  /* -------------------------------------------------------------- frame -- */

  draw() {
    if (!this.W) this.fit();
    if (!this.layout) this.build();
    const { W, H, u } = this;
    const L = this.layout;
    const sc = this.sc;
    const env = this.env;
    // The light moves on every five minutes: the still picture with it.
    const P = this.palette();
    this.P = P;
    const bgKey = `${Math.floor(env.now / 300e3)}:${this.key}:${W}x${H}`;
    if (bgKey !== this.bgKey) {
      this.paintBg(P);
      this.bgKey = bgKey;
    }
    const g = this.g;
    const t = this.t;
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.globalAlpha = 1;
    g.globalCompositeOperation = 'source-over';
    g.drawImage(this.bg, 0, 0);

    // Stars and the shooting one: on a night that shows them.
    const starry = { clear: 1, few: 0.8, partly: 0.45, overcast: 0, storm: 0, none: 0.15 }[sc.sky] ?? 0;
    const starA = starry * clamp(1 - P.light * 2.2);
    if (starA > 0.02) {
      for (const s of L.stars) {
        const a = starA * (s.tw ? 0.45 + 0.55 * (0.5 + 0.5 * Math.sin(t * s.sp + s.ph)) : 0.75);
        g.fillStyle = `rgba(232,226,210,${a})`;
        g.fillRect(s.x, s.y, s.r, s.r);
      }
      if (L.shooting) {
        const s = L.shooting;
        const a = Math.sin(Math.PI * s.life / 0.9) * starA;
        const tail = g.createLinearGradient(s.x, s.y, s.x - s.vx * 0.12, s.y - s.vy * 0.12);
        tail.addColorStop(0, `rgba(255,245,225,${a})`);
        tail.addColorStop(1, 'rgba(255,245,225,0)');
        g.strokeStyle = tail;
        g.lineWidth = 2 * u;
        g.beginPath();
        g.moveTo(s.x, s.y);
        g.lineTo(s.x - s.vx * 0.12, s.y - s.vy * 0.12);
        g.stroke();
      }
    }
    // The northern lights: curtains, slowly moving, on a dark clear-ish night.
    if (env.aurora && P.light < 0.15 && starry >= 0.45) this.aurora(g, t, starA);
    // The sun, or the moon.
    this.lights(g, P, t);
    // Clouds.
    for (const c of L.clouds) this.cloud(g, c, P);
    // The lightning, and its light on the clouds round it.
    if (L.bolt) this.bolt(g, L.bolt);
    // The water: shimmer, the moon's or the sun's road, rings of rain.
    this.water(g, P, t);
    // Fog over the water.
    for (const f of L.fogs) {
      const gr = g.createRadialGradient(f.x, f.y, 0, f.x, f.y, f.w / 2);
      const c = mix(P.low, [200, 205, 210], 0.3);
      gr.addColorStop(0, css(c, 0.16 + 0.06 * sc.fog));
      gr.addColorStop(1, css(c, 0));
      g.save();
      g.translate(f.x, f.y);
      g.scale(1, f.h / f.w);
      g.translate(-f.x, -f.y);
      g.fillStyle = gr;
      g.fillRect(f.x - f.w / 2, f.y - f.w / 2, f.w, f.w);
      g.restore();
    }
    // The cottage's window and its smoke.
    this.home(g, P, t);
    // The near forest, swaying with the wind.
    const sway = [1.5, 5, 11, 19][sc.wind || 0] * u;
    const nearC = mix(P.land, [0, 0, 0], 0.55);
    for (const tr of L.near) {
      const lean = Math.sin(t * (0.6 + (sc.wind || 0) * 0.35) + tr.ph) * sway + (sc.wind || 0) * 3 * u;
      g.fillStyle = css(tr.birch && L.autumn ? mix(nearC, [140, 80, 30], 0.3 * (0.3 + P.light)) : nearC);
      this.spruce(g, tr.x, H + 6 * u, tr.w, tr.h, lean, L.snowy ? P : null);
    }
    // Reeds.
    g.strokeStyle = css(mix(nearC, L.snowy ? [180, 185, 195] : [90, 80, 50], 0.25 + P.light * 0.2));
    g.lineWidth = 1.6 * u;
    g.beginPath();
    for (const r of L.reeds) {
      const bend = Math.sin(t * (1 + (sc.wind || 0) * 0.5) + r.ph) * (2 + (sc.wind || 0) * 4) * u;
      const y0 = L.lakeBottom + 8 * u;
      g.moveTo(r.x, y0);
      g.quadraticCurveTo(r.x + bend * 0.3, y0 - r.h * 0.6, r.x + bend, y0 - r.h);
    }
    g.stroke();
    // Fireflies, birds, leaves.
    for (const f of L.flies) {
      const a = 0.25 + 0.75 * Math.max(0, Math.sin(t * 1.7 * f.s + f.ph));
      const x = f.x + Math.sin(t * 0.4 * f.s + f.ph) * 30 * u;
      const y = f.y + Math.cos(t * 0.5 * f.s + f.ph) * 14 * u;
      const gr = g.createRadialGradient(x, y, 0, x, y, 6 * u);
      gr.addColorStop(0, `rgba(230,240,120,${a * 0.9})`);
      gr.addColorStop(1, 'rgba(230,240,120,0)');
      g.fillStyle = gr;
      g.fillRect(x - 6 * u, y - 6 * u, 12 * u, 12 * u);
    }
    if (L.birds) {
      g.strokeStyle = css(mul(P.land, 0.7), 0.8);
      g.lineWidth = 2 * u;
      for (const b of L.birds.b) {
        const x = L.birds.x + b.dx;
        const y = L.birds.y + b.dy + Math.sin(t * 2 + b.ph) * 3 * u;
        const flap = Math.sin(t * 9 + b.ph) * 5 * u;
        g.beginPath();
        g.moveTo(x - 9 * u, y - flap);
        g.quadraticCurveTo(x - 4 * u, y - 3 * u, x, y);
        g.quadraticCurveTo(x + 4 * u, y - 3 * u, x + 9 * u, y - flap);
        g.stroke();
      }
    }
    for (const l of L.leaves) {
      g.save();
      g.translate(l.x, l.y);
      g.rotate(l.rot);
      g.fillStyle = css(mul(l.c, 0.45 + P.light * 0.45));
      g.beginPath();
      g.ellipse(0, 0, 6 * u, 3 * u, 0, 0, TAU);
      g.fill();
      g.restore();
    }
    // What falls, over everything.
    this.falling(g, P);
    // A soft dark pool behind the clock and the forecast, so they read.
    const pool = g.createRadialGradient(W / 2, H * 0.44, 0, W / 2, H * 0.44, W * 0.42);
    pool.addColorStop(0, 'rgba(0,0,0,0.38)');
    pool.addColorStop(0.6, 'rgba(0,0,0,0.18)');
    pool.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = pool;
    g.fillRect(0, 0, W, H);
  }

  lights(g, P, t) {
    const { W, u } = this;
    const L = this.layout;
    const sc = this.sc;
    const cover = { clear: 0, few: 0.15, partly: 0.4, overcast: 0.85, storm: 1, none: 0.7 }[sc.sky] ?? 0;
    if (P.sun.up && P.light > 0) {
      const x = W * (0.1 + 0.8 * P.sun.arc);
      const y = L.horizon - Math.sin(Math.PI * P.sun.arc) * L.horizon * 0.62 + 10 * u;
      const a = (1 - cover) * P.light;
      if (a > 0.02) {
        const warm = P.sun.glow;
        const c = mix([255, 236, 190], [255, 160, 90], warm);
        const glow = g.createRadialGradient(x, y, 0, x, y, 170 * u);
        glow.addColorStop(0, css(c, 0.5 * a));
        glow.addColorStop(1, css(c, 0));
        g.fillStyle = glow;
        g.fillRect(x - 170 * u, y - 170 * u, 340 * u, 340 * u);
        g.fillStyle = css(mul(c, 0.85), 0.9 * a);
        g.beginPath();
        g.arc(x, y, 26 * u, 0, TAU);
        g.fill();
        this.road = { x, a: a * 0.6, c };
        return;
      }
    }
    this.road = null;
    if (!this.env.moon || P.light > 0.3) return;
    const x = W * (0.12 + 0.76 * P.sun.moonArc);
    const y = L.horizon - Math.sin(Math.PI * P.sun.moonArc) * L.horizon * 0.55 + 20 * u;
    const a = (1 - cover * 0.9) * (1 - P.light * 3);
    if (a <= 0.02) return;
    const glow = g.createRadialGradient(x, y, 0, x, y, 110 * u);
    glow.addColorStop(0, `rgba(220,215,190,${0.22 * a})`);
    glow.addColorStop(1, 'rgba(220,215,190,0)');
    g.fillStyle = glow;
    g.fillRect(x - 110 * u, y - 110 * u, 220 * u, 220 * u);
    g.fillStyle = `rgba(226,220,196,${0.85 * a})`;
    g.beginPath();
    g.arc(x, y, 19 * u, 0, TAU);
    g.fill();
    g.fillStyle = css(P.top, 0.9 * a);
    g.beginPath();
    g.arc(x + 8 * u, y - 4 * u, 17 * u, 0, TAU);
    g.fill();
    this.road = { x: x - 4 * u, a: 0.35 * a, c: [220, 215, 190] };
  }

  aurora(g, t, a) {
    const { W, u } = this;
    const L = this.layout;
    g.save();
    g.globalCompositeOperation = 'lighter';
    for (let k = 0; k < 3; k++) {
      const base = L.horizon * (0.25 + k * 0.12);
      const gr = g.createLinearGradient(0, base - 160 * u, 0, base + 40 * u);
      gr.addColorStop(0, 'rgba(120,60,180,0)');
      gr.addColorStop(0.55, `rgba(60,200,140,${0.16 * a})`);
      gr.addColorStop(1, 'rgba(60,200,140,0)');
      g.fillStyle = gr;
      g.beginPath();
      g.moveTo(0, base + 40 * u);
      for (let x = 0; x <= W; x += 24 * u) {
        const y = base + Math.sin(x / W * 5 + t * 0.15 + k) * 40 * u + Math.sin(x / W * 13 - t * 0.27 + k * 2) * 14 * u;
        g.lineTo(x, y - 160 * u);
      }
      g.lineTo(W, base + 40 * u);
      g.closePath();
      g.fill();
    }
    g.restore();
  }

  /* A cloud: soft blobs, lit from the sun's side, darker in a storm —
     drawn once into a sprite of its own (per cloud and per light), so a
     frame is one drawImage for it, not seven gradients. */
  cloud(g, c, P) {
    const slot = this.bgKey;
    if (!c.sprite || c.slot !== slot) {
      const base = this.sc.storm ? [30, 32, 38] : mix([60, 64, 74], [210, 214, 222], P.light * 0.8);
      const tint = mix(base, [230, 150, 100], P.sun.glow * 0.35 * P.light);
      const R = rng(c.seed);
      const cw = Math.ceil(c.w * 1.4), ch = Math.ceil(c.h * 2.2);
      const cv = c.sprite || document.createElement('canvas');
      cv.width = cw;
      cv.height = ch;
      const x = cv.getContext('2d');
      x.clearRect(0, 0, cw, ch);
      for (let i = 0; i < 7; i++) {
        const bx = cw / 2 + (R() - 0.5) * c.w * 0.85;
        const by = ch / 2 + (R() - 0.5) * c.h * 0.5;
        const r = c.h * (0.45 + R() * 0.45);
        const gr = x.createRadialGradient(bx, by - r * 0.2, 0, bx, by, r);
        gr.addColorStop(0, css(tint, c.a * 0.42));
        gr.addColorStop(1, css(tint, 0));
        x.fillStyle = gr;
        x.fillRect(bx - r, by - r, r * 2, r * 2);
      }
      c.sprite = cv;
      c.slot = slot;
    }
    g.drawImage(c.sprite, c.x - c.sprite.width / 2, c.y - c.sprite.height / 2);
  }

  bolt(g, b) {
    const { u } = this;
    const a = b.life < 0.08 ? 1 : b.life < 0.2 ? 0.4 : b.life < 0.28 ? 0.9 : Math.max(0, 1 - (b.life - 0.28) * 3);
    const [x, y] = b.pts[0];
    const glow = g.createRadialGradient(x, y + 80 * u, 0, x, y + 80 * u, 380 * u);
    glow.addColorStop(0, `rgba(200,205,255,${0.22 * a})`);
    glow.addColorStop(1, 'rgba(200,205,255,0)');
    g.fillStyle = glow;
    g.fillRect(x - 380 * u, y - 300 * u, 760 * u, 760 * u);
    g.strokeStyle = `rgba(235,238,255,${0.85 * a})`;
    g.lineWidth = 2.4 * u;
    g.beginPath();
    b.pts.forEach(([px, py], i) => (i ? g.lineTo(px, py) : g.moveTo(px, py)));
    g.stroke();
  }

  water(g, P, t) {
    const { W, u } = this;
    const L = this.layout;
    if (L.icy) return;
    // Shimmer: short bright strokes that come and go, more in wind.
    const rows = 26;
    g.lineWidth = 1.2 * u;
    for (let i = 0; i < rows; i++) {
      const y = L.lakeTop + 6 * u + (i / rows) * (L.lakeBottom - L.lakeTop - 10 * u);
      const k = i / rows;
      for (let j = 0; j < 6; j++) {
        const x = ((j * 331 + i * 197) % 1000) / 1000 * W + Math.sin(t * 0.3 + i + j) * 30 * u;
        const a = (0.04 + P.light * 0.08 + (this.sc.wind || 0) * 0.02) * (0.5 + 0.5 * Math.sin(t * 1.3 + i * 1.7 + j * 2.3));
        g.strokeStyle = css(mix(P.low, [255, 255, 255], 0.3), a);
        g.beginPath();
        g.moveTo(x, y);
        g.lineTo(x + (20 + k * 50) * u, y);
        g.stroke();
      }
    }
    // The sun's or the moon's road across the water.
    if (this.road && this.road.a > 0.02) {
      const r = this.road;
      for (let i = 0; i < 22; i++) {
        const y = L.lakeTop + 4 * u + i * (L.lakeBottom - L.lakeTop) / 22;
        const w = (8 + i * 3) * u * (0.6 + 0.4 * Math.sin(t * 2 + i * 1.3));
        g.fillStyle = css(r.c, r.a * (1 - i / 26) * (0.5 + 0.5 * Math.sin(t * 1.7 + i)));
        g.fillRect(r.x - w / 2 + Math.sin(t + i) * 4 * u, y, w, 2 * u);
      }
    }
    // Rings where the rain lands.
    g.lineWidth = 1 * u;
    for (const rp of L.ripples) {
      g.strokeStyle = css(mix(P.low, [255, 255, 255], 0.35), 0.35 * (1 - rp.r / rp.max));
      g.beginPath();
      g.ellipse(rp.x, rp.y, rp.r, rp.r * 0.3, 0, 0, TAU);
      g.stroke();
    }
  }

  home(g, P, t) {
    const { u } = this;
    const L = this.layout;
    const c = L.cottage;
    if (P.light < 0.75) {
      const a = (1 - P.light) * (0.75 + 0.1 * Math.sin(t * 3.1) + 0.05 * Math.sin(t * 7.3));
      const wx = c.x - c.w * 0.32;
      const wy = c.y - c.h * 0.62;
      const glow = g.createRadialGradient(wx, wy, 0, wx, wy, 70 * u);
      glow.addColorStop(0, `rgba(255,190,110,${0.35 * a})`);
      glow.addColorStop(1, 'rgba(255,190,110,0)');
      g.fillStyle = glow;
      g.fillRect(wx - 70 * u, wy - 70 * u, 140 * u, 140 * u);
      g.fillStyle = `rgba(255,200,120,${0.9 * a})`;
      g.fillRect(wx - 11 * u, wy - 9 * u, 22 * u, 18 * u);
      g.fillRect(c.x + c.w * 0.32 - 11 * u, wy - 9 * u, 22 * u, 18 * u);
      // Its light on the water.
      if (!L.icy) {
        g.fillStyle = `rgba(255,190,110,${0.12 * a})`;
        for (let i = 0; i < 6; i++) g.fillRect(wx - 8 * u + Math.sin(t * 2 + i) * 3 * u, c.y + 6 * u + i * 7 * u, 16 * u, 2 * u);
      }
    }
    for (const s of L.smoke) {
      const gr = g.createRadialGradient(s.x, s.y, 0, s.x, s.y, s.r);
      const col = mix([120, 120, 125], [200, 200, 205], P.light);
      gr.addColorStop(0, css(col, s.a));
      gr.addColorStop(1, css(col, 0));
      g.fillStyle = gr;
      g.fillRect(s.x - s.r, s.y - s.r, s.r * 2, s.r * 2);
    }
  }

  falling(g, P) {
    const L = this.layout;
    const fall = this.sc.fall;
    if (!fall || !L.drops.length) return;
    const { u } = this;
    const slant = [0.05, 0.15, 0.3, 0.5][this.sc.wind || 0];
    const rainC = mix([150, 165, 185], [210, 220, 235], P.light);
    g.strokeStyle = css(rainC, fall.kind === 'drizzle' ? 0.28 : 0.38);
    g.lineWidth = (fall.kind === 'drizzle' ? 0.9 : 1.3) * u;
    g.beginPath();
    for (const d of L.drops) {
      if (d.snow) continue;
      g.moveTo(d.x, d.y);
      g.lineTo(d.x - d.len * slant, d.y - d.len);
    }
    g.stroke();
    g.fillStyle = css(mix([200, 205, 215], [245, 248, 252], P.light), 0.8);
    for (const d of L.drops) {
      if (!d.snow) continue;
      g.beginPath();
      g.arc(d.x, d.y, d.r, 0, TAU);
      g.fill();
    }
  }
}

function snowFall(sc) { return !!sc.fall && ['snow', 'grains'].includes(sc.fall.kind); }

/* The day's seed: the same landscape all day, another tomorrow. */
export function daySeed(now) {
  const d = new Date(now);
  return d.getFullYear() * 1000 + d.getMonth() * 40 + d.getDate();
}
