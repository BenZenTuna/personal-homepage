/* Radar — everything TunaRadar has found for the house, as a feed
   (2026-10-12, Alex: "I would like to have them as newsfeed items and be
   alerted when something new tracked").

   Made a news feed proper on 2026-10-15 (Alex: "more user friendly, so
   users can have it as a news feed place as well, what is new from the
   tracking radars. It seems more like radar cards and settings now"):

   - **One column, by day**, newest first — Today, Yesterday, the weekday,
     the date — under a line that says what is new and when the trackers
     last looked. A tracker's finds that came together (within BUNDLE_S) are
     one story, "4 new from …", its items in date order; a find's line split
     at its first colon into a small kicker and the headline, the kicker
     said once for a story whose items share it.
   - **The rounds** between them (radarfeed.py rounds()): "06:31 · Checked 5
     trackers · nothing new", so a quiet day says it was looked at. Days
     with nothing but quiet rounds, before yesterday, fold into one line.
   - **New trackers** are one slim line, not a card.
   - **Quiet buttons**: ♡ Save, ✕ Not for us, 📅 Countdown as plain words in
     a row, Open › on the right; in a story's item lines, the same as icons.
   - **Pictures** (the same evening): a find whose page names a preview
     picture shows the kitchen's copy of it (radarthumbs.py) — on the
     story's right on the wall, across its top on a phone; a story of several
     finds shows the first of theirs. One that fails to load goes away.
   - **On the right**: Coming up — the found things still ahead, by date,
     a tap scrolls the feed to it — and the trackers, one short row each (in
     red when a check is overdue). Everything about a tracker — what it
     tracks, how it alerts, Check now, Pause, Stop tracking, Off the wall,
     only its posts, and its finds — is behind a tap, in a sheet of its own.

   The server holds it all (backend/app/radarfeed.py): the posts, the rounds,
   what has been read, saved and hidden, and the ringing. A post shown here
   for a few seconds is read (POST /api/radar/read), for the whole household;
   its dot stays until this view is left, so whoever opened it still sees what
   was new. The count on the Radar button is the server's.

   Every word from TunaRadar is escaped here; a page's address never goes
   into the HTML — Open looks it up by key (Needs attention's openLink, the
   sandboxed frame on the wall, a new tab elsewhere). */

const esc = (s) => String(s ?? '').replace(/[&<>"']/g,
  (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const READ_AFTER_MS = 4000;      // on screen this long: read
const ASK_MS = 5000;             // a two-tap button's ask lapses after this
const BUNDLE_S = 3600;           // one tracker's finds this close are one story
const SOON_MAX = 6;              // Coming up's rows
const DAY_S = 86400;

const FILTERS = [
  ['all', 'Latest'],
  ['new', 'New'],
  ['saved', '♥ Saved'],
  ['past', 'Past'],
  ['hidden', 'Not for us'],
];

const MODE_WORDS = { every: 'alerts on every new result', digest: 'in the daily digest', feed: 'feed only, no alert' };
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const LONG_DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

const pad = (n) => String(n).padStart(2, '0');
const hm = (t) => { const d = new Date(t * 1000); return `${pad(d.getHours())}:${pad(d.getMinutes())}`; };
const dayStart = (t) => { const d = new Date(t * 1000); d.setHours(0, 0, 0, 0); return d.getTime() / 1000; };
const nowS = () => Date.now() / 1000;

/* "just now", "12 min ago", "3 h ago", "yesterday", else the day. */
function ago(t, now = nowS()) {
  const s = Math.max(0, now - t);
  if (s < 90) return 'just now';
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 20 * 3600) return `${Math.round(s / 3600)} h ago`;
  const d = new Date(t * 1000);
  const y = new Date(now * 1000);
  y.setDate(y.getDate() - 1);
  if (d.toDateString() === y.toDateString()) return 'yesterday';
  return d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });
}

/* A day's heading: Today, Yesterday, the weekday within the week, else the date. */
function dayLabel(t, now = nowS()) {
  const days = Math.round((dayStart(now) - dayStart(t)) / DAY_S);
  const d = new Date(t * 1000);
  if (days === 0) return 'Today';
  if (days === 1) return 'Yesterday';
  if (days < 7) return LONG_DAYS[d.getDay()];
  return `${WEEKDAYS[d.getDay()]} ${d.getDate()} ${MONTHS[d.getMonth()]}`;
}

/* "today", "yesterday", "tomorrow", "on Monday", "on Mon 5 Oct" — in a sentence. */
function onDay(t, now = nowS()) {
  const days = Math.round((dayStart(t) - dayStart(now)) / DAY_S);
  if (days === 0) return 'today';
  if (days === -1) return 'yesterday';
  if (days === 1) return 'tomorrow';
  const d = new Date(t * 1000);
  return Math.abs(days) < 7 ? `on ${LONG_DAYS[d.getDay()]}` : `on ${WEEKDAYS[d.getDay()]} ${d.getDate()} ${MONTHS[d.getMonth()]}`;
}

const shortDay = (t) => { const d = new Date(t * 1000); return `${WEEKDAYS[d.getDay()]} ${d.getDate()} ${MONTHS[d.getMonth()]}`; };

/* How far ahead a day is: today, tomorrow, in 4 days, in 3 weeks — or behind. */
function until(t, now = nowS()) {
  const days = Math.round((dayStart(t) - dayStart(now)) / DAY_S);
  if (days === 0) return 'today';
  if (days === 1) return 'tomorrow';
  if (days === -1) return 'yesterday';
  if (days < 0) return `${-days} days ago`;
  if (days < 14) return `in ${days} days`;
  if (days < 60) return `in ${Math.round(days / 7)} weeks`;
  return `in ${Math.round(days / 30)} months`;
}

/* "Barnens universitet (ages 8–12): 19 October lecture …" → a kicker and a
   headline, when the line has a colon early and enough after it. */
function split(summary) {
  const s = String(summary || '');
  const i = s.indexOf(': ');
  if (i >= 6 && i <= 110 && s.length - i - 2 >= 24) {
    const head = s.slice(i + 2);
    return { kicker: s.slice(0, i), head: head[0].toUpperCase() + head.slice(1) };
  }
  return { kicker: '', head: s };
}

/* What a story's kickers share, cut at a word and before any bracket:
   "Barnens universitet (ages 8–12, free …)" and "Barnens universitet (ages
   8–12, public …)" share "Barnens universitet". '' when it is too short. */
function common(kickers) {
  if (!kickers.length || kickers.some((k) => !k)) return '';
  let c = kickers[0];
  for (const k of kickers) {
    let i = 0;
    while (i < c.length && i < k.length && c[i] === k[i]) i++;
    c = c.slice(0, i);
  }
  if (kickers.every((k) => k === c)) return c;
  // Stopped inside a word in any of them: back to that word's start.
  if (kickers.some((k) => /[\p{L}\p{N}]/u.test(k[c.length] || '')) && /[\p{L}\p{N}]$/u.test(c)) {
    c = c.replace(/[\p{L}\p{N}]*$/u, '');
  }
  c = c.split(' (')[0].replace(/[\s,;:(–-]+$/, '');
  return c.length >= 6 ? c : '';
}

/* The day a post is about: its event, else its sale. */
const dayOf = (p) => (p.event != null ? p.event : p.sale != null ? p.sale : null);

/* The kitchen's copy of a find's page's picture, or ''. */
function picture(p, cls = 'rf-pic') {
  const t = p && p.thumb;
  if (!t || !/^[0-9a-f]{40}$/.test(t.id || '')) return '';
  return `<span class="${cls}"><img src="/api/radar/thumb/${t.id}.jpg" alt="" loading="lazy" decoding="async"></span>`;
}

function dateBadge(t, small = false) {
  if (t == null) return '';
  const d = new Date(t * 1000);
  return `<span class="rf-cal${small ? ' sm' : ''}" aria-hidden="true"><i>${MONTHS[d.getMonth()]}</i><b>${d.getDate()}</b><em>${WEEKDAYS[d.getDay()]}</em></span>`;
}

export default {
  id: 'radar',
  title: 'Radar',
  pauseWhenUnseen: true,

  snap: null,
  filter: 'all',
  only: null,           // a tracker's key: only its posts
  sheetTrk: null,       // the tracker whose sheet is open
  openRounds: new Set(),// rounds whose trackers are listed
  visitNew: new Set(),  // posts that were new when this visit began: their dots stay
  shown: false,
  ask: null,            // {key, action} for a two-tap button
  notes: {},            // a post's key → a line under it (Not for us not told, …)
  tnotes: {},           // a tracker's key → a line under its buttons (Check now's answer)
  busy: new Set(),

  init(body, ctx) {
    this.body = body;
    this.ctx = ctx;
    ctx.radar = this;
    body.innerHTML = `
      <div class="rf">
        <section class="rf-feed">
          <div class="rf-head">
            <div class="rf-brief"><b class="rf-bh"></b><span class="rf-bs"></span></div>
            <div class="rf-filters"></div>
          </div>
          <div class="rf-list"></div>
        </section>
        <aside class="rf-rail">
          <div class="rf-box rf-soon"><h3>Coming up</h3><div class="rf-soon-list"></div></div>
          <div class="rf-box rf-trk"><h3>Trackers <span class="rf-n"></span></h3><div class="rf-trk-list"></div></div>
        </aside>
      </div>`;
    this.buildSheet();
    this.allBtn = ctx.addHeaderButton('radar', 'Mark all read', () => this.readAll());
    this.allBtn.hidden = true;
    body.addEventListener('click', (e) => this.click(e));
    // A picture that does not load takes its frame with it ('error' does not bubble).
    const gone = (e) => {
      if (e.target.tagName === 'IMG' && e.target.parentElement?.matches('.rf-pic, .rf-spic')) {
        e.target.parentElement.closest('.has-pic')?.classList.remove('has-pic');
        e.target.parentElement.remove();
      }
    };
    body.addEventListener('error', gone, true);
    this.sheet.addEventListener('error', gone, true);
    ctx.bus.on('radar', (snap) => this.take(snap));
    fetch('/api/radar', { cache: 'no-store' }).then((r) => (r.ok ? r.json() : null))
      .then((s) => { if (s && !this.snap) this.take(s); }).catch(() => {});
    // The ages ("12 min ago") move on.
    setInterval(() => { if (this.shown) this.render(); }, 60 * 1000);
  },

  take(snap) {
    if (!snap || !Array.isArray(snap.posts)) return;
    this.snap = snap;
    this.ctx.presetBadge?.('radar', snap.unread || 0);
    this.render();
    this.scheduleRead();
  },

  onShow() {
    this.shown = true;
    this.visitNew = new Set((this.snap?.posts || []).filter((p) => p.unread).map((p) => p.key));
    this.render();
    this.scheduleRead();
  },

  onHide() {
    this.shown = false;
    clearTimeout(this.readTimer);
    this.visitNew = new Set();
    this.ask = null;
    this.closeSheet();
  },

  /* ------------------------------------------------------------ server -- */

  async send(method, url, body) {
    try {
      const r = await fetch(url, {
        method,
        headers: body ? { 'Content-Type': 'application/json' } : {},
        body: body ? JSON.stringify(body) : undefined,
      });
      const ans = await r.json().catch(() => null);
      if (r.ok && ans && Array.isArray(ans.posts)) this.take(ans);
      return { ok: r.ok, ans };
    } catch {
      return { ok: false, ans: null };
    }
  },

  /* What has been on screen for READ_AFTER_MS is read, for everybody. The
     dots stay until the view is left. */
  scheduleRead() {
    clearTimeout(this.readTimer);
    if (!this.shown || document.hidden) return;
    const keys = this.visible().filter((p) => p.unread).map((p) => p.key);
    if (!keys.length) return;
    for (const k of keys) this.visitNew.add(k);
    this.readTimer = setTimeout(() => {
      if (this.shown && !document.hidden) this.send('POST', '/api/radar/read', { keys });
    }, READ_AFTER_MS);
  },

  readAll() {
    for (const p of this.snap?.posts || []) if (p.unread) this.visitNew.add(p.key);
    this.send('POST', '/api/radar/read', { all: true });
  },

  /* ------------------------------------------------------------ choose -- */

  posts() { return Array.isArray(this.snap?.posts) ? this.snap.posts : []; },
  trackers() { return Array.isArray(this.snap?.trackers) ? this.snap.trackers : []; },
  rounds() { return Array.isArray(this.snap?.rounds) ? this.snap.rounds : []; },
  fresh(p) { return p.unread || this.visitNew.has(p.key); },

  /* The posts the chosen filter (and tracker) shows. */
  visible() {
    let ps = this.posts();
    if (this.only) ps = ps.filter((p) => p.tracker === this.only);
    switch (this.filter) {
      case 'new': return ps.filter((p) => !p.hidden && !p.past && this.fresh(p));
      case 'saved': return ps.filter((p) => p.saved);
      case 'past': return ps.filter((p) => p.past && !p.hidden);
      case 'hidden': return ps.filter((p) => p.hidden);
      default: return ps.filter((p) => !p.hidden && !p.past);
    }
  },

  count(f) {
    const keep = this.filter;
    this.filter = f;
    const n = this.visible().length;
    this.filter = keep;
    return n;
  },

  /* The feed's entries, newest first: stories (a find, or a tracker's finds
     that came together), new trackers and — on Latest — the rounds. */
  entries() {
    const ps = this.visible();
    const out = [];
    const groups = [];
    for (const p of ps.filter((x) => x.type === 'found').sort((a, b) => b.found - a.found)) {
      const g = groups.find((x) => x.tracker === p.tracker && x.oldest - p.found <= BUNDLE_S);
      if (g) { g.posts.push(p); g.oldest = p.found; } else {
        groups.push({ tracker: p.tracker, posts: [p], newest: p.found, oldest: p.found });
      }
    }
    for (const g of groups) {
      if (g.posts.length === 1) out.push({ kind: 'story', at: g.newest, p: g.posts[0] });
      else {
        // The items in the order their days come; without days, as found.
        g.posts.sort((a, b) => ((dayOf(a) ?? Infinity) - (dayOf(b) ?? Infinity)) || (b.found - a.found));
        out.push({ kind: 'bundle', at: g.newest, posts: g.posts });
      }
    }
    for (const p of ps.filter((x) => x.type === 'tracking')) out.push({ kind: 'tracking', at: p.found, p });
    if (this.filter === 'all') {
      for (const r of this.rounds()) {
        if (this.only && !r.trackers.some((t) => t.key === this.only)) continue;
        out.push({ kind: 'round', at: r.at, r });
      }
    }
    // A round sits under the finds it brought, which come a moment after it.
    out.sort((a, b) => (b.at - a.at) || ((a.kind === 'round') - (b.kind === 'round')));
    return out;
  },

  /* The entries by day. Days with nothing but quiet rounds, before yesterday,
     fold into one stretch: "Checked every day — nothing new". */
  days() {
    const now = nowS();
    const byDay = [];
    for (const e of this.entries()) {
      const d = dayStart(e.at);
      const last = byDay[byDay.length - 1];
      if (last && last.day === d) last.items.push(e); else byDay.push({ day: d, items: [e] });
    }
    const quiet = (g) => dayStart(now) - g.day >= 2 * DAY_S
      && g.items.every((e) => e.kind === 'round' && !e.r.found);
    const out = [];
    for (const g of byDay) {
      const prev = out[out.length - 1];
      if (quiet(g) && prev && prev.stretch) {
        prev.from = g.day;
        prev.n += g.items.length;
        prev.days.push(g);
      } else if (quiet(g)) {
        out.push({ stretch: true, to: g.day, from: g.day, n: g.items.length, days: [g] });
      } else {
        out.push(g);
      }
    }
    // One quiet day alone is a day like the others.
    return out.flatMap((g) => (g.stretch && g.days.length < 2 ? g.days : [g]));
  },

  /* ------------------------------------------------------------ render -- */

  render() {
    if (!this.body || !this.snap) return;
    const s = this.snap;
    const trk = this.trackers();
    const unread = s.unread || 0;
    this.ctx.setMeta('radar', [
      unread ? `${unread} new` : 'nothing new',
      `${trk.length} ${trk.length === 1 ? 'tracker' : 'trackers'}`,
      s.overdue ? `${s.overdue} overdue` : '',
    ].filter(Boolean).join(' · '));
    this.allBtn.hidden = !unread;
    this.renderBrief();
    const onlyName = this.only ? (trk.find((t) => t.key === this.only)?.name || 'one tracker') : '';
    this.body.querySelector('.rf-filters').innerHTML = FILTERS.map(([f, label]) => {
      const n = this.count(f);
      return `<button class="rf-f${this.filter === f ? ' on' : ''}" data-filter="${f}">${label}${
        f !== 'all' && n ? ` <span>${n}</span>` : ''}</button>`;
    }).join('') + (this.only ? `<button class="rf-f rf-only on" data-only="">${esc(onlyName)} ✕</button>` : '');
    const days = this.days();
    this.body.querySelector('.rf-list').innerHTML = days.length
      ? days.map((g) => this.dayBlock(g)).join('')
      : `<p class="rf-none">${this.emptyText()}</p>`;
    this.body.querySelector('.rf-n').textContent = String(trk.length);
    this.body.querySelector('.rf-trk-list').innerHTML = trk.length
      ? trk.map((t) => this.trackerRow(t)).join('')
      : '<p class="rf-none">Nothing is on the kitchen screen in TunaRadar.</p>';
    this.body.querySelector('.rf-soon-list').innerHTML = this.soon();
    if (this.sheetTrk) this.renderSheet();
  },

  /* The top line: what is new, and when the trackers last looked and next will. */
  renderBrief() {
    const s = this.snap;
    const now = nowS();
    const unread = s.unread || 0;
    const head = !s.on ? 'Radar is not answering'
      : unread ? `${unread} new ${unread === 1 ? 'find' : 'finds'}` : 'All caught up';
    const trk = this.trackers();
    const r0 = this.rounds()[0];
    const lastAt = r0 ? r0.at : Math.max(0, ...trk.map((t) => t.last_at || 0));
    const nextAt = Math.min(Infinity, ...trk.map((t) => (t.next_at && t.next_at > now ? t.next_at : Infinity)));
    const latest = this.posts().filter((p) => p.type === 'found' && !p.hidden)
      .sort((a, b) => b.found - a.found)[0];
    const parts = [];
    if (lastAt) {
      const n = r0 ? r0.trackers.length : 0;
      parts.push(`Checked ${onDay(lastAt, now)} at ${hm(lastAt)}${n ? ` · ${n} ${n === 1 ? 'tracker' : 'trackers'}` : ''}`);
    }
    if (nextAt !== Infinity) parts.push(`next ${onDay(nextAt, now)} at ${hm(nextAt)}`);
    if (latest && !unread) parts.push(`latest find ${ago(latest.found, now)}`);
    const late = s.overdue ? `<span class="rf-late">${s.overdue} ${s.overdue === 1 ? 'check' : 'checks'} overdue</span>` : '';
    this.body.querySelector('.rf-bh').textContent = head;
    this.body.querySelector('.rf-bh').classList.toggle('new', !!unread);
    this.body.querySelector('.rf-bs').innerHTML = [esc(parts.join(' · ')), late].filter(Boolean).join(' · ');
  },

  dayBlock(g) {
    if (g.stretch) {
      return `<div class="rf-day"><h3>${esc(`${shortDay(g.from)} – ${shortDay(g.to)}`)}</h3>
        <div class="rf-line rf-round"><span class="rf-li" aria-hidden="true">📡</span>
          <span class="rf-lt">Checked every day — nothing new <i>(${g.n} rounds of checks)</i></span></div></div>`;
    }
    return `<div class="rf-day"><h3>${esc(dayLabel(g.day))}</h3>${g.items.map((e) => this.entry(e)).join('')}</div>`;
  },

  entry(e) {
    if (e.kind === 'story') return this.story(e.p);
    if (e.kind === 'bundle') return this.bundle(e.posts);
    if (e.kind === 'tracking') return this.trackingLine(e.p);
    return this.roundLine(e.r);
  },

  emptyText() {
    if (!this.snap.on) return 'TunaRadar is not answering, or is too old to send its finds.';
    return {
      all: this.only ? 'Nothing found by this tracker in the last 30 days.'
        : 'Nothing found in the last 30 days. New finds show here, and on the Radar button.',
      new: 'Nothing new.',
      saved: 'Nothing saved. ♡ Save on a find keeps it here.',
      past: 'Nothing whose day is over.',
      hidden: 'Nothing marked Not for us.',
    }[this.filter];
  },

  /* The day line of a find: its day and how far, its place, its people. */
  facts(p, place = true) {
    const d = dayOf(p);
    const now = nowS();
    return [
      d != null ? `<span class="rf-when">📅 ${esc(p.when || shortDay(d))} <b>${esc(until(d, now))}</b></span>` : '',
      place && p.place ? `<span>📍 ${esc(p.place)}</span>` : '',
      p.who ? `<span>for ${esc(p.who)}</span>` : '',
    ].filter(Boolean).join('');
  },

  /* A find's buttons: words on a story, icons on a story's item line. */
  acts(p, icons = false) {
    const busy = this.busy.has(p.key) ? ' disabled' : '';
    const k = esc(p.key);
    const lbl = (word, icon) => (icons ? icon : `${icon} ${word}`);
    if (p.hidden) return `<button class="rf-a" data-post="unhide" data-key="${k}"${busy}>Undo Not for us</button>`;
    const out = [
      `<button class="rf-a${p.saved ? ' on' : ''}" data-post="${p.saved ? 'unsave' : 'save'}" data-key="${k}"${busy}
        title="${p.saved ? 'saved — tap to unsave' : 'save it'}" aria-label="${p.saved ? 'saved' : 'save'}">${
        lbl(p.saved ? 'Saved' : 'Save', p.saved ? '♥' : '♡')}</button>`,
      `<button class="rf-a" data-post="hide" data-key="${k}"${busy} title="not for us" aria-label="not for us">${lbl('Not for us', '✕')}</button>`,
    ];
    if (p.counted) out.push(`<span class="rf-a rf-done" title="in the countdown">${icons ? '📅✓' : '📅 In the countdown'}</span>`);
    else if (p.can_count) {
      out.push(`<button class="rf-a" data-post="countdown" data-key="${k}"${busy} title="add to the countdown"
        aria-label="add to the countdown">${lbl('Countdown', '📅')}</button>`);
    }
    if (p.url) out.push(`<button class="rf-a rf-open" data-open="${k}" aria-label="open the page">${icons ? '›' : 'Open ›'}</button>`);
    return out.join('');
  },

  story(p) {
    const { kicker, head } = split(p.summary);
    const note = this.notes[p.key];
    const d = dayOf(p);
    const pic = picture(p);
    return `<article class="rf-story${this.fresh(p) ? ' new' : ''}${p.past ? ' past' : ''}${pic ? ' has-pic' : ''}" data-post-key="${esc(p.key)}">
        ${pic}
        <div class="rf-side">${d != null ? dateBadge(d) : `<span class="rf-ico" aria-hidden="true">${esc(p.icon)}</span>`}</div>
        <div class="rf-main">
          <div class="rf-src"><span class="rf-dot" aria-hidden="true"></span>
            <button class="rf-by" data-trk="${esc(p.tracker)}">${esc(p.icon)} ${esc(p.tracker_name)}</button>
            <span>· ${esc(ago(p.found))}</span>${p.what && p.what !== 'New' ? `<span class="rf-what">${esc(p.what)}</span>` : ''}
            ${p.gone ? '<span class="rf-tag">kept</span>' : ''}</div>
          ${kicker ? `<p class="rf-kick">${esc(kicker)}</p>` : ''}
          <h4>${esc(head)}</h4>
          <div class="rf-facts">${this.facts(p)}</div>
          <div class="rf-acts">${this.acts(p)}</div>
          ${note ? `<p class="rf-note">${esc(note)}</p>` : ''}
        </div>
      </article>`;
  },

  /* A tracker's finds that came together: one story, an item line each. */
  bundle(ps) {
    const first = ps[0];
    const parts = ps.map((p) => split(p.summary));
    const shared = common(parts.map((x) => x.kicker));
    const places = [...new Set(ps.map((p) => p.place || ''))];
    const place = places.length === 1 ? places[0] : '';
    const newest = Math.max(...ps.map((p) => p.found));
    const nNew = ps.filter((p) => this.fresh(p)).length;
    const items = ps.map((p, i) => {
      const d = dayOf(p);
      const note = this.notes[p.key];
      return `<li class="rf-item${this.fresh(p) ? ' new' : ''}${p.past ? ' past' : ''}" data-post-key="${esc(p.key)}">
          ${d != null ? dateBadge(d, true) : '<span class="rf-cal sm none" aria-hidden="true"></span>'}
          <div class="rf-it"><b>${esc(shared ? parts[i].head : p.summary)}</b>${
            shared && parts[i].kicker !== shared ? `<span class="rf-ik">${esc(parts[i].kicker.slice(shared.length)
              .replace(/^[\s,:–-]+/, '').replace(/^\((.*)\)$/, '$1'))}</span>` : ''}
            <span class="rf-facts">${this.facts(p, !place)}</span>
            ${note ? `<span class="rf-note">${esc(note)}</span>` : ''}</div>
          <div class="rf-iacts">${this.acts(p, true)}</div>
        </li>`;
    }).join('');
    const pic = picture(ps.find((p) => p.thumb), 'rf-pic rf-banner');
    return `<article class="rf-story rf-bundle${nNew ? ' new' : ''}">
        <div class="rf-side"><span class="rf-ico big" aria-hidden="true">${esc(first.icon)}</span><span class="rf-count">${ps.length}</span></div>
        <div class="rf-main">
          <div class="rf-src"><span class="rf-dot" aria-hidden="true"></span>
            <button class="rf-by" data-trk="${esc(first.tracker)}">${esc(first.tracker_name)}</button>
            <span>· ${ps.length} finds${nNew ? `, ${nNew} new` : ''} · ${esc(ago(newest))}</span></div>
          <h4>${esc(shared || `${ps.length} ${nNew === ps.length ? 'new finds' : 'finds'}`)}</h4>
          ${place ? `<div class="rf-facts"><span>📍 ${esc(place)}</span></div>` : ''}
          ${pic}
          <ul class="rf-items">${items}</ul>
        </div>
      </article>`;
  },

  trackingLine(p) {
    const what = [p.subject && p.subject !== p.tracker_name ? p.subject : '', p.place].filter(Boolean).join(' · ');
    return `<div class="rf-line${this.fresh(p) ? ' new' : ''}" data-post-key="${esc(p.key)}">
        <span class="rf-li" aria-hidden="true">${esc(p.icon)}</span>
        <span class="rf-lt">Started tracking <button class="rf-by" data-trk="${esc(p.tracker)}">${esc(p.tracker_name)}</button>${
          what ? ` <i>— ${esc(what)}</i>` : ''}</span>
        <span class="rf-lw">${esc(hm(p.found))}</span>
      </div>`;
  },

  roundLine(r) {
    const n = r.trackers.length;
    const open = this.openRounds.has(r.key);
    const found = r.found
      ? `<b class="rf-got">${r.found} new ${r.found === 1 ? 'find' : 'finds'}</b>${
        r.found_by.length === 1 ? ` <i>— ${esc(r.found_by[0].name)}</i>` : ''}`
      : '<span>nothing new</span>';
    const list = open ? `<span class="rf-rnames">${r.trackers.map((t) => esc(t.name)).join(' · ')}</span>` : '';
    return `<button class="rf-line rf-round${open ? ' open' : ''}" data-round="${esc(r.key)}" aria-expanded="${open}">
        <span class="rf-li" aria-hidden="true">📡</span>
        <span class="rf-lt">Checked ${n === 1 ? esc(r.trackers[0].name) : `${n} trackers`} · ${found}${list}</span>
        <span class="rf-lw">${esc(hm(r.at))}</span>
      </button>`;
  },

  /* Coming up: the found things still ahead, by their day. */
  soon() {
    const today = dayStart(nowS());
    const ahead = this.posts().filter((p) => p.type === 'found' && !p.hidden && dayOf(p) != null && dayOf(p) >= today)
      .sort((a, b) => dayOf(a) - dayOf(b)).slice(0, SOON_MAX);
    if (!ahead.length) return '<p class="rf-none">Nothing found with a day ahead yet.</p>';
    return ahead.map((p) => {
      const { head } = split(p.summary);
      return `<button class="rf-soonrow" data-goto="${esc(p.key)}">
          ${dateBadge(dayOf(p), true)}
          <span class="rf-st"><b>${esc(head)}</b><i>${esc(until(dayOf(p)))}${p.saved ? ' · ♥' : ''}${p.counted ? ' · 📅' : ''} · ${esc(p.tracker_name)}</i></span>
          ${picture(p, 'rf-spic')}
        </button>`;
    }).join('');
  },

  trackerRow(t) {
    const found = t.found ? `${t.found} found${t.last_found_at ? `, latest ${ago(t.last_found_at)}` : ''}` : 'nothing found yet';
    return `<button class="rf-trow${t.overdue ? ' late' : ''}${this.sheetTrk === t.key ? ' on' : ''}" data-trk="${esc(t.key)}">
        <span class="rf-tt"><b>${esc(t.name)}</b>
          <i>${esc(found)}</i>
          <i class="${t.overdue ? 'rf-late' : t.checking ? 'rf-checking' : ''}">${esc(t.check || t.alarm)}</i></span>
        ${t.paused ? '<span class="rf-tag">Paused</span>' : '<span class="rf-chev" aria-hidden="true">›</span>'}
      </button>`;
  },

  /* ------------------------------------------------------- the sheet -- */

  buildSheet() {
    const el = document.createElement('div');
    el.id = 'rf-sheet';
    // The settings window kit (app.css); the whole width of the wall, for
    // its two columns — what it tracks beside what it has found.
    el.className = 'sheet sheet-full a-radar';
    el.innerHTML = `
      <header>
        <span class="sheet-icon" aria-hidden="true">📡</span>
        <div class="sheet-title"><h2></h2><span class="sheet-status rf-sh-sub"></span></div>
        <span class="spacer"></span>
        <button class="ls-close">Close</button></header>
      <div class="ls-body"></div>`;
    document.body.appendChild(el);
    this.sheet = el;
    el.querySelector('.ls-close').onclick = () => this.closeSheet();
    el.addEventListener('click', (e) => this.click(e));
  },

  openSheet(key) {
    this.sheetTrk = key;
    this.ask = null;
    this.sheet.classList.add('open');
    this.renderSheet();
    this.render();
  },

  closeSheet() {
    if (!this.sheet) return;
    this.sheet.classList.remove('open');
    if (this.sheetTrk) { this.sheetTrk = null; this.render(); }
  },

  renderSheet() {
    const t = this.trackers().find((x) => x.key === this.sheetTrk);
    if (!t) { this.closeSheet(); return; }
    const seq = Number(t.seq) || 0;
    this.sheet.querySelector('h2').textContent = t.name;
    // The kit's header line: what it is and how it stands, its state word in
    // Radar's rose — checking now (live), a check overdue (warn), paused (off).
    const sub = this.sheet.querySelector('.rf-sh-sub');
    const line = [t.kind ? esc(t.kind) : '', t.status ? `<b>${esc(t.status)}</b>` : ''].filter(Boolean).join(' · ');
    const tone = t.paused ? 'off' : t.overdue ? 'warn' : t.checking?.state === 'running' ? 'live' : 'ok';
    if (this.ctx?.sheetkit) this.ctx.sheetkit.status(sub, line, tone);
    else sub.innerHTML = line;
    const b = (action, label, cls = '') => {
      const asking = this.ask && this.ask.key === t.key && this.ask.action === action;
      return `<button class="rf-b${cls}${asking ? ' ask' : ''}" data-tact="${action}" data-seq="${seq}"
        data-key="${esc(t.key)}"${this.busy.has(t.key) ? ' disabled' : ''}>${asking ? 'Tap again to confirm' : label}</button>`;
    };
    const finds = this.posts().filter((p) => p.tracker === t.key && p.type === 'found' && !p.hidden)
      .sort((a, c) => (c.found - a.found) || ((dayOf(a) ?? Infinity) - (dayOf(c) ?? Infinity)));
    this.sheet.querySelector('.ls-body').innerHTML = `
      <div class="rf-sh">
        <div class="rf-sh-about">
          ${t.subject ? `<p><span>Tracking</span>${esc(t.subject)}</p>` : ''}
          ${t.condition ? `<p><span>Found when</span>${esc(t.condition)}</p>` : ''}
          <p><span>Checks</span><b class="${t.overdue ? 'rf-late' : t.checking ? 'rf-checking' : ''}">${esc(t.check)}</b></p>
          <p><span>Next alarm</span>${esc(t.alarm)}</p>
          <p><span>Alerts</span>${esc(MODE_WORDS[t.mode] || '')}${t.phone ? ', and on the phone' : ''}
            — <button class="rf-link" data-gear="1">change on Automation</button></p>
          <p class="rf-meta">${esc([(t.places || []).join(', '), t.who ? `for ${t.who}` : '',
            t.until ? `until ${t.until}` : ''].filter(Boolean).join(' · '))}</p>
          ${seq && !t.paused ? `<div class="rf-tb rf-check"><span class="rf-cl">Check now</span>
            ${this.checkBtn(t, seq, 'claude', 'Claude Code')}${this.checkBtn(t, seq, 'local', 'Local model')}</div>` : ''}
          <div class="rf-tb">
            <button class="rf-b${this.only === t.key ? ' on' : ''}" data-only="${this.only === t.key ? '' : esc(t.key)}">${
              this.only === t.key ? 'Showing only its posts ✕' : 'Only its posts in the feed'}</button>
            ${seq ? (t.paused ? b('resume', 'Resume') : b('pause', 'Pause')) + b('hide', 'Off the wall')
              + b('done', 'Stop tracking', ' rf-end') : ''}
          </div>
          ${this.tnotes[t.key] ? `<p class="rf-note">${esc(this.tnotes[t.key])}</p>` : ''}
        </div>
        <div class="rf-sh-finds">
          <h3>What it has found <span>${finds.length || ''}</span></h3>
          ${finds.length ? `<ul class="rf-items">${finds.map((p) => {
            const d = dayOf(p);
            return `<li class="rf-item${p.past ? ' past' : ''}">
              ${d != null ? dateBadge(d, true) : '<span class="rf-cal sm none" aria-hidden="true"></span>'}
              <div class="rf-it"><b>${esc(p.summary)}</b><span class="rf-facts">${this.facts(p)}<span>found ${esc(ago(p.found))}</span></span></div>
              <div class="rf-iacts">${this.acts(p, true)}</div></li>`;
          }).join('')}</ul>` : '<p class="rf-none">Nothing yet in the last 30 days.</p>'}
        </div>
      </div>`;
  },

  /* Check now with one of TunaRadar's agents: on while that agent has the
     check, off for all while one is running. */
  checkBtn(t, seq, agent, label) {
    const c = t.checking;
    const mine = c && c.agent === agent;
    const busy = this.busy.has(t.key) || (c && c.state === 'running') ? ' disabled' : '';
    return `<button class="rf-b${mine ? ' on' : ''}" data-check="${agent}" data-seq="${seq}"
      data-key="${esc(t.key)}"${busy}>${mine && c.state === 'running' ? `Checking… (${label})` : label}</button>`;
  },

  /* ------------------------------------------------------------- taps -- */

  click(e) {
    const f = e.target.closest('button[data-filter]');
    if (f) { this.filter = f.dataset.filter; this.render(); this.scheduleRead(); return; }
    const only = e.target.closest('button[data-only]');
    if (only) {
      this.only = only.dataset.only || null;
      this.filter = 'all';
      this.closeSheet();
      this.render();
      this.body.querySelector('.rf-list').scrollTop = 0;
      this.scheduleRead();
      return;
    }
    if (e.target.closest('button[data-gear]')) { this.closeSheet(); this.ctx.goAutomation?.('radar'); return; }
    const ck = e.target.closest('button[data-check]');
    if (ck) { this.checkNow(ck.dataset.key, Number(ck.dataset.seq), ck.dataset.check); return; }
    const ta = e.target.closest('button[data-tact]');
    if (ta) { this.trackerAct(ta.dataset.key, Number(ta.dataset.seq), ta.dataset.tact); return; }
    const tr = e.target.closest('button[data-trk]');
    if (tr) { this.openSheet(tr.dataset.trk); return; }
    const rd = e.target.closest('button[data-round]');
    if (rd) {
      if (this.openRounds.has(rd.dataset.round)) this.openRounds.delete(rd.dataset.round);
      else this.openRounds.add(rd.dataset.round);
      this.render();
      return;
    }
    const go = e.target.closest('button[data-goto]');
    if (go) { this.goto(go.dataset.goto); return; }
    const o = e.target.closest('button[data-open]');
    if (o) { this.openPost(o.dataset.open); return; }
    const b = e.target.closest('button[data-post]');
    if (b) this.postAct(b.dataset.key, b.dataset.post);
  },

  /* Coming up's row: the feed scrolled to its find, which lights a moment. */
  goto(key) {
    const p = this.posts().find((x) => x.key === key);
    if (!p) return;
    if (!this.visible().some((x) => x.key === key)) {
      this.filter = p.past ? 'past' : 'all';
      this.only = null;
      this.render();
    }
    const el = this.body.querySelector(`[data-post-key="${CSS.escape(key)}"]`);
    if (!el) return;
    el.scrollIntoView({ block: 'center', behavior: 'smooth' });
    el.classList.remove('flash');
    void el.offsetWidth;
    el.classList.add('flash');
  },

  async postAct(key, what) {
    const k = encodeURIComponent(key);
    const route = {
      save: ['POST', `/api/radar/post/${k}/save`],
      unsave: ['DELETE', `/api/radar/post/${k}/save`],
      hide: ['POST', `/api/radar/post/${k}/hide`],
      unhide: ['DELETE', `/api/radar/post/${k}/hide`],
      countdown: ['POST', `/api/radar/post/${k}/countdown`],
    }[what];
    if (!route) return;
    this.busy.add(key);
    this.render();
    const { ok, ans } = await this.send(...route);
    this.busy.delete(key);
    if (!ok) this.notes[key] = ans?.error || 'The kitchen could not do that just now.';
    else if (what === 'hide') {
      this.notes[key] = ans?.told ? 'Hidden. TunaRadar was told: its next check sends nothing like it.'
        : `Hidden here; TunaRadar could not be told (${ans?.why || 'no answer'}).`;
    } else if (what === 'unhide') this.notes[key] = '';
    else if (what === 'countdown') this.notes[key] = ans?.added ? 'Added to the countdown.' : 'Already in the countdown.';
    this.render();
  },

  async trackerAct(key, seq, action) {
    if (!seq) return;
    if ((action === 'done' || action === 'hide')
        && !(this.ask && this.ask.key === key && this.ask.action === action)) {
      this.ask = { key, action };
      clearTimeout(this.askTimer);
      this.askTimer = setTimeout(() => { this.ask = null; this.render(); }, ASK_MS);
      this.render();
      return;
    }
    this.ask = null;
    this.busy.add(key);
    this.render();
    try {
      const r = await fetch(`/api/attention/tracker/${seq}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action }),
      });
      if (r.ok) this.ctx.attention?.paint(await r.json());
    } catch { /* the next snapshot puts it right */ }
    this.busy.delete(key);
    this.render();
  },

  /* Check now: the kitchen asks TunaRadar for a check by `agent` ("claude" or
     "local"); the server follows it every half minute until it has run. */
  async checkNow(key, seq, agent) {
    if (!seq) return;
    this.busy.add(key);
    this.tnotes[key] = '';
    this.render();
    let r = null;
    let ans = null;
    try {
      r = await fetch(`/api/attention/tracker/${seq}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'check', agent }),
      });
      ans = await r.json().catch(() => null);
    } catch { /* said below */ }
    this.busy.delete(key);
    const who = agent === 'claude' ? 'Claude Code' : 'the local model';
    if (r?.ok && ans) {
      this.ctx.attention?.paint(ans);
      const c = ans.check;
      if (c?.state === 'running') {
        this.tnotes[key] = `A check is already running with ${c.agent === 'claude' ? 'Claude Code' : 'the local model'}.`;
      } else if (agent === 'local' && ans.worker_seen === false) {
        this.tnotes[key] = 'Asked the local model, but AI\'s worker has not been heard from for 20 minutes: '
          + 'the check starts when AI is back (in Ubuntu).';
      } else {
        this.tnotes[key] = `Asked ${who}: the check starts within a minute or so, and this sheet follows it.`;
      }
    } else {
      this.tnotes[key] = ans?.error || 'The kitchen could not ask TunaRadar just now.';
    }
    this.render();
  },

  /* Open: the found page, as Needs attention opens one. */
  openPost(key) {
    this.ctx.attention?.openLink(key);
  },

  /* For Needs attention's Open: a post's key → {key, url, title}. */
  post(key) {
    const p = this.posts().find((x) => x.key === key);
    return p && p.url ? { key, url: p.url, title: p.summary } : null;
  },
};

/* For scripts/radar-view-test.mjs. */
export { split, common, until, dayLabel, onDay };
