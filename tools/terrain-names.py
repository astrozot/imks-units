#!/usr/bin/env python3
"""Build static summit-name tiles from OpenStreetMap and GeoNames.

python3 tools/terrain-names.py --geonames /tmp/allCountries.zip \\
    --osm /tmp/peaks.geojsonseq data/terrain-names

OpenStreetMap (ODbL) is preferred: it is denser and its summit positions are
usually surveyed. GeoNames (CC BY 4.0) fills the gaps: a GeoNames record is
dropped when an OSM summit lies within 300 m, or one with the same name within
1.5 km. Either source may be omitted.

OSM input, any number of files, in either form:
  * osmium GeoJSON sequence of the whole planet (or an extract):
      osmium tags-filter planet.osm.pbf n/natural=peak,volcano,hill -o peaks.osm.pbf
      osmium export peaks.osm.pbf -f geojsonseq -o peaks.geojsonseq
  * Overpass CSV (tab-separated, with header) for a region:
      [out:csv(::id,::lat,::lon,natural,name,ele;true;"\\t")];
      node["natural"~"^(peak|volcano|hill)$"]["name"](S,W,N,E);out;
Only named nodes are used. The raw inputs stay outside the repository; the
output replaces the JSON tiles only.
"""
import argparse
import collections
import datetime
import gzip
import hashlib
import json
import math
import re
import unicodedata
from pathlib import Path
import zipfile

GEONAMES_CODES = {'MT', 'PK', 'HLL', 'VLC'}
OSM_CODES = {'peak': 'PK', 'volcano': 'VLC', 'hill': 'HLL'}
NEAR, SAME_NAME = 300.0, 1500.0


def tile_key(lat, lon):
    return f'{min(17, math.floor((lat + 90) / 10))}-{math.floor((lon + 180) / 10)}'


def valid(lat, lon):
    return math.isfinite(lat) and math.isfinite(lon) and abs(lat) <= 90 and abs(lon) <= 180


def osm_elevation(text):
    """OSM ele: metres by convention; accept '1234', '1234 m', '1,234.5', feet."""
    if not text:
        return None
    text = text.split(';')[0].strip()
    # '1234,5' is a decimal comma; '1,234' a thousands separator.
    text = re.sub(r'^(-?\d+),(\d{1,2})\b', r'\1.\2', text).replace(',', '')
    m = re.match(r'(-?\d+(?:\.\d+)?)\s*(m|ft|feet|\'|)\s*$', text)
    if not m:
        return None
    value = float(m.group(1)) * (0.3048 if m.group(2) in ('ft', 'feet', "'") else 1)
    return round(value) if -500 < value < 9000 else None


def read_osm(path, sink):
    with open(path, encoding='utf-8') as stream:
        first = stream.readline()
        if first.lstrip('\x1e').lstrip().startswith('{'):
            lines = (first, *stream)
            for line in lines:
                line = line.strip().lstrip('\x1e')
                if not line:
                    continue
                f = json.loads(line)
                g, tags = f.get('geometry') or {}, f.get('properties') or {}
                if g.get('type') != 'Point':
                    continue
                ident = f.get('id', tags.get('@id'))
                ident = int(str(ident).lstrip('n').split('/')[-1]) if ident is not None else None
                sink(ident, tags.get('name'), g['coordinates'][1], g['coordinates'][0], tags.get('natural'), tags.get('ele'))
        else:
            header = first.rstrip('\n').split('\t')
            col = {name: i for i, name in enumerate(header)}
            if not {'@id', '@lat', '@lon', 'name'} <= col.keys():
                raise ValueError(f'{path}: expected Overpass CSV with @id, @lat, @lon, natural, name, ele')
            for line in stream:
                f = line.rstrip('\n').split('\t')
                if len(f) < len(header):
                    continue
                sink(int(f[col['@id']]), f[col['name']], float(f[col['@lat']]), float(f[col['@lon']]),
                     f[col['natural']] if 'natural' in col else 'peak', f[col['ele']] if 'ele' in col else None)


def read_geonames(source, sink, digest):
    archive = zipfile.ZipFile(source) if zipfile.is_zipfile(source) else None
    if archive:
        members = [n for n in archive.namelist() if n.endswith('.txt') and '/' not in n]
        if len(members) != 1:
            raise ValueError('Expected a single GeoNames gazetteer TXT in the ZIP')
        stream = archive.open(members[0])
    else:
        stream = open(source, 'rb')
    try:
        for raw in stream:
            digest.update(raw)
            f = raw.decode('utf-8').rstrip('\r\n').split('\t')
            # Individual mountains, summits, hills and volcanoes; exclude
            # ranges/groups whose representative point is not a summit.
            if len(f) < 19 or f[6] != 'T' or f[7] not in GEONAMES_CODES or not f[1].strip():
                continue
            # Do not substitute the coarse GeoNames DEM for surveyed elevation.
            sink(int(f[0]), f[1], float(f[4]), float(f[5]), f[7], int(f[15]) if f[15].strip() else None)
    finally:
        stream.close()
    return datetime.date(*archive.getinfo(members[0]).date_time[:3]).isoformat() if archive else None


def norm(name):
    s = unicodedata.normalize('NFKD', name).encode('ascii', 'ignore').decode().lower()
    return re.sub(r'[^a-z0-9]+', ' ', s).strip()


def metres(a, b):
    p, q = math.radians(a[0]), math.radians(b[0])
    return 6371008.8 * 2 * math.asin(math.sqrt(min(1, math.sin((q - p) / 2) ** 2 + math.cos(p) * math.cos(q) * math.sin(math.radians(b[1] - a[1]) / 2) ** 2)))


def build(geonames, osm_files, destination):
    osm, gn = [], []
    codes, sources = collections.Counter(), {}

    def osm_sink(ident, name, lat, lon, natural, ele):
        name = (name or '').strip()
        if ident is None or not name or natural not in OSM_CODES or not valid(lat, lon):
            return
        osm.append([ident, name, round(lat, 6), round((lon + 180) % 360 - 180, 6), osm_elevation(ele), OSM_CODES[natural], 'O'])

    def gn_sink(ident, name, lat, lon, code, ele):
        if valid(lat, lon):
            gn.append([ident, name, lat, (lon + 180) % 360 - 180, ele, code, 'G'])

    osm_tiles = set()
    for path in osm_files:
        before = len(osm)
        read_osm(path, osm_sink)
        osm_tiles.update(tile_key(r[2], r[3]) for r in osm[before:])
    # The same node can appear in overlapping regional downloads.
    osm = list({r[0]: r for r in osm}.values())
    if osm_files:
        sources['OpenStreetMap'] = dict(license='ODbL 1.0', url='https://www.openstreetmap.org/copyright', count=len(osm))
    if geonames:
        digest = hashlib.sha256()
        date = read_geonames(geonames, gn_sink, digest)
        sources['GeoNames'] = dict(license='CC BY 4.0', url='https://download.geonames.org/export/dump/', sourceSHA256=digest.hexdigest(), sourceDate=date)
    # GeoNames records already present in OSM: same place, or same name nearby.
    cell = 0.02
    near, named = collections.defaultdict(list), collections.defaultdict(list)
    for r in osm:
        near[(math.floor(r[2] / cell), math.floor(r[3] / cell))].append(r)
        named[norm(r[1])].append(r)
    kept = []
    for r in gn:
        i, j = math.floor(r[2] / cell), math.floor(r[3] / cell)
        if any(metres(r[2:4], o[2:4]) < NEAR for di in (-1, 0, 1) for dj in (-1, 0, 1) for o in near.get((i + di, j + dj), ())):
            continue
        if any(metres(r[2:4], o[2:4]) < SAME_NAME for o in named.get(norm(r[1]), ())):
            continue
        kept.append(r)
    if geonames:
        sources['GeoNames'].update(count=len(gn), kept=len(kept))
    tiles = collections.defaultdict(list)
    for r in osm + kept:
        tiles[tile_key(r[2], r[3])].append(r)
        codes[r[5]] += 1
    destination.mkdir(parents=True, exist_ok=True)
    manifest = dict(version=2, tileDegrees=10, sources=sources,
                    columns=['id', 'name', 'lat', 'lon', 'elevation', 'code', 'source'],
                    count=sum(codes.values()), codes=dict(sorted(codes.items())),
                    osmTiles=sorted(osm_tiles), tiles={})
    for key, rows in sorted(tiles.items()):
        data = json.dumps(sorted(rows, key=lambda r: (r[6], r[0])), ensure_ascii=False, separators=(',', ':')).encode() + b'\n'
        packed = gzip.compress(data, compresslevel=9, mtime=0)
        (destination / f'{key}.json.gz').write_bytes(packed)
        manifest['tiles'][key] = dict(count=len(rows), bytes=len(packed), sha256=hashlib.sha256(data).hexdigest())
    for old in destination.glob('*.json*'):
        if old.name != 'index.json' and (not old.name.endswith('.json.gz') or old.name.removesuffix('.json.gz') not in tiles):
            old.unlink()
    (destination / 'index.json').write_text(json.dumps(manifest, ensure_ascii=False, separators=(',', ':')) + '\n')
    print(f"{manifest['count']:,} summits in {len(tiles)} tiles: {len(osm):,} OSM, {len(kept):,} of {len(gn):,} GeoNames; OSM covers {len(osm_tiles)} tiles")


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument('--geonames', type=Path, help='GeoNames allCountries.zip (or a country ZIP/TXT)')
    parser.add_argument('--osm', type=Path, action='append', default=[], help='OSM summits: osmium GeoJSON sequence or Overpass CSV (repeatable)')
    parser.add_argument('destination', type=Path)
    args = parser.parse_args()
    if not args.geonames and not args.osm:
        parser.error('give --geonames and/or --osm')
    build(args.geonames, args.osm, args.destination)
