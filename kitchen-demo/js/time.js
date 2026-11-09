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
//
// The larger half of it is a calendar: this month and the eleven after it,
// with the countdown's days filled in the colour each event wears. The next
// few events are a list; the shape of the year — which weeks are already
// spoken for, how far apart the holidays fall — is only visible laid out as a
// year. Any day of it opens — coloured or not, because a day with nothing on
// it is exactly the day something is being put on — saying what is already
// there and offering a new event on it, which goes back through the same
// /api/countdown the Countdown panel saves to. calendar.js draws the months,
// holds the date arithmetic and builds that list, so a test can check them
// without a browser; this file owns the taps, the form and the fetching.

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

/* The four accents in the order the countdown editor puts them, with the names
   it gives them: this is the second place on the wall that picks a colour for
   an event, and two rows of the same four swatches in two different orders is
   a way to pick the wrong one. calendar.js owns the list itself (the server
   agrees with it); this only decides the order they are drawn in. */
const ACCENT_NAMES = [
  ['food', 'Terracotta'],
  ['house', 'Green'],
  ['birds', 'Blue'],
  ['photos', 'Amber'],
];

const DEFAULT_CLOCKS = [
  { label: 'Istanbul', tz: 'Europe/London' },
  { label: 'Ruse', tz: 'America/New_York' },
  { label: 'Tokyo', tz: 'Asia/Tokyo' },
  { label: 'Washington', tz: 'America/New_York' },
];

export default {
  /* `cal` is calendar.js, loaded by app.js with the build stamp like every
     other module (a bare import from here would not carry it). */
  init(ctx, cal, chime) {
    this.ctx = ctx;
    this.cal = cal;
    /* chime.js, or null in the demo, which has no sounds to strike with. The
       gear hides itself in that case rather than opening an empty sheet. */
    this.chime = chime || null;
    this.events = [];
    this.timers = [];
    this.skew = 0;          // server clock minus this browser's, in seconds
    this.open = false;
    this.calShift = 0;      // months the calendar has been stepped, in twelves
    this.sel = null;        // the day last tapped, "YYYY-MM-DD"
    this.calToday = '';     // the day the calendar was last drawn on
    this.newAccent = 'food';   // the colour the new-event form is offering

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
    this.wire(document.querySelector('.hd-clock'));

    // Both panels' state, on the bus they already publish it to. Every event
    // is kept, past ones too: the list shows what is coming and the calendar
    // the whole year, muted where it has been.
    ctx.bus.on('countdown', (events) => {
      if (!Array.isArray(events)) return;
      this.events = events;
      if (this.open) { this.paintEvents(); this.paintCalendar(); }
    });
    ctx.bus.on('timers', (rows) => {
      if (Array.isArray(rows)) { this.timers = rows; if (this.open) this.paintTimers(); }
    });
  },

  /* A clock that opens this sheet. The top bar's is one; the clock a panel
     carries up into its own header when it fills the screen is the other —
     and over a picture that one has the date under it, so "tap the time or
     the date" is true wherever either is on the glass. The header's copy
     stops the tap there (`stop`): it sits inside a panel's header, and nothing
     under it should hear a tap that was meant for the clock. */
  wire(el, { stop = false } = {}) {
    if (!el) return;
    el.classList.add('tappable');
    el.setAttribute('role', 'button');
    el.setAttribute('tabindex', '0');
    el.setAttribute('aria-label', 'the calendar, clocks, countdowns and the kitchen timers');
    el.addEventListener('click', (e) => {
      if (stop) e.stopPropagation();
      this.openSheet();
    });
    el.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter' && e.key !== ' ') return;
      e.preventDefault();
      if (stop) e.stopPropagation();
      this.openSheet();
    });
  },

  /* A button of somebody else's in this sheet's header, beside the hour's ⚙
     and before Close — how night mode (night.js) puts its 🌙 here: its
     settings are about the clock at night, and this screen is the clock.
     Not app.js's ctx.addHeaderButton(), which is a panel's header. Returns the
     button, or null before the sheet is built. */
  addHeaderButton({ glyph, title, onClick }) {
    const close = this.el?.querySelector('#ts-close');
    if (!close) return null;
    const b = document.createElement('button');
    b.className = 'ts-gear';
    b.textContent = glyph;
    b.title = title;
    b.setAttribute('aria-label', title);
    b.onclick = onClick;
    close.before(b);
    return b;
  },

  /* Two columns, and no page scroll: the year on the left, where it has the
     room for twelve months at a size read from across the kitchen, and
     today's answers down the right — the time, the places, the dials, and the
     countdown, which is the one list long enough to scroll (inside itself)
     and which doubles as the calendar's key, its rows edged in the same
     colours the days are filled with. */
  build() {
    const el = document.createElement('div');
    el.id = 'ts-overlay';
    el.innerHTML = `
      <header>
        <h2>Time</h2><span class="sub" id="ts-here-where"></span>
        <span class="spacer"></span>
        <!-- The clock is the only thing on this screen that can make a noise,
             so its settings belong in this header — and on its own card,
             Clock sounds on House → More. chime.js owns the sheet; this is
             one way in. -->
        <button id="ts-gear" class="ts-gear" aria-label="Clock sounds: what the clock sounds on the hour"
                title="clock sounds">⚙</button>
        <button id="ts-close">Close</button>
      </header>
      <div class="ts-body">
        <section class="ts-cal">
          <div class="cal-head">
            <div class="cal-range" id="ts-cal-range"></div>
            <span class="spacer"></span>
            <button class="cal-now" hidden>This year</button>
            <button class="cal-step" data-step="-12" aria-label="the twelve months before">‹</button>
            <button class="cal-step" data-step="12" aria-label="the twelve months after">›</button>
          </div>
          <div class="cal-cap" id="ts-cal-cap"></div>
          <div class="cal-day" id="ts-cal-day" hidden>
            <div class="cal-dh" id="ts-cal-dh"></div>
            <div class="cal-form" id="ts-cal-form" hidden>
              <input class="cd-in" id="ts-nv-title" type="text" maxlength="80"
                     placeholder="What is happening"
                     autocomplete="off" autocorrect="off" spellcheck="false">
              <div class="cd-accents" id="ts-nv-accents"></div>
              <button class="cd-cancel" id="ts-nv-cancel">Cancel</button>
              <button class="cd-save" id="ts-nv-save" disabled>Save</button>
              <!-- Under the row rather than in it: a refusal is a sentence, and
                   in the row it pushed Save onto a line of its own. It takes
                   the hint's line, which has been read by then anyway. -->
              <p class="cal-msg" id="ts-nv-msg" hidden></p>
              <p class="cd-hint">Typing needs a keyboard, which the wall has not got —
                open this page on a phone to name an event.</p>
            </div>
          </div>
          <div class="cal-months" id="ts-cal-months"></div>
        </section>
        <section class="ts-side">
          <div id="ts-here"></div>
          <div class="wx-cap">Around the world</div>
          <div id="ts-clocks"></div>
          <div class="wx-cap">Kitchen timers</div>
          <div id="ts-timers"></div>
          <div class="wx-cap">Counting down</div>
          <div id="ts-events"></div>
        </section>
      </div>`;
    document.body.appendChild(el);
    this.el = el;
    el.querySelector('#ts-close').onclick = () => this.closeSheet();

    /* The gear opens the chime's sheet over this one — it is settings about
       the clock, and the clock is what this screen is. Without chime.js there
       is nothing to open, so the button goes rather than sitting there dead. */
    const gear = el.querySelector('#ts-gear');
    if (this.chime) gear.onclick = () => this.chime.open();
    else gear.remove();

    // A year at a time, because the window is a year: one press shows the
    // twelve months after these, and "This year" is the way home from there.
    const step = (shift) => {
      this.calShift = shift;
      this.sel = null;
      this.paintCalendar();
      this.markRows();
    };
    el.querySelectorAll('.cal-step').forEach((b) => {
      b.onclick = () => step(this.calShift + Number(b.dataset.step));
    });
    el.querySelector('.cal-now').onclick = () => step(0);
    el.querySelector('#ts-cal-months').addEventListener('click', (e) => {
      const day = this.dayAt(e);
      this.select(day ? day.dataset.d : null);
    });
    // The other way round: a row in the list lights its day in the calendar,
    // stepping the year if that day is outside the twelve months on show. A
    // trip already under way lights today, not its first day: that may be in
    // a month gone by, off the twelve on show, and today is one of its days.
    el.querySelector('#ts-events').addEventListener('click', (e) => {
      const row = e.target.closest('.ts-row[data-date]');
      if (!row) return;
      const today = this.cal.isoDay(new Date());
      this.select(row.dataset.date < today ? today : row.dataset.date, { scroll: false });
    });
    this.wireForm();
  },

  /* The new-event form is built once and wired once, and then only shown and
     hidden. It would be simpler to render it with the day it belongs to — but
     the day panel is redrawn whenever the countdown changes, and somebody
     else's save landing while a title is half typed must not take the half
     back, nor the caret with it. */
  wireForm() {
    if (!this.cal) return;      // no calendar module, no days to add one to
    const title = document.getElementById('ts-nv-title');
    const save = document.getElementById('ts-nv-save');
    document.getElementById('ts-nv-accents').innerHTML = ACCENT_NAMES
      .filter(([a]) => this.cal.ACCENTS.includes(a))
      .map(([a, name]) => `<button class="cd-acc a-${a}" data-accent="${a}"
             title="${name}" aria-label="${name}"></button>`).join('');
    this.paintAccents();
    document.getElementById('ts-nv-accents').onclick = (e) => {
      const btn = e.target.closest('.cd-acc');
      if (!btn) return;
      this.newAccent = btn.dataset.accent;
      this.paintAccents();
    };
    // An empty title is not a save and never was: rather than refusing one
    // with a message, Save is simply not a button yet.
    title.oninput = () => {
      save.disabled = !title.value.trim();
      this.formMsg('');
    };
    document.getElementById('ts-nv-cancel').onclick = () => this.closeForm();
    save.onclick = () => this.saveNew();
  },

  openSheet() {
    this.open = true;
    this.el.classList.add('open');
    // Every opening starts at this month with nothing picked: the sheet is
    // opened to ask about now, not to resume somebody else's browsing.
    this.calShift = 0;
    this.sel = null;
    this.paintEvents();
    this.paintCalendar();
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
        if (Array.isArray(res.events)) {
          this.events = res.events;
          if (this.open) { this.paintEvents(); this.paintCalendar(); }
        }
      }
    } catch { /* likewise */ }
  },

  /* Every second: the clocks, and the dials that are running. Nothing else
     moves that fast, so nothing else is redrawn here. */
  tick() {
    const now = new Date();
    // Midnight with the sheet open: today's ring moves on, yesterday's events
    // go muted and leave the list, and on the 1st the year starts a month on.
    if (this.cal && this.cal.isoDay(now) !== this.calToday) {
      this.paintCalendar();
      this.paintEvents();
    }
    // On its day a timed event counts its minutes, so the list goes along
    // once a minute while one is (`counting`, set by paintEvents()).
    const minute = Math.floor(now / 60000);
    if (minute !== this.evMinute) {
      this.evMinute = minute;
      if (this.counting) this.paintEvents();
    }
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

  /* What is coming, as the Countdown panel counts it — calendar.js says when
     each is next (a yearly one comes back, a trip stays while it is on) and
     in the same words, lower-cased to sit under the number. A row's day is
     the one it is next on, which is the day a tap on it lights. */
  paintEvents() {
    const box = document.getElementById('ts-events');
    const cal = this.cal;
    if (!box || !cal) return;
    const now = new Date();
    const list = cal.upcoming(this.events, cal.isoDay(now));
    this.counting = list.some((e) => e.occ.n === 0 && e.occ.time);
    if (!list.length) {
      box.innerHTML = '<p class="wx-none">Nothing coming up.</p>';
      return;
    }
    box.innerHTML = list.map((e) => {
      const o = e.occ;
      const [y, m, d] = o.start.split('-').map(Number);
      // A trip as its run of days, "October 24 – 30", as the cards say it.
      const when = o.days > 1 ? cal.dayRange(o.start, o.end)
        : new Date(y, m - 1, d).toLocaleDateString(undefined,
          { weekday: 'long', day: 'numeric', month: 'long' });
      const t = o.n >= 0 ? cal.timeLabel(e, o) : '';
      const w = cal.countWords(o, now);
      return `<div class="ts-row a-${esc(e.accent || 'food')}" data-date="${esc(o.start)}"
        data-end="${esc(o.end)}">
        <div class="ts-rname"><div class="ts-rt">${esc(cal.shownTitle(e, o))}</div><span>${esc(when)}${
          t ? ` · ${esc(t)}` : ''}${e.note ? ` · ${esc(e.note)}` : ''}</span></div>
        <div class="ts-rleft">${esc(w.num)}</div>
        <div class="ts-rstate">${esc(w.unit.toLowerCase())}</div>
      </div>`;
    }).join('');
    this.markRows();
  },

  /* ---------- the calendar ---------- */

  /* Drawn whole every time — twelve small grids are nothing to rebuild, and a
     calendar patched in place is one that can keep yesterday's ring. On open,
     when the countdown changes, when the year is stepped, and at midnight. */
  paintCalendar() {
    const cal = this.cal;
    const box = document.getElementById('ts-cal-months');
    if (!cal || !box) return;
    const now = new Date();
    this.calToday = cal.isoDay(now);

    const months = cal.monthsFrom(now.getFullYear(), now.getMonth() + this.calShift, 12);
    // The twelve months' days: a yearly event is on its day in whichever year
    // is on show, and a trip on every one of its days.
    this.calDays = cal.eventDays(this.events, cal.windowOf(months));
    this.calWindow = months;
    document.getElementById('ts-cal-range').textContent = cal.rangeLabel(months);
    this.el.querySelector('.cal-now').hidden = this.calShift === 0;
    box.innerHTML = cal.monthsHtml({
      start: months[0], today: this.calToday, selected: this.sel, days: this.calDays,
    });
    this.paintDay();
  },

  /* Under the header, one of two things: the line that says how to pick a day,
     or the day that has been picked. They are the same height, so tapping
     around the calendar never moves the months under it; only opening the form
     takes room from them, and it gives it straight back.

     Built out of nodes with textContent rather than a string of markup: the
     titles are typed by hand, on a phone, by somebody who is not thinking
     about angle brackets. */
  paintDay() {
    const cal = this.cal;
    const cap = document.getElementById('ts-cal-cap');
    const day = document.getElementById('ts-cal-day');
    if (!cap || !day) return;
    cap.hidden = !!this.sel;
    day.hidden = !this.sel;

    if (!this.sel) {
      this.closeForm();
      const inView = [...this.calDays.keys()].some((iso) => {
        const [y, m] = iso.split('-').map(Number);
        return this.calWindow.some((mo) => mo.year === y && mo.month === m - 1);
      });
      cap.textContent = inView
        ? 'Tap any day to open it — the coloured ones are already in the countdown.'
        : 'Nothing in the countdown falls in these twelve months — tap any day to put something in one.';
      return;
    }

    const list = this.calDays.get(this.sel) || [];
    const head = document.getElementById('ts-cal-dh');
    head.textContent = '';
    if (list.length) {
      const fill = cal.dayFill(list);
      const sw = document.createElement('span');
      sw.className = `cal-sw${fill.cls}`;
      sw.style.cssText = fill.style;
      head.append(sw);
    }
    const label = document.createElement('div');
    label.className = 'cal-dl';
    label.textContent = cal.dayLabel(this.sel);
    const evs = document.createElement('div');
    evs.className = 'cal-devs';
    if (list.length) {
      for (const e of list) {
        const chip = document.createElement('span');
        chip.className = `cal-dev a-${e.accent}`;
        // "Mormor turns 76", "Tandläkare · kl. 09:00", "Lesjön · day 3 of 7".
        chip.append(document.createElement('i'), cal.dayLine(e));
        evs.append(chip);
      }
    } else {
      const none = document.createElement('span');
      none.className = 'cal-dnone';
      none.textContent = 'Nothing on this day.';
      evs.append(none);
    }
    const spacer = document.createElement('span');
    spacer.className = 'spacer';
    const add = document.createElement('button');
    add.className = 'cal-new';
    add.textContent = '+ New event on this day';
    add.onclick = () => this.openForm();
    // The button follows the day rather than sitting at the far right of the
    // row: right-aligned it landed directly under ›, and a miss there steps
    // the calendar a year instead of opening a form.
    head.append(label, evs, add, spacer);
  },

  paintAccents() {
    for (const b of document.querySelectorAll('#ts-nv-accents .cd-acc')) {
      b.classList.toggle('on', b.dataset.accent === this.newAccent);
    }
  },

  formMsg(text) {
    const msg = document.getElementById('ts-nv-msg');
    if (!msg) return;
    msg.textContent = text;
    msg.hidden = !text;
  },

  /* Empty every time. An event is one thing on one day, and a form that
     remembered the last one would offer to add it twice. */
  openForm() {
    const title = document.getElementById('ts-nv-title');
    this.newAccent = 'food';
    title.value = '';
    this.paintAccents();
    this.formMsg('');
    document.getElementById('ts-nv-save').disabled = true;
    document.getElementById('ts-cal-form').hidden = false;
    // On the wall this does nothing visible; on the phone it is what the
    // keyboard comes up for, which is the screen this form is really for.
    title.focus();
  },

  closeForm() {
    const form = document.getElementById('ts-cal-form');
    if (form) form.hidden = true;
  },

  /* Saving is the whole list, which is the only thing /api/countdown takes —
     so the list is read again first. This sheet may have been open for hours,
     and a phone in the other room may have added something to it since; a PUT
     of the copy on this screen would quietly delete that. */
  async saveNew() {
    const cal = this.cal;
    const input = document.getElementById('ts-nv-title');
    const save = document.getElementById('ts-nv-save');
    const title = input.value.trim();
    if (!title || !this.sel || save.disabled) return;
    const word = save.textContent;
    save.disabled = true;
    save.textContent = 'Saving…';
    this.formMsg('');
    try {
      const r = await fetch('/api/countdown');
      if (!r.ok) throw new Error('read');
      const next = cal.withEvent((await r.json()).events,
        { date: this.sel, title, accent: this.newAccent });
      if (next.error) throw new Error(next.error);
      const w = await fetch('/api/countdown', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ events: next.events }),
      });
      if (!w.ok) throw new Error('write');
      // Nothing is painted from here. The server announces the new list on the
      // countdown bus and the calendar, the caption and the Counting-down list
      // all redraw from that — the same path a save from a phone takes, and
      // the only one that cannot show something the server did not keep.
      this.closeForm();
    } catch (err) {
      this.formMsg(err.message === 'full'
        ? `The countdown is full at ${cal.MAX_EVENTS} events — remove one in the Countdown panel first.`
        : 'Could not save — try again');
      save.disabled = false;   // what was typed is still in the box
    } finally {
      save.textContent = word;
    }
  },

  /* The day a tap meant. A day is a 30px square, well under the 52px a finger
     needs, and twelve months of 52px squares would not fit the wall — so a tap
     goes to the nearest day within about a cell's width rather than asking for
     a bullseye. Measured against the day's own width, so the reach is the same
     at every step of the zoom ladder. The blanks that hold the columns at
     either end of a month are not days: they carry no data-d, and a tap on one
     finds that month's own nearest day instead. */
  dayAt(e) {
    const hit = e.target.closest('.cal-d[data-d]');
    if (hit) return hit;
    const month = e.target.closest('.cal-m');
    if (!month) return null;
    let best = null, bestD = Infinity;
    for (const d of month.querySelectorAll('.cal-d[data-d]')) {
      const r = d.getBoundingClientRect();
      const dist = Math.hypot(e.clientX - (r.left + r.width / 2), e.clientY - (r.top + r.height / 2));
      if (dist < bestD && dist <= r.width * 1.2) { best = d; bestD = dist; }
    }
    return best;
  },

  select(iso, { scroll = true } = {}) {
    const was = this.sel;
    this.sel = this.cal?.fromIso(iso) ? iso : null;
    // Moving to another day puts the form away: it was opened for the day it
    // was opened on, and carrying a half-typed title across to a different
    // date is how the wrong day gets an event on it.
    if (this.sel !== was) this.closeForm();
    // Stepped by whole years until the day is on show, and left as it is
    // when it already is (calendar.js shiftFor()).
    if (this.sel) this.calShift = this.cal.shiftFor(this.sel, new Date(), this.calShift);
    this.paintCalendar();
    this.markRows(scroll);
  },

  /* The picked day's rows in the Counting-down list, lit and brought into
     view. A past day has none — the list is what is still to come — and then
     the caption alone answers. Scrolled by hand rather than scrollIntoView,
     which would scroll the sheet as well: it is overflow:hidden, and a hidden
     overflow is still a scroll container to that call. */
  markRows(scroll = false) {
    const box = document.getElementById('ts-events');
    if (!box) return;
    let first = null;
    for (const row of box.querySelectorAll('.ts-row[data-date]')) {
      // Any day of a trip lights the trip's row.
      const on = !!this.sel && row.dataset.date <= this.sel
        && this.sel <= (row.dataset.end || row.dataset.date);
      row.classList.toggle('hit', on);
      if (on && !first) first = row;
    }
    if (first && scroll) {
      box.scrollTo({ top: Math.max(0, first.offsetTop - 8), behavior: 'smooth' });
    }
  },
};
