# Louvre After Dark

**Walk the Louvre after hours with a lamp.** Ten masterpieces from 1483 to 1830, hung along a curved timeline in a dark 3D gallery. Open any painting and it becomes a stage: figures step out of the canvas as you move, the lamp rakes across their forms, and the camera dollies in to the details that matter.

**Live site:** https://nikihu-a.github.io/louvre-after-dark/

Curated, designed and built by **Niki**.

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
| Lamp or full lights | `L` or the toggle in the top bar | The bulb icon |
| Sound | The toggle in the top bar (or click to enter) | The speaker icon |
| Back to the gallery | `Esc` or "Gallery" | "Gallery" |

Every painting has its own link, e.g. [`#/horatii`](https://nikihu-a.github.io/louvre-after-dark/#/horatii). A lightweight version without 3D is at [`?static`](https://nikihu-a.github.io/louvre-after-dark/?static) (devices without WebGL 2 get it automatically).

## How it works

- **No build step.** Plain HTML, CSS and ES modules; [three.js](https://threejs.org) r169 is vendored in `vendor/`, and fonts are self-hosted, so the site loads without any third-party CDN.
- **Depth maps.** Each painting has a depth map estimated offline with [Depth Anything V2](https://github.com/DepthAnything/Depth-Anything-V2) (`tools/make_depth.py`). Near edges are dilated slightly so the figures keep clean silhouettes.
- **Background plates.** When the camera moves, a gap opens behind every figure. `tools/make_plate.py` finds the near side of every depth edge and has [LaMa](https://github.com/advimman/lama) inpaint what lies behind it; the shader re-traces those gaps against this plate instead of stretching the figure's edge.
- **Era soundtrack.** Each era of the timeline has its own music, written within a few decades of its paintings — a Renaissance lute ricercar, French Baroque and Rococo harpsichord, Mozart in 1784, Chopin in 1830. It crossfades as you travel and dips when a painting is open. Tracks load only once sound is switched on.
- **Opening.** The camera starts far back, looking at the middle of the arc, and dollies in while the spotlights switch on one by one from 1483 to 1830. A soft swell of air rises with the lights, synthesized with the Web Audio API.
- **Gallery** (`js/gallery.js`). Cards are bent onto a cylinder in the vertex shader; the radius tightens and colors split slightly with scroll speed. Each card is mirrored, blurred, into the polished floor. A one-tap depth offset makes the centered card breathe with the cursor.
- **Immersive view** (`js/immersive.js`). A full-screen parallax-occlusion ray march through the depth map, so near figures properly occlude far ones as the camera pans, dollies in or the lamp moves. The same shader draws the loupe and the depth-ordered dissolve between paintings.
- **Hand-off.** When you open a painting, its card flies to exactly the size and position of the immersive view's first frame, so the switch between the two renderers is invisible.
- **Performance.** Images are WebP; only the first four cards gate the loader and the rest stream in behind it. If frames run long, the renderer steps its resolution and ray-march quality down, and back up when there is headroom. A lost WebGL context (e.g. after sleep) is restored automatically.

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
curl -L -o lama.onnx https://huggingface.co/Carve/LaMa-ONNX/resolve/main/lama_fp32.onnx
.venv/bin/python tools/fetch_paintings.py depth-small.onnx lama.onnx            # all paintings
.venv/bin/python tools/fetch_paintings.py depth-small.onnx lama.onnx horatii    # just one
.venv/bin/python tools/make_og.py                                               # share image
.venv/bin/python tools/make_music.py "$(which ffmpeg)" path/to/recordings      # music loops, see assets/music/CREDITS.md
```

Painting texts and hotspot positions live in `js/data.js`; interface strings in `js/strings.js`. After changing CSS or JS, bump the `?v=` numbers in `index.html` so returning visitors don't get a cached copy.

## Credits

- All ten paintings are in the collection of the **Musée du Louvre** and are in the public domain. Photographs via [Wikimedia Commons](https://commons.wikimedia.org).
- Depth estimation: Depth Anything V2 (small), via the ONNX export by onnx-community.
- Background inpainting: LaMa, via the ONNX export by Carve.
- Music: recordings by David Hernández Romero (CC BY 3.0), Richard D. Siegel (CC BY-SA 4.0), David Joseph Stith (CC0) and Musopen (public domain); details in [`assets/music/CREDITS.md`](assets/music/CREDITS.md).
- Typeface: [Cormorant Garamond](https://github.com/CatharsisFonts/Cormorant), SIL Open Font License (`assets/fonts/OFL.txt`).
- 3D: [three.js](https://threejs.org), MIT License (`vendor/three.LICENSE`).

This is an independent project and is not affiliated with or endorsed by the Musée du Louvre.

## License

Code is released under the [MIT License](LICENSE). The painting images are public domain; the music recordings, the font and three.js keep their own licenses.
