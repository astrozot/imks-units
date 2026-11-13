"""Refine the lunar series with linear secular amplitudes.

node tools/moon.mjs <cache> --fetch
OPENBLAS_NUM_THREADS=1 python tools/refine-moon.py <cache>
node tools/moon.mjs <cache> --audit

Requires numpy and scipy for development only. Fits geometric Horizons
vectors; independent validation/audit vectors never enter the fit.
"""
import argparse
import json
import pathlib

import numpy as np
import scipy.linalg as la

RAD = np.pi / 180
AS = RAD / 3600
POLYS = [[218.3164477, 481267.88123421, -.0015786, 1/538841, -1/65194000],
         [297.8501921, 445267.1114034, -.0018819, 1/545868, -1/113065000],
         [357.5291092, 35999.0502909, -.0001536, 1/24490000],
         [134.9633964, 477198.8675055, .0087414, 1/69699, -1/14712000],
         [93.272095, 483202.0175233, -.0036539, -1/3526000, 1/863310000]]


def samples(file):
    rows = np.array(json.loads(file.read_text()))
    T = (rows[:, 0] - 2451545) / 36525
    x, y, z = rows[:, 1:].T
    zeta = (2306.2181*T + .30188*T*T + .017998*T**3)*AS
    zz = (2306.2181*T + 1.09468*T*T + .018203*T**3)*AS
    th = (2004.3109*T - .42665*T*T - .041833*T**3)*AS
    x1, y1 = x*np.cos(zeta)-y*np.sin(zeta), x*np.sin(zeta)+y*np.cos(zeta)
    x2, z2 = x1*np.cos(th)-z*np.sin(th), x1*np.sin(th)+z*np.cos(th)
    x, y, z = x2*np.cos(zz)-y1*np.sin(zz), x2*np.sin(zz)+y1*np.cos(zz), z2
    eps = (84381.448-46.815*T-.00059*T*T+.001813*T**3)*AS
    ye, ze = y*np.cos(eps)+z*np.sin(eps), -y*np.sin(eps)+z*np.cos(eps)
    args = np.array([np.polynomial.polynomial.polyval(T, p)*RAD for p in POLYS])
    lon = np.arctan2(ye, x)-args[0]
    lon = np.arctan2(np.sin(lon), np.cos(lon))
    return T, args[1:], {'lon': lon, 'lat': np.arctan2(ze, np.hypot(x, ye)), 'dist': np.sqrt(x*x+y*y+z*z)}


def basis(T, args, model):
    d = np.array(model['delaunay']).reshape(-1, 6)
    f = np.array(model['fixed']).reshape(-1, 3)
    phases = args.T @ d[:, :4].T
    E = (1-.002516*T-.0000074*T*T)[:, None] ** abs(d[:, 1])
    periodic = np.concatenate([np.stack([E*np.sin(phases), E*np.cos(phases)], -1).reshape(len(T), -1),
                               np.stack([np.sin(T[:, None]*36525*f[:, 0]), np.cos(T[:, None]*36525*f[:, 0])], -1).reshape(len(T), -1)], 1)
    return np.concatenate([T[:, None]**np.arange(len(model['poly'])), periodic, periodic*T[:, None]], 1)


def predict(model, T, args):
    d = np.array(model['delaunay']).reshape(-1, 6)
    f = np.array(model['fixed']).reshape(-1, 3)
    secular = model.get('secular', {})
    c = np.concatenate([model['poly'], d[:, 4:].reshape(-1), f[:, 1:].reshape(-1),
                        secular.get('delaunay', np.zeros(2*len(d))), secular.get('fixed', np.zeros(2*len(f)))])
    return basis(T, args, model) @ c


def compare(models, S):
    T, args, targets = S
    pred = {key: predict(model, T, args) for key, model in models.items()}
    errors = np.hypot((pred['lon']-targets['lon'])*np.cos(targets['lat']), pred['lat']-targets['lat']) / AS
    return {'maxArcsec': float(errors.max()), 'rmsArcsec': float(np.sqrt(np.mean(errors**2))),
            'maxDistanceKm': float(max(abs(pred['dist']-targets['dist'])))}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('cache', type=pathlib.Path)
    parser.add_argument('--output', type=pathlib.Path, default=pathlib.Path(__file__).resolve().parents[1] / 'js/moonseries.js')
    parser.add_argument('--rcond', type=float, default=1e-8, help='discard nearly dependent periodic columns for stable endpoint predictions')
    a = parser.parse_args()
    original = json.loads((a.cache/'moon-baseline-series.json').read_text())
    T, args, target = samples(a.cache/'moon.json')
    models = {}
    for key, model in original.items():
        d = np.array(model['delaunay']).reshape(-1, 6)
        f = np.array(model['fixed']).reshape(-1, 3)
        p, nd, nf = len(model['poly']), len(d), len(f)
        coeff = la.lstsq(basis(T, args, model), target[key], cond=a.rcond, lapack_driver='gelsy')[0]
        models[key] = {'poly': coeff[:p].tolist(),
            'delaunay': np.column_stack([d[:, :4], coeff[p:p+2*nd].reshape(-1, 2)]).reshape(-1).tolist(),
            'fixed': np.column_stack([f[:, 0], coeff[p+2*nd:p+2*(nd+nf)].reshape(-1, 2)]).reshape(-1).tolist(),
            'secular': {'delaunay': coeff[p+2*(nd+nf):p+2*(nd+nf)+2*nd].tolist(), 'fixed': coeff[p+2*(nd+nf)+2*nd:].tolist()}}
    validation = compare(models, samples(a.cache/'moon-test.json'))
    report = {'trainingSamples': len(T), 'validation': validation}
    if (a.cache/'moon-audit-v1.json').exists():
        audit = samples(a.cache/'moon-audit-v1.json')
        report['beforeAudit'] = compare(original, audit)
        report['audit'] = compare(models, audit)
    def nums(values):
        return '[' + ','.join(format(float(x), '.15g') for x in values) + ']'
    chunks = []
    for key, model in models.items():
        chunks.append(f'  {key}: {{\n    poly: {nums(model["poly"])},\n    delaunay: {nums(model["delaunay"])},\n'
                      f'    fixed: {nums(model["fixed"])},\n    secular: {{ delaunay: {nums(model["secular"]["delaunay"])}, fixed: {nums(model["secular"]["fixed"])} }},\n  }}')
    header = f'''// Geocentric geometric Moon, mean ecliptic/equinox of date, 1600–2400.
// Generated by tools/refine-moon.py from Horizons vectors. Training begins
// in 1601; the independent audit also checks the 1600 and 2400 endpoints.
// Periodic amplitudes a,b vary linearly in T (TT centuries since J2000).
// Delaunay: d,m,m',f,a,b; fixed: frequency (rad/day),a,b. Secular arrays
// hold the matching linear a,b coefficients. Longitude is from L' (rad),
// latitude rad, distance km. E^|m| multiplies each Delaunay term.
// 400 independent validation dates: max {validation['maxArcsec']:.3f} arcsec,
// RMS {validation['rmsArcsec']:.3f} arcsec, distance {validation['maxDistanceKm']:.3f} km.
// Independent audit and limitations: data/astronomy-accuracy.json.

export const MOON = {{
'''
    a.output.write_text(header + ',\n'.join(chunks) + '\n};\n')
    (a.cache/'moon-refined-validation.json').write_text(json.dumps(report, indent=2) + '\n')
    print(json.dumps(report, indent=2))


if __name__ == '__main__':
    main()
