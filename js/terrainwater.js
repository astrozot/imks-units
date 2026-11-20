// General water polygons, tiled from Natural Earth. No location-specific data
// or assumed lake levels: this changes material only, never the DEM geometry.
// The 1:10 million outlines are far coarser than the DEM, so they only mark
// where to look: each lake's level comes from its own flat DEM surface, and
// the drawn shoreline is the DEM contour at that level (see waterLevels).
import { destination } from './terrainmodel.js';
const normalLon=lon=>((lon+180)%360+360)%360-180;
function decodePolygon(encoded){
 const rings=encoded.map(flat=>{const out=new Int32Array(flat.length);let x=0,y=0;for(let i=0;i<flat.length;i+=2){x+=flat[i];y+=flat[i+1];out[i]=x;out[i+1]=y;}return out;});
 let left=Infinity,bottom=Infinity,right=-Infinity,top=-Infinity;
 for(let i=0;i<rings[0].length;i+=2){left=Math.min(left,rings[0][i]);right=Math.max(right,rings[0][i]);bottom=Math.min(bottom,rings[0][i+1]);top=Math.max(top,rings[0][i+1]);}
 return {rings,left,bottom,right,top};
}
function insideRing(x,y,ring){let hit=false;for(let i=0,j=ring.length-2;i<ring.length;j=i,i+=2){const a=ring[i],b=ring[i+1],c=ring[j],d=ring[j+1];if((b>y)!==(d>y)&&x<(c-a)*(y-b)/(d-b)+a)hit=!hit;}return hit;}
function containing(x,y,polygons){for(const p of polygons)if(x>=p.left&&x<=p.right&&y>=p.bottom&&y<=p.top&&insideRing(x,y,p.rings[0])&&!p.rings.slice(1).some(r=>insideRing(x,y,r)))return p;return null;}
const contains=(x,y,polygons)=>!!containing(x,y,polygons);
export function createWaterMask(manifest,tiles){
 const size=manifest.tileSize,q=1/manifest.quantum;
 // The water body itself: a lake polygon (the same object for every point of
 // that lake), 'ocean', or null. No height test: levels are found separately.
 function body(lat,longitude){
   const lon=normalLon(longitude),x=Math.floor((lon+180)/size),y=Math.floor((lat-manifest.south)/size),key=`${x}_${y}`;
   const kind=manifest.tiles[key];if(!kind)return null;
   if(kind==='o')return 'ocean';
   const tile=tiles.get(key);if(!tile)return null;
   const px=(lon-(-180+x*size))*q,py=(lat-(manifest.south+y*size))*q;
   return containing(px,py,tile.l)||(contains(px,py,tile.o)?'ocean':null);
 }
 return {body,at(lat,longitude,height=0){
   const lon=normalLon(longitude),x=Math.floor((lon+180)/size),y=Math.floor((lat-manifest.south)/size),key=`${x}_${y}`;
   const kind=manifest.tiles[key];if(!kind)return null;
   const ocean=()=>Math.abs(height)<=2?'ocean':null;
   if(kind==='o')return ocean();
   const tile=tiles.get(key);if(!tile)return null;
   const px=(lon-(-180+x*size))*q,py=(lat-(manifest.south+y*size))*q;
   if(contains(px,py,tile.l))return 'lake';
   return contains(px,py,tile.o)?ocean():null;
 }};
}
export async function loadWaterMask(place,{radius=150000,progress=()=>{}}={}){
 const root=new URL('../data/water/',import.meta.url),res=await fetch(new URL('index.json',root));
 if(!res.ok)throw new Error(`Water index HTTP ${res.status}`);
 const manifest=await res.json(),size=manifest.tileSize,tiles=new Map(),missing=[],jobs=[];
 if(manifest.version!==1)throw new Error('Unsupported water polygons');
 const dy=radius/110000+.02,cos=Math.cos(Math.min(84.9,Math.abs(place[0])+dy)*Math.PI/180),dx=Math.min(180,radius/(110000*cos)+.02);
 const x0=Math.floor((place[1]-dx+180)/size),x1=Math.floor((place[1]+dx+180)/size),y0=Math.max(0,Math.floor((place[0]-dy-manifest.south)/size)),y1=Math.min((manifest.north-manifest.south)/size-1,Math.floor((place[0]+dy-manifest.south)/size)),nx=360/size;
 const keys=new Set();
 for(let x=x0;x<=x1;x++)for(let y=y0;y<=y1;y++){const key=`${(x%nx+nx)%nx}_${y}`;if(manifest.tiles[key]==='p')keys.add(key);}
 jobs.push(...keys);let done=0,bytes=0;
 await Promise.all(Array.from({length:Math.min(4,jobs.length)},async()=>{while(jobs.length){const key=jobs.shift();try{const r=await fetch(new URL(key+'.json',root));if(!r.ok)throw new Error(`HTTP ${r.status}`);const text=await r.text();bytes+=text.length;const d=JSON.parse(text);tiles.set(key,{o:d.o.map(decodePolygon),l:d.l.map(decodePolygon)});}catch{missing.push(key);}progress(`Loading water polygons… ${++done}/${keys.size}`);}}));
 return {mask:createWaterMask(manifest,tiles),metrics:{model:manifest.model,attribution:manifest.attribution,sourceScale:manifest.sourceScale,license:manifest.license,sources:manifest.sources,files:tiles.size,bytes,missing}};
}
// Exported for fixture-based tests of polygon holes and sea-level guards.
export const decodeWaterTile=d=>({o:d.o.map(decodePolygon),l:d.l.map(decodePolygon)});

// Per-ring water level maps. Each lake's level is the most common DEM height
// inside its outline (lake surfaces are flattened in the DEM: Garda is exactly
// 65.00 m); a lake whose surface is not flat at one level is ignored rather
// than painted as contour stripes. The sea is at height 0. Each body's search
// region is the outline grown by `margin` metres, assigned to the nearest body.
// levels: heights relative to the eye, NaN where no water is expected.
export const WATER_TOLERANCE = 0.3;
export function waterLevels({ water, place, eye, grids, size = 256, margin = 300, flatness = 0.25 }) {
  const registry = new Map(), samples = [];
  const id = b => { if (!registry.has(b)) { registry.set(b, registry.size); samples.push(new Map()); } return registry.get(b); };
  // Classify cell centres and collect each body's heights (0.25 m bins).
  const rings = grids.map(grid => {
    const cell = grid.extent * 2 / size, ids = new Int32Array(size * size).fill(-1), heights = new Float32Array(size * size);
    for (let j = 0; j < size; j++) for (let i = 0; i < size; i++) {
      const x = -grid.extent + (i + .5) * cell, y = -grid.extent + (j + .5) * cell, k = j * size + i;
      const ti = Math.min(grid.size - 1, Math.floor((i + .5) / size * grid.size)), tj = Math.min(grid.size - 1, Math.floor((j + .5) / size * grid.size)), raw = grid.heights[tj * grid.size + ti];
      heights[k] = raw === 65535 ? NaN : raw * grid.scale + grid.offset;
      const b = water.body(...destination(place[0], place[1], Math.atan2(x, y) * 180 / Math.PI, Math.hypot(x, y)));
      if (!b) continue;
      ids[k] = id(b);
      if (Number.isFinite(heights[k])) { const bin = Math.round(heights[k] * 4) / 4, m = samples[ids[k]]; m.set(bin, (m.get(bin) || 0) + 1); }
    }
    return { grid, cell, ids, heights };
  });
  const bodies = [...registry.keys()], levels = bodies.map((b, n) => {
    if (b === 'ocean') return -eye;
    let best = null, count = 0, total = 0;
    for (const [bin, c] of samples[n]) { total += c; if (c > count) { count = c; best = bin; } }
    if (best === null) return NaN;
    let near = 0; for (const [bin, c] of samples[n]) if (Math.abs(bin - best) <= WATER_TOLERANCE + .25) near += c;
    return near >= total * flatness ? best : NaN;
  });
  const metrics = bodies.map((b, n) => ({ kind: b === 'ocean' ? 'ocean' : 'lake', level: Number.isFinite(levels[n]) ? levels[n] + eye : null, cells: [...samples[n].values()].reduce((s, c) => s + c, 0) }));
  // Grow each region by `margin`, nearest body first (breadth-first).
  const maps = rings.map(({ grid, cell, ids }) => {
    const steps = Math.max(1, Math.ceil(margin / cell)), owner = Int32Array.from(ids);
    let front = []; for (let k = 0; k < owner.length; k++) if (owner[k] >= 0) front.push(k);
    for (let s = 0; s < steps && front.length; s++) {
      const next = [];
      for (const k of front) { const i = k % size, j = (k - i) / size;
        for (const [di, dj] of [[1,0],[-1,0],[0,1],[0,-1]]) { const a = i + di, b = j + dj; if (a < 0 || b < 0 || a >= size || b >= size) continue; const m = b * size + a; if (owner[m] < 0) { owner[m] = owner[k]; next.push(m); } } }
      front = next;
    }
    const out = new Float32Array(size * size);
    for (let k = 0; k < out.length; k++) out[k] = owner[k] >= 0 ? levels[owner[k]] : NaN;
    return { size, extent: grid.extent, levels: out };
  });
  return { maps, metrics };
}
