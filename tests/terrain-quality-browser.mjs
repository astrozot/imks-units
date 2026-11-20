// Deterministic silhouette/coverage regressions; optional cached real DEM
// comparison uses TERRAIN_CACHE and TERRAIN_BASELINE (a previous js/ directory).
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('../',import.meta.url));
let browserType;
for(const name of [process.env.PLAYWRIGHT&&path.join(process.env.PLAYWRIGHT,'index.mjs'),'playwright-core','playwright'].filter(Boolean))try{browserType=(await import(name))[process.env.TERRAIN_BROWSER||'chromium'];break;}catch{}
if(!browserType)throw new Error('Playwright required');
const server=http.createServer(async(req,res)=>{
 try{
  const url=new URL(req.url,'http://localhost');
  const tile=/^\/cached\/(\d+)\/(\d+)\/(\d+)\.webp$/.exec(url.pathname);
  if(tile&&process.env.TERRAIN_CACHE){const bytes=await fs.readFile(path.join(process.env.TERRAIN_CACHE,`mapterhorn-${tile[1]}-${tile[2]}-${tile[3]}`));res.setHeader('content-type','image/webp');res.end(bytes);return;}
  if(url.pathname==='/'){res.setHeader('content-type','text/html');res.end('<!doctype html><body style="margin:0;background:#ddd"></body>');return;}
  const baseline=url.pathname.startsWith('/baseline/');
  const base=baseline?process.env.TERRAIN_BASELINE:root;
  if(!base)throw new Error('No baseline');
  const name=path.resolve(base,baseline?url.pathname.slice(10):url.pathname.slice(1));
  if(!name.startsWith(path.resolve(base)+path.sep))throw new Error('Invalid path');
  let bytes=await fs.readFile(name);
  if(name.endsWith('terrainmodel.js')&&process.env.TERRAIN_CACHE)bytes=Buffer.from(bytes.toString().replace('https://tiles.mapterhorn.com/',`http://127.0.0.1:${server.address().port}/cached/`));
  res.setHeader('content-type',name.endsWith('.js')?'text/javascript':name.endsWith('.json')?'application/json':'application/octet-stream');res.end(bytes);
 }catch{res.writeHead(404);res.end();}
});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const browser=await browserType.launch(process.env.CHROME?{executablePath:process.env.CHROME}:{}),output=process.env.TERRAIN_RESULTS;
try{
 if(output)await fs.mkdir(output,{recursive:true});
 const context=await browser.newContext({viewport:{width:900,height:600},deviceScaleFactor:1});
 // No third-party traffic, including in the optional real-data comparison.
 let tiles=0;const absent=[];
 await context.route('https://**',async route=>{
  const match=/^https:\/\/tiles.mapterhorn.com\/(\d+)\/(\d+)\/(\d+)\.webp$/.exec(route.request().url());
  if(match&&process.env.TERRAIN_CACHE){
   const name=`mapterhorn-${match[1]}-${match[2]}-${match[3]}`;
   try{const body=await fs.readFile(path.join(process.env.TERRAIN_CACHE,name));tiles++;await route.fulfill({contentType:'image/webp',headers:{'access-control-allow-origin':'*'},body});return;}catch{absent.push(name);}
  }
  await route.abort();
 });
 const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto(`http://127.0.0.1:${server.address().port}/`);
 const synthetic=await page.evaluate(async()=>{
  const {makeRing}=await import('/js/terrainmesh.js'),{createTerrainRenderer}=await import('/js/terrainrender.js');
  const {skyFrame,lookAt}=await import('/js/coelum.js'),{skyScene}=await import('/js/coelumsky.js');
  const mesh=makeRing({place:[0,0,90],sample:(lat,lon)=>1200*Math.exp(-(((lat-.08)/.015)**2+(lon/.03)**2)),extent:16000,divisions:256,gridSize:256});
  const surface={meshes:[mesh],metrics:{nearField:100}},frame=skyFrame(Date.parse('2026-06-21T12:00Z')/1000,[0,0,90]);
  const canvas=document.createElement('canvas');canvas.width=900;canvas.height=600;document.body.append(canvas);
  const ctx=canvas.getContext('2d'),view={az:0,alt:10,scale:4},layers={ground:true,horizon:'terrain',terrain:()=>15,terrainSurface:surface,terrainAppearance:{style:'natural',shadows:false,outlines:false,waterColor:true,exposure:0,nightExposure:0},milkyway:false,labels:false,satellites:false};
  // Deliberately disagreeing legacy profile. The centre is sky, above the
  // physical ridge but below that profile. It must remain identical to sky.
  skyScene(frame,900,600,{...layers,ground:false},view,ctx);const sky=Array.from(ctx.getImageData(450,300,1,1).data);
  skyScene(frame,900,600,layers,view,ctx);const composite=Array.from(ctx.getImageData(450,300,1,1).data);
  const silhouette={sky,composite};
  const options={W:700,H:400,radius:2000,rotation:lookAt(0,7),sun:{az:180,alt:40},moon:{az:0,alt:-90},flux:0,exposure:1.6,shadows:false};
  const coverage=[];
  for(const antialias of [false,true]){
   const c=document.createElement('canvas'),r=createTerrainRenderer(c,{antialias});r.setMeshes([mesh]);
   const info=r.draw(options),gl=c.getContext('webgl2'),pixels=new Uint8Array(c.width*c.height*4);gl.readPixels(0,0,c.width,c.height,gl.RGBA,gl.UNSIGNED_BYTE,pixels);
   let partial=0,opaque=0,partialLight=0,opaqueLight=0;
   for(let i=0;i<pixels.length;i+=4){const a=pixels[i+3];if(a>0&&a<255){partial++;partialLight+=pixels[i]+pixels[i+1]+pixels[i+2];}if(a===255){opaque++;opaqueLight+=pixels[i]+pixels[i+1]+pixels[i+2];}}
   coverage.push({antialias,partial,opaque,partialMean:partialLight/partial/3,opaqueMean:opaqueLight/opaque/3,error:gl.getError()});r.destroy();
  }
  const c=document.createElement('canvas'),r=createTerrainRenderer(c);r.setMeshes([mesh]);
  const gl=c.getContext('webgl2'),culling=[];
  const pixels=()=>{const p=new Uint8Array(c.width*c.height*4);gl.readPixels(0,0,c.width,c.height,gl.RGBA,gl.UNSIGNED_BYTE,p);return p;};
  for(const [az,alt,radius] of [[0,7,2000],[90,30,550],[180,-45,550],[270,70,250],[0,7,10000]]){
   r.draw({...options,radius,rotation:lookAt(az,alt),cull:false});const full=new Uint8Array(c.width*c.height*4);gl.readPixels(0,0,c.width,c.height,gl.RGBA,gl.UNSIGNED_BYTE,full);
   const result=r.draw({...options,radius,rotation:lookAt(az,alt),cull:true}),culled=new Uint8Array(full.length);gl.readPixels(0,0,c.width,c.height,gl.RGBA,gl.UNSIGNED_BYTE,culled);
   let different=0;for(let i=0;i<full.length;i++)if(full[i]!==culled[i])different++;
   culling.push({az,alt,radius,different,drawn:result.drawnTriangles,total:mesh.indices.length/3});
  }
  // Two coincident angular ridges only a metre apart at 100 km must remain
  // ordered regardless of draw order (24-bit inverse depth could not do this).
  // Shading comes from height grids: give the far triangle a sloped one so the
  // two shade differently.
  const triangle=(distance,grid)=>({positions:Float32Array.from([-2000,distance,1000,2000,distance,1000,0,distance,5000],(v,i)=>i%3===1?v:v*distance/100000),indices:Uint32Array.from([0,1,2]),...(grid?{grid}:{})});
  const near=triangle(100000),far=triangle(100001,{size:2,extent:200000,heights:Uint16Array.from([0,0,60000,60000]),scale:1,offset:0}),depthOrder=[];
  const depthOptions={...options,radius:5000,rotation:lookAt(0,2)};
  r.setMeshes([near]);r.draw(depthOptions);const reference=pixels();
  for(const meshes of [[far,near],[near,far]]){r.setMeshes(meshes);r.draw(depthOptions);const actual=pixels();let compared=0,different=0;for(let i=0;i<actual.length;i+=4)if(reference[i+3]===255){compared++;if(actual[i]!==reference[i]||actual[i+1]!==reference[i+1]||actual[i+2]!==reference[i+2])different++;}depthOrder.push({compared,different});}
  r.destroy();return {silhouette,coverage,culling,depthOrder};
 });
 assert.deepEqual(synthetic.silhouette.sky,synthetic.silhouette.composite,'Distant profile must not leave a dark band above the visible mesh');
 assert.equal(synthetic.coverage[0].partial,0);
 for(const c of synthetic.coverage){assert.ok(c.opaque>1000);assert.equal(c.error,0);}
 assert.ok(synthetic.coverage[1].partial>50,'Edge antialiasing must provide fractional silhouette coverage');
 assert.ok(synthetic.coverage[1].partialMean>synthetic.coverage[1].opaqueMean*.8,'Partial coverage must not introduce a dark fringe');
 for(const result of synthetic.culling)assert.equal(result.different,0,JSON.stringify(result));
 assert.ok(synthetic.culling.some(r=>r.drawn<r.total*.5));
 for(const result of synthetic.depthOrder){assert.ok(result.compared>1000);assert.equal(result.different,0,'Distant surfaces must preserve depth ordering');}
 if(output)await page.screenshot({path:path.join(output,'synthetic-silhouette.png')});
 const real=[];
 if(process.env.TERRAIN_CACHE){
  for(const prefix of process.env.TERRAIN_BASELINE?['/baseline/','/js/']:['/js/']){
   const value=await page.evaluate(async prefix=>{
    const surface=await new Promise((resolve,reject)=>{const w=new Worker(prefix+'terrainworker.js',{type:'module'});w.onerror=e=>{w.terminate();reject(new Error(e.message));};w.onmessage=({data})=>{if(data.type==='ready'){w.terminate();resolve(data.surface);}if(data.type==='error'){w.terminate();reject(new Error(data.text));}};w.postMessage({place:[45.88675,10.84577]});});
    window.realSurface=surface;if(prefix==='/baseline/')window.baselineSurface=surface;
    const {createTerrainRenderer}=await import(prefix+'terrainrender.js'),{lookAt}=await import('/js/coelum.js');
    const c=document.createElement('canvas');c.style.width='900px';c.style.height='600px';document.body.replaceChildren(c);
    const r=createTerrainRenderer(c),upload=performance.now();r.setMeshes(surface.meshes);const uploadMs=performance.now()-upload;
    const gl=c.getContext('webgl2'),times=[],pixel=new Uint8Array(4),debug=gl.getExtension('WEBGL_debug_renderer_info');
    const options={W:900,H:600,radius:950,rotation:lookAt(179.1,-12.58),sun:{az:180,alt:45},moon:{az:0,alt:-90},flux:0,exposure:1.6,shadows:true};
    const first=r.draw(options);gl.finish();
    for(let i=0;i<12;i++){const start=performance.now();const result=r.draw({...options,rotation:lookAt(179.1+i*.1,-12.58)});gl.readPixels(450,300,1,1,gl.RGBA,gl.UNSIGNED_BYTE,pixel);if(i>1)times.push(performance.now()-start);if(result.glError)throw new Error(`WebGL ${result.glError}`);}
    const lightingTimes=[];
    for(let i=0;i<5;i++){const start=performance.now();r.draw({...options,sun:{az:180+i*.1,alt:45}});gl.readPixels(450,300,1,1,gl.RGBA,gl.UNSIGNED_BYTE,pixel);if(i)lightingTimes.push(performance.now()-start);}
    r.draw({...options,rotation:lookAt(179.1,7),radius:3000});gl.finish();
    window.realRenderer=r;
    return {prefix,eye:surface.eye,metrics:surface.metrics,renderer:debug?gl.getParameter(debug.UNMASKED_RENDERER_WEBGL):gl.getParameter(gl.RENDERER),drawnTriangles:first.drawnTriangles,uploadMs,frameMs:times.sort((a,b)=>a-b)[Math.floor(times.length/2)],lightingFrameMs:lightingTimes.sort((a,b)=>a-b)[Math.floor(lightingTimes.length/2)]};
   },prefix);
   if(output)await page.screenshot({path:path.join(output,prefix==='/js/'?'riva-new.png':'riva-before.png')});
   await page.evaluate(()=>window.realRenderer.destroy());real.push(value);
  }
  if(process.env.TERRAIN_BASELINE){
   const accuracy=await page.evaluate(async()=>{
    const {tilesFor,tileSampler,profile}=await import('/js/terrainmodel.js'),{PANORAMA_RINGS,meshHorizon}=await import('/js/terrainmesh.js');
    const tiles=new Map(),surface=window.realSurface;
    await Promise.all(tilesFor(surface.place,PANORAMA_RINGS,150000).map(async([z,x,y])=>{
     const response=await fetch(`/cached/${z}/${x}/${y}.webp`);if(!response.ok)return;
     const bitmap=await createImageBitmap(await response.blob(),{colorSpaceConversion:'none',premultiplyAlpha:'none'}),c=new OffscreenCanvas(512,512),g=c.getContext('2d');g.drawImage(bitmap,0,0);bitmap.close();
     const pixels=g.getImageData(0,0,512,512).data,h=new Uint16Array(512*512);
     for(let i=0;i<h.length;i++){const value=pixels[i*4]*256+pixels[i*4+1]+pixels[i*4+2]/256-32768;h[i]=pixels[i*4+3]?Math.round((value+1000)*4):65535;}
     tiles.set(`${z}/${x}/${y}`,{size:512,h,scale:.25,offset:-1000,noData:65535});
    }));
    const reference=await profile({place:[...surface.place.slice(0,2),surface.eye-2],sample:tileSampler(tiles,false,true),rings:PANORAMA_RINGS,radius:150000,step:.1,distanceFraction:.5,startDistance:100});
    const compare=mesh=>{const actual=meshHorizon(mesh.meshes),errors=Array.from(actual,(v,i)=>v-reference.alt[i]);return {meanAbsolute:errors.reduce((s,v)=>s+Math.abs(v),0)/errors.length,rms:Math.sqrt(errors.reduce((s,v)=>s+v*v,0)/errors.length),maximum:Math.max(...errors.map(Math.abs))};};
    return {reference:'Same DEM, 0.1 degree rays, half source-pixel distance steps; model agreement, not surveyed accuracy',before:compare(window.baselineSurface),after:compare(surface),referenceMs:reference.computeMs};
   });
   real.push({accuracy});assert.ok(accuracy.after.rms<accuracy.before.rms,'Finer mesh must improve agreement with the source DEM skyline');
  }
 }
 assert.deepEqual(errors,[]);
 const results={status:'passed',synthetic,real,tiles,missingCachedTiles:absent};
 if(output)await fs.writeFile(path.join(output,'quality.json'),JSON.stringify(results,null,2));
 console.log(JSON.stringify(results));await context.close();
}finally{await browser.close();await new Promise(r=>server.close(r));}
