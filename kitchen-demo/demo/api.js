/* The demo's stand-in for the kitchen server.
 *
 * The real dashboard talks to a FastAPI container: it fetches /api/* and holds
 * one server-sent-events connection that every panel subscribes to. Nothing in
 * the panels is changed for this demo — instead, window.fetch and
 * window.EventSource are replaced here, before the dashboard's own modules are
 * imported, and answer out of a small in-memory state.
 *
 * That state is real state: toggling a light, choosing a dinner, ticking an
 * ingredient or starting a timer mutates it and is broadcast on the fake bus,
 * exactly as the server would broadcast it — which is why panels that never
 * asked for the change still follow along. It is saved to localStorage, so a
 * visitor's poking around survives a reload, and the badge in the corner
 * throws it away again.
 *
 * Requests that are not /api/* — the fonts, the photographs, the clip — are
 * passed straight through to the network, because those files really exist.
 */
(function () {
  'use strict';

  const D = window.DEMO;
  // Bumped whenever fresh() gains a key: a visitor carrying last month's saved
  // state would otherwise get a dashboard with no bird box log and no week in
  // it, which looks exactly like a broken panel.
  const STORE = 'kitchen-demo-v5';
  const BUILD = 'demo';
  const DAY = 86400000;

  /* ------------------------------------------------------------ the state */

  function fresh() {
    return {
      ui: {
        preset: 'grid', variants: {}, expanded: null,
        cam_muted: true, media_open: [], meal_until: null,
        alarm_sound: 'funny', cook_pick: { veg: 0, normal: 0 },
      },
      timers: JSON.parse(JSON.stringify(D.TIMERS)),
      events: JSON.parse(JSON.stringify(D.EVENTS)),
      sugg: JSON.parse(JSON.stringify(D.SUGGESTIONS)),
      week: D.week(),
      shopping: JSON.parse(JSON.stringify(D.SHOPPING)),
      pantry: JSON.parse(JSON.stringify(D.PANTRY)),
      motion: {
        settings: { ...D.MOTION_SETTINGS },
        camera: { ...D.MOTION_CAMERA },
        // Oldest first, as the server's own log file is.
        events: D.motionEvents(),
      },
      ha: D.haStates(),
      slideshow: { ...D.CONFIG.slideshow },
      // The tree writes these: a folder and whether it means "everything under
      // here" (deep) or only its own loose files. An intermediate folder that
      // holds nothing itself is a perfectly good entry, which is why they come
      // back on their own as selected_paths rather than as a flag on a row.
      albums: [
        { root: 'photos', folder: 'Pictures/2026', deep: true },
        { root: 'photos', folder: 'Pictures/2025/Hills', deep: true },
      ],
      liked: [],
      disliked: [],
      slide: 0,
    };
  }

  let S = fresh();
  try {
    const saved = JSON.parse(localStorage.getItem(STORE) || 'null');
    if (saved && saved.ui) S = { ...S, ...saved };
  } catch { /* private window, or a half-written entry: the defaults stand */ }

  /* The bird box log and the week are the two things here that are about
     *when* rather than what, and a visitor's saved state is from whenever they
     last looked. A log whose newest still is three days old reads as a camera
     that has stopped, and a plan that ran out on Tuesday reads as a week
     nobody kept — so both are re-dated to this visit. What somebody changed
     while they were here is kept: the motion settings as they left them, and
     their 👍/👎 carried across by which day of the plan it was, since the
     dates underneath have all moved on.

     A test event they fired themselves goes with the old log, which is right:
     it was a demonstration of the noise, not a bird. */
  S.motion.events = D.motionEvents();
  const wasRated = (S.week?.days || []).map((d) => d.rating || {});
  S.week = D.week();
  S.week.days.forEach((d, i) => { if (wasRated[i]) d.rating = wasRated[i]; });

  /* A timer that ran out while nobody was here would greet the next visitor
     with an alarm and a flashing card. Anything more than ten minutes stale is
     put back to idle; anything still counting is left exactly as it was. */
  for (const t of S.timers) {
    if (t.state === 'running' && (t.ends_at || 0) * 1000 < Date.now() - 10 * 60000) {
      t.state = 'idle';
      t.ends_at = null;
      t.remaining_s = null;
    }
  }

  let saveTimer = null;
  function persist() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      try { localStorage.setItem(STORE, JSON.stringify(S)); } catch { /* not fatal */ }
    }, 300);
  }

  window.DEMO_RESET = function () {
    try { localStorage.removeItem(STORE); } catch { /* nothing to remove */ }
    location.reload();
  };

  /* --------------------------------------------------------------- the bus
     One shared channel, as on the server: every open screen gets a snapshot on
     connect and each change after it. */

  const clients = new Set();

  function snapshot() {
    return {
      nas_status: 'awake',
      ha_connected: true,
      ha_states: S.ha,
      countdown: decorate(S.events),
      timers: S.timers,
      cooking_suggestions: withStale(S.sugg),
      cooking_shopping: S.shopping,
      cooking_pantry: S.pantry,
      cooking_week: weekJson(),
      motion: motionJson(),
      photo_cache: cacheState(),
    };
  }

  function publish(type, value) {
    const ev = { type, value, build: BUILD };
    for (const c of clients) c(ev);
  }

  function set(type, value) {
    publish(type, value);
    persist();
  }

  class DemoEventSource {
    constructor(url) {
      this.url = url;
      this.readyState = 0;
      this.onopen = null;
      this.onmessage = null;
      this.onerror = null;
      this._deliver = (ev) => {
        if (this.onmessage) this.onmessage({ data: JSON.stringify(ev) });
      };
      clients.add(this._deliver);
      // A tick later, so a caller that assigns onopen/onmessage right after
      // the constructor is ready before anything arrives.
      setTimeout(() => {
        this.readyState = 1;
        if (this.onopen) this.onopen({});
        this._deliver({ type: 'snapshot', value: snapshot(), build: BUILD });
      }, 40);
      this._beat = setInterval(() => {
        this._deliver({ type: 'heartbeat', ts: Date.now() / 1000, build: BUILD });
      }, 15000);
    }

    addEventListener(type, fn) {
      if (type === 'message') this.onmessage = fn;
      if (type === 'open') this.onopen = fn;
      if (type === 'error') this.onerror = fn;
    }

    removeEventListener() { /* the demo bus never has to drop a handler */ }

    close() {
      clearInterval(this._beat);
      clients.delete(this._deliver);
      this.readyState = 2;
    }
  }

  window.EventSource = DemoEventSource;

  /* ---------------------------------------------------------- countdown wx
     What the backend's _decorate() does: hang whatever forecast is known for
     an event's city on it, and be explicit about why there is none. */

  function decorate(events) {
    const horizon = Date.now() + 15 * DAY;
    return events.map((e) => {
      const out = { ...e };
      const key = (e.city || '').trim().toLowerCase();
      if (!key) return out;
      const wx = D.CITY_WX[key];
      if (!wx) { out.city_found = false; return out; }
      out.now = { ...wx.now, place: wx.label };
      const when = Date.parse(`${e.date}T12:00:00`);
      out.too_far = when > horizon;
      if (!out.too_far && wx.day) out.weather = { ...wx.day, place: wx.label };
      return out;
    });
  }

  function withStale(doc) {
    return { ...doc, stale: doc.date !== D.iso(new Date()) };
  }

  /* ------------------------------------------------------------- the week
     `today` travels with the document for the same reason `stale` does on the
     suggestions: the panel must not decide which row is today against the
     clock of whatever phone is looking at it. */
  function weekJson() {
    const today = D.iso(new Date());
    return {
      ...S.week,
      today,
      has_today: (S.week.days || []).some((d) => d.date === today),
    };
  }

  /* What the week would add to the shopping list: everything the days from
     today on still need that is not in the cupboard and not already on the
     list. The server decides this on the wall too — the panel only asks. */
  function weekShop() {
    const today = D.iso(new Date());
    const pantry = new Set(S.pantry.items.map((i) => i.name));
    const listed = new Set(S.shopping.items.filter((i) => !i.checked).map((i) => i.name));
    const days = (S.week.days || []).filter((d) => d.date >= today);
    const added = [];
    for (const d of days) {
      for (const kind of ['veg', 'normal']) {
        for (const i of d[kind]?.ingredients || []) {
          if (i.have || pantry.has(i.name) || listed.has(i.name)) continue;
          listed.add(i.name);
          added.push(i.name);
          S.shopping.items.push({
            id: newId(), name: i.name, qty: i.qty, checked: false, checked_at: null,
            source: 'week', recipe_id: d[kind].id, staple: false,
          });
        }
      }
    }
    if (added.length) set('cooking_shopping', S.shopping);
    return { ok: true, added, days: days.map((d) => d.date), shopping: S.shopping };
  }

  function rateDay(date, kind, rating) {
    const day = (S.week.days || []).find((d) => d.date === date);
    if (!day || !['veg', 'normal'].includes(kind)) return { ok: false };
    day.rating = { ...(day.rating || {}), [kind]: rating === 1 || rating === -1 ? rating : null };
    set('cooking_week', weekJson());
    return { ok: true };
  }

  /* --------------------------------------------------------- the bird box
     One SSE key carries the lot — the settings, the camera's own sensitivity,
     the count and the log — exactly as the server sends it, which is why the
     panel and the block in the top bar never disagree.

     The stills are files on disk rather than /api/motion/file/… URLs: an <img>
     src never passes through the fetch shim below, so a made-up route would
     draw six broken pictures. */
  function motionUrl(name) { return D.MOTION_FILES[name] || ''; }

  function eventJson(row) {
    const out = { ...row };
    if (row.snapshot) out.snapshot_url = motionUrl(row.snapshot);
    if (row.clip) out.clip_url = motionUrl(row.clip);
    return out;
  }

  function countToday() {
    const start = new Date();
    start.setHours(0, 0, 0, 0);
    const from = start.getTime() / 1000;
    return S.motion.events.filter((e) => e.at >= from).length;
  }

  function motionJson() {
    const rows = S.motion.events;
    return {
      settings: S.motion.settings,
      // There is no camera to be subscribed to, and saying so is better than
      // a green line that means nothing: the sheet prints this verbatim.
      connected: false,
      error: 'no camera in the demo — the log below is made up',
      count_today: countToday(),
      last_at: rows.length ? rows[rows.length - 1].at : 0,
      // Newest first, and only the last forty: the panel steps through this
      // list with ‹ › and prints "3 of 40" against its length.
      events: rows.slice(-40).reverse().map(eventJson),
      camera: S.motion.camera,
    };
  }

  function motionSet(body) {
    const cur = S.motion.settings;
    const next = { ...cur };
    for (const [k, v] of Object.entries(body || {})) {
      if (!(k in D.MOTION_SETTINGS)) continue;         // as the server does
      if (k === 'light_rooms') {
        const known = new Set(D.ENTITIES.lights.map((r) => r.entity));
        next[k] = (Array.isArray(v) ? v : []).filter((x) => known.has(x)).slice(0, 12);
        continue;
      }
      next[k] = typeof D.MOTION_SETTINGS[k] === 'number' ? Number(v) : v;
    }
    S.motion.settings = next;
    set('motion', motionJson());
    return { ok: true, settings: next };
  }

  /* The sensitivity lives in the camera on the wall outside, not in a file on
     the server, which is why it has a route of its own. The firmware validates
     nothing — it accepted every number put to it and read it back verbatim —
     so the guard is here, as it is there. */
  function cameraSet(level) {
    const n = Math.max(1, Math.min(6, Math.round(Number(level) || 0)));
    S.motion.camera = { level: n, read_at: Math.floor(Date.now() / 1000), error: '' };
    set('motion', motionJson());
    return { ok: true, camera: S.motion.camera };
  }

  /* "Test motion" behind the gear. On the wall this records one event exactly
     as a real one — the sound, the still, the log entry, the lights — so the
     whole chain can be tried without a bird. Here it does the same, with a
     frame off the clip standing in for the camera's own. */
  function motionTest() {
    const at = Math.floor(Date.now() / 1000);
    const n = (S.motion.events.length % 6) + 1;
    S.motion.events.push({
      id: `m${at}`, at, event: 'Test',
      ...(S.motion.settings.snapshot ? { snapshot: `still-${n}.jpg` } : {}),
      ...(S.motion.settings.clip ? { clip: 'birdbox.mp4' } : {}),
    });
    set('motion', motionJson());
    return { ok: true, at };
  }

  function motionDrop(id) {
    S.motion.events = id
      ? S.motion.events.filter((e) => e.id !== id)
      : [];
    set('motion', motionJson());
    return { ok: true, count: S.motion.events.length };
  }

  /* ------------------------------------------------------------- the photos
     A folder table big enough for the browser to be worth browsing. The
     pictures inside it are the six files in media/photos/, cycled — a demo
     does not need four hundred distinct jpegs to show what the screen does. */

  const FOLDERS = [
    ['photos', 'Pictures/2026/Coast', 38, 0],
    ['photos', 'Pictures/2026/Coast/Raw', 61, 0],
    ['photos', 'Pictures/2026/Garden', 24, 0],
    ['photos', 'Pictures/2026/Kitchen rebuild', 57, 0],
    ['photos', 'Pictures/2025/Hills', 41, 0],
    ['photos', 'Pictures/2025/City nights', 33, 0],
    ['photos', 'Pictures/2025/Midsummer', 62, 0],
    ['photos', 'Pictures/2025/Autumn', 29, 0],
    ['photos', 'Pictures/2025/Winter', 18, 0],
    ['photos', 'Pictures/2024/Coast road', 88, 0],
    ['photos', 'Pictures/2024/Autumn', 35, 0],
    ['photos', 'Pictures/2024/Bird box', 26, 0],
    // A phone backup, which is the case the folder tree exists for: three
    // levels deep, one folder enormous, and two called Camera under different
    // handsets — the pair a list of last-segment names cannot tell apart.
    ['photos', 'Camera uploads/Pixel/DCIM/Camera', 412, 0],
    ['photos', 'Camera uploads/Pixel/DCIM/Screenshots', 77, 0],
    ['photos', 'Camera uploads/Old phone/DCIM/Camera', 268, 0],
    ['photos', 'Camera uploads', 9, 0],
    ['family', 'Albums/Scans', 54, 0],
    ['family', 'Albums/Winter', 31, 0],
    ['family', 'Albums/Old slides', 96, 0],
    // Loose at the top of its library, so the tree's "— loose photos" row has
    // something to be: without one, that branch is never drawn.
    ['family', '', 12, 0],
    ['video', 'Clips/Bird box', 0, 1],
  ];

  function folderRows() {
    const sel = new Map(S.albums.map((a) => [`${a.root}\u0000${a.folder}`, a.deep !== false]));
    let newest = Math.floor(Date.now() / 1000) - 4 * 3600;
    return {
      any_selected: sel.size > 0,
      libraries: ['Demo library', 'Family', 'Clips'],
      folders: FOLDERS.map(([root, folder, photos, videos]) => {
        newest -= 3600 * 30;
        const key = `${root}\u0000${folder}`;
        return {
          root, library: D.ROOT_LABELS[root], folder,
          count: photos + videos, photos, videos, newest,
          selected: sel.has(key), deep: sel.get(key) !== false,
        };
      }),
      // What the tree draws its ticks from, and the only thing that can: a
      // ticked folder holding no photographs of its own — "everything under
      // Pictures/2026" — has no row above to carry a flag.
      selected_paths: S.albums.map((a) => ({
        root: a.root, folder: a.folder, deep: a.deep !== false,
      })),
    };
  }

  /* Where a file would sit on the NAS, said the way the caption under the
     slideshow says it. The share names are made up like everything else here,
     but the shape is the real one: the caption's second line is the whole path,
     because a house can easily hold four folders called Camera. */
  function nasPath(root, folder, name) {
    return [D.NAS_ROOTS[root] || `/${root}`, folder, name].filter(Boolean).join('/');
  }

  function itemsIn(root, folder, n) {
    if (root === 'video') {
      return [{ ...D.CLIP, folder, path: nasPath(root, folder, D.CLIP.name) }];
    }
    const pool = D.PHOTOS;
    const out = [];
    // The six pictures go round several times in a folder of forty, so the
    // order is scrambled per folder rather than cycled: a grid that repeats in
    // a visible rhythm reads as a bug, and one that repeats scattered reads as
    // a lot of photographs of the same coast.
    let seed = 0;
    for (const c of `${root}/${folder}`) seed = (seed * 31 + c.charCodeAt(0)) >>> 0;
    for (let i = 0; i < Math.min(n, 60); i++) {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      const p = pool[seed % pool.length];
      const name = `img-${String(i + 1).padStart(4, '0')}.jpg`;
      out.push({
        id: i + 1, kind: 'photo', name,
        folder, root, library: D.ROOT_LABELS[root], mtime: p.mtime,
        path: nasPath(root, folder, name),
        duration: null, playclass: null, heavy: false,
        thumb_url: p.file, url: p.file,
      });
    }
    return out;
  }

  function cacheState() {
    return {
      state: 'ready', count: 350, target: 350, available: 350,
      built_at: Math.floor((Date.now() - 6 * 3600000) / 1000),
      nas: 'awake',
      source: S.slideshow.source,
      cache_size: S.slideshow.cache_size,
      cache_refresh_h: S.slideshow.cache_refresh_h,
    };
  }

  // "Fetch now" in the slideshow gear. The real one pulls a few hundred
  // photographs off the NAS and reports progress on the bus; this counts to
  // the same place in a few seconds so the progress line can be seen working.
  let filling = false;
  function refill() {
    if (filling) return { status: 'already_running' };
    filling = true;
    const target = S.slideshow.cache_size || 350;
    let count = 0;
    const step = () => {
      count = Math.min(target, count + Math.ceil(target / 12));
      publish('photo_cache', { state: count >= target ? 'ready' : 'filling', count, target });
      if (count < target) return setTimeout(step, 320);
      filling = false;
      publish('photo_cache', { ...cacheState(), count: target });
    };
    setTimeout(step, 250);
    return { status: 'started' };
  }

  /* One of the pictures in media/photos/, dressed as a row out of the media
     index — the same fields the real /api/media/slideshow/next returns. */
  function slideItem(p) {
    const name = p.file.split('/').pop();
    return {
      id: p.id, kind: 'photo', name,
      folder: p.folder, root: p.root, library: p.library, mtime: p.mtime,
      path: nasPath(p.root, p.folder, name),
      duration: null, playclass: null, heavy: false,
      thumb_url: p.file, url: p.file,
    };
  }

  function nextSlide() {
    const pool = D.PHOTOS;
    if (!pool.length) return { status: 'empty' };
    const order = S.slideshow.order;
    if (order === 'shuffle') {
      let n = S.slide;
      // Never the same picture twice running: a slideshow that repeats looks
      // broken long before it looks random.
      while (pool.length > 1 && n === S.slide) n = Math.floor(Math.random() * pool.length);
      S.slide = n;
    } else if (order === 'newest') {
      // PHOTOS is listed newest first, so "newest" walks forward through it.
      S.slide = (S.slide + 1) % pool.length;
    } else {
      S.slide = (S.slide - 1 + pool.length) % pool.length;
    }
    const p = pool[S.slide];
    persist();
    return {
      status: 'ok',
      source: S.slideshow.source,
      item: slideItem(p),
    };
  }

  /* ------------------------------------------------------ kept photographs
     The heart on the slideshow. On the wall it copies the original off the NAS
     into the server's own data/liked/ folder, under the picture's own name, so
     a kept photograph survives the NAS sleeping and the folder being moved out
     from under it. Here the copy is the same six files pointed at twice, and
     the "folder" is an array in localStorage — but the shape of what comes back
     is the server's, down to `file` being the name the DELETE route takes. */

  function likeKey(root, folder, name) {
    return `${root}\u0000${folder || ''}/${name}`;
  }

  // Two photographs called demo-03.jpg from two folders are two kept files, as
  // they are on the server, so the name is made unique the same way it is
  // there: a -2, -3 on the stem rather than an overwrite.
  function likedFilename(name, taken) {
    if (!taken.has(name)) return name;
    const dot = name.lastIndexOf('.');
    const stem = dot > 0 ? name.slice(0, dot) : name;
    const ext = dot > 0 ? name.slice(dot) : '';
    let i = 2;
    while (taken.has(`${stem}-${i}${ext}`)) i++;
    return `${stem}-${i}${ext}`;
  }

  /* The wall names the picture it is showing; this finds it again. An id is
     enough for a slide, and root/folder/name is what makes a photograph opened
     out of the browser findable too. */
  function findItem(body) {
    const root = String(body.root || '');
    const folder = String(body.folder || '');
    const name = String(body.name || '');
    const p = D.PHOTOS.find((x) => x.file.endsWith(`/${name}`));
    if (p) return slideItem({ ...p, folder: folder || p.folder, root: root || p.root });
    const row = FOLDERS.find((f) => f[0] === root && f[1] === folder);
    if (!row) return null;
    return itemsIn(root, folder, row[2] + row[3]).find((i) => i.name === name) || null;
  }

  function likedJson(entry) {
    // url and thumb_url are the picture itself rather than /api/media/liked/…:
    // an <img> src never passes through the fetch shim, so a kept photograph
    // has to be a file the browser can actually go and get.
    return { ...entry, kind: 'photo', url: entry.src, thumb_url: entry.src };
  }

  /* ♥ and 👎 are the same machinery pointed at two lists, exactly as they are
     on the server — one shared copy-and-record, two files. The difference is
     what the list is *for*: the liked one is a keepsake the slideshow can draw
     from with the NAS asleep, and the disliked one is a list of things to
     delete later, which is why every row on it carries the photograph's whole
     path. Disliking also steps the show on: the point of pressing it is not
     seeing that picture again, and leaving it on the screen answers nothing. */
  const KEPT = {
    liked: { rows: () => S.liked, put: (v) => { S.liked = v; }, stamp: 'liked_at' },
    disliked: { rows: () => S.disliked, put: (v) => { S.disliked = v; }, stamp: 'disliked_at' },
  };

  function keptList(kind) {
    const { rows, stamp } = KEPT[kind];
    return {
      items: [...rows()].sort((a, b) => (b[stamp] || 0) - (a[stamp] || 0)).map(likedJson),
    };
  }

  function toggleKept(kind, body) {
    const { rows, put, stamp } = KEPT[kind];
    const item = findItem(body || {});
    if (!item || item.kind !== 'photo') return [{ error: 'unknown photo' }, 404];
    const key = likeKey(item.root, item.folder, item.name);
    const flag = kind === 'disliked' ? 'disliked' : 'liked';
    const was = rows().find((r) => r.key === key);
    if (was) {
      put(rows().filter((r) => r.key !== key));
      persist();
      return [{ ok: true, [flag]: false, count: rows().length }];
    }
    const entry = {
      key,
      file: likedFilename(item.name, new Set(rows().map((r) => r.file))),
      root: item.root, folder: item.folder, name: item.name,
      library: item.library, path: item.path, mtime: item.mtime,
      [stamp]: Date.now() / 1000, quality: 'original', src: item.url,
    };
    put([...rows(), entry]);
    persist();
    return [{ ok: true, [flag]: true, count: rows().length, item: likedJson(entry) }];
  }

  function unkeep(kind, file) {
    const { rows, put } = KEPT[kind];
    put(rows().filter((r) => r.file !== file));
    persist();
    return { ok: true, count: rows().length };
  }

  /* Where the kept files would be. The wall is asked "where did that go?" and
     answers with both halves — the path inside the container and the path on
     the machine serving it — so the gear can print them. A browser has neither,
     and says so rather than inventing a plausible-looking one. */
  function keptPaths() {
    const pair = (rel) => ({ container: `(in your browser) ${rel}`, host: '' });
    return {
      liked_files: pair('liked/'), liked_json: pair('liked.json'),
      disliked_files: pair('disliked/'), disliked_json: pair('disliked.json'),
    };
  }

  /* ------------------------------------------------------------------ house
     light.turn_on / turn_off / toggle, applied to the fake states and
     broadcast. The panel paints its own optimistic answer first and this is
     the confirmation that lands a moment later — same as the real thing. */

  function haCall(body) {
    const ids = Array.isArray(body.entity_id) ? body.entity_id : [body.entity_id];
    const data = body.data || {};
    for (const id of ids) {
      const st = S.ha[id];
      if (!st) continue;
      if (body.service === 'turn_off') { st.s = 'off'; continue; }
      if (body.service === 'toggle') { st.s = st.s === 'on' ? 'off' : 'on'; continue; }
      st.s = 'on';
      if (data.brightness_pct != null) st.a.brightness = Math.round(data.brightness_pct * 2.55);
      if (data.color_temp_kelvin != null) st.a.color_temp_kelvin = Math.round(data.color_temp_kelvin);
      if (data.hs_color) st.a.hs_color = data.hs_color;
    }
    set('ha_states', S.ha);
    return { ok: true };
  }

  function houseDim(pct) {
    for (const [entity, , kind] of D.ROOMS) {
      const st = S.ha[entity];
      // The bridge's own zone call moves every lamp that is on and leaves the
      // dark ones dark — which is the whole reason the real one exists.
      if (kind !== 'plug' && st && st.s === 'on') st.a.brightness = Math.round(pct * 2.55);
    }
    set('ha_states', S.ha);
    return { ok: true, took_ms: 70 };
  }

  /* ---------------------------------------------------------------- cooking */

  const newId = () => Math.random().toString(16).slice(2, 10);

  function recipe(id) { return S.sugg.recipes.find((r) => r.id === id); }

  function listAdd(r) {
    for (const i of r.ingredients) {
      if (i.have) continue;
      if (S.shopping.items.some((x) => x.name === i.name && !x.checked)) continue;
      S.shopping.items.push({
        id: newId(), name: i.name, qty: i.qty, checked: false, checked_at: null,
        source: 'recipe', recipe_id: r.id, staple: false,
      });
    }
  }

  function listDrop(recipeId) {
    S.shopping.items = S.shopping.items.filter(
      (i) => !(i.source === 'recipe' && i.recipe_id === recipeId && !i.checked));
  }

  function choose(recipeId) {
    const r = recipe(recipeId);
    if (!r) return { ok: false };
    const chosen = { ...(S.sugg.chosen || {}) };
    const was = chosen[r.kind];
    if (was === recipeId) {
      delete chosen[r.kind];
      listDrop(recipeId);
    } else {
      if (was) listDrop(was);
      chosen[r.kind] = recipeId;
      listAdd(r);
    }
    S.sugg.chosen = chosen;
    set('cooking_suggestions', withStale(S.sugg));
    set('cooking_shopping', S.shopping);
    return { ok: true, chosen };
  }

  function tick(recipeId, index, have) {
    const r = recipe(recipeId);
    const i = r && r.ingredients[index];
    if (!i) return { ok: false };
    i.have = !!have;
    // Only a dinner somebody actually chose moves the shopping list: correcting
    // the agent about a recipe nobody picked must not fill the trolley.
    if ((S.sugg.chosen || {})[r.kind] === recipeId) {
      if (have) {
        S.shopping.items = S.shopping.items.filter(
          (x) => !(x.name === i.name && !x.checked && x.source === 'recipe'
                   && x.recipe_id === recipeId));
      } else if (!S.shopping.items.some((x) => x.name === i.name && !x.checked)) {
        S.shopping.items.push({
          id: newId(), name: i.name, qty: i.qty, checked: false, checked_at: null,
          source: 'recipe', recipe_id: recipeId, staple: false,
        });
      }
    }
    set('cooking_suggestions', withStale(S.sugg));
    set('cooking_shopping', S.shopping);
    return { ok: true };
  }

  /* ---------------------------------------------------------------- routing */

  const json = (data, status = 200) => new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });

  function route(path, params, method, body) {
    // These name a file or an id in the path itself, which the switch below
    // cannot express. Everything else is an exact route.
    if (method === 'DELETE' && path.startsWith('/api/media/liked/')) {
      return json(unkeep('liked', decodeURIComponent(path.slice('/api/media/liked/'.length))));
    }
    if (method === 'DELETE' && path.startsWith('/api/media/disliked/')) {
      return json(unkeep('disliked',
                         decodeURIComponent(path.slice('/api/media/disliked/'.length))));
    }
    if (method === 'DELETE' && path.startsWith('/api/motion/events/')) {
      return json(motionDrop(decodeURIComponent(path.slice('/api/motion/events/'.length))));
    }

    switch (`${method} ${path}`) {
      case 'GET /api/config':
        return json(D.CONFIG);

      case 'GET /api/ui-state':
        return json(S.ui);
      case 'PUT /api/ui-state':
        S.ui = { ...S.ui, ...body };
        persist();
        return json({ ok: true });

      case 'GET /api/weather':
        return json(D.weather());

      case 'GET /api/health':
        return json({ ok: true, demo: true });

      case 'GET /api/timers':
        return json({ timers: S.timers, now: Date.now() / 1000 });
      case 'PUT /api/timers':
        if (Array.isArray(body && body.timers)) {
          S.timers = body.timers;
          set('timers', S.timers);
        }
        return json({ ok: true, timers: S.timers });

      case 'GET /api/countdown':
        return json({ events: decorate(S.events) });
      case 'PUT /api/countdown': {
        const rows = (body && body.events) || [];
        S.events = rows
          .filter((e) => e && String(e.title || '').trim() && String(e.date || '').length === 10)
          .map((e) => ({
            id: e.id || newId(), title: String(e.title).slice(0, 80), date: e.date,
            note: String(e.note || '').slice(0, 80), city: String(e.city || '').slice(0, 60),
            accent: ['food', 'house', 'birds', 'photos'].includes(e.accent) ? e.accent : 'food',
          }));
        const out = decorate(S.events);
        set('countdown', out);
        return json({ ok: true, events: out });
      }
      case 'GET /api/countdown/places': {
        const q = (params.get('q') || '').trim().toLowerCase();
        if (q.length < 2) return json({ places: [] });
        return json({
          places: D.PLACES.filter((p) => p.name.toLowerCase().includes(q)
            || p.country.toLowerCase().includes(q)).slice(0, 6),
        });
      }

      case 'GET /api/cooking/suggestions':
        return json(withStale(S.sugg));
      case 'GET /api/cooking/shopping':
        return json(S.shopping);
      case 'GET /api/cooking/pantry':
        return json(S.pantry);
      case 'PUT /api/cooking/shopping':
        S.shopping = { ...S.shopping, items: (body && body.items) || [] };
        set('cooking_shopping', S.shopping);
        return json({ ok: true, ...S.shopping });
      case 'PUT /api/cooking/pantry':
        S.pantry = { ...S.pantry, items: (body && body.items) || [] };
        set('cooking_pantry', S.pantry);
        return json({ ok: true, ...S.pantry });
      case 'POST /api/cooking/choose':
        return json(choose(body && body.recipe_id));
      case 'POST /api/cooking/ingredient':
        return json(tick(body.recipe_id, body.index, body.have));
      /* Two forms, because a dinner outlives the card that offered it: a
         recipe id is tonight's card, a date and a kind is a day of the week.
         The second is the half of the loop that closes it — until it existed a
         dinner could only be rated while its card was still on the wall, and
         most dinners are eaten after the cards have turned over. */
      case 'POST /api/cooking/rate': {
        if (body && body.date) return json(rateDay(body.date, body.kind, body.rating));
        const r = recipe(body && body.recipe_id);
        if (r) {
          r.rating = body.rating === 1 || body.rating === -1 ? body.rating : null;
          set('cooking_suggestions', withStale(S.sugg));
        }
        return json({ ok: true });
      }

      case 'GET /api/cooking/week':
        return json(weekJson());
      case 'POST /api/cooking/week/shop':
        return json(weekShop());

      case 'GET /api/media/stats': {
        const rows = folderRows().folders;
        return json({
          photos: rows.reduce((a, f) => a + f.photos, 0),
          videos: rows.reduce((a, f) => a + f.videos, 0),
        });
      }
      case 'GET /api/media/folders':
      case 'GET /api/media/albums':
        return json(folderRows());
      case 'PUT /api/media/albums':
        S.albums = ((body && body.selected) || []).map((a) => ({
          root: String(a.root || ''), folder: String(a.folder || ''),
          deep: a.deep !== false,
        }));
        persist();
        return json({ ok: true, selected: S.albums.length });
      case 'GET /api/media/list': {
        const root = params.get('root') || 'photos';
        const folder = params.get('folder') || '';
        const row = FOLDERS.find((f) => f[0] === root && f[1] === folder);
        return json({ items: itemsIn(root, folder, row ? row[2] + row[3] : 12) });
      }
      case 'GET /api/media/slideshow/next':
        return json(nextSlide());
      case 'GET /api/media/slideshow/settings':
        // `paths` is where the kept copies live and `defaults` is what the
        // gear's Reset row puts back; the panel draws both.
        return json({ ...S.slideshow, defaults: D.CONFIG.slideshow, paths: keptPaths() });
      case 'PUT /api/media/slideshow/settings':
        S.slideshow = { ...S.slideshow, ...body };
        set('slideshow_settings', S.slideshow);
        return json(S.slideshow);
      case 'GET /api/media/liked':
        return json(keptList('liked'));
      case 'GET /api/media/disliked':
        return json(keptList('disliked'));
      case 'POST /api/media/like': {
        const [payload, status] = toggleKept('liked', body);
        return json(payload, status || 200);
      }
      case 'POST /api/media/dislike': {
        const [payload, status] = toggleKept('disliked', body);
        return json(payload, status || 200);
      }

      case 'GET /api/media/cache/status':
        return json(cacheState());
      case 'POST /api/media/cache/refill':
        return json(refill());

      case 'GET /api/motion':
        return json(motionJson());
      case 'PUT /api/motion/settings':
        return json(motionSet(body));
      case 'PUT /api/motion/camera':
        return json(cameraSet(body && body.level));
      case 'POST /api/motion/camera/refresh':
        return json({ ok: true, camera: S.motion.camera });
      case 'POST /api/motion/test':
        return json(motionTest());
      case 'DELETE /api/motion/events':
        return json(motionDrop(null));

      case 'GET /api/hue/status':
        return json({ ok: true, zone: 'Whole house' });
      case 'POST /api/hue/house-dim':
        return json(houseDim(Number(body && body.pct) || 100));

      case 'POST /api/ha/call':
        return json(haCall(body || {}));

      case 'GET /api/tv/probe': {
        const url = params.get('url') || '';
        const ch = D.CHANNELS.find((c) => c.url === url);
        return json({
          url,
          framable: ch ? ch.framable : true,
          reason: ch && !ch.framable ? "frame-ancestors 'none'" : 'no framing restriction',
        });
      }

      default:
        return json({ error: 'no such endpoint in the demo', path }, 404);
    }
  }

  /* ------------------------------------------------------------- the shim
     Only /api/* is answered here. Everything else — the stylesheet, the fonts,
     the photographs, the clip, the alarm sounds — is a real file and goes to
     the real fetch. */

  const realFetch = window.fetch.bind(window);

  window.fetch = async function (input, init) {
    const url = typeof input === 'string' ? input : (input && input.url) || String(input);
    let u;
    try { u = new URL(url, location.href); } catch { return realFetch(input, init); }
    const at = u.pathname.indexOf('/api/');
    if (at < 0) return realFetch(input, init);

    const method = ((init && init.method) || (input && input.method) || 'GET').toUpperCase();
    let body = null;
    if (init && init.body) {
      try { body = JSON.parse(init.body); } catch { body = null; }
    }
    // A little latency, so optimistic painting and the echo that confirms it
    // are actually two moments apart, the way they are on the wall.
    await new Promise((r) => setTimeout(r, 25 + Math.random() * 40));
    return route(u.pathname.slice(at), u.searchParams, method, body);
  };
})();
