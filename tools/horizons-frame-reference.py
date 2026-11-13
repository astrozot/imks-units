"""Normalize saved Horizons true-of-date references to the modern frame.

python tools/horizons-frame-reference.py (development dependency: pyerfa).
The original observations stay in tests/run.mjs. ERFA supplies only rotations,
not the ephemeris under test. Horizons documents its IAU76/80 observer frame:
https://ssd.jpl.nasa.gov/horizons/manual.html
Daily measured pole offsets, where present in Horizons, are not reconstructed.
"""
import json
import pathlib
import re

import erfa

root = pathlib.Path(__file__).resolve().parents[1]
source = (root/'tests/run.mjs').read_text()
literal = re.search(r'const PLACES = (\[.*?\]);', source, re.S)[1]
rows = json.loads(re.sub(r',\s*]', ']', literal))
frames = []
for jd in sorted({r[1] for r in rows}):
    matrix = erfa.pnm06a(2451545, jd-2451545) @ erfa.pnm80(2451545, jd-2451545).T
    frames.append(dict(tt=jd, matrix=matrix.tolist()))
out = dict(source=f'ERFA {erfa.__version__}: pnm06a @ transpose(pnm80)',
           scope='Frame normalization only; original Horizons directions remain independent ephemeris references. No daily pole offsets.',
           frames=frames)
(root/'tests/fixtures/horizons-frames.json').write_text(json.dumps(out, indent=2)+'\n')
