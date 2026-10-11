"""Compose the 1200x630 social share image (assets/og-cover.jpg).

Usage:
    python tools/make_og.py
"""
import os

from PIL import Image, ImageDraw, ImageFilter, ImageFont

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
P = os.path.join(ROOT, "assets", "paintings")
F = os.path.join(ROOT, "assets", "fonts")
W, H = 1200, 630
NIGHT = (7, 6, 10)
GOLD = (217, 178, 111)
INK = (243, 234, 219)
HORIZON = 452


def font(name, size):
    return ImageFont.truetype(os.path.join(F, f"cormorant-garamond-latin-{name}.woff2"), size)


def rounded(img, r):
    m = Image.new("L", img.size, 0)
    ImageDraw.Draw(m).rounded_rectangle((0, 0, img.width - 1, img.height - 1), r, fill=255)
    img.putalpha(m)
    return img


def main():
    im = Image.new("RGB", (W, H), NIGHT)

    # Warm light pool behind the center card.
    glow = Image.new("L", (W, H), 0)
    ImageDraw.Draw(glow).ellipse((560, 120, 1120, 560), fill=60)
    im.paste((60, 44, 26), mask=glow.filter(ImageFilter.GaussianBlur(90)))

    # Perspective grid floor.
    grid = Image.new("L", (W, H), 0)
    g = ImageDraw.Draw(grid)
    vx, vy = 820, 300
    for k in range(-30, 31):
        x = vx + k * 120
        g.line([(vx + (x - vx) * 0.0, vy), (x, H)], fill=40, width=1)
    y, step = HORIZON, 8
    while y < H:
        g.line([(0, y), (W, y)], fill=40, width=1)
        step *= 1.32
        y += step
    floor_mask = Image.new("L", (W, H), 0)
    ImageDraw.Draw(floor_mask).rectangle((0, HORIZON, W, H), fill=255)
    grid = Image.composite(grid, Image.new("L", (W, H), 0), floor_mask)
    im.paste((150, 146, 160), mask=grid)

    # Cards along an arc: (painting, center x, card height, brightness).
    cards = [
        ("virgin-of-the-rocks", 520, 200, 0.42),
        ("mona-lisa", 640, 250, 0.62),
        ("horatii", 840, 318, 1.0),
        ("liberty", 1055, 250, 0.62),
        ("medusa", 1190, 200, 0.42),
    ]
    order = sorted(range(len(cards)), key=lambda i: cards[i][3])
    for i in order:
        pid, cx, ch, lum = cards[i]
        src = Image.open(os.path.join(P, f"{pid}-card.webp")).convert("RGB")
        cw = round(ch * src.width / src.height)
        card = src.resize((cw, ch), Image.LANCZOS)
        card = Image.eval(card, lambda v, l=lum: int(v * (0.35 + 0.65 * l)))
        bottom = HORIZON - 6
        top = bottom - ch
        x0 = cx - cw // 2
        refl = card.transpose(Image.FLIP_TOP_BOTTOM).filter(ImageFilter.GaussianBlur(3))
        # Strongest right under the card, fading toward the viewer.
        fade = Image.linear_gradient("L").resize((cw, ch)).transpose(Image.FLIP_TOP_BOTTOM)
        fade = Image.eval(fade, lambda v: int(v * 0.3))
        im.paste(refl, (x0, bottom + 6), mask=fade)
        im.paste(rounded(card, 8), (x0, top), rounded(card, 8))

    # Left-side darkening so the type reads.
    shade = Image.linear_gradient("L").rotate(90, expand=True).resize((W, H))
    shade = Image.eval(shade, lambda v: int(max(0, (v - 70)) * 1.25))
    im.paste(NIGHT, mask=shade.transpose(Image.FLIP_LEFT_RIGHT).point(lambda v: min(235, v)))

    d = ImageDraw.Draw(im)
    d.text((70, 168), "Musée du Louvre · Après la fermeture", font=font("500-italic", 26), fill=GOLD)
    d.text((66, 206), "Louvre", font=font("400-italic", 104), fill=GOLD)
    d.text((66, 304), "After Dark", font=font("300-normal", 104), fill=INK)
    d.text((72, 432), "Ten masterpieces, 1483 – 1830", font=font("500-normal", 30), fill=(205, 196, 182))
    d.text((72, 474), "by Niki", font=font("400-italic", 32), fill=GOLD)

    out = os.path.join(ROOT, "assets", "og-cover.jpg")
    im.save(out, quality=86, optimize=True, progressive=True)
    print(out, os.path.getsize(out) // 1024, "KB")


if __name__ == "__main__":
    main()
