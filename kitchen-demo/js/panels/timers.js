// Kitchen timers: three of them, shared by every screen and by the server, so a
// deploy reloading the wall mid-roast does not lose the roast.
//
// A timer is a dial *and its buttons*. The dial alone was the whole interaction
// once, and a gesture nobody can see is not an interaction: every state now
// says what it does on a button big enough to hit with a knuckle.
//
//   idle     − + set the minutes (held down, they accelerate), the presets
//              jump straight to a common time, Start runs it
//   running  Pause stops the clock, − + add or take a minute off what is left
//   paused   Resume picks it up again
//   done     Stop silences the alarm
//
// ✕ resets from any state, and the dial itself still takes a tap (same as the
// button beside it) and a vertical drag to set the minutes.

const R = 44;                       // dial radius in the 100x100 viewBox
const C = 2 * Math.PI * R;          // circumference, for the stroke-dash trick
const MAX_MIN = 180;
const MIN_RUN_S = 30;               // − on a running timer stops here, not at zero
const RING_MS = 13 * 1000;          // sound for thirteen seconds, then leave it flashing
const FADE_MS = 450;                // ...and the last of those thirteen fades out

/* The alarm sounds, and the order they are offered in. Adding one is a file in
   frontend/sounds/ and a line here — nothing else knows about them.
   `file: null` is the built-in oscillator, which is also what plays if a file
   cannot be fetched or the browser refuses to start it.

   Both clips are shorter than RING_MS (about 9s and 12s), so they loop and are
   faded out mid-repeat rather than cut. Either way the noise stops after
   thirteen seconds — long enough to walk in from another room, short of a
   kitchen alarm nobody is answering — and the card goes on flashing to say
   which timer it was. */
const SOUNDS = [
  { id: 'funny', name: 'Funny alarm', file: 'sounds/funny-alarm.mp3' },
  { id: 'cartoon', name: 'Cartoon clock', file: 'sounds/cartoon-clock.mp3' },
  { id: 'beep', name: 'Plain beeps', file: null },
];
const DEFAULT_SOUND = 'funny';
const GAP = 14;                     // must match .tm-row's gap
const MAX_DIAL = 300;
const PRESETS = [5, 10, 20, 45];    // minutes; the four a kitchen actually asks for
const HOLD_FIRST_MS = 400;          // a held − or + waits this long before repeating
const HOLD_MS = 150;

const pad = (n) => String(n).padStart(2, '0');
const clamp = (lo, n, hi) => Math.max(lo, Math.min(hi, n));

function clock(sec) {
  const s = Math.max(0, Math.ceil(sec));
  const h = Math.floor(s / 3600);
  return h ? `${h}:${pad(Math.floor((s % 3600) / 60))}:${pad(s % 60)}`
           : `${Math.floor(s / 60)}:${pad(s % 60)}`;
}

/* ---------- how many timers fit, and in what shape ----------
   The panel is a tall column in Cooking and a short wide strip under the
   photos, and the old sizing answered both with a row of dials: three across
   in a column 800px tall wasted every pixel below them, and one dial in the
   strip left the width empty — which is exactly where the buttons go.

   So the unit is a card (dial + buttons), and the arrangement is whichever
   fits the most cards: stacked in a column, side by side in a strip. */
const MIN_WIDE = { w: 250, h: 104 };   // buttons beside the dial
const MIN_TALL = { w: 100, h: 190 };   // buttons under it
// Past this a card stops gaining anything: the panel expanded to the whole
// screen was three dials marooned in a metre of empty card. The slack goes
// around the cards, where it reads as breathing room, rather than inside them.
const MAX_CARD = { w: 620, h: 400 };

function card(w, h, n, cols) {
  const rows = n / cols;
  return {
    n, cols, rows,
    w: Math.min(MAX_CARD.w, Math.floor((w - GAP * (cols - 1)) / cols)),
    h: Math.min(MAX_CARD.h, Math.floor((h - GAP * (rows - 1)) / rows)),
  };
}

function formFor(c, force) {
  const wide = c.w >= MIN_WIDE.w && c.h >= MIN_WIDE.h;
  const tall = c.w >= MIN_TALL.w && c.h >= MIN_TALL.h;
  // A card much wider than it is tall has to put the buttons beside the dial;
  // anything squarer gets a bigger dial by stacking them underneath.
  if (wide && (!tall || c.w >= c.h * 1.25)) return 'wide';
  if (tall) return 'tall';
  return force ? (c.w >= c.h * 1.25 ? 'wide' : 'tall') : null;
}

/* Everything the panel needs to lay itself out: how many cards, in what grid,
   how big the dial is, and which rows of buttons there is room for. */
function plan(w, h) {
  let best = null;
  for (const [n, cols] of [[3, 1], [3, 3], [2, 1], [2, 2], [1, 1]]) {
    const c = card(w, h, n, cols);
    const form = formFor(c, false);
    if (!form) continue;
    const room = c.w * c.h;
    // More timers first — a hidden timer is worse than a smaller one — and
    // among equals, the arrangement that leaves each card the most room.
    if (!best || n > best.n || (n === best.n && room > best.room)) {
      best = { ...c, form, room };
    }
  }
  // Nothing fits properly: one card in whatever space there is, trimmed below.
  if (!best) {
    const c = card(w, h, 1, 1);
    best = { ...c, form: formFor(c, true), room: c.w * c.h };
  }

  const want = best.form === 'wide'
    ? Math.min(best.h, Math.round(best.w * 0.44))
    : Math.min(best.w, Math.round(best.h * 0.52));
  // The floor is a wish, not a promise: in a slot too small for any of this,
  // a dial insisting on 52px would simply hang out over the edge.
  const dial = clamp(Math.min(52, best.w, best.h), want, MAX_DIAL);

  // What is left of the card once the dial has its square is the control box,
  // and each row of buttons only appears if it can be a real touch target.
  const ctlW = best.form === 'wide' ? best.w - dial - 12 : best.w;
  const ctlH = best.form === 'wide' ? best.h : best.h - dial - 10;
  const acts = ctlW >= 92 && ctlH >= 40;
  // ✕ shares its row with Start, and in a narrow box it takes as much of that
  // row as the thing people came for. Below this width, Start gets the row.
  const reset = acts && ctlW >= 150;
  const steps = acts && ctlW >= 108 && ctlH >= 88;
  const presets = steps && ctlW >= 186 && ctlH >= 142;
  return { ...best, dial, acts, reset, steps, presets };
}

export default {
  id: 'timers',
  title: 'Timers',

  init(body, ctx) {
    this.ctx = ctx;
    this.body = body;
    this.timers = [];
    this.ringing = new Set();   // sounding right now
    this.rang = new Set();      // has already sounded; do not start again
    this.adopted = false;       // has this page seen the server's state yet?
    this.plan = null;
    this.sig = '';
    this.pending = null;  // a broadcast waiting for the finger to come off
    this.skew = 0;        // server clock − ours; a phone and the wall must agree
    this.dirty = false;   // this screen has a change the server has not seen
    this._saveSeq = 0;
    this.holding = false; // a finger is on a dial or a stepper right now

    // The chooser is a sheet, not part of the panel: in the strip under the
    // photos the panel is 300px of a wall, and a list of sounds does not fit
    // in it. The header button is the way in.
    const gear = ctx.addHeaderButton(this.id, '⚙', () => this.openSounds());
    gear.className = 'gear';        // the same wheel Photos uses; see app.css
    gear.title = 'alarm sound';
    this.els = {};
    this.audioEl(this.sound());   // fetch the chosen one now, not at alarm time

    this.load();
    ctx.bus.on('timers', (rows) => {
      if (!Array.isArray(rows)) return;
      this.adopt(rows);
      // Held, not dropped: a phone may genuinely have started a timer while a
      // finger is on this dial, and there is no second announcement coming.
      this.pending = rows;
      this.absorb();
    });

    // One shared ticker for every dial: three independent intervals redrawing
    // the same panel would just be three chances to drift apart.
    this.tick = setInterval(() => this.draw(), 250);

    // How many cards fit is a question about the slot the panel was given —
    // three stacked in Cooking, one across the strip under the photos.
    this.ro = new ResizeObserver(() => this.fit());
    this.ro.observe(body);
    this.fit();
  },

  now() { return Date.now() + this.skew; },

  // Something changed here and the server has not been told yet.
  touched() { this.dirty = true; },

  /* Take the server's word for it — but never while a finger is down, and never
     while this screen is holding a change the server has not seen. Every save
     comes back over SSE, and an echo of the state *before* last is what made a
     dial jump back under the person pressing it.

     Waiting on `dirty` rather than on a stopwatch is what makes this right: the
     flag clears only once our own PUT has come back, by which time `pending`
     holds either that save's echo (applying it changes nothing) or something
     genuinely newer from a phone. A timing guard let the older broadcast land
     the moment it expired — Stop cleared a finished timer, and a second later
     the alarm state came back from the dead. */
  absorb() {
    if (!this.pending) return;
    clearTimeout(this._absorb);
    if (this.holding || this.dirty) {
      this._absorb = setTimeout(() => this.absorb(), 300);
      return;
    }
    this.timers = this.pending;
    this.pending = null;
    this.draw();
  },

  byId(id) { return this.timers.find((t) => t.id === id); },

  fit() {
    // clientWidth includes the panel's own padding, and sizing cards against
    // it overflows the row by exactly that much.
    const cs = getComputedStyle(this.body);
    const w = this.body.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
    const h = this.body.clientHeight - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom);
    if (w <= 0 || h <= 0) return;

    const p = plan(w, h);
    this.plan = p;
    this.body.style.setProperty('--tm-cols', p.cols);
    this.body.style.setProperty('--tm-card-w', `${p.w}px`);
    this.body.style.setProperty('--tm-card-h', `${p.h}px`);
    this.body.style.setProperty('--tm-dial', `${p.dial}px`);

    // Only the shape of the markup is worth rebuilding for; the sizes above
    // are variables precisely so a resize does not have to touch the DOM.
    const sig = `${p.n}|${p.cols}|${p.form}|${p.acts}${p.reset}${p.steps}${p.presets}`;
    if (sig === this.sig) return this.draw();
    this.sig = sig;
    this.render();
  },

  async load() {
    try {
      const res = await (await fetch('/api/timers')).json();
      if (res.now) this.skew = res.now * 1000 - Date.now();
      this.adopt(res.timers || []);
      this.timers = res.timers || [];
    } catch {
      return;   // the SSE snapshot will catch us up
    }
    this.render();
  },

  /* Debounced, and `dirty` stays up until the write has actually been
     acknowledged — that flag is what tells absorb() our copy is the newer one.
     A save that fails clears it too: if the server could not be told, the
     server's version is the one to believe. */
  save() {
    this.touched();
    clearTimeout(this._saveTimer);
    this._saveTimer = setTimeout(async () => {
      this._saveTimer = null;
      const mine = ++this._saveSeq;
      try {
        await fetch('/api/timers', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ timers: this.timers }),
        });
      } catch { /* the dial keeps running locally either way */ }
      // A save started since this one owns the flag now; otherwise give our own
      // echo a moment to arrive, so it is not mistaken for someone else's news.
      if (mine !== this._saveSeq) return;
      setTimeout(() => {
        if (mine === this._saveSeq && !this._saveTimer) this.dirty = false;
      }, 400);
    }, 250);
  },

  /* ---------- state ---------- */

  remaining(t) {
    if (t.state === 'running') return (t.ends_at || 0) * 1000 - this.now();
    if (t.state === 'paused') return (t.remaining_s || 0) * 1000;
    return (t.duration_s || 0) * 1000;
  },

  start(t) {
    const ms = t.state === 'paused' ? (t.remaining_s || 0) * 1000 : (t.duration_s || 0) * 1000;
    if (ms <= 0) return;
    t.state = 'running';
    t.ends_at = (this.now() + ms) / 1000;
    t.remaining_s = null;
    this.save();
  },

  pause(t) {
    t.remaining_s = Math.max(0, ((t.ends_at || 0) * 1000 - this.now()) / 1000);
    t.state = 'paused';
    t.ends_at = null;
    this.save();
  },

  reset(t) {
    this.silence(t.id);
    this.rearm(t.id);
    t.state = 'idle';
    t.ends_at = null;
    t.remaining_s = null;
    this.save();
  },

  poke(t) {
    if (t.state === 'running') this.pause(t);
    else if (t.state === 'done') this.reset(t);
    else this.start(t);
    this.draw();
  },

  /* − and +. On a timer that is already going these add to or take off what is
     left, which is the thing a kitchen actually asks for ("give it two more
     minutes"); on an idle one they set the minutes, snapped to the step so
     twelve plus five is fifteen rather than seventeen. */
  adjust(t, dir, stepMin) {
    if (t.state === 'done') return;
    const delta = dir * stepMin * 60;

    if (t.state === 'running' || t.state === 'paused') {
      const was = this.remaining(t) / 1000;
      const left = clamp(MIN_RUN_S, was + delta, MAX_MIN * 60);
      t.duration_s = clamp(1, (t.duration_s || 0) + (left - was), MAX_MIN * 60);
      if (t.state === 'running') t.ends_at = (this.now() + left * 1000) / 1000;
      else t.remaining_s = left;
    } else {
      const mins = Math.round((t.duration_s || 0) / 60);
      const next = dir > 0
        ? Math.floor(mins / stepMin) * stepMin + stepMin
        : Math.ceil(mins / stepMin) * stepMin - stepMin;
      t.duration_s = clamp(1, next, MAX_MIN) * 60;
    }
    this.touched();
    this.draw();
  },

  setMinutes(t, mins) {
    if (t.state === 'running' || t.state === 'done') return;
    t.duration_s = clamp(1, Math.round(mins), MAX_MIN) * 60;
    t.state = 'idle';
    t.remaining_s = null;
    t.ends_at = null;
    this.save();
    this.draw();
  },

  /* ---------- the alarm ----------
     A chosen sound from frontend/sounds/, and the oscillator below as the
     floor: it costs no network and cannot be the one asset a cache misses, so
     a timer still makes a noise when the file does not arrive. Chrome on the
     wall runs with --autoplay-policy=no-user-gesture-required; a phone does
     not, which is what unlock() is for. */

  soundId() {
    const id = this.ctx.uiState?.alarm_sound;
    return SOUNDS.some((s) => s.id === id) ? id : DEFAULT_SOUND;
  },

  sound(id = this.soundId()) {
    return SOUNDS.find((s) => s.id === id) || SOUNDS[0];
  },

  /* One <audio> per sound, kept and reused: made fresh at alarm time the file
     would still be arriving while the timer flashes silently. */
  audioEl(sound) {
    this.els ||= {};
    if (!this.els[sound.id] && sound.file) {
      const el = new Audio(sound.file);
      el.preload = 'auto';
      this.els[sound.id] = el;
    }
    return this.els[sound.id];
  },

  /* A phone will not play anything until the person has touched the page, and
     the alarm is precisely the moment nobody is touching it. So the first touch
     anywhere in this panel spends a silent, instantly-paused play on the
     selected sound, which is enough to leave it unlocked. */
  unlock() {
    if (this.unlocked) return;
    this.unlocked = true;
    const el = this.audioEl(this.sound());
    if (!el) return;
    el.muted = true;
    Promise.resolve(el.play())
      .then(() => { el.pause(); el.currentTime = 0; })
      .catch(() => { /* still locked; the beeps are the fallback */ })
      .finally(() => { el.muted = false; });
  },

  playAlarm() {
    this.stopAlarm();
    const sound = this.sound();
    const el = this.audioEl(sound);
    if (!el) return this.beepLoop();

    try {
      el.loop = true;          // a clip shorter than the window repeats
      el.volume = 1;
      el.currentTime = 0;
      Promise.resolve(el.play()).catch(() => this.beepLoop());
    } catch {
      return this.beepLoop();
    }
    // Fade rather than cut: both clips are longer than the window they get.
    this.fadeTimer = setTimeout(() => {
      this.fader = setInterval(() => {
        el.volume = Math.max(0, el.volume - 60 / FADE_MS);
        if (el.volume <= 0.02) { clearInterval(this.fader); this.fader = null; }
      }, 60);
    }, Math.max(0, RING_MS - FADE_MS));
  },

  stopAlarm() {
    clearTimeout(this.fadeTimer); this.fadeTimer = null;
    clearInterval(this.fader); this.fader = null;
    clearTimeout(this.beepTimer); this.beepTimer = null;
    for (const el of Object.values(this.els || {})) {
      el.pause();
      try { el.currentTime = 0; el.volume = 1; } catch { /* not loaded yet */ }
    }
  },

  beepLoop() {
    const started = Date.now();
    const again = () => {
      if (Date.now() - started > RING_MS - 400) return;
      this.beep();
      this.beepTimer = setTimeout(again, 1200);
    };
    again();
  },

  beep() {
    try {
      this.audio ||= new (window.AudioContext || window.webkitAudioContext)();
      if (this.audio.state === 'suspended') this.audio.resume();
      const t0 = this.audio.currentTime;
      for (let i = 0; i < 2; i++) {          // bip-bip
        const osc = this.audio.createOscillator();
        const gain = this.audio.createGain();
        osc.type = 'square';
        osc.frequency.value = 880;
        const at = t0 + i * 0.28;
        gain.gain.setValueAtTime(0.0001, at);
        gain.gain.exponentialRampToValueAtTime(0.28, at + 0.01);
        gain.gain.exponentialRampToValueAtTime(0.0001, at + 0.2);
        osc.connect(gain).connect(this.audio.destination);
        osc.start(at);
        osc.stop(at + 0.22);
      }
    } catch { /* a mute wall screen still shows the dial full and flashing */ }
  },

  /* Sounds for RING_MS and then stops for good. `rang` is what makes "for good"
     true: draw() calls this four times a second for as long as the timer says
     done, so without a record that this one has already had its alarm, the
     moment the sound ends it starts again — which is why the beeping never
     stopped until the timer was cleared. */
  ring(id) {
    if (this.ringing.has(id) || this.rang.has(id)) return;
    this.ringing.add(id);
    this.rang.add(id);
    this.playAlarm();
    clearTimeout(this.ringOff);
    this.ringOff = setTimeout(() => this.silence(id), RING_MS);
  },

  silence(id) {
    if (!this.ringing.delete(id)) return;
    if (!this.ringing.size) this.stopAlarm();   // another timer may still be going
  },

  // Leaving the done state re-arms the alarm for next time.
  rearm(id) { this.rang.delete(id); },

  /* The state the server hands a freshly loaded page is history, not news.
     `rang` is what stops a finished timer ringing twice, and it starts empty
     on every page load — so a timer left sitting in `done`, which is what a
     timer nobody pressed Stop on stays as, sounded its alarm again on every
     single refresh. The wall reloads itself after every deploy, so that read
     as an alarm going off on its own: it blinks and rings, and nobody started
     anything.

     So the first state this page ever sees is *adopted* rather than reacted
     to: whatever is already finished has already had its alarm, and only a
     timer that runs out while this page is watching gets to make a noise.

     The exception is the one that matters — a timer that expired inside the
     handful of seconds the reload itself took. That is the deploy-mid-roast
     case the server-side state exists for, so it still rings. */
  adopt(rows) {
    if (this.adopted) return;
    this.adopted = true;
    const grace = this.now() - 60 * 1000;   // a reload takes ~15s, not a minute
    for (const t of rows) {
      if (!t) continue;
      if (t.state === 'done'
          || (t.state === 'running' && (t.ends_at || 0) * 1000 < grace)) {
        this.rang.add(t.id);
      }
    }
  },

  /* ---------- choosing the alarm sound ----------
     Tapping a name plays it and keeps it: on a wall you find the sound you
     want by hearing it, not by reading its name, and there is no Save button
     to forget. The choice is kept in server-side ui-state, so it survives the
     wall reloading itself after a deploy. (ui-state is not broadcast, so a
     second screen picks the change up on its next load, not instantly.) */

  openSounds() {
    if (!this.sheet) {
      this.sheet = document.createElement('div');
      this.sheet.id = 'alarm-sheet';
      this.sheet.innerHTML = `
        <div class="as-card">
          <header>
            <h2>Alarm sound</h2>
            <span class="spacer"></span>
            <button class="as-close">Close</button>
          </header>
          <div class="as-list">${SOUNDS.map((s) => `
            <button class="as-opt" data-id="${s.id}">
              <span class="as-name">${s.name}</span>
              <span class="as-tick">✓</span>
            </button>`).join('')}</div>
          <p class="as-hint">Tap one to hear it and use it. A finished timer
            plays it for thirteen seconds, then keeps flashing.</p>
        </div>`;
      document.body.appendChild(this.sheet);
      this.wireTap(this.sheet.querySelector('.as-close'), () => this.closeSounds());
      this.sheet.querySelectorAll('.as-opt').forEach((btn) =>
        this.wireTap(btn, () => this.pickSound(btn.dataset.id)));
      // A tap on the ground outside the card closes it, like a dropped lid.
      this.sheet.addEventListener('pointerdown', (e) => {
        if (e.target === this.sheet) this.closeSounds();
      });
    }
    this.markSound();
    this.sheet.classList.add('open');
  },

  closeSounds() {
    this.stopAlarm();          // whatever was previewing stops with the sheet
    this.sheet?.classList.remove('open');
  },

  pickSound(id) {
    if (!SOUNDS.some((s) => s.id === id)) return;
    this.ctx.saveUiState({ alarm_sound: id });
    this.unlocked = true;      // this very tap is the gesture that unlocks it
    this.markSound();
    this.stopAlarm();
    this.playAlarm();          // hear it, for the same thirteen seconds it gets
    clearTimeout(this.previewOff);
    this.previewOff = setTimeout(() => { if (!this.ringing.size) this.stopAlarm(); }, RING_MS);
  },

  markSound() {
    const chosen = this.soundId();
    this.sheet?.querySelectorAll('.as-opt').forEach((b) =>
      b.classList.toggle('on', b.dataset.id === chosen));
  },

  /* ---------- drawing ---------- */

  shown() {
    // When only one card fits, a running timer must be the one you can see.
    const rank = (t) => (t.state === 'done' ? 0 : t.state === 'running' ? 1
      : t.state === 'paused' ? 2 : 3);
    return [...this.timers].sort((a, b) => rank(a) - rank(b) || a.id - b.id)
      .slice(0, this.plan ? this.plan.n : 1)
      .sort((a, b) => a.id - b.id);
  },

  render() {
    if (!this.timers.length || !this.plan) {
      this.body.innerHTML = '<div class="placeholder">timers unavailable</div>';
      return;
    }
    const p = this.plan;
    const controls = () => `
      <div class="tm-ctl">
        ${p.steps ? `
        <div class="tm-steps">
          <button class="tm-step" data-dir="-1" aria-label="less time">−</button>
          <button class="tm-step" data-dir="1" aria-label="more time">+</button>
        </div>` : ''}
        <div class="tm-acts">
          <button class="tm-go"></button>
          ${p.reset ? '<button class="tm-reset" aria-label="reset">✕</button>' : ''}
        </div>
        ${p.presets ? `<div class="tm-presets">${PRESETS.map((m) => `
          <button class="tm-preset" data-min="${m}">${m}</button>`).join('')}</div>` : ''}
      </div>`;

    this.body.innerHTML = `<div class="tm-row">${this.shown().map((t) => `
      <div class="tm ${p.form}" data-id="${t.id}">
        <button class="tm-dial" aria-label="timer ${t.id + 1}">
          <svg viewBox="0 0 100 100">
            <circle class="tm-track" cx="50" cy="50" r="${R}"/>
            <circle class="tm-arc" cx="50" cy="50" r="${R}"
                    stroke-dasharray="${C.toFixed(2)}" stroke-dashoffset="${C.toFixed(2)}"/>
          </svg>
          <span class="tm-face"><span class="tm-time"></span><span class="tm-sub"></span></span>
        </button>
        ${p.acts ? controls() : ''}
      </div>`).join('')}</div>`;

    /* Handlers are wired to the timer's **id**, never to the object.
       `this.timers` is replaced wholesale every time a save is broadcast back
       over SSE — which is constantly — and a handler holding the old object
       then quietly edits an orphan: the button lights up, the state changes on
       something nothing is drawing, and the wall does not move. That is the
       "sometimes it just does not respond". */
    this.body.querySelectorAll('.tm').forEach((el) => {
      const id = Number(el.dataset.id);
      const on = (fn) => () => { const t = this.byId(id); if (t) fn(t); };
      this.wireDial(el.querySelector('.tm-dial'), id);
      this.wireTap(el.querySelector('.tm-go'), on((t) => this.poke(t)));
      this.wireTap(el.querySelector('.tm-reset'), on((t) => { this.reset(t); this.draw(); }));
      el.querySelectorAll('.tm-step').forEach((b) => this.wireStep(b, id, Number(b.dataset.dir)));
      el.querySelectorAll('.tm-preset').forEach((b) =>
        this.wireTap(b, on((t) => this.setMinutes(t, Number(b.dataset.min)))));
    });
    this.draw();
  },

  /* Buttons here answer to pointers, not to `click`. A click is only synthesised
     after the browser has satisfied itself that the touch was not a scroll, a
     double-tap or a drag — and on a wall screen, pressed with a knuckle or a wet
     fingertip, the few pixels of travel that follow are enough for it to decide
     the tap never happened. That is the Pause that did nothing.

     Pointer capture keeps the release on this button even if the finger slides
     off it; only real travel (over 30px, i.e. a deliberate drag) cancels. */
  wireTap(btn, fn) {
    if (!btn) return;
    let armed = false, x0 = 0, y0 = 0;

    btn.addEventListener('pointerdown', (e) => {
      if (btn.disabled) return;
      this.unlock();               // spend this touch on the phone's audio lock
      armed = true; x0 = e.clientX; y0 = e.clientY;
      e.preventDefault();          // no double-tap zoom, no text selection
      try { btn.setPointerCapture(e.pointerId); } catch { /* fine without */ }
    });
    btn.addEventListener('pointerup', (e) => {
      if (!armed) return;
      armed = false;
      if (btn.disabled) return;
      if (Math.hypot(e.clientX - x0, e.clientY - y0) > 30) return;
      fn();
    });
    btn.addEventListener('pointercancel', () => { armed = false; });
    // A mouse on the phone or laptop still gets here through the same path;
    // keyboard users (rare, but the editor is opened on a phone) get click.
    btn.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); fn(); }
    });
  },

  /* A held − or + walks faster the longer it is held: single minutes at first,
     then fives, then tens, so an hour is a couple of seconds away and eleven
     minutes is still exactly eleven. */
  wireStep(btn, id, dir) {
    let timer = null;
    let count = 0;

    const fire = () => {
      const t = this.byId(id);
      if (!t) return;
      count += 1;
      this.adjust(t, dir, count <= 4 ? 1 : count <= 10 ? 5 : 10);
      timer = setTimeout(fire, count === 1 ? HOLD_FIRST_MS : HOLD_MS);
    };
    const stop = () => {
      if (!timer && !count) return;
      clearTimeout(timer);
      timer = null;
      count = 0;
      this.holding = false;
      this.save();
    };

    btn.addEventListener('pointerdown', (e) => {
      e.preventDefault();          // no text selection, no long-press menu
      if (btn.disabled) return;
      this.unlock();
      this.holding = true;
      try { btn.setPointerCapture(e.pointerId); } catch { /* fine without */ }
      fire();
    });
    ['pointerup', 'pointercancel', 'lostpointercapture'].forEach((ev) =>
      btn.addEventListener(ev, stop));
  },

  /* The dial is a control in its own right: a tap does whatever the button
     beside it says, and on an idle dial a vertical drag sets the minutes. The
     tap once had a 6px tolerance, which no fingertip on a wall-mounted screen
     has ever met — every tap registered as a tiny drag, which is why nothing
     appeared to start, pause or reset. */
  wireDial(dial, id) {
    let y0 = 0, min0 = 0, moved = false, down = false;

    dial.addEventListener('pointerdown', (e) => {
      const t = this.byId(id);
      if (!t) return;
      this.unlock();
      down = true; moved = false;
      this.holding = true;
      y0 = e.clientY;
      min0 = Math.round((t.duration_s || 600) / 60);
      try { dial.setPointerCapture(e.pointerId); } catch { /* fine without */ }
    });
    dial.addEventListener('pointermove', (e) => {
      const t = down && this.byId(id);
      // Only an idle dial can be dragged. On a running or paused one the drag
      // used to throw the remaining time away, which is a lot to lose to a
      // wobble, and it made every tap on a timer that was already going a
      // gamble. Those dials now do one thing: pause and resume.
      if (!t || t.state !== 'idle') return;
      const dy = y0 - e.clientY;
      if (Math.abs(dy) > 24) moved = true;    // a tap, not a drag, below this
      if (!moved) return;
      // 7px of travel per minute: a whole hour is one long swipe, and a single
      // minute is still landable. Above an hour it moves in fives, because
      // nobody sets 63 minutes and the last stretch is the hardest to hold.
      let mins = clamp(1, min0 + Math.round(dy / 7), MAX_MIN);
      if (mins > 60) mins = Math.round(mins / 5) * 5;
      t.duration_s = mins * 60;
      this.touched();
      this.draw();
    });
    const end = () => {
      if (!down) return;
      down = false;
      this.holding = false;
      const t = this.byId(id);
      if (!t) return;
      if (moved) this.save(); else this.poke(t);
    };
    dial.addEventListener('pointerup', end);
    // A drag that ends off the element still has to be saved: losing it left
    // the wall showing minutes the server had never heard of.
    dial.addEventListener('lostpointercapture', end);
    dial.addEventListener('pointercancel', end);
  },

  /* Redraw values only — never markup. This runs four times a second, and
     rebuilding the DOM under a finger that is mid-drag would fight it. */
  draw() {
    // The one exception: when a single card fits, it has to be the running
    // timer, and any of the three can be started from a phone.
    if (this.plan && this.timers.length && !this.holding) {
      const want = this.shown().map((t) => t.id).join();
      const have = [...this.body.querySelectorAll('.tm')].map((el) => el.dataset.id).join();
      if (want !== have) return this.render();
    }

    for (const el of this.body.querySelectorAll('.tm')) {
      const t = this.byId(Number(el.dataset.id));
      if (!t) continue;
      const left = this.remaining(t);

      if (t.state === 'running' && left <= 0) {
        t.state = 'done';
        t.ends_at = null;
        t.remaining_s = 0;
        this.save();
      }
      if (t.state === 'done') this.ring(t.id);
      else { this.silence(t.id); this.rearm(t.id); }

      const total = (t.duration_s || 1) * 1000;
      const done = t.state === 'done';
      const idle = t.state === 'idle';
      // Fills as time passes: empty at the start, a whole ring at the set time.
      const progress = done ? 1 : idle ? 0 : clamp(0, 1 - left / total, 1);

      el.classList.toggle('running', t.state === 'running');
      el.classList.toggle('paused', t.state === 'paused');
      el.classList.toggle('done', done);
      el.querySelector('.tm-arc').style.strokeDashoffset = (C * (1 - progress)).toFixed(2);

      const time = el.querySelector('.tm-time');
      const sub = el.querySelector('.tm-sub');
      if (done) { time.textContent = 'Done'; sub.textContent = ''; }
      else if (idle) {
        time.textContent = `${Math.round((t.duration_s || 0) / 60)}`;
        sub.textContent = 'min';
      } else {
        time.textContent = clock(left / 1000);
        sub.textContent = t.state === 'paused' ? 'paused' : 'left';
      }

      // The verb lives on the button, where it can be read: the dial does the
      // same thing when tapped, but only the button says so.
      const go = el.querySelector('.tm-go');
      if (go) {
        go.textContent = done ? 'Stop' : t.state === 'running' ? 'Pause'
          : t.state === 'paused' ? 'Resume' : 'Start';
        const rst = el.querySelector('.tm-reset');
        if (rst) rst.hidden = idle;   // nothing to reset, and Start wants the room
      }
      el.querySelectorAll('.tm-step').forEach((b) => { b.disabled = done; });
      el.querySelectorAll('.tm-preset').forEach((b) => {
        b.disabled = t.state === 'running' || done;
        b.classList.toggle('on', idle && Number(b.dataset.min) === Math.round((t.duration_s || 0) / 60));
      });
    }
  },

  onHide() { for (const t of this.timers) this.silence(t.id); },
};
