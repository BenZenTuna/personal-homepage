// Liquid metal shader bound to TWO gravity wells (left + right).
// Mouse attracts the metal toward whichever side is hovered,
// and per-side focus (u_focusL / u_focusR, 0..1) lets JS tune intensity.

const VERT = `
attribute vec2 a_position;
void main() { gl_Position = vec4(a_position, 0.0, 1.0); }
`;

const FRAG = `
precision highp float;
uniform vec2 u_resolution;
uniform float u_time;
uniform vec2 u_mouse;       // 0..1
uniform vec2 u_mouseSmooth; // 0..1
uniform float u_focusL;     // 0..1 (left side hovered)
uniform float u_focusR;     // 0..1 (right side hovered)
uniform vec2 u_click;
uniform float u_clickTime;

float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float noise(vec2 p) {
  vec2 i = floor(p); vec2 f = fract(p);
  float a = hash(i), b = hash(i + vec2(1.0, 0.0));
  float c = hash(i + vec2(0.0, 1.0)), d = hash(i + vec2(1.0, 1.0));
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(a, b, u.x) + (c - a) * u.y * (1.0 - u.x) + (d - b) * u.x * u.y;
}
float fbm(vec2 p) {
  float v = 0.0; float a = 0.5;
  for (int i = 0; i < 5; i++) { v += a * noise(p); p *= 2.03; a *= 0.5; }
  return v;
}

// Star layer (cheap)
float stars(vec2 uv, float t) {
  vec2 g = uv * 90.0;
  vec2 id = floor(g); vec2 f = fract(g) - 0.5;
  float h = hash(id);
  if (h < 0.985) return 0.0;
  float d = length(f);
  float tw = 0.5 + 0.5 * sin(t * (2.0 + h * 6.0) + h * 30.0);
  return smoothstep(0.06, 0.0, d) * tw;
}

void main() {
  vec2 uv = gl_FragCoord.xy / u_resolution.xy;
  vec2 p = (gl_FragCoord.xy - 0.5 * u_resolution) / u_resolution.y;
  float aspect = u_resolution.x / u_resolution.y;

  // Two gravity wells — centers of each half
  vec2 wellL = vec2(-aspect * 0.25, 0.0);
  vec2 wellR = vec2( aspect * 0.25, 0.0);

  float t = u_time * 0.22;

  // Metaballs that orbit each well; mouse-focus shifts them outward
  float fieldL = 0.0;
  float fieldR = 0.0;
  for (int i = 0; i < 6; i++) {
    float fi = float(i);
    float ang = t * (0.8 + fi * 0.11) + fi * 1.7;
    float orbit = 0.28 + 0.08 * sin(t * 1.3 + fi);
    orbit += u_focusL * 0.05 * sin(fi + t * 2.0);

    vec2 oL = vec2(cos(ang), sin(ang) * 0.85) * orbit;
    vec2 oR = vec2(cos(-ang * 1.05 + 0.7), sin(-ang * 1.05 + 0.7) * 0.85) * (orbit + 0.01);

    vec2 cL = wellL + oL;
    vec2 cR = wellR + oR;

    float rL = 0.11 + 0.04 * sin(t * 0.9 + fi);
    float rR = 0.11 + 0.04 * cos(t * 0.8 + fi * 1.3);

    fieldL += rL / (length(p - cL) + 0.025);
    fieldR += rR / (length(p - cR) + 0.025);
  }

  // Shockwave from click
  float dt = u_time - u_clickTime;
  vec2 cp = (u_click * u_resolution - 0.5 * u_resolution) / u_resolution.y;
  float wave = 0.0;
  if (dt < 2.5) {
    float r = length(p - cp);
    wave = sin(r * 18.0 - dt * 10.0) * exp(-r * 2.0) * exp(-dt * 1.8) * 0.8;
  }

  // Each side's field, boosted by its focus
  float boostL = 1.0 + u_focusL * 0.6;
  float boostR = 1.0 + u_focusR * 0.6;

  // Domain warp so metal feels turbulent
  vec2 warp = vec2(
    fbm(p * 2.4 + t + fieldL * 0.1),
    fbm(p * 2.4 - t + fieldR * 0.1)
  );

  float shapeL = fieldL * boostL + (warp.x - 0.5) * 0.9 + wave;
  float shapeR = fieldR * boostR + (warp.y - 0.5) * 0.9 + wave;

  // Rim/iso bands for chrome look
  float bandsL = sin(shapeL * 4.5 + t * 0.5);
  float bandsR = sin(shapeR * 4.5 - t * 0.5);
  float maskL = smoothstep(1.6, 3.6, shapeL);
  float maskR = smoothstep(1.6, 3.6, shapeR);

  // Cosmic background — deep space gradient + nebula + stars
  vec2 bg = uv - 0.5;
  float nebula = fbm(bg * 2.5 + vec2(u_time * 0.01, -u_time * 0.008));
  nebula = smoothstep(0.3, 0.9, nebula);

  vec3 deep   = vec3(0.015, 0.018, 0.032);
  vec3 nebCol = mix(vec3(0.06, 0.03, 0.18), vec3(0.18, 0.05, 0.22), nebula);
  nebCol = mix(nebCol, vec3(0.05, 0.12, 0.30), smoothstep(0.55, 0.9, nebula));

  // Radial dim from center
  float vig = 1.0 - 0.6 * length(bg);
  vec3 col = mix(deep, nebCol * 0.6, smoothstep(0.0, 1.0, nebula)) * vig;

  // Accretion glow around each well (halo)
  float glowL = exp(-length(p - wellL) * 2.2) * (0.12 + 0.25 * u_focusL);
  float glowR = exp(-length(p - wellR) * 2.2) * (0.12 + 0.25 * u_focusR);
  col += glowL * vec3(0.55, 0.7, 1.0);
  col += glowR * vec3(1.0, 0.75, 0.55);

  // Stars — slowly drifting
  col += stars(uv + vec2(u_time * 0.002, 0.0), u_time) * vec3(1.0, 0.95, 0.85) * 0.8;
  col += stars(uv * 1.3 - vec2(u_time * 0.001, 0.0), u_time) * vec3(0.85, 0.9, 1.0) * 0.5;

  // Chrome base — cool silver for left, warm silver for right
  vec3 chromeL_shadow = vec3(0.05, 0.07, 0.11);
  vec3 chromeL_light  = vec3(0.82, 0.88, 1.00);
  vec3 chromeR_shadow = vec3(0.09, 0.06, 0.05);
  vec3 chromeR_light  = vec3(1.00, 0.88, 0.78);

  // Iridescence
  vec3 iriL = 0.5 + 0.5 * cos(6.2831 * (shapeL * 0.35 + t * 0.15 + vec3(0.0, 0.33, 0.67)));
  vec3 iriR = 0.5 + 0.5 * cos(6.2831 * (shapeR * 0.35 - t * 0.15 + vec3(0.1, 0.4, 0.7)));
  iriL = mix(vec3(1.0), iriL, 0.22);
  iriR = mix(vec3(1.0), iriR, 0.22);

  vec3 metalL = mix(chromeL_shadow, chromeL_light * iriL, maskL);
  metalL += 0.2 * bandsL * maskL;
  vec3 metalR = mix(chromeR_shadow, chromeR_light * iriR, maskR);
  metalR += 0.2 * bandsR * maskR;

  // Rim highlights
  float rimL = smoothstep(0.4, 0.0, abs(shapeL - 2.1));
  float rimR = smoothstep(0.4, 0.0, abs(shapeR - 2.1));
  metalL += rimL * vec3(0.8, 0.9, 1.0) * (0.4 + u_focusL * 0.8);
  metalR += rimR * vec3(1.0, 0.9, 0.75) * (0.4 + u_focusR * 0.8);

  col += metalL * maskL;
  col += metalR * maskR;

  // Subtle film grain
  float grain = (hash(gl_FragCoord.xy + u_time) - 0.5) * 0.015;
  col += grain;

  // Global vignette
  col *= 1.0 - 0.35 * dot(bg, bg);

  gl_FragColor = vec4(col, 1.0);
}
`;

function createShader(gl, type, source) {
  const s = gl.createShader(type);
  gl.shaderSource(s, source); gl.compileShader(s);
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
    console.error(gl.getShaderInfoLog(s)); return null;
  }
  return s;
}

class TunasShader {
  constructor(canvas) {
    this.canvas = canvas;
    const gl = this.gl = canvas.getContext('webgl', { antialias: true });
    if (!gl) throw new Error('WebGL not supported');

    const vs = createShader(gl, gl.VERTEX_SHADER, VERT);
    const fs = createShader(gl, gl.FRAGMENT_SHADER, FRAG);
    const p = this.program = gl.createProgram();
    gl.attachShader(p, vs); gl.attachShader(p, fs); gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) {
      console.error(gl.getProgramInfoLog(p));
    }
    gl.useProgram(p);

    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([
      -1,-1, 1,-1, -1,1, -1,1, 1,-1, 1,1,
    ]), gl.STATIC_DRAW);
    const loc = gl.getAttribLocation(p, 'a_position');
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);

    this.u = {
      resolution: gl.getUniformLocation(p, 'u_resolution'),
      time: gl.getUniformLocation(p, 'u_time'),
      mouse: gl.getUniformLocation(p, 'u_mouse'),
      mouseSmooth: gl.getUniformLocation(p, 'u_mouseSmooth'),
      focusL: gl.getUniformLocation(p, 'u_focusL'),
      focusR: gl.getUniformLocation(p, 'u_focusR'),
      click: gl.getUniformLocation(p, 'u_click'),
      clickTime: gl.getUniformLocation(p, 'u_clickTime'),
    };

    this.mouse = [0.5, 0.5];
    this.mouseSmooth = [0.5, 0.5];
    this.targetFocusL = 0; this.targetFocusR = 0;
    this.focusL = 0; this.focusR = 0;
    this.click = [0.5, 0.5];
    this.clickTime = -10;
    this.start = performance.now();

    this.resize();
    window.addEventListener('resize', () => this.resize());
    this.loop();
  }

  resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = this.canvas.clientWidth * dpr;
    const h = this.canvas.clientHeight * dpr;
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w; this.canvas.height = h;
    }
    this.gl.viewport(0, 0, w, h);
  }

  setMouse(nx, ny) { this.mouse = [nx, ny]; }
  setFocus(side) {
    this.targetFocusL = side === 'L' ? 1 : 0;
    this.targetFocusR = side === 'R' ? 1 : 0;
  }
  pulse(nx, ny) {
    this.click = [nx, ny];
    this.clickTime = (performance.now() - this.start) / 1000;
  }

  loop() {
    this.resize();
    const gl = this.gl;
    const t = (performance.now() - this.start) / 1000;

    // Smooth mouse + focus
    this.mouseSmooth[0] += (this.mouse[0] - this.mouseSmooth[0]) * 0.07;
    this.mouseSmooth[1] += (this.mouse[1] - this.mouseSmooth[1]) * 0.07;
    this.focusL += (this.targetFocusL - this.focusL) * 0.05;
    this.focusR += (this.targetFocusR - this.focusR) * 0.05;

    gl.useProgram(this.program);
    gl.uniform2f(this.u.resolution, this.canvas.width, this.canvas.height);
    gl.uniform1f(this.u.time, t);
    gl.uniform2f(this.u.mouse, this.mouse[0], this.mouse[1]);
    gl.uniform2f(this.u.mouseSmooth, this.mouseSmooth[0], this.mouseSmooth[1]);
    gl.uniform1f(this.u.focusL, this.focusL);
    gl.uniform1f(this.u.focusR, this.focusR);
    gl.uniform2f(this.u.click, this.click[0], this.click[1]);
    gl.uniform1f(this.u.clickTime, this.clickTime);
    gl.drawArrays(gl.TRIANGLES, 0, 6);

    requestAnimationFrame(() => this.loop());
  }
}

window.TunasShader = TunasShader;
