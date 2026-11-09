// Coming back from sleep, and saying "somebody is here".
//
// the wall suspends when the Hue sensor has seen nothing in the kitchen for
// fifteen minutes, and wakes on the next movement. Two things follow from that
// and neither is the browser's default behaviour.
//
// 1. The page has been frozen, not reloaded. Its EventSource is attached to a
//    TCP connection the server gave up on hours ago, and nothing sent a FIN, so
//    the browser can sit on a dead stream for minutes before it notices: a wall
//    showing a photograph from last night with a green "Live" dot. The camera's
//    WebRTC session is dead for the same reason, and the slideshow's history
//    points at files from a photograph batch that has since been replaced. One
//    reload fixes all three, and it costs about a second on a screen that
//    already reloads itself after every deploy.
//
//    A suspend is detected as a jump in the wall clock: this ticker runs every
//    five seconds and can only see a ninety-second gap if the machine was not
//    running. A background tab is throttled but never that far, and the guard
//    on document.hidden means a tab nobody is looking at is left alone anyway.
//
//    The reload waits for the network, and that wait is not optional. The
//    ticker fires the instant the machine thaws, and a tenth of a second later
//    NetworkManager tears the Wi-Fi down for two to four seconds to
//    re-associate and fetch a new lease. A reload made in that gap got the
//    page itself out and then lost every stylesheet and module, so no code ran
//    that could ever retry: the wall sat on a dead page until somebody reloaded
//    it by hand — three times in four days, 6.7 of 67 awake hours (found
//    2026-09-18 by matching the server's log to the wall' journal). So: let the
//    Wi-Fi go and come back, then reload once the server has answered twice.
//    index.html carries a second net for whatever still gets through.
//
//    That wait is sse.js's reloadWhenReachable(), which every reload of this
//    page goes through since 2026-10-21. It no longer reloads anyway after
//    five minutes "because Chrome's error page retries itself": that was true
//    at 192.0.2.10:8200, but the wall opens kitchen.home through the workstation's
//    nginx, whose page for a kitchen that is away holds none of this code and
//    never tries again.
//
// 2. A PIR sensor sees movement, not people. Standing at the counter reading a
//    recipe off the wall is exactly what it misses, so every touch tells the
//    server somebody is there; the server holds the screen awake for five
//    minutes afterwards and cancels a sleep that was already on its way.
const JUMP_MS = 90_000;
const TICK_MS = 5_000;
const TOUCH_EVERY_MS = 60_000;

// With the page's build stamp, as app.js imports it: one copy of sse.js, so a
// reload that is already waiting is shared.
const { reloadWhenReachable } = await import(`./sse.js${new URL(import.meta.url).search}`);

export default {
  // `touch: false` is a phone: its reload after a sleep is as useful as the
  // wall's, but its taps are not somebody in the kitchen.
  init({ touch = true } = {}) {
    let last = Date.now();
    let returning = false;
    setInterval(() => {
      const now = Date.now();
      const jumped = now - last > JUMP_MS;
      last = now;
      if (jumped && !document.hidden && !returning) {
        returning = true;
        reloadWhenReachable();
      }
    }, TICK_MS);

    if (!touch) return;
    let sent = 0;
    const bump = () => {
      const now = Date.now();
      if (now - sent < TOUCH_EVERY_MS) return;
      sent = now;
      fetch('/api/wall/touch', { method: 'POST' }).catch(() => {});
    };
    // Capturing and passive: it must see the gesture before any panel has had
    // it, and it must never take part in it. Pointer capture here would steal
    // swipes from the Cooking carousel exactly the way food.js warns about.
    document.addEventListener('pointerdown', bump, { capture: true, passive: true });
  },
};
