import { TERRAIN_SURFACE_VERSION } from './terrainmesh.js';
// Local terrain lifecycle: exact viewpoint keys, bounded offline surfaces, and
// cancellable worker jobs. A surface is never reused at another eye elevation.
// style: landcover (WorldCover materials), natural (muted earth, by slope) or
// paper (pale relief). shadowSync redraws shadows with every frame of
// playback instead of letting them catch up over a few frames.
export const TERRAIN_DEFAULTS = Object.freeze({ style:'landcover', waterColor:true, shadows:true, shadowSync:false, outlines:false, peakNames:true, exposure:0, nightExposure:0 });
export const TERRAIN_STYLES = Object.freeze(['landcover','natural','paper']);
const PROFILE_KEY='imks-coelum-terrain-profiles-v3', SETTINGS_KEY='imks-coelum-terrain-appearance-v3', DATABASE='imks-terrain-surfaces-v2';
export const terrainKey = place => `${Number(place[0])},${Number(place[1])},${Number.isFinite(place[2])?Number(place[2]):'ground+2'}`;
const readProfiles=()=>{try{return JSON.parse(localStorage.getItem(PROFILE_KEY))||{};}catch{return {};}};
export function storedTerrainHorizon(place){const p=readProfiles()[terrainKey(place)];return p?.alt?.length===3600 && p.alt.every(Number.isFinite)?Float32Array.from(p.alt):null;}
export function terrainAppearance(values=null){
  let saved=values;
  if(!saved)try{
    const current=localStorage.getItem(SETTINGS_KEY);
    if(current)saved=JSON.parse(current);
    // Version 2 had no land-cover style: its natural look had become land cover.
    else if(localStorage.getItem('imks-coelum-terrain-appearance-v2')){saved=JSON.parse(localStorage.getItem('imks-coelum-terrain-appearance-v2'));if(saved?.style==='natural')saved.style='landcover';}
    else{
      const old=JSON.parse(localStorage.getItem('imks-coelum-terrain-appearance')||localStorage.getItem('imks-terrain-lab-appearance-v1')||'null');
      if(old)saved={...old,exposure:Math.max(-2,Math.min(2,(old.exposure??.7)-.7)),nightExposure:Math.max(-2,Math.min(2,(old.nightExposure??2)-2))};
    }
  }catch{}
  const out={...TERRAIN_DEFAULTS};
  for(const [key,def]of Object.entries(out)){
    const value=saved?.[key];
    if(typeof def==='boolean'&&typeof value==='boolean'||key==='style'&&TERRAIN_STYLES.includes(value)||typeof def==='number'&&Number.isFinite(value)&&value>=-2&&value<=2)out[key]=value;
  }
  if(values)try{localStorage.setItem(SETTINGS_KEY,JSON.stringify(out));}catch{}
  return out;
}
function database(){return new Promise((resolve,reject)=>{
  const req=indexedDB.open(DATABASE,2);
  req.onupgradeneeded=()=>{const store=req.result.objectStoreNames.contains('surfaces')?req.transaction.objectStore('surfaces'):req.result.createObjectStore('surfaces',{keyPath:'key'});if(!store.indexNames.contains('used'))store.createIndex('used','time');};
  req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error);req.onblocked=()=>reject(new Error('Terrain storage is busy'));
});}
// iOS can leave IndexedDB requests unanswered (neither success nor error),
// e.g. after many reloads; never wait for storage forever.
const withTimeout=(promise,ms)=>Promise.race([promise,new Promise((_,reject)=>setTimeout(()=>reject(new Error('Terrain storage did not respond')),ms))]);
async function transaction(mode,fn,ms=20000){return withTimeout((async()=>{const db=await database();try{return await new Promise((resolve,reject)=>{
  const tx=db.transaction('surfaces',mode),store=tx.objectStore('surfaces');let result;
  fn(store,value=>{result=value;});tx.oncomplete=()=>resolve(result);tx.onabort=tx.onerror=()=>reject(tx.error||new Error('Terrain storage failed'));
});}finally{db.close();}})(),ms);}
// Last use of each stored surface, for keeping the three most recent. Kept
// apart so that opening a surface never rewrites its tens of megabytes.
const USED_KEY='imks-coelum-terrain-used';
const readUsed=()=>{try{return JSON.parse(localStorage.getItem(USED_KEY))||{};}catch{return {};}};
const touch=key=>{const used=readUsed();used[key]=Date.now();try{localStorage.setItem(USED_KEY,JSON.stringify(used));}catch{}};
// Version 5 surfaces carry per-ring height grids and water level maps, with
// compacted meshes, seen from EYE_HEIGHT above the ground; older ones rebuild.
const validGrid=g=>Number.isInteger(g?.size)&&g.size>0&&g.heights instanceof Uint16Array&&g.heights.length===g.size*g.size&&Number.isFinite(g.extent)&&Number.isFinite(g.scale)&&Number.isFinite(g.offset);
const validWater=w=>w===undefined||Number.isInteger(w?.size)&&w.levels instanceof Float32Array&&w.levels.length===w.size*w.size;
const validCover=c=>c===undefined||Number.isInteger(c?.size)&&c.classes instanceof Uint8Array&&c.classes.length===c.size*c.size;
function validSurface(s){return s?.version===TERRAIN_SURFACE_VERSION&&s.profile instanceof Float32Array&&s.profile.length===3600&&s.profile.every(Number.isFinite)&&Array.isArray(s.meshes)&&s.meshes.length===5&&s.meshes.every(m=>m.positions instanceof Float32Array&&m.positions.length%3===0&&m.indices instanceof Uint32Array&&validGrid(m.grid)&&validWater(m.water)&&validCover(m.cover));}
export async function restoreTerrain(place){
  const key=terrainKey(place);
  try{
    const item=await transaction('readonly',(store,done)=>{const req=store.get(key);req.onsuccess=()=>done(req.result);},10000);
    if(item&&validSurface(item.surface)){touch(key);return item.surface;}
    if(item)await transaction('readwrite',store=>store.delete(key),10000);
  }catch{}
  return null;
}
async function saveSurface(surface){
  try{
    const key=terrainKey(surface.place);touch(key);
    await transaction('readwrite',(store)=>{
      store.put({key,time:Date.now(),surface:{...surface,persisted:true}});
      const used=readUsed(),req=store.getAllKeys();
      req.onsuccess=()=>{for(const old of req.result.sort((a,b)=>(used[b]||0)-(used[a]||0)).slice(3))store.delete(old);};
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
    worker.onmessage=({data})=>{if(data.type==='progress')progress(data.text,data.fraction);else if(data.type==='error')finish(reject,new Error(data.text));else if(data.type==='ready'){
      // A service-worker update while the page is open serves the new worker
      // to the old page (or the reverse): say so instead of "invalid".
      if(data.surface?.version!==TERRAIN_SURFACE_VERSION)finish(reject,Object.assign(new Error('Coelum was updated while open. Close and reopen it (or reload the page), then download the terrain again'),{code:'app-updated'}));
      else if(!validSurface(data.surface))finish(reject,new Error('Invalid terrain surface'));else finish(resolve,data.surface);}};
    worker.postMessage({place:[...place]});
  });
  if(signal?.aborted)throw new DOMException('Terrain cancelled','AbortError');
  progress('Saving terrain for offline use…',.99);await saveSurface(surface);
  if(signal?.aborted)throw new DOMException('Terrain cancelled','AbortError');
  return surface;
}
