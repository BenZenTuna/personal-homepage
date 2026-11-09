// Kitchen dashboard orchestrator: builds the panels, applies layout presets,
// handles expand/hide by touch, and persists every choice server-side so the
// wall screen stays disposable.
//
// Weather is not a panel — it lives in the header and is always visible.

// index.html loads this file with the current build stamped on it. Every
// module below is imported with that same stamp, so one deploy is always one
// version of the code: no panel can arrive from a cache written before it.
const V = new URL(import.meta.url).search;
const load = async (path) => (await import(path + V)).default;

const { createBus, reloadWhenReachable } = await import(`./sse.js${V}`);
const weather = await load('./weather.js');
const motionbar = await load('./motionbar.js');
const climate = await load('./climate.js');
/* Needs attention is new, and a top-bar chip is not worth a wall that will not
   start: a module that fails to load leaves the chip out and the rest as it was. */
const attention = await load('./attention.js').catch((e) => {
  console.error('attention.js did not load', e);
  return null;
});
/* Night mode's dim clock, on the same terms: a clock that will not load is no
   reason for a wall that will not start. */
const night = await load('./night.js').catch((e) => {
  console.error('night.js did not load', e);
  return null;
});
const lightsched = await load('./lightsched.js');
const timeSheet = await load('./time.js');
const calendar = await load('./calendar.js');
const wake = await load('./wake.js');
const doorbell = await load('./doorbell.js');
const chime = await load('./chime.js');
const phonebox = await load('./phonebox.js');
/* The morning brief (brief.py): its card on Automation, and the "Good
   morning" card and voice on the wall. A failure is no reason for no wall. */
const ask = await load('./ask.js').catch((e) => {
  console.error('ask.js did not load', e);
  return null;
});
const brief = await load('./brief.js').catch((e) => {
  console.error('brief.js did not load', e);
  return null;
});
/* Mia's school time alert, on the night clock's terms: a song that will not
   load is no reason for a wall that will not start. */
const school = await load('./school.js').catch((e) => {
  console.error('school.js did not load', e);
  return null;
});
/* Babo Alarm (the kitchen window at night) and the disco: their cards in
   More's bottom row. On the school alert's terms: either failing to load is
   no reason for a wall that will not start. */
const babo = await load('./babo.js').catch((e) => {
  console.error('babo.js did not load', e);
  return null;
});
/* The smoke and heat alarms (2026-10-20): their cards on Automation, their
   sheet and the banner with Silence. Fail-soft like the rest. */
const fireAlarms = await load('./firealarm.js').catch((e) => {
  console.error('firealarm.js did not load', e);
  return null;
});
const disco = await load('./disco.js').catch((e) => {
  console.error('disco.js did not load', e);
  return null;
});
/* The aroma diffuser in the entrance: its card on House → Automation, its
   sheet its own (diffuser.js). Same terms as the disco. */
const diffuser = await load('./diffuser.js').catch((e) => {
  console.error('diffuser.js did not load', e);
  return null;
});
/* The flower alarm's tile document and sheet (soilalarm.js). Like the school
   alert: a sheet that will not load is no reason for a wall that will not. */
const soilAlarm = await load('./soilalarm.js').catch((e) => {
  console.error('soilalarm.js did not load', e);
  return null;
});
/* The temperature, humidity and soil sensors and the room each is in
   (sensors.js, 2026-10-21): a card on Automation and its sheet. Fail-soft:
   without it the readings stay where they were last put. */
const sensors = await load('./sensors.js').catch((e) => {
  console.error('sensors.js did not load', e);
  return null;
});
/* The computers' own temperatures (pctemps.js, 2026-10-22): a card beside the
   sensors' and its sheet, on the same terms — without it the card is not
   drawn, and the chart's tab for them still is. */
const pctemps = await load('./pctemps.js').catch((e) => {
  console.error('pctemps.js did not load', e);
  return null;
});
/* House → Automation's alert cards (Aurora, Radar, House alerts, Servers &
   updates) and the sheet behind their gears. On the same terms: cards that
   will not load are no reason for a wall that will not. */
const automation = await load('./automation.js').catch((e) => {
  console.error('automation.js did not load', e);
  return null;
});
/* The school board (schoolboard.js): what the weekly letters say, in the
   column under the countdown over a picture. On the same terms again: a board
   that will not load leaves that column the hours of weather it had. */
const schoolBoard = await load('./schoolboard.js').catch((e) => {
  console.error('schoolboard.js did not load', e);
  return null;
});
/* Not a default export — sound.js is the sounds, the quiet hours and the
   volume bands, shared by the doorbell and the clock. Loaded here with the
   build stamp and handed to both, because a bare import inside either of them
   would not carry it. */
const sound = await import(`./sound.js${V}`);
/* The household's uploaded sounds (one library per sound system) and the
   texts read aloud after an alert's sound: every sheet and player uses them,
   so they are loaded with the rest and handed round on the context. */
const soundlib = await load('./soundlib.js');
const voice = await load('./voice.js');
/* The settings windows' kit (sheetkit.js, 2026-10-22): the section rail of a
   long window, and the switch, card and state sentence every converted
   window writes alike. */
const sheetkit = await load('./sheetkit.js');
const travel = await load('./travel.js');
const notes = await load('./notes.js');
const tunai = await load('./tunai.js');
/* House → Vacuum Cleaner. Like the chip above: a tab is not worth the wall. */
const vacuum = await load('./vacuum.js').catch((e) => {
  console.error('vacuum.js failed to load', e);
  return null;
});
/* Casting from a phone's YouTube app: the wall's player over everything,
   and its card in ⚙ Settings. Guarded like the rest: it must not take the
   wall with it. */
const cast = await load('./cast.js').catch((e) => {
  console.error('cast.js failed to load', e);
  return null;
});
sound.setResolver((id) => soundlib.find(id));
const PANELS = await Promise.all(
  ['camera', 'media', 'ha', 'food', 'countdown', 'tv', 'timers', 'services', 'spending', 'radar']
    .map((n) => load(`./panels/${n}.js`)));

/* A phone is marked by index.html before anything loads, and gets a layout of
   its own from phone.js: one column, the views along the bottom. Every
   difference below is behind this flag, so the wall and the laptops run
   exactly the code they ran before phones existed. */
const PHONE = document.documentElement.classList.contains('phone');
const phone = PHONE ? await load('./phone.js') : null;

const grid = document.getElementById('grid');
const presetsNav = document.getElementById('presets');
// The views with the notes box under them (2026-10-19): the column is what
// moves into a full-screen panel's header and back; the buttons stay in it.
const viewsCol = document.getElementById('views-col');
const presetsHome = viewsCol.parentElement;     // where they live un-expanded
// ...and *where in it*. restoreHeader() used to appendChild() them back, which
// is the end of the top bar, not the place they came from — so the first
// expand-and-close of the day moved the views to the right of the tool column
// and left them there until a reload. The header is only correct by accident
// if nobody has ever pressed ⤢.
const presetsNext = viewsCol.nextElementSibling;

let config;
let uiState;
const shown = {};
let saveTimer = null;

/* The view is the wall's (2026-10-18, Alex: "when I browse kitchen
   dashboard in another computer it also changes the windows in the kitchen
   screen, make them not linked"). The server says which browser is the wall
   (`_wall` on GET /api/ui-state, by the sleep agent's address). Any other —
   a laptop, another screen — keeps which view, which panel filling it and
   which arrangement in its own storage, and sends only what else it changed,
   over the state as it is now: the phone's way (phone.js share()). */
let WALL = true;
const VIEW_KEYS = ['preset', 'expanded', 'variants'];
const VIEW_STORE = 'kitchen-view';
let pendingShare = {};

function shareElsewhere(partial) {
  try {
    localStorage.setItem(VIEW_STORE, JSON.stringify(
      Object.fromEntries(VIEW_KEYS.filter((k) => k in uiState).map((k) => [k, uiState[k]]))));
  } catch { /* private window: the view lasts as long as the page */ }
  for (const [k, v] of Object.entries(partial)) {
    if (!VIEW_KEYS.includes(k)) pendingShare[k] = v;
  }
  if (!Object.keys(pendingShare).length) return;
  clearTimeout(saveTimer);
  saveTimer = setTimeout(async () => {
    const patch = pendingShare;
    pendingShare = {};
    try {
      const now = await (await fetch('/api/ui-state', { cache: 'no-store' })).json();
      delete now._wall;
      const r = await fetch('/api/ui-state', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...now, ...patch }),
      });
      if (!r.ok) throw new Error(r.status);
    } catch {
      pendingShare = { ...patch, ...pendingShare };   // with the next change
    }
  }, 400);
}

function saveUiState(partial) {
  Object.assign(uiState, partial);
  // A phone keeps its own view to itself and writes only what it changed —
  // never its whole copy over the wall's. See share() in phone.js.
  if (PHONE) return phone.share(partial);
  if (!WALL) return shareElsewhere(partial);
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    fetch('/api/ui-state', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(uiState),
    }).catch(() => {}); // retried on the next change; the server keeps the last good state
  }, 400);
}

/* ---------- full screen ----------
   Chrome on the wall also starts full screen (see wall/kitchen-chrome.desktop);
   this is the way back in after someone has left it, and there is no keyboard
   up there to press F11 with. */
function wireFullscreen() {
  const btn = document.getElementById('full-btn');
  const sync = () => btn.classList.toggle('on', !!document.fullscreenElement);
  btn.onclick = async () => {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await document.documentElement.requestFullscreen({ navigationUI: 'hide' });
    } catch { /* refused (no gesture, or a kiosk already full screen) */ }
  };
  document.addEventListener('fullscreenchange', sync);
  sync();
}

/* ---------- dim now (the header's 🌙) ----------
   Alex, 2026-10-18: the 🍽 meal time (half an hour of black) became this —
   "change the icon to dimmer … it will activate the current dimmer". It puts
   Screen dimming's clock (night.js) over the wall at once, whatever the hour,
   until somebody taps it. */
function wireDim() {
  const btn = document.getElementById('dim-btn');
  if (!night) { btn.hidden = true; return; }
  btn.onclick = () => night.dimNow();
}

/* ---------- clock ---------- */
function tickClock() {
  const now = new Date();
  const hhmm = now.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false });
  document.getElementById('time').textContent = hhmm;
  document.getElementById('date').textContent =
    now.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' });
  // The expanded header carries its own clock; see expandedHeader().
  const mirror = document.querySelector('.hx-time');
  if (mirror) mirror.textContent = hhmm;
  // ...and over a picture, the date under it: "September 19", the month
  // first and no weekday — the shortest form that still says which day.
  const day = document.querySelector('.hx-date');
  if (day) day.textContent = now.toLocaleDateString('en-US', { month: 'long', day: 'numeric' });
}

/* ---------- the header of a panel filling the screen ----------
   An expanded panel covers the top bar completely, which took the clock, the
   weather and — worse — the six view buttons off the wall with it: the only
   way out of Photos was the Close button, and the only way to know the time
   was to press it. So the things that are always true of the wall follow the
   panel up: the clock, what it is doing outside, and the views, laid out in
   one line across a header that has the width for it.

   The presets are *moved*, not copied. They carry their own handlers and the
   `on` class applyLayout() paints, and a second set of buttons claiming to be
   the same six would be a second thing to keep in step.

   The time and the date under it are one button, as the top bar's clock is:
   either opens the Time sheet (wired in boot()). The date shows over a
   picture only — see .hx-date in app.css. The weather beside them is the top
   bar's "now" block again, and opens the Weather report. */
const expandedExtras = document.createElement('div');
expandedExtras.className = 'hx';
expandedExtras.innerHTML =
  '<span class="hx-clock"><span class="hx-time"></span><span class="hx-date"></span></span>'
  + '<span class="hx-wx"><span class="hx-ico"></span><span class="hx-temp">--°</span>'
  + '<span class="hx-wxtxt"><span class="hx-feels"></span><span class="hx-city"></span>'
  + '<span class="hx-rh"></span></span></span>'
  + '<span class="hx-events"></span>';

/* What is coming, in the header of a full-screen panel.

   The panel's own .meta line used to sit here — "99,136 on the NAS · 495
   cached" across the top of a photograph. That is a number you want once,
   while you are setting the cache up, and it was on the wall permanently. The
   next event is the opposite: three words nobody asks for on purpose and
   everybody reads. Days and the name, nothing else — no forecast and no city,
   which the countdown panel has the room for and this line does not.

   Read straight off the same bus the countdown panel reads, so it is right
   whether or not that panel is anywhere on screen. It is drawn as a chip
   rather than another cell in the row: beside a clock and a temperature, two
   more numbers in the same weight read as a third weather reading. */
/* Three over a picture, two in an ordinary full-screen header (the CSS drops the
   rest there — the row has the width for two). Over a picture it was six until
   2026-10-04, when the school board took the column under the chips: it is
   measured into whatever room they leave, and Alex wanted that room for
   Mia's school days rather than for the fourth to sixth event. */
const NEXT_EVENTS = 3;
let nextEvents = [];

function watchCountdown(bus) {
  bus.on('countdown', (events) => {
    nextEvents = Array.isArray(events)
      ? events.filter((e) => e && e.title && e.date).map((e) => ({ ...e }))
      : [];
    paintNextEvents();
    paintCdSheet();
  });
  // Midnight turns "1 day" into "Today", and drops an event that has arrived,
  // without anything at all arriving on the bus. A timed event counts its
  // minutes on its day, so the open Upcoming sheet goes along with the chips.
  setInterval(() => { paintNextEvents(); paintCdSheet(); }, 60 * 1000);
}

/* Every upcoming event, from a chip over a picture (2026-10-13, Alex: "when
   some of those is clicked open the full list of upcoming events"): the
   countdown panel's own list, in a sheet, so the view under it stays. */
const cdSheet = document.createElement('div');
cdSheet.id = 'cd-sheet';
cdSheet.className = 'sheet a-event';   // the settings window kit (app.css), in the countdown's violet
cdSheet.setAttribute('role', 'dialog');
cdSheet.setAttribute('aria-label', 'Upcoming');
cdSheet.innerHTML = `<header>
    <span class="sheet-icon" aria-hidden="true">⏳</span>
    <div class="sheet-title"><h2>Upcoming</h2><span class="sheet-status cd-sheetn"></span></div>
    <span class="spacer"></span><button class="ls-close">Close</button></header>
  <div class="ls-body cd-sheetbody"></div>`;
cdSheet.querySelector('.ls-close').onclick = () => cdSheet.classList.remove('open');
cdSheet.onclick = (e) => e.stopPropagation();

function paintCdSheet() {
  if (!cdSheet.classList.contains('open')) return;
  const panel = PANELS.find((p) => p?.id === 'countdown');
  cdSheet.querySelector('.cd-sheetbody').innerHTML = panel?.listHtml?.() || '';
  const n = cdSheet.querySelectorAll('.cd-card').length;
  sheetkit.status(cdSheet.querySelector('.cd-sheetn'), n ? `<b>${n} event${n === 1 ? '' : 's'}</b>` : '');
}

function openCdSheet() {
  if (!cdSheet.isConnected) document.body.appendChild(cdSheet);
  cdSheet.classList.add('open');
  paintCdSheet();
}

expandedExtras.querySelector('.hx-events').addEventListener('click', (e) => {
  if (!e.target.closest('.hx-next')) return;
  e.stopPropagation();
  openCdSheet();
});

function paintNextEvents() {
  const box = expandedExtras.querySelector('.hx-events');
  if (!box) return;
  // Recomputed from the date every paint rather than stored: the wall runs for
  // weeks, and a day count worked out once is wrong by morning. calendar.js
  // says when each is next — a yearly one comes back, a trip stays while it
  // is on — and how to say it, the same words the countdown cards use.
  const now = new Date();
  const soon = calendar.upcoming(nextEvents, calendar.isoDay(now)).slice(0, NEXT_EVENTS);

  box.textContent = '';
  for (const e of soon) {
    const w = calendar.countWords(e.occ, now);
    const chip = document.createElement('span');
    chip.className = 'hx-next';
    chip.innerHTML = '<span class="hx-next-n"></span><span class="hx-next-t"></span>';
    const n = chip.querySelector('.hx-next-n');
    n.textContent = w.num ? `${w.num} ${w.unit}` : w.unit;
    // "Day 3 of 5" and "2 h 15 min" are wider than "3 days": a size down,
    // so the titles beside them still start on one line (app.css).
    n.classList.toggle('long', n.textContent.length > 7);
    // textContent, not innerHTML: an event title is typed by hand in the
    // countdown editor and goes on the wall unescaped otherwise. A family
    // event's time after it ("· kl. 09:00"), on the first day only, as the
    // cards say it; a school event is its title alone here, as it always was.
    const t = e.occ.n >= 0 ? calendar.familyTime(e.occ) : '';
    chip.querySelector('.hx-next-t').textContent =
      calendar.shownTitle(e, e.occ) + (t ? ` · ${t}` : '');
    box.appendChild(chip);
  }
  fitNextEvents();
  placeHours();
}

/* Where the hours strip starts, over a picture.

   It stands at the foot of the left column — the clock, the weather and the
   countdown chips — and that column is as tall as the number of events in it,
   which changes at midnight, whenever somebody adds one on a phone, and
   between one view and the next. So the position is measured rather than
   written down: any constant here would be right for three chips and wrong for
   six.

   offsetTop and offsetHeight rather than getBoundingClientRect: the page is
   scaled as a whole with `zoom` on a screen smaller than the wall, and a rect
   comes back multiplied by it while the value being set here is not. These two
   are layout pixels either way, so this is correct at every step of the
   ladder. The offsetParent is the header, which sits at the top of the panel. */
function placeHours() {
  const panel = expandedExtras.closest('.panel.expanded.bleed');
  if (!panel) return;
  panel.style.setProperty('--wxtop',
    `${expandedExtras.offsetTop + expandedExtras.offsetHeight + 16}px`);
}

/* ...and measured again whenever the column changes height, which is the only
   version of this that cannot go stale.

   Everything in that column arrives at its own pace — the clock's webfont, the
   temperature, the countdown chips over SSE, the bird box — and calling
   placeHours() from each of them is a list of callers that has to stay
   complete for ever. It did not: the hours turned up printed over the chips,
   spread down the whole screen because the strip's rows share out whatever
   height it was given, and the only way back was to reload the page. Watching
   the column needs no list and covers whatever is put in it next.
   No feedback loop: this writes --wxtop, which moves .wxcol in the body, and
   nothing in the header. */
new ResizeObserver(() => placeHours()).observe(expandedExtras);

/* The views take their full width in every header now, so a full-screen panel
   that brings buttons of its own (Cooking's List and Pantry) has no room for
   both chips — and two titles cut to "Abadzh…" and "Siri k…" say less than one
   said whole. The second, the dimmed one, goes when and only when a title
   would be cut. Measured rather than decided per panel, because it depends on
   the titles, which are typed by hand. */
function fitNextEvents() {
  const box = expandedExtras.querySelector('.hx-events');
  if (!box.isConnected) return;   // no panel is expanded
  box.classList.remove('one');
  // Over a picture they are a column down the left edge with a whole screen's
  // height to fall into, so nothing has to give way there.
  if (box.closest('.bleed')) return;
  const cut = () => [...box.querySelectorAll('.hx-next-t')]
    .some((t) => t.scrollWidth > t.clientWidth);
  if (cut()) box.classList.add('one');
}
addEventListener('resize', () => { fitNextEvents(); placeHours(); });
// The clock is 80px of a webfont over a picture: measured before it loads, the
// column is the wrong height and the hours sit in the middle of the chips.
document.fonts.ready.then(() => { fitNextEvents(); placeHours(); });

/* The corner right of the views — ⚙ 🍽 ⛶ and Live — comes up with them
   (2026-10-18, Alex: "these buttons are not shown in all tabs … show it when
   any tab is clicked"): until then Photos, Birds and TV covered it with their
   panel. In the 117px the panel's ⤢ had there, ⤢ joins the three as the
   fourth of a 2×2 and Live is its dot; restoreHeader() puts all of it back. */
const hdRight = document.querySelector('.hd-right');
const hdRightHome = { parent: hdRight.parentNode, next: hdRight.nextSibling };
let expandHome = null;

function expandedHeader(el) {
  const header = el.querySelector('header');
  header.insertBefore(expandedExtras, header.querySelector('.meta'));
  header.insertBefore(viewsCol, header.querySelector('.custom-buttons'));
  const ex = header.querySelector('button.expand');
  expandHome = { btn: ex, parent: ex.parentNode, next: ex.nextSibling };
  header.appendChild(hdRight);
  hdRight.querySelector('.hd-tools').appendChild(ex);
  /* The bird box, where a picture has covered the top bar that usually carries
     it — in the clock's own column, under the time and above what is coming,
     as a chip the size of theirs. Out on its own in the header row it was a
     second block floating in the middle of a photograph; in the column it is
     one more line of the same stack, which is what it is. The Birds view
     carries it too: Photos and Birds show the same column, always, so the
     eye finds the same things in the same places on either. */
  if (el.classList.contains('bleed')) {
    motionbar.mount(expandedExtras, expandedExtras.querySelector('.hx-events'));
    /* The rooms' warmth, straight under the weather outside (Alex,
       2026-10-15: "change the place of this card to here under the current
       weather") — inside beside outside. Over a picture this is the only
       place on the screen that carries it; the top bar is under the photo. */
    climate.mount(expandedExtras, motionbar.mini || expandedExtras.querySelector('.hx-events'));
    /* Needs attention under the rooms, above the bird box. */
    attention?.mount(expandedExtras, [motionbar.mini,
      expandedExtras.querySelector('.hx-events')].find((n) => n?.parentNode === expandedExtras));
  }
  tickClock();
  weather.mirror(expandedExtras);
  paintNextEvents();
}

function restoreHeader() {
  // The corner first: it is the node the views go back in front of.
  hdRightHome.parent.insertBefore(hdRight, hdRightHome.next);
  presetsHome.insertBefore(viewsCol, presetsNext);
  if (expandHome) {
    expandHome.parent.insertBefore(expandHome.btn, expandHome.next);
    expandHome = null;
  }
  expandedExtras.remove();
  motionbar.mount(null);
  climate.mount(null);
  attention?.mount(null);
  weather.mirror(null);
}

/* ---------- the hours beside a picture ----------
   Photos and the bird box are the two panels whose content has a shape of its
   own: a 4:3 frame on a 16:9 wall leaves a band of striped nothing down each
   side, and full screen makes that band 300px wide. So those two get the
   forecast in it, and the picture moves across to sit against the column
   rather than floating in the middle of its own margins.

   One element, moved rather than copied — the same reasoning as the presets
   above: two of these would be two things to keep painted. */
const wxColumn = document.createElement('aside');
wxColumn.className = 'wxcol';

function sideColumn(el, panel) {
  if (!panel || !panel.sideWeather) return;
  el.classList.add('has-wxcol');
  el.querySelector('.body').prepend(wxColumn);
  sideIsBoard = null;
  paintSide();
  placeHours();          // it stands under the column; see placeHours()
}

/* The school board where there is one, and the twelve hours of weather where
   there is not: no letter read yet, a server older than the board, or the
   demo. Alex asked for the board in the place of the hours (2026-10-02); the
   hours are still behind the weather reading above, in its report. The two
   never share the element — the one not painting is handed null — and the
   board says when it comes to be, or stops being, so this is asked again. */
let sideIsBoard = null;

function paintSide() {
  if (!wxColumn.isConnected) return;
  const board = !!schoolBoard?.has();
  if (board === sideIsBoard) return;
  sideIsBoard = board;
  wxColumn.classList.toggle('sb', board);
  if (board) {
    weather.column(null);
    schoolBoard.column(wxColumn);
  } else {
    schoolBoard?.column(null);
    weather.column(wxColumn);
  }
}

function restoreSideColumn(el) {
  if (el) el.classList.remove('has-wxcol');
  wxColumn.remove();
  weather.column(null);
  schoolBoard?.column(null);
  sideIsBoard = null;
  // The next panel to be expanded measures its own column; a number left over
  // from this one would place the hours against a clock that is not there.
  if (el) el.style.removeProperty('--wxtop');
}

/* ---------- panels ---------- */
function buildPanel(p) {
  const sec = document.createElement('section');
  sec.className = 'panel';
  sec.id = `p-${p.id}`;
  sec.style.gridArea = p.id;
  sec.innerHTML = `
    <header>
      <span class="dot"></span>
      <span class="name">${p.title}</span>
      <span class="meta"></span>
      <span class="spacer"></span>
      <span class="custom-buttons"></span>
      <button class="expand" title="fill the screen">⤢</button>
    </header>
    <div class="body"></div>`;
  sec.querySelector('.expand').onclick = () => toggleExpand(p.id);
  grid.appendChild(sec);
  return sec;
}

function addHeaderButton(panelId, label, onclick) {
  const btn = document.createElement('button');
  btn.textContent = label;
  btn.onclick = (e) => { e.stopPropagation(); onclick(); };
  document.querySelector(`#p-${panelId} .custom-buttons`).appendChild(btn);
  return btn;
}

function setMeta(panelId, text) {
  const el = document.querySelector(`#p-${panelId} header .meta`);
  if (el) el.textContent = text || '';
}

/* ---------- layout ---------- */
/* A view for this screen: `wall: false` keeps one off the wall (Everything,
   since 2026-10-18 — the phone's Now and the resting-view choice still live
   on it), `phone: false` off a phone (Economy: the phone's House already has
   the spending). */
function onScreen(name) {
  const p = config.layouts.presets[name];
  return !!p && (PHONE ? p.phone !== false : p.wall !== false);
}

function presetName() {
  return onScreen(uiState.preset) ? uiState.preset : homePreset();
}

/* A preset may offer several arrangements of the same panels under `variants`
   — Everything does, because the bird box is empty for half the year and a
   view built around it is then a view built around a blank rectangle. The
   chosen one is merged over the preset, so a preset with no variants is
   returned untouched and nothing else in here has to know about any of it. */
function variantsOf(name) {
  return config.layouts.presets[name]?.variants || null;
}

function variantKey(name) {
  const vs = variantsOf(name);
  if (!vs) return null;
  const keys = Object.keys(vs);
  const chosen = (uiState.variants || {})[name];
  return keys.includes(chosen) ? chosen : keys[0];
}

function currentPreset() {
  const name = presetName();
  const preset = config.layouts.presets[name];
  const key = variantKey(name);
  return key ? { ...preset, ...preset.variants[key] } : preset;
}

/* ---------- coming home ----------
   The arrangement chosen for Everything says what this wall is *for* when
   nobody is using it: pick "Photos, no bird box" and the kitchen's resting
   view is the photographs, pick "Bird box, no photos" and it is the box. So a
   dashboard left untouched for a quarter of an hour goes back to it — the
   `home` key on that arrangement in layouts.json names which.

   Only the mixed dashboards time out. Photos, Birds and TV carry `stay` and
   are left alone: a screen that jumped away from the bird box or the
   television while somebody was watching would be taking the wall off the
   person using it, which is the opposite of the point. Any touch starts the
   quarter of an hour again, and an open sheet holds it off entirely — a sheet
   on screen is somebody reading it. */
const HOME_AFTER_MS =
  // ?homeafter=<seconds> shortens it, for checking the behaviour in a browser
  // without sitting in front of the wall for fifteen minutes. The wall itself
  // is opened with no query at all.
  Number(new URLSearchParams(location.search).get('homeafter')) * 1000 || 15 * 60 * 1000;
let idleTimer = null;
/* The wall's own settings (screen.py, the header's ⚙ since 2026-10-18): where
   an untouched view goes back to, and after how long. Until the server has
   said, what it always did: home, after HOME_AFTER_MS. */
let screenDoc = null;

function returnPlan() {
  const s = screenDoc?.settings;
  const params = new URLSearchParams(location.search).has('homeafter');
  const ms = params || !s ? HOME_AFTER_MS : s.return_min * 60 * 1000;
  const presets = config.layouts.presets;
  let to = homePreset();
  if (s && s.return_to !== 'home' && presets[s.return_to] && onScreen(s.return_to)) to = s.return_to;
  return { ms, to };
}

/* The home view is Everything's business wherever you happen to be standing:
   it is that view's arrangement that was chosen, not Cooking's. */
function homePreset() {
  const presets = config.layouts.presets;
  const base = Object.keys(presets)[0];
  const key = variantKey(base);
  const home = (key && variantsOf(base)[key].home) || presets[base].home;
  const want = presets[home] ? home : base;
  if (onScreen(want)) return want;
  // Everything itself off the wall (its "Bird box and photos" names it): the
  // first view that stays put — Photos — rests the wall instead.
  const names = Object.keys(presets).filter(onScreen);
  return names.find((n) => presets[n].stay) || names[0];
}

/* Any sheet open over the wall. The chime's, the doorbell's, a room's and the
   alarm were missing from this until 2026-09-25, so the wall could go home
   from under one of them after a quarter of an hour; the countdown list's,
   the diffuser's and a Radar tracker's until 2026-10-15. */
function sheetOpen() {
  return !!document.querySelector('#wx-overlay.open, #ts-overlay.open, #cl-sheet.open, #lx-sheet.open, '
    + '#ch-sheet.open, #db-sheet.open, #light-sheet.open, #alarm-sheet.open, #at-sheet.open, '
    + '#nt-sheet.open, #pb-sheet.open, #sc-sheet.open, #sl-sheet.open, #sb-doc.open, #at-link.open, '
    + '#au-sheet.open, #bb-sheet.open, #dc-sheet.open, #cd-sheet.open, #df-sheet.open, #rf-sheet.open, '
    + '#vc-sheet.open, #fa-sheet.open, #sn-sheet.open, #pt-sheet.open, #cs-player.open, #bf-sheet.open, '
    // The morning brief's card on the wall, while it is up.
    + '#bf-show.open, #ask-sheet.open, '
    // Economy's notes box while somebody speaks, AI writes, or a note is being typed.
    + '#an-sheet.open, #tn-sheet.open, .an-root.busy')
    || !document.getElementById('layout-overlay').hidden;
}

function armIdleReturn() {
  clearTimeout(idleTimer);
  idleTimer = null;
  // A phone stays where it was left: it goes into a pocket, not onto a wall.
  if (PHONE) return;
  const name = presetName();
  if (config.layouts.presets[name]?.stay) return;   // Photos, Birds and TV stay put
  const { ms, to } = returnPlan();
  if (!ms || name === to) return;                   // 0 minutes: never
  idleTimer = setTimeout(() => {
    // Still being read: ask again in another while rather than pulling the
    // sheet out from under whoever opened it.
    if (sheetOpen()) return armIdleReturn();
    const plan = returnPlan();
    if (presetName() !== plan.to) setPreset(plan.to);
  }, ms);
}

/* A panel is *laid out* when its preset shows it — the preset is the only
   thing that decides, now that the per-panel − is gone. Panels used to be
   hideable one by one, which on a wall screen meant a sleeve could take the
   photographs off the wall and leave a chip nobody would connect to it.
   Choosing a view is the way to change what is on the wall.

   A panel is *live* — allowed
   to hold a stream or poll the NAS — only while someone can actually see it,
   which the preset alone does not settle: opening Netflix in another browser
   tab, or minimising the window, leaves every panel laid out and none of them
   watched. Chrome keeps a WebRTC connection and a video element running in a
   background tab, so without this the bird box streams all evening into a tab
   nobody has in front of them.

   Panels opt in with `pauseWhenUnseen`, because leaving the page is not the
   same event for all of them: a kitchen timer has to go on ringing into a room
   whose wall screen has something else on top of it, so timers.js — whose
   onHide() silences alarms — is deliberately not one of them.

   The display style follows layout alone, so coming back re-paints what was
   already there rather than reflowing the grid. */
function panelLaidOut(p, preset) {
  if (PHONE) return phone.shows(p.id, presetName());
  return preset.visible.includes(p.id);
}

/* Night mode's clock covers the whole wall; while it does, nobody can see the
   photographs or the bird box either, so they pause as they do for a hidden
   page (night.js says so through setCovered). */
let nightCovers = false;
let castCovers = false;     // a video cast from a phone is over the whole wall

function syncPanelLifecycle() {
  const preset = currentPreset();
  const unseen = document.hidden || nightCovers || castCovers;
  for (const p of PANELS) {
    const live = panelLaidOut(p, preset) && !(unseen && p.pauseWhenUnseen);
    if (live && !shown[p.id]) p.onShow?.();
    if (!live && shown[p.id]) p.onHide?.();
    shown[p.id] = live;
  }
}

function applyLayout() {
  const preset = currentPreset();
  if (PHONE) {
    phone.arrange(presetName());   // one column, in the phone's own order
  } else {
    grid.style.gridTemplateAreas = preset.areas.map((r) => `"${r}"`).join(' ');
    const cols = preset.areas[0].trim().split(/\s+/).length;
    grid.style.gridTemplateColumns = `repeat(${cols}, 1fr)`;
    grid.style.gridTemplateRows = preset.rows || `repeat(${preset.areas.length}, 1fr)`;
  }

  for (const p of PANELS) {
    document.getElementById(`p-${p.id}`).style.display =
      panelLaidOut(p, preset) ? '' : 'none';
  }
  syncPanelLifecycle();

  presetsNav.querySelectorAll('button').forEach((b) =>
    b.classList.toggle('on', b.dataset.preset === presetName()));
  // The agent's box under the views: on House, Economy and Cooking only
  // (layouts.json `notes`: true for dates and events, or what the box's notes
  // are about, "cooking"), so it is never taken for AI's, House → AI's own.
  notes.showQuick(config.layouts.presets[presetName()]?.notes || false);
}

/* House → Automation, from wherever the wall is: the Needs attention window's
   ⚙ and the Arrange sheet's "How alerts show" both lead there; the Radar
   view's "change on Automation" also opens the Radar card's sheet (`sheet`). */
function goAutomation(sheet) {
  const ha = PANELS.find((p) => p.id === 'ha');
  // A phone too: its House view is where the tab is (setPreset keeps a
  // phone's view to itself).
  if (config.layouts.presets.house && presetName() !== 'house') setPreset('house');
  ha?.setTab?.('auto');
  if (PHONE) document.getElementById('p-ha')?.scrollIntoView({ block: 'start' });
  if (sheet) automation?.open(sheet);
}

/* A number on a view's button: the Radar view's new finds. 0 takes it off. */
function presetBadge(name, n) {
  const btn = presetsNav.querySelector(`button[data-preset="${name}"]`);
  if (!btn) return;
  let b = btn.querySelector('.pv-n');
  if (!n) { b?.remove(); btn.removeAttribute('aria-label'); return; }
  if (!b) {
    b = document.createElement('span');
    b.className = 'pv-n';
    btn.appendChild(b);
  }
  b.textContent = n > 99 ? '99+' : String(n);
  btn.setAttribute('aria-label', `${config.layouts.presets[name]?.label || name}, ${n} new`);
}

function setPreset(name) {
  if (uiState.expanded) collapse();
  saveUiState({ preset: name });
  applyLayout();
  // On a phone every view is already a screen of its own.
  if (PHONE) return;
  // A view of one panel opens as that panel, full screen. Photos and Birds are
  // a single panel across the whole grid, so the un-expanded state of them was
  // the same picture inside a card with a title bar and 16px of panel showing
  // round the edge — a step on the way to what you asked for and nothing else.
  // `expand` in layouts.json names the panel; ⤢ still comes back out of it.
  const target = currentPreset().expand;
  if (target && panelById(target)) expand(target);
  armIdleReturn();
}

/* ---------- arranging a view (the header gear) ----------
   The gear arranges the view you are looking at. Presets that offer no
   arrangements send it to the one that does — a button on a wall screen that
   sometimes does nothing when pressed teaches people to stop pressing it. */
function gearTarget() {
  // Since 2026-10-18 the view you are on, always — with its arrangements if it
  // has more than one — and under them the settings of the wall as a whole.
  return presetName();
}

function esc(s) {
  return String(s ?? '').replace(/[&<>"]/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

/* A scale drawing of the arrangement, built from the very same areas string
   the grid is given. Saying "photographs take the whole width" costs more
   words than this costs pixels, and is less certain when you read it. */
function variantPreview(v) {
  const cols = v.areas[0].trim().split(/\s+/).length;
  const style = [
    `grid-template-areas:${v.areas.map((r) => `"${r}"`).join(' ')}`,
    `grid-template-columns:repeat(${cols},1fr)`,
    `grid-template-rows:${v.rows || `repeat(${v.areas.length},1fr)`}`,
  ].join(';');
  return `<span class="lay-prev" style="${esc(style)}" aria-hidden="true">${
    v.visible.map((id) => `<i data-p="${esc(id)}" style="grid-area:${esc(id)}"></i>`).join('')
  }</span>`;
}

/* The ⚙ Settings window (2026-10-22: on the settings window kit, a sheet
   like every other ⚙ window — it had been the one centred dialog). Its
   cards: how the view you are on is arranged, then the wall as a whole. */
function renderLayoutOptions() {
  const kit = sheetkit;
  const name = gearTarget();
  const box = document.getElementById('lay-options');
  const preset = config.layouts.presets[name] || {};
  const active = variantKey(name);
  const label = preset.label || name;
  const variants = Object.entries(preset.variants || {});

  document.getElementById('lay-title').textContent = 'Settings';
  kit.status(document.getElementById('lay-sub'),
    `for the whole wall — and, first, how <b>${esc(label)}</b>, the view you are on, is arranged`);

  // Chosen as every chosen thing in a settings window is: the window's hue.
  const arrange = variants.length ? `<div class="lay-opts">${variants.map(([key, v]) => `
    <button class="lay-opt${key === active ? ' on' : ''}" data-k="${esc(key)}" aria-pressed="${key === active}">
      ${variantPreview(v)}
      <span class="lay-txt">
        <span class="lay-name">${esc(v.label || key)}${
          key === active ? '<em>in use</em>' : ''}</span>
        <span class="lay-note">${esc(v.note || '')}</span>
      </span>
    </button>`).join('')}</div>`
    : `<p class="sheet-note lay-none">${esc(label)} has one arrangement — nothing to choose here.</p>`;
  const inUse = variants.find(([key]) => key === active)?.[1];

  box.innerHTML = kit.sec(`${label} — how it is arranged`, arrange,
    { note: inUse ? `in use: ${inUse.label || active}` : '' }) + wallSettings();

  box.querySelectorAll('.lay-opt').forEach((b) => {
    b.onclick = () => setVariant(name, b.dataset.k);
  });
  box.querySelectorAll('[data-scr]').forEach((b) => {
    b.onclick = () => putScreen({ [b.dataset.scr]: JSON.parse(b.dataset.v) });
  });
  cast?.wire(box);
  kit.sync(document.getElementById('layout-overlay'));
}

/* The wall as a whole (screen.py): going back by itself, and Chrome kept
   full screen by the wall's extension. One tap sets one value. */
function wallSettings() {
  const kit = sheetkit;
  const d = screenDoc;
  if (!d) return '';
  const s = d.settings;
  const ch = d.choices;
  const views = config.layouts.presets;
  // One of N: a bar, its "none" (Never) chosen in the quiet fill.
  const btn = (key, v, text, none = false) => `<button class="ls-btn${s[key] === v ? ' on' : ''}${
    none ? ' sheet-none' : ''}" data-scr="${key}" data-v='${esc(JSON.stringify(v))}'
    aria-pressed="${s[key] === v}">${esc(text)}</button>`;
  const mins = (m) => (m === 0 ? 'Never' : m < 60 ? `${m} min` : `${m / 60} h`);
  const homeName = views[homePreset()]?.label || homePreset();
  const c = d.chrome || {};
  const age = c.at ? Date.now() / 1000 - c.at : null;
  const chromeLine = age == null ? 'The wall\'s Chrome extension has not reported since the kitchen started — '
      + 'it is updated the next time the wall is awake.'
    : age > 120 ? `The wall's Chrome last reported ${Math.round(age / 60)} min ago (asleep?).`
    : `The wall's Chrome is ${c.fullscreen ? 'full screen' : '<b>not full screen</b>'} now${
      c.forced_at ? ` — last put back at ${new Date(c.forced_at * 1000).toTimeString().slice(0, 5)}` : ''}.`;
  const chromeTone = age == null || age > 120 ? '' : c.fullscreen ? ' sheet-ok' : ' sheet-warn';
  // The cards' notes: what each does now, in a few words.
  const toName = { photos: views.photos?.label || 'Photos', birds: views.birds?.label || 'Birds',
    home: `${homeName}, as before` }[s.return_to] || s.return_to;
  const backNote = s.return_min ? `to ${toName} · after ${mins(s.return_min)}` : 'never';
  const chromeNote = age == null ? 'not reported yet'
    : age > 120 ? `last reported ${Math.round(age / 60)} min ago`
    : c.fullscreen ? 'full screen now' : 'not full screen now';
  return `
    ${kit.sec('Going back by itself', `
      <div class="ls-row${s.return_min ? '' : ' nt-off'}">
        <span class="ls-label">To
          <span class="db-hint">Economy, Cooking, House and Radar, left untouched, go to this view.
            Photos, Birds and TV stay where they are.</span></span>
        <span class="ls-set sheet-seg">${btn('return_to', 'photos', views.photos?.label || 'Photos')}${
          btn('return_to', 'birds', views.birds?.label || 'Birds')}${
          btn('return_to', 'home', `As before (${homeName})`)}</span>
      </div>
      <div class="ls-row">
        <span class="ls-label">After
          <span class="db-hint">with nobody touching the screen; an open sheet holds it off.</span></span>
        <span class="ls-set sheet-seg">${ch.return_min.map((m) => btn('return_min', m, mins(m), m === 0)).join('')}</span>
      </div>`, { note: backNote })}
    ${kit.sec('Chrome on the wall', `
      <div class="ls-row">
        <span class="ls-label">Full screen when it starts
          <span class="db-hint">Chrome opens full screen on the wall.</span></span>
        ${kit.toggle(!!s.fullscreen_start, `data-scr="fullscreen_start" data-v="${s.fullscreen_start ? 'false' : 'true'}"`)}
      </div>
      <div class="ls-row">
        <span class="ls-label">Put it back to full screen
          <span class="db-hint">when it has been out of full screen this long.</span>
          <span class="sheet-line${chromeTone}">${chromeLine}</span></span>
        <span class="ls-set sheet-seg">${ch.fullscreen_after.map((m) => btn('fullscreen_after', m,
          m === 0 ? 'Never' : `after ${m} min`, m === 0)).join('')}</span>
      </div>`, { note: chromeNote })}
    ${cast ? cast.section(kit) : ''}`;
}

async function putScreen(patch) {
  if (screenDoc) screenDoc = { ...screenDoc, settings: { ...screenDoc.settings, ...patch } };
  renderLayoutOptions();
  armIdleReturn();
  try {
    const r = await fetch('/api/screen', {
      method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(patch),
    });
    // Only a whole document replaces the one drawn (a preview answers {}).
    const j = r.ok ? await r.json() : null;
    if (j && j.settings && j.choices) screenDoc = j;
  } catch { /* the next snapshot puts it right */ }
}

function setVariant(presetKey, key) {
  // An expanded panel may not exist in the new arrangement at all.
  if (uiState.expanded) collapse();
  saveUiState({ variants: { ...uiState.variants, [presetKey]: key } });
  if (presetName() !== presetKey) saveUiState({ preset: presetKey });
  applyLayout();
  renderLayoutOptions();
  armIdleReturn();   // the arrangement just chosen may name a different home
}

function wireLayoutGear() {
  const btn = document.getElementById('layout-btn');
  const overlay = document.getElementById('layout-overlay');

  // A .sheet of the kit is shown by .open; `hidden` stays its state as well,
  // which sheetOpen() and the 'screen' event read.
  const close = () => { overlay.hidden = true; overlay.classList.remove('open'); btn.classList.remove('on'); };
  btn.onclick = () => {
    if (!overlay.hidden) return close();
    overlay.hidden = false;
    overlay.classList.add('open');
    document.getElementById('lay-options').scrollTop = 0;
    renderLayoutOptions();
    btn.classList.add('on');
  };
  document.getElementById('lay-close').onclick = close;
  const alerts = document.getElementById('lay-alerts');
  // How each alert shows lives on House → Automation since 2026-10-11.
  if (alerts && automation) {
    alerts.hidden = false;
    alerts.onclick = () => { close(); goAutomation(); };
  }
  // Changing the view while the sheet is open re-aims it at that view.
  presetsNav.addEventListener('click', () => { if (!overlay.hidden) renderLayoutOptions(); });
}

/* ---------- expand ---------- */
function panelById(id) { return PANELS.find((p) => p.id === id); }

function toggleExpand(id) {
  if (uiState.expanded === id) collapse(); else expand(id);
}

function expand(id) {
  if (uiState.expanded && uiState.expanded !== id) collapse();
  const el = document.getElementById(`p-${id}`);
  el.classList.add('expanded');
  /* On a phone a panel filling the screen is only that: a sheet over the
     page with ⤢ to close it. The views stay along the bottom, and the
     clock, the weather and the hours have nowhere to go. */
  if (PHONE) {
    el.querySelector('.expand').title = 'close';
    saveUiState({ expanded: id });
    panelById(id).onExpand?.();
    return;
  }
  // A picture fills the glass rather than sitting in a card with a title bar;
  // the header floats on it. See `.bleed` in app.css.
  el.classList.toggle('bleed', !!panelById(id).fullBleed);
  // The glyph does not change to the word "Close". One button, one meaning:
  // it is the size toggle, and it looked like a different control every time
  // the panel changed state — on a wall screen with no window chrome, the
  // thing you press to make a panel big has to be the thing you press to make
  // it small again, in the same corner, wearing the same face.
  el.querySelector('.expand').title = 'leave full screen';
  expandedHeader(el);
  sideColumn(el, panelById(id));
  saveUiState({ expanded: id });
  panelById(id).onExpand?.();
}

function collapse() {
  const id = uiState.expanded;
  if (!id) return;
  const el = document.getElementById(`p-${id}`);
  el.classList.remove('expanded', 'bleed');
  el.querySelector('.expand').title = 'fill the screen';
  if (!PHONE) {
    restoreSideColumn(el);
    restoreHeader();
  }
  saveUiState({ expanded: null });
  panelById(id).onCollapse?.();
}

/* ---------- boot ---------- */

/* The two documents the whole page is drawn from, asked for again before
   giving up. Alex's phone on the VPN (2026-10-02) said "TypeError: Failed to
   fetch" here on every start after its first, while the server had answered
   both in ten milliseconds. Nothing on the screen said which request it was,
   or why. So each is tried three times, a little apart, past any cache. A
   failure says which one, how, and how long it took, and the server's log
   hears it too (reportStartFailure()). */
async function startJson(url) {
  let why = '';
  for (let n = 1; n <= 3; n++) {
    const t0 = performance.now();
    try {
      const r = await fetch(url, { cache: 'no-store' });
      if (!r.ok) throw new Error(`answered ${r.status}`);
      return await r.json();
    } catch (e) {
      why = `${url}: ${e?.message || e} after ${Math.round(performance.now() - t0)} ms (try ${n} of 3)`;
      if (n < 3) await new Promise((res) => setTimeout(res, 700 * n));
    }
  }
  throw new Error(why);
}

/* What a screen that could not start saw, to the server's log: which
   request, how it failed, whether the browser thought it was online, and
   whether this was a page Chrome had started ahead of time. A beacon, so it
   leaves even as the page reloads. */
function reportStartFailure(e) {
  try {
    const nav = performance.getEntriesByType('navigation')[0];
    navigator.sendBeacon('/api/client-error', new Blob([JSON.stringify({
      where: 'start', error: String(e?.message || e), page: location.href,
      online: navigator.onLine, visible: document.visibilityState,
      ahead: !!(nav && nav.activationStart > 0), nav: nav?.type || '',
      ms: Math.round(performance.now()), phone: PHONE,
    })], { type: 'application/json' }));
  } catch { /* nothing to be done about a report that cannot leave */ }
}

async function boot() {
  /* Chrome starts a page it expects to be opened (an address typed often,
     like kitchen.home on a phone) before it is shown. This page must not
     start unseen: it opens the events stream, plays the hour, and on Photos
     asks for the next photograph, which uses up On-this-day. It waits until
     it is really opened. */
  if (document.prerendering) {
    await new Promise((res) => document.addEventListener('prerenderingchange', res, { once: true }));
  }
  tickClock();
  setInterval(tickClock, 1000);

  [config, uiState] = await Promise.all([startJson('/api/config'), startJson('/api/ui-state')]);
  WALL = !PHONE && uiState._wall !== false;
  delete uiState._wall;
  if (!PHONE && !WALL) {
    // This browser's own view, where it was left; the wall's until it has one.
    try { Object.assign(uiState, JSON.parse(localStorage.getItem(VIEW_STORE) || '{}')); } catch { /* none */ }
  }
  // The view in the wall's state is the wall's. A phone opens on its own —
  // the one in its address, or the one it was left on — and nothing is ever
  // expanded on arrival.
  if (PHONE) Object.assign(uiState, { preset: phone.start(config), expanded: null });

  const dot = document.getElementById('conn-dot');
  const label = document.getElementById('conn-text');
  const bus = createBus((ok) => {
    dot.classList.toggle('down', !ok);
    label.textContent = ok ? 'Live' : 'Offline';
  }, {
    // A new build waits (ten minutes at most) while a sheet is open or a note
    // box has the cursor in it or words not yet sent: a reload would take them.
    busy: () => sheetOpen() || [...document.querySelectorAll('.an-text')]
      .some((t) => t === document.activeElement || t.value.trim()),
  });
  /* Where the sensors are (sensors.py). The list every reading on the wall is
     drawn from, swapped in here — before any panel, so before anybody else
     hears the same event — and the House panel's light cards, the top bar and
     the chart all read the new one when they hear it. */
  bus.on('sensors', (d) => {
    if (d && Array.isArray(d.climate)) config.entities.climate = d.climate;
  });
  // The wall's settings (the ⚙): a change re-aims the wait for going back.
  bus.on('screen', (d) => {
    if (!d || !d.settings) return;
    screenDoc = d;
    armIdleReturn();
    if (!document.getElementById('layout-overlay').hidden) renderLayoutOptions();
  });

  for (const [name, preset] of Object.entries(config.layouts.presets)) {
    if (!onScreen(name)) continue;
    const btn = document.createElement('button');
    btn.textContent = preset.label || name;
    btn.dataset.preset = name;
    // The hue this view's own panels wear, so the button is recognisable
    // before the word on it is read. Named in layouts.json; a preset with no
    // accent keeps the ordinary ink.
    if (preset.accent) btn.style.setProperty('--accent', `var(--${preset.accent})`);
    btn.onclick = () => {
      setPreset(name);
      // Birds is the live picture, always — never the log or the settings
      // the panel was last left on (2026-10-30). The recordings are the bird
      // box tile's.
      if (name === 'birds') {
        try { panelById('camera')?.onAsk?.('live'); } catch (e) { console.error('camera live', e); }
      }
    };
    presetsNav.appendChild(btn);
  }

  // The weather glyphs travel with the context so the countdown panel draws
  // an event's forecast in exactly the same hand as the header band.
  const ctx = {
    config, uiState, bus, saveUiState, addHeaderButton, setMeta,
    // The wall's resting view (homePreset: Photos while Everything's
    // arrangement says so). The TV panel's ⌂ is the only caller — a panel
    // that has taken the whole screen needs the same way out a phone gives you.
    goHome: () => setPreset(homePreset()),
    /* A panel showing a summary of itself sending you to the view that has the
       whole thing — the Cooking strip does this when a dish is tapped. Unknown
       names are ignored rather than throwing: a panel naming a preset somebody
       has since renamed in layouts.json should do nothing, not break. */
    setPreset: (name) => { if (onScreen(name)) setPreset(name); },
    /* One part of the wall asking a panel for one of its own screens — the
       bird box's stills in the top bar are the only caller so far, and they
       want the log rather than the live picture. A panel that does not answer
       to the name, or has nothing to say to it, does nothing: the caller must
       never have to know which, any more than setPreset's caller has to know
       whether a preset still exists. */
    ask: (panelId, what) => {
      try { panelById(panelId)?.onAsk?.(what); }
      catch (e) { console.error(`panel ${panelId} could not open ${what}`, e); }
    },
    /* The doorbell travels with the context for the same reason the weather
       glyphs do: the House panel draws its card, but the bell itself is not
       the House panel's — it has to ring on whichever view is up. */
    doorbell,
    /* The hour, for the same reason: its card, Clock sounds, is at the foot
       of House → More, but the clock strikes on whichever view is up. */
    chime,
    /* Travels with the context for the same reason the doorbell does: the
       House panel prints a room's temperature on that room's light card, but
       the sensors are not the House panel's — they are the top bar's, and the
       two must never round the same reading differently. */
    climate,
    /* The evening dimming ladder's editor. On the context for the same
       reason the doorbell is: the House panel opens it — from the Whole
       house row and from a room's settings — but it is a sheet of its own
       over the whole screen, not a thing inside that panel. */
    lightsched,
    /* The phone box: its tile is drawn at the end of House → More, but the
       settings and the sheet are its own (phonebox.js). */
    phonebox,
    /* Screen dimming: its tile is drawn after the phone box, but the clock,
       its settings and the sheet are night.js's. Null when that file failed
       to load, and the House panel then draws no tile. */
    night,
    /* Mia's school time alert: its tile after Screen dimming, its song,
       settings and sheet its own (school.js). Null if that failed to load. */
    school,
    /* The morning brief's card, sheet and the card on the wall (brief.js). */
    brief,
    // Babo Alarm and the disco: cards beside the clock's on More.
    babo,
    // The smoke and heat alarms: a section of their own on Automation.
    fireAlarms,
    // The temperature sensors and their rooms: a card on Automation too.
    sensors,
    // ...and the computers' own temperatures, beside it.
    pctemps,
    disco,
    diffuser,
    /* The flower alarm: its tile after the school alert, its levels, delay
       and sheet its own (soilalarm.js). Null if that failed to load. */
    soil: soilAlarm,
    /* House → Automation's alert cards and their sheet (automation.js), and
       Needs attention itself, whose window those cards' changes repaint and
       whose ⚙ leads to them. Null if either failed to load. */
    automation,
    attention,
    goAutomation,
    /* The Radar view's count on its button (panels/radar.js). */
    presetBadge,
    /* The school board: the column under the countdown over a picture, the
       panel on the right a tap on it opens, and a letter opened over the wall
       (schoolboard.js). Null if that failed to load. */
    schoolBoard,
    weatherIcon: (code, day) => weather.icon(code, day),
    weatherDescribe: (code) => weather.describe(code),
    /* When an event is next and how it is said ("Day 3 of 7", "Mormor turns
       76"), for the countdown panel: the same calendar.js the chips over a
       picture and the Time sheet use, so the three never disagree. A panel
       cannot import it itself — panels are loaded with the build stamp. */
    calendar,
    /* This page is a phone: it must never make the wall's noises (the hour,
       the doorbell, the bird box) in somebody's pocket. */
    phone: PHONE,
    soundlib,
    voice,
    sheetkit,
    // Economy's Travel tab, drawn by the spending panel (panels/spending.js).
    travel,
    // ...and the box under every Economy tab: notes for the kitchen agent.
    notes,
    // House → AI: what AI makes, drawn by the House panel (panels/ha.js).
    tunai,
    // House → Vacuum Cleaner: Siri's map, room by room (panels/ha.js too).
    vacuum,
  };
  soundlib.init(ctx);
  voice.init(ctx);
  notes.init(ctx);
  for (const p of PANELS) {
    buildPanel(p);
    try { p.init(document.querySelector(`#p-${p.id} .body`), ctx); }
    catch (e) { console.error(`panel ${p.id} failed to start`, e); }
  }
  weather.init();
  // Not a panel either: the bird box's count stands in the top bar, where the
  // hourly band was, and is on screen whichever view is.
  motionbar.init(ctx);
  // Nor this: the kitchen's warmth is a glance, not a view to go to, so it
  // stands in the top bar beside the bird box and travels into a full-screen
  // panel's header the same way. The chart behind it is its own sheet.
  climate.init(ctx);
  // Nor this: what in the house is waiting for somebody, in the top bar only
  // while something is. Guarded: a chip that fails must not take the wall with it.
  try { attention?.init(ctx); } catch (e) { console.error('attention failed to start', e); }
  // Not a panel either: its sheet covers the screen, and the House panel is
  // only where the two ways into it happen to live.
  lightsched.init(ctx);
  // Not a panel either, and for the sharpest version of the same reason: the
  // door opens while the wall is showing photographs, and a bell that only
  // rang on the House view would be a bell nobody trusts. The card on House
  // is only a card; this is the thing that makes the noise.
  doorbell.init(ctx, sound);
  // Nor this: the hour turns while the wall is showing photographs. Its sheet
  // hangs off the gear in the Time screen, which is why it is handed to that
  // one below.
  chime.init(ctx, sound);
  // Nor this: the phones are told by the server; this is the tile's document
  // and the sheet behind its gear. Guarded, like attention: a tile that fails
  // must not take the wall with it.
  try { phonebox.init(ctx); } catch (e) { console.error('phonebox failed to start', e); }
  // Nor this: the song at school time is the server's moment and every
  // screen's sound, whichever view is up.
  try { school?.init(ctx); } catch (e) { console.error('school failed to start', e); }
  try { brief?.init(ctx); } catch (e) { console.error('brief failed to start', e); }
  try { ask?.init(ctx); } catch (e) { console.error('ask failed to start', e); }
  // Nor this: the alarm is the server's (soil.py); this is the tile's words
  // and the sheet where its levels are found.
  try { soilAlarm?.init(ctx); } catch (e) { console.error('soil alarm failed to start', e); }
  // Nor this: the Aurora alert is the server's (aurora.py); this is the cards'
  // words and the sheet behind their gears.
  try { automation?.init(ctx); } catch (e) { console.error('automation failed to start', e); }
  // Nor these: the alarm sounds on whichever view is up; the disco is the server's.
  try { babo?.init(ctx); } catch (e) { console.error('babo failed to start', e); }
  try { fireAlarms?.init(ctx); } catch (e) { console.error('fire alarms failed to start', e); }
  try { sensors?.init(ctx); } catch (e) { console.error('sensors failed to start', e); }
  try { pctemps?.init(ctx); } catch (e) { console.error('pctemps failed to start', e); }
  try { disco?.init(ctx); } catch (e) { console.error('disco failed to start', e); }
  try { diffuser?.init(ctx); } catch (e) { console.error('diffuser failed to start', e); }
  // Nor this: a video cast from a phone plays over whichever view is up, and
  // what it covers stops under it as it does under the dim clock.
  try {
    cast?.init(ctx, { setCovered: (on) => { castCovers = on; syncPanelLifecycle(); } });
    cast?.onChange(() => {
      if (!document.getElementById('layout-overlay').hidden) renderLayoutOptions();
    });
  } catch (e) { console.error('cast failed to start', e); }
  // Nor this: the school board stands in the column under the countdown over
  // a picture, and is the agent's to write. It says when there comes to be
  // one, and the column swaps the hours for it.
  try {
    schoolBoard?.init(ctx);
    schoolBoard?.onChange(paintSide);
  } catch (e) { console.error('school board failed to start', e); }
  // Not a panel either: the wall sleeps when the kitchen is empty, and this is
  // what notices it has come back and what tells the server somebody is here.
  // A phone's taps are not somebody standing in the kitchen: it never holds
  // the wall awake.
  wake.init({ touch: !PHONE });
  // Neither of these is a panel: they live in the header and are always there.
  // The Time sheet reads the countdown and the timers off the same bus their
  // panels do, so it is correct without either of them having to be on screen.
  timeSheet.init(ctx, calendar, chime);
  // Night mode: its 🌙 goes in the Time sheet's header, and its clock over the
  // resting view — so it is handed both, and the pieces of this file it needs:
  // calendar.js too, for the countdown's line at the bottom of the clock.
  try {
    night?.init(ctx, {
      timeSheet, weather, calendar, sheetOpen, presetName, restingView: homePreset,
      setCovered: (on) => { nightCovers = on; syncPanelLifecycle(); },
    });
  } catch (e) { console.error('night mode failed to start', e); }
  // The clock a full-screen panel carries is the same button as the top bar's,
  // and so is its weather.
  timeSheet.wire(expandedExtras.querySelector('.hx-clock'), { stop: true });
  weather.wire(expandedExtras.querySelector('.hx-wx'), { stop: true });
  watchCountdown(bus);
  wireFullscreen();
  wireDim();
  wireLayoutGear();
  if (PHONE) phone.init(ctx, { panelById, setPreset, presetName, weather });
  // The box under the views: dates and events for the kitchen agent, typed
  // or spoken (notes.js). A phone has its views along the bottom, so there it
  // goes under the view's title. Guarded: a box that fails must not take the
  // wall with it.
  try {
    const q = document.getElementById('qnote');
    if (PHONE) document.getElementById('ph-head')?.after(q);
    notes.mountQuick(q);
  } catch (e) { console.error('the note box failed to start', e); }

  applyLayout();
  armIdleReturn();
  // Any touch anywhere is somebody using the view they are on, so the quarter
  // of an hour starts again. Capture and passive, and never a pointer capture:
  // this must not take the gesture off a carousel or a slider (see food.js).
  addEventListener('pointerdown', armIdleReturn, { capture: true, passive: true });
  // Leaving the page stops every stream it was holding; coming back starts
  // them again. Chrome keeps a WebRTC connection and a video element alive in
  // a background tab, so without this the bird box streams all evening into a
  // tab nobody is looking at.
  document.addEventListener('visibilitychange', syncPanelLifecycle);

  if (uiState.expanded) {
    const id = uiState.expanded;
    uiState.expanded = null; // expand() sets it again
    // Laid out, not live: the page may have loaded in a background tab, and
    // the expanded panel still has to come back expanded when it surfaces.
    const p = panelById(id);
    if (p && panelLaidOut(p, currentPreset())) expand(id);
  }
  // Started: index.html's watchdog stands down.
  window.kitchenBooted = true;
}

boot().catch((e) => {
  const box = document.createElement('div');
  box.className = 'placeholder';
  box.append(`the dashboard could not start: ${e?.message || e}`, document.createElement('br'),
    'retrying once the server answers…');
  grid.replaceChildren(box);
  reportStartFailure(e);
  // Ten seconds at the soonest (it settles, then asks twice). A reload into a
  // kitchen that is away is the proxy's page, with no code on it to try again.
  reloadWhenReachable();
});
