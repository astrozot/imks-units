"""Extract native DE440 Chebyshev records into small, optional yearly packs.

python tools/precision-data.py de440s.bsp [--eop finals2000A.all]
Requires numpy/jplephem only during development. No kernel or Python code
is loaded on the phone. Native coefficients are preserved as Float64.
"""
import argparse
import datetime as dt
import hashlib
import json
import pathlib
import struct

import numpy as np
from jplephem.spk import SPK

ROOT = pathlib.Path(__file__).resolve().parents[1]


def jd(year):
    return 2440587.5 + (dt.datetime(year, 1, 1)-dt.datetime(1970, 1, 1)).days


def earth_orientation(file):
    rows = []
    if file:
        for line in file.read_text().splitlines():
            try:
                rows.append([float(line[7:15])+2400000.5, float(line[18:27]), float(line[37:46]), float(line[58:68])])
            except ValueError:
                continue
    return np.array(rows).reshape(-1, 4)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('kernel', type=pathlib.Path)
    parser.add_argument('--eop', type=pathlib.Path)
    parser.add_argument('--first', type=int, default=1900)
    parser.add_argument('--last', type=int, default=2100)
    parser.add_argument('--out', type=pathlib.Path, default=ROOT/'data/precision')
    a = parser.parse_args()
    kernel = SPK.open(str(a.kernel))
    a.out.mkdir(parents=True, exist_ok=True)
    digest = hashlib.sha256(a.kernel.read_bytes()).hexdigest()
    eop = earth_orientation(a.eop)
    manifest = {'version': 1, 'source': 'JPL DE440s', 'kernelSha256': digest,
                'sourceURL': 'https://naif.jpl.nasa.gov/pub/naif/generic_kernels/spk/planets/de440s.bsp',
                'earthOrientation': 'IERS finals2000A, USNO mirror; daily UT1−UTC and polar motion',
                'first': a.first, 'last': a.last, 'files': {}}
    references = []
    rng = np.random.default_rng(9325701)
    for year in range(a.first, a.last+1):
        start, end = jd(year)-3, jd(year+1)+3
        header = {'version': 1, 'year': year, 'source': 'DE440s', 'fromJD': start, 'toJD': end, 'segments': []}
        payload, offset = [], 0
        for segment in kernel.segments:
            epoch, step, coefficients = segment.load_array()
            first = int(np.floor((start-epoch)/step))
            last = int(np.floor((end-epoch)/step))+1
            selected = coefficients[:, first:last, :].transpose(1, 0, 2).astype('<f8')
            header['segments'].append({'center': segment.center, 'target': segment.target, 'start': epoch+first*step,
                                       'step': step, 'count': last-first, 'degree': selected.shape[2]-1, 'offset': offset})
            payload.append(selected.tobytes()); offset += selected.size
            # Independent native SPK evaluations, including record boundaries.
            if year in [1900, 2000, 2024, 2026, 2027, 2036, 2100]:
                for time in [start, end-1e-7, *rng.uniform(start, end, 4)]:
                    p, v = segment.compute_and_differentiate(time)
                    references.append([year, segment.center, segment.target, time, *p.tolist(), *v.tolist()])
        daily = eop[(eop[:, 0] >= start-1) & (eop[:, 0] <= end+1)] if len(eop) else []
        if len(daily) > 1:
            header['eop'] = {'offset': offset, 'count': len(daily), 'stride': 4}
            payload.append(daily.astype('<f8').tobytes())
        metadata = json.dumps(header, separators=(',', ':')).encode()
        padding = bytes((-len(metadata)) % 8)
        data = b'IMKSEPH1' + struct.pack('<II', len(metadata), 0) + metadata + padding + b''.join(payload)
        assert len(data) < 512*1024
        name = f'{year}.bin'
        (a.out/name).write_bytes(data)
        manifest['files'][name] = {'bytes': len(data), 'sha256': hashlib.sha256(data).hexdigest()}
    (a.out/'index.json').write_text(json.dumps(manifest, separators=(',', ':'))+'\n')
    (ROOT/'tests/fixtures/precision-spk.json').write_text(json.dumps({'source': manifest, 'states': references}, separators=(',', ':'))+'\n')
    print(f'{len(manifest["files"])} packs; largest {max(f["bytes"] for f in manifest["files"].values())} bytes; total {sum(f["bytes"] for f in manifest["files"].values())/1024/1024:.1f} MiB on host; each phone fetches only requested years')


if __name__ == '__main__':
    main()
