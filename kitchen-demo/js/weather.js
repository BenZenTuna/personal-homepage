// Weather lives in the header: a "now" block plus an hourly band that reads
// from across the kitchen. Eight hours are in view and the next two days are
// under the finger — the band is dragged sideways like a phone, or paged with
// the arrows at either end.
//
// Two things are tappable, and each opens what it is a summary *of*:
//
//   the "now" block  ->  the week ahead, a row a day
//   the hourly band  ->  the hours in detail — feels-like, humidity, UV, air
//                        quality, wind, hour by hour
//
// They used to be one screen behind the band, which meant the way to next
// Thursday was through a chart of the next 48 hours, and the block showing
// today's temperature was not a button at all. Each half now sits behind the
// thing on the wall that is the short version of it.

const REFRESH_MS = 10 * 60 * 1000;
const BAND_HOURS = 48;   // eight in view, the rest are a swipe away
const BAND_VISIBLE = 8;

/* ============================ drawn glyphs ============================
   Inline SVG rather than emoji or an icon font: it stays crisp at any size,
   needs no network fetch, and — the reason it was worth rewriting — each
   shape is distinct in silhouette, so sun / cloud / rain / snow are told
   apart at a glance rather than read. Colour comes from the CSS palette. */

function rays(cx, cy, r) {
  let out = '';
  for (let i = 0; i < 8; i++) {
    const a = (i * Math.PI) / 4;
    const c = Math.cos(a), s = Math.sin(a);
    out += `<line x1="${(cx + c * (r + 2.4)).toFixed(1)}" y1="${(cy + s * (r + 2.4)).toFixed(1)}"`
         + ` x2="${(cx + c * (r + 5.1)).toFixed(1)}" y2="${(cy + s * (r + 5.1)).toFixed(1)}"/>`;
  }
  return out;
}

const sun = (cx, cy, r) =>
  `<g class="s">${rays(cx, cy, r)}<circle cx="${cx}" cy="${cy}" r="${r}"/></g>`;

const moon = (dx, dy, k) =>
  `<g class="m" transform="translate(${dx} ${dy}) scale(${k})">
     <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></g>`;

// Three overlapping discs on a rounded base: reads as a cloud at any scale.
const cloud = (dx = 0, dy = 0, k = 1) =>
  `<g class="c" transform="translate(${16 + dx} ${16 + dy}) scale(${k}) translate(-16 -16)">
     <circle cx="11.4" cy="19" r="5.2"/><circle cx="17.4" cy="15.8" r="6.8"/>
     <circle cx="23" cy="19.6" r="4.6"/>
     <rect x="6.2" y="18.8" width="21.4" height="5.8" rx="2.9"/></g>`;

const drops = (y, len) => `<g class="r">${[10.8, 16.4, 22]
  .map((x) => `<line x1="${x}" y1="${y}" x2="${x - 1.7}" y2="${y + len}"/>`).join('')}</g>`;

const flakes = (y) => `<g class="w">${[10.8, 16.4, 22]
  .map((x) => `<circle cx="${x}" cy="${y}" r="1.9"/>`).join('')}</g>`;

const bolt = '<path class="b" d="M18.4 22.4 L13.4 28.3 H16.4 L15.1 31.8 L20 25.8 H17.1 Z"/>';

const fogLines = '<g class="f"><line x1="7.5" y1="26" x2="24.5" y2="26"/>'
               + '<line x1="10.5" y1="30" x2="21.5" y2="30"/></g>';

// WMO weather code -> one glyph. `day` picks sun or moon for the clear cases.
function icon(code, day) {
  const wrap = (inner) => `<svg class="wx-ico" viewBox="0 0 32 32" aria-hidden="true">${inner}</svg>`;
  if (code === 0) return wrap(day ? sun(16, 16, 6.8) : moon(5.6, 5.6, 0.88));
  if (code === 1) return wrap((day ? sun(12.5, 12.5, 5.8) : moon(1.5, 2, 0.72)) + cloud(4, 6, 0.6));
  if (code === 2) return wrap((day ? sun(21.5, 10, 5) : moon(11, 0.5, 0.6)) + cloud(-1.5, 3, 0.85));
  if (code === 3) return wrap(cloud(0, 0.5));
  if (code === 45 || code === 48) return wrap(cloud(0, -4, 0.86) + fogLines);
  if (code >= 51 && code <= 57) return wrap(cloud(0, -3, 0.9) + drops(23.5, 3.8));
  if (code >= 61 && code <= 67) return wrap(cloud(0, -3, 0.9) + drops(23, 6.6));
  if ((code >= 71 && code <= 77) || code === 85 || code === 86) {
    return wrap(cloud(0, -3, 0.9) + flakes(28));
  }
  if (code >= 80 && code <= 82) {
    return wrap((day ? sun(23.5, 7.5, 4.2) : moon(15, -2, 0.5)) + cloud(-1, -3, 0.82) + drops(23, 6));
  }
  if (code >= 95) return wrap(cloud(0, -3.5, 0.88) + bolt);
  return wrap(cloud(0, 0.5));
}

/* ====================== bands for the readings ======================
   A number nobody can place is not a reading. "UV 7" means nothing to most
   people; "7 · high — cover up" is the whole point of printing it. */

function uvBand(v) {
  if (v == null) return null;
  const n = Math.round(v);
  if (n < 3) return { n, word: 'low', cls: 'ok' };
  if (n < 6) return { n, word: 'moderate', cls: 'ok' };
  if (n < 8) return { n, word: 'high — cover up', cls: 'warn' };
  if (n < 11) return { n, word: 'very high — stay in the shade', cls: 'warn' };
  return { n, word: 'extreme', cls: 'bad' };
}

/* The European AQI, which is the scale Open-Meteo returns for this part of the
   world. Its bands are fixed by the index itself, not chosen here. */
function aqiBand(v) {
  if (v == null) return null;
  const n = Math.round(v);
  if (n <= 20) return { n, word: 'good', cls: 'ok' };
  if (n <= 40) return { n, word: 'fair', cls: 'ok' };
  if (n <= 60) return { n, word: 'moderate', cls: 'warn' };
  if (n <= 80) return { n, word: 'poor', cls: 'bad' };
  if (n <= 100) return { n, word: 'very poor', cls: 'bad' };
  return { n, word: 'extremely poor', cls: 'bad' };
}

function humidityWord(v) {
  if (v == null) return '';
  if (v < 30) return 'dry';
  if (v < 60) return 'comfortable';
  if (v < 80) return 'humid';
  return 'very humid';
}

function describe(code) {
  if (code === 0) return 'Clear';
  if (code === 1) return 'Mostly clear';
  if (code === 2) return 'Partly cloudy';
  if (code === 3) return 'Overcast';
  if (code === 45 || code === 48) return 'Fog';
  if (code >= 51 && code <= 57) return 'Drizzle';
  if (code >= 61 && code <= 67) return 'Rain';
  if (code >= 71 && code <= 77) return 'Snow';
  if (code >= 80 && code <= 82) return 'Showers';
  if (code === 85 || code === 86) return 'Snow showers';
  if (code >= 95) return 'Thunderstorm';
  return '';
}

export default {
  // Shared with the countdown panel, which draws the same glyphs for the
  // forecast at an event's city. app.js hands it over on the panel context.
  icon,
  describe,

  /* A second, much smaller "now" — the header of a panel that has taken the
     whole screen, where the real one is hidden underneath. Handed the element
     to paint into, or null when the panel closes again. It is filled straight
     away rather than at the next refresh, because a blank temperature for the
     first ten minutes of an expanded panel is the same as none at all. */
  mirror(el) {
    this.mirrorEl = el || null;
    this.paintMirror();
  },

  paintMirror() {
    const el = this.mirrorEl;
    const now = this.data?.hourly?.[Math.max(0, this.nowIndex(this.data.hourly))];
    if (!el || !now) return;
    el.querySelector('.hx-ico').innerHTML = icon(now.code, now.day);
    el.querySelector('.hx-temp').textContent = `${Math.round(now.temp)}°`;
    el.querySelector('.hx-wx').title = describe(now.code);
  },

  init() {
    this.band = document.getElementById('hd-band');
    this.buildOverlay();
    this.buildWeekOverlay();
    this.wireBand();
    this.wireNow();
    this.refresh();
    setInterval(() => this.refresh(), REFRESH_MS);
  },

  /* The "now" block is the week's first line, so it is the button the week
     lives behind. A wall screen has no hover to hint at that, which is why it
     gets the same lit border the band has. */
  wireNow() {
    const el = document.querySelector('.hd-now');
    if (!el) return;
    el.classList.add('tappable');
    el.setAttribute('role', 'button');
    el.setAttribute('tabindex', '0');
    el.setAttribute('aria-label', 'the week ahead');
    el.addEventListener('click', () => this.openWeek());
    el.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); this.openWeek(); }
    });
  },

  /* The band is three things at once — a strip you drag, a strip you page
     with the arrows, and a button that opens the full forecast — so a tap has
     to be told apart from a drag: any real finger travel cancels the open.
     Dragging is wired by hand rather than left to native scrolling because a
     wall screen is also poked with a mouse, and because momentum flinging on
     a pinned kiosk tab tends to bounce the whole page. */
  wireBand() {
    let x0 = 0, y0 = 0, left0 = 0, down = false, moved = false;

    this.band.addEventListener('pointerdown', (e) => {
      down = true; moved = false;
      x0 = e.clientX; y0 = e.clientY; left0 = this.band.scrollLeft;
      this.band.classList.add('dragging');   // kills smooth scrolling mid-drag
      // Capture so a finger (or mouse) that runs off the end of the strip
      // keeps dragging it instead of dropping the gesture halfway.
      try { this.band.setPointerCapture(e.pointerId); } catch { /* not captureable */ }
    });
    this.band.addEventListener('pointermove', (e) => {
      if (!down) return;
      const dx = e.clientX - x0;
      if (Math.abs(dx) > 8 || Math.abs(e.clientY - y0) > 8) moved = true;
      if (moved) {
        this.band.scrollLeft = left0 - dx;
        this.syncArrows();
      }
    });
    const end = (e) => {
      down = false;
      this.band.classList.remove('dragging');
      try { this.band.releasePointerCapture(e.pointerId); } catch { /* already gone */ }
    };
    this.band.addEventListener('pointerup', end);
    this.band.addEventListener('pointercancel', end);

    this.band.addEventListener('click', () => { if (!moved) this.openOverlay(); });
    this.band.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); this.openOverlay(); }
    });
    this.band.addEventListener('scroll', () => this.syncArrows(), { passive: true });
    window.addEventListener('resize', () => this.syncArrows());

    const wrap = this.band.parentElement;
    wrap.querySelector('.hd-arrow.prev').onclick = () => this.page(-1);
    wrap.querySelector('.hd-arrow.next').onclick = () => this.page(1);
    this.syncArrows();   // nothing to scroll until the first forecast lands
  },

  /* One page is the eight hours currently in view, less one for continuity. */
  page(dir) {
    const step = this.band.clientWidth * (BAND_VISIBLE - 1) / BAND_VISIBLE;
    this.band.scrollBy({ left: dir * step, behavior: 'smooth' });
  },

  syncArrows() {
    const wrap = this.band.parentElement;
    const b = this.band;
    const max = b.scrollWidth - b.clientWidth;
    wrap.querySelector('.hd-arrow.prev').hidden = b.scrollLeft <= 4;
    wrap.querySelector('.hd-arrow.next').hidden = b.scrollLeft >= max - 4;
  },

  /* The hours, in detail. What a temperature on its own does not answer:
     what it feels like, how wet the air is, whether the sun will burn, what
     you are breathing — then the same, hour by hour, down the screen. */
  buildOverlay() {
    const el = document.createElement('div');
    el.id = 'wx-overlay';
    el.innerHTML = `
      <header>
        <h2>The hours ahead</h2><span class="sub" id="wx-where"></span>
        <span class="spacer"></span>
        <button id="wx-close">Close</button>
      </header>
      <div id="wx-now"></div>
      <div id="wx-facts"></div>
      <div class="wx-cap">The next 48 hours</div>
      <div id="wx-hours"></div>
      <div class="wx-cap">Hour by hour</div>
      <div id="wx-list"></div>`;
    document.body.appendChild(el);
    this.overlay = el;
    el.querySelector('#wx-close').onclick = () => this.closeOverlay();
  },

  buildWeekOverlay() {
    const el = document.createElement('div');
    el.id = 'wk-overlay';
    el.innerHTML = `
      <header>
        <h2>The week ahead</h2><span class="sub" id="wk-where"></span>
        <span class="spacer"></span>
        <button id="wk-close">Close</button>
      </header>
      <div id="wk-now"></div>
      <div id="wk-week"></div>
      <div id="wk-foot"></div>`;
    document.body.appendChild(el);
    this.week = el;
    el.querySelector('#wk-close').onclick = () => this.closeWeek();
  },

  openOverlay() {
    if (!this.data || !this.data.hourly.length) return;
    this.closeWeek();          // never two sheets over each other
    this.renderOverlay();
    this.overlay.classList.add('open');
  },

  closeOverlay() { this.overlay.classList.remove('open'); },

  openWeek() {
    if (!this.data || !this.data.hourly.length) return;
    this.closeOverlay();
    this.renderWeek();
    this.week.classList.add('open');
  },

  closeWeek() { this.week.classList.remove('open'); },

  async refresh() {
    try {
      this.data = await (await fetch('/api/weather')).json();
    } catch {
      return; // keep the last good render; the clock still ticks
    }
    this.render();
    if (this.overlay.classList.contains('open')) this.renderOverlay();
    if (this.week.classList.contains('open')) this.renderWeek();
  },

  /* index of the hour containing "now", or -1 */
  nowIndex(hours) {
    const now = new Date();
    return hours.findIndex((h) => {
      const d = new Date(h.t);
      return d.getDate() === now.getDate() && d.getHours() === now.getHours();
    });
  },

  render() {
    const d = this.data;
    if (!d || !d.hourly.length) {
      this.band.innerHTML = `<div class="placeholder">${(d && d.error) || 'no forecast yet'}</div>`;
      this.syncArrows();
      return;
    }
    const hours = d.hourly;
    const i = Math.max(0, this.nowIndex(hours));
    const slice = hours.slice(i, i + BAND_HOURS);

    const now = hours[i] || hours[0];
    document.getElementById('now-icon').innerHTML = icon(now.code, now.day);
    document.getElementById('now-temp').textContent = `${Math.round(now.temp)}°`;
    document.getElementById('now-cond').textContent = describe(now.code);
    document.getElementById('now-rain').textContent =
      now.pp != null && now.pp >= 10 ? `${now.pp}% rain` : '';
    document.getElementById('now-city').textContent = d.city || '';
    document.getElementById('now-stale').textContent = d.stale
      ? `as of ${this.hhmm(d.fetched_at * 1000)}` : '';
    this.paintMirror();

    // Midnight starts a new day: it names its weekday and carries a divider,
    // so hours scrolled in from tomorrow are never mistaken for today's.
    this.band.innerHTML = slice.map((h, n) => {
      const dt = new Date(h.t);
      const rp = h.pp || 0;
      const midnight = dt.getHours() === 0;
      // A bare "14" beside a bare "20°" is two numbers with nothing to tell
      // them apart. "14:00" is unmistakably a clock time at a glance.
      const label = n === 0 ? 'now'
        : midnight ? dt.toLocaleDateString(undefined, { weekday: 'short' })
        : `${String(dt.getHours()).padStart(2, '0')}:00`;
      const cls = ['hr'];
      if (n === 0) cls.push('now');
      if (!h.day) cls.push('night');
      if (midnight && n !== 0) cls.push('newday');
      return `<div class="${cls.join(' ')}">
        <div class="hr-h">${label}</div>
        <div class="hr-ico">${icon(h.code, h.day)}</div>
        <div class="hr-t">${Math.round(h.temp)}°</div>
        <div class="hr-f">${rp >= 20 ? `<i></i>${rp}%` : ''}</div>
      </div>`;
    }).join('');
    this.band.classList.toggle('weather-stale', !!d.stale);
    this.band.scrollLeft = 0;   // a refresh always brings "now" back into view
    this.syncArrows();
  },

  hhmm(ms) {
    return new Date(ms)
      .toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false });
  },

  /* What it is now, and what it feels like — the two are the same number often
     enough that showing "feels like" only when they differ makes its absence
     meaningful rather than missing. Drawn into whichever sheet asked. */
  nowBlock(now) {
    const feelsNow = now.feels == null ? ''
      : Math.round(now.feels) === Math.round(now.temp)
        ? '<span class="n-same">feels the same</span>'
        : `<span class="n-feels">feels like <b>${Math.round(now.feels)}°</b></span>`;
    return `
      <div class="n-ico">${icon(now.code, now.day)}</div>
      <div class="n-temp">${Math.round(now.temp)}°</div>
      <div class="n-txt">
        <div class="n-desc">${describe(now.code)}</div>
        <div class="n-sub">${feelsNow}${
          now.pp != null && now.pp >= 10 ? `<span class="n-rain">${now.pp}% rain</span>` : ''}</div>
      </div>`;
  },

  /* One tile per reading, and only for the ones that came back. A backend
     older than these fields sends none of them and the strip simply does not
     appear — the frontend deploys on its own, so that pairing is a normal
     state rather than a broken one. */
  factTiles(h) {
    const uv = uvBand(h.uv);
    const aq = aqiBand(h.aqi);
    const tiles = [
      h.feels != null && ['Feels like', `${Math.round(h.feels)}°`,
        Math.round(h.feels) === Math.round(h.temp) ? 'the same as it is' : '', ''],
      h.rh != null && ['Humidity', `${Math.round(h.rh)}%`, humidityWord(h.rh), ''],
      uv && ['UV index', String(uv.n), uv.word, uv.cls],
      aq && ['Air quality', String(aq.n), `${aq.word}${
        h.pm25 != null ? ` · PM2.5 ${Math.round(h.pm25)}` : ''}`, aq.cls],
      h.wind != null && ['Wind', `${Math.round(h.wind)}<i>km/h</i>`,
        h.gust != null ? `gusting ${Math.round(h.gust)}` : '', ''],
      h.pp != null && ['Chance of rain', `${Math.round(h.pp)}%`, '', h.pp >= 50 ? 'wet' : ''],
      h.cloud != null && ['Cloud', `${Math.round(h.cloud)}%`, '', ''],
      h.press != null && ['Pressure', `${Math.round(h.press)}<i>hPa</i>`, '', ''],
    ].filter(Boolean);

    if (!tiles.length) return '';
    return tiles.map(([cap, val, sub, cls]) => `
      <div class="wx-fact${cls ? ` f-${cls}` : ''}">
        <div class="f-cap">${cap}</div>
        <div class="f-val">${val}</div>
        <div class="f-sub">${sub || ''}</div>
      </div>`).join('');
  },

  renderOverlay() {
    const start = Math.max(0, this.nowIndex(this.data.hourly));
    const hours = this.data.hourly.slice(start, start + 48);
    const temps = hours.map((h) => h.temp);
    const lo = Math.min(...temps), hi = Math.max(...temps);
    const span = Math.max(1, hi - lo);
    const now = hours[0] || {};

    document.getElementById('wx-where').textContent = this.data.city || '';
    document.getElementById('wx-now').innerHTML = this.nowBlock(now);

    const facts = document.getElementById('wx-facts');
    facts.innerHTML = this.factTiles(now);
    facts.hidden = !facts.innerHTML;

    document.getElementById('wx-hours').innerHTML = hours.map((h, n) => {
      const dt = new Date(h.t);
      const bh = 20 + Math.round(((h.temp - lo) / span) * 80);
      const label = n === 0 ? 'now' : String(dt.getHours()).padStart(2, '0');
      // Label every third hour so 48 columns stay readable.
      return `<div class="wx-h${h.day ? '' : ' night'}">
        <div class="t">${n % 3 === 0 ? `${Math.round(h.temp)}°` : ''}</div>
        <div class="col"><i style="height:${bh}%"><b style="height:${h.pp || 0}%"></b></i></div>
        <div class="h">${n % 3 === 0 ? label : ''}</div>
      </div>`;
    }).join('');

    /* A row an hour. The columns are fixed-width and every cell keeps its
       column even when the reading is missing, so the eye runs down "humidity"
       rather than hunting for it on each line. */
    document.getElementById('wx-list').innerHTML = hours.slice(0, 24).map((h, n) => {
      const dt = new Date(h.t);
      const uv = uvBand(h.uv);
      const aq = aqiBand(h.aqi);
      return `<div class="wx-hr${h.day ? '' : ' night'}${n === 0 ? ' now' : ''}">
        <div class="hr-when">${n === 0 ? 'now'
          : `${String(dt.getHours()).padStart(2, '0')}:00`}</div>
        <div class="hr-i">${icon(h.code, h.day)}</div>
        <div class="hr-tt">${Math.round(h.temp)}°</div>
        <div class="hr-fl">${h.feels == null ? '' : `feels ${Math.round(h.feels)}°`}</div>
        <div class="hr-d">${describe(h.code)}</div>
        <div class="hr-c hr-rain">${h.pp != null && h.pp >= 10 ? `${Math.round(h.pp)}%` : ''}</div>
        <div class="hr-c">${h.rh == null ? '' : `${Math.round(h.rh)}%`}</div>
        <div class="hr-c${uv ? ` f-${uv.cls}` : ''}">${uv && uv.n > 0 ? `UV ${uv.n}` : ''}</div>
        <div class="hr-c${aq ? ` f-${aq.cls}` : ''}">${aq ? `AQI ${aq.n}` : ''}</div>
        <div class="hr-c">${h.wind == null ? '' : `${Math.round(h.wind)} km/h`}</div>
      </div>`;
    }).join('');
  },

  renderWeek() {
    const start = Math.max(0, this.nowIndex(this.data.hourly));
    const hours = this.data.hourly.slice(start, start + 48);
    const now = hours[0] || {};

    document.getElementById('wk-where').textContent = this.data.city || '';
    document.getElementById('wk-now').innerHTML = this.nowBlock(now);

    /* The week, from Open-Meteo's own daily figures rather than folded up out
       of the hours: only the first two days have hours to fold. Each row
       carries the real high and low, what those two will feel like, and when
       the sun is up — the two questions a day gets asked in a kitchen. */
    const week = this.data.daily || [];
    document.getElementById('wk-week').innerHTML = !week.length
      ? '<p class="wx-none">No week ahead yet — the forecast has not arrived.</p>'
      : week.map((d, n) => {
        const dt = new Date(`${d.d}T12:00:00`);
        const name = n === 0 ? 'Today' : n === 1 ? 'Tomorrow'
          : dt.toLocaleDateString(undefined, { weekday: 'long' });
        const feels = d.fmax == null ? ''
          : `<span class="w-feels">feels ${Math.round(d.fmax)}° / ${Math.round(d.fmin)}°</span>`;
        const sun = d.sunrise && d.sunset
          ? `<span class="w-sun">☀ ${this.hhmm(Date.parse(d.sunrise))} – ${
              this.hhmm(Date.parse(d.sunset))}</span>` : '';
        const uv = uvBand(d.uv);
        return `<div class="wx-wday${n === 0 ? ' today' : ''}">
          <div class="w-name">${name}<span>${
            dt.toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}</span></div>
          <div class="w-ico">${icon(d.code, 1)}</div>
          <div class="w-desc">${describe(d.code)}</div>
          <div class="w-rain">${d.pp != null && d.pp >= 20 ? `${d.pp}%` : ''}</div>
          <div class="w-uv${uv ? ` f-${uv.cls}` : ''}">${uv && uv.n > 0 ? `UV ${uv.n}` : ''}</div>
          <div class="w-temp">${Math.round(d.tmax)}°<span>${Math.round(d.tmin)}°</span></div>
          <div class="w-feels-wrap">${feels}${sun}</div>
        </div>`;
      }).join('');

    const today = hours.slice(0, 24);
    const rain12 = hours.slice(0, 12).reduce((a, h) => Math.max(a, h.pp || 0), 0);
    const feels24 = today.map((h) => h.feels).filter((f) => f != null);
    document.getElementById('wk-foot').innerHTML = `
      <div><span class="cap">Low / high next 24 h</span>
        <span class="val">${Math.round(Math.min(...today.map((h) => h.temp)))}° / ${Math.round(Math.max(...today.map((h) => h.temp)))}°</span></div>
      <span class="sep"></span>
      ${feels24.length ? `<div><span class="cap">Feels like, next 24 h</span>
        <span class="val">${Math.round(Math.min(...feels24))}° / ${Math.round(Math.max(...feels24))}°</span></div>
      <span class="sep"></span>` : ''}
      <div><span class="cap">Highest chance of rain, next 12 h</span>
        <span class="val rain">${rain12}%</span></div>
      <span class="sep"></span>
      <div><span class="cap">Updated</span>
        <span class="val">${this.hhmm(this.data.fetched_at * 1000)}</span></div>`;
  },
};
