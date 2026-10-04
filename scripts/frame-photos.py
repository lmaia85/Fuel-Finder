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

import numpy as np
from PIL import Image
from scipy import ndimage

MARGIN = 0.03      # padding on every side, as a share of the product's long edge
MAX_EDGE = 640
ALPHA_MIN = 128    # the solid product, not a faint baked-in drop shadow
SPECK = 0.01       # detached bits under 1% of the product's area are cutout debris


def drop_specks(im):
    """Clear stray pixels left floating beside the product by a sloppy
    background removal; they'd also skew the centering."""
    px = np.array(im)
    labels, n = ndimage.label(px[:, :, 3] > 16)
    if n < 2:
        return im
    sizes = ndimage.sum(np.ones(labels.shape), labels, range(1, n + 1))
    specks = [i + 1 for i, size in enumerate(sizes) if size < sizes.max() * SPECK]
    px[np.isin(labels, specks), 3] = 0
    return Image.fromarray(px)


def frame(path):
    im = drop_specks(Image.open(path).convert("RGBA"))
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
