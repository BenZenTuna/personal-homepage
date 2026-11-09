// The bird box, in the top bar: how many times the camera reported in the last
// day, and the last three stills it kept.
//
// It stands where the hourly weather band stood, and the trade is deliberate.
// The band was a summary of a forecast that is one tap away behind the reading
// beside it — the same hours, in more detail, whenever anyone asks. This is the
// only thing on the wall that answers "has anything been at the box today"
// without leaving the view you are on, and it answers it from the doorway.
//
// It owns no state. Everything here arrives on the `motion` key of the SSE bus
// that the Birds view reads, so the two always agree, and a tap hands over to
// that view's log of recordings (Alex, 2026-10-30: "clicking here should show
// the bird box video recordings"); the Birds button is the live picture.
//
// It has a second, smaller surface: `mini`, which app.js hangs in the clock's
// column when a panel fills the screen with a picture. A full-screen photograph
// covers the top bar, and with it the only thing on the wall that answers "has
// anything been at the box today" — so it comes back under the time, as a chip
// the size of the countdown's, in the same stack. One module and one
// subscription paint both; two blocks reading the same key separately would be
// two things to keep in step.

const THUMBS = 3;

const hhmm = (ts) => new Date(ts * 1000)
  .toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false });

export default {
  init(ctx) {
    this.el = document.getElementById('hd-motion');
    if (!this.el) return;
    this.el.innerHTML = `
      <span class="mo-head">
        <span class="mo-n">—</span>
        <span class="mo-txt"><b>Bird box</b><i>motion, last 24 hours</i></span>
      </span>
      <span class="mo-thumbs"></span>`;
    this.nEl = this.el.querySelector('.mo-n');
    this.txtEl = this.el.querySelector('.mo-txt i');
    this.thumbs = this.el.querySelector('.mo-thumbs');
    this.drawn = null;                   // which stills are on screen already

    const open = () => { ctx.setPreset('birds'); ctx.ask('camera', 'events'); };
    this.el.addEventListener('click', open);
    /* The stills open the same log as the block. Kept as their own handler
       (on the thumbnails rather than on each still: they are redrawn whenever
       the camera reports, and a handler per image is a handler to lose). */
    this.thumbs.addEventListener('click', (e) => {
      if (!e.target.closest('.mo-th')) return;
      e.stopPropagation();              // ...or the block's own tap follows it
      ctx.setPreset('birds');
      ctx.ask('camera', 'events');
    });
    this.el.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(); }
    });

    /* The same block over a picture: the count, what it counts, and the last
       still — one, not three, because the rest of that header belongs to the
       photograph under it. Built once and moved in and out, like the views. */
    this.mini = document.createElement('button');
    this.mini.className = 'hx-motion';
    this.mini.title = 'what the bird box has seen today';
    this.mini.innerHTML = `
      <span class="hx-mo-n">—</span>
      <span class="hx-mo-txt"><b>Bird box</b><i>today</i></span>
      <span class="hx-mo-th"></span>`;
    this.miniN = this.mini.querySelector('.hx-mo-n');
    this.miniTxt = this.mini.querySelector('.hx-mo-txt i');
    this.miniTh = this.mini.querySelector('.hx-mo-th');
    this.miniDrawn = null;
    this.mini.addEventListener('click', open);

    ctx.bus.on('motion', (m) => this.paint(m));
  },

  /* app.js hangs this in an expanded header and takes it out again — the same
     move-don't-copy the six view buttons make. Never in the bird box's own
     header: that panel's first button already says the count, and the same
     number twice in one row reads as two different numbers. */
  mount(header, before) {
    if (!this.mini) return;          // a panel expanded before init() ran
    if (header) header.insertBefore(this.mini, before || null);
    else this.mini.remove();
  },

  paint(m) {
    if (!m || !this.el) return;
    const n = m.count_today || 0;
    this.last = m;
    this.paintMini(m, n);
    this.nEl.textContent = String(n);
    // Quiet rather than absent: a nought is an answer, and the block has to
    // keep its shape or the views beside it would move as birds came and went.
    this.el.classList.toggle('quiet', !n);
    const off = !!(m.settings && m.settings.alerts === false);
    this.el.classList.toggle('off', off);
    /* Alerts being switched off is said on this line now, the way the chip
       over a picture has always said it. It used to be said only where the
       stills go, and the readings that moved in beside this block took that
       room: see .mo-none in app.css, which is hidden while they are there.
       The line under the name is the one place in this card with the width
       for it, and "0 · motion, last 24 hours" with the alerts off is a nought
       that means something else entirely. */
    this.txtEl.textContent = off ? 'alerts are off' : 'motion, last 24 hours';

    const shots = (m.events || []).filter((e) => e.snapshot_url).slice(0, THUMBS);
    // The stills are full-size frames off the camera; redrawing the same three
    // on every heartbeat would re-fetch a quarter of a megabyte for nothing.
    const key = shots.map((e) => e.id).join(',');
    if (key === this.drawn) return;
    this.drawn = key;
    this.thumbs.innerHTML = shots.length
      ? shots.map((e) => `
          <span class="mo-th">
            <img src="${encodeURI(e.snapshot_url)}" alt="" loading="lazy">
            <i>${hhmm(e.at)}</i>
          </span>`).join('')
      : `<span class="mo-none">${m.settings && m.settings.alerts === false
          ? 'alerts are off' : 'nothing since yesterday'}</span>`;
  },

  paintMini(m, n) {
    if (!this.mini) return;
    this.miniN.textContent = String(n);
    // "visits" over a picture rather than "motion, last 24 hours": the line is
    // a third of the width it has in the top bar, and what the household calls
    // them is visits — the Birds view's own button says so too.
    this.miniTxt.textContent = m.settings && m.settings.alerts === false
      ? 'alerts are off' : n === 1 ? 'visit today' : 'visits today';
    this.mini.classList.toggle('quiet', !n);
    this.mini.classList.toggle('off', m.settings && m.settings.alerts === false);

    const shot = (m.events || []).find((e) => e.snapshot_url);
    // Same reason as the three above: a still is a full frame off the camera,
    // and redrawing the same one on every heartbeat re-fetches it for nothing.
    const key = shot ? shot.id : '';
    if (key === this.miniDrawn) return;
    this.miniDrawn = key;
    this.miniTh.innerHTML = shot
      ? `<img src="${encodeURI(shot.snapshot_url)}" alt="" loading="lazy">
         <i>${hhmm(shot.at)}</i>` : '';
  },
};
