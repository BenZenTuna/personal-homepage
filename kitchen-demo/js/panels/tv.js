// TV: launcher tiles for the streaming services and TV links.
//
// A tile opens the channel **inside the panel**, under a bar that works the way
// the bar on a phone does: ‹ Back one step, ⌂ Home to the wall's home view, ↻
// to the channel's own front page. Nobody is thrown into a bare browser tab
// with no way back — there is no keyboard on the wall to press Alt+Left with,
// and the tab has no chrome to press anything else with either.
//
// What cannot be fixed from here: **a site decides whether it may be framed at
// all**, and most of the big ones say no. Netflix sends `X-Frame-Options:
// DENY`, YouTube and SVT and TV4 send SAMEORIGIN, HBO Max sends
// `frame-ancestors 'none'`. The browser then paints a blank rectangle and
// fires the same `load` event a working frame does, so a page cannot even tell
// it happened. The backend reads the headers instead (`/api/tv/probe`) and
// this panel asks it before drawing: a channel that refuses gets an honest
// card and one big button, never a blank rectangle, and the tiles say which is
// which before anything is tapped.
//
// The tiles come from settings.json `tv.links`; `launchers` (the older list)
// is still honoured so nothing already configured disappears.

function esc(s) {
  return String(s).replace(/[&<>"]/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

// "Netflix" -> "N", "SVT Play" -> "SP": a readable stand-in when a link in
// settings.json gives no mark of its own.
function autoMark(label) {
  const words = String(label).replace(/[^\p{L}\p{N} ]/gu, ' ').trim().split(/\s+/);
  return (words.length > 1 ? words[0][0] + words[1][0] : words[0].slice(0, 2)).toUpperCase();
}

export default {
  id: 'tv',
  title: 'TV',

  init(body, ctx) {
    this.ctx = ctx;
    this.body = body;

    const tv = ctx.config.tv || {};
    const legacy = (ctx.config.launchers || []).map((l) => ({ label: l.label, url: l.url }));
    this.links = (tv.links && tv.links.length ? tv.links : legacy).filter((l) => l && l.url);

    // url -> true/false/undefined. `embed: true` in settings.json is a hand-
    // written "this one is known to work", so it needs no round trip.
    this.framable = {};
    for (const l of this.links) if (l.embed) this.framable[l.url] = true;
    this.probed = false;

    this.render();
  },

  /* Asked once per page load, not per tap: the answer is a property of the
     site, the backend caches it for six hours anyway, and a tile that only
     learns what it is when pressed has already made the person guess. */
  async probeAll() {
    if (this.probed) return;
    this.probed = true;
    await Promise.all(this.links.map(async (l) => {
      if (this.framable[l.url] !== undefined) return;
      try {
        const r = await fetch(`/api/tv/probe?url=${encodeURIComponent(l.url)}`);
        // A backend older than this endpoint answers 404. That is "not known",
        // never "cannot be framed" — the frontend deploys on its own, so this
        // pairing is a normal state rather than a broken one.
        if (!r.ok) return;
        const res = await r.json();
        if (typeof res.framable === 'boolean' && !res.unknown) this.framable[l.url] = res.framable;
      } catch { /* offline: the tile keeps saying nothing, and the frame still tries */ }
    }));
    if (!this.playing) this.paintNotes();
  },

  /* What a tile promises: whatever settings.json wanted said about the channel,
     then where it will open. Before the probe answers, the second half is left
     off rather than guessed — "opens in a tab" on a channel that plays here is
     a promise broken in the direction people notice. */
  noteFor(l) {
    const f = this.framable[l.url];
    const where = f === true ? 'plays here' : f === false ? 'needs its own tab' : '';
    return [l.note, where].filter(Boolean).join(' · ');
  },

  paintNotes() {
    this.body.querySelectorAll('.tv-tile').forEach((btn) => {
      const l = this.links[Number(btn.dataset.i)];
      btn.querySelector('.tv-note').textContent = this.noteFor(l);
      btn.classList.toggle('tv-embeds', this.framable[l.url] === true);
    });
  },

  render() {
    this.playing = null;
    if (!this.links.length) {
      this.body.innerHTML = `<div class="placeholder"><span class="big">▷</span>
        Add TV links under "tv" in settings.json</div>`;
      return;
    }

    this.body.innerHTML = `<div class="tv-grid">${this.links.map((l, i) => `
      <button class="tv-tile${this.framable[l.url] === true ? ' tv-embeds' : ''}" data-i="${i}"
              style="--brand:${esc(l.color || 'var(--birds)')}">
        <span class="tv-mark">${esc(l.mark || autoMark(l.label || l.url))}</span>
        <span class="tv-label">${esc(l.label || l.url)}</span>
        <span class="tv-note">${esc(this.noteFor(l))}</span>
      </button>`).join('')}</div>`;

    /* A channel already known to refuse framing goes straight to its own tab.
       Sending it through the player first only ever produced one screen — a
       card explaining that it would not play, with a button to do the thing
       the tap had already asked for. That is a tap spent on being told no. The
       card still exists for the case that cannot be known in advance (below).

       The tab is opened from inside the tap itself, which is what keeps it out
       of the popup blocker: a window opened from a `then` a second later has
       no user gesture behind it and is silently swallowed. */
    this.body.querySelectorAll('.tv-tile').forEach((btn) => {
      const link = this.links[Number(btn.dataset.i)];
      btn.onclick = () => (this.framable[link.url] === false
        ? window.open(link.url, '_blank')
        : this.play(link));
    });
  },

  /* The bar is the whole point of playing here rather than in a tab, so it is
     never the thing that scrolls away and never the thing a failure hides:
     "Open in a tab" stays on it whatever the frame is doing.

     ‹ Back is one step back in the dashboard — the channel grid — and not the
     frame's own history, which is unreachable: `contentWindow.history` on a
     cross-origin frame throws, and there is no other way to ask. ↻ is the
     answer to having drilled somewhere inside a channel: it puts the frame
     back on the page the tile opened. */
  play(link) {
    this.playing = link;
    const blocked = this.framable[link.url] === false;

    this.body.innerHTML = `
      <div class="tv-player">
        <div class="tv-nav">
          <button class="tv-nb tv-back" aria-label="back to all channels">‹<em>Back</em></button>
          <button class="tv-nb tv-home" aria-label="the wall's home view">⌂<em>Home</em></button>
          <button class="tv-nb tv-reload" aria-label="back to the channel's front page">↻</button>
          <span class="tv-ptitle">${esc(link.label || link.url)}</span>
          <span class="spacer"></span>
          <button class="tv-pop">Open in a tab ↗</button>
        </div>
        ${blocked ? this.blockedCard(link) : `
          <iframe class="tv-frame" src="${esc(link.url)}"
                  allow="autoplay; fullscreen; encrypted-media; picture-in-picture"
                  allowfullscreen referrerpolicy="no-referrer-when-downgrade"></iframe>`}
      </div>`;

    const bar = this.body.querySelector('.tv-nav');
    bar.querySelector('.tv-back').onclick = () => this.render();
    bar.querySelector('.tv-home').onclick = () => {
      this.render();                 // stop the stream before leaving the view
      this.ctx.goHome?.();
    };
    const reload = bar.querySelector('.tv-reload');
    reload.disabled = blocked;
    reload.onclick = () => {
      const f = this.body.querySelector('.tv-frame');
      if (f) f.src = link.url;       // a fresh src, not reload(): cross-origin forbids that too
    };
    bar.querySelector('.tv-pop').onclick = () => {
      window.open(link.url, '_blank');
      this.render();   // stop this copy so two streams never play at once
    };
    this.body.querySelector('.tv-tab')?.addEventListener('click', () => {
      window.open(link.url, '_blank');
      this.render();
    });

    // Not yet known: let the frame try, and correct the panel if the answer
    // comes back "no" while it is sitting there blank.
    if (this.framable[link.url] === undefined) this.confirm(link);
  },

  /* A channel the browser turns out to refuse *after* the frame was opened —
     the only case the tile could not know in advance. It cannot be sent to a
     tab from here: `window.open` a second after the tap has no user gesture
     behind it and the popup blocker eats it silently, which would leave a
     blank rectangle and no explanation at all. So it says what happened and
     offers the one press that does work. Next time the tile knows, and the tap
     goes straight to a tab. */
  blockedCard(link) {
    return `<div class="tv-blocked">
      <span class="tv-blocked-mark">⊘</span>
      <h3>${esc(link.label || link.url)} will not play inside the dashboard</h3>
      <p>The site tells every browser not to show it inside another page, and
         there is nothing this screen can do about that. It plays normally in a
         tab of its own — the dashboard stays loaded behind it and comes back
         on its own after ten idle minutes.</p>
      <button class="tv-tab">Open ${esc(link.label || 'it')} in a tab ↗</button>
    </div>`;
  },

  async confirm(link) {
    try {
      const r = await fetch(`/api/tv/probe?url=${encodeURIComponent(link.url)}`);
      if (!r.ok) return;
      const res = await r.json();
      if (typeof res.framable !== 'boolean' || res.unknown) return;
      this.framable[link.url] = res.framable;
      // Still on this channel and it turns out it cannot be drawn: swap the
      // blank rectangle for the card that explains it.
      if (res.framable === false && this.playing === link) this.play(link);
    } catch { /* offline: leave the frame to its own devices */ }
  },

  /* Leaving the tab must stop the stream: an audio source the dashboard is no
     longer showing would also keep the idle extension from ever coming home. */
  onHide() { if (this.playing) this.render(); },
  onShow() { this.probeAll(); },
};
