// The year behind the clock: twelve months from this one, drawn for the Time
// sheet, with every day the countdown knows about coloured in.
//
// Dates in, markup out, and the list to save when a day is given an event —
// nothing else. Since 2026-10-21 also when an event is on: a family event may
// have a time, a last day and a yearly repeat, and occurrence() is the one
// answer to "when is it next" that the countdown cards, the chips over a
// picture and this calendar all draw from (app.js hands this file to the
// countdown panel on ctx, as it hands it to time.js).
// time.js owns the sheet, the taps, the form and the fetching;
// this file only knows what a month looks like. That split is
// so scripts/calendar-test.mjs can import it into Node and check the parts
// that are easy to get wrong and slow to notice on a wall — a month that
// starts on the wrong weekday, a week number that is off by one across New
// Year, a day that appears twice on the night the clocks go back. So nothing
// at the top level of this file may touch the DOM.
//
// Every date here is a LOCAL date: built with new Date(y, m, d) and read back
// with getFullYear/getMonth/getDate. Never toISOString(), which is UTC — on
// this wall that is the day before for the first hour or two of every day.

export const ACCENTS = ['house', 'birds', 'photos', 'food'];

// The countdown file's own ceiling (MAX_EVENTS in backend/app/countdown.py). A
// PUT of more than this is truncated server-side, silently — so the sheet has
// to know the number to be able to say "full" instead of losing what was typed.
// If it ever changes there, change it here; scripts/schoolboard-test.py checks
// that the two agree. 24 until the school's events joined the family's.
export const MAX_EVENTS = 80;

// The keys the server keeps (_clean() in countdown.py). Everything else on an
// event that arrives from /api/countdown — the forecast, the weather where it
// happens — is decoration the server adds on the way out and drops on the way
// in, so a list being PUT back is sent as the stored fields. `id` is one of
// them on purpose: without it every event in the list is given a new one. The
// last four are only on an event that has them, and one left out of a PUT is
// gone: a day tapped here must not take a birthday's repeat away.
// `until`, `todo` and `todo_done` since 2026-11-05; the paper is the server's.
const STORED = ['id', 'title', 'date', 'note', 'city', 'accent', 'time', 'end', 'yearly', 'born',
  'until', 'todo', 'todo_done'];

// Monday first, as the week is counted here — the spending panel's "Week 38"
// is an ISO week, and a calendar that starts on Sunday would put that week's
// Sunday in the next row.
export const WEEKDAYS = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];

const pad2 = (n) => String(n).padStart(2, '0');

/* "2026-09-19" for a local date, which is the form the countdown stores. */
export function isoDay(date) {
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
}

/* The countdown's "YYYY-MM-DD" as a local midnight, or null for anything that
   is not a real date — the file is typed by hand on a phone, and 2027-02-30
   must not quietly become March the 2nd. */
export function fromIso(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso ?? ''));
  if (!m) return null;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const date = new Date(y, mo - 1, d);
  if (date.getFullYear() !== y || date.getMonth() !== mo - 1 || date.getDate() !== d) return null;
  return date;
}

/* The local day `n` days after an ISO day, made from its fields — never by
   adding 24 hours, which on the night the clocks go back lands on the same
   date again. */
export function addDays(iso, n) {
  const d = fromIso(iso);
  return d ? isoDay(new Date(d.getFullYear(), d.getMonth(), d.getDate() + n)) : null;
}

/* Whole days from one ISO day to another, rounded: on the two DST days a day
   is 23 or 25 hours long, and flooring would say yesterday's number. */
export function daysBetween(a, b) {
  return Math.round((fromIso(b) - fromIso(a)) / 86400000);
}

/* The day a yearly event falls on in `year`: its own month and day, and the
   28th of February in a year without a 29th (countdown.py _anniversary()). */
export function anniversary(iso, year) {
  const m = Number(iso.slice(5, 7)), d = Number(iso.slice(8, 10));
  const leap = new Date(year, 1, 29).getMonth() === 1;
  return `${year}-${pad2(m)}-${pad2(m === 2 && d === 29 && !leap ? 28 : d)}`;
}

/* An event as it is now or next — or null once it is over:
     start, end   its first and last day this time ("YYYY-MM-DD");
     days         how many days it lasts (1 for one day);
     n            days from `today` to its start, below 0 while it is on;
     day          which of its days today is (1…days) while it is on, else 0;
     age          what a yearly birthday with a birth year turns, else null;
     time         "HH:MM" it starts at, or "".
   `today` is "YYYY-MM-DD". A trip is on until its last day is over, and a
   yearly event comes back by itself, from the year of its stored date on.

   The family's own fields only. A school event's time and last day are the
   school's (inside `school`, from the letters) and it is counted down to its
   one day, exactly as before these fields existed. countdown.py occurrence()
   gives the same days. */
export function occurrence(e, today) {
  if (!e || !fromIso(e.date)) return null;
  const y = Number(String(today).slice(0, 4));
  // Last year's too: a run over New Year that began then is still on now.
  // And as far on as its stored year: a yearly one given a date two years
  // ahead first happens then, and next year would find nothing.
  for (const o of times(e, y - 1, Math.max(y + 1, Number(e.date.slice(0, 4))))) {
    if (o.end < today) continue;
    const n = daysBetween(today, o.start);
    return { ...o, n, day: n <= 0 ? 1 - n : 0 };
  }
  return null;
}

/* Every time an event happens that starts in the years `fromYear`…`toYear`:
   {start, end, days, age, time}. One for an ordinary event, whatever the
   years; one a year for a yearly one, never before its stored date's year. */
function times(e, fromYear, toYear) {
  const fam = !e.school;
  const days = fam && fromIso(e.end) && e.end > e.date ? daysBetween(e.date, e.end) + 1 : 1;
  const yearly = fam && e.yearly === true;
  const born = yearly && Number.isInteger(e.born) ? e.born : null;
  const time = fam && /^\d{2}:\d{2}$/.test(e.time || '') ? e.time : '';
  const until = time && /^\d{2}:\d{2}$/.test(e.until || '') && e.until > time ? e.until : '';
  const first = Number(e.date.slice(0, 4));
  const starts = [];
  if (!yearly) starts.push(e.date);
  else for (let yr = Math.max(first, fromYear); yr <= toYear; yr++) starts.push(anniversary(e.date, yr));
  return starts.map((start) => {
    const yr = Number(start.slice(0, 4));
    return { start, end: addDays(start, days - 1), days, age: born != null && yr > born ? yr - born : null, time, until };
  });
}

/* What the event is called this time: a yearly birthday with a birth year
   says how old, in the countdown's own English ("Mormor turns 76"); the title
   is the person's name for that, which is how the family-events skill and
   the editor's hint write one. Everything else is its title. */
export function shownTitle(e, occ) {
  return occ && occ.age ? `${e.title} turns ${occ.age}` : String(e?.title ?? '');
}

/* "kl. 09:00" for an event with a time — a family event's own, or the one
   the school's letter gave (school.time, "17:00-18:00"), which the cards
   have shown that way since 2026-10-02. "" for neither. */
export function timeLabel(e, occ) {
  const t = e?.school ? String(e.school.time || '').replace(/^kl\.?\s*/i, '') : (occ?.time || '');
  if (!t) return '';
  return occ?.until && !e?.school ? `kl. ${t}–${occ.until}` : `kl. ${t}`;
}

/* "kl. 09:00" for a family event's own time only — what the chips over a
   picture and the calendar's day line add to a title. A school event says
   its title alone there, as it did before the family had times (Alex:
   school events untouched); occurrence() never gives one a time. */
export function familyTime(occ) {
  if (!occ?.time) return '';
  return occ.until ? `kl. ${occ.time}–${occ.until}` : `kl. ${occ.time}`;
}

/* A run of days in a few words, the browser's own way: "October 24 – 30",
   "24 – 30 October", "October 30 – November 2". Intl's formatRange says each
   month and year once; the weekday is left out, which on a phone is what
   lets the range keep its last day instead of losing it to an ellipsis. */
export function dayRange(a, b, locale = undefined) {
  const x = fromIso(a), y = fromIso(b);
  if (!x || !y) return '';
  const f = new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'long' });
  return f.formatRange ? f.formatRange(x, y) : `${f.format(x)} – ${f.format(y)}`;
}

/* Minutes from `now` (a Date) to a timed event's start on its own day,
   rounded up, so "1 min" is the last minute; 0 when it has no time or the
   time has come. */
export function minutesTo(occ, now = new Date()) {
  if (!occ || !occ.time || occ.n !== 0) return 0;
  const [y, m, d] = occ.start.split('-').map(Number);
  const [hh, mm] = occ.time.split(':').map(Number);
  // A local wall-clock time on that local day, which is right on the two DST
  // days as well: new Date() with fields asks for 09:00, not for 9 × 60 minutes.
  return Math.max(0, Math.ceil((new Date(y, m - 1, d, hh, mm) - now) / 60000));
}

/* The countdown's number and the word beside it, the way the cards, the
   chips over a picture and the Time sheet's list all say it: "3 days",
   "1 day", on its day "2 h 15 min" or "40 min" to a time still to come, else
   "Today", and from a trip's second day "Day 3 of 7". `num` is drawn large,
   `unit` small beside it; with no number the word stands alone, as Today
   always has. */
export function countWords(occ, now = new Date()) {
  if (occ.n >= 2) return { num: String(occ.n), unit: 'days' };
  if (occ.n === 1) return { num: '1', unit: 'day' };
  if (occ.n < 0) return { num: '', unit: `Day ${occ.day} of ${occ.days}` };
  const left = minutesTo(occ, now);
  // Between its start and its end (`until`, since 2026-11-05): on now.
  if (!left && occ.until && occ.days === 1) {
    const [y, m, d] = occ.start.split('-').map(Number);
    const [hh, mm] = occ.until.split(':').map(Number);
    if (now < new Date(y, m - 1, d, hh, mm)) return { num: '', unit: 'Now' };
  }
  if (!left) return { num: '', unit: 'Today' };
  const h = Math.floor(left / 60), m = left % 60;
  if (!h) return { num: String(m), unit: 'min' };
  return { num: String(h), unit: m ? `h ${m} min` : 'h' };
}

/* The events still to come or on now, each with its occurrence (`occ`) and
   `n` (never below 0: one on now is as near as today), nearest first. Today,
   what begins today comes before a trip already under way — that one has
   been on the wall for days — and the earlier time first, one with no time
   before the timed ones, as a day reads. Otherwise the order they came in. */
export function upcoming(events, today) {
  const rank = (e) => [e.n, e.occ.n < 0 ? 1 : 0, e.occ.time];
  return (Array.isArray(events) ? events : [])
    .filter((e) => e && e.title)
    .map((e) => ({ ...e, occ: occurrence(e, today) }))
    .filter((e) => e.occ)
    .map((e) => ({ ...e, n: Math.max(0, e.occ.n) }))
    .sort((a, b) => {
      const x = rank(a), y = rank(b);
      return x[0] - y[0] || x[1] - y[1] || x[2].localeCompare(y[2]);
    });
}

/* The ISO 8601 week: weeks start on Monday, and week 1 is the one with the
   year's first Thursday in it — so 31 December can be in week 1 of the next
   year and 1 January in week 53 of the last. Worked on the calendar date alone
   (Date.UTC of its fields), so a 23- or 25-hour day at a DST change cannot
   push the arithmetic across midnight. */
export function isoWeek(date) {
  const t = Date.UTC(date.getFullYear(), date.getMonth(), date.getDate());
  const dow = (new Date(t).getUTCDay() + 6) % 7;          // Monday 0 … Sunday 6
  const thursday = t + (3 - dow) * 86400000;
  const year = new Date(thursday).getUTCFullYear();
  const week = 1 + Math.floor((thursday - Date.UTC(year, 0, 1)) / (7 * 86400000));
  return { week, year };
}

/* One month as the rows of a Monday-first grid: the weeks it touches, each
   with its ISO number and seven cells. Cells outside the month are there to
   keep the columns, and are drawn blank — in twelve months side by side a
   greyed "31" from the month before is a day shown twice.

   Every day is made from its own fields (new Date(y, m, 1 + i)) rather than
   by adding 24 hours to the one before: on the day the clocks change that is
   an hour short or long, and where the change happens at midnight the day can
   start at 01:00 — an addition would print one date twice and skip the next. */
export function monthGrid(year, month) {
  const lead = (new Date(year, month, 1).getDay() + 6) % 7;
  const length = new Date(year, month + 1, 0).getDate();
  const rows = [];
  for (let r = 0; r * 7 < lead + length; r++) {
    const days = [];
    for (let c = 0; c < 7; c++) {
      const date = new Date(year, month, 1 - lead + r * 7 + c);
      days.push({
        iso: isoDay(date), d: date.getDate(), dow: c,
        inMonth: date.getMonth() === month,
      });
    }
    rows.push({ week: isoWeek(new Date(year, month, 1 - lead + r * 7)).week, days });
  }
  return rows;
}

/* `count` months from (year, month), month 0-based and allowed to run past
   either end of the year. */
export function monthsFrom(year, month, count = 12) {
  const out = [];
  for (let i = 0; i < count; i++) {
    const first = new Date(year, month + i, 1);
    out.push({ year: first.getFullYear(), month: first.getMonth() });
  }
  return out;
}

export function monthName(year, month) {
  return new Date(year, month, 1).toLocaleDateString('en-US', { month: 'long' });
}

/* "September 2026 – August 2027". */
export function rangeLabel(months) {
  const a = months[0], b = months[months.length - 1];
  const one = (m) => `${monthName(m.year, m.month)} ${m.year}`;
  return a === b ? one(a) : `${one(a)} – ${one(b)}`;
}

/* "Friday, October 23" — the caption under the calendar header. */
export function dayLabel(iso) {
  const date = fromIso(iso);
  return date
    ? date.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })
    : '';
}

/* How far the calendar is stepped (in months, a whole year at a time as
   ‹ › step it) to show the day `iso`, when it is stepped `shift` now: not at
   all while the day is among the twelve months on show — a tap on the
   calendar always is — else whole years on until it is. A day earlier this
   past year keeps the twelve months from this one, where today is: a year
   back for it would hide today. */
export function shiftFor(iso, now, shift = 0) {
  const [y, m] = iso.split('-').map(Number);
  const ahead = (y - now.getFullYear()) * 12 + (m - 1 - now.getMonth());
  if (ahead >= shift && ahead < shift + 12) return shift;
  return ahead < 0 && ahead > -12 ? 0 : Math.floor(ahead / 12) * 12;
}

/* The first and the last day of a run of months, as monthsFrom() gives them:
   the window eventDays() fills. */
export function windowOf(months) {
  const a = months[0], b = months[months.length - 1];
  return { from: isoDay(new Date(a.year, a.month, 1)), to: isoDay(new Date(b.year, b.month + 1, 0)) };
}

/* Events grouped by their day. Past events are kept: the calendar shows
   them, muted, because "when was the last one" is half of what a year on a
   wall is for. An accent that is not one of the four becomes food, which is
   what the countdown's own server does with it.

   A trip is on every one of its days, and a yearly event on its day in every
   year from its first; `from`/`to` ("YYYY-MM-DD", windowOf()) are the days
   wanted, without which a yearly event is on its stored year's day only. Each
   entry carries `occ` — that time's {start, end, days, age, time} and `day`,
   which of its days this is — for the day's own line (dayLine()). */
export function eventDays(events, { from = null, to = null } = {}) {
  const days = new Map();
  for (const e of Array.isArray(events) ? events : []) {
    if (!e || !e.title || !fromIso(e.date)) continue;
    const accent = ACCENTS.includes(e.accent) ? e.accent : 'food';
    const first = Number(e.date.slice(0, 4));
    // A year before the window too: a run over New Year begun then is in it.
    const span = from && to ? [Number(from.slice(0, 4)) - 1, Number(to.slice(0, 4))] : [first, first];
    for (const o of times(e, ...span)) {
      for (let k = 0; k < o.days; k++) {
        const iso = addDays(o.start, k);
        if ((from && iso < from) || (to && iso > to)) continue;
        if (!days.has(iso)) days.set(iso, []);
        days.get(iso).push({ ...e, accent, occ: { ...o, day: k + 1 } });
      }
    }
  }
  return days;
}

/* One event as the day's line says it: "Mormor turns 76", "Tandläkare ·
   kl. 09:00", "Lesjön · day 3 of 7". The time is the family's own, said on
   the first day of a run only — it is when it starts. */
export function dayLine(e) {
  const o = e.occ || null;
  const bits = [shownTitle(e, o)];
  const t = familyTime(o);
  if (t && o.day <= 1) bits.push(t);
  if (o && o.days > 1) bits.push(`day ${o.day} of ${o.days}`);
  return bits.join(' · ');
}

/* The whole list to PUT back with one event added to it — the shape
   /api/countdown takes, since a save there is always the entire list and never
   a single row. Kept here, away from the DOM, because the three ways it can
   refuse are the part worth testing: an empty title (the button that calls
   this is disabled until there is one, and this is the second lock), a date
   that is not a date, and a file already at its ceiling. `events` is not
   touched; a new array comes back. */
export function withEvent(events, { date, title, accent } = {}) {
  const list = (Array.isArray(events) ? events : []).map(
    (e) => Object.fromEntries(STORED.filter((k) => e && e[k] != null).map((k) => [k, e[k]])),
  );
  const clean = String(title ?? '').trim().slice(0, 80);
  if (!clean) return { error: 'empty' };
  if (!fromIso(date)) return { error: 'date' };
  if (list.length >= MAX_EVENTS) return { error: 'full' };
  // note and city are sent empty rather than left out: the countdown editor is
  // where a city is chosen, from a geocoder's list, and a city guessed at from
  // here would come back "not found" days later.
  list.push({
    title: clean, date, note: '', city: '',
    accent: ACCENTS.includes(accent) ? accent : 'food',
  });
  return { events: list };
}

export function esc(s) {
  return String(s ?? '').replace(/[&<>"]/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

/* The fill for a day with events on it: one accent is a colour, two to four
   are a split of them (the same accent twice is one colour — a split of two
   identical halves says nothing the caption does not). There are only four
   accents, so every colour a day holds is in its fill. Also the swatch in
   the caption, so the line under the header wears the day it describes. */
export function dayFill(list) {
  const accents = [...new Set(list.map((e) => e.accent))];
  return {
    cls: accents.length > 1 ? ` n${accents.length}` : '',
    style: accents.map((a, i) => `--c${i + 1}:var(--${a})`).join(';'),
  };
}

/* Twelve months of markup. `start` is { year, month }, `today` and `selected`
   are "YYYY-MM-DD", `days` is eventDays(). Every month gets six rows, blank
   where it has fewer, so the four across line up and the grid does not jump
   when the window steps a year. */
export function monthsHtml({ start, count = 12, today, selected = null, days = new Map() }) {
  return monthsFrom(start.year, start.month, count).map(({ year, month }, i) => {
    const rows = monthGrid(year, month);
    // The year on the first month shown and on every January: the one place a
    // reader crossing New Year needs telling.
    const name = monthName(year, month)
      + (i === 0 || month === 0 ? ` <span>${year}</span>` : '');
    let cells = '<span class="cal-wk"></span>'
      + WEEKDAYS.map((w, c) => `<span class="cal-wd${c > 4 ? ' we' : ''}">${w}</span>`).join('');
    for (let r = 0; r < 6; r++) {
      const row = rows[r];
      cells += `<span class="cal-wk">${row ? row.week : ''}</span>`;
      for (let c = 0; c < 7; c++) {
        const cell = row && row.days[c];
        if (!cell || !cell.inMonth) { cells += '<span class="cal-d out"></span>'; continue; }
        let cls = 'cal-d';
        if (c > 4) cls += ' we';
        if (cell.iso === today) cls += ' today';
        if (cell.iso === selected) cls += ' sel';
        const list = days.get(cell.iso);
        // Every day of the month is a button, not only the coloured ones: a
        // day with nothing on it is exactly the day something is being added
        // to. The ones that are blank because they belong to the month before
        // or after are not — they are there to hold the columns, and that
        // month's own cell is the one to tap.
        let attrs = ` data-d="${cell.iso}" role="button" aria-label="${esc(dayLabel(cell.iso))}"`;
        if (list) {
          const fill = dayFill(list);
          cls += ` ev${fill.cls}${cell.iso < today ? ' past' : ''}`;
          attrs = ` data-d="${cell.iso}" style="${fill.style}" role="button"`
            + ` aria-label="${esc(`${dayLabel(cell.iso)}: ${list.map(dayLine).join(', ')}`)}"`;
        }
        cells += `<span class="${cls}"${attrs}>${cell.d}</span>`;
      }
    }
    return `<section class="cal-m${year === Number(today.slice(0, 4))
      && month === Number(today.slice(5, 7)) - 1 ? ' now' : ''}">
      <div class="cal-mn">${name}</div>
      <div class="cal-g">${cells}</div>
    </section>`;
  }).join('');
}

export default {
  ACCENTS, MAX_EVENTS, WEEKDAYS, isoDay, fromIso, addDays, daysBetween, anniversary,
  occurrence, shownTitle, timeLabel, familyTime, dayRange, minutesTo, countWords, upcoming, isoWeek,
  monthGrid, monthsFrom, monthName, rangeLabel, dayLabel, shiftFor, windowOf, eventDays, dayLine,
  withEvent, esc, dayFill, monthsHtml,
};
