// Shared server-sent-events bus, and the one way this page's modules reload it.
//
// EventSource reconnects on its own after a dropped connection, and the
// snapshot event on (re)connect replays current state so panels are always
// consistent after any outage. Not after every outage, though: a reconnect
// that is answered with anything but a 200 closes the stream for good, and
// the browser never tries again (the HTML spec; Chromium does exactly that).
// Since the wall screen reaches the kitchen through the proxy in front of it,
// a kitchen that is restarting is answered by the proxy's 502, not by a
// refused connection, so the stream is made again here, and a page that has
// been Offline for two minutes is reloaded once the server is back.
//
// Every reload goes through reloadWhenReachable(), never location.reload() on
// its own. A kitchen that is away is the proxy's own page, with none of this
// code on it: a reload made into a restart left the wall with no clock, no
// timers, no doorbell and no fire banner until somebody reloaded it by hand —
// 6 h 10 min on 2026-10-19, 12 and 47 min on 2026-10-21, each time because a
// deploy's new build arrived on the old server's last heartbeat.
const RETRY_FIRST_MS = 5_000;     // a stream closed for good is made again after this,
const RETRY_MAX_MS = 60_000;      // twice as long each time it fails, up to a minute
const OFFLINE_MS = 120_000;       // Offline this long: reload, once the server answers
const BUSY_EVERY_MS = 5_000;      // a new build waits while somebody is in the middle of something,
const BUSY_MAX_MS = 600_000;      // but never longer than ten minutes

// reloadWhenReachable's questions, and the Wi-Fi teardown after a resume
// behind them (see wake.js). Whoever asks may be a timer that was due while
// the wall screen slept and ran the instant it thawed, so every reload
// settles first: the teardown and reconnect are over by +4.5 s (the worst of
// 29 resumes measured), and asking the server any earlier proves nothing —
// the old association still carries traffic for a moment, which is exactly
// how the three dead pages of 2026-09-18 got their 200.
const SETTLE_MS = 8_000;
const ASK_EVERY_MS = 2_000;
const ASK_TIMEOUT_MS = 3_000;     // a socket from before a suspend may just hang
// After five minutes, every half minute, for as long as it takes. It never
// reloads anyway: a kitchen that is away is the proxy's page, which runs none
// of this code, while this page goes on asking and comes back by itself.
const PATIENT_MS = 300_000;
const ASK_SLOWLY_MS = 30_000;
// Longer than any wait in the loop below can last: only a suspend makes it.
const SLEPT_MS = 90_000;

const pause = (ms) => new Promise((r) => setTimeout(r, ms));

/* Only the kitchen says {"ok": true}. The proxy's page for a kitchen that is
   away is HTML — a 502, or a 200 if the proxy is ever told to say it that way —
   so the body counts, not just the status. */
async function serverAnswers() {
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), ASK_TIMEOUT_MS);
  try {
    const r = await fetch('/api/health', { cache: 'no-store', signal: abort.signal });
    return r.ok && (await r.json())?.ok === true;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

async function untilReachable() {
  let mark = Date.now();
  await pause(SETTLE_MS);
  const since = Date.now();
  for (let good = 0; ;) {
    const ok = navigator.onLine && await serverAnswers();
    // A gap only a suspend makes, since the last question: what answered may
    // have come over the association that is about to be torn down.
    const slept = Date.now() - mark > SLEPT_MS;
    good = ok && !slept ? good + 1 : 0;
    if (good === 2) return;
    mark = Date.now();
    // A first good answer is asked again in two seconds, even after hours.
    const patient = good || Date.now() - since < PATIENT_MS;
    await pause(slept ? SETTLE_MS : patient ? ASK_EVERY_MS : ASK_SLOWLY_MS);
  }
}

/* Reload this page once the server has answered twice in a row, and not
   before. Everybody who asks (a new build, a long Offline, wake.js after a
   suspend, a start that failed) shares the one wait. */
let reloading = null;
export function reloadWhenReachable() {
  return (reloading ||= untilReachable().then(() => location.reload()));
}

/* `busy`: somebody is in the middle of something (app.js: a sheet open, a
   note being written or spoken). A reload waits for it to end. */
export function createBus(onStatus, { busy = () => false } = {}) {
  const subs = {};

  function dispatch(type, value, raw) {
    (subs[type] || []).forEach((fn) => fn(value, raw));
  }

  let build = null;
  let asked = false;
  let retryMs = RETRY_FIRST_MS;
  let offline = null;

  // Not from under whoever is using the screen, for ten minutes at most; the
  // page goes on hearing every event while it waits.
  function reloadSoon() {
    if (asked) return;
    asked = true;
    const until = Date.now() + BUSY_MAX_MS;
    const held = () => { try { return !!busy(); } catch { return false; } };
    (function wait() {
      if (held() && Date.now() < until) setTimeout(wait, BUSY_EVERY_MS);
      else reloadWhenReachable();
    })();
  }

  function status(ok) {
    if (ok) {
      retryMs = RETRY_FIRST_MS;
      clearTimeout(offline);
      offline = null;
    } else if (!offline) {
      offline = setTimeout(reloadSoon, OFFLINE_MS);
    }
    onStatus(ok);
  }

  function receive(e) {
    let ev;
    try { ev = JSON.parse(e.data); } catch { return; }

    // The wall screen has no keyboard: reload itself when new code is deployed.
    if (ev.build) {
      if (build && ev.build !== build) reloadSoon();
      build = ev.build;
    }

    if (ev.type === 'snapshot') {
      for (const [k, v] of Object.entries(ev.value)) dispatch(k, v);
    } else if (ev.type !== 'heartbeat') {
      dispatch(ev.type, ev.value, ev);
    }
  }

  function connect() {
    const es = new EventSource('/api/events');
    es.onopen = () => status(true);
    es.onerror = () => {
      status(false);
      // CONNECTING: the browser is trying again by itself. CLOSED: it has
      // given up on this one (a reconnect the proxy answered 502), so a new
      // one, a while later and longer each time it fails.
      if (es.readyState !== EventSource.CLOSED) return;
      setTimeout(connect, retryMs);
      retryMs = Math.min(retryMs * 2, RETRY_MAX_MS);
    };
    es.onmessage = receive;
  }
  connect();

  return {
    on(type, fn) { (subs[type] ||= []).push(fn); },
  };
}
