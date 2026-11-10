# Writes Björn Jónsson's maps for the close-ups of skyview.js
# (https://bjj.mmedia.is/data/planetary_maps.html, "created by Björn
# Jónsson", from NASA's Voyager, Galileo and Cassini images) into
# img/planets:
#
#   python3 tools/planetmaps.py <dir>
#
# with, in <dir>, from bjj.mmedia.is/data/: saturn/saturn.jpg,
# s_rings/{backscattered,unlitside,transparency,sat_rings_color}.txt,
# io/io.jpg, ganymede/ganymede.jpg, callisto/callisto.jpg; and Europa's
# map, hosted by the Planetary Society:
# planetary.s3.amazonaws.com/web/assets/pictures/20150218_europa_global_map_20000x10000.jpg
# (20000 × 10400 pixels: the map and a strip of credits below). The maps
# are equirectangular, east to the right from longitude 0 at the left edge.
# It needs numpy and Pillow.
#
# saturn-bj.jpg: Saturn, 2048 × 1024, its planetographic latitudes made
# planetocentric (the latitudes of the maps of skyview.js), on Jónsson's
# ellipsoid of 60268 × 54362 km.
#
# saturn-rings.png: the rings from 74510 to 140390 km from the center,
# 4096 samples (16 km), in three rows: the light of the lit face (the
# backscattered profile in its colours, as from the Earth, near the Sun's
# direction), that of the unlit face (in red 1, green 0.97075, blue 0.952,
# Jónsson's colour for it), both premultiplied (0 to 255 for 0 to 1), and
# the transparency seen square on (255 for 1).
#
# galilean.jpg: Io, Europa, Ganymede and Callisto, 1024 × 512 each, from
# the top down, each keeping its own colours but brought to its brightness
# beside Jupiter's map (jupiter.jpg): their mean brightnesses over the
# sphere as their geometric albedos (V: Io 0.63, Europa 0.67, Ganymede
# 0.43, Callisto 0.22; Jupiter 0.538), brightened by a power (none clipped)
# or darkened in proportion.

import sys
import numpy as np
from PIL import Image

Image.MAX_IMAGE_PIXELS = None
src = sys.argv[1]
out = "img/planets"


def load(name, draft=None):
    img = Image.open(f"{src}/{name}")
    if draft:
        img.draft("RGB", draft)
    return np.asarray(img.convert("RGB"), dtype=np.float64) / 255


def save(px, name, **opts):
    Image.fromarray(np.clip(np.rint(px * 255), 0, 255).astype(np.uint8)).save(f"{out}/{name}", **opts)


def resize(px, w, h):
    img = Image.fromarray(np.clip(np.rint(px * 255), 0, 255).astype(np.uint8))
    return np.asarray(img.resize((w, h), Image.LANCZOS), dtype=np.float64) / 255


# Saturn: each row at its planetocentric latitude, sampled (linearly) at
# the planetographic one
sat = load("saturn.jpg")
h, w, _ = sat.shape
W, H = 2048, 1024
k = (54362 / 60268) ** 2
lat_c = np.radians(90 - (np.arange(H) + 0.5) * 180 / H)
lat_g = np.arctan(np.tan(lat_c) / k)
v = (90 - np.degrees(lat_g)) / 180 * h - 0.5
v0 = np.clip(np.floor(v).astype(int), 0, h - 2)
fv = np.clip(v - v0, 0, 1)[:, None, None]
rows = sat[v0] * (1 - fv) + sat[v0 + 1] * fv
save(resize(rows, W, H), "saturn-bj.jpg", quality=88)

# the rings: 13177 samples, 5 km apart, averaged to 4096
def profile(name):
    p = np.loadtxt(f"{src}/{name}", ndmin=2)
    x = np.linspace(0, 1, len(p))
    return np.stack([np.interp(np.linspace(0, 1, 4096 * 4), x, p[:, i]).reshape(4096, 4).mean(1) for i in range(p.shape[1])], 1)

back, unlit, clear, color = (profile(f) for f in ["backscattered.txt", "unlitside.txt", "transparency.txt", "sat_rings_color.txt"])
rings = np.stack([back * color, unlit * [1, 0.97075, 0.952], np.repeat(clear, 3, 1)])
save(rings, "saturn-rings.png", optimize=True)

# the Galilean moons: their mean brightnesses (Rec. 709 luma) over the
# sphere, as Jupiter's
luma = np.array([0.2126, 0.7152, 0.0722])


def brightness(px):
    w = np.cos(np.radians(90 - (np.arange(px.shape[0]) + 0.5) * 180 / px.shape[0]))
    return np.dot(np.einsum("i,ijk->k", w, px) / (w.sum() * px.shape[1]), luma)


jupiter = brightness(np.asarray(Image.open(f"{out}/jupiter.jpg").convert("RGB"), dtype=np.float64) / 255)
maps = []
for name, albedo in {"io.jpg": 0.63, "europa.jpg": 0.67, "ganymede.jpg": 0.43, "callisto.jpg": 0.22}.items():
    if name == "europa.jpg":
        px = load(name, (2500, 1300))
        px = px[: px.shape[1] // 2]
    else:
        px = load(name)
    px = resize(px, 1024, 512)
    target = jupiter * albedo / 0.538
    if brightness(px) > target:
        px = px * target / brightness(px)
    else:
        lo, hi = 0.2, 1.0
        for _ in range(40):
            g = (lo * hi) ** 0.5
            lo, hi = (lo, g) if brightness(px ** g) < target else (g, hi)
        px = px ** g
    maps.append(px)
save(np.concatenate(maps), "galilean.jpg", quality=88)
