/* The kitchen on a phone.

   The wall is a 1920×1080 screen read from the doorway; a phone is a hand's
   width read at arm's length. The same page serves both, and index.html marks
   a phone (the `phone` class on <html>) before anything loads. From there:

   - phone.css lays the page out in one column, and every rule in it starts
     with html.phone, so nothing on the wall or a laptop changes;
   - this module is loaded by app.js only on a phone, and does the few things
     CSS cannot: the views along the bottom, a header saying which one this
     is, the order each view's panels come in, and the running timer that
     follows you from view to view.

   The panels are the wall's own. Nothing here draws a dinner, a light card or
   a photograph — they are laid out differently, and that is all.

   A phone's view is its own. The wall keeps its state on the server
   (ui-state), and any page that saves writes its whole copy of that state
   back; a phone doing that would change what the wall comes back to after
   its next reload, and put back whatever the wall had changed since the
   phone opened. So a phone keeps its view in its address and in its own
   storage, and writes to the server only the settings it actually changed
   (share() below). */

/* Which panels each view shows on a phone, top to bottom. Keyed by the
   preset names in layouts.json; a preset not listed here shows what its
   first arrangement shows, in that order.

   `full` panels are drawn at their full size although the phone is narrow:
   the Cooking panel measures itself and would otherwise draw the strip it
   draws under the photographs. `single` views are one panel and nothing
   else, so that panel has no ⤢ to offer. */
const VIEWS = {
  grid:    { label: 'Now', panels: ['food', 'countdown'], now: true },
  cooking: { panels: ['food', 'timers'], full: ['food'] },
  house:   { panels: ['ha', 'spending', 'services'] },
  ambient: { panels: ['media'], single: true },
  birds:   { panels: ['camera'], single: true },
  tv:      { panels: ['tv'], single: true },
  radar:   { panels: ['radar'], single: true },
};

/* Stroke icons for the bar along the bottom. The wall's buttons are words in
   the view's colour; at a sixth of a phone's width a word alone is too small
   to find by, so each gets a glyph above it in the same colour. */
const ICON = {
  grid: '<rect x="3.5" y="3.5" width="7" height="7" rx="1.5"/><rect x="13.5" y="3.5" width="7" height="7" rx="1.5"/><rect x="3.5" y="13.5" width="7" height="7" rx="1.5"/><rect x="13.5" y="13.5" width="7" height="7" rx="1.5"/>',
  cooking: '<path d="M4 11h16v3a6 6 0 0 1-6 6h-4a6 6 0 0 1-6-6z"/><path d="M2.5 11h19"/><path d="M9 7.5c0-1.2 1.2-1.3 1.2-2.5M13.8 7.5c0-1.2 1.2-1.3 1.2-2.5"/>',
  house: '<path d="M3.5 11 12 4l8.5 7"/><path d="M5.5 9.5V20h13V9.5"/><path d="M10 20v-5h4v5"/>',
  ambient: '<rect x="3" y="5" width="18" height="14" rx="2"/><circle cx="9" cy="10" r="1.8"/><path d="m20.5 16-5-5L7 19.5"/>',
  birds: '<path d="M4 10 12 3.5 20 10"/><path d="M6 8.5V20h12V8.5"/><circle cx="12" cy="12.5" r="2.2"/><path d="M12 16.5v1.5"/>',
  tv: '<rect x="3" y="6.5" width="18" height="12" rx="2"/><path d="M8.5 21h7M9 3l3 3.5L15 3"/>',
  radar: '<circle cx="12" cy="12" r="8.5"/><circle cx="12" cy="12" r="4.5"/><path d="M12 12 18 6"/><circle cx="12" cy="12" r="1" fill="currentColor"/>',
};
const svg = (paths) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"
  stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths}</svg>`;

// Settings that are the wall's alone: which view it shows and whether a panel
// fills it. Whatever else a phone changes — a heart, a dinner picked, an
// alarm sound — is the household's, and goes to the server.
const LOCAL = new Set(['preset', 'expanded']);
const STORE = 'kitchen-phone-view';
const HOURS = 6;          // the hours in the weather card on Now

// The sheets and overlays that cover the page: Back closes the top one.
const SHEETS = ['#wx-overlay', '#ts-overlay', '#cl-sheet', '#lx-sheet', '#light-sheet', '#db-sheet',
  '#ch-sheet', '#at-sheet', '#nt-sheet', '#pb-sheet', '#sc-sheet', '#sl-sheet', '#sb-doc', '#au-sheet', '#bf-sheet', '#ask-sheet',
  '#bb-sheet', '#cd-sheet', '#dc-sheet', '#df-sheet', '#rf-sheet', '#an-sheet', '#tn-sheet', '#alarm-sheet',
  '#vc-sheet', '#fa-sheet', '#sn-sheet', '#pt-sheet'].join(', ');

const esc = (s) => String(s ?? '').replace(/[&<>"]/g,
  (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

export default {
  view: null,
  pending: {},

  /* ------------------------------------------------------------ views ---- */

  viewOf(name) { return VIEWS[name] || null; },

  // The address says which view: #cooking, #house. Built from the labels, so
  // it reads the way the buttons do.
  slug(name) {
    const p = this.config?.layouts.presets[name];
    return String(this.viewOf(name)?.label || p?.label || name).toLowerCase();
  },

  fromSlug(slug) {
    const presets = this.config.layouts.presets;
    return Object.keys(presets).find((k) => this.slug(k) === slug) || null;
  },

  /* The view to open on: the one in the address, then the one this phone was
     left on, then Now. Called before init(), with nothing on screen yet. */
  start(config) {
    this.config = config;
    const presets = config.layouts.presets;
    const fromHash = this.fromSlug(decodeURIComponent(location.hash.slice(1)));
    let stored = null;
    try { stored = localStorage.getItem(STORE); } catch { /* private window */ }
    return fromHash || (presets[stored] ? stored : Object.keys(presets)[0]);
  },

  panelsOf(name) {
    const v = this.viewOf(name);
    if (v) return v.panels;
    const p = this.config.layouts.presets[name] || {};
    const first = p.variants ? Object.values(p.variants)[0] : p;
    return first.visible || [];
  },

  shows(id, name) { return this.panelsOf(name).includes(id); },

  /* ------------------------------------------------------------- boot ---- */

  init(ctx, api) {
    this.ctx = ctx;
    this.api = api;
    this.config = ctx.config;
    const root = document.documentElement;

    // What this is, above everything else: live, the date, and the view.
    this.head = document.createElement('header');
    this.head.id = 'ph-head';
    this.head.innerHTML = `
      <div class="ph-kick"><span class="ph-date"></span></div>
      <h1 class="ph-title"></h1>`;
    document.body.prepend(this.head);
    // The wall's own Live and its dot, moved rather than copied: app.js keeps
    // painting them by id.
    const live = document.querySelector('.hd-live');
    if (live) this.head.querySelector('.ph-kick').prepend(live);
    // 🎤 Ask the kitchen (ask.js), moved the same way: top right of the head.
    const askBtn = document.getElementById('ask-btn');
    if (askBtn) this.head.append(askBtn);
    this.paintDate();
    setInterval(() => this.paintDate(), 60 * 1000);

    // The views along the bottom. The wall's buttons, moved out of the top
    // bar (which only Now shows) and given a glyph each.
    const nav = document.getElementById('presets');
    nav.querySelectorAll('button').forEach((b) => {
      const name = b.dataset.preset;
      const label = this.viewOf(name)?.label || b.textContent;
      b.innerHTML = `<span class="ph-ico">${svg(ICON[name] || ICON.grid)}</span>`
        + `<span class="ph-lab">${esc(label)}</span>`;
      b.setAttribute('aria-label', label);
    });
    document.body.appendChild(nav);

    this.buildHours();
    this.buildTimer();
    this.buildBack();

    // Back and forward move between views, as they would in any app.
    addEventListener('hashchange', () => {
      const name = this.fromSlug(decodeURIComponent(location.hash.slice(1)));
      if (name && name !== api.presetName()) api.setPreset(name);
    });
    root.classList.add('ph-ready');
  },

  paintDate() {
    const el = this.head.querySelector('.ph-date');
    el.textContent = new Date().toLocaleDateString('en-GB',
      { weekday: 'long', day: 'numeric', month: 'long' });
  },

  /* Lay the page out for one view. Called by app.js whenever the layout is
     applied — on arrival, and every time a view is chosen. */
  arrange(name) {
    const root = document.documentElement;
    const view = this.viewOf(name) || {};
    const order = this.panelsOf(name);

    if (name !== this.view) {
      const was = this.viewOf(this.view);
      // A panel drawn full-size in the view being left goes back to measuring
      // itself; one drawn full-size in this view stops.
      for (const id of was?.full || []) {
        if (!view.full?.includes(id)) this.api.panelById(id)?.onCollapse?.();
      }
      for (const id of view.full || []) {
        if (!was?.full?.includes(id)) this.api.panelById(id)?.onExpand?.();
      }
      const first = this.view === null;
      this.view = name;
      try { localStorage.setItem(STORE, name); } catch { /* private window */ }
      const slug = `#${encodeURIComponent(this.slug(name))}`;
      if (location.hash !== slug) {
        // The first view replaces the address; every later one is a step the
        // back button can take back.
        if (first) history.replaceState(null, '', slug);
        else location.hash = slug;
      }
      if (!first) window.scrollTo(0, 0);
    }

    root.classList.toggle('ph-now', !!view.now);
    root.classList.toggle('ph-single', !!view.single);
    root.dataset.phView = name;
    const preset = this.config.layouts.presets[name] || {};
    this.head.querySelector('.ph-title').textContent = view.label || preset.label || name;

    for (const el of document.querySelectorAll('#grid > .panel')) {
      const id = el.id.slice(2);   // "p-food" → "food"
      const i = order.indexOf(id);
      el.style.order = i < 0 ? '' : String(i);
      // No ⤢ where the panel already is the whole view.
      el.classList.toggle('ph-whole', i >= 0 && (!!view.single || !!view.full?.includes(id)));
    }
    this.paintTimer();
  },

  /* --------------------------------------------------- saving settings ---- */

  /* Only what this phone changed, laid over what the server has now. The
     wall's PUT sends its whole state, which is right for the wall — it is the
     only thing that changes most of it — and wrong for a phone, whose copy is
     as old as the moment it was opened. */
  share(partial) {
    for (const [k, v] of Object.entries(partial)) {
      if (!LOCAL.has(k)) this.pending[k] = v;
    }
    if (!Object.keys(this.pending).length) return;
    clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(async () => {
      const patch = this.pending;
      this.pending = {};
      try {
        const now = await (await fetch('/api/ui-state', { cache: 'no-store' })).json();
        const r = await fetch('/api/ui-state', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ...now, ...patch }),
        });
        if (!r.ok) throw new Error(r.status);
      } catch {
        // Kept for the next change, the way the wall's own save is retried.
        this.pending = { ...patch, ...this.pending };
      }
    }, 400);
  },

  /* --------------------------------------------- Back closes a sheet ---- */

  /* A sheet on a phone is the whole screen, and Back is how a phone leaves
     one (2026-10-15 review): it used to step the view back under the sheet,
     which stayed open over the wrong view. So a sheet opening adds a step to
     the history; Back takes it, and the sheet closes as its own Close would.
     A sheet closed by its Close takes its step back out, so the next Back is
     a view again. Watched rather than wired into each sheet: they are a
     dozen modules' own, and all of them open and close by the `open` class. */
  buildBack() {
    this.sheetStack = [];    // [{el, hash}], the newest last
    this.backClosing = 0;    // closes Back asked for, not yet seen
    this.ownBacks = 0;       // history.back() calls of ours, not yet popped
    new MutationObserver((records) => {
      for (const m of records) {
        const el = m.target;
        if (!(el instanceof Element) || !el.matches(SHEETS)) continue;
        const open = el.classList.contains('open');
        const known = this.sheetStack.some((x) => x.el === el);
        if (open && !known) {
          this.sheetStack.push({ el, hash: location.hash });
          history.pushState({ phSheet: el.id }, '');
        } else if (!open && known) {
          this.sheetStack = this.sheetStack.filter((x) => x.el !== el);
          if (this.backClosing) this.backClosing -= 1;
          // Closed by its own Close: its step comes out again — but only
          // while it is the step we are on. A sheet that closed because a
          // button in it went to another view (See the Radar feed) leaves
          // that view where it is.
          else if (history.state?.phSheet === el.id) { this.ownBacks += 1; history.back(); }
        }
      }
    }).observe(document.body, { subtree: true, attributes: true, attributeFilter: ['class'] });
    addEventListener('popstate', () => {
      if (this.ownBacks) { this.ownBacks -= 1; return; }
      const top = this.sheetStack[this.sheetStack.length - 1];
      // Back, from the sheet's step to the page under it: the same address,
      // no longer the sheet's step. Anything else — a view chosen, Forward —
      // is not a Back from the sheet.
      if (!top || history.state?.phSheet === top.el.id || location.hash !== top.hash) return;
      this.backClosing += 1;
      const close = top.el.querySelector(':scope > header .ls-close, :scope .ls-close, :scope .cl-close, '
        + ':scope .as-close, :scope .at-close, #wx-close, #ts-close');
      if (close) close.click(); else top.el.classList.remove('open');
      // A Close that did not close (a sheet that refuses) leaves no debt.
      setTimeout(() => {
        if (top.el.classList.contains('open') && this.backClosing) {
          this.backClosing -= 1;
          history.pushState({ phSheet: top.el.id }, '');
        }
      }, 300);
    });
  },

  /* ----------------------------------------------- the weather on Now ---- */

  /* The next few hours inside the weather card, so the forecast is a glance
     rather than a tap. The wall's top bar gave its hours up for the bird box;
     a phone has the height for them. Read off the weather module's own data,
     so it is never a second forecast. */
  buildHours() {
    const now = document.querySelector('.hd-now');
    if (!now) return;
    this.hours = document.createElement('div');
    this.hours.className = 'ph-hours';
    now.appendChild(this.hours);
    this.hoursKey = null;
    const paint = () => this.paintHours();
    // Checked often and painted only when something moved: the forecast
    // arrives a moment after the page, and changes on the hour.
    paint();
    setInterval(paint, 5 * 1000);
  },

  paintHours() {
    const w = this.api.weather;
    const hours = w?.data?.hourly;
    if (!this.hours || !hours?.length) return;
    const i = Math.max(0, w.nowIndex(hours));
    const slice = hours.slice(i, i + HOURS);
    const key = slice.map((h) => `${h.t}:${Math.round(h.temp)}:${h.code}`).join('|');
    if (key === this.hoursKey) return;
    this.hoursKey = key;
    this.hours.innerHTML = slice.map((h, n) => {
      const dt = new Date(w.ms(h.t));   // epoch seconds: right across a clock change
      const label = n === 0 ? 'now' : `${String(dt.getHours()).padStart(2, '0')}:00`;
      return `<span class="ph-h${n === 0 ? ' now' : ''}">
        <span class="ph-h-t">${label}</span>
        <span class="ph-h-ico">${w.icon(h.code, h.day)}</span>
        <span class="ph-h-c">${Math.round(h.temp)}°</span></span>`;
    }).join('');
  },

  /* --------------------------------------------- the running timer ---- */

  /* A kitchen timer runs on in every view: the soonest one that is running,
     paused or ringing floats above the views, and a tap goes to the dials.
     Read off the same bus the timers panel reads, so it is right whether or
     not that panel is on screen. */
  buildTimer() {
    this.timers = [];
    this.skew = 0;
    this.pill = document.createElement('button');
    this.pill.id = 'ph-timer';
    this.pill.hidden = true;
    this.pill.innerHTML = `
      <svg class="ph-t-ring" viewBox="0 0 30 30" aria-hidden="true">
        <circle cx="15" cy="15" r="12" class="trk"/>
        <circle cx="15" cy="15" r="12" class="arc" transform="rotate(-90 15 15)"/>
      </svg>
      <span class="ph-t-left"></span>`;
    this.pill.addEventListener('click', () => {
      if (this.api.presetName() !== 'cooking') this.api.setPreset('cooking');
      requestAnimationFrame(() => document.getElementById('p-timers')
        ?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
    });
    document.body.appendChild(this.pill);
    this.ctx.bus.on('timers', (rows) => {
      if (Array.isArray(rows)) { this.timers = rows; this.paintTimer(); }
    });
    // The server's clock, so a phone whose own clock is a minute out still
    // counts down to the same second as the wall.
    fetch('/api/timers', { cache: 'no-store' }).then((r) => r.json()).then((d) => {
      if (typeof d?.now === 'number') this.skew = d.now * 1000 - Date.now();
    }).catch(() => {});
    setInterval(() => this.paintTimer(), 1000);
  },

  paintTimer() {
    if (!this.pill) return;
    const now = Date.now() + this.skew;
    const left = (t) => (t.state === 'running' ? (t.ends_at || 0) * 1000 - now
      : t.state === 'paused' ? (t.remaining_s || 0) * 1000 : 0);
    const active = this.timers.filter((t) => ['running', 'paused', 'done'].includes(t.state))
      .sort((a, b) => (a.state === 'done' ? -1 : b.state === 'done' ? 1 : left(a) - left(b)));
    const t = active[0];
    // Not over the dials themselves: the timers panel is right there.
    const onDials = this.api.presetName() === 'cooking';
    this.pill.hidden = !t || onDials;
    if (!t || onDials) return;
    const ms = Math.max(0, left(t));
    const s = Math.ceil(ms / 1000);
    const text = t.state === 'done' ? 'Done'
      : s >= 3600 ? `${Math.floor(s / 3600)}:${String(Math.floor(s / 60) % 60).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`
      : `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
    this.pill.querySelector('.ph-t-left').textContent = text;
    this.pill.classList.toggle('done', t.state === 'done');
    this.pill.classList.toggle('paused', t.state === 'paused');
    const total = (t.duration_s || 0) * 1000;
    const frac = t.state === 'done' ? 0 : total > 0 ? Math.min(1, ms / total) : 1;
    const C = 2 * Math.PI * 12;
    this.pill.querySelector('.arc').setAttribute('stroke-dasharray', `${(frac * C).toFixed(1)} ${C.toFixed(1)}`);
    this.pill.setAttribute('aria-label',
      t.state === 'done' ? 'a timer has finished' : `timer, ${text} left`);
  },
};
