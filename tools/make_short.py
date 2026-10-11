"""Render one "Secrets of a Painting" short (1920x1080, 30 fps, EN + ZH captions).

Each short follows a camera path through one painting (keyframes below), lands
on a hidden detail marked with a pulsing ring, and ends on a title card. It
reuses the depth-stage renderer and type from make_trailer.py.

Usage:
    python tools/make_short.py <ffmpeg> <noto-serif-sc.otf> <short-id> <out.mp4>
"""
import math
import os
import subprocess
import sys

import cv2
import numpy as np

sys.path.insert(0, os.path.dirname(__file__))
from make_trailer import (DIM, FPS, GOLD, H, INK, MUSIC, NIGHT, PAR, W,  # noqa: E402
                          Stage, Type, clamp01, fade, font, over)

SHORTS = {
    "the-cheat": dict(
        no="01",
        shot=dict(id="the-cheat", focus=0.6, aspect=2400 / 1742, tint=(1.0, 0.72, 0.45), spread=0.5),
        music=("rococo", 3.0),  # François Couperin, CC0
        duration=16.0,
        anchor=(0.5, 0.42),
        # (time, zoom, center x, center y, ambient, lamp, light x, light y, free)
        # The room stays dark under the opening question, then the lights come up.
        keys=[
            (0.0, 0.00, 0.50, 0.50, 0.02, 0.35, 0.50, 0.62, 0),
            (2.6, 0.02, 0.50, 0.50, 0.04, 0.45, 0.52, 0.62, 0),
            (4.0, 0.05, 0.52, 0.46, 0.62, 0.50, 0.55, 0.36, 0),
            (6.2, 0.40, 0.57, 0.30, 0.48, 0.78, 0.55, 0.30, 0),
            (7.6, 0.41, 0.57, 0.30, 0.48, 0.78, 0.55, 0.30, 0),
            (10.0, 0.40, 0.07, 0.74, 0.46, 0.85, 0.42, 0.45, 1),
            (11.6, 0.41, 0.07, 0.74, 0.46, 0.85, 0.42, 0.45, 1),
            (13.6, 0.06, 0.50, 0.50, 0.60, 0.50, 0.40, 0.55, 0),
            (16.0, 0.06, 0.50, 0.50, 0.60, 0.50, 0.40, 0.55, 0),
        ],
        ring=dict(at=(0.065, 0.755), t0=9.4, t1=12.4),
        hook=(0.4, 3.4, "Look closely.", "Someone at this table is cheating.", "仔细看，这张牌桌上有人在作弊。"),
        captions=[
            (4.4, 7.6, "Her eyes slide toward the maid…", "交际花的目光斜向女仆……"),
            (8.4, 11.6, "…while he slips the ace of diamonds from his belt.", "……而他正从腰后抽出方块 A。"),
            (11.9, 13.6, "Only we can see it. That makes us his accomplices.", "只有我们看得见，于是我们也成了同谋。"),
        ],
        end=dict(t0=13.6, title="The Cheat with the Ace of Diamonds",
                 meta="Georges de La Tour · c. 1636–1638 · Musée du Louvre",
                 zh="《方块A的作弊者》 乔治·德·拉图尔"),
    ),
}


def camera(keys, t, anchor):
    i = 0
    while i < len(keys) - 2 and t > keys[i + 1][0]:
        i += 1
    k0, k1 = keys[i], keys[i + 1]
    u = clamp01((t - k0[0]) / (k1[0] - k0[0]))
    u = u * u * (3 - 2 * u)
    v = [k0[j] + (k1[j] - k0[j]) * u for j in range(1, 9)]
    return dict(
        zoom=v[0], c=[v[1], v[2]], ambient=v[3], lamp=v[4], light=(v[5], v[6]), free=v[7], anchor=anchor,
        # A slow, small sideways drift keeps the depth alive between moves.
        par=(math.sin(t * 0.5) * PAR * 0.4, math.cos(t * 0.37) * PAR * 0.15),
    )


def build_audio(ffmpeg, track, offset, duration, out):
    subprocess.run([
        ffmpeg, "-hide_banner", "-loglevel", "error", "-y", "-stream_loop", "-1",
        "-i", os.path.join(MUSIC, f"{track}.mp3"), "-af",
        f"atrim=start={offset}:duration={duration},asetpts=PTS-STARTPTS,"
        f"afade=t=in:st=0:d=1,afade=t=out:st={duration - 2.2}:d=2.2,loudnorm=I=-16:TP=-1.5",
        "-ar", "48000", "-ac", "2", out,
    ], check=True)


def main(ffmpeg, zh_font, short_id, out):
    sp = SHORTS[short_id]
    dur = sp["duration"]
    audio = out + ".wav"
    build_audio(ffmpeg, *sp["music"], dur, audio)

    ty = Type(zh_font)
    stage = Stage(sp["shot"])
    series = ty.layer([
        (110, 96, "SECRETS OF A PAINTING", font("500-normal", 24), GOLD, "ls"),
        (110, 132, f"一幅画的秘密 · {sp['no']}", ty.zh(22), DIM, "ls"),
    ])
    h0, h1, h_lead, h_rest, h_zh = sp["hook"]
    hook = ty.layer([
        (W / 2, 220, h_lead, font("400-italic", 72), GOLD, "ms"),
        (W / 2, 300, h_rest, font("300-normal", 64), INK, "ms"),
        (W / 2, 356, h_zh, ty.zh(34), DIM, "ms"),
    ])
    caps = [(t0, t1, ty.layer([
        (W / 2, H - 150, en, font("400-italic", 52), INK, "ms"),
        (W / 2, H - 92, zh, ty.zh(34), DIM, "ms"),
    ])) for t0, t1, en, zh in sp["captions"]]
    e = sp["end"]
    end = ty.layer([
        (W / 2, H / 2 - 120, e["title"], font("300-normal", 76), INK, "ms"),
        (W / 2, H / 2 - 62, e["meta"], font("400-italic", 34), DIM, "ms"),
        (W / 2, H / 2 - 10, e["zh"], ty.zh(34), DIM, "ms"),
        (W / 2, H / 2 + 110, "Louvre After Dark", font("400-italic", 54), GOLD, "ms"),
        (W / 2, H / 2 + 165, "nikihu-a.github.io/louvre-after-dark", font("500-normal", 32), GOLD, "ms"),
        (W / 2, H / 2 + 215, "by Niki", font("400-italic", 34), DIM, "ms"),
    ])
    ring = sp.get("ring")

    enc = subprocess.Popen([
        ffmpeg, "-hide_banner", "-loglevel", "error", "-y",
        "-f", "rawvideo", "-pix_fmt", "rgb24", "-s", f"{W}x{H}", "-r", str(FPS), "-i", "-",
        "-i", audio, "-map", "0:v", "-map", "1:a",
        "-c:v", "libx264", "-preset", "slow", "-crf", "17", "-pix_fmt", "yuv420p",
        "-c:a", "aac", "-b:a", "192k", "-movflags", "+faststart", "-shortest", out,
    ], stdin=subprocess.PIPE)

    total = int(dur * FPS)
    for n in range(total):
        t = n / FPS
        cam = camera(sp["keys"], t, sp["anchor"])
        img = stage.render(cam)

        # The detail: a ring that rides on the 3D surface and pulses.
        if ring and ring["t0"] <= t <= ring["t1"]:
            a = fade(t, ring["t0"], ring["t1"], 0.4, 0.4)
            x, y = (int(v) for v in stage.project(ring["at"], cam))
            pulse = (t - ring["t0"]) % 1.4 / 1.4
            mask = np.zeros((H, W), np.float32)
            cv2.circle(mask, (x, y), 46, 1.0, 3, cv2.LINE_AA)
            wave = np.zeros((H, W), np.float32)
            cv2.circle(wave, (x, y), int(46 + pulse * 70), 1.0, 2, cv2.LINE_AA)
            alpha = (np.maximum(mask, wave * (1 - pulse)) * a)[..., None]
            img = img * (1 - alpha) + np.array(GOLD, np.float32) / 255 * alpha

        img = over(img, series, fade(t, 0.8, e["t0"], 0.8, 0.5))
        img = over(img, hook, fade(t, h0, h1, 0.6, 0.5))
        for t0, t1, layer in caps:
            img = over(img, layer, fade(t, t0, t1, 0.4, 0.4))
        # End card over the dimmed painting.
        k = clamp01((t - e["t0"]) / 0.8)
        img = img * (1 - 0.65 * k) + NIGHT * 0.65 * k
        img = over(img, end, fade(t, e["t0"] + 0.3, dur, 0.7, 0.0))
        img *= clamp01((dur - t) / 0.5)

        enc.stdin.write((np.clip(img, 0, 1) * 255 + 0.5).astype(np.uint8).tobytes())
        if n % 60 == 0:
            print(f"{n}/{total}", flush=True)

    enc.stdin.close()
    enc.wait()
    os.remove(audio)
    print(out, os.path.getsize(out) // 1024, "KB")


if __name__ == "__main__":
    main(*sys.argv[1:5])
