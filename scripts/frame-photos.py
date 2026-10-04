"""Crop every product photo to the product itself, with an even margin.

Product photos are transparent-background WebPs, but many arrive with
lopsided empty space around the pack (one tube sat 13% right of center).
The page centers the image *file*, so off-center content shows off-center.
This trims each file to its visible pixels, pads all sides equally, and caps
the long edge at 640px (the stage shows them at ~320px). Safe to re-run:
an already-framed photo comes out unchanged in shape.

    python3 scripts/frame-photos.py            # frame every photo in place
    python3 scripts/frame-photos.py a.webp     # just these files

scripts/check-images.js fails the deploy if a photo drifts off center again.
"""
import glob
import os
import sys

from PIL import Image

MARGIN = 0.03      # padding on every side, as a share of the product's long edge
MAX_EDGE = 640
ALPHA_MIN = 128    # the solid product, not a faint baked-in drop shadow


def frame(path):
    im = Image.open(path).convert("RGBA")
    box = im.getchannel("A").point(lambda v: 255 if v > ALPHA_MIN else 0).getbbox()
    if not box:
        return f"skip (empty): {path}"
    im = im.crop(box)
    pad = round(max(im.size) * MARGIN)
    out = Image.new("RGBA", (im.width + 2 * pad, im.height + 2 * pad), (0, 0, 0, 0))
    out.paste(im, (pad, pad))
    if max(out.size) > MAX_EDGE:
        scale = MAX_EDGE / max(out.size)
        out = out.resize((round(out.width * scale), round(out.height * scale)), Image.LANCZOS)
    out.save(path, "WEBP", quality=90, method=4)
    return f"{os.path.basename(path)}: {out.width}x{out.height}"


if __name__ == "__main__":
    here = os.path.dirname(os.path.abspath(__file__))
    files = sys.argv[1:] or sorted(glob.glob(os.path.join(here, "..", "img", "products", "*.webp")))
    for f in files:
        print(frame(f))
