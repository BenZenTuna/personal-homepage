/* Travel — Economy's second tab (backend/app/travel.py, 2026-10-19).

   Alex: "travel tab (inside economy) where the kitchen agent will open new
   travel costs for holidays, and will keep track for different travel cards
   the costs … what the money spend for different categories and … how much
   money spend totally for each travel card."

   One card per trip: what it cost so far in kronor, against its budget when
   it has one, and where the money went as one coloured bar. A tap opens the
   trip: its categories down the right (each one filters the costs), its days
   as bars, and every cost with the currency it was paid in beside its
   kronor. Read from the `travel` document on the bus and GET
   /api/travel/trips/<id> for the open one.

   The agent writes, and since 2026-10-30 so does the family (Alex: "make
   it so that I can manually delete or add a new trip … manually add costs and
   categories … so the page can function with manual inputs as well"): ＋ New
   trip on the cards, and on a trip ＋ Add a cost, Edit trip, Delete trip and
   ✎/✕ on each cost. They go to /api/travel/wall/..., the agent's own
   handlers, so the categories are the agent's closed list (a drop-down here)
   and the checks are the same: a duplicate or a lost decimal point is asked
   about, never stored silently.

   Drawn into the spending panel's body while Economy's Travel tab is up
   (spending.js owns the tabs); show(body) and hide() are the whole contract. */

const esc = (s) => String(s ?? '').replace(/[&<>"']/g,
  (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const WHOLE = new Intl.NumberFormat('sv-SE', { maximumFractionDigits: 0 });
const EXACT = new Intl.NumberFormat('sv-SE', { maximumFractionDigits: 2 });
const kr = (x) => `${WHOLE.format(Number(x) || 0)} kr`;
const money = (x, cur) => (cur === 'SEK' ? kr(x) : `${EXACT.format(Number(x) || 0)} ${cur}`);

/* The food page's eight colours (spending.js HUES), in the same tested order,
   given to the travel categories in theirs; "other" is the neutral rest. */
const HUES = {
  flights: '#3987e5', transport: '#d95926', stay: '#199e70', eating: '#c98500',
  groceries: '#d55181', activities: '#008300', shopping: '#9085e9', fees: '#e66767',
};
const colorOf = (key) => HUES[key] || '#8e8676';

/* The currencies offered for a cost beyond the trip's own rates. Any other
   three-letter code can be typed (travel.py checks it). */
const CURRENCIES = ['SEK', 'EUR', 'USD', 'TRY', 'GBP', 'NOK', 'DKK', 'CHF', 'BGN'];
const todayIso = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
/* "1 234,50" or "1234.5" → "1234.50"; "" stays "" (the server says what is wrong). */
const num = (v) => String(v ?? '').replace(/\s/g, '').replace(',', '.');
/* "EUR 11.42, TRY 0.29" ↔ {"EUR": "11.42", "TRY": "0.29"}. */
const ratesText = (r) => Object.entries(r || {}).map(([c, v]) => `${c} ${String(v)}`).join(', ');
function parseRates(text) {
  const out = {};
  for (const part of String(text || '').split(/[,;\n]+/)) {
    const m = part.trim().match(/^([A-Za-z]{3})\s*[=:]?\s*([\d.,]+)$/);
    if (m) out[m[1].toUpperCase()] = num(m[2]);
    else if (part.trim()) throw new Error(`"${part.trim()}" is not a rate — write it like EUR 11.42`);
  }
  return out;
}

const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const DAY = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const parts = (iso) => { const [y, m, d] = iso.split('-').map(Number); return { y, m, d }; };
const dayMonth = (iso) => { const p = parts(iso); return `${p.d} ${MON[p.m - 1]}`; };
const dayName = (iso) => {
  const p = parts(iso);
  return `${DAY[new Date(p.y, p.m - 1, p.d).getDay()]} ${p.d} ${MON[p.m - 1]}`;
};

/* "14–28 Jun 2027", "27 Dec 2026 – 2 Jan 2027", "" when it has no dates. */
function span(t) {
  if (!t.start) return '';
  const a = parts(t.start), b = parts(t.end || t.start);
  if (t.start === (t.end || t.start)) return `${a.d} ${MON[a.m - 1]} ${a.y}`;
  if (a.y !== b.y) return `${a.d} ${MON[a.m - 1]} ${a.y} – ${b.d} ${MON[b.m - 1]} ${b.y}`;
  if (a.m !== b.m) return `${a.d} ${MON[a.m - 1]} – ${b.d} ${MON[b.m - 1]} ${b.y}`;
  return `${a.d}–${b.d} ${MON[a.m - 1]} ${a.y}`;
}

function chip(t) {
  if (t.status === 'now') return `now · day ${t.day} of ${t.days}`;
  if (t.status === 'upcoming') return t.in_days === 1 ? 'tomorrow' : `in ${t.in_days} days`;
  if (t.status === 'done') return 'done';
  return 'no dates yet';
}

/* The coloured bar: each category its share of the trip, in category order
   so neighbours are always the tested pairs. */
function stack(t, order) {
  if (!(t.total > 0)) return '';
  const by = Object.fromEntries((t.by_category || []).map((c) => [c.key, c]));
  return `<div class="trv-stack">${order.filter((k) => by[k]?.amount > 0).map((k) =>
    `<i style="flex:${by[k].amount};background:${colorOf(k)}" title="${esc(`${by[k].label} ${kr(by[k].amount)}`)}"></i>`)
    .join('')}</div>`;
}

function budgetLine(t) {
  if (t.budget == null) return '';
  const used = t.budget > 0 ? Math.min(100, (t.total / t.budget) * 100) : 0;
  const over = t.budget_left < 0;
  return `<div class="trv-budget${over ? ' over' : ''}">
      <div class="trv-bbar"><i style="width:${used.toFixed(1)}%"></i></div>
      <span>of ${kr(t.budget)} · ${over ? `<b>${kr(-t.budget_left)} over</b>` : `${kr(t.budget_left)} left`}</span>
    </div>`;
}

export default {
  doc: null,          // the `travel` document: every trip's card
  body: null,         // the panel body while the tab is up, else null
  open: null,         // the trip being read
  detail: null,       // its GET /api/travel/trips/<id>
  follow: null,       // a category key filtering its costs
  seq: 0,
  onMeta: null,       // spending.js: the header's line has changed
  form: null,         // {kind: 'trip'|'cost', id?, v: {...}} being typed, else null
  formErr: '',
  formAsk: null,      // {key, words}: the server asked "are you sure" (duplicate, large)
  sure: null,         // the delete button armed for its second tap

  init(ctx) {
    this.ctx = ctx;
    ctx.bus.on('travel', (doc) => {
      if (!doc || !Array.isArray(doc.trips)) return;
      this.doc = doc;
      this.onMeta?.();
      if (!this.body || this.form) return;     // never redrawn under somebody typing
      if (this.open) this.load(); else this.render();
    });
    fetch('/api/travel').then((r) => (r.ok ? r.json() : null)).then((doc) => {
      if (doc && Array.isArray(doc.trips) && !this.doc) {
        this.doc = doc;
        this.onMeta?.();
        if (this.body && !this.open) this.render();
      }
    }).catch(() => { /* the bus brings it */ });
  },

  /* "2027: 27 384 kr · 5 trips", for the panel header. */
  meta() {
    const d = this.doc;
    if (!d) return '';
    const n = d.trips.length;
    return `${n} trip${n === 1 ? '' : 's'} · ${kr(d.this_year)} in ${d.year}`;
  },

  show(body) {
    this.body = body;
    if (this.open) this.load(); else this.render();
  },

  hide() {
    this.body = null;
    this.open = null;
    this.detail = null;
    this.follow = null;
    this.seq += 1;
    this.form = null;
    this.closeImage();
  },

  order() {
    return (this.doc?.categories || []).map((c) => c.key);
  },

  /* ---------------------------------------------------------- the cards -- */

  render() {
    const body = this.body;
    if (!body) return;
    const d = this.doc;
    if (!d) { body.innerHTML = ''; return; }
    if (d.broken) {
      body.innerHTML = '<div class="placeholder sp-broken">The travel file on the server could not be read — nothing has been changed</div>';
      return;
    }
    if (this.form?.kind === 'trip' && !this.form.id) {
      body.innerHTML = `<div class="trv-page">${this.tripForm()}</div>`;
      this.wireForm();
      return;
    }
    if (!d.trips.length) {
      body.innerHTML = `<div class="trv-page"><div class="placeholder trv-empty">No trips yet — open one here, or tell
        the kitchen agent about a holiday
        <span>“open a trip: Turkey, 14–28 June, budget 40 000 kr”, then give it the receipts,
        bookings and card statements as they come</span></div>
        <div class="trv-grid"><button class="trv-card trv-new">＋ New trip</button></div></div>`;
      this.tap(body.querySelector('.trv-new'), () => this.newTrip());
      return;
    }
    const order = this.order();
    const cards = d.trips.map((t) => {
      const top = (t.by_category || []).slice(0, 3).map((c) =>
        `<span><span class="sp-dot" style="--c:${colorOf(c.key)}"></span>${esc(c.short)} <b>${WHOLE.format(c.amount)}</b></span>`).join('');
      const foot = [`${t.costs} cost${t.costs === 1 ? '' : 's'}`,
        t.per_day != null && t.total > 0 ? `${kr(t.per_day)} a day` : '',
        (t.by_currency || []).length > 1 ? t.by_currency.map((c) => c.currency).join(' · ') : '']
        .filter(Boolean).join(' · ');
      return `
        <button class="trv-card st-${esc(t.status)}" data-trip="${esc(t.id)}">
          <div class="trv-chead"><span class="trv-name">${esc(t.name)}</span>
            <span class="trv-chip">${esc(chip(t))}</span></div>
          <div class="trv-where">${esc([t.place, span(t)].filter(Boolean).join(' · ') || ' ')}</div>
          <div class="trv-total">${kr(t.total)}</div>
          ${budgetLine(t)}
          ${stack(t, order)}
          <div class="trv-top3">${top || '<span class="trv-nil">nothing recorded yet</span>'}</div>
          <div class="trv-foot">${esc(foot)}${t.unconverted ? ` · <b>${t.unconverted} without kronor</b>` : ''}</div>
        </button>`;
    }).join('');
    body.innerHTML = `
      <div class="trv-page">
        <div class="trv-sum"><span class="trv-big">${kr(d.this_year)}</span>
          <span class="trv-cap">on travel in ${d.year} · ${kr(d.all)} on all ${d.trips.length} trip${d.trips.length === 1 ? '' : 's'}</span></div>
        <div class="trv-grid">${cards}<button class="trv-card trv-new">＋ New trip</button></div>
      </div>`;
    body.querySelectorAll('.trv-card[data-trip]').forEach((b) => this.tap(b, () => this.openTrip(b.dataset.trip)));
    this.tap(body.querySelector('.trv-new'), () => this.newTrip());
  },

  openTrip(id) {
    this.open = id;
    this.follow = null;
    this.detail = null;
    this.load();
  },

  back() {
    this.form = null;
    this.open = null;
    this.detail = null;
    this.follow = null;
    this.seq += 1;
    this.render();
  },

  async load() {
    const mine = ++this.seq;
    const id = this.open;
    let got = null;
    try {
      const r = await fetch(`/api/travel/trips/${encodeURIComponent(id)}`);
      if (r.status === 404) { if (mine === this.seq) this.back(); return; }
      if (r.ok) got = await r.json();
    } catch { /* keeps what it has; the next change on the bus asks again */ }
    if (mine !== this.seq || !this.body || this.open !== id) return;
    if (got) this.detail = got;
    this.renderTrip();
  },

  /* ----------------------------------------------------------- one trip -- */

  renderTrip() {
    const body = this.body;
    const t = this.detail;
    if (!body) return;
    if (!t) { body.innerHTML = '<div class="placeholder">Loading the trip…</div>'; return; }
    const f = this.follow;
    const cats = t.by_category || [];
    const topCat = Math.max(0, ...cats.map((c) => c.amount));
    const share = (a) => (t.total > 0 ? `${Math.round((a / t.total) * 100)} %` : '');
    const where = cats.length ? cats.map((c) => `
      <button class="sp-cat${f === c.key ? ' on' : ''}" data-key="${esc(c.key)}" style="--c:${colorOf(c.key)}">
        <span class="sp-cname"><span class="sp-dot"></span>${esc(c.label)}</span>
        <span class="sp-track"><i style="width:${topCat > 0 ? Math.max(1, (c.amount / topCat) * 100).toFixed(1) : 0}%"></i></span>
        <span class="sp-camt">${kr(c.amount)}</span>
        <span class="sp-cshare">${share(c.amount)}</span>
      </button>`).join('') : '<div class="sp-none">Nothing recorded yet</div>';

    const lines = [];
    if (t.per_day != null && t.total > 0) lines.push(`<b>${kr(t.per_day)}</b> a day over ${t.days} day${t.days === 1 ? '' : 's'}`);
    if ((t.by_currency || []).some((c) => c.currency !== 'SEK')) {
      lines.push(`paid in ${t.by_currency.map((c) => money(c.amount, c.currency)).join(' · ')}`);
    }
    const rates = Object.entries(t.rates || {});
    if (rates.length) lines.push(`counted at ${rates.map(([c, r]) => `1 ${c} = ${String(r).replace('.', ',')} kr`).join(' · ')}`);
    if ((t.by_payer || []).length) lines.push(`paid by ${t.by_payer.map((p) => `${esc(p.name)} ${kr(p.amount)}`).join(' · ')}`);
    if (t.unconverted) lines.push(`<b>${t.unconverted} cost${t.unconverted === 1 ? '' : 's'} without kronor</b> — not in the total`);
    if (t.note) lines.push(esc(t.note));

    if (this.form) {
      body.innerHTML = `<div class="trv-page">${this.form.kind === 'trip' ? this.tripForm() : this.costForm(t)}</div>`;
      this.wireForm();
      return;
    }
    const n = t.costs ?? (t.list || []).length;
    const sure = this.sure === t.id;
    const actions = `
      <div class="trv-actions">
        <button class="ls-btn sheet-primary trv-addcost">＋ Add a cost</button>
        <button class="ls-btn trv-edit">Edit trip</button>
        <button class="ls-btn trv-del${sure ? ' sure' : ''}">${sure
          ? (n ? `Delete it and its ${n} cost${n === 1 ? '' : 's'}? Tap again` : 'Delete the trip? Tap again')
          : 'Delete trip'}</button>
      </div>`;

    const list = (t.list || []).filter((c) => !f || c.category === f);
    const rows = list.length ? list.map((c) => `
      <div class="trv-row${c.image ? ' has-img' : ''}" data-cost="${esc(c.id)}"${c.image ? ` data-img="${esc(c.image)}"` : ''}>
        <span class="sp-rday">${esc(dayName(c.date))}</span>
        <span class="trv-what">${esc(c.what)}${c.where ? ` <i>${esc(c.where)}</i>` : ''}${c.image ? ' <span class="trv-rcpt" title="the receipt">🧾</span>' : ''}</span>
        <span class="trv-cat"><span class="sp-dot" style="--c:${colorOf(c.category)}"></span>${esc(this.short(c.category))}</span>
        <span class="trv-orig">${c.currency !== 'SEK' ? esc(money(c.amount, c.currency)) : ''}</span>
        <span class="sp-ramt">${c.sek != null ? kr(c.sek) : '—'}</span>
        <span class="trv-rbtns"><button class="trv-rb" data-ed="${esc(c.id)}" aria-label="change this cost">✎</button><button
          class="trv-rb${this.sure === c.id ? ' sure' : ''}" data-rm="${esc(c.id)}" aria-label="delete this cost">${this.sure === c.id ? 'Sure?' : '✕'}</button></span>
      </div>`).join('') : `<div class="sp-none">${f ? `No ${esc(this.short(f).toLowerCase())} on this trip` : 'No costs yet'}</div>`;

    body.innerHTML = `
      <div class="trv-detail">
        <div class="trv-dleft">
          <div class="trv-dhead">
            <button class="trv-back" aria-label="all trips">‹ All trips</button>
            <div class="trv-dtitle"><div class="trv-dname">${esc(t.name)}</div>
              <div class="trv-where">${esc([t.place, span(t)].filter(Boolean).join(' · '))}</div></div>
            <span class="trv-chip st-${esc(t.status)}">${esc(chip(t))}</span>
          </div>
          <div class="trv-dfig">
            <div class="trv-big">${kr(t.total)}</div>
            <div class="trv-dside">${budgetLine(t)}${stack(t, this.order())}</div>
          </div>
          ${actions}
          ${lines.length ? `<div class="trv-lines">${lines.map((l) => `<div>${l}</div>`).join('')}</div>` : ''}
          ${this.days(t)}
          <div class="sp-head">${f ? `${esc(this.short(f))} costs` : 'Costs'} · ${list.length}</div>
          <div class="trv-list">${rows}</div>
        </div>
        <div class="trv-dright">
          <div class="sp-head">Where it went</div>
          <div class="sp-where">${where}</div>
        </div>
      </div>`;
    this.tap(body.querySelector('.trv-back'), () => this.back());
    body.querySelectorAll('.sp-cat[data-key]').forEach((b) => this.tap(b, () => {
      this.follow = this.follow === b.dataset.key ? null : b.dataset.key;
      this.renderTrip();
    }));
    body.querySelectorAll('.trv-row[data-img] .trv-what').forEach((r) =>
      this.tap(r, () => this.showImage(r.closest('.trv-row').dataset.img)));
    this.tap(body.querySelector('.trv-addcost'), () => this.newCost(t));
    this.tap(body.querySelector('.trv-edit'), () => this.editTrip(t));
    this.tap(body.querySelector('.trv-del'), () => this.deleteTrip(t));
    body.querySelectorAll('[data-ed]').forEach((b) => this.tap(b, () =>
      this.editCost((t.list || []).find((c) => c.id === b.dataset.ed))));
    body.querySelectorAll('[data-rm]').forEach((b) => this.tap(b, () => this.deleteCost(b.dataset.rm)));
  },

  /* ------------------------------------------------- typed on the wall -- */

  newTrip() {
    this.form = { kind: 'trip', v: { name: '', place: '', start: '', end: '', budget: '', rates: '', note: '' } };
    this.formErr = '';
    this.formAsk = null;
    this.render();
  },

  editTrip(t) {
    this.form = { kind: 'trip', id: t.id, v: { name: t.name || '', place: t.place || '', start: t.start || '',
      end: t.end || '', budget: t.budget ?? '', rates: ratesText(t.rates), note: t.note || '' } };
    this.formErr = '';
    this.formAsk = null;
    this.renderTrip();
  },

  newCost(t) {
    // Today: a cost is dated the day it was paid (travel.py's rule), and
    // the field changes it.
    this.form = { kind: 'cost', v: { date: todayIso(), what: '', where: '', category: this.follow || '',
      amount: '', currency: 'SEK', sek: '', paid_by: '', note: '' } };
    this.formErr = '';
    this.formAsk = null;
    this.renderTrip();
  },

  editCost(c) {
    if (!c) return;
    this.form = { kind: 'cost', id: c.id, v: { date: c.date, what: c.what || '', where: c.where || '',
      category: c.category, amount: c.amount ?? '', currency: c.currency || 'SEK',
      sek: c.sek_charged ? c.sek : '', paid_by: c.paid_by || '', note: c.note || '' } };
    this.formErr = '';
    this.formAsk = null;
    this.renderTrip();
  },

  field(key, label, input, hint = '') {
    return `<label class="trv-f trv-f-${key}"><span class="trv-fl">${esc(label)}</span>${input}${hint
      ? `<span class="trv-fh">${hint}</span>` : ''}</label>`;
  },

  text(key, { type = 'text', max = 80, ph = '', list = '' } = {}) {
    const v = this.form.v[key] ?? '';
    return `<input class="trv-in" data-k="${key}" type="${type}" value="${esc(v)}" maxlength="${max}"
      placeholder="${esc(ph)}"${type === 'text' ? ' autocomplete="off"' : ''}${list ? ` list="${list}"` : ''}
      ${type === 'number' ? 'inputmode="decimal" step="0.01" min="0"' : ''}>`;
  },

  formFoot(save) {
    const ask = this.formAsk;
    return `
      ${this.formErr ? `<div class="trv-ferr">${esc(this.formErr)}</div>` : ''}
      <div class="trv-actions">
        ${ask ? `<button class="ls-btn sheet-primary trv-save" data-ask="${esc(ask.key)}">${esc(ask.words)}</button>`
          : `<button class="ls-btn sheet-primary trv-save">${esc(save)}</button>`}
        <button class="ls-btn trv-cancel">Cancel</button>
      </div>`;
  },

  tripForm() {
    const editing = !!this.form.id;
    return `
      <div class="trv-form">
        <div class="trv-ftitle">${editing ? 'Change the trip' : 'A new trip'}</div>
        <div class="trv-fgrid">
          ${this.field('name', 'Name', this.text('name', { max: 60, ph: 'Turkey summer 2027' }))}
          ${this.field('place', 'Where', this.text('place', { max: 60, ph: 'Antalya' }))}
          ${this.field('start', 'First day', this.text('start', { type: 'date' }), 'optional')}
          ${this.field('end', 'Last day', this.text('end', { type: 'date' }), 'optional')}
          ${this.field('budget', 'Budget, kr', this.text('budget', { type: 'number', ph: 'none' }), 'optional')}
          ${this.field('rates', 'Exchange rates', this.text('rates', { max: 120, ph: 'EUR 11.42, TRY 0.29' }),
            'kronor for 1 of each — costs in that currency are counted at it')}
          ${this.field('note', 'Note', this.text('note', { max: 300 }), 'optional')}
        </div>
        ${this.formFoot(editing ? 'Save the trip' : 'Open the trip')}
      </div>`;
  },

  costForm(t) {
    const editing = !!this.form.id;
    const v = this.form.v;
    const cats = this.doc?.categories || [];
    const what = (this.cats || []).find((c) => c.key === v.category)?.what || '';
    const curs = [...new Set(['SEK', ...Object.keys(t.rates || {}), ...CURRENCIES, v.currency].filter(Boolean))];
    const foreign = v.currency && v.currency !== 'SEK';
    const rate = foreign ? (t.rates || {})[v.currency] : null;
    const payers = [...new Set([...(this.ctx.config?.people || []).map((p) => p.name).filter(Boolean),
      ...(t.by_payer || []).map((p) => p.name)])];
    return `
      <div class="trv-form">
        <div class="trv-ftitle">${editing ? 'Change the cost' : `A cost for ${esc(t.name)}`}</div>
        <div class="trv-fgrid">
          ${this.field('date', 'Day', this.text('date', { type: 'date' }))}
          ${this.field('what', 'What', this.text('what', { ph: 'dinner, hotel 3 nights…' }))}
          ${this.field('where', 'Where', this.text('where', { max: 60, ph: 'optional' }))}
          ${this.field('category', 'Category', `<select class="trv-in" data-k="category">
              <option value=""${v.category ? '' : ' selected'} disabled>choose…</option>
              ${cats.map((c) => `<option value="${esc(c.key)}"${c.key === v.category ? ' selected' : ''}>${esc(c.label)}</option>`).join('')}
            </select>`, esc(what))}
          ${this.field('amount', 'Amount', this.text('amount', { type: 'number' }))}
          ${this.field('currency', 'Currency', `<select class="trv-in" data-k="currency">
              ${curs.map((c) => `<option${c === v.currency ? ' selected' : ''}>${esc(c)}</option>`).join('')}
            </select>`, foreign ? (rate ? `counted at 1 ${esc(v.currency)} = ${esc(String(rate))} kr` : 'the trip has no rate for it: give the kronor charged') : '')}
          ${foreign ? this.field('sek', 'Kronor charged', this.text('sek', { type: 'number', ph: rate ? 'optional' : 'needed' }),
            'what the card was charged, if you know it — it beats the rate') : ''}
          ${this.field('paid_by', 'Paid by', `${this.text('paid_by', { max: 30, ph: 'optional', list: 'trv-payers' })}
            <datalist id="trv-payers">${payers.map((n) => `<option value="${esc(n)}">`).join('')}</datalist>`)}
          ${this.field('note', 'Note', this.text('note', { max: 200, ph: 'optional' }))}
        </div>
        ${this.formFoot(editing ? 'Save the cost' : 'Add the cost')}
      </div>`;
  },

  wireForm() {
    const body = this.body;
    body.querySelectorAll('.trv-in[data-k]').forEach((el) => {
      const k = el.dataset.k;
      el.addEventListener('input', () => { this.form.v[k] = el.value; this.formAsk = null; this.refreshSave(); });
      if (el.tagName === 'SELECT') {
        // A currency or category changes what the form asks for: drawn again.
        el.addEventListener('change', () => { this.form.v[k] = el.value; this.formAsk = null; this.redrawForm(); });
      }
    });
    this.tap(body.querySelector('.trv-save'), () => this.saveForm(body.querySelector('.trv-save')?.dataset.ask));
    this.tap(body.querySelector('.trv-cancel'), () => this.closeForm());
    if (!this.cats) {
      fetch('/api/travel/categories').then((r) => (r.ok ? r.json() : null)).then((d) => {
        if (d?.categories) { this.cats = d.categories; if (this.form?.kind === 'cost') this.redrawForm(); }
      }).catch(() => {});
    }
  },

  refreshSave() {
    // Typing after "Save anyway" is a new question for the server.
    const b = this.body?.querySelector('.trv-save[data-ask]');
    if (b) { delete b.dataset.ask; b.textContent = this.form.id ? 'Save' : 'Add'; }
  },

  redrawForm() {
    if (this.open) this.renderTrip(); else this.render();
  },

  closeForm() {
    this.form = null;
    this.formErr = '';
    this.formAsk = null;
    if (this.open) this.load(); else this.render();
  },

  async send(method, url, payload) {
    const r = await fetch(url, { method, headers: { 'Content-Type': 'application/json' },
      body: payload === undefined ? undefined : JSON.stringify(payload) });
    const d = await r.json().catch(() => ({}));
    return { r, d };
  },

  async saveForm(ask) {
    const f = this.form;
    if (!f || this.saving) return;
    const v = f.v;
    let payload;
    try {
      if (f.kind === 'trip') {
        payload = { name: v.name.trim(), place: v.place.trim(), start: v.start || '', end: v.end || '',
          budget: num(v.budget) === '' ? null : num(v.budget), rates: parseRates(v.rates), note: v.note.trim() };
      } else {
        if (!v.category) throw new Error('choose a category');
        payload = { trip: this.open, date: v.date, what: v.what.trim(), where: v.where.trim(),
          category: v.category, amount: num(v.amount), currency: v.currency || 'SEK',
          sek: v.currency !== 'SEK' && num(v.sek) !== '' ? num(v.sek) : null,
          paid_by: v.paid_by.trim(), note: v.note.trim() };
      }
    } catch (e) {
      this.formErr = e.message;
      this.redrawForm();
      return;
    }
    if (ask === 'dup') payload.allow_duplicate = true;
    if (ask === 'large') payload.confirm_large = true;
    const base = f.kind === 'trip' ? '/api/travel/wall/trips' : '/api/travel/wall/costs';
    this.saving = true;
    let res;
    try {
      res = await this.send(f.id ? 'PATCH' : 'POST', f.id ? `${base}/${encodeURIComponent(f.id)}` : base, payload);
    } catch (e) {
      res = { r: { ok: false, status: 0 }, d: { error: e.message } };
    }
    this.saving = false;
    if (this.form !== f) return;
    const { r, d } = res;
    if (r.ok) {
      const opened = f.kind === 'trip' && !f.id ? d.trip?.id : null;
      this.form = null;
      this.formErr = '';
      this.formAsk = null;
      if (opened) { this.openTrip(opened); return; }
      if (this.open) this.load(); else this.render();
      return;
    }
    if (r.status === 409 && d.kind === 'same') {
      this.formErr = f.kind === 'trip' ? 'A trip of this name starting that day is already open.'
        : 'This looks already recorded: the same day, amount and place.';
      this.formAsk = { key: 'dup', words: 'It is a different one — save anyway' };
    } else if (/confirm_large/.test(d.error || '')) {
      this.formErr = String(d.error).replace(/; send it again.*$/, '.');
      this.formAsk = { key: 'large', words: 'Yes, it really was that much' };
    } else {
      this.formErr = d.error || `the kitchen said ${r.status}`;
      this.formAsk = null;
    }
    this.redrawForm();
  },

  /* Two taps, the wall's way: the first arms the button for four seconds. */
  arm(id) {
    if (this.sure === id) return true;
    this.sure = id;
    clearTimeout(this._sureT);
    this._sureT = setTimeout(() => { if (this.sure === id) { this.sure = null; if (this.open && !this.form) this.renderTrip(); } }, 4000);
    this.renderTrip();
    return false;
  },

  async deleteTrip(t) {
    if (!this.arm(t.id)) return;
    this.sure = null;
    const n = t.costs ?? (t.list || []).length;
    const { r, d } = await this.send('DELETE', `/api/travel/wall/trips/${encodeURIComponent(t.id)}${n ? '?with_costs=true' : ''}`)
      .catch((e) => ({ r: { ok: false }, d: { error: e.message } }));
    if (r.ok) { this.back(); return; }
    this.ctx.soundlib?.toast?.(`Not deleted: ${d.error || r.status}`);
    this.renderTrip();
  },

  async deleteCost(id) {
    if (!this.arm(id)) return;
    this.sure = null;
    const { r, d } = await this.send('DELETE', `/api/travel/wall/costs/${encodeURIComponent(id)}`)
      .catch((e) => ({ r: { ok: false }, d: { error: e.message } }));
    if (!r.ok) this.ctx.soundlib?.toast?.(`Not deleted: ${d.error || r.status}`);
    this.load();
  },

  short(key) {
    return (this.doc?.categories || []).find((c) => c.key === key)?.short || key;
  },

  /* The trip's days as bars, one per day it ran. What was paid ahead (the
     flights, the hotel) or after is said in the heading rather than drawn:
     one bar of a whole booking would flatten every day of the trip to a
     line. A trip with no dates, or one too long for a row of readable bars,
     shows the days it has costs on. */
  days(t) {
    const by = Object.fromEntries((t.by_day || []).map((d) => [d.date, d.amount]));
    let cols = [];
    let before = 0, after = 0;
    if (t.start) {
      for (const [d, a] of Object.entries(by)) {
        if (d < t.start) before += a;
        if (d > (t.end || t.start)) after += a;
      }
      const a = parts(t.start), b = parts(t.end || t.start);
      const end = new Date(b.y, b.m - 1, b.d);
      for (let d = new Date(a.y, a.m - 1, a.d); d <= end; d.setDate(d.getDate() + 1)) {
        const iso = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
        cols.push({ label: String(d.getDate()), amount: by[iso] || 0, title: dayName(iso) });
      }
    }
    if (!t.start || cols.length > 40) {
      before = after = 0;
      cols = (t.by_day || []).slice(-40).map((d) => ({ label: dayMonth(d.date), amount: d.amount, title: dayName(d.date) }));
    }
    const ahead = [before > 0 ? `${kr(before)} paid before the trip` : '',
      after > 0 ? `${kr(after)} after it` : ''].filter(Boolean).join(' · ');
    if (!cols.some((c) => c.amount > 0)) {
      return ahead ? `<div class="sp-head">By day <span class="sp-headsub">${esc(ahead)}</span></div>` : '';
    }
    const top = Math.max(...cols.map((c) => c.amount));
    return `
      <div class="sp-head">By day${ahead ? ` <span class="sp-headsub">· ${esc(ahead)}</span>` : ''}</div>
      <div class="trv-days" style="--n:${cols.length}">${cols.map((c) => `
        <div class="trv-day" title="${esc(`${c.title}: ${kr(c.amount)}`)}">
          <span class="trv-dval">${c.amount > 0 ? WHOLE.format(c.amount) : ''}</span>
          <span class="trv-dbar"><i style="height:${top > 0 ? ((c.amount / top) * 100).toFixed(1) : 0}%"></i></span>
          <span class="trv-dx">${esc(c.label)}</span>
        </div>`).join('')}</div>`;
  },

  /* A cost's receipt, over the page until a tap. */
  showImage(ref) {
    this.closeImage();
    const el = document.createElement('div');
    el.className = 'trv-img';
    el.innerHTML = `<img src="/api/cooking/images/${ref.split('/').map(encodeURIComponent).join('/')}" alt="the receipt">`;
    el.addEventListener('click', () => this.closeImage());
    document.body.appendChild(el);
    this.imgEl = el;
  },

  closeImage() {
    this.imgEl?.remove();
    this.imgEl = null;
  },

  /* Pointer-wired taps, as spending.js does and for its reason (a knuckle on
     the wall travels far enough for Chrome to drop the click). */
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
