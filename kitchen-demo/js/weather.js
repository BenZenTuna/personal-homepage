// Weather lives in the header as one block: what it is doing right now, and
// the place it is doing it. Tapping it opens the whole report — the hours, the
// ten days, and every reading behind them.
//
// There was an hourly band beside it, six hours wide and draggable for two
// days. It has gone: the hours it showed are the first rows of the report a
// tap away, and the top bar had exactly one place where something could stand
// that is not available anywhere else on the wall — what the bird box has
// seen. See motionbar.js.
//
// This module still paints three things besides the sheet: the "now" block in
// the header, the small mirror in a full-screen panel's header, and the strip
// of hours down the side of a full-screen picture.

const REFRESH_MS = 10 * 60 * 1000;
// Down the side of a full-screen panel. Twelve reaches this evening from any
// hour of the morning, and twelve rows is what 1080px of panel holds at a size
// readable from the other side of a kitchen.
const COLUMN_HOURS = 12;

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
    /* What it feels like, where there is room to print it — over a picture,
       where this is the only weather on the screen.

       It says "feels the same" rather than going blank when the two agree, and
       that is the opposite of what the countdown chips do. The chips are a row
       of forecasts being compared with each other, where a silent line reads as
       "nothing to say about this one"; this is a single reading somebody looked
       at deliberately, and a figure that vanishes for a week of mild weather
       reads as broken rather than as equal. Same wording as the weather sheet's
       own now-block, which had already settled the question.

       Nothing at all only when the forecast did not carry the field — that is
       "not known", and it is not the same answer. The element is missing in a
       frontend older than this one, which is not an error either. */
    const feels = el.querySelector('.hx-feels');
    if (feels) {
      feels.textContent = now.feels == null ? ''
        : Math.round(now.feels) === Math.round(now.temp) ? 'feels the same'
        : `feels ${Math.round(now.feels)}°`;
    }
  },

  /* The hours down the left of a panel that has taken the whole screen.

     The picture is the screen now and is centred on the whole of it, so this
     is a thin strip lying over the bottom half of it rather than a column cut
     out of the width: the hour and its glyph, nothing else, faint enough to
     read the photograph through. The temperature is not repeated here — the
     top bar's band carries it, and every reading is in the two sheets behind
     the clock and the "now" block.

     Handed the element to fill, or null when the panel closes. Same contract
     as mirror() above, and painted from the same render(). */
  column(el) {
    this.columnEl = el || null;
    this.paintColumn();
  },

  paintColumn() {
    const el = this.columnEl;
    if (!el) return;
    const d = this.data;
    if (!d || !d.hourly?.length) {
      el.innerHTML = '<div class="wxc-none">no forecast yet</div>';
      return;
    }
    const hours = d.hourly;
    const i = Math.max(0, this.nowIndex(hours));
    el.classList.toggle('weather-stale', !!d.stale);
    el.innerHTML = hours.slice(i, i + COLUMN_HOURS).map((h, n) => {
      const dt = new Date(h.t);
      const midnight = dt.getHours() === 0;
      // Same labelling as the header band: "now" first, and a weekday where a
      // new day starts, because "00:00" alone never says which day it opens.
      const label = n === 0 ? 'now'
        : midnight ? dt.toLocaleDateString(undefined, { weekday: 'short' })
        : `${String(dt.getHours()).padStart(2, '0')}:00`;
      const cls = ['wxc-h'];
      if (n === 0) cls.push('now');
      if (!h.day) cls.push('night');
      if (midnight && n !== 0) cls.push('newday');
      return `<div class="${cls.join(' ')}">
        <span class="wxc-t">${label}</span>
        <span class="wxc-ico">${icon(h.code, h.day)}</span>
      </div>`;
    }).join('');
  },

  init() {
    this.buildOverlay();
    this.wireNow();
    this.refresh();
    setInterval(() => this.refresh(), REFRESH_MS);
  },

  /* The "now" block is the short version of the report, so it is the button
     the report lives behind. A wall screen has no hover to say that a reading
     is also a button, which is why it gets a lit border when pressed. */
  wireNow() {
    const el = document.querySelector('.hd-now');
    if (!el) return;
    el.classList.add('tappable');
    el.setAttribute('role', 'button');
    el.setAttribute('tabindex', '0');
    el.setAttribute('aria-label', 'the full forecast');
    el.addEventListener('click', () => this.openOverlay());
    el.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); this.openOverlay(); }
    });
  },

  /* The hours, in detail. What a temperature on its own does not answer:
     what it feels like, how wet the air is, whether the sun will burn, what
     you are breathing — then the same, hour by hour, down the screen. */
  buildOverlay() {
    const el = document.createElement('div');
    el.id = 'wx-overlay';
    el.innerHTML = `
      <header>
        <h2>Weather</h2><span class="sub" id="wx-where"></span>
        <span class="spacer"></span>
        <button id="wx-close">Close</button>
      </header>
      <div id="wx-now"></div>
      <div id="wx-facts"></div>
      <div id="wx-split">
        <section>
          <div class="wx-cap">Hour by hour</div>
          <div id="wx-list"></div>
        </section>
        <section>
          <div class="wx-cap">The next ten days</div>
          <div id="wk-week"></div>
        </section>
      </div>
      <div id="wk-foot"></div>`;
    document.body.appendChild(el);
    this.overlay = el;
    el.querySelector('#wx-close').onclick = () => this.closeOverlay();
  },

  /* One sheet, whichever summary was tapped. The band and the "now" block are
     two summaries of the same forecast, and two sheets put the hours and the
     days a Close and a second tap apart — each opening with the same "now"
     block at the top of it, which is how obvious it was that they were one
     screen. The hours and the ten days sit side by side here, both in view,
     because those are the two questions a kitchen asks the weather. */
  openOverlay() {
    if (!this.data || !this.data.hourly.length) return;
    this.renderOverlay();
    this.overlay.classList.add('open');
  },

  closeOverlay() { this.overlay.classList.remove('open'); },

  async refresh() {
    try {
      this.data = await (await fetch('/api/weather')).json();
    } catch {
      return; // keep the last good render; the clock still ticks
    }
    this.render();
    if (this.overlay.classList.contains('open')) this.renderOverlay();
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
    if (!d || !d.hourly.length) return;   // the header keeps its last good reading
    const hours = d.hourly;
    const i = Math.max(0, this.nowIndex(hours));
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
    this.paintColumn();
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
    const now = hours[0] || {};

    document.getElementById('wx-where').textContent = this.data.city || '';
    document.getElementById('wx-now').innerHTML = this.nowBlock(now);

    const facts = document.getElementById('wx-facts');
    facts.innerHTML = this.factTiles(now);
    facts.hidden = !facts.innerHTML;

    /* A row an hour. The columns are fixed-width and every cell keeps its
       column even when the reading is missing, so the eye runs down "humidity"
       rather than hunting for it on each line. */
    document.getElementById('wx-list').innerHTML = hours.map((h, n) => {
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

    this.renderWeek();
  },

  renderWeek() {
    const start = Math.max(0, this.nowIndex(this.data.hourly));
    const hours = this.data.hourly.slice(start, start + 48);

    /* The days, from Open-Meteo's own daily figures rather than folded up out
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
