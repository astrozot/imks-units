"""Reviewed additions to the original 14 examples; called by stellar-catalogs.

The numerical screen is deliberately separate from scientific acceptance.
No unchecked mass ratio or primary/photocentre assumption is inferred from
an ORB6 relative orbit. Every accepted addition has a review record.
"""
import json
import math
import hashlib
import csv

R=math.pi/180

def component_magnitudes(line):
    # ORB6 T67,F5.2,A1 and T74,F5.2,A1 (one-based columns).
    # Starting the secondary at T75 loses the tens digit of faint companions.
    return [float(line[66:71]), float(line[73:78])]

def screened_candidates(lines, selection):
    candidates=[]
    for l in lines:
        try:
            grade=int(l[233]);m1,m2=component_magnitudes(l);orbit=orbit_from_record(l)
            if (grade not in selection['grades'] or
                m1>selection['primaryVisualMagnitudeMax'] or
                m2>selection['secondaryVisualMagnitudeMax'] or
                orbit[6]<selection['relativeSemimajorArcsecMin'] or
                l[71]=='k' or l[78]=='k'):continue
            candidates.append(dict(wds=l[19:29],designation=l[30:44].strip(),primaryHip=l[58:64].strip(),grade=grade,primaryMagnitude=m1,secondaryMagnitude=m2,semimajorArcsec=orbit[6],periodYears=orbit[0]/365.25,reference=l[237:246].strip(),record=l[246:].strip(),status='pending-component-and-barycentre-review'))
        except (ValueError,KeyError,IndexError):continue
    return candidates

def annotate_candidate_investigation(root,report):
    path=root/'data/binary-candidate-notes.json'
    if not path.exists():return
    notes=json.loads(path.read_text())['pairs']
    report['candidateInvestigation']='data/binary-candidate-audit.json'
    for c in report['candidates']:
        correction=notes.get(c['record'],{}).get('primaryHipOverride')
        if correction:
            c.setdefault('cataloguePrimaryHip',c['primaryHip'])
            c['primaryHip']=correction
            c['identityReview']=notes[c['record']]['finding']

def resolved_component_system(root,cfg,line,chart):
    source=json.loads((root/'data/binary-resolved-sources.json').read_text())
    record=source['systems'][cfg['name']];adopted=record['adopted']
    stars=sorted(record['gaiaDR3'],key=lambda r:float(r['Gmag']))
    masses=cfg['masses'];weights=[m/sum(masses) for m in masses]
    directions=[[math.cos(float(s['DE_ICRS'])*R)*math.cos(float(s['RA_ICRS'])*R),
                 math.cos(float(s['DE_ICRS'])*R)*math.sin(float(s['RA_ICRS'])*R),
                 math.sin(float(s['DE_ICRS'])*R)] for s in stars]
    v=[sum(w*d[k] for w,d in zip(weights,directions)) for k in range(3)]
    bary=dict(epoch=2451545+(record['refEpoch']-2000)*365.25,
              ra=math.atan2(v[1],v[0])/R%360,dec=math.atan2(v[2],math.hypot(v[0],v[1]))/R,
              distance=1000/adopted['parallaxMas'],pmra=adopted['pmra'],pmdec=adopted['pmdec'],rv=adopted['rv'])
    orbit=orbit_from_record(line)
    assert masses==adopted['masses']
    assert abs((orbit[6]*bary['distance'])**3/(orbit[0]/365.25)**2/sum(masses)-1)<.03
    original=next(r for r in chart if r[0]==cfg['primaryHip']);comps=[]
    tychos=sorted(record['tycho2'],key=lambda r:float(r['VTmag']))
    for i,star in enumerate(stars):
        tyc=tychos[i];t,n,c=[int(tyc[k]) for k in ['TYC1','TYC2','TYC3']]
        aliases=[cfg['componentNames'][i]]+cfg['extraAliases'][i]
        if i==0:aliases+=original[10].split('|')+[f"HIP {cfg['primaryHip']}"]
        aliases += [f"Gaia DR3 {star['Source']}",f'TYC {t}-{n}-{c}']
        comps.append(dict(id=f"{cfg['idPrefix']}:{'AB'[i]}",name=cfg['componentNames'][i],
            hip=cfg['primaryHip'] if i==0 else 0,gaia=star['Source'],tyc=t*65536+n*4+c-1,
            mag=component_magnitudes(line)[i],bv=original[4] if i==0 else None,
            spect=original[11] if i==0 else cfg['secondarySpectrum'],aliases=list(dict.fromkeys(aliases)),
            replace=[f"HIP {cfg['primaryHip']}"] if i==0 else []))
    return dict(name=cfg['name'],orbit=orbit,barycentre=bary,masses=masses,components=comps,
        grade=int(line[233]),reference=line[237:246].strip(),wds=line[19:29],
        massRatioNote=cfg['massRatioNote'],review=cfg['review'],note=cfg['note'],sources=cfg['sources'])

def hip_barycentric_system(root,cfg,line,chart):
    source=json.loads((root/'data/binary-hipparcos-sources.json').read_text())
    record=source['records'][str(cfg['primaryHip'])]
    assert record['AstroRef']=='+' and record['MultFlag']=='O'
    bary=dict(epoch=2448349.0625,ra=float(record['RAICRS']),dec=float(record['DEICRS']),
              pmra=float(record['pmRA']),pmdec=float(record['pmDE']),
              distance=1000/cfg['parallaxMas'],rv=cfg['systemicRV'])
    orbit=orbit_from_record(line);masses=cfg['masses']
    assert abs((orbit[6]*bary['distance'])**3/(orbit[0]/365.25)**2/sum(masses)-1)<.03
    original=next(row for row in chart if row[0]==cfg['primaryHip'])
    tycho=source['tychoRecords'][str(cfg['primaryHip'])]
    t,n,c=map(int,tycho.split('-'));comps=[]
    for i,mag in enumerate(component_magnitudes(line)):
        aliases=[cfg['componentNames'][i]]+cfg['extraAliases'][i]
        if i==0:aliases+=original[10].split('|')+[f"HIP {cfg['primaryHip']}",f'TYC {tycho}']
        comps.append(dict(id=f"{cfg['idPrefix']}:{'AB'[i]}",name=cfg['componentNames'][i],
            hip=cfg['primaryHip'] if i==0 else 0,gaia='',tyc=t*65536+n*4+c-1 if i==0 else 0,
            mag=mag,bv=original[4] if i==0 else None,spect=original[11] if i==0 else cfg['secondarySpectrum'],
            aliases=list(dict.fromkeys(aliases)),replace=[f"HIP {cfg['primaryHip']}"] if i==0 else []))
    return dict(name=cfg['name'],orbit=orbit,barycentre=bary,masses=masses,components=comps,
        grade=int(line[233]),reference=line[237:246].strip(),wds=line[19:29],
        massRatioNote=cfg['massRatioNote'],review=cfg['review'],note=cfg['note'],sources=cfg['sources'])

def hip_record(source,name,hip):
    lines=(source/name).read_text().splitlines()
    header=next(l for l in lines if l.startswith('recno\tHIP')).split('\t')
    ix=header.index('HIP')
    row=next(l.split('\t') for l in lines if len(l.split('\t'))==len(header) and l.split('\t')[ix].strip()==str(hip))
    return {k:v.strip() for k,v in zip(header,row)}

def relative_vector(orbit,jd):
    P,e,i,O,w,t0,a=orbit
    M=(2*math.pi*(jd-t0)/P+math.pi)%(2*math.pi)-math.pi;E=M
    for _ in range(100):
        delta=(E-e*math.sin(E)-M)/(1-e*math.cos(E));E-=delta
        if abs(delta)<1e-14:break
    x=a*(math.cos(E)-e);y=a*math.sqrt(1-e*e)*math.sin(E)
    return [(math.cos(O)*math.cos(w)-math.sin(O)*math.sin(w)*math.cos(i))*x+(-math.cos(O)*math.sin(w)-math.sin(O)*math.cos(w)*math.cos(i))*y,
            (math.sin(O)*math.cos(w)+math.cos(O)*math.sin(w)*math.cos(i))*x+(-math.sin(O)*math.sin(w)+math.cos(O)*math.cos(w)*math.cos(i))*y,
            math.sin(w)*math.sin(i)*x+math.cos(w)*math.sin(i)*y]

def centre_from_primary(ra,dec,orbit,masses,jd):
    # Invert the component-A displacement in the fixed ICRS orbital triad.
    # Catalogue AstroRef='A' is not interchangeable with AstroRef='+'.
    q=relative_vector(orbit,jd);f=-masses[1]/sum(masses)*R/3600
    radial,east,north=1+f*q[2],f*q[1],f*q[0]
    norm=math.sqrt(radial**2+east**2+north**2)
    d=math.asin(math.sin(dec*R)*norm/math.hypot(radial,north))-math.atan2(north,radial)
    a=ra*R-math.atan2(east,radial*math.cos(d)-north*math.sin(d))
    return a/R%360,d/R

def orbit_from_record(l):
    n=lambda a,z:float(l[a-1:z].strip())
    period=n(81,92)*{'y':365.25,'d':1,'c':36525}[l[92]]
    axis=n(106,114)*{'a':1,'m':.001,'M':60}[l[114]]
    epoch=n(163,174)
    epoch=2415020.31352+(epoch-1900)*365.242198781 if l[174]=='y' else epoch+2400000+(0.5 if l[174]=='m' else 0)
    return [period,n(188,195),n(126,133)*R,n(144,151)*R,n(206,213)*R,epoch,axis]

def expand_binary_systems(root,source,systems,chart,hips,proper,members,source_for):
    review=json.loads((root/'data/binary-reviewed-additions.json').read_text())
    lines=(source/'orb6.txt').read_text().splitlines()
    source_rows=[l.split() for l in (source/'binary_orbitparam.dat').read_text().splitlines() if l and not l.startswith('#')]
    candidates=screened_candidates(lines,review['selection'])
    references=[]
    for cfg in review['systems']:
        l=next(l for l in lines if f"wds{cfg['orbitRecord']}.png" in l)
        orbit=orbit_from_record(l)
        candidate=next(c for c in candidates if c['record']==f"wds{cfg['orbitRecord']}.png")
        candidate.update(status='accepted-reviewed-batch',name=cfg['name'],review=cfg['review'])
        if cfg.get('hipBarycentre') or cfg.get('resolvedBarycentre'):
            builder=resolved_component_system if cfg.get('resolvedBarycentre') else hip_barycentric_system
            system=builder(root,cfg,l,chart)
            systems.append(system)
            ephem=next(e for e in (source/'orb6-ephemerides.txt').read_text().splitlines() if e[:10]==system['wds'] and system['reference'] in e and l[30:44].strip() in e)
            references.append(dict(name=cfg['name'],elements=l,ephemerides=ephem))
            continue
        if cfg.get('stellariumPrimaryId'):
            b=next(b for b in source_rows if b[0]==cfg['stellariumPrimaryId'])
            bary=dict(distance=float(b[9]),epoch=float(b[10]),ra=float(b[11])/R,dec=float(b[12])/R,rv=float(b[13]),pmra=float(b[14]),pmdec=float(b[15]))
            masses=list(map(float,b[16:18]))
        else:
            bary=cfg['barycentre'];masses=cfg['masses']
            # Validate the original catalogue's explicit centre-of-mass flag,
            # rather than silently using a primary or photocentre solution.
            record=hip_record(source,'hip-procyon.tsv',37279)
            assert record['AstroRef']=='+' and record['MultFlag']=='O'
            for a,b in [('RAICRS','ra'),('DEICRS','dec'),('pmRA','pmra'),('pmDE','pmdec')]:assert float(record[a])==bary[b]
            assert bary['epoch']==2451545-8.75*365.25
        if cfg['name']=='Castor':
            record=hip_record(source,'hip-castor.tsv',36850)
            assert record['AstroRef']=='A','Castor catalogue position is component A, not its barycentre'
            bary['epoch']=2451545-8.75*365.25
            bary['ra'],bary['dec']=centre_from_primary(float(record['RAICRS']),float(record['DEICRS']),orbit,masses,bary['epoch'])
        if cfg['name']=='70 Ophiuchi':
            rows={s['source_id']:s for s in csv.DictReader((source/'expansion-gaia-astrometry.csv').open())}
            stars=[rows['4468557611984384512'],rows['4468557611977674496']]
            assert all(float(s['ref_epoch'])==2016 for s in stars)
            weight=[m/sum(masses) for m in masses]
            directions=[[math.cos(float(s['dec'])*R)*math.cos(float(s['ra'])*R),math.cos(float(s['dec'])*R)*math.sin(float(s['ra'])*R),math.sin(float(s['dec'])*R)]for s in stars]
            v=[sum(w*d[k]for w,d in zip(weight,directions))for k in range(3)]
            bary=dict(epoch=2451545+16*365.25,ra=math.atan2(v[1],v[0])/R%360,dec=math.atan2(v[2],math.hypot(v[0],v[1]))/R,
                      distance=1000/sum(w*float(s['parallax'])for w,s in zip(weight,stars)),
                      pmra=sum(w*float(s['pmra'])for w,s in zip(weight,stars)),pmdec=sum(w*float(s['pmdec'])for w,s in zip(weight,stars)),rv=sum(w*float(s['radial_velocity'])for w,s in zip(weight,stars)))
        # A Kepler consistency check is useful for detecting units or a
        # mass sum taken from a different level of a hierarchical system.
        kepler_mass=(orbit[6]*bary['distance'])**3/(orbit[0]/365.25)**2
        assert abs(kepler_mass/sum(masses)-1)<.03,(cfg['name'],kepler_mass,masses)
        primary=hips[cfg['primaryHip']][0]
        secondary=members.get(cfg.get('secondaryGaia')) or proper.get(cfg.get('secondaryProper'))
        if secondary is None:secondary=dict(primary,hip='',hd='',hr='',tyc='',gaia='',proper='',spect=cfg.get('secondarySpectrum',''),ci='')
        pair=[primary,secondary];comps=[]
        for i,s in enumerate(pair):
            matches=[row for row in chart if source_for(row) is s]
            existing=min(matches,key=lambda r:r[3]) if matches else None
            aliases=[cfg['componentNames'][i]]+cfg['extraAliases'][i]
            if existing:aliases+=existing[10].split('|')
            gaia=s['gaia']
            if i==0 and gaia and gaia==secondary['gaia']:gaia=''
            aliases+=[f"HIP {s['hip']}" if s['hip'] else '',f"HD {s['hd']}" if s['hd'] else '',f'Gaia DR3 {gaia}' if gaia else '',f"TYC {s['tyc']}" if s['tyc'] else '']
            tyc=list(map(int,s['tyc'].split('-'))) if s['tyc'] else None
            comps.append(dict(id=f"{cfg['idPrefix']}:{'AB'[i]}",name=cfg['componentNames'][i],hip=int(s['hip'] or 0),gaia=gaia,tyc=tyc[0]*65536+tyc[1]*4+tyc[2]-1 if tyc else 0,mag=component_magnitudes(l)[i],bv=existing[4] if existing else float(s['ci']) if s['ci'] else None,spect=s['spect'],aliases=list(dict.fromkeys(a for a in aliases if a)),replace=[f'HIP {row[0]}' if row[0] else row[9] or row[10] for row in matches]))
        system=dict(name=cfg['name'],orbit=orbit,barycentre=bary,masses=masses,components=comps,grade=int(l[233]),reference=l[237:246].strip(),wds=l[19:29],massRatioNote='Bond et al. 2015 dynamical masses' if cfg['name']=='Procyon' else 'Stellarium 26.3 adopted subsystem masses',review=cfg['review'],sources=cfg['sources'])
        if cfg.get('note'):system['note']=cfg['note']
        systems.append(system)
        ephem=next(e for e in (source/'orb6-ephemerides.txt').read_text().splitlines() if e[:10]==system['wds'] and system['reference'] in e and l[30:44].strip() in e)
        references.append(dict(name=cfg['name'],elements=l,ephemerides=ephem))
    existing={(s['wds'],s['reference']) for s in systems[:-len(review['systems'])]}
    for c in candidates:
        if (c['wds'],c['reference']) in existing:c['status']='already-modelled'
    report=dict(selection=review['selection'],orbitRowsAfterScreen=len(candidates),distinctPairDesignations=len({(c['wds'],c['designation']) for c in candidates}),addedSystems=[s['name'] for s in review['systems']],totalModelledSystems=len(systems),candidates=candidates,scope='Reviewed additions. Remaining candidates need identity, hierarchy, barycentre and mass-ratio review; an ORB6 quality grade alone is insufficient for absolute component positions.',sourceHashes={name:hashlib.sha256((source/name).read_bytes()).hexdigest() for cfg in review['systems'] for name in cfg['sourceFiles']})
    report['sourceHashes']['data/binary-hipparcos-sources.json']=hashlib.sha256((root/'data/binary-hipparcos-sources.json').read_bytes()).hexdigest()
    report['sourceHashes']['data/binary-resolved-sources.json']=hashlib.sha256((root/'data/binary-resolved-sources.json').read_bytes()).hexdigest()
    annotate_candidate_investigation(root,report)
    (root/'data/binary-selection.json').write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n')
    return references

def annotate_hip_additions(metadata,review):
    for cfg in review['systems']:
        if cfg.get('hipBarycentre') or cfg.get('resolvedBarycentre'):
            credit=f"{cfg['name']}: {cfg['massRatioNote']} Sources: "+', '.join(cfg['sources'])
            if credit not in metadata['attribution']:metadata['attribution'].append(credit)
    limitation='New Hipparcos additions: μ Cas and β CrB retain barycentric J1991.25 catalogue astrometry, with published adopted parallaxes and dynamical masses. β CrB systemic RV is unknown; perspective acceleration is omitted. Fixed orbits and old absolute anchors do not imply modern observational accuracy.'
    if limitation not in metadata['limitations']:metadata['limitations'].append(limitation)
    if any(c.get('resolvedBarycentre') for c in review['systems']):
        limitation='80 Tauri uses resolved Gaia DR3 J2016.0 positions with Torres 2019 dynamical masses, adopted parallax and fitted systemic proper motion. Its systemic RV is unknown; perspective acceleration is omitted. Published mass and grade-3 orbit uncertainties remain.'
        if limitation not in metadata['limitations']:metadata['limitations'].append(limitation)

def refresh_hip_additions(root,source):
    """Refresh pinned catalogue additions, without reprocessing Gaia RVs.

    python tools/binary_expansion.py SOURCE_DIRECTORY
    Requires the original orb6.txt and orb6-ephemerides.txt snapshots. Other
    binaries, raw chart rows and optional catalogue downloads are preserved.
    """
    review=json.loads((root/'data/binary-reviewed-additions.json').read_text())
    metadata=json.loads((root/'data/stellar-motion.json').read_text())
    for name in ['orb6.txt','orb6-ephemerides.txt']:
        assert hashlib.sha256((source/name).read_bytes()).hexdigest()==metadata['sources'][name],f'Unexpected source snapshot: {name}'
    path=root/'js/binarydata.js';raw=path.read_text();start=raw.index('[\n')
    systems=json.loads(raw[start:raw.rfind(']')+1])
    chart_raw=(root/'js/stardata.js').read_text()
    chart=json.loads(chart_raw[chart_raw.index('[\n'):chart_raw.rfind(']')+1])
    fixtures=root/'tests/fixtures/binary-orbits.json';refs=json.loads(fixtures.read_text())
    lines=(source/'orb6.txt').read_text().splitlines()
    ephemerides=(source/'orb6-ephemerides.txt').read_text().splitlines()
    for cfg in review['systems']:
        if not (cfg.get('hipBarycentre') or cfg.get('resolvedBarycentre')):continue
        line=next(l for l in lines if f"wds{cfg['orbitRecord']}.png" in l)
        builder=resolved_component_system if cfg.get('resolvedBarycentre') else hip_barycentric_system
        system=builder(root,cfg,line,chart)
        ephem=next(e for e in ephemerides if e[:10]==system['wds'] and system['reference'] in e and line[30:44].strip() in e)
        systems=[s for s in systems if s['name']!=cfg['name']]+[system]
        refs=[r for r in refs if r['name']!=cfg['name']]+[dict(name=cfg['name'],elements=line,ephemerides=ephem)]
    # Correct existing components too (notably Procyon B: 10.8, not 0.8).
    for system in systems:
        record=next(r for r in refs if r['name']==system['name'])
        for component,mag in zip(system['components'],component_magnitudes(record['elements'])):
            component['mag']=mag
    report=json.loads((root/'data/binary-selection.json').read_text())
    candidates=screened_candidates(lines,review['selection'])
    accepted={f"wds{c['orbitRecord']}.png":c for c in review['systems']}
    existing={(s['wds'],s['reference']) for s in systems}
    for c in candidates:
        cfg=accepted.get(c['record'])
        if cfg:c.update(status='accepted-reviewed-batch',name=cfg['name'],review=cfg['review'])
        elif (c['wds'],c['reference']) in existing:c['status']='already-modelled'
    report.update(candidates=candidates,orbitRowsAfterScreen=len(candidates),
        distinctPairDesignations=len({(c['wds'],c['designation']) for c in candidates}),
        addedSystems=[c['name'] for c in review['systems']],totalModelledSystems=len(systems),
        scope='Reviewed additions. Remaining candidates need identity, hierarchy, barycentre and mass-ratio review; an ORB6 quality grade alone is insufficient for absolute component positions.')
    report['sourceHashes']['data/binary-hipparcos-sources.json']=hashlib.sha256((root/'data/binary-hipparcos-sources.json').read_bytes()).hexdigest()
    report['sourceHashes']['data/binary-resolved-sources.json']=hashlib.sha256((root/'data/binary-resolved-sources.json').read_bytes()).hexdigest()
    annotate_candidate_investigation(root,report)
    metadata['binaryPairs']=len(systems)
    annotate_hip_additions(metadata,review)
    path.write_text(raw[:start]+json.dumps(systems,ensure_ascii=False,indent=2)+';\n')
    for path,value in [(fixtures,refs),(root/'data/binary-selection.json',report),(root/'data/stellar-motion.json',metadata)]:
        path.write_text(json.dumps(value,ensure_ascii=False,indent=2)+'\n')

if __name__=='__main__':
    import pathlib
    import sys
    refresh_hip_additions(pathlib.Path(__file__).resolve().parents[1],pathlib.Path(sys.argv[1]))
