/* The card that says what this is, and the chip in the header that brings it
   back. Nothing here touches the dashboard: it only shows and hides one
   element the dashboard does not know about.
 *
 * It opens by itself once. A visitor who has already read it and come back to
 * poke at the lights does not need it again, so "seen" is remembered next to
 * the demo's own state — and Reset, which throws that state away, brings the
 * card back too. */
(function () {
  'use strict';

  const SEEN = 'kitchen-demo-seen';
  const intro = document.getElementById('demo-intro');
  const pill = document.getElementById('demo-pill');
  if (!intro || !pill) return;

  /* The card sits over a page that scales itself, and inside that scaled box
     percentages and viewport units are measured in the scaled space rather
     than in pixels anybody can see. The body's own box is the one thing that
     is reliably the visible viewport, so it is what the card is sized against.
     See the note beside .demo-card in demo.css. */
  const measure = () => {
    const r = document.body.getBoundingClientRect();
    intro.style.setProperty('--demo-vw', `${Math.round(r.width)}px`);
    intro.style.setProperty('--demo-vh', `${Math.round(r.height)}px`);
  };
  addEventListener('resize', measure);

  const open = () => { measure(); intro.hidden = false; };
  const close = () => {
    intro.hidden = true;
    try { localStorage.setItem(SEEN, '1'); } catch { /* private window: it opens again */ }
  };

  pill.onclick = open;
  document.getElementById('demo-go').onclick = close;
  document.getElementById('demo-reset').onclick = () => {
    try { localStorage.removeItem(SEEN); } catch { /* nothing to remove */ }
    window.DEMO_RESET();
  };
  // Escape closes it, because a keyboard is exactly what the wall has not got
  // and a browser very much has.
  addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !intro.hidden) close();
  });
  // The scrim, but never the card itself.
  intro.addEventListener('click', (e) => { if (e.target === intro) close(); });

  let seen = false;
  try { seen = localStorage.getItem(SEEN) === '1'; } catch { /* treat as unseen */ }
  if (!seen) open();
})();
