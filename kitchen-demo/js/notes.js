/* Notes for the kitchen agent — two boxes, one way in (2026-10-19).

   Alex: "In the economy tabs, add also open text fields or voice to text
   button where users can speak using built in microphone from the devices
   while AI will do the conversation from voice to text … So users can
   just write text (or voice to text) like Add: kitchen spendings today: 150
   kronors vegetables or Tukey antalya travel: I bought flights for the family
   for 6000 kronors."

   Then, the same day: "have also similar way to enter dates and events to
   calendar, countdown event and school events with free text (and voice to
   text option) … Add a small text box and a microphone under the tabs
   buttons for each tab, but be sure you do not overlap with other buttons".

   So there are two kinds of box, both made by Box below:

   - **the strip** (`mount`), along the bottom of the Economy page on every
     tab: a box to write in, 🎤, Add, and beside them what came of the last
     note — or the agent's question, with Answer;
   - **the quick box** (`mountQuick`), one slim row under the view buttons —
     on House and Economy only since the same evening (Alex: "Lets do 2
     separate boxes … It can stay in Economy and house tab but needs to be
     removed from other tabs", so it is not taken for AI's, which is House
     → AI's own) — for dates and events: the box, 🎤, Add and Notes, in the
     header's own height (the views gave up 10px of theirs for it, so nothing
     under the header moved and no view's own buttons are covered). Too
     narrow for an answer beside it: what came of a note is said inside the
     box for a few seconds, and an open question lights Notes.

   🎤 records on this device and AI writes it down (backend/app/stt.py) —
   or, while AI is away, the kitchen's own English Whisper on the home server.
   The words land in the box to be read and corrected before Add, because a
   misheard figure or date is easier to catch here than on a card. Add hands
   the sentence to the server (agentnotes.py), where it waits for the kitchen
   agent, which writes the spending, the trip cost or the event and answers:
   done, a question (answered with another note), or skipped with why. Notes
   opens the last thirty with their answers, a way to take back one nobody
   has read yet, and, where a device has more than one, which microphone.

   A microphone needs a secure page: https://kitchen.example on a phone
   or a laptop. The wall's Chrome is on http://kitchen.home and is let in by
   a Chrome policy on the wall (wall/install-chrome-policy.sh); without it 🎤
   says so instead of failing silently.

   The evening of the same day the quick box came to Cooking too. Alex: "I
   would like to interact with kitchen agent in the cooking tab … ask about
   recipes or new foods even to suggest food with ingredients that we have at
   home so it will prepare the cooking tab with suggested food". Its notes are
   about `cooking` (layouts.json `notes: "cooking"`). He also asked: "How to
   make so claude code agent instantly answers …? Or have a button at least".
   So the agent now answers by itself: a runner on the workstation starts Claude Code for
   new notes (agent/runner/, the `agent-runner` state). Every box says what
   is happening to its note — sent, the agent on it (with the time), then the
   answer itself, over the quick box for a while. Notes has the switch
   between answering by itself and only when asked, and Answer now.

   Since 2026-10-21 there is a box with no place on the wall: the kitchen's
   Telegram bot (backend/app/telegram.py). What a linked person sends it —
   words, a voice message, a photo, a PDF — is a note with tab `telegram`,
   who sent it (`from`) and its files, and the agent's answer goes back to
   that chat. Notes lists them with the rest, so the household sees what came
   in and what came of it, with the files (opened off the wall, named on it:
   a PDF in a second window there would stay over the kitchen). Such a note
   cannot be taken back here: its sender waits for the answer in Telegram. */

const esc = (s) => String(s ?? '').replace(/[&<>"']/g,
  (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const SHEET_ID = 'an-sheet';
const MIC_STORE = 'kitchen.notes.mic';     // this device's chosen microphone, a deviceId
const TEXT_MAX = 1000;
const HEARD = 0.02;                         // a recording whose loudest moment is under this heard nothing
const SAID_MS = 90000;                      // the strip's own sentences go after this
const SENT_MS = 6000;                       // the quick box's "sent" goes after this
const REPLY_MS = 180000;                    // the agent's answer stays over the quick box this long
const TYPES = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg;codecs=opus'];
const HINT = {
  food: 'Tell the kitchen agent — e.g. “150 kr vegetables at ICA today”',
  travel: 'Tell the kitchen agent — e.g. “Antalya trip: flights for the family, 6 000 kr”',
  calendar: 'A date or event — e.g. “Mormor visits Fri 14 Nov”',
  cooking: 'Ask the kitchen agent — e.g. “dinner tonight from what we have?”',
};
const isPhone = () => document.documentElement.classList.contains('phone');
// A phone's box is a third of the width: the example would be cut mid-word.
const PHONE_HINT = { calendar: 'A date or event…', cooking: 'Ask the kitchen agent…' };
const hintFor = (tab) => (isPhone() && PHONE_HINT[tab]) || HINT[tab] || HINT.food;
const TAB_WORD = { food: 'Food', travel: 'Travel', calendar: 'Calendar', cooking: 'Cooking', telegram: '✈ Telegram',
  paper: '📄 Paperless' };
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const DAY = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

const hm = (d) => `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;

/* "12:40", "yesterday 12:40", "Mon 12 Oct 12:40". */
function when(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const today = new Date();
  const days = Math.round((new Date(today.getFullYear(), today.getMonth(), today.getDate())
    - new Date(d.getFullYear(), d.getMonth(), d.getDate())) / 86400000);
  if (days === 0) return hm(d);
  if (days === 1) return `yesterday ${hm(d)}`;
  return `${DAY[d.getDay()]} ${d.getDate()} ${MON[d.getMonth()]} ${hm(d)}`;
}

/* What came of a note, in a few words. */
function outcome(n, mod) {
  if (n.status === 'new') return mod.waitWords(n);
  if (n.status === 'question') return n.answered ? 'answered — waiting for the agent' : `the agent asks: ${n.reply}`;
  if (n.status === 'skipped') return `not added: ${n.reply}`;
  return n.reply || 'added';
}
const MARK = { new: '⏳', done: '✓', question: '?', skipped: '–' };

/* A note in a few words: its own, or — a file sent to the bot with none —
   the files' names. */
const words = (n) => n.text || (n.files || []).map((f) => f.name).join(', ');

/* "182 KB", "2.4 MB". */
function bytes(b) {
  if (!(b > 0)) return '';
  return b < 1048576 ? `${Math.max(1, Math.round(b / 1024))} KB` : `${(b / 1048576).toFixed(1)} MB`;
}

const clock = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

/* Pointer-wired taps, as travel.js and spending.js do (a knuckle on the wall
   travels far enough for Chrome to drop the click). */
function tap(btn, fn) {
  if (!btn) return;
  let armed = false, x0 = 0, y0 = 0;
  btn.addEventListener('pointerdown', (e) => { armed = true; x0 = e.clientX; y0 = e.clientY; });
  btn.addEventListener('pointerup', (e) => {
    if (!armed) return;
    armed = false;
    if (Math.hypot(e.clientX - x0, e.clientY - y0) > 12) return;
    if (btn.disabled) return;
    fn();
  });
  ['pointercancel', 'pointerleave'].forEach((ev) => btn.addEventListener(ev, () => { armed = false; }));
  btn.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); if (!btn.disabled) fn(); }
  });
}

/* ------------------------------------------------------------- one box -- */

class Box {
  /* kind: 'strip' (Economy), 'quick' (under the views) or 'tunai' (House →
     AI's own input, tunai.js). tabOf: what the note is about, as
     agentnotes.py's TABS — the tab that is up, or 'calendar'. opts, for
     'tunai': submit(text, via) → {error}|{said} in place of a note, label
     (the button's word), hint() (the empty box's example), and audio(blob),
     which while set (Transcribe) makes 🎤 a long recording handed over
     whole instead of words written into the box. */
  constructor(mod, el, kind, tabOf, opts = {}) {
    this.mod = mod;
    this.el = el;
    this.kind = kind;
    this.tabOf = tabOf;
    this.opts = opts;
    this.audio = null;
    this.rec = null;          // the recording under way: {stream, recorder, chunks, ctx, peak, t0, timer}
    this.writing = false;     // AI (or the backup) is writing a recording down
    this.backupOnly = false;  // ...the backup, AI being away
    this.via = 'typed';       // 'voice' once the words in the box came from 🎤
    this.replyTo = null;      // the question note an answer is being written to
    this.mine = null;         // the quick box: the note it sent last, followed until its answer has been shown
    this.mineAt = 0;          // ...when this device first showed that answer
    this.mineSeen = '';       // ...a stage of it somebody tapped away (the next stage shows again)
    this.said = '';           // a sentence of the box's own: an error, "nothing was heard", "sent"
    this.sending = false;
    this.build();
  }

  build() {
    const el = this.el;
    const rec = `
      <div class="an-rec" hidden>
        <span class="an-dot"></span><span class="an-said">Listening</span>
        <span class="an-level"><i></i></span><span class="an-time">0:00</span>
        <button class="an-cancel">Cancel</button>
      </div>`;
    if (this.kind === 'strip') {
      el.innerHTML = `
        <div class="an-strip an-root">
          <div class="an-box">
            <div class="an-re" hidden><span class="an-re-q"></span><button class="an-re-x" aria-label="not answering">✕</button></div>
            <textarea class="an-text" rows="1" maxlength="${TEXT_MAX}" enterkeyhint="send"
              aria-label="a note for the kitchen agent"></textarea>
            ${rec}
          </div>
          <button class="an-mic" aria-label="speak instead of writing">🎤</button>
          <button class="an-add">Add</button>
          <button class="an-last" aria-label="what came of the last note"></button>
          <button class="an-all" aria-label="every note and its answer">Notes</button>
        </div>`;
    } else if (this.kind === 'tunai') {
      el.innerHTML = `
        <div class="qn tn-in an-root">
          <div class="an-box">
            <textarea class="an-text" rows="2" maxlength="2000" enterkeyhint="send"
              aria-label="what AI should make"></textarea>
            <div class="qn-msg" hidden></div>
            ${rec}
          </div>
          <button class="an-mic" aria-label="speak instead of writing">🎤</button>
          <button class="an-add">${esc(this.opts.label || 'Make')}</button>
        </div>`;
    } else {
      el.innerHTML = `
        <div class="qn an-root">
          <div class="an-box">
            <button class="qn-re" hidden aria-label="not answering">↩ answer ✕</button>
            <input class="an-text" type="text" maxlength="${TEXT_MAX}" enterkeyhint="send" autocomplete="off"
              aria-label="a note for the kitchen agent">
            <div class="qn-msg" hidden></div>
            ${rec}
          </div>
          <button class="an-mic" aria-label="speak instead of writing">🎤</button>
          <button class="an-add">Add</button>
          <button class="an-all" aria-label="every note and its answer">Notes</button>
        </div>`;
    }
    this.text = el.querySelector('.an-text');
    this.text.addEventListener('input', () => {
      if (!this.text.value.trim()) this.via = 'typed';
      this.said = '';
      this.grow();
      this.paintButtons();
      this.paintStatus();
    });
    this.text.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); this.add(); }
    });
    this.text.addEventListener('focus', () => this.paintBusy());
    this.text.addEventListener('blur', () => this.paintBusy());
    tap(el.querySelector('.an-mic'), () => (this.rec ? this.stop() : this.listen()));
    tap(el.querySelector('.an-add'), () => this.add());
    tap(el.querySelector('.an-cancel'), () => this.stop(true));
    tap(el.querySelector('.an-re-x'), () => { this.replyTo = null; this.paintRe(); });
    tap(el.querySelector('.qn-re'), () => { this.replyTo = null; this.paintRe(); });
    tap(el.querySelector('.an-all'), () => this.mod.openSheet(this));
    tap(el.querySelector('.an-last'), () => {
      const q = this.mod.question();
      if (q && !this.replyTo && !this.said) this.answer(q); else this.mod.openSheet(this);
    });
    // The message over an empty quick box goes at a tap, and the box is there —
    // unless it carries something to do: Answer now, the agent's question, its answer.
    el.querySelector('.qn-msg')?.addEventListener('pointerdown', (e) => {
      const m = !this.said && this.mineState();
      if (m?.act) {
        e.preventDefault();
        this.mineSeen = m.stage;
        if (m.act === 'ask') this.mod.ask(this);
        else if (m.act === 'answer') { this.mine = null; this.answer(m.note); }
        else { this.mine = null; this.mod.openSheet(this); }
        this.paintStatus();
        return;
      }
      if (m) this.mineSeen = m.stage;
      this.say('');
      this.text.focus();
    });
    this.retab();
  }

  root() { return this.el.querySelector('.an-root'); }

  /* The tab changed (spending.js), or AI's kind: its own example in the
     empty box. */
  retab() {
    if (!this.replyTo) this.text.placeholder = this.opts.hint ? this.opts.hint() : hintFor(this.tabOf());
    this.paintButtons();
    this.paintStatus();
  }

  /* AI's Transcribe: 🎤 records the whole thing for AI to write down,
     and the box is not for typing. null gives the box back. */
  setAudio(fn) {
    if (this.rec) this.stop(true);
    this.audio = fn;
    this.text.disabled = !!fn;
    this.root().classList.toggle('audio', !!fn);
    this.retab();
  }

  /* The page it is on went away: a recording under way is dropped, never sent. */
  leave() {
    if (this.rec) this.stop(true);
    this.say('');
  }

  grow() {
    if (this.kind === 'quick') return;      // one line, in a header of a fixed height
    if (this.kind === 'tunai' && !this.text.value) { this.text.style.height = ''; return; }
    const t = this.text;
    t.style.height = 'auto';
    t.style.height = `${Math.min(t.scrollHeight, 3 * parseFloat(getComputedStyle(t).lineHeight || '24') + 16)}px`;
  }

  /* The wall goes back to its resting view after a while untouched; not from
     under somebody speaking, waiting for AI, or writing (app.js sheetOpen). */
  paintBusy() {
    const writing = document.activeElement === this.text && this.text.value.trim();
    this.root()?.classList.toggle('busy', !!(this.rec || this.writing || writing));
  }

  paintButtons() {
    const mic = this.el.querySelector('.an-mic');
    const add = this.el.querySelector('.an-add');
    mic.classList.toggle('on', !!this.rec);
    mic.disabled = this.writing;
    mic.textContent = this.rec ? '■' : (this.writing ? '…' : '🎤');
    mic.setAttribute('aria-label', this.rec ? 'stop, and let AI write it down' : 'speak instead of writing');
    const ready = this.text.value.trim().length >= 2 && !this.rec && !this.writing && !this.audio
      && !(this.opts.blocked && this.opts.blocked());
    add.disabled = !ready;
    add.classList.toggle('ready', ready);
    add.textContent = this.replyTo ? 'Answer' : (this.opts.label || 'Add');
    add.hidden = !!this.audio;
    this.paintBusy();
  }

  paintRe() {
    if (this.kind === 'strip') {
      const box = this.el.querySelector('.an-re');
      box.hidden = !this.replyTo;
      if (this.replyTo) box.querySelector('.an-re-q').textContent = `Answering: ${this.replyTo.reply}`;
    } else {
      // No room for a line over it: the question is the empty box's prompt.
      this.el.querySelector('.qn-re').hidden = !this.replyTo;
      this.text.placeholder = this.replyTo ? `Answer: ${this.replyTo.reply}` : hintFor(this.tabOf());
    }
    this.paintButtons();
  }

  paintStatus() {
    if (this.kind === 'strip') this.paintLast(); else this.paintMsg();
  }

  /* The strip, beside the box: its own sentence, else the agent's open
     question, else what came of the newest note. */
  paintLast() {
    const btn = this.el.querySelector('.an-last');
    if (!btn || this.writing) return;
    const d = this.mod.doc;
    const notes = d?.notes || [];
    this.el.querySelector('.an-all').textContent = d?.waiting ? `Notes · ${d.waiting} waiting` : 'Notes';
    btn.className = 'an-last';
    if (this.said) {
      btn.classList.add('warn');
      btn.innerHTML = `<span class="an-line">${esc(this.said)}</span>`;
      return;
    }
    const q = this.mod.question();
    if (q && !this.replyTo) {
      btn.classList.add('ask');
      btn.innerHTML = `<span class="an-line"><b>The agent asks:</b> ${esc(q.reply)}
        <i>· about “${esc(words(q))}”</i></span><span class="an-go">Answer ›</span>`;
      return;
    }
    const n = notes[notes.length - 1];
    if (!n) {
      btn.innerHTML = '<span class="an-line an-quiet">The kitchen agent reads what is added here and puts it on Economy</span>';
      return;
    }
    const working = n.status === 'new' && this.mod.workingOn(n.id);
    btn.classList.add(`st-${n.status}`);
    btn.classList.toggle('writing', working);
    btn.innerHTML = `<span class="an-line">${working ? '<span class="an-spin"></span>'
      : `<span class="an-mark">${MARK[n.status] || ''}</span>`}
      <span class="an-when">${esc(when(n.at))}</span> “${esc(words(n))}” — ${esc(outcome(n, this.mod))}${working
        ? ` <b data-agent-since="${esc(this.mod.agent.since || '')}"></b>` : ''}</span>`;
    this.mod.paintSince(btn);
  }

  /* The quick box: a sentence of its own over the empty box, and Notes lit
     while the agent has a question nobody has answered. */
  paintMsg() {
    const all = this.el.querySelector('.an-all');
    const q = this.mod.question();
    if (all) {
      all.classList.toggle('ask', !!q);
      all.innerHTML = q ? 'Notes <b>?</b>' : 'Notes';
      all.setAttribute('aria-label', q ? 'every note — the kitchen agent has a question' : 'every note and its answer');
    }
    if (this.writing) return;
    const msg = this.el.querySelector('.qn-msg');
    const m = this.said ? null : this.mineState();
    const html = this.said ? esc(this.said) : m && m.stage !== this.mineSeen ? m.html : '';
    const show = !!html && !this.text.value.trim() && !this.rec;
    msg.hidden = !show;
    msg.className = `qn-msg${(this.said ? this.saidKind : m?.kind) ? ` ${this.said ? this.saidKind : m.kind}` : ''}`;
    if (show) {
      msg.innerHTML = `<span class="qn-line">${html}</span>`;
      this.mod.paintSince(msg);
    }
  }

  /* The quick box's last note, while it is news: sent and waiting, the agent
     on it, then its answer for REPLY_MS. `act` is what a tap on it does;
     `stage` tells a stage somebody tapped away from the next one. */
  mineState() {
    if (!this.mine || this.kind !== 'quick') return null;
    const mod = this.mod;
    const n = (mod.doc?.notes || []).find((x) => x.id === this.mine);
    if (!n) { this.mine = null; return null; }
    if (n.status === 'new') {
      if (mod.workingOn(n.id)) {
        return { stage: 'working', kind: 'writing', note: n,
          html: `<span class="an-spin"></span>The kitchen agent is on it · <b data-agent-since="${esc(mod.agent.since || '')}"></b>` };
      }
      const a = mod.agent;
      const now = mod.online() && a.state === 'idle' && (a.mode === 'asked' || n.runs > 0);
      const words = !now ? mod.waitWords(n).replace(/^waiting — /, '')
        : a.mode === 'asked' ? 'the kitchen agent answers when asked' : 'the kitchen agent did not answer it';
      return { stage: `new${n.runs}${now ? 'now' : ''}`, kind: 'ok', note: n, act: now ? 'ask' : '',
        html: `✓ Sent — ${esc(words)}${now ? ' <b class="qn-go">Answer now ›</b>' : ''}` };
    }
    if (!this.mineAt) {
      this.mineAt = Date.now();
      setTimeout(() => this.paintStatus(), REPLY_MS + 500);
    }
    if (Date.now() - this.mineAt > REPLY_MS) { this.mine = null; return null; }
    if (n.status === 'question') {
      return { stage: 'question', kind: 'ask', note: n, act: n.answered ? 'sheet' : 'answer',
        html: `<b>The agent asks:</b> ${esc(n.reply)} <b class="qn-go">Answer ›</b>` };
    }
    return { stage: n.status, kind: n.status === 'skipped' ? '' : 'reply', note: n, act: 'sheet',
      html: `${n.status === 'skipped' ? '– ' : '✓ '}${esc(n.reply || 'done')}` };
  }

  /* A sentence of the box's own, for a while: an error from an hour ago is
     not news. `kind` 'ok' for good news (the quick box's "sent"). */
  say(words, kind = '') {
    this.said = words;
    this.saidKind = words ? kind : '';
    clearTimeout(this.saidTimer);
    if (words) this.saidTimer = setTimeout(() => this.say(''), kind === 'ok' ? SENT_MS : SAID_MS);
    this.paintStatus();
  }

  answer(q) {
    this.replyTo = q;
    this.say('');
    this.paintRe();
    this.text.focus();
  }

  async add() {
    const text = this.text.value.trim();
    if (text.length < 2 || this.rec || this.writing || this.sending) return;
    this.sending = true;
    if (this.opts.submit) {
      try {
        const res = await this.opts.submit(text, this.via);
        if (res?.error) { this.say(res.error); return; }
        this.text.value = '';
        this.via = 'typed';
        this.grow();
        this.text.blur();
        this.say(res?.said || '', 'ok');
      } finally {
        this.sending = false;
        this.paintButtons();
      }
      return;
    }
    const body = {
      text, tab: this.tabOf(), via: this.via, device: isPhone() ? 'phone' : 'screen',
      ...(this.replyTo ? { re: this.replyTo.id } : {}),
    };
    try {
      const r = await fetch('/api/agent-notes', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) { this.say(j.error || `the note could not be added (${r.status})`); return; }
      this.text.value = '';
      this.via = 'typed';
      this.replyTo = null;
      this.grow();
      this.paintRe();
      this.text.blur();
      if (j.note) {
        this.mine = j.note.id;
        this.mineAt = 0;
        this.mineSeen = '';
        this.mod.took(j);
      }
      this.say('');
    } catch {
      this.say('the kitchen server did not answer — the note was not added');
    } finally {
      this.sending = false;
      this.paintButtons();
    }
  }

  /* -------------------------------------------------------- the voice -- */

  async listen() {
    if (this.rec || this.writing) return;
    if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) {
      this.say(window.isSecureContext
        ? 'this browser cannot record — type the note instead'
        : 'the microphone is not allowed on this page (it is not https) — type the note, or open https://kitchen.example');
      return;
    }
    this.mod.stopOthers(this);
    this.say('');
    // A recording for AI to write down whole: it waits in AI's queue
    // if AI is away, so there is nothing to ask first.
    if (this.audio) { this.maxS = this.opts.longMaxS || 1800; this.backupOnly = false; }
    // AI first: nobody should speak for half a minute into a recording
    // that has nowhere to go.
    else try {
      const s = await (await fetch('/api/stt')).json();
      // AI away: the home server's own English Whisper writes it down instead.
      this.backupOnly = s.up === false && s.backup === true;
      if (s.up === false && !this.backupOnly) {
        this.say(s.backup === false
          ? 'neither AI nor the kitchen\'s backup is answering — type the note instead'
          : `AI is ${s.why || 'not answering'} — the microphone needs it; type the note instead`);
        return;
      }
      this.maxS = Number(s.max_s) || 120;
    } catch {
      this.say('the kitchen server did not answer');
      return;
    }
    let stream;
    const chosen = this.mod.savedMic();
    const want = (id) => ({
      audio: { ...(id ? { deviceId: { exact: id } } : {}), echoCancellation: true, noiseSuppression: true, autoGainControl: true },
    });
    try {
      stream = await navigator.mediaDevices.getUserMedia(want(chosen));
    } catch (e) {
      let err = e;
      if (chosen && (e.name === 'OverconstrainedError' || e.name === 'NotFoundError')) {
        this.mod.saveMic('');          // the chosen one is gone: this device's default
        try { stream = await navigator.mediaDevices.getUserMedia(want('')); } catch (e2) { err = e2; }
      }
      if (!stream) {
        this.say(err.name === 'NotAllowedError' ? 'the microphone was not allowed — allow it for this page, or type the note'
          : err.name === 'NotFoundError' ? 'this device has no microphone — type the note instead'
            : `the microphone could not start (${err.name || err.message})`);
        return;
      }
    }
    await this.mod.listMics();
    const type = TYPES.find((t) => MediaRecorder.isTypeSupported?.(t)) || '';
    let recorder;
    try {
      recorder = new MediaRecorder(stream, type ? { mimeType: type, audioBitsPerSecond: 32000 } : undefined);
    } catch {
      stream.getTracks().forEach((t) => t.stop());
      this.say('this browser cannot record — type the note instead');
      return;
    }
    const rec = { stream, recorder, chunks: [], peak: 0, t0: Date.now(), dropped: false };
    this.rec = rec;
    recorder.ondataavailable = (e) => { if (e.data?.size) rec.chunks.push(e.data); };
    recorder.onstop = () => this.finish(rec);
    recorder.start(250);
    // How loud, as a bar: the proof the microphone hears anything at all.
    try {
      rec.ctx = new AudioContext();
      const an = rec.ctx.createAnalyser();
      an.fftSize = 1024;
      rec.ctx.createMediaStreamSource(stream).connect(an);
      const buf = new Float32Array(an.fftSize);
      const bar = this.el.querySelector('.an-level i');
      const draw = () => {
        if (this.rec !== rec) return;
        an.getFloatTimeDomainData(buf);
        let sum = 0;
        for (const v of buf) sum += v * v;
        const rms = Math.sqrt(sum / buf.length);
        rec.peak = Math.max(rec.peak, rms);
        bar.style.width = `${Math.min(100, rms * 400).toFixed(0)}%`;
        rec.raf = requestAnimationFrame(draw);
      };
      draw();
    } catch { rec.peak = 1; /* no meter; let AI judge */ }
    rec.timer = setInterval(() => {
      const s = (Date.now() - rec.t0) / 1000;
      this.el.querySelector('.an-time').textContent = clock(s);
      if (s >= this.maxS) this.stop();
    }, 250);
    const label = stream.getAudioTracks()[0]?.label || '';
    this.el.querySelector('.an-said').textContent = this.audio ? 'Recording for AI — tap ■ when done'
      : this.backupOnly ? 'Listening — in English: AI is off'
      : this.mod.mics.length > 1 && label ? `Listening · ${label}` : 'Listening — tap ■ when done';
    this.el.querySelector('.an-rec').hidden = false;
    this.root().classList.add('recording');
    this.paintButtons();
    this.paintStatus();
  }

  /* ■: AI writes it down. Cancel (or leaving the page): dropped. */
  stop(drop = false) {
    const rec = this.rec;
    if (!rec) return;
    rec.dropped = drop;
    this.rec = null;
    clearInterval(rec.timer);
    cancelAnimationFrame(rec.raf);
    try { rec.recorder.state !== 'inactive' ? rec.recorder.stop() : this.finish(rec); } catch { this.finish(rec); }
    rec.stream.getTracks().forEach((t) => t.stop());
    rec.ctx?.close().catch(() => {});
    this.el.querySelector('.an-rec').hidden = true;
    this.root().classList.remove('recording');
    this.paintButtons();
    this.paintStatus();
  }

  /* While AI writes: the strip says it beside the box, the quick box in it. */
  paintWriting() {
    const words = this.backupOnly
      ? 'AI is off — the kitchen\'s English backup is writing it down (a few seconds)…'
      : 'AI is writing it down…';
    if (this.kind === 'strip') {
      const btn = this.el.querySelector('.an-last');
      btn.className = 'an-last writing';
      btn.innerHTML = `<span class="an-line"><span class="an-spin"></span>${words}</span>`;
    } else {
      const msg = this.el.querySelector('.qn-msg');
      msg.hidden = false;
      msg.className = 'qn-msg writing';
      msg.innerHTML = `<span class="an-spin"></span>${words}`;
    }
  }

  async finish(rec) {
    if (rec.finished) return;
    rec.finished = true;
    if (rec.dropped) return;
    if (rec.peak < HEARD) {
      this.say('nothing was heard — is the microphone muted? Try again, or type the note');
      return;
    }
    const blob = new Blob(rec.chunks, { type: rec.recorder.mimeType || 'audio/webm' });
    if (this.audio) {
      const res = await this.audio(blob).catch(() => ({ error: 'the kitchen server did not answer' }));
      if (res?.error) this.say(res.error); else this.say(res?.said || '', 'ok');
      return;
    }
    this.writing = true;
    this.said = '';
    this.paintButtons();
    this.paintWriting();
    try {
      const r = await fetch('/api/stt', {
        method: 'POST', headers: { 'Content-Type': (blob.type || 'audio/webm').split(';')[0] }, body: blob,
      });
      const j = await r.json().catch(() => ({}));
      this.writing = false;
      if (!r.ok) { this.say(j.error || `AI could not write it down (${r.status})`); return; }
      if (!j.text) {
        this.say(`${j.by === 'backup' ? 'the backup' : 'AI'} heard no words — try again closer to the microphone, or type the note`);
        return;
      }
      const before = this.text.value.trim();
      this.text.value = before ? `${before} ${j.text}` : j.text;
      this.via = 'voice';
      this.grow();
      this.say(j.by === 'backup' ? 'written by the kitchen\'s English backup (AI is off) — read it over before Add' : '');
    } catch {
      this.writing = false;
      this.say('the kitchen server did not answer — try again, or type the note');
    } finally {
      this.writing = false;
      this.paintButtons();
      this.paintStatus();
    }
  }
}

/* ------------------------------------------------------------ the module -- */

export default {
  doc: null,          // the `agent-notes` summary: the last thirty notes, oldest first
  strip: null,        // Economy's box (spending.js)
  quick: null,        // the box under the views (app.js)
  mics: [],           // this device's microphones, once the browser has named them
  sheetFrom: null,    // the box whose Notes opened the sheet: Answer goes back to it
  more: {},           // the sheet's folded cards left open, kept across redraws
  agent: null,        // the runner on the workstation (`agent-runner`): there or not, and working on what
  agentAt: 0,         // ...when that came, by this device's clock
  quickTab: 'calendar',

  init(ctx) {
    if (this.ctx) return;           // app.js and spending.js both ask
    this.ctx = ctx;
    ctx.bus.on('agent-notes', (doc) => this.absorb(doc));
    ctx.bus.on('agent-runner', (doc) => this.absorbAgent(doc));
    fetch('/api/agent-notes?limit=30').then((r) => (r.ok ? r.json() : null))
      .then((doc) => { if (doc && !this.doc) this.absorb(doc); })
      .catch(() => { /* the bus brings it */ });
    fetch('/api/agent-runner').then((r) => (r.ok ? r.json() : null))
      .then((doc) => { if (doc && !this.agent) this.absorbAgent(doc); })
      .catch(() => { /* the bus brings it */ });
    // The time the agent has been at it, and the moment it goes quiet.
    setInterval(() => {
      const on = this.online();
      if (on !== this.wasOnline) { this.wasOnline = on; this.repaint(); } else this.paintSince(document);
    }, 1000);
  },

  absorbAgent(doc) {
    // Only a whole runner document (runner_summary): a preview answers a PUT with {}.
    if (!doc || typeof doc !== 'object' || !doc.state) return;
    this.agent = doc;
    this.agentAt = Date.now();
    this.wasOnline = this.online();
    this.repaint();
  },

  repaint() {
    for (const b of this.boxes()) b.paintStatus();
    this.renderSheet();
  },

  /* The runner has been heard from lately: counted on from what the server
     said, with this device's own clock, so no two clocks are compared. */
  online() {
    const a = this.agent;
    if (!a || a.seen_ago == null) return false;
    return a.seen_ago + (Date.now() - this.agentAt) / 1000 < (a.online_s || 45);
  },

  workingOn(id) {
    return this.online() && this.agent.state === 'working' && (this.agent.notes || []).includes(id);
  },

  /* Whether this screen is the wall, which only the server knows (night.js,
     as schoolboard.js asks it); without night.js, the wall — the side that
     cannot strand a PDF over the kitchen. */
  onWall() {
    const n = this.ctx?.night;
    return n ? n.onWall() : true;
  },

  paintSince(root) {
    root?.querySelectorAll?.('[data-agent-since]').forEach((e) => {
      const t = Date.parse(e.dataset.agentSince);
      e.textContent = Number.isNaN(t) ? '' : clock(Math.max(0, (Date.now() - t) / 1000));
    });
  },

  /* A note nobody has answered yet: what happens next. */
  waitWords(n) {
    const a = this.agent;
    if (this.workingOn(n.id)) return 'the kitchen agent is on it…';
    if (!this.online()) return 'waiting — the kitchen agent\'s computer (the workstation) is not answering';
    if (a.state === 'paused') return `waiting — the kitchen agent is paused until ${hm(new Date(a.paused_until))}`;
    if (a.state === 'working') return 'waiting — the kitchen agent is answering another note first';
    if (a.mode === 'auto' && !n.runs) return 'waiting — the kitchen agent answers in a minute or two';
    if (a.mode === 'auto') return 'not answered — tap Answer now to try again';
    return 'waiting — tap Answer now';
  },

  /* The sheet's first line: where the agent is, and what it does. */
  agentLine() {
    const a = this.agent;
    if (!a) return 'The kitchen agent has not been heard from';
    if (!this.online()) {
      return 'The kitchen agent is away: its computer (the workstation) is off or its runner has stopped. Notes wait for it.';
    }
    if (a.state === 'working') {
      return `The kitchen agent is answering ${a.notes.length === 1 ? 'a note' : `${a.notes.length} notes`} · `
        + `<b data-agent-since="${esc(a.since || '')}"></b>`;
    }
    if (a.state === 'paused') return `The kitchen agent is paused until ${hm(new Date(a.paused_until))}: ${esc(a.why)}`;
    const last = a.last?.at ? ` Last answered ${esc(when(a.last.at))}${a.last.took_s ? ` in ${a.last.took_s} s` : ''}.` : '';
    return (a.mode === 'auto' ? 'The kitchen agent answers every new note by itself, in a minute or two.'
      : 'The kitchen agent answers when somebody taps Answer now.') + last;
  },

  /* Answer now: every waiting note goes to the agent's next run. */
  async ask(box) {
    try {
      const r = await fetch('/api/agent-runner/ask', { method: 'POST' });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) { (box || this.sheetFrom || this.quick)?.say(j.error || `the agent could not be asked (${r.status})`); return; }
      this.absorbAgent(j);
    } catch { (box || this.sheetFrom || this.quick)?.say('the kitchen server did not answer'); }
  },

  async setMode(mode) {
    try {
      const r = await fetch('/api/agent-runner', {
        method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ mode }),
      });
      if (r.ok) this.absorbAgent(await r.json());
    } catch { /* the sheet shows what the server has */ }
  },

  boxes() { return [this.strip, this.quick, ...this.others].filter(Boolean); },
  others: [],         // other modules' boxes: House → AI's input (tunai.js)

  absorb(doc) {
    if (!doc || !Array.isArray(doc.notes)) return;
    this.doc = doc;
    for (const b of this.boxes()) {
      if (b.replyTo && !doc.notes.some((n) => n.id === b.replyTo.id && n.status === 'question')) {
        b.replyTo = null;
        b.paintRe();
      }
      b.paintStatus();
    }
    this.renderSheet();
  },

  /* A note just added, before the bus says so. */
  took(j) {
    if (this.doc && !this.doc.notes.some((n) => n.id === j.note.id)) {
      this.absorb({ ...this.doc, notes: [...this.doc.notes, j.note], waiting: j.waiting });
    }
  },

  /* Economy's strip (spending.js), and its tab. */
  mount(el, tabOf) { this.strip = new Box(this, el, 'strip', tabOf); },
  retab() { this.strip?.retab(); },
  leave() {
    this.strip?.leave();
    if (this.sheetFrom === this.strip) this.closeSheet();
  },

  /* The box under the views (app.js) — on the views whose layouts.json entry
     has `notes`: `true` for dates and events (House and Economy), or what its
     notes are about (Cooking: "cooking"). Elsewhere its row stays, empty, so
     the view buttons never move. */
  mountQuick(el) {
    this.quick = new Box(this, el, 'quick', () => this.quickTab);
    this.showQuick(this.quickOn ?? true);
  },
  showQuick(on) {
    this.quickOn = !!on;
    this.quickTab = typeof on === 'string' ? on : 'calendar';
    if (!this.quick) return;
    this.quick.el.classList.toggle('off', !on);
    if (!on) this.quick.leave(); else this.quick.retab();
  },

  /* Another module's input with the same box and 🎤 (tunai.js). */
  mountBox(el, opts) {
    const box = new Box(this, el, 'tunai', () => 'tunai', opts);
    this.others.push(box);
    return box;
  },

  /* One microphone at a time: a second box's 🎤 drops the first's recording. */
  stopOthers(box) {
    for (const b of this.boxes()) if (b !== box && b.rec) b.stop(true);
  },

  /* The newest question nobody has answered yet. */
  question() {
    return [...(this.doc?.notes || [])].reverse().find((n) => n.status === 'question' && !n.answered) || null;
  },

  /* ------------------------------------------------------- microphones -- */

  savedMic() {
    try { return localStorage.getItem(MIC_STORE) || ''; } catch { return ''; }
  },

  saveMic(id) {
    try { if (id) localStorage.setItem(MIC_STORE, id); else localStorage.removeItem(MIC_STORE); } catch { /* private */ }
  },

  /* Named only once the microphone has been allowed on this page. */
  async listMics() {
    try {
      const all = await navigator.mediaDevices.enumerateDevices();
      this.mics = all.filter((d) => d.kind === 'audioinput' && d.deviceId && d.deviceId !== 'default'
        && d.deviceId !== 'communications' && d.label);
    } catch { this.mics = []; }
    this.renderSheet();
  },

  /* ------------------------------------------------------------ the sheet -- */

  buildSheet() {
    const el = document.createElement('div');
    el.id = SHEET_ID;
    el.className = 'sheet';   // the settings window kit (app.css)
    el.innerHTML = `
      <header>
        <span class="sheet-icon" aria-hidden="true">📝</span>
        <div class="sheet-title">
          <h2>Notes for the kitchen agent</h2>
          <span class="sheet-status an-state"></span>
        </div>
        <span class="spacer"></span>
        <button class="ls-close">Close</button>
      </header>
      <div class="ls-body"></div>`;
    document.body.appendChild(el);
    this.sheet = el;
    this.sheetBody = el.querySelector('.ls-body');
    this.stateEl = el.querySelector('.an-state');
    el.querySelector('.ls-close').onclick = () => this.closeSheet();
  },

  /* The sheet's header line: where the agent is and what is waiting, in a
     few words, with the kit's tone — answering now (live), away or never
     heard from (warn), paused (off). */
  sheetState() {
    const a = this.agent;
    const w = this.doc?.waiting || 0;
    const waiting = w ? `${w} ${w === 1 ? 'note' : 'notes'} waiting` : 'nothing waiting';
    if (!a) return ['<b>Not heard from</b> · notes wait for it', 'warn'];
    if (!this.online()) return [`<b>Away</b> · its computer (the workstation) is not answering · ${waiting}`, 'warn'];
    if (a.state === 'working') {
      return [`<b>Answering</b> ${a.notes.length === 1 ? 'a note' : `${a.notes.length} notes`} · `
        + `<span data-agent-since="${esc(a.since || '')}"></span>`, 'live'];
    }
    if (a.state === 'paused') return [`<b>Paused</b> until ${hm(new Date(a.paused_until))} · ${waiting}`, 'off'];
    return [`<b>${a.mode === 'auto' ? 'Answers by itself' : 'Answers when asked'}</b> · ${waiting}`, 'ok'];
  },

  openSheet(from) {
    if (!this.sheet) this.buildSheet();
    this.sheetFrom = from || this.quick;
    this.sheet.classList.add('open');
    if (navigator.mediaDevices?.enumerateDevices) this.listMics(); else this.renderSheet();
  },

  closeSheet() { this.sheet?.classList.remove('open'); },

  renderSheet() {
    if (!this.sheet?.classList.contains('open')) return;
    const notes = [...(this.doc?.notes || [])].reverse();
    // A Telegram note's files: a link off the wall, only their names on it.
    const onWall = this.onWall();
    const files = (n) => ((n.files || []).length ? `<div class="an-files">${n.files.map((f) => {
      const label = `📎 ${esc(f.name)}${f.size ? ` <i>${esc(bytes(f.size))}</i>` : ''}`;
      if (f.gone || !f.path) return `<span class="an-file gone">${label} <i>let go</i></span>`;
      return onWall ? `<span class="an-file">${label}</span>`
        : `<a class="an-file" href="${esc(f.path)}" target="_blank" rel="noopener">${label}</a>`;
    }).join('')}</div>` : '');
    const rows = notes.length ? notes.map((n) => `
      <div class="an-note st-${esc(n.status)}">
        <div class="an-nhead">
          <span class="an-mark">${MARK[n.status] || ''}</span>
          <span class="an-when">${esc(when(n.at))}</span>
          <span class="an-where">${esc([TAB_WORD[n.tab], n.from ? `from ${n.from}` : '',
            n.via === 'voice' ? '🎤 spoken' : '', n.device === 'phone' ? 'from a phone' : '',
            n.forwarded ? `forwarded from ${n.forwarded}` : ''].filter(Boolean).join(' · '))}</span>
          <span class="spacer"></span>
          ${n.status === 'new' && n.tab !== 'telegram' ? `<button class="ls-btn sheet-danger an-back" data-id="${esc(n.id)}">Take back</button>` : ''}
          ${n.status === 'question' && !n.answered ? `<button class="ls-btn an-ans" data-id="${esc(n.id)}">Answer</button>` : ''}
        </div>
        ${n.re_of ? `<div class="an-reof">answering “${esc(n.re_of.reply || n.re_of.text)}”</div>` : ''}
        ${n.text ? `<div class="an-ntext">${esc(n.text)}</div>` : ''}
        ${files(n)}
        <div class="an-nout">${n.status === 'new' && this.workingOn(n.id) ? '<span class="an-spin"></span>' : ''}${esc(outcome(n, this))}${n.handled_at && n.status !== 'new' ? ` <i>${esc(when(n.handled_at))}</i>` : ''}</div>
      </div>`).join('') : '<div class="an-none">No notes yet</div>';
    const kit = this.ctx.sheetkit;
    const a = this.agent;
    const auto = (a?.mode || 'auto') === 'auto';
    const canAsk = this.online() && a.state === 'idle' && (this.doc?.waiting || 0) > 0;
    const w = this.doc?.waiting || 0;
    kit.status(this.stateEl, ...this.sheetState());
    // The cards' notes, read right after their headings.
    const agentNote = !a ? 'not heard from' : !this.online() ? 'away'
      : a.state === 'working' ? 'answering now' : a.state === 'paused' ? 'paused'
      : auto ? 'answers by itself' : 'answers when asked';
    // The agent: where it is, how it answers (a setting), and Answer now (an
    // action) on a row of its own, so the two are never read as one choice.
    const agent = kit.sec('The kitchen agent', `
      <p class="an-aline">🤖 ${this.agentLine()}</p>
      <div class="ls-row">
        <span class="ls-label">Answers
          <span class="db-hint">By itself it starts as soon as a note comes in; When asked, it waits
            for Answer now.</span></span>
        <span class="ls-set sheet-seg an-mode">
          <button class="ls-btn${auto ? ' on' : ''}" data-mode="auto" aria-pressed="${auto}">By itself</button>
          <button class="ls-btn${auto ? '' : ' on'}" data-mode="asked" aria-pressed="${!auto}">When asked</button>
        </span>
      </div>
      <div class="ls-row">
        <span class="ls-label">Waiting to be read <b class="an-wait${w ? ' some' : ''}">${
          w ? `${w} ${w === 1 ? 'note' : 'notes'}` : 'nothing'}</b></span>
        <span class="ls-set an-acts">
          <button class="ls-btn sheet-primary an-now"${canAsk ? '' : ' disabled'}>Answer now</button>
        </span>
      </div>`, { note: agentNote, cls: `an-agent${this.online() ? '' : ' away'}` });
    const saved = this.savedMic();
    const savedMic = this.mics.find((m) => m.deviceId === saved);
    const mics = this.mics.length > 1 ? kit.sec('This screen', `
      <div class="ls-row an-mics">
        <span class="ls-label">Microphone on this screen
          <span class="db-hint">which one 🎤 records from here; kept on this device only</span></span>
        <span class="ls-set sheet-seg">
          <button class="ls-btn${saved ? '' : ' on'}" data-mic="" aria-pressed="${!saved}">Its default</button>
          ${this.mics.map((m) => `<button class="ls-btn${saved === m.deviceId ? ' on' : ''}" data-mic="${esc(m.deviceId)}"
            aria-pressed="${saved === m.deviceId}">${esc(m.label)}</button>`).join('')}
        </span>
      </div>`, { note: savedMic ? savedMic.label : saved ? '' : 'its default' }) : '';
    // What the notes are, at length: reference, folded until asked for.
    const about = kit.more('about', 'What the notes do', `
      <p class="sheet-note an-about">What is written or said in the box under the views (House, Economy and
        Cooking), or under Economy, goes to the kitchen agent — Claude Code on the workstation. It puts a date
        on the calendar, the countdown or the school board, adds the spending or the trip cost,
        answers a question about food or puts dinners on the Cooking tab, and answers each note:
        done, or a question, answered with another note.
        What a linked phone sends the kitchen's Telegram bot — words, a voice message, a photo of a
        receipt, a letter as a PDF — is a note here too (✈ Telegram), and its answer goes back to
        that chat.</p>`, !!this.more.about);
    const list = kit.sec('Notes', `
      <p class="sheet-note">A note can be taken back until it has been read.</p>
      <div class="an-notes">${rows}</div>`,
    { note: !notes.length ? 'none yet' : notes.length === 1 ? 'one note' : `the last ${notes.length}, newest first` });
    this.sheetBody.innerHTML = `${agent}${mics}${about}${list}`;
    this.paintSince(this.sheet);
    this.sheetBody.querySelectorAll('details[data-more]').forEach((d) => {
      d.ontoggle = () => { this.more[d.dataset.more] = d.open; kit.sync(this.sheet); };
    });
    tap(this.sheetBody.querySelector('.an-now'), () => this.ask());
    this.sheetBody.querySelectorAll('[data-mode]').forEach((b) => tap(b, () => this.setMode(b.dataset.mode)));
    this.sheetBody.querySelectorAll('.an-back').forEach((b) => tap(b, () => this.takeBack(b.dataset.id)));
    this.sheetBody.querySelectorAll('.an-ans').forEach((b) => tap(b, () => {
      const q = (this.doc?.notes || []).find((n) => n.id === b.dataset.id);
      const box = this.sheetFrom || this.quick;
      this.closeSheet();
      if (q && box) box.answer(q);
    }));
    this.sheetBody.querySelectorAll('[data-mic]').forEach((b) => tap(b, () => {
      this.saveMic(b.dataset.mic);
      this.renderSheet();
    }));
    kit.sync(this.sheet);
  },

  async takeBack(id) {
    const box = this.sheetFrom || this.quick;
    try {
      const r = await fetch(`/api/agent-notes/${encodeURIComponent(id)}`, { method: 'DELETE' });
      if (!r.ok) {
        const j = await r.json().catch(() => ({}));
        box?.say(j.error || `it could not be taken back (${r.status})`);
      }
    } catch { box?.say('the kitchen server did not answer'); }
  },
};
