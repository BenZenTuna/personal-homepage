/* The settings window kit's script (2026-10-22, Alex: "work on all gear
   settings windows in the platform … visually standardize them and make
   them more user friendly").

   Every settings window is a `.sheet` (app.css, "the settings window kit",
   where the markup is written down; the conversion guide has examples).
   This is the part CSS cannot do — the section rail — and a few string
   helpers, so a switch, a card or the state sentence is written the same
   way in every window. The helpers only build strings: each module keeps
   its own data-* hooks and its own wiring. It is on the context as
   ctx.sheetkit.

   The rail: a window of five cards or more lists them down a rail on the
   left of the wall, each with its live note (the card's `data-note`, the
   same words as its .sheet-sub); a tap jumps to the card, and the card
   being read is marked as the body scrolls. On a phone the rail is a row of
   chips under the header. Under five cards there is no rail on either.
   The modules draw their bodies by innerHTML on every change, so a module
   calls sync(sheet) after each draw: it reads the cards that are there now
   and redraws the rail only when their names change. The rail is the
   sheet's own child, beside .ls-body, so a redraw of the body never takes
   it away. */

const esc = (s) => String(s ?? '').replace(/[&<>"']/g,
  (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const RAIL_FROM = 5;   // cards before a window gets a rail

export default {
  esc,

  /* ------------------------------------------------------------ markup -- */

  /* On or off: one button with a switch drawn in it, saying its state. A tap
     turns it the other way, so `attrs` carries the module's own hook set to
     what the tap makes it: toggle(on, `data-put="wall" data-v="${!on}"`). */
  toggle(on, attrs = '', { words = ['On', 'Off'], cls = '' } = {}) {
    return `<button class="ls-btn sheet-switch${on ? ' on' : ''}${cls ? ` ${cls}` : ''}" role="switch"
      aria-checked="${!!on}" ${attrs}>${esc(on ? words[0] : words[1])}</button>`;
  },

  /* A card: its heading — which is also its name on the rail — with an
     optional live note beside it (`note`, plain text: "every 30 min · every
     day"), the same note the rail shows under the name. `body` is HTML. */
  sec(name, body, { note = '', cls = '', attrs = '' } = {}) {
    return `<section class="sheet-sec${cls ? ` ${cls}` : ''}" data-rail="${esc(name)}"${
      note ? ` data-note="${esc(note)}"` : ''}${attrs ? ` ${attrs}` : ''}>
      <h3 class="sheet-h">${esc(name)}${note ? ` <span class="sheet-sub">${esc(note)}</span>` : ''}</h3>${body}</section>`;
  },

  /* A folded card (long reference help, over ~300 characters): its heading
     opens it. `open` is the module's own memory of it, kept across redraws;
     the module sets that from the element's toggle event (data-more). */
  more(name, heading, body, open = false) {
    return `<details class="sheet-sec sheet-more" data-more="${esc(name)}" data-rail="${esc(heading)}"${
      open ? ' open' : ''}><summary class="sheet-h">${esc(heading)}</summary>${body}</details>`;
  },

  /* The state sentence: the first card of a window with a master on/off —
     one plain sentence of what is true now (`says`, HTML the caller escaped,
     values in <b>), what happens next (`next`), and the master switch
     beside it under a small caption (`ctl`, `cap`). `off` greys the card. */
  sum(says, { next = '', ctl = '', cap = '', off = false } = {}) {
    return `<div class="sheet-sum${off ? ' sheet-sum-off' : ''}">
      <div class="sheet-sum-main"><p class="sheet-says">${says}</p>${
        next ? `<p class="sheet-next">${next}</p>` : ''}</div>${
      ctl ? `<div class="sheet-sum-ctl">${cap ? `<span class="sheet-cap">${esc(cap)}</span>` : ''}${ctl}</div>` : ''}
    </div>`;
  },

  /* The header's line: its words (HTML) and its tone — 'ok' (set and
     working), 'live' (doing it this minute), 'warn' (needs somebody), 'off'. */
  status(el, html, tone = '') {
    if (!el) return;
    if (el.innerHTML !== html) el.innerHTML = html;
    if (tone) el.dataset.tone = tone; else delete el.dataset.tone;
  },

  /* "Alex's and Sam's", "a, b and c" */
  and(xs) {
    const a = xs.filter(Boolean);
    return a.length < 2 ? a.join('') : `${a.slice(0, -1).join(', ')} and ${a[a.length - 1]}`;
  },

  /* -------------------------------------------------------------- rail -- */

  cards(body) {
    return [...body.querySelectorAll(':scope > .sheet-sec')]
      .filter((s) => !s.hidden && s.offsetParent !== null);
  },

  name(sec) {
    if (sec.dataset.rail) return sec.dataset.rail;
    const h = sec.querySelector(':scope > .sheet-h');
    if (!h) return '';
    return [...h.childNodes].filter((n) => n.nodeType === 3 || !n.classList?.contains('sheet-sub'))
      .map((n) => n.textContent).join('').trim();
  },

  /* After the sheet's body was drawn. */
  sync(sheet) {
    const body = sheet?.querySelector(':scope > .ls-body');
    if (!body) return;
    const secs = this.cards(body);
    let rail = sheet.querySelector(':scope > .sheet-rail');
    if (secs.length < RAIL_FROM) {
      if (rail) rail.remove();
      sheet.classList.remove('sheet-railed');
      return;
    }
    if (!rail) {
      rail = document.createElement('nav');
      rail.className = 'sheet-rail';
      rail.setAttribute('aria-label', 'Sections');
      body.before(rail);
      rail.addEventListener('click', (e) => {
        const b = e.target.closest('.sheet-rail-i');
        if (b) this.jump(sheet, Number(b.dataset.i));
      });
    }
    const sig = secs.map((s) => this.name(s)).join('\n');
    if (rail.dataset.sig !== sig) {
      rail.dataset.sig = sig;
      rail.innerHTML = secs.map((s, i) => `<button class="sheet-rail-i" data-i="${i}">
        <span class="sheet-rail-t">${esc(this.name(s))}</span><span class="sheet-rail-n"></span></button>`).join('');
      delete rail.dataset.at;
    }
    rail.querySelectorAll('.sheet-rail-i').forEach((b, i) => {
      const n = b.querySelector('.sheet-rail-n');
      const note = secs[i].dataset.note || '';
      if (n.textContent !== note) n.textContent = note;
    });
    sheet.classList.add('sheet-railed');
    if (!body.dataset.railWired) {
      body.dataset.railWired = '1';
      body.addEventListener('scroll', () => this.mark(sheet), { passive: true });
      body.addEventListener('scrollend', () => {
        const t = this.tapped;
        if (t && t.sheet === sheet) t.landed = true;
      });
    }
    this.mark(sheet);
  },

  /* The card a tap asked for, at the top of the body. A short one, or one of
     the last (which cannot reach the top before the body ends), stays the
     marked one until the body is moved by hand — not the one under it. */
  jump(sheet, i) {
    const body = sheet.querySelector(':scope > .ls-body');
    const sec = this.cards(body)[i];
    if (!sec) return;
    const top = Math.max(0, Math.min(sec.offsetTop - 12, body.scrollHeight - body.clientHeight));
    this.tapped = { sheet, i, top, at: Date.now(), landed: Math.abs(body.scrollTop - top) < 2 };
    body.scrollTo({ top, behavior: 'smooth' });
    this.mark(sheet);
  },

  // Landed: its scroll has ended (or, without scrollend, a moment has passed).
  settled(t) { return t.landed || Date.now() - t.at > 1500; },

  mark(sheet) {
    const body = sheet.querySelector(':scope > .ls-body');
    const rail = sheet.querySelector(':scope > .sheet-rail');
    if (!body || !rail) return;
    const secs = this.cards(body);
    let at = 0;
    // The one being read: the last whose heading has come up to a line near
    // the top of the body — near, so a short card is marked while it is up
    // there rather than skipped for the one under it. At the very top, the
    // first, whatever is short; read down to the end, the last one; just
    // tapped, the tapped one.
    const top = body.scrollTop + Math.min(body.clientHeight * 0.2, 160);
    if (body.scrollTop > 4) secs.forEach((s, i) => { if (s.offsetTop <= top) at = i; });
    const scrolls = body.scrollHeight > body.clientHeight + 4;
    if (scrolls && body.scrollTop > 4 && body.scrollTop + body.clientHeight >= body.scrollHeight - 4) at = secs.length - 1;
    let t = this.tapped && this.tapped.sheet === sheet ? this.tapped : null;
    // Once the jump has landed, any move away from it (a finger, the window
    // opened again at its top) hands the rail back to the reading.
    if (t && this.settled(t) && Math.abs(body.scrollTop - t.top) > 4) { this.tapped = null; t = null; }
    if (t && t.i < secs.length) at = t.i;
    if (rail.dataset.at === String(at)) return;
    rail.dataset.at = String(at);
    rail.querySelectorAll('.sheet-rail-i').forEach((b, i) => {
      if (i === at) b.setAttribute('aria-current', 'true'); else b.removeAttribute('aria-current');
    });
    // On a phone the rail is a row that scrolls sideways: keep the mark in
    // it — the first one at its very start, never cut at the left.
    const cur = rail.children[at];
    if (cur && rail.scrollWidth > rail.clientWidth + 2) {
      const left = at === 0 ? 0 : cur.offsetLeft - (rail.clientWidth - cur.offsetWidth) / 2;
      rail.scrollTo({ left: Math.max(0, left), behavior: 'smooth' });
    }
  },
};
