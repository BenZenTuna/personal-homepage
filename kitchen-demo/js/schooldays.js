/* The school board's arithmetic: which days to show, and what each one says.

   No DOM and no clock of its own. `now` is handed in, so the offline test
   (scripts/schoolboard-test.mjs) can stand on any day of the year, and the
   board, its sheet and the test all read the same answers.

   What it is given:
   - `board`, the school_board document (backend/app/schoolboard.py): the
     regular week, the dated items that live on the board only, the notices;
   - the countdown's events. The school's carry a `school` object holding the
     school's own dates, which the family's countdown date may differ from
     (they count down to the Friday before Höstlov, the school's break is the
     week after), so the school's dates are the ones used here.

   Everything it says is Swedish, as the letters are (Alex, 2026-10-02: "all
   school … information can be in its original language"). */

export const DAY_KEYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];   // Date.getDay() order

const pad2 = (n) => String(n).padStart(2, '0');

/* "2026-09-28" for a local date. Never toISOString(), which is UTC and names
   yesterday for the first hour or two of every day here. */
export function isoDay(d) {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

export function fromIso(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso || ''));
  if (!m) return null;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return d.getMonth() === Number(m[2]) - 1 ? d : null;
}

/* The next day by the calendar, not by adding 24 hours: on the two DST days
   a day is 23 or 25 hours long. */
function nextDay(iso) {
  const d = fromIso(iso);
  d.setDate(d.getDate() + 1);
  return isoDay(d);
}

function daysBetween(a, b) {
  return Math.round((fromIso(b) - fromIso(a)) / 86400000);
}

/* The letters a piece came from. A piece written before the lists were kept
   has only `letter`, the one that last changed it. */
const lettersOf = (o) => (o?.letters?.length ? o.letters : o?.letter ? [o.letter] : []);

/* Everything dated, from both places, in one shape. A countdown event also
   brings the date the family counts down to (`cdDate`), which the detail
   shows where it is not the school's. */
export function datedItems(board, events) {
  const out = [];
  for (const d of board?.days || []) {
    if (d && d.key && fromIso(d.date)) out.push({ ...d, letters: lettersOf(d), calendar: false });
  }
  for (const e of events || []) {
    const s = e && e.school;
    if (!s || !s.key) continue;
    const date = fromIso(s.date) ? s.date : e.date;
    if (!fromIso(date)) continue;
    out.push({
      key: s.key, title: e.title, date, end: s.end || '', note: e.note || '',
      info: s.info || '', bring: s.bring || [], start: s.start || '',
      finish: s.finish || '', time: s.time || '', off: !!s.off, instead: !!s.instead,
      activity: s.activity || '', calendar: true, accent: e.accent, id: e.id, cdDate: e.date, letters: lettersOf(s),
    });
  }
  return out.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
}

/* Letter ids, the newest first: by the board's own list of letters (sorted
   by date), then by id for any the list has let go of. */
export function newestFirst(ids, board) {
  const rank = Object.fromEntries((board?.letters || []).map((l, i) => [l.id, i]));
  return [...new Set((ids || []).filter(Boolean))].sort((a, b) =>
    ((rank[b] ?? -1) - (rank[a] ?? -1)) || (a < b ? 1 : a > b ? -1 : 0));
}

function itemsOn(items, iso) {
  return items.filter((i) => i.date <= iso && iso <= (i.end || i.date));
}

/* Easter Sunday, Gregorian: schoolboard.py _easter(), the same arithmetic. */
function easter(y) {
  const a = y % 19, b = Math.floor(y / 100), c = y % 100;
  const d = Math.floor(b / 4), e = b % 4, f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4), k = c % 4;
  const m = (32 + 2 * e + 2 * i - h - k) % 7;
  const n = Math.floor((a + 11 * h + 22 * m) / 451);
  const t = h + m - 7 * n + 114;
  return new Date(y, Math.floor(t / 31) - 1, (t % 31) + 1);
}

const RED = new Map();   // year → Map(iso → name)

/* Sweden's röda dagar, and the eves the country takes off: no school on any
   of them, whatever the letters say (2026-10-14, with the morning alarm,
   which keeps the same list — schoolboard.py red_days, pinned by
   scripts/school-days.cases.json). The name, or ''. */
export function redDay(iso) {
  const y = Number(String(iso).slice(0, 4));
  if (!RED.has(y)) {
    const e = easter(y);
    const off = (n) => isoDay(new Date(e.getFullYear(), e.getMonth(), e.getDate() + n));
    // The `weekday` (Sunday 0) on day `first` of month `mo` or the six after.
    const on = (mo, first, weekday) => {
      const d = new Date(y, mo - 1, first);
      d.setDate(first + ((weekday - d.getDay() + 7) % 7));
      return isoDay(d);
    };
    const midsummer = on(6, 20, 6);
    const md = fromIso(midsummer);
    RED.set(y, new Map([
      [`${y}-01-01`, 'Nyårsdagen'], [`${y}-01-06`, 'Trettondedag jul'],
      [off(-2), 'Långfredagen'], [off(0), 'Påskdagen'], [off(1), 'Annandag påsk'],
      [`${y}-05-01`, 'Första maj'], [off(39), 'Kristi himmelsfärdsdag'], [off(49), 'Pingstdagen'],
      [`${y}-06-06`, 'Sveriges nationaldag'],
      [isoDay(new Date(y, md.getMonth(), md.getDate() - 1)), 'Midsommarafton'], [midsummer, 'Midsommardagen'],
      [on(10, 31, 6), 'Alla helgons dag'],
      [`${y}-12-24`, 'Julafton'], [`${y}-12-25`, 'Juldagen'], [`${y}-12-26`, 'Annandag jul'],
      [`${y}-12-31`, 'Nyårsafton'],
    ]));
  }
  return RED.get(y).get(iso) || '';
}

/* The time most of the week starts (and ends) at. A start that differs from
   it is drawn in the board's colour, every week: Wednesday's 08:00 is the
   morning that gets forgotten. An end is drawn so only when a letter moves
   it (swimming, home at 14:00): Friday's 13:10 is every Friday, and a
   colour on every Friday says nothing. */
export function usual(board) {
  const most = (field) => {
    const n = {};
    for (const k of DAY_KEYS) {
      const v = board?.week?.[k]?.[field];
      if (v) n[v] = (n[v] || 0) + 1;
    }
    return Object.entries(n).sort((a, b) => b[1] - a[1])[0]?.[0] || '';
  };
  return { start: most('start'), end: most('end') };
}

function addBring(list, more) {
  for (const t of more || []) {
    if (t && !list.some((x) => x.toLowerCase() === String(t).toLowerCase())) list.push(String(t));
  }
}

/* What the board says about one day. `school` is a regular school day by the
   week; `off` is a day an item says there is no school, or a röd dag on a
   school weekday (offNote "Röd dag", no key: nothing to open). An item marked
   `instead` is the day itself (indoor PE cancelled, school at 08:20 on a
   Wednesday that is usually 08:00): the week's bag and note do not apply on
   it, and the week's times only where the item gives none. `insteadOf` is
   then the regular day it is not. */
export function dayPlan(board, items, iso, u = usual(board)) {
  const d = fromIso(iso);
  const base = board?.week?.[DAY_KEYS[d.getDay()]] || null;
  const on = itemsOn(items, iso);
  // A club's item (`activity`, a training) is on the day, but never says
  // what the school day is: schoolboard.py refuses it off/start/instead.
  const school = on.filter((i) => !i.activity);
  const red = base && !school.some((i) => i.off) ? redDay(iso) : '';
  const off = school.find((i) => i.off) || (red ? { title: red, note: 'Röd dag', key: '' } : null);
  const busy = on.filter((i) => i.activity || !i.off);
  const plan = {
    iso, school: !!base && !off, off: !!off,
    offTitle: off ? off.title : '', offNote: off ? off.note : '', offKey: off ? off.key : '',
    start: '', end: '', startChanged: false, endChanged: false,
    bring: [], weekNote: '', events: busy,
    // The regular day this one is (its weekday's entry in the week, with the
    // letters it came from), for the detail; null on a day with no school.
    base: base && !off ? { ...base, letters: lettersOf(base), day: DAY_KEYS[d.getDay()] } : null,
  };
  const own = busy.filter((i) => !i.activity);
  const instead = own.some((i) => i.instead);
  if (base && !off) {
    plan.start = own.find((i) => i.start)?.start || base.start;
    plan.end = own.find((i) => i.finish)?.finish || base.end;
    // Not the usual start, or not this weekday's own: Wednesday's 08:00 every
    // week, and the one Wednesday a letter puts back to 08:20.
    plan.startChanged = (!!u.start && plan.start !== u.start) || plan.start !== base.start;
    plan.endChanged = plan.end !== base.end;
    if (instead) {
      plan.insteadOf = plan.base;
    } else {
      plan.weekNote = base.note || '';
      addBring(plan.bring, base.bring);
    }
  }
  for (const i of busy) addBring(plan.bring, i.bring);
  return plan;
}

/* Swedish dates. The short month comes with a full stop ("okt."), which on a
   board of short lines is noise, so it goes. */
const sv = (d, o) => d.toLocaleDateString('sv-SE', o).replace(/\./g, '');
const cap = (t) => (t ? t[0].toUpperCase() + t.slice(1) : t);
const mon = (d) => sv(d, { month: 'short' });

/* "ons 14 okt" */
export function shortDay(iso) {
  return sv(fromIso(iso), { weekday: 'short', day: 'numeric', month: 'short' });
}

/* "Onsdag 7 oktober" */
export function longDay(iso) {
  return cap(sv(fromIso(iso), { weekday: 'long', day: 'numeric', month: 'long' }));
}

/* "7 okt" */
export function dayMonth(iso) {
  return sv(fromIso(iso), { day: 'numeric', month: 'short' });
}

/* The Monday of the week a day is in. */
export function weekStart(iso) {
  const d = fromIso(iso);
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  return isoDay(d);
}

/* The ISO week number, as the school's letters count them ("v. 43"). */
export function weekNo(iso) {
  const d = fromIso(iso);
  d.setDate(d.getDate() + 3 - ((d.getDay() + 6) % 7));       // that week's Thursday
  const jan4 = new Date(d.getFullYear(), 0, 4);
  return 1 + Math.round((daysBetween(isoDay(jan4), isoDay(d)) - 3 + ((jan4.getDay() + 6) % 7)) / 7);
}

/* 0 for a day this week (Monday to Sunday), 1 next week, and so on. */
export function weeksAhead(iso, now) {
  return Math.round(daysBetween(weekStart(isoDay(now)), weekStart(iso)) / 7);
}

/* "Idag", "Imorgon", "Onsdag" later THIS week, "ons 21 okt" from next week
   on. Until 2026-10-15 a weekday's name meant "within seven days", so on a
   Thursday next Wednesday read "Onsdag" under today, as if it were this
   week's (Alex: "it should be clear that some part of the card is for the
   next week"); the board puts a "Nästa vecka" line above it too. */
export function label(iso, now) {
  const n = daysBetween(isoDay(now), iso);
  if (n === 0) return 'Idag';
  if (n === 1) return 'Imorgon';
  if (n > 1 && weeksAhead(iso, now) === 0) return cap(sv(fromIso(iso), { weekday: 'long' }));
  return shortDay(iso);
}

/* "26–30 okt", "21 dec – 8 jan", or one day's label. */
export function spanLabel(from, to, now) {
  if (from === to) return label(from, now);
  const a = fromIso(from), b = fromIso(to);
  if (a.getMonth() === b.getMonth()) return `${a.getDate()}–${b.getDate()} ${mon(b)}`;
  return `${a.getDate()} ${mon(a)} – ${b.getDate()} ${mon(b)}`;
}

function minutes(hhmm) {
  const [h, m] = String(hhmm).split(':').map(Number);
  return h * 60 + m;
}

/* A school day with nothing to say: the usual times, nothing to bring,
   nothing on. */
export function plain(p) {
  return p.kind === 'day' && !p.bring.length && !p.events.length
    && !p.startChanged && !p.endChanged;
}

/* The days the board shows, nearest first.

   Today, all day, and then the days after it. Until 2026-10-13 today went
   once its school day ended (13:45), on the thought that by the evening
   tomorrow is the question — and took that evening's Föräldramöte (17:00)
   off the board with it. Alex: "keep all items that are for today until
   the next day"; tomorrow is right under it anyway. Weekends and empty days are passed
   over. A run of days off is one entry ("26–30 Oct · Höstlov"), with the
   weekends inside it, so a week's break is one line and not five.

   `skipPlain` is the board's: after the first day, only the days with
   something to say. Its room is a few lines under the countdown, and
   "Monday 08:20–13:45" pushed Wednesday's 08:00 and its PE bag off it. */
export function upcoming(board, items, now, { count = 5, horizon = 28, skipPlain = false } = {}) {
  const u = usual(board);
  const out = [];
  let iso = isoDay(now);

  for (let step = 0; step < horizon; step++, iso = nextDay(iso)) {
    const p = dayPlan(board, items, iso, u);
    // The break this day may carry on: the last one, with nothing after it
    // but the trainings inside it (a club that trains through Höstlov).
    let at = out.length - 1;
    while (at >= 0 && out[at].kind === 'day' && out[at].off) at--;
    const last = out[at];
    // The same break carries on, over a weekend too: one entry, made longer,
    // even when the list is already as long as it may be.
    if (p.off && last && last.kind === 'off' && last.title === p.offTitle
        && daysBetween(last.to, iso) <= 3) {
      last.to = iso;
    } else {
      if (out.length >= count) break;
      if (p.off) out.push({ kind: 'off', from: iso, to: iso, title: p.offTitle, note: p.offNote, key: p.offKey });
    }
    if (p.off) {
      // A day off from school is still a day a club has something on: it
      // stands under the break's line, so the break stays one line.
      if (p.events.length && out.length < count) out.push({ kind: 'day', ...p, label: label(iso, now) });
      continue;
    }
    if (!p.school && !p.events.length) continue;
    const day = { kind: 'day', ...p, label: label(iso, now) };
    if (skipPlain && out.length && plain(day)) continue;
    out.push(day);
  }
  // A break the horizon cut short still runs to its own end: seen from a
  // Tuesday, the board's nine days drew Höstlov 26–30 Oct as "26–28 okt".
  const brk = out.findLast((e) => e.kind === 'off');
  for (let d = brk && nextDay(brk.to); brk && daysBetween(brk.to, d) <= 3; d = nextDay(d)) {
    const p = dayPlan(board, items, d, u);
    if (p.off && p.offTitle === brk.title) brk.to = d;
  }
  for (const e of out) {
    if (e.kind === 'off') e.label = spanLabel(e.from, e.to, now);
  }
  return out;
}

/* The notices to show today, from their `from` until their `until`: the
   newest letter's first, in the order the letter gave them. */
export function activeNotices(board, now) {
  const today = isoDay(now);
  const rank = Object.fromEntries((board?.letters || []).map((l, i) => [l.id, i]));
  return (board?.notices || []).filter((n) => n && n.text && !n.done
    && (!n.from || n.from <= today) && (!n.until || n.until >= today))
    .sort((a, b) => (rank[b.letter] ?? -1) - (rank[a.letter] ?? -1));
}

/* The notices the family has ticked off (2026-10-13) and that would still be
   showing otherwise: the overview lists them, each with a way to undo. */
export function doneNotices(board, now) {
  const today = isoDay(now);
  return (board?.notices || []).filter((n) => n && n.text && n.done
    && (!n.until || n.until >= today));
}

export { cap };

/* Dated items after the days the board already shows, within `days`: what
   is coming that is not counted down to already. The ones in the calendar
   have their own chips right above the board. */
export function later(items, afterIso, now, { days = 21, calendar = false } = {}) {
  const end = isoDay(new Date(now.getFullYear(), now.getMonth(), now.getDate() + days));
  return items.filter((i) => (i.end || i.date) > afterIso && i.date <= end
    && (calendar || !i.calendar));
}

/* Whether there is a board to show at all. Without one the column keeps the
   twelve hours of weather it had before. */
export function hasContent(board, items, now) {
  if (!board) return false;
  if (DAY_KEYS.some((k) => board.week?.[k])) return true;
  const today = isoDay(now);
  return items.some((i) => (i.end || i.date) >= today) || activeNotices(board, now).length > 0;
}

const WEEK_ID = /^\d{4}-w(\d{1,2})$/i;

/* The newest letter, and whether it has gone stale: the school writes every
   Friday, so a letter more than ten days old means one was not given to the
   agent, and the board may be out of date. */
export function lastLetter(board, now) {
  const list = (board?.letters || []).filter((l) => fromIso(l.date));
  // The newest weekly letter ("2026-w41"); a document that came with one
  // ("2026-w41-halloween", an invitation) is not the week's letter.
  const weekly = list.filter((l) => WEEK_ID.test(l.id || ''));
  const l = weekly[weekly.length - 1] || list[list.length - 1];
  if (!l) return null;
  const week = WEEK_ID.exec(l.id || '')?.[1] || '';
  return { ...l, week, stale: daysBetween(l.date, isoDay(now)) > 10 };
}
