"""Independent seeded native-contact check using jplephem and SciPy.

Usage: python tools/native-moon-contacts-reference.py seeds.json output.json
Seeds identify events, not the answer: Brent solves each boundary in an
independent 120-second bracket. This verifies selected contacts; it does not
prove completeness of the event search. Planet shape/radii/poles are the
same declared physical assumptions, not independently measured accuracy.
Fixtures are exact native SPK subsets. No application JS geometry is used.
"""
import json, math, pathlib, sys
from importlib.metadata import version
import numpy as np
from jplephem.spk import SPK
from scipy.optimize import brentq, minimize_scalar
root=pathlib.Path(__file__).resolve().parents[1]
directory=pathlib.Path(sys.argv[3]) if len(sys.argv)>3 else root/'tests/fixtures'
def kernel_path(k):return directory/(k+'.bsp' if len(sys.argv)>3 else k+'-native.bsp')
base=SPK.open(kernel_path('de440'))
kernels={s:SPK.open(kernel_path(k)) for s,k in [('jupiter','jup365'),('saturn','sat441')]}
ids={'jupiter':5,'saturn':6}
radii={'jupiter':71492,'saturn':60268}
flat={'jupiter':.06487,'saturn':.09796}
poles={'jupiter':(268.056595,64.495303),'saturn':(40.589,83.537)}
moons={'Io':(501,1821.6),'Europa':(502,1560.8),'Ganymede':(503,2634.1),'Callisto':(504,2410.3),'Mimas':(601,198.2),'Enceladus':(602,252.1),'Tethys':(603,531.1),'Dione':(604,561.4),'Rhea':(605,763.8),'Titan':(606,2574.7),'Hyperion':(607,135),'Iapetus':(608,734.5)}
def native(k,c,b,jd):
 s=next(s for s in reversed(k.segments) if s.center==c and s.target==b and s.start_jd<=jd<=s.end_jd)
 return s.compute(jd)
def state(body,jd,system):
 center=ids[system]
 if body=='earth':return native(base,0,3,jd)+native(base,3,399,jd)
 if body=='sun':return native(base,0,10,jd)
 target=center*100+99 if body==system else moons[body][0]
 return native(base,0,center,jd)+native(kernels[system],center,target,jd)
def emitted(body,receive,point,system):
 jd=receive
 for _ in range(7):jd=receive+(-np.linalg.norm(state(body,jd,system)-point)/299792.458)/86400
 return jd,state(body,jd,system)
def clearance(t,system,moon,kind,tt_offset=69.184):
 # Modern fixture dates: IERS UTC, TT=UTC+37+32.184 s. The TDB periodic
 # term is the convention used by the native pipeline, shared explicitly.
 tt=t/86400+2440587.5+tt_offset/86400
 jd=tt+.001657*math.sin(math.radians(357.53+.9856003*(tt-2451545)))/86400
 earth=state('earth',jd,system)
 pt,p=emitted(system,jd,earth,system);mt,m=emitted(moon,jd,earth,system)
 v=m-p;observer=m-earth;observer/=np.linalg.norm(observer)
 a,d=np.radians(poles[system]);pole=np.array([math.cos(d)*math.cos(a),math.cos(d)*math.sin(a),math.sin(d)])
 radius=radii[system];spread=0
 if kind=='eclipsed':
  bt,block=emitted(system,mt,m,system);_,sun=emitted('sun',bt,block,system)
  w=block-sun;sun_distance=np.linalg.norm(w);w/=sun_distance;v=m-block;along=np.dot(v,w)
  if along<=0:return radius
  radius*=1+along/sun_distance;spread=abs(along)*695700/sun_distance
 else:
  w=observer;behind=np.dot(v,w)
  if (kind=='transit' and behind>=0) or (kind=='occulted' and behind<=0):return radius
 q=v-np.dot(v,w)*w;z=np.dot(pole,w);h=math.sqrt(max(0,1-z*z));y=np.dot(q,pole)/h if h>1e-10 else 0;x=math.sqrt(max(0,np.dot(q,q)-y*y))
 A=radius;B=A*math.sqrt((1-flat[system])**2*(1-z*z)+z*z)
 # Minimize physical Euclidean distance to the projected ellipse rather
 # than using the app's Lagrange-multiplier bisection implementation.
 f=lambda theta:(abs(x)-A*math.cos(theta))**2+(abs(y)-B*math.sin(theta))**2
 result=minimize_scalar(f,bounds=(0,math.pi/2),method='bounded',options={'xatol':1e-13})
 distance=math.sqrt(min(result.fun,f(0),f(math.pi/2)))
 if (x/A)**2+(y/B)**2<1:distance=-distance
 return distance-moons[moon][1]-spread
contacts=[]
for seed in json.loads(pathlib.Path(sys.argv[1]).read_text()):
 if seed['kind'] not in ['transit','occulted','eclipsed']:continue
 row={key:seed[key] for key in ['system','moon','kind']}
 if 'epoch' in seed:row['epoch']=seed['epoch']
 for key in ['begin','end']:
  center=seed[key];f=lambda t:clearance(t,seed['system'],seed['moon'],seed['kind'],seed.get('ttMinusUTC',69.184))
  row[key]=brentq(f,center-60,center+60,xtol=.0001)
 contacts.append(row)
output={'source':{'versions':{p:version(p) for p in ['jplephem','scipy','numpy']},'orbits':'Original native JPL records, independently evaluated with jplephem; sparse development files contain only authenticated requested source chunks','solver':'SciPy Brent roots, independent projected-ellipse minimization','clock':'Shared declared app TT offset at each contact (IERS/leap seconds where available; modelled ΔT elsewhere), and declared TDB convention','scope':'Seeded external limb and eclipse penumbral contacts; completeness and visible shadow contacts are not independently validated','physicalModel':'Same adopted oblate-planet shape, pole and spherical moon radii; numerical agreement is not observational accuracy'},'contacts':contacts}
pathlib.Path(sys.argv[2]).write_text(json.dumps(output,indent=2)+'\n')
print(f'Wrote {len(contacts)*2} independently solved native contacts')
