// Local, read-only comparison through PeakFinder's documented canvas API.
// No production imports or rendering behaviour are changed by this harness.
import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('../../',import.meta.url));
const kind=process.env.TERRAIN_BROWSER||'webkit',samples=Number(process.env.BENCH_SAMPLES||40),rounds=Number(process.env.BENCH_ROUNDS||3);
const cache=process.env.TERRAIN_CACHE||path.join(os.tmpdir(),'imks-terrain-cache');
const output=process.env.TERRAIN_RESULTS||path.join(os.tmpdir(),'imks-peakfinder-comparison-'+kind);
let browserType;
for(const name of [process.env.PLAYWRIGHT&&path.join(process.env.PLAYWRIGHT,'index.mjs'),'playwright-core','playwright'].filter(Boolean))try{browserType=(await import(name))[kind];break;}catch{}
if(!browserType)throw new Error('Set PLAYWRIGHT to a playwright-core installation');
// The terrain worker adds a 2 m eye height to the ground: 88 m gives the 90 m eye.
const html=`<!doctype html><meta charset="utf-8"><style>html,body{margin:0;overflow:hidden}canvas{display:block;width:100vw;height:100vh}</style><canvas id="canvas"></canvas>`;
const server=http.createServer(async(req,res)=>{
 try{
  if(process.env.BENCH_ISOLATED){res.setHeader('Cross-Origin-Opener-Policy','same-origin');res.setHeader('Cross-Origin-Embedder-Policy','require-corp');}
  const url=new URL(req.url,'http://localhost');
  if(url.pathname==='/'){res.setHeader('content-type','text/html');res.end(html);return;}
  const match=/^\/cached\/(\d+)\/(\d+)\/(\d+)\.webp$/.exec(url.pathname);
  let name;
  if(match)name=path.join(cache,`mapterhorn-${match[1]}-${match[2]}-${match[3]}`);
  else {name=path.resolve(root,url.pathname.slice(1));if(!name.startsWith(root))throw new Error('Invalid path');}
  let body=await fs.readFile(name);
  if(url.pathname==='/js/terrainmodel.js')body=Buffer.from(body.toString().replace('https://tiles.mapterhorn.com/',`http://127.0.0.1:${server.address().port}/cached/`));
  res.setHeader('content-type',name.endsWith('.js')?'text/javascript':name.endsWith('.json')?'application/json':name.endsWith('.webp')||match?'image/webp':'application/octet-stream');res.end(body);
 }catch{res.writeHead(404);res.end();}
});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const origin=`http://127.0.0.1:${server.address().port}`;
await fs.mkdir(output,{recursive:true});
const browser=await browserType.launch(process.env.CHROME?{executablePath:process.env.CHROME}:{});
let scenarios=process.env.BENCH_QUICK?[{name:'desktop-wide',width:900,height:600,fov:69.78,alt:-12.58}]:[
 {name:'desktop-wide',width:900,height:600,fov:69.78,alt:-12.58},
 {name:'desktop-zoom',width:900,height:600,fov:20,alt:-5},
 {name:'phone-viewport',width:390,height:844,fov:69.78,alt:-12.58}
];
if(process.env.BENCH_SCENARIOS)scenarios=scenarios.filter(s=>process.env.BENCH_SCENARIOS.split(',').includes(s.name));
for(const s of scenarios)s.horizontalFovDegrees=s.width>=s.height?s.fov:2*Math.atan(Math.tan(s.fov*Math.PI/360)*s.width/s.height)*180/Math.PI;
const result={browser:kind,browserVersion:browser.version(),samplesPerRound:samples,rounds,isolated:!!process.env.BENCH_ISOLATED,devicePixelRatio:1,viewpoint:[45.88675,10.84577,90],rangeMetres:150000,method:{peakfinder:'Official canvas API, perspective projection, peak labels hidden via minimum elevation 10000 m; Sun/Moon/grid disabled.',coelum:'Current local terrain renderer, natural material, shadows enabled and cached during panning.',coelumScene:'Production skyScene including sky and neutral foreground composition, with labels/Milky Way/satellites disabled.',framing:'Same CSS and backing dimensions at DPR 1, same horizontal FOV, bearing and eye height. PeakFinder normalizes its FOV along the longer canvas dimension; portrait horizontal FOV is derived with the perspective aspect ratio before setting the Coelum stereographic radius. Coelum pitch is the negative of PeakFinder API altitude to align the observed views. Projections and elevation sources differ.',timing:'Main-thread frame callback plus one-pixel final-canvas readback: default WebGL framebuffer for PeakFinder/Coelum terrain, final 2D canvas for the complete Coelum scene. Excludes waiting for requestAnimationFrame; latency and frame intervals are reported separately. Eight warm-up updates before every measured run.',loading:'Setup times are diagnostic only, not comparable: Coelum tiles are served from an existing local cache; PeakFinder uses its own network/browser cache.',order:'Alternating app order between rounds; only one app page remains open at a time.'},runs:[],errors:[]};
try{
 const context=await browser.newContext({viewport:{width:900,height:600},deviceScaleFactor:1});
 await context.addInitScript(()=>{
  const b=window.bench={contexts:[],pending:null},seen=new WeakSet();
  const originalContext=HTMLCanvasElement.prototype.getContext;
  HTMLCanvasElement.prototype.getContext=function(...args){
   const gl=originalContext.apply(this,args);
   if(gl&&/webgl/.test(args[0])&&!seen.has(gl)){
    seen.add(gl);const entry={gl,draws:0};b.contexts.push(entry);
    for(const method of ['drawArrays','drawElements','drawArraysInstanced','drawElementsInstanced'])if(gl[method]){const original=gl[method].bind(gl);gl[method]=(...args)=>{entry.draws++;return original(...args);};}
   }
   return gl;
  };
  function complete(active,start,cpuMs){
   const pending=b.pending;if(!pending)return;
   let draws=0;
   for(const entry of active){
    entry.measured=true;draws+=entry.draws-entry.before;if(b.final2d)continue;const {gl}=entry,readTarget=gl.READ_FRAMEBUFFER||gl.FRAMEBUFFER,binding=gl.getParameter(gl.READ_FRAMEBUFFER_BINDING||gl.FRAMEBUFFER_BINDING),pixel=new Uint8Array(4);
    gl.bindFramebuffer(readTarget,null);gl.readPixels(Math.floor(gl.drawingBufferWidth/2),Math.floor(gl.drawingBufferHeight/2),1,1,gl.RGBA,gl.UNSIGNED_BYTE,pixel);gl.bindFramebuffer(readTarget,binding);
   }
   if(b.final2d)b.final2d.getImageData(0,0,1,1);
   const end=performance.now();b.pending=null;clearTimeout(pending.timeout);
   pending.resolve({cpuMs:cpuMs+(pending.setterMs||0),synchronisedMs:end-start+(pending.setterMs||0),latencyMs:end-pending.start,end,drawCalls:draws});
  }
  const raf=window.requestAnimationFrame.bind(window);
  window.requestAnimationFrame=callback=>raf(time=>{
   for(const entry of b.contexts)entry.before=entry.draws;
   const start=performance.now();callback(time);const cpuMs=performance.now()-start;
   if(b.pending){const active=b.contexts.filter(entry=>entry.draws>entry.before);if(active.length)complete(active,start,cpuMs);}
  });
  b.frame=update=>new Promise((resolve,reject)=>{
   if(b.pending)throw new Error('Overlapping measured frames');
   const start=performance.now(),pending=b.pending={start,resolve,reject,timeout:setTimeout(()=>{b.pending=null;reject(new Error('No rendered frame after camera update'));},5000)};
   for(const entry of b.contexts)entry.before=entry.draws;
   update();pending.setterMs=performance.now()-start;
   const active=b.contexts.filter(entry=>entry.draws>entry.before);
   if(active.length)complete(active,start,0);
  });
  b.info=()=>b.contexts.filter(entry=>entry.measured).map(({gl})=>{const debug=gl.getExtension('WEBGL_debug_renderer_info');return {renderer:debug?gl.getParameter(debug.UNMASKED_RENDERER_WEBGL):gl.getParameter(gl.RENDERER),width:gl.drawingBufferWidth,height:gl.drawingBufferHeight,attributes:gl.getContextAttributes()};});
 });
 for(const scenario of scenarios){
  const order=Array.from({length:rounds},(_,i)=>i%2?['coelum-scene','coelum','peakfinder']:['peakfinder','coelum','coelum-scene']);
  for(let round=0;round<rounds;round++)for(const app of order[round]){
   console.log(`Starting ${kind} ${scenario.name} ${app} round ${round+1}`);
   const page=await context.newPage();await page.setViewportSize({width:scenario.width,height:scenario.height});
   const requests=[];let measuring=false;
   page.on('request',r=>{if(measuring)requests.push(r.url());});
   page.on('pageerror',e=>result.errors.push({app,scenario:scenario.name,message:e.message}));
   await page.goto(origin+'/');
   const started=Date.now();
   if(app==='peakfinder'){
    await page.addScriptTag({url:'https://www.peakfinder.com/script/peakfinder.1.0.min.js'});
    await page.evaluate(()=>{
     window.panel=new PeakFinder.PanoramaPanel({canvasid:'canvas',locale:'en',disableinfosheets:true});
     panel.init(()=>{panel.addEventListener('viewpointjourney finished',()=>window.loaded=true);panel.loadViewpoint(45.88675,10.84577,'Riva',{animation:'teleport'});});
    });
    await page.waitForFunction(()=>window.loaded,null,{timeout:120000});
    await page.evaluate(s=>{
     panel.settings.visibilityRange(150000);panel.settings.projection(0);panel.settings.minimalElevation(10000);
     panel.settings.showSun(0);panel.settings.showMoon(0);panel.settings.showGrid(0);
     panel.settings.showZoomButtons(0);panel.settings.showElevationOffsetControl(0);panel.settings.showSliders(0);
     panel.elevationOffset(90-panel.viewpoint.elevation(),0);
     panel.azimut(179.1,0);panel.altitude(s.alt,0);panel.fieldofview(s.fov,0);
    },scenario);
   }else{
    await page.evaluate(async s=>{
     window.surface=await new Promise((resolve,reject)=>{const worker=new Worker('/js/terrainworker.js',{type:'module'});worker.onerror=e=>{worker.terminate();reject(new Error(e.message));};worker.onmessage=({data})=>{if(data.type==='ready'){worker.terminate();resolve(data.surface);}else if(data.type==='error'){worker.terminate();reject(new Error(data.text));}};worker.postMessage({place:[45.88675,10.84577,88]});});
     const {createTerrainRenderer}=await import('/js/terrainrender.js'),{lookAt}=await import('/js/coelum.js');
     window.renderer=createTerrainRenderer(canvas);renderer.setMeshes(surface.meshes);window.lookAt=lookAt;
     window.options={W:s.width,H:s.height,radius:s.width/(2*Math.tan(s.horizontalFovDegrees*Math.PI/720)),rotation:lookAt(179.1,-s.alt),sun:{az:180,alt:45},moon:{az:0,alt:-90},flux:0,exposure:2**.7,shadows:true,outlines:false};
     if(s.app==='coelum-scene'){
      renderer.destroy();canvas.remove();
      const finalCanvas=document.createElement('canvas');finalCanvas.width=s.width;finalCanvas.height=s.height;document.body.append(finalCanvas);
      const ctx=finalCanvas.getContext('2d'),{skyScene,skyRadius}=await import('/js/coelumsky.js'),{skyFrame}=await import('/js/coelum.js'),{horizonAt}=await import('/js/skyhorizon.js');
      const frame=skyFrame(Date.parse('2026-06-21T12:00Z')/1000,[45.88675,10.84577,90]);
      const layers={ground:true,horizon:'terrain',terrain:horizonAt(surface.profile),terrainSurface:surface,terrainAppearance:{style:'natural',shadows:true,outlines:false,waterColor:true,exposure:0,nightExposure:0},milkyway:false,labels:false,satellites:false};
      const scale=options.radius/skyRadius(s.width,s.height,1);
      window.drawScene=az=>skyScene(frame,s.width,s.height,layers,{az,alt:-s.alt,scale},ctx);
      bench.final2d=ctx;drawScene(179.1);
     }else renderer.draw(options);
    },{...scenario,app});
   }
   await page.waitForTimeout(1500);
   const setupMs=Date.now()-started;
   const run=await page.evaluate(async({app,scenario,samples})=>{
    const update=az=>{if(app==='peakfinder')panel.azimut(az,0);else requestAnimationFrame(()=>app==='coelum-scene'?drawScene(az):renderer.draw({...options,rotation:lookAt(az,-scenario.alt)}));};
    for(let i=0;i<8;i++)await bench.frame(()=>update(179.1+i*.1));
    const info=bench.info(),frames=[];
    window.runCamera=async()=>{for(let i=0;i<samples;i++){const az=179.1+12*Math.sin(i/(samples-1)*Math.PI*2);const frame=await bench.frame(()=>update(az));frames.push(frame);}return frames;};
    return {info,settings:app==='peakfinder'?{elevation:panel.viewpoint.elevation(),offset:panel.elevationOffset(),eye:panel.viewpoint.elevation()+panel.elevationOffset(),fov:panel.fieldofview(),alt:panel.altitude(),range:panel.settings.visibilityRange(),minimalElevation:panel.settings.minimalElevation(),projection:panel.settings.projection(),crossOriginIsolated,version:typeof PF_WASMVERSION==='undefined'?null:PF_WASMVERSION,mode:PeakFinder.utils.hasMultiThreadingSupport()&&PeakFinder.utils.hasSimdSupport()?'multi-threaded official canvas API':'single-threaded official canvas API'}:{eye:surface.eye,triangles:surface.metrics.triangles,shadowSize:2048,range:150000}};
   },{app,scenario,samples});
   measuring=true;run.frames=await page.evaluate(()=>runCamera());measuring=false;
   run.app=app;run.scenario=scenario;run.round=round+1;run.setupMs=setupMs;run.requestsDuringMeasurement=requests;
   if(round===0)await page.screenshot({path:path.join(output,`${scenario.name}-${app}.png`)});
   result.runs.push(run);
   await fs.writeFile(path.join(output,'raw.json'),JSON.stringify(result,null,2));
   console.log(JSON.stringify({app,scenario:scenario.name,round:round+1,frames:run.frames.length,info:run.info,settings:run.settings}));
   await page.close();
  }
 }
 await context.close();
}finally{await browser.close();await new Promise(r=>server.close(r));}
function stats(values){const sorted=values.slice().sort((a,b)=>a-b);return {median:sorted[Math.floor(sorted.length*.5)],p95:sorted[Math.floor(sorted.length*.95)],mean:values.reduce((s,v)=>s+v,0)/values.length};}
result.summary=[];
for(const scenario of scenarios)for(const app of ['peakfinder','coelum','coelum-scene']){
 const runs=result.runs.filter(r=>r.app===app&&r.scenario.name===scenario.name),frames=runs.flatMap(r=>r.frames);
 const intervals=runs.flatMap(r=>r.frames.slice(1).map((f,i)=>f.end-r.frames[i].end));
 result.summary.push({app,scenario:scenario.name,frames:frames.length,synchronisedMs:stats(frames.map(f=>f.synchronisedMs)),cpuMs:stats(frames.map(f=>f.cpuMs)),latencyMs:stats(frames.map(f=>f.latencyMs)),frameIntervalMs:stats(intervals),drawCalls:stats(frames.map(f=>f.drawCalls)),requestsDuringMeasurement:runs.reduce((s,r)=>s+r.requestsDuringMeasurement.length,0)});
}
await fs.writeFile(path.join(output,'results.json'),JSON.stringify(result,null,2));
console.log(JSON.stringify({summary:result.summary,errors:result.errors,output}));
