// Locked pinch anchors in paused and playing sky/chart views. Uses the
// same PLAYWRIGHT / CHROME options as coelum-browser.mjs.
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
let chromium;
for (const name of [process.env.PLAYWRIGHT && path.join(process.env.PLAYWRIGHT,'index.mjs'),'playwright-core','playwright'].filter(Boolean)) {
  try { ({ chromium }=await import(name)); break; } catch { /* next */ }
}
if (!chromium) throw new Error('Install Playwright or set PLAYWRIGHT to its package directory');
const root=fileURLToPath(new URL('../',import.meta.url));
const server=http.createServer((req,res)=>{
 const file=path.join(root,new URL(req.url,'http://localhost').pathname.replace(/\/$/,'/index.html'));
 if(!file.startsWith(root)||!fs.existsSync(file)){res.writeHead(404);res.end();return;}
 const ext=path.extname(file);res.setHeader('content-type',ext==='.js'?'text/javascript':ext==='.html'?'text/html':ext==='.css'?'text/css':'application/octet-stream');
 fs.createReadStream(file).pipe(res);
});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
let browser;
try {
 browser=await chromium.launch(process.env.CHROME?{executablePath:process.env.CHROME}:{});

 const page=await browser.newPage({viewport:{width:600,height:800},hasTouch:true});
 await page.route('https://**',route=>route.abort());
 await page.goto(`http://localhost:${server.address().port}/coelum/`);
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 const results=await page.evaluate(async()=>{
  const {mountCoelum}=await import('/js/coelumui.js');
  const {lookAt,projectVector,unprojectSky,chartRadius,skyFrame,pointVector}=await import('/js/coelum.js');
  const {skyRadius}=await import('/js/coelumsky.js');
  const wait=ms=>new Promise(r=>setTimeout(r,ms));
  const samples=[];
  for(const mode of ['sky','chart']) {
   const run=async(locked,play)=>{
    localStorage.setItem('imks-coelum-mode',mode);
    const host=document.createElement('div');host.className='coelum-explorer';document.body.replaceChildren(host);
    const t=Date.parse('2026-11-24T21:00:00Z')/1000;
    const explorer=mountCoelum(host,{t,place:[41.892,12.511,20],label:'Rome'},String,{standalone:true});
    for(const key of ['ground','atmosphere','milkyway']) {
     const box=host.querySelector(`[data-layer="${key}"]`);if(box){box.checked=false;box.dispatchEvent(new Event('change',{bubbles:true}));}
    }
    explorer.focus('Moon',{fit:true,field:0.05});await wait(750);
    const svg=host.querySelector('.coelum-full');
    // Move the Moon's center well outside this close-up before locking.
    for(let i=0;i<40;i++)svg.dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowRight',bubbles:true}));
    if(locked)host.querySelector('[data-action="lock"]').click();
    const W=svg.viewBox.baseVal.width,H=svg.viewBox.baseVal.height;
    const box=svg.getBoundingClientRect();
    const pointer=(type,id,x,y)=>svg.dispatchEvent(new PointerEvent(type,{pointerId:id,isPrimary:id===11,pointerType:'touch',clientX:box.x+x*box.width/W,clientY:box.y+y*box.height/H,bubbles:true}));
    const camera=()=>mode==='sky'?lookAt(Number(svg.dataset.az),Number(svg.dataset.alt)):svg.dataset.rotation.split(',').map(Number);
    const radius=()=> (mode==='sky'?skyRadius:chartRadius)(W,H,Number(svg.dataset.scale));
    const snapshot=()=>({scale:Number(svg.dataset.scale),camera:camera()});
    const moonPosition=()=>{
     const f=skyFrame(explorer.time,explorer.place),moon=f.bodies.find(o=>o.body==='moon');
     const q=projectVector(pointVector(moon),camera(),mode==='sky'),r=radius();
     return [W/2+q.x*r,H/2+q.y*r];
    };
    const moonStart=moonPosition();
    if(moonStart[0]>=0&&moonStart[0]<=W&&moonStart[1]>=0&&moonStart[1]<=H)throw new Error(`${mode}: fixture must put locked center off screen`);
    let x=W*0.58,y=H*0.46,d=60;
    pointer('pointerdown',11,x-d/2,y);pointer('pointerdown',12,x+d/2,y);
    if(play)host.querySelector('[data-action="play"]').click();
    let anchorError=0;
    for(let step=0;step<4;step++) {
     // Time changes between moves must preserve the anchor in the tracked
     // camera, instead of returning to the sky grabbed at touch-down.
     if(play){explorer.setTime(t+(step+1)*600);host.querySelector('[data-action="play"]').click();await wait(35);}
     const r0=radius(),rotation=camera();
     const grabbed=unprojectSky((x-W/2)/r0,(y-H/2)/r0,rotation,mode==='sky');
     const nextD=d+20,nextX=x+10;
     // Move just the right finger: the centroid translates as it zooms.
     pointer('pointermove',12,nextX+nextD/2,y);
     const q=projectVector(grabbed,camera(),mode==='sky'),r1=radius();
     anchorError=Math.max(anchorError,Math.hypot(W/2+q.x*r1-nextX,H/2+q.y*r1-y));
     x=nextX;d=nextD;await wait(30);
    }
    pointer('pointerup',12,x+d/2,y);pointer('pointerup',11,x-d/2,y);
    if(play)host.querySelector('[data-action="play"]').click();
    await wait(40);
    const result={...snapshot(),anchorError};
    if(locked){
     const before=moonPosition();explorer.setTime(explorer.time+600);const after=moonPosition();
     const drift=Math.hypot(after[0]-before[0],after[1]-before[1]);
     if(drift>1)throw new Error(`${mode}: lock drifted after pinch: ${drift}px`);
     // Trackpad pinch paths have the same center anchor as unlocked zoom.
     const beforeCamera=camera();
     svg.dispatchEvent(new WheelEvent('wheel',{deltaY:-20,ctrlKey:true,bubbles:true,cancelable:true}));await wait(40);
     const start=new Event('gesturestart',{bubbles:true,cancelable:true});svg.dispatchEvent(start);
     const change=new Event('gesturechange',{bubbles:true,cancelable:true});change.scale=1.2;svg.dispatchEvent(change);
     svg.dispatchEvent(new Event('gestureend',{bubbles:true,cancelable:true}));await wait(40);
     if(Math.max(...camera().map((v,i)=>Math.abs(v-beforeCamera[i])))>1e-7)throw new Error(`${mode}: trackpad pinch moved center anchor`);
    }
    if(locked&&host.querySelector('[data-action="lock"]').getAttribute('aria-pressed')!=='true')throw new Error('Pinch released lock');
    host.remove();await wait(0);return result;
   };
   const free=await run(false,false),locked=await run(true,false),playing=await run(true,true);
   const difference=Math.max(...free.camera.map((v,i)=>Math.abs(v-locked.camera[i])));
   if(difference>1e-7||Math.abs(free.scale-locked.scale)>1e-5)throw new Error(`${mode}: paused lock differs from standard pinch: ${difference}`);
   if(playing.anchorError>1)throw new Error(`${mode}: playback pinch anchor drifted ${playing.anchorError}px`);
   samples.push({mode,difference,anchorError:playing.anchorError});
  }
  return samples;
 });
 assert.equal(results.length,2);assert.deepEqual(errors,[]);
 console.log('Locked pinch checks passed:',JSON.stringify(results));
} finally {
 await browser?.close();await new Promise(r=>server.close(r));
}
