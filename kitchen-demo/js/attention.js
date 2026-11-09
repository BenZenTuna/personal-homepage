/* Needs attention: the few things in the house that are waiting for a person.

   A chip in the top bar that is there only when something needs somebody — a
   dimmer on its last per cent, a lamp that has not answered for a day, the
   bird box gone quiet, a backup that did not happen — and a sheet behind it
   saying what, since when, with a week's Hide and a for-good Ignore on each.
   The server does all the looking (backend/app/attention.py) and sends only
   its own sentences, over the `attention` key; nothing here reads the house.

   The chip takes no width from anything but the bird box beside it, which is
   the one cell in the top bar that was ever elastic: the six views never move.
   While it shows, the bird box keeps its count and its name and gives up the
   line under them and its stills (app.css). Over a picture, where the top bar
   is covered, a smaller one stands in the clock's column like the bird box's.

   A server older than this answers /api/attention with a 404, and then there
   is no chip and no sheet — never a guess.

   Some items are alarms, marked `alarm` by attention.py: the flowers needing
   water (since 2026-10-01) and TunaRadar's "tickets on sale now" (since
   2026-10-09). The server sorts alarms first, so one is the line the chip
   shows, and while one is open the chip is red with a sign blinking.

   Since 2026-10-09 which items are alarms is the household's choice: one
   style per type of alert — how it shows (Alarm, On the chip, In the list,
   Off) and three extras: a banner over whichever view is up (until Seen), a
   sound once when it first appears, and waking a sleeping wall. Since
   2026-10-11 they are set on House → Automation's cards (automation.js), and
   the ⚙ in this sheet's header takes the wall there. The server applies them
   (attention.py, read_styles) and marks each item `alarm`, `sev`, `banner`
   and `ring`; this draws what it is told.

   Since 2026-10-09 a TunaRadar item may carry `url`, the page the tracker
   found (attention.py checks it, and linkOf here again: http or https only).
   Its row then has Open. On the wall it opens over the whole screen with a
   big Close, as a school letter does (schoolboard.js): the wall is Chrome
   full screen with no keyboard and no tab strip, so a second tab there would
   stay over the kitchen until the idle extension took it back ten minutes
   later. The page is in a sandboxed frame (no navigating the wall away, no
   referrer, no camera, microphone, location, autoplay or full screen), and
   the overlay closes itself after LINK_IDLE_MS untouched (a tap in the frame
   counts, by the window's blur). Many ticket sites refuse to be framed; the
   server reads the page's headers first (/api/attention/<key>/framable, the
   TV panel's rule) and then the overlay says "This site can't be shown here
   — open it on a phone: <address>" instead of a blank frame. Everywhere else (a phone, a laptop) Open is a
   plain link to a new tab, rel="noopener noreferrer". The address is never
   written into HTML: buttons carry the item's key, and href/src are set as
   properties. */

const esc = (s) => String(s ?? '').replace(/[&<>"]/g,
  (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

/* "since 14:02" today, "since Tuesday" this week, "since 3 September" before
   that; "at least since" where the server only knows a lower bound. */
export function sinceText(t, atLeast = false, now = Date.now()) {
  if (!t) return '';
  const d = new Date(t * 1000);
  const days = (now - d.getTime()) / 86400000;
  const today = new Date(now).toDateString() === d.toDateString();
  const when = today
    ? d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false })
    : days < 6
      ? d.toLocaleDateString('en-GB', { weekday: 'long' })
      : d.toLocaleDateString('en-GB', { day: 'numeric', month: 'long' });
  return `${atLeast ? 'at least since' : 'since'} ${when}`;
}

/* An item's line as the wall says it. A title that ends in "since" (a backup
   that has not happened) takes the date straight after it. */
export function sayItem(i) {
  const since = sinceText(i.since, i.at_least);
  if (/ since$/.test(i.title) && since) return `${i.title} ${since.replace(/^(at least )?since /, '')}`;
  return i.title;
}

/* The alert sounds: the timers' alarms (babo.py has the same two). */
const SOUND_FILES = {
  funny: 'sounds/funny-alarm.mp3', cartoon: 'sounds/cartoon-clock.mp3',
  // 2026-10-15: the Aurora alert's ambience (90 s — Seen stops it) and Radar's two pings.
  space: 'sounds/space-ambient.mp3', radar1: 'sounds/radar1.mp3', radar2: 'sounds/radar2.mp3',
};
const RING_FRESH_S = 60;   // a ring this young still plays on a page just opened
const LINK_IDLE_MS = 10 * 60 * 1000;   // an open page closes itself after this
const LINK_MAX = 2000;
const HOUSE_SUFFIXES = ['.lan', '.home', '.local', '.internal', '.home.arpa', '.localhost', '.example.com'];
/* The frame: what the page may do inside it, and what it may never use.
   Exported for the test, which pins both strings. */
export const LINK_SANDBOX = 'allow-scripts allow-same-origin allow-forms';
export const LINK_ALLOW = "autoplay 'none'; camera 'none'; microphone 'none'; geolocation 'none'; fullscreen 'none'";

/* The item's link if it is a plain http(s) address, else null — the same rule
   as attention.py's _radar_url, again, because this is what opens it. */
export function linkOf(u) {
  if (typeof u !== 'string' || !u || u.length > LINK_MAX || /[\s\u0000-\u001f\u007f-\u009f]/.test(u)) return null;
  // A host straight after the two slashes, and no backslash anywhere: the URL
  // parser would read "https:///x" or "https://a\\@b" more kindly than Python.
  if (!/^https?:\/\/[^/?#@\\]/i.test(u) || u.includes('\\')) return null;
  let p;
  try { p = new URL(u); } catch { return null; }
  if ((p.protocol !== 'http:' && p.protocol !== 'https:') || !p.hostname || p.username || p.password) return null;
  // A public page only: the parser has already turned 0x7f.1 and 2130706433
  // into 127.0.0.1, so an IP literal is digits and dots, or [IPv6]. No port
  // but the scheme's own (the parser drops that one), no single-label host,
  // localhost or house name, and never the kitchen itself.
  const host = p.hostname.toLowerCase().replace(/\.$/, '');
  if (p.port || host.startsWith('[') || host.includes(':') || /^[0-9.]+$/.test(host) || /\.(0x[0-9a-f]*|\d+)$/i.test(host)) return null;
  if (!host.includes('.') || host === 'localhost' || host === 'example.com' || HOUSE_SUFFIXES.some((x) => host.endsWith(x))) return null;
  if (typeof location !== 'undefined' && p.origin === location.origin) return null;
  return p.href;
}

export default {
  snap: null,
  live: false,
  rung: new Set(),       // the rings this page has played
  trkOpen: new Set(),    // the trackers opened into their whole card under Being tracked
  audio: null,

  init(ctx) {
    this.ctx = ctx;
    // Absent from a page without it (the demo's own index.html): the sheet and
    // the chip over a picture still work, the top bar simply has no chip.
    this.el = document.getElementById('hd-attn');
    if (this.el) {
      this.el.setAttribute('role', 'button');
      this.el.tabIndex = 0;
      this.el.setAttribute('aria-label', 'what needs attention in the house');
      this.el.innerHTML = `
        <span class="at-head"><span class="at-sign" aria-hidden="true">!</span><span class="at-n"></span></span>
        <span class="at-what">need attention</span>
        <span class="at-top"></span>`;
      this.el.addEventListener('click', () => this.open());
      this.el.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); this.open(); }
      });
    }

    this.mini = document.createElement('button');
    this.mini.className = 'hx-attn';
    this.mini.hidden = true;
    this.mini.title = 'what needs attention in the house';
    this.mini.innerHTML = `
      <span class="at-sign" aria-hidden="true">!</span>
      <span class="hx-at-n"></span>
      <span class="hx-at-txt"><b>need attention</b><i></i></span>`;
    this.mini.addEventListener('click', () => this.open());

    this.buildSheet();
    this.buildBanner();
    ctx.bus.on('attention', (snap) => this.paint(snap));
    fetch('/api/attention', { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null))
      .then((snap) => { if (snap) this.paint(snap); })
      .catch(() => { /* no server behind it: nothing to show */ });
  },

  /* app.js hangs the small one in the clock's column over a picture, and
     takes it out again — the same move-don't-copy the bird box's makes. */
  mount(header, before) {
    if (!this.mini) return;
    if (header) header.insertBefore(this.mini, before || null);
    else this.mini.remove();
  },

  openItems() {
    return (this.snap?.items || []).filter((i) => i.state === 'open' && i.sev === 'act');
  },

  paint(snap) {
    if (!snap || !Array.isArray(snap.items)) return;
    this.snap = snap;
    this.live = true;
    const open = this.openItems();
    const n = open.length;
    // The server sorts by kind, then by how long it has been so: the first is
    // the one to name — a flat battery before a lamp that is out of reach.
    const top = open[0];
    // The flowers needing water is an alarm, not a chore: the chip goes red
    // and a sign blinks on it (app.css) for as long as that item is open.
    // Hidden or ignored from the sheet, it stops — as every other item does.
    const alarm = open.some((i) => i.alarm);
    // Nothing waiting, but TunaRadar is tracking something for the house: the
    // chip stays, quieter, saying so — so the trackers are always one tap away.
    const trk = Array.isArray(snap.tracking) ? snap.tracking : [];
    const tracking = !n && trk.length > 0;
    const count = tracking ? trk.length : n;
    const what = tracking ? 'being tracked' : 'need attention';
    const line = tracking ? `${trk[0].name} — ${trk[0].alarm}` : top ? sayItem(top) : '';
    this.mini.classList.toggle('alarm', alarm);
    this.mini.classList.toggle('tracking', tracking);
    if (this.el) {
      this.el.classList.toggle('alarm', alarm);
      this.el.classList.toggle('tracking', tracking);
      this.el.hidden = !count;
      this.el.querySelector('.at-n').textContent = String(count);
      this.el.querySelector('.at-what').textContent = what;
      this.el.querySelector('.at-top').textContent = line;
      this.el.title = line;
    }
    this.mini.hidden = !count;
    this.mini.querySelector('.hx-at-n').textContent = String(count);
    this.mini.querySelector('.hx-at-txt b').textContent = what;
    this.mini.querySelector('.hx-at-txt i').textContent = line;
    this.paintBanner();
    this.ring();
    if (this.isOpen()) this.renderSheet();
  },

  /* ---------------------------------------------------- banner and sound -- */

  buildBanner() {
    const el = document.createElement('div');
    el.id = 'at-banner';
    el.hidden = true;
    el.setAttribute('role', 'alert');
    el.innerHTML = `
      <span class="at-sign" aria-hidden="true">!</span>
      <span class="atb-txt"><b></b><i></i></span>
      <button class="atb-open">Open</button>
      <button class="atb-seen">Seen</button>`;
    // The Radar line ("3 new on Radar") opens the feed, everything else this window.
    el.querySelector('.atb-open').onclick = () => (el.dataset.go ? this.go(el.dataset.go) : this.open());
    el.querySelector('.atb-seen').onclick = () => {
      this.audio?.pause();                 // the space ambience is a minute and a half
      const k = el.dataset.key;
      if (k) this.act('seen', k);
    };
    document.body.appendChild(el);
    this.banner = el;
  },

  /* The first open item that asks for a banner; "+2 more" if there are more. */
  paintBanner() {
    const want = (this.snap?.items || []).filter((i) => i.state === 'open' && i.banner);
    const b = this.banner;
    if (!b) return;
    b.hidden = !want.length;
    if (!want.length) return;
    const top = want[0];
    b.dataset.key = top.key;
    b.dataset.go = top.go || '';
    b.classList.toggle('alarm', !!top.alarm);
    b.querySelector('b').textContent = sayItem(top);
    b.querySelector('i').textContent = [top.detail, want.length > 1 ? `+${want.length - 1} more` : '']
      .filter(Boolean).join(' · ');
  },

  /* An item that has just appeared, of a type with a sound: once, on the
     wall — never on a phone, never twice on one page, never a ring older
     than a minute (a page opened later is not news). */
  ring(now = Date.now() / 1000) {
    if (this.ctx.phone) return;
    for (const i of this.snap?.items || []) {
      const r = i.ring;
      if (!r || typeof r.at !== 'number' || this.rung.has(i.key)) continue;
      this.rung.add(i.key);
      if (Math.abs(now - r.at) > RING_FRESH_S) continue;
      // The sound, then its text read aloud (2026-10-18) — or the text alone.
      if (r.sound) this.play(r.sound, r.voice);
      else if (r.voice) this.ctx.voice?.play(r.voice);
      break;                               // one sound at a time
    }
  },

  /* `then`: a voice file to read once the sound has ended. */
  play(id, then = null) {
    // A sound of the household's own (uploaded in the alerts' sheets) as well.
    const file = SOUND_FILES[id] || this.snap?.uploaded?.[id]?.file;
    if (!file) { if (then) this.ctx.voice?.play(then); return; }
    try {
      const el = (this.audio ||= new Audio());
      el.src = file;
      el.volume = 1;
      el.onended = then ? () => { el.onended = null; this.ctx.voice?.play(then); } : null;
      Promise.resolve(el.play()).catch(() => {});
    } catch { /* no audio here */ }
  },

  /* ------------------------------------------------------------ the sheet -- */

  buildSheet() {
    this.sheet = document.createElement('div');
    this.sheet.id = 'at-sheet';
    // The settings window kit's frame and header (app.css), in the
    // terracotta of its headings; its body is its own (.at-body).
    this.sheet.className = 'sheet a-food';
    this.sheet.setAttribute('role', 'dialog');
    this.sheet.setAttribute('aria-label', 'Needs attention');
    this.sheet.innerHTML = `
      <header>
        <span class="sheet-icon at-icon" aria-hidden="true">!</span>
        <div class="sheet-title">
          <h2>Needs attention</h2><span class="sheet-status at-count"></span>
        </div>
        <span class="spacer"></span>
        <button class="ls-btn at-gear" title="how alerts show: House → Automation"
                aria-label="how alerts show, on House → Automation">⚙</button>
        <button class="ls-close at-close">Close</button>
      </header>
      <div class="ls-body at-body"></div>`;
    this.sheet.querySelector('.at-close').addEventListener('click', () => this.close());
    this.sheet.querySelector('.at-gear').addEventListener('click', () => {
      this.close();
      this.ctx.goAutomation?.();
    });
    this.sheet.querySelector('.at-body').addEventListener('click', (e) => {
      const tk = e.target.closest('button[data-trk]');
      if (tk) { this.trackerAct(Number(tk.dataset.trk), tk.dataset.act, tk.dataset.agent); return; }
      const tl = e.target.closest('button[data-trkline]');
      if (tl) {
        const k = tl.dataset.trkline;
        if (this.trkOpen.has(k)) this.trkOpen.delete(k); else this.trkOpen.add(k);
        this.renderSheet();
        return;
      }
      const g = e.target.closest('button[data-go]');
      if (g) { this.go(g.dataset.go); return; }
      const up = e.target.closest('button[data-upd]');
      if (up) { this.updateAct(up.dataset.upd); return; }
      const upc = e.target.closest('button[data-upd-cancel]');
      if (upc) { this.updAsk = null; this.renderSheet(); return; }
      const upk = e.target.closest('button[data-upd-ok]');
      if (upk) { this.updateOk(upk.dataset.updOk); return; }
      const o = e.target.closest('button[data-open]');
      if (o) { this.openLink(o.dataset.open); return; }
      const b = e.target.closest('button[data-do]');
      if (b) this.act(b.dataset.do, b.dataset.key);
    });
    document.body.appendChild(this.sheet);
  },

  isOpen() { return !!this.sheet?.classList.contains('open'); },

  /* A view of its own for an item: the Radar line opens the feed. */
  go(view) {
    this.close();
    this.ctx.setPreset?.(view);
  },

  open() {
    if (!this.live) return;
    this.renderSheet();
    this.sheet.classList.add('open');
  },

  close() {
    this.sheet.classList.remove('open');
  },

  row(i, buttons) {
    const since = sinceText(i.since, i.at_least);
    const said = sayItem(i);
    const sub = [i.detail, said === i.title ? since : ''].filter(Boolean).join(' · ');
    // Open: only the key goes into the HTML; the address is looked up on tap.
    const live = i.key && !['hidden', 'ignored', 'off'].includes(i.state);
    const open = i.go === 'radar' && live ? '<button class="at-open" data-go="radar">Open Radar</button>'
      : linkOf(i.url) && live ? `<button class="at-open" data-open="${esc(i.key)}">Open</button>` : '';
    return `<div class="at-row${i.sev === 'info' ? ' info' : ''}${i.alarm ? ' alarm' : ''}">
        <div class="at-what-row"><b>${esc(said)}</b>${sub ? `<i>${esc(sub)}</i>` : ''}</div>
        <div class="at-btns">${open}${buttons}</div></div>`;
  },

  btn(what, key, label) {
    return `<button data-do="${what}" data-key="${esc(key)}">${label}</button>`;
  },

  renderSheet() {
    const gear = this.sheet.querySelector('.at-gear');
    gear.hidden = !(this.snap && Array.isArray(this.snap.types) && this.ctx.goAutomation);
    const snap = this.snap || { items: [], kinds: {} };
    const kinds = snap.kinds || {};
    const items = snap.items || [];
    const open = items.filter((i) => i.state === 'open');
    const act = open.filter((i) => i.sev === 'act');
    const info = open.filter((i) => i.sev !== 'act');
    const put = items.filter((i) => i.state !== 'open');
    // The header's line, in the kit's tones: something waiting is somebody
    // needed (warn); nothing is all well.
    const count = act.length ? `${act.length} ${act.length === 1 ? 'thing' : 'things'}` : 'nothing right now';
    const countEl = this.sheet.querySelector('.at-count');
    if (this.ctx?.sheetkit) this.ctx.sheetkit.status(countEl, act.length ? `<b>${count}</b>` : count, act.length ? 'warn' : 'ok');
    else countEl.textContent = count;

    const parts = [];
    for (const [kind, heading] of Object.entries(kinds)) {
      const rows = act.filter((i) => i.kind === kind);
      if (!rows.length) continue;
      // The lamps switched off at the wall will never answer and are nobody's
      // to fix: the one kind worth dismissing in a single tap.
      const all = kind === 'offline' && rows.length > 1
        ? this.btn('ignore', `kind:${kind}`, `Ignore all ${rows.length}`) : '';
      parts.push(`<section class="at-kind"><h3>${esc(heading)}${all}</h3>${rows.map((i) => this.itemRow(i))
        .join('')}</section>`);
    }
    if (!act.length) {
      parts.push('<div class="at-none">Nothing in the house is waiting for anybody.</div>');
    }
    const trk = Array.isArray(snap.tracking) ? snap.tracking : [];
    if (trk.length) {
      // One line each since 2026-10-12 (the Radar view has the feed): a tap
      // opens the whole card, with its buttons.
      parts.push(`<section class="at-kind at-tracking"><h3>Being tracked <span class="att-n">${trk.length}</span>
        <span class="att-from">from TunaRadar</span>${this.ctx.config?.layouts?.presets?.radar
          ? '<button class="att-feed" data-go="radar">See the Radar feed</button>' : ''}</h3>
        <div class="att-lines">${trk.map((t) => this.trackerLine(t)).join('')}</div></section>`);
    }
    if (info.length) {
      // By kind, as the urgent ones are: a dozen container versions are not
      // to be read mixed in with a lamp's firmware.
      const byKind = Object.keys(kinds).map((k) => [k, info.filter((i) => i.kind === k)])
        .filter(([, rows]) => rows.length);
      const one = byKind.length === 1;
      parts.push(`<section class="at-kind at-later"><h3>${esc(kinds.update || 'When you have time')}</h3>${
        byKind.map(([k, rows]) => `${one && k === 'update' ? '' : `<h4>${esc(kinds[k] || k)}</h4>`}${
          rows.map((i) => this.itemRow(i)).join('')}`).join('')}</section>`);
    }
    const kindsOff = snap.ignored_kinds || [];
    if (put.length || kindsOff.length) {
      const rows = [
        ...kindsOff.map((k) => this.row({ title: `All of "${kinds[k] || k}"`, detail: 'ignored' },
          this.btn('restore', `kind:${k}`, 'Restore'))),
        ...put.filter((i) => !i.by_kind).map((i) => (i.state === 'off'
          ? this.row({ ...i, detail: 'switched off on House → Automation (the ⚙ above)' }, '')
          : this.row({ ...i, detail: i.state === 'hidden'
            ? `hidden until ${new Date(i.until * 1000).toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' })}`
            : 'ignored' }, this.btn('restore', i.key, 'Restore')))),
      ];
      parts.push(`<details class="at-put"><summary>Hidden and ignored (${put.length})</summary>${
        rows.join('')}</details>`);
    }
    this.sheet.querySelector('.at-body').innerHTML = parts.join('');
  },

  /* An open item's row and buttons. A container update waiting (the
     server's update_items) has Update; its first tap says what will happen
     and asks, and the ask stays until Yes or Cancel. A pressed update's own
     line (run) follows the job on the server and, once it has ended, done or
     not, has only OK. */
  itemRow(i) {
    const hideIgnore = this.btn('hide', i.key, 'Hide 7 days') + this.btn('ignore', i.key, 'Ignore');
    const run = i.run;
    if (run) {
      const row = { ...i, detail: run.state === 'running' ? `${i.detail}…` : i.detail };
      return this.row(row, run.state === 'running' ? '<span class="at-run">working</span>'
        : `<button class="at-upd" data-upd-ok="${esc(run.service)}">OK</button>`)
        .replace('class="at-row', `class="at-row at-run-${run.state}`);
    }
    const u = i.update;
    if (!u || !u.can) return this.row(i, hideIgnore);
    const m = this.updMsg?.[u.service];
    if (this.updBusy === u.service) return this.row({ ...i, detail: 'Starting…' }, '');
    if (this.updAsk === u.service) {
      const what = u.service === 'homeassistant'
        ? 'Home Assistant stops for a few minutes: the lights keep their state, the switches and sensors wait.'
        : `${u.name} stops for a moment.`;
      return this.row({ ...i, detail: `${what} A copy of its folder is taken first, and it only goes ahead after a good weekly backup.` },
        `<button class="at-upd ask" data-upd="${esc(u.service)}">Yes, update now</button>`
        + `<button data-upd-cancel="${esc(u.service)}">Cancel</button>`);
    }
    return this.row(m ? { ...i, detail: m.text } : i,
      `<button class="at-upd" data-upd="${esc(u.service)}">Update</button>` + hideIgnore);
  },

  async updateAct(service) {
    if (this.updAsk !== service) { this.updAsk = service; this.renderSheet(); return; }
    this.updAsk = null;
    this.updBusy = service;
    this.renderSheet();
    let ans = null;
    try {
      const r = await fetch(`/api/attention/update/${encodeURIComponent(service)}`, { method: 'POST' });
      ans = await r.json();
    } catch { /* said below */ }
    // Started: the server's own line for the run replaces this row on the next
    // snapshot. Refused: the reason stays on the row until another press.
    this.updMsg = { ...(this.updMsg || {}),
      [service]: ans?.ok ? null : { text: `Not started: ${ans?.output || 'the kitchen could not ask the dashboard/services'}` } };
    this.updBusy = null;
    if (this.isOpen()) this.renderSheet();
  },

  async updateOk(service) {
    try {
      const r = await fetch(`/api/attention/update/${encodeURIComponent(service)}/ok`, { method: 'POST' });
      if (r.ok) this.paint(await r.json());
    } catch { /* the next snapshot puts it right */ }
  },

  /* One tracker: what it watches, what counts as found, when it will next
     alarm, and where, for whom and until when. All of it the server's words
     or TunaRadar's tracker's own, escaped here. */
  trackerCard(t) {
    const seq = Number(String(t.key || '').split(':')[1]) || 0;
    const meta = [
      (t.places || []).join(', '),
      t.sale ? `on sale ${t.sale}` : '',
      t.event ? `event ${t.event}` : '',
      t.next_check && !t.overdue ? `next search ${t.next_check}` : '',
      t.until ? `until ${t.until}` : '',
      t.who ? `for ${t.who}` : '',
    ].filter(Boolean).join(' · ');
    return `<div class="att-card${t.paused ? ' paused' : ''}">
      <div class="att-head"><span class="att-icon" aria-hidden="true">📡</span><b>${esc(t.name)}</b>
        <span class="att-tag">${esc(t.kind)}</span>${t.continuous ? '<span class="att-tag att-st">Keeps watching</span>'
          : `<span class="att-tag att-st">${esc(t.status)}</span>`}</div>
      ${t.subject ? `<div class="att-line"><span>Tracking</span><p>${esc(t.subject)}</p></div>` : ''}
      ${t.condition ? `<div class="att-line"><span>Alarms when</span><p>${esc(t.condition)}</p></div>` : ''}
      <div class="att-line att-alarm"><span>Next</span><p>${esc(t.alarm)}</p></div>
      ${t.continuous ? this.recentList(t) : ''}
      ${meta ? `<div class="att-meta">${esc(meta)}</div>` : ''}
      ${seq ? `<div class="att-btns">${this.trackerButtons(t, seq)}</div>` : ''}
    </div>`;
  },

  /* A continuous tracker's last found items (the server keeps three),
     newest first, each with its Open; only the key goes into the HTML. */
  recentList(t) {
    const rec = Array.isArray(t.recent) ? t.recent : [];
    if (!rec.length) return '<div class="att-line"><span>Latest</span><p class="att-none">Nothing found yet</p></div>';
    return `<div class="att-line att-recent"><span>Latest${t.last_found ? `<br><small>${esc(t.last_found)}</small>` : ''}</span><ol>${
      rec.map((f) => `<li><div><b>${esc(f.summary)}</b>${f.detail ? `<i>${esc(f.detail)}</i>` : ''}</div>${
        linkOf(f.url) && f.key ? `<button class="at-open" data-open="${esc(f.key)}">Open</button>` : ''}</li>`).join('')
    }</ol></div>`;
  },

  /* A tracker in one line — its name, and when it was last checked, in red
     when a check is overdue — that opens into its whole card. */
  trackerLine(t) {
    const open = this.trkOpen.has(t.key);
    return `<div class="att-tline${open ? ' open' : ''}${t.overdue ? ' late' : ''}">
      <button class="att-tl" data-trkline="${esc(t.key)}" aria-expanded="${open}">
        <span class="att-icon" aria-hidden="true">📡</span><b>${esc(t.name)}</b>
        <i class="${t.overdue ? 'att-late' : t.checking ? 'att-checking' : ''}">${esc(t.check || t.alarm || '')}</i>
        <span class="att-chev" aria-hidden="true">${open ? '▴' : '▾'}</span></button>
      ${open ? this.trackerCard(t) : ''}</div>`;
  },

  /* An Open's page: an alert item's, else a continuous tracker's found item's,
     else a post in the Radar feed. */
  linkItem(key) {
    const item = (this.snap?.items || []).find((i) => i.key === key);
    if (item) return item;
    const post = this.ctx.radar?.post?.(key);
    if (post) return post;
    for (const t of this.snap?.tracking || []) {
      const f = (t.recent || []).find((r) => r.key === key);
      if (f) return { key, url: f.url, title: f.summary };
    }
    return null;
  },

  /* Pause or Resume at once; Stop tracking (Done on TunaRadar, for everyone
     following it) and Off the wall (it carries on in TunaRadar) ask for a
     second tap first, and the ask lapses after a few seconds. */
  trackerButtons(t, seq) {
    const ask = this.trkAsk && this.trkAsk.seq === seq ? this.trkAsk.action : null;
    const busy = this.trkBusy === seq ? ' disabled' : '';
    const b = (action, label, cls = '') => `<button class="att-b${cls}${ask === action ? ' ask' : ''}"
      data-trk="${seq}" data-act="${action}"${busy}>${ask === action ? 'Tap again to confirm' : label}</button>`;
    // Check now (2026-10-12), by either of TunaRadar's agents; none while paused
    // or while a check is running.
    const c = t.checking;
    const chk = (agent, label) => `<button class="att-b${c && c.agent === agent ? ' ask' : ''}" data-trk="${seq}"
      data-act="check" data-agent="${agent}"${busy || (c && c.state === 'running') ? ' disabled' : ''}>${label}</button>`;
    const check = t.paused ? '' : `<span class="att-check"><span>Check now</span>${chk('claude', 'Claude Code')}${chk('local', 'Local model')}</span>`;
    const msg = this.trkMsg?.[seq] ? `<p class="att-msg">${esc(this.trkMsg[seq])}</p>` : '';
    return check + (t.paused ? b('resume', 'Resume') : b('pause', 'Pause'))
      + b('done', 'Stop tracking', ' att-end') + b('hide', 'Off the wall') + msg;
  },

  async trackerAct(seq, action, agent) {
    if ((action === 'done' || action === 'hide')
        && !(this.trkAsk && this.trkAsk.seq === seq && this.trkAsk.action === action)) {
      this.trkAsk = { seq, action };
      clearTimeout(this.trkAskTimer);
      this.trkAskTimer = setTimeout(() => { this.trkAsk = null; if (this.isOpen()) this.renderSheet(); }, 5000);
      this.renderSheet();
      return;
    }
    this.trkAsk = null;
    this.trkBusy = seq;
    this.renderSheet();
    try {
      const r = await fetch(`/api/attention/tracker/${seq}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(action === 'check' ? { action, agent } : { action }),
      });
      const ans = await r.json().catch(() => null);
      this.trkMsg = { ...(this.trkMsg || {}), [seq]: '' };
      if (r.ok && ans) {
        this.paint(ans);
        if (action === 'check') {
          this.trkMsg[seq] = ans.check?.state === 'running' ? 'A check is already running.'
            : agent === 'local' && ans.worker_seen === false
              ? "Asked the local model; AI's worker has not been heard from for 20 minutes, so it starts when AI is back."
              : `Asked ${agent === 'claude' ? 'Claude Code' : 'the local model'}: the check starts within a minute or so.`;
        }
      } else {
        this.trkMsg[seq] = ans?.error || 'TunaRadar could not be asked just now.';
        console.warn('tracker action failed', r.status);
      }
    } catch { /* the next snapshot puts the sheet right */ }
    this.trkBusy = null;
    if (this.isOpen()) this.renderSheet();
  },

  /* ------------------------------------------------------ a found page -- */

  onWall() {
    if (this.ctx?.phone) return false;
    const n = this.ctx?.night;
    // Without night.js, or before it has heard from the server which screen
    // is the wall: the wall, the side that cannot go wrong.
    if (!n || !n.data) return true;
    return n.onWall();
  },

  openLink(key) {
    const item = this.linkItem(key);
    const url = linkOf(item?.url);
    if (!url) return;
    if (!this.onWall()) {
      const a = document.createElement('a');
      a.href = url;
      a.target = '_blank';
      a.rel = 'noopener noreferrer';
      a.referrerPolicy = 'no-referrer';
      document.body.appendChild(a);
      a.click();
      a.remove();
      return;
    }
    if (!this.linkEl) this.buildLink();
    const el = this.linkEl;
    el.querySelector('h2').textContent = sayItem(item);
    el.querySelector('.atl-addr').textContent = url;
    const body = el.querySelector('.atl-body');
    body.replaceChildren(this.linkNote('Checking whether the site can be shown here…'));
    const seq = (this.linkSeq = (this.linkSeq || 0) + 1);
    this.linkTouch = Date.now();
    el.classList.add('open');
    clearInterval(this.linkTimer);
    this.linkTimer = setInterval(() => {
      if (Date.now() - this.linkTouch >= LINK_IDLE_MS) this.closeLink();
    }, 30 * 1000);
    // A refused frame is a blank rectangle with nothing to catch, so the
    // server reads the page's headers first (attention.py frame_verdict, the
    // TV panel's rule); when it cannot tell, the frame gets its chance.
    fetch(`/api/attention/${encodeURIComponent(key)}/framable`, { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null)).catch(() => null)
      .then((v) => {
        if (seq !== this.linkSeq || !this.linkOpen()) return;
        if (v && v.framable === false) {
          body.replaceChildren(this.linkNote("This site can't be shown here — open it on a phone: ", url));
          return;
        }
        body.replaceChildren(this.linkFrame(url, sayItem(item)));
      });
  },

  /* The page in a frame that may run its own scripts in its own origin and
     post its own forms, and nothing else: no top navigation (it cannot take
     the wall away from the kitchen), no popups, modals or downloads, no
     camera, microphone, location, autoplay or full screen, no referrer. */
  linkFrame(url, title) {
    const f = document.createElement('iframe');
    f.setAttribute('sandbox', LINK_SANDBOX);
    f.setAttribute('allow', LINK_ALLOW);
    f.referrerPolicy = 'no-referrer';
    f.title = title;
    f.src = url;
    return f;
  },

  linkNote(text, addr = '') {
    const p = document.createElement('p');
    p.className = 'atl-note';
    p.textContent = text;
    if (addr) {
      const b = document.createElement('b');
      b.textContent = addr;
      p.append(b);
    }
    return p;
  },

  buildLink() {
    const el = document.createElement('div');
    el.id = 'at-link';
    el.setAttribute('role', 'dialog');
    el.innerHTML = `
      <header>
        <div class="atl-head"><h2></h2>
          <span class="atl-sub">A blank page means the site will not show here: open
            <span class="atl-addr"></span> on a phone.</span></div>
        <button class="atl-close">Close</button>
      </header>
      <div class="atl-body"></div>`;
    el.querySelector('.atl-close').onclick = () => this.closeLink();
    el.addEventListener('pointerdown', () => { this.linkTouch = Date.now(); }, { passive: true });
    // A tap inside the frame never reaches this page, but the first one takes
    // the focus into the frame, which blurs this window: count that as a
    // touch, so somebody reading the page is not closed on after ten minutes.
    // Two seconds later the focus is taken back (the wall has no keyboard to
    // type into the page with), so the next tap in the frame blurs again.
    addEventListener('blur', () => {
      if (!this.linkOpen() || document.activeElement?.tagName !== 'IFRAME') return;
      this.linkTouch = Date.now();
      clearTimeout(this.linkRefocus);
      this.linkRefocus = setTimeout(() => {
        if (this.linkOpen() && document.activeElement?.tagName === 'IFRAME') document.activeElement.blur();
      }, 2000);
    });
    document.body.appendChild(el);
    this.linkEl = el;
  },

  closeLink() {
    clearInterval(this.linkTimer);
    this.linkTimer = null;
    if (!this.linkEl) return;
    this.linkEl.classList.remove('open');
    this.linkEl.querySelector('.atl-body').replaceChildren();   // the page goes, not just hides
  },

  linkOpen() { return !!this.linkEl?.classList.contains('open'); },

  async act(what, key) {
    const path = `/api/attention/${encodeURIComponent(key)}/${what === 'restore' ? 'ignore' : what}`;
    try {
      const r = await fetch(path, { method: what === 'restore' ? 'DELETE' : 'POST' });
      if (!r.ok) throw new Error(r.status);
      this.paint(await r.json());
    } catch {
      /* the next snapshot over SSE puts the sheet right either way */
    }
  },
};
