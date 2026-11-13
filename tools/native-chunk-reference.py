"""Independent jplephem native-state references from staged exact chunks.

python tools/native-chunk-reference.py staged-directory manifest-path output-json
Sparse files made here are development fixtures, NEVER production uploads.
Only the advertised original records are reconstructed; holes are unreadable
for scientific purposes. The code evaluates each selected state with
jplephem, independently of the browser SPK parser or Chebyshev evaluator.
"""
import json
import pathlib
import sys
import tempfile
import subprocess

import jplephem
import skyfield
import erfa
import numpy as np
from jplephem.spk import SPK
from skyfield.timelib import julian_date
from skyfield.api import load, load_file, wgs84

directory, catalogue, output = map(pathlib.Path, sys.argv[1:])
manifest = json.loads(catalogue.read_text())
systems = {
    'mar099': (4, [499, 401, 402]),
    'jup365': (5, [599, 501, 502, 503, 504]),
    'sat441': (6, [699, 601, 602, 603, 604, 605, 606, 607, 608]),
    'ura184': (7, [799, 705, 701, 702, 703, 704]),
    'nep097': (8, [899, 801]),
}
states, positions = [], []
with tempfile.TemporaryDirectory(prefix='astrolabium-native-reference-') as temporary:
    for name, descriptor in manifest['kernels'].items():
        file = pathlib.Path(temporary) / (name + '.bsp')
        size = descriptor.get('chunkBytes', manifest['chunkBytes'])
        with file.open('wb') as handle:
            handle.truncate(descriptor['bytes'])
            for chunk in (directory / descriptor['path']).glob('[0-9]*.bin'):
                handle.seek(int(chunk.stem) * size)
                handle.write(chunk.read_bytes())
        if name in systems:
            center, targets = systems[name]
            pairs = [(center, target) for target in targets]
            dates = [(1900, 6, 1), (2024, 4, 8), (2099, 6, 1)]
            if name == 'mar099':
                # Native solution epochs meet here; check both sides and
                # the inclusive SPICE-precedence boundary itself.
                dates += [(1989, 2, 17.875), (1989, 2, 18), (1989, 2, 18.125)]
        else:
            pairs = [(0, t) for t in [1, 2, 3, 4, 5, 6, 7, 8, 10]] + [(3, 301), (3, 399)]
            dates = [(-1000, 1, 2), (-653, 6, 1), (1, 6, 1), (1500, 6, 1)] if name == 'de441-part1' else [(2800, 6, 1), (3000, 12, 30)] if name == 'de441-part2' else [(2024, 4, 8)]
        with SPK.open(file) as kernel:
            for year, month, day in dates:
                jd = float(julian_date(year, month, day))
                for center, target in pairs:
                    segment = next(s for s in reversed(kernel.segments) if s.center == center and s.target == target and s.start_jd <= jd <= s.end_jd)
                    position, velocity = segment.compute_and_differentiate(jd)
                    states.append([name, center, target, jd, *position.tolist(), *velocity.tolist()])
        if name.startswith('de441'):
            eph = load_file(str(file))
            for year, month, day in dates:
                t = (float(julian_date(year, month, day)) - 2440587.5) * 86400
                # Share only the declared ancient/future clock assumption;
                # all state, observer and apparent-position work is Skyfield.
                script = "import {precisionClock} from './js/precisionephem.js';console.log(JSON.stringify(precisionClock({orientation:()=>null},Number(process.argv[1]))));"
                c = json.loads(subprocess.check_output(['node', '--input-type=module', '-e', script, '--', str(t)], cwd=pathlib.Path(__file__).resolve().parents[1]))
                ts = load.timescale(builtin=True)
                delta = (c['ttJD']-c['ut1JD'])*86400
                ts.delta_t_function = lambda jd: jd*0+delta
                clock = ts.tt_jd(c['ttJD'])
                # Skyfield uses a different precession parameterisation;
                # standardise the comparison to IAU 2006/2000A using ERFA,
                # independently of the app's truncated nutation series.
                clock.M = erfa.pnm06a(2451545., c['ttJD']-2451545.)
                clock.MT = clock.M.T
                clock.gast = float(erfa.gst06a(2451545., c['ut1JD']-2451545., 2451545., c['ttJD']-2451545.))*12/np.pi
                for place in [None, [45.4642, 9.19, 120]]:
                    observer = eph['earth'] if place is None else eph['earth']+wgs84.latlon(*place[:2], elevation_m=place[2])
                    for body in ['sun', 'moon', 'mercury', 'venus']:
                        astrometric = observer.at(clock).observe(eph[body])
                        apparent = astrometric.apparent()
                        ra, dec, distance = apparent.radec(epoch='date')
                        positions.append(dict(t=t, body=body, place=place, ra=float(ra.degrees), dec=float(dec.degrees), dist=float(astrometric.distance().km)))
            eph.close()
result = {'source': {'evaluator': 'jplephem ' + jplephem.__version__,
                     'apparentEvaluator': 'Skyfield ' + skyfield.__version__ + ' with ERFA ' + erfa.__version__ + ' pnm06a/gst06a',
                     'apparentMeaning': 'App DeltaT clock assumption; independently computed apparent RA/Dec and astrometric distance; WGS84 observer without refraction',
                     'meaning': 'Native ICRF km and km/day; not an event-accuracy claim',
                     'catalogueCreated': manifest.get('created'),
                     'kernels': {name: {'source': d.get('source'), 'publishedMd5': d.get('publishedMd5'), 'indexSha256': d['indexSha256']} for name, d in manifest['kernels'].items()}},
          'states': states, 'positions': positions}
output.write_text(json.dumps(result, separators=(',', ':')) + '\n')
print(f'Wrote {len(states)} independent native states to {output}')
