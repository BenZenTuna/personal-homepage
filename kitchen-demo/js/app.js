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

const { createBus } = await import(`./sse.js${V}`);
const weather = await load('./weather.js');
const motionbar = await load('./motionbar.js');
const timeSheet = await load('./time.js');
const PANELS = await Promise.all(
  ['camera', 'media', 'ha', 'food', 'countdown', 'tv', 'timers', 'services']
    .map((n) => load(`./panels/${n}.js`)));

const grid = document.getElementById('grid');
const presetsNav = document.getElementById('presets');
const presetsHome = presetsNav.parentElement;   // where they live un-expanded
// ...and *where in it*. restoreHeader() used to appendChild() them back, which
// is the end of the top bar, not the place they came from — so the first
// expand-and-close of the day moved the views to the right of the tool column
// and left them there until a reload. The header is only correct by accident
// if nobody has ever pressed ⤢.
const presetsNext = presetsNav.nextElementSibling;

let config;
let uiState;
const shown = {};
let saveTimer = null;

function saveUiState(partial) {
  Object.assign(uiState, partial);
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
   Chrome on the wall also starts full screen, from its own desktop entry; this
   is the way back in after someone has left it, and there is no keyboard up
   there to press F11 with. */
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

/* ---------- meal time ----------
   Half an hour of black. The end time is saved server-side rather than counted
   down in a variable, so a deploy reloading the wall in the middle of dinner
   does not put the kitchen lights back on the wall. */
const MEAL_MS = 30 * 60 * 1000;

function wireMeal() {
  const overlay = document.getElementById('meal-overlay');
  const clockEl = document.getElementById('meal-clock');
  let timer = null;

  const stop = () => {
    clearInterval(timer);
    timer = null;
    overlay.hidden = true;
    saveUiState({ meal_until: null });
  };

  const run = (until) => {
    overlay.hidden = false;
    clearInterval(timer);
    const paint = () => {
      const left = until - Date.now();
      if (left <= 0) return stop();
      const s = Math.ceil(left / 1000);
      clockEl.textContent =
        `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
    };
    paint();
    timer = setInterval(paint, 1000);
  };

  document.getElementById('meal-btn').onclick = () => {
    const until = Date.now() + MEAL_MS;
    saveUiState({ meal_until: until });
    run(until);
  };
  document.getElementById('meal-end').onclick = stop;

  if (uiState.meal_until && uiState.meal_until > Date.now()) run(uiState.meal_until);
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
   the same six would be a second thing to keep in step. */
const expandedExtras = document.createElement('div');
expandedExtras.className = 'hx';
expandedExtras.innerHTML =
  '<span class="hx-time"></span>'
  + '<span class="hx-wx"><span class="hx-ico"></span><span class="hx-temp">--°</span>'
  + '<span class="hx-feels"></span></span>'
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
/* Six over a picture, two in an ordinary full-screen header (the CSS drops the
   rest there — the row has the width for two). A header row could only ever
   hold a couple, and the answer to "what is coming" was cut off at the point
   where it starts being useful: the next thing, and then the shape of the
   fortnight. Down the left edge of a photograph there is a column's worth of
   room going spare, so the list runs as far as the band it stands in. */
const NEXT_EVENTS = 6;
let nextEvents = [];

function daysUntil(iso) {
  const [y, m, d] = String(iso).split('-').map(Number);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return Math.round((new Date(y, m - 1, d) - today) / 86400000);
}

function watchCountdown(bus) {
  bus.on('countdown', (events) => {
    nextEvents = Array.isArray(events)
      ? events.filter((e) => e && e.title && e.date).map((e) => ({ ...e }))
      : [];
    paintNextEvents();
  });
  // Midnight turns "1 day" into "Today", and drops an event that has arrived,
  // without anything at all arriving on the bus.
  setInterval(paintNextEvents, 60 * 1000);
}

function paintNextEvents() {
  const box = expandedExtras.querySelector('.hx-events');
  if (!box) return;
  // Recomputed from the date every paint rather than stored: the wall runs for
  // weeks, and a day count worked out once is wrong by morning.
  const soon = nextEvents
    .map((e) => ({ ...e, n: daysUntil(e.date) }))
    .filter((e) => e.n >= 0)
    .sort((a, b) => a.n - b.n)
    .slice(0, NEXT_EVENTS);

  box.textContent = '';
  for (const e of soon) {
    const n = e.n;
    const chip = document.createElement('span');
    chip.className = 'hx-next';
    chip.innerHTML = '<span class="hx-next-n"></span><span class="hx-next-t"></span>';
    chip.querySelector('.hx-next-n').textContent =
      n === 0 ? 'Today' : n === 1 ? '1 day' : `${n} days`;
    // textContent, not innerHTML: an event title is typed by hand in the
    // countdown editor and goes on the wall unescaped otherwise.
    chip.querySelector('.hx-next-t').textContent = e.title;
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

function expandedHeader(el) {
  const header = el.querySelector('header');
  header.insertBefore(expandedExtras, header.querySelector('.meta'));
  header.insertBefore(presetsNav, header.querySelector('.custom-buttons'));
  /* The bird box, where a picture has covered the top bar that usually carries
     it — in the clock's own column, under the time and above what is coming,
     as a chip the size of theirs. Out on its own in the header row it was a
     second block floating in the middle of a photograph; in the column it is
     one more line of the same stack, which is what it is. Never in the bird
     box's own, where the first button already says the count. */
  if (el.classList.contains('bleed') && el.id !== 'p-camera') {
    motionbar.mount(expandedExtras, expandedExtras.querySelector('.hx-events'));
  }
  tickClock();
  weather.mirror(expandedExtras);
  paintNextEvents();
}

function restoreHeader() {
  presetsHome.insertBefore(presetsNav, presetsNext);
  expandedExtras.remove();
  motionbar.mount(null);
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
  weather.column(wxColumn);
  placeHours();          // it stands under the column; see placeHours()
}

function restoreSideColumn(el) {
  if (el) el.classList.remove('has-wxcol');
  wxColumn.remove();
  weather.column(null);
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
function presetName() {
  const presets = config.layouts.presets;
  return presets[uiState.preset] ? uiState.preset : Object.keys(presets)[0];
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

/* The home view is Everything's business wherever you happen to be standing:
   it is that view's arrangement that was chosen, not Cooking's. */
function homePreset() {
  const presets = config.layouts.presets;
  const base = Object.keys(presets)[0];
  const key = variantKey(base);
  const home = (key && variantsOf(base)[key].home) || presets[base].home;
  return presets[home] ? home : base;
}

function sheetOpen() {
  return !!document.querySelector('#wx-overlay.open, #ts-overlay.open')
    || !document.getElementById('layout-overlay').hidden
    || !document.getElementById('meal-overlay').hidden;
}

function armIdleReturn() {
  clearTimeout(idleTimer);
  idleTimer = null;
  const name = presetName();
  if (config.layouts.presets[name]?.stay) return;   // Photos, Birds and TV stay put
  if (name === homePreset()) return;
  idleTimer = setTimeout(() => {
    // Still being read: ask again in another quarter of an hour rather than
    // pulling the sheet out from under whoever opened it.
    if (sheetOpen()) return armIdleReturn();
    const home = homePreset();
    if (presetName() !== home) setPreset(home);
  }, HOME_AFTER_MS);
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
  return preset.visible.includes(p.id);
}

function syncPanelLifecycle() {
  const preset = currentPreset();
  for (const p of PANELS) {
    const live = panelLaidOut(p, preset) && !(document.hidden && p.pauseWhenUnseen);
    if (live && !shown[p.id]) p.onShow?.();
    if (!live && shown[p.id]) p.onHide?.();
    shown[p.id] = live;
  }
}

function applyLayout() {
  const preset = currentPreset();
  grid.style.gridTemplateAreas = preset.areas.map((r) => `"${r}"`).join(' ');
  const cols = preset.areas[0].trim().split(/\s+/).length;
  grid.style.gridTemplateColumns = `repeat(${cols}, 1fr)`;
  grid.style.gridTemplateRows = preset.rows || `repeat(${preset.areas.length}, 1fr)`;

  for (const p of PANELS) {
    document.getElementById(`p-${p.id}`).style.display =
      panelLaidOut(p, preset) ? '' : 'none';
  }
  syncPanelLifecycle();

  presetsNav.querySelectorAll('button').forEach((b) =>
    b.classList.toggle('on', b.dataset.preset === uiState.preset));
}

function setPreset(name) {
  if (uiState.expanded) collapse();
  saveUiState({ preset: name });
  applyLayout();
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
  const name = presetName();
  if (variantsOf(name)) return name;
  return Object.keys(config.layouts.presets).find(variantsOf) || null;
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

function renderLayoutOptions() {
  const name = gearTarget();
  const box = document.getElementById('lay-options');
  if (!name) { box.innerHTML = ''; return; }
  const preset = config.layouts.presets[name];
  const active = variantKey(name);
  const showing = presetName() === name;

  document.getElementById('lay-title').textContent = `${preset.label || name} — how it is arranged`;
  document.getElementById('lay-sub').textContent = showing
    ? 'Tap an arrangement to use it.'
    : `Tap an arrangement to use it and switch to ${preset.label || name}.`;

  box.innerHTML = Object.entries(preset.variants).map(([key, v]) => `
    <button class="lay-opt${key === active ? ' on' : ''}" data-k="${esc(key)}">
      ${variantPreview(v)}
      <span class="lay-txt">
        <span class="lay-name">${esc(v.label || key)}${
          key === active ? '<em>in use</em>' : ''}</span>
        <span class="lay-note">${esc(v.note || '')}</span>
      </span>
    </button>`).join('');

  box.querySelectorAll('.lay-opt').forEach((b) => {
    b.onclick = () => setVariant(name, b.dataset.k);
  });
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
  if (!gearTarget()) { btn.hidden = true; return; }

  const close = () => { overlay.hidden = true; btn.classList.remove('on'); };
  btn.onclick = () => {
    if (!overlay.hidden) return close();
    renderLayoutOptions();
    overlay.hidden = false;
    btn.classList.add('on');
  };
  document.getElementById('lay-close').onclick = close;
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
  restoreSideColumn(el);
  restoreHeader();
  saveUiState({ expanded: null });
  panelById(id).onCollapse?.();
}

/* ---------- boot ---------- */
async function boot() {
  tickClock();
  setInterval(tickClock, 1000);

  [config, uiState] = await Promise.all([
    fetch('/api/config').then((r) => r.json()),
    fetch('/api/ui-state').then((r) => r.json()),
  ]);

  const dot = document.getElementById('conn-dot');
  const label = document.getElementById('conn-text');
  const bus = createBus((ok) => {
    dot.classList.toggle('down', !ok);
    label.textContent = ok ? 'Live' : 'Offline';
  });

  for (const [name, preset] of Object.entries(config.layouts.presets)) {
    const btn = document.createElement('button');
    btn.textContent = preset.label || name;
    btn.dataset.preset = name;
    // The hue this view's own panels wear, so the button is recognisable
    // before the word on it is read. Named in layouts.json; a preset with no
    // accent keeps the ordinary ink.
    if (preset.accent) btn.style.setProperty('--accent', `var(--${preset.accent})`);
    btn.onclick = () => setPreset(name);
    presetsNav.appendChild(btn);
  }

  // The weather glyphs travel with the context so the countdown panel draws
  // an event's forecast in exactly the same hand as the header band.
  const ctx = {
    config, uiState, bus, saveUiState, addHeaderButton, setMeta,
    // The wall's home screen: the first preset in layouts.json, which is
    // Everything. The TV panel's ⌂ is the only caller — a panel that has taken
    // the whole screen needs the same way out a phone gives you.
    goHome: () => setPreset(Object.keys(config.layouts.presets)[0]),
    /* A panel showing a summary of itself sending you to the view that has the
       whole thing — the Cooking strip does this when a dish is tapped. Unknown
       names are ignored rather than throwing: a panel naming a preset somebody
       has since renamed in layouts.json should do nothing, not break. */
    setPreset: (name) => { if (config.layouts.presets[name]) setPreset(name); },
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
    weatherIcon: (code, day) => weather.icon(code, day),
    weatherDescribe: (code) => weather.describe(code),
  };
  for (const p of PANELS) {
    buildPanel(p);
    try { p.init(document.querySelector(`#p-${p.id} .body`), ctx); }
    catch (e) { console.error(`panel ${p.id} failed to start`, e); }
  }
  weather.init();
  // Not a panel either: the bird box's count stands in the top bar, where the
  // hourly band was, and is on screen whichever view is.
  motionbar.init(ctx);
  // Neither of these is a panel: they live in the header and are always there.
  // The Time sheet reads the countdown and the timers off the same bus their
  // panels do, so it is correct without either of them having to be on screen.
  timeSheet.init(ctx);
  watchCountdown(bus);
  wireFullscreen();
  wireMeal();
  wireLayoutGear();

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
}

boot().catch((e) => {
  grid.innerHTML =
    `<div class="placeholder">the dashboard could not start: ${e}<br>retrying in 10 seconds…</div>`;
  setTimeout(() => location.reload(), 10000);
});
