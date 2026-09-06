/* Everything the demo pretends to know.
 *
 * This file is the whole content of the demo: rooms, dinners, events, photos,
 * channels, the weather. Nothing here comes off the real dashboard — no host
 * names, no tokens, no family photographs, no real addresses. Edit this file
 * and the demo says something else; no other file has to change.
 *
 * Loaded as a plain script before the dashboard's own modules, so it publishes
 * one global: window.DEMO.
 */
(function () {
  'use strict';

  /* ---------------------------------------------------------------- dates
     Everything is generated relative to the moment the page is opened, so the
     demo is never showing last spring's forecast or a countdown that has
     already run out. */
  const DAY = 86400000;
  const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${
    String(d.getDate()).padStart(2, '0')}`;
  const inDays = (n) => iso(new Date(Date.now() + n * DAY));
  const midnight = () => { const d = new Date(); d.setHours(0, 0, 0, 0); return d; };

  /* A seeded generator, so the weather is the same all day rather than
     re-rolling itself every time a panel repaints. */
  function rng(seed) {
    let s = seed >>> 0;
    return () => {
      s = (s * 1664525 + 1013904223) >>> 0;
      return s / 4294967296;
    };
  }

  /* ------------------------------------------------------------- weather
     Shaped exactly like the backend's /api/weather: WMO codes, hourly rows for
     four days and Open-Meteo's own daily figures for seven. Every field the
     header band, the hours sheet and the week sheet read is filled in. */
  const CITY = 'Karlstad';

  // One character per day: what kind of day it is, and the numbers follow.
  const DAYS = [
    { code: 2, hi: 19, lo: 11, pp: 10 },
    { code: 3, hi: 17, lo: 12, pp: 25 },
    { code: 61, hi: 15, lo: 11, pp: 80 },
    { code: 80, hi: 16, lo: 10, pp: 55 },
    { code: 1, hi: 18, lo: 9, pp: 5 },
    { code: 0, hi: 20, lo: 10, pp: 0 },
    { code: 2, hi: 19, lo: 12, pp: 15 },
  ];

  function weather() {
    const start = midnight();
    const r = rng(Math.floor(start.getTime() / DAY));
    const hourly = [];
    for (let h = 0; h < 96; h++) {
      const d = DAYS[Math.floor(h / 24) % DAYS.length];
      const t = new Date(start.getTime() + h * 3600000);
      const hour = t.getHours();
      // Coldest around 04:00, warmest around 15:00.
      const curve = Math.sin(((hour - 9) / 24) * 2 * Math.PI);
      const temp = d.lo + (d.hi - d.lo) * (0.5 + 0.5 * curve) + (r() - 0.5) * 0.8;
      const day = hour >= 6 && hour < 20 ? 1 : 0;
      const wet = d.code >= 51;
      const code = wet && (hour < 4 || hour > 21) ? 3 : d.code;
      hourly.push({
        t: `${iso(t)}T${String(hour).padStart(2, '0')}:00`,
        temp: Math.round(temp * 10) / 10,
        feels: Math.round((temp - 1.2 - (wet ? 1 : 0)) * 10) / 10,
        code,
        day,
        pp: Math.max(0, Math.round(d.pp * (0.5 + r() * 0.9))),
        rh: Math.round(58 + (wet ? 20 : 0) + (1 - (0.5 + 0.5 * curve)) * 14 + r() * 6),
        uv: day ? Math.round(Math.max(0, 4.2 * Math.sin(((hour - 6) / 14) * Math.PI))
          * (code >= 3 ? 0.5 : 1) * 10) / 10 : 0,
        wind: Math.round((7 + r() * 9 + (wet ? 5 : 0)) * 10) / 10,
        gust: Math.round((12 + r() * 14 + (wet ? 8 : 0)) * 10) / 10,
        press: Math.round(1006 + (d.code < 3 ? 10 : 0) + r() * 6),
        cloud: code === 0 ? Math.round(r() * 8) : code === 1 ? 20 + Math.round(r() * 15)
          : code === 2 ? 45 + Math.round(r() * 20) : 78 + Math.round(r() * 20),
        aqi: 14 + Math.round(r() * 16),
        pm25: Math.round((3 + r() * 6) * 10) / 10,
      });
    }

    const daily = DAYS.map((d, i) => {
      const date = new Date(start.getTime() + i * DAY);
      // Sunrise and sunset drift a couple of minutes a day, as they do.
      const rise = 6 * 60 + 12 + i * 3;
      const set = 19 * 60 + 48 - i * 4;
      const hhmm = (m) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${
        String(m % 60).padStart(2, '0')}`;
      return {
        d: iso(date),
        code: d.code,
        tmax: d.hi, tmin: d.lo,
        fmax: d.hi - 1, fmin: d.lo - 2,
        pp: d.pp,
        uv: d.code >= 3 ? 2 : 4,
        sunrise: `${iso(date)}T${hhmm(rise)}`,
        sunset: `${iso(date)}T${hhmm(set)}`,
      };
    });

    return {
      fetched_at: Math.floor((Date.now() - 7 * 60000) / 1000),
      stale: false,
      city: CITY,
      error: null,
      hourly,
      daily,
    };
  }

  /* --------------------------------------------------------------- layout
     The arrangement presets, exactly as the wall has them: six views, and
     three arrangements of the first one because a bird box is empty for half
     the year and a view built around it is then a view built around a blank
     rectangle. */
  const LAYOUTS = {
    presets: {
      grid: {
        label: 'Everything',
        variants: {
          'birds-photos': {
            label: 'Bird box and photos',
            note: 'the box above the countdown, photographs down the right',
            rows: '1.5fr 1fr 0.7fr',
            areas: [
              'camera    camera    camera    media media media',
              'countdown countdown countdown media media media',
              'countdown countdown countdown food  food  timers',
            ],
            visible: ['camera', 'countdown', 'media', 'food', 'timers'],
          },
          photos: {
            label: 'Photos, no bird box',
            note: 'for the months the box is empty — the picture gets the full height',
            rows: '1.25fr 1fr 0.55fr',
            areas: [
              'countdown countdown media media media media media media',
              'timers    timers    media media media media media media',
              'food      food      media media media media media media',
            ],
            visible: ['countdown', 'media', 'food', 'timers'],
          },
          birds: {
            label: 'Bird box, no photos',
            note: 'nesting season — the box gets the full height',
            rows: '1.25fr 1fr 0.55fr',
            areas: [
              'countdown countdown camera camera camera camera camera camera',
              'timers    timers    camera camera camera camera camera camera',
              'food      food      camera camera camera camera camera camera',
            ],
            visible: ['camera', 'countdown', 'food', 'timers'],
          },
        },
      },
      cooking: {
        label: 'Cooking',
        variants: {
          tonight: {
            label: 'Tonight and timers',
            note: 'the two suggestions with the dials beside them',
            rows: '1fr',
            areas: ['food food food food timers timers'],
            visible: ['food', 'timers'],
          },
          steps: {
            label: 'More room to cook',
            note: 'for reading the steps from across the kitchen — one dial keeps the time',
            rows: '1fr',
            areas: ['food food food food food timers'],
            visible: ['food', 'timers'],
          },
        },
      },
      house: {
        label: 'House',
        rows: '1fr 132px',
        areas: [
          'ha ha ha ha countdown countdown',
          'ha ha ha ha services  services',
        ],
        visible: ['ha', 'countdown', 'services'],
      },
      ambient: {
        label: 'Photos',
        rows: '1fr',
        areas: ['media media media media media media'],
        visible: ['media'],
      },
      birds: {
        label: 'Birds',
        rows: '1fr',
        areas: ['camera camera camera camera camera camera'],
        visible: ['camera'],
      },
      tv: {
        label: 'TV',
        rows: '1fr',
        areas: ['tv tv tv tv tv tv'],
        visible: ['tv'],
      },
    },
  };

  /* ---------------------------------------------------------------- house
     Nine rooms and two sensor readings. Most rooms dim and take colour; the
     storage cupboard is an on/off plug, which is what gives the House panel
     its "no gear on a lamp that cannot do anything" case. */
  const ROOMS = [
    ['light.demo_kitchen', 'Kitchen', 'full', 'on', 78],
    ['light.demo_living', 'Living room', 'full', 'on', 55],
    ['light.demo_tv', 'TV room', 'full', 'on', 32],
    ['light.demo_office', 'Office', 'warm', 'off', 100],
    ['light.demo_bedroom', 'Bedroom', 'full', 'off', 40],
    ['light.demo_bathroom', 'Bathroom', 'warm', 'off', 100],
    ['light.demo_hall', 'Hallway', 'warm', 'on', 20],
    ['light.demo_guest', 'Guest room', 'full', 'off', 100],
    ['light.demo_store', 'Storage', 'plug', 'off', 100],
  ];

  const ENTITIES = {
    lights: ROOMS.map(([entity, label]) => ({ entity, label })),
    climate: [
      { label: 'Kitchen', temp_entity: 'sensor.demo_kitchen_t', hum_entity: 'sensor.demo_kitchen_h' },
      { label: 'Outside', temp_entity: 'sensor.demo_out_t', hum_entity: 'sensor.demo_out_h', outside: true },
    ],
    motion: { entity: '', auto_expand: false, auto_unmute: false, cooldown_s: 120, hold_s: 60 },
  };

  function haStates() {
    const st = {};
    for (const [entity, , kind, power, pct] of ROOMS) {
      const modes = kind === 'plug' ? ['onoff']
        : kind === 'warm' ? ['color_temp'] : ['color_temp', 'xy'];
      st[entity] = {
        s: power,
        a: {
          supported_color_modes: modes,
          ...(kind === 'plug' ? {} : {
            brightness: Math.round(pct * 2.55),
            min_color_temp_kelvin: 2000,
            max_color_temp_kelvin: 6500,
            color_temp_kelvin: 2700,
          }),
        },
      };
    }
    st['sensor.demo_kitchen_t'] = { s: '21.4', a: {} };
    st['sensor.demo_kitchen_h'] = { s: '44', a: {} };
    st['sensor.demo_out_t'] = { s: '13.8', a: {} };
    st['sensor.demo_out_h'] = { s: '71', a: {} };
    return st;
  }

  /* ------------------------------------------------------------ countdown
     A city on an event buys it two weather chips: what it is like there now,
     and the forecast for the day — the second only exists inside the sixteen
     days a forecast actually covers, which is why Tokyo says so instead. */
  const EVENTS = [
    { id: 'e1', title: 'Dinner with friends', date: inDays(2), note: '19:00',
      city: '', accent: 'food' },
    { id: 'e2', title: 'Weekend in Lisbon', date: inDays(9), note: 'three nights',
      city: 'Lisbon, PT', accent: 'birds' },
    { id: 'e3', title: 'Clean out the bird box', date: inDays(23), note: 'before the frost',
      city: '', accent: 'house' },
    { id: 'e4', title: 'Trip to Tokyo', date: inDays(74), note: '',
      city: 'Tokyo, JP', accent: 'photos' },
    { id: 'e5', title: 'New year', date: `${new Date().getMonth() > 0
      ? new Date().getFullYear() + 1 : new Date().getFullYear()}-01-01`,
      note: '', city: '', accent: 'photos' },
  ];

  // What the chips draw from. `now` is "there at this moment", `day` is the
  // forecast for that date; a city with no `day` entry reads as too far off.
  const CITY_WX = {
    'lisbon, pt': {
      label: 'Lisbon',
      now: { temp: 26, feels: 27, code: 0, day: 1 },
      day: { tmax: 27, tmin: 18, code: 1, pp: 5 },
    },
    'tokyo, jp': {
      label: 'Tokyo',
      now: { temp: 24, feels: 26, code: 2, day: 0 },
      day: null,
    },
  };

  // The city box's type-ahead. The real one asks Open-Meteo's geocoder; this
  // is a short list filtered by what has been typed.
  const PLACES = [
    { name: 'Lisbon', admin1: 'Lisboa', country: 'Portugal', value: 'Lisbon, PT' },
    { name: 'Tokyo', admin1: 'Tokyo', country: 'Japan', value: 'Tokyo, JP' },
    { name: 'Stockholm', admin1: 'Stockholm', country: 'Sweden', value: 'Stockholm, SE' },
    { name: 'Berlin', admin1: 'Berlin', country: 'Germany', value: 'Berlin, DE' },
    { name: 'Barcelona', admin1: 'Catalonia', country: 'Spain', value: 'Barcelona, ES' },
    { name: 'Reykjavík', admin1: 'Capital Region', country: 'Iceland', value: 'Reykjavík, IS' },
    { name: 'Porto', admin1: 'Porto', country: 'Portugal', value: 'Porto, PT' },
    { name: 'Copenhagen', admin1: 'Capital Region', country: 'Denmark', value: 'Copenhagen, DK' },
    { name: 'Kyoto', admin1: 'Kyoto', country: 'Japan', value: 'Kyoto, JP' },
    { name: 'Amsterdam', admin1: 'North Holland', country: 'Netherlands', value: 'Amsterdam, NL' },
  ];

  /* -------------------------------------------------------------- cooking
     Six dinners, three of each kind, written the way the food agent writes
     them: a note, a time, servings, ingredients flagged have/don't-have, and
     steps whose timed ones can start a kitchen timer with one tap. */
  const ing = (name, qty, have) => ({ name, qty, have: !!have });

  const RECIPES = [
    {
      id: 'veg-1', kind: 'veg', title: 'Halloumi and couscous with roasted peppers',
      note: 'sheet pan, almost no washing up', time_min: 30, servings: 4, rating: null,
      ingredients: [
        ing('halloumi', '2 blocks'), ing('couscous', '300 g', true),
        ing('red peppers', '3', true), ing('red onion', '2', true),
        ing('lemon', '1'), ing('olive oil', '4 tbsp', true),
        ing('mint', 'a handful'), ing('cumin', '1 tsp', true),
      ],
      steps: [
        { text: 'Heat the oven to 220°C. Cut the peppers and onion into wide strips.', timer_min: null },
        { text: 'Toss with oil and cumin, spread on a tray and roast.', timer_min: 20 },
        { text: 'Pour boiling water over the couscous, cover and leave it alone.', timer_min: 8 },
        { text: 'Slice the halloumi thick and fry it hard on both sides.', timer_min: 6 },
        { text: 'Fork the couscous through, add lemon and mint, pile the peppers on top.', timer_min: null },
      ],
    },
    {
      id: 'veg-2', kind: 'veg', title: 'Mushroom risotto',
      note: 'wants stirring, worth it', time_min: 40, servings: 4, rating: 1,
      ingredients: [
        ing('arborio rice', '350 g', true), ing('chestnut mushrooms', '400 g'),
        ing('dried porcini', '20 g'), ing('vegetable stock', '1.2 l', true),
        ing('white wine', '150 ml'), ing('parmesan', '80 g', true),
        ing('shallots', '2', true), ing('butter', '50 g', true),
      ],
      steps: [
        { text: 'Soak the porcini in hot water; keep the water, it is the stock.', timer_min: 15 },
        { text: 'Soften the shallots in butter, add the rice and let it go glassy.', timer_min: null },
        { text: 'Wine in, then stock a ladle at a time, stirring.', timer_min: 18 },
        { text: 'Fry the fresh mushrooms separately so they colour rather than steam.', timer_min: 8 },
        { text: 'Beat in the parmesan off the heat and let it sit two minutes.', timer_min: 2 },
      ],
    },
    {
      id: 'veg-3', kind: 'veg', title: 'Chickpea and spinach curry',
      note: 'store cupboard, twenty-five minutes', time_min: 25, servings: 4, rating: null,
      ingredients: [
        ing('chickpeas', '2 tins', true), ing('chopped tomatoes', '1 tin', true),
        ing('spinach', '200 g'), ing('coconut milk', '400 ml', true),
        ing('garam masala', '2 tsp', true), ing('ginger', 'thumb'),
        ing('garlic', '4 cloves', true), ing('basmati rice', '300 g', true),
      ],
      steps: [
        { text: 'Fry the garlic, ginger and spices until the kitchen smells of them.', timer_min: null },
        { text: 'Tomatoes and coconut milk in, simmer until it thickens.', timer_min: 12 },
        { text: 'Rice on.', timer_min: 11 },
        { text: 'Chickpeas in to warm through, spinach at the very end.', timer_min: 4 },
      ],
    },
    {
      id: 'nrm-1', kind: 'normal', title: 'Creamy chicken and leek pie',
      note: 'a Sunday thing on a Tuesday', time_min: 55, servings: 4, rating: null,
      ingredients: [
        ing('chicken thighs', '800 g'), ing('leeks', '3', true),
        ing('puff pastry', '1 sheet'), ing('crème fraîche', '200 ml'),
        ing('dijon mustard', '2 tsp', true), ing('thyme', 'a few sprigs', true),
        ing('chicken stock', '300 ml', true), ing('egg', '1', true),
      ],
      steps: [
        { text: 'Brown the chicken in batches so it colours instead of stewing.', timer_min: 10 },
        { text: 'Soften the leeks in the same pan, then stock, mustard and thyme.', timer_min: 12 },
        { text: 'Stir in the crème fraîche, let it cool a little, tip into a dish.', timer_min: null },
        { text: 'Lid of pastry, egg wash, into a 200°C oven until deep gold.', timer_min: 25 },
      ],
    },
    {
      id: 'nrm-2', kind: 'normal', title: 'Salmon with dill potatoes',
      note: 'thirty-five minutes, one pan and a pot', time_min: 35, servings: 4, rating: null,
      ingredients: [
        ing('salmon fillets', '4'), ing('new potatoes', '900 g', true),
        ing('dill', 'a bunch'), ing('butter', '60 g', true),
        ing('lemon', '1'), ing('capers', '2 tbsp', true),
        ing('green beans', '300 g'),
      ],
      steps: [
        { text: 'Potatoes into salted water.', timer_min: 18 },
        { text: 'Salmon skin down in a hot pan, and leave it there.', timer_min: 6 },
        { text: 'Turn it, one minute more, then rest it off the heat.', timer_min: 1 },
        { text: 'Beans in with the potatoes for the last four minutes.', timer_min: 4 },
        { text: 'Butter, capers, lemon and most of the dill into the pan; pour it over.', timer_min: null },
      ],
    },
    {
      id: 'nrm-3', kind: 'normal', title: 'Beef chili',
      note: 'better tomorrow, so make it all', time_min: 50, servings: 6, rating: -1,
      ingredients: [
        ing('minced beef', '700 g'), ing('kidney beans', '2 tins', true),
        ing('chopped tomatoes', '2 tins', true), ing('onions', '2', true),
        ing('smoked paprika', '2 tsp', true), ing('chipotle paste', '1 tbsp'),
        ing('dark chocolate', '20 g', true), ing('cumin', '2 tsp', true),
      ],
      steps: [
        { text: 'Brown the beef properly — it is the whole flavour of the dish.', timer_min: 10 },
        { text: 'Onions and spices in, then tomatoes and chipotle.', timer_min: null },
        { text: 'Low and slow, lid off for the last stretch.', timer_min: 35 },
        { text: 'Beans and the chocolate in at the end, then leave it to sit.', timer_min: 10 },
      ],
    },
  ];

  const SUGGESTIONS = {
    version: 1,
    date: inDays(0),
    generated: new Date(Date.now() - 5 * 3600000).toISOString(),
    recipes: RECIPES,
    chosen: { veg: 'veg-1' },
    stale: false,
  };

  const SHOPPING = {
    version: 1,
    updated: new Date(Date.now() - 3600000).toISOString(),
    items: [
      { id: 's1', name: 'halloumi', qty: '2 blocks', checked: false, checked_at: null,
        source: 'recipe', recipe_id: 'veg-1', staple: false },
      { id: 's2', name: 'lemon', qty: '1', checked: false, checked_at: null,
        source: 'recipe', recipe_id: 'veg-1', staple: false },
      { id: 's3', name: 'mint', qty: 'a handful', checked: false, checked_at: null,
        source: 'recipe', recipe_id: 'veg-1', staple: false },
      { id: 's4', name: 'washing up liquid', qty: '', checked: false, checked_at: null,
        source: 'manual', recipe_id: null, staple: false },
      { id: 's5', name: 'coffee', qty: '500 g', checked: false, checked_at: null,
        source: 'manual', recipe_id: null, staple: true },
      { id: 's6', name: 'bread', qty: '', checked: true,
        checked_at: new Date(Date.now() - DAY).toISOString(),
        source: 'manual', recipe_id: null, staple: false },
      { id: 's7', name: 'milk', qty: '2 l', checked: true,
        checked_at: new Date(Date.now() - DAY).toISOString(),
        source: 'receipt', recipe_id: null, staple: true },
    ],
  };

  const PANTRY = {
    version: 1,
    updated: new Date(Date.now() - 2 * DAY).toISOString(),
    items: [
      { id: 'p1', name: 'couscous', qty: '500 g', category: 'dry', added: inDays(-3), source: 'receipt' },
      { id: 'p2', name: 'red peppers', qty: '4', category: 'veg', added: inDays(-3), source: 'receipt' },
      { id: 'p3', name: 'olive oil', qty: '1 l', category: 'dry', added: inDays(-10), source: 'receipt' },
      { id: 'p4', name: 'arborio rice', qty: '1 kg', category: 'dry', added: inDays(-12), source: 'manual' },
      { id: 'p5', name: 'parmesan', qty: '200 g', category: 'dairy', added: inDays(-6), source: 'receipt' },
      { id: 'p6', name: 'chickpeas', qty: '4 tins', category: 'tins', added: inDays(-21), source: 'receipt' },
      { id: 'p7', name: 'coconut milk', qty: '2 tins', category: 'tins', added: inDays(-21), source: 'receipt' },
      { id: 'p8', name: 'butter', qty: '250 g', category: 'dairy', added: inDays(-4), source: 'receipt' },
      { id: 'p9', name: 'new potatoes', qty: '1 kg', category: 'veg', added: inDays(-2), source: 'receipt' },
      { id: 'p10', name: 'mushrooms', qty: '400 g', category: 'veg', added: inDays(-31), source: 'receipt' },
      { id: 'p11', name: 'garam masala', qty: '1 jar', category: 'spice', added: inDays(-40), source: 'manual' },
    ],
  };

  /* --------------------------------------------------------------- timers
     Three dials, in three different states, because a demo that shows only
     idle ones shows none of the panel. `ends_at` is absolute, as on the
     server, so the running one keeps counting across a reload. */
  const TIMERS = [
    { id: 0, state: 'running', duration_s: 1500,
      ends_at: (Date.now() + 12.5 * 60000) / 1000, remaining_s: null,
      label: 'Halloumi and couscous' },
    { id: 1, state: 'idle', duration_s: 600, ends_at: null, remaining_s: null, label: '' },
    { id: 2, state: 'paused', duration_s: 660, ends_at: null, remaining_s: 272, label: 'Rice' },
  ];

  /* --------------------------------------------------------------- photos
     Six photographs, in media/photos/. Drop your own files in there and list
     them here the same way.

     `folder` and `library` are what the caption under the slideshow reads, and
     what the folder browser groups by. `when` is either a year, and the date is
     invented inside it, or a full timestamp for a picture that was actually
     taken on a day. */
  const P = (n, folder, library, root, when, w, h) => ({
    file: `media/photos/demo-${String(n).padStart(2, '0')}.jpg`,
    id: n, folder, library, root, w, h,
    mtime: Math.floor(new Date(
      typeof when === 'number' ? `${when}-06-1${n % 9}T12:00:00` : when,
    ).getTime() / 1000),
  });

  // Newest first: that is the order "Newest first" in the gear walks forward
  // through, so a picture with a real date belongs at its date, not at the end.
  const PHOTOS = [
    P(18, 'Pictures/2025/Autumn', 'Demo library', 'photos', '2025-10-28T16:05:53', 1600, 898),
    P(16, 'Pictures/2025/Midsummer', 'Demo library', 'photos', '2025-07-20T10:18:04', 1600, 898),
    P(17, 'Pictures/2025/Midsummer', 'Demo library', 'photos', '2025-07-20T11:17:02', 1600, 900),
    P(15, 'Pictures/2025/Midsummer', 'Demo library', 'photos', '2025-07-02T14:05:53', 1600, 1200),
    P(14, 'Pictures/2025/Winter', 'Demo library', 'photos', '2025-02-16T14:26:33', 1600, 1200),
    P(13, 'Pictures/2024/Autumn', 'Demo library', 'photos', '2024-10-30T16:35:53', 1600, 900),
  ];

  // One video, so the folder browser has a clip to open. It is the same file
  // the bird box panel loops.
  const CLIP = {
    id: 101, kind: 'video', name: 'birdbox.mp4', folder: 'Clips/Bird box',
    root: 'video', library: 'Clips', mtime: Math.floor(Date.now() / 1000) - 3 * DAY / 1000,
    duration: 10, playclass: 'direct', heavy: false,
    thumb_url: 'media/birdbox.jpg', url: 'media/birdbox.mp4',
  };

  const ROOT_LABELS = { photos: 'Demo library', family: 'Family', video: 'Clips' };

  /* Where each library would live on the NAS. Invented, like everything else
     here, but it is what the caption under the slideshow prints on its second
     line — the whole path, because the file name alone does not say which of
     four folders called Camera a picture came out of. */
  const NAS_ROOTS = {
    photos: '/share/photos',
    family: '/share/family',
    video: '/share/video',
  };

  /* ------------------------------------------------------------------ TV
     Twelve tiles, every one of them a local page — no third-party site is
     contacted by this demo. Two are marked "needs its own tab" so the panel's
     other path can be seen: on the wall that is Netflix and friends refusing
     to be framed, which the backend finds out by reading their headers. */
  const CH = (label, mark, color, framable) => ({
    label, mark, color, framable,
    url: `media/channel.html?c=${encodeURIComponent(label)}&k=${encodeURIComponent(color)}`,
    note: framable ? 'live' : '',
  });

  // Marks are letters and typographic symbols rather than emoji: a tile whose
  // glyph is a missing-character box on somebody else's machine is the one
  // thing a demo cannot afford.
  const CHANNELS = [
    CH('Nature Live', 'NL', '#93d3a2', true),
    CH('City Cam', 'CC', '#8fc0d8', true),
    CH('News 24', 'N24', '#e05c5c', true),
    CH('Recipes', 'RC', '#e2a184', true),
    CH('Music Box', '♪', '#d3b3e8', true),
    CH('Kids', 'K', '#e86fa0', true),
    CH('Docs', 'D', '#e8c07a', true),
    CH('Weather', 'W', '#7ec8c0', true),
    CH('Radio', 'R', '#c9c2b0', true),
    CH('Local TV', 'LT', '#9b83e8', true),
    CH('Film Club', 'FC', '#e8484f', false),
    CH('Sport', 'SP', '#6e8fe0', false),
  ];

  /* --------------------------------------------------------------- config
     What GET /api/config answers with. Same shape as the real backend's. */
  const CONFIG = {
    layouts: LAYOUTS,
    entities: ENTITIES,
    camera: { sub_src: 'demo', hd_src: 'demo', go2rtc_base: '' },
    slideshow: {
      interval_s: 3, transition_s: 1.2, order: 'shuffle', recent_ratio: 0.3,
      include_videos: false, fit: 'contain', show_caption: true, use_chosen: true,
      source: 'cache', cache_size: 350, cache_refresh_h: 24,
    },
    launchers: [],
    tv: { links: CHANNELS.map(({ label, mark, color, url, note }) => ({ label, mark, color, url, note })) },
    services: { url: 'media/house.html', display: 'home.demo', label: 'Home' },
    clocks: [
      { label: 'Lisbon', tz: 'Europe/Lisbon' },
      { label: 'Berlin', tz: 'Europe/Berlin' },
      { label: 'Tokyo', tz: 'Asia/Tokyo' },
      { label: 'New York', tz: 'America/New_York' },
    ],
  };

  window.DEMO = {
    CITY, CONFIG, LAYOUTS, ENTITIES, ROOMS, EVENTS, CITY_WX, PLACES,
    SUGGESTIONS, SHOPPING, PANTRY, TIMERS, PHOTOS, CLIP, ROOT_LABELS, NAS_ROOTS,
    CHANNELS, weather, haStates, iso, inDays,
  };
})();
