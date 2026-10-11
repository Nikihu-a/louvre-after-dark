"""Cut the era soundtrack loops into assets/music/<era>.mp3.

Each loop is an excerpt from the start of a recording, loudness-normalized,
with a fade in and a long fade out: the player starts the next pass before the
current one ends, so the baked fades become a crossfade.

Usage:
    python tools/make_music.py <ffmpeg> <source-dir>

<source-dir> holds the downloaded recordings named below (see assets/music/CREDITS.md
for where each one comes from).
"""
import os
import subprocess
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "assets", "music")
FADE_IN = 2.5
FADE_OUT = 4.0  # must match OVERLAP in js/audio.js

# era: (source file, start seconds, length seconds)
LOOPS = {
    "renaissance": ("renaissance.webm", 0, 56),
    "baroque": ("baroque.ogg", 0, 92),
    "rococo": ("rococo.wav", 0, 88),
    "neoclassical": ("neoclassical.ogg", 0, 96),
    "romantic": ("romantic.flac", 0, 96),
}


def run(ffmpeg, src_dir):
    os.makedirs(OUT, exist_ok=True)
    for era, (name, start, length) in LOOPS.items():
        src = os.path.join(src_dir, name)
        out = os.path.join(OUT, f"{era}.mp3")
        af = (
            f"atrim=start={start}:duration={length},asetpts=PTS-STARTPTS,"
            "loudnorm=I=-20:TP=-2:LRA=11,"
            f"afade=t=in:st=0:d={FADE_IN},afade=t=out:st={length - FADE_OUT}:d={FADE_OUT}"
        )
        subprocess.run([
            ffmpeg, "-hide_banner", "-loglevel", "error", "-y", "-i", src, "-vn",
            "-af", af, "-ar", "44100", "-ac", "2", "-c:a", "libmp3lame", "-b:a", "112k", out,
        ], check=True)
        print(f"{era}: {os.path.getsize(out) // 1024} KB")


if __name__ == "__main__":
    run(sys.argv[1], sys.argv[2])
