import {makeGrid} from '../js/terrainmesh.js';
import {tileSampler} from '../js/terrainmodel.js';
export async function rivaAtmosphereGrids(place,path){
 const base='/'+path.replace(/^\/+|\/+$/g,''),jobs=await(await fetch(base+'/tile-index.json')).json(),tiles=new Map();
 await Promise.all(jobs.map(async([z,x,y])=>{
  const b=await createImageBitmap(await(await fetch(`${base}/tiles/${z}-${x}-${y}.webp`)).blob(),{colorSpaceConversion:'none',premultiplyAlpha:'none'}),c=new OffscreenCanvas(512,512),g=c.getContext('2d');g.drawImage(b,0,0);b.close();const p=g.getImageData(0,0,512,512).data,h=new Float32Array(512*512);
  for(let i=0;i<h.length;i++)h[i]=p[i*4+3]?p[i*4]*256+p[i*4+1]+p[i*4+2]/256-32768:NaN;
  tiles.set(`${z}/${x}/${y}`,{size:512,h,noData:NaN});
 }));
 const sample=tileSampler(tiles,false,true);return [4000,16000,60000].map(extent=>makeGrid({place,sample,extent,size:512,zoom:14}));
}
