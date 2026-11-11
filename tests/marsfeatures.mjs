import assert from 'node:assert/strict';
import { MARS_FEATURES } from '../js/marsdata.js';
import { marsDisk, searchMarsFeatures, findMarsFeature, marsFeatureState, projectMarsFeatures, pickMarsFeature, marsFeatureDetails, MARS_MIN_RADIUS, marsFeatureOutline } from '../js/marsfeatures.js';
import { skyFrame, searchSky } from '../js/coelum.js';
import { surfaceVector } from '../js/skyview.js';
const R = Math.PI/180, start = Date.parse('2026-11-24T21:00:00Z')/1000;
assert.equal(MARS_FEATURES.length, 2054);
assert.equal(new Set(MARS_FEATURES.map((f) => f[0])).size, MARS_FEATURES.length, 'Duplicate Bohar record is collapsed by stable ID');
assert.equal(MARS_FEATURES.filter((f) => f[5] === 'AA').length, 1242);
assert.equal(MARS_FEATURES.filter((f) => f[5] === 'AL').length, 126);
for (const [id, name, lon, lat, diameter, code, shape] of MARS_FEATURES) {
  assert.ok(id > 0 && name && lon >= 0 && lon < 360 && Math.abs(lat) <= 90 && diameter >= 0 && code);
  if (!shape) continue;
  assert.ok(['robbins2020', 'usgs-opm', 'polygon-fit', 'albedo-map'].includes(shape.source));
  if (shape.kind === 'ellipse') {
    assert.ok(shape.major >= shape.minor && shape.minor > 0 && shape.angle >= 0 && shape.angle < 180);
    if (shape.source === 'robbins2020') assert.ok(shape.angleSD <= 15 && shape.arc >= 0.75);
  } else for (const ring of shape.rings) {
    assert.ok(ring.length >= 4);
    assert.deepEqual(ring[0], ring.at(-1));
    for (const [x, y] of ring) assert.ok(Number.isFinite(x) && Math.abs(y) <= 90);
  }
}
assert.equal(searchMarsFeatures('Mars Olympus')[0].key, 'mars:4453');
assert.equal(searchMarsFeatures('VÁLLES MARINERIS')[0].name, 'Valles Marineris');
assert.equal(searchMarsFeatures('Jezero')[0].code, 'AA');
assert.equal(searchMarsFeatures('Syrtis Major')[0].code, 'AL', 'Albedo and topographic names remain distinct');
assert.equal(searchMarsFeatures('Syrtis Major Planum')[0].code, 'PM');
assert.equal(findMarsFeature('lunar:4453'), null);
const gale = findMarsFeature('mars:2071'), huygens = findMarsFeature('mars:2596');
assert.equal(gale.shape.source, 'robbins2020');
assert.equal(gale.shape.ref, '15-1-003122');
assert.equal(gale.shape.major, 154.599);
assert.equal(gale.shape.minor, 153.373);
assert.equal(huygens.shape.major, 484.481);
assert.equal(huygens.shape.angle, 129.225);
assert.equal(findMarsFeature('mars:4453').shape.source, 'polygon-fit');
assert.equal(findMarsFeature('mars:6288').shape.kind, 'polygon');
assert.equal(findMarsFeature('mars:5795').shape.epoch, '2022–23');
assert.equal(findMarsFeature('mars:5624').shape.kind, 'ellipse');
assert.match(marsFeatureDetails(gale), /Measured crater ellipse.*Robbins 2020/s);
assert.match(marsFeatureDetails(findMarsFeature('mars:5795')), /Approximate.*2022–23.*markings can change/s);
assert.match(marsFeatureDetails({ ...gale, name: '<unsafe>' }), /&lt;unsafe&gt;/);

const center = { x: 600, y: 600 }, radius = 500, north = 0.7, seen = new Set();
for (let hour = 0; hour < 26; hour += 2) {
  const disk = marsDisk(start+hour*3600), features = projectMarsFeatures(disk, center, radius, north, 1200, 1200);
  assert.deepEqual(projectMarsFeatures(disk, center, MARS_MIN_RADIUS-1, north, 1200, 1200), []);
  const axes = [surfaceVector(disk, 0, 0), surfaceVector(disk, 90, 0), surfaceVector(disk, 0, 90)];
  for (const f of features) {
    seen.add(f.name);
    const state = marsFeatureState(disk, f), v = state.v;
    assert.ok(state.visible && state.sunlit);
    const polar = v.reduce((s, x, k) => s+x*disk.pole[k], 0);
    assert.ok(Math.abs(v.reduce((s, x) => s+x*x, 0)+polar**2*((1-0.00589)**-2-1)-1) < 1e-8);
    assert.ok(Math.abs(f.x-center.x-radius*(v[0]*Math.cos(north)+v[1]*Math.sin(north))) < 1e-8);
    assert.ok(Math.abs(f.y-center.y-radius*(v[0]*Math.sin(north)-v[1]*Math.cos(north))) < 1e-8);
    if (v[2] > 0.4 && state.sunlight > 0.2) assert.equal(pickMarsFeature([f], f.x, f.y), f);
    assert.equal(pickMarsFeature([f], f.x+2*radius+30, f.y), null);
  }
  // Independently recover ellipse points by ray/ellipsoid intersection and
  // convert to local metric coordinates. This checks both axes and rotation.
  for (const f of features.filter((f) => f.shape?.kind === 'ellipse').slice(0, 4)) {
    const shape = f.shape, [lon, lat] = shape.center;
    const C = [Math.cos(lat*R)*Math.cos(lon*R), Math.cos(lat*R)*Math.sin(lon*R), Math.sin(lat*R)];
    const E = [-Math.sin(lon*R), Math.cos(lon*R), 0], N = [-Math.sin(lat*R)*Math.cos(lon*R), -Math.sin(lat*R)*Math.sin(lon*R), Math.cos(lat*R)];
    const outline = marsFeatureOutline(disk, f, center, radius, north);
    assert.ok(outline.length > 100);
    for (const p of outline.filter((p) => p.visible)) {
      const dx = (p.x-center.x)/radius, dy = (p.y-center.y)/radius, c = Math.cos(north), s = Math.sin(north);
      const x = dx*c+dy*s, y = dx*s-dy*c, pole = disk.pole, k = (1-0.00589)**-2-1;
      const A = 1+k*pole[2]**2, B = k*(x*pole[0]+y*pole[1])*pole[2], Q = x*x+y*y+k*(x*pole[0]+y*pole[1])**2-1;
      const z = (-B+Math.sqrt(Math.max(0, B*B-A*Q)))/A, norm = Math.hypot(x, y, z);
      const geo = axes.map((a) => (x*a[0]+y*a[1]+z*a[2])/norm);
      const dot = (a, b) => a.reduce((sum, v, i) => sum+v*b[i], 0);
      const angle = Math.acos(Math.max(-1, Math.min(1, dot(geo, C))));
      const scale = 3396.19*angle/Math.max(1e-12, Math.sin(angle));
      const east = scale*dot(geo, E), n = scale*dot(geo, N), a = shape.angle*R;
      const u = east*Math.cos(a)+n*Math.sin(a), w = -east*Math.sin(a)+n*Math.cos(a);
      assert.ok(Math.abs((2*u/shape.major)**2+(2*w/shape.minor)**2-1) < 1e-6, 'Ellipse axes, center and orientation survive globe projection');
    }
  }
  const dark = { ...disk, sun: [0, 0, -1] };
  assert.deepEqual(projectMarsFeatures(dark, center, radius, north, 1200, 1200), []);
  if (features.length) {
    const f = features[0], shaded = { ...f, projection: { ...f.projection, disk: dark } };
    assert.equal(pickMarsFeature([shaded], f.x, f.y), null, 'No picks on unlit portions of a footprint');
  }
}
for (const name of ['Olympus Mons', 'Valles Marineris', 'Hellas', 'Syrtis Major', 'Gale', 'Huygens', 'Jezero']) assert.ok(seen.has(name), name);
// Small named features remain selectable when directly searched.
const disk = marsDisk(start+10*3600), jezero = searchMarsFeatures('Jezero')[0];
const selected = projectMarsFeatures(disk, center, 156, 0, 1200, 1200, jezero.key);
if (marsFeatureState(disk, jezero).visible && marsFeatureState(disk, jezero).sunlit) assert.ok(selected.some((f) => f.key === jezero.key));
const frame = skyFrame(start, [41.892, 12.511, 20]);
const companion = { ...frame.stars[0], name: 'Olympus Mons companion' };
assert.equal(searchSky({ ...frame, stars: [companion] }, 'Olympus Mons')[0].name, companion.name);
assert.equal(searchSky(frame, 'Mars Jezero')[0].key, jezero.key);
console.log('Expanded Mars checks passed: catalogue, source geometry, albedo provenance, elliptical projection, clipping, picking, search and zoom selection');
