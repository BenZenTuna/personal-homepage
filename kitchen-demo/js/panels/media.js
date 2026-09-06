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
// The heart on the picture keeps it: the server copies the original into
// data/liked/ under its own name, and the Liked tab is that folder. A liked
// photograph is a file, so it survives the NAS sleeping, the nightly re-index,
// and the folder being moved out from under it.
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

const HISTORY_MAX = 40;   // photographs kept for ‹; a wall screen runs for weeks
// A wall screen that has been paused is a wall screen showing one photograph
// for the rest of the week. Somebody stopped on a picture, looked at it, and
// walked off; ten minutes later the kitchen wants its slideshow back.
const AUTO_RESUME_MS = 10 * 60 * 1000;
// How long the button stays up after a tap while the show is running. Long
// enough to move a finger to it, short enough not to sit on the photograph.
const BIG_SHOW_MS = 5000;

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
const ICON_HEART = '<svg class="m-gl m-hrt" viewBox="0 0 24 24" aria-hidden="true">'
  + '<path d="M12 20.2 4.6 13a4.6 4.6 0 0 1 6.5-6.5l.9.9.9-.9A4.6 4.6 0 1 1 19.4 13Z"/></svg>';

export default {
  id: 'media',
  title: 'Photos',
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
    this.liked = new Map();  // photographs kept, by root/folder/name
    this.filter = '';

    body.innerHTML = `
      <div class="m-slideshow"><img class="m-img a"><img class="m-img b">
        <div class="m-caption">
          <span class="m-cap-name"></span>
          <span class="m-cap-path"></span>
          <span class="m-cap-note" hidden></span>
        </div>
        <div class="m-paused" hidden>Paused</div>
        <button class="m-big" hidden aria-label="pause">${ICON_PAUSE}</button>
        <div class="m-controls">
          <button class="m-ctl m-like" aria-label="keep this photograph">${ICON_HEART}</button>
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
    this.elSlide.querySelector('.m-like').onclick = () => this.toggleLike();
    this.elSlide.querySelector('.m-prev').onclick = () => this.prevSlide();
    this.elSlide.querySelector('.m-next').onclick = () => this.nextSlide(true);
    this.elSlide.querySelector('.m-big').onclick = () => this.setPaused(!this.paused);
    this.paintControls();

    ctx.bus.on('nas_status', (s) => {
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
      this.cache = { ...this.cache, ...c, available: c.count };
      this.showCount();
      this.renderCacheBox();
    });
    // Another screen changed the settings — follow along without a reload.
    ctx.bus.on('slideshow_settings', (cfg) => {
      this.settings = { ...this.settings, ...cfg };
      this.applySettings();
      this.restart();
    });

    // One button, but it always says where it goes: "Browse" while the show is
    // running, "Slideshow" once you have left it. Nothing toggles silently.
    this.browseBtn = ctx.addHeaderButton(this.id, 'Browse', () =>
      this.mode === 'slideshow' ? this.openBrowse() : this.openSlideshow());
    this.setMode('slideshow');
    // Choose is the same tree, opened on the folders already ticked — the two
    // used to be two screens onto one list, which is why one of them could
    // quietly hide the other's folders.
    ctx.addHeaderButton(this.id, 'Choose', () => this.openBrowse('chosen'));
    const gear = ctx.addHeaderButton(this.id, '⚙', () => this.openSettings());
    gear.className = 'gear';
    gear.title = 'slideshow options';
    this.showCount();
    this.applySettings();
    this.loadLiked();
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
    if (!this.live || this.paused) return;
    const every = (this.settings.interval_s || 10) * 1000;
    this.timer = setInterval(() => { if (this.mode === 'slideshow') this.nextSlide(); }, every);
  },

  setPaused(paused) {
    this.paused = paused;
    this.bumpTimer();          // stops it when paused, restarts it when not

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
    this.elSlide.querySelector('.m-big').hidden = false;
    if (!this.paused) {
      this.bigTimer = setTimeout(() => {
        const b = this.elSlide.querySelector('.m-big');
        if (!this.paused) b.hidden = true;
      }, BIG_SHOW_MS);
    }
    this.paintControls();
  },

  paintControls() {
    const big = this.elSlide.querySelector('.m-big');
    big.innerHTML = this.paused ? ICON_PLAY : ICON_PAUSE;
    big.setAttribute('aria-label', this.paused ? 'carry on' : 'pause');
    big.classList.toggle('is-play', this.paused);
    this.elSlide.querySelector('.m-paused').hidden = !this.paused;
    this.elSlide.classList.toggle('m-is-paused', this.paused);
    // Nothing has been shown before the first one: a ‹ that does nothing when
    // pressed teaches people to stop pressing the row.
    this.elSlide.querySelector('.m-prev').disabled = this.histAt <= 0;
  },

  /* Stepping by hand pauses. Somebody walking the show back to a photograph is
     not asking for it to slide on ten seconds later, and the alternative — a
     tap that moves and then keeps moving — is why the ‹ was unusable. */
  prevSlide() {
    if (this.histAt <= 0) return;
    this.setPaused(true);
    this.histAt -= 1;
    this.showItem(this.history[this.histAt]);
  },

  async nextSlide(manual) {
    // Nobody is looking: another browser tab, or a minimised window. Asking
    // the server for a picture here is a read off the NAS for no viewer.
    if (document.hidden) return;
    if (manual) this.setPaused(true);

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
    back.src = item.url;
    this.slide = item;
    this.paintControls();
    this.paintLike();
  },

  /* Which photograph this is, said the way you would have to say it to go and
     find the file: its own name on top, and under it the whole path on the NAS
     — the share, not the container's mount point and not the last segment of
     the folder. "Camera / 2026 09" is four folders on one NAS and only the
     whole path tells them apart, which is the entire reason the line is
     there. */
  setCaption(item) {
    const nameEl = this.caption.querySelector('.m-cap-name');
    const pathEl = this.caption.querySelector('.m-cap-path');
    if (!item) {
      nameEl.textContent = '';
      pathEl.textContent = '';
      return;
    }
    const year = item.mtime ? new Date(item.mtime * 1000).getFullYear() : '';
    nameEl.textContent = [item.name, year].filter(Boolean).join('  ·  ');
    const dir = item.path
      ? item.path.slice(0, item.path.lastIndexOf('/'))
      : [item.root, item.folder].filter(Boolean).join('/');
    pathEl.textContent = [item.library || item.root, dir].filter(Boolean).join('  ·  ');
    pathEl.title = item.path || dir;
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
        && this.tab !== 'chosen' && this.tab !== 'liked') {
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
            ['chosen', 'Chosen'], ['liked', 'Liked']];
  },

  /* How many folders the library actually holds, not how many rows the tree
     happens to be showing — a tab reading "Family video 0" because that
     library keeps its clips loose at the top level was simply wrong. */
  tabCount(k) {
    if (k === 'chosen') return this.picked.size;
    if (k === 'liked') return this.liked.size;
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
    this.renderTabs();
  },

  renderTabs() {
    const bar = this.elBrowse.querySelector('.m-tabs');
    if (!bar) return;
    bar.innerHTML = this.tabs().map(([k, label]) =>
      `<button class="m-tab${this.tab === k ? ' on' : ''}" data-k="${encodeURIComponent(k)}">
         ${this.esc(label)} <span class="m-fcount">${this.tabCount(k)}</span></button>`).join('');
    bar.querySelectorAll('.m-tab').forEach((b) => {
      b.onclick = () => { this.tab = decodeURIComponent(b.dataset.k); this.renderTabs(); };
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
    if (this.tab === 'liked') return this.paintLikedTab(box);

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
      ? `${this.liked.size} photograph${this.liked.size === 1 ? '' : 's'} kept — tap ♥ on the wall to add one.`
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

  /* ---------------- liked photographs ----------------
     A copy on this server's own disk, under the picture's own name. The NAS
     can sleep, be re-indexed, or have the folder moved out from under it; a
     liked photograph is a file and stays one. */
  likeKey(item) {
    return item ? `${item.root}\u0000${item.folder || ''}/${item.name}` : '';
  },

  async loadLiked() {
    try {
      const data = await (await fetch('/api/media/liked')).json();
      this.liked = new Map((data.items || []).map((i) => [this.likeKey(i), i]));
    } catch { /* the heart simply stays unlit */ }
    this.paintLike();
  },

  paintLike() {
    const btn = this.elSlide?.querySelector('.m-like');
    if (!btn) return;
    const item = this.slide;
    const on = this.liked.has(this.likeKey(item));
    btn.classList.toggle('on', on);
    btn.disabled = !item || item.kind === 'video';
    btn.setAttribute('aria-label', on ? 'kept — tap to drop it' : 'keep this photograph');
  },

  async toggleLike() {
    const item = this.slide;
    if (!item || item.kind === 'video') return;
    const btn = this.elSlide.querySelector('.m-like');
    btn.classList.add('busy');
    try {
      const res = await (await fetch('/api/media/like', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: item.id, root: item.root, folder: item.folder, name: item.name }),
      })).json();
      if (res.liked === true) this.liked.set(this.likeKey(item), res.item);
      else if (res.liked === false) this.liked.delete(this.likeKey(item));
      else this.flashCaption(res.error || 'could not keep that one');
    } catch {
      this.flashCaption('the kitchen server could not be reached');
    }
    btn.classList.remove('busy');
    this.paintLike();
  },

  /* The panel has no room for a toast, and the caption is the one line on the
     picture that is already words. It says its piece and gives the line back. */
  flashCaption(text) {
    const el = this.elSlide.querySelector('.m-cap-note');
    if (!el) return;
    el.textContent = text;
    el.hidden = false;
    clearTimeout(this._noteTimer);
    this._noteTimer = setTimeout(() => { el.hidden = true; }, 3000);
  },

  paintLikedTab(box) {
    const items = [...this.liked.values()]
      .sort((a, b) => (b.liked_at || 0) - (a.liked_at || 0));
    const title = this.elBrowse.querySelector('.m-title');
    if (title) title.textContent = items.length ? `${items.length} kept` : '';
    if (!items.length) {
      box.innerHTML = '<div class="placeholder">Nothing kept yet.<br>'
        + '<span style="font-size:14px">Tap the heart on a photograph in the show '
        + 'and a copy is saved here.</span></div>';
      return;
    }
    box.innerHTML = `<div class="m-grid thumbs">${items.map((i) => `
      <button class="m-thumb" data-f="${encodeURIComponent(i.file)}">
        <img loading="lazy" src="${this.esc(i.thumb_url)}" alt="">
        <span class="m-unlike" data-a="drop" aria-label="stop keeping this">✕</span>
      </button>`).join('')}</div>`;
    box.querySelectorAll('.m-thumb').forEach((b) => {
      const file = decodeURIComponent(b.dataset.f);
      const item = items.find((i) => i.file === file);
      b.onclick = async (e) => {
        if (e.target.closest('[data-a="drop"]')) {
          await fetch(`/api/media/liked/${encodeURIComponent(file)}`, { method: 'DELETE' })
            .catch(() => {});
          this.liked.delete(this.likeKey(item));
          this.paintLike();
          this.renderTabs();
          return;
        }
        this.openItem(item);
      };
    });
  },
  /* ---------------- slideshow options (the gear) ----------------
     Every row is a segmented control: one tap sets the value and saves it, so
     there is no Save button to forget on a wall screen nobody sits at. */
  settingRows() {
    return [
      { key: 'interval_s', label: 'Time on screen', hint: 'how long each picture stays up',
        options: [[3, '3s'], [5, '5s'], [10, '10s'], [30, '30s'], [60, '1 min'], [300, '5 min']] },
      { key: 'order', label: 'Order',
        options: [['shuffle', 'Shuffle'], ['newest', 'Newest first'], ['oldest', 'Oldest first']] },
      { key: 'recent_ratio', label: 'Favour recent photos',
        hint: 'how often shuffle reaches for the last three months',
        when: (s) => s.order === 'shuffle',
        options: [[0, 'Never'], [0.3, 'Sometimes'], [0.6, 'Often'], [1, 'Always']] },
      { key: 'fit', label: 'Framing',
        options: [['cover', 'Fill the panel'], ['contain', 'Show the whole photo']] },
      { key: 'transition_s', label: 'Crossfade',
        options: [[0, 'None'], [0.5, 'Quick'], [1.2, 'Gentle'], [3, 'Slow']] },
      { key: 'include_videos', label: 'Video clips',
        // A cached batch is photographs: a few hundred clips would be tens of
        // gigabytes. Saying so here is the only place it can be noticed.
        hint: (s) => (s.source === 'cache'
          ? 'cached batches hold photographs only — choose NAS live for clips'
          : 'clips appear as their first frame, tap to play'),
        options: [[false, 'Photos only'], [true, 'Include videos']] },
      { key: 'show_caption', label: 'Caption',
        hint: 'the file name, and where it sits on the NAS',
        options: [[false, 'Hidden'], [true, 'Name and path']] },
      { key: 'use_chosen', label: 'Folders',
        options: [[true, 'Chosen folders'], [false, 'Whole library']] },
      { key: 'source', label: 'Pictures come from',
        hint: 'cached keeps the show running while the NAS sleeps',
        options: [['cache', 'NAS cache'], ['live', 'NAS live']] },
      { key: 'cache_size', label: 'Pictures per batch',
        hint: 'downloaded together, then served from this server',
        options: [[0, 'Off'], [200, '200'], [350, '350'], [500, '500']] },
      { key: 'cache_refresh_h', label: 'New batch',
        hint: 'the old batch is deleted when the new one lands',
        when: (s) => s.cache_size > 0,
        options: [[6, 'Every 6h'], [12, 'Twice a day'], [24, 'Daily'], [72, 'Every 3 days']] },
    ];
  },

  openSettings() {
    this.setMode('settings');
    this.elSlide.hidden = true;
    this.elView.hidden = true;
    this.elBrowse.hidden = false;
    this.elBrowse.innerHTML = `
      <div class="m-bar">
        <button class="m-back">Back</button>
        <span class="m-title">Slideshow options</span>
        <span class="spacer" style="flex:1"></span>
        <span class="m-saved" hidden>Saved</span>
      </div>
      <div class="m-opts"></div>
      <div class="m-cache"></div>`;
    this.elBrowse.querySelector('.m-back').onclick = () => this.openSlideshow();
    this.renderSettings();
    this.loadCacheStatus();
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
    if (c.state === 'filling') return `Downloading a new batch… ${c.count} of ${c.target}.`;
    if (c.state === 'failed') return 'The last batch could not be built. Try again once the NAS is awake.';
    const n = c.available ?? c.count;
    if (!n) return this.nas === 'awake'
      ? 'No batch yet — one is built shortly.'
      : 'No batch yet — it is built when the NAS next wakes.';
    const when = new Date((c.built_at || 0) * 1000);
    const today = when.toDateString() === new Date().toDateString();
    return `${n} pictures ready, fetched ${today
      ? `today at ${when.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}`
      : when.toLocaleDateString('en-GB', { day: 'numeric', month: 'long' })}.`;
  },

  renderCacheBox() {
    const box = this.elBrowse?.querySelector('.m-cache');
    if (!box) return;   // the gear screen is not open
    const busy = this.cache?.state === 'filling';
    box.innerHTML = `
      <div class="m-opt">
        <div class="m-olabel">Cached batch<span class="m-ohint">${this.esc(this.cacheLine())}</span></div>
        <div class="m-oset">
          <button class="m-oval m-refill"${busy ? ' disabled' : ''}>${busy ? 'Downloading…' : 'Fetch now'}</button>
        </div>
      </div>`;
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

  renderSettings() {
    const s = this.settings;
    const box = this.elBrowse.querySelector('.m-opts');
    if (!box) return;
    box.innerHTML = this.settingRows()
      .filter((r) => !r.when || r.when(s))
      .map((r) => {
        // A hint may depend on the other settings — "video clips" reads
        // differently once the pictures are coming from a cached batch.
        const hint = typeof r.hint === 'function' ? r.hint(s) : r.hint;
        return `
        <div class="m-opt">
          <div class="m-olabel">${r.label}${hint ? `<span class="m-ohint">${this.esc(hint)}</span>` : ''}</div>
          <div class="m-oset" data-key="${r.key}">${r.options.map(([v, label]) => `
            <button class="m-oval${v === s[r.key] ? ' on' : ''}" data-v="${encodeURIComponent(JSON.stringify(v))}">${label}</button>`).join('')}
          </div>
        </div>`;
      }).join('');
    box.querySelectorAll('.m-oval').forEach((b) => {
      b.onclick = () => this.setSetting(b.parentElement.dataset.key,
                                        JSON.parse(decodeURIComponent(b.dataset.v)));
    });
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

  flashSaved(text = 'Saved') {
    const el = this.elBrowse.querySelector('.m-saved');
    if (!el) return;
    el.textContent = text;
    el.hidden = false;
    clearTimeout(this._savedTimer);
    this._savedTimer = setTimeout(() => { el.hidden = true; }, 1600);
  },

  /* ---------------- single item ---------------- */
  async openItem(item) {
    if (!item) return;
    this.setMode('view');
    this.elBrowse.hidden = true;
    this.elView.hidden = false;
    const close = '<button class="m-back m-float">Back</button>';

    if (item.kind === 'photo') {
      this.elView.innerHTML = `${close}<img class="m-full" src="${item.url}">`;
    } else {
      this.elView.innerHTML = `${close}<div class="placeholder">preparing video…</div>`;
      const r = await fetch(item.url, { method: 'HEAD' }).catch(() => null);
      if (!r || r.status === 415) {
        this.elView.innerHTML = `${close}<div class="placeholder">
          <span class="big">🎞</span>This video can't play on the wall screen</div>`;
      } else if (r.status === 202) {
        this.elView.innerHTML = `${close}<div class="placeholder">
          <span class="big">⏳</span>Converting this clip… it will play in a moment</div>`;
        setTimeout(() => { if (this.mode === 'view') this.openItem(item); }, 4000);
      } else if (r.status === 503) {
        this.elView.innerHTML = `${close}<div class="placeholder"><span class="big">🌙</span>NAS is sleeping</div>`;
      } else {
        this.elView.innerHTML = `${close}
          <video class="m-full" src="${item.url}" controls autoplay playsinline></video>`;
      }
    }
    this.elView.querySelector('.m-back').onclick = () => {
      const v = this.elView.querySelector('video');
      if (v) v.pause();
      this.elView.hidden = true;
      this.elBrowse.hidden = false;
      this.setMode('browse');
    };
  },

  onHide() { this.live = false; clearInterval(this.timer); this.timer = null; },
  onShow() { this.live = true; if (this.mode === 'slideshow') this.restart(); },
};
