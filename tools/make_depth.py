"""Generate a depth map for a painting with Depth Anything V2 (ONNX).

Usage:
    python tools/make_depth.py <model.onnx> <painting.jpg> <out_depth.png> [--long-side 1288] [--dilate 7]

Model: https://huggingface.co/onnx-community/depth-anything-v2-small (onnx/model.onnx)
Output: 8-bit grayscale PNG, same size as the input image, white = near, black = far.
"""
import argparse

import numpy as np
import onnxruntime as ort
from PIL import Image, ImageFilter

MEAN = np.array([0.485, 0.456, 0.406], dtype=np.float32)
STD = np.array([0.229, 0.224, 0.225], dtype=np.float32)


def run(model_path, image_path, out_path, long_side, dilate):
    img = Image.open(image_path).convert("RGB")
    w, h = img.size
    scale = long_side / max(w, h)
    # The ViT patch size is 14, so both sides must be multiples of 14.
    iw = max(14, round(w * scale / 14) * 14)
    ih = max(14, round(h * scale / 14) * 14)

    x = np.asarray(img.resize((iw, ih), Image.BICUBIC), dtype=np.float32) / 255.0
    x = ((x - MEAN) / STD).transpose(2, 0, 1)[None]

    sess = ort.InferenceSession(model_path, providers=["CPUExecutionProvider"])
    depth = sess.run(None, {"pixel_values": x})[0][0]

    # Relative inverse depth: larger = closer. Clip outliers, then normalize.
    lo, hi = np.percentile(depth, [1, 99])
    depth = np.clip((depth - lo) / (hi - lo), 0, 1)

    out = Image.fromarray((depth * 255).astype(np.uint8))
    # Grow near regions slightly past their silhouettes. When the camera moves,
    # the gap that opens behind a figure then stretches background texture
    # instead of smearing the figure's own colors.
    out = out.filter(ImageFilter.MaxFilter(dilate)) if dilate > 1 else out
    out = out.resize((w, h), Image.BICUBIC)
    # A light blur hides stair-stepping without softening edges much.
    out = out.filter(ImageFilter.GaussianBlur(radius=max(w, h) / 1600))
    out.save(out_path, optimize=True)
    print(f"{image_path} -> {out_path} ({w}x{h}, inference {iw}x{ih})")


if __name__ == "__main__":
    p = argparse.ArgumentParser()
    p.add_argument("model")
    p.add_argument("image")
    p.add_argument("out")
    p.add_argument("--long-side", type=int, default=1288)
    p.add_argument("--dilate", type=int, default=7, help="odd max-filter size, in inference pixels")
    a = p.parse_args()
    run(a.model, a.image, a.out, a.long_side, a.dilate)
