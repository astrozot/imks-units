"""Independent Skyfield/SciPy and ERFA checks for optional DE440 events.

python tools/precision-reference.py /path/de440s.bsp --eop finals2000A.all
Development only: pip install skyfield scipy pyerfa. No runtime dependency.
The reference shares the physical radii and explicit time assumptions, not
the app's frame, apparent-position, observer, separation or contact solver.
"""
import argparse
import datetime as dt
import json
import pathlib
import subprocess

import erfa
import numpy as np
from scipy.optimize import brentq, minimize_scalar
from skyfield.api import load, load_file, wgs84, Star

ROOT = pathlib.Path(__file__).resolve().parents[1]
P = argparse.ArgumentParser(description=__doc__)
P.add_argument('kernel')
P.add_argument('--eop', required=True)
A = P.parse_args()
eph = load_file(A.kernel)
ts = load.timescale(builtin=True)
rows = []
for line in pathlib.Path(A.eop).read_text().splitlines():
    try:
        rows.append([float(line[7:15])+2400000.5, float(line[18:27]), float(line[37:46]), float(line[58:68])])
    except ValueError:
        pass
rows = np.array(rows)

# Export only the app's clock assumptions for dates beyond measured EOP.
# Modern TT and UT1 below are instead independently calculated from IERS.
clock_js = """
import fs from 'node:fs';
import {precisionClock} from './js/precisionephem.js';
import {readPrecisionPack} from './js/precisionpack.js';
const times=JSON.parse(fs.readFileSync(0,'utf8'));
console.log(JSON.stringify(times.map(t=>{let y=new Date(t*1000).getUTCFullYear(),b=fs.readFileSync(`data/precision/${y}.bin`),p=readPrecisionPack(b.buffer.slice(b.byteOffset,b.byteOffset+b.byteLength));let c=precisionClock(p,t);return {tt:c.ttJD,ut1:c.ut1JD};})));
"""
def seconds(s):
    return dt.datetime.fromisoformat(s).replace(tzinfo=dt.timezone.utc).timestamp()

def context(t):
    utc = t/86400+2440587.5
    if rows[0, 0] <= utc <= rows[-1, 0]:
        # Skyfield supplies the historical UTC leap-second table; IERS
        # supplies UT1/polar motion, with no app code in this branch.
        day = dt.datetime.fromtimestamp(t, dt.timezone.utc)
        clock = ts.utc(day)
        i = min(len(rows)-2, np.searchsorted(rows[:, 0], utc, side='right')-1)
        f = (utc-rows[i, 0])/(rows[i+1, 0]-rows[i, 0])
        u1, u2 = rows[i:i+2, 3]
        if abs(u2-u1) > .5:
            u2 -= round(u2-u1)
        ut1 = utc+(u1+f*(u2-u1))/86400
        delta = (clock.tt-ut1)*86400
        xp, yp = rows[i, 1:3]+f*(rows[i+1, 1:3]-rows[i, 1:3])
    else:
        c = json.loads(subprocess.check_output(['node', '--input-type=module', '-e', clock_js], input=json.dumps([t]).encode(), cwd=ROOT))[0]
        clock = ts.tt_jd(c['tt'])
        delta = (c['tt']-c['ut1'])*86400
        xp = yp = 0
    ts.delta_t_function = lambda jd: np.zeros_like(jd)+delta
    ts.polar_motion_table = (np.array([clock.tt-10, clock.tt+10]), np.array([xp, xp]), np.array([yp, yp]))
    return clock

positions, frames, clocks = [], [], []
for stamp in ['1900-01-01T00:00:00','1900-12-31T23:59:00','1975-04-01T12:00:00','2000-01-01T12:00:00','2017-08-21T18:20:00','2024-04-08T18:42:00','2024-12-31T23:59:00','2100-01-01T00:00:00','2100-12-31T23:59:00']:
    t = seconds(stamp)
    clock = context(t)
    clocks.append(dict(t=t, tt=float(clock.tt), ut1=float(clock.ut1)))
    dp, de = erfa.nut00b(2451545., clock.tt-2451545.)
    T = (clock.tt-2451545)/36525
    dp *= 1+.4697e-6-2.7774e-6*T
    de *= 1-2.7774e-6*T
    gamb, phib, psib, epsa = erfa.pfw06(2451545., clock.tt-2451545.)
    matrix = erfa.fw2m(gamb, phib, psib+dp, epsa+de)
    frames.append(dict(tt=float(clock.tt), matrix=matrix.tolist(), dpsi=float(dp), deps=float(de)))
    for place in [None, [45.4642,9.19,120], [-33.8688,151.2093,50]]:
        obs = eph['earth'] if place is None else eph['earth']+wgs84.latlon(*place[:2], elevation_m=place[2])
        for body in ['sun','moon','mercury','venus']:
            apparent = obs.at(clock).observe(eph[body]).apparent()
            ra, dec, distance = apparent.radec(epoch='date')
            positions.append(dict(t=t,body=body,place=place,ra=ra.degrees,dec=dec.degrees,dist=distance.km))

events = []
solar = [
 ('Dallas','2024-04-08T18:42:00',[32.7767,-96.797,130]),
 ('Carbondale','2017-08-21T18:21:00',[37.7273,-89.2168,126]),
 ('La Serena','2019-07-02T20:39:00',[-29.9027,-71.252,28]),
 ('Pucon','2020-12-14T16:03:00',[-39.282,-71.954,227]),
 ('Albuquerque','2023-10-14T16:37:00',[35.0844,-106.6504,1619]),
 ('Munich','1999-08-11T10:38:00',[48.1372,11.5756,520]),
 ('Luxor','2027-08-02T10:04:00',[25.6872,32.6396,89]),
 ('Sydney','2028-07-22T04:00:00',[-33.8688,151.2093,50]),
 ('No eclipse','2024-04-08T18:42:00',[0,0,0]),
]

def roots(f, mid, half):
    def side(a,b):
        return None if f(a)*f(b)>0 else float(brentq(f,a,b,xtol=.0001))
    return side(mid-half,mid),side(mid,mid+half)

for name, stamp, place in solar:
    t = seconds(stamp)
    context(t)
    obs = eph['earth']+wgs84.latlon(*place[:2],elevation_m=place[2])
    def at(x):
        clock = context(x)
        o = obs.at(clock)
        m,s = [o.observe(eph[b]).apparent() for b in ['moon','sun']]
        return m.separation_from(s).radians, np.arcsin(1737.4/m.distance().km), np.arcsin(695700/s.distance().km)
    mid = t+minimize_scalar(lambda x: at(t+x)[0],bounds=(-10800,10800),method='bounded',options={'xatol':.0001}).x
    d,m,s = at(mid)
    event = None
    if d < m+s:
        outer = lambda x: (lambda d,m,s:d-m-s)(*at(x))
        inner = lambda x: (lambda d,m,s:d-abs(m-s))(*at(x))
        c1,c4 = roots(outer,mid,14400)
        c2,c3 = roots(inner,mid,14400) if d < abs(m-s) else (None,None)
        event = dict(max=float(mid),C1=c1,C2=c2,C3=c3,C4=c4,kind=('total' if m>s else 'annular') if c2 else 'partial')
    events.append(dict(name=name,kind='solar',t=t,place=place,event=event))
    print(name, event, flush=True)

# Point-star disappearance/reappearance, independently propagated by
# Skyfield including proper motion, parallax and radial velocity.
regulus = dict(ra=152.092962,dec=11.967209,pmra=-249.4,pmdec=4.91,plx=41.13,rv=6)
star = Star(ra_hours=regulus['ra']/15,dec_degrees=regulus['dec'],ra_mas_per_year=regulus['pmra'],dec_mas_per_year=regulus['pmdec'],parallax_mas=regulus['plx'],radial_km_per_s=regulus['rv'])
t = seconds('2036-05-31T15:40:00')
place = [45.4642,9.19,120]
obs = eph['earth']+wgs84.latlon(*place[:2],elevation_m=place[2])
def star_at(x):
    o = obs.at(context(x))
    m,s = o.observe(eph['moon']).apparent(),o.observe(star).apparent()
    return m.separation_from(s).radians,np.arcsin(.2725076*6378.137/m.distance().km)
mid = t+minimize_scalar(lambda x:star_at(t+x)[0],bounds=(-14400,14400),method='bounded',options={'xatol':.0001}).x
c1,c4 = roots(lambda x:(lambda d,r:d-r)(*star_at(x)),mid,14400)
events.append(dict(name='Regulus Milan',kind='occultation',front='moon',target=regulus,t=t,place=place,event=dict(max=float(mid),C1=c1,C4=c4)))

for stamp in ['2000-01-21T04:44:00','2022-11-08T10:59:00','2025-03-14T06:59:00']:
    t = seconds(stamp)
    def lunar_at(x):
        clock = context(x)
        o = eph['earth'].at(clock)
        m,s = [o.observe(eph[b]).apparent() for b in ['moon','sun']]
        pm,ps,ss = np.arcsin(6378.137/m.distance().km),np.arcsin(6378.137/s.distance().km),np.arcsin(695700/s.distance().km)
        return np.pi-m.separation_from(s).radians,np.arcsin(1737.4/m.distance().km),1.01*pm+ps-ss,1.01*pm+ps+ss
    mid = t+minimize_scalar(lambda x:lunar_at(t+x)[0],bounds=(-10800,10800),method='bounded',options={'xatol':.0001}).x
    d,m,u,p = lunar_at(mid)
    contact = lambda index,sign: roots(lambda x:(lambda g:g[0]-g[index]-sign*g[1])(lunar_at(x)),mid,.4*86400)
    p1,p4 = contact(3,1)
    u1,u4 = contact(2,1) if d<u+m else (None,None)
    u2,u3 = contact(2,-1) if d<u-m else (None,None)
    events.append(dict(name='Lunar '+stamp[:10],kind='lunar',t=t,event=dict(max=float(mid),P1=p1,U1=u1,U2=u2,U3=u3,U4=u4,P4=p4,kind='total' if u2 else 'partial' if u1 else 'penumbral')))
out = dict(source={'positions':'Skyfield '+__import__('skyfield').__version__,'frames':'ERFA '+erfa.__version__,'kernel':'JPL DE440s','time':'IERS finals2000A + leap seconds where available; app ΔT assumptions elsewhere','radiiKm':{'sun':695700,'moonSolar':1737.4,'moonOccultation':.2725076*6378.137}},clocks=clocks,frames=frames,positions=positions,events=events)
(ROOT/'tests/fixtures/precision-events.json').write_text(json.dumps(out,separators=(',',':'))+'\n')
print(f'{len(positions)} positions, {len(frames)} frames, {len(events)} events')
