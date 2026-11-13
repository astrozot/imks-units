"""Compile pinned Stellarium ephemerides and compare with Horizons vectors.

python tools/stellarium-check.py <Horizons-cache> <Stellarium-source-cache>
Use --fetch to download sources at the pinned revision. Requires numpy
and a C compiler, only during development. No Stellarium code is shipped
in the app. The source cache retains the upstream license notices.
"""
import argparse
import ctypes
import json
import pathlib
import re
import subprocess
import urllib.request

import numpy as np

COMMIT = 'aa2b7127eb991b02edfc7c9208622057271feb1d'
SOURCES = ['l12', 'tass17', 'gust86', 'marssat', 'vsop87', 'elp82b',
           'elliptic_to_rectangular', 'calc_interpolated_elements']


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('horizons', type=pathlib.Path)
    parser.add_argument('source', type=pathlib.Path)
    parser.add_argument('--fetch', action='store_true')
    args = parser.parse_args()
    args.source.mkdir(parents=True, exist_ok=True)
    if args.fetch:
        for name in [f'{stem}.{suffix}' for stem in SOURCES for suffix in ['c', 'h']] + ['EphemWrapper.cpp']:
            url = f'https://raw.githubusercontent.com/Stellarium/stellarium/{COMMIT}/src/core/planetsephems/{name}'
            (args.source / name).write_bytes(urllib.request.urlopen(url, timeout=60).read())
        (args.source / 'commit.txt').write_text(COMMIT + '\n')
    if (args.source / 'commit.txt').read_text().strip() != COMMIT:
        raise ValueError('Source revision mismatch; use --fetch for the pinned comparison')
    library = args.source.resolve() / 'comparison.so'
    subprocess.run(['cc', '-O2', '-shared', '-fPIC', *[str(args.source / f'{s}.c') for s in SOURCES], '-lm', '-o', str(library)], check=True)
    lib = ctypes.CDLL(str(library))
    text = (args.source / 'tass17.c').read_text()
    def matrix(name):
        values = re.search(name + r'\[9\] = \{([^}]+)', text).group(1)
        return np.array([float(x) for x in values.split(',')]).reshape(3, 3)
    # Use Stellarium's own dynamical-ecliptic -> equatorial J2000 rotation,
    # including its small equinox offset, rather than assuming ICRF=ecliptic.
    rotation = matrix('TASS17toJ2000') @ matrix('TASS17toVSOP87').T
    systems = json.loads((args.horizons / 'systems.json').read_text())
    results, positions = {}, {}
    for planet, system in systems.items():
        if planet == 'neptune':
            continue  # No matching Triton routine in these Stellarium sources.
        function = getattr(lib, {'mars': 'GetMarsSatCoor', 'jupiter': 'GetL12Coor', 'saturn': 'GetTass17Coor', 'uranus': 'GetGust86Coor'}[planet])
        function.argtypes = [ctypes.c_double, ctypes.c_int, ctypes.POINTER(ctypes.c_double), ctypes.POINTER(ctypes.c_double)]
        function.restype = None
        for i, (name, (ident, _)) in enumerate(system['moons'].items()):
            index = {'Hyperion': 7, 'Iapetus': 6}.get(name, i)
            rows = json.loads((args.horizons / f'{ident}-test-v2.json').read_text())
            errors, values = [], []
            for jd, *reference in rows:
                p, v = (ctypes.c_double * 3)(), (ctypes.c_double * 3)()
                function(jd, index, p, v)
                position = rotation @ np.array(p) * 149597870.7
                errors.append(float(np.linalg.norm(position - reference)))
                values.append([jd, *position.tolist()])
            results[name] = {'maxKm': max(errors), 'rmsKm': float(np.sqrt(np.mean(np.array(errors) ** 2)))}
            positions[name] = values
            print(f'{name}: Stellarium–Horizons max {max(errors):.1f} km, RMS {results[name]["rmsKm"]:.1f} km', flush=True)
    # Also record the geometric VSOP87/ELP82B fallback used for the main
    # bodies. A Stellarium installation using DE440/441 has different
    # reference positions: the comparison is explicitly configuration-specific.
    dates = [2305500.5, 2415020.5, 2451545, 2461345.5, 2597500.5]
    vsop, moon = lib.GetVsop87Coor, lib.GetElp82bCoor
    vsop.argtypes = [ctypes.c_double, ctypes.c_int, ctypes.POINTER(ctypes.c_double)]
    moon.argtypes = [ctypes.c_double, ctypes.POINTER(ctypes.c_double)]
    main_bodies = {}
    for jd in dates:
        m = (ctypes.c_double * 3)(); moon(jd, m)
        for i, name in enumerate(['mercury', 'venus', 'earth', 'mars', 'jupiter', 'saturn', 'uranus', 'neptune']):
            p = (ctypes.c_double * 6)(); vsop(jd, i, p)
            position = np.array(p[:3])
            if name == 'earth':
                position -= 0.0121505677733761 * np.array(m)  # EMB -> Earth, as EphemWrapper.cpp.
            main_bodies.setdefault(name, []).append([jd, *position.tolist()])
        main_bodies.setdefault('moon', []).append([jd, *(rotation @ np.array(m) * 149597870.7).tolist()])
    report = {'commit': COMMIT, 'configuration': 'Analytic VSOP87/ELP82B, MarsSat, L1.2, TASS 1.7, GUST86; no JPL binary ephemeris', 'errors': results}
    (args.horizons / 'stellarium-comparison.json').write_text(json.dumps(report, indent=2) + '\n')
    (args.horizons / 'stellarium-positions.json').write_text(json.dumps(positions) + '\n')
    (args.horizons / 'stellarium-main-positions.json').write_text(json.dumps(main_bodies) + '\n')


if __name__ == '__main__':
    main()
