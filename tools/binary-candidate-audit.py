"""Reproduce the remaining-candidate investigation from retained source extracts.

Requires NumPy, SciPy and ERFA, like space-motion-reference.py. No network.
Run: python tools/binary-candidate-audit.py
The report checks relative models and identifies missing absolute astrometry;
it does not turn photometric mass estimates into accepted dynamical models.
"""
import collections
import hashlib
import json
import math
import pathlib

import erfa
import numpy as np
from scipy.optimize import brentq
from binary_expansion import orbit_from_record

ROOT = pathlib.Path(__file__).resolve().parents[1]


def source_direction(line):
    ra = (float(line[:2]) + float(line[2:4])/60 + float(line[4:9])/3600)*15
    dec = (float(line[10:12]) + float(line[12:14])/60 + float(line[14:18])/3600)
    return ra, -dec if line[9] == '-' else dec


def angular_distance(ra, dec, other_ra, other_dec):
    a, d, b, e = map(math.radians, [ra, dec, other_ra, other_dec])
    u = np.array([math.cos(d)*math.cos(a), math.cos(d)*math.sin(a), math.sin(d)])
    v = np.array([math.cos(e)*math.cos(b), math.cos(e)*math.sin(b), math.sin(e)])
    return math.degrees(2*math.asin(min(1, np.linalg.norm(u-v)/2)))*3600


def ephemeris_check(line, published):
    period, eccentricity, inc, node, peri, epoch, axis = orbit_from_record(line)
    ra, dec = map(math.radians, source_direction(line))
    u = np.array([math.cos(dec)*math.cos(ra), math.cos(dec)*math.sin(ra), math.sin(dec)])
    north = np.array([-math.sin(dec)*math.cos(ra), -math.sin(dec)*math.sin(ra), math.cos(dec)])
    east = np.array([-math.sin(ra), math.cos(ra), 0])
    values = list(map(float, published[43:].split()[:10]))
    rows = []
    for y in range(5):
        jd = 2415020.31352 + (125+y)*365.242198781
        mean = (2*math.pi*(jd-epoch)/period) % (2*math.pi)
        anomaly = brentq(lambda x: x-eccentricity*math.sin(x)-mean, 0, 2*math.pi, xtol=1e-14)
        true = math.atan2(math.sqrt(1-eccentricity**2)*math.sin(anomaly), math.cos(anomaly)-eccentricity)
        radius = axis*(1-eccentricity*math.cos(anomaly))
        n = radius*(math.cos(node)*math.cos(true+peri)-math.sin(node)*math.sin(true+peri)*math.cos(inc))
        e = radius*(math.sin(node)*math.cos(true+peri)+math.cos(node)*math.sin(true+peri)*math.cos(inc))
        # USNO's published PA is referred to the equinox of the prediction
        # date. Transport both the direction and its tangent basis with ERFA.
        matrix = erfa.pmat06(2451545, jd-2451545)
        direction = matrix @ u
        a = math.atan2(direction[1], direction[0])
        d = math.atan2(direction[2], math.hypot(*direction[:2]))
        dated_north = np.array([-math.sin(d)*math.cos(a), -math.sin(d)*math.sin(a), math.cos(d)])
        dated_east = np.array([-math.sin(a), math.cos(a), 0])
        delta = matrix @ (n*north+e*east)
        pa = math.degrees(math.atan2(delta @ dated_east, delta @ dated_north))
        raw_pa = math.degrees(math.atan2(e, n))
        rows.append(dict(besselianYear=2025+y, separationErrorArcsec=abs(math.hypot(n,e)-values[2*y+1]),
                         positionAngleErrorDegrees=abs((pa-values[2*y]+180) % 360-180),
                         unprecessedPositionAngleErrorDegrees=abs((raw_pa-values[2*y]+180) % 360-180)))
    dr = max(r['separationErrorArcsec'] for r in rows)
    dt = max(r['positionAngleErrorDegrees'] for r in rows)
    return dict(samples=rows, passed=dr < .002 and dt < .3,
                maxSeparationErrorArcsec=dr, maxPositionAngleErrorDegrees=dt)


def investigate(write=True):
    snapshot = json.loads((ROOT/'data/binary-candidate-sources.json').read_text())
    notes = json.loads((ROOT/'data/binary-candidate-notes.json').read_text())['pairs']
    selection = json.loads((ROOT/'data/binary-selection.json').read_text())
    candidates = {c['record']: c for c in selection['candidates']}
    raw = (ROOT/'js/stardata.js').read_text()
    chart = {str(r[0]): r for r in json.loads(raw[raw.index('[\n'):raw.rfind(']')+1])}
    counts = collections.Counter()
    records = []
    for ref in snapshot['orbits']:
        candidate = candidates[ref['record']]
        line = ref['elements']; orbit = orbit_from_record(line)
        note = notes.get(ref['record'], {})
        printed_hip = line[58:64].strip()
        hip = note.get('primaryHipOverride', printed_hip)
        astrometry = snapshot['hipparcos'][hip]
        original_astrometry = snapshot['hipparcos'][printed_hip]
        row = chart.get(hip)
        name = note.get('name') or (row[9] or row[10].split('|')[0] if row else f'HIP {hip}')
        matched = []
        for table in ['table1', 'table3-4']:
            for r in snapshot['soderhjelm'][f'J/A+A/341/121/{table}']:
                if r['HIP'] == hip:
                    # A HIP match alone is not a subsystem match. Preserve
                    # mismatches as leads, without assigning their mass ratio.
                    same_scale = abs(float(r['Per'])/candidate['periodYears']-1) < .2 and abs(float(r['a'])/orbit[6]-1) < .2
                    measured = table == 'table1'
                    value = r.get('M2/M1') if measured else r.get('q')
                    matched.append(dict(table=table, massRatio=float(value) if value else None,
                                        method='astrometric' if measured else 'photometric',
                                        approximateOrbitScaleMatches=same_scale, publishedNote=r['Note'],
                                        publishedMassSumSolar=float(r['Msum']), publishedParallaxMas=float(r['plx'])))
        mass_evidence = 'dedicated-paper-review-required'
        if any(m['massRatio'] is not None and m['method']=='photometric' and m['approximateOrbitScaleMatches'] for m in matched):
            mass_evidence = 'photometric-estimate-only-in-reviewed-catalogue'
        if any(m['method']=='astrometric' and m['approximateOrbitScaleMatches'] for m in matched):
            mass_evidence = 'published-astrometric-ratio'
        if note.get('massEvidence') == 'dynamical':
            mass_evidence = 'published-dynamical-solution'
        scope_flag = any(part in candidate['designation'] for part in ['Aa,','Ba,','Ab,','AB,','BC','CD'])
        scope_flag = scope_flag or note.get('hierarchyReview', False)
        # Multiple pair levels of the same system cannot consume the same
        # component twice without a hierarchy model.
        if sum(c['wds']==candidate['wds'] for c in candidates.values()) > 1:
            scope_flag = True
        complete = all(astrometry[k] for k in ['RAICRS','DEICRS','pmRA','pmDE','Plx'])
        barycentric = astrometry['AstroRef']=='+' and astrometry['MultFlag']=='O'
        blockers = []
        if not complete: blockers.append('missing-Hipparcos-absolute-astrometry')
        if not barycentric: blockers.append('absolute-barycentre-and-systemic-motion-not-established')
        if astrometry['HD']!=line[51:57].strip():
            blockers.append('component-HD-identifiers-need-reconciliation')
        if mass_evidence in ['photometric-estimate-only-in-reviewed-catalogue','dedicated-paper-review-required']:
            blockers.append('reviewed-dynamical-or-adopted-subsystem-mass-ratio-needed')
        if scope_flag: blockers.append('explicit-component-and-hierarchy-scope-needed')
        if hip != printed_hip: blockers.append('source-HIP-identity-error-corrected-for-review')
        check = ephemeris_check(line, ref['ephemerides'])
        if not check['passed']: blockers.append('relative-ephemeris-discrepancy-needs-review')
        identity = dict(printedHip=printed_hip, reviewedHip=hip,
                        matchingHD=astrometry['HD']==line[51:57].strip(),
                        chartRowAvailable=row is not None)
        if complete:
            a, d = float(astrometry['RAICRS']), float(astrometry['DEICRS'])
            a += float(astrometry['pmRA'])*8.75/3600000/math.cos(math.radians(d))
            d += float(astrometry['pmDE'])*8.75/3600000
            identity['reviewedHipOffsetFromSourceArcsec'] = angular_distance(*source_direction(line), a, d)
            if identity['reviewedHipOffsetFromSourceArcsec'] > 60:
                blockers.append('system-position-identity-discrepancy')
        if hip != printed_hip:
            identity['printedHipOffsetFromSourceArcsec'] = angular_distance(*source_direction(line), float(original_astrometry['RAICRS']), float(original_astrometry['DEICRS']))
        parallax = float(astrometry['Plx']) if astrometry['Plx'] else None
        mass = (orbit[6]*1000/parallax)**3/(orbit[0]/365.25)**2 if parallax and parallax>0 else None
        accepted = candidate['status']=='accepted-reviewed-batch'
        outcome = 'accepted-reviewed-model' if accepted else 'requires-absolute-solution'
        if not accepted and not complete: outcome='missing-absolute-astrometry'
        if not accepted and scope_flag: outcome='requires-component-or-hierarchy-review'
        if hip!=printed_hip: outcome='catalogue-identity-corrected-needs-review'
        if accepted: blockers=[]
        counts[outcome] += 1
        records.append(dict(record=ref['record'],wds=candidate['wds'],designation=candidate['designation'],name=name,
                            orbitGrade=candidate['grade'],periodYears=candidate['periodYears'],relativeOrbitCheck=check,
                            identity=identity,hipparcos=astrometry,
                            keplerMassUsingHipparcosParallaxSolar=mass,
                            keplerMassCaveat='Diagnostic mass sum only; catalogue distance and hierarchy can be wrong. Does not determine the component mass ratio.',
                            massEvidence=mass_evidence,soderhjelmMatches=matched,hierarchyScopeFlag=bool(scope_flag),
                            status=outcome,blockers=blockers,literatureReview=note or None,
                            nextStep=note.get('nextStep','Review component identities and obtain a barycentric position, systemic proper motion and supported component/subsystem mass ratio.')))
    report=dict(scope='Catalogue investigation of every pair pending at the start of this review, with focused literature follow-up for selected systems. This is not an exhaustive literature survey or an observational validation.',
                sourceSnapshot='data/binary-candidate-sources.json',literatureNotes='data/binary-candidate-notes.json',
                numericalMethod=f'Independent SciPy {__import__("scipy").__version__} bracketed Kepler solve and true-anomaly projection; ERFA {erfa.__version__} IAU 2006 precession for equinox-of-date PA.',
                tolerances=dict(separationArcsec=.002,positionAngleDegrees=.3),
                summary=dict(investigatedPairs=len(records),relativeEphemeridesChecked=len(records)*5,
                             relativeModelsPassing=sum(r['relativeOrbitCheck']['passed'] for r in records),
                             hipparcosExplicitBarycentreSolutions=sum(r['hipparcos']['AstroRef']=='+' and r['hipparcos']['MultFlag']=='O' for r in records),
                             soderhjelmCatalogueMatches=sum(bool(r['soderhjelmMatches']) for r in records),
                             focusedLiteratureReviews=sum(r['literatureReview'] is not None for r in records),
                             identityCorrections=sum(r['identity']['printedHip']!=r['identity']['reviewedHip'] for r in records),
                             outcomes=dict(counts)),
                sourceHashes={str(p.relative_to(ROOT)):hashlib.sha256(p.read_bytes()).hexdigest() for p in [ROOT/'data/binary-candidate-sources.json',ROOT/'data/binary-candidate-notes.json']},
                candidates=records)
    if write:
        (ROOT/'data/binary-candidate-audit.json').write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n')
        print(json.dumps(report['summary'],indent=2))
    return report


if __name__ == '__main__':
    investigate()
