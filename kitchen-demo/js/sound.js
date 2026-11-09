/* The sounds this house can make, and when it is allowed to make them.

   Two things make a noise on the wall now — the doorbell when the entrance
   door opens, and the clock at the top of each hour — and the household wants
   the same say over both: quiet hours in which nothing sounds at all, and a
   volume that is not the same at eight in the morning as it is at eight at
   night. Keeping that in one file is the point. Two dialects of "quiet hours"
   on one wall is one too many, and the rules below are the kind that go
   subtly wrong when they are written twice. What each of them sounds like is
   no longer shared: the bells are the doorbell's and the creatures the
   clock's (see SOUNDS).

   Nothing here touches the DOM and nothing here fetches — the rows it builds
   are strings, which the two sheets hang and wire themselves — so
   scripts/sound-rules-test.mjs can put a day through `volumeAt` without a
   browser. The players are the one exception and they only need `Audio`.

   The settings shape both features store (see backend/app/doorbell.py and
   backend/app/chime.py, which validate exactly these):

     quiet_on    false | true    are quiet hours in force at all
     quiet_from  20 21 22 23     the hour the quiet starts
     quiet_to    7 8 9 10 11     the hour it ends
     vol_morning 0..100          from the end of quiet until 10:00
     vol_day     0..100          10:00 until 20:00
     vol_evening 0..100          20:00 until the quiet starts

   The three bands are fixed at 10:00 and 20:00 on purpose. They were asked
   for as "morning, the day, and the evening", and a wall screen is not the
   place to be laying out arbitrary time ranges with a finger. */

/* The sounds, by the ids the server validates against (DOOR_SOUNDS and
   ANIMALS in backend/app/sound.py) — keep the two together.

   Two families, and since 2026-10-03 they no longer mix: the five bells are
   the doorbell's and only the doorbell's, the nine creatures (`animal: true`)
   the clock's. The household asked for the two to be separated, and it is
   what makes the wall legible from the next room — a bell always means the
   door, an animal always means the hour. `plays` is how many times
   one goes round, which is only ever more than once for the short single
   ding, whose half a second is not a doorbell from the other end of a
   kitchen. The two crane calls are cut out of longer recordings (the far one
   is one pair of calls lifted out of 79 seconds of a quiet field, which is
   why it sounds like distance). The farmyard three arrived 2026-09-22 and are
   cut the same way, each to a whole number of calls ending in the gap after
   one: three hee-haws of the donkey, two bleats of the goat, three croaks of
   the frog. A creature cut off mid-breath is the one thing that makes a
   recording sound like a recording. */
export const SOUNDS = [
  { id: 'ring', name: 'Ring', file: 'sounds/doorbell/ring.mp3', plays: 2 },
  { id: 'chime', name: 'Chime', file: 'sounds/doorbell/chime.mp3', plays: 1 },
  { id: 'buzzer', name: 'Buzzer', file: 'sounds/doorbell/buzzer.mp3', plays: 1 },
  { id: 'electronic', name: 'Electronic', file: 'sounds/doorbell/electronic.mp3', plays: 1 },
  { id: 'single', name: 'Single ring', file: 'sounds/doorbell/single.mp3', plays: 1 },
  { id: 'crane', name: 'Crane', file: 'sounds/doorbell/crane.mp3', plays: 1, animal: true },
  { id: 'crane-far', name: 'Cranes, far off', file: 'sounds/doorbell/crane-far.mp3', plays: 1, animal: true },
  { id: 'meow', name: 'Cat', file: 'sounds/doorbell/meow.mp3', plays: 1, animal: true },
  { id: 'owl', name: 'Owl', file: 'sounds/doorbell/owl.mp3', plays: 1, animal: true },
  { id: 'blackbird', name: 'Blackbird', file: 'sounds/doorbell/blackbird.mp3', plays: 1, animal: true },
  { id: 'crow', name: 'Crow', file: 'sounds/doorbell/crow.mp3', plays: 1, animal: true },
  { id: 'donkey', name: 'Donkey', file: 'sounds/doorbell/donkey.mp3', plays: 1, animal: true },
  { id: 'goat', name: 'Goat', file: 'sounds/doorbell/goat.mp3', plays: 1, animal: true },
  { id: 'frog', name: 'Frog', file: 'sounds/doorbell/frog.mp3', plays: 1, animal: true },
];

/* The sounds uploaded in the doorbell's and the clock's sheets (soundlib.js,
   2026-10-18): app.js hands over how to find one by its id. */
let resolve = () => null;
export function setResolver(fn) { resolve = fn; }

export function soundOf(id) {
  const own = SOUNDS.find((s) => s.id === id);
  if (own) return own;
  const up = resolve(id);
  return up ? { id: up.id, name: up.label, file: up.file, plays: 1, uploaded: true } : null;
}

/* "Animals", the clock's own last choice: not a sound but an instruction to
   take a different one of the nine creatures each hour. It is the clock's and
   not the doorbell's on purpose — a doorbell that answers in a different voice
   every time is a doorbell nobody learns, while an hour that does is the
   pleasant half of a cuckoo clock. The server keeps it as the stored `sound`
   of the chime and nothing else accepts it (chime.py). */
export const ANIMALS = 'animals';

export const animals = () => SOUNDS.filter((s) => s.animal);

/* The doorbell's sheet offers these and nothing else. */
export const doorSounds = () => SOUNDS.filter((s) => !s.animal);

/* Which creature this hour gets. Random, with one rule: never the same one
   twice running, because two identical hours in a row read as a stuck clock
   rather than as chance. With only one animal left to choose from it is that
   one, obviously. */
export function pickAnimal(last, ids = null) {
  // `ids`: the clock's own pool (chime.js, 2026-11-02) — the creatures and
  // its uploads, less the ones paused in its sheet. Empty: nothing to play.
  const all = ids || animals().map((s) => s.id);
  if (!all.length) return null;
  const pool = all.filter((id) => id !== last);
  const from = pool.length ? pool : all;
  return from[Math.floor(Math.random() * from.length)];
}

export const QUIET_FROM = [20, 21, 22, 23];
export const QUIET_TO = [7, 8, 9, 10, 11];

/* The volumes offered. Six is as many as a row of buttons can carry at a size
   that can be pressed from arm's length, and 0 is on the list because "this
   band, silent" is a thing somebody will want without wanting quiet hours. */
export const VOLUMES = [0, 20, 40, 60, 80, 100];

/* The band edges, in hours. Only the outer two move, and only with the quiet
   hours. */
const MORNING_ENDS = 10;
const EVENING_BEGINS = 20;

export const BANDS = ['morning', 'day', 'evening'];

const num = (v, fallback) => (Number.isFinite(Number(v)) ? Number(v) : fallback);

const oneOf = (v, allowed, fallback) => {
  const h = num(v, NaN);
  return allowed.includes(h) ? h : fallback;
};

/* Weekend nights (2026-10-03, the clock's). Quiet hours can be later at the
   weekend, and what belongs to the weekend is the NIGHT, not the calendar
   day: Friday's and Saturday's nights — later to bed, a lie-in after — are
   the weekend's, and Sunday's is a school night like the four before it. A
   night begins on the evening of its own day and ends on the morning of the
   next, so an hour before noon belongs to the night that began the evening
   before. Hence Friday 22:30 can sound while Sunday 22:30 cannot, and
   Saturday 08:00 keeps the weekend's quiet while Monday 08:00 has the week's.

   `quiet_from_we` / `quiet_to_we` are the weekend's two hours. Missing — the
   doorbell has none, and nor has a setting saved before they existed — they
   are the week's own, so nothing moves for anybody who has not set them. */
export function isWeekendNight(at = new Date()) {
  const began = new Date(at.getFullYear(), at.getMonth(),
    at.getDate() - (at.getHours() < 12 ? 1 : 0)).getDay();
  return began === 5 || began === 6;
}

export function quietFrom(s, { weekend = false } = {}) {
  const week = oneOf(s?.quiet_from, QUIET_FROM, 22);
  return weekend ? oneOf(s?.quiet_from_we, QUIET_FROM, week) : week;
}

export function quietTo(s, { weekend = false } = {}) {
  const week = oneOf(s?.quiet_to, QUIET_TO, 7);
  return weekend ? oneOf(s?.quiet_to_we, QUIET_TO, week) : week;
}

/* Is this instant inside the quiet hours?

   The evening half of a night is judged by when that night's quiet starts,
   the morning half by when it ends — noon is the seam, and any hour from
   11:00 to 19:00 would do as well, since quiet never starts before 20:00 or
   lasts past 11:00. That those are the only hours on offer (QUIET_FROM,
   QUIET_TO, and the server refuses others) is what makes every window wrap
   round midnight; a hand-edited file with anything else is read as the
   default here rather than as a window that silently means "never". */
export function isQuiet(s, at = new Date()) {
  if (!s || !s.quiet_on) return false;
  const weekend = isWeekendNight(at);
  const h = at.getHours();
  return h >= 12 ? h >= quietFrom(s, { weekend }) : h < quietTo(s, { weekend });
}

export function isWeekend(at = new Date()) {
  const d = at.getDay();
  return d === 0 || d === 6;
}

/* Which band an instant falls in — 'quiet' first, because quiet hours win
   over any volume set for the band they cover. */
export function bandAt(s, at = new Date()) {
  if (isQuiet(s, at)) return 'quiet';
  const h = at.getHours();
  if (h < MORNING_ENDS) return 'morning';
  if (h < EVENING_BEGINS) return 'day';
  return 'evening';
}

export function volumePct(s, band) {
  const v = num(s?.[`vol_${band}`], 100);
  return Math.max(0, Math.min(100, Math.round(v)));
}

/* How loud this instant is allowed to be, 0 (silent) to 1. The one number
   both features ask for, and the only one either of them should act on. */
export function volumeAt(s, at = new Date()) {
  const band = bandAt(s, at);
  if (band === 'quiet') return 0;
  return volumePct(s, band) / 100;
}

const hh = (h) => `${String(h % 24).padStart(2, '0')}:00`;

/* What a band covers, for the sheet to print under its buttons. A band can be
   empty — quiet until 11:00 leaves no morning at all — and saying so is the
   whole reason this is here: a volume that cannot ever apply should not look
   like one that does. `weekend` asks for the weekend's mornings (Saturday's,
   Sunday's) and evenings (Friday's, Saturday's), whose quiet can differ. */
export function bandRange(s, band, { weekend = false } = {}) {
  const on = !!(s && s.quiet_on);
  const from = quietFrom(s, { weekend });
  const to = quietTo(s, { weekend });
  if (band === 'morning') {
    const start = on ? to : 0;
    return start >= MORNING_ENDS ? null : `${on ? hh(to) : 'midnight'} – ${hh(MORNING_ENDS)}`;
  }
  if (band === 'day') return `${hh(MORNING_ENDS)} – ${hh(EVENING_BEGINS)}`;
  const end = on ? from : 24;
  return end <= EVENING_BEGINS ? null
    : `${hh(EVENING_BEGINS)} – ${on ? hh(from) : 'midnight'}`;
}

/* The one sentence the sheets put at the top: what the sound would do if it
   happened right now. It is the only feedback there is for a set of rules
   whose whole job is to do nothing. */
export function nowLine(s, { weekendSilent = false, at = new Date() } = {}) {
  if (weekendSilent && isWeekend(at)) return 'silent — it is the weekend';
  const band = bandAt(s, at);
  if (band === 'quiet') {
    return `silent until ${hh(quietTo(s, { weekend: isWeekendNight(at) }))} — quiet hours`;
  }
  const pct = volumePct(s, band);
  if (pct === 0) return `silent right now — ${band} is set to 0%`;
  return `right now: ${pct}%, the ${band} volume`;
}

/* The next hour the clock will be heard, for its card on House → More:
   `{ at, pct }`, or null when no hour in the coming week would sound at all —
   every band it can reach at 0%, or quiet hours and silent weekends leaving
   nothing between them. The hour striking now is not "next": it has happened
   or is happening, so this starts at the top of the one after.

   A week is far enough. The rules repeat every seven days, so an hour that
   does not sound in the next 168 will not sound in the 169th either. */
export function nextStrike(s, { weekendSilent = false, at = new Date() } = {}) {
  for (let i = 1; i <= 7 * 24; i += 1) {
    const h = new Date(at.getFullYear(), at.getMonth(), at.getDate(), at.getHours() + i);
    if (weekendSilent && isWeekend(h)) continue;
    const v = volumeAt(s, h);
    if (v > 0) return { at: h, pct: Math.round(v * 100) };
  }
  return null;
}

/* ------------------------------------------------------------- playing ----
   Chrome on the wall runs with --autoplay-policy=no-user-gesture-required, so
   this needs no tap behind it; a laptop that has never been touched may
   refuse, which is the one case where the hour passes in silence. There is no
   oscillator fallback on purpose — a doorbell that improvises a beep is not
   the sound anybody chose.

   One player per feature, so that the clock striking cannot cut off a
   doorbell halfway: they are two different pieces of news and the rare moment
   they collide is better as both than as neither. */
export function player() {
  return {
    els: {},          // one <audio> per sound, made on first use
    playing: null,

    /* `volume` is 0..1; 0 is silence and is not played at all, because an
       <audio> at volume 0 still occupies the element and still fires onended,
       and "it played, inaudibly" is not what the setting means. */
    play(id, volume = 1, { then = null } = {}) {
      const sound = soundOf(id) || SOUNDS[0];
      const vol = Math.max(0, Math.min(1, Number(volume)));
      this.stop();
      if (!(vol > 0)) return false;
      try {
        const el = (this.els[sound.id] ||= new Audio(sound.file));
        el.volume = vol;
        this.playing = el;
        let left = Math.max(1, sound.plays || 1) - 1;
        el.onended = () => {
          if (this.playing !== el) return;
          if (left-- <= 0) {
            // Played to its end: what comes after it (a voice, 2026-10-18).
            if (then) then(vol);
            return;
          }
          el.currentTime = 0;
          Promise.resolve(el.play()).catch(() => {});
        };
        el.currentTime = 0;
        Promise.resolve(el.play()).catch(() => {});
        return true;
      } catch {
        return false;   // no audio on this machine; the card still says it rang
      }
    },

    stop() {
      const el = this.playing;
      this.playing = null;
      if (!el) return;
      try { el.onended = null; el.pause(); el.currentTime = 0; } catch { /* already gone */ }
    },
  };
}

/* ---------------------------------------------------------- the rows ----
   The quiet-hours row and the three volume rows, as HTML, in the settings
   window kit's words (app.css, "the settings window kit"): a switch, and each
   hour or volume a bar of joined buttons beside its caption. Both sheets hang
   these in cards of their own and both wire them the same way they wire
   their own rows — every button here carries `data-put`, which is the one
   convention this dashboard's settings sheets share: one tap sets one value
   and saves it, because a wall screen has no Save button anybody would
   remember to press. Strings only, so scripts/sound-rules-test.mjs reads
   them in Node; the kit's helpers (sheetkit.js) are not imported here. */
const esc = (s) => String(s ?? '').replace(/[&<>"]/g,
  (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

const hourBtns = (key, hours, chosen) => hours.map((h) => `
  <button class="ls-btn${Number(chosen) === h ? ' on' : ''}" data-put="${key}" data-v="${h}"
          aria-pressed="${Number(chosen) === h}">${hh(h)}</button>`).join('');

/* One band's volume. The range is printed beside the name because the numbers
   only mean something next to the hours they cover, and an empty band — quiet
   until 11:00 leaves no morning — says so instead of offering six buttons
   that can never be reached. Silent is the bar's "none": chosen, it wears the
   kit's quiet fill, never the colour of a sound switched on. */
function volumeRow(s, band, name) {
  const range = bandRange(s, band);
  // The weekend's quiet hours move the outer bands' edges at the weekend
  // only; when they do, the band says both, and is empty only if it is empty
  // both times.
  const weekend = bandRange(s, band, { weekend: true });
  const ranges = range === weekend
    ? `<span class="snd-range">${range ? esc(range) : 'no hours left in this band'}</span>`
    : `<span class="snd-range">weekdays ${range ? esc(range) : 'no hours'}</span>
        <span class="snd-range">weekends ${weekend ? esc(weekend) : 'no hours'}</span>`;
  const pct = volumePct(s, band);
  return `
    <div class="sheet-band">
      <span class="snd-cap">${esc(name)}
        ${ranges}</span>
      ${range || weekend ? `<span class="ls-set sheet-seg sheet-hourbar snd-vol">${VOLUMES.map((v) => `
        <button class="ls-btn${pct === v ? ' on' : ''}${v === 0 ? ' sheet-none' : ''}" data-put="vol_${band}"
                data-v="${v}" aria-pressed="${pct === v}">${v === 0 ? 'Silent' : `${v}%`}</button>`).join('')}</span>` : ''}
    </div>`;
}

/* One night's two hours: From in the evening, Until in the morning. With
   `days`, each caption says which evenings and mornings it is — the weekend
   is Friday and Saturday NIGHT (see isWeekendNight), and "Weekends from"
   alone would read as Saturday and Sunday evening. */
function quietPair(s, { name = '', weekend = false, days = null } = {}) {
  const sfx = weekend ? '_we' : '';
  const cap = (word, when) => `<span class="snd-cap">${name ? `${esc(name)} ${word.toLowerCase()}` : word}${
    when ? `<span class="snd-range">${esc(when)}</span>` : ''}</span>`;
  return `
      <div class="sheet-band${weekend ? ' snd-weekend' : ''}">
        ${cap('From', days?.[0])}<span class="ls-set sheet-seg sheet-hourbar">${
          hourBtns(`quiet_from${sfx}`, QUIET_FROM, quietFrom(s, { weekend }))}</span>
      </div>
      <div class="sheet-band">
        ${cap('Until', days?.[1])}<span class="ls-set sheet-seg sheet-hourbar">${
          hourBtns(`quiet_to${sfx}`, QUIET_TO, quietTo(s, { weekend }))}</span>
      </div>`;
}

/* The rows one by one, for a sheet that hangs them in cards of its own:
   `quiet` (the switch and the hours), `weekend` (the clock's silent
   weekends; '' without `weekendKey`) and `loud` (the three bands).

   `quietNote` is the sentence after "…makes no sound between these
   hours", and is each sheet's own: what the doorbell goes on doing in its
   quiet hours (flashing the rooms) is nothing the clock does.

   `weekendQuiet` gives the weekend nights hours of their own (the clock's,
   2026-10-03): two pairs instead of one. The doorbell keeps one pair for the
   whole week, and its settings no weekend keys, so for it nothing differs.

   `inCards`: the cards' headings say "Quiet hours" and "How loud" already,
   so those two rows leave the names out and open with their hints. */
export function rulesParts(s, { what = 'it', weekendKey = '', quietNote = '', weekendQuiet = false,
                                inCards = false } = {}) {
  const on = !!(s && s.quiet_on);
  const lead = weekendQuiet
    ? `${esc(what)} makes no sound between these hours, which can be later at the
          weekend: Friday and Saturday nights are the weekend's, Sunday night is the
          week's.`
    : `${esc(what)} makes no sound between these two hours.`;
  const label = (name, hint) => (inCards
    ? `<span class="ls-label"><span class="db-hint sheet-lead">${hint}</span></span>`
    : `<span class="ls-label">${name}
        <span class="db-hint">${hint}</span></span>`);
  const silent = !!(weekendKey && s?.[weekendKey]);
  return {
    quiet: `
    <div class="ls-row">
      ${label('Quiet hours', `${lead}${quietNote ? ` ${esc(quietNote)}` : ''}`)}
      <div class="sheet-ctl">
        <button class="ls-btn sheet-switch${on ? ' on' : ''}" role="switch" aria-checked="${on}"
                data-put="quiet_on" data-v="${on ? 'false' : 'true'}">${on ? 'On' : 'Off'}</button>
        ${!on ? '' : weekendQuiet ? `
        ${quietPair(s, { name: 'Weekdays', days: ['Sun – Thu evening', 'Mon – Fri morning'] })}
        ${quietPair(s, { name: 'Weekends', weekend: true,
                         days: ['Fri – Sat evening', 'Sat – Sun morning'] })}` : quietPair(s)}
      </div>
    </div>`,

    weekend: weekendKey ? `
    <div class="ls-row">
      <span class="ls-label">Weekends
        <span class="db-hint">Saturday and Sunday, all day. Quiet hours still apply on
          top of this the rest of the week.</span></span>
      <span class="ls-set sheet-seg">
        <button class="ls-btn${silent ? '' : ' on'}" data-put="${esc(weekendKey)}" data-v="false"
                aria-pressed="${!silent}">Sounds</button>
        <button class="ls-btn sheet-none${silent ? ' on' : ''}" data-put="${esc(weekendKey)}" data-v="true"
                aria-pressed="${silent}">Silent</button>
      </span>
    </div>` : '',

    loud: `
    <div class="ls-row">
      ${label('How loud', `a different volume for each part of the day, because the
          kitchen at eight in the morning is not the kitchen at eight at night.`)}
      <div class="sheet-ctl">
        ${volumeRow(s, 'morning', 'Morning')}
        ${volumeRow(s, 'day', 'The day')}
        ${volumeRow(s, 'evening', 'Evening')}
      </div>
    </div>`,
  };
}

/* All of them in one string, the quiet hours first. */
export function rulesRows(s, opts = {}) {
  const p = rulesParts(s, opts);
  return `${p.quiet}${p.weekend}${p.loud}`;
}

/* The cards' notes (the settings window kit: a card's live state, beside its
   heading and under its name on the rail). Quiet hours: "22:00–08:00 ·
   weekends to 10:00", or "off"; with silent weekends "· weekends silent". */
export function quietNote(s, { weekendQuiet = false, weekendSilent = false } = {}) {
  const parts = [];
  if (s?.quiet_on) {
    const f = quietFrom(s);
    const t = quietTo(s);
    parts.push(`${hh(f)}–${hh(t)}`);
    if (weekendQuiet) {
      const fw = quietFrom(s, { weekend: true });
      const tw = quietTo(s, { weekend: true });
      if (fw !== f || tw !== t) parts.push(`weekends ${fw === f ? `to ${hh(tw)}` : `${hh(fw)}–${hh(tw)}`}`);
    }
  } else {
    parts.push('off');
  }
  if (weekendSilent) parts.push('weekends silent');
  return parts.join(' · ');
}

/* How loud: "morning 40 % · day 60 % · evening silent". A band with no hours
   left in it, weekdays or weekends, is left out. */
export function volumeNote(s) {
  return BANDS.filter((b) => bandRange(s, b) || bandRange(s, b, { weekend: true }))
    .map((b) => { const v = volumePct(s, b); return `${b} ${v ? `${v} %` : 'silent'}`; })
    .join(' · ');
}

/* How loud to play a sound somebody has just tapped to hear.

   Not `volumeAt`. Choosing a sound and hearing it are one tap on this wall,
   and a chooser that plays nothing because it is half past eleven at night is
   a chooser that looks broken — the rules are there to govern the door
   opening and the hour striking, not the audition. So a preview falls back to
   the loudest volume that is set anywhere in the day, and the sheet's own
   line above says what the real thing would do right now. */
export function previewVolume(s, at = new Date()) {
  const now = volumeAt(s, at);
  if (now > 0) return now;
  const loudest = Math.max(...BANDS.map((b) => volumePct(s, b)));
  return loudest > 0 ? loudest / 100 : 1;
}
