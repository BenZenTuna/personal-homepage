// Casting to the wall from a phone's YouTube app (2026-10-31).
//
// The receiver the phone casts to is a container next to the kitchen
// (cast/receiver.mjs); the server holds what the wall should be doing
// (cast.py) and publishes it as `cast`. This file is the player: on the wall,
// and only there, the video plays in YouTube's own embedded player over the
// whole screen, and every change in that player is reported back, so the
// phone's progress bar and buttons stay true. Every other screen — a phone, a
// laptop — only has the card in ⚙ Settings: who is connected, and the code
// for pairing a phone that is away from the home Wi-Fi.
//
// The wall's own buttons (⏸ and ✕) go through the receiver rather than
// straight to the player, so the phone hears about them the way it hears
// about its own.

const esc = (s) => String(s ?? '').replace(/[&<>"']/g,
  (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const REPORT_EVERY_MS = 5000;   // the phone's progress bar, while it plays
const BAR_HIDES_MS = 6000;      // the bar along the bottom, untouched
const DRIFT_S = 3;              // further from the expected place than this: seek

// YouTube's embedded player's own error numbers, in the household's words.
const ERRORS = {
  2: 'YouTube did not recognise that video.',
  5: 'This video could not be played here.',
  100: 'That video is gone or private.',
  101: 'Its owner only lets it play on YouTube itself.',
  150: 'Its owner only lets it play on YouTube itself.',
  153: 'YouTube refused the player here.',
};

const post = (url, body) => fetch(url, {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body || {}),
}).then((r) => (r.ok ? r.json() : null)).catch(() => null);

export default {
  init(ctx, { setCovered } = {}) {
    this.ctx = ctx;
    this.setCovered = setCovered || (() => {});
    this.state = null;
    this.player = null;       // YT.Player, made on the first video
    this.ready = false;
    this.vid = '';            // the video in the player
    this.mark = 0;            // the `changed` of the play command it was loaded for
    this.reportedAt = 0;
    this.listeners = new Set();
    this.build();
    ctx.bus.on('cast', (s) => { this.state = s; this.apply(); this.listeners.forEach((f) => f(s)); });
    // The wall learns that it is the wall a moment after the page starts
    // (night.js asks the server), and a video may already be waiting then.
    setInterval(() => this.tick(), 1000);
  },

  onChange(f) { this.listeners.add(f); },

  onWall() {
    if (this.ctx.phone) return false;
    const n = this.ctx.night;
    return n ? n.onWall() : true;
  },

  build() {
    const el = document.createElement('div');
    el.id = 'cs-player';
    el.innerHTML = `
      <div class="cs-video"><div class="cs-yt"></div></div>
      <div class="cs-catch" aria-hidden="true"></div>
      <div class="cs-msg" hidden></div>
      <div class="cs-bar">
        <span class="cs-icon" aria-hidden="true">📺</span>
        <span class="cs-txt"><b class="cs-title">Starting…</b><i class="cs-who"></i></span>
        <span class="cs-time"></span>
        <button class="cs-pp" aria-label="pause">⏸</button>
        <button class="cs-stop">✕ Stop casting</button>
      </div>`;
    document.body.appendChild(el);
    this.el = el;
    this.bar = el.querySelector('.cs-bar');
    this.msg = el.querySelector('.cs-msg');
    el.querySelector('.cs-catch').onclick = () => this.showBar();
    this.bar.onclick = () => this.showBar();
    el.querySelector('.cs-pp').onclick = (e) => {
      e.stopPropagation();
      const playing = this.state?.status === 'playing' || this.state?.status === 'loading';
      post('/api/cast/control', { cmd: playing ? 'pause' : 'resume' });
      this.showBar();
    };
    el.querySelector('.cs-stop').onclick = (e) => {
      e.stopPropagation();
      post('/api/cast/control', { cmd: 'stop' });
      this.close();     // at once: the receiver's stop follows and finds it closed
    };
  },

  isOpen() { return this.el?.classList.contains('open'); },

  open() {
    if (this.isOpen()) return;
    this.el.classList.add('open');
    this.setCovered(true);      // the slideshow and the camera stop under it
    this.showBar();
  },

  close() {
    if (this.player) {
      try { this.player.destroy(); } catch { /* already gone */ }
    }
    this.player = null;
    this.ready = false;
    this.vid = '';
    this.mark = 0;
    // YT.Player replaced the div with its frame; destroy() took the frame away.
    const box = this.el.querySelector('.cs-video');
    box.innerHTML = '<div class="cs-yt"></div>';
    this.msg.hidden = true;
    if (!this.isOpen()) return;
    this.el.classList.remove('open');
    this.setCovered(false);
  },

  showBar() {
    this.bar.classList.remove('gone');
    clearTimeout(this.barTimer);
    this.barTimer = setTimeout(() => {
      if (this.state?.status === 'playing') this.bar.classList.add('gone');
    }, BAR_HIDES_MS);
  },

  /* Where the video should be now, by the server's account. */
  expected() {
    const s = this.state;
    if (!s) return 0;
    const run = s.status === 'playing' || s.status === 'loading';
    return Math.max(0, (s.position || 0) + (run && s.at ? Date.now() / 1000 - s.at : 0));
  },

  async apply() {
    const s = this.state;
    if (!s || !s.video_id || s.status === 'idle') { this.close(); return; }
    if (!this.onWall()) return;
    this.open();
    this.paintBar();
    if (this.vid !== s.video_id || (s.status === 'loading' && s.changed !== this.mark)) {
      await this.load(s);
      return;
    }
    if (!this.ready) return;
    const p = this.player;
    const yst = p.getPlayerState();
    if (s.status === 'paused' && yst === 1) p.pauseVideo();
    if ((s.status === 'playing' || s.status === 'loading') && (yst === 2 || yst === 5 || yst === -1)) p.playVideo();
    if (Math.abs((p.getCurrentTime() || 0) - this.expected()) > DRIFT_S) p.seekTo(this.expected(), true);
    this.volume(s.volume);
  },

  volume(v) {
    if (!this.ready || !v) return;
    this.player.setVolume(v.level ?? 60);
    if (v.muted) this.player.mute(); else this.player.unMute();
  },

  async load(s) {
    this.vid = s.video_id;
    this.mark = s.changed;
    this.msg.hidden = true;
    const at = this.expected();
    if (this.player && this.ready) {
      this.player.loadVideoById({ videoId: s.video_id, startSeconds: at });
      return;
    }
    if (this.player) return;    // being made: onReady starts the latest
    try { await this.api(); } catch {
      this.say('YouTube could not be reached from the wall.');
      return;
    }
    if (!this.state?.video_id) return;   // stopped while the player loaded
    this.player = new window.YT.Player(this.el.querySelector('.cs-yt'), {
      width: '100%', height: '100%',
      videoId: s.video_id,
      playerVars: {
        autoplay: 1, controls: 0, disablekb: 1, fs: 0, rel: 0, iv_load_policy: 3,
        playsinline: 1, start: Math.floor(at), origin: location.origin,
      },
      events: {
        onReady: () => {
          this.ready = true;
          this.volume(this.state?.volume);
          // A newer video may have been cast while this one was being made.
          if (this.state?.video_id && this.state.video_id !== s.video_id) this.vid = '';
          this.apply();
        },
        onStateChange: (e) => this.changed(e.data),
        onError: (e) => this.failed(e.data),
      },
    });
  },

  api() {
    if (window.YT?.Player) return Promise.resolve();
    if (!this.apiP) {
      this.apiP = new Promise((ok, fail) => {
        const before = window.onYouTubeIframeAPIReady;
        window.onYouTubeIframeAPIReady = () => { before?.(); ok(); };
        const sc = document.createElement('script');
        sc.src = 'https://www.youtube.com/iframe_api';
        sc.onerror = () => { this.apiP = null; sc.remove(); fail(new Error('unreachable')); };
        document.head.appendChild(sc);
      });
    }
    return this.apiP;
  },

  /* YouTube's player: -1 unstarted, 0 ended, 1 playing, 2 paused, 3 buffering, 5 cued. */
  changed(yst) {
    const word = { 0: 'ended', 1: 'playing', 2: 'paused', 3: 'buffering' }[yst];
    if (yst === 1) this.msg.hidden = true;
    if (word) this.report(word);
    if (yst === 1) this.showBar();
    if (yst === 2) this.bar.classList.remove('gone');
    this.paintBar();
  },

  failed(code) {
    this.say(`${ERRORS[code] || 'This video could not be played here.'} Trying the next one…`);
    this.report('error', { code: String(code) });
  },

  say(text) {
    this.msg.textContent = text;
    this.msg.hidden = false;
    this.bar.classList.remove('gone');
  },

  report(status, extra = {}) {
    if (!this.vid) return;
    const p = this.ready ? this.player : null;
    this.reportedAt = Date.now();
    post('/api/cast/report', {
      video_id: this.vid,
      status,
      position: p ? p.getCurrentTime() || 0 : this.expected(),
      duration: p ? p.getDuration() || 0 : 0,
      title: p?.getVideoData?.()?.title || '',
      ...extra,
    });
  },

  tick() {
    const s = this.state;
    if (s?.video_id && s.status !== 'idle' && this.onWall() && !this.isOpen()) this.apply();
    if (!this.isOpen() || !this.ready) return;
    if (this.player.getPlayerState() === 1 && Date.now() - this.reportedAt > REPORT_EVERY_MS) {
      this.report('playing');
    }
    this.paintTime();
  },

  paintBar() {
    const s = this.state || {};
    const title = s.title || (this.ready && this.player.getVideoData?.()?.title) || 'Starting…';
    this.el.querySelector('.cs-title').textContent = title;
    this.el.querySelector('.cs-who').textContent = s.who ? `cast by ${s.who}` : 'cast from a phone';
    const pp = this.el.querySelector('.cs-pp');
    const playing = s.status === 'playing' || s.status === 'loading';
    pp.textContent = playing ? '⏸' : '▶';
    pp.setAttribute('aria-label', playing ? 'pause' : 'play');
    this.paintTime();
  },

  paintTime() {
    if (!this.ready) return;
    const t = (x) => {
      const n = Math.max(0, Math.floor(x || 0));
      const h = Math.floor(n / 3600);
      const m = Math.floor((n % 3600) / 60);
      const sec = String(n % 60).padStart(2, '0');
      return h ? `${h}:${String(m).padStart(2, '0')}:${sec}` : `${m}:${sec}`;
    };
    const d = this.player.getDuration() || 0;
    this.el.querySelector('.cs-time').textContent = d
      ? `${t(this.player.getCurrentTime())} / ${t(d)}` : '';
  },

  /* ---- the card in ⚙ Settings (app.js wallSettings) ---- */
  section(kit) {
    const s = this.state;
    if (!s) return '';
    const r = s.receiver || {};
    const name = esc(r.name || 'Kitchen wall');
    const who = (r.senders || []).map((x) => esc(x.name)).filter(Boolean);
    const now = s.video_id && s.status !== 'idle'
      ? `<span class="sheet-line sheet-ok">Playing now: <b>${esc(s.title || s.video_id)}</b>${
        s.who ? ` · cast by ${esc(s.who)}` : ''}</span>` : '';
    const line = !r.up
      ? '<span class="sheet-line sheet-warn">The cast receiver is not answering, so phones cannot find the wall now.</span>'
      : who.length ? `<span class="sheet-line sheet-ok">Connected: ${kit.and(who)}.</span>`
      : '<span class="sheet-line">No phone is connected now.</span>';
    const left = r.pairing_until ? Math.max(0, Math.round((r.pairing_until - Date.now() / 1000) / 60)) : 0;
    const code = r.pairing_code
      ? `<span class="cs-code">${esc(r.pairing_code.replace(/(\d{3})(?=\d)/g, '$1 '))}</span>
         <span class="db-hint">shown for ${left} more min; YouTube changes it every five.</span>`
      : r.pairing_until ? '<span class="db-hint">Asking YouTube for a code…</span>' : '';
    const body = `
      <div class="ls-row">
        <span class="ls-label">On the home Wi-Fi
          <span class="db-hint">In the YouTube app, tap the cast button and choose <b>${name}</b>.
            The video plays over the whole wall; the phone is the remote.</span>
          ${line}${now}</span>
      </div>
      <div class="ls-row">
        <span class="ls-label">Away from home, pair once
          <span class="db-hint">In the YouTube app: you → ⚙ Settings → Watch on TV → <b>Enter TV code</b>,
            and type the code shown here. After that the wall is in the phone's cast list wherever it is.</span>
          ${code}</span>
        <span class="ls-set">${r.pairing_until
          ? '<button class="ls-btn" data-cs-pair="stop">Hide the code</button>'
          : `<button class="ls-btn"${r.up ? '' : ' disabled'} data-cs-pair="start">Show a TV code</button>`}</span>
      </div>${now ? `
      <div class="ls-row">
        <span class="ls-label">The video on the wall</span>
        <span class="ls-set"><button class="ls-btn" data-cs-stop>✕ Stop casting</button></span>
      </div>` : ''}`;
    const note = !r.up ? 'not answering' : now ? 'playing now'
      : who.length ? `${who.length} connected` : 'ready';
    return kit.sec('Cast to the wall', body, { note });
  },

  /* Wires the card's buttons after app.js has drawn it. */
  wire(box) {
    box.querySelectorAll('[data-cs-pair]').forEach((b) => {
      b.onclick = async () => {
        b.disabled = true;
        const s = await post('/api/cast/pairing', { stop: b.dataset.csPair === 'stop' });
        if (s) { this.state = s; this.listeners.forEach((f) => f(s)); }
      };
    });
    box.querySelectorAll('[data-cs-stop]').forEach((b) => {
      b.onclick = () => post('/api/cast/control', { cmd: 'stop' });
    });
  },
};
