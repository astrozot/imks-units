"""Build general, public-domain ocean/major-lake masks, with no regional overrides.
Requires shapely and pyshp. Usage: python prepare-global-water.py SOURCE_DIR OUTPUT_DIR
SOURCE_DIR contains ocean.zip and lakes.zip from Natural Earth's 1:10m physical data.
The 1:10m label is a cartographic scale (1:10 million), NOT 10-metre accuracy.
"""
import hashlib, io, json, math, pathlib, sys, zipfile
import shapefile
from shapely.geometry import shape, box, Polygon
from shapely import make_valid
from shapely.strtree import STRtree
src, out = map(pathlib.Path, sys.argv[1:3]); out.mkdir(parents=True, exist_ok=True)

def polygons(g):
    if g.is_empty: return []
    if g.geom_type == 'Polygon': return [g]
    return [p for part in g.geoms for p in polygons(part)] if hasattr(g, 'geoms') else []

def load(name):
    z = zipfile.ZipFile(src / (name+'.zip'))
    base = next(n[:-4] for n in z.namelist() if n.endswith('.shp'))
    reader = shapefile.Reader(shp=io.BytesIO(z.read(base+'.shp')), dbf=io.BytesIO(z.read(base+'.dbf')), shx=io.BytesIO(z.read(base+'.shx')))
    result=[]
    for item in reader.iterShapes():
        g=shape(item.__geo_interface__)
        if not g.is_valid: g=make_valid(g)
        result.extend(polygons(g.simplify(.00005, preserve_topology=True)))
    version=z.read(base+'.VERSION.txt').decode().strip()
    return result, version

oceans, ov = load('ocean'); lakes, lv = load('lakes')
print(f'Loaded {len(oceans)} ocean and {len(lakes)} lake polygons', flush=True)
otree, ltree = STRtree(oceans), STRtree(lakes)

def encode(g, x, y):
    result=[]
    for poly in polygons(g):
        rings=[]
        for ring in [poly.exterior, *poly.interiors]:
            points=[]
            for lon,lat in ring.coords:
                p=(round((lon-x)*100000),round((lat-y)*100000))
                if not points or p!=points[-1]: points.append(p)
            if len(points)>1 and points[0]==points[-1]: points.pop()
            if len(points)<3: continue
            flat=[]; px=py=0
            for i,(a,b) in enumerate(points):
                flat.extend([a if not i else a-px,b if not i else b-py]); px,py=a,b
            rings.append(flat)
        if rings: result.append(rings)
    return result

index={}; total=0
for iy,y in enumerate(range(-85,85,5)):
    band=box(-180,y,180,y+5)
    ocean_band=[oceans[i].intersection(band) for i in otree.query(band)]
    for ix,x in enumerate(range(-180,180,5)):
        tile=box(x,y,x+5,y+5)
        o=[g.intersection(tile) for g in ocean_band if g.intersects(tile)]
        l=[lakes[i].intersection(tile) for i in ltree.query(tile)]
        if any(g.equals(tile) for g in o) and not l:
            index[f'{ix}_{iy}']='o'; continue
        oc=[p for g in o for p in encode(g,x,y)]; lc=[p for g in l for p in encode(g,x,y)]
        if not oc and not lc: continue
        filename=f'{ix}_{iy}.json'; payload=json.dumps({'o':oc,'l':lc},separators=(',',':'))+'\n'
        (out/filename).write_text(payload); total+=len(payload); index[f'{ix}_{iy}']='p'
    print(f'Prepared latitude {y:+d}° band', flush=True)
manifest={'version':1,'model':'natural-earth-v1','tileSize':5,'south':-85,'north':85,'quantum':.00001,'sourceScale':'1:10 million; generalised coastlines and major lakes','simplificationDegrees':.00005,'license':'Public domain','attribution':'Made with Natural Earth','sources':[{'name':name,'version':ver,'url':f'https://naciscdn.org/naturalearth/10m/physical/ne_10m_{name}.zip','sha256':hashlib.sha256((src/(name+'.zip')).read_bytes()).hexdigest()} for name,ver in [('ocean',ov),('lakes',lv)]],'tiles':index}
(out/'index.json').write_text(json.dumps(manifest,separators=(',',':'))+'\n')
print(json.dumps({'tiles':len(index),'polygonFiles':sum(v=='p' for v in index.values()),'bytes':total}),flush=True)
