import assert from 'node:assert/strict';
import { terrainKey, terrainAppearance } from '../js/skyterrain.js';
import { horizonAt } from '../js/skyhorizon.js';
import { profile, tileSampler } from '../js/terrainmodel.js';
assert.notEqual(terrainKey([45,10,90]),terrainKey([45,10,92]));
assert.notEqual(terrainKey([45,10,90]),terrainKey([45,10,90.01]));
assert.notEqual(terrainKey([45,10,90]),terrainKey([45.000001,10,90]));
assert.equal(horizonAt([0,10,20,30])(315),15);
assert.equal(horizonAt(new Float32Array(3600).fill(4))(231.7),4);
const settings=terrainAppearance({style:'bad',shadows:false,outlines:'yes',exposure:Infinity,nightExposure:1});
assert.deepEqual(settings,{style:'natural',waterColor:true,shadows:false,outlines:false,exposure:0,nightExposure:1});
const p=await profile({place:[0,0,0],sample:()=>0,rings:[[14,1000]],radius:1000,step:90,startDistance:100});
assert.ok(p.alt.every(v=>v<0),'Negative terrain elevations are retained');
assert.equal(p.eye,2);
console.log('Terrain keys, variable-resolution horizons, appearance validation and geometry checks passed');

const encoded=new Map([['0/0/0',{size:2,h:new Uint16Array([4001,4001,4001,4001]),scale:.25,offset:-1000,noData:65535}]]);
assert.equal(tileSampler(encoded)(0,0,0),.25);
encoded.get('0/0/0').h.fill(65535);assert.equal(tileSampler(encoded)(0,0,0),null);
console.log('Packed DEM precision and missing coverage checks passed');

const {terrainExposure}=await import('../js/terrainlighting.js');
assert.equal(terrainExposure(0),2**.7);
assert.equal(terrainExposure(0,true),4);
assert.equal(terrainExposure(1,true),8);
console.log('Centred exposure controls retain the approved day/night brightness');
