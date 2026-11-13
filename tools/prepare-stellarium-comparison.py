"""Fetch and compile the pinned official Stellarium satellite theories.

python tools/prepare-stellarium-comparison.py /tmp/stellarium-comparison
All upstream source and the compiled development library stay outside the
repository. Only numerical benchmark output is committed. Requires a C
compiler; uses four official C translation units, no desktop app or Qt.
"""
import concurrent.futures,hashlib,json,pathlib,subprocess,sys,urllib.request
COMMIT='3f23cf3a1a59523a9c7b1ec4540c33bca77addfa'
TAG='v26.3'
FILES=['l12.c','l12.h','tass17.c','tass17.h','calc_interpolated_elements.c','calc_interpolated_elements.h','elliptic_to_rectangular.c','elliptic_to_rectangular.h','elp82b.h','EphemWrapper.cpp']
directory=pathlib.Path(sys.argv[1]).resolve();directory.mkdir(parents=True,exist_ok=True)
root=pathlib.Path(__file__).resolve().parents[1]
if directory==root or root in directory.parents:raise ValueError('Use an external development directory, not the app repository')
api=f'https://api.github.com/repos/Stellarium/stellarium/contents/src/core/planetsephems?ref={COMMIT}'
def read(url):
 request=urllib.request.Request(url,headers={'User-Agent':'Astrolabium-accuracy-check'})
 with urllib.request.urlopen(request,timeout=45) as response:return response.read()
catalogue=json.loads(read(api));items={row['name']:row for row in catalogue}
def fetch(name):
 row=items[name];url=f'https://raw.githubusercontent.com/Stellarium/stellarium/{COMMIT}/src/core/planetsephems/{name}';data=read(url)
 blob=hashlib.sha1(b'blob '+str(len(data)).encode()+b'\0'+data).hexdigest()
 if blob!=row['sha']:raise ValueError('Source checksum mismatch: '+name)
 (directory/name).write_bytes(data)
with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:list(pool.map(fetch,FILES))
(directory/'source.json').write_text(json.dumps({'tag':TAG,'commit':COMMIT,'files':catalogue},indent=2)+'\n')
library=directory/('ephemerides.dylib' if sys.platform=='darwin' else 'ephemerides.so')
units=['l12.c','tass17.c','calc_interpolated_elements.c','elliptic_to_rectangular.c']
subprocess.run(['cc','-O2','-fPIC','-shared',*[str(directory/name) for name in units],'-lm','-o',str(library)],check=True)
print('Prepared Stellarium',TAG,COMMIT,'at',directory)
