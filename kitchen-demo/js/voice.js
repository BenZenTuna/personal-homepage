/* Voices — a text read aloud after an alert's sound (voices.py).

   Alex, 2026-10-18: "play a specific sound + it will follow up to read a
   given text", for every alert there is. Each alert or sound system is an
   *owner* ("alert:water", "alert:tracker:3", "school", "babo", "doorbell",
   "timers", "birds", "phonebox", "switch:<button>:<press>") with one text, a
   voice and a language. AI makes the speech once and the kitchen keeps it;
   until it is made nothing is read for that owner — the sheet says it is
   waiting for AI.

   This holds the `voices` document, the editor every sheet shows for its
   owners (🗣 opens it under the row), and the player: play(owner) after a
   sound has ended, and the alert goes on. It is ctx.voice. */

const esc = (s) => String(s ?? '').replace(/[&<>"']/g,
  (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const LANG_NAMES = { auto: 'Any language', sv: 'Svenska', en: 'English', tr: 'Türkçe' };

export default {
  doc: null,
  subs: [],
  open: null,          // the owner whose editor is open
  drafts: {},          // owner -> {text, voice, lang} being typed
  focus: null,         // {owner}: the text box being typed in, which a redraw gives back
  audio: null,

  init(ctx) {
    this.ctx = ctx;
    // A tap anywhere but a text box ends the typing a redraw gives back.
    document.addEventListener('pointerdown', (e) => {
      if (!e.target.closest?.('[data-vc-text]')) this.focus = null;
    }, true);
    ctx.bus.on('voices', (doc) => {
      if (!doc || typeof doc !== 'object' || !doc.owners) return;
      this.doc = doc;
      for (const fn of this.subs) {
        try { fn(doc); } catch (e) { console.error('voices subscriber failed', e); }
      }
    });
  },

  onChange(fn) { this.subs.push(fn); },

  of(owner) { return this.doc?.owners?.[owner] || null; },

  file(owner) { return this.of(owner)?.file || null; },

  /* ------------------------------------------------------------ playing -- */

  /* The voice of `owner` (or a file), once; resolves when it has ended — at
     once if there is none, or it cannot play. Never on a phone. */
  play(ownerOrFile, volume = 1) {
    const file = String(ownerOrFile || '').startsWith('api/') ? ownerOrFile : this.file(ownerOrFile);
    if (!file || this.ctx?.phone || !(volume > 0)) return Promise.resolve(false);
    this.stop();
    return new Promise((resolve) => {
      try {
        const el = (this.audio ||= new Audio());
        el.src = file;
        el.volume = Math.max(0, Math.min(1, volume));
        const done = (ok) => { el.onended = el.onerror = null; this.done = null; resolve(ok); };
        this.done = done;
        el.onended = () => done(true);
        el.onerror = () => done(false);
        Promise.resolve(el.play()).catch(() => done(false));
      } catch { resolve(false); }
    });
  },

  stop() {
    const el = this.audio;
    if (el) {
      try { el.pause(); el.currentTime = 0; } catch { /* gone */ }
    }
    if (this.done) this.done(false);
  },

  speaking() { return !!(this.audio && !this.audio.paused && !this.audio.ended); },

  /* ------------------------------------------------------------- editor -- */

  status(owner) {
    const v = this.of(owner);
    if (!v) return '';
    if (v.state === 'ready') return '✓ ready';
    if (this.doc?.busy) return '⏳ AI is making it…';
    if (this.doc?.tunai?.up === false) return '⏳ waiting for AI — it is off; made when it is back';
    return `⏳ waiting to be made${v.error ? ` — ${v.error}` : ''}`;
  },

  /* The row's button: what is read, or an invitation. */
  chip(owner, { cls = 'ls-btn' } = {}) {
    const v = this.of(owner);
    const words = v ? `🗣 “${v.text.length > 22 ? `${v.text.slice(0, 22)}…` : v.text}” ${v.state === 'ready' ? '✓' : '⏳'}`
      : '🗣 Read a text';
    return `<button class="${cls} vc-chip${this.open === owner ? ' on' : ''}" data-vc-chip="${esc(owner)}"
      title="a text read aloud after the sound">${esc(words)}</button>`;
  },

  /* The editor, under the row, while its chip is open. */
  editor(owner, { hint = 'read aloud after the sound, in the voice below' } = {}) {
    if (this.open !== owner) return '';
    const v = this.of(owner);
    const d = this.drafts[owner] ||= { text: v?.text || '', voice: v?.voice || 'female', lang: v?.lang || 'auto' };
    const max = this.doc?.text_max || 300;
    const same = v && d.text.trim() === v.text && d.voice === v.voice && d.lang === v.lang;
    const btn = (key, val, text) => `<button class="ls-btn${d[key] === val ? ' on' : ''}"
      data-vc-set="${esc(owner)}" data-k="${key}" data-v="${esc(val)}" aria-pressed="${d[key] === val}">${esc(text)}</button>`;
    return `<div class="vc-editor" data-vc-ed="${esc(owner)}">
      <span class="db-hint">${esc(hint)}. AI makes the voice once and the kitchen keeps it; a new
        text is made again.</span>
      <textarea class="vc-text" data-vc-text="${esc(owner)}" maxlength="${max}" rows="2"
        placeholder="the words to read aloud">${esc(d.text)}</textarea>
      <span class="ls-set vc-voice">
        <span class="vc-grp"><span class="sheet-cap">Voice</span>
          <span class="sheet-seg">${btn('voice', 'female', 'Female')}${btn('voice', 'male', 'Male')}</span></span>
        <span class="vc-grp"><span class="sheet-cap">Language</span>
          <span class="sheet-seg">${Object.entries(LANG_NAMES).map(([k, n]) => btn('lang', k, n)).join('')}</span></span>
      </span>
      <span class="ls-set">
        <button class="ls-btn sheet-primary vc-save" data-vc-save="${esc(owner)}"${same || !d.text.trim() ? ' disabled' : ''}>Save</button>
        ${v?.file ? `<button class="ls-btn" data-vc-hear="${esc(owner)}">▶ Hear it</button>` : ''}
        ${v ? `<button class="ls-btn sheet-danger" data-vc-clear="${esc(owner)}">Remove the text</button>` : ''}
        ${v && v.state !== 'ready' ? `<button class="ls-btn" data-vc-retry>Ask AI now</button>` : ''}
        <button class="ls-btn" data-vc-close="${esc(owner)}">Close</button>
        <span class="vc-status">${esc(this.status(owner))}</span>
      </span>
    </div>`;
  },

  async save(owner, d) {
    try {
      const r = await fetch(`/api/voices/${encodeURIComponent(owner).replace(/%3A/g, ':')}`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(d),
      });
      const body = await r.json().catch(() => ({}));
      if (r.ok && body.owners) this.doc = body;
      else this.ctx?.soundlib?.toast(`Not saved: ${body.error || r.status}`);
    } catch (e) { this.ctx?.soundlib?.toast(`Not saved: ${e.message}`); }
  },

  /* Everything above, inside `root`; `redraw` is the sheet's own render. */
  wire(root, redraw) {
    const again = () => redraw();
    root.querySelectorAll('[data-vc-chip]').forEach((b) => {
      b.onclick = (e) => {
        e.stopPropagation();
        const o = b.dataset.vcChip;
        this.open = this.open === o ? null : o;
        if (this.open) delete this.drafts[o];
        again();
      };
    });
    root.querySelectorAll('[data-vc-close]').forEach((b) => {
      b.onclick = (e) => { e.stopPropagation(); delete this.drafts[this.open]; this.open = null; again(); };
    });
    root.querySelectorAll('[data-vc-text]').forEach((t) => {
      const o = t.dataset.vcText;
      t.oninput = () => {
        this.drafts[o].text = t.value;
        const save = root.querySelector(`[data-vc-save="${CSS.escape(o)}"]`);
        const v = this.of(o);
        if (save) save.disabled = !t.value.trim() || (v && t.value.trim() === v.text);
      };
      t.onfocus = () => { this.focus = { owner: o }; };
      t.onclick = (e) => e.stopPropagation();
      // A redraw while typing (the server's updates arrive all the time) gives the box back.
      if (this.focus?.owner === o && document.activeElement !== t) {
        t.focus();
        const n = t.value.length;
        t.setSelectionRange(n, n);
      }
    });
    root.querySelectorAll('[data-vc-set]').forEach((b) => {
      b.onclick = (e) => {
        e.stopPropagation();
        this.drafts[b.dataset.vcSet][b.dataset.k] = b.dataset.v;
        again();
      };
    });
    root.querySelectorAll('[data-vc-save]').forEach((b) => {
      b.onclick = async (e) => {
        e.stopPropagation();
        const o = b.dataset.vcSave;
        const d = { ...this.drafts[o], text: (this.drafts[o].text || '').trim() };
        this.focus = null;
        await this.save(o, d);
        again();
      };
    });
    root.querySelectorAll('[data-vc-clear]').forEach((b) => {
      b.onclick = async (e) => {
        e.stopPropagation();
        const o = b.dataset.vcClear;
        if (!b.dataset.sure) {
          b.dataset.sure = '1';
          b.textContent = 'Sure? Tap again';
          setTimeout(() => { if (b.isConnected) { delete b.dataset.sure; b.textContent = 'Remove the text'; } }, 4000);
          return;
        }
        delete this.drafts[o];
        this.open = null;
        await this.save(o, { text: '' });
        again();
      };
    });
    root.querySelectorAll('[data-vc-hear]').forEach((b) => {
      b.onclick = (e) => { e.stopPropagation(); this.play(b.dataset.vcHear); };
    });
    root.querySelectorAll('[data-vc-retry]').forEach((b) => {
      b.onclick = async (e) => {
        e.stopPropagation();
        b.disabled = true;
        b.textContent = 'Asking AI…';
        try { this.doc = await (await fetch('/api/voices/retry', { method: 'POST' })).json(); } catch { /* next */ }
        again();
      };
    });
  },
};
