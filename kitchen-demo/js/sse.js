// Shared server-sent-events bus. EventSource reconnects on its own; the
// snapshot event on (re)connect replays current state so panels are always
// consistent after any outage.
export function createBus(onStatus) {
  const subs = {};

  function dispatch(type, value, raw) {
    (subs[type] || []).forEach((fn) => fn(value, raw));
  }

  let build = null;

  const es = new EventSource('/api/events');
  es.onopen = () => onStatus(true);
  es.onerror = () => onStatus(false);
  es.onmessage = (e) => {
    let ev;
    try { ev = JSON.parse(e.data); } catch { return; }

    // The wall screen has no keyboard: reload itself when new code is deployed.
    if (ev.build) {
      if (build && ev.build !== build) return location.reload();
      build = ev.build;
    }

    if (ev.type === 'snapshot') {
      for (const [k, v] of Object.entries(ev.value)) dispatch(k, v);
    } else if (ev.type !== 'heartbeat') {
      dispatch(ev.type, ev.value, ev);
    }
  };

  return {
    on(type, fn) { (subs[type] ||= []).push(fn); },
  };
}
