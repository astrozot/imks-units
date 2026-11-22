#!/usr/bin/env python3
"""Build geographic timezone TopoJSON with shared, generalized borders.

Requires mapshaper 0.8.7 on PATH (or --mapshaper /path/to/mapshaper).
Downloads are build inputs only; the application uses the bundled output offline.
"""
import argparse
import hashlib
import json
from pathlib import Path
import shutil
import subprocess
import tempfile
import urllib.request
import zipfile

VERSION = '2026f'
ARCHIVE = 'timezones-with-oceans.geojson.zip'
URL = f'https://github.com/evansiroky/timezone-boundary-builder/releases/download/{VERSION}/{ARCHIVE}'
SHA256 = '838b3c9161e09ee944edb64cc4d9e4d2eb3ad0a3ec3d8d6a1520a5f8f6e21ac9'
ROOT = Path(__file__).resolve().parents[1]
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--archive', type=Path, help='Use an already downloaded archive')
parser.add_argument('--mapshaper', default='mapshaper')
args = parser.parse_args()
with tempfile.TemporaryDirectory(prefix='imks-timezones-') as folder:
    temp = Path(folder)
    archive = args.archive or temp / ARCHIVE
    if not args.archive:
        urllib.request.urlretrieve(URL, archive)
    with archive.open('rb') as stream:
        checksum = hashlib.sha256()
        for block in iter(lambda: stream.read(1024 * 1024), b''):
            checksum.update(block)
        digest = checksum.hexdigest()
    if digest != SHA256:
        raise SystemExit('Source archive checksum differs from the pinned release')
    source = temp / 'source.geojson'
    with zipfile.ZipFile(archive) as zipped, zipped.open('combined-with-oceans.json') as src, source.open('wb') as dst:
        shutil.copyfileobj(src, dst)
    output = ROOT / 'data/timezones.topo.json'
    subprocess.run([args.mapshaper, str(source), '-filter-fields', 'tzid', '-simplify', 'dp', 'interval=250m', 'keep-shapes', '-rename-layers', 'timezones', '-o', 'force', 'format=topojson', 'quantization=1000000', str(output)], check=True)
    centers_path = temp / 'centers.geojson'
    subprocess.run([args.mapshaper, str(output), '-points', 'inner', '-o', 'format=geojson', str(centers_path)], check=True)
    centers = {f['properties']['tzid']: list(reversed(f['geometry']['coordinates'])) for f in json.loads(centers_path.read_text())['features']}
    topology = json.loads(output.read_text())
    for geometry in topology['objects']['timezones']['geometries']:
        geometry['properties']['center'] = centers[geometry['properties']['tzid']]
    topology['source'] = dict(project='Timezone Boundary Builder', version=VERSION, url=URL, sha256=SHA256, license='ODbL-1.0', attribution='Timezone Boundary Builder; © OpenStreetMap contributors', simplificationMeters=250, mapshaper=subprocess.check_output([args.mapshaper, '-version'], text=True).strip())
    output.write_text(json.dumps(topology, separators=(',', ':')) + '\n')
    license_path = ROOT / 'data/timezones-LICENSE.txt'
    if not license_path.exists():
        urllib.request.urlretrieve(f'https://raw.githubusercontent.com/evansiroky/timezone-boundary-builder/{VERSION}/DATA_LICENSE', license_path)
    print(f'{output}: {output.stat().st_size:,} bytes, {len(centers)} zones')
