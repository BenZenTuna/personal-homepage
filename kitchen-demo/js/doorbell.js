/* The doorbell: the sound the wall makes when the entrance door opens, and
   the sheet that says what else should happen when it does.

   Not a panel, for one reason: **the doorbell has to ring whichever view is
   up.** A panel only exists while its view is on screen, and a bell that went
   quiet because somebody left the wall on Photos would be a bell nobody
   trusts. So this lives beside motionbar and the Time sheet — built once at
   boot, subscribed to the bus for the whole life of the page.

   The card on the House panel is panels/ha.js's, and it is only a card: it
   reads the document this module keeps and hands the taps back here. */

/* The sounds, the quiet hours and the volume bands are sound.js's now: the
   clock strikes the hour under the same rules, and the two going out of step
   would show up as one of them ringing in the night. The sounds themselves
   are split between them since 2026-10-03 — the five bells are the door's,
   the creatures the clock's — so a bell on the wall always means the door. */
/* How long the door may stand open before the rooms start asking for it to be
   shut. The same four numbers the server will accept (OPEN_ALERT_MIN in
   backend/app/doorbell.py); anything else it writes down as 0. */
const OPEN_ALERT = [[0, 'Off'], [30, '30 min'], [60, '1 hour'], [120, '2 hours']];

const STYLES = [['blink', 'Blink'], ['flash', 'Flash'], ['fade', 'Fade'], ['breathe', 'Breathe']];

/* How old a ring may be and still be worth playing to a page that has only
   just opened. See shouldRing: this is the whole of "wake the wall for the
   doorbell", because a wall woken by the door is a wall that boots up *after*
   the ring it was woken for. A minute is long enough for a suspend to thaw,
   Wi-Fi to come back and the page to reload (wake.js settles for eight
   seconds and then checks the server twice), and short enough that a ring
   nobody is still at the door for is not replayed. */
const FRESH_S = 60;

const esc = (s) => String(s ?? '').replace(/[&<>"]/g,
  (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

/* Loaded with the build stamp like every other module — a bare import from
   here would not carry it, and the wall would go on running last deploy's
   rules after this one's arrived. app.js hands it over in init(). */
let snd = null;

export default {
  /* The document the server keeps, as it last arrived. `null` until the first
     snapshot, which is not the same as a server without a doorbell in it —
     that one answers with `configured: false`. */
  doc: null,

  /* These three are the object's own and are NOT set up in init(), because
     the House panel is built before init() runs and subscribes to this on the
     way past: a `this.subs = []` in there would throw its subscription away,
     and the card would then sit hidden for ever while the document arrived
     perfectly well behind it. */
  subs: [],
  lastRingAt: null,         // the newest ring this page knows about
  seen: false,              // ...and whether it has seen the server at all yet

  init(ctx, sound) {
    this.ctx = ctx;
    snd = sound;
    this.player = sound.player();
    this.buildSheet();
    // Its uploaded sounds and its text (2026-10-18) redraw the sheet as they change.
    ctx.soundlib?.onChange(() => this.render());
    ctx.voice?.onChange(() => this.render());

    ctx.bus.on('doorbell', (doc) => {
      if (!doc || typeof doc !== 'object') return;
      const fresh = this.shouldRing(doc);
      this.doc = doc;
      if (fresh) this.play(doc.settings?.sound);
      this.changed();
    });
  },

  /* Is this document a ring this page has not already heard?

     The snapshot replays the last ring for ever, so a page that simply played
     what was in it would sound the bell at every reconnect, every deploy and
     every reload. So the first document a page sees is **adopted in silence**,
     whatever is in it: the ring in it already happened, possibly yesterday.

     What this must not do is mistake "no ring yet" for "nothing has been seen
     yet". A wall that started after the container did — which is every wall,
     after every deploy — has a first document whose `ring` is null, and a rule
     that waits for a *previous* ring to compare against would then sit out the
     first real one in silence. That is exactly the doorbell nobody trusts, so
     the two are separate: `seen` says a document has arrived, `lastRingAt`
     says what the newest ring in one was, and a ring where there was none
     before is as fresh as a ring later than the last.

     Side-effecting on purpose, and pure of the DOM, so scripts/doorbell-ring-test.mjs
     can put a hundred snapshots through it without a browser. */
  shouldRing(doc, now = Date.now() / 1000) {
    // typeof before Number(), because Number(null) is 0 and not NaN: read the
    // lazy way, a `ring: {at: null}` is a ring that happened in 1970, which is
    // newer than "none seen yet" and rings the bell for nothing.
    const raw = doc && doc.ring ? doc.ring.at : undefined;
    const at = typeof raw === 'number' && Number.isFinite(raw) ? raw : null;
    const first = !this.seen;
    this.seen = true;
    const newer = at !== null && (this.lastRingAt === null || at > this.lastRingAt);
    // The one thing that may be played on a first document: a ring that
    // happened seconds ago. That is the wall which the door itself woke —
    // it boots after the ring it was woken for, so the old rule (first
    // document always adopted in silence) meant it woke, reloaded, and stood
    // there silently for the person at the door. Anything older than a minute
    // is still adopted in silence, which is every ordinary reload and every
    // deploy.
    const justHappened = at !== null && now - at <= FRESH_S && now - at >= -FRESH_S;
    const fresh = newer && (!first || justHappened);
    if (at !== null) this.lastRingAt = Math.max(this.lastRingAt ?? 0, at);
    return fresh;
  },

  /* Whoever is drawing a card from this — panels/ha.js — wants to know when
     the document moves, whether that was the server or a tap here. */
  onDoc(fn) { this.subs.push(fn); },

  changed() {
    for (const fn of this.subs) {
      try { fn(this.doc); } catch (e) { console.error('doorbell subscriber failed', e); }
    }
  },

  settings() { return (this.doc && this.doc.settings) || {}; },

  // ------------------------------------------------------------- sound ----
  /* The ring, at whatever volume this hour of this day allows — which can be
     silence, and silence here is the feature working, not failing. The door
     still opened, the card still says so and the rooms still flash: quiet
     hours take the noise away and nothing else. */
  play(id) {
    if (this.ctx.phone) return;   // the wall rings; a phone in a pocket does not
    // ...and then its text, read at the same volume (2026-10-18), if it has one.
    this.player.play(id, snd.volumeAt(this.settings()),
      { then: (vol) => this.ctx.voice?.play('doorbell', vol) });
  },

  stop() { this.player.stop(); this.ctx.voice?.stop(); },

  // ------------------------------------------------------------ server ----
  /* One tap sets one value and saves it — a wall screen has no Save button
     anybody would remember to press. The sheet paints the new value first and
     the server's own answer lands over SSE a moment later and wins, which is
     how every other control in this house behaves. */
  async put(patch) {
    if (this.doc) {
      this.doc = { ...this.doc, settings: { ...this.settings(), ...patch } };
      this.changed();
      this.render();
    }
    try {
      const r = await fetch('/api/doorbell/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch),
      });
      const body = await r.json().catch(() => ({}));
      if (r.ok && body.settings && this.doc) {
        this.doc = { ...this.doc, settings: body.settings };
        this.changed();
        this.render();
      }
    } catch { /* the server will put us right on the next snapshot */ }
  },

  async test() {
    try { await fetch('/api/doorbell/test', { method: 'POST' }); }
    catch { /* nothing rang; the button says nothing either */ }
  },

  toggle() { this.put({ enabled: !this.settings().enabled }); },

  // ------------------------------------------------------------- sheet ----
  buildSheet() {
    const el = document.createElement('div');
    el.id = 'db-sheet';
    el.className = 'sheet';   // the settings window kit (app.css)
    el.innerHTML = `
      <header>
        <span class="sheet-icon" aria-hidden="true">🔔</span>
        <div class="sheet-title">
          <h2>Doorbell<span class="db-which"></span></h2>
          <span class="sheet-status db-now"></span>
        </div>
        <span class="spacer"></span>
        <button class="ls-close">Close</button>
      </header>
      <div class="ls-body"></div>`;
    document.body.appendChild(el);
    this.sheet = el;
    this.bodyEl = el.querySelector('.ls-body');
    el.querySelector('.ls-close').onclick = () => this.close();
  },

  open() {
    // Open first, then fill: render() draws nothing into a sheet that is not
    // showing, so doing these the other way round opens an empty one.
    this.sheet.classList.add('open');
    this.render();
  },

  close() {
    this.stop();                 // nobody wants a preview following them out
    this.sheet.classList.remove('open');
  },

  isOpen() { return this.sheet.classList.contains('open'); },

  /* Every room the dashboard knows, on both tabs: the entrance hall is a
     "more" room and is the most likely thing anybody flashes for a door. */
  rooms() {
    return (this.ctx.config.entities?.lights || [])
      .filter((l) => l && l.entity);
  },

  /* The chips — a tick for each room chosen — under their caption. */
  roomChips(chosen, key) {
    const on = Array.isArray(chosen) ? chosen : [];
    return `<span class="ls-set sheet-chips">${this.rooms().map((l) => `
      <button class="ls-btn db-room${on.includes(l.entity) ? ' on' : ''}"
              data-room="${esc(l.entity)}" data-key="${esc(key)}" aria-pressed="${on.includes(l.entity)}">
        <span aria-hidden="true">${esc(l.emoji || '💡')}</span> ${esc(l.label || l.entity)}
      </button>`).join('')}</span>`;
  },

  /* ...and, when none of them is lit, a line saying what that means. "On"
     with no rooms chosen is a setting that does nothing at all, and doing
     nothing quietly is how somebody ends up believing the flash is broken
     when they have simply not said where. */
  roomWarn(chosen) {
    return Array.isArray(chosen) && chosen.length ? ''
      : '<span class="db-warn">No rooms chosen yet — pick one or more below, or nothing will flash.</span>';
  },

  /* The chosen sound's name: one of the bells, or one uploaded here. */
  soundName(s = this.settings()) {
    return snd.soundOf(s.sound || 'ring')?.name || s.sound || '';
  },

  /* The sheet's header line, and its tone (the settings window kit). */
  headLine(s) {
    const d = this.doc || {};
    if (d.error) return ['<b>Not working</b> · ' + esc(d.error), 'warn'];
    if (!s.enabled) return ['<b>Off</b>', 'off'];
    if (d.alerting) return ['<b>Door open</b> · the rooms are flashing for it', 'warn'];
    return [`<b>On</b> · ${esc(snd.nowLine(s))}`, 'ok'];
  },

  /* Each card's live note, beside its heading and under its name on the rail. */
  notes(s) {
    const people = (this.doc?.telegram_people || []).filter((p) => (s.telegram || []).includes(p.id));
    const n = (xs) => (Array.isArray(xs) ? xs.length : 0);
    const rooms = (k) => (n(s[k]) ? `${n(s[k])} ${n(s[k]) === 1 ? 'room' : 'rooms'}` : 'no rooms yet');
    const open = OPEN_ALERT.find(([v]) => v === (Number(s.open_alert_min) || 0)) || OPEN_ALERT[0];
    const voice = this.ctx.voice?.of('doorbell');
    return {
      sound: `${this.soundName(s)}${voice ? ' · then its text' : ''}`,
      tell: [people.length ? `✈ ${people.map((p) => p.label).join(', ')}` : 'no Telegram',
        !s.blink ? 'no flash' : n(s.blink_rooms) ? `flashes ${rooms('blink_rooms')}` : 'flash: no rooms yet'].join(' · '),
      quiet: snd.quietNote(s),
      loud: snd.volumeNote(s),
      wake: s.wake_wall ? 'on' : 'off',
      open: open[0] ? `after ${open[1]} · ${rooms('open_rooms')}` : 'off',
    };
  },

  /* The state sentence at the top (the settings window kit): what the door
     opening does now, and what it would sound like this minute, with the
     doorbell's switch beside it. */
  sumCard(s) {
    const kit = this.ctx.sheetkit;
    const ctl = kit.toggle(!!s.enabled, `data-put="enabled" data-v="${s.enabled ? 'false' : 'true'}"`);
    const voice = this.ctx.voice?.of('doorbell');
    const sound = `<b>${esc(this.soundName(s))}</b>${voice ? ', then reads its text' : ''}`;
    const quiet = s.quiet_on
      ? `, except in its quiet hours, <b>${esc(snd.quietNote(s))}</b>` : '';
    if (!s.enabled) {
      return kit.sum('Off — the door opens in silence: no sound, no flash, no message.', {
        next: `When it is on, the wall plays ${sound}.`, ctl, cap: 'Doorbell', off: true,
      });
    }
    const band = snd.bandAt(s);
    const pct = band === 'quiet' ? 0 : snd.volumePct(s, band);
    const now = band === 'quiet'
      ? `Right now it would be <b>silent</b> — quiet hours, until <b>${esc(`${String(snd.quietTo(s)).padStart(2, '0')}:00`)}</b>.`
      : pct === 0 ? `Right now it would be <b>silent</b> — the ${esc(band)} is set to 0%.`
        : `Right now it would ring at <b>${pct}%</b>, the ${esc(band)} volume.`;
    return kit.sum(`When the door opens, the wall plays ${sound}${quiet}.`, { next: now, ctl, cap: 'Doorbell' });
  },

  render() {
    if (!this.sheet || !this.isOpen()) return;
    const kit = this.ctx.sheetkit;
    const s = this.settings();
    // Which door this is. It is the card's line that could not fit on the
    // card, and this is the one place anybody reads it.
    this.sheet.querySelector('.db-which').textContent =
      this.doc?.label ? ` · ${this.doc.label}` : '';
    // The rules' only feedback: what a ring would sound like this minute.
    // Without it, quiet hours and a 0% band look exactly like a broken bell.
    kit.status(this.sheet.querySelector('.db-now'), ...this.headLine(s));
    const pick = (v, want) => (v === want ? ' on' : '');
    const sw = (key, on) => kit.toggle(on, `data-put="${key}" data-v="${on ? 'false' : 'true'}"`);
    const n = this.notes(s);
    const rules = snd.rulesParts(s, {
      what: 'The doorbell',
      quietNote: 'Nothing else changes — the lights still flash, the card still says '
        + 'what happened; it is the noise that stops.',
      inCards: true,
    });
    const people = this.doc?.telegram_people || [];
    const openMin = Number(s.open_alert_min) || 0;
    this.bodyEl.innerHTML = `
      ${this.sumCard(s)}

      ${kit.sec('Sound', `
        <p class="sheet-note">When the door opens, the wall makes a sound.</p>
        <div class="ls-row">
          <span class="ls-label">
            <span class="db-hint sheet-lead">tap one to hear it. A preview is always audible, whatever
              the hour — it is the door opening these rules are about, not the
              choosing. The animals are the clock's: Clock sounds, on House → Automation.
              ＋ Upload adds a sound file of your own; ✕ deletes one.</span></span>
          <div class="sheet-ctl">
            <span class="ls-set sheet-seg db-sounds">${snd.doorSounds().map((one) => `
              <button class="ls-btn${pick(s.sound || 'ring', one.id)}" data-sound="${esc(one.id)}"
                      aria-pressed="${(s.sound || 'ring') === one.id}">
                <span class="db-play" aria-hidden="true">▶</span> ${esc(one.name)}
              </button>`).join('')}${(this.ctx.soundlib?.list('doorbell') || []).map((one) => `
              <button class="ls-btn${pick(s.sound, one.id)}" data-sound="${esc(one.id)}"
                      aria-pressed="${s.sound === one.id}">
                <span class="db-play" aria-hidden="true">▶</span> ${esc(one.label)}
              </button>${this.ctx.soundlib.delBtn(one.id, { label: one.label })}`).join('')}</span>
            <span class="sheet-acts">
              ${this.ctx.soundlib?.uploadBtn('doorbell') || ''}
              ${this.ctx.voice?.chip('doorbell') || ''}
            </span>
          </div>
          ${this.ctx.voice?.editor('doorbell', { hint: 'read aloud after the bell — at the same volume, and not in quiet hours' }) || ''}
        </div>`, { note: n.sound })}

      ${kit.sec('Tell the house', `
        <div class="ls-row">
          <span class="ls-label">Also on Telegram
            <span class="db-hint">every time the door opens, a message to these people — silently in the quiet hours below. A person whose Telegram is not linked yet is dashed and cannot be chosen until it is linked
              under House → Automation → Telegram.</span></span>
          ${people.length ? `<span class="ls-set sheet-chips">${people.map((p) => {
            const on = (s.telegram || []).includes(p.id);
            return `
            <button class="ls-btn${on ? ' on' : ''}${p.ready ? '' : ' sheet-na'}" data-tgp="${esc(p.id)}"
                    aria-pressed="${on}"${p.ready || on ? '' : ' disabled'}${p.ready ? ''
                      : ' title="link their Telegram under House → Automation → Telegram"'}>✈ ${esc(p.label)}</button>`;
          }).join('')}</span>` : '<span class="sheet-line">no Telegram bot set up</span>'}
        </div>
        <div class="ls-row">
          <span class="ls-label">Flash the lights as it opens
            <span class="db-hint">for the half of the house that cannot hear the wall —
              pick the rooms, then how they should flash. Each one goes back to
              exactly the brightness it was.</span>
            ${s.blink ? this.roomWarn(s.blink_rooms) : ''}</span>
          <div class="sheet-ctl">
            ${sw('blink', !!s.blink)}
            ${s.blink ? `<div><span class="sheet-cap">Rooms</span>${this.roomChips(s.blink_rooms, 'blink_rooms')}</div>
            <div><span class="sheet-cap">How they flash</span><span class="ls-set sheet-seg">${STYLES.map(([v, name]) => `
              <button class="ls-btn${pick(s.blink_style || 'blink', v)}" data-put="blink_style"
                      data-v="${esc(JSON.stringify(v))}" aria-pressed="${(s.blink_style || 'blink') === v}">${esc(name)}</button>`).join('')}
            </span></div>` : ''}
          </div>
        </div>`, { note: n.tell })}

      ${kit.sec('Quiet hours', rules.quiet, { note: n.quiet })}

      ${kit.sec('How loud', rules.loud, { note: n.loud })}

      ${kit.sec('Wake the wall for it', `
        <div class="ls-row">
          <span class="ls-label"><span class="db-hint sheet-lead">the screen sleeps when the kitchen is empty, and a
            sleeping screen cannot ring. With this on, the door opening wakes it —
            it takes a few seconds, so the ring comes just after the door — and it
            goes back to sleep afterwards unless somebody is there. Never during
            quiet hours, and never for a volume set to 0%: a ring nobody would
            hear is not worth lighting the kitchen for.</span></span>
          ${sw('wake_wall', !!s.wake_wall)}
        </div>`, { note: n.wake })}

      ${kit.sec('If the door is left open', `
        <div class="ls-row">
          <span class="ls-label"><span class="db-hint sheet-lead">the rooms below flash over and over until it is shut, or
            until the doorbell is switched off. Nothing sounds — it is a door
            standing open, not somebody arriving.</span>
            ${openMin > 0 ? this.roomWarn(s.open_rooms) : ''}</span>
          <div class="sheet-ctl">
            <span class="ls-set sheet-seg">${OPEN_ALERT.map(([v, name]) => `
              <button class="ls-btn${pick(openMin, v)}${v ? '' : ' sheet-none'}" data-put="open_alert_min"
                      data-v="${v}" aria-pressed="${openMin === v}">${esc(name)}</button>`).join('')}
            </span>
            ${openMin > 0 ? `<div><span class="sheet-cap">Rooms</span>${this.roomChips(s.open_rooms, 'open_rooms')}</div>` : ''}
          </div>
        </div>`, { note: n.open })}

      ${kit.sec('Try it', `
        <div class="ls-row">
          <span class="ls-label"><span class="db-hint sheet-lead">rings every screen and flashes the rooms, as a real
            one would — without opening the door</span></span>
          <span class="ls-set">
            <button class="ls-btn sheet-primary db-ring">Ring it now</button>
          </span>
        </div>`)}`;

    this.bodyEl.querySelectorAll('[data-put]').forEach((btn) => {
      btn.onclick = () => this.put({ [btn.dataset.put]: JSON.parse(btn.dataset.v) });
    });
    this.bodyEl.querySelectorAll('[data-tgp]').forEach((btn) => {
      btn.onclick = () => {
        const set = new Set(this.settings().telegram || []);
        if (set.has(btn.dataset.tgp)) set.delete(btn.dataset.tgp); else set.add(btn.dataset.tgp);
        this.put({ telegram: (this.doc?.telegram_people || []).map((p) => p.id).filter((i) => set.has(i)) });
      };
    });
    // An upload is the doorbell's sound at once.
    this.ctx.soundlib?.wire(this.bodyEl, { onUploaded: (r) => this.put({ sound: r.id }) });
    this.ctx.voice?.wire(this.bodyEl, () => this.render());
    // Choosing a sound and hearing it are one tap, not two: nobody picks a
    // doorbell off a list of five words.
    this.bodyEl.querySelectorAll('[data-sound]').forEach((btn) => {
      btn.onclick = () => {
        this.player.play(btn.dataset.sound, snd.previewVolume(this.settings()));
        this.put({ sound: btn.dataset.sound });
      };
    });
    this.bodyEl.querySelectorAll('.db-room').forEach((btn) => {
      btn.onclick = () => {
        const key = btn.dataset.key;
        const have = Array.isArray(this.settings()[key]) ? this.settings()[key] : [];
        const room = btn.dataset.room;
        this.put({ [key]: have.includes(room) ? have.filter((r) => r !== room) : [...have, room] });
      };
    });
    // Its own hook: the 🗣 editor's Save was a .db-test too, and the first
    // one in the sheet was wired as Ring it now.
    this.bodyEl.querySelector('.db-ring').onclick = () => this.test();
    kit.sync(this.sheet);
  },
};
