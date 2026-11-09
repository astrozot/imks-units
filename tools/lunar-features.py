#!/usr/bin/env python3
"""Build the offline lunar gazetteer from the official USGS KMZ.

Download https://asc-planetarynames-data.s3.us-west-2.amazonaws.com/MOON_nomenclature_center_pts.kmz
then run: python3 tools/lunar-features.py /path/to/MOON_nomenclature_center_pts.kmz
"""
import json
from pathlib import Path
import sys
import xml.etree.ElementTree as ET
from zipfile import ZipFile

ns = {'k': 'http://www.opengis.net/kml/2.2'}
with ZipFile(sys.argv[1]) as archive:
    root = ET.fromstring(archive.read('MOON_nomenclature_center_pts.kml'))
rows = []
for feature in root.findall('.//k:Placemark', ns):
    data = {item.attrib['name']: item.text for item in feature.findall('.//k:SimpleData', ns)}
    if data['approval'] != 'Adopted by IAU':
        continue
    rows.append([int(data['link'].rsplit('/', 1)[1]), feature.find('k:name', ns).text,
                 round(float(data['center_lon']), 4), round(float(data['center_lat']), 4),
                 round(float(data['diameter']), 3), data['code']])
rows.sort(key=lambda row: row[0])
output = Path(__file__).resolve().parents[1] / 'js/lunardata.js'
output.write_text('// IAU/USGS Gazetteer of Planetary Nomenclature, retrieved 2026-11-09.\n'
                  '// East longitude, planetocentric latitude (LOLA 2011).\n'
                  '// Source: https://planetarynames.wr.usgs.gov/Page/MOON/target\n'
                  '// Regenerate with tools/lunar-features.py; includes lettered satellite craters.\n'
                  '// [USGS feature ID, name, longitude, latitude, diameter/longest extent (km), type]\n'
                  'export const LUNAR_FEATURES = [\n' +
                  ',\n'.join(json.dumps(row, ensure_ascii=False, separators=(',', ':')) for row in rows) + '\n];\n')
print(f'{len(rows)} features, {output.stat().st_size} bytes')
