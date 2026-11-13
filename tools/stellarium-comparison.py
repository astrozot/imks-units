"""Compare pinned official Stellarium C satellite theories with native JPL.

python tools/stellarium-comparison.py source-directory sparse-kernels seeds.json output.json
Uses an externally compiled library; no upstream code/binary is vendored or
linked into the application. Same-date geometric ICRF km, no light time,
refraction or event-radius convention mixed into this orbit comparison.
"""
import ctypes,json,math,pathlib,subprocess,sys,hashlib,re
import numpy as np
from jplephem.spk import SPK
root=pathlib.Path(__file__).resolve().parents[1]
source,directory,seeds_file,output=map(pathlib.Path,sys.argv[1:])
metadata=json.loads((source/'source.json').read_text())
if metadata['commit']!='3f23cf3a1a59523a9c7b1ec4540c33bca77addfa':raise ValueError('Unexpected Stellarium source revision; review before updating benchmark')
lib=ctypes.CDLL(str(source/('ephemerides.dylib' if sys.platform=='darwin' else 'ephemerides.so')));ptr=ctypes.POINTER(ctypes.c_double)
for symbol in ['GetL12Coor','GetTass17Coor']:getattr(lib,symbol).argtypes=[ctypes.c_double,ctypes.c_int,ptr,ptr]
files={key:SPK.open(directory/(key+'.bsp')) for key in ['de440','jup365','sat441']}
def native(kernel,c,b,jd):
 s=next(s for s in reversed(kernel.segments) if s.center==c and s.target==b and s.start_jd<=jd<=s.end_jd)
 return s.compute(jd)
# Frame conversion explicitly documented by Stellarium's elp82b.h.
eps=math.radians(23.4392803055556);psi=math.radians(-.0000275)
rx=np.array([[1,0,0],[0,math.cos(eps),-math.sin(eps)],[0,math.sin(eps),math.cos(eps)]])
rz=np.array([[math.cos(psi),-math.sin(psi),0],[math.sin(psi),math.cos(psi),0],[0,0,1]])
rotation=rz@rx
text=(source/'tass17.c').read_text()
def matrix(name):
 body=re.search(name+r'\[9\] = \{(.*?)\}',text,re.S).group(1)
 return np.array([float(x) for x in re.findall(r'[-+]?[0-9]+\.[0-9]+e[-+][0-9]+',body,re.I)]).reshape(3,3)
frame_error=float(np.max(abs(rotation@matrix('TASS17toVSOP87')-matrix('TASS17toJ2000'))))
if frame_error>1e-13:raise ValueError('Frame convention does not match Stellarium’s documented rotation')
systems={'jupiter':('jup365',5,{'Io':(0,501),'Europa':(1,502),'Ganymede':(2,503),'Callisto':(3,504)}),'saturn':('sat441',6,{'Mimas':(0,601),'Enceladus':(1,602),'Tethys':(2,603),'Dione':(3,604),'Rhea':(4,605),'Titan':(5,606),'Hyperion':(7,607),'Iapetus':(6,608)})}
# These epochs have authenticated source records in the independent-contact
# sparse kernels. Their TT offset is taken from the declared app clock only.
seeds=json.loads(seeds_file.read_text())
epochs={row['epoch']:row['ttMinusUTC'] for row in seeds}
rows=[];truth=[];stellarium=[]
for epoch,offset in sorted(epochs.items()):
 tt=epoch/86400+2440587.5+offset/86400
 tdb=tt+.001657*math.sin(math.radians(357.53+.9856003*(tt-2451545)))/86400
 for system,(kernel,center,moons) in systems.items():
  for moon,(index,target) in moons.items():
   position=(ctypes.c_double*3)();velocity=(ctypes.c_double*3)()
   getattr(lib,'GetL12Coor' if system=='jupiter' else 'GetTass17Coor')(tt,index,position,velocity)
   p=rotation@np.array(position)*149597870.7
   q=native(files[kernel],center,target,tdb)-native(files[kernel],center,center*100+99,tdb)
   if np.linalg.norm(q)<10000:raise ValueError('Invalid/missing native records in sparse source')
   rows.append({'system':system,'moon':moon,'ttJD':tt,'tdbJD':tdb});truth.append(q);stellarium.append(p)
compact=json.loads(subprocess.check_output(['node','tools/stellarium-compact-states.mjs'],input=json.dumps(rows).encode(),cwd=root))
summary={}
for row,q,s,c in zip(rows,truth,stellarium,compact):
 row.update({'stellariumKm':s.tolist(),'compactKm':c,'nativeKm':q.tolist(),'stellariumErrorKm':float(np.linalg.norm(s-q)),'compactErrorKm':float(np.linalg.norm(np.array(c)-q))})
 key=row['system'];summary.setdefault(key,{'samples':0,'stellariumMaxKm':0,'compactMaxKm':0,'byMoon':{}});r=summary[key];r['samples']+=1;r.setdefault('compactCloserSamples',0);r['compactCloserSamples']+=int(row['compactErrorKm']<row['stellariumErrorKm'])
 for field,value in [('stellariumMaxKm',row['stellariumErrorKm']),('compactMaxKm',row['compactErrorKm'])]:r[field]=max(r[field],value)
 r['byMoon'].setdefault(row['moon'],{'stellariumMaxKm':0,'compactMaxKm':0})
 for field,value in [('stellariumMaxKm',row['stellariumErrorKm']),('compactMaxKm',row['compactErrorKm'])]:r['byMoon'][row['moon']][field]=max(r['byMoon'][row['moon']][field],value)
report={'source':{'stellariumTag':metadata['tag'],'stellariumCommit':metadata['commit'],'sourceURL':'https://github.com/Stellarium/stellarium/tree/'+metadata['commit']+'/src/core/planetsephems','models':{'jupiter':'Stellarium L1.2','saturn':'Stellarium TASS1.7','native':'JUP365 / SAT441, jplephem evaluator','compact':'Current Astrolabium compact satellite series'},'frame':'Geometric planet-centred ICRF km; TT for analytic theories, TDB for native SPK','frameMatrixAgreement':frame_error,'scope':'Six epochs, 1900–2099; orbit-model comparison only, not a comparison of full Stellarium apparent positions or event timings. Optional JPL planetary ephemerides in Stellarium are not benchmarked. Same-kernel native agreement is not an observational error estimate.','files':{name:hashlib.sha256((source/name).read_bytes()).hexdigest() for name in ['l12.c','l12.h','tass17.c','tass17.h','elp82b.h','calc_interpolated_elements.c','elliptic_to_rectangular.c']}},'summary':summary,'states':rows}
output.write_text(json.dumps(report,indent=2)+'\n')
print(json.dumps(summary,indent=2))
