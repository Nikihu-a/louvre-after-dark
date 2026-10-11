"""Build a background plate for a painting: what lies behind its figures' edges.

When the camera moves in the immersive view, a gap opens behind every figure.
Instead of stretching the figure's edge into that gap, the shader samples this
plate, where a thin band on the near side of every depth edge has been
inpainted (LaMa) with plausible background.

Usage:
    python tools/make_plate.py <lama.onnx> <painting.jpg|webp> <depth.png|webp> <out_plate.webp> <out_bgdepth.webp>

Model: https://huggingface.co/Carve/LaMa-ONNX (lama_fp32.onnx, 512x512 input)
"""
import sys

import numpy as np
import onnxruntime as ort
from PIL import Image, ImageFilter

SIZE = 512          # LaMa input
BAND = 41           # how far behind an edge we reconstruct, in 512-px units (odd)
PLATE_LONG = 1400   # plate resolution (long side)


def run(model, image_path, depth_path, out_plate, out_bgdepth, sess=None):
    img = Image.open(image_path).convert("RGB")
    W, H = img.size
    d = Image.open(depth_path).convert("L").resize((SIZE, SIZE), Image.BILINEAR)

    # Local background depth: the farthest value nearby. Pixels much nearer than
    # that sit on the near side of an edge and get reconstructed.
    bg = d.filter(ImageFilter.MinFilter(BAND)).filter(ImageFilter.GaussianBlur(4))
    dn = np.asarray(d, np.float32) / 255
    bn = np.asarray(bg, np.float32) / 255
    mask = Image.fromarray(((dn - bn) > 0.14).astype(np.uint8) * 255).filter(ImageFilter.MaxFilter(7))

    x = np.asarray(img.resize((SIZE, SIZE), Image.BICUBIC), np.float32).transpose(2, 0, 1)[None] / 255
    m = (np.asarray(mask, np.float32) / 255)[None, None]
    sess = sess or ort.InferenceSession(model, providers=["CPUExecutionProvider"])
    out = sess.run(None, {"image": x, "mask": m})[0][0].transpose(1, 2, 0)
    if out.max() <= 1.5:  # some exports return 0..1
        out = out * 255
    filled = Image.fromarray(np.clip(out, 0, 255).astype(np.uint8))

    # Keep the original at full detail everywhere except the reconstructed band.
    s = min(1.0, PLATE_LONG / max(W, H))
    pw, ph = round(W * s), round(H * s)
    base = img.resize((pw, ph), Image.LANCZOS)
    soft = mask.resize((pw, ph), Image.BILINEAR).filter(ImageFilter.GaussianBlur(2))
    plate = Image.composite(filled.resize((pw, ph), Image.BICUBIC), base, soft)
    plate.save(out_plate, quality=80, method=6)

    # Depth of the plate: the background estimate (smooth, no figure edges).
    bgd = bg.resize((round(SIZE * W / max(W, H)), round(SIZE * H / max(W, H))), Image.BILINEAR)
    bgd.filter(ImageFilter.GaussianBlur(3)).save(out_bgdepth, lossless=True)
    print(f"{image_path} -> {out_plate} ({pw}x{ph}), masked {np.mean(np.asarray(mask) > 0) * 100:.1f}%")
    return sess


if __name__ == "__main__":
    run(*sys.argv[1:6])
