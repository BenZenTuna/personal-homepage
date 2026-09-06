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
const timeSheet = await load('./time.js');
const PANELS = await Promise.all(
  ['camera', 'media', 'ha', 'food', 'countdown', 'tv', 'timers', 'services']
    .map((n) => load(`./panels/${n}.js`)));

const grid = document.getElementById('grid');
const presetsNav = document.getElementById('presets');
const presetsHome = presetsNav.parentElement;   // where they live un-expanded

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
  + '<span class="hx-wx"><span class="hx-ico"></span><span class="hx-temp">--°</span></span>';

function expandedHeader(el) {
  const header = el.querySelector('header');
  header.insertBefore(expandedExtras, header.querySelector('.meta'));
  header.insertBefore(presetsNav, header.querySelector('.custom-buttons'));
  tickClock();
  weather.mirror(expandedExtras);
}

function restoreHeader() {
  presetsHome.appendChild(presetsNav);
  expandedExtras.remove();
  weather.mirror(null);
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
  el.querySelector('.expand').textContent = 'Close';
  expandedHeader(el);
  saveUiState({ expanded: id });
  panelById(id).onExpand?.();
}

function collapse() {
  const id = uiState.expanded;
  if (!id) return;
  const el = document.getElementById(`p-${id}`);
  el.classList.remove('expanded');
  el.querySelector('.expand').textContent = '⤢';
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
    weatherIcon: (code, day) => weather.icon(code, day),
    weatherDescribe: (code) => weather.describe(code),
  };
  for (const p of PANELS) {
    buildPanel(p);
    try { p.init(document.querySelector(`#p-${p.id} .body`), ctx); }
    catch (e) { console.error(`panel ${p.id} failed to start`, e); }
  }
  weather.init();
  // Neither of these is a panel: they live in the header and are always there.
  // The Time sheet reads the countdown and the timers off the same bus their
  // panels do, so it is correct without either of them having to be on screen.
  timeSheet.init(ctx);
  wireFullscreen();
  wireMeal();
  wireLayoutGear();

  applyLayout();
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
