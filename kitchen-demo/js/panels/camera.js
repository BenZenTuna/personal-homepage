// Bird-box camera on go2rtc's own player component (vendored).
// Rules that keep the cheap camera happy: exactly one stream element exists
// at a time; expand destroys the sub element and creates an HD one; hiding
// the panel destroys the element entirely (go2rtc then drops its RTSP
// consumer). Audio muted by default, big tap target to unmute.

// Stamped like the rest of the module graph — see the top of app.js.
const { VideoRTC } = await import(`../vendor/video-rtc.js${new URL(import.meta.url).search}`);

class KitchenStream extends VideoRTC {
  oninit() {
    super.oninit();
    this.video.controls = false;
    this.video.muted = this.startMuted !== false;
  }
}
customElements.define('kitchen-stream', KitchenStream);

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

/* The log reaches back `keep_days` now, not the last few hours, so "15:42" on
   its own could be any of three afternoons. Today keeps the bare time; any
   other day says which. */
const when = (ts) => {
  const d = new Date(ts * 1000);
  return d.toDateString() === new Date().toDateString()
    ? hhmm(ts)
    : `${d.toLocaleDateString('en-GB', { weekday: 'short' })} ${hhmm(ts)}`;
};

/* How many stills one "Show more" adds to the log. About nine rows of the grid
   at full screen: enough that nobody presses it every few seconds, few enough
   that a page of thumbnails is not a wait. */
const LOG_PAGE = 120;

/* ⏺ Record's − and +: whole minutes to 5, then fives, to half an hour. */
const RECORD_STEPS = [1, 2, 3, 4, 5, 10, 15, 20, 25, 30];

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
    // The settings' uploaded sounds and text (2026-10-18) redraw them as they change.
    const redraw = () => { if (this.elSettings && !this.elSettings.hidden) this.renderSettings(); };
    ctx.soundlib?.onChange(redraw);
    ctx.voice?.onChange(redraw);
    this.expanded = false;
    this.muted = ctx.uiState.cam_muted !== false;
    // A recorded clip's sound, apart from the live picture's: hearing what the
    // box sounded like a minute ago is not the same wish as listening to it now.
    this.clipSound = ctx.uiState.clip_sound === true;
    body.innerHTML = '<div class="cam-overlay">connecting to the camera…</div>'
      + '<div class="cam-live" hidden><i></i>Live</div>'
      + '<div class="cam-sheet cam-events" hidden></div>'
      + '<div class="cam-sheet cam-settings" hidden></div>';
    this.overlay = body.querySelector('.cam-overlay');
    this.liveBadge = body.querySelector('.cam-live');
    this.elEvents = body.querySelector('.cam-events');
    this.elSettings = body.querySelector('.cam-settings');
    this.recMin = 5;          // ⏺'s minutes, until changed in its sheet
    this.keptMode = false;    // the log showing only the 📌 kept ones

    /* What the camera has reported, and what the wall is to do about it. The
       detecting happens on the camera's own chip; this panel is the part that
       says so, keeps the count, and makes the noise. See backend/app/motion.py.

       The count is a button because the question after "three since midnight"
       is always "three of what", and the answer is the stills behind it. */
    this.motion = { settings: {}, count_today: 0, events: [], connected: false };
    // The log as this screen knows it, newest first: the forty the SSE key
    // carries, then whatever "Show more" has paged in beneath them.
    this.log = [];
    this.logDone = true;
    this.shown = LOG_PAGE;
    this._lastMotionAt = null;
    this.ringing = false;
    this.leftOut = null;      // the Left out screen, while it is the one showing
    this.buildAlertBar();

    /* The row reads left to right as what the box did, then the three things
       the wall does about it, then the settings behind all of them: the count,
       the lights, the alert sound, the camera's own sound, the gear. The two
       sounds are named for which sound they are — "Motion" and "Sound off"
       were a state of the log and a state of the stream wearing the same
       word, and the pair of them said neither. */
    this.countBtn = ctx.addHeaderButton(this.id, '—', () => this.openEvents());
    /* ⏺ Record (2026-10-18): first in the row, before the count — a clip of
       the box for as long as asked, up to half an hour (motion.py). Its
       choices open beside it in the same row, as the ✈ buttons do over a
       clip (Alex: "no need to open a new recording window"): − 5 min +,
       Start, ✕; while it records the button is the time left, in red, and
       its choice is Stop. */
    this.recBtn = ctx.addHeaderButton(this.id, '⏺ Record', () => this.openRecord());
    this.recBtn.classList.add('cam-rec');
    this.countBtn.before(this.recBtn);
    this.recBar = document.createElement('span');
    this.recBar.className = 'cam-recbar';
    this.recBar.hidden = true;
    this.recBtn.after(this.recBar);
    this.recOpen = false;
    setInterval(() => this.paintRecord(), 1000);
    this.countBtn.title = 'the stills and clips the camera has kept';
    this.lightBtn = ctx.addHeaderButton(this.id, '💡', () => this.toggleLights());
    this.beepBtn = ctx.addHeaderButton(this.id, 'Motion sound', () => this.toggleBeep());
    this.muteBtn = ctx.addHeaderButton(this.id, 'Camera sound', () => this.toggleMute());
    const gear = ctx.addHeaderButton(this.id, '⚙', () => this.openSettings());
    gear.className = 'gear';
    gear.title = 'what to do when the camera sees something';
    this.gearBtn = gear;
    ctx.setMeta(this.id, 'go2rtc · sub stream');
    ctx.bus.on('motion', (m) => this.onMotion(m));
    // Telegram (2026-10-12): the clip viewer's ✈ and the ⚙'s Link (telegram.py).
    this.tg = null;
    ctx.bus.on('telegram', (t) => this.onTelegram(t));
    fetch('/api/telegram', { cache: 'no-store' }).then((r) => (r.ok ? r.json() : null))
      .then((t) => { if (t) this.onTelegram(t); }).catch(() => {});
    this.paintMotion();

    this.el = null;
    this._stalls = 0;
    this._lastTime = -1;
    setInterval(() => this.watchdog(), STALL_CHECK_MS);
    // no create() here: onShow() from the layout engine owns element lifetime
  },

  wsUrl(src) {
    const cam = this.ctx.config.camera;
    const base = cam.camera_base;
    if (base) {
      if (base.startsWith('/')) {
        const scheme = location.protocol === 'https:' ? 'wss' : 'ws';
        return `${scheme}://${location.host}${base}/api/ws?src=${src}`;
      }
      return `${base}/api/ws?src=${src}`;
    }
    // A page opened over https — through the house's front door, as on
    // AI (2026-10-14: "connecting to the camera…" for ever) — may not open
    // a plain ws:// (the browser blocks it), and the front door's name has no
    // port 1984 anyway: it is the workstation, not the home server. go2rtc has its own secure
    // name there (settings.json camera.go2rtc_https). The wall keeps the plain
    // way, but not "the page's host, port 1984": since 2026-10-04 kitchen.home
    // is the workstation too, and the wall opened as http://kitchen.home sat on
    // "connecting to the camera…" dialling the workstation:1984 (2026-10-17). So a plain
    // page goes to go2rtc's own address (camera.go2rtc_http).
    if (location.protocol === 'https:' && cam.go2rtc_https) {
      return `${cam.go2rtc_https}/api/ws?src=${src}`;
    }
    if (cam.go2rtc_http) return `${cam.go2rtc_http}/api/ws?src=${src}`;
    return `ws://${location.hostname}:1984/api/ws?src=${src}`;
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
    const cam = this.ctx.config.camera;
    const src = this.expanded ? (cam.hd_src || 'birdbox_hd') : (cam.sub_src || 'birdbox');
    const el = document.createElement('kitchen-stream');
    el.mode = 'webrtc,mse';
    el.background = false;
    el.startMuted = this.muted;
    this.overlay.classList.remove('hidden');
    this.overlay.textContent = 'connecting to the camera…';
    if (this.liveBadge) this.liveBadge.hidden = true;
    this.body.appendChild(el);
    el.src = this.wsUrl(src);
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
    this.mergeLog();
    this.paintMotion();
    if (!this.elSettings.hidden) this.renderSettings();
    // Looking at one event is not the same screen as the log, and a bird that
    // reports while somebody is reading a still must not throw them back out
    // to the grid — which is what re-rendering the log under them did.
    if (!this.elEvents.hidden) {
      if (this.oneId) this.showOne(this.oneId);
      else if (!this.leftOut) this.renderEvents();
    }
    // Only for something that has just happened: a reconnect replays the
    // snapshot, and a wall that beeped at every reconnect would be a wall
    // nobody leaves switched on.
    if (fresh && this.motion.settings?.alerts) this.beep();
  },

  /* Fold a fresh snapshot into the log. Everything as new as the snapshot's
     oldest row comes from the snapshot, so a still deleted there is gone here
     too; below that, what was paged in stays — minus anything older than the
     log's own oldest row, which the sweep has taken off the disk. Rows that
     slide out of the newest forty are still in `this.log` from the snapshot
     before, so the join has no gap in it. */
  mergeLog() {
    if (this.keptMode) return;        // the kept list is its own fetch
    const top = this.motion.events || [];
    if (!top.length) {
      this.log = [];
      this.logDone = true;
      return;
    }
    const floor = top[top.length - 1].at;
    const oldest = this.motion.oldest_at || 0;
    const below = this.log.filter((e) => e.at < floor && e.at >= oldest);
    this.log = [...top, ...below];
    // A backend older than `total` has only the forty to give.
    this.logDone = this.motion.total == null || this.log.length >= this.motion.total;
  },

  /* The next page of the log, older than the last still on screen. A cursor
     and not an offset: the top of the log moves every few seconds. */
  async loadOlder() {
    if (this.logDone || this._loading || this.keptMode) return;
    const last = this.log[this.log.length - 1];
    if (!last) return;
    this._loading = true;
    try {
      const q = new URLSearchParams({ before: String(last.at), limit: String(LOG_PAGE) });
      const r = await fetch(`/api/motion/events?${q}`);
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const doc = await r.json();
      const have = new Set(this.log.map((e) => e.id));
      this.log.push(...(doc.events || []).filter((e) => !have.has(e.id)));
      this.logDone = !doc.more;
      this._loadError = '';
    } catch (e) {
      this._loadError = 'could not reach the server — try again';
    } finally {
      this._loading = false;
    }
  },

  async showMore() {
    this.shown += LOG_PAGE;
    if (this.log.length < this.shown && !this.logDone) {
      this.renderEvents();        // the button says it is loading
      await this.loadOlder();
    }
    if (!this.elEvents.hidden && !this.oneId) this.renderEvents();
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
    if (this.ctx.phone) return;   // the noise the wall makes, not a phone

    // 0 is "until stopped". Read with ?? rather than ||, or the one setting
    // whose value is nought would read as "unset" and come back as 0.6s.
    const raw = Number(cfg.beep_ms ?? 600);
    const forever = raw === 0;
    const ms = forever ? TONE_EVERY_MS : Math.max(100, Math.min(4000, raw || 600));
    const sound = this.motionSounds().find((s) => s.id === cfg.beep_sound) || MOTION_SOUNDS[0];
    if (forever) this.raiseAlert();
    // ...and then the bird box's text, read once (2026-10-18), when the sound
    // has its end: not for "until stopped", which only Stop ends.
    clearTimeout(this._voiceTimer);
    if (!forever && this.ctx.voice?.file('birds')) {
      this._voiceTimer = setTimeout(() => this.ctx.voice.play('birds'), ms + 150);
    }
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

  /* The three above, then the ones uploaded in the settings (2026-10-18). */
  motionSounds() {
    return [...MOTION_SOUNDS, ...(this.ctx.soundlib?.list('birds') || [])
      .map((x) => ({ id: x.id, name: x.label, file: x.file, uploaded: true }))];
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
    // ⚙ lit while its settings are up, as the photographs' and the
    // countdown's gears are: it is also the way out of them.
    this.gearBtn?.classList.toggle('on', which === 'settings');
  },

  /* Leaving the log forgets how far down it was paged, so the next visit
     starts at the newest again and a wall left alone does not go on holding
     three days of rows it is not showing. */
  closeSheets() {
    this.sheet(null);
    this.leftOut = null;
    this.keptMode = false;
    this.shown = LOG_PAGE;
    this.log = [...(this.motion.events || [])];
    this.logDone = this.motion.total == null || this.log.length >= this.motion.total;
  },

  openSettings() {
    if (!this.elSettings.hidden) return this.closeSheets();
    this.renderSettings();
    this.elSettings.scrollTop = 0;
    this.sheet('settings');
  },

  openEvents() {
    // Watching one recording, "N visits today" means "all of them again"
    // (Alex, 2026-10-13), not "close": back to the grid, as Back does.
    if (!this.elEvents.hidden && this.oneId) {
      const at = this.log.findIndex((e) => e.id === this.oneId);
      if (at >= this.shown) this.shown = Math.ceil((at + 1) / LOG_PAGE) * LOG_PAGE;
      return this.renderEvents();
    }
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
  onAsk(what) {
    if (what === 'events') this.showEvents();
    /* The Birds button (Alex, 2026-10-30: "clicking here should only open
       the live camera"): the live picture, whatever sheet was up, and no clip
       left playing behind it. */
    if (what === 'live') {
      this.elEvents.querySelectorAll('video').forEach((v) => { try { v.pause(); } catch { /* gone */ } });
      this.closeSheets();
    }
  },

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
      { key: 'level', label: 'How sensitive the camera is', cam: true, group: 'counts',
        hint: cam.level == null
          ? `the camera has not said yet${cam.error ? ` — ${cam.error}` : ''}`
          : 'the camera’s own scale, 1 to 6 — higher should mean it reports more often',
        value: cam.level ?? null,
        options: [[1, '1'], [2, '2'], [3, '3'], [4, '4'], [5, '5'], [6, '6']] },
      /* The camera calls the light changing motion, at every one of its six
         levels: the sun and the clouds outside the hole, and its own change
         between day and night (2026-10-14). The server looks at the picture
         before it believes it — backend/app/birdcheck.py. */
      { key: 'bird_check', label: 'Only a bird counts', group: 'counts', toggle: true,
        hint: s.bird_check === false
          ? 'off: everything the camera reports is a visit, the sun and the clouds included'
          : `the camera also reports the light changing in the box; this looks at the picture first and keeps a visit only with something in the hole or in the box, by day or in the night pictures${
            this.motion.ignored_today ? ` — ${this.motion.ignored_today} left out today` : ''}`,
        value: s.bird_check !== false, options: [[true, 'On'], [false, 'Off']] },
      // The master switch: the state sentence at the top carries it.
      { key: 'alerts', label: 'Motion alerts', hint: 'the whole of it: off means the camera is still watching, the wall is not',
        master: true, value: s.alerts !== false, options: [[true, 'On'], [false, 'Off']] },
      // Its card's own switch: the card's heading is its name (lead).
      { key: 'beep', label: 'Sound on the wall', hint: 'a noise up here when the camera reports',
        group: 'sound', toggle: true, lead: true,
        value: s.beep !== false, options: [[true, 'On'], [false, 'Off']] },
      { key: 'beep_sound', label: 'Which sound', value: s.beep_sound || 'chime', group: 'sound', off: s.beep === false,
        hint: '＋ Upload adds a sound file of your own; ✕ deletes one; 🗣 reads a text after it',
        options: this.motionSounds().map((x) => [x.id, x.name]),
        // ✕ right after the uploaded sound it deletes, in the bar; ＋ Upload
        // and 🗣 beside the bar, never in it.
        after: Object.fromEntries(this.motionSounds().filter((x) => x.uploaded).map((x) =>
          [x.id, this.ctx.soundlib.delBtn(x.id, { cls: 'ls-btn m-oval', label: x.name })])),
        acts: `${this.ctx.soundlib?.uploadBtn('birds', { cls: 'ls-btn m-oval' }) || ''}${
          this.ctx.voice?.chip('birds', { cls: 'ls-btn m-oval' }) || ''}`,
        below: this.ctx.voice?.editor('birds', { hint: 'read aloud after the sound, when it has an end — e.g. "a bird in the box"' }) || '' },
      { key: 'beep_ms', label: 'How long it sounds', group: 'sound', off: s.beep === false,
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
      { key: 'light_pulse', label: 'Flash the lights', group: 'lights', toggle: true, lead: true,
        hint: 'the rooms below go to full and come back to exactly how they were',
        value: s.light_pulse === true, options: [[true, 'On'], [false, 'Off']] },
      ...(rooms.length ? [{
        key: 'light_rooms', label: 'Which rooms', group: 'lights', off: s.light_pulse !== true,
        hint: 'as many as you like — a dark room goes dark again afterwards',
        multi: true, values: chosen,
        options: rooms.map((r) => [r.entity, r.label]),
      }] : []),
      { key: 'light_pulse_style', label: 'How they flash', group: 'lights', off: s.light_pulse !== true,
        hint: 'straight up is a light being switched on; dark to light rises out of nothing, which catches an eye that was not on the room',
        value: s.light_pulse_style || 'flash',
        options: [['flash', 'Straight up'], ['fade', 'Dark to light'],
                  ['blink', 'Blink'], ['breathe', 'Breathe']] },
      { key: 'light_pulse_times', label: 'How many times', group: 'lights', off: s.light_pulse !== true,
        hint: 'once is a signal; three is hard to miss from another room',
        value: Number(s.light_pulse_times) || 1,
        options: [[1, 'Once'], [2, 'Twice'], [3, '3 times'], [5, '5 times']] },
      { key: 'light_pulse_s', label: 'How long each flash lasts', group: 'lights', off: s.light_pulse !== true,
        hint: 'the rooms hold at full for this long before going back to how they were — blink and breathe move quicker than it',
        value: Number(s.light_pulse_s) || 4,
        options: [[2, '2s'], [4, '4s'], [8, '8s'], [15, '15s']] },
      { key: 'snapshot', label: 'Keep a still', hint: 'cut from the stream at the moment it reported',
        group: 'kept', toggle: true,
        value: s.snapshot !== false, options: [[true, 'On'], [false, 'Off']] },
      { key: '_clip', label: 'Keep a clip', group: 'kept', none: 0,
        hint: 'recorded after it, with its sound, one at a time (a visit while one records is in it) — about 7 MB a minute',
        value: clip, options: [[0, 'Off'], [5, '5s'], [8, '8s'], [15, '15s'], [30, '30s'],
          [45, '45s'], [60, '1 min'], [90, '1:30'], [120, '2 min']] },
      { key: 'keep_days', label: 'Delete them after', hint: 'stills and clips both, swept every hour', group: 'kept',
        value: Number(s.keep_days) || 3,
        options: [[1, '1 day'], [3, '3 days'], [7, 'a week'], [14, 'two weeks'], [30, 'a month']] },
      { key: 'cooldown_s', label: 'Quiet gap', hint: 'a nesting bird reports every few seconds; this is one entry per', group: 'counts',
        value: Number(s.cooldown_s ?? 60),
        options: [[0, 'every one'], [30, '30s'], [60, '1 min'], [300, '5 min'], [900, '15 min']] },
    ];
  },

  /* The settings on the settings window kit (2026-10-22; app.css, "the
     in-panel settings on the kit"): still inside the panel, with a header
     line in the kit's style, the state sentence with Motion alerts — the
     whole of it — beside it, then a card for each question: what counts as a
     visit, the sound, the lights, what is kept, and trying it. Each card says
     what it is set to beside its heading. */
  settingNotes(s, lab, names) {
    const cam = this.motion.camera || {};
    // While Motion alerts is off, a card that does something says what it
    // would do when it is on.
    const whenOn = s.alerts === false ? 'when on: ' : '';
    const n = this.motion.ignored_today || 0;
    const still = s.snapshot !== false;
    return {
      counts: [cam.level == null ? 'level not known' : `level ${cam.level}`,
        s.bird_check === false ? 'every report' : 'only a bird',
        Number(s.cooldown_s ?? 60) ? `${lab('cooldown_s')} apart` : 'every one'].join(' · '),
      sound: s.beep === false ? 'off' : `${whenOn}${lab('beep_sound')} · ${lab('beep_ms')}`,
      lights: s.light_pulse !== true ? 'off' : names.length
        ? `${whenOn}${names.length} ${names.length === 1 ? 'room' : 'rooms'} · ${
          lab('light_pulse_style').toLowerCase()} · ${lab('light_pulse_times').toLowerCase()}`
        : 'no room chosen',
      kept: still || s.clip
        ? `${whenOn}${[still && 'still', s.clip && `${lab('_clip')} clip`].filter(Boolean).join(' and ')} · ${lab('keep_days')}`
        : 'nothing kept',
      check: n ? `${n} left out today` : '',
    };
  },

  /* What is true now and what comes next, with the master switch beside it. */
  settingSum(s, lab, names) {
    const kit = this.ctx.sheetkit;
    const on = s.alerts !== false;
    const ctl = kit.toggle(on, `data-k="alerts" data-v="${esc(JSON.stringify(!on))}"`, { cls: 'm-oval' });
    if (!on) {
      return kit.sum('Off — the camera is still watching, the wall is not.', {
        next: 'Nothing is counted, sounded or kept until it is on.', ctl, cap: 'Motion alerts', off: true,
      });
    }
    const what = s.bird_check === false ? 'the camera reports <b>anything</b>' : '<b>a bird</b> is seen in the box';
    const sound = s.beep === false ? 'the wall stays quiet'
      : `the wall plays <b>${esc(lab('beep_sound'))}</b> ${Number(s.beep_ms ?? 600) === 0
        ? '<b>until stopped</b>' : `for <b>${esc(lab('beep_ms'))}</b>`}`;
    const flash = s.light_pulse === true && names.length
      ? ` and <b>${esc(names.length > 3 ? `${names.length} rooms` : kit.and(names))}</b> ${
        names.length === 1 ? 'flashes' : 'flash'} <b>${esc(lab('light_pulse_times').toLowerCase())}</b>` : '';
    const still = s.snapshot !== false;
    const clip = s.clip ? `${/^8/.test(lab('_clip')) ? 'an' : 'a'} <b>${esc(lab('_clip'))}</b> clip` : '';
    const days = `<b>${esc(lab('keep_days'))}</b>`;
    const kept = still && clip ? `a still and ${clip} are kept for ${days}`
      : still ? `a still is kept for ${days}` : clip ? `${clip} is kept for ${days}` : 'nothing is kept';
    const n = this.motion.count_today || 0;
    const left = this.motion.ignored_today || 0;
    const today = `Today: <b>${n ? `${n} visit${n === 1 ? '' : 's'}` : 'nothing'}</b>${n ? '' : ' yet'}${
      left ? `, ${left} left out` : ''}.`;
    const dark = s.light_pulse === true && !names.length ? ' Flash the lights is on, but no room is chosen yet.' : '';
    return kit.sum(`When ${what}, ${sound}${flash}; ${kept}.`, {
      next: `${today}${dark}`, ctl, cap: 'Motion alerts',
    });
  },

  // Clear the log's first tap asks, for 4 s (renderSettings draws it so).
  _clearSureNow() { return !!this._clearSure && Date.now() - this._clearSure < 4000; },

  renderSettings() {
    const kit = this.ctx.sheetkit;
    const s = this.motion.settings || {};
    const sure = this._clearSureNow();
    const all = this.settingRows();
    const byKey = Object.fromEntries(all.map((r) => [r.key, r]));
    // The label the value has among its options ("0.6s", "Chime").
    const lab = (k) => {
      const r = byKey[k];
      const o = r?.options.find(([v]) => v === r.value);
      return o ? o[1] : '';
    };
    const chosen = new Set(byKey.light_rooms?.values || []);
    const names = (byKey.light_rooms?.options || []).filter(([v]) => chosen.has(v)).map(([, l]) => l);
    const row = (r) => {
      const label = r.lead
        // The card's own switch: its heading is the name, this its hint.
        ? `<span class="ls-label m-olabel"><span class="db-hint sheet-lead m-ohint">${esc(r.hint)}</span></span>`
        : `<span class="ls-label m-olabel">${esc(r.label)}${
          r.hint ? `<span class="db-hint m-ohint">${esc(r.hint)}</span>` : ''}</span>`;
      const attrs = (v) => `data-k="${esc(r.key)}"${r.multi ? ' data-multi="1"' : ''}${
        r.cam ? ' data-cam="1"' : ''} data-v="${esc(JSON.stringify(v))}"`;
      let set;
      if (r.toggle) {
        // On or off: one switch saying its state; a tap makes it the other.
        set = `<span class="ls-set m-oset">${kit.toggle(r.value, attrs(!r.value), { cls: 'm-oval' })}</span>`;
      } else if (r.multi) {
        // Several of them: a chip each, in or out.
        set = `<span class="ls-set sheet-chips m-oset">${r.options.map(([v, l]) => {
          const on = r.values.includes(v);
          return `<button class="ls-btn m-oval${on ? ' on' : ''}" ${attrs(v)} aria-pressed="${on}">${esc(l)}</button>`;
        }).join('')}</span>`;
      } else {
        set = `<span class="ls-set sheet-seg m-oset">${r.options.map(([v, l]) => {
          const on = v === r.value;
          return `<button class="ls-btn m-oval${on ? ' on' : ''}${'none' in r && v === r.none ? ' sheet-none' : ''}"
            ${attrs(v)} aria-pressed="${on}">${esc(l)}</button>${r.after?.[v] || ''}`;
        }).join('')}</span>`;
      }
      if (r.acts) set = `<div class="sheet-ctl">${set}<span class="sheet-acts">${r.acts}</span></div>`;
      return `<div class="ls-row m-opt${r.off ? ' nt-off' : ''}">${label}${set}${r.below || ''}</div>`;
    };
    const group = (g) => all.filter((r) => r.group === g).map(row).join('');
    const n = this.settingNotes(s, lab, names);
    const on = s.alerts !== false;
    const today = this.motion.count_today || 0;
    this.elSettings.innerHTML = `
      <div class="m-bar pset-head">
        <span class="sheet-icon" aria-hidden="true">🐦</span>
        <div class="sheet-title">
          <h2 class="m-title">When the camera sees something</h2>
          <span class="sheet-status cam-conn"></span>
        </div>
        <span class="spacer"></span>
        <button class="m-back">Bird box</button>
      </div>
      <div class="pset cam-setw">
        ${this.settingSum(s, lab, names)}
        <div class="m-opts">
          ${kit.sec('What counts', `${on ? `
            <p class="sheet-note"><b>Motion alerts</b>, at the top, is the whole of it: off means the
              camera is still watching, the wall is not.</p>` : ''}${group('counts')}`, { note: n.counts })}
          ${kit.sec('Sound on the wall', group('sound'), { note: n.sound })}
          ${kit.sec('Flash the lights', group('lights'), { note: n.lights })}
          ${kit.sec('What is kept', group('kept'), { note: n.kept })}
        </div>
        ${kit.sec('Check it', `
          <div class="ls-row m-opt">
            <span class="ls-label m-olabel">Try it
              <span class="db-hint m-ohint">records one event exactly as a real one, sound and still and all</span></span>
            <span class="ls-set m-oset">
              <button class="ls-btn sheet-primary m-oval" data-a="test">Test motion</button>
              <button class="ls-btn sheet-danger m-oval" data-a="clear"${sure ? ' data-sure="1"' : ''}>${
                sure ? 'Sure? Tap again' : 'Clear the log'}</button>
            </span>
          </div>
          <div class="ls-row m-opt">
            <span class="ls-label m-olabel">Left out
              <span class="db-hint m-ohint">what the camera reported that was only the light, or could not be judged — to check no bird went with it</span></span>
            <span class="ls-set m-oset">
              <button class="ls-btn m-oval" data-a="leftout">See them</button>
            </span>
          </div>`, { note: n.check, cls: 'm-cache' })}
      </div>`;
    // The line under the title: on or off, and the camera's own link — warn
    // while the wall is not subscribed to it (it is unplugged half the year).
    kit.status(this.elSettings.querySelector('.cam-conn'), `<b>${on ? 'On' : 'Off'}</b> · ${this.motion.connected
      ? 'subscribed to the camera' : esc(this.motion.error || 'not subscribed')}${
      on ? ` · ${today ? `${today} visit${today === 1 ? '' : 's'} today` : 'nothing today'}` : ''}`,
    !this.motion.connected ? 'warn' : on ? 'ok' : 'off');
    this.elSettings.querySelector('.m-back').onclick = () => this.closeSheets();
    // An upload is the sound at once (2026-10-18).
    this.ctx.soundlib?.wire(this.elSettings, { onUploaded: (r) => this.put({ beep_sound: r.id }) });
    this.ctx.voice?.wire(this.elSettings, () => this.renderSettings());
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
    // The whole log, stills and clips, at one tap: so the first tap asks.
    // The pending ask is the panel's, not the button's: a redraw in between
    // (motion's SSE, the camera's link, a sound) draws it still asking.
    this.elSettings.querySelector('[data-a="clear"]').onclick = async () => {
      if (!this._clearSureNow()) {
        this._clearSure = Date.now();
        clearTimeout(this._clearSureTimer);
        this._clearSureTimer = setTimeout(() => {
          this._clearSure = 0;
          const b = this.elSettings?.querySelector('[data-a="clear"]');
          if (b) { delete b.dataset.sure; b.textContent = 'Clear the log'; }
        }, 4000);
        const b = this.elSettings.querySelector('[data-a="clear"]');
        b.dataset.sure = '1';
        b.textContent = 'Sure? Tap again';
        return;
      }
      this._clearSure = 0;
      clearTimeout(this._clearSureTimer);
      const b = this.elSettings.querySelector('[data-a="clear"]');
      delete b.dataset.sure;
      b.textContent = 'Clear the log';
      try { await fetch('/api/motion/events', { method: 'DELETE' }); } catch { /* SSE says */ }
    };
    this.elSettings.querySelector('[data-a="leftout"]').onclick = () => this.showLeftOut();
  },

  renderEvents() {
    this.oneId = this._oneDrawn = null;   // the grid is not one of them
    this.leftOut = null;
    this.elEvents.classList.remove('cam-solo');
    const events = this.log.slice(0, this.shown);
    const total = this.keptMode ? this.log.length : Math.max(this.motion.total ?? 0, this.log.length);
    // What is left below the grid: the rest of the rows already here, then
    // whatever the server still has that has not been paged in.
    const left = Math.max(0, total - events.length);
    const more = left > 0 && (events.length < this.log.length || !this.logDone);
    const grid = !events.length && this.keptMode
      ? `<div class="placeholder">Nothing kept yet.<br>
         <span style="font-size:14px">Open a visit and tap 📌 Keep: it stays after the
         ${this.motion.settings?.keep_days || 3} days the others are kept.</span></div>`
      : !events.length
      ? `<div class="placeholder">Nothing reported in the last few days.<br>
         <span style="font-size:14px">The camera reports movement on its own; the wall keeps
         ${this.motion.settings?.keep_days || 3} days of it.</span></div>`
      : `<div class="m-grid thumbs">${events.map((e) => `
          <button class="m-thumb${e.kept ? ' cam-kept' : ''}" data-id="${esc(e.id)}">
            ${e.snapshot_url
              ? `<img loading="lazy" src="${esc(e.snapshot_url)}" alt="">`
              : '<span class="cam-nostill">no still</span>'}
            <span class="cam-when">${when(e.at)}${e.event === 'Recorded' ? ' · ⏺' : ''}${e.clip_url ? ' · clip' : ''}</span>
            ${e.kept ? '<span class="cam-pin" aria-label="kept">📌</span>'
              : '<span class="m-unlike" data-a="drop" aria-label="delete this one">✕</span>'}
          </button>`).join('')}</div>
        ${more ? `<div class="cam-more">
          <button class="m-oval" data-a="more"${this._loading ? ' disabled' : ''}>${this._loading
            ? 'Loading…'
            : `Show ${Math.min(LOG_PAGE, left)} more`}</button>
          <span class="cam-more-note">${this._loadError
            ? esc(this._loadError)
            : `showing ${events.length} of ${total}`}</span>
        </div>` : ''}`;
    this.elEvents.innerHTML = `
      <div class="m-bar">
        <button class="m-back">${this.keptMode ? 'Visits' : 'Bird box'}</button>
        <span class="m-title">${this.keptMode ? `📌 Kept · ${total}, never deleted by themselves`
          : `${total} in the last ${this.motion.settings?.keep_days || 3} days · ${this.motion.count_today || 0} today`}</span>
        <span class="spacer" style="flex:1"></span>
        ${this.keptMode ? '' : `<button class="m-none" data-a="kept">📌 Kept · ${this.motion.kept || 0}</button>`}
        ${this.motion.settings?.bird_check !== false
          ? `<button class="m-none" data-a="leftout">Left out · ${this.motion.ignored_today || 0} today</button>`
          : ''}
        <button class="m-none" data-a="settings">Settings</button>
      </div>
      ${grid}`;
    this.elEvents.querySelector('.m-back').onclick = () => {
      if (!this.keptMode) return this.closeSheets();
      this.closeSheets();               // back to the visits, from the newest
      this.renderEvents();
      this.sheet('events');
    };
    this.elEvents.querySelector('[data-a="settings"]').onclick = () => this.openSettings();
    const keptBtn = this.elEvents.querySelector('[data-a="kept"]');
    if (keptBtn) keptBtn.onclick = () => this.showKept();
    const leftBtn = this.elEvents.querySelector('[data-a="leftout"]');
    if (leftBtn) leftBtn.onclick = () => this.showLeftOut();
    const moreBtn = this.elEvents.querySelector('[data-a="more"]');
    if (moreBtn) moreBtn.onclick = () => this.showMore();
    this.elEvents.querySelectorAll('.m-thumb').forEach((b) => {
      const item = events.find((e) => e.id === b.dataset.id);
      b.onclick = async (e) => {
        if (e.target.closest('[data-a="drop"]')) {
          try {
            const r = await fetch(`/api/motion/events/${encodeURIComponent(item.id)}`,
                                  { method: 'DELETE' });
            // The SSE key only carries the newest forty, so a still paged in
            // from further down has to leave this list by hand.
            if (r.ok) {
              this.log = this.log.filter((x) => x.id !== item.id);
              if (!this.elEvents.hidden && !this.oneId) this.renderEvents();
            }
          } catch { /* SSE says */ }
          return;
        }
        this.showOne(item.id);
      };
    });
  },

  /* What the camera reported and the server left out as only the light
     (backend/app/birdcheck.py): the place to look if a bird ever seems to be
     missing from the log. Its own little screen in the log's sheet — not rows
     in the log, which is visits and nothing else. A new report does not
     redraw it (onMotion), so a still somebody has opened stays open. */
  async showLeftOut() {
    this.oneId = this._oneDrawn = null;
    this.leftOut = { rows: null, total: 0, error: '' };
    this.renderLeftOut();
    this.sheet('events');
    let next;
    try {
      const r = await fetch('/api/motion/ignored?limit=120', { cache: 'no-store' });
      if (!r.ok) throw new Error(`the server answered ${r.status}`);
      const doc = await r.json();
      next = { rows: doc.ignored || [], total: doc.total || 0, error: '' };
    } catch (e) {
      next = { rows: [], total: 0, error: String(e.message || e) };
    }
    if (!this.leftOut || this.elEvents.hidden) return;   // left while it loaded
    this.leftOut = next;
    this.renderLeftOut();
  },

  renderLeftOut() {
    const lo = this.leftOut;
    this.elEvents.classList.remove('cam-solo');
    const rows = lo.rows || [];
    const keep = this.motion.settings?.keep_days || 3;
    const body = lo.rows === null ? '<div class="placeholder">Loading…</div>'
      : lo.error ? `<div class="placeholder">${esc(lo.error)}</div>`
      : !rows.length ? `<div class="placeholder">Nothing left out.<br>
          <span style="font-size:14px">Everything the camera reported in the last ${keep} days
          had something in the hole or in the box.</span></div>`
      : `<div class="m-grid thumbs cam-left">${rows.map((r) => `
          <button class="m-thumb" title="${esc(r.why || '')}">
            ${r.snapshot_url
              ? `<img loading="lazy" src="${esc(r.snapshot_url)}" alt="">`
              : '<span class="cam-nostill">no still</span>'}
            <span class="cam-when">${when(r.at)} · ${r.verdict === 'unsure' ? 'not sure'
              : /day and night/.test(r.why || '') ? 'day ↔ night'
              : /night picture/.test(r.why || '') ? 'night' : 'light'}</span>
          </button>`).join('')}</div>`;
    this.elEvents.innerHTML = `
      <div class="m-bar">
        <button class="m-back">Visits</button>
        <span class="m-title">Left out · ${this.motion.ignored_today || 0} today${
          lo.total ? ` · ${lo.total} in ${keep} days` : ''}</span>
        <span class="spacer" style="flex:1"></span>
        <button class="m-none" data-a="settings">Settings</button>
      </div>
      <p class="m-hint">What the camera reported with nothing in the hole or in the box: the
        sun and the clouds changing the light, or the camera changing between day and night —
        and what could not be judged ("not sure"). Not counted, no sound, no clip. Tap one to
        see it bigger.</p>
      ${body}`;
    this.elEvents.querySelector('.m-back').onclick = () => this.renderEvents();
    this.elEvents.querySelector('[data-a="settings"]').onclick = () => {
      this.leftOut = null;
      this.openSettings();
    };
    this.elEvents.querySelectorAll('.cam-left .m-thumb').forEach((b) => {
      b.onclick = () => b.classList.toggle('cam-big');
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
    const events = this.log;
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

    // Why it counted, where the server said (motion.py `why`, since
    // 2026-10-21: "something in the hole (55 px)") — the camera's own name for
    // the event, "VideoMotion", says nothing to anybody.
    this.elEvents.innerHTML = `
      <div class="m-bar">
        <button class="m-back">Back</button>
        <span class="m-title">${when(item.at)} · ${esc(item.why || item.event || 'motion')}</span>
        <span class="spacer" style="flex:1"></span>
        ${item.clip_url ? '<button class="m-none cam-snd"></button>' : ''}
        <button class="m-none cam-keep"></button>
        <span class="cam-tgnote"></span>
        <span class="cam-tgs"></span>
        <span class="cam-pos"></span>
      </div>
      <div class="cam-one">
        <figure class="cam-frame${item.clip_url ? ' has-clip' : ''}">${item.clip_url
          ? `<video src="${esc(item.clip_url)}" controls autoplay${this.clipSound ? '' : ' muted'} playsinline></video>`
          : item.snapshot_url ? `<img src="${esc(item.snapshot_url)}" alt="">`
          : '<div class="placeholder">nothing was kept for this one</div>'}
          <div class="cam-nav">
            <button class="m-ctl cam-prev" aria-label="the one before this">‹</button>
            <button class="m-ctl cam-next" aria-label="the one after this">›</button>
          </div>
        </figure>
      </div>`;
    // Back to the grid with the one just looked at still in it: stepping ›
    // walks past the end of the drawn page, so the page grows to meet it.
    this.elEvents.querySelector('.m-back').onclick = () => {
      const at = this.log.findIndex((e) => e.id === this.oneId);
      if (at >= this.shown) this.shown = Math.ceil((at + 1) / LOG_PAGE) * LOG_PAGE;
      this.renderEvents();
    };
    this.elEvents.querySelector('.cam-prev').onclick = () => this.stepOne(-1);
    this.elEvents.querySelector('.cam-next').onclick = () => this.stepOne(1);
    this.elEvents.querySelector('.cam-tgs').onclick = (e) => {
      const b = e.target.closest('button[data-to]');
      if (b) this.sendTelegram(b.dataset.to);
    };
    this.tgSent = null;
    this.elEvents.querySelector('.cam-keep').onclick = () => this.toggleKeep();
    this.wireClipSound();
    this.paintOne();
    this.paintTelegram();
  },

  /* Sound on a recorded clip (2026-10-14: clips carry the camera's sound
     since then; older ones have none). One button in the clip's bar, kept in
     ui-state like the live picture's, so the next clip opens the same way. A
     browser that will not start a clip with sound starts it silent instead,
     and the button says what is really playing. */
  wireClipSound() {
    const v = this.elEvents.querySelector('.cam-one video');
    const b = this.elEvents.querySelector('.cam-snd');
    if (!v || !b) return;
    v.muted = !this.clipSound;
    v.onvolumechange = () => this.paintClipSound();
    b.onclick = () => {
      this.clipSound = v.muted;              // silent now, so the wish is sound
      v.muted = !this.clipSound;
      if (this.clipSound && v.volume === 0) v.volume = 1;
      this.ctx.saveUiState({ clip_sound: this.clipSound });
      this.paintClipSound();
    };
    if (this.clipSound) {
      v.play?.()?.catch?.(() => { v.muted = true; v.play().catch(() => {}); });
    }
    this.paintClipSound();
  },

  paintClipSound() {
    const v = this.elEvents?.querySelector('.cam-one video');
    const b = this.elEvents?.querySelector('.cam-snd');
    if (!v || !b) return;
    const on = !v.muted && v.volume > 0;
    b.textContent = on ? '🔊 Sound on' : '🔇 Sound off';
    b.classList.toggle('on', on);
    b.title = on ? 'watch the clips without sound'
      : 'hear the clips — a clip recorded before 14 October 2026 has no sound';
  },

  /* ------------------------------------------------------- Telegram --
     The one on screen to one person's Telegram (telegram.py): a ✈ button per
     linked person — "✈ Alex", "✈ Sam" — the clip when there is one, the
     still otherwise. Shown once the kitchen has a bot; with nobody linked yet
     one ✈ Telegram opens House → Automation's Telegram sheet, where Link is
     (moved there from this panel's ⚙ on 2026-10-13). */
  onTelegram(t) {
    if (!t || typeof t !== 'object') return;
    this.tg = t;
    this.paintTelegram();
  },

  paintTelegram() {
    const box = this.elEvents?.querySelector('.cam-tgs');
    const note = this.elEvents?.querySelector('.cam-tgnote');
    if (!box) return;
    const item = this.log.find((e) => e.id === this.oneId);
    const s = this.tgSent && this.tgSent.id === this.oneId ? this.tgSent : null;
    const chats = this.tg?.chats || [];
    if (!this.tg?.configured || !item || !(item.clip || item.snapshot)) box.innerHTML = '';
    else if (!chats.length) box.innerHTML = '<button class="m-none cam-tg" data-to="">✈ Telegram</button>';
    else {
      box.innerHTML = chats.map((c) => `<button class="m-none cam-tg" data-to="${esc(c.key)}"${s?.busy ? ' disabled' : ''}
        title="send this to ${esc(c.name)}'s Telegram">${s?.busy && s.to === c.key ? 'Sending…' : `✈ ${esc(c.name)}`}</button>`).join('');
    }
    if (note) {
      note.textContent = s?.text || '';
      note.classList.toggle('bad', !!s?.bad);
    }
  },

  async sendTelegram(to) {
    const item = this.log.find((e) => e.id === this.oneId);
    if (!item) return;
    if (!to || !(this.tg?.chats || []).length) { this.ctx.goAutomation?.('telegram'); return; }
    const file = item.clip || item.snapshot;
    this.tgSent = { id: item.id, busy: true, to };
    this.paintTelegram();
    let ans = null;
    let ok = false;
    try {
      const r = await fetch('/api/telegram/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ file, to }),
      });
      ok = r.ok;
      ans = await r.json().catch(() => null);
    } catch { /* said below */ }
    const sent = ans?.sent || [];
    const failed = (ans?.failed || []).map((f) => f.name);
    this.tgSent = {
      id: item.id,
      bad: !ok,
      text: ok ? `Sent to ${sent.join(', ')} ✓${failed.length ? ` · not to ${failed.join(', ')}` : ''}`
        : (ans?.error || (ans?.failed?.[0]?.why) || 'Telegram could not be reached'),
    };
    this.paintTelegram();
  },

  /* Where this one stands in the list, read fresh each time rather than closed
     over: every new event pushes it one further from the top. */
  paintOne() {
    const events = this.log;
    const i = events.findIndex((e) => e.id === this.oneId);
    const pos = this.elEvents.querySelector('.cam-pos');
    if (i < 0 || !pos) return;
    const keep = this.elEvents.querySelector('.cam-keep');
    if (keep) {
      const k = !!events[i].kept;
      keep.textContent = k ? '📌 Kept' : '📌 Keep';
      keep.classList.toggle('on', k);
      keep.title = k ? 'kept until you tap again — then it goes with the others'
        : `keep this one: never deleted after the ${this.motion.settings?.keep_days || 3} days`;
    }
    const total = this.keptMode ? events.length : Math.max(this.motion.total ?? 0, events.length);
    pos.textContent = `${i + 1} of ${total}${this.keptMode ? ' kept' : ''}`;
    this.elEvents.querySelector('.cam-prev').disabled = i <= 0;
    // The last one loaded is not the last one kept: › pages in the next lot.
    this.elEvents.querySelector('.cam-next').disabled = i >= events.length - 1 && this.logDone;
  },

  async stepOne(by) {
    let i = this.log.findIndex((e) => e.id === this.oneId);
    if (i + by >= this.log.length && !this.logDone) {
      const id = this.oneId;
      await this.loadOlder();
      if (this.oneId !== id) return;      // they moved on while it loaded
      i = this.log.findIndex((e) => e.id === id);
    }
    const next = this.log[i + by];
    if (i >= 0 && next) this.showOne(next.id);
    else this.paintOne();
  },

  /* ------------------------------------------------------- 📌 Keep --
     A visit kept past the sweep (motion.py `kept`): its tile wears 📌 instead
     of ✕, and Clear leaves it. Unkeep in the viewer gives it back to the
     sweep and its ✕. */
  async toggleKeep() {
    const item = this.log.find((e) => e.id === this.oneId);
    if (!item) return;
    const keep = !item.kept;
    try {
      const r = await fetch(`/api/motion/events/${encodeURIComponent(item.id)}/keep`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ keep }),
      });
      if (!r.ok) return;
    } catch { return; }
    if (keep) item.kept = Date.now() / 1000; else delete item.kept;
    this.paintOne();
  },

  async showKept() {
    this.keptMode = true;
    this.oneId = this._oneDrawn = null;
    this.log = [];
    this.logDone = true;
    this.shown = 500;
    this.renderEvents();
    try {
      const r = await fetch('/api/motion/events?kept=true&limit=500', { cache: 'no-store' });
      if (r.ok) this.log = (await r.json()).events || [];
    } catch { /* the empty list says so */ }
    if (this.keptMode && !this.elEvents.hidden && !this.oneId) this.renderEvents();
  },

  /* ------------------------------------------------------- ⏺ Record --
     How long, then Start, in the header row beside ⏺; while it records,
     Stop. The server records (POST /api/motion/record), so a recording
     carries on whatever the wall does meanwhile, and a phone sees the same
     one. The live picture stays on screen the whole time. */
  openRecord() {
    this.recOpen = !this.recOpen;
    this.recErr = '';
    this.renderRecord();
  },

  renderRecord() {
    const rec = this.motion.recording;
    this.recBar.hidden = !this.recOpen;
    this._recShown = !!rec;
    if (!this.recOpen) { this.recBar.innerHTML = ''; return; }
    const at = RECORD_STEPS.indexOf(this.recMin);
    this.recBar.innerHTML = rec
      ? `<button data-a="stop" class="cam-rec-stop">■ Stop</button>
         <button data-a="close" aria-label="close">✕</button>`
      : `<button data-a="minus" aria-label="shorter"${at <= 0 ? ' disabled' : ''}>−</button>
         <span class="cam-rec-min">${this.recMin} min</span>
         <button data-a="plus" aria-label="longer"${at >= RECORD_STEPS.length - 1 ? ' disabled' : ''}>+</button>
         <button data-a="start" class="cam-rec-go">⏺ Start</button>
         <button data-a="close" aria-label="close">✕</button>
         ${this.recErr ? `<span class="cam-rec-err">${esc(this.recErr)}</span>` : ''}`;
    const on = (a, fn) => {
      const b = this.recBar.querySelector(`[data-a="${a}"]`);
      if (b) b.onclick = (e) => { e.stopPropagation(); fn(e); };
    };
    const step = (by) => {
      const k = RECORD_STEPS.indexOf(this.recMin);
      this.recMin = RECORD_STEPS[Math.max(0, Math.min(RECORD_STEPS.length - 1, k + by))];
      this.renderRecord();
    };
    on('close', () => { this.recOpen = false; this.renderRecord(); });
    on('minus', () => step(-1));
    on('plus', () => step(1));
    on('start', async (e) => {
      e.target.disabled = true;
      let err = '';
      try {
        const r = await fetch('/api/motion/record', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ minutes: this.recMin }),
        });
        const doc = await r.json().catch(() => ({}));
        if (!r.ok) err = doc.error || `the server answered ${r.status}`;
        else this.motion = { ...this.motion, ...doc };
      } catch { err = 'could not reach the kitchen server'; }
      this.recErr = err;
      // Started: the row folds away and ⏺ counts down; a tap brings Stop.
      if (!err) this.recOpen = false;
      this.renderRecord();
      this.paintRecord();
    });
    on('stop', async (e) => {
      e.target.disabled = true;
      e.target.textContent = 'Stopping…';
      try { await fetch('/api/motion/record/stop', { method: 'POST' }); } catch { /* SSE says */ }
    });
  },

  /* The header button, every second: the time left while it records. */
  paintRecord() {
    if (!this.recBtn) return;
    const rec = this.motion.recording;
    const left = rec ? Math.max(0, rec.until - Date.now() / 1000) : 0;
    const txt = rec ? `⏺ ${Math.floor(left / 60)}:${String(Math.floor(left % 60)).padStart(2, '0')}` : '⏺ Record';
    if (this.recBtn.textContent !== txt) this.recBtn.textContent = txt;
    this.recBtn.classList.toggle('on', !!rec);
    // Started or ended elsewhere (a phone, or the time ran out): the open
    // choices follow — Stop while it records, − + Start once it is over.
    if (this.recOpen && this._recShown !== !!rec) this.renderRecord();
  },

  onExpand() {
    this.expanded = true;
    this.ctx.setMeta(this.id, 'go2rtc · HD stream');
    this.create();
  },
  onCollapse() {
    this.expanded = false;
    this.ctx.setMeta(this.id, 'go2rtc · sub stream');
    this.create();
  },
  onHide() { this.destroy(); },
  onShow() { this.create(); },
};
