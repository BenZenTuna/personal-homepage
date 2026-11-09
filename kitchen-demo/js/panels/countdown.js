// Countdown: hand-entered events, shown as whole days remaining.
//
// Every event is the same card. The nearest one used to be a hero at twice the
// size, and the cost was paid by the thing the panel is actually read for: two
// cards of different heights put their weather chips at two different widths,
// so the column of forecasts down the right-hand edge zig-zagged and the pair
// on one card stacked while the pair on the other did not. Uniform cards line
// the numbers up, line the chips up, and fit more events on the wall. The next
// one is still marked — a brighter accent and a filled edge — because which
// one is next is the question, not how big it is.
//
// Editing is behind the header button; events are stored server-side
// (backend/app/countdown.py) so any screen can add one.
//
// Since 2026-10-21 a family event may have a time, a last day and a yearly
// repeat (a birthday with a birth year says "Mormor turns 76"). When each is
// next, and how that is said, is calendar.js's (occurrence(), countWords()),
// handed over on ctx: the chips over a picture and the Time sheet say the
// same from the same file.

// Enough to notice midnight, and the minutes to a timed event on its day.
const TICK_MS = 60 * 1000;

const ACCENTS = [
  ['food', 'Terracotta'],
  ['house', 'Green'],
  ['birds', 'Blue'],
  ['photos', 'Amber'],
];

/* "2026-09-19" for a local date. Written out field by field on purpose:
   toISOString() is UTC, so from about 22:00 here until midnight it names
   yesterday — and a new row dated a week ahead would open dated six days
   ahead. (calendar.js has the same function for the Time sheet's calendar; a
   panel cannot import it, because panels are loaded with the build stamp.) */
function isoDay(date) {
  const p2 = (n) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${p2(date.getMonth() + 1)}-${p2(date.getDate())}`;
}

function longDate(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d)
    .toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' });
}

/* The date line of a card: its day; for a trip its first day to its last
   until it begins ("October 24 – 30"), then "until" its last day while it is
   on. Then the time it starts at, until it has started, and the note. */
function dateLine(e, cal) {
  const o = e.occ;
  let when = longDate(o.start);
  if (o.days > 1) when = o.n < 0 ? `until ${longDate(o.end)}` : cal.dayRange(o.start, o.end);
  const t = o.n >= 0 ? cal.timeLabel(e, o) : '';
  return esc(when) + (t ? ` · ${esc(t)}` : '') + (e.note ? ` · ${esc(e.note)}` : '');
}

function esc(s) {
  return String(s).replace(/[&<>"]/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

/* The first day a trip's last day may be: the day after its first. */
function minEnd(iso) {
  const [y, m, d] = String(iso || '').split('-').map(Number);
  return y && m && d ? isoDay(new Date(y, m - 1, d + 1)) : '';
}

/* An editor row's extras after the date, the family's own (a school event's
   times and days are its letters'): + Time, + More days, ↻ Every year, each a
   box with its ✕ once used, and the year born beside Every year
   (wireMore()). A field is open while the draft has it, even empty, so a box
   opened and not yet filled stays open. */
function moreHtml(e) {
  // + Time and + More days are actions (they open a box): the kit's plain
  // button. ↻ Every year is on or off: a chip with its tick box (app.css,
  // "the settings window kit"). ✕ beside a box takes it away again.
  const time = 'time' in e
    ? `<span class="cd-opt"><span class="cd-opt-l">kl.</span>
        <input class="cd-in cd-time-in" type="time" value="${esc(e.time || '')}" aria-label="starts at">
        <button class="ls-btn cd-opt-x" data-clear="time" title="no time" aria-label="no time">✕</button></span>`
    : '<button class="ls-btn cd-opt-add" data-open="time">+ Time</button>';
  // When it ends (2026-11-05): only beside a start time.
  const until = !('time' in e) ? '' : 'until' in e
    ? `<span class="cd-opt"><span class="cd-opt-l">to</span>
        <input class="cd-in cd-until-in" type="time" value="${esc(e.until || '')}" aria-label="ends at">
        <button class="ls-btn cd-opt-x" data-clear="until" title="no end time" aria-label="no end time">✕</button></span>`
    : '<button class="ls-btn cd-opt-add" data-open="until">+ Ends at</button>';
  // Something to do for it (sign a list, bring a dish), ticked on the card.
  const todo = 'todo' in e
    ? `<span class="cd-opt cd-opt-todo"><span class="cd-opt-l">to do</span>
        <input class="cd-in cd-todo-in" type="text" maxlength="80" value="${esc(e.todo || '')}"
               placeholder="sign the list, bring a dish…" aria-label="to do">
        <button class="ls-btn cd-opt-x" data-clear="todo" title="nothing to do" aria-label="nothing to do">✕</button></span>`
    : '<button class="ls-btn cd-opt-add" data-open="todo">+ To do</button>';
  const paper = e.paper ? '<span class="cd-opt-l cd-has-paper">📄 its paper is kept</span>' : '';
  const end = 'end' in e
    ? `<span class="cd-opt"><span class="cd-opt-l">until</span>
        <input class="cd-in cd-end-in" type="date" value="${esc(e.end || '')}"
               min="${minEnd(e.date)}" aria-label="last day">
        <button class="ls-btn cd-opt-x" data-clear="end" title="one day only" aria-label="one day only">✕</button></span>`
    : '<button class="ls-btn cd-opt-add" data-open="end">+ More days</button>';
  const born = e.yearly ? `<span class="cd-opt"><span class="cd-opt-l">born</span>
        <input class="cd-in cd-born-in" type="text" inputmode="numeric" maxlength="4"
               placeholder="year" value="${esc(e.born ?? '')}" aria-label="the year born"></span>` : '';
  return `<div class="cd-more">${time}${until}${end}${todo}
    <span class="sheet-chips cd-yearly"><button class="ls-btn cd-opt-add${e.yearly ? ' on' : ''}" data-open="yearly"
            aria-pressed="${e.yearly ? 'true' : 'false'}">↻ Every year</button></span>${born}${paper}</div>`;
}

/* Two chips where the event has a city, and they answer two different
   questions. The left one is what it is like there **right now** — the thing
   you actually wonder about when a trip is still months away. The right one is
   the forecast **for the day you arrive**, which only exists once the date is
   inside Open-Meteo's 16 days.

   The city is named on the chips: the header band is Lakeside and these are
   not, so an unlabelled second temperature on the same screen would read as a
   contradiction rather than as somewhere else. */

function nowChip(e, ctx) {
  const n = e.now;
  if (!n || n.temp == null) return '<span class="cd-wx cd-wx-void"></span>';
  const feels = n.feels != null && Math.round(n.feels) !== Math.round(n.temp)
    ? `<i>feels ${Math.round(n.feels)}°</i>` : '';
  return `<span class="cd-wx cd-wx-now">
    <span class="cd-wx-ico">${ctx.weatherIcon(n.code, n.day)}</span>
    <span class="cd-wx-txt">
      <span class="cd-wx-temp">${Math.round(n.temp)}°${feels}</span>
      <span class="cd-wx-city">there now</span>
    </span>
  </span>`;
}

function dayChip(e, ctx) {
  const w = e.weather;
  if (!w) {
    // No forecast, and the three reasons are not interchangeable: a misspelt
    // city needs fixing, a distant one needs only patience, and a blank chip
    // that says neither leaves someone waiting on weather that never comes.
    const why = e.city_found === false ? 'not found — check the spelling'
      : e.too_far ? 'forecast nearer the time'
      : 'looking up the forecast…';
    return `<span class="cd-wx cd-wx-plain${e.city_found === false ? ' cd-wx-bad' : ''}">
      <span class="cd-wx-txt">
        <span class="cd-wx-city">${esc(e.city)}</span>
        <span class="cd-wx-why">${why}</span>
      </span></span>`;
  }
  const rain = w.pp != null && w.pp >= 20 ? `<span class="cd-wx-rain">${w.pp}%</span>` : '';
  return `<span class="cd-wx">
    <span class="cd-wx-ico">${ctx.weatherIcon(w.code, 1)}</span>
    <span class="cd-wx-txt">
      <span class="cd-wx-temp">${Math.round(w.tmax)}°<i>${Math.round(w.tmin)}°</i>${rain}</span>
      <span class="cd-wx-city">${esc(w.place || e.city)}${e.n === 0 ? '' : ' on the day'}</span>
    </span>
  </span>`;
}

function weatherChips(e, ctx) {
  if (!e.city) return '';
  return `<span class="cd-wxs">${nowChip(e, ctx)}${dayChip(e, ctx)}</span>`;
}

export default {
  id: 'countdown',
  title: 'Countdown',

  init(body, ctx) {
    this.ctx = ctx;
    this.body = body;
    this.events = [];
    this.editing = false;
    this.draft = null;
    this.dayKey = new Date().toDateString();

    /* A gear, like every other panel's settings button. "Edit" was a word
       because adding an event is not a setting, but on a wall that already
       teaches one wheel for "change what is in here", a second convention
       spelled out in a word is a second thing to learn. It carries `.on` while
       the editor is open, which is how the other gears say the same thing. */
    this.editBtn = ctx.addHeaderButton(this.id, '⚙', () => this.toggleEdit());
    this.editBtn.className = 'gear';
    this.editBtn.title = 'add or change events';

    this.render();
    this.load();

    // ☐ a to-do ticked, 📄 its paper opened (2026-11-05) — on the panel and
    // on the Upcoming sheet over a picture, which draws listHtml() too.
    document.addEventListener('click', (ev) => {
      const t = ev.target.closest?.('[data-cd-todo]');
      if (t) { ev.stopPropagation(); this.tick(t.dataset.cdTodo); return; }
      const p = ev.target.closest?.('[data-cd-paper]');
      if (p) { ev.stopPropagation(); this.openPaper(p.dataset.cdPaper); }
    }, true);

    // Another screen (a phone, usually) saved an event.
    ctx.bus.on('countdown', (events) => {
      if (!Array.isArray(events)) return;
      this.events = events;
      if (!this.editing) this.render();
    });

    // Midnight has to move every number down by one, and nothing else does —
    // but for an event with a time on its day, whose minutes count down
    // (`counting`, set by render()).
    setInterval(() => {
      const key = new Date().toDateString();
      if (key === this.dayKey && !this.counting) return;
      this.dayKey = key;
      if (!this.editing) this.render();
    }, TICK_MS);
  },

  /* Today, as calendar.js counts: a local "YYYY-MM-DD". */
  today() {
    return this.ctx.calendar.isoDay(new Date());
  },

  async load() {
    try {
      const res = await (await fetch('/api/countdown')).json();
      this.events = res.events || [];
    } catch {
      return;   // keep whatever is on screen; the SSE snapshot will catch up
    }
    if (!this.editing) this.render();
  },

  async save() {
    // A birth year is typed as text and kept as a number; anything that is
    // not four digits is no birth year, and the server would drop it anyway.
    const events = this.draft.filter((e) => e.title.trim() && e.date).map((e) => ({
      ...e, born: e.yearly && /^\d{4}$/.test(String(e.born ?? '').trim()) ? Number(e.born) : undefined,
    }));
    const err = this.body.querySelector('.cd-err');
    // A last day not after the first is red in its box, and the server would
    // drop it without a word — the trip saved as one day. So it is not sent:
    // the editor stays open with it, and says why.
    if (events.some((e) => !e.school && e.end && e.end <= e.date)) {
      if (err) { err.textContent = 'The last day must be after the first'; err.hidden = false; }
      return;
    }
    if (events.some((e) => !e.school && e.time && e.until && e.until <= e.time)) {
      if (err) { err.textContent = 'It must end after it starts'; err.hidden = false; }
      return;
    }
    try {
      const res = await fetch('/api/countdown', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        // `removed` names the school's events taken off with ✕. The server
        // keeps any of theirs a PUT does not mention, since the kitchen agent
        // may have added one while this editor was open, so a ✕ has to be
        // said in so many words (countdown.py, _merge_put).
        body: JSON.stringify({ events, removed: this.removed }),
      });
      if (!res.ok) throw new Error();
      this.events = (await res.json()).events || events;
    } catch {
      if (err) { err.textContent = 'Could not save — try again'; err.hidden = false; }
      return;   // stay in the editor so nothing typed is lost
    }
    this.editing = false;
    this.editBtn.classList.remove('on');
    this.editBtn.title = 'add or change events';
    this.render();
  },

  async tick(id) {
    const e = this.events.find((x) => x.id === id);
    if (!e) return;
    const done = !e.todo_done;
    e.todo_done = done || undefined;
    if (!this.editing) this.render();
    try {
      await fetch(`/api/countdown/${encodeURIComponent(id)}/todo`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ done }),
      });
    } catch { /* the next snapshot puts it right */ }
  },

  /* The paper an event came from, in the school board's letter window. */
  openPaper(id) {
    const e = this.events.find((x) => x.id === id);
    const board = this.ctx.schoolBoard;
    if (!e?.paper) return;
    const url = `/api/countdown/${encodeURIComponent(id)}/paper?v=${encodeURIComponent(e.paper.at || '')}`;
    if (!board?.openDoc) { window.open(url, '_blank'); return; }
    board.openDoc({ title: e.title, date: e.date, file: { ext: e.paper.ext } }, url, { family: true });
  },

  toggleEdit() {
    if (this.editing) {           // pressed again — the draft is thrown away
      this.editing = false;
      this.editBtn.classList.remove('on');
      this.editBtn.title = 'add or change events';
      this.render();
      return;
    }
    this.editing = true;
    this.draft = this.events.map((e) => ({ ...e }));
    this.removed = [];
    this.added = new Set();       // rows + Add event made, shown first in Coming up
    this.opened = this.draft.length;   // the bar counts the ones ✕ took away against it
    this.editBtn.classList.add('on');
    this.editBtn.title = 'stop editing';
    this.renderEditor();
  },

  /* ---------------- view ---------------- */

  render() {
    if (this.editing) return;
    // Sorted nearest-first; days already past stay in the file but leave the
    // wall until the editor is opened. A yearly one is never past, and a
    // trip is not until its last day is over.
    const list = this.ctx.calendar.upcoming(this.events, this.today());
    this.counting = list.some((e) => e.occ.n === 0 && e.occ.time);

    this.ctx.setMeta(this.id, list.length ? `${list.length} upcoming` : '');

    if (!list.length) {
      this.body.innerHTML = `<div class="placeholder"><span class="big">◷</span>
        No events yet — tap ⚙ to add one</div>`;
      return;
    }
    this.body.innerHTML = this.listHtml(list);
  },

  /* Every upcoming event as the panel draws them — also the "Upcoming" sheet
     a countdown chip over a picture opens (app.js, 2026-10-13). */
  listHtml(list = null) {
    const cal = this.ctx.calendar;
    list = list || cal.upcoming(this.events, this.today());
    if (!list.length) return '<div class="placeholder">Nothing coming up</div>';
    const now = new Date();
    // One template for every event. `next` is a tint and a thicker edge, never
    // a different size — see the note at the top of this file. The number is
    // drawn large and the unit beside it, small; Today has no number at all —
    // "0 days" is a sum, "Today" is the answer — and nor has a trip's
    // "Day 3 of 7".
    return `
      <div class="cd-wrap">${list.map((e, i) => {
        const s = cal.countWords(e.occ, now);
        return `
        <div class="cd-card a-${esc(e.accent || 'food')}${i === 0 ? ' next' : ''}">
          <div class="cd-num">${s.num}<span>${s.unit}</span></div>
          <div class="cd-ctxt">
            <div class="cd-title">${esc(cal.shownTitle(e, e.occ))}</div>
            <div class="cd-date">${dateLine(e, cal)}</div>
            ${e.todo && !e.school ? `<button class="cd-todo${e.todo_done ? ' done' : ''}" data-cd-todo="${esc(e.id)}"
                aria-pressed="${e.todo_done ? 'true' : 'false'}"><span class="cd-tick" aria-hidden="true">${
                e.todo_done ? '☑' : '☐'}</span> ${esc(e.todo)}</button>` : ''}
          </div>
          ${e.paper && !e.school ? `<button class="cd-paper" data-cd-paper="${esc(e.id)}"
              title="the paper it came from" aria-label="show the paper it came from">📄</button>` : ''}
          ${weatherChips(e, this.ctx)}
        </div>`;
      }).join('')}</div>`;
  },

  /* ---------------- editor ----------------
     Typing needs a keyboard, which the wall does not have — open
     http://192.0.2.10:8200 on a phone to add an event, and it appears here
     over SSE. The editor is still touch-sized so an event can be removed, or
     recoloured, by finger. */

  /* On the settings window kit (2026-10-22; app.css, "the in-panel settings
     on the kit"), still inside the panel: a bar that stays at the top while
     the list scrolls — what is being edited, Cancel and Save, and why a
     Save was refused — then the events in cards: Coming up (with + Add event
     at its top, and a new row right under it), the school's, and those
     already over. Each event is one block, its boxes in the same places in
     every row however wide the panel is. */
  renderEditor() {
    const kit = this.ctx.sheetkit;
    this.added ||= new Set();
    // Events already past are kept in a card of their own rather than
    // hidden: the editor is the only place they can be removed, or moved on
    // to next year. A yearly one is never past.
    const today = this.today();
    const past = (e) => !!e.date && !this.ctx.calendar.occurrence(e, today);
    const rowHtml = (e, i) => `
      <div class="cd-edit${past(e) ? ' past' : ''}${e.school ? ' school' : ''}" data-i="${i}">
        <input class="cd-in cd-title-in" type="text" value="${esc(e.title)}"
               placeholder="What is happening" maxlength="80">
        <div class="cd-city-wrap">
          <input class="cd-in cd-city-in" type="text" value="${esc(e.city || '')}"
                 placeholder="City (optional)" maxlength="60"
                 autocomplete="off" autocorrect="off" spellcheck="false">
          <div class="cd-sugg" hidden></div>
        </div>
        <input class="cd-in cd-date-in" type="date" value="${esc(e.date)}">
        ${e.school ? '' : moreHtml(e)}
        <div class="cd-accents" role="group" aria-label="colour">${ACCENTS.map(([a, name]) => {
          const on = (e.accent || 'food') === a;
          return `<button class="cd-acc a-${a}${on ? ' on' : ''}" data-accent="${a}" title="${name}"
                  aria-label="${name}" aria-pressed="${on}"></button>`;
        }).join('')}</div>
        <button class="ls-btn sheet-danger cd-del" title="remove" aria-label="remove">✕</button>
      </div>`;
    const all = this.draft.map((e, i) => [e, i]);
    const fresh = all.filter(([e]) => this.added.has(e)).reverse();
    const kept = all.filter(([e]) => !this.added.has(e));
    const coming = kept.filter(([e]) => !e.school && !past(e));
    const school = kept.filter(([e]) => e.school && !past(e));
    const gone = kept.filter(([e]) => past(e));
    const list = (xs) => xs.map(([e, i]) => rowHtml(e, i)).join('');
    const count = (n) => `${n} ${n === 1 ? 'event' : 'events'}`;
    // The school's note goes with the first card that has one of theirs.
    const schoolNote = `<p class="sheet-note cd-hint">The ones edged in
          yellow are the school's, from its weekly letters. Change or remove them
          like any other: the next letter leaves your change alone, and does not
          put back one you removed.</p>`;
    // Against the list the editor opened with: a phone's event arriving over
    // SSE meanwhile changes this.events, not the draft.
    const removed = (this.opened ?? this.draft.length) - (this.draft.length - this.added.size);

    this.body.innerHTML = `
      <div class="pset cd-editor">
        <div class="cd-actions cd-ehead">
          <span class="sheet-status cd-enow"></span>
          <!-- The gear toggles the editor shut too, but a wheel that is also
               the way out is a thing you have to have been told. -->
          <button class="ls-btn cd-cancel">Cancel</button>
          <button class="ls-btn sheet-primary cd-save">Save</button>
          <span class="cd-err" hidden>Could not save — try again</span>
        </div>
        <p class="sheet-note cd-hint cd-kbd">Typing needs a keyboard, which the wall has not got —
          open this page on a phone to name an event.</p>
        ${kit.sec('Coming up', `
          ${this.draft.some((e) => e.yearly) ? `<p class="sheet-note cd-hint">Every year: it comes
            back on the same day by itself. For a birthday with the year born, call it
            by the name alone — the card says “Mormor turns 76”.</p>` : ''}
          <div class="cd-addrow"><button class="ls-btn cd-add">+ Add event</button></div>
          ${list(fresh)}${list(coming)}
          ${this.draft.length ? '' : '<p class="sheet-note cd-hint">No events yet.</p>'}`,
        { note: count(fresh.length + coming.length) })}
        ${school.length ? kit.sec('From the school’s letters', `${schoolNote}${list(school)}`,
          { note: count(school.length) }) : ''}
        ${gone.length ? kit.sec('Already over', `${school.length || !gone.some(([e]) => e.school)
          ? '' : schoolNote}${list(gone)}`, { note: count(gone.length) }) : ''}
      </div>`;
    kit.status(this.body.querySelector('.cd-enow'), `<b>Editing</b> · ${count(this.draft.length)}${
      this.added.size ? ` · ${this.added.size} new` : ''}${removed > 0 ? ` · ${removed} removed` : ''}`, 'ok');

    const editor = this.body.querySelector('.cd-editor');
    editor.querySelector('.cd-add').onclick = () => {
      const d = new Date();
      d.setDate(d.getDate() + 7);
      const e = {
        title: '', date: isoDay(d), note: '', city: '', accent: 'food',
      };
      this.draft.push(e);
      this.added.add(e);
      this.renderEditor();
      // The new row is the first under + Add event: its name box is the
      // one to fill (on a phone that brings the keyboard up). The bar is
      // sticky over the top of what scrolls, so the row comes in below it,
      // not behind it.
      const row = this.body.querySelector(`.cd-edit[data-i="${this.draft.length - 1}"]`);
      if (row) {
        const bar = this.body.querySelector('.cd-ehead');
        row.style.scrollMarginTop = `${(bar?.offsetHeight || 0) + 12}px`;
        row.scrollIntoView({ block: 'nearest' });
      }
      row?.querySelector('.cd-title-in')?.focus({ preventScroll: true });
    };
    editor.querySelector('.cd-save').onclick = () => this.save();
    editor.querySelector('.cd-cancel').onclick = () => this.toggleEdit();

    editor.querySelectorAll('.cd-edit').forEach((row) => {
      const e = this.draft[Number(row.dataset.i)];
      row.querySelector('.cd-title-in').oninput = (ev) => { e.title = ev.target.value; };
      row.querySelector('.cd-date-in').onchange = (ev) => {
        e.date = ev.target.value;
        // The last day has to come after the first; the box says so (red,
        // :invalid) rather than the server dropping it without a word.
        const end = row.querySelector('.cd-end-in');
        if (end) end.min = minEnd(e.date);
      };
      this.wireCity(row.querySelector('.cd-city-in'), row.querySelector('.cd-sugg'), e);
      if (!e.school) this.wireMore(row, e);
      row.querySelector('.cd-del').onclick = () => {
        const [gone] = this.draft.splice(Number(row.dataset.i), 1);
        if (gone?.school && gone.id) this.removed.push(gone.id);
        this.added.delete(gone);
        this.renderEditor();
      };
      row.querySelectorAll('.cd-acc').forEach((btn) => {
        btn.onclick = () => {
          e.accent = btn.dataset.accent;
          row.querySelectorAll('.cd-acc').forEach((b) => {
            b.classList.toggle('on', b === btn);
            b.setAttribute('aria-pressed', String(b === btn));
          });
        };
      });
    });
  },

  /* The row's extras: a time, a last day, every year and a birth year. A
     button until it is used, so a row that needs none of them stays three
     small buttons after the date; ✕ beside a box takes it away again, which a
     time or date box on a wall with no keyboard cannot do by itself. Opening
     one redraws the editor (as + Add event and ✕ do — the draft holds what
     was typed) and opens its picker. */
  wireMore(row, e) {
    const i = row.dataset.i;
    const reopen = (sel) => {
      this.renderEditor();
      const box = this.body.querySelector(`.cd-edit[data-i="${i}"] ${sel}`);
      if (!box) return;
      box.focus();
      // The tap that opened it is still the user's gesture, which is what
      // showPicker() asks for; a browser without it just has the box focused.
      try { box.showPicker?.(); } catch { /* typed or tapped open instead */ }
    };
    row.querySelector('[data-open="time"]')?.addEventListener('click', () => {
      e.time = '';
      reopen('.cd-time-in');
    });
    row.querySelector('[data-open="until"]')?.addEventListener('click', () => {
      e.until = '';
      reopen('.cd-until-in');
    });
    row.querySelector('[data-open="todo"]')?.addEventListener('click', () => {
      e.todo = '';
      reopen('.cd-todo-in');
    });
    row.querySelector('[data-open="end"]')?.addEventListener('click', () => {
      e.end = '';
      reopen('.cd-end-in');
    });
    row.querySelector('[data-open="yearly"]')?.addEventListener('click', () => {
      e.yearly = !e.yearly;
      if (!e.yearly) delete e.born;
      this.renderEditor();
    });
    row.querySelectorAll('[data-clear]').forEach((b) => {
      b.onclick = () => {
        delete e[b.dataset.clear];
        if (b.dataset.clear === 'time') delete e.until;     // an end needs a start
        if (b.dataset.clear === 'todo') delete e.todo_done;
        this.renderEditor();
      };
    });
    const until = row.querySelector('.cd-until-in');
    if (until) until.onchange = () => { e.until = until.value; };
    const todo = row.querySelector('.cd-todo-in');
    if (todo) todo.oninput = () => { e.todo = todo.value; delete e.todo_done; };
    const time = row.querySelector('.cd-time-in');
    if (time) time.onchange = () => { e.time = time.value; };
    const end = row.querySelector('.cd-end-in');
    if (end) end.onchange = () => { e.end = end.value; };
    const born = row.querySelector('.cd-born-in');
    if (born) born.oninput = () => { e.born = born.value; };
  },

  /* The city box asks the geocoder while it is being typed, so a place is
     chosen from the list of ones that actually exist rather than spelled at
     it and found wanting days later. Typing a name by hand still works — the
     list is a shortcut, never a gate — and a lookup that fails (no network,
     usually) simply does not appear. */
  wireCity(input, list, e) {
    let timer = null;
    let seq = 0;                 // answers can arrive out of order; only the last counts

    const close = () => { list.hidden = true; list.innerHTML = ''; };

    const show = (places, q) => {
      if (document.activeElement !== input) return;
      if (!places.length) {
        list.innerHTML =
          `<p class="cd-sugg-none">Nowhere called “${esc(q)}” — check the spelling</p>`;
      } else {
        list.innerHTML = places.map((p) => `
          <button type="button" data-value="${esc(p.value)}">
            <span class="s-name">${esc(p.name)}</span>
            <span class="s-where">${esc([p.admin1, p.country].filter(Boolean).join(' · '))}</span>
          </button>`).join('');
        list.querySelectorAll('button').forEach((b) => {
          // pointerdown rather than click: the input blurs first, and a click
          // on a list that blur has already hidden never arrives.
          b.addEventListener('pointerdown', (ev) => {
            ev.preventDefault();
            input.value = b.dataset.value;
            e.city = b.dataset.value;
            close();
          });
        });
      }
      list.hidden = false;
    };

    const look = async (q) => {
      const mine = ++seq;
      try {
        const r = await fetch(`/api/countdown/places?q=${encodeURIComponent(q)}`);
        // A backend older than this endpoint answers 404, and reading that as
        // "nowhere called Istanbul" would be a lie: say nothing instead. The
        // frontend deploys on its own (./sync.sh without `backend`), so this
        // pairing is a normal state, not a broken one.
        if (!r.ok) return close();
        const res = await r.json();
        if (!Array.isArray(res.places)) return close();
        if (mine === seq) show(res.places, q);
      } catch {
        close();                     // offline: typing a name by hand still works
      }
    };

    input.addEventListener('input', () => {
      e.city = input.value;
      clearTimeout(timer);
      const q = input.value.trim();
      if (q.length < 2) { seq += 1; return close(); }
      timer = setTimeout(() => look(q), 300);   // a lookup per word, not per letter
    });
    input.addEventListener('blur', () => setTimeout(close, 150));
    input.addEventListener('keydown', (ev) => { if (ev.key === 'Escape') close(); });
  },
};
