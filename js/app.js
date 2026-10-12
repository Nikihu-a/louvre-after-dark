import * as THREE from "../vendor/three.module.min.js";
import { PAINTINGS } from "./data.js";
import { UI } from "./strings.js";
import { Sound, TRACKS } from "./audio.js";
import { Gallery, CARD_H } from "./gallery.js";
import { Immersive, PARALLAX, fitHeight } from "./immersive.js";

const N = PAINTINGS.length;
const $ = (s) => document.querySelector(s);
const reduceMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;
const finePointer = matchMedia("(pointer: fine)").matches;

const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
const clamp01 = (x) => clamp(x, 0, 1);
const lerp = (a, b, t) => a + (b - a) * t;
const smoothstep = (a, b, x) => {
  const t = clamp01((x - a) / (b - a));
  return t * t * (3 - 2 * t);
};
const damp = (a, b, k, dt) => lerp(a, b, 1 - Math.exp(-k * dt));
const easeInOut = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

// Lighting presets: the lamp (default) or the gallery lights switched on.
const LIGHT = {
  lamp: { gallery: [0.55, 0.6], overview: [0.62, 0.55], detail: [0.46, 0.78], next: [0.32, 0.7] },
  on: { gallery: [1.0, 0.12], overview: [1.0, 0.12], detail: [0.95, 0.12], next: [0.85, 0.12] },
};

// Opening: how far back the camera starts, where along the arc it looks
// (the middle of the collection), and when each spotlight switches on.
const PULL = 2.4;
const OPENING_C = 4.5;
const lightDelay = (i) => (reduceMotion ? 0.3 + i * 0.05 : 0.4 + i * 0.12);
const OPENING = reduceMotion ? 1.2 : 3.2;

// A spotlight that catches, drops out, and catches again.
function powerAt(i, t) {
  const x = t - lightDelay(i);
  if (x < 0) return 0;
  if (reduceMotion) return 1;
  if (x < 0.05) return 0.9;
  if (x < 0.11) return 0.08;
  if (x < 0.16) return 1;
  if (x < 0.21) return 0.55;
  return 1;
}

// ---------------------------------------------------------------- tweens
const tweens = new Set();
function tween(seconds, onUpdate, onDone) {
  const t = { t0: performance.now(), dur: seconds * 1000 * (reduceMotion ? 0.5 : 1), onUpdate, onDone };
  tweens.add(t);
  return t;
}
function runTweens(now) {
  for (const t of [...tweens]) {
    const k = clamp01((now - t.t0) / t.dur);
    t.onUpdate(k);
    if (k >= 1) {
      tweens.delete(t);
      if (t.onDone) t.onDone();
    }
  }
}

// ---------------------------------------------------------------- strings
const L = () => UI;
// Fill the interface strings marked with data-i18n.
function fillStrings() {
  document.querySelectorAll("[data-i18n]").forEach((el) => {
    const v = UI[el.dataset.i18n];
    if (typeof v === "string") el.textContent = v;
  });
}

// ---------------------------------------------------------------- DOM
const el = (tag, cls, txt) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (txt != null) e.textContent = txt;
  return e;
};

const ui = {
  loader: $("#loader"), loaderPct: $("#loader-pct"), loaderBar: $("#loader-bar"),
  intro: $("#intro"), cards: $("#cards-ui"), scrub: $("#scrub"), scrubTrack: $("#scrub-track"),
  scrubList: $("#scrub-list"), scrubDot: $("#scrub-dot"),
  view: $("#view"), hotspots: $("#hotspots"), chapters: $("#chapters"), wall: $("#wall"), wallGrid: $("#wall-grid"),
  cursor: $("#cursor"), cursorLabel: $("#cursor-label"), lights: $("#lights"), sound: $("#sound"),
  lost: $("#lost"), announce: $("#announce"), nowPlaying: $("#now-playing"),
};

// Wall (also the fallback without WebGL): each painting with a museum-style label.
PAINTINGS.forEach((p, i) => {
  const li = el("li");
  const b = el("button");
  b.type = "button";
  const frame = el("span", "frame");
  const img = el("img");
  img.src = `assets/paintings/${p.id}-card.webp`;
  img.alt = `${p.title}, ${p.artist}`;
  img.loading = "lazy";
  frame.append(img);
  const label = el("span", "label");
  label.append(el("span", "y", p.date), el("span", "t", p.title), el("span", "a", p.artist));
  b.append(frame, label);
  b.addEventListener("click", () => openPainting(i));
  li.append(b);
  ui.wallGrid.append(li);
});

function noWebGL() {
  document.documentElement.classList.add("no-webgl");
  document.body.classList.add("on-wall");
  document.body.classList.remove("is-loading");
  ui.loader.classList.add("done");
}

let openPainting = () => {};

// ---------------------------------------------------------------- renderer
let renderer = null;
if (new URLSearchParams(location.search).has("static")) noWebGL();
else {
  try {
    renderer = new THREE.WebGLRenderer({ canvas: $("#gl"), antialias: true, powerPreference: "high-performance" });
  } catch (err) {
    console.error(err);
    noWebGL();
  }
}
fillStrings();
if (renderer) start();

function start() {
  renderer.setClearColor(0x07060a, 1);
  renderer.autoClear = false;

  const canvas = renderer.domElement;
  canvas.addEventListener("webglcontextlost", () => ui.lost.classList.add("on"));
  canvas.addEventListener("webglcontextrestored", () => ui.lost.classList.remove("on"));

  const texLoader = new THREE.TextureLoader();
  const loadTexture = (url, { flipY = true, mipmaps = true } = {}) => new Promise((res, rej) => {
    texLoader.load(url, (t) => {
      t.flipY = flipY;
      if (!mipmaps) {
        t.generateMipmaps = false;
        t.minFilter = THREE.LinearFilter;
      }
      t.needsUpdate = true;
      res(t);
    }, undefined, () => rej(new Error("Failed to load " + url)));
  });

  const readPixels = (img, w = 256) => {
    const c = document.createElement("canvas");
    c.width = w;
    c.height = Math.round((w * img.height) / img.width);
    const g = c.getContext("2d", { willReadFrequently: true });
    g.drawImage(img, 0, 0, c.width, c.height);
    return { w: c.width, h: c.height, data: g.getImageData(0, 0, c.width, c.height).data };
  };

  // Gallery card textures, in priority order: the first paintings (or a deep
  // link's) gate the loader; the rest stream in behind it.
  const deep = PAINTINGS.findIndex((p) => p.id === location.hash.replace(/^#\/?/, ""));
  const first = deep >= 0 ? [deep, deep + 1, deep - 1].filter((i) => i >= 0 && i < N) : [0, 1, 2, 3];
  const order = [...first, ...PAINTINGS.map((_, i) => i).filter((i) => !first.includes(i))];
  const cardCache = new Map();
  const loadCard = (i) => {
    if (!cardCache.has(i)) {
      const p = PAINTINGS[i];
      cardCache.set(i, Promise.all([
        loadTexture(`assets/paintings/${p.id}-card.webp`),
        loadTexture(`assets/paintings/${p.id}-depth-sm.webp`, { mipmaps: false }),
      ]).then(([map, depth]) => ({ map, depth, pixels: readPixels(depth.image) })));
    }
    return cardCache.get(i);
  };

  // Full-size textures for the immersive view, loaded on demand.
  const full = new Map();
  const loadFull = (i) => {
    if (!full.has(i)) {
      const p = PAINTINGS[i];
      const opt = { flipY: false, mipmaps: false };
      const optional = (url) => loadTexture(url, opt).catch(() => null);
      const pr = Promise.all([
        loadTexture(`assets/paintings/${p.id}.webp`, opt),
        loadTexture(`assets/paintings/${p.id}-depth.webp`, opt),
        optional(`assets/paintings/${p.id}-plate.webp`),
        optional(`assets/paintings/${p.id}-bgdepth.webp`),
        loadCard(i),
      ]).then(([image, depth, plate, bgDepth, card]) => ({ image, depth, plate, bgDepth, pixels: card.pixels }));
      pr.catch(() => full.delete(i));
      full.set(i, pr);
    }
    return full.get(i);
  };

  let done = 0;
  const tick = () => {
    done++;
    const p = done / first.length;
    ui.loaderPct.textContent = `${Math.round(p * 100)}%`;
    ui.loaderBar.style.transform = `scaleX(${p})`;
    ui.loader.style.setProperty("--p", p.toFixed(3));
  };
  Promise.all(first.map((i) => loadCard(i).then((c) => (tick(), c)))).then(() => {
    run(loadCard, loadFull, order, deep);
  }).catch((err) => {
    console.error(err);
    ui.loader.querySelector(".loader-text").textContent = L().loadError;
  });
}

// ---------------------------------------------------------------- app
function run(loadCard, loadFull, order, deep) {
  const gallery = new Gallery(renderer, PAINTINGS);
  const sound = new Sound();
  const baseDpr = Math.min(devicePixelRatio || 1, finePointer ? 1.75 : 1.5);
  const TIERS = [
    { dpr: baseDpr, steps: finePointer ? 48 : 32 },
    { dpr: Math.min(baseDpr, 1.25), steps: 36 },
    { dpr: 1, steps: 28 },
    { dpr: 0.75, steps: 20 },
  ];
  const immersive = new Immersive(renderer, { steps: TIERS[0].steps });

  // Stream card textures in, nearest first.
  (async () => {
    for (const i of order) {
      try {
        const c = await loadCard(i);
        gallery.setTextures(i, c.map, c.depth, performance.now());
      } catch (err) {
        console.error(err);
      }
    }
  })();

  const S = {
    mode: "gallery", // gallery | entering | view | leaving | switching
    opening: deep >= 0 ? "done" : "waiting", // waiting | playing | done
    openingT0: 0,
    power: new Array(N).fill(deep >= 0 ? 1 : 0), pull: deep >= 0 ? 1 : PULL,
    T: deep >= 0 ? -1 : OPENING_C, C: deep >= 0 ? -1 : OPENING_C, vel: 0, introO: 1,
    tx: 0, ty: 0, px: 0, py: 0,
    tlx: 0.5, tly: 0.45, lx: 0.5, ly: 0.45,
    cx: innerWidth / 2, cy: innerHeight / 2, ccx: innerWidth / 2, ccy: innerHeight / 2,
    lastMove: -1e9, lastInput: -1e9, tilt: null,
    focusIndex: -1, focusT: 0, pendingOpen: -1,
    viewOpacity: 0, current: 0, chapter: 0,
    lights: "lamp", hover: -1,
    cam: { zoom: 0, cx: 0.5, cy: 0.5, ambient: 0.6, lamp: 0.55 }, camLock: false,
    loupe: [0.5, 0.5], loupeK: 0, loupeTarget: 0,
    thresh: -0.2, invert: 0,
    wheelAcc: 0, lastStep: 0,
    announced: -2,
    tier: 0, frameMs: 16.7, tierAt: 0, playing: "",
  };

  // ------------------------------------------------ captions & timeline DOM
  const cardEls = PAINTINGS.map((p, i) => {
    const cap = el("div", "card-cap");
    const artist = el("p");
    const title = el("h2");
    cap.append(artist, title);
    const btn = el("button", "card-open");
    btn.type = "button";
    btn.innerHTML = '<span aria-hidden="true">→</span>';
    btn.addEventListener("click", () => openPainting(i));
    const year = el("p", "card-year");
    const era = el("span", "e");
    year.append(el("span", "y", p.date), era);
    ui.cards.append(cap, btn, year);
    return { cap, btn, year, artist, title, era };
  });

  const scrubBtns = PAINTINGS.map((p, i) => {
    const li = el("li");
    const b = el("button", null, String(p.year));
    b.type = "button";
    b.addEventListener("click", () => { if (S.opening === "done") { S.T = i; S.lastInput = performance.now(); } });
    li.append(b);
    ui.scrubList.append(li);
    return b;
  });

  const chapterBtns = [0, 1, 2, 3, 4].map((c) => {
    const b = el("button");
    b.type = "button";
    b.addEventListener("click", () => setChapter(c));
    ui.chapters.append(b);
    return b;
  });

  let hotspotBtns = [];

  function labelGallery() {
    const u = L();
    PAINTINGS.forEach((p, i) => {
      cardEls[i].artist.textContent = p.artist;
      cardEls[i].title.textContent = p.title;
      cardEls[i].era.textContent = p.era;
      cardEls[i].btn.setAttribute("aria-label", u.open(p.title));
      scrubBtns[i].setAttribute("aria-label", `${p.date}, ${p.title}`);
    });
    chapterBtns.forEach((b, c) => b.setAttribute("aria-label", u.chapters[c]));
    labelToggles();
    ui.lights.title = u.lightsTitle;
  }
  labelGallery();

  // ------------------------------------------------ view content
  function fillView(i) {
    const u = L();
    const p = PAINTINGS[i];
    $("#v-eyebrow").textContent = `${p.date} · ${p.era}`;
    $("#v-original").textContent = p.original;
    $("#v-title").textContent = p.title;
    $("#v-artist").textContent = p.artist;
    $("#v-lead").textContent = p.lead;
    const next = PAINTINGS[i + 1];
    $("#n-eyebrow").textContent = next ? u.next(next.date) : u.endEyebrow;
    $("#n-title").textContent = next ? next.title : u.endTitle;
    $("#n-go-label").textContent = next ? u.continue : u.leave;

    ui.hotspots.textContent = "";
    hotspotBtns = p.hotspots.map((h, k) => {
      const b = el("button", "hotspot", String(k + 1));
      b.type = "button";
      b.setAttribute("aria-label", u.detailLabel(k + 1, h.title));
      b.addEventListener("click", () => setChapter(k + 1));
      ui.hotspots.append(b);
      return b;
    });
  }

  function setChapter(c, quiet) {
    c = clamp(c, 0, 4);
    S.chapter = c;
    const p = PAINTINGS[S.current];
    if (c >= 1 && c <= 3) {
      const h = p.hotspots[c - 1];
      $("#d-num").textContent = L().detailOf(c);
      $("#d-title").textContent = h.title;
      $("#d-text").textContent = h.text;
    }
    ui.view.querySelectorAll(".view-panel").forEach((panel) => {
      const ch = panel.dataset.chapter;
      panel.classList.toggle("on", ch === "detail" ? c >= 1 && c <= 3 : Number(ch) === c);
    });
    // Restart the detail card's entrance when stepping between details.
    const detail = ui.view.querySelector(".view-detail");
    if (c >= 1 && c <= 3 && !quiet) {
      detail.classList.remove("on");
      void detail.offsetWidth;
      detail.classList.add("on");
    }
    chapterBtns.forEach((b, k) => b.classList.toggle("on", k === c));
    hotspotBtns.forEach((b, k) => b.classList.toggle("on", k === c - 1));
    if (c >= 1 && c <= 3 && !quiet) announce(p.hotspots[c - 1].title);
  }

  function viewTarget() {
    const Lt = LIGHT[S.lights];
    const p = PAINTINGS[S.current];
    if (S.chapter === 0) return { zoom: 0.04, cx: 0.5, cy: 0.5, ambient: Lt.overview[0], lamp: Lt.overview[1] };
    if (S.chapter <= 3) {
      const h = p.hotspots[S.chapter - 1];
      return { zoom: h.zoom, cx: h.x, cy: h.y, ambient: Lt.detail[0], lamp: Lt.detail[1] };
    }
    return { zoom: 0, cx: 0.5, cy: 0.5, ambient: Lt.next[0], lamp: Lt.next[1] };
  }

  const announce = (msg) => { ui.announce.textContent = msg; };
  const describe = (i) => {
    const p = PAINTINGS[i];
    return `${p.date}: ${p.title}, ${p.artist}`;
  };

  // ------------------------------------------------ opening
  // Entering never turns sound on by itself; only the sound button does.
  function startOpening() {
    if (S.opening !== "waiting") return;
    S.opening = "playing";
    S.openingT0 = performance.now();
    sound.swell(OPENING * 0.9);
    // Dolly in while swinging back round the arc to the first painting.
    tween(OPENING, (k) => {
      const e = easeInOut(k);
      S.pull = lerp(PULL, 1, e);
      S.T = S.C = lerp(OPENING_C, 0, e);
      S.introO = 1 - smoothstep(0, 0.18, k);
    }, () => {
      S.T = S.C = 0;
      S.opening = "done";
      S.power.fill(1);
      ui.intro.classList.add("entered");
    });
  }

  // ------------------------------------------------ transitions
  openPainting = (i) => {
    if (S.mode !== "gallery") return;
    if (S.opening !== "done") {
      S.opening = "done";
      S.power.fill(1);
      S.pull = 1;
      ui.intro.classList.add("entered");
    }
    if (Math.abs(S.C - i) < 0.03) enter(i);
    else {
      S.T = i;
      S.pendingOpen = i;
      loadFull(i);
    }
  };

  function enter(i) {
    if (S.mode !== "gallery") return;
    S.mode = "entering";
    S.pendingOpen = -1;
    S.focusIndex = i;
    S.current = i;
    S.T = i;
    const ready = loadFull(i);
    const f0 = S.focusT;
    tween(1.15, (k) => { S.focusT = lerp(f0, 1, easeInOut(k)); }, async () => {
      let tex;
      try {
        tex = await ready;
      } catch (err) {
        console.error(err);
        S.mode = "leaving";
        tween(0.8, (k) => { S.focusT = 1 - easeInOut(k); }, () => { S.focusIndex = -1; S.mode = "gallery"; });
        return;
      }
      const ov = LIGHT[S.lights].overview;
      immersive.set(PAINTINGS[i], tex, tex.pixels);
      Object.assign(S.cam, { zoom: 0, cx: 0.5, cy: 0.5, ambient: ov[0], lamp: ov[1] });
      S.thresh = -0.2;
      S.invert = 0;
      fillView(i);
      setChapter(0);
      ui.view.classList.add("on");
      ui.view.setAttribute("aria-hidden", "false");
      tween(0.35, (k) => { S.viewOpacity = k; }, () => {
        S.mode = "view";
        if (i + 1 < N) loadFull(i + 1);
      });
      setHash(i);
      announce(describe(i));
    });
  }

  function leave(after) {
    if (S.mode !== "view") return;
    S.mode = "leaving";
    S.loupeTarget = 0;
    ui.view.classList.remove("on");
    ui.view.setAttribute("aria-hidden", "true");
    // Glide the camera back to the full frame so the hand-off to the card is seamless.
    S.camLock = true;
    const from = { ...S.cam };
    const ov = LIGHT[S.lights].overview;
    tween(0.6, (k) => {
      const e = easeInOut(k);
      S.cam.zoom = lerp(from.zoom, 0, e);
      S.cam.cx = lerp(from.cx, 0.5, e);
      S.cam.cy = lerp(from.cy, 0.5, e);
      S.cam.ambient = lerp(from.ambient, ov[0], e);
      S.cam.lamp = lerp(from.lamp, ov[1], e);
    }, () => {
      tween(0.3, (k) => { S.viewOpacity = 1 - k; }, () => {
        S.camLock = false;
        tween(1.0, (k) => { S.focusT = 1 - easeInOut(k); }, () => {
          S.focusIndex = -1;
          S.mode = "gallery";
          if (after) after();
        });
      });
    });
    setHash(null);
  }

  function switchTo(j) {
    if (S.mode !== "view" || j < 0 || j >= N || j === S.current) return;
    S.mode = "switching";
    S.loupeTarget = 0;
    ui.view.classList.add("swapping");
    const ready = loadFull(j);
    tween(0.9, (k) => { S.invert = 0; S.thresh = lerp(-0.15, 1.08, k); }, async () => {
      let tex;
      try {
        tex = await ready;
      } catch (err) {
        console.error(err);
        S.thresh = -0.2;
        S.mode = "view";
        ui.view.classList.remove("swapping");
        return;
      }
      const ov = LIGHT[S.lights].overview;
      immersive.set(PAINTINGS[j], tex, tex.pixels);
      S.current = j;
      S.focusIndex = j;
      S.T = S.C = j;
      S.focusT = 1;
      Object.assign(S.cam, { zoom: 0, cx: 0.5, cy: 0.5, ambient: ov[0], lamp: ov[1] });
      fillView(j);
      setChapter(0);
      S.invert = 1;
      setHash(j, true);
      announce(describe(j));
      tween(1.1, (k) => { S.thresh = lerp(1.08, -0.15, k); }, () => {
        S.mode = "view";
        ui.view.classList.remove("swapping");
        if (j + 1 < N) loadFull(j + 1);
      });
    });
  }

  function continueNext() {
    if (S.current + 1 < N) switchTo(S.current + 1);
    else leave(() => { S.T = N; S.lastInput = performance.now(); });
  }

  function stepChapter(d) {
    const c = S.chapter + d;
    if (c > 4) return continueNext();
    if (c < 0) return;
    setChapter(c);
  }

  // ------------------------------------------------ routing
  const indexOf = (id) => PAINTINGS.findIndex((p) => p.id === id);
  const hashIndex = () => indexOf(location.hash.replace(/^#\/?/, ""));
  function setHash(i, replace) {
    const h = i == null ? "#/" : `#/${PAINTINGS[i].id}`;
    if (location.hash === h) return;
    history[replace ? "replaceState" : "pushState"](null, "", h);
  }
  addEventListener("popstate", () => {
    const i = hashIndex();
    if (i >= 0) {
      if (S.mode === "gallery") { S.C = S.T = i; openPainting(i); }
      else if (S.mode === "view") switchTo(i);
    } else if (S.mode === "view") leave();
  });
  document.querySelector("[data-home]").addEventListener("click", (e) => {
    e.preventDefault();
    if (S.mode === "view") leave(() => { S.T = -1; });
    else if (S.mode === "gallery" && S.opening === "done") { S.T = -1; S.lastInput = performance.now(); }
  });

  // ------------------------------------------------ controls
  // Labels double as aria-labels: on phones only the icons are shown.
  function labelToggles() {
    const u = L();
    const lt = S.lights === "on" ? u.lightsOn : u.lamp;
    const st = sound.on ? u.soundOff : u.soundOn;
    ui.lights.querySelector(".toggle-label").textContent = lt;
    ui.lights.setAttribute("aria-label", lt);
    ui.sound.querySelector(".toggle-label").textContent = st;
    ui.sound.setAttribute("aria-label", sound.on ? u.soundOffLabel : u.soundOnLabel);
  }

  function setSound(on) {
    sound.enable(on);
    ui.sound.setAttribute("aria-pressed", String(sound.on));
    labelToggles();
  }
  ui.sound.addEventListener("click", () => setSound(!sound.on));

  const toggleLights = () => {
    S.lights = S.lights === "lamp" ? "on" : "lamp";
    ui.lights.setAttribute("aria-pressed", String(S.lights === "on"));
    labelToggles();
    sound.swell(1.1, 0.55);
  };
  ui.lights.addEventListener("click", toggleLights);
  $("#view-back").addEventListener("click", () => leave());
  ui.view.querySelector("[data-step]").addEventListener("click", () => setChapter(1));
  $("#n-go").addEventListener("click", continueNext);

  const snapValue = (T) => {
    if (T < 0) return T < -0.5 ? -1 : 0;
    if (T > N - 1) return T > N - 0.5 ? N : N - 1;
    return Math.round(T);
  };

  const wheelDelta = (e) => {
    let d = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY;
    if (e.deltaMode === 1) d *= 16;
    else if (e.deltaMode === 2) d *= innerHeight;
    return d;
  };

  addEventListener("wheel", (e) => {
    const d = wheelDelta(e);
    if (S.mode === "gallery") {
      // Let the wall scroll natively once we are on it.
      if (e.target instanceof Node && ui.wall.contains(e.target) && S.C > N - 0.1 && (ui.wall.scrollTop > 0 || d > 0)) return;
      e.preventDefault();
      if (S.opening === "waiting") { if (d > 4) startOpening(); return; }
      if (S.opening === "playing") return;
      S.T = clamp(S.T + d * 0.0022, -1, N);
      S.lastInput = performance.now();
    } else {
      e.preventDefault();
      if (S.mode === "view") {
        S.wheelAcc += d;
        const now = performance.now();
        if (Math.abs(S.wheelAcc) > 50 && now - S.lastStep > 650) {
          stepChapter(Math.sign(S.wheelAcc));
          S.wheelAcc = 0;
          S.lastStep = now;
        }
      }
    }
  }, { passive: false });

  addEventListener("keydown", (e) => {
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    const k = e.key;
    if (k === "l" || k === "L") return toggleLights();
    const onButton = e.target.closest && e.target.closest("button, a");
    if (S.mode === "gallery") {
      if (S.opening === "waiting") {
        if (["Enter", " "].includes(k) && !onButton) { e.preventDefault(); startOpening(); }
        else if (["ArrowRight", "ArrowDown", "PageDown"].includes(k)) { e.preventDefault(); startOpening(); }
        return;
      }
      if (S.opening === "playing") return;
      let d = 0;
      if (["ArrowRight", "ArrowDown", "PageDown"].includes(k) || (k === " " && !onButton)) d = 1;
      if (["ArrowLeft", "ArrowUp", "PageUp"].includes(k)) d = -1;
      if (d) {
        e.preventDefault();
        S.T = clamp(snapValue(S.T) + d, -1, N);
        S.lastInput = performance.now();
      } else if (k === "Home") S.T = -1;
      else if (k === "End") S.T = N;
      else if (k === "Enter" && !onButton) {
        const i = Math.round(S.C);
        if (i >= 0 && i < N) openPainting(i);
      }
    } else if (S.mode === "view") {
      if (["ArrowDown", "PageDown"].includes(k) || (k === " " && !onButton)) { e.preventDefault(); stepChapter(1); }
      else if (["ArrowUp", "PageUp"].includes(k)) { e.preventDefault(); stepChapter(-1); }
      else if (k === "ArrowRight") switchTo(S.current + 1);
      else if (k === "ArrowLeft") switchTo(S.current - 1);
      else if (k === "Escape" || k === "Backspace") leave();
    }
  });

  // Pointer: lamp + parallax everywhere; drag to travel the gallery; in the
  // view, press-and-hold for the loupe and swipe for chapters / paintings.
  const drag = { on: false, id: null, x0: 0, y0: 0, T0: 0, moved: false, axis: null, timer: 0 };
  const uiTarget = (t) => t.closest && t.closest("button, a, .wall, .scrub-track");

  function pointerAt(x, y) {
    S.tlx = x / innerWidth;
    S.tly = y / innerHeight;
    S.tx = (x / innerWidth - 0.5) * 2;
    S.ty = (y / innerHeight - 0.5) * 2;
    S.cx = x;
    S.cy = y;
    S.lastMove = performance.now();
  }

  addEventListener("pointermove", (e) => {
    pointerAt(e.clientX, e.clientY);
    if (e.pointerType === "mouse") ui.cursor.classList.add("on");
    if (!drag.on || e.pointerId !== drag.id) return;
    const dx = e.clientX - drag.x0, dy = e.clientY - drag.y0;
    if (!drag.moved && Math.hypot(dx, dy) > 8) {
      drag.moved = true;
      drag.axis = Math.abs(dx) > Math.abs(dy) ? "x" : "y";
      if (S.loupeTarget === 0) clearTimeout(drag.timer);
    }
    if (S.mode === "gallery" && drag.moved) {
      if (S.opening === "waiting") { startOpening(); drag.on = false; return; }
      if (S.opening !== "done") return;
      const r = gallery.cardRect(clamp(Math.round(S.C), 0, N - 1));
      const per = Math.max(120, (r.x1 - r.x0) * 1.1);
      const d = drag.axis === "x" ? dx : dy * (e.pointerType === "mouse" ? 0 : 1);
      S.T = clamp(drag.T0 - d / per, -1, N);
      S.lastInput = performance.now();
    }
    if (S.loupeTarget > 0) S.loupe = [e.clientX / innerWidth, e.clientY / innerHeight];
  });

  addEventListener("pointerdown", (e) => {
    if (e.button > 0 || uiTarget(e.target)) return;
    pointerAt(e.clientX, e.clientY);
    Object.assign(drag, { on: true, id: e.pointerId, x0: e.clientX, y0: e.clientY, T0: S.T, moved: false, axis: null });
    if (S.mode === "view") {
      drag.timer = setTimeout(() => {
        if (drag.on && (!drag.moved || e.pointerType === "mouse")) {
          S.loupe = [S.cx / innerWidth, S.cy / innerHeight];
          S.loupeTarget = 1;
          ui.cursor.classList.add("hide");
        }
      }, e.pointerType === "mouse" ? 220 : 380);
    }
  });

  const endDrag = (e) => {
    if (!drag.on || e.pointerId !== drag.id) return;
    drag.on = false;
    clearTimeout(drag.timer);
    const dx = e.clientX - drag.x0, dy = e.clientY - drag.y0;
    if (S.loupeTarget > 0) {
      S.loupeTarget = 0;
      ui.cursor.classList.remove("hide");
      return;
    }
    if (S.mode === "gallery") {
      if (!drag.moved && e.type === "pointerup") {
        if (S.opening === "waiting") return startOpening();
        if (S.opening !== "done") return;
        // Click: open the centered card, or travel to the one clicked.
        const hit = hitCard(e.clientX, e.clientY);
        if (hit >= 0) {
          if (Math.abs(S.C - hit) < 0.3) openPainting(hit);
          else { S.T = hit; S.lastInput = performance.now(); }
        }
      }
    } else if (S.mode === "view" && drag.moved && e.pointerType !== "mouse") {
      if (drag.axis === "y" && Math.abs(dy) > 50) stepChapter(dy < 0 ? 1 : -1);
      else if (drag.axis === "x" && Math.abs(dx) > 70) switchTo(S.current + (dx < 0 ? 1 : -1));
    }
  };
  addEventListener("pointerup", endDrag);
  addEventListener("pointercancel", endDrag);
  document.addEventListener("mouseleave", () => ui.cursor.classList.remove("on"));

  function hitCard(x, y) {
    let best = -1, bestActive = -1;
    gallery.cards.forEach((c, i) => {
      if (c.vis < 0.3 || !c.mesh.visible) return;
      const r = gallery.cardRect(i);
      if (x >= r.x0 && x <= r.x1 && y >= r.y0 && y <= r.y1 && c.active > bestActive) {
        best = i;
        bestActive = c.active;
      }
    });
    return best;
  }

  // Timeline scrubber: drag along the track.
  let scrubbing = false;
  const scrubTo = (x) => {
    const r = ui.scrubTrack.getBoundingClientRect();
    S.T = clamp(((x - r.left) / r.width) * N - 0.5, 0, N - 1);
    S.lastInput = performance.now();
  };
  ui.scrubTrack.addEventListener("pointerdown", (e) => {
    if (S.opening !== "done") return;
    scrubbing = true;
    ui.scrubTrack.setPointerCapture(e.pointerId);
    scrubTo(e.clientX);
  });
  ui.scrubTrack.addEventListener("pointermove", (e) => { if (scrubbing) scrubTo(e.clientX); });
  ui.scrubTrack.addEventListener("pointerup", () => { scrubbing = false; });

  // Phones: tilt to look around.
  function onTilt(e) {
    if (e.gamma == null) return;
    S.tilt = [clamp(e.gamma / 25, -1, 1), clamp((e.beta - 45) / 25, -1, 1)];
  }
  if (!finePointer && "DeviceOrientationEvent" in window) {
    if (typeof DeviceOrientationEvent.requestPermission === "function") {
      addEventListener("touchend", function ask() {
        removeEventListener("touchend", ask);
        DeviceOrientationEvent.requestPermission()
          .then((r) => r === "granted" && addEventListener("deviceorientation", onTilt))
          .catch(() => {});
      });
    } else {
      addEventListener("deviceorientation", onTilt);
    }
  }

  // ------------------------------------------------ layout & quality
  function resize() {
    const w = innerWidth, h = innerHeight;
    renderer.setPixelRatio(TIERS[S.tier].dpr);
    renderer.setSize(w, h, false);
    gallery.resize(w, h);
    immersive.resize(w, h);
  }
  addEventListener("resize", resize);
  resize();

  // Step quality down when frames run long, and back up when there is headroom.
  function adaptQuality(dtMs, now) {
    if (document.hidden || dtMs > 100) return;
    S.frameMs = S.frameMs * 0.95 + dtMs * 0.05;
    const since = now - S.tierAt;
    let tier = S.tier;
    if (S.frameMs > 26 && since > 2000 && tier < TIERS.length - 1) tier++;
    else if (S.frameMs < 13 && since > 8000 && tier > 0) tier--;
    if (tier === S.tier) return;
    S.tier = tier;
    S.tierAt = now;
    S.frameMs = 16.7;
    renderer.setPixelRatio(TIERS[tier].dpr);
    renderer.setSize(innerWidth, innerHeight, false);
    immersive.setSteps(TIERS[tier].steps);
  }

  const tintAt = (C) => {
    const c = clamp(C, 0, N - 1);
    const i = Math.floor(c), f = c - i;
    const a = PAINTINGS[i].tint, b = PAINTINGS[Math.min(N - 1, i + 1)].tint;
    return [lerp(a[0], b[0], f), lerp(a[1], b[1], f), lerp(a[2], b[2], f)];
  };

  // ------------------------------------------------ loop
  let last = performance.now();
  function frame(now) {
    const dtMs = now - last;
    const dt = Math.min(0.05, dtMs / 1000);
    last = now;
    const t = now / 1000;
    runTweens(now);
    adaptQuality(dtMs, now);

    // Parallax target: pointer, device tilt, or a slow idle drift.
    const idle = clamp01((now - S.lastMove - 2500) / 1500);
    let tx = S.tx, ty = S.ty;
    if (S.tilt) { tx = S.tilt[0]; ty = S.tilt[1]; }
    else if (idle > 0 && !reduceMotion) {
      tx = lerp(tx, Math.sin(t * 0.37) * 0.55, idle);
      ty = lerp(ty, Math.sin(t * 0.23 + 1.3) * 0.35, idle);
    }
    const motion = reduceMotion ? 0.35 : 1;
    S.px = damp(S.px, tx * motion, 3.2, dt);
    S.py = damp(S.py, ty * motion, 3.2, dt);

    let ltx = S.tlx, lty = S.tly;
    if (!finePointer && S.lastMove < 0) {
      ltx = 0.5 + Math.sin(t * 0.5) * 0.18;
      lty = 0.45 + Math.cos(t * 0.31) * 0.08;
    }
    S.lx = damp(S.lx, ltx, 5, dt);
    S.ly = damp(S.ly, lty, 5, dt);

    S.ccx = damp(S.ccx, S.cx, 18, dt);
    S.ccy = damp(S.ccy, S.cy, 18, dt);
    ui.cursor.style.transform = `translate(${S.ccx.toFixed(1)}px, ${S.ccy.toFixed(1)}px)`;

    // Opening: spotlights switch on one by one.
    if (S.opening === "playing") {
      const st = (now - S.openingT0) / 1000;
      for (let i = 0; i < N; i++) S.power[i] = powerAt(i, st);
    }

    // Gallery travel, with a gentle snap to the nearest stop once input stops.
    if (S.mode === "gallery" && S.opening === "done" && !drag.on && !scrubbing && now - S.lastInput > 160) S.T = snapValue(S.T);
    const prevC = S.C;
    S.C = damp(S.C, S.T, 5.5, dt);
    if (Math.abs(S.C - S.T) < 1e-4) S.C = S.T;
    S.vel = damp(S.vel, (S.C - prevC) / Math.max(dt, 1e-3), 8, dt);
    if (S.opening === "playing") S.vel = 0;
    if (S.pendingOpen >= 0 && Math.abs(S.C - S.pendingOpen) < 0.03) enter(S.pendingOpen);

    const Lt = LIGHT[S.lights];
    const introK = S.opening === "done" ? smoothstep(-1, -0.2, S.C) : 1;
    const wallK = smoothstep(N - 1 + 0.25, N - 0.15, S.C);
    const fe = S.focusT * S.focusT * (3 - 2 * S.focusT);

    // Hover lean on the card under a mouse.
    S.hover = finePointer && S.mode === "gallery" && S.opening === "done" && !drag.on && wallK < 0.5 ? hitCard(S.cx, S.cy) : -1;

    renderer.clear();
    if (S.viewOpacity < 0.999) {
      gallery.update({
        C: S.C, vel: S.vel, time: t, now,
        mouse: [S.px, S.py], light: [S.lx, S.ly],
        ambient: lerp(0.03, Lt.gallery[0], introK),
        lamp: S.opening === "waiting" ? 1.2 : lerp(1.2, Lt.gallery[1], introK),
        tint: tintAt(S.C), power: S.power, hover: S.hover, pull: S.pull,
        focusIndex: S.focusIndex, focusT: S.focusT,
        focusFit: S.focusIndex >= 0 ? fitHeight(innerWidth / innerHeight, PAINTINGS[S.focusIndex].aspect) : 1,
        focusAmbient: Lt.overview[0], focusLamp: Lt.overview[1],
        cardsVis: 1 - wallK, floorVis: 1 - wallK * 0.75,
      });
      gallery.render();
    }

    if (S.viewOpacity > 0.001) {
      if (!S.camLock) {
        const vt = viewTarget();
        const k = S.mode === "switching" ? 0 : 2.4;
        S.cam.zoom = damp(S.cam.zoom, vt.zoom, k, dt);
        S.cam.cx = damp(S.cam.cx, vt.cx, k, dt);
        S.cam.cy = damp(S.cam.cy, vt.cy, k, dt);
        S.cam.ambient = damp(S.cam.ambient, vt.ambient, 3, dt);
        S.cam.lamp = damp(S.cam.lamp, vt.lamp, 3, dt);
      }
      S.loupeK = damp(S.loupeK, S.loupeTarget, 14, dt);
      const portrait = innerWidth < innerHeight * 0.9;
      immersive.update({
        zoom: S.cam.zoom, cx: S.cam.cx, cy: S.cam.cy,
        target: portrait ? [0.5, 0.36] : [0.64, 0.46],
        par: [S.px * PARALLAX, S.py * PARALLAX * 0.7],
        light: [S.lx, S.ly],
        ambient: S.cam.ambient, lamp: S.cam.lamp,
        loupe: [S.loupe[0], S.loupe[1], S.loupeK],
        thresh: S.thresh, invert: S.invert,
        opacity: S.viewOpacity, time: t,
      });
      renderer.clearDepth();
      immersive.render();
    }

    // ---------------- DOM overlays
    const inGallery = S.mode === "gallery" || S.mode === "entering" || S.mode === "leaving";
    const introO = S.opening === "done" ? 1 - smoothstep(-0.85, -0.4, S.C) : S.introO;
    ui.intro.style.opacity = (introO * (1 - fe)).toFixed(3);

    const capsK = (S.opening === "done" ? introK : smoothstep(1.35, 1.05, S.pull)) * (1 - wallK) * (1 - fe) * (inGallery ? 1 : 0);
    gallery.cards.forEach((c, i) => {
      const e = cardEls[i];
      const show = c.mesh.visible && capsK > 0.01 && c.vis > 0.02;
      if (!show) {
        e.cap.style.opacity = e.btn.style.opacity = e.year.style.opacity = "0";
        e.btn.style.pointerEvents = "none";
        e.btn.tabIndex = -1;
        return;
      }
      const top = gallery.toScreen(gallery.cardPoint(i, 0, CARD_H / 2));
      const bot = gallery.toScreen(gallery.cardPoint(i, 0, -CARD_H / 2));
      const hpx = bot[1] - top[1];
      const sc = clamp(hpx / 560, 0.25, 1.6);
      const pad = CARD_H * 0.06;
      const capP = gallery.toScreen(gallery.cardPoint(i, -c.w / 2 + pad, -CARD_H / 2 + pad));
      const btnP = gallery.toScreen(gallery.cardPoint(i, c.w / 2 - pad, -CARD_H / 2 + pad));
      const yearP = gallery.toScreen(gallery.cardPoint(i, 0, -CARD_H / 2 - 0.3));
      const o = c.vis * capsK * S.power[i];
      e.cap.style.maxWidth = `${((c.w / CARD_H) * hpx * 0.72) / sc}px`;
      e.cap.style.whiteSpace = "normal";
      e.cap.style.transform = `translate(${capP[0].toFixed(1)}px, ${capP[1].toFixed(1)}px) translateY(-100%) scale(${sc.toFixed(3)})`;
      e.cap.style.opacity = (o * (0.3 + 0.7 * c.active)).toFixed(3);
      e.btn.style.transform = `translate(${btnP[0].toFixed(1)}px, ${btnP[1].toFixed(1)}px) scale(${clamp(sc, 0.6, 1.2).toFixed(3)})`;
      e.btn.style.opacity = (o * c.active).toFixed(3);
      e.btn.style.pointerEvents = o * c.active > 0.5 ? "auto" : "none";
      e.btn.tabIndex = o * c.active > 0.5 ? 0 : -1;
      e.year.style.transform = `translate(${yearP[0].toFixed(1)}px, ${yearP[1].toFixed(1)}px) translateX(-50%) scale(${sc.toFixed(3)})`;
      e.year.style.opacity = (o * (0.4 + 0.6 * c.active)).toFixed(3);
      e.year.classList.toggle("on", c.active > 0.5);
    });

    const scrubK = (S.opening === "done" ? introK : 0) * (1 - wallK) * (1 - fe) * (inGallery ? 1 : 0);
    ui.scrub.style.opacity = scrubK.toFixed(3);
    ui.scrub.style.visibility = scrubK > 0.01 ? "visible" : "hidden";
    const ci = clamp(Math.round(S.C), 0, N - 1);
    ui.scrubDot.style.left = `${((clamp(S.C, 0, N - 1) + 0.5) / N) * 100}%`;
    scrubBtns.forEach((b, i) => b.classList.toggle("on", i === ci));

    const wallO = wallK * (inGallery ? 1 : 0);
    ui.wall.style.opacity = wallO.toFixed(3);
    ui.wall.classList.toggle("live", wallO > 0.01);
    ui.wall.style.pointerEvents = wallO > 0.5 ? "auto" : "none";
    document.body.classList.toggle("on-wall", wallO > 0.5);

    // Announce the painting in front of you.
    const nearest = S.C < -0.5 ? -1 : S.C > N - 0.5 ? N : ci;
    if (inGallery && S.opening === "done" && nearest !== S.announced && Math.abs(S.C - S.T) < 0.05) {
      S.announced = nearest;
      if (nearest >= 0 && nearest < N) announce(describe(nearest));
    }

    // Hotspot markers ride on the 3D surface.
    if (S.viewOpacity > 0.01) {
      const p = PAINTINGS[S.current];
      hotspotBtns.forEach((b, k) => {
        const [x, y] = immersive.project(p.hotspots[k].x, p.hotspots[k].y);
        const vis = S.chapter === 0 ? 1 : S.chapter === k + 1 ? 1 : S.chapter <= 3 ? 0.35 : 0;
        const inside = x > 24 && y > 90 && x < innerWidth - 60 && y < innerHeight - 50;
        b.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px)`;
        b.style.opacity = (inside && S.mode === "view" ? vis * (1 - S.loupeK) : 0).toFixed(3);
        b.style.pointerEvents = inside && vis > 0.5 ? "auto" : "none";
      });
    }

    // Cursor label over the centered card.
    if (finePointer) {
      let label = "";
      if (S.hover >= 0 && introK > 0.5 && !document.elementFromPoint(S.cx, S.cy)?.closest("button, a")) {
        label = Math.abs(S.C - S.hover) < 0.3 ? L().cursorView : L().cursorGo;
      }
      if (ui.cursorLabel.textContent !== label) ui.cursorLabel.textContent = label;
      ui.cursor.classList.toggle("label", !!label);
    }

    // Era soundtrack: follow the painting you have settled on.
    if (S.viewOpacity > 0.5 || (S.mode !== "gallery" && S.focusIndex >= 0)) sound.setEra(PAINTINGS[S.current].music);
    else if (S.opening !== "done") sound.setEra(PAINTINGS[0].music);
    else if (Math.abs(S.C - S.T) < 0.5) sound.setEra(PAINTINGS[clamp(Math.round(S.T), 0, N - 1)].music);
    sound.duck(S.viewOpacity > 0.5 || wallK > 0.5);
    const playing = sound.on && sound.voice ? sound.voice.era : "";
    if (playing !== S.playing) {
      S.playing = playing;
      ui.nowPlaying.classList.toggle("on", !!playing);
      if (playing) ui.nowPlaying.textContent = `♪ ${TRACKS[playing].title} · ${TRACKS[playing].year}`;
    }

    S.wheelAcc = damp(S.wheelAcc, 0, 3, dt);
    requestAnimationFrame(frame);
  }

  // ------------------------------------------------ go
  document.body.classList.remove("is-loading");
  ui.loader.classList.add("done");
  if (deep >= 0) {
    ui.intro.classList.add("entered");
    S.T = S.C = deep;
    enter(deep);
  }
  requestAnimationFrame(frame);
}
