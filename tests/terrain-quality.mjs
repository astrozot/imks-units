import assert from 'node:assert/strict';
import { makeRing, meshHeightAt, meshHorizon, terrainForeground } from '../js/terrainmesh.js';
import { simplifyTerrain } from '../js/terrainlod.js';
import { terrainGpuMesh } from '../js/terrainlighting.js';

// A known plane: maximum slope is at the far edge, not the near cutoff.
const plane=makeRing({place:[0,0,100],sample:()=>0,extent:16000,divisions:128});
const horizon=meshHorizon([plane],{step:1,radius:10000});
assert.ok(horizon.every(a=>a<0));
for(const a of horizon)assert.ok(Math.abs(a-Math.atan((-100-10000**2*.87/(2*6371008.8))/10000)*180/Math.PI)<.0001);
const foreground=terrainForeground({meshes:[plane],metrics:{nearField:100}});
assert.ok(foreground(0)<-40,'Foreground must not paint a distant mountain silhouette');
assert.equal(meshHeightAt(plane,0,0),-100);

// A ridge crossing block boundaries: adaptation preserves its angular shape.
const ridge=makeRing({place:[0,0,90],sample:(lat,lon)=>1000*Math.exp(-(((lat-.08)/.015)**2+((lon-.03)/.025)**2)),extent:16000,divisions:256});
const adapted=simplifyTerrain(ridge),denseProfile=meshHorizon([ridge]),simpleProfile=meshHorizon([adapted]);
const error=Math.max(...denseProfile.map((v,i)=>Math.abs(v-simpleProfile[i])));
assert.ok(error<.006,`Skyline changed by ${error}°`);
assert.ok(adapted.indices.length<ridge.indices.length*.8);
// Every internal edge appears twice; block boundaries have no T-junctions.
const edges=new Map(),p=adapted.positions,n=257;
let area=0;
for(let i=0;i<adapted.indices.length;i+=3){
 const [a,b,c]=adapted.indices.subarray(i,i+3);
 area+=((p[b*3]-p[a*3])*(p[c*3+1]-p[a*3+1])-(p[b*3+1]-p[a*3+1])*(p[c*3]-p[a*3]))/2;
 for(const [u,v]of [[a,b],[b,c],[c,a]]){const key=u<v?`${u},${v}`:`${v},${u}`;edges.set(key,(edges.get(key)||0)+1);}
}
assert.equal(area,32000**2);
for(const [key,count]of edges){const [a,b]=key.split(',').map(Number);if(count===1)assert.ok(a%n===0&&b%n===0||a%n===256&&b%n===256||a<n&&b<n||a>=n*256&&b>=n*256,key);else assert.equal(count,2);}
// Water coastlines cannot be simplified into mixed land/water triangles.
const water={...plane,waterMask:Float32Array.from(plane.waterMask,(_,i)=>i%129<64?1:0)};
const coast=simplifyTerrain(water);
for(let i=0;i<coast.indices.length;i+=3){const ids=coast.indices.subarray(i,i+3);if(ids.some(k=>water.waterMask[k]!==water.waterMask[ids[0]])){
 const xs=Array.from(ids,k=>k%129);assert.ok(Math.max(...xs)-Math.min(...xs)<=1);
}}
// Packing must retain triangle planes and discard unused dense samples.
const packed=terrainGpuMesh(adapted);
assert.ok(packed.vertices.length/10<ridge.positions.length/3*2);
for(let i=0;i<packed.indices.length;i+=3){
 const ids=packed.indices.subarray(i,i+3),pos=Array.from(ids,k=>Array.from(packed.vertices.subarray(k*10,k*10+3)));
 const u=pos[1].map((v,k)=>v-pos[0][k]),v=pos[2].map((v,k)=>v-pos[0][k]);
 const normal=[u[1]*v[2]-u[2]*v[1],u[2]*v[0]-u[0]*v[2],u[0]*v[1]-u[1]*v[0]],length=Math.hypot(...normal);
 for(let k=0;k<3;k++)assert.ok(Math.abs(packed.vertices[ids[2]*10+7+k]-normal[k]/length)<1e-6);
}
console.log(JSON.stringify({status:'passed',denseTriangles:ridge.indices.length/3,adaptiveTriangles:adapted.indices.length/3,maxSkylineErrorDegrees:error}));
