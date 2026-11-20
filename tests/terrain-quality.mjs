import assert from 'node:assert/strict';
import { makeRing, makeGrid, packGrid, compactMesh, GRID_MISSING, meshHeightAt, meshHorizon, terrainForeground } from '../js/terrainmesh.js';
import { waterLevels } from '../js/terrainwater.js';
import { resampleGrid, tileSampler, tileXY } from '../js/terrainmodel.js';
import { simplifyTerrainRTIN } from '../js/terrainlod.js';
import { terrainGpuMesh } from '../js/terrainlighting.js';

// A known plane: maximum slope is at the far edge, not the near cutoff.
const plane=makeRing({place:[0,0,100],sample:()=>0,extent:16000,divisions:128});
const horizon=meshHorizon([plane],{step:1,radius:10000});
assert.ok(horizon.every(a=>a<0));
for(const a of horizon)assert.ok(Math.abs(a-Math.atan((-100-10000**2*.87/(2*6371008.8))/10000)*180/Math.PI)<.0001);
const foreground=terrainForeground({meshes:[plane],metrics:{nearField:100}});
assert.ok(foreground(0)<-40,'Foreground must not paint a distant mountain silhouette');
// Stored (compacted) meshes take the foreground from the height grid instead.
const gridded=makeRing({place:[0,0,100],sample:()=>0,extent:1000,divisions:16,gridSize:64}),fromGrid=terrainForeground({meshes:[{...gridded,positions:new Float32Array(0)}],metrics:{nearField:100}});
assert.ok(Math.abs(fromGrid(90)-Math.atan2(-100,100)*180/Math.PI)<.01);
assert.equal(meshHeightAt(plane,0,0),-100);

// A ridge crossing the hollow ring: RTIN keeps its angular shape, covers the
// ring exactly once, and has no T-junctions (each interior edge used twice).
const ridge=makeRing({place:[0,0,90],sample:(lat,lon)=>1000*Math.exp(-(((lat-.08)/.015)**2+((lon-.03)/.025)**2)),extent:16000,inner:4000,divisions:256});
const adapted=simplifyTerrainRTIN(ridge,{angularError:.005}),denseProfile=meshHorizon([ridge]),simpleProfile=meshHorizon([adapted]);
const error=Math.max(...denseProfile.map((v,i)=>Math.abs(v-simpleProfile[i])));
assert.ok(error<.006,`Skyline changed by ${error}°`);
assert.ok(adapted.indices.length<ridge.indices.length*.5);
const edges=new Map(),p=adapted.positions,n=257,lo=96,hi=160;
let area=0;
for(let i=0;i<adapted.indices.length;i+=3){
 const [a,b,c]=adapted.indices.subarray(i,i+3);
 area+=((p[b*3]-p[a*3])*(p[c*3+1]-p[a*3+1])-(p[b*3+1]-p[a*3+1])*(p[c*3]-p[a*3]))/2;
 for(const [u,v]of [[a,b],[b,c],[c,a]]){const key=u<v?`${u},${v}`:`${v},${u}`;edges.set(key,(edges.get(key)||0)+1);}
}
assert.equal(area,32000**2-8000**2);
const onBoundary=k=>{const i=k%n,j=(k-i)/n;return i===0||j===0||i===n-1||j===n-1||(i===lo||i===hi)&&j>=lo&&j<=hi||(j===lo||j===hi)&&i>=lo&&i<=hi;};
for(const [key,count]of edges){const [a,b]=key.split(',').map(Number);if(count===1)assert.ok(onBoundary(a)&&onBoundary(b),key);else assert.equal(count,2);}
// Compaction keeps exactly the referenced vertices and the same triangles.
const compact=compactMesh(adapted);
assert.equal(compact.indices.length,adapted.indices.length);
assert.ok(compact.positions.length<adapted.positions.length);
for(let i=0;i<compact.indices.length;i+=97)for(let a=0;a<3;a++)assert.equal(compact.positions[compact.indices[i]*3+a],adapted.positions[adapted.indices[i]*3+a]);
// Packing keeps positions and water flags, and discards unused dense samples.
const packed=terrainGpuMesh(adapted);
assert.ok(packed.vertices.length/3<ridge.positions.length/3);
for(let i=0;i<packed.indices.length;i++){const k=packed.indices[i],j=adapted.indices[i];for(let a=0;a<3;a++)assert.equal(packed.vertices[k*3+a],adapted.positions[j*3+a]);}
// Height grids: centimetre quantisation, missing data kept explicit.
const grid=packGrid(Float32Array.from([-12.5,0,NaN,1830.25]),10,2);
assert.equal(grid.heights[2],GRID_MISSING);
for(const [i,v] of [[0,-12.5],[1,0],[3,1830.25]])assert.ok(Math.abs(grid.heights[i]*grid.scale+grid.offset-v)<=grid.scale/2+1e-9);
assert.ok(grid.scale<.03);
// The fast tile resampler agrees with exact per-texel geodesy.
const place=[45.88,10.84,0],z=12,P=512,tiles=new Map(),[cx,cy]=tileXY(place[0],place[1],z);
for(let ty=Math.floor(cy)-2;ty<=Math.floor(cy)+2;ty++)for(let tx=Math.floor(cx)-2;tx<=Math.floor(cx)+2;tx++){
 const h=new Float32Array(P*P);for(let j=0;j<P;j++)for(let i=0;i<P;i++)h[j*P+i]=1000+300*Math.sin((tx*P+i+.5)/40)+200*Math.cos((ty*P+j+.5)/55);
 tiles.set(`${z}/${tx}/${ty}`,{size:P,h,noData:-1});
}
const fast=resampleGrid({tiles,place,zoom:z,extent:8000,size:256,eye:0}),exact=makeGrid({place,sample:tileSampler(tiles),extent:8000,size:256,zoom:z});
let resampleError=0;for(let i=0;i<fast.length;i++)resampleError=Math.max(resampleError,Math.abs(fast[i]-(exact.heights[i]*exact.scale+exact.offset)));
// The surface changes by up to 7.5 m per source pixel: 0.075 m is 0.01 pixel.
assert.ok(resampleError<.075,`Resampled grid differs by ${resampleError} m`);
// Rings carry a grid aligned with their own extent when requested.
const withGrid=makeRing({place:[0,0,100],sample:()=>50,extent:1000,divisions:8,gridSize:16});
assert.equal(withGrid.grid.size,16);assert.ok(withGrid.grid.heights.every(h=>Math.abs(h*withGrid.grid.scale+withGrid.grid.offset+50)<.01));
// Water levels come from the DEM, not the outline: a flat lake gets its level
// (beyond its outline too, within the margin); a lake that is not level in the
// DEM gets none, and land far from any outline gets none.
const metres=111194.9,lake={},hilly={};
const body=(lat,lon)=>{const x=lon*metres,y=lat*metres;return x>-500&&x<500&&y>-1500&&y<-500?lake:x>-500&&x<500&&y>500&&y<1500?hilly:null;};
const terrain=(lat,lon)=>{const x=lon*metres,y=lat*metres;return y<-400&&x>-700&&x<700?10:y>500&&y<1500&&x>-500&&x<500?20+((x+y)%37+37)%37:30+Math.abs(x)/50;};
const waterGrid=makeGrid({place:[0,0,0],sample:terrain,extent:2000,size:128});
const {maps,metrics}=waterLevels({water:{body},place:[0,0,0],eye:0,grids:[waterGrid],size:64,margin:300});
const levelAt=(x,y)=>maps[0].levels[Math.floor((y+2000)/4000*64)*64+Math.floor((x+2000)/4000*64)];
assert.equal(metrics.find(m=>m.level!==null)?.level,10);
assert.equal(levelAt(0,-1000),10);assert.equal(levelAt(600,-1000),10,'The level extends past the coarse outline');
assert.ok(Number.isNaN(levelAt(0,1000)),'A lake that is not level in the DEM gets no water');
assert.ok(Number.isNaN(levelAt(-1800,1800)),'Land away from water has no level');
console.log(JSON.stringify({status:'passed',denseTriangles:ridge.indices.length/3,adaptiveTriangles:adapted.indices.length/3,maxSkylineErrorDegrees:error,resampleError}));
