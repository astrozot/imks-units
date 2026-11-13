"""Small on-demand Hyperion/Iapetus packs, fitted to Horizons TT vectors.

python tools/precision-satellites.py <cache> [--first 2020 --last 2040]
Only the offline preparation contacts Horizons, sequentially. Each year
is independently checked at dates absent from the fit. Requires NumPy.
"""
import argparse
import datetime as dt
import hashlib
import json
import math
import pathlib
import struct
import time
import urllib.request

import numpy as np

ROOT = pathlib.Path(__file__).resolve().parents[1]


def jd(y):
    return 2440587.5+(dt.datetime(y,1,1)-dt.datetime(1970,1,1)).days


def fetch(cache, ident, tag, dates):
    file = cache/f'{ident}-{tag}.json'
    if file.exists():
        return np.array(json.loads(file.read_text()))
    rows = []
    for start in range(0,len(dates),1000):
        script = '\n'.join(['!$$SOF',f"COMMAND='{ident}'","CENTER='500@699'","OBJ_DATA=NO","MAKE_EPHEM=YES","EPHEM_TYPE=VECTORS","REF_PLANE=FRAME","REF_SYSTEM=ICRF","VEC_TABLE=1","VEC_CORR=NONE","OUT_UNITS=KM-S","CSV_FORMAT=YES","TLIST_TYPE=JD","TIME_TYPE=TT","TLIST=",*[f"'{t:.9f}'" for t in dates[start:start+1000]],'!$$EOF',''])
        boundary = 'IMKS_HORIZONS_PRECISION'
        body = (f'--{boundary}\r\nContent-Disposition: form-data; name="format"\r\n\r\ntext\r\n--{boundary}\r\nContent-Disposition: form-data; name="input"; filename="input.txt"\r\nContent-Type: text/plain\r\n\r\n{script}\r\n--{boundary}--\r\n').encode()
        for attempt in range(4):
            try:
                req = urllib.request.Request('https://ssd.jpl.nasa.gov/api/horizons_file.api',body,{'Content-Type':f'multipart/form-data; boundary={boundary}'})
                text = urllib.request.urlopen(req,timeout=120).read().decode()
                block = text.split('$$SOE')[1].split('$$EOE')[0]
                for line in block.strip().splitlines():
                    c = line.split(','); rows.append([float(c[0]),float(c[2]),float(c[3]),float(c[4])])
                break
            except Exception:
                if attempt==3: raise
                time.sleep(2)
    array = np.array(rows)
    if len(array)!=len(dates): raise ValueError('Missing Horizons vectors')
    file.write_text(json.dumps(rows,separators=(',',':')))
    return array


def main():
    p = argparse.ArgumentParser(description=__doc__);p.add_argument('cache',type=pathlib.Path);p.add_argument('--first',type=int,default=2020);p.add_argument('--last',type=int,default=2040);a=p.parse_args()
    a.cache.mkdir(parents=True,exist_ok=True);out=ROOT/'data/precision-satellites';out.mkdir(parents=True,exist_ok=True)
    manifest = {'version':1,'source':'JPL Horizons, Saturn-centred geometric ICRF, TT','first':a.first,'last':a.last,'files':{},'audit':{}}
    refs=[]
    for year in range(a.first,a.last+1):
        start,end=jd(year)-4,jd(year+1)+4
        header={'version':1,'year':year,'source':'Horizons satellites','timeScale':'TT','fromJD':start,'toJD':end,'segments':[]};payload=[];offset=0
        for name,ident,step in [('Hyperion',607,3),('Iapetus',608,3)]:
            count=math.ceil((end-start)/step);n=12;nodes=np.polynomial.chebyshev.chebgauss(n)[0][::-1]
            dates=(start+np.arange(count)[:,None]*step+(nodes+1)*step/2).reshape(-1)
            rows=fetch(a.cache,ident,f'{year}-fit-step-{step}-v1',dates)
            coefficients=np.array([np.polynomial.chebyshev.chebfit(nodes,r,n-1).T for r in rows[:,1:].reshape(count,n,3)],dtype='<f8')
            tests=fetch(a.cache,ident,f'{year}-audit-v1',np.sort(np.random.default_rng(ident+year*7919).uniform(start,end,24)))
            errors=[]
            for t,*r in tests:
                i=min(count-1,int((t-start)/step));x=(t-start-i*step)*2/step-1
                v=np.array([np.polynomial.chebyshev.chebval(x,c) for c in coefficients[i]])
                errors.append(float(np.linalg.norm(v-r)));refs.append([year,699,ident,t,*r])
            if max(errors)>.05: raise ValueError(f'{name} fit error {max(errors)} km exceeds 50 m')
            header['segments'].append({'center':699,'target':ident,'name':name,'start':start,'step':step,'count':count,'degree':n-1,'offset':offset});payload.append(coefficients.tobytes());offset+=coefficients.size
            manifest['audit'][f'{year}-{name}']={'samples':len(tests),'maxKm':max(errors),'rmsKm':float(np.sqrt(np.mean(np.array(errors)**2)))}
        meta=json.dumps(header,separators=(',',':')).encode();data=b'IMKSEPH1'+struct.pack('<II',len(meta),0)+meta+bytes((-len(meta))%8)+b''.join(payload)
        (out/f'{year}.bin').write_bytes(data);manifest['files'][f'{year}.bin']={'bytes':len(data),'sha256':hashlib.sha256(data).hexdigest()}
        (out/'index.json').write_text(json.dumps(manifest,separators=(',',':'))+'\n')
        (ROOT/'tests/fixtures/precision-satellites.json').write_text(json.dumps({'source':manifest['source'],'states':refs},separators=(',',':'))+'\n')
        print(year, len(data),'bytes; audit',manifest['audit'][f'{year}-Hyperion']['maxKm'],manifest['audit'][f'{year}-Iapetus']['maxKm'],flush=True)


if __name__=='__main__':main()
