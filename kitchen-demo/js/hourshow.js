/* The hour, shown (2026-11-12).

   When the clock strikes the hour (chime.js), the wall can also put on a
   show for as long as the sound plays: the whole screen becomes a clock, and
   the creature that is calling comes out and does what it does — a crane
   flies over, the donkey walks round the clock braying, the frog hops, the
   owl lands on top and hoots. Its sound is drawn too: a comic word ("HEE-HAW!"),
   rings of sound from its mouth, notes for the songbirds.

   **Skins.** How the hour looks is a skin, chosen in the clock's sheet
   (`show` in chime.json: "off" or a skin's id). One so far, "garden": an
   analog clock standing in a meadow under the sky of the hour. A skin draws
   the scene and the clock; the creatures and their sounds are this module's
   and are the same in every skin, so a new skin is a scene and nothing else.
   One skin is plain (2026-11-13, Alex: the dim clock's calm pond "for hourly
   time sound animations … in plain version"): "pond" is the screen dimming's
   look 5 (pond.js) filling the screen with the time over it — no creature, no
   words — for as long as the sound plays, like the others. Since 2026-11-15
   the butterfly tree (tree.js, look 6) is one too, and on both the new hour
   is made so the hour's show is not mistaken for the dim clock
   (hourpaint.js): on the pond a butterfly flies in and paints it in colour;
   on the tree the crown's own butterflies fly off and land in its shape.

   Everything is drawn here, in SVG, from shapes: no pictures to fetch, so
   the show starts the instant the sound does, even on a wall that has only
   just woken. It is a page overlay above everything (even the dim clock) and
   a tap anywhere ends it. It never runs on a phone (chime.js strikes nothing
   there). */

export const SKINS = [['off', 'Off'], ['garden', 'Analog garden'], ['pond', 'Calm pond'], ['tree', 'Butterfly tree']];
const PLAIN = { pond: ['pond.js', 'Pond'], tree: ['tree.js', 'Tree'] };
/* How the show goes (2026-11-15, Alex: "a time option for how many times
   this animation will be played and for how long each animation will be
   shown … make the time digits bigger … options to set how big"). chime.py's
   SHOW_TIMES, SHOW_SECS and SHOW_SIZES must match. Each time again, the pond's
   butterfly paints the hour anew as the old paint fades, and the tree's
   butterflies fly home to their twigs as others come; the garden simply
   goes on that much longer. The digits' size is the pond's and the tree's
   (a share of the screen's height; the width of the screen is the limit). */
export const TIMES = [1, 2, 3, 4, 5];
export const SECS = [[0, 'As the sound'], [15, '15 s'], [20, '20 s'], [30, '30 s'], [45, '45 s'], [60, '1 min']];
export const DIGITS = [['m', 'Medium', 0.3], ['l', 'Large', 0.4], ['xl', 'Very large', 0.48], ['full', 'Full width', 0.62]];
const digitsOf = (k) => (DIGITS.find(([v]) => v === k) || DIGITS[1])[2];

// Where the sun is, as the dim clock's landscape has it (light, glow, arc).
const { sunAt } = await import(`./dimscape.js${new URL(import.meta.url).search}`);

const NS = 'http://www.w3.org/2000/svg';
const W = 1600;
const H = 900;
const CX = 800;          // the clock: its middle and its face's radius
const CY = 410;
const R = 205;
const HEAD_Y = 104;      // the time's baseline, above it
const ORBIT = { cx: 800, cy: 712, rx: 600, ry: 105 };   // the walkers' path round it
const MIN_S = 12;        // a show lasts at least this long...
const AFTER_S = 3;       // ...and this long after the sound ends...
const MAX_S = 40;        // ...and never longer than this
const CALL_EVERY_S = 3.2;

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const ease = (u) => 1 - (1 - u) ** 3;
const easeBack = (u) => { const c = 1.6; return 1 + (c + 1) * (u - 1) ** 3 + c * (u - 1) ** 2; };

/* ------------------------------------------------------------ creatures ----
   Which creature a sound is. The built-in ones by id; an uploaded one by the
   words in its name ("rooster-crowing-in-the-morning" is a rooster), and
   anything not recognised is a songbird with notes. */
const BY_ID = {
  crane: 'crane', 'crane-far': 'cranes', meow: 'cat', owl: 'owl', blackbird: 'blackbird',
  crow: 'crow', donkey: 'donkey', goat: 'goat', frog: 'frog',
};
const BY_WORD = [
  [/donkey|hee-?haw/i, 'donkey'], [/\bcow|moo|cattle|bull\b/i, 'cow'], [/gees|goose|honk/i, 'geese'],
  [/horse|neigh|pony|whinny/i, 'horse'], [/rooster|cock|chicken|\bhen\b|crow(ing)? in the morning/i, 'rooster'],
  [/\bcat\b|meow|kitten|purr/i, 'cat'], [/\bowl/i, 'owl'], [/\bcrows?\b|raven|caw/i, 'crow'],
  [/frog|toad|ribbit|croak/i, 'frog'], [/goat|sheep|lamb|baa|bleat/i, 'goat'], [/crane/i, 'crane'],
  [/blackbird|thrush|robin|song ?bird|sparrow|tit\b|finch/i, 'blackbird'],
];
export function creatureOf(id, name = '') {
  if (BY_ID[id]) return BY_ID[id];
  // "rooster-crowing…" must be a rooster before the crow rule sees "crow".
  const words = String(name).replace(/[-_]+/g, ' ');
  if (/rooster|cockerel|chicken|\bhen\b/i.test(words)) return 'rooster';
  for (const [rx, kind] of BY_WORD) if (rx.test(words)) return kind;
  return 'blackbird';
}

/* What each one does and says. `motion`: fly (one bird, passes over the
   screen), flock (a V of them, high), perch (flies in, sits on the clock),
   walk (round the clock), hop (round it, in jumps). */
const KINDS = {
  crane: { label: 'Crane', motion: 'fly', word: 'KRROO-KRROO!', color: '#c0392b', scale: 1.15 },
  cranes: { label: 'Cranes', motion: 'flock', base: 'crane', word: 'kru… kru…', color: '#7f8c8d', scale: 0.42, count: 7 },
  geese: { label: 'Geese', motion: 'flock', base: 'goose', word: 'HONK! HONK!', color: '#8e5a2b', scale: 0.5, count: 6 },
  crow: { label: 'Crow', motion: 'fly', word: 'CAW! CAW!', color: '#2c3e50', scale: 0.95 },
  blackbird: { label: 'Blackbird', motion: 'fly', word: '♪ tirra-lee ♪', color: '#e67e22', scale: 0.8, notes: true },
  owl: { label: 'Owl', motion: 'perch', word: 'HOO-HOOO', color: '#6d4c2f', scale: 1 },
  donkey: { label: 'Donkey', motion: 'walk', word: 'HEE-HAW!', color: '#7b5e57', scale: 1.05, speed: 0.32 },
  horse: { label: 'Horse', motion: 'walk', word: 'NEIGH-HEH-HEH!', color: '#8b4513', scale: 1.15, speed: 0.42 },
  cow: { label: 'Cow', motion: 'walk', word: 'MOOOO!', color: '#34495e', scale: 1.1, speed: 0.24 },
  goat: { label: 'Goat', motion: 'walk', word: 'MEEH-EH-EH!', color: '#8e7d5a', scale: 0.85, speed: 0.36 },
  cat: { label: 'Cat', motion: 'walk', word: 'MEOW!', color: '#d35400', scale: 1.15, speed: 0.34 },
  rooster: { label: 'Rooster', motion: 'walk', word: 'COCK-A-DOODLE-DOO!', color: '#c0392b', scale: 1.3, speed: 0.38 },
  frog: { label: 'Frog', motion: 'hop', word: 'RIBBIT!', color: '#27ae60', scale: 1.7 },
};

/* ------------------------------------------------------------- sprites ----
   Each is drawn facing right, its origin at its feet (walkers) or its middle
   (fliers). Parts that move carry a class and their pivot:
   .leg-a/.leg-b swing in turn, .head nods, .tail sways, .wing-n/.wing-f flap,
   .lid blinks, .sac swells (the frog). */
const pv = (cls, x, y, body) => `<g class="${cls}" data-px="${x}" data-py="${y}">${body}</g>`;
const shadow = (rx = 70) => `<ellipse cx="0" cy="2" rx="${rx}" ry="${rx * 0.16}" fill="#000" opacity=".18"/>`;
const eye = (x, y, r = 4.5) => `<circle cx="${x}" cy="${y}" r="${r}" fill="#fff"/><circle cx="${x + 1}" cy="${y}" r="${r * 0.6}" fill="#1b1b1b"/>`
  + `<circle cx="${x + 2}" cy="${y - 1.5}" r="${r * 0.22}" fill="#fff"/>`;

function quadruped(o) {
  const leg = (x, cls, c) => pv(cls, x, -50, `<rect x="${x - 7}" y="-52" width="14" height="${o.legLen || 48}" rx="7" fill="${c}"/>`
    + `<rect x="${x - 8}" y="${-52 + (o.legLen || 48) - 8}" width="16" height="10" rx="4" fill="${o.hoof}"/>`);
  const far = o.far || o.body;
  const horns = o.horns === 'goat'
    ? `<path d="M70,-148 Q62,-175 44,-176 Q58,-168 62,-146 Z" fill="#a89070"/><path d="M80,-150 Q76,-178 58,-182 Q72,-172 72,-148 Z" fill="#bca582"/>`
    : o.horns === 'cow' ? `<path d="M70,-146 Q64,-162 52,-162" stroke="#e8dcc0" stroke-width="7" fill="none" stroke-linecap="round"/>`
      + `<path d="M84,-148 Q86,-166 98,-168" stroke="#f3ead6" stroke-width="7" fill="none" stroke-linecap="round"/>` : '';
  const ears = `<ellipse cx="66" cy="${-148 - o.ear / 2}" rx="7" ry="${o.ear / 2 + 4}" fill="${o.earC || o.body}" transform="rotate(-22 66 -146)"/>`
    + `<ellipse cx="76" cy="${-150 - o.ear / 2}" rx="7" ry="${o.ear / 2 + 4}" fill="${o.earC || o.body}" transform="rotate(8 76 -148)"/>`
    + (o.ear > 20 ? `<ellipse cx="76" cy="${-150 - o.ear / 2}" rx="3.5" ry="${o.ear / 2 - 2}" fill="${o.earIn || '#555'}" transform="rotate(8 76 -148)"/>` : '');
  const mane = o.mane ? `<path d="M38,-100 Q50,-140 72,-150 Q66,-134 60,-128 Q56,-116 50,-108 Q46,-98 40,-92 Z" fill="${o.mane}"/>` : '';
  const spots = (o.spots || []).map(([x, y, rx, ry]) => `<ellipse cx="${x}" cy="${y}" rx="${rx}" ry="${ry}" fill="${o.spotC}"/>`).join('');
  const beard = o.beard ? `<path d="M100,-108 Q104,-90 96,-84 Q92,-96 92,-108 Z" fill="${o.beard}"/>` : '';
  const udder = o.udder ? `<ellipse cx="-6" cy="-44" rx="16" ry="9" fill="#f4a6b4"/>` : '';
  const tail = pv('tail', -58, -86, o.tailLong
    ? `<path d="M-58,-88 Q-82,-70 -80,-30 Q-70,-50 -60,-80 Z" fill="${o.tailC || o.mane || o.body}"/>`
    : `<path d="M-58,-88 Q-76,-72 -74,-48" stroke="${o.body}" stroke-width="6" fill="none" stroke-linecap="round"/>`
      + `<ellipse cx="-74" cy="-44" rx="6" ry="10" fill="${o.tailC || '#444'}"/>`);
  return `${shadow(80)}
    ${leg(-36, 'leg-b', far)}${leg(36, 'leg-a', far)}
    ${tail}
    <g class="bob">
      <ellipse cx="0" cy="-78" rx="66" ry="34" fill="${o.body}"/>
      <ellipse cx="0" cy="-62" rx="48" ry="16" fill="${o.belly}" opacity=".7"/>
      ${spots}${udder}
      <path d="M36,-100 Q52,-130 68,-142 L94,-124 Q72,-98 56,-62 Z" fill="${o.body}"/>
      ${mane}
      ${pv('head', 64, -128, `${ears}${horns}
        <ellipse cx="84" cy="-128" rx="30" ry="18" fill="${o.body}" transform="rotate(28 84 -128)"/>
        <ellipse cx="102" cy="-112" rx="16" ry="14" fill="${o.muzzle}"/>
        <circle cx="108" cy="-114" r="2.6" fill="#3a2a2a"/>
        <path d="M100,-102 Q108,-100 114,-104" stroke="#3a2a2a" stroke-width="2.4" fill="none" stroke-linecap="round"/>
        ${eye(80, -136)}${beard}`)}
    </g>
    ${leg(-26, 'leg-a', o.body)}${leg(46, 'leg-b', o.body)}`;
}

function cat() {
  const c = '#f0a04b';
  const d = '#c97a2c';
  const leg = (x, cls, col) => pv(cls, x, -28, `<rect x="${x - 6}" y="-30" width="12" height="30" rx="6" fill="${col}"/>`);
  return `${shadow(60)}
    ${leg(-30, 'leg-b', d)}${leg(30, 'leg-a', d)}
    ${pv('tail', -50, -50, `<path d="M-50,-50 Q-90,-60 -86,-110 Q-84,-124 -74,-120" stroke="${c}" stroke-width="10" fill="none" stroke-linecap="round"/>`)}
    <g class="bob">
      <ellipse cx="0" cy="-44" rx="54" ry="22" fill="${c}"/>
      <path d="M-30,-62 l8,30 M-12,-64 l6,32 M6,-64 l4,30" stroke="${d}" stroke-width="5" stroke-linecap="round"/>
      ${pv('head', 44, -60, `<path d="M42,-86 L46,-112 L62,-92 Z" fill="${c}"/><path d="M66,-90 L80,-112 L82,-86 Z" fill="${c}"/>
        <path d="M48,-92 L49,-104 L57,-94 Z" fill="#f7c6c6"/><path d="M70,-90 L78,-104 L78,-90 Z" fill="#f7c6c6"/>
        <circle cx="62" cy="-72" r="24" fill="${c}"/>
        <path d="M50,-92 l4,10 M62,-96 l0,10" stroke="${d}" stroke-width="4" stroke-linecap="round"/>
        ${eye(56, -76, 4)}${eye(72, -76, 4)}
        <path d="M66,-66 l-3,3 l6,0 Z" fill="#e57b8a"/>
        <path d="M63,-62 Q66,-58 70,-62" stroke="#5a3a2a" stroke-width="2" fill="none"/>
        <path d="M74,-66 l22,-4 M74,-63 l22,2 M58,-66 l-22,-4 M58,-63 l-22,2" stroke="#fff" stroke-width="1.6" opacity=".8"/>`)}
    </g>
    ${leg(-20, 'leg-a', c)}${leg(40, 'leg-b', c)}`;
}

function rooster() {
  const leg = (x, cls) => pv(cls, x, -36, `<path d="M${x},-36 L${x},-4 M${x - 8},0 L${x + 12},0" stroke="#e6a817" stroke-width="5" stroke-linecap="round"/>`);
  return `${shadow(45)}
    ${leg(-6, 'leg-b')}
    ${pv('tail', -26, -66, `<path d="M-24,-60 Q-70,-130 -40,-150 Q-50,-110 -14,-70 Z" fill="#1e5b46"/>
      <path d="M-26,-62 Q-80,-100 -70,-140 Q-60,-100 -16,-66 Z" fill="#14342a"/>
      <path d="M-22,-58 Q-64,-60 -78,-100 Q-50,-80 -12,-62 Z" fill="#2e7d5b"/>`)}
    <g class="bob">
      <ellipse cx="0" cy="-58" rx="36" ry="28" fill="#c0502a"/>
      <ellipse cx="10" cy="-50" rx="22" ry="18" fill="#7a2e14"/>
      <path d="M-20,-62 Q0,-40 22,-58 Q4,-50 -20,-62 Z" fill="#8f3a1a"/>
      <path d="M14,-76 Q20,-96 26,-104 L38,-96 Q32,-80 30,-66 Z" fill="#e0782f"/>
      ${pv('head', 26, -96, `<circle cx="32" cy="-104" r="15" fill="#e0782f"/>
        <path d="M22,-116 q4,-14 8,-2 q4,-14 8,-2 q5,-12 7,2 Z" fill="#e3242b"/>
        <path d="M45,-106 L60,-101 L45,-97 Z" fill="#f2b630"/>
        <ellipse cx="44" cy="-90" rx="5" ry="8" fill="#e3242b"/>
        ${eye(36, -107, 3.6)}`)}
    </g>
    ${leg(10, 'leg-a')}`;
}

function frog() {
  return `${shadow(46)}
    <g class="bob">
      <ellipse cx="-26" cy="-14" rx="22" ry="14" fill="#3f8f34"/>
      <ellipse cx="0" cy="-30" rx="40" ry="28" fill="#5cb44a"/>
      <ellipse cx="8" cy="-20" rx="26" ry="14" fill="#c8e6a0"/>
      <path d="M-34,-36 q10,-8 18,0 M-20,-48 q8,-6 14,0" stroke="#3f8f34" stroke-width="5" fill="none" stroke-linecap="round"/>
      <ellipse cx="26" cy="-6" rx="10" ry="6" fill="#3f8f34"/>
      ${pv('sac', 30, -14, '<circle class="sac-c" cx="30" cy="-12" r="12" fill="#eaf5b8" stroke="#a4c46a" stroke-width="2"/>')}
      <circle cx="14" cy="-58" r="13" fill="#5cb44a"/><circle cx="34" cy="-56" r="13" fill="#5cb44a"/>
      ${eye(15, -60, 7)}${eye(35, -58, 7)}
      <path d="M8,-30 Q26,-22 42,-34" stroke="#2d6b25" stroke-width="3" fill="none" stroke-linecap="round"/>
    </g>`;
}

/* A bird in flight, side on. Wings flap by squashing them through the body
   line — from above it (+1) to under it (−1). */
function flyer(o) {
  const wing = (cls, col, dx) => pv(cls, dx, -6, `<path d="M${dx - 34},-4 Q${dx - 30},-${o.span * 0.7} ${dx - 70},-${o.span}
     Q${dx - 10},-${o.span * 0.55} ${dx + 26},-6 Z" fill="${col}"/>
     <path d="M${dx - 70},-${o.span} Q${dx - 60},-${o.span * 0.75} ${dx - 46},-${o.span * 0.62}" stroke="${o.tip}" stroke-width="9" fill="none" stroke-linecap="round"/>`);
  const legs = o.legs ? `<path d="M-30,4 L-${o.legs},10 M-30,8 L-${o.legs},16" stroke="#222" stroke-width="3.4" stroke-linecap="round"/>` : '';
  const neck = o.neck ? `<path d="M30,-8 Q${30 + o.neck / 2},-14 ${32 + o.neck},-10 L${32 + o.neck},0 Q${30 + o.neck / 2},-2 30,6 Z" fill="${o.neckC || o.body}"/>` : '';
  const hx = 40 + o.neck;
  return `${wing('wing-f', o.far, 6)}${legs}
    <path d="M-40,-2 L-${o.tail},-14 L-${o.tail - 6},10 Z" fill="${o.far}"/>
    <ellipse cx="0" cy="0" rx="${o.len}" ry="${o.thick}" fill="${o.body}"/>
    ${neck}
    <g class="head"><circle cx="${hx}" cy="-6" r="${o.headR}" fill="${o.headC || o.body}"/>
      ${o.cheek ? `<path d="M${hx - 8},-2 Q${hx},4 ${hx + 6},-4" stroke="${o.cheek}" stroke-width="4" fill="none"/>` : ''}
      ${o.crown ? `<circle cx="${hx + 1}" cy="${-6 - o.headR + 3}" r="4.5" fill="${o.crown}"/>` : ''}
      <path d="M${hx + o.headR - 2},-9 L${hx + o.headR + o.beak},-5 L${hx + o.headR - 2},-1 Z" fill="${o.beakC}"/>
      ${eye(hx + 3, -9, 3)}${o.ring ? `<circle cx="${hx + 3}" cy="-9" r="4.4" fill="none" stroke="${o.ring}" stroke-width="1.6"/>` : ''}</g>
    ${wing('wing-n', o.near, 0)}`;
}

const FLYERS = {
  crane: { body: '#b9bec6', far: '#8e949c', near: '#c9ced5', tip: '#2b2b2b', span: 92, len: 46, thick: 15,
    neck: 46, neckC: '#2b2b2b', headC: '#2b2b2b', headR: 10, cheek: '#f5f5f5', crown: '#d62d20', beak: 22, beakC: '#5b5b5b', tail: 70, legs: 120 },
  goose: { body: '#9a8f80', far: '#6f665a', near: '#b3a998', tip: '#3e3832', span: 80, len: 44, thick: 17,
    neck: 30, neckC: '#5e564b', headC: '#5e564b', headR: 11, beak: 16, beakC: '#f39c34', tail: 60 },
  crow: { body: '#23252b', far: '#15161a', near: '#33363e', tip: '#0a0a0c', span: 80, len: 40, thick: 15,
    neck: 8, headR: 13, beak: 18, beakC: '#15161a', tail: 66 },
  blackbird: { body: '#1e1f22', far: '#121315', near: '#2c2d31', tip: '#0a0a0a', span: 60, len: 32, thick: 13,
    neck: 6, headR: 11, beak: 12, beakC: '#f5a623', ring: '#f5a623', tail: 58 },
};

function owl() {
  const wing = (cls, side) => pv(cls, side * 34, -30, `<path d="M${side * 34},-40 Q${side * 110},-90 ${side * 140},-30 Q${side * 100},-38 ${side * 90},-10 Q${side * 70},-24 ${side * 34},-6 Z" fill="#7a5a3c"/>`);
  return `${wing('wing-l', -1)}${wing('wing-r', 1)}
    <g class="bob">
      <path d="M-30,-82 L-40,-110 L-14,-90 Z M30,-82 L40,-110 L14,-90 Z" fill="#7a5a3c"/>
      <ellipse cx="0" cy="-40" rx="44" ry="56" fill="#8b6a4a"/>
      <ellipse cx="0" cy="-22" rx="28" ry="34" fill="#e9d5b4"/>
      <path d="M-14,-34 l6,6 l6,-6 M2,-34 l6,6 l6,-6 M-14,-16 l6,6 l6,-6 M2,-16 l6,6 l6,-6 M-6,0 l6,6 l6,-6" stroke="#a07e58" stroke-width="2.6" fill="none"/>
      <g class="fold"><ellipse cx="-40" cy="-36" rx="12" ry="36" fill="#6f5034"/><ellipse cx="40" cy="-36" rx="12" ry="36" fill="#6f5034"/></g>
      ${pv('head', 0, -70, `<ellipse cx="-17" cy="-74" rx="20" ry="19" fill="#f2e2c4"/><ellipse cx="17" cy="-74" rx="20" ry="19" fill="#f2e2c4"/>
        <circle cx="-17" cy="-74" r="12" fill="#f4c430"/><circle cx="17" cy="-74" r="12" fill="#f4c430"/>
        <circle cx="-16" cy="-74" r="6.5" fill="#111"/><circle cx="18" cy="-74" r="6.5" fill="#111"/>
        <circle cx="-14" cy="-77" r="2" fill="#fff"/><circle cx="20" cy="-77" r="2" fill="#fff"/>
        ${pv('lid', 0, -88, '<rect x="-38" y="-94" width="76" height="22" rx="10" fill="#8b6a4a"/>')}
        <path d="M-5,-64 L0,-52 L5,-64 Z" fill="#e0a030"/>`)}
      <path d="M-14,14 l-4,8 M-8,14 l0,9 M8,14 l0,9 M14,14 l4,8" stroke="#e0a030" stroke-width="4" stroke-linecap="round"/>
    </g>`;
}

function sprite(kind) {
  switch (kind) {
    case 'donkey': return quadruped({ body: '#9b9a9e', far: '#7f7e83', belly: '#e2e0dc', muzzle: '#e6e1d8', hoof: '#3b3b3b',
      ear: 34, earIn: '#5d5c61', mane: '#4a4a4f', tailC: '#3d3d40' });
    case 'horse': return quadruped({ body: '#8b5a2b', far: '#6e4520', belly: '#a8774a', muzzle: '#6b4423', hoof: '#2b2018',
      ear: 14, mane: '#2e1d10', tailLong: true, legLen: 56 });
    case 'cow': return quadruped({ body: '#f6f3ee', far: '#d9d4cc', belly: '#ffffff', muzzle: '#f2b6be', hoof: '#3b3b3b',
      ear: 12, earC: '#f6f3ee', horns: 'cow', spotC: '#2b2b2b', udder: true,
      spots: [[-30, -86, 20, 13], [16, -70, 14, 10], [40, -94, 10, 8], [-50, -66, 9, 7]] });
    case 'goat': return quadruped({ body: '#ece5d6', far: '#cfc6b3', belly: '#fffaf0', muzzle: '#e0d6c2', hoof: '#4a4038',
      ear: 12, horns: 'goat', beard: '#cfc3a8', tailC: '#ece5d6' });
    case 'cat': return cat();
    case 'rooster': return rooster();
    case 'frog': return frog();
    case 'owl': return owl();
    default: return flyer(FLYERS[kind] || FLYERS.blackbird);
  }
}

/* Where each one's voice comes from, in its own drawing's units. */
const MOUTH = {
  donkey: [116, -106], horse: [116, -106], cow: [116, -106], goat: [116, -106],
  cat: [70, -62], rooster: [60, -100], frog: [42, -30], owl: [0, -58],
  crane: [118, -6], goose: [92, -6], crow: [80, -6], blackbird: [62, -6],
};

/* ----------------------------------------------------------- the scene ----
   The garden skin (rebuilt 2026-11-12, "more professional, artistic"): a
   landscape in layers that fade into the distance — sky, far and near
   mountains in haze, a lake, wooded hills, the meadow — lit by where the sun
   really is (today's sunrise and sunset from the forecast, dimscape.js's
   sunAt): the colours of day, golden hour and night blended by the light,
   not swapped by the hour. In it a station clock: brass bezel, enamel face,
   blued two-tone hands with their shadows, on an iron post; the time above
   it in large type with the date under it. Everything enters in turn — the
   clock, its indices one by one, the hands sweeping to the time, the
   figures rising — and the clock rings out a pulse at every call. */
const hexOf = (c) => [1, 3, 5].map((i) => parseInt(c.slice(i, i + 2), 16));
const mix = (a, b, u) => {
  const A = hexOf(a);
  const B = hexOf(b);
  return `#${A.map((v, i) => Math.round(v + (B[i] - v) * clamp(u, 0, 1)).toString(16).padStart(2, '0')).join('')}`;
};
const blend = (P, Q, u) => Object.fromEntries(Object.keys(P).map((k) => [k, mix(P[k], Q[k], u)]));

const DAY = { sky0: '#2a6fb8', sky1: '#76b4e3', sky2: '#d6ecf7', haze: '#cfe3ef', far: '#9db8cf', near: '#7f9fba',
  lake0: '#d4ecf8', lake1: '#5f98c2', hill: '#86b862', hillD: '#5a8f42', tree: '#3c7639', treeL: '#5d9c4b',
  ground0: '#72b052', ground1: '#3d7030', sun: '#fff6c8', cloud: '#ffffff', cloudS: '#c4d8e8' };
const GOLD = { sky0: '#3a3f7a', sky1: '#d88a6c', sky2: '#ffd6a0', haze: '#f0b893', far: '#a4809a', near: '#86698a',
  lake0: '#ffd6a8', lake1: '#9a7aa8', hill: '#9aa456', hillD: '#738440', tree: '#4c6235', treeL: '#7d8c46',
  ground0: '#83a047', ground1: '#4a612c', sun: '#ffb060', cloud: '#ffe6c8', cloudS: '#c98a8a' };
const NIGHT = { sky0: '#02061a', sky1: '#0b1838', sky2: '#1f3160', haze: '#1d2c55', far: '#1b2648', near: '#121a36',
  lake0: '#2c406f', lake1: '#0a1230', hill: '#172629', hillD: '#0f1a1c', tree: '#0b1416', treeL: '#14231f',
  ground0: '#16241c', ground1: '#0a120d', sun: '#f2eed6', cloud: '#3a4670', cloudS: '#1a2244' };

/* A small seeded random, so the same hour draws the same hills. */
function rnd(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a * 1664525 + 1013904223) >>> 0;
    return a / 4294967296;
  };
}

const HILL = (x) => 604 - 24 * Math.sin(x / 230 + 0.7) - 13 * Math.sin(x / 97 + 2.1);
const MEADOW = (x) => 688 - 15 * Math.sin(x / 300 + 2) - 7 * Math.sin(x / 120);

function ridge(base, amp, s, step = 20) {
  let d = `M-40,900 L-40,${base}`;
  for (let x = -40; x <= W + 40; x += step) {
    const v = 0.55 * Math.sin(x / 170 + s) + 0.3 * Math.sin(x / 67 + 2 * s) + 0.15 * Math.sin(x / 29 + 3 * s);
    d += ` L${x},${(base - amp * ((v + 1) / 2) ** 1.7).toFixed(1)}`;
  }
  return `${d} L${W + 40},900 Z`;
}

function line(fn, step = 20) {
  let d = `M-20,900 L-20,${fn(-20).toFixed(1)}`;
  for (let x = 0; x <= W + 20; x += step) d += ` L${x},${fn(x).toFixed(1)}`;
  return `${d} L${W + 20},900 Z`;
}

function tree(x, y, s, p, kind) {
  if (kind) {
    return `<g transform="translate(${x} ${y}) scale(${s})">
      <rect x="-3" y="-10" width="6" height="12" fill="${p.hillD}"/>
      <path d="M0,-70 L-16,-30 L-9,-30 L-22,-6 L22,-6 L9,-30 L16,-30 Z" fill="${p.tree}"/>
      <path d="M0,-70 L16,-30 L9,-30 L22,-6 L4,-6 Z" fill="${p.treeL}" opacity=".45"/></g>`;
  }
  return `<g transform="translate(${x} ${y}) scale(${s})">
    <rect x="-3.5" y="-22" width="7" height="24" fill="${p.hillD}"/>
    <circle cx="-10" cy="-34" r="16" fill="${p.tree}"/><circle cx="10" cy="-36" r="17" fill="${p.tree}"/>
    <circle cx="0" cy="-50" r="18" fill="${p.tree}"/>
    <circle cx="6" cy="-54" r="10" fill="${p.treeL}" opacity=".55"/><circle cx="14" cy="-38" r="8" fill="${p.treeL}" opacity=".4"/></g>`;
}

const SERIF = "Georgia, 'DejaVu Serif', 'Liberation Serif', serif";

function gardenScene(now, sun) {
  const light = sun.light;
  let p = blend(NIGHT, DAY, light);
  p = blend(p, GOLD, sun.glow * (light > 0 ? 0.8 : 0.45));
  const night = light < 0.35;
  const r = rnd(now.getDate() * 97 + now.getHours());
  // The sun along its arc; the moon along the night's.
  // ...never behind the clock or the time: the middle of the sky is theirs.
  const across = (a) => (a < 0.5 ? 130 + a * 2 * 290 : 1180 + (a - 0.5) * 2 * 290);
  const sx = across(sun.arc);
  const sy = 478 - Math.sin(Math.PI * sun.arc) * 330;
  const mx = across(sun.moonArc);
  const my = 430 - Math.sin(Math.PI * sun.moonArc) * 290;
  let stars = '';
  if (light < 0.6) {
    for (let i = 0; i < 110; i += 1) {
      stars += `<circle class="hs-star" cx="${(r() * W).toFixed(0)}" cy="${(r() * 470).toFixed(0)}"
        r="${(0.6 + r() * 1.5).toFixed(1)}" fill="#fff" data-i="${i}" data-o="${(1 - light / 0.6).toFixed(2)}"/>`;
    }
  }
  const cloud = (x, y, s, o, far) => `<g class="hs-cloud" data-x="${x}" data-y="${y}" data-s="${s}" data-v="${far ? 5 : 11}"
      transform="translate(${x} ${y}) scale(${s})" opacity="${o}">
    <ellipse cx="0" cy="8" rx="96" ry="18" fill="url(#hs-cloudg)"/>
    <circle cx="-52" cy="-6" r="30" fill="url(#hs-cloudg)"/><circle cx="-12" cy="-24" r="42" fill="url(#hs-cloudg)"/>
    <circle cx="34" cy="-14" r="34" fill="url(#hs-cloudg)"/><circle cx="66" cy="0" r="22" fill="url(#hs-cloudg)"/></g>`;
  const cloudO = night ? 0.35 : 0.92;
  let trees = '';
  for (let x = 20; x < W; x += 34 + r() * 46) {
    const s = 0.55 + r() * 0.55;
    trees += tree(x.toFixed(0), (HILL(x) + 6).toFixed(0), s.toFixed(2), p, r() < 0.45);
  }
  let shimmer = '';
  for (let i = 0; i < 26; i += 1) {
    const y = 556 + r() * 34;
    shimmer += `<rect class="hs-shim" data-i="${i}" x="${(r() * W).toFixed(0)}" y="${y.toFixed(0)}" width="${(30 + r() * 90).toFixed(0)}"
      height="2" rx="1" fill="${night ? '#c9d6ff' : '#ffffff'}" opacity=".0"/>`;
  }
  let flowers = '';
  for (let i = 0; i < 40; i += 1) {
    const x = r() * W;
    const y = MEADOW(x) + 30 + r() * (900 - MEADOW(x) - 40);
    const c = ['#ff7a9c', '#ffd34d', '#ffffff', '#b99cff', '#ff9f43'][i % 5];
    const s = 0.6 + ((y - 700) / 200) * 0.8;
    flowers += `<g class="hs-sway" data-k="${i % 3}" data-x="${x.toFixed(0)}" data-y="${y.toFixed(0)}" data-s="${s.toFixed(2)}"
      transform="translate(${x.toFixed(0)} ${y.toFixed(0)}) scale(${s.toFixed(2)})">
      <path d="M0,0 Q2,-10 0,-20" stroke="${p.ground1}" stroke-width="2.4" fill="none"/>
      <circle cx="0" cy="-22" r="5.5" fill="${mix(c, p.ground1, night ? 0.75 : 0.1)}"/><circle cx="0" cy="-22" r="2.2" fill="${mix('#f5b324', p.ground1, night ? 0.7 : 0)}"/></g>`;
  }
  let grass = '';
  for (let i = 0; i < 90; i += 1) {
    const x = (i / 90) * W + r() * 14;
    const h = 22 + r() * 30;
    grass += `<g class="hs-sway" data-k="${i % 3}" data-x="${x.toFixed(0)}" data-y="902" data-s="1" transform="translate(${x.toFixed(0)} 902)">
      <path d="M-5,0 Q-6,-${h * 0.6} -12,-${h} Q-1,-${h * 0.55} 1,0 Z M0,0 Q4,-${h * 0.7} 9,-${h * 0.9} Q4,-${h * 0.5} 5,0 Z" fill="${mix(p.ground1, '#000', 0.25)}"/></g>`;
  }
  let flies = '';
  if (light < 0.3) {
    for (let i = 0; i < 22; i += 1) {
      flies += `<circle class="hs-fly" data-i="${i}" data-x="${(r() * W).toFixed(0)}" data-y="${(560 + r() * 300).toFixed(0)}" r="9" fill="url(#hs-flyg)"/>`;
    }
  }
  // The clock.
  const ticks = Array.from({ length: 60 }, (_, i) => {
    if (i % 5 === 0) return '';
    const a = (i / 60) * Math.PI * 2;
    const r1 = R - 16;
    const r2 = R - 26;
    return `<line x1="${(CX + Math.sin(a) * r1).toFixed(1)}" y1="${(CY - Math.cos(a) * r1).toFixed(1)}"
      x2="${(CX + Math.sin(a) * r2).toFixed(1)}" y2="${(CY - Math.cos(a) * r2).toFixed(1)}" stroke="#3a2f25" stroke-width="1.6"/>`;
  }).join('');
  const idx = Array.from({ length: 12 }, (_, i) => {
    if (i % 3 === 0) {
      const n = i === 0 ? 12 : i;
      const a = (i / 12) * Math.PI * 2;
      const rr = R - 64;
      return `<g class="hs-idx" data-i="${i}"><text x="${(CX + Math.sin(a) * rr).toFixed(1)}" y="${(CY - Math.cos(a) * rr).toFixed(1)}"
        text-anchor="middle" dominant-baseline="central" font-family="${SERIF}" font-size="62" fill="#251c15">${n}</text></g>`;
    }
    return `<g class="hs-idx" data-i="${i}" data-a="${i * 30}"><g transform="rotate(${i * 30} ${CX} ${CY})">
      <rect x="${CX - 5}" y="${CY - R + 30}" width="10" height="38" rx="2" fill="url(#hs-brass)"/>
      <rect x="${CX}" y="${CY - R + 30}" width="5" height="38" rx="1" fill="#000" opacity=".12"/></g></g>`;
  }).join('');
  const guill = Array.from({ length: 16 }, (_, i) => `<circle cx="${CX}" cy="${CY}" r="${24 + i * 7}" fill="none" stroke="#7a5f3a" stroke-width=".8" opacity=".09"/>`).join('');
  const hand = (cls, len, w, tail) => `<g class="${cls}">
      <g transform="translate(6 9)" opacity=".22"><g class="${cls}-sh"><path d="M${CX},${CY + tail} L${CX - w},${CY - 10} L${CX},${CY - len} L${CX + w},${CY - 10} Z" fill="#000"/></g></g>
      <g class="${cls}-in"><path d="M${CX},${CY + tail} L${CX - w},${CY - 10} L${CX},${CY - len} Z" fill="#1a2231"/>
      <path d="M${CX},${CY + tail} L${CX + w},${CY - 10} L${CX},${CY - len} Z" fill="#3e4f68"/></g></g>`;
  const hh = String(now.getHours()).padStart(2, '0');
  const mm = String(now.getMinutes()).padStart(2, '0');
  const chars = `${hh}:${mm}`.split('');
  const adv = (c) => (c === ':' ? 30 : 56);
  const total = chars.reduce((s, c) => s + adv(c), 0);
  let cx = CX - total / 2;
  const digits = chars.map((c, i) => {
    const x = cx + adv(c) / 2;
    cx += adv(c);
    return `<g class="hs-ch" data-i="${i}"><text x="${x}" y="${HEAD_Y + 3}" text-anchor="middle" font-size="96" font-weight="300" fill="#000" opacity=".22">${c}</text>
      <text x="${x}" y="${HEAD_Y}" text-anchor="middle" font-size="96" font-weight="300" fill="#fff">${c}</text></g>`;
  }).join('');
  const date = now.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' }).toUpperCase().replace(',', ' ·');
  return `
    <defs>
      <linearGradient id="hs-sky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${p.sky0}"/>
        <stop offset=".55" stop-color="${p.sky1}"/><stop offset="1" stop-color="${p.sky2}"/></linearGradient>
      <radialGradient id="hs-sunglow" cx=".5" cy=".5" r=".5"><stop offset="0" stop-color="${p.sun}" stop-opacity=".75"/>
        <stop offset=".35" stop-color="${p.sun}" stop-opacity=".22"/><stop offset="1" stop-color="${p.sun}" stop-opacity="0"/></radialGradient>
      <linearGradient id="hs-cloudg" x1="0" y1="0" x2="0" y2="1"><stop offset=".3" stop-color="${p.cloud}"/><stop offset="1" stop-color="${p.cloudS}"/></linearGradient>
      <linearGradient id="hs-far" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${p.far}"/><stop offset="1" stop-color="${p.haze}"/></linearGradient>
      <linearGradient id="hs-near" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${p.near}"/><stop offset="1" stop-color="${mix(p.near, p.haze, 0.6)}"/></linearGradient>
      <linearGradient id="hs-haze" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${p.haze}" stop-opacity="0"/>
        <stop offset=".6" stop-color="${p.haze}" stop-opacity=".75"/><stop offset="1" stop-color="${p.haze}" stop-opacity="0"/></linearGradient>
      <linearGradient id="hs-lake" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${p.lake0}"/><stop offset="1" stop-color="${p.lake1}"/></linearGradient>
      <linearGradient id="hs-hill" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${p.hill}"/><stop offset="1" stop-color="${p.hillD}"/></linearGradient>
      <linearGradient id="hs-ground" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${p.ground0}"/><stop offset="1" stop-color="${p.ground1}"/></linearGradient>
      <linearGradient id="hs-brass" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#fff2c2"/><stop offset=".28" stop-color="#e0b35a"/>
        <stop offset=".55" stop-color="#94661f"/><stop offset=".8" stop-color="#f0d188"/><stop offset="1" stop-color="#6e4b14"/></linearGradient>
      <linearGradient id="hs-brass2" x1="1" y1="1" x2="0" y2="0"><stop offset="0" stop-color="#fff2c2"/><stop offset=".3" stop-color="#d8a94e"/>
        <stop offset=".6" stop-color="#8a5d1a"/><stop offset="1" stop-color="#e9c77a"/></linearGradient>
      <radialGradient id="hs-face" cx=".46" cy=".4" r=".62"><stop offset="0" stop-color="#fffdf8"/><stop offset=".72" stop-color="#f7efdd"/>
        <stop offset="1" stop-color="#e3d3b2"/></radialGradient>
      <linearGradient id="hs-glass" x1="0" y1="0" x2=".6" y2="1"><stop offset="0" stop-color="#fff" stop-opacity=".55"/>
        <stop offset="1" stop-color="#fff" stop-opacity="0"/></linearGradient>
      <linearGradient id="hs-iron" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#0f1814"/><stop offset=".45" stop-color="#3b4d42"/>
        <stop offset="1" stop-color="#0c1310"/></linearGradient>
      <radialGradient id="hs-vig" cx=".5" cy=".46" r=".75"><stop offset=".55" stop-color="#000" stop-opacity="0"/>
        <stop offset="1" stop-color="#000" stop-opacity="${night ? 0.55 : 0.38}"/></radialGradient>
      <radialGradient id="hs-flyg" cx=".5" cy=".5" r=".5"><stop offset="0" stop-color="#fff7b0"/><stop offset=".25" stop-color="#e8f56a" stop-opacity=".8"/>
        <stop offset="1" stop-color="#c8f04a" stop-opacity="0"/></radialGradient>
      <radialGradient id="hs-halo" cx=".5" cy=".5" r=".5"><stop offset=".6" stop-color="${p.sun}" stop-opacity="0"/>
        <stop offset=".8" stop-color="${p.sun}" stop-opacity="${night ? 0.12 : 0.2}"/><stop offset="1" stop-color="${p.sun}" stop-opacity="0"/></radialGradient>
    </defs>
    <rect width="${W}" height="${H}" fill="url(#hs-sky)"/>
    <g class="hs-stars">${stars}</g>
    ${sun.up || light > 0.05 ? `<g class="hs-rays" data-x="${sx.toFixed(0)}" data-y="${sy.toFixed(0)}" opacity="${(0.07 * light).toFixed(3)}">${
      Array.from({ length: 9 }, (_, i) => `<path d="M${sx},${sy} L${sx + Math.cos(i * 0.7) * 1400},${sy + Math.sin(i * 0.7) * 1400}
        L${sx + Math.cos(i * 0.7 + 0.12) * 1400},${sy + Math.sin(i * 0.7 + 0.12) * 1400} Z" fill="${p.sun}"/>`).join('')}</g>
      <circle cx="${sx}" cy="${sy}" r="260" fill="url(#hs-sunglow)"/>
      <circle cx="${sx}" cy="${sy}" r="52" fill="${p.sun}"/>` : ''}
    ${light < 0.5 ? `<circle cx="${mx}" cy="${my}" r="150" fill="url(#hs-sunglow)" opacity=".5"/>
      <circle cx="${mx}" cy="${my}" r="40" fill="#f3efda"/>
      <circle cx="${mx - 12}" cy="${my - 8}" r="8" fill="#ddd6bb" opacity=".7"/><circle cx="${mx + 10}" cy="${my + 12}" r="6" fill="#ddd6bb" opacity=".6"/>
      <circle cx="${mx + 14}" cy="${my - 14}" r="4" fill="#ddd6bb" opacity=".6"/>` : ''}
    ${cloud(260, 150, 0.7, cloudO * 0.7, true)}${cloud(1000, 110, 0.6, cloudO * 0.6, true)}
    <path d="${ridge(470, 150, 1.3, 16)}" fill="url(#hs-far)"/>
    ${cloud(560, 260, 1.05, cloudO, false)}${cloud(1380, 220, 1.3, cloudO, false)}
    <path d="${ridge(530, 110, 4.2, 14)}" fill="url(#hs-near)"/>
    <rect x="0" y="440" width="${W}" height="140" fill="url(#hs-haze)"/>
    <rect x="0" y="548" width="${W}" height="60" fill="url(#hs-lake)"/>
    <g class="hs-shims">${shimmer}</g>
    <path d="${line(HILL)}" fill="url(#hs-hill)"/>
    ${trees}
    <path d="${line(MEADOW)}" fill="url(#hs-ground)"/>
    <path d="${line(MEADOW).replace(/ L[^ ]+,900 Z$/, '').replace(/^M-20,900 L/, 'M')}" fill="none" stroke="${mix(p.ground0, '#fff', 0.35)}" stroke-width="3" opacity=".5"/>
    ${flowers}
    <g class="hs-back"></g>
    <ellipse cx="${CX + 30}" cy="${ORBIT.cy + 8}" rx="130" ry="16" fill="#000" opacity=".22"/>
    <g class="hs-post">
      <path d="M${CX - 46},${ORBIT.cy + 8} Q${CX - 30},${ORBIT.cy - 8} ${CX - 16},${ORBIT.cy - 22} L${CX + 16},${ORBIT.cy - 22}
        Q${CX + 30},${ORBIT.cy - 8} ${CX + 46},${ORBIT.cy + 8} Z" fill="url(#hs-iron)"/>
      <rect x="${CX - 11}" y="${CY + R}" width="22" height="${ORBIT.cy - CY - R - 16}" fill="url(#hs-iron)"/>
      <rect x="${CX - 20}" y="${ORBIT.cy - 46}" width="40" height="8" rx="3" fill="url(#hs-brass)"/>
      <path d="M${CX - 34},${CY + R + 22} Q${CX},${CY + R + 62} ${CX + 34},${CY + R + 22} Z" fill="url(#hs-iron)"/>
    </g>
    <g class="hs-clock">
      <circle cx="${CX + 12}" cy="${CY + 18}" r="${R + 34}" fill="#000" opacity=".25"/>
      <circle class="hs-halo" cx="${CX}" cy="${CY}" r="${R + 120}" fill="url(#hs-halo)"/>
      <circle cx="${CX}" cy="${CY}" r="${R + 32}" fill="url(#hs-brass)"/>
      <circle cx="${CX}" cy="${CY}" r="${R + 23}" fill="url(#hs-brass2)"/>
      <circle cx="${CX}" cy="${CY}" r="${R + 14}" fill="url(#hs-brass)"/>
      <circle cx="${CX}" cy="${CY}" r="${R + 5}" fill="#4a3210"/>
      <circle cx="${CX}" cy="${CY}" r="${R}" fill="url(#hs-face)"/>
      ${guill}
      <circle cx="${CX}" cy="${CY}" r="${R - 14}" fill="none" stroke="#3a2f25" stroke-width="1.4"/>
      <circle cx="${CX}" cy="${CY}" r="${R - 26}" fill="none" stroke="#3a2f25" stroke-width="1"/>
      ${ticks}
      ${idx}
      <text class="hs-name" x="${CX}" y="${CY + 84}" text-anchor="middle" font-family="${SERIF}" font-size="22" font-style="italic"
        letter-spacing="3" fill="#7a5f3a"></text>
      <path d="M${CX - 40},${CY + 97} L${CX + 40},${CY + 97}" stroke="#b39468" stroke-width="1"/>
      ${hand('hs-hand-h', 128, 13, 26)}
      ${hand('hs-hand-m', 186, 9, 32)}
      <g class="hs-hand-s"><g transform="translate(5 8)" opacity=".2"><g class="hs-hand-s-sh">
          <line x1="${CX}" y1="${CY + 46}" x2="${CX}" y2="${CY - 196}" stroke="#000" stroke-width="3"/></g></g>
        <g class="hs-hand-s-in"><line x1="${CX}" y1="${CY + 46}" x2="${CX}" y2="${CY - 196}" stroke="#c0281f" stroke-width="2.6" stroke-linecap="round"/>
        <circle cx="${CX}" cy="${CY + 36}" r="7" fill="#c0281f"/></g></g>
      <circle cx="${CX}" cy="${CY}" r="13" fill="url(#hs-brass)"/><circle cx="${CX}" cy="${CY}" r="4.5" fill="#3a2a10"/>
      <path class="hs-glass" d="M${CX - R + 18},${CY - 30} A${R - 18},${R - 18} 0 0 1 ${CX + 60},${CY - R + 26}
        Q${CX - 60},${CY - R + 70} ${CX - R + 18},${CY - 30} Z" fill="url(#hs-glass)" opacity=".5"/>
    </g>
    <g class="hs-head">${digits}
      <g class="hs-date" opacity="0">
        <path d="M${CX - 320},${HEAD_Y + 34} L${CX - 236},${HEAD_Y + 34} M${CX + 236},${HEAD_Y + 34} L${CX + 320},${HEAD_Y + 34}" stroke="#fff" stroke-opacity=".6" stroke-width="1.4"/>
        <text x="${CX}" y="${HEAD_Y + 40}" text-anchor="middle" font-size="19" letter-spacing="6" fill="#fff" fill-opacity=".9">${date}</text>
      </g>
    </g>
    <rect width="${W}" height="${H}" fill="url(#hs-vig)" pointer-events="none"/>
    <g class="hs-flies">${flies}</g>
    <g class="hs-front"></g>
    ${grass}
    <g class="hs-fx"></g>`;
}

const SCENES = { garden: gardenScene };

/* ------------------------------------------------------------- the show ---- */
export default {
  el: null,
  raf: 0,

  init(ctx) {
    this.ctx = ctx;
  },

  build() {
    if (this.el) return;
    const el = document.createElement('div');
    el.id = 'hour-show';
    el.setAttribute('aria-hidden', 'true');
    const svg = document.createElementNS(NS, 'svg');
    svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
    svg.setAttribute('preserveAspectRatio', 'xMidYMid slice');
    el.appendChild(svg);
    document.body.appendChild(el);
    el.addEventListener('pointerdown', (e) => { e.stopPropagation(); e.preventDefault(); this.stop(); }, true);
    this.el = el;
    this.svg = svg;
  },

  /* Put the show on: `skin` from the clock's settings, the sound's id and
     name, and the <audio> that is playing it (null for a silent preview), so
     the show lasts as long as the sound does. */
  play({ skin = 'garden', id = '', name = '', audio = null, sun = null, times = 1, secs = 0, size = 'l' } = {}) {
    const how = { times: TIMES.includes(times) ? times : 1, secs: SECS.some(([v]) => v === secs) ? secs : 0, size: digitsOf(size) };
    if (PLAIN[skin]) return this.playPlain(skin, { audio, sun, how });
    if (!SCENES[skin]) return false;
    this.build();
    this.stop(true);
    this.el.classList.remove('hs-plain');
    const now = new Date();
    this.svg.innerHTML = SCENES[skin](now, sunAt(now.getTime(), sun?.rise, sun?.set));
    const kindName = creatureOf(id, name);
    const kind = KINDS[kindName] || KINDS.blackbird;
    // The creature's own name: an upload's file name is too long for a clock face.
    this.svg.querySelector('.hs-name').textContent = (BY_ID[id] ? name : kind.label || name || '').slice(0, 18);
    // The moving parts of the scene, found once rather than every frame.
    const all = (sel) => [...this.svg.querySelectorAll(sel)];
    this.bits = {
      clouds: all('.hs-cloud'), stars: all('.hs-star'), shims: all('.hs-shim'), sway: all('.hs-sway'),
      flies: all('.hs-fly'), idx: all('.hs-idx'), chars: all('.hs-ch'), rays: this.svg.querySelector('.hs-rays'),
      date: this.svg.querySelector('.hs-date'), clock: this.svg.querySelector('.hs-clock'),
      glass: this.svg.querySelector('.hs-glass'), halo: this.svg.querySelector('.hs-halo'),
      hands: ['h', 'm', 's'].map((k) => [this.svg.querySelector(`.hs-hand-${k}-in`), this.svg.querySelector(`.hs-hand-${k}-sh`)]),
    };
    this.state = {
      t0: performance.now(), audio, kindName, kind, keep: MIN_S, lastCall: -10, calls: 0, closing: null, ...how,
      round: 1, roundAt: 0, roundLen: null,
      actors: this.cast(kindName, kind), fx: [],
    };
    this.el.classList.add('on');
    const loop = () => { this.raf = requestAnimationFrame(loop); this.frame(); };
    this.raf = requestAnimationFrame(loop);
    return true;
  },

  /* The plain skins: the calm pond or the butterfly tree, and the hour
     painted over it. The overlay is up at once; the scene (pond.js or
     tree.js, and wxart.js for the hour's rain or snow) and the painter
     (hourpaint.js) come in as soon as they have loaded — from the cache on a
     wall that has shown the dim clock's looks. Without the painter the time
     is plain words, as it was. */
  playPlain(skin, { audio = null, sun = null, how = { times: 1, secs: 0, size: 0.4 } } = {}) {
    this.build();
    this.stop(true);
    if (!this.timeEl) {
      this.timeEl = document.createElement('div');
      this.timeEl.className = 'hs-time';
      this.el.appendChild(this.timeEl);
    }
    this.el.classList.add('hs-plain', 'on');
    const st = { t0: performance.now(), audio, keep: MIN_S, closing: null, plain: true, words: false, ...how,
      round: 1, roundAt: 0, roundLen: null };
    this.state = st;
    this.timeEl.textContent = '';
    const loop = () => { this.raf = requestAnimationFrame(loop); this.frame(); };
    this.raf = requestAnimationFrame(loop);
    this.startPlain(st, skin, sun);
    return true;
  },

  async startPlain(st, skin, sun) {
    const V = new URL(import.meta.url).search;
    const [file, cls] = PLAIN[skin];
    this.mods ||= {};
    const load = (f) => (this.mods[f] ||= import(`./${f}${V}`).catch((e) => {
      console.error(`${f} did not load`, e);
      delete this.mods[f];
      return null;
    }));
    const [mod, paintMod, wx] = await Promise.all([load(file), load('hourpaint.js'), load('wxart.js')]);
    if (this.state !== st) return;               // over, or another show began meanwhile
    const now = Date.now();
    const w = this.ctx?.weather;
    const hours = w?.data?.hourly;
    const i = hours?.length && w.nowIndex ? w.nowIndex(hours) : -1;
    const sc = wx && i >= 0 ? wx.scene(hours[i]) : null;
    // The tree's own butterflies make the hour; on the pond one paints it.
    const text = paintMod?.HourPaint.hourText(new Date(now));
    const flock = paintMod && mod && skin === 'tree';
    let box = null;
    if (flock) {
      this.flock ||= new paintMod.HourFlock(this.el);
      box = this.flock.layout(text, st.size);
    } else if (paintMod) {
      this.painter ||= new paintMod.HourPaint(this.el);
      this.painter.start(text, { skin, night: !!sc?.night, size: st.size });
      this.hourArt = this.painter;
      box = this.painter.box();
    } else {
      st.words = true;
      this.tickTime();
    }
    if (!mod) return;
    this.scenes ||= {};
    for (const [k, sc2] of Object.entries(this.scenes)) if (k !== skin) sc2.stop();
    const scene = this.scenes[skin] ||= new mod[cls](this.el);
    scene.set(sc, { now, rise: sun?.rise, set: sun?.set, seed: mod.daySeed(now), boxes: box ? [box] : [] }, 3);
    scene.start();
    if (flock) {
      this.flock.start(scene);
      this.hourArt = this.flock;
    }
  },

  tickTime() {
    const t = new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false });
    if (this.timeEl.textContent !== t) this.timeEl.textContent = t;
  },

  stop(now = false) {
    if (!this.state) return;
    if (now) {
      cancelAnimationFrame(this.raf);
      this.state = null;
      for (const sc of Object.values(this.scenes || {})) sc.stop();
      this.painter?.stop();
      this.flock?.stop();
      this.hourArt = null;
      this.el?.classList.remove('on');
      return;
    }
    if (!this.state.closing) this.state.closing = (performance.now() - this.state.t0) / 1000;
  },

  /* The actors: one creature, or a flock of them. */
  cast(kindName, kind) {
    const base = kind.base || kindName;
    const n = kind.motion === 'flock' ? kind.count : 1;
    const out = [];
    for (let i = 0; i < n; i += 1) {
      const g = document.createElementNS(NS, 'g');
      g.innerHTML = `<g class="hs-a">${sprite(base)}</g>`;
      const parts = {};
      for (const cls of ['leg-a', 'leg-b', 'head', 'tail', 'wing-n', 'wing-f', 'wing-l', 'wing-r', 'lid', 'sac', 'bob', 'fold']) {
        parts[cls] = [...g.querySelectorAll(`.${cls}`)];
      }
      const layer = kind.motion === 'walk' || kind.motion === 'hop' ? '.hs-back' : '.hs-front';
      this.svg.querySelector(layer).appendChild(g);
      out.push({ g, inner: g.firstElementChild, parts, i, base, x: -999, y: -999, s: 1, dir: 1, front: false });
    }
    return out;
  },

  frame() {
    const st = this.state;
    if (!st) return;
    const t = (performance.now() - st.t0) / 1000;
    // As long as the sound plays, and a little after.
    const a = st.audio;
    const sounding = !!a && !a.paused && !a.ended;
    if (sounding) st.keep = Math.max(st.keep, t + AFTER_S);
    // Each time as long as chosen, or as long as the first took with the
    // sound; never ended while the sound still plays.
    if (st.roundLen == null) {
      if (st.secs) st.roundLen = st.secs;
      else if (!sounding && t >= st.keep) st.roundLen = st.keep;
    }
    const all = st.roundLen == null ? st.keep : Math.max(st.keep, st.roundLen * st.times);
    const end = Math.min(st.times * (st.secs || MAX_S), st.closing ?? all);
    // Once more: the plain skins make the hour again.
    if (st.plain && st.roundLen && st.round < st.times && t >= st.roundAt + st.roundLen && t < end - 2) {
      st.round += 1;
      st.roundAt = t;
      this.hourArt?.again?.();
    }
    if (t >= end + 0.8) { this.stop(true); return; }
    this.el.style.opacity = String(clamp(Math.min(t / 0.6, (end + 0.8 - t) / 0.8), 0, 1));
    if (st.plain) {
      if (st.words) this.tickTime();
      this.hourArt?.frame();
      return;
    }
    this.clock(t);
    this.sky(t);
    // A call — the word, the rings of sound — every few seconds for as long
    // as the show lasts, but not as it is fading out.
    const calling = t < end - 2.5;
    if (calling && t - st.lastCall >= CALL_EVERY_S && t > 0.35) {
      st.lastCall = t;
      st.calls += 1;
      st.callAt = t;
    }
    const callNow = st.callAt === t;
    for (const act of st.actors) this.move(act, t, st);
    if (callNow) this.call(st.actors[0], st);
    st.fx = st.fx.filter((f) => {
      const age = t - f.born;
      if (age > f.life) { f.el.remove(); return false; }
      f.tick(age);
      return true;
    });
  },

  /* The clock and the time above it: in, in turn, then running. */
  clock(t) {
    const B = this.bits;
    const d = new Date();
    const sec = d.getSeconds() + d.getMilliseconds() / 1000;
    const min = d.getMinutes() + sec / 60;
    const hr = (d.getHours() % 12) + min / 60;
    // The hands sweep round to the time, from 0.5 s.
    const u = easeBack(clamp((t - 0.5) / 1.8, 0, 1));
    const degs = [hr * 30 - (1 - u) * 120, min * 6 - (1 - u) * 360, sec * 6];
    B.hands.forEach(([hand, shade], i) => {
      const tr = `rotate(${degs[i].toFixed(2)} ${CX} ${CY})`;
      hand?.setAttribute('transform', tr);
      shade?.setAttribute('transform', tr);
    });
    // The clock comes in, and rings at each call: a small swell.
    const st = this.state;
    const since = st.callAt != null ? t - st.callAt : 9;
    const ring = Math.max(0, 1 - since / 0.5);
    const inU = easeBack(clamp(t / 0.9, 0, 1));
    const s = (0.88 + 0.12 * inU) * (1 + ring * 0.018);
    B.clock?.setAttribute('transform', `translate(${CX} ${CY}) scale(${s.toFixed(4)}) translate(${-CX} ${-CY})`);
    B.clock?.setAttribute('opacity', clamp(t / 0.5, 0, 1).toFixed(3));
    B.halo?.setAttribute('opacity', (0.6 + ring * 0.4 + Math.sin(t * 1.4) * 0.1).toFixed(3));
    B.glass?.setAttribute('opacity', (0.35 + 0.25 * Math.max(0, Math.sin(t * 0.6))).toFixed(3));
    if (t < 2.5) {
      // The indices one after another, round from twelve.
      B.idx.forEach((g) => {
        const i = Number(g.dataset.i);
        const v = clamp((t - 0.25 - i * 0.07) / 0.35, 0, 1);
        const k = easeBack(v);
        g.setAttribute('opacity', v.toFixed(3));
        g.setAttribute('transform', `translate(${CX} ${CY}) scale(${(0.7 + 0.3 * k).toFixed(3)}) translate(${-CX} ${-CY})`);
      });
      // The figures of the time rise one by one; the date after them.
      B.chars.forEach((g) => {
        const i = Number(g.dataset.i);
        const v = clamp((t - 0.3 - i * 0.08) / 0.55, 0, 1);
        g.setAttribute('opacity', v.toFixed(3));
        g.setAttribute('transform', `translate(0 ${((1 - ease(v)) * 34).toFixed(1)})`);
      });
      B.date?.setAttribute('opacity', clamp((t - 0.9) / 0.6, 0, 1).toFixed(3));
    }
  },

  /* The living landscape: clouds drift, stars twinkle, the lake glints,
     flowers and grass sway, the sun's rays turn, fireflies wander. */
  sky(t) {
    const B = this.bits;
    for (const c of B.clouds) {
      const s = Number(c.dataset.s);
      const x = ((Number(c.dataset.x) + t * Number(c.dataset.v) + 300) % (W + 600)) - 300;
      c.setAttribute('transform', `translate(${x.toFixed(1)} ${c.dataset.y}) scale(${s})`);
    }
    for (const s of B.stars) {
      const i = Number(s.dataset.i);
      s.setAttribute('opacity', (Number(s.dataset.o) * (0.35 + 0.65 * Math.abs(Math.sin(t * (0.6 + (i % 7) * 0.25) + i)))).toFixed(3));
    }
    for (const r of B.shims) {
      const i = Number(r.dataset.i);
      r.setAttribute('opacity', (0.5 * Math.max(0, Math.sin(t * (0.9 + (i % 5) * 0.3) + i * 1.7))).toFixed(3));
    }
    const sway = [0, 1, 2].map((k) => Math.sin(t * (1.1 + k * 0.25) + k * 2) * 7);
    for (const g of B.sway) {
      g.setAttribute('transform', `translate(${g.dataset.x} ${g.dataset.y}) scale(${g.dataset.s}) skewX(${sway[g.dataset.k].toFixed(2)})`);
    }
    if (B.rays) B.rays.setAttribute('transform', `rotate(${(t * 2).toFixed(2)} ${B.rays.dataset.x} ${B.rays.dataset.y})`);
    for (const f of B.flies) {
      const i = Number(f.dataset.i);
      const x = Number(f.dataset.x) + Math.sin(t * 0.5 + i) * 40 + Math.sin(t * 1.3 + i * 2) * 12;
      const y = Number(f.dataset.y) + Math.cos(t * 0.7 + i * 1.3) * 26;
      f.setAttribute('cx', x.toFixed(1));
      f.setAttribute('cy', y.toFixed(1));
      f.setAttribute('opacity', (0.3 + 0.7 * Math.max(0, Math.sin(t * 1.6 + i * 2.2))).toFixed(3));
    }
  },

  /* ------------------------------------------------------------- motion ---- */
  move(act, t, st) {
    const k = st.kind;
    const calling = st.callAt != null && t - st.callAt < 1.4;
    const P = act.parts;
    const rotate = (els, deg) => els.forEach((e) => e.setAttribute('transform', `rotate(${deg} ${e.dataset.px} ${e.dataset.py})`));
    const flapY = (els, f) => els.forEach((e) => e.setAttribute('transform',
      `translate(0 ${e.dataset.py}) scale(1 ${f}) translate(0 ${-e.dataset.py})`));
    let x;
    let y;
    let s = k.scale;
    let dir = 1;
    let tilt = 0;
    if (k.motion === 'walk' || k.motion === 'hop') {
      // Round the clock, on the meadow: behind it on the far side, smaller,
      // in front on the near side. Walkers stop to call; hoppers jump.
      const speed = k.speed || 0.3;
      st.walkA ??= Math.PI * 0.12;
      st.walkT ??= t;
      const dt = t - st.walkT;
      st.walkT = t;
      let lift = 0;
      if (k.motion === 'walk') {
        if (!calling) st.walkA += dt * speed;
        const step = calling ? 0 : Math.sin(t * 9 * (speed / 0.3));
        rotate(P['leg-a'], step * 22);
        rotate(P['leg-b'], -step * 22);
        P.bob.forEach((b) => b.setAttribute('transform', `translate(0 ${calling ? 0 : Math.abs(step) * -3})`));
        rotate(P.head, calling ? -18 + Math.sin(t * 20) * 4 : Math.sin(t * 4.5) * 4);
        rotate(P.tail, Math.sin(t * 6) * 14);
      } else {
        // The frog: a hop of 0.6 s, a rest of 0.7 s — and it sits still
        // while it croaks, so its word points at it.
        const cyc = 1.3;
        st.hopT = (st.hopT ?? 0) + (calling && ((st.hopT % cyc) / cyc) >= 0.46 ? 0 : dt);
        const ph = (st.hopT % cyc) / cyc;
        const air = ph < 0.46;
        const u = air ? ph / 0.46 : 0;
        if (air) st.walkA += dt * 0.9;
        lift = air ? Math.sin(u * Math.PI) * 90 : 0;
        const sq = air ? 1 : 1 - Math.max(0, 0.1 - (ph - 0.46)) * 1.2;
        P.bob.forEach((b) => b.setAttribute('transform', `translate(0 0) scale(${air ? 0.9 : 1.04} ${air ? 1.14 : sq})`));
        const sac = !air && calling ? 0.6 + Math.abs(Math.sin(t * 12)) * 0.9 : 0.25;
        P.sac.forEach((e) => e.setAttribute('transform', `translate(${e.dataset.px} ${e.dataset.py}) scale(${sac}) translate(${-e.dataset.px} ${-e.dataset.py})`));
        tilt = air ? (u - 0.5) * -24 : 0;
      }
      const A = st.walkA;
      const depth = Math.sin(A);              // -1 behind .. +1 in front
      x = ORBIT.cx + Math.cos(A) * ORBIT.rx;
      y = ORBIT.cy + depth * ORBIT.ry - lift * (0.8 + 0.2 * depth);
      s = k.scale * (0.78 + 0.22 * depth);
      dir = -Math.sin(A) >= 0 ? 1 : -1;       // d(x)/dA = -sin A
      const front = depth > 0;
      if (front !== act.front) {
        act.front = front;
        this.svg.querySelector(front ? '.hs-front' : '.hs-back').appendChild(act.g);
      }
    } else if (k.motion === 'fly') {
      // Passes over the screen, each the other way and at another height,
      // swooping as it goes.
      const pass = 7.5;
      const n = Math.floor(t / pass);
      const u = (t % pass) / pass;
      dir = n % 2 === 0 ? 1 : -1;
      const y0 = [210, 300, 160, 260][n % 4];
      x = dir > 0 ? -220 + u * (W + 440) : W + 220 - u * (W + 440);
      y = y0 + Math.sin(u * Math.PI * 2) * 90;
      tilt = Math.cos(u * Math.PI * 2) * -14;
      const f = Math.cos(t * (k.scale > 1 ? 7 : 11));
      flapY(P['wing-n'], f);
      flapY(P['wing-f'], f * 0.9);
    } else if (k.motion === 'flock') {
      // A V, high and slow — far off, as the recording is.
      const pass = 11;
      const n = Math.floor(t / pass);
      const u = (t % pass) / pass;
      dir = n % 2 === 0 ? 1 : -1;
      const row = act.i === 0 ? 0 : Math.ceil(act.i / 2);
      const side = act.i % 2 === 0 ? 1 : -1;
      const lead = dir > 0 ? -300 + u * (W + 700) : W + 300 - u * (W + 700);
      x = lead - dir * row * 70;
      y = 150 + row * 34 * side + Math.sin(t * 1.3 + act.i) * 6 + (n % 2) * 60;
      const f = Math.cos(t * 6 + act.i * 0.9);
      flapY(P['wing-n'], f);
      flapY(P['wing-f'], f * 0.9);
    } else {
      // The owl: in from the top corner, onto the clock's rim at half past
      // one, and away again.
      const end = Math.min(MAX_S, st.closing ?? st.keep);
      const perchX = CX + (R + 28) * Math.SQRT1_2;
      const perchY = CY - (R + 28) * Math.SQRT1_2 - 22;
      const inU = ease(clamp(t / 2.4, 0, 1));
      const outU = clamp((t - (end - 2.2)) / 2.2, 0, 1);
      x = W + 160 + (perchX - W - 160) * inU + (-200 - perchX) * outU * outU;
      y = -120 + (perchY + 120) * inU - 400 * outU * outU;
      const flying = inU < 1 || outU > 0;
      const f = flying ? Math.sin(t * 13) * 26 : 0;
      P['wing-l'].forEach((e) => e.setAttribute('transform', `rotate(${f} ${e.dataset.px} ${e.dataset.py})`));
      P['wing-r'].forEach((e) => e.setAttribute('transform', `rotate(${-f} ${e.dataset.px} ${e.dataset.py})`));
      [...P['wing-l'], ...P['wing-r']].forEach((e) => e.setAttribute('opacity', flying ? '1' : '0'));
      P.fold.forEach((e) => e.setAttribute('opacity', flying ? '0' : '1'));
      // Blinks, and turns its head the way owls do.
      const blink = (t % 3.4) < 0.18 ? 1 : 0;
      P.lid.forEach((e) => e.setAttribute('transform', `translate(0 ${e.dataset.py}) scale(1 ${blink}) translate(0 ${-e.dataset.py})`));
      rotate(P.head, flying ? 0 : (calling ? Math.sin(t * 14) * 6 : Math.sin(t * 0.9) * 14));
      P.bob.forEach((b) => b.setAttribute('transform', `translate(0 ${calling ? -Math.abs(Math.sin(t * 10)) * 6 : 0})`));
    }
    act.x = x; act.y = y; act.s = s; act.dir = dir;
    act.inner.setAttribute('transform', `translate(${x} ${y}) rotate(${tilt}) scale(${s * dir} ${s})`);
  },

  /* ------------------------------------------------------------- sound ---- */
  call(act, st) {
    const k = st.kind;
    const [mx, my] = MOUTH[act.base] || [60, -60];
    const x = act.x + mx * act.s * act.dir;
    const y = act.y + my * act.s;
    if (x < -60 || x > W + 60) return;      // off screen: nobody to hear
    const t = (performance.now() - st.t0) / 1000;
    this.pulse(t);
    this.rings(x, y, act.dir, k.color, t);
    if (k.notes) this.notes(x, y, k.color, t);
    this.word(x, y, act.dir, k, t);
  },

  add(el, life, tick, t) {
    this.svg.querySelector('.hs-fx').appendChild(el);
    this.state.fx.push({ el, born: t, life, tick });
  },

  /* The clock rings out: two golden circles spread from its rim. */
  pulse(t) {
    for (let i = 0; i < 2; i += 1) {
      const c = document.createElementNS(NS, 'circle');
      c.setAttribute('cx', CX);
      c.setAttribute('cy', CY);
      c.setAttribute('fill', 'none');
      c.setAttribute('stroke', '#f6d58a');
      this.add(c, 1.6, (age) => {
        const u = clamp((age - i * 0.3) / 1.2, 0, 1);
        c.setAttribute('r', (R + 34 + ease(u) * 150).toFixed(1));
        c.setAttribute('stroke-width', (6 * (1 - u) + 0.5).toFixed(2));
        c.setAttribute('opacity', u <= 0 ? '0' : ((1 - u) * 0.8).toFixed(3));
      }, t);
    }
  },

  rings(x, y, dir, color, t) {
    for (let i = 0; i < 3; i += 1) {
      const g = document.createElementNS(NS, 'path');
      g.setAttribute('fill', 'none');
      g.setAttribute('stroke', color);
      g.setAttribute('stroke-width', '7');
      g.setAttribute('stroke-linecap', 'round');
      this.add(g, 1.1 + i * 0.15, (age) => {
        const u = clamp((age - i * 0.15) / 0.95, 0, 1);
        const r = 18 + u * 70;
        const a = 0.75;
        const sx = x + dir * 10;
        g.setAttribute('d', `M${sx + dir * Math.cos(a) * r},${y - Math.sin(a) * r} A${r},${r} 0 0 ${dir > 0 ? 1 : 0} ${sx + dir * Math.cos(a) * r},${y + Math.sin(a) * r}`);
        g.setAttribute('opacity', String(u <= 0 ? 0 : (1 - u) * 0.9));
      }, t);
    }
  },

  notes(x, y, color, t) {
    for (let i = 0; i < 4; i += 1) {
      const n = document.createElementNS(NS, 'text');
      n.textContent = i % 2 ? '♫' : '♪';
      n.setAttribute('font-size', '46');
      n.setAttribute('fill', color);
      n.setAttribute('text-anchor', 'middle');
      this.add(n, 2.2, (age) => {
        const u = clamp((age - i * 0.25) / 1.9, 0, 1);
        n.setAttribute('x', String(x + Math.sin(u * 7 + i) * 26 + (i - 1.5) * 28));
        n.setAttribute('y', String(y - 20 - u * 170));
        n.setAttribute('opacity', String(u <= 0 ? 0 : Math.min(1, (1 - u) * 2)));
      }, t);
    }
  },

  /* The word, in a comic bubble that points at the mouth. */
  word(x, y, dir, k, t) {
    const text = k.word;
    const fs = text.length > 14 ? 42 : 54;
    const w = Math.max(180, text.length * fs * 0.62 + 60);
    const h = fs + 44;
    let bx = x + dir * (w / 2 + 40);
    let by = y - h / 2 - 70;
    bx = clamp(bx, w / 2 + 20, W - w / 2 - 20);
    by = clamp(by, h / 2 + 20, H - h / 2 - 20);
    // Never over the time and the date: off to the side of them.
    if (by - h / 2 < HEAD_Y + 50 && Math.abs(bx - CX) < w / 2 + 250) {
      bx = clamp(x < CX ? CX - 250 - w / 2 : CX + 250 + w / 2, w / 2 + 20, W - w / 2 - 20);
    }
    const g = document.createElementNS(NS, 'g');
    const tx = clamp(x, bx - w / 2 + 30, bx + w / 2 - 30);
    g.innerHTML = `<path d="M${tx - 22},${by + h / 2 - 6} L${x},${y - 14} L${tx + 22},${by + h / 2 - 6} Z" fill="#fff" stroke="#222" stroke-width="5" stroke-linejoin="round"/>
      <rect x="${bx - w / 2}" y="${by - h / 2}" width="${w}" height="${h}" rx="${h / 2}" fill="#fff" stroke="#222" stroke-width="5"/>
      <path d="M${tx - 18},${by + h / 2 - 2} L${x},${y - 14} L${tx + 18},${by + h / 2 - 2}" fill="#fff"/>
      <text x="${bx}" y="${by + 2}" text-anchor="middle" dominant-baseline="central" font-size="${fs}" font-weight="900"
        fill="${k.color}" stroke="#222" stroke-width="1.5" letter-spacing="1">${text.replace(/&/g, '&amp;').replace(/</g, '&lt;')}</text>`;
    this.add(g, 2.3, (age) => {
      const pop = age < 0.35 ? easeBack(age / 0.35) : 1;
      const out = age > 1.8 ? (age - 1.8) / 0.5 : 0;
      const wob = Math.sin(age * 18) * Math.max(0, 0.6 - age) * 4;
      g.setAttribute('transform', `translate(${bx} ${by - out * 30}) rotate(${wob}) scale(${pop}) translate(${-bx} ${-by})`);
      g.setAttribute('opacity', String(1 - out));
    }, t);
  },
};
