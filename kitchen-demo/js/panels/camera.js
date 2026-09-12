// Bird box — the wall's own panel, with a clip where the camera was.
//
// On the wall this is a WebRTC stream off a nest-box camera, held to three
// rules that keep a cheap camera happy: exactly one stream element at a time,
// expanding swaps the sub stream for the HD one, and hiding the panel destroys
// the element so the streamer drops its consumer. There is no camera behind a
// static demo, so the element here is a looping <video> — and everything
// around it is kept: the same lifecycle, the same "connecting…" overlay and
// Live badge, the same motion log, settings sheet and alarm bar, all of it
// talking to demo/api.js.

// No camera behind a static demo, and so no player component: the element
// this panel creates is an ordinary looping <video>. Swapping the file in
// media/birdbox.mp4 is the whole of changing what the box shows.
const CLIP = 'media/birdbox.mp4';
const POSTER = 'media/birdbox.jpg';

const STALL_CHECK_MS = 5000;
const STALL_LIMIT = 3; // 3 checks x 5s = 15s frozen -> recreate

/* The noise the wall makes when the camera reports. The same two files the
   timers use, plus an oscillator that costs no network and cannot be the one
   asset a cache misses — which matters more here than there, because nobody is
   standing at the wall when this plays. */
const MOTION_SOUNDS = [
  { id: 'chime', name: 'Chime', file: null },
  { id: 'funny', name: 'Funny alarm', file: 'sounds/funny-alarm.mp3' },
  { id: 'cartoon', name: 'Cartoon clock', file: 'sounds/cartoon-clock.mp3' },
];

/* "Until stopped" is `beep_ms: 0` — the sound goes round until a person ends
   it, and a bar comes up carrying the button that does.

   With a cap on it, which is the one place this disobeys its own name. The box
   reports birds, and on an empty house an uncapped alarm is still sounding at
   midnight; a wall that cannot be quietened from the room it is in is a wall
   somebody unplugs, and an unplugged wall answers nothing at all. Ten minutes
   is long enough to have walked in from the garden. */
const ALERT_MAX_MS = 10 * 60 * 1000;
const TONE_EVERY_MS = 1400;   // the oscillator has no loop of its own

const esc = (s) => String(s ?? '').replace(/[&<>"]/g,
  (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

const hhmm = (ts) => new Date(ts * 1000)
  .toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false });

export default {
  id: 'camera',
  title: 'Bird box',
  // The bird box streams 4:3 — same wasted band as Photos, same forecast in it.
  sideWeather: true,
  // Full screen, the stream is the screen, as a photograph is. See .bleed in
  // app.css.
  fullBleed: true,
  // Leaving the page drops the stream, exactly as hiding the panel does:
  // a camera consumer nobody is watching is the same cost either way.
  pauseWhenUnseen: true,

  init(body, ctx) {
    this.ctx = ctx;
    this.body = body;
    this.expanded = false;
    this.muted = ctx.uiState.cam_muted !== false;
    body.innerHTML = '<div class="cam-overlay">connecting to the camera…</div>'
      + '<div class="cam-live" hidden><i></i>Live</div>'
      + '<div class="cam-sheet cam-events" hidden></div>'
      + '<div class="cam-sheet cam-settings" hidden></div>';
    this.overlay = body.querySelector('.cam-overlay');
    this.liveBadge = body.querySelector('.cam-live');
    this.elEvents = body.querySelector('.cam-events');
    this.elSettings = body.querySelector('.cam-settings');

    /* What the camera has reported, and what the wall is to do about it. The
       detecting happens on the camera's own chip; this panel is the part that
       says so, keeps the count, and makes the noise. See backend/app/motion.py.

       The count is a button because the question after "three since midnight"
       is always "three of what", and the answer is the stills behind it. */
    this.motion = { settings: {}, count_today: 0, events: [], connected: false };
    this._lastMotionAt = null;
    this.ringing = false;
    this.buildAlertBar();

    /* The row reads left to right as what the box did, then the three things
       the wall does about it, then the settings behind all of them: the count,
       the lights, the alert sound, the camera's own sound, the gear. The two
       sounds are named for which sound they are — "Motion" and "Sound off"
       were a state of the log and a state of the stream wearing the same
       word, and the pair of them said neither. */
    this.countBtn = ctx.addHeaderButton(this.id, '—', () => this.openEvents());
    this.countBtn.title = 'the stills and clips the camera has kept';
    this.lightBtn = ctx.addHeaderButton(this.id, '💡', () => this.toggleLights());
    this.beepBtn = ctx.addHeaderButton(this.id, 'Motion sound', () => this.toggleBeep());
    this.muteBtn = ctx.addHeaderButton(this.id, 'Camera sound', () => this.toggleMute());
    const gear = ctx.addHeaderButton(this.id, '⚙', () => this.openSettings());
    gear.className = 'gear';
    gear.title = 'what to do when the camera sees something';
    ctx.setMeta(this.id, 'demo clip · looping');
    ctx.bus.on('motion', (m) => this.onMotion(m));
    this.paintMotion();

    this.el = null;
    this._stalls = 0;
    this._lastTime = -1;
    setInterval(() => this.watchdog(), STALL_CHECK_MS);
    // no create() here: onShow() from the layout engine owns element lifetime
  },

  create() {
    this.destroy();
    // A hidden tab (user is on Netflix, or a stray duplicate tab) must not
    // hold a camera connection — defer creation until we're visible again.
    if (document.hidden) {
      if (!this._deferred) {
        this._deferred = () => {
          if (!document.hidden) {
            removeEventListener('visibilitychange', this._deferred);
            this._deferred = null;
            this.create();
          }
        };
        addEventListener('visibilitychange', this._deferred);
      }
      return;
    }
    const el = document.createElement('video');
    el.className = 'cam-video';
    el.src = CLIP;
    el.poster = POSTER;
    el.loop = true;
    el.autoplay = true;
    el.playsInline = true;
    el.preload = 'auto';
    el.muted = this.muted;
    // The wall's stream element holds its own <video> and exposes it as
    // `.video`; the mute button and the stall watchdog both reach through that
    // name. A plain <video> is its own, which leaves both of them working here
    // without a line of their code changing.
    el.video = el;
    this.overlay.classList.remove('hidden');
    this.overlay.textContent = 'connecting to the camera…';
    if (this.liveBadge) this.liveBadge.hidden = true;
    this.body.appendChild(el);
    this.el = el;
    this._stalls = 0;
    this._lastTime = -1;
    // hide the overlay as soon as frames flow
    const hide = () => {
      this.overlay.classList.add('hidden');
      if (this.liveBadge) this.liveBadge.hidden = false;
    };
    el.addEventListener('playing', hide, true);
    el.addEventListener('timeupdate', hide, true);
    // A file that will not load says so rather than sitting on "connecting…"
    // for ever — the one failure this panel can actually have in a demo.
    el.addEventListener('error', () => {
      this.overlay.classList.remove('hidden');
      this.overlay.textContent = `no clip at ${CLIP}`;
    });
    el.play().catch(() => { /* autoplay refused; the poster stands in */ });
  },

  destroy() {
    if (this._deferred) {
      removeEventListener('visibilitychange', this._deferred);
      this._deferred = null;
    }
    if (this.el) { this.el.remove(); this.el = null; }
  },

  watchdog() {
    const el = this.el;
    if (!el || !el.video || document.hidden) return;
    const t = el.video.currentTime;
    if (!el.video.paused && t > 0 && t === this._lastTime) {
      if (++this._stalls >= STALL_LIMIT) {
        this.overlay.classList.remove('hidden');
        this.overlay.textContent = 'reconnecting to the camera…';
        if (this.liveBadge) this.liveBadge.hidden = true;
        this.create();
      }
    } else {
      this._stalls = 0;
    }
    this._lastTime = t;
  },

  toggleMute() {
    this.muted = !this.muted;
    if (this.el && this.el.video) this.el.video.muted = this.muted;
    this.ctx.saveUiState({ cam_muted: this.muted });
    this.paintMotion();
  },

  /* ---------------- motion ----------------
     Everything below reacts to one SSE key. The server owns the settings and
     the log; this panel never decides anything on its own, so a second screen
     watching the same camera agrees with this one without being told. */
  onMotion(m) {
    if (!m || typeof m !== 'object') return;
    const first = this._lastMotionAt === null;
    const fresh = !first && (m.last_at || 0) > this._lastMotionAt;
    this._lastMotionAt = m.last_at || 0;
    this.motion = { ...this.motion, ...m };
    this.paintMotion();
    if (!this.elSettings.hidden) this.renderSettings();
    // Looking at one event is not the same screen as the log, and a bird that
    // reports while somebody is reading a still must not throw them back out
    // to the grid — which is what re-rendering the log under them did.
    if (!this.elEvents.hidden) {
      if (this.oneId) this.showOne(this.oneId); else this.renderEvents();
    }
    // Only for something that has just happened: a reconnect replays the
    // snapshot, and a wall that beeped at every reconnect would be a wall
    // nobody leaves switched on.
    if (fresh && this.motion.settings?.alerts) this.beep();
  },

  paintMotion() {
    const s = this.motion.settings || {};
    if (this.countBtn) {
      // "11 in 24 h" was a figure with its subject left out — in 24 hours of
      // what? The count is the number of times something came to the box, and
      // nought is still an answer, so it says so rather than going blank.
      const n = this.motion.count_today || 0;
      this.countBtn.textContent = n ? `${n} visit${n === 1 ? '' : 's'} today` : 'nothing today';
      this.countBtn.classList.toggle('cam-quiet', !n);
    }
    if (this.beepBtn) {
      const on = s.beep !== false;
      this.beepBtn.textContent = on ? 'Motion sound on' : 'Motion sound off';
      this.beepBtn.classList.toggle('on', on);
    }
    if (this.lightBtn) {
      const on = s.light_pulse === true;
      const rooms = (s.light_rooms || []).length;
      this.lightBtn.textContent = on ? '💡 Flash on' : '💡 Flash off';
      this.lightBtn.classList.toggle('on', on);
      // On with nowhere to flash is a switch that does nothing when pressed,
      // which on this wall teaches people to stop pressing things. The button
      // says where to fix it rather than looking broken.
      this.lightBtn.title = !on ? 'flash the chosen rooms when the camera reports'
        : rooms ? `flashes ${rooms} room${rooms === 1 ? '' : 's'} when the camera reports`
        : 'no rooms chosen yet — pick them behind the gear';
      this.lightBtn.classList.toggle('cam-quiet', on && !rooms);
    }
    if (this.muteBtn) {
      this.muteBtn.textContent = this.muted ? 'Camera sound off' : 'Camera sound on';
      this.muteBtn.classList.toggle('on', !this.muted);
    }
    /* Switching the sound off is also a way of stopping one that is sounding —
       from the button in this row, from the gear, or from a phone on the other
       side of the house. Every one of those arrives here as a settings change,
       so this is the one place that has to notice. */
    if (this.ringing && (s.beep === false || s.alerts === false)) this.stopAlert();
  },

  /* The sensitivity is the camera's, so this is a round trip to the box
     outside rather than a line in a file here. It can genuinely fail — the
     camera is unplugged for half the year — and a failure has to leave the row
     showing what the camera really has, never what was just tapped.

     A backend older than this endpoint answers 404, which is "not there" and
     not an answer: the frontend deploys on its own, so that pairing is a
     normal state rather than a broken one. */
  async putCamera(level) {
    try {
      const r = await fetch('/api/motion/camera', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ level }),
      });
      if (!r.ok) throw new Error();
      const res = await r.json();
      if (res.camera) this.motion.camera = res.camera;
    } catch { /* the SSE snapshot is still the truth; nothing local to undo */ }
    if (!this.elSettings.hidden) this.renderSettings();
  },

  async put(body) {
    try {
      const res = await (await fetch('/api/motion/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })).json();
      if (res.settings) this.motion.settings = res.settings;
    } catch { /* the SSE snapshot is still the truth; nothing local to undo */ }
    this.paintMotion();
    if (!this.elSettings.hidden) this.renderSettings();
  },

  /* The noise the wall makes, not whether the camera is watched: switching this
     off leaves the count moving and the stills arriving, which is what the two
     of them being separate settings is for. Whether the wall reacts at all is
     "Motion alerts" behind the gear. */
  toggleBeep() { this.put({ beep: !(this.motion.settings?.beep !== false) }); },

  /* The same alert, said in the rooms that cannot hear the wall — the server
     does the flashing (backend/app/motion.py), so it happens whether or not
     this screen is awake to see it. */
  toggleLights() { this.put({ light_pulse: !(this.motion.settings?.light_pulse === true) }); },

  /* A file if one is chosen, an oscillator otherwise, and the oscillator again
     if the file will not play. Chrome on the wall runs with
     --autoplay-policy=no-user-gesture-required; a laptop may refuse until the
     page has been touched, which is the one case where nothing sounds. */
  beep() {
    const cfg = this.motion.settings || {};
    if (cfg.beep === false) return;
    // 0 is "until stopped". Read with ?? rather than ||, or the one setting
    // whose value is nought would read as "unset" and come back as 0.6s.
    const raw = Number(cfg.beep_ms ?? 600);
    const forever = raw === 0;
    const ms = forever ? TONE_EVERY_MS : Math.max(100, Math.min(4000, raw || 600));
    const sound = MOTION_SOUNDS.find((s) => s.id === cfg.beep_sound) || MOTION_SOUNDS[0];
    if (forever) this.raiseAlert();
    if (!sound.file) return this.tone(ms, forever);
    try {
      this.els ||= {};
      const el = (this.els[sound.id] ||= new Audio(sound.file));
      el.loop = forever;
      el.currentTime = 0;
      clearTimeout(this._soundTimer);
      this._playing = el;
      Promise.resolve(el.play())
        .then(() => {
          // Stop is what ends this one — a timer would be a second opinion
          // about when the noise is over.
          if (forever) return;
          this._soundTimer = setTimeout(() => { el.pause(); el.currentTime = 0; }, ms);
        })
        .catch(() => this.tone(ms, forever));
    } catch { this.tone(ms, forever); }
  },

  tone(ms, repeat = false) {
    if (repeat) {
      // The oscillator is one note with an end; looping it is scheduling the
      // next one. Cleared by stopAlert(), which is the only way out.
      clearInterval(this._toneTimer);
      this._toneTimer = setInterval(() => this.tone(ms), ms + 400);
    }
    try {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      if (!Ctx) return;
      this.audio ||= new Ctx();
      const ctx = this.audio;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.value = 880;
      // A flat square of sound clicks at both ends; this rises and falls.
      const now = ctx.currentTime;
      const end = now + ms / 1000;
      gain.gain.setValueAtTime(0.0001, now);
      gain.gain.exponentialRampToValueAtTime(0.25, now + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, end);
      osc.connect(gain).connect(ctx.destination);
      osc.start(now);
      osc.stop(end + 0.02);
    } catch { /* no audio on this machine; the count still moves */ }
  },

  /* ---------------- the alert that has to be stopped ----------------
     A sound with no end of its own needs the button that ends it in front of
     whoever is in the room. Not in this panel: the module runs in every view,
     so the noise plays on Cooking and on the photographs too, and a Stop
     inside the bird box would be a Stop you have to go and find first. It is
     fixed over everything instead, the way meal time is — and under meal time,
     which is the one thing on this wall allowed to be blacker than an alarm. */
  buildAlertBar() {
    if (document.getElementById('cam-alert')) return;   // one wall, one bar
    const el = document.createElement('div');
    el.id = 'cam-alert';
    el.innerHTML = `
      <span class="al-mark">🔔</span>
      <span class="al-txt"><b>Something at the bird box</b><i></i></span>
      <button class="al-see">Show me</button>
      <button class="al-stop">Stop</button>`;
    document.body.appendChild(el);
    this.alertBar = el;
    el.querySelector('.al-stop').onclick = () => this.stopAlert();
    // Looking at it is answering it: the alarm has done its job the moment
    // somebody asks to see the box, so this ends the noise as well.
    el.querySelector('.al-see').onclick = () => {
      this.stopAlert();
      this.ctx.setPreset('birds');
    };
  },

  raiseAlert() {
    if (!this.alertBar) return;
    this.ringing = true;
    this.alertBar.querySelector('.al-txt i').textContent =
      hhmm(this.motion.last_at || Date.now() / 1000);
    this.alertBar.classList.add('on');
    clearTimeout(this._alertCap);
    this._alertCap = setTimeout(() => this.stopAlert(), ALERT_MAX_MS);
  },

  stopAlert() {
    this.ringing = false;
    clearTimeout(this._alertCap);
    clearTimeout(this._soundTimer);
    clearInterval(this._toneTimer);
    this._toneTimer = null;
    if (this._playing) {
      this._playing.loop = false;
      this._playing.pause();
      this._playing.currentTime = 0;
      this._playing = null;
    }
    this.alertBar?.classList.remove('on');
  },

  sheet(which) {
    this.elSettings.hidden = which !== 'settings';
    this.elEvents.hidden = which !== 'events';
  },

  closeSheets() { this.sheet(null); },

  openSettings() {
    if (!this.elSettings.hidden) return this.closeSheets();
    this.renderSettings();
    this.sheet('settings');
  },

  openEvents() {
    if (!this.elEvents.hidden) return this.closeSheets();
    this.showEvents();
  },

  showEvents() {
    this.renderEvents();
    this.sheet('events');
  },

  /* Another part of the wall asking for one of this panel's own screens. The
     three stills in the top bar are the same three this log holds, so a finger
     on one of them has to arrive *here*; before, it arrived at the live
     picture, which after dark is a black rectangle and reads as nothing having
     happened at all. Not a toggle — the caller is asking for this screen, not
     for whichever screen it is not on. */
  onAsk(what) { if (what === 'events') this.showEvents(); },

  /* One tap sets a value and saves it, the same contract the slideshow gear
     keeps: a wall screen has no Save button anybody would remember to press. */
  settingRows() {
    const s = this.motion.settings || {};
    const clip = s.clip ? Number(s.clip_s) || 8 : 0;
    // The rooms this house actually has, named as the House view names them —
    // there is no second list of rooms anywhere, and there must not be.
    const rooms = (this.ctx.config.entities?.lights || []).filter((r) => r.entity);
    const chosen = Array.isArray(s.light_rooms) ? s.light_rooms : [];
    /* The camera's own detector, and the only setting here that decides
       whether there is an event at all — everything under it decides what the
       wall does about one. So it goes first.

       It is not part of `settings`: it lives on the camera and round-trips to
       it over DVRIP, which is why it has its own key and its own PUT. A camera
       that has not answered yet has no level rather than a wrong one, and the
       row says so instead of lighting a number that came from nowhere. */
    const cam = this.motion.camera || {};
    return [
      { key: 'level', label: 'How sensitive the camera is', cam: true,
        hint: cam.level == null
          ? `the camera has not said yet${cam.error ? ` — ${cam.error}` : ''}`
          : 'the camera’s own scale, 1 to 6 — higher should mean it reports more often',
        value: cam.level ?? null,
        options: [[1, '1'], [2, '2'], [3, '3'], [4, '4'], [5, '5'], [6, '6']] },
      { key: 'alerts', label: 'Motion alerts', hint: 'the whole of it: off means the camera is still watching, the wall is not',
        value: s.alerts !== false, options: [[true, 'On'], [false, 'Off']] },
      { key: 'beep', label: 'Sound on the wall', hint: 'a noise up here when the camera reports',
        value: s.beep !== false, options: [[true, 'On'], [false, 'Off']] },
      { key: 'beep_sound', label: 'Which sound', value: s.beep_sound || 'chime',
        options: MOTION_SOUNDS.map((x) => [x.id, x.name]) },
      { key: 'beep_ms', label: 'How long it sounds',
        hint: 'until stopped keeps sounding and puts a Stop on the screen, wherever you are on it',
        // ?? and not ||: nought is a real answer here, and || would read it as
        // "nothing chosen" and light 0.6s instead.
        value: Number(s.beep_ms ?? 600),
        options: [[300, '0.3s'], [600, '0.6s'], [1200, '1.2s'], [2500, '2.5s'],
                  [0, 'until stopped']] },
      /* The lights are the beep for the rest of the house. Three rows and not
         one, because "on" is not something this house can act on by itself:
         which rooms and for how long are the two questions straight after it,
         and neither has an answer that could be chosen here for somebody. */
      { key: 'light_pulse', label: 'Flash the lights',
        hint: 'the rooms below go to full and come back to exactly how they were',
        value: s.light_pulse === true, options: [[true, 'On'], [false, 'Off']] },
      ...(rooms.length ? [{
        key: 'light_rooms', label: 'Which rooms',
        hint: 'as many as you like — a dark room goes dark again afterwards',
        multi: true, values: chosen,
        options: rooms.map((r) => [r.entity, r.label]),
      }] : []),
      { key: 'light_pulse_style', label: 'How they flash',
        hint: 'straight up is a light being switched on; dark to light rises out of nothing, which catches an eye that was not on the room',
        value: s.light_pulse_style || 'flash',
        options: [['flash', 'Straight up'], ['fade', 'Dark to light'],
                  ['blink', 'Blink'], ['breathe', 'Breathe']] },
      { key: 'light_pulse_times', label: 'How many times',
        hint: 'once is a signal; three is hard to miss from another room',
        value: Number(s.light_pulse_times) || 1,
        options: [[1, 'Once'], [2, 'Twice'], [3, '3 times'], [5, '5 times']] },
      { key: 'light_pulse_s', label: 'How long each flash lasts',
        hint: 'the rooms hold at full for this long before going back to how they were — blink and breathe move quicker than it',
        value: Number(s.light_pulse_s) || 4,
        options: [[2, '2s'], [4, '4s'], [8, '8s'], [15, '15s']] },
      { key: 'snapshot', label: 'Keep a still', hint: 'cut from the stream at the moment it reported',
        value: s.snapshot !== false, options: [[true, 'On'], [false, 'Off']] },
      { key: '_clip', label: 'Keep a clip', hint: 'recorded after it — longer clips are bigger files',
        value: clip, options: [[0, 'Off'], [5, '5s'], [8, '8s'], [15, '15s'], [30, '30s']] },
      { key: 'keep_days', label: 'Delete them after', hint: 'stills and clips both, swept every hour',
        value: Number(s.keep_days) || 3,
        options: [[1, '1 day'], [3, '3 days'], [7, 'a week'], [14, 'two weeks'], [30, 'a month']] },
      { key: 'cooldown_s', label: 'Quiet gap', hint: 'a nesting bird reports every few seconds; this is one entry per',
        value: Number(s.cooldown_s ?? 60),
        options: [[0, 'every one'], [30, '30s'], [60, '1 min'], [300, '5 min'], [900, '15 min']] },
    ];
  },

  renderSettings() {
    const rows = this.settingRows().map((r) => `
      <div class="m-opt">
        <span class="m-olabel">${esc(r.label)}
          ${r.hint ? `<span class="m-ohint">${esc(r.hint)}</span>` : ''}</span>
        <span class="m-oset">${r.options.map(([v, label]) => `
          <button class="m-oval${(r.multi ? r.values.includes(v) : v === r.value) ? ' on' : ''}"
                  data-k="${esc(r.key)}"${r.multi ? ' data-multi="1"' : ''}${r.cam ? ' data-cam="1"' : ''}
                  data-v="${esc(JSON.stringify(v))}">${esc(label)}</button>`).join('')}
        </span>
      </div>`).join('');
    this.elSettings.innerHTML = `
      <div class="m-bar">
        <button class="m-back">Bird box</button>
        <span class="m-title">When the camera sees something</span>
        <span class="spacer" style="flex:1"></span>
        <span class="cam-conn">${this.motion.connected
          ? 'subscribed to the camera' : esc(this.motion.error || 'not subscribed')}</span>
      </div>
      <div class="m-opts">${rows}</div>
      <div class="m-cache">
        <div class="m-opt">
          <span class="m-olabel">Try it
            <span class="m-ohint">records one event exactly as a real one, sound and still and all</span></span>
          <span class="m-oset">
            <button class="m-oval" data-a="test">Test motion</button>
            <button class="m-oval" data-a="clear">Clear the log</button>
          </span>
        </div>
      </div>`;
    this.elSettings.querySelector('.m-back').onclick = () => this.closeSheets();
    this.elSettings.querySelectorAll('.m-oval[data-k]').forEach((b) => {
      b.onclick = () => {
        const value = JSON.parse(b.dataset.v);
        // "Keep a clip" is two settings behind one row of buttons: whether to
        // record at all, and for how long. Off is the same answer to both.
        if (b.dataset.k === '_clip') return this.put({ clip: value > 0, clip_s: value || 8 });
        // Rooms are the one row where the buttons are not alternatives: each
        // is in or out, and the setting is the whole set. Read off the server's
        // last word rather than off the lit buttons, so two screens choosing
        // rooms at once cannot leave one of them writing a stale list back.
        if (b.dataset.multi) {
          const set = new Set(this.motion.settings?.[b.dataset.k] || []);
          if (set.has(value)) set.delete(value); else set.add(value);
          return this.put({ [b.dataset.k]: [...set] });
        }
        // The camera's own setting goes to the camera, not to motion.json.
        if (b.dataset.cam) return this.putCamera(value);
        this.put({ [b.dataset.k]: value });
      };
    });
    this.elSettings.querySelector('[data-a="test"]').onclick = async (e) => {
      e.target.disabled = true;
      try { await fetch('/api/motion/test', { method: 'POST' }); } catch { /* SSE says */ }
      e.target.disabled = false;
    };
    this.elSettings.querySelector('[data-a="clear"]').onclick = async () => {
      try { await fetch('/api/motion/events', { method: 'DELETE' }); } catch { /* SSE says */ }
    };
  },

  renderEvents() {
    this.oneId = this._oneDrawn = null;   // the grid is not one of them
    this.elEvents.classList.remove('cam-solo');
    const events = this.motion.events || [];
    const grid = !events.length
      ? `<div class="placeholder">Nothing reported in the last few days.<br>
         <span style="font-size:14px">The camera reports movement on its own; the wall keeps
         ${this.motion.settings?.keep_days || 3} days of it.</span></div>`
      : `<div class="m-grid thumbs">${events.map((e) => `
          <button class="m-thumb" data-id="${esc(e.id)}">
            ${e.snapshot_url
              ? `<img loading="lazy" src="${esc(e.snapshot_url)}" alt="">`
              : '<span class="cam-nostill">no still</span>'}
            <span class="cam-when">${hhmm(e.at)}${e.clip_url ? ' · clip' : ''}</span>
            <span class="m-unlike" data-a="drop" aria-label="delete this one">✕</span>
          </button>`).join('')}</div>`;
    this.elEvents.innerHTML = `
      <div class="m-bar">
        <button class="m-back">Bird box</button>
        <span class="m-title">${events.length} in the last
          ${this.motion.settings?.keep_days || 3} days · ${this.motion.count_today || 0} today</span>
        <span class="spacer" style="flex:1"></span>
        <button class="m-none" data-a="settings">Settings</button>
      </div>
      ${grid}`;
    this.elEvents.querySelector('.m-back').onclick = () => this.closeSheets();
    this.elEvents.querySelector('[data-a="settings"]').onclick = () => this.openSettings();
    this.elEvents.querySelectorAll('.m-thumb').forEach((b) => {
      const item = events.find((e) => e.id === b.dataset.id);
      b.onclick = async (e) => {
        if (e.target.closest('[data-a="drop"]')) {
          try {
            await fetch(`/api/motion/events/${encodeURIComponent(item.id)}`, { method: 'DELETE' });
          } catch { /* SSE says */ }
          return;
        }
        this.showOne(item.id);
      };
    });
  },

  /* One event, filling the sheet: the clip if there is one, the still
     otherwise. ‹ › step to the one before and the one after without going back
     out to the grid — a bird in the box reports every few seconds, so what
     somebody wants after looking at one still is nearly always the next still,
     and the round trip through the grid loses their place in it every time.

     The list is newest first, so › walks back through the day. The position is
     written out beside the time, because an arrow on its own does not say
     which way the day runs. */
  showOne(id) {
    const events = this.motion.events || [];
    const i = events.findIndex((e) => e.id === id);
    if (i < 0) return this.renderEvents();   // swept, or deleted, while open
    const item = events[i];
    this.oneId = id;

    // A new event arriving while this one is open comes back through here (see
    // onMotion): the position moves and the ends of the list move, the picture
    // does not. Rebuilding it would restart a clip somebody is halfway through.
    if (this._oneDrawn === id && this.elEvents.querySelector('.cam-one')) {
      return this.paintOne();
    }
    this._oneDrawn = id;
    this.elEvents.classList.add('cam-solo');   // this sheet does not scroll

    this.elEvents.innerHTML = `
      <div class="m-bar">
        <button class="m-back">Back</button>
        <span class="m-title">${hhmm(item.at)} · ${esc(item.event || 'motion')}</span>
        <span class="spacer" style="flex:1"></span>
        <span class="cam-pos"></span>
      </div>
      <div class="cam-one">
        <figure class="cam-frame${item.clip_url ? ' has-clip' : ''}">${item.clip_url
          ? `<video src="${esc(item.clip_url)}" controls autoplay muted playsinline></video>`
          : item.snapshot_url ? `<img src="${esc(item.snapshot_url)}" alt="">`
          : '<div class="placeholder">nothing was kept for this one</div>'}
          <div class="cam-nav">
            <button class="m-ctl cam-prev" aria-label="the one before this">‹</button>
            <button class="m-ctl cam-next" aria-label="the one after this">›</button>
          </div>
        </figure>
      </div>`;
    this.elEvents.querySelector('.m-back').onclick = () => this.renderEvents();
    this.elEvents.querySelector('.cam-prev').onclick = () => this.stepOne(-1);
    this.elEvents.querySelector('.cam-next').onclick = () => this.stepOne(1);
    this.paintOne();
  },

  /* Where this one stands in the list, read fresh each time rather than closed
     over: every new event pushes it one further from the top. */
  paintOne() {
    const events = this.motion.events || [];
    const i = events.findIndex((e) => e.id === this.oneId);
    const pos = this.elEvents.querySelector('.cam-pos');
    if (i < 0 || !pos) return;
    pos.textContent = `${i + 1} of ${events.length}`;
    this.elEvents.querySelector('.cam-prev').disabled = i <= 0;
    this.elEvents.querySelector('.cam-next').disabled = i >= events.length - 1;
  },

  stepOne(by) {
    const events = this.motion.events || [];
    const next = events[events.findIndex((e) => e.id === this.oneId) + by];
    if (next) this.showOne(next.id);
  },

  onExpand() {
    this.expanded = true;
    this.ctx.setMeta(this.id, 'demo clip · looping · full screen');
    this.create();
  },
  onCollapse() {
    this.expanded = false;
    this.ctx.setMeta(this.id, 'demo clip · looping');
    this.create();
  },
  onHide() { this.destroy(); },
  onShow() { this.create(); },
};
