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

const TICK_MS = 60 * 1000;   // enough to notice midnight; nothing here is per-second

const ACCENTS = [
  ['food', 'Terracotta'],
  ['house', 'Green'],
  ['birds', 'Blue'],
  ['photos', 'Amber'],
];

/* Whole calendar days between today and the event, counted on local dates.
   Rounding rather than flooring the millisecond difference is deliberate: on
   the two DST days of the year a "day" is 23 or 25 hours long, and flooring
   would quietly report yesterday's number. */
function daysUntil(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  const target = new Date(y, m - 1, d);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return Math.round((target - today) / 86400000);
}

/* The number is drawn large and the unit sits beside it, small. Today has no
   number at all — "0 days" is a sum, "Today" is the answer. */
function shortWhen(n) {
  if (n === 0) return { num: '', unit: 'Today' };
  if (n === 1) return { num: '1', unit: 'day' };
  return { num: String(n), unit: 'days' };
}

function longDate(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d)
    .toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' });
}

function esc(s) {
  return String(s).replace(/[&<>"]/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

/* Two chips where the event has a city, and they answer two different
   questions. The left one is what it is like there **right now** — the thing
   you actually wonder about when a trip is still months away. The right one is
   the forecast **for the day you arrive**, which only exists once the date is
   inside Open-Meteo's 16 days.

   The city is named on the chips: the header band is home and these are not,
   so an unlabelled second temperature on the same screen would read as a
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

    // Another screen (a phone, usually) saved an event.
    ctx.bus.on('countdown', (events) => {
      if (!Array.isArray(events)) return;
      this.events = events;
      if (!this.editing) this.render();
    });

    // Midnight has to move every number down by one, and nothing else does.
    setInterval(() => {
      const key = new Date().toDateString();
      if (key === this.dayKey) return;
      this.dayKey = key;
      if (!this.editing) this.render();
    }, TICK_MS);
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
    const events = this.draft.filter((e) => e.title.trim() && e.date);
    try {
      const res = await fetch('/api/countdown', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ events }),
      });
      if (!res.ok) throw new Error();
      this.events = (await res.json()).events || events;
    } catch {
      this.body.querySelector('.cd-err')?.removeAttribute('hidden');
      return;   // stay in the editor so nothing typed is lost
    }
    this.editing = false;
    this.editBtn.classList.remove('on');
    this.editBtn.title = 'add or change events';
    this.render();
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
    this.editBtn.classList.add('on');
    this.editBtn.title = 'stop editing';
    this.renderEditor();
  },

  /* ---------------- view ---------------- */

  render() {
    if (this.editing) return;
    // Sorted nearest-first; days already past stay in the file (they are
    // often yearly) but leave the wall until the editor is opened.
    const list = this.events
      .map((e) => ({ ...e, n: daysUntil(e.date) }))
      .filter((e) => e.n >= 0)
      .sort((a, b) => a.n - b.n);

    this.ctx.setMeta(this.id, list.length ? `${list.length} upcoming` : '');

    if (!list.length) {
      this.body.innerHTML = `<div class="placeholder"><span class="big">◷</span>
        No events yet — tap Edit to add one</div>`;
      return;
    }

    // One template for every event. `next` is a tint and a thicker edge, never
    // a different size — see the note at the top of this file.
    this.body.innerHTML = `
      <div class="cd-wrap">${list.map((e, i) => {
        const s = shortWhen(e.n);
        return `
        <div class="cd-card a-${esc(e.accent || 'food')}${i === 0 ? ' next' : ''}">
          <div class="cd-num">${s.num}<span>${s.unit}</span></div>
          <div class="cd-ctxt">
            <div class="cd-title">${esc(e.title)}</div>
            <div class="cd-date">${longDate(e.date)}${
              e.note ? ` · ${esc(e.note)}` : ''}</div>
          </div>
          ${weatherChips(e, this.ctx)}
        </div>`;
      }).join('')}</div>`;
  },

  /* ---------------- editor ----------------
     Typing needs a keyboard, which the wall does not have — open the same page
     on a phone to add an event, and it appears here over SSE. The editor is
     still touch-sized so an event can be removed, or recoloured, by finger. */

  renderEditor() {
    // Events already past are dimmed rather than hidden: the editor is the
    // only place they can be removed, or moved on to next year.
    const rows = this.draft.map((e, i) => `
      <div class="cd-edit${e.date && daysUntil(e.date) < 0 ? ' past' : ''}" data-i="${i}">
        <input class="cd-in cd-title-in" type="text" value="${esc(e.title)}"
               placeholder="What is happening" maxlength="80">
        <div class="cd-city-wrap">
          <input class="cd-in cd-city-in" type="text" value="${esc(e.city || '')}"
                 placeholder="City (optional)" maxlength="60"
                 autocomplete="off" autocorrect="off" spellcheck="false">
          <div class="cd-sugg" hidden></div>
        </div>
        <input class="cd-in cd-date-in" type="date" value="${esc(e.date)}">
        <div class="cd-accents">${ACCENTS.map(([a, name]) => `
          <button class="cd-acc a-${a}${(e.accent || 'food') === a ? ' on' : ''}"
                  data-accent="${a}" title="${name}"></button>`).join('')}</div>
        <button class="cd-del" title="remove">✕</button>
      </div>`).join('');

    this.body.innerHTML = `
      <div class="cd-editor">
        ${rows || '<p class="cd-hint">No events yet.</p>'}
        <div class="cd-actions">
          <button class="cd-add">+ Add event</button>
          <span class="spacer"></span>
          <span class="cd-err" hidden>Could not save — try again</span>
          <!-- The gear toggles the editor shut too, but a wheel that is also
               the way out is a thing you have to have been told. -->
          <button class="cd-cancel">Cancel</button>
          <button class="cd-save">Save</button>
        </div>
        <p class="cd-hint">Typing needs a keyboard, which the wall has not got —
          open this page on a phone to name an event.</p>
      </div>`;

    const editor = this.body.querySelector('.cd-editor');
    editor.querySelector('.cd-add').onclick = () => {
      const d = new Date();
      d.setDate(d.getDate() + 7);
      this.draft.push({
        title: '', date: d.toISOString().slice(0, 10), note: '', city: '', accent: 'food',
      });
      this.renderEditor();
    };
    editor.querySelector('.cd-save').onclick = () => this.save();
    editor.querySelector('.cd-cancel').onclick = () => this.toggleEdit();

    editor.querySelectorAll('.cd-edit').forEach((row) => {
      const e = this.draft[Number(row.dataset.i)];
      row.querySelector('.cd-title-in').oninput = (ev) => { e.title = ev.target.value; };
      row.querySelector('.cd-date-in').onchange = (ev) => { e.date = ev.target.value; };
      this.wireCity(row.querySelector('.cd-city-in'), row.querySelector('.cd-sugg'), e);
      row.querySelector('.cd-del').onclick = () => {
        this.draft.splice(Number(row.dataset.i), 1);
        this.renderEditor();
      };
      row.querySelectorAll('.cd-acc').forEach((btn) => {
        btn.onclick = () => {
          e.accent = btn.dataset.accent;
          row.querySelectorAll('.cd-acc').forEach((b) => b.classList.toggle('on', b === btn));
        };
      });
    });
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
