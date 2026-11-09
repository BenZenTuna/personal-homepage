/* The evening dimming ladder, as something you can drag.

   One sheet, two scopes. The gear on the Whole house row opens it on the
   house ladder; the gear in a room's light settings opens the same sheet on
   that room's, with a switch at the top between "follows the house" and a
   ladder of its own. Two editors for one idea would be two to keep in step,
   and the room one would be the one that fell behind.

   A step is a row: when it begins, how bright, how warm. The times are chips
   rather than a clock input because this is a wall screen and the question is
   "is half past eight better than nine", not "what is the exact minute" — and
   because sunset and sunrise have to sit in the same list as the hours, being
   the same kind of answer. Brightness and warmth are sliders you drag, not a
   handful of named levels: finding the one you like is the whole exercise.

   Every change saves itself. There is no Save button here, which is the
   wall's convention everywhere else (see sound.js) — but a list you add rows
   to has no single field to PUT, so what goes up is the whole ladder each
   time and the server sends back what it stored. A slider is saved when the
   finger comes off it, not while it moves.
*/

const SHEET_ID = 'lx-sheet';

/* What a step may begin at. Sunset and sunrise first because an evening
   ladder is really anchored to them — here the sun goes down at 22:00 in
   June and 15:30 in December, and a fixed hour cannot follow that — then
   the half hours somebody actually wants to experiment with. The household
   asked for 19:00 through 21:30 by name; the rest is the same ladder's worth
   of room on either side.

   Two rows since 2026-11-01 (Alex: "I can not add a step from like 6:00 or
   6:30 … sun rise becomes pretty late in swedish winters" — 08:40 in
   December): the evening, and the night and morning up to 09:00 with
   sunrise at its end. The server takes any HH:MM; a step's day is found by
   current_step(), so 06:00 is this morning's, after yesterday's 00:00. */
const WHENS_EVENING = [
  'sunset', '17:00', '17:30', '18:00', '18:30', '19:00', '19:30', '20:00', '20:30',
  '21:00', '21:30', '22:00', '22:30', '23:00', '23:30', '00:00', '00:30', '01:00',
];
const WHENS_MORNING = [
  '01:30', '02:00', '02:30', '03:00', '03:30', '04:00', '04:30', '05:00', '05:30',
  '06:00', '06:30', '07:00', '07:30', '08:00', '08:30', '09:00', 'sunrise',
];

const PCT_MIN = 1;
const PCT_MAX = 100;
const K_MIN = 2000;
const K_MAX = 6500;

// A new step lands somewhere useful rather than at midnight on nothing.
const NEW_STEP = { at: '21:00', offset: 0, pct: 60, k: 2700, hs: null };

/* The colours a step may set, for a lamp whose job is to be one — the Salon's
   accent spot. The same nine the rest of the wall offers, as [name, hue,
   saturation], so "Blue" means the same blue on a tile, in a light sheet and
   in a ladder. A lamp is a colour or a colour temperature and never both, so
   picking one here puts the warmth slider away. One differs: the tiles' and
   the light settings' Blue is 220° at 80% (panels/ha.js), this one 240° at
   100%; the light settings name both "Blue", so a lamp the ladder set reads
   the same in both sheets. */
const COLOURS = [
  ['Warm white', 30, 25], ['Peach', 20, 55], ['Red', 0, 90],
  ['Amber', 40, 85], ['Green', 120, 70], ['Teal', 175, 70],
  ['Blue', 240, 100], ['Violet', 275, 70], ['Pink', 320, 70],
];

const HOUSE = '__house__';

const sameHs = (a, b) => (!a && !b) || (!!a && !!b
  && Math.round(a[0]) === Math.round(b[0]) && Math.round(a[1]) === Math.round(b[1]));

/* When a wake-up may start. Quarter hours across the mornings anybody in this
   house gets up in — a wake-up light is set once and nudged, so a grid of
   real times beats a clock control you have to aim at on a wall. */
const WAKE_ATS = [];
for (let h = 4; h <= 10; h += 1) {
  for (const m of ['00', '15', '30', '45']) WAKE_ATS.push(`0${h}`.slice(-2) + ':' + m);
}
// How long the climb takes. Twenty minutes is the usual advice; the rest is
// there because the only way to find out is to try it for a week.
const WAKE_MINS = [5, 10, 15, 20, 30, 45, 60, 90];
const DAY_NAMES = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
/* A light on motion (2026-11-01): from when, until when, and how long after
   the last motion it goes out. lights.py MOTION_* and motion_window(). */
const MOTION_FROMS = ['sunset', '16:00', '17:00', '18:00', '18:30', '19:00', '19:30', '20:00', '20:30',
  '21:00', '21:30', '22:00', '22:30', '23:00', '23:30', '00:00', '00:30', '01:00'];
// Off at a fixed time (lights.py MOTION_OFF_AT_RE): the sensors only say
// somebody is home. null, the first chip, is "after the minutes" instead.
const MOTION_OFF_ATS = [null, '16:00', '17:00', '18:00', '19:00', '20:00', '21:00', '22:00', '23:00', '24:00'];
const MOTION_UNTILS = ['04:00', '05:00', '05:30', '06:00', '06:30', '07:00', '07:30', '08:00', 'sunrise'];
const MOTION_OFFS = [1, 2, 3, 5, 10, 15, 30, 60];
/* How long a woken lamp stays on once it is fully bright, before it goes off
   by itself. Asked for after a school morning's wake-up left a child's lamp
   on until somebody came home; null, the first chip, is "stays on". */
const WAKE_OFFS = [null, 15, 30, 45, 60, 90, 120, 180];

// "1 h 30 min" rather than "90 min", for anything an hour or longer.
function minsText(m) {
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  return `${h} h${m % 60 ? ` ${m % 60} min` : ''}`;
}

// A clock time plus minutes, as HH:MM — "06:45" + 90 is "08:15".
function addMins(hhmm, mins) {
  const [h, m] = hhmm.split(':').map(Number);
  const t = (h * 60 + m + mins) % (24 * 60);
  return `${String(Math.floor(t / 60)).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`;
}

function esc(s) {
  return String(s).replace(/[&<>"]/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

// How far along its track a brightness is, 0–1: the lit part of the
// slider (--fill, app.css "light settings").
const fill = (v) => ((Number(v) - PCT_MIN) / (PCT_MAX - PCT_MIN)).toFixed(3);

// "2026-10-26" as "Mon 26 Oct", the school alert's way of writing a morning.
function dayText(iso) {
  const [y, m, d] = String(iso).split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });
}

/* What a wake-up's next chosen morning does, from the server's `wake_next`
   (lights.py _wake_next): "Next morning Mon 26 Oct: no school (Höstlov),
   stays off — on again Mon 2 Nov at 06:45." '' from a server without it.
   Exported for lights-test.py, which runs it on the server's own answers. */
export function wakeNextText(nx, schoolOnly, now = new Date()) {
  if (!nx || !nx.date) return '';
  const iso = (t) => `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, '0')}-${String(t.getDate()).padStart(2, '0')}`;
  const tomorrow = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
  const which = nx.date === iso(now) ? 'This morning' : nx.date === iso(tomorrow) ? 'Tomorrow' : 'Next morning';
  const when = `${which} <b>${esc(dayText(nx.date))}</b>`;
  if (!nx.runs) {
    const off = `${when}: no school${nx.why ? ` (${esc(nx.why)})` : ''}, stays off`;
    if (nx.comes_on) return `${off} — on again ${esc(dayText(nx.comes_on))} at ${esc(nx.at)}.`;
    /* Not one chosen morning with school in the server's look-ahead
       (WAKE_LOOK_DAYS, 100 days): only weekend days chosen, most likely.
       Said plainly, or a wake-up that never runs reads like one that only
       skips the next morning. */
    return `${off}. None of the chosen days has school in the coming months, so as
      it is set it does not come on at all: <b>Every chosen day</b> makes it come on.`;
  }
  if (nx.school) return `${when}: a school day, comes on at ${esc(nx.at)}.`;
  if (schoolOnly) {
    return `${when}: comes on at ${esc(nx.at)}. The school board has no school week on it,
      so until it does the wake-up runs on every chosen day.`;
  }
  return `${when}: comes on at ${esc(nx.at)}, school or not.`;
}

export default {
  doc: null,
  scope: null,          // null = the house, otherwise a room's entity id
  sheet: null,
  /* The ladder's nine, for the light settings (panels/ha.js colourWord) to
     name a lamp the ladder set: its Blue is not the tiles' (see COLOURS). */
  colours: COLOURS,

  init(ctx) {
    this.ctx = ctx;
    this.buildSheet();
    ctx.bus.on('lights_schedule', (d) => {
      this.doc = d;
      // Never while a finger is on a slider: the server echoes the ladder
      // back on every save, and redrawing then would take the handle away
      // mid-drag. The values in flight are this browser's own anyway.
      if (this.isOpen() && !this.dragging) this.render();
    });
  },

  isOpen() {
    return !!(this.sheet && this.sheet.classList.contains('open'));
  },

  /* The settings window kit (app.css, js/sheetkit.js): a card per step, so
     the rail down the wall's left edge reads as the ladder itself — "From
     ☾ sunset, 100% at 2700 K", "From 19:30, 70%" — and a tap there finds
     the step. The answer to Apply now (.lx-note) stands under the title, in
     place of the status line for a few seconds, where the eye is after the
     button beside it; at the foot of the body it was off screen. */
  buildSheet() {
    const el = document.createElement('div');
    el.id = SHEET_ID;
    el.className = 'sheet sheet-full';   // the settings window kit (app.css); its step cards want the wall's width
    el.innerHTML = `
      <header>
        <span class="sheet-icon" aria-hidden="true">🕰️</span>
        <div class="sheet-title">
          <h2 class="lx-title">Lights by the clock</h2>
          <span class="sheet-status lx-now"></span>
          <span class="lx-note" role="status" hidden></span>
        </div>
        <span class="lx-scope"></span>
        <span class="spacer"></span>
        <button class="ls-btn sheet-primary lx-apply">Apply now</button>
        <button class="ls-close">Close</button>
      </header>
      <div class="ls-body lx-body"></div>`;
    document.body.appendChild(el);
    this.sheet = el;
    this.body = el.querySelector('.lx-body');
    el.querySelector('.ls-close').onclick = () => this.close();
    el.querySelector('.lx-apply').onclick = () => this.applyNow();
  },

  open(scope) {
    this.scope = scope || null;
    this.sheet.classList.add('open');
    this.render();
    // Its top, whichever scope it was left at the foot of.
    this.body.scrollTop = 0;
    // The snapshot on the bus is seeded at boot, but a wall that has been up
    // for a week has the one from then; ask for a fresh one on the way in.
    this.refresh();
  },

  /* A fresh ladder from the server, redrawn here if this sheet is open. The
     server pushes lights_schedule on a save, not when a step's hour comes,
     so whoever states the ladder's "now" (a room's light settings too) asks
     first. Resolves either way; a failure keeps the snapshot it had. */
  refresh() {
    return fetch('/api/lights/schedule').then((r) => (r.ok ? r.json() : null)).then((d) => {
      if (!d || typeof d !== 'object') return;
      this.doc = d;
      if (this.isOpen() && !this.dragging) this.render();
    }).catch(() => {});
  },

  close() {
    this.sheet.classList.remove('open');
  },

  /* ---------------- reading the document ---------------- */

  roomLabel(entity) {
    if (entity === '__house__') return 'the whole house';
    const r = this.known(entity);
    return r ? r.label : entity;
  },

  known(entity) {
    return (this.doc?.known || []).find((x) => x.entity === entity) || null;
  },

  // The room a lamp is part of — the Salon, for its two colour lamps.
  parentOf(entity) {
    const r = this.known(entity);
    return r && r.part_of ? this.known(r.part_of) : null;
  },

  /* A room and the lamps inside it, as one row of chips at the top of the
     sheet whichever of them is open. The Salon's colours are the Salon's,
     and the Salon's settings are where anybody goes looking for them — they
     used to be a tile on More that nothing on the Salon mentioned. */
  family() {
    if (!this.scope) return null;
    const head = this.parentOf(this.scope) || this.known(this.scope);
    if (!head) return null;
    const kids = (this.doc?.known || []).filter((x) => x.part_of === head.entity);
    return kids.length ? { head, kids } : null;
  },

  /* Whether the lamps this ladder is sent to can show a colour at all. The
     server reads it off what Home Assistant says each lamp supports; not
     known yet counts as yes, because hiding a control that works is worse
     than showing one that does not. The house's ladder goes to every room,
     so a colour there is not offered. */
  canColour() {
    if (!this.scope) return false;
    const r = this.known(this.scope);
    return !r || r.colour !== false;
  },

  // One step's level in words: "Blue · 40%", "45% at 2200 K", "45%".
  levelText(step) {
    if (!step || step.pct == null) return 'left alone';
    if (step.hs) return `${this.colourName(step.hs)} · ${step.pct}%`;
    if (this.common()) return `${this.colourName(this.common())} · ${step.pct}%`;
    return `${step.pct}%${step.k ? ` at ${step.k} K` : ''}`;
  },

  // What this room has been given: a list of steps of its own, a link to
  // somebody else's hours, or nothing at all (it follows the house).
  entry() {
    if (!this.scope || !this.doc) return null;
    return (this.doc.rooms || {})[this.scope] || null;
  },

  // Linked: the hours are another ladder's, the levels are this lamp's own.
  linked() {
    const e = this.entry();
    return e && !Array.isArray(e) && e.times_from ? e.times_from : null;
  },

  /* The rungs to draw. Anything that is not a list of the room's own —
     a link, a lamp going with its room, a room following the house — is
     drawn from the resolved copy the server sends: it already knows how to
     follow each of those, and working it out again here would be a second
     answer to the same question. */
  steps() {
    if (!this.doc) return [];
    if (!this.scope) return this.doc.house || [];
    const own = this.entry();
    if (Array.isArray(own)) return own;
    const eff = (this.doc.effective || {})[this.scope] || this.doc.house || [];
    /* Linked: the hours from the resolved copy, the levels from the lamp's
       own entry. The resolved copy has the common colour filled into every
       step without one, and saving those back would make it each step's own
       — changing the common colour later would then change nothing. The
       same carry-the-last-level rule as the server's _effective(). */
    if (own && own.times_from) {
      const vals = own.steps || [];
      return eff.map((st, i) => {
        const v = i < vals.length ? vals[i] : vals[vals.length - 1] || null;
        return { ...st, pct: v ? v.pct : null, k: v ? v.k : null, hs: v ? v.hs : null };
      });
    }
    // Followed: the lamp's common colour is in there too; take it back out.
    const c = this.common();
    return c ? eff.map((st) => (sameHs(st.hs, c) ? { ...st, hs: null } : st)) : eff;
  },

  /* The lamp's common colour: on every step that names none of its own
     (lights.py `colours`). Only a lamp's; the house has none. */
  common() {
    if (!this.scope || !this.doc) return null;
    return (this.doc.colours || {})[this.scope] || null;
  },

  saveCommon(hs) {
    const all = { ...(this.doc.colours || {}) };
    if (hs) all[this.scope] = hs; else delete all[this.scope];
    return this.save({ colours: all });
  },

  // Is this room on anything of its own, linked or not?
  personal() {
    return !!this.entry();
  },

  // The ladders a link may borrow its hours from: the house, and any room
  // that keeps hours of its own. Never this room — see the server.
  sources() {
    const out = [{ key: HOUSE, label: 'the house' }];
    // The room a lamp is in, whatever that room's hours come from: a lamp
    // borrowing the Salon's hours means the Salon's, even while the Salon
    // is only following the house.
    const parent = this.parentOf(this.scope);
    for (const r of this.doc?.known || []) {
      if (r.entity === this.scope) continue;
      if (Array.isArray((this.doc.rooms || {})[r.entity]) || r.entity === parent?.entity) {
        out.push({ key: r.entity, label: r.label });
      }
    }
    return out;
  },

  // What to call a step's colour, so the line above the swatches is a word
  // rather than two numbers.
  colourName(hs) {
    if (!hs) return 'none';
    const hit = COLOURS.find(([, h]) => Math.round(hs[0]) === h);
    return hit ? hit[0] : `hue ${Math.round(hs[0])}°`;
  },

  sourceLabel(key) {
    return (this.sources().find((x) => x.key === key) || {}).label || key;
  },

  /* ---------------- the pause ----------------
     A room on pause is left to its switch and Home Assistant: no step, no
     catch-up as it comes on, no putting back. The server says whose pause
     holds a room — its own, or the room a lamp is part of — so the answer is
     worked out once. */
  pausedBy(entity) {
    return ((this.doc?.now || {})[entity] || {}).paused_by || null;
  },

  pausedSince(entity) {
    return (this.doc?.paused || {})[entity] || null;
  },

  /* The whole house paused (the Whole house row's ⏸, or Paused on this
     sheet): every room is left to its switch, whatever the ladder says. The
     server's now.__house__.paused_by says so; its paused list too. */
  housePaused() {
    return !!(((this.doc?.now || {})[HOUSE] || {}).paused_by || (this.doc?.paused || {})[HOUSE]);
  },

  /* "20:15", "yesterday 20:15", "Sat 20:15": a pause stays until somebody
     takes it off, and one forgotten for days has to say so. The server's
     "2026-09-28T20:15" has no offset, which a browser reads as local time —
     the same clock the server wrote it by. */
  sinceText(iso) {
    const t = iso ? new Date(iso) : null;
    if (!t || Number.isNaN(t.getTime())) return '';
    const hm = `${String(t.getHours()).padStart(2, '0')}:${String(t.getMinutes()).padStart(2, '0')}`;
    const day = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
    const ago = Math.round((day(new Date()) - day(t)) / 864e5);
    if (ago <= 0) return hm;
    if (ago === 1) return `yesterday ${hm}`;
    if (ago < 7) return `${DAY_NAMES[(t.getDay() + 6) % 7]} ${hm}`;
    return `${t.getDate()}/${t.getMonth() + 1} ${hm}`;
  },

  /* Its own route, never the PUT: nothing that saves the rest of the
     schedule can take a pause off by not knowing about it. Resume answers
     with how many lit rooms it put back on their step.

     Answers { ok, text }, `text` being what to tell somebody. This sheet
     shows it on its note line; a Pause tapped in a room's light settings,
     with this sheet shut, is shown there by the caller. The sheet is drawn
     again whatever happened — after a failure that is what gives the
     button back. */
  async setPause(entity, paused) {
    let ok = false;
    let text = '';
    try {
      const r = await fetch('/api/lights/schedule/pause', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ entity, paused }),
      });
      const d = await r.json().catch(() => ({}));
      if (d && d.schedule) this.doc = d.schedule;
      ok = r.ok;
      if (!r.ok) text = (d && d.error) || 'That could not be changed.';
      else if (!paused) {
        text = !this.doc?.enabled
          ? 'Back on its ladder — but the whole ladder is off, so nothing is set until it is on again.'
          : d.changed
            ? 'Back on its ladder, at the step the clock is in.'
            : 'Back on its ladder. It takes its step when it next comes on.';
      }
    } catch {
      text = 'That could not be changed — the dashboard is not answering.';
    }
    if (this.isOpen() && !this.dragging) this.render();
    if (this.isOpen() && text) this.note(text);
    return { ok, text };
  },

  /* "paused since 20:15", or "paused with Salon since 20:15" for a lamp held
     by its room's pause; '' when nothing holds it. */
  pauseText(entity) {
    const pb = this.pausedBy(entity);
    if (!pb) return '';
    const since = this.sinceText(this.pausedSince(pb));
    return `paused${pb === entity ? '' : ` with ${this.roomLabel(pb)}`}${since ? ` since ${since}` : ''}`;
  },

  /* One line for the room's own settings sheet: is it following the house,
     and what is it at just now. Asked by panels/ha.js rather than worked out
     there, so the two never give different answers to the same question. */
  summaryFor(entity) {
    if (!this.doc || !entity) return '';
    // The pause first, even with the whole ladder off: the tile carries its
    // mark either way, and the settings must not say less than the tile.
    const paused = this.pauseText(entity);
    if (!this.doc.enabled) return paused ? `${paused} · the ladder is off` : 'the ladder is off';
    const entry = (this.doc.rooms || {})[entity];
    const own = !!entry;
    const parent = this.parentOf(entity);
    const now = (this.doc.now || {})[entity] || {};
    const at = now.step && now.step.pct != null
      ? `${this.levelText(now.step)} now`
      : 'nothing set just now';
    // The words of the choice made in its sheet, linked hours included.
    const whose = own && !Array.isArray(entry) && entry.times_from ? 'same hours, own levels'
      : own ? 'its own ladder' : parent ? `goes with ${parent.label}` : 'follows the house';
    if (paused) return `${paused} · ${whose}`;
    return `${whose} · ${at}`;
  },

  /* A lamp's evening in one line, for the button that opens it from its
     room's settings: "Blue · 100% from sunset, 40% from 20:30, …". Only the
     steps that set something; a lamp with none says what it goes with. */
  planFor(entity) {
    if (!this.doc || !entity) return '';
    const paused = this.pauseText(entity);
    const plan = this.planText(entity);
    return paused ? `${paused} · ${plan}` : plan;
  },

  planText(entity) {
    const own = (this.doc.rooms || {})[entity];
    if (!own) {
      const parent = this.parentOf(entity);
      return parent ? `goes with ${parent.label}` : 'follows the house';
    }
    const when = (s) => (s.offset ? `${s.at}${s.offset > 0 ? '+' : ''}${s.offset}` : s.at);
    const steps = ((this.doc.effective || {})[entity] || []).filter((s) => s.pct != null);
    if (!steps.length) return 'nothing set';
    // One colour all evening is said once, not on every step.
    const names = new Set(steps.map((s) => (s.hs ? this.colourName(s.hs) : '')));
    if (names.size === 1 && steps[0].hs) {
      return `${this.colourName(steps[0].hs)}: ${steps.map((s) => `${s.pct}% from ${when(s)}`).join(', ')}`;
    }
    return steps.map((s) => `${this.levelText(s)} from ${when(s)}`).join(', ');
  },

  /* ---------------- saving ---------------- */

  /* The whole document every time, and the server's cleaned-up copy adopted
     from the answer. `keep` leaves the rows on screen exactly as they are —
     used while a slider is moving, where re-rendering would be the one thing
     that must not happen. */
  async save(patch, keep = false) {
    const body = { ...patch };
    try {
      const r = await fetch('/api/lights/schedule', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const d = await r.json();
      if (d && d.schedule) {
        this.doc = d.schedule;
        if (!keep && this.isOpen()) this.render();
      }
    } catch {
      this.note('That could not be saved — the dashboard is not answering.');
    }
  },

  // Save a changed ladder, into the house or into this room, whichever is
  // being edited. One place, so no caller has to know which scope it is in.
  saveSteps(steps, keep = false) {
    if (!this.scope) return this.save({ house: steps }, keep);
    const from = this.linked();
    // Linked: only the levels are this lamp's to save. The hours go back
    // where they came from, and writing them here would quietly unlink it.
    const entry = from
      ? { times_from: from, steps: steps.map((x) => ({ pct: x.pct, k: x.k, hs: x.hs })) }
      : steps;
    return this.save({ rooms: { ...(this.doc.rooms || {}), [this.scope]: entry } }, keep);
  },

  async applyNow() {
    const btn = this.sheet.querySelector('.lx-apply');
    btn.disabled = true;
    try {
      const r = await fetch('/api/lights/schedule/apply', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(this.scope ? { entity: this.scope } : {}),
      });
      const d = await r.json();
      if (d.paused) { this.note('Paused here — resume it to put it at its step.'); return; }
      this.note(d.changed
        ? `Put ${d.changed} lit room${d.changed === 1 ? '' : 's'} at its step.`
        : 'Nothing is on to change.');
    } catch {
      this.note('That could not be applied.');
    } finally {
      // Still off for a paused room, or the whole house paused: there is
      // nothing here to apply.
      btn.disabled = this.scope ? !!this.pausedBy(this.scope) : this.housePaused();
    }
  },

  note(text) {
    const el = this.sheet.querySelector('.lx-note');
    if (!el) return;
    el.textContent = text || '';
    el.hidden = !text;
    clearTimeout(this._noteT);
    if (text) this._noteT = setTimeout(() => { el.hidden = true; }, 6000);
  },

  /* ---------------- drawing ---------------- */

  /* The header's line (the settings window kit): the whole ladder on or
     off, its steps and what is in force; for a room, what it follows and
     what it is at (summaryFor, the same words its light settings use), and
     its wake-up when that is on. */
  headLine() {
    const d = this.doc || {};
    if (!this.scope) {
      const n = (d.house || []).length;
      const now = (d.now || {}).__house__ || {};
      const ps = Object.keys(d.paused || {}).filter((e) => e === '__house__' || this.known(e)).length;
      /* The whole house paused, the ladder on: nothing is set in any room,
         so the line leads with that rather than with a level nobody gets. */
      if (d.enabled && this.housePaused()) {
        const since = this.sinceText(this.pausedSince(HOUSE));
        const more = Object.keys(d.paused || {}).filter((e) => e !== HOUSE && this.known(e)).length;
        return ['<b>Paused</b>', `the whole house${since ? ` since ${esc(since)}` : ''}`,
          `${n} ${n === 1 ? 'step' : 'steps'}`, more ? `${more} more paused` : ''].filter(Boolean).join(' · ');
      }
      return [`<b>${d.enabled ? 'On' : 'Off'}</b>`, `${n} ${n === 1 ? 'step' : 'steps'}`,
        d.enabled ? (now.step && now.step.pct != null ? `${esc(this.levelText(now.step))} now` : 'nothing set just now') : '',
        ps ? `${ps} paused` : ''].filter(Boolean).join(' · ');
    }
    const parts = this.summaryFor(this.scope).split(' · ').filter(Boolean);
    const first = parts.shift() || '';
    const w = this.wake();
    return [first ? `<b>${esc(first.charAt(0).toUpperCase() + first.slice(1))}</b>` : '',
      ...parts.map(esc), w && w.on && d.enabled ? `wake-up ${esc(w.at)}` : '',
      this.motion()?.on && d.enabled ? `on motion from ${esc(this.motion().from)}` : ''].filter(Boolean).join(' · ');
  },

  headTone() {
    const d = this.doc || {};
    if (!d.enabled || (this.scope ? this.pausedBy(this.scope) : this.housePaused())) return 'off';
    return 'ok';
  },

  /* "Mon–Fri", "Sat, Sun", "every day": the wake-up card's note. */
  daysText(days) {
    const ds = [...(days || [])].sort((a, b) => a - b);
    if (!ds.length) return 'no days';
    if (ds.length === 7) return 'every day';
    const run = ds.length > 2 && ds.every((x, i) => !i || x === ds[i - 1] + 1);
    return run ? `${DAY_NAMES[ds[0]]}–${DAY_NAMES[ds[ds.length - 1]]}` : ds.map((x) => DAY_NAMES[x]).join(', ');
  },

  /* The house's master switch as the kit's state sentence: what is in force
     now, with the switch beside it, and what Off does. */
  sumCard(now) {
    const kit = this.ctx.sheetkit;
    const d = this.doc;
    const since = now.since ? esc(now.since) : '';
    const ctl = kit.toggle(!!d.enabled, `data-v="${d.enabled ? '0' : '1'}"`, { cls: 'lx-en' });
    const offNext = `Off leaves every room exactly as it is, everywhere, without
        forgetting a single step you have set up here.`;
    /* The whole house paused: the ladder is on, but it sets nothing in any
       room until the pause comes off, so what is "in force" is what Resume
       will do, not what the rooms are being given. A room with a ladder of
       its own goes to its own step then, and one paused by itself stays
       paused (lights.py _resume). */
    const hp = this.housePaused();
    const hpSince = hp ? this.sinceText(this.pausedSince(HOUSE)) : '';
    if (d.enabled && hp) {
      const level = now.step && now.step.pct != null ? esc(this.levelText(now.step)) : '';
      const own = Object.keys(d.rooms || {}).some((e) => this.known(e));
      const alone = Object.keys(d.paused || {}).some((e) => e !== HOUSE && this.known(e));
      const next = (level
        ? `Resume puts every lit room at <b>${level}</b>, the step the clock is in${
          own ? ' (a room with a ladder of its own at its own step)' : ''}.`
        : !now.step ? 'Resume puts every room back on its ladder — but the house ladder is empty.'
        : 'Resume puts every room back on its ladder; the step in force just now sets nothing.')
        + (alone ? ' A room paused on its own stays paused.' : '');
      return kit.sum(`On — but the whole house is paused${hpSince ? ` since <b>${esc(hpSince)}</b>` : ''}:
        nothing is set in any room until it is resumed.`, { next, ctl, cap: 'The ladder' });
    }
    const says = !d.enabled ? 'Off — nothing is set by the clock.'
      : !now.step ? 'On — but no step is in force: the ladder is empty.'
      : now.step.pct == null ? `On — nothing is being set just now${since ? ` (since <b>${since}</b>)` : ''}.`
      : `On — in force now: <b>${esc(this.levelText(now.step))}</b>${since ? `, since <b>${since}</b>` : ''}.`;
    return kit.sum(says, {
      // Off with the whole house paused as well: switching it on is not
      // the whole story, and the sentence says so.
      next: !d.enabled && hp ? `${offNext} The whole house is paused too${
        hpSince ? ` (since <b>${esc(hpSince)}</b>)` : ''}: switched on, it sets nothing until that is resumed.` : offNext,
      ctl, cap: 'The ladder', off: !d.enabled,
    });
  },

  render() {
    if (!this.doc) return;
    const kit = this.ctx.sheetkit;
    const d = this.doc;
    const room = this.scope;
    const personal = this.personal();
    const linked = this.linked();
    // A lamp inside a room — one of the Salon's colour lamps — goes with
    // that room's steps when it has none of its own, not with the house's.
    const parent = room ? this.parentOf(room) : null;
    const fam = this.family();
    /* Whose rungs are on screen, and what can be done to them here.
       'edit' is the room's own list. 'linked' is somebody else's hours with
       this lamp's own levels, so the levels move and the hours do not. 'view'
       is a room following the house, or a lamp going with its room: shown so
       it can be read, and nothing on it moves — the first drag would have
       quietly given the room a ladder of its own and nobody would have been
       told. The card above says so and offers the button that changes it. */
    const mode = linked ? 'linked' : (room && !personal) ? 'view' : 'edit';
    const steps = this.steps();
    const sun = d.sun || {};
    const now = (d.now || {})[room || '__house__'] || {};
    // Whose pause holds this room, if any: its own, or its room's.
    const pb = room ? this.pausedBy(room) : null;
    const pOwn = !!pb && pb === room;
    const pSince = pb ? this.sinceText(this.pausedSince(pb)) : '';
    const pWho = pb && !pOwn ? esc(this.roomLabel(pb)) : '';
    this.sheet.querySelector('.lx-apply').disabled = room ? !!pb : this.housePaused();
    // The step cards want the wall's width; a ladder only followed is a list
    // of lines, which reads in the kit's column.
    this.sheet.classList.toggle('sheet-full', mode !== 'view');

    this.sheet.querySelector('.lx-scope').textContent =
      room ? this.roomLabel(room) : 'the whole house';
    kit.status(this.sheet.querySelector('.lx-now'), this.headLine(), this.headTone());

    const capped = !!(d.sunrise_latest && sun.morning && sun.morning !== sun.sunrise);
    const sunNote = [
      sun.sunrise ? `sunrise ${sun.sunrise}${capped ? ` (its steps begin at ${sun.morning})` : ''}`
        : d.sunrise_latest ? `sunrise not known yet (its steps begin by ${d.sunrise_latest})`
        : 'sunrise not known yet',
      sun.sunset ? `sunset ${sun.sunset}` : 'sunset not known yet',
    ].join(' · ');

    // While paused, what Resume will do. Not "puts it at X" flatly: a dark
    // room is only told its step, and gets it when it next comes on — and
    // with the whole ladder off Resume sets nothing at all. (The house's own
    // line is its state sentence, sumCard().)
    const inForce = pb
      ? (!d.enabled
        ? 'Paused — and the whole ladder is off just now, so Resume sets nothing until it is on again.'
        : now.step && now.step.pct != null
        ? `Paused. Resume puts it at ${this.levelText(now.step)}, the step the clock is in — at once if it is lit, otherwise when it next comes on.`
        : 'Paused. Resume puts it back on the ladder; the step in force just now sets nothing.')
      // The server sends the step whether or not the ladder is on.
      : !d.enabled ? 'The whole ladder is off just now — nothing is set by the clock.'
      : now.step
      ? (now.step.pct == null
        ? `Nothing is being set just now${now.since ? ` (since ${now.since})` : ''}.`
        : `In force now: ${this.levelText(now.step)}${now.since ? `, since ${now.since}` : ''}.`)
      : 'No step is in force — the ladder is empty.';

    const pLabel = parent ? esc(parent.label) : '';
    const hint = linked
      ? `The hours below belong to ${esc(this.sourceLabel(linked))} and change when they do. What this lamp is at — its brightness, and its colour — is its own.`
      : personal && parent
      ? `This lamp is on the ladder below, and ${pLabel}'s steps do not touch it. When ${pLabel} comes on — its motion sensor, a switch — this lamp comes up at the colour and brightness of the step the clock is in.`
      : personal
      ? 'This room is on the ladder below. The house ladder does not touch it.'
      : parent
      ? `This lamp takes ${pLabel}'s steps, the same as the room's white lamps. Give it a ladder of its own to choose its colour, and how bright it comes on, for the evening and for the night.`
      : 'This room takes the house ladder. Give it one of its own to treat it differently — a bedroom that should never come up bright late, say.';

    const n = steps.length;
    const stepsNote = `${n} ${n === 1 ? 'step' : 'steps'}${room && !pb && d.enabled && now.step && now.step.pct != null
      ? ` · ${this.levelText(now.step)} now` : ''}`;
    const what = parent ? 'lamp' : 'room';
    const whose = linked ? 'same hours, own levels' : personal ? 'its own ladder'
      : parent ? `goes with ${parent.label}` : 'follows the house';

    this.body.innerHTML = `
      ${room ? '' : this.sumCard(now)}

      ${room ? '' : this.pausedRow()}

      ${fam ? kit.sec(`${fam.head.label} and its lamps`, `
        <p class="sheet-note">Pick a lamp to choose its own colour and brightness for the evening
          and the night. A lamp with no ladder of its own goes with ${esc(fam.head.label)}'s steps.</p>
        <div class="ls-set sheet-seg lx-fam-set">
          ${[fam.head, ...fam.kids].map((x) => `<button class="ls-btn lx-fam${x.entity === room ? ' on' : ''}"
             data-e="${esc(x.entity)}" aria-pressed="${x.entity === room}">${esc(x.emoji)} ${esc(x.label)}${
             x === fam.head ? ' — the room' : ''}</button>`).join('')}
        </div>`, { cls: 'lx-fam-row', note: `${fam.kids.length} ${fam.kids.length === 1 ? 'lamp' : 'lamps'}` }) : ''}

      ${room ? kit.sec(`This ${what}`, `
        <div class="ls-row">
          <span class="ls-label"><span class="db-hint sheet-lead">${hint}</span></span>
          <span class="ls-set sheet-seg">
            <button class="ls-btn lx-follow${personal ? '' : ' on'}" aria-pressed="${!personal}">${
              parent ? `Goes with ${pLabel}` : 'Follows the house'}</button>
            <button class="ls-btn lx-own${personal && !linked ? ' on' : ''}" aria-pressed="${personal && !linked}">Its own ladder</button>
            <button class="ls-btn lx-link${linked ? ' on' : ''}" aria-pressed="${!!linked}">Same hours, own levels</button>
          </span>
        </div>
        ${linked ? `
        <div class="ls-row">
          <span class="ls-label">Hours from</span>
          <span class="ls-set sheet-seg lx-srcs">
            ${this.sources().map((x) => `<button class="ls-btn lx-src${x.key === linked ? ' on' : ''}"
               data-s="${esc(x.key)}" aria-pressed="${x.key === linked}">${esc(x.label)}</button>`).join('')}
          </span>
        </div>` : ''}
        <!-- The pause, a row of its own under the three: a pause is not a
             fourth kind of ladder, it is this room's ladder put down for a
             while, and the choice above is kept for when it is picked up
             again. Amber when on, so it never reads as a mode. -->
        <div class="ls-row">
          <span class="ls-label">${pb ? `<span class="lx-paused-line">${pOwn
            ? `Paused since ${esc(pSince)} — the switch and Home Assistant decide this
               ${what}'s light. Resume puts it back on its ladder.`
            : `Paused with ${pWho} since ${esc(pSince)} — the switch and Home Assistant
               decide this ${what}'s light too. It comes off with ${pWho}: resume
               ${pWho} to put it back on its ladder.`}${
            this.wake()?.on ? ' The morning wake-up below is not paused; it has its own On and Off.' : ''}</span>`
            : `<span class="db-hint sheet-lead">Pause hands this ${what} to its switch and Home
                 Assistant — for working late under a bright light, say — until you resume it.${
                 parent ? ` Pausing ${pLabel} pauses this lamp too, and it is resumed with ${pLabel}.` : ''}</span>`}</span>
          <span class="ls-set">
            <button class="ls-btn lx-pause${pb ? ' on' : ''}" data-e="${esc(pb || room)}"
                    data-v="${pb ? '0' : '1'}">${pb ? (pOwn ? '▶ Resume' : `▶ Resume ${pWho}`) : '⏸ Pause'}</button>
          </span>
        </div>`, { note: pb ? this.pauseText(room) : whose }) : ''}

      ${kit.sec('Steps', `
        <p class="sheet-note">Each step says when it begins and what the lights go to.
          It runs until the next one. Nothing here ever switches a light on or off —
          it only changes rooms that are already lit, and lights the level as they
          come on. Today: ${esc(sunNote)}.</p>
        ${this.canColour() ? this.allColourRow(steps) : ''}
        ${steps.length ? '' : '<p class="lx-empty">No steps yet. Add one below.</p>'}
        ${mode === 'view' && steps.length ? `<div class="lx-steps">
          ${steps.map((s, i) => this.stepRow(s, i, mode)).join('')}</div>` : ''}
        ${mode === 'edit' ? '' : `<p class="sheet-note">${linked
            ? `Rungs are added and removed on ${esc(this.sourceLabel(linked))}'s ladder — this one has as many as it has.`
            : parent
            ? `These are ${pLabel}'s steps, shown as they stand. Give this lamp its own above to choose what it does.`
            : 'This is the house ladder, shown as it stands. Give this room one of its own above to change what it does here.'}</p>`}
        ${room ? `<p class="sheet-line lx-force">${esc(inForce)}</p>` : ''}`, { note: stepsNote })}

      ${mode === 'view' ? '' : steps.map((s, i) => this.stepRow(s, i, mode)).join('')}
      ${mode === 'edit' ? `<div class="lx-addline">
        <button class="ls-btn lx-add">+ Add a step</button>
      </div>` : ''}

      ${room ? '' : this.morningRow()}

      ${room ? this.wakeRow() : ''}

      ${room ? this.motionRow() : ''}`;

    // data-on rather than a class in the markup above, so one line can set
    // the lit state on both members of a pair without a ternary each.
    this.body.querySelectorAll('[data-on="1"]').forEach((b) => {
      b.classList.add('on');
      b.setAttribute('aria-pressed', 'true');
    });
    this.wire();
    kit.sync(this.sheet);
  },

  /* Dark mornings. In a northern winter the sun is up long after the house
     has left, and every step "from sunrise" — the morning's full light —
     would wait for it. This puts a latest time on all of them, in every
     ladder: sunrise, or this, whichever comes first. With it, on the house's
     sheet, what a light changed by hand does: two rules for every room. */
  morningRow() {
    const kit = this.ctx.sheetkit;
    const d = this.doc || {};
    const sun = d.sun || {};
    const cur = d.sunrise_latest || null;
    const opts = [null, '05:30', '06:00', '06:30', '07:00', '07:30', '08:00'];
    const today = !sun.sunrise ? ''
      : cur && sun.morning && sun.morning !== sun.sunrise
      ? ` Today the sun rises at ${sun.sunrise}, so the morning steps begin at ${sun.morning}.`
      : ` Today the sun rises at ${sun.sunrise}${cur ? `, before ${cur}, so the sun decides` : ''}.`;
    return kit.sec('Mornings and changes by hand', `
      <div class="ls-row">
        <span class="ls-label">Mornings: sunrise, but no later than
          <span class="db-hint">Every step that begins at sunrise, in every room's ladder,
            begins at this time when the sun is later — so a dark winter morning
            gets the day's light, not the night's.${esc(today)}</span></span>
        <span class="ls-set sheet-seg">
          ${opts.map((v) => `<button class="ls-btn lx-sl${v === cur ? ' on' : ''}${v ? '' : ' sheet-none'}"
             data-v="${v || ''}" aria-pressed="${v === cur}">${v || 'The sun decides'}</button>`).join('')}
        </span>
      </div>
      <div class="ls-row">
        <span class="ls-label">When you change a light by hand
          <span class="db-hint">${d.reassert
            ? 'A room that drifts from its step is put back within half a minute. Tidy, but it will argue with you if you turn something up on purpose.'
            : 'Turn a light up to read a recipe and it stays up until the clock reaches the next step. This is the gentler of the two.'}</span></span>
        <span class="ls-set sheet-seg">
          <button class="ls-btn lx-re" data-v="0"${d.reassert ? '' : ' data-on="1"'} aria-pressed="false">Leave it until the next step</button>
          <button class="ls-btn lx-re" data-v="1"${d.reassert ? ' data-on="1"' : ''} aria-pressed="false">Put it back</button>
        </span>
      </div>`, { note: `${d.enabled ? '' : 'when on: '}${cur ? `no later than ${cur}` : 'the sun decides'} · ${
        d.reassert ? 'put back' : 'left until the next step'}` });
  },

  /* On the house's sheet: every room somebody has paused, each with its own
     Resume. A pause is only ever taken off by hand, so the one place that
     is about every room is where a forgotten one is found. Not drawn when
     there is none. */
  pausedRow() {
    const ps = Object.entries(this.doc?.paused || {})
      .filter(([e]) => e === '__house__' || this.known(e))
      .sort((a, b) => a[1].localeCompare(b[1]));
    if (!ps.length) return '';
    return this.ctx.sheetkit.sec('Paused', `
      <div class="ls-row lx-paused-row">
        <span class="ls-label"><span class="db-hint sheet-lead">The ladder leaves these to their
          switches and Home Assistant ("the whole house" is every room at once). Tap one to put it
          back on its ladder.</span></span>
        <span class="ls-set lx-paused-set">
          ${ps.map(([e, t]) => `<button class="ls-btn lx-resume" data-e="${esc(e)}"
             >▶ ${esc(this.roomLabel(e))} <small>since ${esc(this.sinceText(t))}</small></button>`).join('')}
        </span>
      </div>`, { note: ps.map(([e]) => this.roomLabel(e)).join(', ') });
  },

  /* The morning wake-up: the one thing on this sheet that switches a light
     on. It is a room's own and never the house's — a whole house coming up at
     six would be a different and much less welcome feature — so it is drawn
     only when a room is in scope, and it says plainly what it does. */
  wake() {
    return (this.doc?.wake || {})[this.scope] || null;
  },

  wakeRow() {
    const kit = this.ctx.sheetkit;
    const w = this.wake();
    const on = !!(w && w.on);
    const at = w ? w.at : '06:30';
    const mins = w ? w.minutes : 20;
    const days = w ? w.days : [0, 1, 2, 3, 4];
    const pct = w ? w.pct : 100;
    const k = w ? w.k : 2700;
    const offAfter = (w && w.off_after) || null;
    // On unless somebody chose otherwise, as the server has it.
    const schoolOnly = !(w && w.school_only === false);
    // The whole ladder off stops the wake-up too (lights.py's tick returns
    // before either), so the next morning's line would promise a light that
    // does not come: it gives way to the line that says so.
    const stopped = on && !this.doc?.enabled;
    const nextLine = on && !stopped ? wakeNextText((this.doc?.wake_next || {})[this.scope], schoolOnly) : '';
    const from = this.doc?.wake_limits?.from_pct ?? 1;
    const fade = this.doc?.wake_limits?.off_fade_s ?? 10;
    const bright = addMins(at, mins);
    return kit.sec('Morning wake-up', `
      <div class="ls-row lx-wake">
        <span class="ls-label"><span class="db-hint sheet-lead">The lamp comes up from ${from}% to its
          finishing level over the length you choose, so the room is light before the alarm is. This is
          the one thing here that switches a light on — and, if you ask it to, off again once the
          morning is over. Everything above only changes lamps that are already lit. Switch the lamp
          off while it is climbing and it gives up for that morning rather than coming back on.</span>
          ${stopped ? `<span class="sheet-line sheet-warn">The whole ladder is off just now, so the
            wake-up does not come on until it is on again.</span>` : ''}</span>
        ${kit.toggle(on, `data-v="${on ? '0' : '1'}"`, { cls: 'lx-wk-on' })}
      </div>

      <div class="lx-wk-grid${on ? '' : ' nt-off'}">
        <div class="ls-row">
          <span class="ls-label lx-cap">Starts at <b>${esc(at)}</b></span>
          <span class="ls-set sheet-grid lx-wk-ats">${WAKE_ATS.map((t) =>
            `<button class="ls-btn lx-wk-at${t === at ? ' on' : ''}" data-v="${t}" aria-pressed="${t === at}">${t}</button>`).join('')}</span>
        </div>
        <div class="ls-row">
          <span class="ls-label lx-cap">Over <b>${mins} min</b></span>
          <span class="ls-set sheet-seg sheet-hourbar">${WAKE_MINS.map((m) =>
            `<button class="ls-btn lx-wk-min${m === mins ? ' on' : ''}" data-v="${m}" aria-pressed="${m === mins}">${m}</button>`).join('')}</span>
        </div>
        <div class="ls-row">
          <span class="ls-label lx-cap">On these days</span>
          <span class="ls-set sheet-grid sheet-days">${DAY_NAMES.map((d, i) =>
            `<button class="ls-btn lx-wk-day${days.includes(i) ? ' on' : ''}" data-v="${i}" aria-pressed="${days.includes(i)}">${d}</button>`).join('')}</span>
        </div>
        <!-- Under the days because it narrows them: of the chosen days, the
             ones the school board (the school alert's own day plan) says
             have school. Then what the next chosen morning will do. -->
        <div class="ls-row">
          <span class="ls-label lx-cap">No school <b>${schoolOnly ? 'stays off' : 'comes on'}</b>
            <span class="db-hint">Only on school days, it also stays off on a chosen day the school
              board has no school on — a lov, a studiedag, a röd dag — just as the school alert
              stays quiet.</span>
            ${nextLine ? `<span class="sheet-line lx-wk-next">${nextLine}</span>` : ''}</span>
          <span class="ls-set sheet-seg">
            <button class="ls-btn lx-wk-sch${schoolOnly ? ' on' : ''}" data-v="1" aria-pressed="${schoolOnly}">Only on school days</button>
            <button class="ls-btn lx-wk-sch${schoolOnly ? '' : ' on'}" data-v="0" aria-pressed="${!schoolOnly}">Every chosen day</button>
          </span>
        </div>
        <div class="ls-row">
          <span class="ls-label lx-cap">Finishes at <b>${pct}%</b></span>
          <input class="ls-slider ls-fill lx-wk-pct" type="range" min="${PCT_MIN}" max="${PCT_MAX}"
                 value="${pct}" style="--fill: ${fill(pct)}" aria-label="finishing brightness">
        </div>
        <div class="ls-row">
          <span class="ls-label lx-cap">Warmth <b>${k} K</b></span>
          <input class="ls-slider ls-kelvin lx-wk-k" type="range" min="${K_MIN}" max="${K_MAX}" step="50"
                 value="${k}" aria-label="warmth">
        </div>
        <!-- What happens once it is fully bright. Last, because it is what
             comes last: a school morning's lamp was still on when everybody
             came home, and this is the answer to that. -->
        <div class="ls-row">
          <span class="ls-label lx-cap">Then <b>${offAfter ? `off at ${addMins(at, mins + offAfter)}` : 'stays on'}</b>
            <span class="db-hint lx-wk-then">${offAfter
              ? `Fully bright at ${bright}, then off at ${addMins(at, mins + offAfter)}, fading out over
                 ${fade} seconds — if it is still on. Switched back on after that, it stays on.`
              : `Fully bright at ${bright}, and on until somebody switches it off.`}</span></span>
          <span class="ls-set sheet-seg">${WAKE_OFFS.map((m) =>
            `<button class="ls-btn lx-wk-off${m === offAfter ? ' on' : ''}${m ? '' : ' sheet-none'}" data-v="${m || ''}"
               aria-pressed="${m === offAfter}">${m ? `off after ${minsText(m)}` : 'Stays on'}</button>`).join('')}</span>
        </div>
      </div>`, { note: stopped ? 'on · the ladder is off'
      : on ? `on · ${at} · ${this.daysText(days)}${schoolOnly ? ' · school days' : ''}` : 'off' });
  },

  /* A light on motion: the second thing on this sheet that switches a light
     on, and off again. A lamp's own, like the wake-up. */
  motion() {
    return (this.doc?.motion || {})[this.scope] || null;
  },

  motionRow() {
    const kit = this.ctx.sheetkit;
    const m = this.motion();
    const on = !!(m && m.on);
    const sun = this.doc?.sun || {};
    const frm = m ? m.from : '22:00';
    const until = m ? m.until : 'sunrise';
    const offAfter = m ? m.off_after : 5;
    const offAt = (m && m.off_at) || null;
    const atWord = (t) => (t === '24:00' ? 'midnight' : t);
    const fromWord = (t) => (t === 'sunset' ? '☾ sunset' : t);
    const fromText = frm === 'sunset' ? `sunset${sun.sunset ? ` (${sun.sunset} today)` : ''}` : frm;
    const sensors = this.doc?.motion_sensors || [];
    const chosen = new Set(m && Array.isArray(m.sensors) ? m.sensors : sensors.map((x) => x.entity));
    const names = sensors.filter((x) => chosen.has(x.entity)).map((x) => x.label);
    const stopped = on && !this.doc?.enabled;
    const lit = (this.doc?.motion_lit || []).includes(this.scope);
    const untilWord = (u) => (u === 'sunrise' ? '☀ sunrise' : u);
    const untilText = until === 'sunrise'
      ? `sunrise${sun.morning ? ` (${sun.morning} today)` : ''}` : until;
    const now = ((this.doc?.now || {})[this.scope] || {}).step;
    return kit.sec('Light on motion', `
      <div class="ls-row lx-mo">
        <span class="ls-label"><span class="db-hint sheet-lead">From the time you choose, motion on
          any of the chosen sensors switches this lamp on — at the step its ladder is in then, with
          that step's colour or warmth — and it goes off again at a fixed time, or once nobody has
          moved for the minutes you choose. Only when it is dark: a lamp somebody has switched on
          is left to them, and never switched off by this. Switch it off by hand and the next motion
          lights it again.</span>
          ${lit ? '<span class="sheet-line lx-mo-lit">Lit by motion just now.</span>' : ''}
          ${stopped ? `<span class="sheet-line sheet-warn">The whole ladder is off just now, so motion
            does not light it until it is on again.</span>` : ''}</span>
        ${kit.toggle(on, `data-v="${on ? '0' : '1'}"`, { cls: 'lx-mo-on' })}
      </div>

      <div class="lx-wk-grid${on ? '' : ' nt-off'}">
        <div class="ls-row">
          <span class="ls-label lx-cap">From <b>${esc(fromText)}</b></span>
          <span class="ls-set sheet-grid lx-mo-grid lx-mo-9">${MOTION_FROMS.map((t) =>
            `<button class="ls-btn lx-mo-from${t === frm ? ' on' : ''}" data-v="${t}" aria-pressed="${t === frm}">${fromWord(t)}</button>`).join('')}</span>
        </div>
        <div class="ls-row${offAt ? ' nt-off' : ''}">
          <span class="ls-label lx-cap">Until <b>${esc(offAt ? atWord(offAt) : untilText)}</b>
            ${offAt ? `<span class="db-hint">Off at ${atWord(offAt)} below, so motion lights it until then.</span>` : ''}</span>
          <span class="ls-set sheet-grid lx-mo-grid lx-mo-9">${MOTION_UNTILS.map((t) =>
            `<button class="ls-btn lx-mo-until${t === until ? ' on' : ''}" data-v="${t}" aria-pressed="${t === until}">${untilWord(t)}</button>`).join('')}</span>
        </div>
        <div class="ls-row">
          <span class="ls-label lx-cap">Motion on <b>${names.length === sensors.length ? 'any sensor'
            : names.length ? `${names.length} of ${sensors.length}` : 'no sensor'}</b>
            ${names.length ? '' : '<span class="db-hint">No sensor is chosen, so nothing lights it.</span>'}</span>
          <span class="ls-set sheet-seg">${sensors.map((x) =>
            `<button class="ls-btn lx-mo-sensor${chosen.has(x.entity) ? ' on' : ''}" data-v="${esc(x.entity)}"
               aria-pressed="${chosen.has(x.entity)}">${esc(x.label)}</button>`).join('')}</span>
        </div>
        <div class="ls-row">
          <span class="ls-label lx-cap">Off <b>${offAt ? `at ${atWord(offAt)}` : 'after the last motion'}</b>
            <span class="db-hint">${offAt
              ? `The sensors only say somebody is home: lit, it stays on whatever they say, goes off at
                 ${atWord(offAt)}, and nothing lights it again until ${frm === 'sunset' ? 'the next sunset' : `${frm} the next day`}.`
              : 'Or a fixed time: the sensors then only say somebody is home.'}</span></span>
          <span class="ls-set sheet-grid lx-mo-grid lx-mo-10">${MOTION_OFF_ATS.map((x) =>
            `<button class="ls-btn lx-mo-offat${x === offAt ? ' on' : ''}${x ? '' : ' sheet-none'}" data-v="${x || ''}"
               aria-pressed="${x === offAt}">${x || 'Minutes'}</button>`).join('')}</span>
        </div>
        <div class="ls-row${offAt ? ' nt-off' : ''}">
          <span class="ls-label lx-cap">${offAt ? 'Not used: ' : ''}<b>${minsText(offAfter)}</b> after the last motion
            <span class="db-hint">${now && now.pct != null
              ? `Just now it would come on at ${esc(this.levelText(now))}, the step in force — change the steps above to change it.`
              : 'With no step in force it comes on as it was last.'}</span></span>
          <span class="ls-set sheet-grid lx-mo-grid lx-mo-8">${MOTION_OFFS.map((x) =>
            `<button class="ls-btn lx-mo-off${x === offAfter ? ' on' : ''}" data-v="${x}" aria-pressed="${x === offAfter}">${minsText(x)}</button>`).join('')}</span>
        </div>
      </div>`, { note: stopped ? 'on · the ladder is off'
      : on ? `on · ${frm}–${offAt ? atWord(offAt) : until === 'sunrise' ? 'sunrise' : until}${lit ? ' · lit now' : ''}` : 'off' });
  },

  saveMotion(patch) {
    const m = this.motion() || { on: false, from: '22:00', until: 'sunrise', sensors: null, off_after: 5, off_at: null };
    return this.save({ motion: { ...(this.doc.motion || {}), [this.scope]: { ...m, ...patch } } });
  },

  saveWake(patch) {
    const w = this.wake() || { on: false, at: '06:30', minutes: 20, days: [0, 1, 2, 3, 4],
                               pct: 100, k: 2700, off_after: null, school_only: true };
    return this.save({ wake: { ...(this.doc.wake || {}), [this.scope]: { ...w, ...patch } } });
  },

  /* One colour for the whole evening, in one tap. A lamp that shows a colour
     at all nearly always wants the same one on every step, only brighter or
     dimmer — and nine swatches on each of eight steps is seventy-two chances
     to miss one. A step that is left alone is left alone. */
  /* Since 2026-10-31 a common colour rather than a copy into every step
     (Alex: "keep the colour for all stages ... if any colour is chosen [in
     a stage] it will use the chosen colour of the stage, if not the common
     colour"). It is the lamp's, kept apart from its steps, so it works on a
     lamp going with its room's steps as well as on one with its own, and a
     step given a colour of its own keeps it whatever is chosen here. */
  allColourRow(steps) {
    const c = this.common();
    const ownCol = steps.filter((s) => s.pct != null && s.hs).length;
    const name = c ? this.colourName(c) : 'none';
    const says = !c
      ? 'Pick one to give every step that has no colour of its own this colour.'
      : ownCol
      ? `Every step without a colour of its own is ${esc(name)}; ${ownCol} ${
        ownCol === 1 ? 'step keeps its own' : 'steps keep their own'}.`
      : `Every step is ${esc(name)}. A step given a colour of its own below keeps that one.`;
    return `
      <div class="ls-row lx-allcol">
        <span class="ls-label lx-cap">Common colour <b>${esc(name)}</b>
          <span class="db-hint">${says}</span></span>
        <div class="lx-sws">
          <button class="ls-btn lx-nocol lx-all-none${c ? '' : ' on'}">None</button>
          ${COLOURS.map(([n, h, sat]) => `<button class="lx-sw lx-all-sw${
            c && Math.round(c[0]) === h ? ' on' : ''}"
            data-h="${h}" data-s="${sat}" title="${n}" aria-label="${n} for every step"
            style="--sw:hsl(${h} ${sat}% 60%)"></button>`).join('')}
        </div>
        ${c && ownCol && this.editable() ? `<button class="ls-btn lx-all-clear"
          title="All steps to ${esc(name)}">All steps to ${esc(name)}</button>` : ''}
      </div>`;
  },

  // Whether this sheet's steps are this lamp's to change (its own or linked).
  editable() { return !!this.entry(); },

  /* One rung. `mode` is render()'s: 'edit' draws every control, 'linked'
     draws the hour as the card's name only and keeps the levels, and 'view'
     is a line of text in the Steps card — a ladder this room is only
     following, which nothing here may change. A rung to edit is a card of
     its own (the kit's), named by when it begins, its level the note: the
     rail lists them in order, which is the ladder at a glance. */
  stepRow(step, i, mode = 'edit') {
    const anchored = step.at === 'sunrise' || step.at === 'sunset';
    const off = step.offset || 0;
    const when = (w) => (w === 'sunrise' ? '☀ sunrise' : w === 'sunset' ? '☾ sunset' : w);
    if (mode === 'view') {
      return `
      <div class="lx-step borrowed view" data-i="${i}">
        <span class="lx-borrowed">from ${when(step.at)}
          ${off ? `<i>${off > 0 ? `+${off}` : off} min</i>` : ''}</span>
        <span class="lx-level">${esc(this.levelText(step))}</span>
      </div>`;
    }
    const linked = mode === 'linked';
    const colour = this.canColour() || !!step.hs;
    const common = this.common();
    // What the step shows when it names no colour: the common one, or a white.
    const noneWord = common ? `common — ${this.colourName(common)}` : 'none — a white';
    const name = `From ${when(step.at)}${off ? ` ${off > 0 ? `+${off}` : off} min` : ''}`;
    return this.ctx.sheetkit.sec(name, `
        ${linked ? '' : `
        ${[WHENS_EVENING, WHENS_MORNING].map((row) => `
        <div class="ls-set sheet-seg lx-when">
          ${row.map((w) => `<button class="ls-btn lx-w${w === step.at ? ' on' : ''}"
              data-w="${w}" aria-pressed="${w === step.at}">${when(w)}</button>`).join('')}
        </div>`).join('')}`}
        ${!linked && anchored ? `
        <div class="lx-off">
          <span class="lx-cap">Offset <b>${off > 0 ? `+${off}` : off} min</b></span>
          <input class="ls-slider lx-off-in" type="range" min="-120" max="120" step="10"
                 value="${off}" aria-label="minutes before or after">
        </div>` : ''}
        <div class="lx-sliders">
          <div class="lx-s">
            <span class="lx-cap">Brightness
              <b>${step.pct == null ? 'leave alone' : `${step.pct}%`}</b></span>
            <input class="ls-slider ls-fill lx-pct" type="range" min="${PCT_MIN}" max="${PCT_MAX}"
                   value="${step.pct == null ? 60 : step.pct}" style="--fill: ${fill(step.pct == null ? 60 : step.pct)}"
                   ${step.pct == null ? 'disabled' : ''} aria-label="brightness">
            <button class="ls-btn lx-null" data-f="pct">${step.pct == null ? 'Set it' : 'Leave alone'}</button>
          </div>
          <div class="lx-s"${step.hs || common ? ' hidden' : ''}>
            <span class="lx-cap">Warmth
              <b>${step.k == null ? 'leave alone' : `${step.k} K`}</b></span>
            <input class="ls-slider ls-kelvin lx-k" type="range" min="${K_MIN}" max="${K_MAX}" step="50"
                   value="${step.k == null ? 2700 : step.k}"
                   ${step.k == null ? 'disabled' : ''} aria-label="warmth">
            <button class="ls-btn lx-null" data-f="k">${step.k == null ? 'Set it' : 'Leave alone'}</button>
          </div>
        </div>
        <!-- A colour, for a lamp whose job is to be one. Picking one puts the
             warmth away: a lamp is a colour or a colour temperature, never
             both, and offering both would be two controls for one property
             where whichever was touched last silently won. Not drawn at all
             for lamps that cannot show one — a bedroom's white panel, the
             Salon's whites — where nine swatches would be nine things that
             do nothing. -->
        ${colour ? `<div class="lx-colour">
          <span class="lx-cap">Colour
            <b>${step.hs ? `${esc(this.colourName(step.hs))} — its own` : esc(noneWord)}</b></span>
          <div class="lx-sws">
            <button class="ls-btn lx-nocol${step.hs ? '' : ' on'}">${common ? 'Common' : 'None'}</button>
            ${COLOURS.map(([cname, h, sat]) => `<button class="lx-sw${
              step.hs && Math.round(step.hs[0]) === h ? ' on' : ''}"
              data-h="${h}" data-s="${sat}" title="${cname}" aria-label="${cname}"
              style="--sw:hsl(${h} ${sat}% 60%)"></button>`).join('')}
          </div>
        </div>` : ''}
        ${linked ? '' : `<button class="ls-btn sheet-danger lx-del" title="remove this step"
          aria-label="remove this step">✕ Remove</button>`}`,
    { note: this.levelText(step), cls: `lx-step${linked ? ' borrowed' : ''}`, attrs: `data-i="${i}"` });
  },

  wire() {
    const steps = () => this.steps().map((s) => ({ ...s }));
    const idx = (el) => Number(el.closest('.lx-step').dataset.i);

    this.body.querySelectorAll('.lx-w').forEach((b) => {
      b.onclick = () => {
        const list = steps();
        list[idx(b)].at = b.dataset.w;
        if (b.dataset.w !== 'sunrise' && b.dataset.w !== 'sunset') list[idx(b)].offset = 0;
        this.saveSteps(list);
      };
    });

    this.body.querySelectorAll('.lx-del').forEach((b) => {
      b.onclick = () => {
        // Two taps: the first asks, the second takes the step away — a
        // whole rung is a lot to lose to a hand brushing the wall.
        if (!b.dataset.sure) {
          b.dataset.sure = '1';
          b.textContent = 'Sure? Tap again';
          setTimeout(() => { if (b.isConnected) { delete b.dataset.sure; b.textContent = '✕ Remove'; } }, 4000);
          return;
        }
        const list = steps();
        list.splice(idx(b), 1);
        this.saveSteps(list);
      };
    });

    const add = this.body.querySelector('.lx-add');
    if (add) {
      add.onclick = () => this.saveSteps([...steps(), { ...NEW_STEP }]);
    }

    this.body.querySelectorAll('.lx-step .lx-sw').forEach((sw) => {
      sw.onclick = () => {
        const list = steps();
        // A colour and a colour temperature cannot both be set, so choosing
        // one clears the other rather than leaving a step that says both.
        list[idx(sw)].hs = [Number(sw.dataset.h), Number(sw.dataset.s)];
        list[idx(sw)].k = null;
        this.saveSteps(list);
      };
    });
    this.body.querySelectorAll('.lx-step .lx-nocol').forEach((b) => {
      b.onclick = () => {
        const list = steps();
        list[idx(b)].hs = null;
        this.saveSteps(list);
      };
    });

    // The lamp's common colour: saved apart from its steps, which keep theirs.
    this.body.querySelectorAll('.lx-all-sw').forEach((sw) => {
      sw.onclick = () => this.saveCommon([Number(sw.dataset.h), Number(sw.dataset.s)]);
    });
    const allNone = this.body.querySelector('.lx-all-none');
    if (allNone) allNone.onclick = () => this.saveCommon(null);
    /* Every step back to the common colour, in one tap: a step's own colour
       is otherwise taken away one step at a time (its Common button). Two
       taps, like ✕ Remove — eight steps' colours are a lot to lose. */
    const allClear = this.body.querySelector('.lx-all-clear');
    if (allClear) {
      allClear.onclick = () => {
        if (!allClear.dataset.sure) {
          allClear.dataset.sure = '1';
          allClear.textContent = 'Sure? Tap again';
          const was = allClear.title;
          setTimeout(() => {
            if (allClear.isConnected) { delete allClear.dataset.sure; allClear.textContent = was; }
          }, 4000);
          return;
        }
        this.saveSteps(steps().map((x) => ({ ...x, hs: null })));
      };
    }

    // A room and its lamps: the chips at the top move the sheet between them.
    this.body.querySelectorAll('.lx-fam').forEach((b) => {
      b.onclick = () => {
        if (b.dataset.e === this.scope) return;
        this.scope = b.dataset.e;
        this.render();
        this.body.scrollTop = 0;
      };
    });

    this.body.querySelectorAll('.lx-src').forEach((b) => {
      b.onclick = () => this.save({
        rooms: {
          ...(this.doc.rooms || {}),
          [this.scope]: { times_from: b.dataset.s, steps: this.steps()
            .map((x) => ({ pct: x.pct, k: x.k, hs: x.hs })) },
        },
      });
    });

    const link = this.body.querySelector('.lx-link');
    if (link) {
      // Starting from whatever is on screen: a lamp being linked is almost
      // always already showing the levels somebody wants to keep.
      // A lamp inside a room borrows that room's hours; anything else, the
      // house's.
      link.onclick = () => this.save({
        rooms: {
          ...(this.doc.rooms || {}),
          [this.scope]: { times_from: this.linked() || this.parentOf(this.scope)?.entity || HOUSE,
            steps: this.steps().map((x) => ({ pct: x.pct, k: x.k, hs: x.hs })) },
        },
      });
    }

    this.body.querySelectorAll('.lx-null').forEach((b) => {
      b.onclick = () => {
        const list = steps();
        const s = list[idx(b)];
        const f = b.dataset.f;
        s[f] = s[f] == null ? (f === 'pct' ? 60 : 2700) : null;
        this.saveSteps(list);
      };
    });

    /* The sliders. Nothing is saved while one is moving — only the figure
       beside it moves, so the wall keeps up with the finger — and the whole
       ladder goes up when the finger comes off. `dragging` is what stops the
       answer to that save, or anybody else's, from rebuilding the rows under
       the hand still holding one. */
    const slider = (sel, field, fmt) => {
      this.body.querySelectorAll(sel).forEach((sl) => {
        const cap = sl.parentElement.querySelector('.lx-cap b');
        sl.oninput = () => {
          this.dragging = true;
          if (cap) cap.textContent = fmt(Number(sl.value));
          if (sl.classList.contains('ls-fill')) sl.style.setProperty('--fill', fill(sl.value));
        };
        const done = () => {
          if (!this.dragging) return;
          this.dragging = false;
          const list = steps();
          list[idx(sl)][field] = Number(sl.value);
          this.saveSteps(list, true);
        };
        sl.onchange = done;
        ['pointerup', 'pointercancel'].forEach((e) => sl.addEventListener(e, done));
      });
    };
    slider('.lx-pct', 'pct', (v) => `${v}%`);
    slider('.lx-k', 'k', (v) => `${v} K`);
    slider('.lx-off-in', 'offset', (v) => `${v > 0 ? `+${v}` : v} min`);

    const follow = this.body.querySelector('.lx-follow');
    if (follow) {
      follow.onclick = () => {
        const rooms = { ...(this.doc.rooms || {}) };
        delete rooms[this.scope];
        // null tells the server to drop it; a missing key would be read as
        // "no change to that room", which is the opposite.
        this.save({ rooms: { ...rooms, [this.scope]: null } });
      };
    }
    const own = this.body.querySelector('.lx-own');
    if (own) {
      /* Starting from a copy of the steps on screen, not from nothing: a
         room being personalised almost always means "like it is, but…" —
         and for one of the Salon's colour lamps, what it is now is the
         Salon's steps, not the house's. Saved as a list outright rather than
         through saveSteps(), which keeps a linked lamp linked, and a linked
         lamp asking for a ladder of its own would have stayed linked. */
      own.onclick = () => {
        if (Array.isArray(this.entry())) return;
        this.save({ rooms: { ...(this.doc.rooms || {}),
          [this.scope]: this.steps().map((s) => ({ ...s })) } });
      };
    }

    // Pause and Resume, in a room's sheet and on the house's list.
    this.body.querySelectorAll('.lx-pause, .lx-resume').forEach((b) => {
      b.onclick = () => {
        b.disabled = true;
        this.setPause(b.dataset.e, b.classList.contains('lx-pause') && b.dataset.v === '1');
      };
    });

    this.body.querySelectorAll('.lx-sl').forEach((b) => {
      b.onclick = () => this.save({ sunrise_latest: b.dataset.v || null });
    });
    this.body.querySelectorAll('.lx-re').forEach((b) => {
      b.onclick = () => this.save({ reassert: b.dataset.v === '1' });
    });
    this.body.querySelectorAll('.lx-en').forEach((b) => {
      b.onclick = () => this.save({ enabled: b.dataset.v === '1' });
    });

    // ---- a light on motion ----
    this.body.querySelectorAll('.lx-mo-on').forEach((b) => {
      b.onclick = () => this.saveMotion({ on: b.dataset.v === '1' });
    });
    this.body.querySelectorAll('.lx-mo-from').forEach((b) => {
      b.onclick = () => this.saveMotion({ from: b.dataset.v });
    });
    this.body.querySelectorAll('.lx-mo-until').forEach((b) => {
      b.onclick = () => this.saveMotion({ until: b.dataset.v });
    });
    this.body.querySelectorAll('.lx-mo-offat').forEach((b) => {
      b.onclick = () => this.saveMotion({ off_at: b.dataset.v || null });
    });
    this.body.querySelectorAll('.lx-mo-off').forEach((b) => {
      b.onclick = () => this.saveMotion({ off_after: Number(b.dataset.v) });
    });
    this.body.querySelectorAll('.lx-mo-sensor').forEach((b) => {
      b.onclick = () => {
        // Every sensor lit is "any", kept as null so a sensor added to the
        // config later is heard too; otherwise the list as chosen.
        const all = (this.doc?.motion_sensors || []).map((x) => x.entity);
        const m = this.motion();
        const now = new Set(m && Array.isArray(m.sensors) ? m.sensors : all);
        if (now.has(b.dataset.v)) now.delete(b.dataset.v); else now.add(b.dataset.v);
        const list = all.filter((e) => now.has(e));
        this.saveMotion({ sensors: list.length === all.length ? null : list });
      };
    });

    // ---- the morning wake-up ----
    this.body.querySelectorAll('.lx-wk-on').forEach((b) => {
      b.onclick = () => this.saveWake({ on: b.dataset.v === '1' });
    });
    this.body.querySelectorAll('.lx-wk-at').forEach((b) => {
      b.onclick = () => this.saveWake({ at: b.dataset.v });
    });
    this.body.querySelectorAll('.lx-wk-min').forEach((b) => {
      b.onclick = () => this.saveWake({ minutes: Number(b.dataset.v) });
    });
    this.body.querySelectorAll('.lx-wk-off').forEach((b) => {
      b.onclick = () => this.saveWake({ off_after: Number(b.dataset.v) || null });
    });
    this.body.querySelectorAll('.lx-wk-sch').forEach((b) => {
      b.onclick = () => this.saveWake({ school_only: b.dataset.v === '1' });
    });
    this.body.querySelectorAll('.lx-wk-day').forEach((b) => {
      b.onclick = () => {
        const d = Number(b.dataset.v);
        const days = (this.wake()?.days || []).slice();
        const i = days.indexOf(d);
        // Tapping a lit day puts it out: the row is seven switches, not a
        // choice of one, and a week with no days is a wake-up that never
        // fires rather than an error.
        if (i >= 0) days.splice(i, 1);
        else days.push(d);
        this.saveWake({ days: days.sort((x, y) => x - y) });
      };
    });
    const wslider = (sel, field, fmt) => {
      this.body.querySelectorAll(sel).forEach((sl) => {
        const cap = sl.parentElement.querySelector('.lx-cap b');
        sl.oninput = () => {
          this.dragging = true;
          if (cap) cap.textContent = fmt(Number(sl.value));
          if (sl.classList.contains('ls-fill')) sl.style.setProperty('--fill', fill(sl.value));
        };
        const done = () => {
          if (!this.dragging) return;
          this.dragging = false;
          this.saveWake({ [field]: Number(sl.value) });
        };
        sl.onchange = done;
        ['pointerup', 'pointercancel'].forEach((e) => sl.addEventListener(e, done));
      });
    };
    wslider('.lx-wk-pct', 'pct', (v) => `${v}%`);
    wslider('.lx-wk-k', 'k', (v) => `${v} K`);
  },
};
