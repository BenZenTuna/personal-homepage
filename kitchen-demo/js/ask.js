/* Ask the kitchen — the 🎤 beside ⛶ in the header (backend/app/ask.py).

   Alex, 2026-11-05 (A7, "🎤 button only"): tap, say it, hear the answer.
   Nothing listens until the button is tapped. The recording stops by itself
   after a pause once something was said (or at ■, or after MAX_S), AI
   writes it down, the house's own model answers — looking things up or acting
   with the kitchen's tools — and AI's voice reads the answer here. On a
   phone too: the answer plays where it was asked. */

const esc = (s) => String(s ?? '').replace(/[&<>"]/g,
  (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

const TYPES = ['audio/webm;codecs=opus', 'audio/ogg;codecs=opus', 'audio/webm', 'audio/mp4'];
const MAX_S = 20;
const SPEECH = 0.025;      // rms counted as speaking
const QUIET = 0.012;       // ...and as quiet again
const PAUSE_MS = 1400;     // this long quiet after speaking: done

export default {
  init(ctx) {
    this.ctx = ctx;
    this.build();
    const btn = document.getElementById('ask-btn');
    if (btn) btn.onclick = () => this.open();
  },

  build() {
    const el = document.createElement('div');
    el.id = 'ask-sheet';
    el.setAttribute('role', 'dialog');
    el.setAttribute('aria-label', 'Ask the kitchen');
    el.innerHTML = `<div class="ask-box">
        <div class="ask-head"><span class="ask-mic" aria-hidden="true">🎤</span>
          <h2>Ask the kitchen</h2><button class="ls-btn ask-close">Close</button></div>
        <div class="ask-level"><i></i></div>
        <p class="ask-state"></p>
        <p class="ask-heard" hidden></p>
        <p class="ask-answer" hidden></p>
        <ul class="ask-did" hidden></ul>
        <div class="ask-acts">
          <button class="ls-btn sheet-primary ask-stop" hidden>■ Done</button>
          <button class="ls-btn sheet-primary ask-again" hidden>🎤 Ask again</button>
        </div>
        <p class="sheet-note ask-hint">For example: “What is needed for school tomorrow?” · “Set a timer for
          twelve minutes” · “Turn off the Salon” · “Put milk on the shopping list” · in English, Swedish or Turkish.</p>
      </div>`;
    el.querySelector('.ask-close').onclick = () => this.close();
    el.querySelector('.ask-stop').onclick = () => this.stop();
    el.querySelector('.ask-again').onclick = () => this.listen();
    document.body.appendChild(el);
    this.el = el;
  },

  isOpen() { return this.el.classList.contains('open'); },

  open() {
    document.body.appendChild(this.el);      // over whatever is open
    this.el.classList.add('open');
    this.listen();
  },

  close() {
    this.stop(true);
    this.audio?.pause();
    this.el.classList.remove('open');
  },

  show({ state = '', heard = null, answer = null, did = null, listening = false, again = false } = {}) {
    const q = (s) => this.el.querySelector(s);
    q('.ask-state').textContent = state;
    q('.ask-state').hidden = !state;
    if (heard !== null) { q('.ask-heard').textContent = heard ? `“${heard}”` : ''; q('.ask-heard').hidden = !heard; }
    if (answer !== null) { q('.ask-answer').textContent = answer; q('.ask-answer').hidden = !answer; }
    if (did !== null) {
      q('.ask-did').innerHTML = (did || []).map((d) => `<li>${esc(d)}</li>`).join('');
      q('.ask-did').hidden = !(did || []).length;
    }
    q('.ask-stop').hidden = !listening;
    q('.ask-again').hidden = !again;
    q('.ask-level').hidden = !listening;
    this.el.classList.toggle('listening', listening);
  },

  async listen() {
    if (this.rec || this.busy) return;
    this.audio?.pause();
    this.show({ state: 'Starting the microphone…', heard: '', answer: '', did: [] });
    if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) {
      this.show({ state: window.isSecureContext ? 'This browser cannot record.'
        : 'The microphone needs https: open https://kitchen.example', again: false });
      return;
    }
    let stream;
    const id = this.ctx.notes?.savedMic?.() || '';
    const want = (d) => ({ audio: { ...(d ? { deviceId: { exact: d } } : {}), echoCancellation: true,
      noiseSuppression: true, autoGainControl: true } });
    try {
      stream = await navigator.mediaDevices.getUserMedia(want(id));
    } catch (e) {
      try { stream = id ? await navigator.mediaDevices.getUserMedia(want('')) : null; } catch { stream = null; }
      if (!stream) {
        this.show({ state: e.name === 'NotAllowedError' ? 'The microphone was not allowed on this page.'
          : `The microphone could not start (${e.name || e.message}).`, again: true });
        return;
      }
    }
    const type = TYPES.find((t) => MediaRecorder.isTypeSupported?.(t)) || '';
    const recorder = new MediaRecorder(stream, type ? { mimeType: type, audioBitsPerSecond: 32000 } : undefined);
    const rec = { stream, recorder, chunks: [], spoke: false, quietAt: 0, t0: Date.now() };
    this.rec = rec;
    recorder.ondataavailable = (e) => { if (e.data?.size) rec.chunks.push(e.data); };
    recorder.onstop = () => this.finish(rec);
    recorder.start(250);
    this.show({ state: 'Listening — say it, then pause.', listening: true });
    try {
      rec.ac = new AudioContext();
      const an = rec.ac.createAnalyser();
      an.fftSize = 1024;
      rec.ac.createMediaStreamSource(stream).connect(an);
      const buf = new Float32Array(an.fftSize);
      const bar = this.el.querySelector('.ask-level i');
      const tick = () => {
        if (this.rec !== rec) return;
        an.getFloatTimeDomainData(buf);
        let sum = 0;
        for (const v of buf) sum += v * v;
        const rms = Math.sqrt(sum / buf.length);
        bar.style.width = `${Math.min(100, rms * 400).toFixed(0)}%`;
        const now = Date.now();
        if (rms > SPEECH) { rec.spoke = true; rec.quietAt = 0; } else if (rms < QUIET && rec.spoke && !rec.quietAt) rec.quietAt = now;
        if ((rec.spoke && rec.quietAt && now - rec.quietAt > PAUSE_MS) || now - rec.t0 > MAX_S * 1000) {
          this.stop();
          return;
        }
        rec.raf = requestAnimationFrame(tick);
      };
      tick();
    } catch { rec.spoke = true; /* no meter: ■ or the time limit ends it */ }
  },

  stop(drop = false) {
    const rec = this.rec;
    if (!rec) return;
    this.rec = null;
    rec.dropped = drop;
    cancelAnimationFrame(rec.raf);
    try { if (rec.recorder.state !== 'inactive') rec.recorder.stop(); else this.finish(rec); } catch { this.finish(rec); }
    rec.stream.getTracks().forEach((t) => t.stop());
    rec.ac?.close().catch(() => {});
  },

  async finish(rec) {
    if (rec.done || rec.dropped) return;
    rec.done = true;
    if (!rec.spoke) { this.show({ state: 'Nothing was heard.', again: true }); return; }
    this.busy = true;
    const blob = new Blob(rec.chunks, { type: rec.recorder.mimeType || 'audio/webm' });
    try {
      this.show({ state: 'Writing it down…' });
      const h = await fetch('/api/ask/hear', {
        method: 'POST', headers: { 'Content-Type': (blob.type || 'audio/webm').split(';')[0] }, body: blob,
      });
      const heard = await h.json().catch(() => ({}));
      if (!h.ok || !heard.text) {
        this.show({ state: heard.error || 'No words were heard — try again, closer.', again: true });
        return;
      }
      this.show({ state: 'Thinking…', heard: heard.text });
      const a = await fetch('/api/ask/answer', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: heard.text, language: heard.language, device: this.ctx.phone ? 'phone' : 'screen' }),
      });
      const ans = await a.json().catch(() => ({}));
      if (!a.ok) { this.show({ state: ans.error || 'No answer came.', again: true }); return; }
      this.show({ state: '', answer: ans.answer, did: ans.did || [], again: true });
      if (ans.audio && this.isOpen()) {
        this.audio = new Audio(ans.audio);
        this.audio.play().catch(() => {});
      }
    } catch {
      this.show({ state: 'The kitchen server did not answer.', again: true });
    } finally {
      this.busy = false;
    }
  },
};
