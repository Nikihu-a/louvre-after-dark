// The gallery: paintings as curved screens along an arc, over a perspective
// grid floor that reflects them. Positions along the strip are in world units
// ("s"); the scroll position C is in painting indices and is mapped to s by
// stripAt().

import * as THREE from "../vendor/three.module.min.js";

export const CARD_H = 3.2;
const GAP = 0.85;
const RADIUS = 9.5;
const FOV = 35;
const CAM_Y = 0.62;
const LOOK_Y = 0.12;
const FLOOR_Y = -CARD_H / 2 - 0.14;

const CARD_VERT = /* glsl */ `
  uniform float uOffset;   // strip position of the card center relative to the view
  uniform float uRadius;
  uniform float uFocus;    // 0 = on the strip, 1 = flat and filling the screen
  uniform vec3 uFocusPos;
  uniform float uFocusScale;
  uniform float uHover;
  uniform float uReflect;  // 1 = draw the mirror image under the floor
  uniform float uFloorY;
  varying vec2 vUv;

  void main() {
    vUv = uv;
    float s = uOffset + position.x;
    float th = s / uRadius;
    vec3 strip = vec3(uRadius * sin(th), position.y, -uRadius * (1.0 - cos(th)));
    // Hover: the card leans a touch toward the viewer.
    strip += vec3(sin(th), 0.0, cos(th)) * uHover * 0.16;
    strip.y = mix(strip.y, 2.0 * uFloorY - strip.y, uReflect);
    vec3 flat_ = uFocusPos + vec3(position.xy * uFocusScale, 0.0);
    vec3 wp = mix(strip, flat_, uFocus);
    gl_Position = projectionMatrix * viewMatrix * vec4(wp, 1.0);
  }`;

const CARD_FRAG = /* glsl */ `
  uniform sampler2D uMap;
  uniform sampler2D uDepth;
  uniform float uAspect;
  uniform vec2 uPar;
  uniform float uDepthFocus;
  uniform float uActive;
  uniform float uAmbient;
  uniform float uLamp;
  uniform float uPower;    // 0 = this card's light is off
  uniform float uLoaded;
  uniform float uHover;
  uniform vec3 uTint;
  uniform vec2 uLight;     // screen uv, y down
  uniform vec2 uRes;
  uniform float uGlare;
  uniform float uGlareAmt;
  uniform float uVel;
  uniform float uVis;
  uniform float uFocus;
  uniform float uReflect;
  varying vec2 vUv;

  float roundBox(vec2 p, vec2 b, float r) {
    vec2 q = abs(p) - b + r;
    return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - r;
  }

  void main() {
    vec2 cp = (vUv - 0.5) * vec2(uAspect, 1.0);
    float d = roundBox(cp, vec2(uAspect * 0.5, 0.5), mix(0.035, 0.0, uFocus));
    float aa = fwidth(d);
    float mask = 1.0 - smoothstep(-aa, aa, d);
    if (mask <= 0.0) discard;

    float h = texture2D(uDepth, vUv).r;
    vec3 col;
    if (uReflect > 0.5) {
      // Blurred, like a reflection in polished stone.
      col = texture2D(uMap, vUv, 3.0).rgb;
    } else {
      // Cheap one-tap depth parallax: enough to make the centered card breathe.
      vec2 uv = vUv + uPar * (h - uDepthFocus) * uActive;
      // Chromatic split while the strip is moving fast.
      vec2 ca = vec2(clamp(uVel, -3.0, 3.0) * 0.0035, 0.0);
      col = vec3(texture2D(uMap, uv + ca).r, texture2D(uMap, uv).g, texture2D(uMap, uv - ca).b);
    }
    col = mix(vec3(0.05, 0.045, 0.05), col, uLoaded);

    vec2 s = gl_FragCoord.xy / uRes;
    s.y = 1.0 - s.y;
    vec2 asp = vec2(uRes.x / uRes.y, 1.0);
    float dist = length((s - uLight) * asp);
    float spot = exp(-dist * dist / 0.09);

    vec3 amb = mix(vec3(1.0), uTint, 0.35);
    float ambient = mix(0.03, uAmbient, uPower) * (1.0 + 0.18 * uHover);
    vec3 lit = col * (ambient * amb + uLamp * spot * uTint * (0.75 + 0.5 * h));

    // A diagonal sheen sweeping across the glass, strongest on the centered card.
    float band = s.x + (s.y - 0.5) * 0.35 - uGlare;
    lit += vec3(1.0, 0.96, 0.9) * exp(-band * band * 60.0) * uGlareAmt * (0.25 + 0.75 * uActive) * (1.0 - uFocus) * uPower * (1.0 - uReflect);

    // Soft inner edge so cards read as lit screens rather than flat cutouts.
    float edge = smoothstep(0.0, 0.06, -d);
    lit *= mix(0.55, 1.0, mix(edge, 1.0, uFocus));

    float alpha = mask * uVis;
    if (uReflect > 0.5) alpha *= 0.3 * smoothstep(0.7, 0.0, vUv.y);
    gl_FragColor = vec4(lit * uVis, alpha);
  }`;

const FLOOR_VERT = /* glsl */ `
  varying vec3 vWorld;
  void main() {
    vec4 w = modelMatrix * vec4(position, 1.0);
    vWorld = w.xyz;
    gl_Position = projectionMatrix * viewMatrix * w;
  }`;

// Drawn additively over the reflections: grid lines and a warm pool of light.
const FLOOR_FRAG = /* glsl */ `
  uniform float uScroll;
  uniform vec3 uTint;
  uniform float uPool;
  uniform float uFade;
  varying vec3 vWorld;

  void main() {
    vec2 g = vec2(vWorld.x + uScroll, vWorld.z) / 1.2;
    vec2 grid = abs(fract(g - 0.5) - 0.5) / fwidth(g);
    float line = 1.0 - min(min(grid.x, grid.y), 1.0);
    float dist = length(vWorld.xz - vec2(0.0, -2.0));
    float fade = exp(-dist * dist * 0.006) * smoothstep(9.0, 3.0, vWorld.z);
    float pool = exp(-(vWorld.x * vWorld.x * 0.07 + (vWorld.z + 0.6) * (vWorld.z + 0.6) * 0.22));
    vec3 col = vec3(0.62, 0.6, 0.66) * line * 0.2 * fade + uTint * pool * 0.12 * uPool;
    gl_FragColor = vec4(col * uFade, 1.0);
  }`;

const clamp01 = (x) => Math.min(1, Math.max(0, x));
const smoothstep = (a, b, x) => {
  const t = clamp01((x - a) / (b - a));
  return t * t * (3 - 2 * t);
};
const lerp = (a, b, t) => a + (b - a) * t;

function dustTexture() {
  const c = document.createElement("canvas");
  c.width = c.height = 64;
  const g = c.getContext("2d");
  const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grad.addColorStop(0, "rgba(255,240,215,1)");
  grad.addColorStop(1, "rgba(255,240,215,0)");
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(c);
}

function solidTexture(v) {
  const t = new THREE.DataTexture(new Uint8Array([v, v, v, 255]), 1, 1);
  t.needsUpdate = true;
  return t;
}

export class Gallery {
  constructor(renderer, paintings) {
    this.renderer = renderer;
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(FOV, 1, 0.1, 200);
    this.camZ = 9;
    this.res = new THREE.Vector2(1, 1);
    this.aniso = Math.min(8, renderer.capabilities.getMaxAnisotropy());
    const blank = solidTexture(20), flat = solidTexture(128);

    this.cards = paintings.map((p) => {
      const w = CARD_H * p.aspect;
      const mat = new THREE.ShaderMaterial({
        vertexShader: CARD_VERT,
        fragmentShader: CARD_FRAG,
        transparent: true,
        depthWrite: false,
        uniforms: {
          uOffset: { value: 0 },
          uRadius: { value: RADIUS },
          uFocus: { value: 0 },
          uFocusPos: { value: new THREE.Vector3() },
          uFocusScale: { value: 1 },
          uHover: { value: 0 },
          uReflect: { value: 0 },
          uFloorY: { value: FLOOR_Y },
          uMap: { value: blank },
          uDepth: { value: flat },
          uAspect: { value: p.aspect },
          uPar: { value: new THREE.Vector2() },
          uDepthFocus: { value: p.focus },
          uActive: { value: 0 },
          uAmbient: { value: 0.5 },
          uLamp: { value: 0.5 },
          uPower: { value: 1 },
          uLoaded: { value: 0 },
          uTint: { value: new THREE.Color(...p.tint) },
          uLight: { value: new THREE.Vector2(0.5, 0.5) },
          uRes: { value: this.res },
          uGlare: { value: 0.5 },
          uGlareAmt: { value: 0.1 },
          uVel: { value: 0 },
          uVis: { value: 1 },
        },
      });
      // The reflection shares every uniform except uReflect.
      const reflMat = mat.clone();
      reflMat.uniforms = { ...mat.uniforms, uReflect: { value: 1 } };
      reflMat.depthTest = false;
      reflMat.side = THREE.DoubleSide; // mirroring flips the triangle winding

      const geo = new THREE.PlaneGeometry(w, CARD_H, 72, 1);
      const mesh = new THREE.Mesh(geo, mat);
      const refl = new THREE.Mesh(geo, reflMat);
      mesh.frustumCulled = refl.frustumCulled = false;
      refl.renderOrder = -2;
      this.scene.add(refl, mesh);
      return { mesh, refl, mat, w, s: 0, offset: 0, vis: 1, active: 0, hover: 0, loadedAt: -1 };
    });
    let s = 0;
    this.cards.forEach((c, i) => {
      if (i > 0) s += this.cards[i - 1].w / 2 + GAP + c.w / 2;
      c.s = s;
    });

    this.floorMat = new THREE.ShaderMaterial({
      vertexShader: FLOOR_VERT,
      fragmentShader: FLOOR_FRAG,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      uniforms: {
        uScroll: { value: 0 },
        uTint: { value: new THREE.Color(1, 0.85, 0.6) },
        uPool: { value: 1 },
        uFade: { value: 1 },
      },
    });
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(90, 40), this.floorMat);
    floor.rotation.x = -Math.PI / 2;
    floor.position.set(0, FLOOR_Y, -8);
    floor.renderOrder = -1;
    this.scene.add(floor);

    // Dust drifting through the lamp light.
    const n = 260;
    const pos = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      pos[i * 3] = (Math.random() - 0.5) * 18;
      pos[i * 3 + 1] = FLOOR_Y + Math.random() * 6;
      pos[i * 3 + 2] = -6 + Math.random() * 11;
    }
    const dustGeo = new THREE.BufferGeometry();
    dustGeo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    this.dustBase = pos.slice();
    this.dust = new THREE.Points(dustGeo, new THREE.PointsMaterial({
      size: 0.035, map: dustTexture(), transparent: true, depthWrite: false,
      blending: THREE.AdditiveBlending, opacity: 0.5, color: 0xffe2b8,
    }));
    this.scene.add(this.dust);

    this.tmp = new THREE.Vector3();
  }

  get count() { return this.cards.length; }

  // Swap in a card's real textures once they arrive; it fades up from dark.
  setTextures(i, map, depth, now) {
    const c = this.cards[i];
    map.anisotropy = this.aniso;
    c.mat.uniforms.uMap.value = map;
    c.mat.uniforms.uDepth.value = depth;
    c.loadedAt = now;
  }

  // Scroll position (painting index, may run past either end) -> strip position.
  stripAt(C) {
    const cards = this.cards, n = cards.length;
    if (C <= 0) return cards[0].s;
    if (C >= n - 1) {
      const last = cards[n - 1];
      return last.s + (C - (n - 1)) * (last.w + GAP) * 1.4;
    }
    const i = Math.floor(C), f = C - i;
    return lerp(cards[i].s, cards[i + 1].s, f);
  }

  resize(w, h) {
    this.res.set(w, h);
    const aspect = w / h;
    this.camera.aspect = aspect;
    const tanHalf = Math.tan(THREE.MathUtils.degToRad(FOV / 2));
    // Landscape: frame the card height. Portrait: frame a typical card width.
    const visH = Math.max(CARD_H * 1.85, (CARD_H * 1.3) / aspect);
    this.camZ = visH / (2 * tanHalf);
    this.camera.updateProjectionMatrix();
  }

  // World position of a point on card i (local coords, origin at card center).
  cardPoint(i, lx, ly, out = new THREE.Vector3()) {
    const c = this.cards[i];
    const u = c.mat.uniforms;
    const s = u.uOffset.value + lx;
    const R = u.uRadius.value;
    const th = s / R;
    const hv = u.uHover.value * 0.16;
    const strip = out.set(R * Math.sin(th) + Math.sin(th) * hv, ly, -R * (1 - Math.cos(th)) + Math.cos(th) * hv);
    const f = u.uFocus.value;
    if (f > 0) {
      const fp = u.uFocusPos.value, sc = u.uFocusScale.value;
      strip.x = lerp(strip.x, fp.x + lx * sc, f);
      strip.y = lerp(strip.y, fp.y + ly * sc, f);
      strip.z = lerp(strip.z, fp.z, f);
    }
    return out;
  }

  toScreen(v) {
    const p = this.tmp.copy(v).project(this.camera);
    return [(p.x * 0.5 + 0.5) * this.res.x, (0.5 - p.y * 0.5) * this.res.y, p.z];
  }

  // Screen-space bounding box of card i.
  cardRect(i) {
    const c = this.cards[i];
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    const v = new THREE.Vector3();
    for (const fx of [-0.5, 0, 0.5]) {
      for (const fy of [-0.5, 0.5]) {
        const [x, y] = this.toScreen(this.cardPoint(i, fx * c.w, fy * CARD_H, v));
        x0 = Math.min(x0, x); x1 = Math.max(x1, x);
        y0 = Math.min(y0, y); y1 = Math.max(y1, y);
      }
    }
    return { x0, y0, x1, y1 };
  }

  // Where the focused card must sit (and how big) so that it appears
  // `screenHeights` tall, matching the immersive view's first frame.
  focusTarget(screenHeights) {
    const D = this.camZ * 0.5;
    const visH = 2 * D * Math.tan(THREE.MathUtils.degToRad(FOV / 2));
    return { pos: new THREE.Vector3(0, CAM_Y, this.camZ - D), scale: (screenHeights * visH) / CARD_H };
  }

  // st: { C, vel, time, now, mouse, light, ambient, lamp, tint, power[], hover,
  //       focusIndex, focusT, focusFit, focusAmbient, focusLamp, cardsVis, floorVis, pull }
  update(st) {
    const S = this.stripAt(st.C);
    const R = RADIUS / (1 + Math.min(Math.abs(st.vel) * 0.22, 1.1));
    const ft = st.focusT;
    const fe = ft * ft * (3 - 2 * ft);

    // `pull` > 1 backs the camera away and up (the opening dolly).
    const pull = st.pull;
    const cam = this.camera;
    cam.position.set(st.mouse[0] * 0.18 * (1 - fe), CAM_Y + st.mouse[1] * -0.08 * (1 - fe) + (pull - 1) * 1.1, this.camZ * pull);
    cam.lookAt(0, lerp(LOOK_Y, CAM_Y, fe) - (pull - 1) * 0.25, 0);

    const focus = st.focusIndex >= 0 ? this.focusTarget(st.focusFit) : null;
    const glare = 0.5 + Math.sin(st.time * 0.25) * 0.25 + st.mouse[0] * 0.15 - st.vel * 0.08;
    let poolPower = 0;

    this.cards.forEach((c, i) => {
      const u = c.mat.uniforms;
      c.offset = c.s - S;
      const th = Math.abs(c.offset) / R;
      // During the opening dolly the camera sees further round the arc.
      const reach = (pull - 1) * 0.9;
      c.vis = smoothstep(1.75 + reach, 1.1 + reach, th);
      c.active = clamp01(1 - Math.abs(c.offset) / (0.55 * (c.w + GAP)));
      c.hover = lerp(c.hover, st.hover === i ? 1 : 0, 0.12);
      const isFocus = i === st.focusIndex;
      const vis = c.vis * (isFocus ? 1 : 1 - fe) * st.cardsVis;
      poolPower += st.power[i] * c.active;

      c.mesh.visible = vis > 0.002;
      c.refl.visible = c.mesh.visible && !isFocus;
      if (!c.mesh.visible) return;
      u.uOffset.value = c.offset;
      u.uRadius.value = R;
      u.uFocus.value = isFocus ? fe : 0;
      if (isFocus && focus) {
        u.uFocusPos.value.copy(focus.pos);
        u.uFocusScale.value = focus.scale;
      }
      u.uHover.value = c.hover * (1 - fe);
      u.uPar.value.set(st.mouse[0] * 0.012, -st.mouse[1] * 0.009);
      u.uActive.value = isFocus ? lerp(c.active, 0, fe) : c.active;
      u.uAmbient.value = lerp(st.ambient * (0.45 + 0.55 * c.active), st.focusAmbient, isFocus ? fe : 0);
      u.uLamp.value = lerp(st.lamp, st.focusLamp, isFocus ? fe : 0);
      u.uPower.value = isFocus ? lerp(st.power[i], 1, fe) : st.power[i];
      u.uLoaded.value = c.loadedAt < 0 ? 0 : clamp01((st.now - c.loadedAt) / 600);
      u.uLight.value.set(st.light[0], st.light[1]);
      u.uGlare.value = glare;
      u.uGlareAmt.value = 0.08 + Math.min(Math.abs(st.vel) * 0.05, 0.12);
      u.uVel.value = isFocus ? 0 : st.vel;
      u.uVis.value = vis;
      // Keep the focused card above its neighbours while it flies forward.
      c.mesh.renderOrder = isFocus ? 2 : 1;
    });

    const fu = this.floorMat.uniforms;
    fu.uScroll.value = S;
    fu.uTint.value.setRGB(...st.tint);
    fu.uPool.value = st.ambient * 1.6 * clamp01(poolPower);
    fu.uFade.value = (1 - fe) * st.floorVis;

    const p = this.dust.geometry.attributes.position;
    for (let i = 0; i < p.count; i++) {
      const b = i * 3;
      const x = this.dustBase[b] + 9 + Math.sin(st.time * 0.07 + i) * 0.4 - S * 0.15;
      p.array[b] = (((x % 18) + 18) % 18) - 9;
      p.array[b + 1] = this.dustBase[b + 1] + Math.sin(st.time * 0.11 + i * 1.7) * 0.25;
    }
    p.needsUpdate = true;
    this.dust.material.opacity = 0.45 * (1 - fe) * st.floorVis;
  }

  render() {
    this.renderer.render(this.scene, this.camera);
  }
}
