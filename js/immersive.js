// The immersive view: one painting filling the screen, rendered as a depth
// stage. A parallax-occlusion ray march through the depth map lets near
// figures occlude far ones as the camera moves, dollies in, or the lamp rakes
// across the surface.

import * as THREE from "../vendor/three.module.min.js";

export const MARGIN = 1.08; // overscan so displaced edges never show
const MAX_CROP = 1.35; // a very tall or very wide painting may overflow the screen by at most this much

// On-screen height of the painting, in screen heights. Paintings close to the
// screen's shape fill it (with overscan); very different shapes are mostly
// shown whole, floating in the dark, so a portrait never loses its face.
export function fitHeight(screenAspect, imageAspect) {
  const r = screenAspect / imageAspect;
  return Math.min(Math.max(1, r) * MARGIN, Math.min(1, r) * MAX_CROP);
}
export const PARALLAX = 0.045;
const DEPTH_SPREAD = 1.0; // how much farther the background sits than the foreground
const LOUPE_ZOOM = 2.8;

const VERT = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = vec4(position.xy, 0.0, 1.0);
  }`;

const FRAG = /* glsl */ `
  uniform sampler2D uImage;
  uniform sampler2D uDepth;
  uniform sampler2D uPlate;    // background behind figure edges (inpainted)
  uniform sampler2D uBgDepth;
  uniform float uHasPlate;
  uniform vec2 uK;          // screen uv -> image uv scale
  uniform vec2 uPar;        // parallax offset (image uv)
  uniform float uFocus;
  uniform float uZoom;
  uniform vec2 uC;          // zoom center (image uv)
  uniform vec2 uA;          // where that center sits (cover space)
  uniform vec2 uLight;      // lamp position (screen uv, y down)
  uniform float uAspect;    // screen aspect
  uniform float uAmbient;
  uniform float uLamp;
  uniform vec3 uTint;
  uniform vec2 uTexel;
  uniform vec3 uLoupe;      // x, y (screen uv, y down), strength
  uniform float uLoupeR;
  uniform float uThresh;    // depth dissolve threshold; below -0.1 = fully shown
  uniform float uInvert;    // 1 = reveal near-first instead of far-first
  uniform float uOpacity;
  uniform float uTime;
  uniform float uImgAspect;
  uniform vec4 uRock;       // amplitude (rad), speed, bob, unused
  uniform vec2 uPivot;      // rocking pivot (image uv)
  uniform vec2 uRockDepth;  // depth range that rocks
  uniform vec4 uWave;       // band y0, y1, amplitude, max depth
  uniform vec4 uSway[3];    // soft local sway (feathers): x, y (image uv), radius, amplitude
  uniform vec2 uSwayK;      // speed, min depth that sways
  varying vec2 vUv;

  float mag(float h) {
    float d0 = 1.0 + (1.0 - h) * ${DEPTH_SPREAD.toFixed(2)};
    return d0 / (d0 - uZoom);
  }
  vec2 at(vec2 b, float h) {
    vec2 p = uC + (b - uA) / mag(h) + uPar * (h - uFocus);
    // Living motion. Displacing the lookup inside the ray march keeps
    // occlusion right: the rocking layer still hides what is behind it.
    float w = smoothstep(uRockDepth.x, uRockDepth.y, h);
    if (uRock.x > 0.0 && w > 0.0) {
      float ang = sin(uTime * uRock.y) * uRock.x * w;
      vec2 d = (p - uPivot) * vec2(uImgAspect, 1.0);
      d = vec2(d.x * cos(ang) - d.y * sin(ang), d.x * sin(ang) + d.y * cos(ang));
      p = uPivot + d / vec2(uImgAspect, 1.0);
      p.y += sin(uTime * uRock.y * 1.3 + 1.0) * uRock.z * w;
    }
    if (uWave.z > 0.0) {
      float band = smoothstep(uWave.x, uWave.x + 0.03, p.y) * (1.0 - smoothstep(uWave.y - 0.03, uWave.y, p.y));
      float far = 1.0 - smoothstep(uWave.w - 0.08, uWave.w, h);
      p.x += sin(p.y * 160.0 - uTime * 1.1) * uWave.z * band * far;
      p.y += sin(p.x * 70.0 + uTime * 0.8) * uWave.z * 0.6 * band * far;
    }
    // Feathers: a slow, uneven sway inside a soft circle, near layers only.
    for (int i = 0; i < 3; i++) {
      vec4 s = uSway[i];
      if (s.w <= 0.0) continue;
      vec2 dv = (p - s.xy) * vec2(uImgAspect, 1.0);
      float g = exp(-dot(dv, dv) / (s.z * s.z));
      float wd = smoothstep(uSwayK.y - 0.08, uSwayK.y, h);
      float ph = uTime * uSwayK.x + float(i) * 1.7;
      float gust = 0.65 + 0.35 * sin(uTime * 0.37 + float(i));
      p += vec2(sin(ph + p.y * 18.0), 0.45 * cos(ph * 0.83 + p.x * 13.0)) * s.w * g * wd * gust;
    }
    return p;
  }
  float depthAt(vec2 p) { return texture2D(uDepth, p).r; }

  float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float noise(vec2 p) {
    vec2 i = floor(p), f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash(i), hash(i + vec2(1, 0)), f.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), f.x), f.y);
  }

  void main() {
    vec2 s = vec2(vUv.x, 1.0 - vUv.y);
    vec2 asp = vec2(uAspect, 1.0);

    // Loupe: magnify around the press point.
    float ld = length((s - uLoupe.xy) * asp);
    float inL = uLoupe.z * (1.0 - smoothstep(uLoupeR - 0.002, uLoupeR, ld));
    vec2 sl = inL > 0.001 ? uLoupe.xy + (s - uLoupe.xy) / ${LOUPE_ZOOM.toFixed(1)} : s;

    vec2 b = (sl - 0.5) * uK + 0.5;

    float stepH = 1.0 / float(STEPS);
    float h = 1.0;
    vec2 p = at(b, h);
    float d = depthAt(p);
    vec2 prevP = p;
    float prevH = h;
    float prevGap = 0.0;
    for (int i = 0; i < STEPS; i++) {
      if (d >= h) break;
      prevP = p; prevH = h; prevGap = h - d;
      h -= stepH;
      p = at(b, h);
      d = depthAt(p);
    }
    float under = max(d - h, 0.0);
    float w = under / (under + prevGap + 1e-5);
    vec2 hit = mix(p, prevP, w);
    float hitH = mix(h, prevH, w);

    vec3 col = texture2D(uImage, hit).rgb;
    // Outside the painting is the dark room; soften the canvas edge.
    vec2 edge = min(hit, 1.0 - hit) * vec2(uK.y / uK.x * uAspect, 1.0);
    float inside = smoothstep(0.0, 0.004, min(edge.x, edge.y));

    // Normals from the depth gradient, so the lamp rakes across forms.
    vec2 e = uTexel * 2.0;
    float dl = depthAt(hit - vec2(e.x, 0.0)), dr = depthAt(hit + vec2(e.x, 0.0));
    float du = depthAt(hit - vec2(0.0, e.y)), dd = depthAt(hit + vec2(0.0, e.y));
    vec3 n = normalize(vec3((dl - dr) * 7.0, (du - dd) * 7.0, 1.0));

    // Disocclusion: the ray landed on the steep wall between a figure and what
    // is behind it, and the view has actually moved. Re-trace against the
    // background plate instead of stretching the figure's edge.
    float wall = length(vec2(dr - dl, dd - du));
    vec2 travel = (b - uA) * (1.0 / mag(1.0) - 1.0 / mag(0.0)) + uPar;
    float wallK = uHasPlate * smoothstep(0.05, 0.2, wall) * smoothstep(0.0015, 0.008, length(travel));
    if (wallK > 0.001) {
      float hb = 1.0;
      vec2 pb = at(b, hb);
      float db = texture2D(uBgDepth, pb).r;
      for (int i = 0; i < 20; i++) {
        if (db >= hb) break;
        hb -= 0.05;
        pb = at(b, hb);
        db = texture2D(uBgDepth, pb).r;
      }
      col = mix(col, texture2D(uPlate, pb).rgb, wallK);
      hitH = mix(hitH, hb, wallK);
      n = normalize(mix(n, vec3(0.0, 0.0, 1.0), wallK));
    }

    vec3 pos = vec3(s * asp, hitH * 0.25);
    vec3 l = normalize(vec3(uLight * asp, 0.55) - pos);
    float diff = max(dot(n, l), 0.0);
    float dist = length((s - uLight) * asp);
    float spot = exp(-dist * dist / 0.085);

    float fog = mix(0.7, 1.0, smoothstep(0.05, 0.8, hitH));
    vec3 amb = mix(vec3(1.0), uTint, 0.3);
    vec3 lit = col * (uAmbient * fog * amb + uLamp * spot * (0.3 + 0.95 * diff) * uTint);

    vec2 v = (s - 0.5) * vec2(1.0, 1.15);
    lit *= clamp(1.0 - dot(v, v) * 1.1, 0.25, 1.0);

    // Inside the loupe the painting is evenly lit, like under a gallery light.
    lit = mix(lit, col * 1.04, inL);
    float ring = uLoupe.z * exp(-pow((ld - uLoupeR) / 0.0022, 2.0));
    float shadow = uLoupe.z * (1.0 - inL) * exp(-pow(max(ld - uLoupeR, 0.0) / 0.03, 2.0)) * 0.45;
    lit = lit * (1.0 - shadow) + vec3(0.85, 0.7, 0.44) * ring;

    // Depth dissolve between paintings, with a gold ember at the edge.
    float key = mix(noise(hit * asp * 14.0 + uTime * 0.05), hitH, 0.62);
    key = mix(key, 1.0 - key, uInvert);
    float shown = smoothstep(uThresh, uThresh + 0.035, key);
    float ember = (1.0 - shown) * smoothstep(uThresh - 0.07, uThresh, key);
    vec3 bg = vec3(0.027, 0.024, 0.039);
    vec3 outc = mix(bg, lit, shown * inside) + vec3(1.0, 0.72, 0.38) * ember * 0.9 * inside;

    gl_FragColor = vec4(outc, uOpacity);
  }`;

const clamp01 = (x) => Math.min(1, Math.max(0, x));
const lerp = (a, b, t) => a + (b - a) * t;

// Must match mag() in the shader.
export const mag = (h, zoom) => {
  const d0 = 1 + (1 - h) * DEPTH_SPREAD;
  return d0 / (d0 - zoom);
};

export class Immersive {
  // Fewer ray-march steps for slower GPUs (forces a shader recompile).
  setSteps(steps) {
    if (this.material.defines.STEPS === steps) return;
    this.material.defines.STEPS = steps;
    this.material.needsUpdate = true;
  }

  constructor(renderer, { steps = 48 } = {}) {
    this.renderer = renderer;
    this.scene = new THREE.Scene();
    this.camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    this.res = [1, 1];
    this.material = new THREE.ShaderMaterial({
      vertexShader: VERT,
      fragmentShader: FRAG,
      defines: { STEPS: steps },
      transparent: true,
      depthTest: false,
      depthWrite: false,
      uniforms: {
        uImage: { value: null },
        uDepth: { value: null },
        uPlate: { value: null },
        uBgDepth: { value: null },
        uHasPlate: { value: 0 },
        uK: { value: new THREE.Vector2(1, 1) },
        uPar: { value: new THREE.Vector2() },
        uFocus: { value: 0.55 },
        uZoom: { value: 0 },
        uC: { value: new THREE.Vector2(0.5, 0.5) },
        uA: { value: new THREE.Vector2(0.5, 0.5) },
        uLight: { value: new THREE.Vector2(0.5, 0.5) },
        uAspect: { value: 1 },
        uAmbient: { value: 0.6 },
        uLamp: { value: 0.6 },
        uTint: { value: new THREE.Color(1, 0.85, 0.6) },
        uTexel: { value: new THREE.Vector2(1 / 1024, 1 / 1024) },
        uLoupe: { value: new THREE.Vector3(0.5, 0.5, 0) },
        uLoupeR: { value: 0.16 },
        uThresh: { value: -0.2 },
        uInvert: { value: 0 },
        uOpacity: { value: 0 },
        uTime: { value: 0 },
        uImgAspect: { value: 1 },
        uRock: { value: new THREE.Vector4(0, 0, 0, 0) },
        uPivot: { value: new THREE.Vector2(0.5, 0.5) },
        uRockDepth: { value: new THREE.Vector2(0.4, 0.6) },
        uWave: { value: new THREE.Vector4(0, 0, 0, 0) },
        uSway: { value: [new THREE.Vector4(), new THREE.Vector4(), new THREE.Vector4()] },
        uSwayK: { value: new THREE.Vector2(1, 0.3) },
      },
    });
    const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.material);
    quad.frustumCulled = false;
    this.scene.add(quad);
    this.painting = null;
    this.imgAspect = 1;
    this.sampleDepth = () => 0.5;
  }

  // Swap in a painting whose full-size textures are already loaded.
  set(painting, { image, depth, plate, bgDepth }, depthPixels) {
    const u = this.material.uniforms;
    this.painting = painting;
    this.imgAspect = painting.aspect;
    u.uImage.value = image;
    u.uDepth.value = depth;
    u.uPlate.value = plate || image;
    u.uBgDepth.value = bgDepth || depth;
    u.uHasPlate.value = plate && bgDepth ? 1 : 0;
    u.uFocus.value = painting.focus;
    u.uTint.value.setRGB(...painting.tint);
    u.uImgAspect.value = painting.aspect;
    const rock = painting.motion && painting.motion.rock;
    const waves = painting.motion && painting.motion.waves;
    u.uRock.value.set(rock ? rock.amp : 0, rock ? rock.speed : 0, rock ? rock.bob : 0, 0);
    if (rock) {
      u.uPivot.value.set(...rock.pivot);
      u.uRockDepth.value.set(...rock.depth);
    }
    u.uWave.value.set(waves ? waves.band[0] : 0, waves ? waves.band[1] : 0, waves ? waves.amp : 0, waves ? waves.depthMax : 0);
    const sway = (painting.motion && painting.motion.sway) || null;
    u.uSway.value.forEach((v, k) => {
      const s = sway && sway.regions[k];
      v.set(s ? s.at[0] : 0, s ? s.at[1] : 0, s ? s.r : 0, s ? s.amp : 0);
    });
    if (sway) u.uSwayK.value.set(sway.speed, sway.depthMin);
    u.uTexel.value.set(1 / depth.image.width, 1 / depth.image.height);
    const { w, h, data } = depthPixels;
    this.sampleDepth = (x, y) => {
      const px = Math.min(w - 1, Math.max(0, Math.round(x * (w - 1))));
      const py = Math.min(h - 1, Math.max(0, Math.round(y * (h - 1))));
      return data[(py * w + px) * 4] / 255;
    };
  }

  resize(w, h) {
    this.res = [w, h];
    this.material.uniforms.uAspect.value = w / h;
  }

  // Scale from screen uv to image uv for the current fit.
  coverK() {
    const sa = this.res[0] / this.res[1];
    const h = fitHeight(sa, this.imgAspect);
    return [sa / (h * this.imgAspect), 1 / h];
  }

  // Pan a zoomed subject toward `target` (cover space) without ever sampling
  // outside the image, even for the far (least magnified) layer.
  anchor(zoom, cx, cy, target, k) {
    const w = clamp01(zoom / 0.4);
    const m0 = mag(0, zoom);
    const pad = PARALLAX * 0.6;
    return [cx, cy].map((c, i) => {
      const half = Math.min(0.5, k[i] / 2);
      const lo = 0.5 + half - (1 - c - pad) * m0;
      const hi = 0.5 - half + (c - pad) * m0;
      const a = lerp(c, target[i], w);
      return lo <= hi ? Math.min(hi, Math.max(lo, a)) : c;
    });
  }

  // v: { zoom, cx, cy, target, par, light, ambient, lamp, loupe, thresh, invert, opacity, time }
  update(v) {
    const u = this.material.uniforms;
    const k = this.coverK();
    const a = this.anchor(v.zoom, v.cx, v.cy, v.target, k);
    this.k = k;
    this.a = a;
    this.v = v;
    u.uK.value.set(k[0], k[1]);
    u.uZoom.value = v.zoom;
    u.uC.value.set(v.cx, v.cy);
    u.uA.value.set(a[0], a[1]);
    u.uPar.value.set(v.par[0], v.par[1]);
    u.uLight.value.set(v.light[0], v.light[1]);
    u.uAmbient.value = v.ambient;
    u.uLamp.value = v.lamp;
    u.uLoupe.value.set(v.loupe[0], v.loupe[1], v.loupe[2]);
    u.uLoupeR.value = Math.min(0.2, 130 / this.res[1]);
    u.uThresh.value = v.thresh;
    u.uInvert.value = v.invert;
    u.uOpacity.value = v.opacity;
    u.uTime.value = v.time;
  }

  // Screen position of an image point at its own depth (inverse of the shader).
  project(qx, qy) {
    const v = this.v, k = this.k, a = this.a;
    if (!v) return [0, 0];
    const h = this.sampleDepth(qx, qy);
    const m = mag(h, v.zoom);
    const off = h - this.painting.focus;
    const bx = a[0] + (qx - v.par[0] * off - v.cx) * m;
    const by = a[1] + (qy - v.par[1] * off - v.cy) * m;
    return [((bx - 0.5) / k[0] + 0.5) * this.res[0], ((by - 0.5) / k[1] + 0.5) * this.res[1]];
  }

  render() {
    this.renderer.render(this.scene, this.camera);
  }
}
