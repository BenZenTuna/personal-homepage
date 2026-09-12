// Cooking: the dinners the agent suggests each day — up to three vegetarian
// and three not — with per-ingredient have/don't-have ticks, a cook mode whose
// steps can start the kitchen timers, and the week, the shopping list and the
// pantry behind three header buttons. The backend (backend/app/cooking.py and
// cookbook.py) owns all the documents; this panel and the agent are both just
// clients of it.
//
// The Week is the plan and the two columns are today's page of it: the server
// copies today's entry into the suggestions just after midnight, so nothing
// below has to know a week exists — the cards, the choosing, the ticks and the
// list work exactly as they did. What the week view adds is the two things a
// day could never answer. What are we eating on Thursday, and did we like what
// we ate on Monday: a dinner used to be rateable only while its card was still
// on the wall, which is to say almost never.
//
// Two columns, one per kind, and each column is a swipe: the card stays the
// size it was when there was only one suggestion, and the others sit beside it
// off-screen. Dots under the card say which of the three is showing, because a
// carousel with no marks reads as "that is all there is". The swipe is native
// scroll-snap rather than a hand-wired drag — it is the one gesture a browser
// already does perfectly on a touchscreen, and every tap in here is wired to
// survive it (see wireTap).
//
// The panel lives in two very different slots: the Cooking preset gives it
// two-thirds of the wall, the Everything variants a strip barely 200px tall.
// A ResizeObserver decides which render fits; the strip shows only the two
// chosen dish names (the old placeholder layout), and its header buttons expand
// the panel first so the list is never crammed into a sliver.

const RETRY_MS = 5 * 60 * 1000;   // backend older than this frontend: try again
const KIND_LABEL = { veg: 'Vegetarian', normal: 'Regular' };
const KINDS = ['veg', 'normal'];

const esc = (s) => String(s ?? '').replace(/[&<>"]/g,
  (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

/* A plan's "2026-09-14" as a date in this kitchen, not in UTC. new Date(iso)
   reads a bare date as midnight UTC, and an hour west of Greenwich that is the
   evening before — the wall would call Monday's dinner Sunday's. */
function localDate(iso) {
  const [y, m, d] = String(iso || '').split('-').map(Number);
  return (y && m && d) ? new Date(y, m - 1, d) : null;
}

/* en-GB, named rather than left to the browser, because this panel's dates sit
   under a header that is already "Saturday 12 September" (app.js) — and
   because the wall and the laptop reading it must not disagree about which
   way round a date goes. */
const dayShort = (iso) =>
  localDate(iso)?.toLocaleDateString('en-GB', { weekday: 'short' }) || '';
const dayNum = (iso) =>
  localDate(iso)?.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }) || '';
const dayLong = (iso) => localDate(iso)?.toLocaleDateString('en-GB',
  { weekday: 'long', day: 'numeric', month: 'long' }) || String(iso || '');

const IMG = (ref) => `/api/cooking/images/${ref}`;

/* Pantry rows show their age, because "mushrooms · 3 w" answers the question
   a pantry list is actually asked: is that still good? */
function age(added) {
  const t = Date.parse(added);
  if (!t) return { txt: '', stale: false };
  const d = Math.max(0, Math.floor((Date.now() - t) / 86400000));
  if (d < 1) return { txt: 'today', stale: false };
  if (d < 14) return { txt: `${d} d`, stale: false };
  return { txt: `${Math.floor(d / 7)} w`, stale: d >= 28 };
}

export default {
  id: 'food',
  title: 'Cooking',

  init(body, ctx) {
    this.ctx = ctx;
    this.body = body;
    this.sugg = null;       // decorated suggestions doc, or null before load
    this.shopping = null;
    this.pantry = null;
    this.week = null;       // the plan, or null where the backend has no week
    this.missing = false;   // backend has no /api/cooking yet (older deploy)
    this.view = 'tonight';  // tonight | cook | week | day | shopping | pantry
    this.cookId = null;
    this.cookBack = 'tonight';
    this.dayDate = null;
    this.compact = true;
    this.expanded = false;
    // Same dirty/pending dance as timers.js, per document: our own save's SSE
    // echo must not be mistaken for news, and a genuinely newer broadcast must
    // not land while an optimistic change is still waiting for its ack.
    this.dirty = { shopping: false, pantry: false, sugg: false, week: false };
    this.pending = {};
    this.seq = { shopping: 0, pantry: 0 };
    // Which suggestion each column is showing. Kept server-side with the rest
    // of the ui-state: the wall reloads itself on every deploy, and coming back
    // to the first card when somebody had swiped to the third reads as the
    // dashboard having forgotten what it was told.
    const saved = ctx.uiState?.cook_pick || {};
    this.pick = { veg: Number(saved.veg) || 0, normal: Number(saved.normal) || 0 };

    // Week first: it is about dinners, like the view behind it, and the other
    // two are the errands. Nearest the panel's own subject, furthest from ⤢.
    this.btnWeek = ctx.addHeaderButton(this.id, 'Week', () => this.open('week'));
    this.btnList = ctx.addHeaderButton(this.id, 'List', () => this.open('shopping'));
    this.btnPantry = ctx.addHeaderButton(this.id, 'Pantry', () => this.open('pantry'));

    ctx.bus.on('cooking_suggestions', (doc) => this.absorb('sugg', doc));
    ctx.bus.on('cooking_shopping', (doc) => this.absorb('shopping', doc));
    ctx.bus.on('cooking_pantry', (doc) => this.absorb('pantry', doc));
    ctx.bus.on('cooking_week', (doc) => this.absorb('week', doc));

    this.ro = new ResizeObserver(() => this.fit());
    this.ro.observe(body);
    this.load();
  },

  onExpand() { this.expanded = true; this.fit(true); },
  onCollapse() { this.expanded = false; this.view = 'tonight'; this.fit(true); },

  async load() {
    clearTimeout(this._retry);
    try {
      const [s, sh, p, w] = await Promise.all([
        fetch('/api/cooking/suggestions'),
        fetch('/api/cooking/shopping'),
        fetch('/api/cooking/pantry'),
        // The week arrived later than the rest of this panel, and a frontend
        // deploy does not rebuild the backend: a 404 here means "this server
        // has no week yet", which is a missing button, not a missing panel.
        fetch('/api/cooking/week').catch(() => null),
      ]);
      // 404 is "not deployed yet", never an answer: a plain ./sync.sh pushes
      // this file without rebuilding the backend it talks to.
      if (!s.ok || !sh.ok || !p.ok) throw new Error('not there yet');
      this.sugg = await s.json();
      this.shopping = await sh.json();
      this.pantry = await p.json();
      this.week = w && w.ok ? await w.json() : null;
      this.missing = false;
    } catch {
      this.missing = this.sugg === null;
      this._retry = setTimeout(() => this.load(), RETRY_MS);
    }
    this.render();
  },

  absorb(key, doc) {
    if (!doc) return;
    if (this.dirty[key === 'sugg' ? 'sugg' : key]) {
      this.pending[key] = doc;
      clearTimeout(this._absorb);
      this._absorb = setTimeout(() => {
        for (const [k, d] of Object.entries(this.pending)) this.absorb(k, d);
      }, 300);
      return;
    }
    delete this.pending[key];
    this[key] = doc;
    this.missing = false;
    this.render();
  },

  /* Wholesale saves (shopping, pantry) — debounced, dirty until acked, exactly
     the timers.js contract. `key` is the doc, `url` its endpoint. */
  save(key, url) {
    this.dirty[key] = true;
    clearTimeout(this[`_t_${key}`]);
    this[`_t_${key}`] = setTimeout(async () => {
      this[`_t_${key}`] = null;
      const mine = ++this.seq[key];
      try {
        await fetch(url, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ items: this[key].items }),
        });
      } catch { /* the screen keeps its copy; the server's next echo wins */ }
      if (mine !== this.seq[key]) return;
      setTimeout(() => {
        if (mine === this.seq[key] && !this[`_t_${key}`]) this.dirty[key] = false;
      }, 400);
    }, 250);
  },

  /* Fire-and-ack POSTs (ingredient tick, rating): the server writes both docs
     and broadcasts; dirty holds our optimistic flip until that echo lands. */
  async post(url, payload) {
    this.dirty.sugg = this.dirty.shopping = true;
    try {
      await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
    } catch { /* echo (or reload) reconciles */ }
    setTimeout(() => { this.dirty.sugg = this.dirty.shopping = false; }, 400);
  },

  /* ---------- layout ---------- */

  fit(force) {
    const cs = getComputedStyle(this.body);
    const w = this.body.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
    const h = this.body.clientHeight - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom);
    if (w <= 0 || h <= 0) return;
    const compact = !this.expanded && (w < 640 || h < 380);
    // The Everything variants give this panel a column barely 460px wide, and
    // a strip that narrow has room for the dish or for the note beside it,
    // never both. `narrow` is what drops the note and lets the name wrap —
    // "Halloumi & couscous with r…" is not a dinner anybody can picture.
    const narrow = compact && w < 620;
    if (compact === this.compact && narrow === this.narrow && !force) return;
    this.compact = compact;
    this.narrow = narrow;
    if (compact) this.view = 'tonight';
    this.render();
  },

  /* In the strip there is no room for a list, but the buttons that promise one
     still have to keep the promise: they expand the panel and then show it. */
  open(view) {
    this.view = this.view === view ? 'tonight' : view;
    if (this.compact && this.view !== 'tonight' && !this.expanded) {
      document.querySelector('#p-food .expand')?.click();   // sets this.expanded via onExpand
    }
    this.render();
  },

  /* One list per kind, veg first — the left column is vegetarian every day, so
     a glance from the doorway lands on the same side it did yesterday. */
  ofKind(kind) { return (this.sugg?.recipes || []).filter((r) => r.kind === kind); },

  /* The card a column is swiped to, clamped: the agent may write two
     vegetarian dinners tomorrow having written three today. Not to be confused
     with the *chosen* dinner, which is the one being cooked. */
  showing(kind) {
    const rs = this.ofKind(kind);
    if (!rs.length) return null;
    const i = Math.min(Math.max(0, this.pick[kind] || 0), rs.length - 1);
    this.pick[kind] = i;
    return rs[i];
  },

  /* Any dinner this panel can show, wherever it is written down: today's
     suggestions first, then the plan. Steps opened from Thursday has to find
     Thursday's recipe, and Thursday is not in the suggestions document. */
  byId(id) {
    const tonight = (this.sugg?.recipes || []).find((r) => r.id === id);
    if (tonight) return tonight;
    for (const d of this.week?.days || []) {
      for (const k of KINDS) {
        if (d[k]?.id === id) return d[k];
        const alt = (d.alternates?.[k] || []).find((a) => a.id === id);
        if (alt) return alt;
      }
    }
    return null;
  },

  dayOf(date) { return (this.week?.days || []).find((d) => d.date === date) || null; },

  /* What putting the week on the list would add — the same arithmetic the
     server does, mirrored here only so the button can say the number before
     anybody presses it. Never stored: the moment it is kept it is wrong. */
  weekNeeds() {
    const pantry = new Set((this.pantry?.items || []).map((i) => i.name));
    const listed = this.listed();
    const names = new Set();
    for (const d of this.week?.days || []) {
      if (d.date < (this.week.today || '')) continue;
      for (const k of KINDS) {
        for (const ing of d[k]?.ingredients || []) {
          if (!ing.have && !pantry.has(ing.name) && !listed.has(ing.name)) {
            names.add(ing.name);
          }
        }
      }
    }
    return names.size;
  },

  toBuy() { return (this.shopping?.items || []).filter((i) => !i.checked); },

  /* Names on the list and not yet bought. The card's "on the list" tag is read
     from this rather than from the ingredient's own flag: the two used to be
     kept in step by seeding the list from the suggestions, and with six
     suggestions that is no longer true — only what somebody asked for is on
     there, and the card has to say so honestly. */
  listed() { return new Set(this.toBuy().map((i) => i.name)); },

  /* ---------- render ---------- */

  render() {
    const n = this.toBuy().length;
    this.ctx.setMeta(this.id, n ? `${n} to buy` : '');
    this.btnWeek?.classList.toggle('on', this.view === 'week' || this.view === 'day');
    this.btnList?.classList.toggle('on', this.view === 'shopping');
    this.btnPantry?.classList.toggle('on', this.view === 'pantry');

    this.body.style.opacity = '';   // only the compact stale view dims it
    if (this.missing) {
      this.body.innerHTML = `<div class="placeholder"><span class="big">◔</span>
        The food agent will suggest dinner here</div>`;
      return;
    }
    if (!this.sugg) return;   // first load still in flight

    if (this.view === 'shopping') return this.renderShopping();
    if (this.view === 'pantry') return this.renderPantry();
    if (this.view === 'week') return this.renderWeek();
    if (this.view === 'day' && this.dayOf(this.dayDate)) return this.renderDay();
    if (this.view === 'cook' && this.byId(this.cookId)) return this.renderCook();
    this.view = 'tonight';
    if (this.compact) return this.renderCompact();
    this.renderTonight();
  },

  /* The strip under the photographs shows what was decided if anything was —
     from the doorway "we are having the chili" is worth more than the card
     somebody last swiped to.

     One dinner per line, not two side by side. Side by side, each name had
     half a narrow strip and every one of them ended in an ellipsis:
     "Halloumi & couscou…" beside "Creamy chicken an…" is two dishes nobody can
     name. A line each is the same two dinners in the same height, and the
     strip is wide rather than tall, so the width was the thing to spend. The
     full card in the Cooking view is untouched — that panel has the room for
     two columns and needs them for the swipe. */
  renderCompact() {
    const chosen = this.sugg.chosen || {};
    const rs = KINDS.map((k) => this.byId(chosen[k]) || this.showing(k)).filter(Boolean);
    if (!rs.length) {
      this.body.innerHTML = `<div class="placeholder"><span class="big">◔</span>
        The food agent will suggest dinner here</div>`;
      return;
    }
    // The kicker leads the line so the eye finds "Cooking this" without
    // reading the dish first; the note trails in dim and is the first thing to
    // go, because a clipped note still reads and a clipped dish does not.
    this.body.innerHTML = `<div class="food-strip${this.narrow ? ' narrow' : ''}">${
      rs.map((r) => `
      <button class="food-line" data-id="${esc(r.id)}">
        <span class="kicker${r.kind === 'veg' ? '' : ' alt'}">${
          chosen[r.kind] === r.id ? 'Cooking this' : KIND_LABEL[r.kind]}</span>
        <span class="dish">${esc(r.title)}</span>
        ${this.narrow ? '' : `<span class="meta">${esc(r.note)}</span>`}
      </button>`).join('')}</div>`;
    this.body.style.opacity = this.sugg.stale ? '.5' : '';

    /* A dish name on the wall is a question — what is in it, how long does it
       take — and the strip has no room for the answer. Tapping one goes to the
       Cooking view and opens that very card, rather than the view's default:
       arriving at somebody else's suggestion is arriving at the wrong page. */
    this.body.querySelectorAll('.food-line').forEach((line) => {
      line.onclick = () => this.openInCooking(line.dataset.id);
    });
  },

  openInCooking(id) {
    const r = this.byId(id);
    if (r) {
      const i = this.ofKind(r.kind).findIndex((x) => x.id === r.id);
      if (i >= 0) this.pick[r.kind] = i;   // swipe that column to this card
    }
    this.view = 'tonight';
    // Falls back to expanding this panel where there is no Cooking preset to
    // go to, so the tap always ends somewhere the card actually fits.
    if (this.ctx.setPreset && this.ctx.config.layouts.presets.cooking) {
      this.ctx.setPreset('cooking');
    } else {
      document.querySelector('#p-food .expand')?.click();
    }
  },

  /* One dinner. `opts.readonly` is a day of the plan that is not today: the
     ticks and the decision belong to the day being cooked, and the server
     would refuse them anyway — the ingredient tick addresses a recipe in
     today's suggestions, and Thursday's is not there. Steps still works,
     because reading Thursday's recipe on Wednesday evening is exactly what
     somebody opening Thursday wants. */
  card(r, listed, chosen, opts = {}) {
    const ro = !!opts.readonly;
    const missing = r.ingredients.filter((i) => !i.have);
    const facts = [r.note, r.time_min && `${r.time_min} min`,
                   r.servings && `${r.servings} servings`].filter(Boolean);
    // What the line under the ingredients is for: before a choice it says what
    // this dinner would cost you in shopping, after one it says the list has
    // already been told.
    const line = !missing.length ? 'everything is at home'
      : ro ? `${missing.length} to buy`
      : chosen ? `${missing.length} on the shopping list`
      : `${missing.length} to buy if you pick this`;
    const glyph = (i) => `<span class="ck-glyph">${i.have ? '✓' : '＋'}</span>
      <span class="ck-iname">${esc(i.name)}</span>
      ${!i.have && listed.has(i.name) ? '<span class="ck-tag">on the list</span>' : ''}
      <span class="ck-qty">${esc(i.qty)}</span>`;
    return `
      <div class="ck-card${chosen ? ' on' : ''}" data-id="${esc(r.id)}">
        <div class="kicker${r.kind === 'veg' ? '' : ' alt'}">${KIND_LABEL[r.kind]}${
          chosen ? ' · cooking this' : ''}</div>
        <div class="ck-title">${esc(r.title)}</div>
        <div class="ck-note">${esc(facts.join(' · '))}</div>
        ${r.image ? `<img class="ck-pic" src="${esc(IMG(r.image))}" alt="">` : ''}
        <div class="ck-ings">${r.ingredients.map((i, idx) => ro
          ? `<div class="ck-ing static${i.have ? '' : ' need'}">${glyph(i)}</div>`
          : `<button class="ck-ing${i.have ? '' : ' need'}" data-i="${idx}">${
              glyph(i)}</button>`).join('')}</div>
        <div class="ck-needline${missing.length ? '' : ' ok'}">${line}</div>
        <div class="ck-actions">
          ${ro ? '' : `<button class="ck-choose${chosen ? ' on' : ''}">${
            chosen ? '✓ Cooking this' : 'Cook this one'}</button>`}
          <button class="ck-cookbtn">Steps</button>
          ${ro ? '' : `
          <button class="ck-rate${r.rating === 1 ? ' on up' : ''}" data-r="1">👍</button>
          <button class="ck-rate${r.rating === -1 ? ' on down' : ''}" data-r="-1">👎</button>`}
        </div>
      </div>`;
  },

  /* A recipe's picture is the one thing on these cards that can be missing
     without anybody having done anything wrong — a file deleted, a week
     planned against a picture that never uploaded. An empty frame says the
     dashboard is broken; no frame says nothing, which is the truth. */
  wirePictures() {
    this.body.querySelectorAll('.ck-pic, .wk-thumb, .ck-source').forEach((img) => {
      img.onerror = () => img.remove();
    });
  },

  /* "Stale" covers two very different situations and the panel used to say the
     same sentence for both. One day old is last night's dinner still sitting
     there in the morning. Eleven days old — which is what it actually said for
     eleven days — means nobody has planned anything since, and a banner that
     calls that "yesterday's" is the dashboard lying about its own age. */
  staleWords() {
    const n = this.sugg?.age_days;
    const days = this.week?.days || [];
    const last = days.length ? days[days.length - 1].date : null;
    const plan = last && !this.week.has_today
      ? ` · the plan runs to ${dayLong(last)}` : '';
    if (n === 1) return `yesterday's suggestions — nothing written for today yet${plan}`;
    if (!n || n < 0) return `these suggestions are not today's${plan}`;
    return `suggestions from ${dayLong(this.sugg.date)}, ${n} days ago${plan}`;
  },

  renderTonight() {
    this.body.style.opacity = '';
    if (!this.sugg.recipes?.length) {
      this.body.innerHTML = `<div class="placeholder"><span class="big">◔</span>
        The food agent will suggest dinner here</div>`;
      return;
    }
    const listed = this.listed();
    const chosen = this.sugg.chosen || {};
    KINDS.forEach((k) => this.showing(k));   // clamp: today may have fewer cards
    const column = (kind) => {
      const rs = this.ofKind(kind);
      if (!rs.length) return '';
      return `
        <div class="ck-col" data-kind="${kind}">
          <div class="ck-track">${rs.map((r) =>
            this.card(r, listed, chosen[kind] === r.id)).join('')}</div>
          ${rs.length > 1 ? `<div class="ck-dots">${rs.map((_, i) => `
            <button class="ck-dot${i === this.pick[kind] ? ' on' : ''}"
                    data-i="${i}" aria-label="suggestion ${i + 1}"><i></i></button>`)
            .join('')}</div>` : ''}
        </div>`;
    };
    this.body.innerHTML = `<div class="ck-wrap">
      ${this.sugg.stale ? `<div class="ck-stale">${esc(this.staleWords())}</div>` : ''}
      <div class="ck-cards">${KINDS.map(column).join('')}</div></div>`;
    this.wirePictures();

    // Wired to ids and indexes, never to objects: every save comes back over
    // SSE as a whole new doc, and a handler holding the old one edits an orphan.
    this.body.querySelectorAll('.ck-card').forEach((el) => {
      const id = el.dataset.id;
      el.querySelectorAll('button.ck-ing').forEach((btn) =>
        this.wireTap(btn, () => this.tick(id, Number(btn.dataset.i))));
      this.wireTap(el.querySelector('.ck-cookbtn'), () => {
        this.cookId = id; this.cookBack = 'tonight'; this.view = 'cook'; this.render();
      });
      this.wireTap(el.querySelector('.ck-choose'), () => this.choose(id));
      el.querySelectorAll('.ck-rate').forEach((btn) =>
        this.wireTap(btn, () => this.rate(id, Number(btn.dataset.r))));
    });
    this.body.querySelectorAll('.ck-col').forEach((col) => this.wireTrack(col));
  },

  /* The swipe itself is the browser's; this only keeps the dots and the saved
     choice in step with it, and lets a dot be tapped instead. Deliberately no
     re-render on scroll — rebuilding the DOM under a moving finger is how a
     carousel starts fighting the person using it. */
  wireTrack(col) {
    const kind = col.dataset.kind;
    const track = col.querySelector('.ck-track');
    const dots = [...col.querySelectorAll('.ck-dot')];
    const n = track.children.length;

    const mark = (i) => dots.forEach((d, j) => d.classList.toggle('on', i === j));
    // A render puts every track back at zero; the column has to return to the
    // card it was showing before the echo that caused it.
    const settle = () => {
      const w = track.clientWidth;
      if (w) track.scrollLeft = this.pick[kind] * w;
    };
    requestAnimationFrame(settle);

    track.addEventListener('scroll', () => {
      clearTimeout(this._scrollT);
      this._scrollT = setTimeout(() => {
        const w = track.clientWidth;
        if (!w) return;
        const i = Math.min(n - 1, Math.max(0, Math.round(track.scrollLeft / w)));
        if (i === this.pick[kind]) return;
        this.pick[kind] = i;
        mark(i);
        this.ctx.saveUiState({ cook_pick: { ...this.pick } });
      }, 90);
    });

    dots.forEach((dot, i) => this.wireTap(dot, () => {
      track.scrollTo({ left: i * track.clientWidth, behavior: 'smooth' });
      this.pick[kind] = i;
      mark(i);
      this.ctx.saveUiState({ cook_pick: { ...this.pick } });
    }));
  },

  /* The week, as rows rather than as seven columns.
     Seven columns on this panel is 170px each, and at 170px every dinner in
     the house ends in an ellipsis — the same arithmetic that made the strip
     under the photographs stack its two dishes instead of setting them side by
     side. A row per day gives each dinner half the panel's width, which is
     enough for the longest title anybody writes, and seven rows is a shape the
     eye reads as a week without being told. */
  renderWeek() {
    const wk = this.week;
    if (!wk?.days?.length) {
      this.body.innerHTML = `<div class="ck-wrap">
        ${this.listBar('The week', 'nothing planned')}
        <div class="placeholder">No week planned yet — hand Claude the
          photographs from the kitchen and ask for one</div></div>`;
      this.wireListBar();
      return;
    }
    const today = wk.today;
    const need = this.weekNeeds();

    const dish = (d, kind) => {
      const r = d[kind];
      if (!r) return '';
      const alts = (d.alternates?.[kind] || []).map((a) => a.title).filter(Boolean);
      const rating = d.rating?.[kind] ?? null;
      const meta = [r.time_min && `${r.time_min} min`,
                    alts.length && `or ${alts.join(' · ')}`].filter(Boolean).join(' · ');
      return `
        <div class="wk-dish">
          <button class="wk-open" data-date="${esc(d.date)}">
            ${r.image ? `<img class="wk-thumb" src="${esc(IMG(r.image))}" alt="">` : ''}
            <span class="wk-text">
              <span class="kicker${kind === 'veg' ? '' : ' alt'}">${KIND_LABEL[kind]}</span>
              <span class="wk-name">${esc(r.title)}</span>
              ${meta ? `<span class="wk-meta">${esc(meta)}</span>` : ''}
            </span>
          </button>
          ${d.date <= today ? `
            <button class="ck-rate${rating === 1 ? ' on up' : ''}" data-date="${
              esc(d.date)}" data-kind="${kind}" data-r="1">👍</button>
            <button class="ck-rate${rating === -1 ? ' on down' : ''}" data-date="${
              esc(d.date)}" data-kind="${kind}" data-r="-1">👎</button>` : ''}
        </div>`;
    };

    this.body.innerHTML = `<div class="ck-wrap">
      ${this.listBar('The week', wk.has_today ? `${wk.days.length} days planned`
        : `planned to ${dayNum(wk.days[wk.days.length - 1].date)} — not today`)}
      <div class="ck-listwrap wk-list">${wk.days.map((d) => `
        <div class="wk-row${d.date === today ? ' now' : ''}${
          d.date < today ? ' past' : ''}">
          <div class="wk-when">
            <b>${esc(dayShort(d.date))}</b>
            <span>${esc(dayNum(d.date))}</span>
            ${d.date === today ? '<span class="wk-today">today</span>' : ''}
          </div>
          <div class="wk-body">
            <div class="wk-dishes">${dish(d, 'veg')}${dish(d, 'normal')}</div>
            ${d.note ? `<div class="wk-daynote">${esc(d.note)}</div>` : ''}
          </div>
        </div>`).join('')}</div>
      <div class="ck-foot">
        <button class="ck-shop${need ? '' : ' off'}">${need
          ? `＋ Put ${need} thing${need === 1 ? '' : 's'} on the shopping list`
          : 'Nothing to add — the week is at home or on the list'}</button>
      </div></div>`;

    this.wireListBar();
    this.wirePictures();
    this.body.querySelectorAll('.wk-open').forEach((btn) =>
      this.wireTap(btn, () => this.openDay(btn.dataset.date)));
    this.body.querySelectorAll('.wk-dish .ck-rate').forEach((btn) =>
      this.wireTap(btn, () => this.rateDay(btn.dataset.date, btn.dataset.kind,
                                           Number(btn.dataset.r))));
    const shop = this.body.querySelector('.ck-shop');
    this.wireTap(shop, () => this.shopWeek(shop));
  },

  /* Today is not a page of the plan — it is the panel's own two columns, with
     the ticks and the decision on them. Sending the finger there rather than
     to a read-only copy of the same two dinners is the difference between
     looking at the week and using it. */
  openDay(date) {
    if (!date) return;
    if (date === this.week?.today) { this.view = 'tonight'; this.render(); return; }
    this.dayDate = date;
    this.view = 'day';
    this.render();
  },

  renderDay() {
    const d = this.dayOf(this.dayDate);
    const listed = this.listed();
    this.body.innerHTML = `<div class="ck-wrap">
      ${this.listBar(dayLong(d.date), d.note || '', '‹ Week')}
      <div class="ck-cards">${KINDS.map((k) => {
        const alts = (d.alternates?.[k] || []).map((a) => a.title).filter(Boolean);
        return `
        <div class="ck-col">
          <div class="ck-still">${this.card(d[k], listed, false, { readonly: true })}</div>
          ${alts.length ? `<div class="ck-alts">or ${esc(alts.join(' · '))}</div>` : ''}
        </div>`;
      }).join('')}</div></div>`;

    this.wireListBar('week');
    this.wirePictures();
    this.body.querySelectorAll('.ck-card').forEach((el) => {
      const id = el.dataset.id;
      this.wireTap(el.querySelector('.ck-cookbtn'), () => {
        this.cookId = id; this.cookBack = 'day'; this.view = 'cook'; this.render();
      });
    });
  },

  /* Rating a day is the half of the loop that was missing: a dinner could only
     be rated while its card was on the wall, so anything eaten after the cards
     turned over — which is most dinners — was never rated, and the history the
     next plan is supposed to learn from stayed empty. */
  rateDay(date, kind, rating) {
    const day = this.dayOf(date);
    if (!day) return;
    const now = day.rating?.[kind] ?? null;
    const next = now === rating ? null : rating;   // second tap takes it back
    day.rating = { ...(day.rating || {}), [kind]: next };
    this.dirty.week = true;
    this.post('/api/cooking/rate', { date, kind, rating: next });
    setTimeout(() => { this.dirty.week = false; }, 400);
    this.render();
  },

  /* The week's shopping, in one stroke, because the alternative is ticking
     thirty ingredients across seven cards. The server decides what is actually
     missing — this only asks and then says what happened. */
  async shopWeek(btn) {
    if (!btn) return;
    const was = btn.textContent;
    btn.textContent = 'adding…';
    this.dirty.shopping = true;
    try {
      const res = await fetch('/api/cooking/week/shop', { method: 'POST' });
      const out = await res.json();
      this.shopping = out.shopping || this.shopping;
      btn.textContent = out.added?.length
        ? `✓ ${out.added.length} added to the list` : '✓ nothing was missing';
    } catch {
      btn.textContent = was;
    }
    setTimeout(() => { this.dirty.shopping = false; this.render(); }, 1800);
  },

  renderCook() {
    const r = this.byId(this.cookId);
    this.body.innerHTML = `
      <div class="ck-wrap ck-cookview">
        <div class="ck-cookhead">
          <button class="ck-back">‹ Back</button>
          <div class="ck-cookname">
            <span class="kicker${r.kind === 'veg' ? '' : ' alt'}">${KIND_LABEL[r.kind]}</span>
            <span class="ck-title">${esc(r.title)}</span>
          </div>
        </div>
        <div class="ck-chips">${r.ingredients.map((i) => `
          <span class="ck-chip${i.have ? '' : ' need'}">${esc(i.name)}${
            i.qty ? ` <em>${esc(i.qty)}</em>` : ''}</span>`).join('')}</div>
        <div class="ck-cookbody">
          <ol class="ck-steps">${r.steps.map((s, idx) => `
            <li>
              <span class="ck-stepnum">${idx + 1}</span>
              <span class="ck-steptext">${esc(s.text)}</span>
              ${s.timer_min ? `<button class="ck-timer" data-min="${s.timer_min}">
                ⏱ ${s.timer_min} min</button>` : ''}
            </li>`).join('')}
            ${r.steps.length ? '' : '<li><span class="ck-steptext">No steps — the agent kept this one simple.</span></li>'}
          </ol>
          ${/* The page it was read off, beside the steps it was read into. A
                recipe photographed out of a book loses whatever the reader did
                not think to write down, and the cook is the one who finds out.
                Having the original here costs a column and settles it. */
            r.source_image ? `<img class="ck-source" src="${esc(IMG(r.source_image))}"
              alt="the page this recipe was read from">` : ''}
        </div>
      </div>`;
    this.wirePictures();
    this.wireTap(this.body.querySelector('.ck-back'), () => {
      this.view = this.cookBack || 'tonight'; this.render();
    });
    this.body.querySelectorAll('.ck-timer').forEach((btn) =>
      this.wireTap(btn, () => this.startTimer(Number(btn.dataset.min), r.title, btn)));
  },

  /* The way back to the dinners, at the top of every list this panel can show.
     The header's List and Pantry buttons are toggles and do come back when
     pressed a second time, but a lit button is a state, not a signpost: from
     inside a shopping list there was nothing on screen that said "dinners are
     that way", and a wall screen is read by people who did not build it. */
  listBar(title, note, back = '‹ Dinners') {
    return `<div class="ck-listbar">
      <button class="ck-back">${esc(back)}</button>
      <span class="ck-listtitle">${esc(title)}</span>
      <span class="ck-listnote">${esc(note || '')}</span>
    </div>`;
  },

  wireListBar(to = 'tonight') {
    const back = this.body.querySelector('.ck-back');
    if (back) this.wireTap(back, () => { this.view = to; this.render(); });
  },

  renderShopping() {
    const items = this.shopping?.items || [];
    const open = items.filter((i) => !i.checked);
    const done = items.filter((i) => i.checked);
    const row = (i) => `
      <button class="ck-row${i.checked ? ' done' : ''}" data-id="${esc(i.id)}">
        <span class="ck-glyph">${i.checked ? '✓' : '○'}</span>
        <span class="ck-iname">${esc(i.name)}</span>
        <span class="ck-qty">${esc(i.qty)}</span>
      </button>`;
    this.body.innerHTML = `<div class="ck-wrap">
      ${this.listBar('Shopping list',
        open.length ? `${open.length} to buy` : 'nothing to buy')}
      <div class="ck-listwrap">
        ${open.length ? open.map(row).join('')
          : '<div class="placeholder">Nothing to buy — add from a recipe, here, or in Telegram</div>'}
        ${done.length ? `<div class="ck-divider">bought — clears itself after a few days</div>
          ${done.map(row).join('')}` : ''}
      </div>
      <div class="ck-foot">
        <button class="ck-add">＋ Add</button>
        ${done.length ? '<button class="ck-clear">Clear bought</button>' : ''}
      </div></div>`;
    this.wireListBar();
    this.body.querySelectorAll('.ck-row').forEach((btn) =>
      this.wireTap(btn, () => this.check(btn.dataset.id)));
    this.wireTap(this.body.querySelector('.ck-add'), () => this.addItem('shopping'));
    this.wireTap(this.body.querySelector('.ck-clear'), () => {
      this.shopping.items = this.shopping.items.filter((i) => !i.checked);
      this.save('shopping', '/api/cooking/shopping');
      this.render();
    });
  },

  renderPantry() {
    const items = this.pantry?.items || [];
    this.body.innerHTML = `<div class="ck-wrap">
      ${this.listBar('Pantry', items.length ? `${items.length} at home` : 'empty')}
      <div class="ck-listwrap">
        ${items.length ? items.map((i) => {
          const a = age(i.added);
          return `
          <div class="ck-row static${a.stale ? ' stale' : ''}" data-id="${esc(i.id)}">
            <span class="ck-iname">${esc(i.name)}</span>
            <span class="ck-qty">${esc(i.qty)}</span>
            <span class="ck-age">${a.txt}</span>
            <button class="ck-del" aria-label="remove">✕</button>
          </div>`;
        }).join('')
          : '<div class="placeholder">Nothing here yet — send a receipt photo to the Telegram bot, or add by hand</div>'}
      </div>
      <div class="ck-foot"><button class="ck-add">＋ Add</button></div></div>`;
    this.wireListBar();
    this.body.querySelectorAll('.ck-del').forEach((btn) =>
      this.wireTap(btn, () => {
        const id = btn.closest('.ck-row').dataset.id;
        this.pantry.items = this.pantry.items.filter((i) => i.id !== id);
        this.save('pantry', '/api/cooking/pantry');
        this.render();
      }));
    this.wireTap(this.body.querySelector('.ck-add'), () => this.addItem('pantry'));
  },

  /* ---------- actions ---------- */

  tick(recipeId, index) {
    const r = this.byId(recipeId);
    const ing = r?.ingredients[index];
    if (!ing) return;
    const have = !ing.have;
    ing.have = have;                       // optimistic; the echo confirms
    // The list only follows a dinner that was actually chosen — correcting the
    // agent about a recipe nobody picked must not fill the trolley. Mirrored
    // locally as well so the "3 to buy" meta moves under the finger.
    const chosen = (this.sugg.chosen || {})[r.kind] === recipeId;
    if (this.shopping && chosen) {
      if (have) {
        this.shopping.items = this.shopping.items.filter((i) =>
          !(i.name === ing.name && !i.checked && i.source === 'recipe'
            && i.recipe_id === recipeId));
      } else if (!this.shopping.items.some((i) => i.name === ing.name && !i.checked)) {
        this.shopping.items.push({ id: `tmp-${index}`, name: ing.name, qty: ing.qty,
          checked: false, checked_at: null, source: 'recipe',
          recipe_id: recipeId, staple: false });
      }
    }
    this.post('/api/cooking/ingredient', { recipe_id: recipeId, index, have });
    this.render();
  },

  /* "We are cooking this one." The server moves the shopping list to match and
     broadcasts both documents; the optimistic flip here is only so the card
     answers the finger rather than the network. */
  async choose(recipeId) {
    const r = this.byId(recipeId);
    if (!r) return;
    const chosen = { ...(this.sugg.chosen || {}) };
    if (chosen[r.kind] === recipeId) delete chosen[r.kind];
    else chosen[r.kind] = recipeId;
    this.sugg = { ...this.sugg, chosen };
    this.render();

    this.dirty.sugg = this.dirty.shopping = true;
    try {
      await fetch('/api/cooking/choose', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ recipe_id: recipeId }),
      });
    } catch { /* the broadcast, or the next load, settles it */ }
    setTimeout(() => { this.dirty.sugg = this.dirty.shopping = false; }, 400);
  },

  rate(recipeId, rating) {
    const r = this.byId(recipeId);
    if (!r) return;
    r.rating = r.rating === rating ? null : rating;   // second tap takes it back
    this.post('/api/cooking/rate', { recipe_id: recipeId, rating: r.rating });
    this.render();
  },

  check(id) {
    const it = (this.shopping?.items || []).find((i) => i.id === id);
    if (!it) return;
    it.checked = !it.checked;
    it.checked_at = it.checked ? new Date().toISOString() : null;
    this.save('shopping', '/api/cooking/shopping');
    this.render();
  },

  /* prompt() is fine here: adding by typing is a phone gesture (the wall has
     no keyboard), and the phone opens this same page. On the wall the primary
     ways in are ingredient ticks and the Telegram agent. */
  addItem(which) {
    const name = (window.prompt(which === 'pantry'
      ? 'Add to the pantry:' : 'Add to the shopping list:') || '').trim();
    if (!name) return;
    if (which === 'pantry') {
      this.pantry.items.push({ id: `tmp-${Date.now()}`, name: name.toLowerCase(),
        qty: '', category: '', added: new Date().toISOString().slice(0, 10),
        source: 'manual' });
      this.save('pantry', '/api/cooking/pantry');
    } else {
      this.shopping.items.push({ id: `tmp-${Date.now()}`, name: name.toLowerCase(),
        qty: '', checked: false, checked_at: null, source: 'manual',
        recipe_id: null, staple: false });
      this.save('shopping', '/api/cooking/shopping');
    }
    this.render();
  },

  /* A recipe step borrows a kitchen timer: first idle dial, set and started,
     labeled with the dish. The timers panel beside this one lights up through
     its own SSE subscription — nothing here talks to it directly. */
  async startTimer(min, label, btn) {
    try {
      const res = await (await fetch('/api/timers')).json();
      const timers = res.timers || [];
      const t = timers.find((x) => x.state === 'idle');
      if (!t) {
        const was = btn.textContent;
        btn.textContent = 'no free timer';
        setTimeout(() => { btn.textContent = was; }, 1800);
        return;
      }
      const now = res.now ? res.now * 1000 : Date.now();
      t.state = 'running';
      t.duration_s = min * 60;
      t.ends_at = (now + min * 60 * 1000) / 1000;
      t.remaining_s = null;
      t.label = String(label).slice(0, 40);
      await fetch('/api/timers', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ timers }),
      });
      btn.classList.add('on');
      btn.textContent = '⏱ running';
    } catch { /* the timers panel is the authority; nothing to clean up */ }
  },

  /* Pointer-wired taps, for the reason timers.js gives: a click is only
     synthesised once the browser has ruled out a drag, and a knuckle on a wall
     screen travels far enough to lose it.

     Unlike timers.js this one takes no pointer capture and prevents no default,
     because almost every button here sits inside something that scrolls — the
     card carousel sideways, the ingredient and shopping lists downward. Capture
     would take the gesture away from the scroller, and the panel would answer a
     swipe by ticking whichever ingredient the finger happened to land on. The
     browser sends `pointercancel` the moment it decides the gesture is a scroll,
     which disarms the tap; a small travel budget catches the rest. */
  wireTap(btn, fn) {
    if (!btn) return;
    let armed = false, x0 = 0, y0 = 0;
    btn.addEventListener('pointerdown', (e) => {
      armed = true; x0 = e.clientX; y0 = e.clientY;
    });
    btn.addEventListener('pointerup', (e) => {
      if (!armed) return;
      armed = false;
      if (Math.hypot(e.clientX - x0, e.clientY - y0) > 12) return;
      fn();
    });
    ['pointercancel', 'pointerleave'].forEach((ev) =>
      btn.addEventListener(ev, () => { armed = false; }));
    btn.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); fn(); }
    });
  },
};
