"""Download the paintings from Wikimedia Commons and build every web asset.

Usage:
    python tools/fetch_paintings.py <depth-model.onnx> [painting-id ...]

For each painting this writes into assets/paintings/:
    <id>.jpg            2400px long side, used in the immersive view
    <id>-card.jpg       1280px long side, used on the gallery cards
    <id>-depth.png      full-size depth map (tools/make_depth.py)
    <id>-depth-sm.png   512px depth map for the gallery cards

All source images are photographs of public-domain paintings in the Musée du Louvre.
"""
import json
import os
import subprocess
import sys
import urllib.parse

from PIL import Image, ImageDraw

sys.path.insert(0, os.path.dirname(__file__))
import make_depth  # noqa: E402

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "assets", "paintings")
UA = "louvre-after-dark/1.0 (https://github.com/Nikihu-a/louvre-after-dark)"

COMMONS = {
    "virgin-of-the-rocks": "Leonardo Da Vinci - Vergine delle Rocce (Louvre).jpg",
    "mona-lisa": "Mona Lisa, by Leonardo da Vinci, from C2RMF retouched.jpg",
    "wedding-at-cana": "Les Noces de Cana - Paolo Veronese - Musée du Louvre Peintures INV 142 ; MR 384.jpg",
    "the-cheat": "Le Tricheur à l'as de carreau - Georges de La Tour - Musée du Louvre Peintures RF 1972 8.jpg",
    "the-lacemaker": "Johannes Vermeer - The lacemaker (c.1669-1671).jpg",
    "cythera": "L'Embarquement pour Cythère, by Antoine Watteau, from C2RMF retouched.jpg",
    "horatii": "Le Serment des Horaces - Jacques-Louis David - Musée du Louvre Peintures INV 3692 ; MR 1432.jpg",
    "coronation": "Jacques-Louis David - The Coronation of Napoleon (1805-1807).jpg",
    "medusa": "JEAN LOUIS THÉODORE GÉRICAULT - La Balsa de la Medusa (Museo del Louvre, 1818-19).jpg",
    "liberty": "La Liberté guidant le peuple - Eugène Delacroix - Musée du Louvre Peintures RF 129 - après restauration 2024.jpg",
}


# Arched panels photographed on white: paint the area outside the arch as night.
ARCHED = {"virgin-of-the-rocks"}
NIGHT = (7, 6, 10)


def mask_corners(img):
    """Return (image, mask) with the white top corners flood-filled to NIGHT."""
    probe = img.copy()
    w, _ = probe.size
    for seed in ((0, 0), (w - 1, 0)):
        ImageDraw.floodfill(probe, seed, (255, 0, 255), thresh=60)
    mask = Image.eval(probe.split()[0], lambda v: 255 if v == 255 else 0)
    green = Image.eval(probe.split()[1], lambda v: 255 if v == 0 else 0)
    mask = Image.composite(mask, Image.new("L", mask.size, 0), green)
    out = img.copy()
    out.paste(NIGHT, mask=mask)
    return out, mask


def curl(url, out=None):
    args = ["curl", "-sSL", "--retry", "6", "--retry-all-errors", "--retry-delay", "3",
            "-m", "300", "-A", UA, url]
    if out:
        args += ["-o", out]
    r = subprocess.run(args, capture_output=True, text=not out)
    if r.returncode != 0:
        raise RuntimeError(f"download failed: {url}")
    return r.stdout


def thumb_url(title, width):
    q = urllib.parse.urlencode({
        "action": "query", "format": "json", "prop": "imageinfo",
        "iiprop": "url|size", "iiurlwidth": width, "titles": "File:" + title,
    })
    page = next(iter(json.loads(curl("https://commons.wikimedia.org/w/api.php?" + q))["query"]["pages"].values()))
    info = page["imageinfo"][0]
    return info.get("thumburl", info["url"]).split("?")[0]


def resized(img, long_side):
    w, h = img.size
    s = min(1.0, long_side / max(w, h))
    return img.resize((round(w * s), round(h * s)), Image.LANCZOS) if s < 1 else img.copy()


def build(pid, model):
    src = os.path.join(OUT, f"{pid}.src.jpg")
    if not os.path.exists(src):
        curl(thumb_url(COMMONS[pid], 3000), src)
    img = Image.open(src).convert("RGB")

    mask = None
    if pid in ARCHED:
        img, mask = mask_corners(img)

    full = os.path.join(OUT, f"{pid}.jpg")
    resized(img, 2400).save(full, quality=84, optimize=True, progressive=True)
    resized(img, 1280).save(os.path.join(OUT, f"{pid}-card.jpg"), quality=80, optimize=True, progressive=True)

    depth = os.path.join(OUT, f"{pid}-depth.png")
    make_depth.run(model, full, depth, 1288, 7)
    if mask is not None:
        d = Image.open(depth)
        d.paste(0, mask=mask.resize(d.size))
        d.save(depth, optimize=True)
    resized(Image.open(depth), 512).save(os.path.join(OUT, f"{pid}-depth-sm.png"), optimize=True)
    os.remove(src)
    print(f"ok {pid} {Image.open(full).size}")


if __name__ == "__main__":
    model = sys.argv[1]
    ids = sys.argv[2:] or list(COMMONS)
    os.makedirs(OUT, exist_ok=True)
    for pid in ids:
        build(pid, model)
