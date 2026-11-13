"""Generate independent ERFA stellar references: python tools/stellar-reference.py.

Development dependency: pyerfa. No runtime dependency. The app supplies only
its modelled TT and UT1 clock assumptions; ERFA supplies Earth ephemerides,
IAU 2006/2000A frames, space motion, parallax, deflection and aberration.
Refraction and polar motion are disabled to match the compact sky model.
"""
import json
import pathlib
import subprocess

import erfa
import numpy as np

root = pathlib.Path(__file__).resolve().parents[1]
clocks = json.loads(subprocess.check_output([
    'node', '--input-type=module', '-e', """
import {centuries, siderealTime, equatorial, surfaceObserver} from './js/astro.js';
const dates=['1900-03-21','2000-06-21','2026-03-21','2026-06-21','2026-09-21','2026-12-21','2099-12-21'];
const places=[[0,0,0],[45,9,120],[-33,151,2000],[90,0,0]];
console.log(JSON.stringify(dates.map(d=>{
  const t=Date.parse(d+'T12:00Z')/1000;
  return {t,tt:2451545+centuries(t)*36525,ut1:t/86400+2440587.5,gast:siderealTime(t,0)*Math.PI/180,
    local:places.map(place=>({place,preDiurnal:[[0,0],[90,45],[270,-60],[359.99,89.99]].map(([ra,dec])=>
      ({star:{ra,dec},...equatorial({ra,dec},t,null,surfaceObserver(t,place).position)}))}))};
})));
"""], cwd=root))
frame_clocks = json.loads(subprocess.check_output([
    'node', '--input-type=module', '-e', """
import {centuries} from './js/astro.js';
const dates=['-001000-06-01','0000-06-01','1000-06-01','1600-06-01','1900-03-21','2000-06-21','2026-03-21','2099-12-21','2400-06-01','3000-06-01'];
console.log(JSON.stringify(dates.map(d=>{const t=Date.parse(d+'T12:00Z')/1000;return {t,tt:2451545+centuries(t)*36525,ut1:t/86400+2440587.5};})));
"""], cwd=root))
stars = [
    dict(ra=0, dec=0, pmra=0, pmdec=0, plx=0),
    dict(ra=90, dec=45, pmra=0, pmdec=0, plx=0),
    dict(ra=90, dec=45, pmra=0, pmdec=0, plx=768),
    dict(ra=270, dec=-60, pmra=0, pmdec=0, plx=0),
    dict(ra=359.9, dec=89.99, pmra=10, pmdec=-20, plx=100),
    dict(ra=217.4, dec=-62.7, pmra=-3600, pmdec=700, plx=768),
    dict(ra=269.45, dec=4.69, pmra=-800, pmdec=10300, plx=548),
]
rows, diurnal = [], []
for clock in clocks:
    tt, ut1 = clock['tt'], clock['ut1']
    pvh, pvb = erfa.epv00(2451545, tt-2451545)
    x, y, s = erfa.xys06a(2451545, tt-2451545)
    for entry in clock['local']:
        place = entry['place']
        lat, lon, height = place
        astrom = erfa.apco(2451545, tt-2451545, pvb, pvh[0], x, y, s,
                          erfa.era00(2451545, ut1-2451545), np.deg2rad(lon),
                          np.deg2rad(lat), height, 0, 0,
                          erfa.sp00(2451545, tt-2451545), 0, 0)
        for star in stars:
            ra, dec = np.deg2rad([star['ra'], star['dec']])
            ri, di = erfa.atciq(ra, dec, star['pmra']*erfa.DAS2R/1000/np.cos(dec),
                               star['pmdec']*erfa.DAS2R/1000, star['plx']/1000, 0, astrom)
            az, zd, *_ = erfa.atioq(ri, di, astrom)
            rows.append(dict(t=clock['t'], place=place, star=star,
                             alt=90-np.rad2deg(zd), az=np.rad2deg(az)))
        # Isolate the rotational correction independently of annual terms.
        local = erfa.apio(0, clock['gast'], np.deg2rad(lon), np.deg2rad(lat), height, 0, 0, 0, 0)
        for before in entry['preDiurnal']:
            ra, dec = before['ra'], before['dec']
            az, zd, *_ = erfa.atioq(np.deg2rad(ra), np.deg2rad(dec), local)
            diurnal.append(dict(t=clock['t'], place=place, star=before['star'], ra=ra, dec=dec,
                                alt=90-np.rad2deg(zd), az=np.rad2deg(az)))
# Isolate light deflection over the limb and the regularised solar disk.
deflection = []
for distance in [0.983, 1, 1.017]:
    for angle in [0, 1e-8, 0.01, 0.08, 0.2666, 0.5, 1, 5, 90, 180]:
        a = np.deg2rad(angle)
        source = np.array([-np.cos(a), np.sin(a), 0])
        e = np.array([1., 0, 0])
        natural = erfa.ldsun(source, e, distance)
        natural /= np.linalg.norm(natural)
        deflection.append(dict(observer=(e*distance).tolist(), source=source.tolist(), natural=natural.tolist()))
frames = []
for clock in frame_clocks:
    tt, ut1 = clock['tt'], clock['ut1']
    frames.append(dict(**clock, matrix=erfa.pnm06a(2451545, tt-2451545).tolist(),
                       gast=float(erfa.gst06a(2451545, ut1-2451545, 2451545, tt-2451545))))
out = dict(source=f'ERFA {erfa.__version__}: epv00, apco, atciq, atioq; isolated rotation via apio/atioq; deflection via ldsun; frames via pnm06a/gst06a',
           scope='Independent full apparent positions; compact-model approximations remain. TT/UT1 clocks shared, zero refraction/polar motion, zero radial velocity.',
           rows=rows, diurnal=diurnal, deflection=deflection, frames=frames)
(root/'tests/fixtures/stellar-positions.json').write_text(json.dumps(out, indent=2)+'\n')
