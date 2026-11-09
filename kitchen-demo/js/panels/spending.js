// Food spending: what the kitchen has paid for food, read off the receipts and
// the costs somebody told the agent. The backend (backend/app/spending.py) owns
// the ledger and does every sum, with its own clock, so the wall never decides
// which week it is. The agent is the only thing that writes; this panel only
// ever reads.
//
// On House it is a strip across the top of the right-hand column: this week's
// food so far, last week and the usual week beside it, and where the money
// went in one line under them. The whole strip is the button to the rest.
// Expanded — by that tap or by ⤢ — it is the statistics page: weeks, months or
// years as bars, the one being read said in words above them, its receipts
// under them, and every category down the right, each of which can be followed
// back through the bars.
//
// The page is the panel's own expanded state, as the Cooking panel's week is,
// rather than a sheet laid over the body: it gets the views and the clock in
// its header without asking, and it comes back after a reload because
// ui-state already remembers which panel was expanded. Where it had got to
// does not come back with it — see onCollapse().

const RETRY_MS = 5 * 60 * 1000;   // backend older than this frontend: try again
const PERIODS = [['week', 'Week'], ['month', 'Month'], ['year', 'Year']];

/* Said instead of "No spending yet" when the server could not read its file.
   An empty-looking ledger would invite a first receipt on top of years of
   them; the server refuses every write until the file is fixed, so what is on
   disk is still exactly what was there, and this says so. */
const BROKEN = 'The spending file on the server could not be read — nothing has been changed';

const esc = (s) => String(s ?? '').replace(/[&<>"]/g,
  (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

/* Kronor the way a Swedish receipt prints them — "1 235 kr", a space between
   the thousands — and a named locale rather than the browser's, so the wall
   and a laptop reading the same page cannot disagree. Whole kronor wherever
   figures are set against each other; a receipt's own total keeps its öre, so
   the list still matches the paper in the drawer. The space before "kr" is a
   non-breaking one: a figure split from its unit at the end of a line reads
   as two things. */
const WHOLE = new Intl.NumberFormat('sv-SE', { maximumFractionDigits: 0 });
const EXACT = new Intl.NumberFormat('sv-SE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const num = (x) => WHOLE.format(Number(x) || 0);
const kr = (x) => `${num(x)}\u00a0kr`;
const paper = (x) => (Number.isInteger(Number(x)) ? num(x) : EXACT.format(Number(x) || 0));

/* A purchase date as a date in this kitchen, not in UTC — new Date(iso) reads
   a bare date as midnight UTC, which west of Greenwich is the evening before. */
function localDate(iso) {
  const [y, m, d] = String(iso || '').split('-').map(Number);
  return (y && m && d) ? new Date(y, m - 1, d) : null;
}

/* "Sat 19 Sep". The weekday is en-GB's, named for the reason food.js gives;
   the month is spelt here, because en-GB now prints September as "Sept" and
   the server's labels, on the same page a few lines up, say "Sep". */
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
function dayName(iso) {
  const d = localDate(iso);
  if (!d) return '';
  return `${d.toLocaleDateString('en-GB', { weekday: 'short' })} ${d.getDate()} ${MON[d.getMonth()]}`;
}
const dayMonth = (iso) => {
  const d = localDate(iso);
  return d ? `${d.getDate()} ${MON[d.getMonth()]}` : '';
};

/* A category inside a sentence: "12 % above your usual week for meat". The
   labels are written for a list, so they are lowered; "Not itemised" is not a
   kind of food at all, and gets words of its own. */
const word = (c) => (c.key === 'unsorted' ? 'unitemised spending'
  : String(c.label || c.key).toLowerCase());

/* A period inside a sentence: "week 38", "September 2026", "2026". */
const called = (b, period) => (period === 'week'
  ? String(b.long || '').split(' · ')[0].toLowerCase() : String(b.long || ''));

const purchases = (n) => `${n} purchase${n === 1 ? '' : 's'}`;
const times = (n) => (n === 1 ? 'once' : n === 2 ? 'twice' : `${n} times`);

/* Colour (2026-10-12, Alex: "more colourful … a pie chart of which things we
   usually spend weekly"). Eight categories have a colour of their own, the
   dark steps of a palette tested for colour-blind separation, in the tested
   order, and the pie and the stacks always draw them in this order so
   neighbours stay the pairs that were tested. Everything else — fish,
   frozen, snacks, ready meals, other, not itemised — is one neutral, "the
   rest". A colour belongs to its category everywhere on the page, never to a
   rank, and every coloured mark has its name beside it in a legend or row. */
const HUES = [
  ['dairy', '#3987e5'], ['bread', '#d95926'], ['drinks', '#199e70'], ['pantry', '#c98500'],
  ['fruit', '#d55181'], ['vegetables', '#008300'], ['takeaway', '#9085e9'], ['meat', '#e66767'],
];
const HUE = Object.fromEntries(HUES);
const REST = { key: '_rest', label: 'Everything else', short: 'Rest', color: '#8e8676' };
const HOUSEHOLD = '#5f5745';
const colorOf = (key) => HUE[key] || (key === 'household' ? HOUSEHOLD : REST.color);

/* Food categories folded to the eight and "the rest", in drawing order;
   household is not food and is left out. */
function fold(cats) {
  const by = Object.fromEntries((cats || []).map((c) => [c.key, c]));
  const out = HUES.filter(([k]) => by[k]?.amount > 0).map(([k, color]) => ({ ...by[k], color }));
  const rest = (cats || []).filter((c) => !HUE[c.key] && c.key !== 'household' && c.amount > 0);
  const restAmt = rest.reduce((a, c) => a + c.amount, 0);
  if (restAmt > 0) {
    out.push({ ...REST, amount: restAmt, parts: rest.map((c) => c.short).join(', ') });
  }
  return out;
}

// Economy's tabs (2026-10-19, Alex: "different tabs inside the economy (like
// in the House tab)"): Food is this page, Travel is travel.js's, drawn into
// the same body. The tabs stand after the name only while the page is open;
// small, on House, this is the food strip and nothing else. Every visit
// starts on Food, as it starts on this week (onCollapse()).
const TABS = [['food', 'Food'], ['travel', 'Travel']];

export default {
  id: 'spending',
  title: 'Food spending',

  init(body, ctx) {
    this.ctx = ctx;
    this.body = body;
    this.sum = null;          // the summary, or null before it has arrived
    this.missing = false;     // this server has no /api/spending yet (older deploy)
    this.heard = 0;           // summaries the bus has delivered; see load()
    this.expanded = false;
    this.catLines = [];       // the category line, longest first; see fitCats()

    // The statistics page. Where it is looking lives here and nowhere else —
    // onCollapse() says why none of it goes into ui-state.
    this.period = 'week';
    this.pick = 'current';    // the bar being read: its start date, or 'current'
    this.follow = null;       // {key, label, short} of the category followed
    this.stats = null;
    this.statsFollow = null;  // the category those stats were asked for; see refresh()
    this.list = null;         // the receipts behind that bar, with the query they answer
    this.failed = false;
    this.seqStats = 0;        // answers can arrive out of order; only the last counts
    this.seqList = 0;

    // In the header, like the Cooking panel's own buttons, and only while the
    // page is open: small, the header has the week and its purchases to say.
    this.btns = {};
    for (const [p, label] of PERIODS) {
      this.btns[p] = ctx.addHeaderButton(this.id, label, () => this.setPeriod(p));
    }
    this.nameEl = body.parentElement?.querySelector(':scope > header .name');
    this.tab = 'food';
    if (this.nameEl) {
      this.tabsEl = document.createElement('span');
      this.tabsEl.className = 'ec-tabs';
      this.tabsEl.setAttribute('role', 'tablist');
      this.tabsEl.innerHTML = TABS.map(([key, label]) =>
        `<button class="ha-tab ec-tab" role="tab" data-tab="${key}">${label}</button>`).join('');
      this.nameEl.after(this.tabsEl);
      this.tabsEl.querySelectorAll('.ec-tab').forEach((b) => {
        b.onclick = (e) => { e.stopPropagation(); this.setTab(b.dataset.tab); };
      });
    }
    // Travel's page (travel.js), loaded by app.js with the build's stamp.
    this.travel = ctx.travel;
    this.travel.init(ctx);
    this.travel.onMeta = () => { if (this.expanded && this.tab === 'travel') this.ctx.setMeta(this.id, this.travel.meta()); };
    // Under every tab, while the page is open: a box for notes to the kitchen
    // agent, typed or spoken (notes.js). Beside the body rather than in it,
    // so neither page has to make room for it; CSS hides it on the strip.
    this.notes = ctx.notes;
    this.notes.init(ctx);
    this.foot = document.createElement('footer');
    this.foot.className = 'ec-notes';
    body.after(this.foot);
    this.notes.mount(this.foot, () => this.tab);

    ctx.bus.on('spending', (sum) => this.absorb(sum));
    this.ro = new ResizeObserver(() => this.fitCats());
    this.ro.observe(body);
    // The category line is fitted by measuring it, and measured before the
    // webfont has arrived it is measured in the wrong letters.
    document.fonts?.ready.then(() => this.fitCats());
    this.load();
  },

  /* The summary rides the SSE snapshot, so this fetch is a first answer for a
     bus that has not connected yet, and the way a missing backend is noticed. */
  async load() {
    clearTimeout(this._retry);
    const heard = this.heard;
    try {
      const res = await fetch('/api/spending');
      // 404 is "not deployed yet", never an answer: a plain ./sync.sh pushes
      // this file without rebuilding the backend it talks to.
      if (!res.ok) throw new Error('not there yet');
      const sum = await res.json();
      // The bus may have spoken while this was in flight, and anything it said
      // is newer than what this asked for.
      if (this.heard === heard) this.absorb(sum, true);
    } catch {
      if (this.sum) return;
      this.missing = true;
      this._retry = setTimeout(() => this.load(), RETRY_MS);
      this.render();
    }
  },

  /* Any summary at all is the answer, from the bus or from the fetch: it takes
     the "not set up" placeholder down and stops the retry, as the Cooking
     panel's absorb() does. */
  absorb(sum, fetched = false) {
    if (!sum || typeof sum !== 'object' || !sum.week) return;
    if (!fetched) this.heard += 1;
    clearTimeout(this._retry);
    this.sum = sum;
    this.missing = false;
    this.render();
    // A new summary means the ledger changed, or the day did. The page is
    // drawn from its own fetches, so it asks again rather than keep old bars.
    if (this.expanded) this.refresh();
  },

  /* "Food spending" names the strip among the other House panels. Full
     screen the page is the only thing there, and its header also carries the
     clock, the next event, the views and three period buttons: at the long
     name the event was cut to "1 day Ka…", and an event nobody can read is
     the one thing that chip is for. app.js fitted the chips to this header
     before onExpand() ran, with the long name still in it, so it is asked to
     fit them again the way a resize asks it. */
  onExpand() {
    this.expanded = true;
    if (this.nameEl) this.nameEl.textContent = 'Economy';
    this.tab = 'food';
    this.paintTabs();
    this.notes.retab();
    dispatchEvent(new Event('resize'));
    this.body.innerHTML = '';
    this.refresh();
  },

  /* Food or Travel. Food's period buttons are Food's: on Travel they go. */
  setTab(tab) {
    if (!this.expanded || !TABS.some(([k]) => k === tab)) return;
    if (tab === this.tab) {
      if (tab === 'travel' && this.travel.open) this.travel.back();   // the lit tab again: back to the cards
      return;
    }
    this.tab = tab;
    this.paintTabs();
    this.notes.retab();
    this.seqStats += 1;       // a food answer still in flight must not draw over travel
    this.seqList += 1;
    this.body.innerHTML = '';
    if (tab === 'travel') {
      this.ctx.setMeta(this.id, this.travel.meta());
      this.travel.show(this.body);
    } else {
      this.travel.hide();
      this.render();
      this.refresh();
    }
  },

  paintTabs() {
    this.tabsEl?.querySelectorAll('.ec-tab').forEach((b) => {
      const on = b.dataset.tab === this.tab;
      b.classList.toggle('on', on);
      b.setAttribute('aria-selected', String(on));
    });
    for (const btn of Object.values(this.btns)) btn.style.display = this.tab === 'food' ? '' : 'none';
  },

  /* Every visit starts at this week and every category. Somebody tapping
     "so far this week" expects to arrive at this week — not at last year, or
     at meat, because that is where the last person to use the page left it.
     So nothing about it is kept in ui-state, which is the whole wall's shared
     state and no place for one reader's browsing; only `expanded` is, which
     app.js keeps for every panel, so a reload comes back to the page. */
  onCollapse() {
    this.expanded = false;
    if (this.nameEl) this.nameEl.textContent = this.title;
    this.travel.hide();
    this.notes.leave();
    this.tab = 'food';
    this.paintTabs();
    this.period = 'week';
    this.pick = 'current';
    this.follow = null;
    this.stats = null;
    this.statsFollow = null;
    this.list = null;
    this.failed = false;
    this.seqStats += 1;       // anything still in flight was for a page that is gone
    this.seqList += 1;
    this.render();
  },

  /* The strip is the way in, and ⤢ is the same door. Pressing that button
     rather than expanding directly keeps app.js the only thing that knows how
     a panel fills the screen. */
  open() {
    if (!this.expanded) document.querySelector('#p-spending .expand')?.click();
  },

  paintButtons() {
    for (const [p, btn] of Object.entries(this.btns)) btn.classList.toggle('on', p === this.period);
  },

  /* ---------- the strip ---------- */

  render() {
    this.paintButtons();
    const s = this.sum;
    if (this.expanded && this.tab === 'travel') { this.ctx.setMeta(this.id, this.travel.meta()); return; }
    this.ctx.setMeta(this.id, s ? this.meta(s) : '');
    if (this.expanded) return;          // the page draws itself from its own fetches

    if (this.missing) {
      this.body.innerHTML = '<div class="placeholder">Spending is not set up on the server yet</div>';
      return;
    }
    if (!s) { this.body.innerHTML = ''; return; }   // first load still in flight
    if (s.broken) {
      this.body.innerHTML = `<div class="placeholder sp-broken">${BROKEN}</div>`;
      return;
    }
    if (!s.count) {
      this.body.innerHTML =
        '<div class="placeholder">No spending yet — give the kitchen agent a receipt</div>';
      return;
    }

    /* Food, not the receipt's total: a big cleaning week must not read as a
       week of eating more. The household part is still said, dimmed, after
       the categories when there is room for it — after them and never in
       place of one: a carrier bag is on nearly every receipt, and 3 kr of it
       would push out the third category nearly every week. */
    const w = s.week;
    const cats = (w.by_category || []).filter((c) => c.key !== 'household' && c.amount > 0);
    const slot = (c) => `<span>${esc(c.short)} <b>${num(c.amount)}</b></span>`;
    const home = w.household > 0 ? `<span class="sp-hh">+ ${kr(w.household)} household</span>` : '';
    const line = (parts) => parts.join(' · ');
    const top = cats.slice(0, 3).map(slot);
    this.catLines = !w.entries ? ['<span class="sp-hh">nothing recorded yet this week</span>']
      : [home && line([...top, home]), line(top), line(top.slice(0, 2)),
         line(top.slice(0, 1))].filter(Boolean);

    /* Last week only when something is on record for it. On the first day of
       the ledger, or after a week nobody wrote down, a bare "0 kr" would say
       nothing was spent — the page and the usual week treat such a week as
       unrecorded, not free, and so does this. */
    const last = s.last_week?.entries > 0
      ? `<div class="sp-cmp">last week <b>${kr(s.last_week.food)}</b></div>` : '';

    this.body.innerHTML = `
      <div class="sp-sum tappable" role="button" tabindex="0"
           aria-label="food spending by week, month and year">
        <div class="sp-top">
          <div class="sp-hero">
            <div class="sp-big">${kr(w.food)}</div>
            <div class="sp-cap">so far this week</div>
          </div>
          <div class="sp-side">
            ${last}
            ${s.usual_week != null ? `<div class="sp-cmp">usual <b>${kr(s.usual_week)}</b></div>` : ''}
          </div>
        </div>
        <div class="sp-cats">${this.catLines[0] || ''}</div>
      </div>`;

    const el = this.body.querySelector('.sp-sum');
    el.addEventListener('click', () => this.open());
    el.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); this.open(); }
    });
    this.fitCats();
  },

  /* "Week 38 · 3 purchases", and how many rows of the file the server could
     not read, when there are any: those purchases are missing from every
     figure here, and the header is the one line both sizes of the panel show. */
  meta(s) {
    const parts = [s.week.label];
    if (s.week.entries) parts.push(purchases(s.week.entries));
    if (s.unreadable > 0) parts.push(`${s.unreadable} unreadable`);
    return parts.join(' · ');
  },

  /* Three categories and the household after them if all of it fits, then
     the three alone, then two, then one — a line cut off in the middle of a
     figure says a wrong number, which is worse than saying fewer. Measured
     rather than counted, because the width depends on the labels and on how
     many digits this week has. */
  fitCats() {
    if (this.expanded) return;
    const line = this.body.querySelector('.sp-cats');
    if (!line || !line.clientWidth) return;   // not on screen: measured when it is
    for (const html of this.catLines) {
      line.innerHTML = html;
      if (line.scrollWidth <= line.clientWidth) return;
    }
  },

  /* ---------- the statistics page ---------- */

  setPeriod(p) {
    if (!this.expanded) return;       // hidden while small; ⤢ is the way in
    // The lit one pressed again is the way back to now from a past bar.
    if (p === this.period) { this.choose('current'); return; }
    this.period = p;
    this.refresh();
  },

  /* The buttons and the rows light under the finger, before the answer is
     in; what they asked for is remembered with the answer, so the page can
     tell whether the bars in hand are the ones the controls say. */
  async refresh() {
    if (this.tab !== 'food') return;
    const mine = ++this.seqStats;
    const follow = this.follow;
    this.paintButtons();
    const q = new URLSearchParams({ period: this.period });
    // Left out, never "null": the server refuses a category it does not know,
    // and it is right to.
    if (follow) q.set('category', follow.key);
    let stats = null;
    try {
      const res = await fetch(`/api/spending/stats?${q}`);
      if (res.ok) stats = await res.json();
    } catch { /* see below; the next summary on the bus asks again */ }
    if (mine !== this.seqStats || !this.expanded) return;
    // A refetch that fails keeps the page it had: a blip in the network is
    // not the backend going away, and only a page with nothing on it yet
    // says that it is not set up. The controls go back with it — Month lit
    // over weekly bars, or Meat over all the food, would be read as an answer
    // to what they ask, figures and words both wrong. When they already agree
    // (the bus asked, nobody pressed anything) the page is left alone, so a
    // list somebody is reading down is not redrawn back to its top.
    if (!stats && this.stats) {
      if (!this.answers() || this.drawn !== this.pick) {
        this.period = this.stats.period;
        this.follow = this.statsFollow;
        this.renderPage();
      }
      return;
    }
    // A new period starts at its current bar: week 31 means nothing to the
    // month view, and a week that begins on the 1st would be taken for a
    // month. Reset here, when the new bars are in, rather than on the press,
    // so a press that fails leaves the bar being read where it was.
    if (stats && stats.period !== this.stats?.period) this.pick = 'current';
    this.stats = stats;
    this.statsFollow = follow;
    this.failed = !stats;
    this.renderPage();
  },

  /* Whether the stats in hand answer what the buttons and the rows say. */
  answers() {
    const st = this.stats;
    return !!st && st.period === this.period
      && (st.category || null) === (this.follow?.key || null);
  },

  /* The bar being read. Held as its start date, never as a position: the
     series moves along by one every Monday, and a week somebody picked must
     not quietly become the week after it. Gone from the series, or never
     picked, means the current one. */
  selected() {
    const all = this.stats?.buckets || [];
    const live = all.filter((b) => !b.before_first);
    return (this.pick !== 'current' && live.find((b) => b.start === this.pick))
      || all.find((b) => b.current) || all[all.length - 1] || null;
  },

  /* Drawn now only over bars that answer the controls. While another period
     or category is on its way, the old bars are still on screen, and a bar
     tapped among them drawn with the new words would be a week's food called
     a month of meat; the refresh() in flight draws the pick when it lands. */
  choose(pick) {
    // Compared with the bar on screen, not only the one asked for: a pick
    // made while other bars were loading, whose load then failed, was stored
    // but never drawn, and tapping it again has to draw it.
    if (pick === this.pick && pick === this.drawn) return;
    this.pick = pick;
    if (this.answers()) this.renderPage();
  },

  /* Following a category turns every bar into that category, so the stats are
     asked for again. The row lights under the finger straight away; the
     figures follow when the answer does. */
  followCat(c) {
    this.follow = this.follow?.key === c.key ? null : c;
    this.body.querySelectorAll('.sp-cat').forEach((row) =>
      row.classList.toggle('on', row.dataset.key === this.follow?.key));
    this.refresh();
  },

  renderPage() {
    if (this.tab !== 'food') return;
    this.paintButtons();
    const st = this.stats;
    if (this.failed) {
      this.body.innerHTML = '<div class="placeholder">Spending is not set up on the server yet</div>';
      return;
    }
    if (!st) return;
    if (st.broken) {
      this.body.innerHTML = `<div class="placeholder sp-broken">${BROKEN}</div>`;
      return;
    }
    if (!st.first_date) {
      this.body.innerHTML =
        '<div class="placeholder">No spending yet — give the kitchen agent a receipt</div>';
      return;
    }
    const b = this.selected();
    if (!b) return;
    this.drawn = this.pick;

    this.body.innerHTML = `
      <div class="sp-page">
        <div class="sp-left">
          ${this.reading(st, b)}
          ${this.chart(st, b)}
          ${this.insights(st, b)}
          <div class="sp-head sp-rcap"></div>
          <div class="sp-rlist"></div>
        </div>
        <div class="sp-right">
          ${this.donut(st)}
          <div class="sp-head">Where it went <span class="sp-headsub">${esc(called(b, this.period))}</span></div>
          <div class="sp-where">${this.where(b)}</div>
        </div>
      </div>`;

    this.body.querySelectorAll('.sp-col[data-start]').forEach((col) =>
      this.wireTap(col, () => this.choose(col.dataset.now ? 'current' : col.dataset.start)));
    this.body.querySelectorAll('.sp-cat').forEach((row) =>
      this.wireTap(row, () => this.followCat({
        key: row.dataset.key, label: row.dataset.label, short: row.dataset.short,
      })));
    this.body.querySelectorAll('.sp-leg[data-key]').forEach((row) =>
      this.wireTap(row, () => this.followCat({
        key: row.dataset.key, label: row.dataset.label, short: row.dataset.short,
      })));
    this.wireTap(this.body.querySelector('.sp-pill'), () => this.followCat(this.follow));
    this.loadReceipts();
  },

  /* The figure being read, and what it means. A week still running is never
     given a percentage: on a Tuesday its total against a whole usual week
     reads "70 % below", which says nothing about the week except the day. */
  reading(st, b) {
    const f = this.follow;
    const home = f ? 0 : (b.by_category || []).find((c) => c.key === 'household')?.amount || 0;
    return `
      <div class="sp-read">
        <div class="sp-readhead">
          <span class="sp-long">${esc(b.long)}</span>
          ${f ? `<button class="sp-pill" aria-label="stop following ${esc(word(f))}">Following:
            <b>${esc(f.label)}</b><span class="sp-unfollow">✕</span></button>` : ''}
        </div>
        <div class="sp-readbody">
          <span class="sp-amt">${kr(b.amount)}</span>
          <span class="sp-words">
            <span class="sp-said">${esc(this.compare(st, b))}</span>
            ${home > 0 ? `<span class="sp-said-hh">+ ${kr(home)} household</span>` : ''}
          </span>
        </div>
      </div>`;
  },

  compare(st, b) {
    const noun = this.period;
    const f = this.follow;
    const of = f ? ` for ${word(f)}` : '';
    const u = st.usual;
    if (b.current) {
      const so = `so far · ${b.days_elapsed} of ${b.days_total} days`;
      return u == null ? `${so} · not enough history for a usual ${noun} yet`
        : `${so} · usual ${noun}${of} ${kr(u)}`;
    }
    // The ledger began part of the way through this one, so it holds only
    // part of what was spent — the usual leaves it out for the same reason.
    if (b.partial_start) return `only part of the ${noun} — the ledger starts ${dayMonth(st.first_date)}`;
    // Nothing on record is a week nobody wrote down, not a week nobody ate.
    if (!b.entries) return `nothing recorded — left out of your usual ${noun}`;
    if (u == null) return `not enough history for a usual ${noun} yet`;
    if (u <= 0) return `your usual ${noun} has no ${f ? word(f) : 'food'}`;
    // "100 % below" is arithmetic; "none" is what happened.
    if (b.amount <= 0) return `none — your usual ${noun}${of} is ${kr(u)}`;
    const p = Math.round(((b.amount - u) / u) * 100);
    if (Math.abs(p) <= 5) return `about your usual ${noun}${of}`;
    return `${Math.abs(p)}\u00a0% ${p > 0 ? 'above' : 'below'} your usual ${noun}${of}`;
  },

  /* Columns of HTML rather than a drawing: every bar carries its figure in the
     same type as the rest of the page, a bar is a button as tall as the chart,
     and nothing is scaled with a viewBox into text nobody can read. A bar
     without its number is a shape, and this wall has had a chart taken away
     for being only that (see the weather sheet in app.css). */
  chart(st, b) {
    const live = st.buckets.filter((x) => !x.before_first);
    // Years from before the ledger are left off altogether. A week or a
    // month before it is one gap in a row of a dozen, and says where the
    // record starts; three empty years out of five are most of the chart
    // saying nothing. The chart is then only as wide as its columns need
    // (--n, see .sp-chart): a ledger in its first year is one column of the
    // width five had, not a lit block across half the screen.
    const shown = st.period === 'year' ? live : st.buckets;
    const top = Math.max(0, st.usual || 0, ...live.map((x) => x.amount));
    const h = (v) => (top > 0 ? Math.max(0, v) / top : 0).toFixed(4);
    const f = this.follow;
    const cols = shown.map((x) => {
      // Before the ledger began there is nothing to draw, and a zero there
      // would say that nothing was spent.
      if (x.before_first) return `<div class="sp-col sp-void"><span class="sp-x">${esc(x.label)}</span></div>`;
      const cls = `sp-col${x.start === b.start ? ' on' : ''}${x.current ? ' now' : ''}`;
      const note = x.current ? '<i>so far</i>' : x.partial_start ? '<i>partial</i>' : '';
      // Stacked by category, bottom up in the pie's order; one colour while a
      // category is followed. The segments' heights are shares of the same
      // scale as the bar, so the stack is exactly as tall as it was alone.
      const segs = f ? [{ key: f.key, label: f.label, amount: x.amount, color: colorOf(f.key) }]
        : fold(x.by_category);
      const tip = segs.map((c) => `${c.label} ${kr(c.amount)}`).join(' · ');
      return `
        <button class="${cls}" data-start="${esc(x.start)}"${x.current ? ' data-now="1"' : ''}
                style="--h:${h(x.amount)}" title="${esc(tip)}"
                aria-label="${esc(`${x.long}, ${kr(x.amount)}: ${tip}`)}">
          <span class="sp-val">${num(x.amount)}${note}</span>
          <span class="sp-bar">${segs.map((c) => `<i style="--s:${h(c.amount)};background:${c.color}"></i>`).join('')}</span>
          <span class="sp-x">${esc(x.label)}</span>
        </button>`;
    }).join('');
    const usual = st.usual == null ? ''
      : `<div class="sp-usual" style="--h:${h(st.usual)}"><span>usual ${num(st.usual)}</span></div>`;
    return `<div class="sp-chart" style="--n:${shown.length}"><div class="sp-cols">${cols}</div>${usual}</div>`;
  },

  /* Every category the picked bar holds, largest first, household included —
     it is on the receipts, so it is in the list, and leaving it out would make
     the shares add up to less than the whole. A followed category with
     nothing in this bar stays in the list at nought, lit, so the thing that
     turns it off is still where it was turned on. */
  where(b) {
    const rows = (b.by_category || []).filter((c) => c.amount > 0);
    const f = this.follow;
    if (f && !rows.some((c) => c.key === f.key)) rows.push({ ...f, amount: 0 });
    if (!rows.length) return `<div class="sp-none">Nothing recorded in ${esc(called(b, this.period))}</div>`;
    const top = Math.max(...rows.map((c) => c.amount));
    const share = (a) => {
      if (!(b.total > 0) || a <= 0) return '';
      const p = Math.round((a / b.total) * 100);
      return p < 1 ? '<1\u00a0%' : `${p}\u00a0%`;
    };
    return rows.map((c) => `
      <button class="sp-cat${f?.key === c.key ? ' on' : ''}" data-key="${esc(c.key)}"
              data-label="${esc(c.label)}" data-short="${esc(c.short)}" style="--c:${colorOf(c.key)}">
        <span class="sp-cname"><span class="sp-dot"></span>${esc(c.label)}</span>
        <span class="sp-track"><i style="width:${top > 0 && c.amount > 0
          ? Math.max(1, (c.amount / top) * 100).toFixed(1) : 0}%"></i></span>
        <span class="sp-camt">${kr(c.amount)}</span>
        <span class="sp-cshare">${share(c.amount)}</span>
      </button>`).join('');
  },

  /* The pie: a usual week, category by category (spending.py _usual_mix —
     the same weeks as the usual week, so its middle is that figure). A ring
     rather than a full disc, so the figure has somewhere to stand; slices in
     the fixed order, a 2px gap of panel between them. Each legend row follows
     its category through the bars, as a row of Where it went does. */
  donut(st) {
    const mix = st.usual_mix;
    if (!mix || !(mix.food > 0)) return '';
    const parts = fold(mix.categories);
    const R = 82, W = 30, C = 2 * Math.PI * R;
    const gap = parts.length > 1 ? 3 : 0;
    let at = 0;
    const arcs = parts.map((c) => {
      const len = (c.amount / mix.food) * C;
      const seg = `<circle r="${R}" cx="100" cy="100" fill="none" stroke="${c.color}" stroke-width="${W}"
        stroke-dasharray="${Math.max(0, len - gap).toFixed(2)} ${C.toFixed(2)}"
        stroke-dashoffset="${(-at).toFixed(2)}"><title>${esc(`${c.label} ${kr(c.amount)}`)}</title></circle>`;
      at += len;
      return seg;
    }).join('');
    const pct = (a) => Math.round((a / mix.food) * 100);
    const f = this.follow;
    const legend = [...parts].sort((a, b) => b.amount - a.amount).map((c) => `
      <${c.key === REST.key ? 'div' : 'button'} class="sp-leg${f?.key === c.key ? ' on' : ''}"
        ${c.key === REST.key ? `title="${esc(c.parts || '')}"`
          : `data-key="${esc(c.key)}" data-label="${esc(c.label)}" data-short="${esc(c.short)}"`}
        style="--c:${c.color}">
        <span class="sp-dot"></span>
        <span class="sp-lname">${esc(c.key === REST.key ? 'The rest' : c.short)}</span>
        <span class="sp-lamt">${kr(c.amount)}</span>
        <span class="sp-lpct">${pct(c.amount)}\u00a0%</span>
      </${c.key === REST.key ? 'div' : 'button'}>`).join('');
    const from = mix.provisional
      ? `so far, from ${mix.weeks} recorded week${mix.weeks === 1 ? '' : 's'}`
      : `average of your last ${mix.weeks} weeks`;
    return `
      <div class="sp-head">A usual week <span class="sp-headsub">${esc(from)}</span></div>
      <div class="sp-pie">
        <div class="sp-ring">
          <svg viewBox="0 0 200 200" role="img" aria-label="${esc(`a usual week, ${kr(mix.food)} of food`)}">
            <g transform="rotate(-90 100 100)">${arcs}</g>
          </svg>
          <div class="sp-ringmid"><b>${kr(mix.food)}</b><span>a week</span>
            ${mix.household > 0 ? `<i>+ ${kr(mix.household)} household</i>` : ''}</div>
        </div>
        <div class="sp-legend">${legend}</div>
      </div>`;
  },

  /* Four cards under the bars about the bar being read: eating out (the
     takeaway category — restaurants, delivery, cafés) against groceries, what
     a day costs and where the period is heading, and where it was bought.
     Only Eating out wears a category's colour, because it is one; the others
     are not categories and keep the page's own. */
  insights(st, b) {
    let n = b.insights;
    let head = '';
    // The running period with nothing in it yet — every Monday morning — would
    // leave the cards blank; they show the last one with food instead, and
    // say which.
    if (b.current && !(n?.food > 0)) {
      const prev = [...(st.buckets || [])].reverse().find((x) => !x.current && x.insights?.food > 0);
      if (!prev) return '';
      n = prev.insights;
      head = `<div class="sp-head sp-chead">${esc(prev.long)} — nothing yet this ${esc(this.period)}</div>`;
    }
    if (!n || !(n.food > 0)) return '';
    const noun = this.period;
    const eo = n.eat_out, gr = n.groceries;
    const card = (cls, color, title, big, lines, extra = '') => `
      <div class="sp-card ${cls}" style="--c:${color}">
        <div class="sp-ctitle"><span class="sp-dot"></span>${title}</div>
        <div class="sp-cbig">${big}</div>
        ${lines.filter(Boolean).map((l) => `<div class="sp-cline">${l}</div>`).join('')}${extra}
      </div>`;
    const eatUsual = st.usual_eat_out != null ? `usual ${noun} ${kr(st.usual_eat_out)}` : '';
    const eat = card('sp-eat', HUE.takeaway, 'Takeaway & restaurants', kr(eo.amount), [
      eo.visits ? `${times(eo.visits)} · ${kr(eo.per_visit)} each` : `none this ${noun}`,
      eo.share != null ? `<b>${eo.share}\u00a0%</b> of food` : '',
      eatUsual,
    ]);
    // The split as one bar: groceries and eating out side by side.
    const split = eo.amount > 0 && gr.amount > 0 ? `<div class="sp-split" title="groceries ${gr.share} %, eating out ${eo.share} %">
        <i style="flex:${gr.amount};background:var(--mid)"></i><i style="flex:${eo.amount};background:${HUE.takeaway}"></i></div>` : '';
    const groc = card('sp-groc', 'var(--mid)', 'Groceries', kr(gr.amount), [
      gr.trips ? `${gr.trips} shop${gr.trips === 1 ? '' : 's'} · ${kr(gr.per_trip)} each` : '',
      gr.share != null ? `<b>${gr.share}\u00a0%</b> of food` : '',
    ], split);
    const [s1, ...more] = n.shops || [];
    const day = card('sp-day', 'var(--food)', 'A day', n.per_day != null ? kr(n.per_day) : '—', [
      n.pace != null ? `on course for <b>${kr(n.pace)}</b>` : n.days ? `over ${n.days} day${n.days === 1 ? '' : 's'}` : '',
      n.biggest ? `biggest ${kr(n.biggest.amount)}` : '',
      n.biggest ? `${esc(n.biggest.store || 'a told cost')}, ${esc(dayName(n.biggest.date))}` : '',
    ]);
    const shop = card('sp-shop', 'var(--food)', 'Where you shop', s1 ? esc(s1.name) : '—', [
      s1 ? `${kr(s1.amount)} · ${times(s1.visits)} · <b>${s1.share}\u00a0%</b>` : '',
      ...more.map((x) => `${esc(x.name)} · ${kr(x.amount)} · ${x.share}\u00a0%`),
    ]);
    return `${head}<div class="sp-cards">${eat}${groc}${day}${shop}</div>`;
  },

  async loadReceipts() {
    if (this.tab !== 'food') return;
    const b = this.selected();
    if (!b) return;
    const q = new URLSearchParams({ from: b.start, to: b.end });
    if (this.follow) q.set('category', this.follow.key);
    const key = q.toString();
    const mine = ++this.seqList;
    // The list on screen stays up while its own refetch is in flight — an
    // agent write arriving should not blank it — but another bar's receipts
    // must never stand under this one's heading.
    if (this.list?.key !== key) this.list = null;
    this.paintReceipts();
    let got = null;
    try {
      const res = await fetch(`/api/spending/entries?${q}`);
      if (res.ok) got = await res.json();
    } catch { /* the heading stays; the next summary on the bus asks again */ }
    if (mine !== this.seqList || !this.expanded || !got) return;
    this.list = { ...got, key };
    this.paintReceipts();
  },

  /* A receipt's own total, to the öre, so the row matches the paper; while a
     category is followed, that category's share of it first. Store names and
     notes are the agent's reading of a receipt, so they go through esc(). */
  paintReceipts() {
    const cap = this.body.querySelector('.sp-rcap');
    const box = this.body.querySelector('.sp-rlist');
    const b = this.selected();
    if (!cap || !box || !b) return;
    const f = this.follow;
    const got = this.list;
    // The count is said up here because the list has no scrollbar to say it:
    // seven rows showing out of ten look exactly like seven out of seven.
    cap.textContent = (f ? `Receipts with ${word(f)}` : 'Receipts')
      + (got?.count ? ` · ${got.count}` : '');
    if (!got) { box.innerHTML = ''; return; }
    const rows = got.entries || [];
    if (!rows.length) {
      box.innerHTML = `<div class="sp-none">${esc(f
        ? `No ${word(f)} in ${called(b, this.period)}`
        : `Nothing recorded in ${called(b, this.period)}`)}</div>`;
      return;
    }
    box.innerHTML = rows.map((e) => {
      const part = f ? (e.by_category || []).find((c) => c.key === f.key)?.amount || 0 : 0;
      const tag = e.source === 'told' ? 'told'
        : `receipt · ${e.lines} line${e.lines === 1 ? '' : 's'}`;
      return `
        <div class="sp-rrow">
          <span class="sp-rday">${esc(dayName(e.date))}</span>
          <span class="sp-rwhere">${esc(e.store || e.note || '—')}</span>
          <span class="sp-ramt">${f ? `<em>${esc(f.short)}</em> ${kr(part)}`
            : `${paper(e.total)}\u00a0kr`}</span>
          <span class="sp-rtag">${f ? `of ${paper(e.total)}` : esc(tag)}</span>
        </div>`;
    }).join('') + (got.truncated
      ? `<div class="sp-more">and ${got.count - rows.length} more</div>` : '');
  },

  /* Pointer-wired taps, as in food.js and for its reason: a knuckle on a wall
     screen travels far enough for Chrome to drop the synthesised click. The
     plainer of the wall's two versions, with no pointer capture and no
     preventDefault: nothing on this page is dragged, so there is no gesture
     for a tap to keep for itself. */
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
