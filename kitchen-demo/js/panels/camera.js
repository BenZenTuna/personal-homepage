// Bird box — the demo stand-in for the real panel.
//
// On the wall this is a go2rtc WebRTC stream off a nest-box camera, held to
// three rules that keep a cheap camera happy: exactly one stream element at a
// time, expanding swaps the sub stream for the HD one, and hiding the panel
// destroys the element so go2rtc drops its consumer.
//
// There is no camera behind a static demo, so the element here is a looping
// <video> instead. Everything around it is kept: the same lifecycle contract
// (init/onShow/onHide/onExpand/onCollapse), the same "connecting…" overlay and
// Live badge, the same Sound on/off button writing to ui-state. Swapping the
// file in media/birdbox.mp4 is the whole of changing what it shows.

const SRC = 'media/birdbox.mp4';
const POSTER = 'media/birdbox.jpg';

export default {
  id: 'camera',
  title: 'Bird box',
  // Leaving the page drops the stream, exactly as hiding the panel does: a
  // camera consumer nobody is watching is the same cost either way.
  pauseWhenUnseen: true,

  init(body, ctx) {
    this.ctx = ctx;
    this.body = body;
    this.expanded = false;
    this.muted = ctx.uiState.cam_muted !== false;
    body.innerHTML = '<div class="cam-overlay">connecting to the camera…</div>'
      + '<div class="cam-live" hidden><i></i>Live</div>';
    this.overlay = body.querySelector('.cam-overlay');
    this.liveBadge = body.querySelector('.cam-live');

    this.muteBtn = ctx.addHeaderButton(this.id, this.muted ? 'Sound off' : 'Sound on',
                                       () => this.toggleMute());
    ctx.setMeta(this.id, 'demo clip · looping');

    this.el = null;
    // no create() here: onShow() from the layout engine owns element lifetime
  },

  create() {
    this.destroy();
    // A hidden tab must not hold a decoder open — defer until we are back.
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
    el.src = SRC;
    el.poster = POSTER;
    el.loop = true;
    el.muted = this.muted;
    el.autoplay = true;
    el.playsInline = true;
    el.preload = 'auto';
    this.overlay.classList.remove('hidden');
    this.overlay.textContent = 'connecting to the camera…';
    if (this.liveBadge) this.liveBadge.hidden = true;
    this.body.appendChild(el);
    this.el = el;

    const hide = () => {
      this.overlay.classList.add('hidden');
      if (this.liveBadge) this.liveBadge.hidden = false;
    };
    el.addEventListener('playing', hide);
    el.addEventListener('timeupdate', hide);
    // A file that will not load says so rather than sitting on "connecting…"
    // forever — the one failure this panel can actually have in a demo.
    el.addEventListener('error', () => {
      this.overlay.classList.remove('hidden');
      this.overlay.textContent = 'no clip at media/birdbox.mp4';
    });
    el.play().catch(() => { /* autoplay refused; the poster stands in */ });
  },

  destroy() {
    if (this._deferred) {
      removeEventListener('visibilitychange', this._deferred);
      this._deferred = null;
    }
    if (this.el) { this.el.pause(); this.el.remove(); this.el = null; }
  },

  toggleMute() {
    this.muted = !this.muted;
    if (this.el) {
      this.el.muted = this.muted;
      if (!this.muted) this.el.play().catch(() => {});
    }
    this.muteBtn.textContent = this.muted ? 'Sound off' : 'Sound on';
    this.ctx.saveUiState({ cam_muted: this.muted });
  },

  // On the wall these swap the sub stream for the HD one and back. Here they
  // only relabel: one clip is the whole of what a demo has to offer.
  onExpand() {
    this.expanded = true;
    this.ctx.setMeta(this.id, 'demo clip · looping · full screen');
  },
  onCollapse() {
    this.expanded = false;
    this.ctx.setMeta(this.id, 'demo clip · looping');
  },
  onHide() { this.destroy(); },
  onShow() { this.create(); },
};
