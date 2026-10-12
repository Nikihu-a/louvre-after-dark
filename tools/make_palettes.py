"""Print each painting's five-colour palette for js/data.js.

Three distinct base tones by area, plus two vivid accents (so a small but
characteristic colour, like the tricolour in Liberty, is not lost), sorted
dark to light.

Usage:
    python tools/make_palettes.py
"""
import colorsys
import os

import numpy as np
from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
IDS = ["virgin-of-the-rocks", "mona-lisa", "wedding-at-cana", "the-cheat", "the-lacemaker",
       "cythera", "horatii", "coronation", "medusa", "liberty"]


def kmeans(px, k, seeds=4):
    best = None
    for seed in range(seeds):
        rng = np.random.default_rng(seed)
        c = px[rng.choice(len(px), k, replace=False)]
        for _ in range(50):
            lab = ((px[:, None, :] - c[None]) ** 2).sum(-1).argmin(1)
            c = np.array([px[lab == i].mean(0) if (lab == i).any() else c[i] for i in range(k)])
        err = ((px - c[lab]) ** 2).sum()
        if best is None or err < best[0]:
            best = (err, c, lab)
    return best[1], best[2]


def palette(path):
    im = Image.open(path).convert("RGB")
    im.thumbnail((240, 240))
    px = np.asarray(im, np.float32).reshape(-1, 3)
    c, lab = kmeans(px, 12)
    share = np.bincount(lab, minlength=len(c)) / len(lab)
    vivid = np.array([s * v for _, s, v in (colorsys.rgb_to_hsv(*(x / 255)) for x in c)])
    far = lambda i, picks, d: all(np.linalg.norm(c[i] - c[j]) > d for j in picks)
    picks = []
    for i in np.argsort(-share):
        if far(i, picks, 34):
            picks.append(i)
        if len(picks) == 3:
            break
    for i in sorted(range(len(c)), key=lambda i: -(vivid[i] * share[i] ** 0.35)):
        if len(picks) == 5:
            break
        if i not in picks and share[i] > 0.012 and far(i, picks, 40):
            picks.append(i)
    for i in np.argsort(-share):
        if len(picks) == 5:
            break
        if i not in picks:
            picks.append(i)
    lum = c[picks] @ np.array([0.2126, 0.7152, 0.0722])
    return ["#%02x%02x%02x" % tuple(int(round(v)) for v in c[picks][j]) for j in np.argsort(lum)]


if __name__ == "__main__":
    for pid in IDS:
        print(f'"{pid}": {palette(os.path.join(ROOT, "assets", "paintings", f"{pid}-card.webp"))}')
