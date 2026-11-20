"""Enrich the shipped catalogues without replacing their existing astrometry.

python tools/stellar-catalogs.py SOURCE_DIRECTORY
Requires numpy. Sources: AT-HYG v4.0 athyg_40.csv.gz; Gaia DR3 gaia-rv.csv
(tools/gaia-radial-velocities.adql, FORMAT=csv, MAXREC=10000000); Stellarium
v26.3 binary_orbitparam.dat; USNO orb6.txt and orb6-ephemerides.txt.
No network access at runtime. Re-running is idempotent. Old STAR v1/v2 files
are accepted; output v3/v4 appends float32 km/s (NaN explicitly unknown).
"""
import csv
import gzip
import hashlib
import json
import math
import pathlib
import re
import sys
import numpy as np
from binary_expansion import expand_binary_systems

ROOT = pathlib.Path(__file__).resolve().parents[1]
SOURCE = pathlib.Path(sys.argv[1])
R = math.pi / 180
sha = lambda p: hashlib.sha256(p.read_bytes()).hexdigest()
bs = [line.split() for line in (SOURCE/'binary_orbitparam.dat').read_text().splitlines() if line and not line.startswith('#')][:14]
# Names requested from the guide, with independent USNO orbit identifiers.
names = ['α Centauri', 'Sirius', '61 Cygni', 'γ Virginis', 'Alula Australis', 'Achird', 'ε¹ Lyrae', 'ε² Lyrae', 'β Muscae', 'Dalim', 'ψ Velorum', 'ρ Ophiuchi', 'ζ Herculis', 'η Ophiuchi']
pngs = ['14396-6050g', '06451-1643a', '21069+3845e', '12417-0127c', '11182+3132b', '00491+5749a', '18443+3940a', '18443+3940h', '12463-6806d', '03121-2859b', '09307-4028c', '16256-2327d', '16413+3136c', '17104-1544d']
ids = {x for i,b in enumerate(bs) if i != 11 for x in b[:2]}
reviewed=json.loads((ROOT/'data/binary-reviewed-additions.json').read_text())
ids.update(s['secondaryGaia'] for s in reviewed['systems'] if s.get('secondaryGaia'))
raw = (ROOT/'js/stardata.js').read_text()
chart = json.loads(raw[raw.index('[\n'):raw.rfind(']')+1])
# Preserve the original unoverlaid rows; binary components are added at load.
hips, hds, proper = {}, {}, {}
by_tyc, members = {}, {}
with gzip.open(SOURCE/'athyg_40.csv.gz', 'rt') as f:
    for s in csv.DictReader(f):
        rv = float(s['rv']) if s['rv'] else None
        # HYG historically uses zero for unknown RV: do not call it measured.
        if rv == 0 and s['rv_src'] == 'HYG': rv = None
        if s['tyc']: by_tyc[s['tyc']] = rv
        if s['hip']: hips.setdefault(int(s['hip']), []).append(s)
        if s['hd']: hds.setdefault(int(s['hd']), []).append(s)
        if s['proper']: proper[s['proper']] = s
        s['_rv'] = rv
        for key in [s['gaia'], s['hip']]:
            if key in ids: members[key] = s
        if s['hip'] == '80473': members['rhoA'] = s
        if s['hd'] == '147934': members['rhoB'] = s
print('AT-HYG radial velocities loaded', flush=True)

def source_for(row):
    candidates = hips.get(row[0], []) if row[0] else []
    if not candidates:
        for hd in re.findall(r'HD (\d+)', row[10]): candidates += hds.get(int(hd), [])
    if not candidates and row[9] in proper: candidates = [proper[row[9]]]
    return min(candidates, key=lambda s: math.hypot(((float(s['ra'])*15-row[1]+180)%360-180)*math.cos(row[2]*R), float(s['dec'])-row[2])) if candidates else None

for row in chart:
    s = source_for(row)
    if len(row) <= 12: row.append(None)
    row[12] = s['_rv'] if s else None
prefix = raw[:raw.index('export const CHART_STARS')]
prefix = prefix.replace("import { withBinaryStars } from './starmotion.js';\n", '')
prefix = re.sub(r'// Appended field:.*\n', '', prefix)
prefix += "// Appended field: radial velocity (km/s; null unknown).\nimport { withBinaryStars } from './starmotion.js';\n"
(ROOT/'js/stardata.js').write_text(prefix+'export const CHART_STARS = withBinaryStars([\n'+',\n'.join(json.dumps(row, ensure_ascii=False, separators=(',', ':')) for row in chart)+'\n]);\n')
# The smaller calculator catalogue already had RV, but zero also represented
# missing measurements there. Use the same provenance and null convention.
catalog_path=ROOT/'js/catalog.js';catalog=catalog_path.read_text()
first=catalog.index('[\n',catalog.index('const STARS ='));last=catalog.index('\n];',first)+2
named=json.loads(re.sub(r',\s*\]', ']', catalog[first:last]))
for row in named:
    if row[0] in proper: row[6]=proper[row[0]]['_rv']
    elif row[6]==0: row[6]=None
catalog_path.write_text(catalog[:first]+'[\n'+',\n'.join('  '+json.dumps(row,ensure_ascii=False,separators=(',', ':')) for row in named)+'\n]'+catalog[last:])

orbital_lines = (SOURCE/'orb6.txt').read_text().splitlines()
systems = []
references = []
for i, (name, token, b) in enumerate(zip(names, pngs, bs)):
    l = next(l for l in orbital_lines if 'wds'+token+'.png' in l)
    n = lambda a,z: float(l[a-1:z].strip())
    period = n(81,92) * {'y':365.25,'d':1,'c':36525}[l[92]]
    axis = n(106,114) * {'a':1,'m':.001,'M':60}[l[114]]
    epoch = n(163,174)
    epoch = 2415020.31352 + (epoch-1900)*365.242198781 if l[174]=='y' else epoch+2400000+(0.5 if l[174]=='m' else 0)
    orbit = [period,n(188,195),n(126,133)*R,n(144,151)*R,n(206,213)*R,epoch,axis]
    bary = dict(distance=float(b[9]), epoch=float(b[10]), ra=float(b[11])/R, dec=float(b[12])/R, rv=float(b[13]), pmra=float(b[14]), pmdec=float(b[15]))
    mass = [float(b[16]),float(b[17])]
    primary_hip = [71683,32349,104214,61941,55203,3821,91919,91926,62322,14879,46651,80473,81693,84012][i]
    primary = members.get(b[0]) or hips[primary_hip][0]
    secondary = members.get(b[1])
    if secondary is None:
        # A faint component absent from AT-HYG is still represented by the
        # independently catalogued orbit and USNO component photometry.
        secondary = dict(primary, hip='', hd='', hr='', tyc='', proper='', gaia=b[1] if int(b[1])>120000 else '', spect='')
    sources = [primary,secondary] if i != 11 else [members['rhoA'], members['rhoB']]
    if i == 8: mass = [7.35,6.40]  # β Mus: published B-star mass ratio, not Achird's copied masses.
    if i == 11:
        # The guide says rho Oph; the corresponding Stellarium row is 70 Oph.
        # Use rho Oph's own component astrometry and an explicitly adopted
        # equal-mass barycentre; this long-period orbit is grade 5.
        mass = [1,1]
        a,c = sources
        bary = dict(distance=float(a['dist']), epoch=2451545, ra=(float(a['ra'])+float(c['ra']))*7.5, dec=(float(a['dec'])+float(c['dec']))/2, rv=a['_rv'], pmra=(float(a['pmra'] or 0)+float(c['pmra'] or 0))/2, pmdec=(float(a['pmdec'] or 0)+float(c['pmdec'] or 0))/2)
    comps = []
    for j,s in enumerate(sources):
        matches = [row for row in chart if source_for(row) is s]
        # Some source HIP identifiers represent an unresolved pair. Consume
        # the original row once, while giving the two components distinct IDs.
        existing = min(matches, key=lambda row: row[3]) if matches else None
        label = ('A','B')[j]
        c_name = existing[9] if existing and existing[9] else name+' '+label
        if j and c_name == (comps[0]['name'] if comps else ''): c_name = name+' B'
        aliases = list(dict.fromkeys(([existing[10]] if existing else []) + [name+' '+label, name if j==0 else '', 'HIP '+s['hip'] if s['hip'] else '', 'HD '+s['hd'] if s['hd'] else '', 'Gaia DR3 '+s['gaia'] if s['gaia'] else '', 'TYC '+s['tyc'] if s['tyc'] else '']))
        aliases = [a for chunk in aliases for a in chunk.split('|') if a]
        if i == 6: aliases += [('ε¹ Lyr','ε¹ Lyr B')[j], ('epsilon1 Lyr','epsilon1 Lyr B')[j]]
        if i == 7: aliases += [('ε² Lyr','ε² Lyr B')[j], ('epsilon2 Lyr','epsilon2 Lyr B')[j]]
        # USNO V magnitudes separate the components; an integrated V would
        # double-count light once both stars are drawn.
        mag = n(67,71) if j==0 else n(75,79)
        if mag < -5 or mag > 25: raise ValueError('Invalid binary magnitude')
        tyc = s['tyc'].split('-') if s['tyc'] else None
        comps.append(dict(id=f'{i}:{label}',name=c_name,hip=int(s['hip'] or 0),gaia=s['gaia'],tyc=int(tyc[0])*65536+int(tyc[1])*4+int(tyc[2])-1 if tyc else 0, mag=mag,bv=existing[4] if existing else float(s['ci']) if s['ci'] else None,spect=s['spect'], aliases=list(dict.fromkeys(aliases)), replace=[f'HIP {row[0]}' if row[0] else row[9] or row[10] for row in matches]))
    system = dict(name=name, orbit=orbit, barycentre=bary,masses=mass,components=comps,grade=int(l[233]),reference=l[237:246].strip(),wds=l[19:29],massRatioNote='Adopted equal masses' if i==11 else 'Adopted B-star masses 7.35/6.40' if i==8 else 'Stellarium 26.3 adopted masses')
    systems.append(system)
    ephem = next(e for e in (SOURCE/'orb6-ephemerides.txt').read_text().splitlines() if e[:10]==system['wds'] and system['reference'] in e and l[30:44].strip() in e)
    references.append(dict(name=name,elements=l,ephemerides=ephem))
references.extend(expand_binary_systems(ROOT,SOURCE,systems,chart,hips,proper,members,source_for))
(ROOT/'js/binarydata.js').write_text('// Generated by tools/stellar-catalogs.py. USNO ORB6 elements; source\n// records, grades, attribution and barycentre assumptions: data/stellar-motion.json.\nexport const BINARY_SYSTEMS = '+json.dumps(systems,ensure_ascii=False,indent=2)+';\n')
(ROOT/'tests/fixtures/binary-orbits.json').write_text(json.dumps(references,ensure_ascii=False,indent=2)+'\n')

gaia_rv = {}
with (SOURCE/'gaia-rv.csv').open() as f:
    for row in csv.DictReader(f):
        if row.get('radial_velocity'): gaia_rv[int(row['source_id'])] = float(row['radial_velocity'])
if len(gaia_rv) != 2161040: raise ValueError('Gaia radial-velocity extract is incomplete (independent DR3 COUNT: 2161040)')
stats = {}
for depth in [8,10,11,12]:
    file = ROOT/f'data/stars-{depth}.bin'
    old = file.read_bytes()
    _, version, T,N,A = np.frombuffer(old,dtype='<u4',count=5)
    T,N,A = int(T),int(N),int(A)
    gaia = version in [2,4]
    end = 24+20*T+16*N+8*A+(8*N if gaia else 0)
    tyc = np.frombuffer(old,dtype='<u4',count=N,offset=24+20*T)
    rv = np.full(N,np.nan,dtype='<f4')
    for j,t in enumerate(tyc):
        if t:
            key=f'{int(t)//65536}-{(int(t)//4)%16384}-{int(t)%4+1}'
            v=by_tyc.get(key)
            if v is not None: rv[j]=v
    if gaia:
        gids=np.frombuffer(old,dtype='<u8',count=N,offset=end-8*N)
        for j,g in enumerate(gids):
            if g: rv[j]=gaia_rv.get(int(g),np.nan)
    # Modelled components are built in. Remove their old optional entries,
    # remapping tile and alias indices so each component remains unique.
    binary_tycs=[c['tyc'] for s in systems for c in s['components'] if c['tyc']]
    binary_gaias=[int(c['gaia']) for s in systems for c in s['components'] if c['gaia']]
    keep=~np.isin(tyc,binary_tycs)
    if gaia: keep &= ~np.isin(gids,binary_gaias)
    starts=np.frombuffer(old,dtype='<u4',count=T+1,offset=20+16*T)
    new_index=np.concatenate([np.zeros(1,dtype='<u4'),np.cumsum(keep,dtype='<u4')])
    o=24+20*T;arrays=[]
    for dtype in ['<u4','<u2','<u2','<i2','<i2','<u2','u1','i1']:
        values=np.frombuffer(old,dtype=dtype,count=N,offset=o);o+=N*np.dtype(dtype).itemsize
        arrays.append(values[keep].tobytes())
    alias_star=np.frombuffer(old,dtype='<u4',count=A,offset=o)
    alias=np.frombuffer(old,dtype='<u4',count=A,offset=o+4*A);alias_keep=keep[alias_star]
    newN=int(keep.sum());newA=int(alias_keep.sum())
    header=b'STAR'+np.array([4 if gaia else 3,T,newN,newA],dtype='<u4').tobytes()
    result=header+old[20:20+16*T]+new_index[starts].tobytes()+b''.join(arrays)+new_index[alias_star[alias_keep]].tobytes()+alias[alias_keep].tobytes()
    if gaia: result+=gids[keep].tobytes()
    rv=rv[keep];N=newN;result+=rv.tobytes();file.write_bytes(result)
    stats[str(depth)]=dict(stars=N,bytes=len(result),radialVelocities=int(np.isfinite(rv).sum()),unknown=int(np.isnan(rv).sum()),sha256=sha(file))
    print(depth,stats[str(depth)],flush=True)
meta_path=ROOT/'data/stars-12.json';meta=json.loads(meta_path.read_text());meta.update(format='STAR v4',stars=stats['12']['stars'],retainedATHYG=stats['11']['stars'],addedGaia=stats['12']['stars']-stats['11']['stars'],bytes=stats['12']['bytes'],sha256=stats['12']['sha256'],radialVelocities=stats['12']['radialVelocities']);meta_path.write_text(json.dumps(meta,indent=2)+'\n')
metadata=dict(sources={name:sha(SOURCE/name) for name in ['athyg_40.csv.gz','gaia-rv.csv','binary_orbitparam.dat','orb6.txt','orb6-ephemerides.txt']},catalogs=stats,binaryPairs=14,gaiaMeasuredRadialVelocities=len(gaia_rv),attribution=['AT-HYG v4.0: David Nash, CC BY-SA 4.0, https://codeberg.org/astronexus/athyg','ESA Gaia DR3 radial_velocity, https://gea.esac.esa.int/archive/','USNO Sixth Catalog of Orbits of Visual Binary Stars, https://crf.usno.navy.mil/wds-orb6','Stellarium v26.3 binary_orbitparam.dat: barycentres and adopted mass ratios, GPL-2.0-or-later. https://github.com/Stellarium/stellarium/blob/v26.3/stars/hip_gaia3/binary_orbitparam.dat'],limitations=['Uniform space motion and fixed Kepler orbits are extrapolations, not all-date accuracy guarantees.','USNO grades 4 and 5 have uncertain orbits. Component masses are adopted; rho Oph uses equal masses and an AT-HYG mean barycentre.','The Stellarium guide lists rho Oph, but its data row is 70 Oph. We implement the actual rho Oph AB. Its beta Mus row copies Achird orbital elements; USNO elements replace them.','Existing catalogue positions, proper motions and parallaxes are preserved; source radial velocities are adopted at J2000, with no claim of new astrometric calibration.','AT-HYG HYG-source zero radial velocities are conservatively unknown; missing values are never reported as measured zero.'])
metadata['limitations'].append('Stellarium also gives psi Velorum exactly the same periastron JD as Dalim; the app uses the USNO Msn2023 epoch. Full 14-system audit: data/binary-stellarium-audit.json.')
metadata['stellariumAudit']='data/binary-stellarium-audit.json'
metadata['binaryPairs']=len(systems)
metadata['reviewedExpansion']='data/binary-selection.json'
metadata['attribution'].extend([
    'ESA Hipparcos I/239: Castor component-A and Procyon barycentric J1991.25 astrometry, https://vizier.cfa.harvard.edu/ftp/cats/I/239/ReadMe',
    'ESA Gaia DR3: resolved 70 Ophiuchi J2016.0 astrometry, https://gea.esac.esa.int/archive/',
    'Bond et al. 2015: Procyon adopted masses, parallax and systemic velocity, https://arxiv.org/abs/1510.00485',
])
(ROOT/'data/stellar-motion.json').write_text(json.dumps(metadata,indent=2)+'\n')
