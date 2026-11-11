#!/usr/bin/env python3
"""Build the offline Mars catalogue (stdlib only).

Inputs: official MARS_nomenclature_center_pts.kmz, OpenPlanetary CARTO JSON
(SELECT link,name,code,diameter,ST_AsGeoJSON(the_geom) AS geometry FROM
opm_499_mars_nomenclature_polygons), Robbins 2020 ZIP. Optional curated
albedo file defaults to data/mars-albedo-contours.json. See data/mars-features.md.
"""
import argparse
import csv
import hashlib
import io
import json
import math
from collections import Counter, defaultdict
from pathlib import Path
from zipfile import ZipFile
import xml.etree.ElementTree as ET

ROOT = Path(__file__).resolve().parents[1]
RADIUS = 3396.19
RAD = math.pi / 180

def delta(lon):
    return (lon + 180) % 360 - 180

def local(lon, lat, lon0, lat0):
    """Spherical azimuthal equidistant coordinates (km); no map-stretch fit."""
    a, b, d = lat * RAD, lat0 * RAD, delta(lon - lon0) * RAD
    east = math.cos(a) * math.sin(d)
    north = math.cos(b) * math.sin(a) - math.sin(b) * math.cos(a) * math.cos(d)
    z = math.sin(a) * math.sin(b) + math.cos(a) * math.cos(b) * math.cos(d)
    angle = math.acos(max(-1, min(1, z)))
    k = RADIUS * angle / math.hypot(east, north) if math.hypot(east, north) > 1e-12 else RADIUS
    return east * k, north * k

def geographic(x, y, lon0, lat0):
    d = math.hypot(x, y) / RADIUS
    if d < 1e-12:
        return [lon0, lat0]
    a = lat0 * RAD
    lat = math.asin(math.cos(d) * math.sin(a) + y / math.hypot(x, y) * math.sin(d) * math.cos(a))
    lon = lon0 * RAD + math.atan2(x / math.hypot(x, y) * math.sin(d) * math.cos(a), math.cos(d) - math.sin(a) * math.sin(lat))
    return [round(lon / RAD % 360, 5), round(lat / RAD, 5)]

def fit_ellipse(rings, lon, lat):
    """Area-moment equivalent ellipse; derived approximation, not a rim fit."""
    if len(rings) != 1:
        return None
    points = [local(x, y, lon, lat) for x, y in rings[0]]
    if any(math.hypot(x, y) > 2000 for x, y in points):
        return None  # continental regions are not local ellipses
    area = sx = sy = xx = yy = xy = 0
    for (x, y), (u, v) in zip(points, points[1:]):
        cross = x*v-u*y
        area += cross / 2
        sx += (x+u)*cross / 6
        sy += (y+v)*cross / 6
        xx += (x*x+x*u+u*u)*cross / 12
        yy += (y*y+y*v+v*v)*cross / 12
        xy += (2*x*y+x*v+u*y+2*u*v)*cross / 24
    if abs(area) < 1e-6:
        return None
    x0, y0 = sx/area, sy/area
    xx, yy, xy = xx/area-x0*x0, yy/area-y0*y0, xy/area-x0*y0
    gap = math.hypot(xx-yy, 2*xy)
    big, small = (xx+yy+gap)/2, (xx+yy-gap)/2
    if small <= 0:
        return None
    major, minor = 4*math.sqrt(big), 4*math.sqrt(small)
    angle = math.atan2(2*xy, xx-yy)/2
    c, s = math.cos(angle), math.sin(angle)
    residual = math.sqrt(sum((math.hypot(2*((x-x0)*c+(y-y0)*s)/major, 2*(-(x-x0)*s+(y-y0)*c)/minor)-1)**2 for x, y in points) / len(points))
    return dict(center=geographic(x0, y0, lon, lat), major=round(major, 3), minor=round(minor, 3), angle=round(angle/RAD % 180, 3), residual=round(residual, 4))

def simplify(points, epsilon=0.025):
    def rdp(ps):
        if len(ps) < 3:
            return ps
        a, b = ps[0], ps[-1]
        dx, dy = b[0]-a[0], b[1]-a[1]
        den = dx*dx+dy*dy
        def distance(p):
            t = max(0, min(1, ((p[0]-a[0])*dx+(p[1]-a[1])*dy)/den)) if den else 0
            return math.hypot(p[0]-a[0]-t*dx, p[1]-a[1]-t*dy)
        dist, index = max((distance(p), i) for i, p in enumerate(ps[1:-1], 1))
        return rdp(ps[:index+1])[:-1] + rdp(ps[index:]) if dist > epsilon else [a, b]
    if len(points) < 5:
        return points
    half = len(points)//2
    result = rdp(points[:half+1])[:-1] + rdp(points[half:])
    return result if len(result) >= 4 else points

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('centres', type=Path)
    parser.add_argument('polygons', type=Path)
    parser.add_argument('craters', type=Path)
    parser.add_argument('--albedo', type=Path, default=ROOT/'data/mars-albedo-contours.json')
    parser.add_argument('--output', type=Path, default=ROOT/'js/marsdata.js')
    args = parser.parse_args()
    ns = {'k': 'http://www.opengis.net/kml/2.2'}
    with ZipFile(args.centres) as z:
        root = ET.fromstring(z.read('MARS_nomenclature_center_pts.kml'))
    features = {}
    for p in root.findall('.//k:Placemark', ns):
        d = {i.attrib['name']: i.text for i in p.findall('.//k:SimpleData', ns)}
        if d['approval'] != 'Adopted by IAU':
            continue
        id = int(d['link'].rsplit('/', 1)[1])
        features[id] = dict(id=id, name=p.findtext('k:name', namespaces=ns), lon=float(d['center_lon']) % 360, lat=float(d['center_lat']), diameter=float(d['diameter']), code=d['code'], bounds=[float(d[k]) for k in ['min_lon', 'max_lon', 'min_lat', 'max_lat']], shape=None)
    for p in json.loads(args.polygons.read_text())['rows']:
        id = int(p['link'].rsplit('/', 1)[1])
        f = features.get(id)
        if not f or not p['geometry'] or f['code'] in ['AL', 'AA']:
            continue  # old albedo rectangles and generated crater circles
        g = json.loads(p['geometry'])
        polys = g['coordinates'] if g['type'] == 'MultiPolygon' else [g['coordinates']]
        rings = [[[round(f['lon']+delta(x-f['lon']), 5), round(y, 5)] for x, y, *_ in poly[0]] for poly in polys]
        # Rectangles are bounds, not traced footprints.
        if all(len(r) <= 5 and len({x for x, y in r}) <= 2 and len({y for x, y in r}) <= 2 for r in rings):
            continue
        # Reject stale geometries whose diameter disagrees materially.
        if f['diameter'] and abs(p['diameter']-f['diameter']) > max(10, f['diameter']*0.15):
            continue
        fit = fit_ellipse(rings, f['lon'], f['lat'])
        if f['code'] in ['MO', 'TH', 'PE', 'PL'] and fit and fit['residual'] <= 0.12:
            f['shape'] = dict(kind='ellipse', source='polygon-fit', **fit)
        else:
            f['shape'] = dict(kind='polygon', source='usgs-opm', rings=[simplify(r) for r in rings], **({'fit': fit} if fit else {}))
    # Index named craters spatially; require size agreement and a unique match.
    cells = defaultdict(list)
    for f in features.values():
        if f['code'] == 'AA':
            cells[(int(f['lon']), int(f['lat']+90))].append(f)
    candidates = []
    with ZipFile(args.craters) as z:
        with z.open(next(n for n in z.namelist() if n.endswith('.csv'))) as raw:
            for row in csv.DictReader(io.TextIOWrapper(raw, encoding='utf-8-sig')):
                try:
                    lon, lat = float(row['LON_CIRC_IMG']) % 360, float(row['LAT_CIRC_IMG'])
                    diameter = float(row['DIAM_CIRC_IMG'])
                    major, minor, angle = (float(row[k]) for k in ['DIAM_ELLI_MAJOR_IMG', 'DIAM_ELLI_MINOR_IMG', 'DIAM_ELLI_ANGLE_IMG'])
                    angle_sd, arc = float(row['DIAM_ELLI_ANGLE_SD_IMG']), float(row['ARC_IMG'])
                except (ValueError, TypeError):
                    continue
                if not 0 < minor <= major or not 0 <= angle < 180 or arc < 0.75 or angle_sd > 15:
                    continue
                for dy in [-1, 0, 1]:
                    for dx in range(-3, 4):
                        for f in cells.get(((int(lon)+dx) % 360, int(lat+90)+dy), []):
                            error = abs(diameter-f['diameter']) / max(1, f['diameter'])
                            if error > 0.1:
                                continue
                            distance = math.hypot(*local(lon, lat, f['lon'], f['lat']))
                            if distance > max(2, f['diameter']*0.12):
                                continue
                            shape = dict(kind='ellipse', source='robbins2020', center=[round(float(row['LON_ELLI_IMG']) % 360, 5), round(float(row['LAT_ELLI_IMG']), 5)], major=round(major, 3), minor=round(minor, 3), angle=round(angle, 3), angleSD=round(angle_sd, 3), arc=round(arc, 4), ref=row['CRATER_ID'])
                            candidates.append((distance/max(1, f['diameter'])+error, f['id'], shape))
    used = set()
    for score, id, shape in sorted(candidates, key=lambda c: c[0]):
        if features[id]['shape'] or shape['ref'] in used:
            continue
        features[id]['shape'] = shape
        used.add(shape['ref'])
    if args.albedo.exists():
        curated = json.loads(args.albedo.read_text())
        for item in curated['features']:
            f = features[item['id']]
            assert f['code'] == 'AL' and f['name'] == item['name']
            grid = curated['grid']
            ring = []
            for x, y in item['pixels']:
                lon = -(grid['westAtLeft'] + (x-grid['left'])/grid['width']*360) % 360
                graphic = math.asin(max(-1, min(1, (y-grid['equator'])/grid['latitudeScale'])))
                lat = math.atan((1-0.00589)**2 * math.tan(graphic)) / RAD
                ring.append([round(lon, 5), round(lat, 5)])
            fit = fit_ellipse([ring], f['lon'], f['lat']) if item.get('ellipse') else None
            f['shape'] = dict(source='albedo-map', epoch=curated['epoch'], map=curated['url'],
                **(dict(kind='ellipse', **fit) if fit else dict(kind='polygon', rings=[ring])))
    rows = [[f['id'], f['name'], round(f['lon'], 5), round(f['lat'], 5), round(f['diameter'], 3), f['code'], f['shape']] for f in sorted(features.values(), key=lambda f: f['id'])]
    hashes = {k: hashlib.sha256(getattr(args, k).read_bytes()).hexdigest() for k in ['centres', 'polygons', 'craters']}
    args.output.write_text('// Generated by tools/mars-features.py; see data/mars-features.md for sources.\n// [USGS ID, name, east longitude, planetocentric latitude, extent km, type, geometry]\nexport const MARS_FEATURES = '+json.dumps(rows, ensure_ascii=False, separators=(',', ':'))+';\n')
    print(len(rows), 'features;', Counter(f['shape']['source'] if f['shape'] else 'extent/point' for f in features.values()))
    print('source SHA256', json.dumps(hashes))
    print('output bytes', args.output.stat().st_size)

if __name__ == '__main__':
    main()
