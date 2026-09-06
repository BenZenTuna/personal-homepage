// The house index: one link out of the dashboard to everything else on the
// network — Home Assistant, the NAS, Pi-hole, the cameras, the AI tools.
//
// It used to be the last thing inside the House panel, under the light tiles,
// and it was taking a strip of the widest panel on the wall to say one line.
// As its own panel it sits in the bottom-right corner instead, under the
// countdown, and the room it gives back goes to the two things that wanted it:
// the lights get their full height, the countdown gets the column.
//
// A link, never a frame. Framed, the index brought its own header, search box
// and scrollbar into a panel that is meant to be lights.

export default {
  id: 'services',
  title: 'Home',

  init(body, ctx) {
    this.body = body;
    const svc = ctx.config.services || {};
    const url = svc.url || '';

    if (!url) {
      body.innerHTML = '<div class="placeholder">No house index configured '
        + '(services.url in settings.json)</div>';
      return;
    }

    // Tinted with the house hue and marked with a door, because it is both a
    // part of this corner of the wall and the way out of it: as a grey strip
    // it read as a footer nobody had to look at.
    //
    // svc.display is the demo's one addition: the real panel prints the url,
    // which here would be the local file standing in for the house index.
    body.innerHTML = `
      <a class="ha-svc" href="${this.esc(url)}" target="_blank" rel="noreferrer">
        <span class="ha-svc-mark">⌂</span>
        <span class="ha-svc-txt">
          <span class="ha-svc-name">${this.esc(svc.label || 'Home')}</span>
          <span class="ha-svc-desc">Every service on the house network —
            automation, storage, cameras, the lot</span>
        </span>
        <span class="ha-svc-url">${this.esc((svc.display || url).replace(/\/$/, ''))}</span>
        <span class="ha-svc-go">Open ↗</span>
      </a>`;
  },

  esc(s) {
    return String(s ?? '').replace(/[&<>"']/g,
      (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  },
};
