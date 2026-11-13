"""Prepare optional Moon maps from NASA's public-domain CGI Moon Kit.

Download lroc_color_poles_8k.tif and ldem_16_uint.tif from
https://svs.gsfc.nasa.gov/4720/ then run:
  python3 tools/lunarmaps.py COLOR.tif HEIGHTS.tif
Requires Pillow and numpy. Heights are lossless half-meters above -10 km,
packed in R (high byte), G (low byte); B is zero. Do not colour-correct.
"""
import sys
from pathlib import Path
import numpy as np
from PIL import Image

out = Path(__file__).resolve().parent.parent / "img" / "planets"
color = Image.open(sys.argv[1]).convert("RGB")
assert color.size == (8192, 4096)
color.save(out / "moon-8k.jpg", quality=92, subsampling=0, optimize=True)
color.resize((4096, 2048), Image.Resampling.LANCZOS).save(
    out / "moon-4k.jpg", quality=92, subsampling=0, optimize=True)
heights = np.asarray(Image.open(sys.argv[2]), dtype=np.uint16)
assert heights.shape == (2880, 5760)
packed = np.zeros((*heights.shape, 3), dtype=np.uint8)
packed[:, :, 0] = heights >> 8
packed[:, :, 1] = heights & 255
Image.fromarray(packed).save(out / "moon-heights-16.png", optimize=True)
# Average actual half-metre heights, never their independently packed bytes.
# Pre-sized files avoid decoding the full desktop images on a phone.
small = np.rint(heights.astype(np.float32).reshape(1440, 2, 2880, 2).mean(axis=(1, 3))).astype(np.uint16)
packed = np.zeros((*small.shape, 3), dtype=np.uint8)
packed[:, :, 0] = small >> 8
packed[:, :, 1] = small & 255
Image.fromarray(packed).save(out / "moon-heights-mobile-16.png", optimize=True)
