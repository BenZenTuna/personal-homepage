// The Time screen, behind the clock in the header.
//
// The clock was the one thing on the wall that was a reading and not a button,
// and the three questions asked around it — what time is it where they are,
// how long until the thing we are counting to, how long has the oven got —
// were spread across a panel, another panel and nowhere at all. They are one
// screen now, opened by tapping the time, in that order: the places first
// because that is the question the clock itself prompts.
//
// It reads state rather than owning it. The timers are the ones in the Cooking
// panel and the events are the ones in the Countdown panel — both arrive on
// the same SSE bus every panel uses, so this screen agrees with them without
// anything having to be kept in step by hand. Setting a timer is still done on
// its dial; this is where you look, not where you cook.

const TICK_MS = 1000;

/* Minutes east of UTC for a zone at a given instant — which is not a constant:
   half of these places change it twice a year, and on different dates from
   each other. Read off the formatter rather than written down anywhere. */
function tzOffsetMinutes(date, tz) {
  const parts = {};
  for (const p of new Intl.DateTimeFormat('en-US', {
    timeZone: tz, hour12: false,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  }).formatToParts(date)) parts[p.type] = p.value;
  const h = parts.hour === '24' ? '00' : parts.hour;   // some engines say 24 for midnight
  const asUTC = Date.UTC(+parts.year, +parts.month - 1, +parts.day,
                         +h, +parts.minute, +parts.second);
  return Math.round((asUTC - date.getTime()) / 60000);
}

/* "+2 h", "−6 h", "+5:45" — the difference from this kitchen, which is the
   only form of it anybody uses: nobody converts through UTC in their head. */
function offsetLabel(mins) {
  if (mins === 0) return 'same time as here';
  const sign = mins > 0 ? '+' : '−';
  const a = Math.abs(mins);
  const h = Math.floor(a / 60), m = a % 60;
  return `${sign}${h}${m ? `:${String(m).padStart(2, '0')}` : ''} h`;
}

/* Whole calendar days between today and the event, counted on local dates —
   the same rounding countdown.js uses, and for the same reason: on the two DST
   days of the year a "day" is 23 or 25 hours long, and flooring would quietly
   report yesterday's number. */
function daysUntil(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  const target = new Date(y, m - 1, d);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return Math.round((target - today) / 86400000);
}

function clock(secs) {
  const s = Math.max(0, Math.round(secs));
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
  const mm = String(m).padStart(h ? 2 : 1, '0');
  return `${h ? `${h}:` : ''}${mm}:${String(sec).padStart(2, '0')}`;
}

function esc(s) {
  return String(s ?? '').replace(/[&<>"]/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

const DEFAULT_CLOCKS = [
  { label: 'Lisbon', tz: 'Europe/Lisbon' },
  { label: 'Berlin', tz: 'Europe/Berlin' },
  { label: 'Tokyo', tz: 'Asia/Tokyo' },
  { label: 'New York', tz: 'America/New_York' },
];

export default {
  init(ctx) {
    this.ctx = ctx;
    this.events = [];
    this.timers = [];
    this.skew = 0;          // server clock minus this browser's, in seconds
    this.open = false;

    const cfg = ctx.config.clocks;
    // A zone the browser has never heard of throws on the first format and
    // would take the whole screen with it, so they are checked once, here.
    this.clocks = (Array.isArray(cfg) && cfg.length ? cfg : DEFAULT_CLOCKS)
      .filter((c) => c && c.tz && c.label)
      .filter((c) => {
        try { new Intl.DateTimeFormat('en-GB', { timeZone: c.tz }); return true; }
        catch { return false; }
      });

    this.build();
    this.wireClock();

    // Both panels' state, on the bus they already publish it to.
    ctx.bus.on('countdown', (events) => {
      if (Array.isArray(events)) { this.events = events; if (this.open) this.paintEvents(); }
    });
    ctx.bus.on('timers', (rows) => {
      if (Array.isArray(rows)) { this.timers = rows; if (this.open) this.paintTimers(); }
    });
  },

  wireClock() {
    const el = document.querySelector('.hd-clock');
    if (!el) return;
    el.classList.add('tappable');
    el.setAttribute('role', 'button');
    el.setAttribute('tabindex', '0');
    el.setAttribute('aria-label', 'clocks, countdowns and the kitchen timers');
    el.addEventListener('click', () => this.openSheet());
    el.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); this.openSheet(); }
    });
  },

  build() {
    const el = document.createElement('div');
    el.id = 'ts-overlay';
    el.innerHTML = `
      <header>
        <h2>Time</h2><span class="sub" id="ts-here-where"></span>
        <span class="spacer"></span>
        <button id="ts-close">Close</button>
      </header>
      <div id="ts-here"></div>
      <div class="wx-cap">Around the world</div>
      <div id="ts-clocks"></div>
      <div class="ts-two">
        <div class="ts-half">
          <div class="wx-cap">Kitchen timers</div>
          <div id="ts-timers"></div>
        </div>
        <div class="ts-half">
          <div class="wx-cap">Counting down</div>
          <div id="ts-events"></div>
        </div>
      </div>`;
    document.body.appendChild(el);
    this.el = el;
    el.querySelector('#ts-close').onclick = () => this.closeSheet();
  },

  openSheet() {
    this.open = true;
    this.el.classList.add('open');
    this.paintEvents();
    this.paintTimers();
    this.tick();
    // Only while it is on screen: a second-by-second repaint of a sheet nobody
    // is looking at is the sort of thing that runs for weeks on a wall.
    clearInterval(this.ticker);
    this.ticker = setInterval(() => this.tick(), TICK_MS);
    this.load();
  },

  closeSheet() {
    this.open = false;
    this.el.classList.remove('open');
    clearInterval(this.ticker);
    this.ticker = null;
  },

  /* The bus snapshot already carries both of these, so this is a top-up rather
     than the source: it is here for `now`, which is the server's clock and the
     thing the dials are actually counting against. A backend older than an
     endpoint answers 404, which is "not there", never an answer. */
  async load() {
    try {
      const r = await fetch('/api/timers');
      if (r.ok) {
        const res = await r.json();
        if (Array.isArray(res.timers)) this.timers = res.timers;
        if (res.now) this.skew = res.now - Date.now() / 1000;
        this.paintTimers();
      }
    } catch { /* the bus snapshot is still on screen */ }
    try {
      const r = await fetch('/api/countdown');
      if (r.ok) {
        const res = await r.json();
        if (Array.isArray(res.events)) { this.events = res.events; this.paintEvents(); }
      }
    } catch { /* likewise */ }
  },

  /* Every second: the clocks, and the dials that are running. Nothing else
     moves that fast, so nothing else is redrawn here. */
  tick() {
    const now = new Date();
    document.getElementById('ts-here').innerHTML = `
      <div class="ts-big">${now.toLocaleTimeString('en-GB',
        { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false })}</div>
      <div class="ts-herewhen">${now.toLocaleDateString(undefined,
        { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}</div>`;
    // The place the header already names, rather than a second source of truth
    // for it; the browser's own zone is the fallback when no city is known.
    document.getElementById('ts-here-where').textContent =
      document.getElementById('now-city')?.textContent
      || Intl.DateTimeFormat().resolvedOptions().timeZone || '';

    document.getElementById('ts-clocks').innerHTML = this.clocks.map((c) => {
      const time = now.toLocaleTimeString('en-GB',
        { timeZone: c.tz, hour: '2-digit', minute: '2-digit', hour12: false });
      const date = now.toLocaleDateString(undefined,
        { timeZone: c.tz, weekday: 'short', day: 'numeric', month: 'short' });
      const delta = tzOffsetMinutes(now, c.tz) + now.getTimezoneOffset();
      // Whether it is still last night there, or already tomorrow, is the
      // thing a difference in hours does not say out loud.
      const hereDay = now.toLocaleDateString('en-CA');
      const theirDay = now.toLocaleDateString('en-CA', { timeZone: c.tz });
      const day = theirDay === hereDay ? ''
        : theirDay > hereDay ? 'tomorrow there' : 'still yesterday there';
      const hour = Number(time.slice(0, 2));
      return `<div class="ts-clk${hour < 7 || hour >= 21 ? ' night' : ''}">
        <div class="ts-city">${esc(c.label)}</div>
        <div class="ts-time">${time}</div>
        <div class="ts-when">${date}</div>
        <div class="ts-off">${offsetLabel(delta)}${day ? ` · ${day}` : ''}</div>
      </div>`;
    }).join('');

    if (this.timers.some((t) => t.state === 'running')) this.paintTimers();
  },

  paintTimers() {
    const box = document.getElementById('ts-timers');
    if (!box) return;
    const now = Date.now() / 1000 + this.skew;
    if (!this.timers.length) {
      box.innerHTML = '<p class="wx-none">No timers yet.</p>';
      return;
    }
    const left = (t) => {
      if (t.state === 'running' && t.ends_at != null) return Math.max(0, t.ends_at - now);
      if (t.state === 'paused') return Math.max(0, t.remaining_s ?? 0);
      if (t.state === 'done') return 0;
      return t.duration_s || 0;
    };
    const word = { idle: 'ready', running: 'running', paused: 'paused', done: 'finished' };
    box.innerHTML = this.timers.map((t, i) => `
      <div class="ts-row s-${esc(t.state)}">
        <div class="ts-rname">${esc(t.label || `Timer ${i + 1}`)}</div>
        <div class="ts-rleft">${clock(left(t))}</div>
        <div class="ts-rstate">${word[t.state] || t.state}</div>
      </div>`).join('')
      + '<p class="ts-foot">Set them on the dials in Cooking.</p>';
  },

  paintEvents() {
    const box = document.getElementById('ts-events');
    if (!box) return;
    const list = this.events
      .map((e) => ({ ...e, n: daysUntil(e.date) }))
      .filter((e) => e.n >= 0)
      .sort((a, b) => a.n - b.n);
    if (!list.length) {
      box.innerHTML = '<p class="wx-none">Nothing coming up.</p>';
      return;
    }
    box.innerHTML = list.map((e) => {
      const [y, m, d] = e.date.split('-').map(Number);
      const when = new Date(y, m - 1, d).toLocaleDateString(undefined,
        { weekday: 'long', day: 'numeric', month: 'long' });
      return `<div class="ts-row a-${esc(e.accent || 'food')}">
        <div class="ts-rname">${esc(e.title)}<span>${when}</span></div>
        <div class="ts-rleft">${e.n === 0 ? '' : e.n}</div>
        <div class="ts-rstate">${e.n === 0 ? 'today' : e.n === 1 ? 'day' : 'days'}</div>
      </div>`;
    }).join('');
  },
};
