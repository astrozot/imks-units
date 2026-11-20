// Local terrain lifecycle: exact viewpoint keys, bounded offline surfaces, and
// cancellable worker jobs. A surface is never reused at another eye elevation.
export const TERRAIN_DEFAULTS = Object.freeze({ style:'natural', waterColor:true, shadows:true, outlines:false, exposure:0, nightExposure:0 });
const PROFILE_KEY='imks-coelum-terrain-profiles-v2', SETTINGS_KEY='imks-coelum-terrain-appearance-v2', DATABASE='imks-terrain-surfaces-v2';
export const terrainKey = place => `${Number(place[0])},${Number(place[1])},${Number.isFinite(place[2])?Number(place[2]):'ground+2'}`;
const readProfiles=()=>{try{return JSON.parse(localStorage.getItem(PROFILE_KEY))||{};}catch{return {};}};
export function storedTerrainHorizon(place){const p=readProfiles()[terrainKey(place)];return p?.alt?.length===3600 && p.alt.every(Number.isFinite)?Float32Array.from(p.alt):null;}
export function terrainAppearance(values=null){
  let saved=values;
  if(!saved)try{
    const current=localStorage.getItem(SETTINGS_KEY);
    if(current)saved=JSON.parse(current);
    else{
      const old=JSON.parse(localStorage.getItem('imks-coelum-terrain-appearance')||localStorage.getItem('imks-terrain-lab-appearance-v1')||'null');
      if(old)saved={...old,exposure:Math.max(-2,Math.min(2,(old.exposure??.7)-.7)),nightExposure:Math.max(-2,Math.min(2,(old.nightExposure??2)-2))};
    }
  }catch{}
  const out={...TERRAIN_DEFAULTS};
  for(const [key,def]of Object.entries(out)){
    const value=saved?.[key];
    if(typeof def==='boolean'&&typeof value==='boolean'||key==='style'&&['natural','paper'].includes(value)||typeof def==='number'&&Number.isFinite(value)&&value>=-2&&value<=2)out[key]=value;
  }
  if(values)try{localStorage.setItem(SETTINGS_KEY,JSON.stringify(out));}catch{}
  return out;
}
function database(){return new Promise((resolve,reject)=>{
  const req=indexedDB.open(DATABASE,2);
  req.onupgradeneeded=()=>{const store=req.result.objectStoreNames.contains('surfaces')?req.transaction.objectStore('surfaces'):req.result.createObjectStore('surfaces',{keyPath:'key'});if(!store.indexNames.contains('used'))store.createIndex('used','time');};
  req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error);req.onblocked=()=>reject(new Error('Terrain storage is busy'));
});}
async function transaction(mode,fn){const db=await database();try{return await new Promise((resolve,reject)=>{
  const tx=db.transaction('surfaces',mode),store=tx.objectStore('surfaces');let result;
  fn(store,value=>{result=value;});tx.oncomplete=()=>resolve(result);tx.onabort=tx.onerror=()=>reject(tx.error||new Error('Terrain storage failed'));
});}finally{db.close();}}
// Version 4 surfaces carry per-ring height grids and water level maps, with
// compacted meshes; older ones are rebuilt.
const validGrid=g=>Number.isInteger(g?.size)&&g.size>0&&g.heights instanceof Uint16Array&&g.heights.length===g.size*g.size&&Number.isFinite(g.extent)&&Number.isFinite(g.scale)&&Number.isFinite(g.offset);
const validWater=w=>w===undefined||Number.isInteger(w?.size)&&w.levels instanceof Float32Array&&w.levels.length===w.size*w.size;
function validSurface(s){return s?.version===4&&s.profile instanceof Float32Array&&s.profile.length===3600&&s.profile.every(Number.isFinite)&&Array.isArray(s.meshes)&&s.meshes.length===5&&s.meshes.every(m=>m.positions instanceof Float32Array&&m.positions.length%3===0&&m.indices instanceof Uint32Array&&validGrid(m.grid)&&validWater(m.water));}
export async function restoreTerrain(place){
  try{return (await transaction('readwrite',(store,done)=>{const req=store.get(terrainKey(place));req.onsuccess=()=>{const item=req.result;if(item&&validSurface(item.surface)){item.time=Date.now();store.put(item);done(item.surface);}else if(item)store.delete(item.key);};})) || null;}catch{return null;}
}
async function saveSurface(surface){
  try{
    await transaction('readwrite',(store)=>{
      store.put({key:terrainKey(surface.place),time:Date.now(),surface:{...surface,persisted:true}});
      let count=0;const req=store.index('used').openKeyCursor(null,'prev');req.onsuccess=()=>{const cursor=req.result;if(!cursor)return;if(++count>3)store.delete(cursor.primaryKey);cursor.continue();};
    });surface.persisted=true;
  }catch{surface.persisted=false;}
  const all=readProfiles();all[terrainKey(surface.place)]={time:Date.now(),alt:Array.from(surface.profile),eye:surface.eye};
  for(const key of Object.keys(all).sort((a,b)=>all[b].time-all[a].time).slice(12))delete all[key];
  try{localStorage.setItem(PROFILE_KEY,JSON.stringify(all));}catch{}
}
export async function forgetTerrain(place){
  const all=readProfiles();delete all[terrainKey(place)];try{localStorage.setItem(PROFILE_KEY,JSON.stringify(all));}catch{}
  try{await transaction('readwrite',store=>store.delete(terrainKey(place)));}catch{}
}
export async function prepareTerrain(place,{signal,progress=()=>{},refresh=false}={}){
  if(!Number.isFinite(place[0])||Math.abs(place[0])>80||!Number.isFinite(place[1])||Math.abs(place[1])>180)throw new Error('Local terrain supports latitudes between 80° S and 80° N');
  if(signal?.aborted)throw new DOMException('Terrain cancelled','AbortError');
  if(!refresh){const cached=await restoreTerrain(place);if(signal?.aborted)throw new DOMException('Terrain cancelled','AbortError');if(cached)return cached;}
  const surface=await new Promise((resolve,reject)=>{
    const worker=new Worker(new URL('./terrainworker.js',import.meta.url),{type:'module'});
    const finish=(fn,value)=>{worker.terminate();signal?.removeEventListener('abort',abort);fn(value);};
    const abort=()=>finish(reject,new DOMException('Terrain cancelled','AbortError'));
    signal?.addEventListener('abort',abort,{once:true});
    worker.onerror=e=>finish(reject,new Error(e.message||'Terrain computation failed'));
    worker.onmessage=({data})=>{if(data.type==='progress')progress(data.text,data.fraction);else if(data.type==='error')finish(reject,new Error(data.text));else if(data.type==='ready'){if(!validSurface(data.surface))finish(reject,new Error('Invalid terrain surface'));else finish(resolve,data.surface);}};
    worker.postMessage({place:[...place]});
  });
  if(signal?.aborted)throw new DOMException('Terrain cancelled','AbortError');
  progress('Saving terrain for offline use…',.99);await saveSurface(surface);
  if(signal?.aborted)throw new DOMException('Terrain cancelled','AbortError');
  return surface;
}
