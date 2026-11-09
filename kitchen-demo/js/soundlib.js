/* The household's own sounds, one library per sound system (soundlib.py).

   Every sheet that chooses a sound — Babo Alarm and the Hue switches, the
   alerts, the doorbell, the clock, the school alert, the timers, the bird
   box, the phone box — lists its built-in sounds and then the ones uploaded
   in it, with ＋ Upload and ✕ beside them (2026-10-18, Alex: "upload
   options … to any other sound alert or sound system … so I can add manually
   for each one a new sound"). This holds the `sound_library` document (each
   library's uploads and their files), uploads and deletes, and the buttons.
   It is ctx.soundlib.

   An upload's message — added, or why not — comes up as a toast at the
   bottom of the screen: the sheet it was made in redraws as the library
   changes, so a line in the sheet would be gone before it was read. */

const esc = (s) => String(s ?? '').replace(/[&<>"']/g,
  (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export default {
  lib: {},
  subs: [],

  init(ctx) {
    this.ctx = ctx;
    ctx.bus.on('sound_library', (doc) => {
      if (!doc || typeof doc !== 'object') return;
      this.lib = doc;
      for (const fn of this.subs) {
        try { fn(doc); } catch (e) { console.error('sound library subscriber failed', e); }
      }
    });
  },

  onChange(fn) { this.subs.push(fn); },

  /* One library's uploads: [{id, label, file, uploaded: true}]. */
  list(scope) { return (this.lib[scope] || []).map((x) => ({ ...x, uploaded: true })); },

  find(id) {
    for (const one of Object.values(this.lib)) {
      const x = (one || []).find((y) => y.id === id);
      if (x) return x;
    }
    return null;
  },

  file(id) { return this.find(id)?.file || null; },

  /* The file picker, then the upload: resolves {ok, id, label} or {ok: false,
     error}; never, if the picker is closed with nothing chosen. */
  pick(scope) {
    return new Promise((resolve) => {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = 'audio/*,.mp3,.m4a,.ogg,.wav,.webm,.flac';
      input.onchange = async () => {
        const f = input.files?.[0];
        if (f) resolve(await this.upload(f, scope));
      };
      input.click();
    });
  },

  async upload(file, scope) {
    this.toast(`Uploading ${file.name}…`);
    try {
      const r = await fetch(`/api/sounds?scope=${encodeURIComponent(scope)}&name=${encodeURIComponent(file.name)}`,
        { method: 'PUT', body: file });
      const body = await r.json().catch(() => ({}));
      if (!r.ok) {
        this.toast(`Not added: ${body.error || `the kitchen said ${r.status}`}`);
        return { ok: false, error: body.error };
      }
      // The library's own update is on its way over SSE; this one is here now.
      this.lib = { ...this.lib, [scope]: body.sounds.map(({ id, label, file: f }) => ({ id, label, file: f })) };
      this.toast(`Added "${body.label}".`);
      return { ok: true, id: body.id, label: body.label, file: body.file };
    } catch (e) {
      this.toast(`Not added: ${e.message}`);
      return { ok: false, error: e.message };
    }
  },

  async remove(id) {
    try {
      const r = await fetch(`/api/sounds/${encodeURIComponent(id)}`, { method: 'DELETE' });
      const body = await r.json().catch(() => ({}));
      this.toast(r.ok ? 'Deleted.' : `Not deleted: ${body.error || r.status}`);
    } catch (e) {
      this.toast(`Not deleted: ${e.message}`);
    }
  },

  /* ----------------------------------------------------------- buttons -- */

  /* ＋ Upload, for the sheet `scope` belongs to. `row` (optional) is handed
     back to wire()'s onUploaded, to choose the new sound for one row. */
  uploadBtn(scope, { cls = 'ls-btn', text = '＋ Upload a sound', row = '' } = {}) {
    return `<button class="${cls} sl-up" data-sl-up="${esc(scope)}"${row ? ` data-sl-row="${esc(row)}"` : ''}
      title="a sound file of your own: mp3, m4a, ogg, wav; up to 8 MB">${esc(text)}</button>`;
  },

  /* ✕ for an uploaded sound: two taps, the first asks. A removal, so the
     settings window kit's terracotta (.sheet-danger); in a bar of sounds it
     sits right after the sound it deletes. */
  delBtn(id, { cls = 'ls-btn sheet-danger', label = '' } = {}) {
    return `<button class="${cls} sl-del" data-sl-del="${esc(id)}" aria-label="Delete ${esc(label)}">✕</button>`;
  },

  /* The buttons above, inside `root`. onUploaded({id, label, row}) after an
     upload that worked — to choose it, if the sheet wants that. */
  wire(root, { onUploaded = null } = {}) {
    root.querySelectorAll('[data-sl-up]').forEach((b) => {
      b.onclick = async (e) => {
        e.stopPropagation();
        const res = await this.pick(b.dataset.slUp);
        if (res.ok && onUploaded) onUploaded({ ...res, row: b.dataset.slRow || '' });
      };
    });
    root.querySelectorAll('[data-sl-del]').forEach((b) => {
      b.onclick = (e) => {
        e.stopPropagation();
        if (!b.dataset.sure) {
          b.dataset.sure = '1';
          b.textContent = 'Delete?';
          setTimeout(() => { if (b.isConnected) { delete b.dataset.sure; b.textContent = '✕'; } }, 4000);
          return;
        }
        this.remove(b.dataset.slDel);
      };
    });
  },

  toast(text) {
    if (!this.toastEl) {
      this.toastEl = document.createElement('div');
      this.toastEl.id = 'sl-toast';
      this.toastEl.setAttribute('role', 'status');
      document.body.appendChild(this.toastEl);
    }
    this.toastEl.textContent = text;
    this.toastEl.hidden = false;
    clearTimeout(this.toastTimer);
    this.toastTimer = setTimeout(() => { this.toastEl.hidden = true; }, 5000);
  },
};
