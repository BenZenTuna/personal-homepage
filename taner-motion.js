// Motion for /taner/: the background follows the section you're in, content
// builds itself in as it scrolls into view, cards lean toward the mouse, and
// About draws the journey from the Danube to the Bosphorus to the Nordics.
// Everything here is skipped when the visitor asks for reduced motion
// (the page's <head> only adds .motion to <html> when motion is welcome).

(function () {
  const root = document.documentElement;
  const motion = root.classList.contains('motion');
  const shader = window.soloShader && window.soloShader.setMood ? window.soloShader : null;

  // ---------- Background follows you ----------
  // well: where the liquid metal drifts (screen-height units from the centre);
  // tint: the colour it leans toward; grid: circuit traces.
  const MOODS = {
    hero:    { well: [0, 0],        tint: [0.55, 0.70, 1.00], tintAmt: 0,    grid: 0 },
    about:   { well: [0.48, 0.06],  tint: [0.40, 0.95, 1.00], tintAmt: 0.45, grid: 0 },
    code:    { well: [-0.52, -0.04], tint: [0.45, 1.00, 0.72], tintAmt: 0.35, grid: 1 },
    frames:  { well: [0, 0.30],     tint: [0.82, 0.60, 1.00], tintAmt: 0.45, grid: 0 },
    wear:    { well: [0.50, -0.10], tint: [1.00, 0.72, 0.50], tintAmt: 0.50, grid: 0 },
    contact: { well: [0, -0.05],    tint: [0.75, 0.82, 1.00], tintAmt: 0.20, grid: 0 },
  };
  const sections = [...document.querySelectorAll('main > section[id]')].filter(s => MOODS[s.id]);

  if (shader) {
    window.addEventListener('mousemove', e => {
      shader.setMouse(e.clientX / window.innerWidth, 1 - e.clientY / window.innerHeight);
    }, { passive: true });

    let current = null, queued = false;
    const check = () => {
      queued = false;
      const probe = window.scrollY + window.innerHeight * 0.4;
      let id = sections.length ? sections[0].id : null;
      for (const s of sections) if (s.offsetTop <= probe) id = s.id;
      if (!id || id === current) return;
      const first = current === null;
      current = id;
      const mood = MOODS[id];
      shader.setMood(mood);
      if (!first && motion) {
        // A ripple from where the metal is heading
        const aspect = window.innerHeight / window.innerWidth;
        shader.pulse(0.5 + mood.well[0] * aspect, 0.5 + mood.well[1]);
      }
    };
    window.addEventListener('scroll', () => { if (!queued) { queued = true; requestAnimationFrame(check); } }, { passive: true });
    window.addEventListener('resize', check);
    check();
  }

  if (!motion) {
    drawJourney(true);
    return;
  }

  // ---------- Content builds itself in ----------
  // Section titles letter by letter; everything else rises in, one after
  // another, as it comes into view.
  document.querySelectorAll('.section-title').forEach(title => {
    const words = title.textContent.trim().split(/\s+/);
    title.setAttribute('aria-label', title.textContent.trim());
    title.textContent = '';
    let c = 0;
    words.forEach((w, wi) => {
      const word = document.createElement('span');
      word.className = 'word';
      word.setAttribute('aria-hidden', 'true');
      for (const ch of w) {
        const s = document.createElement('span');
        s.className = 'ch';
        s.style.setProperty('--c', c++);
        s.textContent = ch;
        word.appendChild(s);
      }
      title.appendChild(word);
      if (wi < words.length - 1) title.appendChild(document.createTextNode(' '));
    });
    title.classList.add('rise-letters');
  });

  const RISE = [
    '.section-num', '.section-sub', '.section-title',
    '.about > p', '.journey',
    '.code-hero-lede', '.code-stat', '.code-handle', '.project',
    '#frames .reel', '#frames .reel-meta', '#frames .caption-line', '#frames .notes',
    '.tees-intro', '.tee', '.tees-footnote',
    '.channel',
  ].join(',');
  const risers = [...document.querySelectorAll(RISE)];
  risers.forEach(el => { if (!el.classList.contains('rise-letters')) el.classList.add('rise'); });

  const io = new IntersectionObserver(entries => {
    // Items arriving together go one after another, in page order
    const arriving = entries.filter(e => e.isIntersecting).map(e => e.target)
      .sort((a, b) => (a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING) ? -1 : 1);
    arriving.forEach((el, i) => {
      el.style.setProperty('--d', `${Math.min(i, 8) * 90}ms`);
      el.classList.add('in');
      io.unobserve(el);
      if (el.classList.contains('code-stat')) countUp(el, Math.min(i, 8) * 90);
    });
  }, { threshold: 0.12, rootMargin: '0px 0px -6% 0px' });
  risers.forEach(el => io.observe(el));

  // 04 counts up from 00; ∞ races through numbers before it settles.
  function countUp(stat, delay) {
    const num = stat.querySelector('.code-stat-num');
    if (!num) return;
    const final = num.textContent.trim();
    const target = parseInt(final, 10);
    const infinite = isNaN(target);
    const ms = infinite ? 1300 : 900;
    num.textContent = '00';
    setTimeout(() => {
      const t0 = performance.now();
      const step = now => {
        const p = Math.min(1, (now - t0) / ms);
        if (p >= 1) { num.textContent = final; return; }
        const v = infinite ? Math.floor(Math.pow(p, 2) * 99) : Math.round(target * (1 - Math.pow(1 - p, 3)));
        num.textContent = String(v).padStart(2, '0');
        requestAnimationFrame(step);
      };
      requestAnimationFrame(step);
    }, delay + 200);
  }

  // ---------- Cards react to the mouse ----------
  if (window.matchMedia('(hover: hover) and (pointer: fine)').matches) {
    const TILT = [['.project', 2.2], ['.tee', 7], ['.channel', 6]];
    TILT.forEach(([sel, max]) => document.querySelectorAll(sel).forEach(card => {
      const glare = document.createElement('span');
      glare.className = 'glare';
      glare.setAttribute('aria-hidden', 'true');
      card.appendChild(glare);
      card.addEventListener('pointermove', e => {
        const r = card.getBoundingClientRect();
        const x = (e.clientX - r.left) / r.width - 0.5;
        const y = (e.clientY - r.top) / r.height - 0.5;
        card.style.transition = 'transform 90ms linear, border-color 300ms, box-shadow 300ms, background 300ms';
        card.style.transform = `perspective(1000px) rotateX(${(-y * max).toFixed(2)}deg) rotateY(${(x * max).toFixed(2)}deg) translateY(-3px)`;
        card.style.setProperty('--gx', `${((x + 0.5) * 100).toFixed(1)}%`);
        card.style.setProperty('--gy', `${((y + 0.5) * 100).toFixed(1)}%`);
        card.classList.add('is-tilting');
      });
      card.addEventListener('pointerleave', () => {
        card.style.transition = '';
        card.style.transform = '';
        card.classList.remove('is-tilting');
      });
    }));

    // Hero depth: the two portraits drift apart from the cursor, the name a little less.
    const chemist = document.querySelector('.portrait--chemist');
    const digital = document.querySelector('.portrait--digital');
    const name = document.querySelector('.hero .name');
    let px = 0, py = 0, tx = 0, ty = 0, raf = 0;
    const settle = () => {
      px += (tx - px) * 0.08; py += (ty - py) * 0.08;
      if (chemist) chemist.style.translate = `${(px * -18).toFixed(1)}px ${(py * -12).toFixed(1)}px`;
      if (digital) digital.style.translate = `${(px * 18).toFixed(1)}px ${(py * 12).toFixed(1)}px`;
      if (name) name.style.translate = `${(px * 8).toFixed(1)}px ${(py * 5).toFixed(1)}px`;
      raf = Math.abs(tx - px) + Math.abs(ty - py) > 0.002 ? requestAnimationFrame(settle) : 0;
    };
    window.addEventListener('mousemove', e => {
      if (window.scrollY > window.innerHeight) return;
      tx = e.clientX / window.innerWidth - 0.5;
      ty = e.clientY / window.innerHeight - 0.5;
      if (!raf) raf = requestAnimationFrame(settle);
    }, { passive: true });
  }

  drawJourney(false);

  // ---------- Journey line in About ----------
  function drawJourney(instant) {
    const svg = document.querySelector('.journey');
    if (!svg) return;
    const seg1 = svg.querySelector('.journey-path.leg-1');
    const seg2 = svg.querySelector('.journey-path.leg-2');
    const head = svg.querySelector('.journey-head');
    const stops = ['danube', 'bosphorus', 'nordics'].map(k => svg.querySelectorAll(`[data-stop="${k}"]`));
    const light = i => stops[i].forEach(el => el.classList.add('lit'));
    if (instant || !seg1 || !seg2 || !seg1.getTotalLength) {
      stops.forEach((_, i) => light(i));
      svg.classList.add('done');
      return;
    }
    const legs = [seg1, seg2].map(p => ({ p, len: p.getTotalLength() }));
    legs.forEach(l => { l.p.style.strokeDasharray = l.len; l.p.style.strokeDashoffset = l.len; });
    svg.classList.add('armed');

    const ease = t => t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
    function draw(leg, ms) {
      return new Promise(done => {
        const t0 = performance.now();
        head.classList.add('on');
        const step = now => {
          const p = ease(Math.min(1, (now - t0) / ms));
          leg.p.style.strokeDashoffset = leg.len * (1 - p);
          const pt = leg.p.getPointAtLength(leg.len * p);
          head.setAttribute('cx', pt.x); head.setAttribute('cy', pt.y);
          if (p < 1) requestAnimationFrame(step); else { head.classList.remove('on'); done(); }
        };
        requestAnimationFrame(step);
      });
    }
    const wait = ms => new Promise(r => setTimeout(r, ms));

    const jo = new IntersectionObserver(async entries => {
      if (!entries.some(e => e.isIntersecting)) return;
      jo.disconnect();
      await wait(500);
      light(0);
      await wait(350);
      await draw(legs[0], 800);
      light(1);
      await wait(600);
      await draw(legs[1], 1900);
      light(2);
      svg.classList.add('done');
    }, { threshold: 0.4 });
    jo.observe(svg);
  }
})();
