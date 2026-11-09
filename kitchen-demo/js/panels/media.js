// NAS photos and videos.
//   slideshow -> ambient crossfade (default), captioned with the file's name
//                and its whole path on the NAS
//   browse    -> one folder tree, a tab per NAS library plus Chosen and Liked.
//                Tap a folder's name to look inside it, tap its box to put it
//                on the wall; a tick saves itself.
//   view      -> one photo or a video player
//   settings  -> how the slideshow behaves (the gear button)
// A sleeping NAS is a rendered state, never a spinner that hangs.
//
// The hearts on the picture keep it, one heart per person with their initial
// in it (the people come from /api/config, never from this file, which the
// public demo copies). The server copies a liked photograph into data/liked/
// under its own name — once, however many people like it — and the Liked tab
// is that folder. A liked photograph is a file, so it survives the NAS
// sleeping, the nightly re-index, and the folder being moved out from under
// it. A liked clip is only its NAS path and plays from the NAS.
//
// The slideshow draws from a cached batch by default (the server pulls a few
// hundred pictures off the NAS at once and serves them from disk), so the wall
// keeps showing photographs after the NAS powers down at midnight. "NAS live"
// in the gear goes back to one read per slide.
//
// The show can be held. Tapping the picture brings up one big button in the
// middle of it — ॥ while it is playing, ▶ while it is held — and that button
// is what pauses and resumes. ‹ › in the corner step by hand; ‹ walks back
// through what has already been shown rather than asking the server, because
// "the previous photograph" is not a question a shuffled slideshow can answer.

/* What the show draws from. One setting with two controls — the bar in Browse
   and a row in the gear — so the words live here and the two cannot drift into
   describing the same thing differently. */
const MIX_LEVELS = [
  ['new', 'Only new, cached'],
  ['mix', 'Cached & liked'],
  ['liked', 'Only liked'],
];

/* Megabytes as the clip rows say them: "5 GB", "1.5 GB", "250 MB". */
const gb = (mb) => (mb >= 1024 ? `${+(mb / 1024).toFixed(2)} GB` : `${mb} MB`);
const HISTORY_MAX = 40;   // photographs kept for ‹; a wall screen runs for weeks
// A wall screen that has been paused is a wall screen showing one photograph
// for the rest of the week. Somebody stopped on a picture, looked at it, and
// walked off; ten minutes later the kitchen wants its slideshow back.
const AUTO_RESUME_MS = 10 * 60 * 1000;
// How long the button stays up after a tap while the show is running. Long
// enough to move a finger to it, short enough not to sit on the photograph.
const BIG_SHOW_MS = 5000;
// Sound on is for the clip somebody is watching now, not a new setting for
// the kitchen: a wall left talking over dinner because nobody remembered the
// switch is the thing the default of off exists to prevent.
const SOUND_OFF_MS = 15 * 60 * 1000;
// A heart or a thumb whose answer has not come holds the show on its picture
// (holding()), so the answer is seen on the picture it is about — but not once
// this long has passed (the show then moves at its next tick, so at most this
// plus one interval): a server that never answers must not stop the wall.
const HOLD_MAX_MS = 60 * 1000;
// How long a heart's request may take before the wall stops waiting and asks
// the server what its lists really say. Longer than the server's own copy
// timeout (120 s), so a slow keep is never given up on while it can succeed.
const KEPT_TIMEOUT_MS = 150 * 1000;

/* Drawn, not typed. The obvious pause character is not in Space Grotesk, and a
   glyph the font has never heard of is not a missing-character box on this
   wall — it is nothing at all, so the middle button was a blank disc between
   two working arrows. ‹ and › are in the font and stay as text. */
const ICON_PAUSE = '<svg class="m-gl" viewBox="0 0 24 24" aria-hidden="true">'
  + '<rect x="6.5" y="4" width="4" height="16" rx="1.2"/>'
  + '<rect x="13.5" y="4" width="4" height="16" rx="1.2"/></svg>';
const ICON_PLAY = '<svg class="m-gl" viewBox="0 0 24 24" aria-hidden="true">'
  + '<path d="M8 4.6 19 12 8 19.4Z"/></svg>';
/* Liking a photograph keeps a copy of it on the kitchen server, under its own
   name, in data/liked/. Outlined until it is kept, filled once it is — the
   button says which of the two it is about to do without a word on it. */
const HEART_PATH = 'M12 20.2 4.6 13a4.6 4.6 0 0 1 6.5-6.5l.9.9.9-.9A4.6 4.6 0 1 1 19.4 13Z';
const ICON_HEART = '<svg class="m-gl m-hrt" viewBox="0 0 24 24" aria-hidden="true">'
  + `<path d="${HEART_PATH}"/></svg>`;
/* A person's heart: the same heart with their initial in it. The initial is
   the whole difference between three buttons in a row, so the heart is drawn
   bigger than the icons beside it to hold a letter that can be read from the
   doorway. The viewBox hugs the heart — the 24-unit box above leaves a third
   of itself empty — so the heart all but fills its 52px circle. */
const ICON_HEART_LETTER = (letter) => '<svg class="m-gl m-hrt m-lh" viewBox="2.8 4.7 18.4 16.4"'
  + ` aria-hidden="true"><path d="${HEART_PATH}"/><text x="12" y="11.9">${letter}</text></svg>`;
/* And its opposite: this one never shows again, and its path goes on a list to
   delete from the NAS later. Outlined and filled the same way the heart is. */
const ICON_THUMBDOWN = '<svg class="m-gl m-hrt" viewBox="0 0 24 24" aria-hidden="true">'
  + '<path d="M14.2 3.5H7.4a2.4 2.4 0 0 0-2.3 1.8L3.6 11a2.4 2.4 0 0 0 2.3 3h4.3l-.8 3.4a2.1 2.1 '
  + '0 0 0 2 2.6c.4 0 .7-.2.9-.5l3.9-6.1Z"/>'
  + '<path d="M17.6 3.5h1.6a1.6 1.6 0 0 1 1.6 1.6v7a1.6 1.6 0 0 1-1.6 1.6h-1.6Z"/></svg>';

export default {
  id: 'media',
  title: 'Photos',
  // A photograph is rarely 16:9; full screen leaves a band down each side.
  // app.js puts the hours in it. See sideColumn() there.
  sideWeather: true,
  // Full screen, the photograph is the screen: no card round it, and the
  // header floats on it. See .bleed in app.css.
  fullBleed: true,
  // Leaving the page stops the slide timer: a picture fetched for a tab that
  // is behind Netflix is a read off the NAS that nothing displays.
  pauseWhenUnseen: true,

  init(body, ctx) {
    this.ctx = ctx;
    this.body = body;
    this.nas = ctx.busState?.nas_status || 'unknown';
    this.setMode('slideshow');
    this.folders = null;
    this.slide = null;
    this.timer = null;
    this.live = false;   // set by onShow/onHide; see restart()
    this.paused = false;
    // What has already been shown, so ‹ can go back to a photograph rather
    // than asking the server for "the previous one", which it cannot answer:
    // shuffle has no previous, and on a cached batch there is nothing to
    // re-derive it from. Capped, because this is a wall screen that runs for
    // weeks and every entry holds a url and a caption.
    this.history = [];
    this.histAt = -1;
    this.settings = { ...ctx.config.slideshow };
    this.tab = null;         // null = whichever library the tree finds first
    this.nodes = null;       // the folder tree, built from the server's rows
    this.picked = new Set(); // folder keys the wall draws from
    this.shallow = new Set(); // ...of which these mean "this folder only"
    // Which branches are unfolded. Server-side, so the wall reloading itself
    // mid-browse comes back where it was rather than at the top of the tree.
    this.open = new Set(ctx.uiState.media_open || []);
    // Photographs kept, by root/folder/name: one entry per picture whoever
    // liked it, carrying `who` — the people whose hearts are lit for it, and
    // "earlier" for the likes from before there were people.
    this.liked = new Map();
    this.disliked = new Map(); // ...and the ones never to show again, the same way
    // Taps the server has not answered yet, by kind, picture and person: what
    // the last tap asked for. The heart shows that at once (paintKept), and
    // sendKept() sees that the lists end up saying it. See toggleKept().
    this.pending = new Map();
    // Bumped by every change that is not a whole-list read (an answer, an
    // event), so a list read that was sent before one and answered after it
    // cannot put the older lists back over it (loadKept).
    this.keptRev = { liked: 0, disliked: 0 };
    this.filter = '';
    // One heart each, from the server's config. None configured (or a server
    // older than people) is one plain heart, which is the wall as it was.
    this.people = (ctx.config.people || []).filter((p) => p && p.id && p.letter);
    this.keptWho = 'all';    // the Liked tab's filter: all, a person, or earlier
    // Per screen and in memory, never saved: see setSound().
    this.sound = false;
    const hearts = this.people.length
      ? this.people.map((p) => `<button class="m-ctl m-like" data-who="${this.esc(p.id)}"
          aria-label="Like as ${this.esc(p.name)}">${ICON_HEART_LETTER(this.esc(p.letter))}</button>`).join('')
      : `<button class="m-ctl m-like" aria-label="keep this photograph">${ICON_HEART}</button>`;

    body.innerHTML = `
      <div class="m-slideshow"><img class="m-img a"><img class="m-img b">
        <video class="m-vid" muted playsinline preload="auto" hidden></video>
        <div class="m-caption">
          <span class="m-cap-big" hidden><span class="m-cap-year"></span><span
            class="m-cap-place"></span></span>
          <span class="m-cap-name"></span>
          <span class="m-cap-path"></span>
          <span class="m-cap-note" hidden></span>
        </div>
        <div class="m-otd" hidden aria-live="polite"><span class="m-otd-k">On this day</span>
          <span class="m-otd-y"></span><span class="m-otd-a"></span></div>
        <div class="m-paused" hidden></div>
        <button class="m-ctl m-tgbtn" aria-label="send this to Telegram" hidden>✈</button>
        <div class="m-tgpick" hidden aria-live="polite"></div>
        <button class="m-big" hidden aria-label="pause">${ICON_PAUSE}</button>
        <div class="m-controls">
          <button class="m-ctl m-dislike" aria-label="never show this one again">${ICON_THUMBDOWN}</button>
          ${hearts}
          <button class="m-ctl m-prev" aria-label="the photo before this one">‹</button>
          <button class="m-ctl m-next" aria-label="the next photo">›</button>
        </div>
      </div>
      <div class="m-browse" hidden></div>
      <div class="m-view" hidden></div>`;
    this.elSlide = body.querySelector('.m-slideshow');
    this.elBrowse = body.querySelector('.m-browse');
    this.elView = body.querySelector('.m-view');
    this.imgs = [body.querySelector('.m-img.a'), body.querySelector('.m-img.b')];
    this.vid = body.querySelector('.m-vid');
    this.clip = null;        // the clip on screen, while it is playing
    this.caption = body.querySelector('.m-caption');
    this.front = 0;

    /* Tapping the picture asks for the button, and the button does the work.
       The tap used to pause outright, and that is one gesture too clever for a
       wall somebody leans past with a plate: a sleeve stopped the show and
       nothing on screen said which tap would start it again. Now the tap only
       ever *reveals* — ॥ while it is playing, ▶ while it is held — so pausing
       is always a deliberate press of a button that says what it will do.
       (Browse moved to the header button, where it says so in words.) */
    this.elSlide.onclick = (e) => {
      if (e.target.closest('.m-controls') || e.target.closest('.m-big')) return;
      this.showBig();
    };
    this.elSlide.querySelectorAll('.m-like').forEach((b) => {
      b.onclick = () => this.toggleKept('liked', b);
    });
    /* A heart is aimed at the picture under it when the finger lands, and the
       show must not move it away in the meantime. It used to: somebody liked
       one photograph, the interval ran out, and the tap meant to take the like
       back came 1.2 s later and liked the next picture instead — two likes,
       and the first heart only came back by stepping ‹ to it. So the landing
       names the picture and buys a full interval from now. */
    this.elSlide.querySelectorAll('.m-like, .m-dislike').forEach((b) => {
      b.addEventListener('pointerdown', () => {
        this.tapped = { slide: this.slide, at: Date.now() };
        this.bumpTimer();
      });
    });
    // The caption runs under the row of buttons and has to stop short of it,
    // however many hearts the household has.
    this.elSlide.style.setProperty('--m-ctls',
      this.elSlide.querySelectorAll('.m-controls .m-ctl').length);
    // ✈ beside 👎 (2026-10-13): the photograph on screen to one person's
    // Telegram. The press names the picture, as a heart's does, and the show
    // holds it while the chooser is up (holding()), so what is sent is what
    // was looked at.
    const tgBtn = this.elSlide.querySelector('.m-tgbtn');
    tgBtn.addEventListener('pointerdown', () => this.bumpTimer());
    tgBtn.onclick = () => this.openTgPick();
    this.elSlide.querySelector('.m-tgpick').onclick = (e) => {
      e.stopPropagation();
      const b = e.target.closest('[data-tgp]');
      if (!b) return;
      if (b.dataset.tgp === 'cancel') this.closeTgPick();
      else if (b.dataset.tgp === 'setup') { this.closeTgPick(); this.ctx.goAutomation?.('telegram'); }
      else this.sendSlideTg(b.dataset.tgp);
    };
    this.elSlide.querySelector('.m-dislike').onclick = () =>
      this.toggleKept('disliked', this.elSlide.querySelector('.m-dislike'));
    this.elSlide.querySelector('.m-prev').onclick = () => this.prevSlide();
    this.elSlide.querySelector('.m-next').onclick = () => this.nextSlide(true);
    this.elSlide.querySelector('.m-big').onclick = () => this.setPaused(!this.paused);
    this.paintControls();

    // Telegram (2026-10-12): a liked photo's ✈, to one person's chat (telegram.py).
    this.tg = null;
    ctx.bus.on('telegram', (t) => {
      if (t && typeof t === 'object') { this.tg = t; this.paintTgBtn(); }
    });
    fetch('/api/telegram', { cache: 'no-store' }).then((r) => (r.ok ? r.json() : null))
      .then((t) => { if (t && !this.tg) { this.tg = t; this.paintTgBtn(); } }).catch(() => {});
    ctx.bus.on('nas_status', (s) => {
      // In every snapshot, so this also runs whenever the events stream comes
      // back: a heart pressed on a phone while it was down sent its
      // media_kept into the gap, and only the lists themselves know.
      for (const kind of ['liked', 'disliked']) {
        this.loadKept(kind).then(() => { if (this.tab === kind) this.renderKeptSoon(); });
      }
      const was = this.nas;
      this.nas = s;
      // Waking is worth reacting to; going to sleep is not, because a cached
      // batch carries the show straight through it. The next reply says so.
      if (s === 'awake' && was !== 'awake') this.restart();
    });
    // The server fills the cache in the background — follow it live so the
    // gear screen shows a batch arriving rather than a stale count.
    ctx.bus.on('photo_cache', (c) => {
      // The bus carries live progress, so its count is newer than the
      // `available` figure the status fetch left behind.
      // `available` is pictures, not items: overwriting it with the total is
      // what made a batch of 500 pictures and 10 clips read "510 pictures
      // ready" with no mention of a clip anywhere.
      this.cache = { ...this.cache, ...c, available: c.photos ?? c.count };
      this.showCount();
      this.renderCacheBox();
    });
    // Every heart and thumb pressed anywhere — a phone, a laptop, this wall —
    // and the original arriving after a like: the lists were read once, at
    // load, so a like made on a phone never lit this wall's heart.
    ctx.bus.on('media_kept', (ev) => {
      if (!ev || (ev.kind !== 'liked' && ev.kind !== 'disliked')) return;
      const key = this.likeKey(ev);
      const map = this.kept(ev.kind);
      const prev = map.get(key);
      // The echo of this screen's own change: the tab has drawn it already,
      // and drawing it again would only swap the tiles under a finger.
      const same = ev.item ? !!prev && JSON.stringify(prev) === JSON.stringify(ev.item) : !prev;
      if (ev.item) map.set(key, ev.item);
      else map.delete(key);
      this.keptRev[ev.kind] += 1;
      if (this.slide && this.likeKey(this.slide) === key) this.paintKept();
      if (!same && this.tab === ev.kind) this.renderKeptSoon();
    });
    // Another screen changed the settings — follow along without a reload.
    ctx.bus.on('slideshow_settings', (cfg) => {
      this.settings = { ...this.settings, ...cfg };
      this.applySettings();
      this.restart();
      // ...and the options, if they are open here: their lit choices, their
      // cards' notes and the line under their title say what is set.
      if (this.mode === 'settings') this.renderSettings();
    });

    // One button, but it always says where it goes: "Browse" while the show is
    // running, "Slideshow" once you have left it. Nothing toggles silently.
    this.browseBtn = ctx.addHeaderButton(this.id, 'Browse', () =>
      this.mode === 'slideshow' ? this.openBrowse() : this.openSlideshow());
    this.setMode('slideshow');
    // There is no Choose button beside it. Choose *is* the tree Browse opens,
    // on the Chosen tab, and a header button claiming to be a second way in
    // read as a second screen — the thing the one-tree rewrite was for. The
    // tab carries the count, which the button never did.
    // Between Browse and ⚙ on purpose: addHeaderButton() appends in call order.
    this.soundBtn = ctx.addHeaderButton(this.id, 'Sound off', () => this.setSound(!this.sound));
    this.paintSound();
    // ⚙ opens the options and, open, closes them again — lit while they are
    // up, as the bird box's and the countdown's gears are (setMode()).
    const gear = ctx.addHeaderButton(this.id, '⚙', () =>
      (this.mode === 'settings' ? this.openSlideshow() : this.openSettings()));
    this.gearBtn = gear;          // ✈ stands under it (placeTg)
    new ResizeObserver(() => this.placeTg()).observe(body);
    addEventListener('resize', () => this.placeTg());
    gear.className = 'gear';
    gear.title = 'slideshow options';
    this.showCount();
    this.applySettings();
    this.loadKept('liked');
    this.loadKept('disliked');
    // No restart() here: onShow() from the layout engine owns the timer, the
    // same contract camera.js keeps for its stream element. Starting it in
    // init() meant the Cooking preset — which never shows this panel — still
    // pulled a photograph off the NAS every ten seconds, all day.
  },

  /* Every route in and out of the slideshow goes through here, so the header
     button can never end up describing the wrong destination. */
  setMode(mode) {
    this.mode = mode;
    if (!this.browseBtn) return;
    const back = mode !== 'slideshow';
    this.browseBtn.textContent = back ? 'Slideshow' : 'Browse';
    this.browseBtn.title = back ? 'back to the photo slideshow' : 'browse folders on the NAS';
    this.browseBtn.classList.toggle('on', back);
    this.gearBtn?.classList.toggle('on', mode === 'settings');
  },

  /* Settings that are purely visual are applied straight to the elements;
     the rest are read by nextSlide() and by the server. */
  applySettings() {
    const s = this.settings;
    this.imgs.forEach((im) => {
      // Default to the whole frame: a wall photo cropped to fill loses heads.
      im.style.objectFit = s.fit || 'contain';
      im.style.transitionDuration = `${s.transition_s ?? 1.2}s`;
    });
    if (this.vid) {
      this.vid.style.objectFit = s.fit || 'contain';
      this.vid.style.transitionDuration = `${s.transition_s ?? 1.2}s`;
    }
    this.caption.hidden = s.show_caption === false;
  },

  async showCount() {
    try {
      if (this.total == null) {
        const st = await (await fetch('/api/media/stats')).json();
        this.total = (st.photos || 0) + (st.videos || 0);
      }
      const c = this.cache;
      const cached = c && c.state !== 'off' && c.count
        ? (c.state === 'filling' ? `caching ${c.count}/${c.target}` : `${c.count} cached`)
        : '';
      this.ctx.setMeta(this.id, [
        this.total ? `${this.total.toLocaleString()} on the NAS` : '', cached,
      ].filter(Boolean).join(' · '));
    } catch { /* the meta line is decoration; never block on it */ }
  },

  /* ---------------- slideshow ----------------
     The timer exists only while the panel is live: shown by the current
     preset, on a page someone is actually looking at. Most routes in here are
     not user gestures — the NAS waking, another screen saving a setting — and
     any of them firing on the Cooking preset would put the panel back to
     reading a photograph off the NAS every ten seconds for nobody. So the
     guard sits here rather than at each caller. */
  restart() {
    clearInterval(this.timer);
    this.timer = null;
    if (!this.live) return;
    this.bumpTimer();
    // Paused and already showing something: coming back from Browse must not
    // move the photograph somebody deliberately stopped on. Paused with a
    // blank panel still needs a first picture.
    if (!this.paused || !this.slide) this.nextSlide();
  },

  /* A full interval from now. Called after every manual step as well, so
     tapping › does not leave two seconds of the old interval before the show
     moves on by itself. */
  bumpTimer() {
    clearInterval(this.timer);
    this.timer = null;
    // A clip runs to its own length and asks for the next slide when it ends.
    if (!this.live || this.paused || this.clip) return;
    const every = (this.settings.interval_s || 10) * 1000;
    this.timer = setInterval(() => {
      if (this.mode === 'slideshow' && !this.holding()) this.nextSlide();
    }, every);
  },

  setPaused(paused) {
    this.paused = paused;
    this.bumpTimer();          // stops it when paused, restarts it when not
    // Held means held: a clip left running under a paused show is the one
    // thing on this panel that would carry on moving after the button said no.
    if (this.clip && this.vid) {
      if (paused) { try { this.vid.pause(); } catch { /* not loaded */ } }
      else this.startClip();
    }

    /* Held, and nobody came back to it. The wall would otherwise show one
       photograph until somebody noticed, which on a screen nobody sits at is
       measured in days. Ten minutes is long enough to look at a picture and
       long enough to answer the door in the middle of looking. */
    clearTimeout(this.resumeTimer);
    this.resumeTimer = null;
    if (paused) {
      this.resumeTimer = setTimeout(() => this.setPaused(false), AUTO_RESUME_MS);
    }
    this.showBig();            // whichever it now is, say so
  },

  /* The big button, and how long it stays. Paused, it stays until pressed —
     it is the only way back and hiding it would strand the show. Playing, it
     is an offer, so it withdraws. */
  showBig() {
    clearTimeout(this.bigTimer);
    this.bigTimer = null;
    this.setBigShown(true);
    if (!this.paused) {
      this.bigTimer = setTimeout(() => {
        if (!this.paused) this.setBigShown(false);
      }, BIG_SHOW_MS);
    }
    this.paintControls();
  },

  /* The button and the words under it are one statement — "tap to pause", or
     "paused, tap to continue" — so they appear and withdraw together. A ॥ on
     its own was read as "this is paused" as often as "press to pause", and a ▶
     on a photograph reads as a video that has stopped, which it is not. */
  setBigShown(shown) {
    this.elSlide.querySelector('.m-big').hidden = !shown;
    this.elSlide.querySelector('.m-paused').hidden = !shown;
  },

  paintControls() {
    const big = this.elSlide.querySelector('.m-big');
    big.innerHTML = this.paused ? ICON_PLAY : ICON_PAUSE;
    big.setAttribute('aria-label', this.paused ? 'carry on' : 'pause');
    big.classList.toggle('is-play', this.paused);
    this.elSlide.querySelector('.m-paused').textContent = this.paused
      ? 'Paused — tap to continue the slideshow'
      : 'Tap to pause the slideshow';
    this.elSlide.classList.toggle('m-is-paused', this.paused);
    // Nothing has been shown before the first one: a ‹ that does nothing when
    // pressed teaches people to stop pressing the row.
    this.elSlide.querySelector('.m-prev').disabled = this.histAt <= 0;
    this.paintTgBtn();
  },

  /* ✈ shows once the kitchen has a bot, on a photograph or a clip (since
     2026-11-03: the clip goes from the batch's copy, made smaller on the
     server when it is over a bot's 50 MB). */
  paintTgBtn() {
    const b = this.elSlide?.querySelector('.m-tgbtn');
    if (!b) return;
    const show = !!this.tg?.configured && ['photo', 'video'].includes(this.slide?.kind);
    if (b.hidden === show) b.hidden = !show;
    if (show) this.placeTg();
  },

  /* ✈ under the ⚙ (2026-10-13, Alex's sketch), measured, because where the
     ⚙ is depends on the view: full screen it hangs under the views over the
     picture; in a card it is in the panel's own header above the picture, and
     then ✈ takes the picture's top right corner. Rects are scaled by the
     page's zoom on a smaller screen and the CSS values are not, so the
     distances are divided by it. */
  placeTg() {
    const s = this.elSlide;
    if (!s || !s.isConnected || !s.offsetWidth) return;
    const sr = s.getBoundingClientRect();
    const k = sr.width / s.offsetWidth || 1;
    const g = this.gearBtn?.offsetParent ? this.gearBtn.getBoundingClientRect() : null;
    const top = g ? Math.max(12, (g.bottom - sr.top) / k + 10) : 12;
    const right = g ? Math.max(12, (sr.right - g.right) / k) : 16;
    s.style.setProperty('--m-tg-top', `${Math.round(top)}px`);
    s.style.setProperty('--m-tg-right', `${Math.round(right)}px`);
  },

  openTgPick() {
    const item = this.slide;
    if (!item || !['photo', 'video'].includes(item.kind)) return;
    const chats = this.tg?.chats || [];
    this.tgPick = { item, at: Date.now() };
    const box = this.elSlide.querySelector('.m-tgpick');
    box.innerHTML = chats.length
      ? `<span class="m-tgq">Send this ${item.kind === 'video' ? 'video' : 'photo'} to</span>
         ${chats.map((c) => `<button class="m-tgto" data-tgp="${this.esc(c.key)}">✈ ${this.esc(c.name)}</button>`).join('')}
         <button class="m-tgno" data-tgp="cancel">Cancel</button>`
      : `<span class="m-tgq">Nobody has linked their Telegram yet.</span>
         <button class="m-tgto" data-tgp="setup">Link on House → Automation</button>
         <button class="m-tgno" data-tgp="cancel">Cancel</button>`;
    box.hidden = false;
    this.placeTg();
    clearTimeout(this._tgTimer);
    this._tgTimer = setTimeout(() => this.closeTgPick(), 15000);
  },

  closeTgPick() {
    clearTimeout(this._tgTimer);
    this.tgPick = null;
    const box = this.elSlide?.querySelector('.m-tgpick');
    if (box) { box.hidden = true; box.innerHTML = ''; }
    this.bumpTimer();
  },

  async sendSlideTg(to) {
    const pick = this.tgPick;
    if (!pick) return;
    clearTimeout(this._tgTimer);
    const box = this.elSlide.querySelector('.m-tgpick');
    const say = (text, bad = false) => {
      box.innerHTML = `<span class="m-tgq${bad ? ' bad' : ''}">${this.esc(text)}</span>`;
    };
    say('Sending…');
    const { item } = pick;
    let ans = null;
    let ok = false;
    try {
      const r = await fetch(item.kind === 'video' ? '/api/telegram/send-video' : '/api/telegram/send-photo', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: item.id, root: item.root, folder: item.folder, name: item.name, to }),
      });
      ok = r.ok;
      ans = await r.json().catch(() => null);
    } catch { /* said below */ }
    if (this.tgPick !== pick) return;        // closed meanwhile
    say(ok && ans?.queued ? `A big video: making it smaller, then it goes to ${(ans.to || []).join(', ')} in a few minutes`
      : ok ? `Sent to ${(ans?.sent || []).join(', ')} ✓`
      : ans?.error || ans?.failed?.[0]?.why || 'Telegram could not be reached', !ok);
    this._tgTimer = setTimeout(() => this.closeTgPick(), ok && !ans?.queued ? 2500 : 6000);
  },

  /* Stepping by hand does not pause. ‹ and › move the show and it carries on
     from there, with a full interval from the step rather than the remainder
     of the last picture's — which is what bumpTimer() is for. Stepping used to
     pause, and it was one control doing another's job: ॥ in the middle of the
     picture is the thing that means "stop here", it says so, and it is the
     only way in or out of held. */
  prevSlide() {
    if (this.histAt <= 0) return;
    this.histAt -= 1;
    this.showItem(this.history[this.histAt]);
    this.bumpTimer();
  },

  async nextSlide(manual) {
    // Nobody is looking: another browser tab, or a minimised window. Asking
    // the server for a picture here is a read off the NAS for no viewer.
    if (document.hidden) return;
    if (manual) this.bumpTimer();   // a full interval from the step, not a pause

    // Walked back with ‹ and now going forward again: the next picture is one
    // we have already got, and asking the server would skip past it.
    if (this.histAt >= 0 && this.histAt < this.history.length - 1) {
      this.histAt += 1;
      return this.showItem(this.history[this.histAt]);
    }

    let res;
    try {
      res = await (await fetch('/api/media/slideshow/next')).json();
    } catch { return; }
    // Only the server knows whether a sleeping NAS actually stops the show —
    // with a cached batch it does not — so the status it returns decides.
    if (res.status !== 'ok') return this.render(res.status);
    this.render();
    this.history.push(res.item);
    if (this.history.length > HISTORY_MAX) this.history.shift();
    this.histAt = this.history.length - 1;
    this.showItem(res.item);
  },

  showItem(item) {
    if (!item) return;
    const back = this.imgs[1 - this.front];
    back.onload = () => {
      back.classList.add('show');
      this.imgs[this.front].classList.remove('show');
      this.front = 1 - this.front;
      this.setCaption(item);
    };
    back.onerror = () => {}; // a single unreadable file must not stop the show
    // A clip crossfades in as its poster first and plays over the top, so the
    // transition is the same one every other slide gets and there is never a
    // black rectangle between two photographs.
    back.src = (item.kind === 'video' && item.thumb_url) ? item.thumb_url : item.url;
    this.slide = item;
    // What a heart said is about its own picture: over the next one it would
    // be a caption telling a lie ("Kept for …" under a heart that is dark).
    if (this._note?.key && this._note.key !== this.likeKey(item)) this.hideNote();
    this.playClip(item);
    this.paintControls();
    this.paintKept();
  },

  /* A clip in the show plays itself: muted, once, and then the show moves on
     of its own accord. Muted because this is a wall in a kitchen and a
     photograph that suddenly speaks is a photograph nobody wants — unless
     somebody has pressed Sound on, which lasts a quarter of an hour (see
     setSound); once, because the interval belongs to pictures and a clip's
     length is its own.

     Everything here has a way out. A clip that will not play, will not load,
     or quietly stops firing events hands the slide back to the ordinary timer
     rather than leaving one frame on the wall until somebody notices — which
     on a screen nobody sits at is measured in days. */
  playClip(item) {
    const v = this.vid;
    if (!v) return;
    clearTimeout(this.clipGuard);
    this.clipGuard = null;
    // A clip runs with no picture interval under it (bumpTimer), so a photo
    // put up over one — by ›, by a 👎's step, by ‹'s history — has to start
    // the interval itself. It did not, and the wall stayed on that photo
    // until something else restarted the show.
    const replacing = !!this.clip;
    this.clip = null;
    v.onended = v.onerror = v.oncanplay = null;
    v.classList.remove('show');
    try { v.pause(); } catch { /* nothing loaded */ }

    if (!item || item.kind !== 'video') {
      v.hidden = true;
      v.removeAttribute('src');
      v.load();          // drops the buffered clip; a wall runs for weeks
      if (replacing) this.bumpTimer();
      return;
    }

    this.clip = item;
    v.hidden = false;
    v.onended = () => this.endClip(true);
    v.onerror = () => this.endClip(false);
    v.oncanplay = () => v.classList.add('show');
    v.src = item.url;
    // The backstop for a clip whose events never arrive. Its own length plus
    // slack when the index probed one — and five minutes when it did not,
    // because a short guard over an unknown duration does not protect the
    // show, it truncates it: half the clips in this library are FILM
    // derivatives the probe never read a duration from.
    const guard = item.duration ? (item.duration + 8) * 1000 : 300000;
    this.clipGuard = setTimeout(() => this.endClip(true), Math.min(Math.max(guard, 15000), 300000));
    this.bumpTimer();    // no picture interval runs underneath a clip
    if (!this.paused) this.startClip();
  },

  /* play(), with sound if the switch says so. A browser nobody has touched
     refuses to start a clip with sound — the wall's Chrome is launched with
     that rule switched off, a phone's and a laptop's are not — and a refusal
     used to be the end of the clip. So a clip refused with sound is tried
     once more without it, and the switch goes back to off to say so. Only
     for the clip that asked: a refusal arriving after the show has moved on
     belongs to a clip that is no longer on screen.

     Only a refusal (NotAllowedError) is about sound. play() also rejects when
     the hold button pauses a clip that is still loading (AbortError) or when
     the file cannot be played at all, and retrying those would start a clip
     somebody had just held, or switch sound off for a reason that has nothing
     to do with it — so they end the clip, as every rejection always did. */
  startClip() {
    const v = this.vid;
    const clip = this.clip;
    v.muted = !this.sound;
    v.play().catch((e) => {
      if (this.clip !== clip) return;
      if (v.muted || e?.name !== 'NotAllowedError' || this.paused) {
        this.endClip(false);
        return;
      }
      this.setSound(false);
      v.play().catch(() => { if (this.clip === clip) this.endClip(false); });
    });
  },

  /* Sound for the clips in the show, off on every page load and on every
     screen by itself. Not ui-state, and not a slideshow setting: the wall and
     a laptop are two screens, and sound switched on at one must not come on
     at the other — where a browser nobody tapped would refuse the clip — nor
     survive the wall reloading itself after a deploy. A slideshow setting
     would also restart the show on every screen, cutting off the very clip
     somebody wanted to hear. It switches itself off after SOUND_OFF_MS.
     Browse's own player has its own controls and is left alone. */
  setSound(on) {
    this.sound = on;
    clearTimeout(this.soundTimer);
    this.soundTimer = on ? setTimeout(() => this.setSound(false), SOUND_OFF_MS) : null;
    if (this.vid) this.vid.muted = !on;   // the clip playing now, as well as the next
    this.paintSound();
  },

  paintSound() {
    if (!this.soundBtn) return;
    this.soundBtn.textContent = this.sound ? 'Sound on' : 'Sound off';
    this.soundBtn.classList.toggle('on', this.sound);
    this.soundBtn.title = this.sound
      ? 'clips play with sound — tap to mute; it mutes itself after 15 minutes'
      : 'clips play muted — tap for sound, for 15 minutes';
  },

  /* Done with the clip on screen: `advance` says whether it earned the next
     slide (it played, or it timed out) or merely failed, in which case the
     poster stays for one ordinary interval like any other picture. */
  endClip(advance) {
    if (!this.clip) return;
    clearTimeout(this.clipGuard);
    this.clipGuard = null;
    this.clip = null;
    this.vid.classList.remove('show');
    this.vid.hidden = true;
    try { this.vid.pause(); } catch { /* nothing loaded */ }
    this.bumpTimer();
    if (advance && !this.paused && !this.holding()) this.nextSlide();
  },

  /* Which photograph this is, said the way you would have to say it to go and
     find the file: its own name on top, and under it the whole path on the NAS
     — /photos/homes/… — not the container's mount point and not the last
     segment of the folder. "Camera / 2026 09" is four folders on this NAS and
     only the whole path tells them apart, which is the entire reason the line
     is there. */
  setCaption(item) {
    const bigEl = this.caption.querySelector('.m-cap-big');
    const yearEl = this.caption.querySelector('.m-cap-year');
    const placeEl = this.caption.querySelector('.m-cap-place');
    const nameEl = this.caption.querySelector('.m-cap-name');
    const pathEl = this.caption.querySelector('.m-cap-path');
    this.setOnThisDay(item);
    if (!item) {
      yearEl.textContent = '';
      placeEl.textContent = '';
      bigEl.hidden = true;
      nameEl.textContent = '';
      pathEl.textContent = '';
      return;
    }
    // Where it was taken ("Town, Country"): the server reads it off the
    // photograph's own GPS. A picture without any has no place.
    placeEl.textContent = item.place || '';
    // The year it was taken, from its name when the server could read one
    // there: the file's mtime is the day it was copied for a third of this
    // library, which put 2024 under photographs from 2016.
    const year = item.taken ? item.taken.slice(0, 4)
      : item.mtime ? new Date(item.mtime * 1000).getFullYear() : '';
    // The year and the place are for the room, so they are the big line —
    // one line, the year first and the place after it, "2025 · Lakeside,
    // Sweden" (Alex, 2026-10-01; they were two lines, the year on top). The
    // file's name under it is for finding it. On this day already writes the
    // year, huge, just above: said once is enough.
    yearEl.textContent = item.on_this_day ? '' : String(year);
    bigEl.hidden = !yearEl.textContent && !placeEl.textContent;
    nameEl.textContent = item.name || '';
    const dir = item.path
      ? item.path.slice(0, item.path.lastIndexOf('/'))
      : [item.root, item.folder].filter(Boolean).join('/');
    pathEl.textContent = [item.library || item.root, dir].filter(Boolean).join('  ·  ');
    pathEl.title = item.path || dir;
  },

  /* "On this day", big, over the picture it belongs to: a photograph taken on
     today's date in an earlier year, which the server marks (on_this_day) as
     it hands the slide out. Set here, with the caption, because this runs at
     the crossfade — so the words change with the picture, whether it came
     from ›, from ‹ out of the history, or as a clip's poster, and never a
     slide early. Drawn whether or not the caption is switched on: the caption
     is for finding the file, this is for the people looking at it. */
  setOnThisDay(item) {
    const el = this.elSlide?.querySelector('.m-otd');
    if (!el) return;
    const otd = item && item.on_this_day;
    el.hidden = !otd;
    if (!otd) return;
    el.querySelector('.m-otd-y').textContent = otd.year;
    el.querySelector('.m-otd-a').textContent = otd.years_ago === 1
      ? 'a year ago' : `${otd.years_ago} years ago`;
  },

  render(status) {
    if (this.mode !== 'slideshow') return;
    if (status === 'nas_sleeping') {
      this.setCaption(null);
      this.elSlide.classList.add('m-empty');
      this.elSlide.dataset.msg = '🌙  NAS is sleeping — photos are back in the morning';
    } else if (status === 'empty') {
      this.setCaption(null);
      this.elSlide.classList.add('m-empty');
      this.elSlide.dataset.msg = '🖼  No photos indexed yet';
    } else {
      this.elSlide.classList.remove('m-empty');
    }
  },

  /* ---------------- browse ----------------
     One screen and one tree, the shape Windows draws a disk in: a library
     unfolds into its folders, those unfold into theirs, and every row carries
     a box saying whether the wall may draw from it.

     The box is the whole point of the tree. Ticking a folder means "this and
     everything under it", which is the sentence somebody actually has in mind
     when they look at a phone backup — 353 folders under one name. Untick one
     child of a ticked parent and the selection is written out the long way
     (every other child, plus the parent's own loose files as a shallow entry)
     so the picture on the wall matches the boxes exactly.

     Nothing is saved by a Save button. A tick is a decision, it goes to the
     server the moment the finger leaves, and "Saved" says so — the same
     bargain the gear screen makes, for the same reason: nobody sits at a wall.

     Browsing and choosing were two screens onto one list, and are now one
     screen: tap a folder's *name* to look inside it, tap its *box* to put it
     on the wall. */

  /* Drawn, not typed — the tick and the twisty are not glyphs Space Grotesk
     has, and a character the font has never heard of renders as nothing at
     all on this wall rather than as a missing-character box. */
  boxIcon(state) {
    const tick = state === 'on'
      ? '<path d="M7.4 12.4 10.7 15.7 16.8 8.6"/>'
      : state === 'some' ? '<path d="M8 12h8"/>' : '';
    return `<svg class="m-bx is-${state}" viewBox="0 0 24 24" aria-hidden="true">`
      + '<rect x="3.6" y="3.6" width="16.8" height="16.8" rx="3.6"/>'
      + `${tick}</svg>`;
  },

  twistIcon() {
    return '<svg class="m-tw" viewBox="0 0 24 24" aria-hidden="true">'
      + '<path d="M9.5 5.5 16 12l-6.5 6.5"/></svg>';
  },

  /* Keys join the two halves with a NUL, which cannot occur in either, so a
     library called "a/b" and a library "a" holding "b" can never collide. */
  keyOf(root, path) { return `${root}\u0000${path}`; },

  async openBrowse(tab) {
    this.setMode('browse');
    this.elSlide.hidden = true;
    this.elView.hidden = true;
    this.elBrowse.hidden = false;
    if (tab) this.tab = tab;
    this.elBrowse.innerHTML = '<div class="placeholder">loading…</div>';
    let data;
    try {
      data = await (await fetch('/api/media/folders')).json();
    } catch {
      this.elBrowse.innerHTML = '<div class="placeholder">could not reach the kitchen server</div>';
      return;
    }
    this.buildTree(data);
    this.renderBrowse();
  },

  openSlideshow() {
    this.setMode('slideshow');
    this.elBrowse.hidden = true;
    this.elView.hidden = true;
    this.elSlide.hidden = false;
    // restart(), not nextSlide(): leaving the page stops the timer, and if the
    // panel was left on Browse when that happened onShow() had no slideshow to
    // resume. Coming back here has to be what starts it, or the wall sits on
    // one photograph for the rest of the evening.
    this.restart();
  },

  /* Folder names come off the NAS, so they land in markup escaped. */
  esc(s) {
    return String(s ?? '').replace(/[&<>"']/g,
      (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  },

  /* ---------------- the tree ----------------
     The server sends one row per folder that actually holds photographs, with
     its whole path in it. The tree is those paths split apart: the folders in
     between hold nothing themselves and have no row of their own, but they are
     exactly the ones worth ticking, so they are made here. */
  buildTree(data) {
    this.nodes = new Map();
    this.libs = [];

    const node = (root, path, name, library) => {
      const key = this.keyOf(root, path);
      let n = this.nodes.get(key);
      if (!n) {
        n = { key, root, path, name, library, parent: null, children: new Map(),
              own: 0, ownVideos: 0, count: 0, videos: 0, newest: 0 };
        this.nodes.set(key, n);
      }
      return n;
    };

    for (const f of data.folders || []) {
      if (!f.count) continue;
      const library = f.library || f.root;
      const root = node(f.root, '', library, library);
      if (!this.libs.some((l) => l.root === f.root)) {
        this.libs.push({ root: f.root, label: library });
      }
      let here = root;
      let path = '';
      for (const part of String(f.folder || '').split('/').filter(Boolean)) {
        path = path ? `${path}/${part}` : part;
        const child = node(f.root, path, part, library);
        if (!child.parent) { child.parent = here; here.children.set(part, child); }
        here = child;
      }
      here.own += f.count;
      here.ownVideos += f.videos || 0;
      // Counts roll up: a folder's line has to answer "how much is under this"
      // before anyone unfolds it, or every tick is a guess.
      for (let n = here; n; n = n.parent) {
        n.count += f.count;
        n.videos += f.videos || 0;
        n.newest = Math.max(n.newest, f.newest || 0);
      }
    }

    // Flat rows, for the filter box.
    this.folders = (data.folders || []).filter((f) => f.count > 0)
      .sort((a, b) => (b.newest || 0) - (a.newest || 0));

    const chosen = data.selected_paths || [];
    this.picked = new Set(chosen.map((a) => this.keyOf(a.root, a.folder)));
    this.shallow = new Set(chosen.filter((a) => a.deep === false)
      .map((a) => this.keyOf(a.root, a.folder)));

    if (!this.libs.some((l) => l.root === this.tab)
        && !['chosen', 'liked', 'disliked'].includes(this.tab)) {
      this.tab = this.libs.length ? this.libs[0].root : 'chosen';
    }
  },

  /* Everything under this node, and never the node itself: a library's own key
     is a prefix of all of its children's, so equality has to be excluded by
     hand rather than by the string. */
  descPrefix(n) { return n.path ? `${n.key}/` : n.key; },

  isDescendantKey(k, n) { return k !== n.key && k.startsWith(this.descPrefix(n)); },

  /* The nearest ticked folder above this one — the reason a child can be ticked
     without a key of its own. A shallow entry covers nothing but itself. */
  coveringAncestor(n) {
    for (let p = n.parent; p; p = p.parent) {
      if (this.picked.has(p.key) && !this.shallow.has(p.key)) return p;
    }
    return null;
  },

  checkState(n) {
    if (this.picked.has(n.key) && !this.shallow.has(n.key)) return 'on';
    if (this.coveringAncestor(n)) return 'on';
    for (const k of this.picked) {
      if (this.isDescendantKey(k, n)) return 'some';
    }
    return this.picked.has(n.key) ? 'some' : 'off';
  },

  /* Ticking is easy; un-ticking a folder inside a ticked one is the whole
     problem. "Everything under Camera except 2019" is not one path, so it is
     written out as every other child of every folder on the way down — plus a
     shallow entry for each of those folders' own loose photographs, which
     would otherwise vanish along with the branch nobody meant to touch. */
  toggleNode(n) {
    const wantOn = this.checkState(n) !== 'on';
    const cover = this.coveringAncestor(n);

    for (const k of [...this.picked]) {
      if (k === n.key || this.isDescendantKey(k, n)) {
        this.picked.delete(k);
        this.shallow.delete(k);
      }
    }

    if (wantOn) {
      if (!cover) this.picked.add(n.key);
    } else if (cover) {
      this.picked.delete(cover.key);
      this.shallow.delete(cover.key);
      for (let c = n; c !== cover; c = c.parent) {
        const parent = c.parent;
        if (parent.own) { this.picked.add(parent.key); this.shallow.add(parent.key); }
        for (const sib of parent.children.values()) {
          if (sib !== c) this.picked.add(sib.key);
        }
      }
    }
    this.saveAlbums();
  },

  clearPicks() {
    this.picked.clear();
    this.shallow.clear();
    this.saveAlbums();
  },

  /* Debounced, because a person ticking four folders in a row should be one
     write, not four — and every write restarts the sequence the show is
     walking. */
  saveAlbums() {
    // Only the boxes move, never the rows — rebuilding the list under a finger
    // ticking four folders in a row would throw the scroll position away each
    // time. The Chosen tab is the exception: there, unticking removes the row.
    if (this.tab === 'chosen') this.paintTree(); else this.paintBoxes();
    clearTimeout(this._albumTimer);
    this._albumTimer = setTimeout(async () => {
      const selected = [...this.picked].map((k) => {
        const cut = k.indexOf('\u0000');
        return { root: k.slice(0, cut), folder: k.slice(cut + 1), deep: !this.shallow.has(k) };
      });
      try {
        await fetch('/api/media/albums', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ selected }),
        });
        this.flashSaved();
      } catch {
        this.flashSaved('Not saved — server unreachable');
      }
    }, 700);
  },

  /* Free-text match over everything visible on the row, so typing either the
     folder's own name or any parent in its path finds it. */
  matches(f) {
    if (!this.filter) return true;
    return `${f.library} ${f.folder}`.toLowerCase().includes(this.filter);
  },

  countLine(n) {
    return [
      `${n.count.toLocaleString()} item${n.count === 1 ? '' : 's'}`,
      n.own && n.children.size ? `${n.own.toLocaleString()} here` : '',
      n.videos ? `${n.videos} video` : '',
    ].filter(Boolean).join(' · ');
  },

  tabs() {
    return [...this.libs.map((l) => [l.root, l.label]),
            ['chosen', 'Chosen'], ['liked', 'Liked'], ['disliked', 'Disliked']];
  },

  /* How many folders the library actually holds, not how many rows the tree
     happens to be showing — a tab reading "Family video 0" because that
     library keeps its clips loose at the top level was simply wrong. */
  tabCount(k) {
    if (k === 'chosen') return this.picked.size;
    if (k === 'liked') return this.liked.size;
    if (k === 'disliked') return this.disliked.size;
    return this.folders.filter((f) => f.root === k).length;
  },

  renderBrowse() {
    if (!this.nodes || !this.nodes.size) {
      this.elBrowse.innerHTML = `<div class="m-bar"><button class="m-back">Slideshow</button></div>
        <div class="placeholder">Nothing indexed yet.<br>
        <span style="font-size:14px">Photos appear once the NAS share is mounted.</span></div>`;
      this.elBrowse.querySelector('.m-back').onclick = () => this.openSlideshow();
      return;
    }
    this.elBrowse.innerHTML = `
      <div class="m-bar">
        <button class="m-back">Slideshow</button>
        <span class="m-title"></span>
        <span class="m-mix" role="group" aria-label="what the slideshow draws from"></span>
        <span class="spacer" style="flex:1"></span>
        <span class="m-saved" hidden>Saved</span>
        <input class="m-filter" type="search" placeholder="Filter by name or path"
               value="${this.esc(this.filter)}" autocomplete="off">
        <button class="m-none">Clear ticks</button>
      </div>
      <div class="m-tabs"></div>
      <p class="m-hint"></p>
      <div class="m-items"></div>`;
    this.elBrowse.querySelector('.m-back').onclick = () => this.openSlideshow();
    this.elBrowse.querySelector('.m-none').onclick = () => this.clearPicks();
    // Only the rows are redrawn as you type — rebuilding the bar would take
    // the keyboard focus out of this very box between two keystrokes.
    const box = this.elBrowse.querySelector('.m-filter');
    box.oninput = () => { this.filter = box.value.trim().toLowerCase(); this.paintTree(); };
    this.renderMix();
    this.renderTabs();
  },

  /* What reaches the wall, in the bar at the top rather than down among the
     tabs. The tabs answer "what is there" — a library, the chosen folders, the
     kept ones — and this answers "which of it plays", which is a different
     question about a different screen. Sat at the end of that row it read as a
     seventh tab. */
  renderMix() {
    const box = this.elBrowse.querySelector('.m-mix');
    if (!box) return;
    const mix = this.settings.liked_mix || 'mix';
    box.innerHTML = MIX_LEVELS.map(([k, label]) =>
      `<button class="m-mixb${mix === k ? ' on' : ''}" data-m="${k}">${label}</button>`).join('');
    box.querySelectorAll('.m-mixb').forEach((b) => {
      b.onclick = () => {
        this.setSetting('liked_mix', b.dataset.m);
        this.renderMix();      // the lit one moves at once, not on the reply
      };
    });
  },

  renderTabs() {
    // Drawing now is drawing the latest: a kept-tab redraw still queued
    // (renderKeptSoon) would only rebuild the same tiles under a finger.
    clearTimeout(this._keptTabTimer);
    this._keptStale = false;
    const bar = this.elBrowse.querySelector('.m-tabs');
    if (!bar) return;
    bar.innerHTML = this.tabs().map(([k, label]) =>
      `<button class="m-tab${this.tab === k ? ' on' : ''}" data-k="${encodeURIComponent(k)}">
         ${this.esc(label)} <span class="m-fcount">${this.tabCount(k)}</span></button>`).join('');
    bar.querySelectorAll('.m-tab').forEach((b) => {
      b.onclick = () => {
        this.tab = decodeURIComponent(b.dataset.k);
        this.renderTabs();
        if (this.tab === 'liked' || this.tab === 'disliked') this.loadKept(this.tab, true);
      };
    });
    this.paintTree();
  },

  /* The rows the current tab and filter ask for, each with the depth it is
     drawn at. Only unfolded branches are walked, so a library of 40 000 items
     costs the same to draw as one of forty until somebody opens it. */
  visibleRows() {
    const rows = [];
    if (this.filter) {
      for (const f of this.folders) {
        if (!this.matches(f)) continue;
        const n = this.nodes.get(this.keyOf(f.root, f.folder));
        if (n) rows.push({ n, depth: 0, full: true });
      }
      return rows;
    }
    if (this.tab === 'chosen') {
      for (const key of [...this.picked].sort()) {
        const n = this.nodes.get(key);
        if (n) rows.push({ n, depth: 0, full: true });
      }
      return rows;
    }
    const root = this.nodes.get(this.keyOf(this.tab, ''));
    if (!root) return rows;
    // A library's own loose photographs are a row too, or they are unreachable.
    if (root.own) rows.push({ n: root, depth: 0 });
    const walk = (parent, depth) => {
      const kids = [...parent.children.values()]
        .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
      for (const c of kids) {
        rows.push({ n: c, depth });
        if (this.open.has(c.key)) walk(c, depth + 1);
      }
    };
    walk(root, 0);
    return rows;
  },

  nodeRow({ n, depth, full }) {
    const kids = n.children.size;
    const open = this.open.has(n.key);
    const label = full
      ? [n.library, n.path].filter(Boolean).join(' / ')
      : (n.path ? n.name : `${n.library} — loose photos`);
    return `<div class="m-node${open ? ' open' : ''}" style="--d:${depth}"
                 data-k="${encodeURIComponent(n.key)}">
      <button class="m-twist${kids ? '' : ' none'}" data-a="twist"
              aria-label="${open ? 'fold away' : 'unfold'}">${kids ? this.twistIcon() : ''}</button>
      <button class="m-box" data-a="box" aria-label="show this folder on the wall"
        >${this.boxIcon(this.checkState(n))}</button>
      <button class="m-nname" data-a="open">
        <span class="m-nlabel">${this.esc(label)}</span>
        <span class="m-nmeta">${this.countLine(n)}</span>
      </button>
    </div>`;
  },

  paintTree() {
    const box = this.elBrowse.querySelector('.m-items');
    if (!box) return;
    this.renderHint();
    if (this.tab === 'liked' || this.tab === 'disliked') return this.paintKeptTab(box, this.tab);

    const rows = this.visibleRows();
    const title = this.elBrowse.querySelector('.m-title');
    if (title) {
      // The library tabs count the whole library; Chosen and a filter count
      // what is on screen, because there the rows *are* the answer.
      const own = this.tab === 'chosen' || this.filter;
      const folders = own ? rows.length : this.tabCount(this.tab);
      const items = own
        ? rows.reduce((a, r) => a + r.n.count, 0)
        : (this.nodes.get(this.keyOf(this.tab, ''))?.count || 0);
      title.textContent = rows.length
        ? `${folders.toLocaleString()} folder${folders === 1 ? '' : 's'} · ${items.toLocaleString()} items`
        : '';
    }

    if (!rows.length) {
      box.innerHTML = `<div class="placeholder">${
        this.filter ? `Nothing matches “${this.esc(this.filter)}”.`
          : this.tab === 'chosen'
            ? 'Nothing ticked yet, so the whole library is on the wall. Tick a folder to narrow it down.'
            : 'Nothing indexed in this library yet.'}</div>`;
      return;
    }
    box.innerHTML = `<div class="m-tree">${rows.map((r) => this.nodeRow(r)).join('')}</div>`;
    box.querySelector('.m-tree').onclick = (e) => {
      const btn = e.target.closest('[data-a]');
      const row = e.target.closest('.m-node');
      if (!btn || !row) return;
      const n = this.nodes.get(decodeURIComponent(row.dataset.k));
      if (!n) return;
      if (btn.dataset.a === 'box') return this.toggleNode(n);
      if (btn.dataset.a === 'open' && n.own) return this.openFolder(n.root, n.path);
      this.toggleOpen(n);
    };
  },

  /* Boxes and counts, repainted where they stand. */
  paintBoxes() {
    const box = this.elBrowse.querySelector('.m-items');
    if (!box) return;
    box.querySelectorAll('.m-node').forEach((row) => {
      const n = this.nodes.get(decodeURIComponent(row.dataset.k));
      if (n) row.querySelector('.m-box').innerHTML = this.boxIcon(this.checkState(n));
    });
    const chosen = this.elBrowse.querySelector('.m-tab[data-k="chosen"] .m-fcount');
    if (chosen) chosen.textContent = this.picked.size;
    this.renderHint();
  },

  toggleOpen(n) {
    if (!n.children.size) return;
    if (this.open.has(n.key)) this.open.delete(n.key); else this.open.add(n.key);
    // Kept server-side so the wall reloading itself mid-browse comes back
    // where it was. Capped: this is a wall screen that runs for weeks.
    this.ctx.saveUiState({ media_open: [...this.open].slice(-200) });
    this.paintTree();
  },

  renderHint() {
    const el = this.elBrowse.querySelector('.m-hint');
    if (!el) return;
    el.textContent = this.tab === 'liked'
      ? `${this.liked.size} kept. ${this.people.length
        ? 'Each person\'s hearts are listed in data/liked-<person>.json, the earlier ones in data/liked.json.'
        : 'Their NAS paths and names are listed in data/liked.json.'} `
        + 'Photographs are copied once into data/liked/, whoever liked them; '
        + 'clips stay on the NAS and are kept by their path.'
      : this.tab === 'disliked'
      ? `${this.disliked.size} the wall skips. `
        + 'Their NAS paths are listed in data/disliked.json, for deleting later. '
        + '🗑 deletes a picture\'s copy on the server; the NAS keeps the photograph, '
        + 'and the wall goes on skipping it.'
      : this.picked.size
        ? `${this.picked.size} folder${this.picked.size === 1 ? '' : 's'} ticked — only these appear on the wall.`
        : 'Nothing ticked, so the whole library is shown. Tick a folder to narrow it down.';
  },

  /* ---------------- the photographs in one folder ---------------- */
  async openFolder(root, folder) {
    this.elBrowse.innerHTML = '<div class="placeholder">loading…</div>';
    let items = [];
    try {
      items = (await (await fetch(
        `/api/media/list?root=${encodeURIComponent(root)}&folder=${encodeURIComponent(folder)}`
      )).json()).items;
    } catch { /* fall through to empty */ }
    this.elBrowse.innerHTML = `
      <div class="m-bar"><button class="m-back">Folders</button>
        <span class="m-title">${this.esc(folder || root)}</span></div>
      <div class="m-grid thumbs">${items.map((i) => `
        <button class="m-thumb" data-id="${i.id}">
          <img loading="lazy" src="${i.thumb_url}" alt="">
          ${i.kind === 'video' ? `<span class="m-play">▶${i.playclass === 'none' ? '✕' : ''}</span>` : ''}
        </button>`).join('')}</div>`;
    this.elBrowse.querySelector('.m-back').onclick = () => this.renderBrowse();
    this.items = items;
    this.elBrowse.querySelectorAll('.m-thumb').forEach((b) => {
      b.onclick = () => this.openItem(items.find((x) => x.id === Number(b.dataset.id)));
    });
  },

  /* ---------------- kept photographs: liked, and disliked ----------------
     One mechanism, two verbs. Either way a photograph is a copy on this
     server's own disk under the picture's own name, a row in a JSON file, and
     a tab in Browse. The NAS can sleep, be re-indexed, or have the folder
     moved out from under it; a kept photograph is a file and stays one. A
     clip is only its NAS path and a poster — copies of clips were most of a
     gigabyte of this server's disk, and the backup carried every byte.

     Liking is per person: a heart each, a list each, and a photograph liked
     by three people is still one copy. Disliking is one list for the whole
     kitchen, because "never show this again" is said for everybody.

     Disliked is the one that is also a list of work: every row carries the
     photograph's whole NAS path, so `data/disliked.json` is what a deletion
     from the NAS can be driven from later. Until then the wall simply stops
     showing it, and dropping it from the Disliked tab puts it back in the show
     and takes it off the list. */
  likeKey(item) {
    return item ? `${item.root}\u0000${item.folder || ''}/${item.name}` : '';
  },

  kept(kind) { return kind === 'disliked' ? this.disliked : this.liked; },

  /* Whose lists a kept picture is on. A server older than people sends no
     `who`, and every like on it is then nobody's in particular — Earlier. */
  whoOf(item) { return (item && item.who) || ['earlier']; },

  /* `repaint` is for a tab being opened: the lists were read once when the
     panel started, and a wall runs for weeks — another phone's hearts, or a
     copy deleted from a laptop, would otherwise never reach this tab. */
  async loadKept(kind, repaint = false) {
    // A heart answered, or an event arrived, while the list was on its way:
    // the list is older than what this screen already knows, so ask again
    // (a few times at most) rather than put the older lists back.
    for (let tries = 0; tries < 3; tries += 1) {
      const rev = this.keptRev[kind];
      let map;
      try {
        const data = await (await fetch(`/api/media/${kind}`)).json();
        map = new Map((data.items || []).map((i) => [this.likeKey(i), i]));
      } catch { break; /* the button simply stays unlit */ }
      if (this.keptRev[kind] !== rev) continue;
      if (kind === 'disliked') this.disliked = map; else this.liked = map;
      break;
    }
    this.paintKept();
    if (repaint && this.tab === kind && this.mode === 'browse') this.renderTabs();
  },

  paintKept() {
    const item = this.slide;
    this.elSlide?.querySelectorAll('.m-like, .m-dislike').forEach((btn) => {
      const kind = btn.classList.contains('m-dislike') ? 'disliked' : 'liked';
      const dis = kind === 'disliked';
      const who = btn.dataset.who;
      const person = this.people.find((p) => p.id === who);
      // A tap still on its way shows what it asked for, at full strength,
      // with a ring for "on its way" (.pending). It used to fade the old
      // state to half, which read as "not liked" from across the kitchen,
      // and to ignore every tap until the answer — for 39 s, once, while the
      // server waited on the NAS — which is how "take it back" was lost.
      const p = item && this.pending.get(this.pendKey(kind, item, who));
      const on = p ? p.want : this.isKept(kind, item, who);
      btn.classList.toggle('on', on);
      btn.classList.toggle('pending', !!p);
      // Clips can be kept too. They were excluded here and refused by the
      // server as well, so a clip in the show was the one slide where the
      // buttons in the corner did nothing and never said why.
      btn.disabled = !item;
      btn.setAttribute('aria-label', dis
        ? (on ? 'on the delete list — tap to take it off' : 'never show this one again')
        : person ? (on ? `${person.name} likes this` : `Like as ${person.name}`)
          : (on ? 'kept — tap to drop it' : 'keep this one'));
    });
  },

  /* Whether the lists, as this screen last heard them, have this picture on
     for this button. A person's heart is lit by their own like and by nobody
     else's — Earlier's included; the one plain heart (no people) by anybody's. */
  isKept(kind, item, who) {
    const kept = item && this.kept(kind).get(this.likeKey(item));
    return !!kept && (kind === 'disliked' || !who || this.whoOf(kept).includes(who));
  },

  pendKey(kind, item, who) { return `${kind}|${this.likeKey(item)}|${who || ''}`; },

  /* An open Liked or Disliked tab, redrawn for changes made elsewhere — once
     for a burst (Delete all copies sends one event per picture), and not
     while a tile is asking "Delete the copy?" or the row "Delete all?": a
     redraw wipes the question from under the finger about to answer it. */
  renderKeptSoon() {
    clearTimeout(this._keptTabTimer);
    this._keptTabTimer = setTimeout(() => {
      if (this.tab !== 'liked' && this.tab !== 'disliked') return;
      // Looking at one picture: the grid behind it is drawn on the way back.
      if (this.mode === 'view') { this._keptStale = true; return; }
      if (this.mode !== 'browse') return;
      // A question is up: ask again later rather than lose the change.
      if (this.asking || this.elBrowse?.querySelector('.m-dropall.asking')) {
        this.renderKeptSoon();
        return;
      }
      this._keptStale = false;
      this.renderTabs();
    }, 400);
  },

  /* A tap on a heart or the thumb says what it wants — the opposite of what
     the button shows now, pending taps included — and the button shows that
     at once. No tap is ever dropped: one made while an earlier one is still
     on its way changes what is wanted, and sendKept() sends it when that one
     answers. The server is asked for a state, never told to toggle, so a
     request that arrives twice, or late, cannot turn "take it back" round.

     Pending is kept per picture and person, not per button: E's slow answer
     for one photograph used to leave the E button faded and deaf on the next
     one as well. */
  toggleKept(kind, btn) {
    // The picture the finger landed on (see the pointerdown above), if it
    // landed a moment ago; otherwise — a keyboard, say — the one showing.
    const t = this.tapped;
    this.tapped = null;
    const item = t && Date.now() - t.at < 2000 ? t.slide : this.slide;
    if (!item) return;
    const who = btn.dataset.who;
    const k = this.pendKey(kind, item, who);
    const p = this.pending.get(k);
    const want = !(p ? p.want : this.isKept(kind, item, who));
    if (p) p.want = want;
    else this.pending.set(k, { kind, item, who, want, since: Date.now(), busy: false });
    if (this.slide === item) {
      this.paintKept();
      this.bumpTimer();
    }
    // Said now, from what the tap asked, not when the server gets round to
    // answering: two metres away an outline heart does not tell "taken back"
    // from "the tap missed", which is how somebody ends up pressing it four
    // times and believing it is broken.
    const note = this.keptNote(kind, want, item, who);
    this.flashCaption(this.slide === item ? note : `${item.name}: ${note}`, 5000, item, k);
    this.sendKept(k);
  },

  /* Sees one (kind, picture, person) through to what its last tap wanted:
     at most one request out at a time, and another after it if the wish
     changed while it was out. */
  async sendKept(k) {
    const p = this.pending.get(k);
    if (!p || p.busy) return;      // the request already out sends the rest
    p.busy = true;
    const { kind, item, who } = p;
    const key = this.likeKey(item);
    let now = null;
    let err = '';
    let retried = false;
    for (;;) {
      const want = p.want;
      err = '';
      let res = null;
      const ctl = new AbortController();
      const timer = setTimeout(() => ctl.abort(), KEPT_TIMEOUT_MS);
      try {
        res = await (await fetch(`/api/media/${kind === 'disliked' ? 'dislike' : 'like'}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          signal: ctl.signal,
          body: JSON.stringify({ id: item.id, root: item.root, folder: item.folder, name: item.name,
                                 want, ...(who ? { who } : {}) }),
        })).json();
      } catch {
        err = 'the kitchen server could not be reached';
      } finally {
        clearTimeout(timer);
      }
      now = res && (kind === 'disliked' ? res.disliked : res.liked);
      if (typeof now !== 'boolean') {
        err = err || res?.error || 'could not keep that one';
        // Tapped again while the failed one was out: that later wish is the
        // one that matters, and it gets one try of its own rather than being
        // dropped with the failure.
        if (p.want !== want && !retried) {
          retried = true;
          continue;
        }
        break;
      }
      // The answer's item is the picture as the lists now have it — every
      // person's like, not only this one — so a heart taken back by one
      // person leaves the others lit. No item: nobody keeps it any more.
      if (res.item) this.kept(kind).set(key, res.item);
      else this.kept(kind).delete(key);
      this.keptRev[kind] += 1;
      // Done once the lists say what the last tap asked — or if the server
      // answered something else (one older than `want`, which toggles): the
      // server is then the truth, and asking again would only flip it back.
      if (p.want === now || now !== want) break;
    }
    this.pending.delete(k);
    const isHere = () => !!this.slide && this.likeKey(this.slide) === key;
    if (err) {
      // Not waiting any more: the heart drops its ring and shows what this
      // screen last knew while the lists are read, rather than a pending look
      // that invites a tap on a state nobody has confirmed.
      this.paintKept();
      // What happened is not known — a keep can finish after its answer was
      // lost — so ask rather than guess, then say which picture it was. Up or
      // not is asked after the read: the show may have moved during it.
      await this.loadKept(kind);
      if (isHere()) {
        this.flashCaption(err, 5000, item, k);
        this.bumpTimer();      // long enough on screen to be read
      } else this.flashCaption(`${item.name}: ${err}`, 5000);
      return;
    }
    const here = isHere();
    this.paintKept();
    // The note said what was asked; say it again if the lists came out
    // otherwise (another screen's like in between, say) — naming the picture,
    // as the tap did, if it is no longer the one up.
    const note = this.keptNote(kind, now, item, who);
    this.flashCaption(here ? note : `${item.name}: ${note}`, 5000, item, k, true);
    if (!here) return;
    // "Never show this one again" is answered now, not in eight seconds' time.
    // A step, exactly like ›, so it does not stop the show either — and only
    // if it is still the picture up: a late answer used to skip whichever
    // picture had arrived in the meantime.
    // Its note goes with it, naming the picture it was about, rather than
    // sitting under the next one as if that were on the delete list.
    if (kind === 'disliked' && now === true) {
      this.flashCaption(`${item.name} — never shown again, on the delete list`, 5000);
      if (this.mode === 'slideshow') this.nextSlide(true);
    // Anything else leaves the picture up a full interval from the answer, so
    // the heart's new state can be seen and a second tap still lands here.
    } else this.bumpTimer();
  },

  /* Whether the picture on screen has a heart or a thumb waiting for its
     answer. The show waits for it, within HOLD_MAX_MS: an answer arriving
     over the next picture was said over the wrong one, and the tap meant to
     take it back liked the new one instead. */
  holding() {
    // The ✈ chooser holds the picture it was opened over (at most a minute).
    if (this.tgPick && Date.now() - this.tgPick.at < 60000) return true;
    if (!this.slide || !this.pending.size) return false;
    const key = this.likeKey(this.slide);
    const now = Date.now();
    for (const p of this.pending.values()) {
      if (this.likeKey(p.item) === key && now - p.since < HOLD_MAX_MS) return true;
    }
    return false;
  },

  /* One sentence for what a tap did, in the words somebody would use for it.

     The important half is the taking back: "nothing kept" is said out loud,
     because that is the thing the heart cannot show — an outline heart looks
     the same whether the picture was never kept or has just stopped being. If
     somebody else still likes it, that is said too, because then the picture
     really does stay in the Liked tab and the heart alone would be a lie.
     Everybody else's hearts are read as this screen has them, their own
     pending taps included. */
  keptNote(kind, on, item, who) {
    const me = this.people.find((p) => p.id === who);
    if (kind === 'disliked') {
      return on ? 'Never shown again — on the delete list'
        : 'Back in the show — nothing kept';
    }
    if (on) return me ? `Kept for ${me.name}` : 'Kept';
    // "earlier" is nobody's and is taken off with this one (the server does
    // it), so it is never among them.
    const others = this.people.filter((p) => p.id !== who)
      .filter((p) => this.pending.get(this.pendKey('liked', item, p.id))?.want
        ?? this.isKept('liked', item, p.id))
      .map((p) => p.name);
    const took = me ? `${me.name}'s like taken back` : 'Like taken back';
    return others.length
      ? `${took} — still kept for ${others.join(' and ')}`
      : `${took} — nothing kept for this one`;
  },

  /* The panel has no room for a toast, and the caption is the one line on the
     picture that is already words. It says its piece and gives the line back.

     Notes about one picture share the line while they last, one part per
     button (`part`): T then N tapped a second apart used to leave only N's
     words up, and a burst of answers only the last. A note about another
     picture, or about nothing in particular, starts the line afresh.
     `onlyIfShown` updates a part that is still up and never brings one back. */
  flashCaption(text, ms = 3000, item = null, part = null, onlyIfShown = false) {
    const el = this.elSlide.querySelector('.m-cap-note');
    if (!el) return;
    const key = item ? this.likeKey(item) : '';
    const same = !el.hidden && this._note && this._note.key === key && part;
    if (onlyIfShown && !(same && this._note.parts.has(part))) return;
    if (onlyIfShown && this._note.parts.get(part) === text) return;
    if (!same) this._note = { key, parts: new Map() };
    this._note.parts.set(part || '', text);
    el.textContent = [...this._note.parts.values()].join('  ·  ');
    el.hidden = false;
    clearTimeout(this._noteTimer);
    this._noteTimer = setTimeout(() => this.hideNote(), ms);
  },

  hideNote() {
    const el = this.elSlide?.querySelector('.m-cap-note');
    if (el) el.hidden = true;
    clearTimeout(this._noteTimer);
    this._note = null;
  },

  /* The Liked tab has a row of its own above the pictures: All, then each
     person, then Earlier while it has any. A tile wears the initials of the
     people who like it. The ✕ appears only in one person's filter (or
     Earlier's), and it takes back that one like — in All it could not say
     whose like it was dropping. The Disliked tab is one list, so its ✕ is on
     every tile. */
  paintKeptTab(box, kind) {
    const map = this.kept(kind);
    const stamp = kind === 'disliked' ? 'disliked_at' : 'liked_at';
    let items = [...map.values()].sort((a, b) => (b[stamp] || 0) - (a[stamp] || 0));
    let drop = kind === 'disliked' ? '' : null;   // whose like the ✕ takes back
    let filters = '';
    // With nobody configured every like is Earlier's: no row to choose from,
    // and the ✕ on every tile, as the tab always was.
    if (kind === 'liked' && !this.people.length) drop = 'earlier';
    else if (kind === 'liked') {
      const count = (id) => items.filter((i) => this.whoOf(i).includes(id)).length;
      const earlier = count('earlier');
      const opts = [['all', 'All', items.length],
        ...this.people.map((p) => [p.id, p.name, count(p.id)]),
        ...(earlier ? [['earlier', 'Earlier', earlier]] : [])];
      if (!opts.some(([k]) => k === this.keptWho)) this.keptWho = 'all';
      if (opts.length > 1) {
        filters = `<div class="m-who" role="group" aria-label="whose likes">${opts.map(([k, label, n]) =>
          `<button class="m-whob${k === this.keptWho ? ' on' : ''}" data-w="${this.esc(k)}">${
            this.esc(label)} <span class="m-fcount">${n}</span></button>`).join('')}</div>`;
      }
      if (this.keptWho !== 'all') {
        drop = this.keptWho;
        items = items.filter((i) => this.whoOf(i).includes(drop));
      }
    }
    const title = this.elBrowse.querySelector('.m-title');
    if (title) {
      title.textContent = items.length
        ? `${items.length} ${kind === 'disliked' ? 'on the delete list' : 'kept'}` : '';
    }
    const empty = kind === 'disliked'
      ? '<div class="placeholder">Nothing on the delete list.<br>'
        + '<span style="font-size:15px">Tap the thumb down on a photograph in the '
        + 'show: the wall stops showing it, and its NAS path is written to '
        + 'data/disliked.json for deleting later.</span></div>'
      : this.keptWho !== 'all'
        ? `<div class="placeholder">${this.esc(this.people.find((p) => p.id === this.keptWho)?.name
          || 'Nobody')} has not liked anything yet.</div>`
        : '<div class="placeholder">Nothing kept yet.<br>'
          + '<span style="font-size:15px">Tap a heart on a photograph in the show: '
          + 'a copy is saved in data/liked/ and its NAS path and name are written '
          + 'to that person\'s list.</span></div>';
    // The Disliked tab's own row: every copy still on the server, in one go.
    // Offered only by a server that can do it (`droppable`), and asked twice.
    const droppable = kind === 'disliked' ? items.filter((i) => i.droppable).length : 0;
    if (droppable) {
      filters = `<div class="m-who m-dropall-row"><button class="m-whob m-dropall"
        data-n="${droppable}">🗑 Delete all copies <span class="m-fcount">${droppable}</span></button></div>`;
    }
    box.innerHTML = `${filters}${items.length
      ? `<div class="m-grid thumbs">${items.map((i, n) => this.keptTile(i, n, kind, drop)).join('')}</div>`
      : empty}`;
    box.querySelectorAll('.m-whob:not(.m-dropall)').forEach((b) => {
      b.onclick = () => { this.keptWho = b.dataset.w; this.paintKeptTab(box, kind); };
    });
    const all = box.querySelector('.m-dropall');
    if (all) all.onclick = () => this.askDropAll(all);
    box.querySelectorAll('.m-kept').forEach((w) => {
      const item = items[Number(w.dataset.i)];
      w.onclick = (e) => {
        const act = e.target.closest('[data-a]')?.dataset.a;
        if (act === 'drop') return this.dropKept(kind, item, drop);
        if (act === 'tg') return this.askTelegram(w, item);
        if (act === 'tg-to') return this.sendTelegram(w, item, e.target.closest('[data-to]').dataset.to);
        if (act === 'tg-no') return this.cancelDropCopy(w);
        if (act === 'dropcopy') return this.askDropCopy(w);
        if (act === 'dropcopy-yes') return this.dropCopy(item);
        if (act === 'dropcopy-no') return this.cancelDropCopy(w);
        // With the question on the tile, a tap beside its two buttons is a
        // finger that missed them, not a request to open the picture.
        if (w.classList.contains('m-asking')) return undefined;
        return this.openItem(item, kind);
      };
    });
  },

  /* Where a kept picture is, as two short lines under its tile: its own name,
     and the end of its folder's NAS path — as many of the last folders as fit
     a tile, so "…/DCIM/Camera/2026/07" tells this house's four Camera folders
     apart where a path cut short at its end (the share, then "…") would not.
     The whole path is on the picture itself, once it is opened. */
  keptWhere(i) {
    const full = i.path || [i.root, i.folder, i.name].filter(Boolean).join('/');
    const parts = full.slice(0, full.lastIndexOf('/')).split('/').filter(Boolean);
    let tail = parts.pop() || '';
    while (parts.length && tail.length + parts[parts.length - 1].length < 26) {
      tail = `${parts.pop()}/${tail}`;
    }
    return { full, tail: parts.length ? `…/${tail}` : `/${tail}` };
  },

  /* One tile. Matched back to its item by position, not by file name: a clip
     kept by its path has no file, and every such tile used to resolve to the
     first one.

     On the Disliked tab the corner that said ✕ says ↩ now — it puts the
     picture back in the show — because 🗑, which deletes its copy on the
     server, sits on the same tile, and two crosses would be one guess away
     from the wrong one. A picture whose copy was deleted is a tile of words:
     its path, and that the copy is gone. It has no picture to show, and asks
     the server for none, so nothing of it is ever cached there again. */
  keptTile(i, n, kind, drop) {
    const initials = kind === 'liked'
      ? this.people.filter((p) => this.whoOf(i).includes(p.id))
        .map((p) => `<b>${this.esc(p.letter)}</b>`).join('')
      : '';
    const where = this.keptWhere(i);
    const dis = kind === 'disliked';
    const face = i.dropped
      ? `<span class="m-ktxt"><span class="m-ktxt-path">${this.esc(where.full)}</span>
           <span class="m-ktxt-note">copy deleted</span></span>`
      : `${i.thumb_url ? `<img loading="lazy" src="${this.esc(i.thumb_url)}" alt="">` : ''}
         ${i.kind === 'video' ? `<span class="m-play">▶${i.gone ? '✕' : ''}</span>` : ''}
         ${initials ? `<span class="m-lwho" aria-hidden="true">${initials}</span>` : ''}`;
    // A liked photograph that has its copy here can go to somebody's Telegram:
    // ✈ in the upper right (2026-10-12), so the like's ✕ moves to the left.
    // A liked clip too (2026-11-03): the server finds a copy, or the NAS's.
    const tg = kind === 'liked' && (i.kind === 'video' ? !i.gone : i.file) && !i.dropped && this.tg?.configured
      ? '<span class="m-tgsend" data-a="tg" role="button" aria-label="send it to Telegram" '
        + 'title="send it to Telegram">✈</span>'
      : '';
    const back = drop === null ? '' : dis
      ? '<span class="m-unlike m-kbig" data-a="drop" role="button" '
        + 'aria-label="take it off the list and show it again" title="show it again">↩</span>'
      : `<span class="m-unlike${tg ? ' m-left' : ''}" data-a="drop" role="button" `
        + 'aria-label="take this like back">✕</span>';
    const bin = dis && i.droppable
      ? '<span class="m-dropcopy m-kbig" data-a="dropcopy" role="button" '
        + 'aria-label="delete the copy on the server" title="Delete copy">🗑</span>'
      : '';
    return `<div class="m-kept${i.dropped ? ' m-dropped' : ''}" data-i="${n}">
        <button class="m-thumb${i.gone ? ' m-gone' : ''}${i.dropped ? ' m-textile' : ''}">
          ${face}${back}${bin}${tg}
        </button>
        <span class="m-kpath" title="${this.esc(where.full)}">
          <b>${this.esc(i.name || '')}</b><span>${this.esc(where.tail)}</span></span>
      </div>`;
  },

  /* ✈ on a liked photograph: who to send it to, on the tile itself — a
     button per linked person and Cancel — then what became of it, for a few
     seconds. Nobody linked: it says where Link is. The question shares the
     🗑's overlay and its clearing (cancelDropCopy). */
  askTelegram(tile, item) {
    const chats = this.tg?.chats || [];
    this.cancelDropCopy(this.asking);
    tile.classList.add('m-asking');
    tile.querySelector('.m-thumb').insertAdjacentHTML('beforeend', `
      <span class="m-confirm m-tgask">
        <span>${chats.length ? `Send this ${item.kind === 'video' ? 'video' : 'photo'} to` : 'Nobody has linked their Telegram yet: House → Automation → Telegram.'}</span>
        <span class="m-cbtns">${chats.map((c) => `<span class="m-cyes" data-a="tg-to" data-to="${this.esc(c.key)}"
          role="button">✈ ${this.esc(c.name)}</span>`).join('')}
          <span class="m-cno" data-a="tg-no" role="button">${chats.length ? 'Cancel' : 'OK'}</span>
        </span>
      </span>`);
    this.asking = tile;
    clearTimeout(this._askTimer);
    this._askTimer = setTimeout(() => this.cancelDropCopy(tile), 8000);
  },

  async sendTelegram(tile, item, to) {
    clearTimeout(this._askTimer);
    const box = tile.querySelector('.m-tgask');
    const say = (text) => { if (box) box.innerHTML = `<span>${this.esc(text)}</span>`; };
    say('Sending…');
    let ans = null;
    let ok = false;
    try {
      const r = await fetch('/api/telegram/send-liked', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key: item.key, to }),
      });
      ok = r.ok;
      ans = await r.json().catch(() => null);
    } catch { /* said below */ }
    say(ok && ans?.queued ? `${ans.nas ? 'Copying it off the NAS' : 'A big video: making it smaller'}, then it goes to ${(ans.to || []).join(', ')} in a few minutes`
      : ok ? `Sent to ${(ans?.sent || []).join(', ')} ✓`
      : ans?.error || ans?.failed?.[0]?.why || 'Telegram could not be reached');
    this._askTimer = setTimeout(() => this.cancelDropCopy(tile), ok && !ans?.queued ? 2500 : 6000);
  },

  /* 🗑 asks first, on the tile itself: the second tap is on words that say
     what is about to happen, and the question takes itself back after a few
     seconds, so a finger resting on a tile can never delete anything. */
  askDropCopy(tile) {
    this.cancelDropCopy(this.asking);
    tile.classList.add('m-asking');
    tile.querySelector('.m-thumb').insertAdjacentHTML('beforeend', `
      <span class="m-confirm">
        <span>Delete the copy on the server? The NAS keeps the photo.</span>
        <span class="m-cbtns">
          <span class="m-cyes" data-a="dropcopy-yes" role="button">Delete</span>
          <span class="m-cno" data-a="dropcopy-no" role="button">Keep</span>
        </span>
      </span>`);
    this.asking = tile;
    clearTimeout(this._askTimer);
    this._askTimer = setTimeout(() => this.cancelDropCopy(tile), 5000);
  },

  cancelDropCopy(tile) {
    if (!tile) return;
    tile.classList.remove('m-asking');
    tile.querySelector('.m-confirm')?.remove();
    if (this.asking === tile) this.asking = null;
  },

  /* The row stays — that is what keeps the picture off the wall — and the
     answer is the row as it now is: a text tile. POST, never DELETE: a server
     older than this answers 405 rather than taking the picture off the list. */
  async dropCopy(item) {
    clearTimeout(this._askTimer);
    this.asking = null;
    let res;
    try {
      const r = await fetch(`/api/media/disliked/${encodeURIComponent(item.key || '')}/drop-copy`,
        { method: 'POST' });
      res = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(res.error || r.status);
    } catch (e) {
      this.flashSaved(`Not deleted — ${res?.error || e.message || 'server unreachable'}`, 4000);
      this.renderTabs();
      return;
    }
    if (res.item) this.disliked.set(this.likeKey(item), res.item);
    this.keptRev.disliked += 1;
    this.flashSaved(`Copy deleted${res.freed_bytes ? ` — ${this.mb(res.freed_bytes)} freed` : ''}`, 4000);
    this.renderTabs();
  },

  askDropAll(btn) {
    const n = Number(btn.dataset.n) || 0;
    if (!btn.classList.contains('asking')) {
      btn.classList.add('asking');
      btn.innerHTML = `Delete ${n} ${n === 1 ? 'copy' : 'copies'} on the server? `
        + 'The NAS keeps the photos. <b>Tap again</b>';
      clearTimeout(this._askAllTimer);
      this._askAllTimer = setTimeout(() => this.renderTabs(), 5000);
      return;
    }
    clearTimeout(this._askAllTimer);
    this.dropAllCopies();
  },

  async dropAllCopies() {
    let res;
    try {
      const r = await fetch('/api/media/disliked/drop-copies', { method: 'POST' });
      res = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(res.error || r.status);
    } catch (e) {
      this.flashSaved(`Not deleted — ${res?.error || e.message || 'server unreachable'}`, 4000);
      this.renderTabs();
      return;
    }
    this.flashSaved(`${res.dropped} ${res.dropped === 1 ? 'copy' : 'copies'} deleted`
      + `${res.freed_bytes ? ` — ${this.mb(res.freed_bytes)} freed` : ''}`, 4000);
    await this.loadKept('disliked', true);
  },

  mb(bytes) {
    return bytes >= 1e6 ? `${(bytes / 1e6).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1e3))} kB`;
  },

  /* By key, which every row has, rather than by file name, which a clip kept
     by its path does not. The answer is what is left of the picture: another
     person's like keeps it on the tab, one initial fewer. */
  async dropKept(kind, item, who) {
    const key = this.likeKey(item);
    const q = kind === 'liked' ? `?who=${encodeURIComponent(who)}` : '';
    let res;
    try {
      const r = await fetch(`/api/media/${kind}/${encodeURIComponent(item.key || '')}${q}`,
        { method: 'DELETE' });
      res = await r.json();
      if (!r.ok) throw new Error(res.error || r.status);
    } catch {
      this.flashSaved(`Not removed — ${res?.error || 'server unreachable'}`);
      return;
    }
    if (res.item) this.kept(kind).set(key, res.item); else this.kept(kind).delete(key);
    this.keptRev[kind] += 1;
    this.paintKept();
    this.renderTabs();
  },
  /* ---------------- slideshow options (the gear) ----------------
     Every row is one tap: it sets the value and saves it, so there is no Save
     button to forget on a wall screen nobody sits at. Since 2026-10-22 they
     are the settings window kit's rows (app.css, "the in-panel settings on
     the kit"): a bar of choices (`none`: the option that is a "none", drawn
     as one), or a switch for the two that are on or off (`toggle`), in three
     cards by `group` — on screen, what plays, and the batch that plays while
     the NAS sleeps — with the kept files' paths under them. */
  settingRows() {
    return [
      { key: 'interval_s', label: 'Time on screen', hint: 'how long each picture stays up', group: 'screen',
        options: [[3, '3s'], [5, '5s'], [10, '10s'], [15, '15s'], [20, '20s'],
                  [30, '30s'], [60, '1 min'], [300, '5 min']] },
      { key: 'order', label: 'Order', group: 'plays',
        options: [['shuffle', 'Shuffle'], ['newest', 'Newest first'], ['oldest', 'Oldest first']] },
      { key: 'recent_ratio', label: 'Favour recent photos',
        hint: 'how often shuffle reaches for the last three months',
        when: (s) => s.order === 'shuffle', group: 'plays', none: 0,
        options: [[0, 'Never'], [0.3, 'Sometimes'], [0.6, 'Often'], [1, 'Always']] },
      { key: 'on_this_day', label: 'On this day',
        hint: 'photographs taken on today\'s date in earlier years, each once a day',
        when: (s) => s.order === 'shuffle', group: 'plays', none: 0,
        options: [[0, 'Off'], [0.1, 'Now and then'], [0.25, 'Often'], [0.5, 'Mostly']] },
      { key: 'fit', label: 'Framing', group: 'screen',
        options: [['cover', 'Fill the panel'], ['contain', 'Show the whole photo']] },
      { key: 'transition_s', label: 'Crossfade', group: 'screen', none: 0,
        options: [[0, 'None'], [0.5, 'Quick'], [1.2, 'Gentle'], [3, 'Slow']] },
      { key: 'include_videos', label: 'Video clips', group: 'plays', toggle: true,
        // A cached batch is photographs: a few hundred clips would be tens of
        // gigabytes. Saying so here is the only place it can be noticed.
        hint: (s) => (s.source === 'cache'
          ? 'clips are cached too, up to the budget set below'
          : 'clips play from the NAS as they come round'),
        options: [[false, 'Photos only'], [true, 'Include videos']] },
      { key: 'liked_mix', label: 'Liked pictures', group: 'plays',
        // True of photographs only now: a liked clip is kept as its NAS path,
        // not copied, so "Only liked" skips the clips until the NAS is back.
        hint: 'only liked plays the photographs copied to this server, so it keeps going '
          + 'with the NAS asleep — liked clips play only while the NAS is awake',
        options: MIX_LEVELS },
      { key: 'show_caption', label: 'Caption', group: 'screen', toggle: true,
        hint: 'where it was taken, when the photograph knows; the file name, and where it sits on the NAS',
        options: [[false, 'Hidden'], [true, 'Place, name and path']] },
      { key: 'use_chosen', label: 'Folders', group: 'plays',
        options: [[true, 'Chosen folders'], [false, 'Whole library']] },
      { key: 'source', label: 'Pictures come from', group: 'nas',
        hint: 'cached keeps the show running while the NAS sleeps',
        options: [['cache', 'NAS cache'], ['live', 'NAS live']] },
      { key: 'cache_size', label: 'Pictures per batch', group: 'nas', none: 0,
        hint: 'downloaded together, then served from this server',
        options: [[0, 'Off'], [200, '200'], [350, '350'], [500, '500'],
                  [1000, '1000'], [2000, '2000'], [3000, '3000']] },
      // Clips are counted in bytes, not in files: two hundred photographs are
      // a predictable eighty megabytes and two hundred clips are anything from
      // one gigabyte to forty. A budget is the only number that means the same
      // thing every night. Anything on its own larger than the whole budget is
      // left on the NAS rather than eating the batch.
      { key: 'video_cache_mb', label: 'Clips per batch',
        hint: (s) => (s.include_videos
          ? 'a size to fill, not a count — one clip bigger than this is skipped'
          : 'switch Video clips on above to cache any'),
        when: (s) => s.cache_size > 0, group: 'nas',
        // Alex, 2026-10-30: "adjustable … 1GB + and -", not fixed sizes.
        stepper: { steps: [-1024, 1024], snap: 1024, min: 0, max: 20480,
          word: (d) => `${d < 0 ? '−' : '+'}1 GB`, fmt: (v) => (!v ? 'Off' : gb(v)) } },
      // The largest one clip that is copied (2026-10-30, Alex's to choose,
      // then: "manually adjustable, with + and - buttons, not predefined
      // values"): a bigger one stays on the NAS — it still plays with the NAS
      // live. 0 is no limit; media.py holds it to 0–20480.
      { key: 'video_max_mb', label: 'Largest clip',
        hint: (s) => (s.include_videos
          ? 'a clip bigger than this is not cached — it stays on the NAS; 0 is no limit'
          : 'switch Video clips on above to cache any'),
        when: (s) => s.cache_size > 0 && s.video_cache_mb > 0, group: 'nas',
        // ...and in whole gigabytes too, the same day.
        stepper: { steps: [-1024, 1024], snap: 1024, min: 0, max: 20480,
          word: (d) => `${d < 0 ? '−' : '+'}1 GB`, fmt: (v) => (!v ? 'No limit' : gb(v)) } },
      { key: 'cache_refresh_h', label: 'New batch',
        hint: 'the old batch is deleted when the new one lands',
        when: (s) => s.cache_size > 0, group: 'nas',
        options: [[6, 'Every 6h'], [12, 'Twice a day'], [24, 'Daily'], [72, 'Every 3 days']] },
    ];
  },

  openSettings() {
    this.setMode('settings');
    this.elSlide.hidden = true;
    this.elView.hidden = true;
    this.elBrowse.hidden = false;
    // The kit's header line (the way out in its top right corner, as every
    // settings window has it), then the cards in a column of their own. The
    // cached batch's row is drawn into its card by renderCacheBox(), which the
    // photo_cache updates call on their own; the paths into theirs by
    // renderWhere().
    this.elBrowse.innerHTML = `
      <div class="m-bar pset-head">
        <span class="sheet-icon" aria-hidden="true">🖼️</span>
        <div class="sheet-title">
          <h2 class="m-title">Slideshow options</h2>
          <span class="sheet-status m-now"></span>
        </div>
        <span class="spacer"></span>
        <span class="m-saved" hidden>Saved</span>
        <button class="m-back">Back</button>
      </div>
      <div class="pset m-setw">
        <div class="m-opts"></div>
        <div class="m-where"></div>
      </div>`;
    this.elBrowse.scrollTop = 0;
    this.elBrowse.querySelector('.m-back').onclick = () => this.openSlideshow();
    this.renderSettings();
    this.loadCacheStatus();
    this.loadWhere();
  },

  /* Where the hearts and the thumbs down actually put things.
     Asked of the server rather than written here: the container sees one path
     and the machine serving it sees another, and only the server knows both.
     A backend older than the endpoint sends no `paths` at all, and then this
     block simply does not appear — which is right, because a path this page
     invented would be worse than no path. */
  async loadWhere() {
    try {
      const res = await (await fetch('/api/media/slideshow/settings')).json();
      this.paths = res.paths || null;
    } catch {
      this.paths = null;
    }
    this.renderWhere();
  },

  renderWhere() {
    const box = this.elBrowse?.querySelector('.m-where');
    if (!box) return;
    const p = this.paths;
    if (!p || !p.liked_json) { box.innerHTML = ''; return; }
    // A path breaks after a slash, never inside a name: on a phone
    // "liked-alex.json" came out as "liked-alex.js" over "on", and then as
    // "liked-" over "alex.json". So each name is one unbreakable piece.
    const path = (o) => String(o.host || o.container).split('/')
      .map((seg) => (seg ? `<span class="m-wseg">${this.esc(seg)}</span>` : ''))
      .join('/<wbr>');
    const row = (what, o) => `
      <div class="m-wrow"><span class="m-wwhat">${what}</span>
        <code class="m-wpath">${path(o)}</code></div>`;
    box.innerHTML = this.ctx.sheetkit.sec('Where the kept files are', `
        <p class="sheet-note m-ohint">on ${this.esc(location.hostname)} — the copies themselves,
          and the lists naming every one with its whole path on the NAS</p>
        <div class="m-wpaths">
          ${row('Liked copies', p.liked_files)}
          ${(p.liked_people || []).map((o) => row(`Liked by ${this.esc(o.name)}`, o)).join('')}
          ${row(p.liked_people?.length ? 'Earlier likes' : 'Liked list', p.liked_json)}
          ${row('Disliked copies', p.disliked_files)}
          ${row('Disliked list', p.disliked_json)}
        </div>`, { cls: 'm-opt' });
  },

  /* The gear is the only place the cache is visible, so it has to answer
     "is there one, how old is it, and can I have a new one now?" without
     anyone having to reason about the settings above it. */
  async loadCacheStatus() {
    try {
      this.cache = await (await fetch('/api/media/cache/status')).json();
    } catch { this.cache = null; }
    this.renderCacheBox();
    this.showCount();
  },

  cacheLine() {
    const c = this.cache;
    if (!c) return 'Cache status unavailable.';
    if (c.state === 'off') return 'Cache is off — every picture is read from the NAS as it appears.';
    if (c.state === 'filling') {
      // Two phases, two units. Pictures are files against a target and clips
      // are megabytes against a budget, so one progress line that only knew
      // about files sat frozen at "71 of 500" for the whole of the second half.
      if (c.phase === 'clips') {
        const mb = (b) => Math.round((b || 0) / 1048576);
        return `Pictures done. Downloading clips… ${mb(c.clip_bytes)}`
          + ` of ${mb(c.clip_budget)} MB${c.clips ? `, ${c.clips} so far` : ''}.`;
      }
      return `Downloading pictures… ${c.photos ?? c.count} of ${c.target}.`;
    }
    if (c.state === 'failed') return 'The last batch could not be built. Try again once the NAS is awake.';
    const n = c.available ?? c.count;
    if (!n) return this.nas === 'awake'
      ? 'No batch yet — one is built shortly.'
      : 'No batch yet — it is built when the NAS next wakes.';
    const when = new Date((c.built_at || 0) * 1000);
    const today = when.toDateString() === new Date().toDateString();
    // Clips are counted apart from the pictures, and in megabytes as well as
    // in files: the budget above is set in megabytes, so this is the line that
    // has to say whether it was spent.
    const clips = c.clips
      ? ` and ${c.clips} clip${c.clips === 1 ? '' : 's'}`
        + `${c.clip_bytes ? ` (${Math.round(c.clip_bytes / 1048576)} MB)` : ''}`
      : '';
    return `${n} picture${n === 1 ? '' : 's'}${clips} ready, fetched ${today
      ? `today at ${when.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}`
      : when.toLocaleDateString('en-GB', { day: 'numeric', month: 'long' })}.`;
  },

  renderCacheBox() {
    const box = this.elBrowse?.querySelector('.m-cache');
    this.renderHead();
    if (!box) return;   // the gear screen is not open
    const busy = this.cache?.state === 'filling';
    const failed = this.cache?.state === 'failed';
    // An action, not a setting: a plain button beside its status line, the
    // last row of the card whose settings build the batch.
    box.innerHTML = `
      <span class="ls-label m-olabel">Cached batch
        <span class="sheet-line${failed ? ' sheet-warn' : ''} m-ohint">${this.esc(this.cacheLine())}</span></span>
      <span class="ls-set m-oset">
        <button class="ls-btn m-oval m-refill"${busy ? ' disabled' : ''}>${busy ? 'Downloading…' : 'Fetch now'}</button>
      </span>`;
    box.querySelector('.m-refill').onclick = async () => {
      const btn = box.querySelector('.m-refill');
      btn.disabled = true;
      btn.textContent = 'Starting…';
      let res = {};
      try {
        res = await (await fetch('/api/media/cache/refill', { method: 'POST' })).json();
      } catch { res = { status: 'unreachable' }; }
      // Progress arrives over the bus from here on; only a refusal needs saying.
      if (res.status === 'nas_sleeping') this.flashSaved('NAS is asleep');
      else if (res.status === 'unreachable') this.flashSaved('Server unreachable');
      this.loadCacheStatus();
    };
  },

  /* The label a setting's value has among its options ("20s", "Shuffle"). */
  optLabel(key, s = this.settings) {
    const row = this.settingRows().find((r) => r.key === key);
    if (row?.stepper) return row.stepper.fmt(s[key]);
    const hit = row?.options?.find(([v]) => v === s[key]);
    return hit ? hit[1] : String(s[key] ?? '');
  },

  /* Each card's live state, beside its heading: what it is set to now. */
  setNotes(s) {
    const lab = (k) => this.optLabel(k, s);
    return {
      screen: [`${lab('interval_s')} each`, (s.fit || 'contain') === 'cover' ? 'fills the panel' : 'the whole photo',
        s.show_caption ? 'caption' : 'no caption'].join(' · '),
      plays: [lab('order'), lab('use_chosen').toLowerCase(),
        s.include_videos ? 'with clips' : 'photos only'].filter(Boolean).join(' · '),
      nas: s.cache_size > 0
        ? `${lab('source')} · ${s.cache_size} a batch · ${lab('cache_refresh_h').toLowerCase()}`
        : `${lab('source')} · cache off`,
    };
  },

  /* The line under the title: how the show runs, and the batch behind it —
     "live" while a batch downloads, "warn" when the last one failed. */
  renderHead() {
    const el = this.elBrowse?.querySelector('.m-now');
    if (!el || !this.ctx.sheetkit) return;
    const s = this.settings;
    const c = this.cache;
    let tail = '';
    let tone = 'ok';
    if (!c || !(s.cache_size > 0)) tail = '';
    else if (c.state === 'filling') { tail = 'downloading a batch'; tone = 'live'; }
    else if (c.state === 'failed') { tail = 'the last batch could not be built'; tone = 'warn'; }
    else if (c.state !== 'off') {
      const n = c.available ?? c.count;
      tail = n ? `${n} picture${n === 1 ? '' : 's'} cached` : 'no batch yet';
    }
    this.ctx.sheetkit.status(el, `<b>${this.esc(this.optLabel('order'))}</b> · ${
      this.esc(this.optLabel('interval_s'))} each${tail ? ` · ${this.esc(tail)}` : ''}`, tone);
  },

  renderSettings() {
    const s = this.settings;
    const box = this.elBrowse.querySelector('.m-opts');
    if (!box) return;
    const kit = this.ctx.sheetkit;
    const enc = (v) => encodeURIComponent(JSON.stringify(v));
    const rows = this.settingRows().filter((r) => !r.when || r.when(s));
    // The buttons stay the direct children of the element carrying data-key:
    // setSetting() is handed b.parentElement.dataset.key.
    const row = (r) => {
      // A hint may depend on the other settings — "video clips" reads
      // differently once the pictures are coming from a cached batch.
      const hint = typeof r.hint === 'function' ? r.hint(s) : r.hint;
      const word = (want) => r.options.find(([v]) => v === want)[1];
      const st = r.stepper;
      const set = st
        // − value +, each tap a step from where it is (the kit's stepper).
        ? `<span class="ls-set sheet-step m-ostep" data-key="${r.key}">${st.steps.filter((d) => d < 0).map((d) => `
            <button class="ls-btn sheet-txt" data-d="${d}" aria-label="less">${st.word ? st.word(d) : `−${-d}`}</button>`).join('')}
            <b class="sheet-val">${this.esc(st.fmt(s[r.key]))}</b>${st.steps.filter((d) => d > 0).map((d) => `
            <button class="ls-btn sheet-txt" data-d="${d}" aria-label="more">${st.word ? st.word(d) : `+${d}`}</button>`).join('')}</span>`
        : r.toggle
        // On or off: one switch saying its state; a tap makes it the other.
        ? `<span class="ls-set m-oset" data-key="${r.key}">${kit.toggle(!!s[r.key],
          `data-v="${enc(!s[r.key])}"`, { words: [word(true), word(false)], cls: 'm-oval' })}</span>`
        : `<span class="ls-set sheet-seg m-oset" data-key="${r.key}">${r.options.map(([v, label]) => `
            <button class="ls-btn m-oval${v === s[r.key] ? ' on' : ''}${'none' in r && v === r.none ? ' sheet-none' : ''}"
              data-v="${enc(v)}" aria-pressed="${v === s[r.key]}">${label}</button>`).join('')}</span>`;
      return `
        <div class="ls-row m-opt">
          <span class="ls-label m-olabel">${r.label}${hint ? `<span class="db-hint m-ohint">${this.esc(hint)}</span>` : ''}</span>
          ${set}
        </div>`;
    };
    const group = (g) => rows.filter((r) => r.group === g).map(row).join('');
    const n = this.setNotes(s);
    box.innerHTML = `
      ${kit.sec('On screen', group('screen'), { note: n.screen })}
      ${kit.sec('What plays', group('plays'), { note: n.plays })}
      ${kit.sec('While the NAS sleeps', `${group('nas')}
        <div class="ls-row m-opt m-cache"></div>`, { note: n.nas })}`;
    box.querySelectorAll('.m-ostep[data-key] > [data-d]').forEach((b) => {
      b.onclick = () => {
        const key = b.parentElement.dataset.key;
        const st = this.settingRows().find((r) => r.key === key)?.stepper;
        if (!st) return;
        let v = (Number(this.settings[key]) || 0) + Number(b.dataset.d);
        // A value off the grid (an older fixed choice, 250 MB) lands on it.
        if (st.snap) v = Math.round(v / st.snap) * st.snap;
        v = Math.min(st.max, Math.max(st.min, v));
        if (v !== this.settings[key]) this.setSetting(key, v);
      };
    });
    box.querySelectorAll('.m-oset[data-key] > .m-oval').forEach((b) => {
      b.onclick = () => this.setSetting(b.parentElement.dataset.key,
                                        JSON.parse(decodeURIComponent(b.dataset.v)));
    });
    // The batch's own row, in the card above; its status line follows the
    // photo_cache updates by itself (renderCacheBox), and so does the header.
    this.renderCacheBox();
  },

  async setSetting(key, value) {
    this.settings = { ...this.settings, [key]: value };
    this.renderSettings();   // 'Order' can show or hide the recency row
    this.applySettings();
    if (key === 'interval_s') this.restart();
    try {
      const saved = await (await fetch('/api/media/slideshow/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(this.settings),
      })).json();
      this.settings = { ...this.settings, ...saved };
      this.flashSaved();
    } catch {
      this.flashSaved('Not saved — server unreachable');
    }
  },

  flashSaved(text = 'Saved', ms = 1600) {
    const el = this.elBrowse.querySelector('.m-saved');
    if (!el) return;
    el.textContent = text;
    el.hidden = false;
    clearTimeout(this._savedTimer);
    this._savedTimer = setTimeout(() => { el.hidden = true; }, ms);
  },

  /* ---------------- single item ---------------- */
  /* `kept` names the tab a kept picture was opened from. Those carry a bar
     along the foot like the slideshow's caption: where it was taken when the
     photograph knows, the library and the whole path on the NAS, selectable
     with one tap — the Liked and Disliked tabs are where somebody goes to
     find the file itself. */
  async openItem(item, kept = null) {
    if (!item) return;
    this.setMode('view');
    this.elBrowse.hidden = true;
    this.elView.hidden = false;
    const close = '<button class="m-back m-float">Back</button>';
    const where = kept ? this.keptWhere(item) : null;
    const cap = where ? `<div class="m-kcap">
        ${item.place ? `<span class="m-kcap-place">${this.esc(item.place)}</span>` : ''}
        <span class="m-kcap-lib">${this.esc(item.library || item.root || '')}</span>
        <span class="m-kcap-path">${this.esc(where.full)}</span></div>` : '';
    const put = (html) => { this.elView.innerHTML = `${close}${html}${cap}`; };
    // The bar takes its own room under the picture rather than lying over it:
    // over a clip it would cover the player's own controls.
    this.elView.classList.toggle('m-kview', !!cap);

    if (item.dropped) {
      // Its copy was deleted from the server, and nothing of it is fetched
      // again: the words are the whole of what is left here.
      put(`<div class="placeholder m-dropview"><span class="big">🗑</span>
        <b>${this.esc(item.name || '')}</b>
        The copy on the server was deleted. The NAS keeps the photograph,
        and the wall goes on skipping it.</div>`);
    } else if (!item.url) {
      // Kept by its path, and the path is no longer in the library: moved or
      // deleted on the NAS. The poster is all that is left of it.
      put(`<div class="placeholder">
        <span class="big">🎞</span>This is no longer on the NAS — it was moved or deleted there</div>`);
    } else if (item.kind === 'photo') {
      put(`<img class="m-full" src="${item.url}">`);
    } else {
      put('<div class="placeholder">preparing video…</div>');
      const r = await fetch(item.url, { method: 'HEAD' }).catch(() => null);
      if (!r || r.status === 415) {
        put(`<div class="placeholder">
          <span class="big">🎞</span>This video can't play on the wall screen</div>`);
      } else if (r.status === 202) {
        put(`<div class="placeholder">
          <span class="big">⏳</span>Converting this clip… it will play in a moment</div>`);
        setTimeout(() => { if (this.mode === 'view') this.openItem(item, kept); }, 4000);
      } else if (r.status === 503) {
        put('<div class="placeholder"><span class="big">🌙</span>NAS is sleeping</div>');
      } else {
        put(`<video class="m-full" src="${item.url}" controls autoplay playsinline></video>`);
      }
    }
    this.elView.querySelector('.m-back').onclick = () => {
      const v = this.elView.querySelector('video');
      if (v) v.pause();
      this.elView.hidden = true;
      this.elBrowse.hidden = false;
      this.setMode('browse');
      if (this._keptStale) {
        this._keptStale = false;
        this.renderTabs();
      }
    };
  },

  onHide() {
    this.live = false;
    clearInterval(this.timer);
    this.timer = null;
    // Nobody is looking: a clip decoding behind a Cooking preset is the same
    // waste the timer was stopped for.
    if (this.clip) this.endClip(false);
  },
  onShow() { this.live = true; if (this.mode === 'slideshow') this.restart(); },
};
