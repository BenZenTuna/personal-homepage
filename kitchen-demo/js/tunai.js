/* House → AI (backend/app/tunai.py, 2026-10-19).

   Alex: "add a new tab in the House tab for generating Video, LLM, Music,
   Image, transcription with AI, It will have text and voice input to
   connect AI and generate the request." And on the agent's box: "Lets do
   2 separate boxes" — this input is AI's alone, lives only in this tab,
   wears AI's colour and says Make, so nothing typed here is taken for a
   note to the kitchen agent, and nothing for AI is left waiting for one.

   Along the top the six kinds — Ask, Image, Video, Music, Transcribe,
   Speakers — and whether AI is on and what it is doing. Under them the box
   (notes.js's Box, so 🎤 writes the words in as everywhere else; for
   Transcribe and Speakers 🎤 is the recording itself, up to half an hour,
   handed over whole). Under that what was asked, newest first, as cards:
   waiting its turn, being made (with the time it usually takes), waiting for
   AI to come back, failed (with Try again), or made — the answer, the
   picture, the clip, the songs or the transcript. A tap opens one over the
   whole screen (#tn-sheet).

   Speakers (Alex: "Not names but to identify different speakers") is
   Transcribe with the router's speaker labels: each turn drawn under its
   Speaker N, in that voice's colour, with its time. Transcribe stays one
   plain text.

   Drawn into the House panel's own pane (panels/ha.js) while its AI tab
   is up; show(el) and hide() are the contract. */

const esc = (s) => String(s ?? '').replace(/[&<>"']/g,
  (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const SHEET_ID = 'tn-sheet';
const KINDS = [
  ['ask', '💬', 'Ask', 'Ask AI anything — e.g. “what can I cook with leeks and feta?”'],
  ['image', '🖼', 'Image', 'Describe the picture — e.g. “a fox in the snow at dusk, 16:9”'],
  ['video', '🎬', 'Video', 'Describe the clip — e.g. “5 seconds of waves on a rocky shore at sunset”'],
  ['music', '🎵', 'Music', 'Describe the song — e.g. “a one-minute Turkish lullaby with soft guitar”'],
  ['transcribe', '📝', 'Transcribe', 'Tap 🎤 and speak, up to half an hour — AI writes it all down as one text'],
  ['speakers', '👥', 'Speakers', 'Tap 🎤 and record the conversation, up to half an hour — AI writes down who said what'],
];
const RECORDED = ['transcribe', 'speakers'];
const KIND = Object.fromEntries(KINDS.map(([k, icon, word, hint]) => [k, { icon, word, hint }]));
const MADE = { ask: 'an answer', image: 'a picture', video: 'a clip', music: 'a song', transcribe: 'a transcript',
  speakers: 'a transcript with speakers' };
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

const hm = (d) => `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
function when(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const t = new Date();
  const days = Math.round((new Date(t.getFullYear(), t.getMonth(), t.getDate())
    - new Date(d.getFullYear(), d.getMonth(), d.getDate())) / 86400000);
  if (days === 0) return hm(d);
  if (days === 1) return `yesterday ${hm(d)}`;
  return `${d.getDate()} ${MON[d.getMonth()]} ${hm(d)}`;
}
const clock = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

/* Who said what: each turn under its speaker, in that voice's colour (.v1–.v6,
   by the number the router gave it, so Speaker 2 is the same colour on the
   card and over the whole screen). */
const VOICES = 6;
function turns(list) {
  return (list || []).map((u) => {
    const n = parseInt(String(u.speaker).replace(/\D+/g, ''), 10) || 1;
    return `<div class="tn-turn v${((n - 1) % VOICES) + 1}">
      <div class="tn-who">${esc(u.speaker)}<span>${clock(u.start || 0)}</span></div>
      <div class="tn-said">${esc(u.text)}</div></div>`;
  }).join('');
}
const voices = (j) => (j.speakers > 1 ? `${j.speakers} speakers` : 'AI heard one voice')
  + (j.duration ? ` · ${clock(j.duration)}` : '');

/* Enough markdown for an answer on a wall: paragraphs, lists, bold, code,
   headings as bold lines. Everything is escaped first. */
function md(text) {
  const inline = (t) => esc(t).replace(/\*\*(.+?)\*\*/g, '<b>$1</b>').replace(/`([^`]+)`/g, '<code>$1</code>');
  const out = [];
  let list = null;
  const close = () => { if (list) { out.push(`</${list}>`); list = null; } };
  for (const raw of String(text || '').split('\n')) {
    const line = raw.trimEnd();
    const ul = line.match(/^\s*[-*•]\s+(.*)$/);
    const ol = line.match(/^\s*\d+[.)]\s+(.*)$/);
    if (ul || ol) {
      const want = ul ? 'ul' : 'ol';
      if (list !== want) { close(); out.push(`<${want}>`); list = want; }
      out.push(`<li>${inline((ul || ol)[1])}</li>`);
      continue;
    }
    close();
    if (!line.trim()) { out.push(''); continue; }
    const h = line.match(/^#{1,4}\s+(.*)$/);
    const q = line.match(/^>\s?(.*)$/);
    out.push(h ? `<p><b>${inline(h[1])}</b></p>` : q ? `<blockquote>${inline(q[1])}</blockquote>` : `<p>${inline(line)}</p>`);
  }
  close();
  return out.join('\n');
}

export default {
  doc: null,          // the `tunai` document: the requests, AI's state
  el: null,           // the pane while the tab is up
  kind: 'ask',
  box: null,

  init(ctx) {
    if (this.ctx) return;
    this.ctx = ctx;
    ctx.bus.on('tunai', (doc) => this.absorb(doc));
  },

  absorb(doc) {
    if (!doc || !Array.isArray(doc.jobs)) return;
    this.doc = doc;
    if (this.el) { this.paintState(); this.renderList(); this.box?.retab(); }
    this.renderSheet();
  },

  async load() {
    try {
      const r = await fetch('/api/tunai');
      if (r.ok) this.absorb(await r.json());
    } catch { /* the bus brings it */ }
  },

  show(el) {
    if (this.el !== el) this.build(el);
    this.el = el;
    this.load();
    this.paintState();
    this.renderList();
    clearInterval(this.tick);
    this.tick = setInterval(() => this.paintRunning(), 1000);
  },

  hide() {
    clearInterval(this.tick);
    this.tick = null;
    this.box?.leave();
    this.el?.querySelectorAll('video, audio').forEach((m) => m.pause());
    this.closeSheet();
  },

  build(el) {
    el.innerHTML = `
      <div class="tn">
        <div class="tn-top">
          <div class="tn-kinds" role="tablist">${KINDS.map(([k, icon, word]) =>
            `<button class="tn-kind" role="tab" data-kind="${k}"><span>${icon}</span>${word}</button>`).join('')}</div>
          <span class="tn-state"></span>
        </div>
        <div class="tn-input"></div>
        <div class="tn-hint"></div>
        <div class="tn-list"></div>
      </div>`;
    el.querySelectorAll('.tn-kind').forEach((b) => this.tap(b, () => this.setKind(b.dataset.kind)));
    this.box = this.ctx.notes.mountBox(el.querySelector('.tn-input'), {
      label: '✨ Make',
      hint: () => KIND[this.kind].hint,
      blocked: () => this.needsKey(),
      submit: (text) => this.submit(text),
      longMaxS: 1800,
    });
    this.setKind(this.kind);
  },

  /* Pictures, clips and songs go through chat.home, which needs the kitchen's key. */
  needsKey() {
    return ['image', 'video', 'music'].includes(this.kind) && this.doc && !this.doc.chat;
  },

  setKind(kind) {
    this.kind = KIND[kind] ? kind : 'ask';
    this.el?.querySelectorAll('.tn-kind').forEach((b) => {
      const on = b.dataset.kind === this.kind;
      b.classList.toggle('on', on);
      b.setAttribute('aria-selected', String(on));
    });
    this.box?.setAudio(RECORDED.includes(this.kind) ? (blob) => this.record(blob) : null);
    this.paintState();
  },

  /* Over the list: whether AI is there, and what it is doing. */
  paintState() {
    if (!this.el) return;
    const d = this.doc;
    const st = this.el.querySelector('.tn-state');
    const run = d?.jobs.find((j) => j.status === 'running');
    st.className = `tn-state${d?.up === false ? ' off' : ''}`;
    if (run) st.innerHTML = `<span class="tn-dot busy"></span>AI is making ${MADE[run.kind]} <b class="tn-el" data-since="${esc(run.started_at)}"></b>`;
    else if (d?.up === false) st.innerHTML = '<span class="tn-dot"></span>AI is off — requests wait for it';
    else if (d?.up) st.innerHTML = '<span class="tn-dot on"></span>AI is on';
    else st.textContent = '';
    const hint = this.el.querySelector('.tn-hint');
    const usual = { ask: 'an answer in seconds', image: 'a picture in about half a minute',
      video: 'a clip in one to three minutes, with sound', music: 'two versions in under a minute',
      transcribe: 'one plain text in the language spoken; the recording is deleted once written down',
      speakers: 'each voice gets its own label — Speaker 1, Speaker 2 … — never a name; the recording is deleted once written down',
    }[this.kind];
    hint.textContent = this.needsKey()
      ? 'Pictures, video and music are not connected yet: the kitchen needs its own key for chat.home on AI.'
      : `${usual[0].toUpperCase()}${usual.slice(1)}. One request at a time${d?.queued ? ` · ${d.queued} waiting` : ''}.`;
    hint.classList.toggle('warn', this.needsKey());
    this.paintRunning();
  },

  paintRunning() {
    this.el?.querySelectorAll('[data-since]').forEach((e) => {
      const t = Date.parse(e.dataset.since);
      e.textContent = Number.isNaN(t) ? '' : clock(Math.max(0, (Date.now() - t) / 1000));
    });
  },

  async submit(text) {
    try {
      const r = await fetch('/api/tunai/jobs', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ kind: this.kind, text, device: this.device() }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) return { error: j.error || `AI could not be asked (${r.status})` };
      this.took(j.job);
      return { said: `✓ Asked — ${MADE[this.kind]} appears below` };
    } catch {
      return { error: 'the kitchen server did not answer' };
    }
  },

  async record(blob) {
    try {
      const r = await fetch(`/api/tunai/transcribe?kind=${this.kind}&device=${this.device()}`, {
        method: 'POST', headers: { 'Content-Type': (blob.type || 'audio/webm').split(';')[0] }, body: blob,
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) return { error: j.error || `the recording could not be sent (${r.status})` };
      this.took(j.job);
      return { said: '✓ Sent — the transcript appears below' };
    } catch {
      return { error: 'the kitchen server did not answer — the recording was not sent' };
    }
  },

  device() { return document.documentElement.classList.contains('phone') ? 'phone' : 'screen'; },

  took(job) {
    if (job && this.doc && !this.doc.jobs.some((j) => j.id === job.id)) {
      this.absorb({ ...this.doc, jobs: [...this.doc.jobs, job] });
    }
  },

  /* ------------------------------------------------------------ the list -- */

  renderList() {
    const list = this.el?.querySelector('.tn-list');
    if (!list) return;
    // A clip or a song playing is not cut off by a card redrawn under it.
    if ([...list.querySelectorAll('video, audio')].some((m) => !m.paused)) {
      this.dirty = true;
      return;
    }
    this.dirty = false;
    const jobs = [...(this.doc?.jobs || [])].reverse();
    list.innerHTML = jobs.length ? jobs.map((j) => this.card(j)).join('')
      : '<div class="tn-none">Nothing asked yet. Pick what AI should make, then write it or say it.</div>';
    list.querySelectorAll('[data-open]').forEach((b) => this.tap(b, () => this.openSheet(b.dataset.open)));
    list.querySelectorAll('[data-del]').forEach((b) => this.tap(b, () => this.remove(b.dataset.del)));
    list.querySelectorAll('[data-again]').forEach((b) => this.tap(b, () => this.again(b.dataset.again)));
    list.querySelectorAll('video, audio').forEach((m) => m.addEventListener('pause', () => { if (this.dirty) this.renderList(); }));
    this.paintRunning();
  },

  card(j) {
    const k = KIND[j.kind] || KIND.ask;
    const head = `
      <div class="tn-chead">
        <span class="tn-ckind">${k.icon} ${k.word}</span>
        <span class="tn-when">${esc(when(j.at))}</span>
        <span class="tn-spacer"></span>
        ${['done', 'failed'].includes(j.status) && !RECORDED.includes(j.kind) ? `<button class="tn-x" data-again="${esc(j.id)}" aria-label="ask again">↻</button>` : ''}
        ${j.status === 'failed' && RECORDED.includes(j.kind) ? `<button class="tn-x" data-again="${esc(j.id)}" aria-label="try again">↻</button>` : ''}
        <button class="tn-x" data-del="${esc(j.id)}" aria-label="delete">✕</button>
      </div>`;
    const asked = j.text ? `<div class="tn-asked">${esc(j.text)}</div>` : '';
    let main = '';
    if (j.status === 'queued') main = '<div class="tn-wait">waiting its turn</div>';
    else if (j.status === 'running') {
      main = `<div class="tn-wait run"><span class="an-spin"></span>being made · <b data-since="${esc(j.started_at)}"></b>
        ${j.expect_s ? ` · usually about ${j.expect_s < 60 ? `${j.expect_s} s` : `${Math.round(j.expect_s / 60)} min`}` : ''}</div>`;
    } else if (j.status === 'waiting') main = '<div class="tn-wait off">AI is off — it will be made when AI is back</div>';
    else if (j.status === 'failed') main = `<div class="tn-fail">${esc(j.error || 'it did not work')}</div>`;
    else main = this.result(j);
    return `<div class="tn-card k-${esc(j.kind)} st-${esc(j.status)}">${head}${j.kind === 'ask' || j.status !== 'done' ? asked : ''}${main}</div>`;
  },

  result(j) {
    const files = j.files || [];
    if (j.kind === 'image') {
      const img = files.find((f) => f.type === 'image');
      return `${img ? `<button class="tn-img" data-open="${esc(j.id)}"><img src="${esc(img.url)}" alt="${esc(j.title)}" loading="lazy"></button>` : ''}
        <div class="tn-title">${esc(j.title || j.text)}</div>`;
    }
    if (j.kind === 'video') {
      const v = files.find((f) => f.type === 'video');
      return `${v ? `<video class="tn-vid" src="${esc(v.url)}" controls playsinline preload="metadata"></video>` : ''}
        <div class="tn-title">${esc(j.title || j.text)}</div>
        <button class="tn-more" data-open="${esc(j.id)}">Full screen ›</button>`;
    }
    if (j.kind === 'music') {
      return `<div class="tn-title">🎵 ${esc(j.title || j.text)}</div>
        ${files.filter((f) => f.type === 'audio').map((f, i, all) =>
          `<div class="tn-song">${all.length > 1 ? `<span>Version ${i + 1}</span>` : ''}<audio src="${esc(f.url)}" controls preload="none"></audio></div>`).join('')}
        ${j.body ? `<button class="tn-more" data-open="${esc(j.id)}">Lyrics and details ›</button>` : ''}`;
    }
    const text = j.body || '';
    const rec = RECORDED.includes(j.kind);
    const said = j.utterances?.length ? turns(j.utterances) : md(text);
    return `${j.kind === 'speakers' ? `<div class="tn-voices">👥 ${esc(voices(j))}</div>` : ''}
      <div class="tn-text${rec ? ' tr' : ''}">${said}</div>
      <button class="tn-more" data-open="${esc(j.id)}">${rec ? 'Read it all ›' : 'Full screen ›'}</button>`;
  },

  async remove(id) {
    try { await fetch(`/api/tunai/jobs/${encodeURIComponent(id)}`, { method: 'DELETE' }); } catch { /* the bus says */ }
  },

  async again(id) {
    try {
      const r = await fetch(`/api/tunai/jobs/${encodeURIComponent(id)}/again`, { method: 'POST' });
      if (!r.ok) {
        const j = await r.json().catch(() => ({}));
        this.box?.say(j.error || `it could not be asked again (${r.status})`);
      }
    } catch { this.box?.say('the kitchen server did not answer'); }
  },

  /* ------------------------------------------------- one, full screen -- */

  buildSheet() {
    const el = document.createElement('div');
    el.id = SHEET_ID;
    el.className = 'sheet a-tunai';   // the settings window kit (app.css), in AI's lilac
    el.innerHTML = `
      <header>
        <span class="sheet-icon tn-sicon" aria-hidden="true"></span>
        <div class="sheet-title">
          <h2></h2>
          <span class="sheet-status tn-sstate"></span>
        </div>
        <span class="spacer"></span>
        <button class="ls-close">Close</button>
      </header>
      <div class="ls-body"></div>`;
    document.body.appendChild(el);
    this.sheet = el;
    el.querySelector('.ls-close').onclick = () => this.closeSheet();
  },

  openSheet(id) {
    if (!this.sheet) this.buildSheet();
    this.sheetId = id;
    this.sheet.classList.add('open');
    this.renderSheet(true);
  },

  closeSheet() {
    this.sheet?.querySelectorAll('video, audio').forEach((m) => m.pause());
    this.sheet?.classList.remove('open');
    this.sheetId = null;
  },

  renderSheet(fresh = false) {
    if (!this.sheet?.classList.contains('open')) return;
    const j = this.doc?.jobs.find((x) => x.id === this.sheetId);
    if (!j) { this.closeSheet(); return; }
    if (!fresh) return;                     // never redrawn under a clip playing
    const k = KIND[j.kind] || KIND.ask;
    // The kit's header: the kind's icon in its tile, the title, and a line of
    // what it is and when it was asked.
    this.sheet.querySelector('.tn-sicon').textContent = k.icon;
    this.sheet.querySelector('h2').textContent = j.title || k.word;
    this.ctx?.sheetkit?.status(this.sheet.querySelector('.tn-sstate'),
      `<b>${esc(k.word)}</b>${j.at ? ` · ${esc(when(j.at))}` : ''}`, j.status === 'failed' ? 'warn' : 'ok');
    const files = j.files || [];
    let main = '';
    if (j.kind === 'image') {
      const img = files.find((f) => f.type === 'image');
      main = img ? `<img class="tn-full" src="${esc(img.url)}" alt="${esc(j.title)}">` : '';
    } else if (j.kind === 'video') {
      const v = files.find((f) => f.type === 'video');
      main = v ? `<video class="tn-full" src="${esc(v.url)}" controls autoplay playsinline></video>` : '';
    } else if (j.kind === 'music') {
      main = files.filter((f) => f.type === 'audio').map((f, i, all) =>
        `<div class="tn-song">${all.length > 1 ? `<span>Version ${i + 1}</span>` : ''}<audio src="${esc(f.url)}" controls></audio></div>`).join('');
    }
    this.sheet.querySelector('.ls-body').innerHTML = `
      <div class="tn-sheet">
        ${main}
        ${j.text ? `<div class="tn-asked">${esc(j.text)}</div>` : ''}
        ${j.kind === 'speakers' && j.status === 'done' ? `<div class="tn-voices">👥 ${esc(voices(j))}</div>` : ''}
        ${j.utterances?.length ? `<div class="tn-text full">${turns(j.utterances)}</div>`
          : j.body ? `<div class="tn-text full">${md(j.body)}</div>` : ''}
      </div>`;
  },

  /* Pointer-wired taps, as travel.js does. */
  tap(btn, fn) {
    if (!btn) return;
    let armed = false, x0 = 0, y0 = 0;
    btn.addEventListener('pointerdown', (e) => { armed = true; x0 = e.clientX; y0 = e.clientY; });
    btn.addEventListener('pointerup', (e) => {
      if (!armed) return;
      armed = false;
      if (Math.hypot(e.clientX - x0, e.clientY - y0) > 12) return;
      fn();
    });
    ['pointercancel', 'pointerleave'].forEach((ev) => btn.addEventListener(ev, () => { armed = false; }));
    btn.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); fn(); }
    });
  },
};
