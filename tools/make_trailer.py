"""Render the 30-second YouTube trailer (1920x1080, 30 fps, EN + ZH captions).

Painting shots are rendered here as depth stages from the site's own assets
(depth maps and inpainted plates), with the same camera model as the immersive
view. The gallery shot uses frames captured from the live site.

Usage:
    python tools/make_trailer.py <ffmpeg> <noto-serif-sc.otf> <gallery-frames-dir> <out.mp4>
"""
import math
import os
import subprocess
import sys

import cv2
import numpy as np
from PIL import Image, ImageDraw, ImageFilter, ImageFont

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PAINT = os.path.join(ROOT, "assets", "paintings")
FONTS = os.path.join(ROOT, "assets", "fonts")
MUSIC = os.path.join(ROOT, "assets", "music")
W, H, FPS = 1920, 1080, 30
DURATION = 30.0
GOLD = (217, 178, 111)
INK = (243, 234, 219)
DIM = (190, 182, 168)
NIGHT = np.array([7, 6, 10], np.float32) / 255

# ---------------------------------------------------------------- timeline
# Painting shots: (id, start, end, focus, aspect, tint, camera target (image uv), caption, music line)
SHOTS = [
    dict(id="mona-lisa", t0=2.2, t1=5.0, focus=0.6, aspect=1610 / 2400, tint=(1.0, 0.84, 0.6),
         target=(0.44, 0.30), zoom=(0.0, 0.30), reveal=True,
         year="1503", title="Mona Lisa", artist="Leonardo da Vinci", zh="《蒙娜丽莎》 列奥纳多·达·芬奇",
         music=("Francesco da Milano — lute, c. 1530s", "弗朗切斯科·达·米兰诺 · 鲁特琴")),
    dict(id="wedding-at-cana", t0=5.0, t1=7.8, focus=0.62, aspect=2400 / 1607, tint=(1.0, 0.78, 0.62),
         target=(0.47, 0.66), zoom=(0.06, 0.34),
         year="1563", title="The Wedding at Cana", artist="Paolo Veronese", zh="《迦拿的婚礼》 保罗·委罗内塞",
         tagline=("Ten masterpieces of the Louvre, 1483 – 1830", "卢浮宫十幅名画，1483—1830")),
    dict(id="the-cheat", t0=7.8, t1=10.6, focus=0.6, aspect=2400 / 1742, tint=(1.0, 0.72, 0.45),
         target=(0.55, 0.34), zoom=(0.06, 0.36),
         year="1635", title="The Cheat with the Ace of Diamonds", artist="Georges de La Tour", zh="《方块A的作弊者》 乔治·德·拉图尔",
         tagline=("Each heard with music from its own time", "每一幅，都配上同时代的音乐"),
         music=("François Couperin — harpsichord, 1716", "弗朗索瓦·库普兰 · 羽管键琴")),
    dict(id="cythera", t0=10.6, t1=13.4, focus=0.5, aspect=2400 / 1574, tint=(1.0, 0.8, 0.72),
         target=(0.66, 0.64), zoom=(0.06, 0.34),
         year="1717", title="Pilgrimage to Cythera", artist="Antoine Watteau", zh="《舟发西苔岛》 安托万·华托"),
    dict(id="horatii", t0=13.4, t1=16.2, focus=0.55, aspect=2400 / 1861, tint=(0.94, 0.92, 1.0),
         target=(0.45, 0.36), zoom=(0.06, 0.38),
         year="1784", title="The Oath of the Horatii", artist="Jacques-Louis David", zh="《荷拉斯兄弟之誓》 雅克-路易·大卫",
         music=("Mozart — Sonata K. 333, 1784", "莫扎特 · 降B大调奏鸣曲")),
    dict(id="medusa", t0=16.2, t1=19.0, focus=0.58, aspect=2400 / 1638, tint=(1.0, 0.66, 0.48),
         target=(0.62, 0.30), zoom=(0.06, 0.34),
         year="1818", title="The Raft of the Medusa", artist="Théodore Géricault", zh="《梅杜萨之筏》 泰奥多尔·籍里柯",
         music=("Chopin — Nocturne Op. 9 No. 1, 1830", "肖邦 · 降B小调夜曲")),
    dict(id="liberty", t0=19.0, t1=21.8, focus=0.55, aspect=2400 / 1920, tint=(1.0, 0.7, 0.55),
         target=(0.58, 0.28), zoom=(0.06, 0.34),
         year="1830", title="Liberty Leading the People", artist="Eugène Delacroix", zh="《自由引导人民》 欧仁·德拉克罗瓦"),
]
GALLERY = (21.8, 26.6)
END = (26.6, DURATION)
XFADE = 0.4

# Soundtrack: (track, start in the video, end in the video, offset into the loop)
SOUNDTRACK = [
    ("renaissance", 0.0, 7.8, 0.0),
    ("rococo", 7.8, 13.4, 3.0),
    ("neoclassical", 13.4, 16.2, 4.0),
    ("romantic", 16.2, DURATION, 3.0),
]

ease = lambda t: t * t * (3 - 2 * t)
clamp01 = lambda x: max(0.0, min(1.0, x))


def smooth(a, b, x):
    t = np.clip((x - a) / (b - a), 0, 1)
    return t * t * (3 - 2 * t)


# ---------------------------------------------------------------- depth stage
MARGIN, MAX_CROP, SPREAD, PAR = 1.08, 1.35, 1.0, 0.03


def fit_height(sa, ia):
    r = sa / ia
    return min(max(1, r) * MARGIN, min(1, r) * MAX_CROP)


def mag(h, zoom):
    d0 = 1 + (1 - h) * SPREAD
    return d0 / (d0 - zoom)


class Stage:
    def __init__(self, shot):
        pid = shot["id"]
        load = lambda name, mode: np.asarray(Image.open(os.path.join(PAINT, name)).convert(mode), np.float32) / 255
        self.img = load(f"{pid}.webp", "RGB")
        self.depth = load(f"{pid}-depth.webp", "L")
        self.plate = cv2.resize(load(f"{pid}-plate.webp", "RGB"), (self.img.shape[1], self.img.shape[0]))
        self.bg = cv2.resize(load(f"{pid}-bgdepth.webp", "L"), (self.depth.shape[1], self.depth.shape[0]))
        self.shot = shot
        sa, ia = W / H, shot["aspect"]
        hd = fit_height(sa, ia)
        self.k = (sa / (hd * ia), 1 / hd)
        sx, sy = np.meshgrid((np.arange(W) + 0.5) / W, (np.arange(H) + 0.5) / H)
        self.s = (sx.astype(np.float32), sy.astype(np.float32))
        self.b = ((sx - 0.5) * self.k[0] + 0.5).astype(np.float32), ((sy - 0.5) * self.k[1] + 0.5).astype(np.float32)

    def sample(self, src, px, py, border=cv2.BORDER_REPLICATE):
        hh, ww = src.shape[:2]
        return cv2.remap(src, px * (ww - 1), py * (hh - 1), cv2.INTER_LINEAR, borderMode=border)

    def anchor(self, zoom, c):
        target = (0.6, 0.42)
        w = clamp01(zoom / 0.4)
        m0 = mag(0, zoom)
        out = []
        for i in range(2):
            half = min(0.5, self.k[i] / 2)
            lo = 0.5 + half - (1 - c[i] - PAR * 0.6) * m0
            hi = 0.5 - half + (c[i] - PAR * 0.6) * m0
            a = c[i] + (target[i] - c[i]) * w
            out.append(min(hi, max(lo, a)) if lo <= hi else c[i])
        return out

    def frame(self, t):
        """t in 0..1 across the shot."""
        sh = self.shot
        e = ease(t)
        zoom = sh["zoom"][0] + (sh["zoom"][1] - sh["zoom"][0]) * e
        c = [0.5 + (sh["target"][i] - 0.5) * e for i in range(2)]
        a = self.anchor(zoom, c)
        par = ((t - 0.5) * 2 * PAR, math.sin(t * math.pi) * PAR * 0.3)
        focus = sh["focus"]
        bx, by = self.b

        def at(h):
            m = mag(h, zoom)
            return ((c[0] + (bx - a[0]) / m + par[0] * (h - focus)).astype(np.float32),
                    (c[1] + (by - a[1]) / m + par[1] * (h - focus)).astype(np.float32))

        h = np.full((H, W), focus, np.float32)
        for _ in range(4):  # fixed-point stand-in for the shader's ray march
            px, py = at(h)
            h = self.sample(self.depth, px, py)
        col = self.sample(self.img, px, py)

        # Fill disocclusions from the inpainted plate, as the site does.
        ex, ey = 2 / self.depth.shape[1], 2 / self.depth.shape[0]
        dx = self.sample(self.depth, px + ex, py) - self.sample(self.depth, px - ex, py)
        dy = self.sample(self.depth, px, py + ey) - self.sample(self.depth, px, py - ey)
        wall = np.sqrt(dx * dx + dy * dy)
        travel = math.hypot(par[0], par[1]) + np.abs(bx - a[0]) * abs(1 / mag(1, zoom) - 1 / mag(0, zoom))
        wk = (smooth(0.05, 0.2, wall) * smooth(0.0015, 0.008, travel))[..., None]
        hb = self.sample(self.bg, *at(np.full((H, W), focus, np.float32)))
        qx, qy = at(hb)
        col = col * (1 - wk) + self.sample(self.plate, qx, qy) * wk

        # Lamp and room light.
        sx, sy = self.s
        asp = W / H
        if sh.get("reveal"):
            ambient = 0.06 + 0.58 * ease(clamp01(t * 1.6))
            lx, ly = 0.15 + 0.32 * ease(clamp01(t * 1.3)), 0.32
            lamp = 1.1 - 0.5 * ease(clamp01(t * 1.6))
        else:
            ambient, lamp = 0.68, 0.5
            lx, ly = 0.42 + 0.2 * t, 0.38
        d2 = ((sx - lx) * asp) ** 2 + (sy - ly) ** 2
        spot = np.exp(-d2 / 0.11)
        nz = 1 / np.sqrt(1 + (dx * 7) ** 2 + (dy * 7) ** 2)
        lxv, lyv = (lx - sx) * asp, (ly - sy)
        ln = 1 / np.sqrt(lxv ** 2 + lyv ** 2 + 0.3)
        diff = np.clip(((-dx * 7) * lxv + (-dy * 7) * lyv + 0.55) * nz * ln, 0, 1)
        fog = 0.72 + 0.28 * smooth(0.05, 0.8, h)
        tint = np.array(sh["tint"], np.float32)
        light = (ambient * fog)[..., None] * (0.7 + 0.3 * tint) + (lamp * spot * (0.35 + 0.9 * diff))[..., None] * tint
        out = col * light

        # Outside the canvas is the dark room.
        inside = ((px > 0) & (px < 1) & (py > 0) & (py < 1)).astype(np.float32)[..., None]
        out = out * inside + NIGHT * (1 - inside)
        vx, vy = sx - 0.5, (sy - 0.5) * 1.15
        out *= np.clip(1 - (vx * vx + vy * vy) * 1.0, 0.3, 1)[..., None]
        return out


# ---------------------------------------------------------------- type
def font(name, size):
    return ImageFont.truetype(os.path.join(FONTS, f"cormorant-garamond-latin-{name}.woff2"), size)


class Type:
    def __init__(self, zh_font):
        self.zh = lambda size: ImageFont.truetype(zh_font, size)

    def layer(self, items):
        """items: (x, y, text, font, fill, anchor). Returns an RGBA layer with a soft shadow."""
        txt = Image.new("RGBA", (W, H), (0, 0, 0, 0))
        d = ImageDraw.Draw(txt)
        for x, y, s, f, fill, anchor in items:
            d.text((x, y), s, font=f, fill=fill + (255,), anchor=anchor)
        alpha = txt.split()[3]
        shadow = Image.new("RGBA", (W, H), (0, 0, 0, 0))
        shadow.putalpha(alpha.filter(ImageFilter.GaussianBlur(10)).point(lambda v: int(v * 0.85)))
        out = Image.alpha_composite(shadow, txt)
        a = np.asarray(out, np.float32) / 255
        return a[..., :3], a[..., 3:4]

    def caption(self, sh):
        x, y = 110, H - 120
        return self.layer([
            (x, y - 166, sh["year"], font("300-normal", 92), GOLD, "ls"),
            (x, y - 92, sh["title"], font("500-normal", 50), INK, "ls"),
            (x, y - 50, sh["artist"], font("400-italic", 30), DIM, "ls"),
            (x, y, sh["zh"], self.zh(30), DIM, "ls"),
        ])

    def music(self, en, zh):
        # Cormorant has no music note, so the note is set in the CJK face.
        x, y = W - 110, H - 120
        en_font = font("400-italic", 30)
        note_x = x - en_font.getlength(en) - 14
        return self.layer([
            (note_x, y - 44, "♪", self.zh(26), GOLD, "rs"),
            (x, y - 44, en, en_font, DIM, "rs"),
            (x, y, zh, self.zh(24), (150, 143, 132), "rs"),
        ])

    def tagline(self, en, zh):
        return self.layer([
            (W / 2, 150, en, font("300-normal", 54), INK, "ms"),
            (W / 2, 205, zh, self.zh(30), DIM, "ms"),
        ])

    def opening(self):
        return self.layer([
            (W / 2, H / 2 - 40, "Night falls.", font("400-italic", 96), GOLD, "ms"),
            (W / 2, H / 2 + 60, "The Louvre is closed.", font("300-normal", 96), INK, "ms"),
            (W / 2, H / 2 + 135, "夜幕降临，卢浮宫闭馆了。", self.zh(36), DIM, "ms"),
        ])

    def gallery(self):
        return self.layer([
            (W / 2, 150, "Walk the timeline in 3D", font("300-normal", 54), INK, "ms"),
            (W / 2, 205, "在 3D 时间轴上漫步", self.zh(30), DIM, "ms"),
        ])

    def end(self):
        return self.layer([
            (W / 2, H / 2 - 70, "Louvre", font("400-italic", 120), GOLD, "ms"),
            (W / 2, H / 2 + 40, "After Dark", font("300-normal", 120), INK, "ms"),
            (W / 2, H / 2 + 110, "卢浮宫之夜 · 十幅名画，五段时代之声", self.zh(34), DIM, "ms"),
            (W / 2, H / 2 + 190, "nikihu-a.github.io/louvre-after-dark", font("500-normal", 34), GOLD, "ms"),
            (W / 2, H / 2 + 250, "by Niki", font("400-italic", 40), DIM, "ms"),
        ])


def over(base, layer, alpha):
    rgb, a = layer
    a = a * alpha
    return base * (1 - a) + rgb * a


def fade(t, t0, t1, fin=0.5, fout=0.5):
    return clamp01((t - t0) / fin) * clamp01((t1 - t) / fout) if fout else clamp01((t - t0) / fin)


# ---------------------------------------------------------------- soundtrack
def build_audio(ffmpeg, out):
    inputs, parts = [], []
    for i, (track, t0, t1, off) in enumerate(SOUNDTRACK):
        a0, a1 = max(0, t0 - XFADE), min(DURATION, t1 + XFADE)
        dur = a1 - a0
        inputs += ["-stream_loop", "-1", "-i", os.path.join(MUSIC, f"{track}.mp3")]
        fi = 0 if i == 0 else 0.8
        fo = 0.8 if t1 < DURATION else 3.0
        parts.append(
            f"[{i}:a]atrim=start={off}:duration={dur},asetpts=PTS-STARTPTS,"
            f"afade=t=in:st=0:d={max(fi, 0.01)},afade=t=out:st={dur - fo}:d={fo},"
            f"adelay={int(a0 * 1000)}|{int(a0 * 1000)}[m{i}]"
        )
    mix = "".join(f"[m{i}]" for i in range(len(SOUNDTRACK)))
    graph = ";".join(parts) + f";{mix}amix=inputs={len(SOUNDTRACK)}:normalize=0,atrim=0:{DURATION},loudnorm=I=-16:TP=-1.5[a]"
    subprocess.run([ffmpeg, "-hide_banner", "-loglevel", "error", "-y", *inputs,
                    "-filter_complex", graph, "-map", "[a]", "-ar", "48000", "-ac", "2", out], check=True)


# ---------------------------------------------------------------- render
def main(ffmpeg, zh_font, gallery_dir, out):
    audio = out + ".wav"
    build_audio(ffmpeg, audio)
    ty = Type(zh_font)
    stages = {sh["id"]: Stage(sh) for sh in SHOTS}
    captions = {sh["id"]: ty.caption(sh) for sh in SHOTS}
    musics = {sh["id"]: ty.music(*sh["music"]) for sh in SHOTS if "music" in sh}
    tags = {sh["id"]: ty.tagline(*sh["tagline"]) for sh in SHOTS if "tagline" in sh}
    opening, gallery_t, end = ty.opening(), ty.gallery(), ty.end()
    frames = sorted(f for f in os.listdir(gallery_dir) if f.endswith(".jpg"))

    enc = subprocess.Popen([
        ffmpeg, "-hide_banner", "-loglevel", "error", "-y",
        "-f", "rawvideo", "-pix_fmt", "rgb24", "-s", f"{W}x{H}", "-r", str(FPS), "-i", "-",
        "-i", audio, "-map", "0:v", "-map", "1:a",
        "-c:v", "libx264", "-preset", "slow", "-crf", "17", "-pix_fmt", "yuv420p",
        "-c:a", "aac", "-b:a", "192k", "-movflags", "+faststart", "-shortest", out,
    ], stdin=subprocess.PIPE)

    music_line = None
    total = int(DURATION * FPS)
    for n in range(total):
        t = n / FPS
        img = np.tile(NIGHT, (H, W, 1))

        # Painting shots, crossfading into each other.
        for i, sh in enumerate(SHOTS):
            t0, t1 = sh["t0"], sh["t1"]
            if not (t0 - XFADE / 2 <= t < t1 + XFADE / 2):
                continue
            w = clamp01((t - (t0 - XFADE / 2)) / XFADE) if i > 0 else clamp01((t - t0) / 0.6)
            if i < len(SHOTS) - 1:
                w *= clamp01((t1 + XFADE / 2 - t) / XFADE)
            else:
                w *= clamp01((GALLERY[0] + XFADE / 2 - t) / XFADE)
            local = clamp01((t - t0) / (t1 - t0))
            frame = stages[sh["id"]].frame(local)
            frame = over(frame, captions[sh["id"]], fade(t, t0 + 0.25, t1, 0.45, 0.35))
            if sh["id"] in tags:
                frame = over(frame, tags[sh["id"]], fade(t, t0 + 0.35, t1, 0.5, 0.4))
            img = img * (1 - w) + frame * w
            if "music" in sh and t >= t0:
                music_line = (sh["id"], t0)

        # Gallery shot from the live site.
        g0, g1 = GALLERY
        if g0 - XFADE / 2 <= t < g1 + XFADE / 2:
            k = min(len(frames) - 1, max(0, int((t - g0) * FPS)))
            gf = cv2.resize(cv2.cvtColor(cv2.imread(os.path.join(gallery_dir, frames[k])), cv2.COLOR_BGR2RGB),
                            (W, H), interpolation=cv2.INTER_AREA).astype(np.float32) / 255
            gf = np.clip(gf * 1.18, 0, 1)
            gf = over(gf, gallery_t, fade(t, g0 + 1.4, g1, 0.6, 0.5))
            w = clamp01((t - (g0 - XFADE / 2)) / XFADE) * clamp01((g1 + XFADE / 2 - t) / XFADE)
            img = img * (1 - w) + gf * w

        # Music credit line, bottom right, while its era plays.
        if music_line and t < GALLERY[1]:
            sid, mt0 = music_line
            img = over(img, musics[sid], clamp01((t - mt0 - 0.3) / 0.5) * clamp01((GALLERY[1] - t) / 0.5))

        # Opening title and end card.
        img = over(img, opening, fade(t, 0.3, 2.6, 0.7, 0.5))
        img = over(img, end, fade(t, END[0] + 0.2, DURATION - 0.2, 0.8, 0.0))
        img *= clamp01((DURATION - t) / 0.6)  # out to black

        enc.stdin.write((np.clip(img, 0, 1) * 255 + 0.5).astype(np.uint8).tobytes())
        if n % 60 == 0:
            print(f"{n}/{total}", flush=True)

    enc.stdin.close()
    enc.wait()
    os.remove(audio)
    print(out, os.path.getsize(out) // 1024, "KB")


if __name__ == "__main__":
    main(*sys.argv[1:5])
