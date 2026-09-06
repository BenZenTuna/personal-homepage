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
  const STORE = 'kitchen-demo-v4';
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
      shopping: JSON.parse(JSON.stringify(D.SHOPPING)),
      pantry: JSON.parse(JSON.stringify(D.PANTRY)),
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
      slide: 0,
    };
  }

  let S = fresh();
  try {
    const saved = JSON.parse(localStorage.getItem(STORE) || 'null');
    if (saved && saved.ui) S = { ...S, ...saved };
  } catch { /* private window, or a half-written entry: the defaults stand */ }

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

  function likedList() {
    return {
      items: [...S.liked].sort((a, b) => (b.liked_at || 0) - (a.liked_at || 0))
        .map(likedJson),
    };
  }

  function toggleLike(body) {
    const item = findItem(body || {});
    if (!item || item.kind !== 'photo') return [{ error: 'unknown photo' }, 404];
    const key = likeKey(item.root, item.folder, item.name);
    const was = S.liked.find((r) => r.key === key);
    if (was) {
      S.liked = S.liked.filter((r) => r.key !== key);
      persist();
      return [{ ok: true, liked: false, count: S.liked.length }];
    }
    const entry = {
      key,
      file: likedFilename(item.name, new Set(S.liked.map((r) => r.file))),
      root: item.root, folder: item.folder, name: item.name,
      library: item.library, path: item.path, mtime: item.mtime,
      liked_at: Date.now() / 1000, quality: 'original', src: item.url,
    };
    S.liked.push(entry);
    persist();
    return [{ ok: true, liked: true, count: S.liked.length, item: likedJson(entry) }];
  }

  function unlike(file) {
    S.liked = S.liked.filter((r) => r.file !== file);
    persist();
    return { ok: true, count: S.liked.length };
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
    // Dropping a kept photograph names the file in the path itself, which the
    // switch below cannot express. Everything else is an exact route.
    if (method === 'DELETE' && path.startsWith('/api/media/liked/')) {
      return json(unlike(decodeURIComponent(path.slice('/api/media/liked/'.length))));
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
      case 'POST /api/cooking/rate': {
        const r = recipe(body && body.recipe_id);
        if (r) {
          r.rating = body.rating === 1 || body.rating === -1 ? body.rating : null;
          set('cooking_suggestions', withStale(S.sugg));
        }
        return json({ ok: true });
      }

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
        return json(S.slideshow);
      case 'PUT /api/media/slideshow/settings':
        S.slideshow = { ...S.slideshow, ...body };
        set('slideshow_settings', S.slideshow);
        return json(S.slideshow);
      case 'GET /api/media/liked':
        return json(likedList());
      case 'POST /api/media/like': {
        const [payload, status] = toggleLike(body);
        return json(payload, status || 200);
      }

      case 'GET /api/media/cache/status':
        return json(cacheState());
      case 'POST /api/media/cache/refill':
        return json(refill());

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
