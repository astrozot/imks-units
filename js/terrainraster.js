// Transparent mountain overlay, composited at the sky's existing ground pass.
// The unchanged sky raster remains the fallback when WebGL is unavailable.
import { createTerrainRenderer } from './terrainrender.js';
import { moonFlux } from './terrainmesh.js';
import { terrainExposure } from './terrainlighting.js';
import { terrainAppearance } from './skyterrain.js';
const renderers=new WeakMap();
// Diagnostics (?perf): GPU-synchronised timings of the latest terrain frame.
export const terrainStats={profile:false,last:null};
export function releaseTerrainRaster(ctx){const entry=renderers.get(ctx);entry?.renderer?.destroy();renderers.delete(ctx);}
export function terrainRaster(ctx,surface,{W,H,radius,rotation,sun,moon,lightingSunAlt=sun.alt,solarFlux=1,appearance=null,onRedraw=null}){
  if(!surface)return null;
  let entry=renderers.get(ctx);
  if(!entry){
    const canvas=document.createElement('canvas');
    try{entry={canvas,renderer:createTerrainRenderer(canvas),surface:null};}catch{return null;}
    renderers.set(ctx,entry);
    canvas.addEventListener('webglcontextlost',e=>e.preventDefault());
    canvas.addEventListener('webglcontextrestored',()=>{releaseTerrainRaster(ctx);onRedraw?.();});
  }
  if(entry.canvas.getContext('webgl2').isContextLost())return null;
  try{
    if(entry.surface!==surface){entry.renderer.setMeshes(surface.meshes);entry.surface=surface;}
    const preferences=appearance||terrainAppearance(),night=sun.alt < -6;
    const sine=Math.max(0,Math.sin((moon?.alt??-90)*Math.PI/180)),airmass=1/(sine+.025*Math.exp(-11*sine));
    const flux=moon?moonFlux(moon.phase??180,moon.dist)*10**(-.4*.22*Math.max(0,airmass-1)):0;
    const result=entry.renderer.draw({W,H,radius,rotation,sun,lightingSunAlt,solarFlux,moon:moon||{az:0,alt:-90},flux,paper:preferences.style==='paper',waterColor:preferences.waterColor,shadows:preferences.shadows,outlines:preferences.outlines,exposure:terrainExposure(preferences[night?'nightExposure':'exposure'],night),nearField:100,profile:terrainStats.profile,progressive:true});
    terrainStats.last=result;
    // Unfinished shadow bands need one more frame, unless the app draws anyway
    // (playback, gestures). Check after all of the next frame's callbacks have
    // run: the app's own may come after this one, and must not be doubled.
    const count=entry.frames=(entry.frames||0)+1;
    if(result?.shadowsPending&&!entry.waiting){entry.waiting=true;requestAnimationFrame(()=>setTimeout(()=>{entry.waiting=false;if(entry.frames===count&&renderers.get(ctx)===entry)onRedraw?.();},0));}
    return result;
  }catch(e){console.warn('Terrain surface fallback:',e.message);releaseTerrainRaster(ctx);return null;}
}
