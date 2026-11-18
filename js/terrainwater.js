// General water polygons, tiled from Natural Earth. No location-specific data
// or assumed lake levels: this changes material only, never the DEM geometry.
const normalLon=lon=>((lon+180)%360+360)%360-180;
function decodePolygon(encoded){
 const rings=encoded.map(flat=>{const out=new Int32Array(flat.length);let x=0,y=0;for(let i=0;i<flat.length;i+=2){x+=flat[i];y+=flat[i+1];out[i]=x;out[i+1]=y;}return out;});
 let left=Infinity,bottom=Infinity,right=-Infinity,top=-Infinity;
 for(let i=0;i<rings[0].length;i+=2){left=Math.min(left,rings[0][i]);right=Math.max(right,rings[0][i]);bottom=Math.min(bottom,rings[0][i+1]);top=Math.max(top,rings[0][i+1]);}
 return {rings,left,bottom,right,top};
}
function insideRing(x,y,ring){let hit=false;for(let i=0,j=ring.length-2;i<ring.length;j=i,i+=2){const a=ring[i],b=ring[i+1],c=ring[j],d=ring[j+1];if((b>y)!==(d>y)&&x<(c-a)*(y-b)/(d-b)+a)hit=!hit;}return hit;}
function contains(x,y,polygons){for(const p of polygons)if(x>=p.left&&x<=p.right&&y>=p.bottom&&y<=p.top&&insideRing(x,y,p.rings[0])&&!p.rings.slice(1).some(r=>insideRing(x,y,r)))return true;return false;}
export function createWaterMask(manifest,tiles){
 const size=manifest.tileSize,q=1/manifest.quantum;
 return {at(lat,longitude,height=0){
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
