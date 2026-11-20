"""Independent numerical references (temporary dev dependencies: ERFA, SciPy).
Run after tools/stellar-catalogs.py: python tools/space-motion-reference.py.
ERFA pmpx supplies perspective acceleration, independent of app formulas.
Binary references use a bracketed SciPy solver and true-anomaly projection;
published USNO ephemerides are retained as a separate external check.
"""
import json
import math
import pathlib
import subprocess
import erfa
from scipy.optimize import brentq

root = pathlib.Path(__file__).resolve().parents[1]
systems = json.loads(subprocess.check_output(['node','--input-type=module','-e',"import {BINARY_SYSTEMS} from './js/binarydata.js'; console.log(JSON.stringify(BINARY_SYSTEMS));"],cwd=root))
stars = [dict(ra=90,dec=45,pmra=1000,pmdec=-500,plx=100,rv=100),dict(ra=359.99,dec=89.999,pmra=-3000,pmdec=1000,plx=1000,rv=-100),dict(ra=269.45,dec=4.69,pmra=-800,pmdec=10300,plx=548,rv=-110.5),dict(ra=0,dec=-90,pmra=120,pmdec=-240,plx=0,rv=500),dict(ra=20,dec=-30,pmra=0,pmdec=0,plx=1000,rv=100),dict(ra=200,dec=20,pmra=400,pmdec=500,plx=100,rv=0)]
rows=[]
for star in stars:
    a,d=math.radians(star['ra']),math.radians(star['dec'])
    for years in [-3000,-1000,-100,-1,0,1,100,1000]:
        pmr=star['pmra']*erfa.DAS2R/1000/max(1e-15,math.cos(d))
        # The RA parameterisation is singular at the pole: use the limit
        # just off it for ERFA, while testing exact poles separately in JS.
        if abs(star['dec'])==90: continue
        direction=erfa.pmpx(a,d,pmr,star['pmdec']*erfa.DAS2R/1000,star['plx']/1000,star['rv'],years,[0,0,0])
        rows.append(dict(star=star,years=years,direction=direction.tolist()))
orbits=[]
for s in systems:
    P,e,inc,node,peri,t0,axis=s['orbit']
    for jd in [2451545,2415020.31352+125*365.242198781,2488070,t0,t0+P*.49,t0+P*.99]:
        M=(2*math.pi*(jd-t0)/P)%(2*math.pi)
        E=brentq(lambda E:E-e*math.sin(E)-M,0,2*math.pi,xtol=1e-14)
        v=math.atan2(math.sqrt(1-e*e)*math.sin(E),math.cos(E)-e)
        r=axis*(1-e*math.cos(E));u=v+peri
        north=r*(math.cos(node)*math.cos(u)-math.sin(node)*math.sin(u)*math.cos(inc))
        east=r*(math.sin(node)*math.cos(u)+math.cos(node)*math.sin(u)*math.cos(inc))
        away=r*math.sin(u)*math.sin(inc)
        orbits.append(dict(name=s['name'],jd=jd,relative=[north,east,away]))
result=dict(source=f'ERFA {erfa.__version__} pmpx (zero observer displacement); SciPy brentq + true anomaly; orbital elements pinned in binarydata.js',stars=rows,orbits=orbits)
(root/'tests/fixtures/space-motion.json').write_text(json.dumps(result,ensure_ascii=False,indent=2)+'\n')
print(len(rows),'ERFA space-motion directions;',len(orbits),'independent relative orbits')
