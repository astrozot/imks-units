import assert from 'node:assert/strict';
import fs from 'node:fs';
import { makeRing, waterSampler, moonFlux, lightVector, shadowBasis, stitchRings } from './panorama-model.mjs';
// Azimuth, handedness and orthogonal light-map basis (including zenith).
assert.ok(Math.abs(lightVector(90, 0)[0] - 1) < 1e-12);
for (const light of [lightVector(123, 34), lightVector(0, 90), lightVector(0, -90)]) {
  const {right, up} = shadowBasis(light), dot = (a,b) => a.reduce((s,v,i) => s+v*b[i],0);
  assert.ok(Math.abs(dot(right,light)) < 1e-12); assert.ok(Math.abs(dot(up,light)) < 1e-12); assert.ok(Math.abs(dot(right,up)) < 1e-12);
  assert.ok(Math.abs(Math.hypot(...up)-1) < 1e-12);
}
// Phase brightness is nonlinear, with inverse-square distance dependence.
assert.ok(moonFlux(90) < moonFlux(0) / 8);
assert.ok(moonFlux(180) < moonFlux(90) / 100);
assert.equal(moonFlux(0, 768800), moonFlux(0) / 4);
// Mesh normals follow a known tilted surface, not a constant upward normal.
const mesh = makeRing({place:[0,0,0],sample:(lat,lon)=>lon*111195*0.5,extent:100,divisions:8,zoom:14});
assert.equal(mesh.indices.length, 8*8*6); assert.equal(mesh.missing,0);
const centre = (4*9+4)*3;
assert.ok(Math.abs(mesh.normals[centre]+1/Math.sqrt(5)) < 1e-5);
assert.ok(Math.abs(mesh.normals[centre+2]-2/Math.sqrt(5)) < 1e-5);
const missing = makeRing({place:[0,0,0],sample:()=>null,extent:100,divisions:8,zoom:14});
assert.equal(missing.indices.length,0); assert.equal(missing.missing,81);
// Explicit eye height shifts the geometry without source-height clamping.
const lifted = makeRing({place:[0,0,20],sample:()=>10,extent:100,divisions:8,zoom:14});
assert.equal(lifted.positions[centre+2],-10);
const hollow = makeRing({place:[0,0,0],sample:()=>10,extent:400,inner:100,divisions:8,zoom:14});
assert.equal(hollow.indices.length, (64-4)*6);
// Water material respects islands and never modifies source elevation.
const mask = waterSampler({elevation:65,outer:[[[0,0],[2,0],[2,2],[0,2],[0,0]]],inner:[[[0.8,0.8],[1.2,0.8],[1.2,1.2],[0.8,1.2],[0.8,0.8]]]});
assert.equal(mask.contains(.5,.5),true); assert.equal(mask.contains(1,1),false); assert.equal(mask.contains(3,3),false);
const lake = makeRing({place:[.5,.5,90],sample:()=>100,water:mask,extent:100,divisions:8,zoom:14});
assert.equal(lake.positions[centre+2],10); assert.equal(lake.waterMask[centre/3],1);
// Fine ring boundaries coincide with interpolated coarse boundaries.
const fine=makeRing({place:[0,0,0],sample:(a,b)=>Math.sin(b*10000)*30,extent:100,divisions:16,zoom:14});
const coarse=makeRing({place:[0,0,0],sample:(a,b)=>Math.sin(b*10000)*30,extent:400,inner:100,divisions:16,zoom:14});
stitchRings([fine,coarse]);
// Fine edge at x=100, y=0 shares the coarse node at (10,8).
assert.equal(fine.positions[(8*17+16)*3+2],coarse.positions[(8*17+10)*3+2]);
assert.ok([...fine.positions,...fine.normals].every(Number.isFinite));
console.log('Panorama checks passed: normals, missing coverage, eye height, light basis, lunar phase, lake/islands, LOD seams.');

const {packSurface,unpackSurface}=await import('./surface-io.mjs');
const packed=packSurface({lat:0,lon:0,eye:90},{pointGround:10},[lake,lake,lake,lake]);
const roundtrip=unpackSurface(JSON.parse(JSON.stringify(packed)));
assert.deepEqual(roundtrip.meshes[0].positions,lake.positions);
assert.deepEqual(roundtrip.meshes[0].indices,lake.indices);
packed.meshes[0].indices=btoa(String.fromCharCode(255,255,255,255));
assert.throws(()=>unpackSurface(packed),/Invalid mesh geometry/);
console.log('Surface persistence checks passed: exact typed-buffer round trip and invalid-index rejection.');
