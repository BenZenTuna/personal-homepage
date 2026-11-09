/* The clock strikes the hour.

   The wall has always had the time on it and never said it out loud. This
   makes it say it: at the top of each hour, one of the creatures, under
   the same kind of quiet hours and volume bands as the doorbell (sound.js
   owns both, and the doorbell sheet offers exactly these rows). The bells are
   the doorbell's alone since 2026-10-03, so an hour never sounds like
   somebody at the door.

   Not a panel, for the doorbell's reason — the hour turns while the wall is
   showing photographs — so this is built once at boot and lives for the whole
   life of the page. Its settings sheet is reached from the gear on its own
   card, "Clock sounds" on House → Automation (drawn by panels/ha.js,
   like the doorbell's card), and from the gear in the Time screen's header,
   which is where somebody wondering about the clock will also look.

   **The hour is struck by the browser, not the server.** The server keeps the
   settings and nothing else. That is the doorbell's arrangement and it is
   here for the same reason: the speakers are in the kitchen, and an mp3
   played by the container would come out of the home server, which lives in a
   cupboard. It also means the wall being asleep is the end of it — a sleeping
   wall strikes no hour, which is what anybody would want at four in the
   morning and is free.

   Only the `test` ring comes from the server, so that "try it" rings every
   screen at once the way a real doorbell does. */

const esc = (s) => String(s ?? '').replace(/[&<>"]/g,
  (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

/* How often to look at the clock. Not a timeout to the top of the hour: the
   wall suspends when the kitchen is empty and wakes when somebody walks in,
   and a timer set for 47 minutes' time does not survive that — it comes back
   late, or fires all at once, depending on the browser. A short tick that
   asks "is it the hour?" survives anything, including the clock being
   stepped. */
const TICK_MS = 5000;

/* How late is too late. A wall that wakes at 10:00:40 has missed the hour;
   striking it then is a machine catching up with itself, not a clock. */
const GRACE_S = 20;

export default {
  doc: null,
  subs: [],
  lastStruck: null,     // "YYYY-MM-DDTHH", so one hour is struck once
  lastAnimal: null,     // ...and which creature it was, so the next differs
  lastRingAt: null,     // the newest "try it" this page knows about...
  seen: false,          // ...and whether it has seen the server at all yet
  hourSeen: null,       // the hour the card's "Next at" was last worked out in

  init(ctx, sound) {
    this.ctx = ctx;
    this.snd = sound;
    this.player = sound.player();
    this.buildSheet();
    // Sounds uploaded in its sheet (2026-10-18) redraw it as they change.
    ctx.soundlib?.onChange(() => this.render());

    ctx.bus.on('chime', (doc) => {
      if (!doc || typeof doc !== 'object') return;
      const fresh = this.shouldRing(doc);
      this.doc = doc;
      if (fresh) this.strike({ test: true });
      this.changed();
      this.render();
    });

    setInterval(() => this.tick(), TICK_MS);
    this.tick();
  },

  /* A "try it" nobody on this page has heard yet. The doorbell's rule, for
     the doorbell's reason (see shouldRing in doorbell.js): the snapshot
     replays the last one for ever, so the first document a page sees is
     adopted in silence whatever is in it. */
  shouldRing(doc) {
    const raw = doc && doc.ring ? doc.ring.at : undefined;
    const at = typeof raw === 'number' && Number.isFinite(raw) ? raw : null;
    const first = !this.seen;
    this.seen = true;
    const fresh = !first && at !== null && (this.lastRingAt == null || at > this.lastRingAt);
    if (at !== null) this.lastRingAt = Math.max(this.lastRingAt ?? 0, at);
    return fresh;
  },

  onDoc(fn) { this.subs.push(fn); },

  changed() {
    for (const fn of this.subs) {
      try { fn(this.doc); } catch (e) { console.error('chime subscriber failed', e); }
    }
  },

  settings() { return (this.doc && this.doc.settings) || {}; },

  // -------------------------------------------------------------- hours ----
  /* Is it the top of an hour this page has not struck yet?

     `lastStruck` is the hour's own name and not a timestamp, so nothing here
     can strike the same hour twice however the tick lands, and a clock that
     goes backwards an hour in October does not strike 02:00 twice either.

     A page that loads inside the first twenty seconds of an hour strikes it.
     That is deliberate: the wall reloads itself after a deploy, and the hour
     it happens to land on should not be the silent one. */
  tick() {
    const now = new Date();
    const key = `${now.toDateString()}T${now.getHours()}`;
    // A new hour moves the card's "Next at" on, whether or not this one is
    // struck — so the card is told, the way it is told of a new setting.
    if (this.hourSeen !== key) {
      const first = this.hourSeen === null;
      this.hourSeen = key;
      if (!first) this.changed();
    }
    if (now.getMinutes() !== 0 || now.getSeconds() > GRACE_S) return;
    if (this.lastStruck === key) return;
    this.lastStruck = key;
    this.strike();
  },

  /* One hour struck — or not, which is most of what this does. `test` skips
     only the on/off switch: somebody pressing "try it" has asked for it, but
     they have not asked to be shouted at during quiet hours, and a test that
     ignored the rules would be a test of something other than what happens at
     the hour. */
  strike({ test = false } = {}) {
    if (this.ctx.phone) return false;   // the wall's hour, not a phone's
    const s = this.settings();
    if (!test && !s.enabled) return false;
    if (s.weekend_silent && this.snd.isWeekend()) return false;
    const id = this.voice(s);
    if (!id) return false;              // every sound paused
    return this.player.play(id, this.snd.volumeAt(s));
  },

  /* Which sound this hour gets. Usually the one that was chosen; with
     "Animals" it is a different creature each time, and the one just played is
     remembered only so that the next is not it — two identical hours in a row
     read as a stuck clock rather than as chance.

     Each screen picks its own, so two rooms can strike different animals at
     the same hour. Left that way on purpose: making them agree would mean the
     server choosing and every screen obeying, which is a message an hour and
     a lock on the wall being in step, for a thing nobody can hear from both
     rooms at once. */
  voice(s) {
    if (s.sound !== this.snd.ANIMALS) return s.sound || 'crane';
    this.lastAnimal = this.snd.pickAnimal(this.lastAnimal, this.pool(s)) || this.lastAnimal;
    return this.pool(s).length ? this.lastAnimal : null;
  },

  /* Every sound the clock can strike — the creatures, then the ones uploaded
     in its sheet — less the ones paused there (2026-11-02). "Animals" picks
     from this; the server keeps `paused` (chime.py). */
  allIds() {
    return [...this.snd.animals().map((a) => a.id),
      ...(this.ctx.soundlib?.list('clock') || []).map((u) => u.id)];
  },

  pool(s = this.settings()) {
    const paused = new Set(s.paused || []);
    return this.allIds().filter((id) => !paused.has(id));
  },

  /* ⏸ / ▶ on one sound. Pausing the one the hour plays hands the hour to
     the others at random — the server does the same, this only saves a
     flicker. */
  togglePause(id) {
    const s = this.settings();
    const paused = new Set(s.paused || []);
    if (paused.has(id)) paused.delete(id); else paused.add(id);
    const patch = { paused: this.allIds().filter((x) => paused.has(x)) };
    if (paused.has(id) && s.sound === id) patch.sound = this.snd.ANIMALS;
    this.put(patch);
  },

  stop() { this.player.stop(); },

  // --------------------------------------------------------------- card ----
  /* The two lines of the card on House → Automation (panels/ha.js draws it): the
     chosen sound, and when the wall will next be heard striking. "On" alone
     would leave whoever reads it to work out the rest — quiet hours, a
     silent weekend and a band at 0% all leave long stretches in which a
     clock that is on says nothing. The volume is the sheet's to say: the
     line has 154px beside the button, and "Next at 07:00 · 40%" is 157.
     Both are '' until the server has answered, which is when the card shows. */
  soundName() {
    if (!this.doc) return '';
    const s = this.settings();
    if (s.sound === this.snd.ANIMALS) return 'Animals, at random';
    return this.snd.soundOf(s.sound || 'crane')?.name || '';
  },

  cardLine(now = new Date()) {
    if (!this.doc) return '';
    const s = this.settings();
    if (!s.enabled) return 'Won’t strike';
    const next = this.snd.nextStrike(s, { weekendSilent: !!s.weekend_silent, at: now });
    if (!next) return 'Every hour silent';
    const hm = `${String(next.at.getHours()).padStart(2, '0')}:00`;
    // Within a day the hour is enough — 07:00 read at half past ten at night
    // is tomorrow's. Only a silent weekend puts it further off, and then the
    // day is named.
    if (next.at - now > 24 * 3600 * 1000) {
      return `Next ${next.at.toLocaleDateString('en-GB', { weekday: 'short' })} ${hm}`;
    }
    return `Next at ${hm}`;
  },

  toggle() { this.put({ enabled: !this.settings().enabled }); },

  // ------------------------------------------------------------- server ----
  async put(patch) {
    if (this.doc) {
      this.doc = { ...this.doc, settings: { ...this.settings(), ...patch } };
      this.changed();
      this.render();
    }
    try {
      const r = await fetch('/api/chime/settings', {
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
    try { await fetch('/api/chime/test', { method: 'POST' }); }
    catch { /* nothing sounded; the button says nothing either */ }
  },

  // -------------------------------------------------------------- sheet ----
  buildSheet() {
    const el = document.createElement('div');
    el.id = 'ch-sheet';
    el.className = 'sheet';   // the settings window kit (app.css)
    el.innerHTML = `
      <header>
        <span class="sheet-icon" aria-hidden="true">🕰️</span>
        <div class="sheet-title">
          <h2>Clock sounds</h2>
          <span class="sheet-status ch-now"></span>
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
    this.sheet.classList.add('open');
    this.render();
  },

  close() {
    this.stop();               // nobody wants a preview following them out
    this.sheet.classList.remove('open');
  },

  isOpen() { return this.sheet.classList.contains('open'); },

  /* The state sentence at the top (the settings window kit): what the hour
     sounds like now and when it is next heard, with the clock's switch. */
  sumCard(s) {
    const kit = this.ctx.sheetkit;
    const snd = this.snd;
    const ctl = kit.toggle(!!s.enabled, `data-put="enabled" data-v="${s.enabled ? 'false' : 'true'}"`);
    const what = s.sound === snd.ANIMALS
      ? `<b>one of ${this.pool(s).length} sounds</b>, a different one each hour`
      : `<b>${esc(this.soundName())}</b>`;
    if (!s.enabled) {
      return kit.sum('Off — the hour passes in silence.', {
        next: `When it is on: ${what}, at the top of every hour.`, ctl, cap: 'Strike the hour', off: true,
      });
    }
    const hh = (h) => `${String(h).padStart(2, '0')}:00`;
    const [f, t] = [snd.quietFrom(s), snd.quietTo(s)];
    const [fw, tw] = [snd.quietFrom(s, { weekend: true }), snd.quietTo(s, { weekend: true })];
    const weekend = fw === f && tw === t ? ''
      : ` (weekends <b>${fw === f ? `to ${hh(tw)}` : `${hh(fw)}–${hh(tw)}`}</b>)`;
    const rules = [s.quiet_on ? `except in its quiet hours, <b>${hh(f)}–${hh(t)}</b>${weekend}` : '',
      s.weekend_silent ? 'and not at all at weekends' : ''].filter(Boolean).join(' ');
    const now = new Date();
    const next = snd.nextStrike(s, { weekendSilent: !!s.weekend_silent, at: now });
    let when = '';
    if (next) {
      const hm = `${String(next.at.getHours()).padStart(2, '0')}:00`;
      when = next.at - now > 24 * 3600 * 1000
        ? `${next.at.toLocaleDateString('en-GB', { weekday: 'short' })} ${hm}` : hm;
    }
    return kit.sum(`At the top of every hour the wall plays ${what}${rules ? `, ${rules}` : ''}.`, {
      next: next ? `Next: <b>${esc(when)}</b>, at ${next.pct}%.`
        : 'Next: <b>none</b> — every hour is silent as it is set.',
      ctl, cap: 'Strike the hour',
    });
  },

  render() {
    if (!this.sheet || !this.isOpen()) return;
    const kit = this.ctx.sheetkit;
    const s = this.settings();
    const snd = this.snd;
    const pick = (v, want) => (v === want ? ' on' : '');
    kit.status(this.sheet.querySelector('.ch-now'),
      s.enabled ? `<b>On</b> · ${esc(snd.nowLine(s, { weekendSilent: !!s.weekend_silent }))}` : '<b>Off</b>',
      s.enabled ? 'ok' : 'off');
    const rules = snd.rulesParts(s, {
      what: 'The hour',
      weekendKey: 'weekend_silent',
      quietNote: 'Its card on House → Automation says when it will next be heard.',
      weekendQuiet: true,
      inCards: true,
    });
    const chosen = s.sound || 'crane';
    const paused = new Set(s.paused || []);
    const all = [...snd.animals().map((a) => ({ id: a.id, name: a.name })),
      ...(this.ctx.soundlib?.list('clock') || []).map((u) => ({ id: u.id, name: u.label, uploaded: true }))];
    const pool = this.pool(s);
    this.bodyEl.innerHTML = `
      ${this.sumCard(s)}

      ${kit.sec('Sound', `
        <p class="sheet-note">At the top of every hour the wall makes a sound — once, whatever the hour
          is. It only sounds on a screen that is awake, so a kitchen nobody is standing in stays quiet.</p>
        <div class="ls-row">
          <span class="ls-label">
            <span class="db-hint sheet-lead">the creatures — the bells are the doorbell's, so an hour
              never sounds like somebody at the door. Tap one to hear it. ⏸ leaves a sound
              out of the clock until ▶ brings it back; ＋ Upload adds a sound file of your
              own; ✕ deletes one.</span>
            <span class="db-hint">Animals takes a different one each hour from every sound
              not paused — ${pool.length} of ${all.length} now — and never the same one
              twice running.</span></span>
          <div class="sheet-ctl">
            <div><span class="sheet-cap">A different one each hour</span>
              <span class="ls-set sheet-seg">
                <button class="ls-btn ch-animals${pick(s.sound, snd.ANIMALS)}" data-sound="${esc(snd.ANIMALS)}"
                        aria-pressed="${s.sound === snd.ANIMALS}">
                  <span class="db-play" aria-hidden="true">▶</span> Animals, at random
                </button></span></div>
            <div><span class="sheet-cap">The same one every hour</span>
              <span class="ls-set sheet-seg db-sounds">${all.map((one) => `<span class="ch-one">
                <button class="ls-btn${pick(chosen, one.id)}${paused.has(one.id) ? ' ch-paused' : ''}"
                        data-sound="${esc(one.id)}" aria-pressed="${chosen === one.id}">
                  <span class="db-play" aria-hidden="true">▶</span> ${esc(one.name)}
                </button><button class="ls-btn ch-pz${paused.has(one.id) ? ' ch-pz-on' : ''}" data-pause="${esc(one.id)}"
                        aria-pressed="${paused.has(one.id)}"
                        aria-label="${paused.has(one.id) ? 'Bring back' : 'Pause'} ${esc(one.name)}">${paused.has(one.id) ? '▶' : '⏸'}</button>${
                  one.uploaded ? this.ctx.soundlib.delBtn(one.id, { label: one.name }) : ''}</span>`).join('')}</span></div>
            <span class="sheet-acts">${this.ctx.soundlib?.uploadBtn('clock') || ''}</span>
          </div>
        </div>`, { note: this.soundName() })}

      ${kit.sec('Quiet hours', `${rules.quiet}${rules.weekend}`,
        { note: snd.quietNote(s, { weekendQuiet: true, weekendSilent: !!s.weekend_silent }) })}

      ${kit.sec('How loud', rules.loud, { note: snd.volumeNote(s) })}

      ${kit.sec('Wake the wall for it', `
        <div class="ls-row">
          <span class="ls-label"><span class="db-hint sheet-lead">the screen sleeps when the kitchen is empty, and a
            sleeping screen strikes no hour. With this on it is woken a minute
            before, strikes, and goes straight back to sleep — unless somebody
            is there, and then it simply stays on as it always would. It is
            never woken for an hour that would be silent anyway, so quiet hours
            and a band set to 0% keep the kitchen dark as well as quiet.</span></span>
          ${kit.toggle(!!s.wake_wall, `data-put="wake_wall" data-v="${s.wake_wall ? 'false' : 'true'}"`)}
        </div>`, { note: s.wake_wall ? 'on' : 'off' })}

      ${kit.sec('Try it', `
        <div class="ls-row">
          <span class="ls-label"><span class="db-hint sheet-lead">sounds on every screen at once, exactly as the hour
            would — quiet hours and the volume for this moment included, so a
            silent answer here is an answer</span></span>
          <span class="ls-set">
            <button class="ls-btn sheet-primary ch-test">Strike it now</button>
          </span>
        </div>`)}`;

    this.bodyEl.querySelectorAll('[data-put]').forEach((btn) => {
      btn.onclick = () => this.put({ [btn.dataset.put]: JSON.parse(btn.dataset.v) });
    });
    this.bodyEl.querySelectorAll('[data-sound]').forEach((btn) => {
      btn.onclick = () => {
        const id = btn.dataset.sound;
        this.player.play(id === snd.ANIMALS ? snd.pickAnimal(this.lastAnimal) : id,
                         snd.previewVolume(s));
        this.put({ sound: id });
      };
    });
    this.bodyEl.querySelectorAll('[data-pause]').forEach((btn) => {
      btn.onclick = (e) => { e.stopPropagation(); this.togglePause(btn.dataset.pause); };
    });
    this.bodyEl.querySelector('.ch-test').onclick = () => this.test();
    // An upload is the hour's sound at once.
    this.ctx.soundlib?.wire(this.bodyEl, { onUploaded: (r) => this.put({ sound: r.id }) });
    kit.sync(this.sheet);
  },
};
