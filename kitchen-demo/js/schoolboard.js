/* The school board: what the weekly letters say the family needs to know,
   under the countdown over a picture, where the twelve hours of weather were.

   Alex's ask (2026-10-02): the kitchen agent reads the school's weekly
   letter, and anything the family needs to know for the coming days, weeks
   or year goes on the wall. Swimming means swimwear, PE means PE clothes, and
   every item to pack is listed. The agent writes it (backend/app/schoolboard.py);
   this file only reads.

   The same evening, two more asks. **A tap on one thing on the board tells
   the whole of it on the same screen**: a panel on the right, over the
   photograph or the bird box, with an ✕, never a new screen. The panel names
   the Veckobrev it was taken from, and the letter itself opens from there, so
   parents can check it against the original. **And all of it in Swedish**,
   the letters' own language: the board, the panel and what the agent writes.
   The rest of the wall stays as it was.

   Since 2026-10-20 it is "Skola & träning" (Alex: "School and Trainings"):
   the emails from Mia's clubs go on it too, each piece with its
   `activity` ("Shorinji Kempo"), which the panel names where the school's
   say "Skolan". A club's day never changes the school day (schooldays.js),
   and one inside a break stands under the break's line.

   Two keys on the bus. `school_board` carries the week, the board-only items,
   the notices and the letters. `countdown` carries the school's events too,
   each with its `school` object: the family may have edited those there, and
   the board shows them as they are. The days themselves are worked out in
   schooldays.js, which has no DOM and is what scripts/schoolboard-test.mjs
   pins.

   The column is the one app.js moves between Photos and Birds (`.wxcol`).
   With no board (no letter read yet, or a server older than this) it keeps
   the hours of weather; see paintSide() in app.js. This is ctx.schoolBoard. */
const sd = await import(`./schooldays.js${new URL(import.meta.url).search}`);

const esc = (s) => String(s ?? '').replace(/[&<>"]/g,
  (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

/* What a day-off line opens: the item behind it, or — a röd dag, which has
   none — the day itself (redHtml). */
const offRef = (p) => (p.key ? `item:${p.key}` : `red:${p.from}`);

/* A school bag: what goes in it is the line it stands in front of. */
const BAG = '<svg class="sb-bag" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor"'
  + ' stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round">'
  + '<path d="M9 6.5V5a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v1.5"/>'
  + '<rect x="4.5" y="6.5" width="15" height="14.5" rx="4"/><path d="M8.5 13.5h7v3.5h-7z"/></svg>';

/* The panel and an open letter close themselves after this long untouched.
   Either one left open would sit on the photographs until somebody noticed,
   and an open letter would keep the night's clock off the wall. */
const IDLE_CLOSE_MS = 10 * 60 * 1000;

const WEEKDAY = { mon: 'måndag', tue: 'tisdag', wed: 'onsdag', thu: 'torsdag', fri: 'fredag',
  sat: 'lördag', sun: 'söndag' };

/* "08:00–13:45", the part that differs from the usual day in the board's
   colour; "ingen skola" on a day off. */
function times(p) {
  if (p.kind === 'off') return '<span class="sb-off">ingen skola</span>';
  if (!p.start) return '';
  const t = (v, chg) => (chg ? `<b class="sb-chg">${esc(v)}</b>` : esc(v));
  return `${t(p.start, p.startChanged)}–${t(p.end, p.endChanged)}`;
}

/* "kl. 17.00–18.00", an event's own time, written as the letter writes it. */
const at = (t) => (t ? ` kl. ${esc(t.replace(/^kl\.?\s*/i, ''))}` : '');

/* The day's events in one line: "Föräldramöte kl. 17.00–18.00 · …". */
function eventLine(p) {
  if (!p.events?.length) return '';
  const e = p.events[0];
  const more = p.events.length > 1 ? ` +${p.events.length - 1}` : '';
  return `<b>${esc(e.title)}</b>${at(e.time)}${e.note ? ` · ${esc(e.note)}` : ''}${more}`;
}

const bringLine = (list, cls = 'sb-pbring') => (list?.length
  ? `<div class="${cls}">${BAG}<span>${list.map(esc).join(' · ')}</span></div>` : '');

export default {
  board: null,        // the school_board document; null before it arrives, or with none
  events: [],         // the countdown's events (the school's carry `school`)
  colEl: null,
  listeners: [],
  ref: null,          // what the panel on the right shows, or null when it is shut
  trail: [],          // where it came from, for ‹ Tillbaka
  lastTouch: 0,

  init(ctx) {
    this.ctx = ctx;
    if (!this.panelEl) this.buildPanel();
    this.buildDoc();
    ctx.bus.on('school_board', (doc) => {
      this.board = doc && typeof doc === 'object' ? doc : null;
      this.changed();
    });
    ctx.bus.on('countdown', (events) => {
      this.events = Array.isArray(events) ? events : [];
      this.changed();
    });
    // The end of the school day and midnight both move what the board shows,
    // with nothing at all arriving on the bus.
    setInterval(() => { this.changed(); this.idleClose(); }, 60 * 1000);
    addEventListener('pointerdown', () => { this.lastTouch = Date.now(); },
      { capture: true, passive: true });
  },

  /* app.js is told when there comes to be a board, or stops being one, so
     the column can swap the hours for it (or back). */
  onChange(fn) { this.listeners.push(fn); },

  changed() {
    for (const fn of this.listeners) {
      try { fn(); } catch (e) { console.error('school board listener failed', e); }
    }
    this.paint();
    if (this.ref) this.renderPanel();
  },

  items() { return sd.datedItems(this.board, this.events); },

  has() { return sd.hasContent(this.board, this.items(), new Date()); },

  letter(id) { return (this.board?.letters || []).find((l) => l.id === id) || null; },

  /* Handed the column to paint, or null when the panel closes. The same
     contract as weather.column(). The panel on the right goes where the
     column goes, into the same picture, and shuts with it. */
  column(el) {
    if (!this.panelEl) this.buildPanel();
    this.colEl = el || null;
    /* Fitted again whenever the column changes height. It stands under the
       countdown, and placeHours() moves its top as the chips, the bird box,
       Needs attention and the clock's webfont arrive, each at its own pace;
       a board fitted once, at the first of those, is cut at the wrong place. */
    this.ro ||= new ResizeObserver(() => this.paint());
    this.ro.disconnect();
    if (el) {
      this.ro.observe(el);
      el.parentNode?.appendChild(this.panelEl);
    } else {
      this.close();
      this.panelEl.remove();
    }
    this.paint();
  },

  /* -------------------------------------------------------------- board -- */

  paint() {
    const el = this.colEl;
    if (!el) return;
    const now = new Date();
    const items = this.items();
    // The days with something to say in the next week and a bit: the first,
    // then only the ones that differ from an ordinary day (schooldays.js).
    const days = sd.upcoming(this.board, items, now, { count: 5, horizon: 9, skipPlain: true });
    const notices = sd.activeNotices(this.board, now);
    const letter = sd.lastLetter(this.board, now);
    const last = days[days.length - 1];
    const later = sd.later(items, last ? (last.to || last.iso) : sd.isoDay(now), now, { days: 14 });
    const who = this.board?.about?.child || '';

    /* Every block says what a tap on it shows (data-ref). `data-p` is the
       order blocks used to be dropped in when the column was short; since
       2026-10-13 nothing is dropped and the card scrolls (fit()), and the
       numbers are only a record of what matters most. */
    const blocks = [];
    /* A line where the days cross into a later week — "Nästa vecka · v. 43" —
       worked out from today, so it moves on by itself: on Monday the days
       under it are this week's and it is gone. */
    let week = 0;
    days.forEach((p, i) => {
      const ahead = sd.weeksAhead(p.iso || p.from, now);
      if (ahead > week && ahead > 0) {
        week = ahead;
        const no = sd.weekNo(p.iso || p.from);
        blocks.push(`<div class="sb-week">${ahead === 1 ? 'Nästa vecka' : `Om ${ahead} veckor`} · v. ${no}</div>`);
      }
      const lines = [`<div class="sb-dl"><span class="sb-when">${esc(p.label)}</span>`
        + `<span class="sb-time">${times(p)}</span></div>`];
      if (p.kind === 'off') {
        lines.push(`<div class="sb-ev" data-p="${i === 0 ? 40 : 0}"><b>${esc(p.title)}</b>${
          p.note ? ` · ${esc(p.note)}` : ''}</div>`);
      } else {
        if (p.bring.length) {
          lines.push(`<div class="sb-bring">${BAG}<span>${p.bring.map(esc).join(' · ')}</span></div>`);
        }
        const ev = eventLine(p);
        if (ev) lines.push(`<div class="sb-ev" data-p="${i === 0 ? 40 : 0}">${ev}</div>`);
        if (i === 0 && p.weekNote) lines.push(`<div class="sb-note" data-p="45">${esc(p.weekNote)}</div>`);
      }
      const p0 = i === 0 ? 0 : i === 1 ? 30 : i === 2 ? 60 : 80 + i;
      const ref = p.kind === 'off' ? offRef(p) : `day:${p.iso}`;
      blocks.push(`<div class="sb-day sb-hit${p.kind === 'off' ? ' is-off' : ''}" data-ref="${esc(ref)}"${
        p0 ? ` data-p="${p0}"` : ''}>${lines.join('')}</div>`);
    });
    notices.forEach((n, i) => {
      blocks.push(`<div class="sb-notice sb-hit" data-ref="notice:${esc(n.key)}" data-p="${
        i === 0 ? 50 : 70 + i}"><span class="sb-bang">!</span><span>${esc(n.text)}</span>`
        + `<button class="sb-check" data-done="${esc(n.key)}" aria-label="Klart: ${esc(n.text)}" `
        + 'title="Klart — ta bort från listan"></button></div>');
    });
    later.forEach((it, i) => {
      blocks.push(`<div class="sb-later sb-hit" data-ref="item:${esc(it.key)}" data-p="${90 + i}"><span>${esc(
        it.end ? sd.spanLabel(it.date, it.end, now) : sd.shortDay(it.date))}</span> ${esc(it.title)}</div>`);
    });

    // A repaint (the bus, the minute) keeps where somebody had scrolled to.
    const was = el.querySelector('.sb-card')?.scrollTop || 0;
    el.innerHTML = `
      <div class="sb-card" role="button" tabindex="0" aria-label="Skola och träning: visa allt">
        <div class="sb-head sb-hit" data-ref="overview">
          <span class="sb-kicker">Skola &amp; träning${who ? ` · ${esc(who)}` : ''}</span>
          ${letter ? `<span class="sb-letter${letter.stale ? ' stale' : ''}">${
            letter.stale ? 'senaste veckobrev' : 'veckobrev'} v. ${esc(letter.week || '?')}</span>` : ''}
        </div>
        ${blocks.join('')}
      </div>`;
    const card = el.querySelector('.sb-card');
    // One thing tapped is that thing on the right; the header, or anywhere
    // between the lines, is all of it.
    card.onclick = (e) => {
      e.stopPropagation();
      // ✓ on a notice (2026-10-13): done, off the list — not "show it".
      const tick = e.target.closest('[data-done]');
      if (tick) { this.setDone(tick.dataset.done, true, tick); return; }
      const hit = e.target.closest('[data-ref]');
      this.show(hit ? hit.dataset.ref : 'overview', { fresh: true });
    };
    card.scrollTop = was;
    this.fit(card);
    this.mark();
  },

  /* Everything stays, and the card scrolls (2026-10-13, Alex: "in different
     screens and resolutions all of this table is not visible … make it
     scrollable so all the items would not be missed"). Until then blocks were
     taken away, the least needed first, until the card fitted — which on a
     smaller screen hid notices and later days without a word. A fade at the
     foot says there is more while there is. */
  fit(card) {
    const edge = () => card.classList.toggle('sb-more',
      card.scrollTop + card.clientHeight < card.scrollHeight - 2);
    edge();
    card.onscroll = edge;
  },

  /* The line the panel is showing is lit on the board, so the two read as
     one thing: this, told in full over there. */
  mark() {
    if (!this.colEl) return;
    for (const n of this.colEl.querySelectorAll('[data-ref]')) {
      n.classList.toggle('on', !!this.ref && n.dataset.ref === this.ref);
    }
  },

  /* ------------------------------------------------- the panel on the right -- */

  buildPanel() {
    const el = document.createElement('aside');
    el.className = 'sb-panel';
    el.hidden = true;
    el.innerHTML = '<button class="sb-x" aria-label="Stäng">✕</button><div class="sb-pbody"></div>';
    el.querySelector('.sb-x').onclick = (e) => { e.stopPropagation(); this.close(); };
    // Nothing in here is the photograph's: a tap must not reach the show
    // underneath and bring up its pause button.
    el.addEventListener('click', (e) => {
      e.stopPropagation();
      const back = e.target.closest('.sb-back');
      if (back) { this.back(); return; }
      const doc = e.target.closest('[data-letter]');
      if (doc) { this.openLetter(doc.dataset.letter); return; }
      const tick = e.target.closest('[data-done], [data-undone]');
      if (tick) {
        this.lastTouch = Date.now();
        if (tick.dataset.done) this.setDone(tick.dataset.done, true, tick);
        else this.setDone(tick.dataset.undone, false, tick);
        return;
      }
      const hit = e.target.closest('[data-ref]');
      if (hit) this.show(hit.dataset.ref);
    });
    this.panelEl = el;
  },

  /* A notice ticked off, or put back. The board comes back on the bus too;
     the answer is taken at once so the line goes under the finger. */
  async setDone(key, done, btn) {
    if (btn) btn.disabled = true;
    try {
      const r = await fetch(`/api/school-board/notices/${encodeURIComponent(key)}/done`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ done }),
      });
      if (r.ok) {
        const b = await r.json();
        if (b && typeof b === 'object') {
          this.board = { ...this.board, ...b };
          this.paint();
          if (this.ref) this.renderPanel();
        }
        return;
      }
    } catch { /* the bus puts it right */ }
    if (btn) btn.disabled = false;
  },

  show(ref, { fresh = false } = {}) {
    if (fresh) this.trail = [];
    else if (this.ref && this.ref !== ref) this.trail.push(this.ref);
    this.ref = ref;
    this.lastTouch = Date.now();
    this.renderPanel();
    this.panelEl.hidden = false;
    this.panelEl.querySelector('.sb-pbody').scrollTop = 0;
    this.mark();
  },

  back() {
    this.ref = this.trail.pop() || 'overview';
    this.renderPanel();
    this.mark();
  },

  close() {
    this.ref = null;
    this.trail = [];
    if (this.panelEl) this.panelEl.hidden = true;
    this.mark();
  },

  idleClose() {
    if (Date.now() - this.lastTouch < IDLE_CLOSE_MS) return;
    if (this.ref) this.close();
    if (this.docOpen()) this.closeDoc();
  },

  renderPanel() {
    const body = this.panelEl?.querySelector('.sb-pbody');
    if (!body || !this.ref) return;
    const now = new Date();
    const [kind, key] = this.ref.split(/:(.*)/s);
    let html = null;
    if (kind === 'overview') html = this.overviewHtml(now);
    else if (kind === 'day') html = this.dayHtml(key, now);
    else if (kind === 'item') html = this.itemHtml(key, now);
    else if (kind === 'red') html = this.redHtml(key);
    else if (kind === 'notice') html = this.noticeHtml(key);
    else if (kind === 'week') html = this.weekHtml(key);
    body.innerHTML = (this.trail.length ? '<button class="sb-back">‹ Tillbaka</button>' : '')
      + (html ?? '<p class="sb-none">Det här finns inte längre på tavlan: ett senare brev '
        + 'har tagit bort det, eller så är det över.</p>');
  },

  /* "Källa": the letters it came from, the newest first, each a button that
     opens the letter itself. A letter whose file the agent did not put on the
     kitchen's server is named but cannot be opened. */
  sources(ids) {
    const list = sd.newestFirst(ids, this.board).slice(0, 4);
    if (!list.length) return '';
    return `<div class="sb-src"><div class="sb-srclabel">Källa</div>${list.map((id) => {
      const l = this.letter(id);
      const name = l?.title || `Veckobrev ${id}`;
      const when = l?.date ? sd.shortDay(l.date) : '';
      return l?.file
        ? `<button class="sb-letterbtn" data-letter="${esc(id)}"><span>${esc(name)}</span>`
          + `<small>${esc(when)}</small><i aria-hidden="true">↗</i></button>`
        : `<div class="sb-letterbtn nofile"><span>${esc(name)}</span><small>${
          esc(when)}${when ? ' · ' : ''}filen finns inte här</small></div>`;
    }).join('')}</div>`;
  },

  /* A röd dag (schooldays.redDay, 2026-10-14): no letter's item behind it —
     it is the law's — so its own few words, and the morning alert's silence. */
  redHtml(iso) {
    const name = sd.redDay(iso);
    if (!name) return null;
    return this.head('Ingen skola', name, esc(sd.longDay(iso)))
      + '<p class="sb-pchg">Röd dag: en allmän helgdag, ingen skola. Skolalarmet på väggen är tyst.</p>';
  },

  head(kicker, title, sub = '') {
    return `<div class="sb-pk">${esc(kicker)}</div><h3 class="sb-ph">${esc(title)}</h3>${
      sub ? `<div class="sb-psub">${sub}</div>` : ''}`;
  },

  /* What the letters say about one school day: its times and what goes in
     the bag, then where each part comes from, the regular week and every
     event on the day, each with its letters. */
  dayHtml(iso, now) {
    if (!sd.fromIso(iso)) return null;
    const p = sd.dayPlan(this.board, this.items(), iso);
    if (!p.school && !p.events.length && !p.off) return null;
    // "Idag" and "Imorgon" say something the date does not; a weekday's name
    // would only say the title twice.
    const label = sd.label(iso, now);
    // A day with only a club on it (a Saturday's training, one in Höstlov)
    // is that club's day, not a school day.
    const clubs = [...new Set(p.events.map((e) => e.activity).filter(Boolean))];
    const kicker = label === 'Idag' || label === 'Imorgon' ? label
      : p.school ? 'Skoldag' : clubs.length === 1 && p.events.every((e) => e.activity) ? clubs[0] : 'Dag';
    const u = sd.usual(this.board);
    const changes = [];
    // Wednesday's 08:00 is every Wednesday's, and says so; a time a letter
    // moved for one day says what it is instead of.
    if (p.base && p.start !== p.base.start) {
      changes.push(`Börjar ${esc(p.start)} i stället för ${esc(p.base.start)}.`);
    } else if (p.startChanged) {
      changes.push(`Börjar ${esc(p.start)}, de andra dagarna ${esc(u.start)}.`);
    }
    if (p.endChanged && p.base) changes.push(`Slutar ${esc(p.end)} i stället för ${esc(p.base.end)}.`);
    if (p.off) changes.push(`Ingen skola: ${esc(p.offTitle)}.`);
    if (p.insteadOf) {
      const b = p.insteadOf;
      changes.push(`Inte en vanlig ${esc(WEEKDAY[b.day])} (${esc(b.start)}–${esc(b.end)}${
        b.bring?.length ? `, ${esc(b.bring.join(', ').toLowerCase())}` : ''}).`);
    }
    let html = this.head(kicker, sd.longDay(iso),
      p.school ? `<span class="sb-ptime">${times({ ...p, kind: 'day' })}</span>` : '');
    if (changes.length) html += `<p class="sb-pchg">${changes.join(' ')}</p>`;
    html += bringLine(p.bring, 'sb-pbring big');
    if (p.base && !p.insteadOf) {
      html += `<section class="sb-psec"><h4>Varje ${esc(WEEKDAY[p.base.day])}</h4>`
        + `<div class="sb-ptime small">${esc(p.base.start)}–${esc(p.base.end)}</div>`
        + (p.base.note ? `<p class="sb-pnote">${esc(p.base.note)}</p>` : '')
        + bringLine(p.base.bring)
        + this.sources(p.base.letters) + '</section>';
    }
    for (const e of p.events) html += this.eventSection(e, now);
    return html;
  },

  eventSection(e, now) {
    const tags = [];
    if (e.activity) tags.push(esc(e.activity));
    if (e.calendar) {
      tags.push(e.cdDate && e.cdDate !== e.date
        ? `i nedräkningen, till ${esc(sd.shortDay(e.cdDate))}` : 'i nedräkningen');
    }
    const span = e.end ? ` <small>${esc(sd.spanLabel(e.date, e.end, now))}</small>` : '';
    const when = [e.time && `kl. ${esc(e.time.replace(/^kl\.?\s*/i, ''))}`,
      e.start && `skolan börjar ${esc(e.start)}`, e.finish && `slutar ca ${esc(e.finish)}`]
      .filter(Boolean).join(', ');
    return `<section class="sb-psec"><h4>${esc(e.title)}${span}${
      tags.length ? ` <span class="sb-tag">${tags.join(' · ')}</span>` : ''}</h4>`
      + (when ? `<div class="sb-ptime small">${when}</div>` : '')
      + (e.note ? `<p class="sb-pnote">${esc(e.note)}</p>` : '')
      + (e.info ? `<p class="sb-pinfo">${esc(e.info)}</p>` : '')
      + bringLine(e.bring)
      + this.sources(e.letters) + '</section>';
  },

  itemHtml(key, now) {
    const it = this.items().find((i) => i.key === key);
    if (!it) return null;
    const when = it.end
      ? `${sd.longDay(it.date)} – ${sd.longDay(it.end).toLowerCase()}` : sd.longDay(it.date);
    const kicker = it.activity || (it.off ? 'Ingen skola' : it.calendar ? 'I nedräkningen' : 'Skolan');
    const sub = [
      it.activity && it.calendar ? 'I nedräkningen.' : '',
      it.calendar && it.cdDate && it.cdDate !== it.date
        ? `Nedräkningen räknar till ${esc(sd.shortDay(it.cdDate))}.` : '',
      it.start ? `Skolan börjar ${esc(it.start)}.` : '',
      it.finish ? `Slutar ca ${esc(it.finish)}.` : '',
      it.instead ? 'I stället för en vanlig skoldag.' : '',
    ].filter(Boolean).join(' ');
    return this.head(kicker, it.title, `${esc(when)}${at(it.time)}`)
      + (sub ? `<p class="sb-pchg">${sub}</p>` : '')
      + (it.note ? `<p class="sb-pnote big">${esc(it.note)}</p>` : '')
      + (it.info ? `<p class="sb-pinfo">${esc(it.info)}</p>` : '')
      + bringLine(it.bring, 'sb-pbring big')
      + this.sources(it.letters);
  },

  noticeHtml(key) {
    const n = (this.board?.notices || []).find((x) => x.key === key);
    if (!n) return null;
    const when = [n.from && `från ${esc(sd.shortDay(n.from))}`,
      n.until && `till och med ${esc(sd.shortDay(n.until))}`].filter(Boolean).join(' ');
    return this.head(n.activity || 'Att veta', n.text, when ? `Gäller ${when}` : '')
      + (n.done
        ? `<p class="sb-pdone">Avbockad ${esc(sd.shortDay(String(n.done).slice(0, 10)))} — syns inte på tavlan.
            <button class="sb-undo" data-undone="${esc(n.key)}">Ångra</button></p>`
        : `<p class="sb-pdone"><button class="sb-donebtn" data-done="${esc(n.key)}">Klart ✓</button>
            tar bort den från tavlan</p>`)
      + (n.info ? `<p class="sb-pinfo">${esc(n.info)}</p>` : '')
      + bringLine(n.bring, 'sb-pbring big')
      + this.sources(n.letters?.length ? n.letters : n.letter ? [n.letter] : []);
  },

  weekHtml(day) {
    const w = this.board?.week?.[day];
    if (!w || !WEEKDAY[day]) return null;
    return this.head('Varje vecka', `Varje ${WEEKDAY[day]}`,
      `<span class="sb-ptime">${esc(w.start)}–${esc(w.end)}</span>`)
      + (w.note ? `<p class="sb-pnote big">${esc(w.note)}</p>` : '')
      + bringLine(w.bring, 'sb-pbring big')
      + this.sources(w.letters);
  },

  /* All of it: the header's tap. The same panel, so the board beside it
     stays where it is, and every line in here opens its own detail with a
     way back. */
  overviewHtml(now) {
    const b = this.board || {};
    const about = b.about || {};
    const items = this.items();
    const days = sd.upcoming(b, items, now, { count: 10, horizon: 42 });
    const last = days[days.length - 1];
    const shownTo = last ? (last.to || last.iso) : sd.isoDay(now);
    const later = items.filter((i) => (i.end || i.date) > shownTo);
    const notices = sd.activeNotices(b, now);
    const done = sd.doneNotices(b, now);
    const letters = (b.letters || []).slice().reverse();
    const row = (ref, left, right, under = '') => `<div class="sb-orow" data-ref="${esc(ref)}">`
      + `<span class="sb-oleft">${left}</span><span class="sb-oright">${right}</span>${
        under ? `<span class="sb-ounder">${under}</span>` : ''}</div>`;
    const section = (title, rows, empty) => `<section class="sb-osec"><h4>${title}</h4>${
      rows || `<p class="sb-none">${empty}</p>`}</section>`;

    const dayRows = days.map((p) => (p.kind === 'off'
      ? row(offRef(p), esc(p.label), `<span class="sb-off">ingen skola</span>`, `<b>${esc(p.title)}</b>`)
      : row(`day:${p.iso}`, `${esc(p.label)}${/\d/.test(p.label) ? '' : ` <small>${esc(sd.dayMonth(p.iso))}</small>`}`,
        times(p), [p.bring.length ? `${BAG}${p.bring.map(esc).join(' · ')}` : '',
          p.events.map((e) => `<b>${esc(e.title)}</b>${at(e.time)}`).join(' · ')].filter(Boolean).join(' · ')))).join('');
    const noticeRows = notices.map((n) => row(`notice:${n.key}`, `<span class="sb-bang">!</span>${esc(n.text)}`,
      n.until ? `t.o.m. ${esc(sd.dayMonth(n.until))}` : '')).join('');
    const laterRows = later.map((i) => row(`item:${i.key}`,
      esc(i.end ? sd.spanLabel(i.date, i.end, now) : sd.shortDay(i.date)),
      i.calendar ? '<small>i nedräkningen</small>' : '',
      `<b>${esc(i.title)}</b>${at(i.time)}${i.off ? ' · ingen skola' : ''}`)).join('');
    const weekRows = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'].filter((d) => b.week?.[d]).map((d) => {
      const w = b.week[d];
      const u = sd.usual(b);
      return row(`week:${d}`, `Varje ${WEEKDAY[d]}`,
        `${w.start !== u.start ? `<b class="sb-chg">${esc(w.start)}</b>` : esc(w.start)}–${esc(w.end)}`,
        w.bring?.length ? `${BAG}${w.bring.map(esc).join(' · ')}` : '');
    }).join('');
    const letterRows = letters.map((l) => `<div class="sb-orow">${l.file
      ? `<button class="sb-letterbtn" data-letter="${esc(l.id)}"><span>${esc(l.title)}</span>`
        + `<small>${esc(l.date ? sd.shortDay(l.date) : '')}</small><i aria-hidden="true">↗</i></button>`
      : `<div class="sb-letterbtn nofile"><span>${esc(l.title)}</span><small>filen finns inte här</small></div>`}${
      l.summary ? `<span class="sb-ounder">${esc(l.summary)}</span>` : ''}</div>`).join('');

    return this.head('Skola & träning',
      [about.child, about.class, about.school].filter(Boolean).join(' · ') || 'Skola & träning')
      + section('Kommande dagar', dayRows, 'Inget de närmaste sex veckorna.')
      + (noticeRows ? section('Att veta', noticeRows, '') : '')
      + (done.length ? section('Klart', done.map((n) => `<div class="sb-orow sb-odone">`
        + `<span class="sb-oleft">✓ ${esc(n.text)}</span><span class="sb-oright">`
        + `<button class="sb-undo" data-undone="${esc(n.key)}">Ångra</button></span></div>`).join(''), '') : '')
      + section('Senare under läsåret', laterRows, 'Inget längre fram ännu.')
      + section('Varje vecka', weekRows, 'Inget veckoschema från ett veckobrev ännu.')
      + section('Brev', letterRows, 'Inget brev läst ännu.')
      + '<p class="sb-hint">Köksagenten skriver allt det här från skolans veckobrev och från '
      + 'träningarnas mejl: ge den nästa brev (pdf:en, en skärmbild eller texten) så ändras det. En '
      + 'händelse i nedräkningen kan du ändra eller ta bort där, som alla andra; nästa brev låter din '
      + 'ändring vara.</p>';
  },

  /* ------------------------------------------------------ the letter itself -- */

  /* "When pressed it will open in a new window the clicked Veckobrev file."
     Everywhere but on the wall, it does. The wall has no keyboard and no
     window to go back to: a second window there would stay over the kitchen
     until somebody found its close button, and the wall would sleep and wake
     with the PDF still on it. So on the wall the letter opens over the whole
     screen, with Stäng, and shuts itself when it is left alone. Which screen
     is the wall, only the server knows (night.js, `wall`); without night.js
     the page takes itself to be the wall, the side that cannot go wrong. */
  onWall() {
    const n = this.ctx?.night;
    return n ? n.onWall() : true;
  },

  openLetter(id) {
    const l = this.letter(id);
    if (!l?.file) return;
    const url = `/api/school-board/letters/${encodeURIComponent(id)}/file`;
    if (!this.onWall()) {
      window.open(url, '_blank', 'noopener');
      return;
    }
    this.openDoc(l, url);
  },

  buildDoc() {
    const el = document.createElement('div');
    el.id = 'sb-doc';
    el.className = 'sheet a-school';   // the settings window kit (app.css), in the school's lemon
    el.innerHTML = `
      <header>
        <span class="sheet-icon" aria-hidden="true">✉️</span>
        <div class="sheet-title">
          <h2></h2>
          <span class="sheet-status sb-doc-sub"></span>
        </div>
        <span class="spacer"></span>
        <button class="ls-close">Stäng</button>
      </header>
      <div class="sb-doc-body"></div>`;
    document.body.appendChild(el);
    el.querySelector('.ls-close').onclick = () => this.closeDoc();
    this.docEl = el;
  },

  /* `family`: a family event's paper (countdown.js, 2026-11-05) in the same
     window, in the house's green and English rather than the school's. */
  openDoc(l, url, { family = false } = {}) {
    const el = this.docEl;
    el.classList.toggle('a-school', !family);
    el.querySelector('.sheet-icon').textContent = family ? '📄' : '✉️';
    el.querySelector('.ls-close').textContent = family ? 'Close' : 'Stäng';
    el.querySelector('h2').textContent = l.title || `Veckobrev ${l.id}`;
    const sub = el.querySelector('.sb-doc-sub');
    const day = l.date ? `<b>${esc(sd.longDay(l.date))}</b>` : '';
    if (this.ctx?.sheetkit) this.ctx.sheetkit.status(sub, day); else sub.innerHTML = day;
    const body = el.querySelector('.sb-doc-body');
    const ext = l.file?.ext;
    if (ext === 'pdf') {
      // Chrome's own PDF viewer, fitted to the width, with its page controls.
      body.innerHTML = `<iframe title="${esc(l.title)}" src="${esc(url)}#view=FitH"></iframe>`;
    } else if (ext === 'png' || ext === 'jpg') {
      body.innerHTML = `<div class="sb-doc-img"><img alt="${esc(l.title)}" src="${esc(url)}"></div>`;
    } else {
      body.innerHTML = '<pre class="sb-doc-text">…</pre>';
      fetch(url, { cache: 'no-store' }).then((r) => (r.ok ? r.text() : Promise.reject()))
        .then((t) => { body.querySelector('pre').textContent = t; })
        .catch(() => { body.querySelector('pre').textContent = 'Brevet kunde inte läsas.'; });
    }
    this.lastTouch = Date.now();
    // Last in the page, so it is over whatever window it was opened from
    // (the Upcoming sheet is on the same layer).
    if (el.nextElementSibling) document.body.appendChild(el);
    el.classList.add('open');
  },

  closeDoc() {
    this.docEl?.classList.remove('open');
    const body = this.docEl?.querySelector('.sb-doc-body');
    if (body) body.innerHTML = '';   // a PDF left in a hidden frame keeps its memory
  },

  docOpen() { return !!this.docEl?.classList.contains('open'); },
};
