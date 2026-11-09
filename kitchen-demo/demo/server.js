/* The demo's stand-in for the kitchen server.
 *
 * The real wall talks to a FastAPI container: it fetches /api/* and holds one
 * server-sent-events stream that every part of the page listens to. Nothing in
 * the wall's own code is changed for the demo. Instead, before any of it loads,
 * this file replaces window.fetch and window.EventSource and answers out of
 * demo/fixtures.js: a made-up household (Alex, Sam and Mia in Lakeside) in the
 * exact shape the real server sends.
 *
 * - Every date and timestamp in the fixtures is moved forward to today, so the
 *   forecast, the countdown and the school week are always current.
 * - Reads answer from the fixtures; writes change them in memory and are
 *   broadcast on the fake stream, as the server would — a lamp switched in one
 *   place is switched everywhere. A reload starts afresh.
 * - Settings windows work generically: …/settings merges, …/pause pauses,
 *   …/test and …/try ring.
 * - The bird box's camera is a looping clip (media/birdbox.mp4).
 * - Requests that are not /api/* (fonts, pictures, sounds) go to the network.
 */
(function () {
  'use strict';
  const F = window.DEMO_FIX;
  const BUILD = 'demo';

  /* Photos and Birds always open filling the screen. A visitor's browser
     keeps the view it was left on ('kitchen-view', app.js), and that wins
     over /api/ui-state, so a view left un-filled is filled again here,
     before the wall's code reads it. */
  const FILLS = { ambient: 'media', birds: 'camera' };
  try {
    const view = JSON.parse(localStorage.getItem('kitchen-view') || 'null');
    if (view && FILLS[view.preset] && view.expanded !== FILLS[view.preset]) {
      view.expanded = FILLS[view.preset];
      localStorage.setItem('kitchen-view', JSON.stringify(view));
    }
  } catch { /* private window: nothing kept, the fixtures' start applies */ }
  const now = () => Date.now() / 1000;
  const clone = (v) => (v === undefined ? v : JSON.parse(JSON.stringify(v)));

  /* ------------------------------------------------- re-dated to today -- */
  const mid = (t) => { const d = new Date(t); d.setHours(0, 0, 0, 0); return d.getTime(); };
  const SHIFT_DAYS = Math.round((mid(Date.now()) - mid(F.recorded * 1000)) / 86400000);
  const SHIFT_S = SHIFT_DAYS * 86400;
  const REC = F.recorded;
  const ISO = /^(\d{4})-(\d{2})-(\d{2})/;
  function shiftIso(s) {
    const m = ISO.exec(s);
    if (!m) return s;
    const d = new Date(+m[1], +m[2] - 1, +m[3]);
    if (Math.abs(d.getTime() / 1000 - REC) > 400 * 86400) return s;     // a birth year, a far date: kept
    d.setDate(d.getDate() + SHIFT_DAYS);
    const iso = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    return iso + s.slice(10);
  }
  function shift(v) {
    if (!SHIFT_DAYS) return v;
    if (typeof v === 'string') return ISO.test(v) ? shiftIso(v) : v;
    if (typeof v === 'number') {
      if (Math.abs(v - REC) < 400 * 86400) return v + SHIFT_S;
      if (Math.abs(v - REC * 1000) < 400 * 86400e3) return v + SHIFT_S * 1000;
      return v;
    }
    if (Array.isArray(v)) return v.map(shift);
    if (v && typeof v === 'object') {
      const o = {};
      for (const k of Object.keys(v)) o[k] = shift(v[k]);
      return o;
    }
    return v;
  }
  const SNAP = shift(F.snapshot);
  const GET = shift(F.get);
  const PHOTOS = F.photos;

  /* The demo shows itself off a little more than a kitchen would. */
  function tune(n) {
    if (!n || !n.settings) return;
    // Dim after two minutes untouched, at any hour — never already dimmed when
    // somebody opens the page, which the wall does at night.
    Object.assign(n.settings, { night: false, day_hours: Array.from({ length: 24 }, (_, h) => h), day_cycle: false,
      day_idle_min: 2, look: 4, look_auto: false });
    n.wall = true;
  }
  // A visitor who has just arrived has just touched it: two minutes before it dims.
  try { sessionStorage.setItem('kitchen-night-touched', String(Date.now())); } catch { /* private window */ }
  tune(GET['/api/night']);
  tune(SNAP.night);

  /* ------------------------------------------------------- the stream -- */
  const streams = new Set();
  function send(es, msg) {
    const ev = { data: JSON.stringify({ ...msg, build: BUILD }) };
    try { es.onmessage && es.onmessage(ev); } catch (e) { console.error(e); }
    for (const fn of es._listeners.message || []) { try { fn(ev); } catch (e) { console.error(e); } }
  }
  function publish(key) {
    for (const es of streams) send(es, { type: key, value: SNAP[key] });
  }
  class DemoEventSource {
    constructor(url) {
      this.url = url;
      this.readyState = 0;
      this._listeners = {};
      streams.add(this);
      setTimeout(() => {
        this.readyState = 1;
        try { this.onopen && this.onopen({}); } catch (e) { console.error(e); }
        send(this, { type: 'snapshot', value: SNAP });
      }, 30);
    }
    addEventListener(t, fn) { (this._listeners[t] ||= []).push(fn); }
    removeEventListener(t, fn) { this._listeners[t] = (this._listeners[t] || []).filter((f) => f !== fn); }
    close() { this.readyState = 2; streams.delete(this); }
  }
  DemoEventSource.CONNECTING = 0;
  DemoEventSource.OPEN = 1;
  DemoEventSource.CLOSED = 2;
  window.EventSource = DemoEventSource;

  /* ---------------------------------------------------- the bird box -- */
  const define = customElements.define.bind(customElements);
  customElements.define = function (name, cls, opts) {
    if (name !== 'kitchen-stream') return define(name, cls, opts);
    class DemoStream extends HTMLElement {
      constructor() {
        super();
        const v = document.createElement('video');
        Object.assign(v, { loop: true, autoplay: true, playsInline: true, muted: true, poster: 'media/birdbox.jpg' });
        v.style.cssText = 'width:100%;height:100%;object-fit:cover;display:block';
        this.video = v;
      }
      connectedCallback() {
        if (this.video.isConnected) return;
        this.appendChild(this.video);
        this.video.muted = this.startMuted !== false;
        this.video.src = 'media/birdbox.mp4';
        this.video.play().catch(() => {});
      }
      set src(_) { /* no camera: the clip */ }
      get src() { return 'media/birdbox.mp4'; }
    }
    return define(name, DemoStream, opts);
  };

  /* ------------------------------------------------------- answers -- */
  const json = (v, status = 200) => new Response(JSON.stringify(v ?? {}), {
    status, headers: { 'Content-Type': 'application/json' },
  });
  // Which stream key a module's address belongs to.
  function busKey(mod) {
    if (mod in SNAP) return mod;
    const u = mod.replace(/-/g, '_');
    return u in SNAP ? u : null;
  }
  function docOf(mod) {
    const k = busKey(mod);
    return { k, doc: k ? SNAP[k] : GET[`/api/${mod}`] };
  }
  function changed(mod, doc) {
    const k = busKey(mod);
    if (k) { SNAP[k] = doc; publish(k); }
    if (GET[`/api/${mod}`] && GET[`/api/${mod}`] !== doc && typeof doc === 'object' && !Array.isArray(doc)) {
      const g = GET[`/api/${mod}`];
      if (doc.settings && g.settings) g.settings = clone(doc.settings);
      if ('paused' in doc) g.paused = doc.paused;
      if ('ring' in doc) g.ring = doc.ring;
    }
  }

  let slide = 0;
  const SAID = {
    en: 'What does Mia need for school tomorrow?',
  };
  function askAnswer(text) {
    const t = text.toLowerCase();
    if (/timer/.test(t)) return { answer: 'Timer 1 is running: twelve minutes for the pasta.', did: ['set_timer: timer 1 started: 12 min'] };
    if (/light|lamp|turn/.test(t)) return { answer: 'The living room is off.', did: ['lights: Living room off'] };
    if (/shopping|milk/.test(t)) return { answer: 'Milk is on the shopping list.', did: ['add_to_shopping: on the list: milk'] };
    return { answer: 'Tomorrow Mia has school from 08:20 to 13:45; on Wednesday she needs her PE kit and indoor shoes.',
      did: ['school: tomorrow: School is from 08:20 to 13:45.'] };
  }

  async function route(path, params, method, body) {
    const parts = path.split('/');           // ['', 'api', mod, ...]
    const mod = parts[2] || '';
    const last = parts[parts.length - 1];

    if (method === 'GET') {
      if (path === '/api/health') return json({ ok: true, build: BUILD });
      if (path === '/api/media/slideshow/next') {
        const item = PHOTOS[slide++ % PHOTOS.length];
        return json({ status: 'ok', item });
      }
      if (path === '/api/media/list') return json({ items: PHOTOS, total: PHOTOS.length, offset: 0 });
      if (path === '/api/night/photo') return json({ ...PHOTOS[Math.floor(Math.random() * PHOTOS.length)] });
      if (path === '/api/brief/preview') {
        const b = SNAP.brief?.ring;
        return json(b || { title: 'Good morning', lines: [
          { icon: '🌤️', text: 'It is 4 degrees outside, partly cloudy. Today between 1 and 7 degrees.' },
          { icon: '🎒', text: 'School is from 08:20 to 13:45. Bring: PE kit, Indoor shoes.' },
          { icon: '📅', text: 'Today: Book club at Sam\'s at 19:00.' }], speech: '' });
      }
      if (path === '/api/countdown') return json({ events: SNAP.countdown });
      if (path in GET) return json(clone(GET[path]));
      const k = busKey(mod);
      if (k && parts.length === 3) return json(clone(SNAP[k]));
      if (path.startsWith('/api/media/')) return json({ items: [], folders: [] });
      return json({});
    }

    // ---- writes ---------------------------------------------------------
    if (path === '/api/ui-state') { GET['/api/ui-state'] = { ...(GET['/api/ui-state'] || {}), ...(body || {}) }; return json({ ok: true }); }
    if (path === '/api/timers') {
      SNAP.timers = (body && body.timers) || SNAP.timers;
      publish('timers');
      return json({ ok: true, timers: SNAP.timers, now: now() });
    }
    if (path === '/api/countdown' && method === 'PUT') {
      const school = (SNAP.countdown || []).filter((e) => e.school);
      const mine = (body.events || []).filter((e) => !e.school).map((e) => ({ ...e, id: e.id || Math.random().toString(16).slice(2, 10) }));
      SNAP.countdown = [...mine, ...school.filter((e) => !(body.removed || []).includes(e.id))];
      publish('countdown');
      return json({ ok: true, events: SNAP.countdown });
    }
    if (/^\/api\/countdown\/[^/]+\/todo$/.test(path)) {
      const e = (SNAP.countdown || []).find((x) => x.id === parts[3]);
      if (e) { if (body.done) e.todo_done = true; else delete e.todo_done; publish('countdown'); }
      return json({ ok: true });
    }
    if (path === '/api/ha/call') {
      const st = SNAP.ha_states || {};
      const ids = [].concat(body.entity_id || []);
      for (const id of ids) {
        const e = st[id];
        if (!e) continue;
        const on = body.service === 'turn_on' || (body.service === 'toggle' && e.s !== 'on');
        e.s = on ? 'on' : 'off';
        e.a = { ...(e.a || {}) };
        if (on && body.data && body.data.brightness_pct != null) e.a.brightness = Math.round(body.data.brightness_pct * 2.55);
        if (on && !e.a.brightness) e.a.brightness = 200;
        if (on && body.data && body.data.color_temp_kelvin) e.a.color_temp_kelvin = body.data.color_temp_kelvin;
        if (on && body.data && body.data.hs_color) e.a.hs_color = body.data.hs_color;
        e.lu = new Date().toISOString();
      }
      publish('ha_states');
      return json({ ok: true });
    }
    if (path === '/api/agent-notes' && method === 'POST') {
      const notes = SNAP['agent-notes'];
      const n = { id: `an-${Math.random().toString(16).slice(2, 10)}`, text: body.text, tab: body.tab || 'calendar',
        via: body.via || 'typed', device: body.device || 'screen', at: new Date().toISOString(), status: 'new',
        reply: '', did: [], re: body.re || null, handled_at: null, runs: 0 };
      notes.notes.push(n);
      publish('agent-notes');
      setTimeout(() => {
        n.status = 'done';
        n.handled_at = new Date().toISOString();
        n.reply = 'In the real kitchen the kitchen agent reads this and puts it where it belongs (the countdown, '
          + 'spending, a trip, the week\'s dinners), then answers here.';
        publish('agent-notes');
      }, 4000);
      return json({ note: n, waiting: 1 });
    }
    if (path === '/api/stt' || path === '/api/ask/hear') return json({ text: SAID.en, language: 'en', by: 'demo' });
    if (path === '/api/ask/answer') return json({ ...askAnswer(body.text || ''), audio: null, language: 'en' });
    if (mod === 'brief' && last === 'try') {
      const r = await (await route('/api/brief/preview', params, 'GET')).json();
      SNAP.brief.ring = { at: now(), title: r.title, lines: r.lines, owner: null };
      publish('brief');
      return json({ ok: true, voice: false, ...r });
    }

    // ---- any settings window ----------------------------------------------
    const { doc } = docOf(mod);
    if (doc && typeof doc === 'object' && !Array.isArray(doc)) {
      if (last === 'settings' && body && typeof body === 'object') {
        doc.settings = { ...(doc.settings || {}), ...body };
        changed(mod, doc);
        return json(clone(doc));
      }
      if (last === 'pause') {
        doc.paused = body && body.paused ? now() : null;
        changed(mod, doc);
        return json(clone(doc));
      }
      if (['test', 'try', 'wall-test'].includes(last)) {
        doc.ring = mod === 'chime' ? { at: now() } : now();
        changed(mod, doc);
        return json({ ok: true });
      }
    }
    return json({ ok: true });
  }

  const realFetch = window.fetch.bind(window);
  window.fetch = async function (input, init = {}) {
    const url = typeof input === 'string' ? input : input.url;
    const u = new URL(url, location.href);
    const at = u.pathname.indexOf('/api/');
    if (at < 0) return realFetch(input, init);
    const method = (init.method || (typeof input !== 'string' && input.method) || 'GET').toUpperCase();
    let body = null;
    if (init.body && typeof init.body === 'string') {
      try { body = JSON.parse(init.body); } catch { body = null; }
    }
    await new Promise((r) => setTimeout(r, 40));
    try {
      return await route(u.pathname.slice(at), u.searchParams, method, body || {});
    } catch (e) {
      console.error('demo server', u.pathname, e);
      return json({ error: 'demo' }, 500);
    }
  };
})();
