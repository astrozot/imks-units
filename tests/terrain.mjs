import assert from 'node:assert/strict';
import { terrainKey, terrainAppearance } from '../js/skyterrain.js';
import { horizonAt } from '../js/skyhorizon.js';
import { profile, tileSampler, tilesFor, tileXY, destination } from '../js/terrainmodel.js';
import { PANORAMA_RINGS } from '../js/terrainmesh.js';
assert.notEqual(terrainKey([45,10,90]),terrainKey([45,10,92]));
assert.notEqual(terrainKey([45,10,90]),terrainKey([45,10,90.01]));
assert.notEqual(terrainKey([45,10,90]),terrainKey([45.000001,10,90]));
assert.equal(horizonAt([0,10,20,30])(315),15);
assert.equal(horizonAt(new Float32Array(3600).fill(4))(231.7),4);
const settings=terrainAppearance({style:'bad',shadows:false,outlines:'yes',exposure:Infinity,nightExposure:1});
assert.deepEqual(settings,{style:'landcover',waterColor:true,shadows:false,shadowSync:false,outlines:false,peakNames:true,exposure:0,nightExposure:1});
assert.equal(terrainAppearance({style:'natural'}).style,'natural');
const p=await profile({place:[0,0,0],sample:()=>0,rings:[[14,1000]],radius:1000,step:90,startDistance:100});
assert.ok(p.alt.every(v=>v<0),'Negative terrain elevations are retained');
assert.equal(p.eye,2);
// Every vertex of every ring's square must lie in a requested tile. At
// 46.074 N 10.750 E the north-west corner of the 150 km square crosses a
// zoom-10 tile boundary that a flat extent/cos(lat) box missed (2026-11-21).
for(const place of [[46.074,10.75],[46.074,-10.75],[-46.074,10.75],[64,25],[0.1,0.1]]){
 const keys=new Set(tilesFor(place,PANORAMA_RINGS,150000).map(t=>t.join('/')));
 for(const [z,extent] of PANORAMA_RINGS)for(let k=0;k<=200;k++){const t=-extent+2*extent*k/200;
  for(const [x,y] of [[t,-extent],[t,extent],[-extent,t],[extent,t]]){const [fx,fy]=tileXY(...destination(place[0],place[1],Math.atan2(x,y)*180/Math.PI,Math.hypot(x,y)),z);
   assert.ok(keys.has(`${z}/${Math.floor(fx)}/${Math.floor(fy)}`),`Tile missing at ${place} z${z} (${x},${y})`);}}
}
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

// Source tiles are kept between builds: a second build at a nearby place
// downloads only the tiles it lacks; tiles of builds older than the last
// three are pruned, and old tiles are fetched again.
{
 const { terrainTileStore } = await import('../js/terraintiles.js');
 const store = new Map(), cacheStorage = { open: async () => ({
  match: async url => store.get(url)?.clone(), put: async (url, res) => { store.set(url, res); },
  keys: async () => [...store.keys()].map(url => ({ url })), delete: async req => store.delete(req.url) }) };
 let fetched = [], clock = 0;
 const fetchImpl = async url => { fetched.push(url); return url.includes('sea') ? new Response('', { status: 404 }) : url.includes('fail') ? new Response('', { status: 500 }) : new Response(new Blob([url])); };
 const build = async urls => { const s = terrainTileStore({ cacheStorage, fetchImpl, now: () => clock }); fetched = []; const out = []; for (const u of urls) { const r = await s.fetch(u); out.push(r.ok ? await r.text() : r.status); } await s.commit(); return { out, s }; };
 const first = await build(['https://t/1', 'https://t/2', 'https://t/sea', 'https://t/fail']);
 assert.deepEqual(first.out, ['https://t/1', 'https://t/2', 404, 500]);
 const second = await build(['https://t/2', 'https://t/3', 'https://t/sea', 'https://t/fail']);
 assert.deepEqual(fetched, ['https://t/3', 'https://t/fail'], 'Only new tiles (and failures) are downloaded');
 assert.deepEqual(second.out, ['https://t/2', 'https://t/3', 404, 500]);
 assert.equal(second.s.stats.cached, 2);
 await build(['https://t/4']); await build(['https://t/5']);
 assert.ok(!store.has('https://t/1') && store.has('https://t/2') && store.has('https://t/3') && store.has('https://t/5'), 'Tiles of older builds are pruned');
 clock = 61 * 864e5; await build(['https://t/5']);
 assert.deepEqual(fetched, ['https://t/5'], 'Old tiles are fetched again');
 // Without Cache Storage, plain downloads.
 const plain = terrainTileStore({ cacheStorage: null, fetchImpl });
 assert.equal(await (await plain.fetch('https://t/9')).text(), 'https://t/9'); await plain.commit();
 console.log('Terrain tile cache checks passed');
}
