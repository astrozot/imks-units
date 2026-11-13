"""Refine the Horizons satellite series without increasing their trig cost much.

Run tools/moons.mjs <cache> --fetch first, then:
  OPENBLAS_NUM_THREADS=1 python tools/refine-moons.py <cache>

Development dependencies: numpy, scipy, finufft. None are app dependencies.
The independent test vectors never enter the fit or its stopping criterion.
Secular cubic amplitudes model slowly varying perturbations. Additional
frequencies are chosen from the training residual with a nonuniform FFT.
"""
import argparse
import json
import pathlib

import finufft
import numpy as np
import scipy.linalg as la
import scipy.optimize as opt


def matrix(t, frequencies, complex_plane, degree):
    phase = t[:, None] * frequencies
    basis = np.exp(1j * phase) if complex_plane else np.stack([np.cos(phase), np.sin(phase)], -1).reshape(len(t), -1)
    return np.concatenate([basis * (t[:, None] / 36525) ** k for k in range(degree + 1)], 1)


def frame(pole):
    a, d = np.radians(pole)
    z = np.array([np.cos(d) * np.cos(a), np.cos(d) * np.sin(a), np.sin(d)])
    x = np.array([-z[1], z[0], 0]); x /= np.linalg.norm(x)
    return np.array([x, np.cross(z, x), z])


def refine(rows, baseline, period, radius, name):
    t, xyz = rows[:, 0] - 2451545, rows[:, 1:]
    fx = list(np.array(baseline[0]).reshape(-1, 3)[:, 0])
    fz = list(np.array(baseline[1]).reshape(-1, 3)[:, 0])
    degree = 3
    df = 2 * np.pi / (t[-1] - t[0]) / 3
    modes = 2 * int(np.ceil(3.5 * 2 * np.pi / abs(period) / df))
    # Iapetus's residual is not well represented by more fixed frequencies;
    # retain its secular improvement rather than adding weak alias peaks.
    cap = 0 if name == 'Iapetus' else 40
    for step in range(cap + 1):
        a, b = matrix(t, fx, True, degree), matrix(t, fz, False, degree)
        ca = la.lstsq(a, xyz[:, 0] + 1j * xyz[:, 1], cond=1e-10, lapack_driver='gelsy')[0]
        cb = la.lstsq(b, xyz[:, 2], cond=1e-10, lapack_driver='gelsy')[0]
        rx, rz = xyz[:, 0] + 1j * xyz[:, 1] - a @ ca, xyz[:, 2] - b @ cb
        error = np.sqrt(abs(rx) ** 2 + rz ** 2)
        if error.max() <= max(2, 0.0003 * radius) or step == cap:
            break
        complex_plane = abs(rx).max() >= abs(rz).max()
        residual = rx if complex_plane else rz.astype(complex)
        power = abs(finufft.nufft1d1(t * df, residual, modes, eps=1e-8, isign=-1, nthreads=1)) ** 2
        if not complex_plane:
            power[:modes // 2] = 0
        frequency = (np.argmax(power) - modes // 2) * df
        frequency = opt.minimize_scalar(lambda f: -abs(np.exp(-1j * f * t) @ residual) ** 2,
                                        bounds=(frequency - df, frequency + df), method='bounded',
                                        options={'xatol': 1e-14}).x
        (fx if complex_plane else fz).append(frequency)
    xy = np.stack([ca.real, ca.imag], -1).reshape(degree + 1, len(fx), 2).transpose(1, 0, 2)
    z = cb.reshape(degree + 1, len(fz), 2).transpose(1, 0, 2)
    return {'degree': degree, 'fx': fx, 'fz': fz, 'xy': xy.tolist(), 'z': z.tolist(),
            'trainMaxKm': float(error.max()), 'trainRmsKm': float(np.sqrt(np.mean(error ** 2)))}


def predict(fit, days):
    ca = np.array(fit['xy']); cb = np.array(fit['z'])
    degree = fit['degree']
    c = (ca[:, :, 0] + 1j * ca[:, :, 1]).T.reshape(-1)
    z = cb.transpose(1, 0, 2).reshape(-1)
    xy = matrix(days, fit['fx'], True, degree) @ c
    return np.stack([xy.real, xy.imag, matrix(days, fit['fz'], False, degree) @ z], 1)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('cache', type=pathlib.Path)
    parser.add_argument('--output', type=pathlib.Path, default=pathlib.Path(__file__).resolve().parents[1] / 'js/moons.js')
    args = parser.parse_args()
    root = args.cache
    baseline = json.loads((root / 'moons-baseline-series.json').read_text())
    systems = json.loads((root / 'systems.json').read_text())
    audit = json.loads((root / 'moons-audit.json').read_text()) if (root / 'moons-audit.json').exists() else {}
    report, output = {}, {}
    for planet, system in systems.items():
        axes = frame(system['pole'])
        output[planet] = {'radius': system['radius'], 'pole': system['pole'], 'moons': {}}
        for name, (ident, period) in system['moons'].items():
            cache = root / f'{name}-refined-v1.json'
            if cache.exists():
                fit = json.loads(cache.read_text())
            else:
                rows = np.array(json.loads((root / f'{ident}-train-v2.json').read_text()))
                rows[:, 1:] = rows[:, 1:] @ axes.T
                fit = refine(rows, baseline[planet]['moons'][name], period, system['radius'], name)
                cache.write_text(json.dumps(fit))
            tests = np.array(json.loads((root / f'{ident}-test-v2.json').read_text()))
            error = np.linalg.norm(predict(fit, tests[:, 0] - 2451545) - tests[:, 1:] @ axes.T, axis=1)
            report[name] = {'planet': planet, 'trainMaxKm': fit['trainMaxKm'], 'maxKm': float(error.max()),
                            'rmsKm': float(np.sqrt(np.mean(error ** 2))), 'termsXY': len(fit['fx']), 'termsZ': len(fit['fz'])}
            degree = fit['degree']
            xy, z = np.array(fit['xy']), np.array(fit['z'])
            base_xy = np.column_stack([fit['fx'], xy[:, 0, :]]).reshape(-1).tolist()
            base_z = np.column_stack([fit['fz'], z[:, 0, :]]).reshape(-1).tolist()
            # A working error allowance, not a formal statistical sigma.
            allowance = int(np.ceil(1.25 * max(error.max(), fit['trainMaxKm'], audit.get(name, {}).get('maxKm', 0))))
            output[planet]['moons'][name] = [base_xy, base_z, allowance,
                {'order': degree, 'xy': xy[:, 1:, :].reshape(-1).tolist(), 'z': z[:, 1:, :].reshape(-1).tolist()}]
            print(f'{name}: max {error.max():.1f} km, RMS {report[name]["rmsKm"]:.1f} km, {len(fit["fx"])} + {len(fit["fz"])} terms', flush=True)
    def nums(values):
        return '[' + ','.join(format(float(x), '.15g') for x in values) + ']'
    chunks = []
    for planet, system in output.items():
        moons = []
        for name, (xy, z, error, secular) in system['moons'].items():
            moons.append(f'      {name}: [\n        {nums(xy)},\n        {nums(z)},\n        {error},\n'
                         f'        {{ order: {secular["order"]}, xy: {nums(secular["xy"])}, z: {nums(secular["z"])} }},\n      ],')
        chunks.append(f'  {planet}: {{\n    radius: {system["radius"]},\n    pole: {nums(system["pole"])},\n    moons: {{\n' + '\n'.join(moons) + '\n    },\n  },')
    header = '''// Major satellite series fitted to JPL Horizons, 1900–2100.
// Generated by tools/refine-moons.py after tools/moons.mjs --fetch.
// Frame: planet's fixed J2000 equator, km; t = TT days since J2000.
// Each moon: [xy terms (f,a,b), z terms (f,a,b), error allowance km,
// {order, xy, z}]. Secular coefficients extend each a,b as a polynomial
// in t/36525, interleaved by term, then increasing power (starting at 1).
// xy = sum (a+ib) exp(ift); z = sum a cos(ft)+b sin(ft).
// Allowances = 1.25 times the larger of training and validation maxima;
// sampled comparisons are not certified bounds or statistical sigmas.
// Validation: independent stratified dates across the full interval,
// including both endpoints. See data/astronomy-accuracy.json.

export const MOONS = {
'''
    args.output.write_text(header + '\n'.join(chunks) + '\n};\n')
    (root / 'moons-refined-validation.json').write_text(json.dumps(report, indent=2) + '\n')


if __name__ == '__main__':
    main()
