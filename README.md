# Louvre After Dark

**Walk the Louvre after hours with a lamp.** Ten masterpieces from 1483 to 1830, hung along a curved timeline in a dark 3D gallery. Open any painting and it becomes a stage: figures step out of the canvas as you move, the lamp rakes across their forms, and the camera dollies in to the details that matter.

**Live site:** https://nikihu-a.github.io/louvre-after-dark/

Curated, designed and built by **Niki**.

> 提灯夜游卢浮宫：沿着一条从 1483 年到 1830 年的时间轴，走过十幅卢浮宫名画。点开任意一幅，画面会变成可以“走进去”的 3D 舞台。

## The collection

| Year | Painting | Artist |
|---|---|---|
| c. 1483–1486 | The Virgin of the Rocks | Leonardo da Vinci |
| 1503–1519 | Mona Lisa | Leonardo da Vinci |
| 1562–1563 | The Wedding at Cana | Paolo Veronese |
| c. 1636–1638 | The Cheat with the Ace of Diamonds | Georges de La Tour |
| c. 1669–1670 | The Lacemaker | Johannes Vermeer |
| 1717 | Pilgrimage to Cythera | Antoine Watteau |
| 1784 | The Oath of the Horatii | Jacques-Louis David |
| 1805–1807 | The Coronation of Napoleon | Jacques-Louis David |
| 1818–1819 | The Raft of the Medusa | Théodore Géricault |
| 1830 | Liberty Leading the People | Eugène Delacroix |

## How to explore

| | Desktop | Phone |
|---|---|---|
| Travel the timeline | Scroll, drag, ← →, or the scrubber | Swipe |
| Open a painting | Click the centered card or its → button, or Enter | Tap |
| Step through details | Scroll, ↑ ↓, or click the gold markers | Swipe up / down, tap markers |
| Next / previous painting | ← → | Swipe left / right |
| Magnifier | Press and hold | Press and hold |
| Lamp or full lights | `L` or the toggle in the top bar | The toggle in the top bar |
| Back to the gallery | `Esc` or "Gallery" | "Gallery" |

Every painting has its own link, e.g. [`#/horatii`](https://nikihu-a.github.io/louvre-after-dark/#/horatii).

## How it works

- **No build step.** Plain HTML, CSS and ES modules; [three.js](https://threejs.org) r169 is vendored in `vendor/`, and fonts are self-hosted, so the site loads without any third-party CDN.
- **Depth maps.** Each painting has a depth map estimated offline with [Depth Anything V2](https://github.com/DepthAnything/Depth-Anything-V2) (`tools/make_depth.py`). Near edges are dilated slightly so that, when the camera moves, the gap behind a figure stretches background texture rather than smearing the figure.
- **Gallery** (`js/gallery.js`). Cards are bent onto a cylinder in the vertex shader; the radius tightens with scroll speed. A one-tap depth offset makes the centered card breathe with the cursor.
- **Immersive view** (`js/immersive.js`). A full-screen parallax-occlusion ray march through the depth map, so near figures properly occlude far ones as the camera pans, dollies in or the lamp moves. The same shader draws the loupe and the depth-ordered dissolve between paintings.
- **Hand-off.** When you open a painting, its card flies to exactly the size and position of the immersive view's first frame, so the switch between the two renderers is invisible.

## Run locally

Any static file server works:

```bash
python3 -m http.server 8000
```

Then open http://localhost:8000.

## Rebuild the images

The processed images and depth maps are committed, so this is only needed to add or change a painting.

```bash
python3 -m venv .venv && .venv/bin/pip install onnxruntime numpy pillow
curl -L -o depth-small.onnx https://huggingface.co/onnx-community/depth-anything-v2-small/resolve/main/onnx/model.onnx
.venv/bin/python tools/fetch_paintings.py depth-small.onnx            # all paintings
.venv/bin/python tools/fetch_paintings.py depth-small.onnx horatii    # just one
```

Painting texts and hotspot positions live in `js/data.js`.

## Credits

- All ten paintings are in the collection of the **Musée du Louvre** and are in the public domain. Photographs via [Wikimedia Commons](https://commons.wikimedia.org).
- Depth estimation: Depth Anything V2 (small), via the ONNX export by onnx-community.
- Typeface: [Cormorant Garamond](https://github.com/CatharsisFonts/Cormorant), SIL Open Font License (`assets/fonts/OFL.txt`).
- 3D: [three.js](https://threejs.org), MIT License (`vendor/three.LICENSE`).

This is an independent project and is not affiliated with or endorsed by the Musée du Louvre.

## License

Code is released under the [MIT License](LICENSE). The painting images are public domain; the font and three.js keep their own licenses.
