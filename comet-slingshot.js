// Comet slingshot: press anywhere, pull back and let go to fling a comet
// into the binary system. Both portraits pull on it like suns; falling into
// one scores for that side, and the longest time in orbit is remembered.

(function () {
  if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

  const COOL = [168, 195, 255];   // Taner's side
  const WARM = [255, 196, 154];   // Neshe's side
  const ORBIT_R = 1.7;            // a circular orbit at 1.7 portrait radii...
  const PERIOD = 3.2;             // ...takes this many seconds
  const DRAG_START = 8;           // px of movement before a press becomes a sling
  const MAX_PULL = 220;           // px
  const MAX_COMETS = 8;
  const TRAIL = 48;
  const SUBSTEPS = 6;
  const BEST_KEY = 'tunas-comet-best';
  const MILESTONES = [
    [10, '10 s in orbit'],
    [30, '30 s · a stable orbit'],
    [60, '60 s · the binary system has a third body'],
  ];

  const canvas = document.createElement('canvas');
  canvas.id = 'comet-canvas';
  document.body.appendChild(canvas);
  const ctx = canvas.getContext('2d');

  const wells = [...document.querySelectorAll('.half')].map(h => ({
    side: h.dataset.side,
    name: h.dataset.side === 'L' ? 'Taner' : 'Neshe',
    half: h,
    el: h.querySelector('.portrait'),
    x: 0, y: 0, r: 0, gm: 0,
  }));
  const wellL = wells.find(w => w.side === 'L');
  const wellR = wells.find(w => w.side === 'R');
  if (!wellL || !wellR) return;

  const scoreEl = document.getElementById('comet-score');
  const orbitEl = document.getElementById('comet-orbit');
  const noteEl = document.getElementById('comet-note');
  document.querySelectorAll('.comet-hud').forEach(el => { el.hidden = false; });

  const score = { L: 0, R: 0 };
  let best = 0;
  try { best = parseFloat(localStorage.getItem(BEST_KEY)) || 0; } catch (e) {}

  let W = 0, H = 0;
  let comets = [];
  let sparks = [];
  let aim = null;
  let launched = false;
  let suppressClick = false;
  let running = false;
  let last = 0;
  let hudTimer = 0;
  const A = [0, 0];

  function resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    W = canvas.clientWidth; H = canvas.clientHeight;
    if (canvas.width !== Math.round(W * dpr) || canvas.height !== Math.round(H * dpr)) {
      canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr);
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  // Wells follow the portraits, so the parallax and the mobile layout move them too.
  function measure() {
    for (const w of wells) {
      const b = w.el.getBoundingClientRect();
      w.x = b.left + b.width / 2;
      w.y = b.top + b.height / 2;
      w.r = w.el.offsetWidth / 2;
      const a = ORBIT_R * w.r;
      w.gm = 4 * Math.PI * Math.PI * a * a * a / (PERIOD * PERIOD);
    }
  }

  function accel(x, y) {
    let ax = 0, ay = 0;
    for (const w of wells) {
      const dx = w.x - x, dy = w.y - y;
      const soft = 0.3 * w.r;
      const d2 = dx * dx + dy * dy + soft * soft;
      const f = w.gm / (d2 * Math.sqrt(d2));
      ax += dx * f; ay += dy * f;
    }
    A[0] = ax; A[1] = ay;
  }

  function wellAt(x, y, scale) {
    for (const w of wells) {
      if (w.r > 0 && Math.hypot(x - w.x, y - w.y) < w.r * scale) return w;
    }
    return null;
  }

  // Semi-implicit Euler keeps orbits from slowly gaining energy.
  function step(c, dt) {
    accel(c.x, c.y);
    c.vx += A[0] * dt; c.vy += A[1] * dt;
    c.x += c.vx * dt; c.y += c.vy * dt;
  }

  // 0 near Taner (cool), 1 near Neshe (warm).
  function warmth(x, y) {
    const dL = Math.hypot(x - wellL.x, y - wellL.y);
    const dR = Math.hypot(x - wellR.x, y - wellR.y);
    return dL / (dL + dR + 1e-6);
  }

  function rgba(t, a) {
    const r = COOL[0] + (WARM[0] - COOL[0]) * t;
    const g = COOL[1] + (WARM[1] - COOL[1]) * t;
    const b = COOL[2] + (WARM[2] - COOL[2]) * t;
    return `rgba(${r | 0}, ${g | 0}, ${b | 0}, ${a})`;
  }

  function launchVelocity(a) {
    let dx = a.sx - a.px, dy = a.sy - a.py;
    const len = Math.hypot(dx, dy);
    if (len > MAX_PULL) { dx *= MAX_PULL / len; dy *= MAX_PULL / len; }
    const k = 3.3 * (wellL.r + wellR.r) / 200;
    return [dx * k, dy * k];
  }

  let noteTimer = 0;
  function note(text, ms) {
    if (!noteEl) return;
    noteEl.textContent = text;
    noteEl.classList.add('show');
    clearTimeout(noteTimer);
    noteTimer = setTimeout(() => noteEl.classList.remove('show'), ms || 2200);
  }

  function updateHud() {
    if (scoreEl) scoreEl.textContent = `Taner ${score.L} · Neshe ${score.R}`;
    if (!orbitEl) return;
    let now = 0;
    for (const c of comets) now = Math.max(now, c.orbit);
    const bestText = best > 0 ? `best ${best.toFixed(1)} s` : '—';
    orbitEl.textContent = comets.length ? `${now.toFixed(1)} s · ${bestText}` : bestText;
  }

  function saveBest() {
    try { localStorage.setItem(BEST_KEY, best.toFixed(1)); } catch (e) {}
  }

  function capture(c, w) {
    score[w.side] += 1;
    note(`${w.name} caught it · ${score[w.side]}`);
    const t = w.side === 'L' ? 0 : 1;
    for (let i = 0; i < 36; i++) {
      const ang = Math.random() * Math.PI * 2;
      const sp = 60 + Math.random() * 260;
      const life = 0.5 + Math.random() * 0.7;
      sparks.push({ x: c.x, y: c.y, vx: Math.cos(ang) * sp + c.vx * 0.15, vy: Math.sin(ang) * sp + c.vy * 0.15, life, max: life, t });
    }
    if (window.tunasShader) window.tunasShader.pulse(c.x / W, 1 - c.y / H);
    w.half.classList.remove('comet-hit');
    void w.half.offsetWidth;
    w.half.classList.add('comet-hit');
    clearTimeout(w.hitTimer);
    w.hitTimer = setTimeout(() => w.half.classList.remove('comet-hit'), 900);
    saveBest();
  }

  function update(dt) {
    const h = dt / SUBSTEPS;
    for (let i = comets.length - 1; i >= 0; i--) {
      const c = comets[i];
      let caught = null;
      for (let s = 0; s < SUBSTEPS && !caught; s++) {
        step(c, h);
        caught = wellAt(c.x, c.y, 0.92);
      }
      if (caught) { capture(c, caught); comets.splice(i, 1); continue; }

      c.trail.push({ x: c.x, y: c.y, t: warmth(c.x, c.y) });
      if (c.trail.length > TRAIL) c.trail.shift();

      const onScreen = c.x > -20 && c.x < W + 20 && c.y > -20 && c.y < H + 20;
      if (onScreen) {
        c.offFor = 0;
        c.orbit += dt;
        if (c.orbit > best) best = c.orbit;
        const m = MILESTONES[c.milestone];
        if (m && c.orbit >= m[0]) { note(m[1], 3200); c.milestone += 1; }
      } else if ((c.offFor += dt) > 2.5) {
        comets.splice(i, 1);
        saveBest();
      }
    }

    for (let i = sparks.length - 1; i >= 0; i--) {
      const p = sparks[i];
      p.life -= dt;
      if (p.life <= 0) { sparks.splice(i, 1); continue; }
      p.vx *= 0.94; p.vy *= 0.94;
      p.x += p.vx * dt; p.y += p.vy * dt;
    }
  }

  function drawHead(x, y, t, glow) {
    const g = ctx.createRadialGradient(x, y, 0, x, y, glow);
    g.addColorStop(0, 'rgba(255, 255, 255, 0.95)');
    g.addColorStop(0.25, rgba(t, 0.7));
    g.addColorStop(1, rgba(t, 0));
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(x, y, glow, 0, Math.PI * 2); ctx.fill();
  }

  function drawAim() {
    const t = warmth(aim.sx, aim.sy);
    // The rubber band, from the comet back to the pointer
    ctx.strokeStyle = 'rgba(243, 239, 232, 0.28)';
    ctx.lineWidth = 1;
    ctx.setLineDash([3, 5]);
    ctx.beginPath(); ctx.moveTo(aim.sx, aim.sy); ctx.lineTo(aim.px, aim.py); ctx.stroke();
    ctx.setLineDash([]);

    // The first 1.2 s of its flight, so aiming is a game of skill, not luck
    const [vx, vy] = launchVelocity(aim);
    const c = { x: aim.sx, y: aim.sy, vx, vy };
    const h = 1 / 60 / SUBSTEPS;
    for (let i = 1; i <= 72; i++) {
      for (let s = 0; s < SUBSTEPS; s++) step(c, h);
      if (wellAt(c.x, c.y, 0.92)) break;
      if (i % 3) continue;
      ctx.fillStyle = rgba(warmth(c.x, c.y), 0.75 * (1 - i / 72));
      ctx.beginPath(); ctx.arc(c.x, c.y, 2, 0, Math.PI * 2); ctx.fill();
    }

    drawHead(aim.sx, aim.sy, t, 14 + Math.sin(performance.now() / 160) * 2);
  }

  function draw() {
    ctx.clearRect(0, 0, W, H);
    ctx.globalCompositeOperation = 'lighter';
    ctx.lineCap = 'round';

    for (const c of comets) {
      const n = c.trail.length;
      for (let i = 1; i < n; i++) {
        const p = c.trail[i - 1], q = c.trail[i];
        const k = i / n;
        ctx.strokeStyle = rgba(q.t, 0.85 * k);
        ctx.lineWidth = 0.8 + 4.2 * k;
        ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(q.x, q.y); ctx.stroke();
      }
      drawHead(c.x, c.y, warmth(c.x, c.y), 17);
    }

    for (const p of sparks) {
      ctx.fillStyle = rgba(p.t, p.life / p.max);
      ctx.beginPath(); ctx.arc(p.x, p.y, 1.2 + 1.3 * (p.life / p.max), 0, Math.PI * 2); ctx.fill();
    }

    if (aim && aim.active) drawAim();
    ctx.globalCompositeOperation = 'source-over';
  }

  function frame(now) {
    const dt = Math.min((now - last) / 1000, 1 / 20);
    last = now;
    resize();
    measure();
    update(dt);
    draw();
    if ((hudTimer -= dt) <= 0) { updateHud(); hudTimer = 0.1; }
    if (comets.length || sparks.length || (aim && aim.active)) {
      requestAnimationFrame(frame);
    } else {
      running = false;
      updateHud();
    }
  }

  function kick() {
    if (running) return;
    running = true;
    last = performance.now();
    requestAnimationFrame(frame);
  }

  window.addEventListener('pointerdown', (e) => {
    if (!e.isPrimary || (e.pointerType === 'mouse' && e.button !== 0)) return;
    measure();
    // A press on a portrait is a click on that profile, never a sling.
    if (wellAt(e.clientX, e.clientY, 1.0)) return;
    aim = { id: e.pointerId, sx: e.clientX, sy: e.clientY, px: e.clientX, py: e.clientY, active: false };
  });

  window.addEventListener('pointermove', (e) => {
    if (!aim || e.pointerId !== aim.id) return;
    aim.px = e.clientX; aim.py = e.clientY;
    if (!aim.active && Math.hypot(aim.px - aim.sx, aim.py - aim.sy) > DRAG_START) {
      aim.active = true;
      document.documentElement.classList.add('comet-aiming');
      if (!launched && noteEl) noteEl.classList.remove('show');
      kick();
    }
  });

  window.addEventListener('pointerup', (e) => {
    if (!aim || e.pointerId !== aim.id) return;
    if (aim.active) {
      const [vx, vy] = launchVelocity(aim);
      comets.push({ x: aim.sx, y: aim.sy, vx, vy, trail: [], orbit: 0, offFor: 0, milestone: 0 });
      if (comets.length > MAX_COMETS) comets.shift();
      launched = true;
      // The release must not also open the profile it happened over.
      suppressClick = true;
      setTimeout(() => { suppressClick = false; }, 0);
      kick();
    }
    aim = null;
    document.documentElement.classList.remove('comet-aiming');
  });

  window.addEventListener('pointercancel', (e) => {
    if (!aim || e.pointerId !== aim.id) return;
    aim = null;
    document.documentElement.classList.remove('comet-aiming');
  });

  window.addEventListener('click', (e) => {
    if (!suppressClick) return;
    e.preventDefault();
    e.stopImmediatePropagation();
  }, true);

  // Dragging a link or a portrait would start the browser's own drag and drop.
  document.addEventListener('dragstart', (e) => {
    if (e.target.closest && e.target.closest('.composition')) e.preventDefault();
  });

  updateHud();
  setTimeout(() => { if (!launched) note('drag anywhere · sling a comet', 6000); }, 2000);
})();
