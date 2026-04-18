// Solo liquid-metal shader — one gravity well at center.
// Used by taner.html and neshe.html. Accepts a `tint` param:
//  'cool' = blue/silver, 'warm' = amber/silver.

const VERT = `
attribute vec2 a_position;
void main() { gl_Position = vec4(a_position, 0.0, 1.0); }
`;

function makeFrag(tint) {
  const isCool = tint === 'cool';
  return `
precision highp float;
uniform vec2 u_resolution;
uniform float u_time;
uniform vec2 u_mouseSmooth;
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

  // Mouse-influenced well
  vec2 m = (u_mouseSmooth * u_resolution - 0.5 * u_resolution) / u_resolution.y;
  vec2 well = m * 0.15;

  float t = u_time * 0.22;

  float field = 0.0;
  for (int i = 0; i < 7; i++) {
    float fi = float(i);
    float ang = t * (0.8 + fi * 0.11) + fi * 1.7;
    float orbit = 0.32 + 0.10 * sin(t * 1.2 + fi);
    vec2 c = well + vec2(cos(ang), sin(ang) * 0.88) * orbit;
    float r = 0.13 + 0.04 * sin(t * 0.9 + fi);
    field += r / (length(p - c) + 0.025);
  }

  // Click shockwave
  float dt = u_time - u_clickTime;
  vec2 cp = (u_click * u_resolution - 0.5 * u_resolution) / u_resolution.y;
  float wave = 0.0;
  if (dt < 2.5) {
    float r = length(p - cp);
    wave = sin(r * 18.0 - dt * 10.0) * exp(-r * 2.0) * exp(-dt * 1.8) * 0.8;
  }

  vec2 warp = vec2(fbm(p * 2.4 + t + field * 0.1), fbm(p * 2.4 - t));
  float shape = field + (warp.x - 0.5) * 0.9 + wave;

  float bands = sin(shape * 4.5 + t * 0.5);
  float mask = smoothstep(1.6, 3.6, shape);

  // Cosmic bg
  vec2 bg = uv - 0.5;
  float nebula = fbm(bg * 2.5 + vec2(u_time * 0.01, -u_time * 0.008));
  nebula = smoothstep(0.3, 0.9, nebula);

  vec3 deep = vec3(0.015, 0.018, 0.032);
  vec3 nebCol = mix(vec3(0.06, 0.03, 0.18), vec3(0.18, 0.05, 0.22), nebula);
  nebCol = mix(nebCol, vec3(0.05, 0.12, 0.30), smoothstep(0.55, 0.9, nebula));

  float vig = 1.0 - 0.6 * length(bg);
  vec3 col = mix(deep, nebCol * 0.6, smoothstep(0.0, 1.0, nebula)) * vig;

  // Halo
  float glow = exp(-length(p - well) * 2.0) * 0.28;
  col += glow * ${isCool ? 'vec3(0.55, 0.7, 1.0)' : 'vec3(1.0, 0.75, 0.55)'};

  col += stars(uv + vec2(u_time * 0.002, 0.0), u_time) * vec3(1.0, 0.95, 0.85) * 0.8;
  col += stars(uv * 1.3 - vec2(u_time * 0.001, 0.0), u_time) * vec3(0.85, 0.9, 1.0) * 0.5;

  vec3 chromeShadow = ${isCool ? 'vec3(0.05, 0.07, 0.11)' : 'vec3(0.09, 0.06, 0.05)'};
  vec3 chromeLight  = ${isCool ? 'vec3(0.82, 0.88, 1.00)' : 'vec3(1.00, 0.88, 0.78)'};

  vec3 iri = 0.5 + 0.5 * cos(6.2831 * (shape * 0.35 + t * 0.15 + vec3(0.0, 0.33, 0.67)));
  iri = mix(vec3(1.0), iri, 0.22);

  vec3 metal = mix(chromeShadow, chromeLight * iri, mask);
  metal += 0.2 * bands * mask;

  float rim = smoothstep(0.4, 0.0, abs(shape - 2.1));
  metal += rim * ${isCool ? 'vec3(0.8, 0.9, 1.0)' : 'vec3(1.0, 0.9, 0.75)'} * 0.6;

  col += metal * mask;

  float grain = (hash(gl_FragCoord.xy + u_time) - 0.5) * 0.015;
  col += grain;

  col *= 1.0 - 0.35 * dot(bg, bg);

  gl_FragColor = vec4(col, 1.0);
}
`;
}

function createShader(gl, type, source) {
  const s = gl.createShader(type);
  gl.shaderSource(s, source); gl.compileShader(s);
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
    console.error(gl.getShaderInfoLog(s)); return null;
  }
  return s;
}

class SoloShader {
  constructor(canvas, tint) {
    this.canvas = canvas;
    const gl = this.gl = canvas.getContext('webgl', { antialias: true });
    if (!gl) throw new Error('WebGL not supported');

    const vs = createShader(gl, gl.VERTEX_SHADER, VERT);
    const fs = createShader(gl, gl.FRAGMENT_SHADER, makeFrag(tint));
    const p = this.program = gl.createProgram();
    gl.attachShader(p, vs); gl.attachShader(p, fs); gl.linkProgram(p);
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
      mouseSmooth: gl.getUniformLocation(p, 'u_mouseSmooth'),
      click: gl.getUniformLocation(p, 'u_click'),
      clickTime: gl.getUniformLocation(p, 'u_clickTime'),
    };

    this.mouse = [0.5, 0.5];
    this.mouseSmooth = [0.5, 0.5];
    this.click = [0.5, 0.5];
    this.clickTime = -10;
    this.start = performance.now();

    this.resize();
    window.addEventListener('resize', () => this.resize());

    canvas.addEventListener('mousemove', (e) => {
      const r = canvas.getBoundingClientRect();
      this.mouse = [(e.clientX - r.left) / r.width, 1 - (e.clientY - r.top) / r.height];
    });
    canvas.addEventListener('click', (e) => {
      const r = canvas.getBoundingClientRect();
      this.click = [(e.clientX - r.left) / r.width, 1 - (e.clientY - r.top) / r.height];
      this.clickTime = (performance.now() - this.start) / 1000;
    });

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

  loop() {
    this.resize();
    const gl = this.gl;
    const t = (performance.now() - this.start) / 1000;
    this.mouseSmooth[0] += (this.mouse[0] - this.mouseSmooth[0]) * 0.07;
    this.mouseSmooth[1] += (this.mouse[1] - this.mouseSmooth[1]) * 0.07;

    gl.useProgram(this.program);
    gl.uniform2f(this.u.resolution, this.canvas.width, this.canvas.height);
    gl.uniform1f(this.u.time, t);
    gl.uniform2f(this.u.mouseSmooth, this.mouseSmooth[0], this.mouseSmooth[1]);
    gl.uniform2f(this.u.click, this.click[0], this.click[1]);
    gl.uniform1f(this.u.clickTime, this.clickTime);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
    requestAnimationFrame(() => this.loop());
  }
}

window.SoloShader = SoloShader;
