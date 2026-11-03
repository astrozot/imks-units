# Writes img/moon.webp, the near side of the Moon as seen from the Earth
# (north up, east of the sky to the left: Mare Crisium on the right),
# from NASA's colour map of the LRO Camera (public domain, NASA's
# Scientific Visualization Studio, CGI Moon Kit):
#
#   python3 tools/moondisk.py lroc_color_poles_1k.jpg
#
# from https://svs.gsfc.nasa.gov/vis/a000000/a004700/a004720/lroc_color_poles_1k.jpg
# (equirectangular, longitude −180° to 180° from left to right). It needs
# numpy and Pillow. The disk is an orthographic view from above 0° N, 0° E,
# brightened a little, with some limb darkening; outside it, transparent.

import sys
import numpy as np
from PIL import Image

N = 256
src = np.asarray(Image.open(sys.argv[1]).convert("RGB"), dtype=np.float64) / 255
h, w, _ = src.shape
# pixel centers, in units of the radius: x to the right, y up
c = (np.arange(N) + 0.5) / N * 2 - 1
x, y = np.meshgrid(c, -c)
r2 = x * x + y * y
inside = r2 <= 1
z = np.sqrt(np.clip(1 - r2, 0, 1))
lat = np.arcsin(np.clip(y, -1, 1))
lon = np.arctan2(x, z)
# bilinear sampling of the map
u = (lon / (2 * np.pi) + 0.5) * w - 0.5
v = (0.5 - lat / np.pi) * h - 0.5
u0 = np.floor(u).astype(int); v0 = np.clip(np.floor(v).astype(int), 0, h - 2)
fu = (u - u0)[..., None]; fv = (v - v0)[..., None]
u0 %= w; u1 = (u0 + 1) % w
px = (src[v0, u0] * (1 - fu) * (1 - fv) + src[v0, u1] * fu * (1 - fv) + src[v0 + 1, u0] * (1 - fu) * fv + src[v0 + 1, u1] * fu * fv)
# brighter, as the full Moon looks; a little limb darkening, and a soft
# edge one pixel wide
px = 1.15 * px ** 0.9 * (0.82 + 0.18 * z)[..., None]
alpha = np.clip((1 - np.sqrt(r2)) * N / 2, 0, 1)
out = np.dstack([np.clip(px, 0, 1), alpha]) * 255
Image.fromarray(out.astype(np.uint8)).save("img/moon.webp", quality=82, method=6)
