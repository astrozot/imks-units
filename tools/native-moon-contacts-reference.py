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
def ellipse_clearance(v,w,pole,radius,flattening):
 q=v-np.dot(v,w)*w;z=np.dot(pole,w);h=math.sqrt(max(0,1-z*z));y=np.dot(q,pole)/h if h>1e-10 else 0;x=math.sqrt(max(0,np.dot(q,q)-y*y))
 A=radius;B=A*math.sqrt((1-flattening)**2*(1-z*z)+z*z)
 objective=lambda theta:(abs(x)-A*math.cos(theta))**2+(abs(y)-B*math.sin(theta))**2
 result=minimize_scalar(objective,bounds=(0,math.pi/2),method='bounded',options={'xatol':1e-13})
 distance=math.sqrt(min(result.fun,objective(0),objective(math.pi/2)))
 return -distance if (x/A)**2+(y/B)**2<1 else distance

def shadow_clearance(v,observer,light,pole,radius,flattening,moon_radius,sun_distance,key):
 # Independent construction of the adopted shadow model. The globe is an
 # ellipsoid, the cone has a finite Sun, and only the illuminated visible
 # limb can supply a contact after the shadow axis passes behind the limb.
 axis=v+sun_distance*light;length=np.linalg.norm(axis);axis/=length
 if np.dot(v,light)>=0:return radius
 global_distance=ellipse_clearance(v,axis,pole,radius,flattening)
 angle=695700/length;spread=max(0,-np.dot(v,axis))*angle;umbra_radius=moon_radius-spread
 if key!='penumbra' and umbra_radius<=0:return radius
 global_value=global_distance-moon_radius-spread if key=='penumbra' else global_distance-umbra_radius if key=='umbra' else global_distance+umbra_radius
 if global_distance>=2*(moon_radius+spread):return global_value
 k=1/(1-flattening);stretch=np.eye(3)+(k-1)*np.outer(pole,pole);inverse=np.linalg.inv(stretch)
 p=stretch@v;d=stretch@axis
 roots=np.roots([np.dot(d,d),2*np.dot(p,d),np.dot(p,p)-radius**2])
 real=sorted(r.real for r in roots if abs(r.imag)<1e-8)
 if real:point=inverse@(p+real[0]*d)
 else:
  foot=p-np.dot(p,d)/np.dot(d,d)*d;point=inverse@(radius*foot/np.linalg.norm(foot))
 visible=np.dot(stretch@stretch@point,observer)<0
 if visible and key!='full':return global_value
 if not visible and key=='full':return radius
 # Transform the Earth tangent plane to a great circle on a sphere. A
 # dense independent bracket scan + SciPy bounded minimization replaces
 # the app's 32-sample/golden-section implementation.
 u=stretch@observer;u/=np.linalg.norm(u);e=np.cross(u,[1,0,0] if abs(u[0])<.8 else [0,1,0]);e/=np.linalg.norm(e);f=np.cross(u,e)
 def limb(theta):
  q=inverse@(radius*(e*math.cos(theta)+f*math.sin(theta)));normal=stretch@stretch@q
  if np.dot(normal,light)>1e-8*radius:return float('inf')
  ray=q-v;along=np.dot(ray,axis)
  if along<=0:return float('inf')
  distance=np.linalg.norm(np.cross(ray,axis));spread=angle*along
  return distance-moon_radius-spread if key=='penumbra' else distance-max(0,moon_radius-spread)
 step=2*math.pi/192;values=[limb(i*step) for i in range(192)];minimum=min(values)
 for i,value in enumerate(values):
  if math.isfinite(value) and value<=values[(i-1)%192] and value<=values[(i+1)%192]:
   result=minimize_scalar(lambda theta:min(limb(theta),1e20),bounds=((i-1)*step,(i+1)*step),method='bounded',options={'xatol':1e-12});minimum=min(minimum,result.fun)
 return max(global_value,-minimum) if key=='full' else minimum

def clearance(t,system,moon,kind,tt_offset=69.184,key="penumbra"):
 # TT offset is supplied by the declared clock for each seeded contact.
 # The TDB periodic convention is shared explicitly with the native pipeline.
 tt=t/86400+2440587.5+tt_offset/86400
 jd=tt+.001657*math.sin(math.radians(357.53+.9856003*(tt-2451545)))/86400
 earth=state('earth',jd,system)
 pt,p=emitted(system,jd,earth,system);mt,m=emitted(moon,jd,earth,system)
 v=m-p;observer=m-earth;observer/=np.linalg.norm(observer)
 a,d=np.radians(poles[system]);pole=np.array([math.cos(d)*math.cos(a),math.cos(d)*math.sin(a),math.sin(d)])
 radius=radii[system];spread=0
 if kind=='shadow':
  _,sun=emitted('sun',pt,p,system);light=p-sun;sun_distance=np.linalg.norm(light);light/=sun_distance
  _,casting=emitted(moon,pt,p,system)
  planet_observer=p-earth;planet_observer/=np.linalg.norm(planet_observer)
  return shadow_clearance(casting-p,planet_observer,light,pole,radius,flat[system],moons[moon][1],sun_distance,key)
 if kind=='eclipsed':
  bt,block=emitted(system,mt,m,system);_,sun=emitted('sun',bt,block,system)
  w=block-sun;sun_distance=np.linalg.norm(w);w/=sun_distance;v=m-block;along=np.dot(v,w)
  if along<=0:return radius
  radius*=1+along/sun_distance;spread=abs(along)*695700/sun_distance
 else:
  w=observer;behind=np.dot(v,w)
  if (kind=='transit' and behind>=0) or (kind=='occulted' and behind<=0):return radius
 return ellipse_clearance(v,w,pole,radius,flat[system])-moons[moon][1]-spread
contacts=[]
for seed in json.loads(pathlib.Path(sys.argv[1]).read_text()):
 if seed['kind'] not in ['transit','occulted','eclipsed','shadow']:continue
 row={key:seed[key] for key in ['system','moon','kind']}
 if 'epoch' in seed:row['epoch']=seed['epoch']
 for key in ['begin','end']+(['C1','C2','C3','C4'] if seed['kind']=='shadow' else []):
  center=seed.get(key) if key in ['begin','end'] else seed['contacts'].get(key)
  if center is None:row[key]=None;continue
  phase='penumbra' if key in ['begin','end'] else 'umbra' if key in ['C1','C4'] else 'full'
  f=lambda t:clearance(t,seed['system'],seed['moon'],seed['kind'],seed.get('ttMinusUTC',69.184),phase)
  try:row[key]=brentq(f,center-60,center+60,xtol=.0001)
  except ValueError as error:raise ValueError(f"{seed['system']} {seed['moon']} {seed['kind']} {key} at {center}: {f(center-60)}, {f(center)}, {f(center+60)}") from error
 contacts.append(row)
output={'source':{'versions':{p:version(p) for p in ['jplephem','scipy','numpy']},'orbits':'Original native JPL records, independently evaluated with jplephem; sparse development files contain only authenticated requested source chunks','solver':'SciPy Brent roots, independent projected-ellipse minimization; 192-bracket visible-shadow limb search','clock':'Shared declared app TT offset at each contact (IERS/leap seconds where available; modelled ΔT elsewhere), and declared TDB convention','scope':'Seeded external limb, eclipse penumbral, and visible shadow penumbral/umbral/full contacts; search completeness is not independently validated','physicalModel':'Same adopted oblate-planet shape, pole and spherical moon radii; shadows use the Earth-to-planet viewing ray. Numerical agreement is not observational accuracy'},'contacts':contacts}
pathlib.Path(sys.argv[2]).write_text(json.dumps(output,indent=2)+'\n')
print(f'Wrote {sum(sum(isinstance(row.get(k),(int,float)) for k in ["begin","end","C1","C2","C3","C4"]) for row in contacts)} independently solved native contacts')
