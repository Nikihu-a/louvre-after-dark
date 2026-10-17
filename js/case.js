// An investigation played inside a painting (data: `case` in data.js).
//
//   intro  → search → clue → search → … → accuse → file
//
// While searching the room is dimmed and the lamp is the only way to see:
// hold it over something suspicious (or tap it) to find a clue. The camera
// dollies in, the clue card opens, and any glance it reveals is drawn as a
// thread of light between the two figures. With the evidence in hand you name
// who is in on it, and the case file tells you how you did and what the
// painting is really about.

const el = (tag, cls, txt) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (txt != null) e.textContent = txt;
  return e;
};
const clamp01 = (x) => Math.min(1, Math.max(0, x));
const smoothstep = (a, b, x) => {
  const t = clamp01((x - a) / (b - a));
  return t * t * (3 - 2 * t);
};
const SVG = "http://www.w3.org/2000/svg";
const DWELL = 0.8; // seconds the lamp must rest on a clue

export class Case {
  constructor({ root, project, chime, finePointer, onState }) {
    this.root = root;
    this.project = project;
    this.chime = chime || (() => {});
    this.fine = finePointer;
    this.onState = onState || (() => {});
    this.data = null;
    this.state = "off";
    this.found = new Set();
    this.picked = new Set();
    this.current = null;
    this.dwell = 0;
    this.dwellOn = null;
    this.warmth = 0;
    this.hinted = null;
  }

  get active() { return this.state !== "off"; }

  // ------------------------------------------------------------ setup
  load(painting) {
    this.exit(true);
    this.data = painting && painting.case ? painting.case : null;
    this.root.textContent = "";
    if (!this.data) return;
    const d = this.data;

    // Threads of light between figures (one per clue with a `look`).
    this.svg = document.createElementNS(SVG, "svg");
    this.svg.setAttribute("class", "case-lines");
    this.svg.setAttribute("aria-hidden", "true");
    this.lines = new Map();
    d.clues.forEach((c) => {
      if (!c.look) return;
      const path = document.createElementNS(SVG, "path");
      path.setAttribute("pathLength", "1");
      this.svg.append(path);
      this.lines.set(c.id, path);
    });

    // Marks for found clues (click to reread), the hint ring, the suspects.
    this.marks = el("div", "case-marks");
    this.markEls = new Map();
    d.clues.forEach((c) => {
      const b = el("button", "case-mark");
      b.type = "button";
      b.setAttribute("aria-label", c.title);
      b.addEventListener("click", () => this.open(c, true));
      this.marks.append(b);
      this.markEls.set(c.id, b);
    });
    this.hintEl = el("button", "case-hint-ring");
    this.hintEl.type = "button";
    this.hintEl.addEventListener("click", () => this.hinted && this.find(this.hinted));
    this.marks.append(this.hintEl);
    this.suspectEls = d.suspects.map((s) => {
      const b = el("button", "case-suspect");
      b.type = "button";
      b.setAttribute("aria-pressed", "false");
      b.append(el("span", "ring"), el("span", "name", s.name));
      b.addEventListener("click", () => this.pick(s.id, b));
      this.marks.append(b);
      return b;
    });

    // HUD: progress and a hint.
    this.hud = el("div", "case-hud");
    this.hudCount = el("p", "case-count");
    this.hudHint = el("p", "case-hint", this.fine ? d.searchHint : d.searchHintTouch);
    const hintBtn = el("button", "case-hint-btn", "Hint");
    hintBtn.type = "button";
    hintBtn.addEventListener("click", () => this.hint());
    this.hud.append(this.hudCount, this.hudHint, hintBtn);

    const exit = el("button", "case-exit");
    exit.type = "button";
    exit.innerHTML = '<span aria-hidden="true">×</span> <span>Leave the investigation</span>';
    exit.addEventListener("click", () => this.exit());

    // Panels.
    this.panels = {};
    const intro = this.panel("intro");
    intro.append(el("p", "eyebrow", d.kicker), el("h2", null, d.title), el("p", "lead", d.intro));
    intro.append(this.pill(d.start, () => this.go("search")));

    const clue = this.panel("clue");
    this.clueNum = el("p", "num");
    this.clueTitle = el("h3");
    this.clueText = el("p", "text");
    this.clueActions = el("div", "actions");
    clue.append(this.clueNum, this.clueTitle, this.clueText, this.clueActions);

    const accuse = this.panel("accuse");
    accuse.append(el("h3", null, d.accuse.title), el("p", "text", d.accuse.text));
    this.accuseBtn = this.pill(d.accuse.button, () => this.verdict());
    this.accuseBtn.disabled = true;
    accuse.append(this.accuseBtn);

    const file = this.panel("file");
    this.fileHead = el("div", "file-head");
    this.fileRoll = el("ul", "file-roll");
    const sections = el("div", "file-sections");
    sections.append(el("p", "eyebrow", d.fileTitle));
    d.file.forEach((s) => {
      const sec = el("section");
      sec.append(el("h4", null, s.h), el("p", null, s.p));
      sections.append(sec);
    });
    file.append(this.fileHead, this.fileRoll, sections, this.pill(d.again, () => this.exit()));

    this.root.append(this.svg, this.marks, this.hud, exit, ...Object.values(this.panels));
  }

  panel(name) {
    const p = el("div", `case-panel case-${name}`);
    this.panels[name] = p;
    return p;
  }

  pill(label, fn) {
    const b = el("button", "pill");
    b.type = "button";
    b.innerHTML = `<b></b> <span aria-hidden="true">→</span>`;
    b.querySelector("b").textContent = label;
    b.addEventListener("click", fn);
    return b;
  }

  // ------------------------------------------------------------ flow
  start() {
    if (!this.data) return;
    this.found.clear();
    this.picked.clear();
    this.suspectEls.forEach((b) => { b.classList.remove("picked", "guilty", "innocent"); b.setAttribute("aria-pressed", "false"); });
    this.lines.forEach((p) => p.classList.remove("on"));
    this.hinted = null;
    this.go("intro");
  }

  go(state) {
    this.state = state;
    this.dwell = 0;
    this.dwellOn = null;
    if (state !== "search") this.hinted = null;
    this.root.className = `case on is-${state}`;
    Object.entries(this.panels).forEach(([k, p]) => p.classList.toggle("on", k === state));
    this.updateCount();
    this.onState(state);
    const focus = this.panels[state] && this.panels[state].querySelector("button");
    if (focus && !this.fine) focus.blur();
    else if (focus) setTimeout(() => focus.focus({ preventScroll: true }), 400);
  }

  exit(silent) {
    if (this.state === "off") return;
    this.state = "off";
    this.root.className = "case";
    if (this.panels) Object.values(this.panels).forEach((p) => p.classList.remove("on"));
    if (!silent) this.onState("off");
  }

  main() { return this.data.clues.filter((c) => !c.bonus); }
  foundMain() { return this.main().filter((c) => this.found.has(c.id)).length; }

  updateCount() {
    if (!this.data) return;
    const bonus = this.data.clues.some((c) => c.bonus && this.found.has(c.id));
    this.hudCount.textContent = this.data.progress(this.foundMain(), this.main().length) + (bonus ? "  ·  + 1 bonus" : "");
  }

  find(c) {
    if (this.found.has(c.id)) return this.open(c, true);
    this.found.add(c.id);
    this.chime(c.bonus ? 2 : 1);
    const line = this.lines.get(c.id);
    if (line) requestAnimationFrame(() => line.classList.add("on"));
    this.open(c, false);
  }

  open(c, reread) {
    this.current = c;
    const d = this.data;
    const done = this.foundMain() >= this.main().length;
    this.clueNum.textContent = c.bonus ? "Bonus" : `Evidence ${this.main().indexOf(c) + 1}`;
    this.clueTitle.textContent = c.title;
    this.clueText.textContent = c.text;
    this.clueActions.textContent = "";
    if (done) this.clueActions.append(this.pill(d.toAccuse, () => this.go("accuse")));
    if (!done || reread) {
      const keep = this.pill(d.keepSearching, () => this.go("search"));
      if (done) keep.classList.add("ghost");
      this.clueActions.append(keep);
    }
    this.go("clue");
    // Restart the card's entrance.
    const p = this.panels.clue;
    p.classList.remove("on");
    void p.offsetWidth;
    p.classList.add("on");
  }

  hint() {
    if (this.state !== "search") return;
    const next = this.data.clues.find((c) => !c.bonus && !this.found.has(c.id));
    this.hinted = next || null;
    if (this.hinted) this.hintEl.focus({ preventScroll: true });
  }

  pick(id, b) {
    if (this.state !== "accuse") return;
    if (this.picked.has(id)) this.picked.delete(id);
    else this.picked.add(id);
    b.classList.toggle("picked", this.picked.has(id));
    b.setAttribute("aria-pressed", String(this.picked.has(id)));
    this.accuseBtn.disabled = this.picked.size === 0;
  }

  verdict() {
    const d = this.data;
    const right = d.suspects.every((s) => s.guilty === this.picked.has(s.id));
    const r = right ? d.right : d.wrong;
    this.fileHead.textContent = "";
    this.fileHead.append(el("h2", null, r.title), el("p", "lead", r.text));
    this.fileRoll.textContent = "";
    d.suspects.forEach((s, i) => {
      const li = el("li", s.guilty ? "guilty" : "innocent");
      li.append(el("b", null, s.name), el("span", "tag", s.guilty ? "In on it" : "Innocent"), el("p", null, s.verdict));
      this.fileRoll.append(li);
      this.suspectEls[i].classList.add(s.guilty ? "guilty" : "innocent");
    });
    this.chime(right ? 3 : 1);
    this.go("file");
    this.panels.file.scrollTop = 0;
  }

  // ------------------------------------------------------------ input
  // A click or tap in the view while investigating. Returns true if used.
  tap(x, y) {
    if (this.state !== "search") return this.state !== "off";
    const c = this.nearest(x, y, 1.25);
    if (c) this.find(c);
    return true;
  }

  key(k) {
    if (this.state === "off") return false;
    if (k === "Escape" || k === "Backspace") {
      if (this.state === "clue") this.go("search");
      else this.exit();
      return true;
    }
    if (k === "h" || k === "H") { this.hint(); return true; }
    return true; // swallow navigation keys while investigating
  }

  nearest(x, y, slack = 1) {
    const s = Math.min(innerWidth, innerHeight);
    let best = null, bd = Infinity;
    for (const c of this.data.clues) {
      if (this.found.has(c.id)) continue;
      const [px, py] = this.project(c.x, c.y);
      const dist = Math.hypot(px - x, py - y) / (c.r * s);
      if (dist < slack && dist < bd) { best = c; bd = dist; }
    }
    return best;
  }

  // ------------------------------------------------------------ camera
  cam(light) {
    const c = this.current;
    switch (this.state) {
      case "intro": return { zoom: 0.06, cx: 0.4, cy: 0.5, ambient: 0.42, lamp: 0.75 };
      // Touch screens have no lamp to steer, so the room stays brighter there.
      case "search": return { zoom: 0.03, cx: 0.5, cy: 0.5, ambient: light === "on" || !this.fine ? 0.5 : 0.17, lamp: 1.15 };
      case "clue": return { zoom: c.zoom, cx: c.x, cy: c.y, ambient: 0.55, lamp: 0.55 };
      case "accuse": return { zoom: 0.0, cx: 0.5, cy: 0.5, ambient: 0.62, lamp: 0.4 };
      default: return { zoom: 0.0, cx: 0.5, cy: 0.5, ambient: 0.3, lamp: 0.3 };
    }
  }

  // ------------------------------------------------------------ per frame
  // x, y: the pointer (CSS px); hover: whether the pointer is a resting mouse.
  update(dt, x, y, hover, visible) {
    if (!this.data || this.state === "off") return { warmth: 0, dwell: 0 };
    const s = Math.min(innerWidth, innerHeight);

    // Hot / cold, and the dwell that finds a clue.
    let warmth = 0;
    if (this.state === "search" && hover) {
      for (const c of this.data.clues) {
        if (this.found.has(c.id)) continue;
        const [px, py] = this.project(c.x, c.y);
        const dist = Math.hypot(px - x, py - y) / (c.r * s);
        warmth = Math.max(warmth, smoothstep(3.2, 1, dist) * (c.bonus ? 0.6 : 1));
      }
      const c = this.nearest(x, y);
      if (c && c === this.dwellOn) this.dwell += dt;
      else { this.dwellOn = c; this.dwell = 0; }
      if (c && this.dwell >= DWELL) { this.dwell = 0; this.find(c); }
    }
    this.warmth += (warmth - this.warmth) * Math.min(1, dt * 8);

    // Marks ride the 3D surface.
    const show = (b, cx, cy, on) => {
      const [px, py] = this.project(cx, cy);
      b.style.transform = `translate(${px.toFixed(1)}px, ${py.toFixed(1)}px)`;
      b.classList.toggle("edge-r", px > innerWidth - 90);
      b.classList.toggle("edge-l", px < 90);
      b.classList.toggle("on", on && visible);
    };
    const markOn = this.state === "search" || this.state === "clue";
    this.data.clues.forEach((c) => {
      const b = this.markEls.get(c.id);
      show(b, c.x, c.y, markOn && this.found.has(c.id) && !(this.state === "clue" && this.current === c));
      b.tabIndex = b.classList.contains("on") ? 0 : -1;
    });
    if (this.hinted && this.found.has(this.hinted.id)) this.hinted = null;
    show(this.hintEl, this.hinted ? this.hinted.x : 0.5, this.hinted ? this.hinted.y : 0.5, !!this.hinted && this.state === "search");
    const sOn = this.state === "accuse" || this.state === "file";
    // In the file, the sheet covers the right side; drop markers hidden under it.
    const sheet = this.state === "file" ? this.panels.file.getBoundingClientRect().left : Infinity;
    this.data.suspects.forEach((sp, i) => {
      const b = this.suspectEls[i];
      const under = this.project(sp.x, sp.y)[0] > sheet - 40;
      show(b, sp.x, sp.y, sOn && !under);
      b.tabIndex = this.state === "accuse" ? 0 : -1;
    });

    // Threads of light, bowed slightly so they read as glances, not rulers.
    this.data.clues.forEach((c) => {
      const path = this.lines.get(c.id);
      if (!path) return;
      const [ax, ay] = this.project(...c.look.from);
      const [bx, by] = this.project(...c.look.to);
      const mx = (ax + bx) / 2, my = (ay + by) / 2;
      const nx = -(by - ay) * 0.12, ny = (bx - ax) * 0.12;
      path.setAttribute("d", `M${ax.toFixed(1)},${ay.toFixed(1)} Q${(mx + nx).toFixed(1)},${(my + ny).toFixed(1)} ${bx.toFixed(1)},${by.toFixed(1)}`);
      path.classList.toggle("dim", this.state === "file");
    });

    return { warmth: this.warmth, dwell: this.dwellOn ? clamp01(this.dwell / DWELL) : 0 };
  }
}
