// Long-press feedback, persistent tracked objects and selectable binary references.
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
try{
 browser=await chromium.launch(process.env.CHROME?{executablePath:process.env.CHROME}:{});
 const page=await browser.newPage({viewport:{width:640,height:720},hasTouch:true}),errors=[];
 page.on('pageerror',e=>errors.push(e.message));await page.route('https://**',route=>route.abort());
 await page.goto(`http://localhost:${server.address().port}/coelum/`);
 const results=await page.evaluate(async()=>{
  const {mountCoelum}=await import('/js/coelumui.js');
  const wait=ms=>new Promise(r=>setTimeout(r,ms)),results=[];
  for(const mode of ['chart','sky']){
   localStorage.setItem('imks-coelum-mount','galactic');localStorage.setItem('imks-coelum-mode',mode);
   const host=document.createElement('div');host.className='coelum-explorer';document.body.replaceChildren(host);
   const t=Date.parse('2026-11-20T00:00:00Z')/1000,app=mountCoelum(host,{t,place:[41.9,12.5,0,'barycentric'],label:'Solar system barycenter'},String,{standalone:true});
   app.focus('Toliman',{fit:true,field:.02});await wait(800);app.select('Rigil Kentaurus');
   const svg=host.querySelector('.coelum-full'),box=()=>svg.getBoundingClientRect();
   const pointer=(type,dx=0)=>{const b=box();svg.dispatchEvent(new PointerEvent(type,{pointerId:11,isPrimary:true,pointerType:'touch',clientX:b.x+b.width/2+dx,clientY:b.y+b.height/2,bubbles:true}));};
   pointer('pointerdown');await wait(150);const before=svg.dataset.tracked;
   await wait(450);const during=svg.dataset.tracked,reference=svg.dataset.selected;
   const redSpikes=mode==='chart' && !!svg.querySelector('path[stroke="#ff5555"]');
   const redPixels=()=>{const c=host.querySelector('canvas'),d=c.getContext('2d').getImageData(0,0,c.width,c.height).data;let n=0;for(let i=0;i<d.length;i+=4)if(d[i]>180&&d[i+1]<140&&d[i+2]<140)n++;return n;};
   const earlyPixels=mode==='sky'?redPixels():0;pointer('pointerup');
   const after=svg.dataset.tracked;
   const play=host.querySelector('[data-action="play"]');
   const originalRAF=window.requestAnimationFrame,originalCancel=window.cancelAnimationFrame;
   let id=0;const callbacks=new Map();window.requestAnimationFrame=fn=>{callbacks.set(++id,fn);return id;};window.cancelAnimationFrame=i=>callbacks.delete(i);
   let primary,bary,third,multiple;
   const read=()=>{const p=svg.querySelector('.coelum-trajectory'),v=[...p.getAttribute('d').matchAll(/[ML](-?[\d.]+),(-?[\d.]+)/g)].map(m=>[+m[1],+m[2]]),x=v.map(p=>p[0]),y=v.map(p=>p[1]);return {samples:+p.dataset.samples,target:p.dataset.target,reference:p.dataset.reference,span:Math.hypot(Math.max(...x)-Math.min(...x),Math.max(...y)-Math.min(...y))};};
   try{
    app.setSpeed(28000000);play.click();let now=performance.now();
    for(let k=0;k<320;k++){now+=100;const scheduled=[...callbacks.values()];callbacks.clear();for(const fn of scheduled)fn(now);}
    play.click();primary=read();
    app.select('α Centauri barycenter');bary=read();
    for(let j=0;j<2;j++){host.querySelector('[data-action="mount"]').click();const switched=read();if(switched.reference!==bary.reference||switched.samples!==bary.samples)throw new Error('Reference changed with the display mount');}
    app.select('Rigil Kentaurus');third=read();
    app.select('Rigil Kentaurus',{longPress:true});
    if(read().samples!==third.samples)throw new Error('Adding a target erased an existing history');
    play.click();
    for(let k=0;k<5;k++){now+=100;const scheduled=[...callbacks.values()];callbacks.clear();for(const fn of scheduled)fn(now);}
    play.click();
    app.select('α Centauri barycenter');
    multiple=[...svg.querySelectorAll('.coelum-trajectory')].map(p=>({target:p.dataset.target,reference:p.dataset.reference,samples:+p.dataset.samples}));
    const beforeRemoval=read();
    app.select('Rigil Kentaurus',{longPress:true});
    const afterRemoval=read();
    if(svg.querySelectorAll('.coelum-trajectory').length!==1||beforeRemoval.samples!==afterRemoval.samples)throw new Error('Removing a target altered another history');
   }finally{window.requestAnimationFrame=originalRAF;window.cancelAnimationFrame=originalCancel;}
   // The grey cross itself must be hit-testable, not just searchable.
   app.focus('α Centauri barycenter',{fit:true,field:.02});await wait(800);
   pointer('pointerdown');await wait(30);pointer('pointerup');
   const picked=svg.dataset.selected;
   // A real second hold adds another target, and holding it again removes it.
   const hold=async()=>{pointer('pointerdown');await wait(550);pointer('pointerup');};
   await hold();const added=JSON.parse(svg.dataset.trackedObjects);
   await hold();const removed=JSON.parse(svg.dataset.trackedObjects);
   app.select('Toliman',{longPress:true});
   const lastRemoved=JSON.parse(svg.dataset.trackedObjects),lastTrail=!!svg.querySelector('.coelum-trajectory');
   app.select(null);
   pointer('pointerdown');pointer('pointermove',20);await wait(550);pointer('pointerup',20);
   const dragged=svg.dataset.tracked;
   pointer('pointerdown');pointer('pointercancel');await wait(550);const cancelled=svg.dataset.tracked;
   if(mode==='sky'){
    app.focus('α Centauri barycenter',{fit:true,field:.025});await wait(800);
    app.select('Rigil Kentaurus');app.select('Toliman',{longPress:true});
   }
   results.push({mode,before,during,reference,after,redSpikes,earlyPixels,primary,bary,third,multiple,picked,added,removed,lastRemoved,lastTrail,dragged,cancelled});
  }
  return results;
 });
 for(const r of results){
  assert.equal(r.before,'');assert.equal(r.during,'Toliman');assert.equal(r.after,'Toliman');assert.equal(r.reference,'Rigil Kentaurus');
  if(r.mode==='chart')assert.equal(r.redSpikes,true);else assert.ok(r.earlyPixels>20,'Red reticle visible on canvas before release');
  assert.equal(r.primary.target,'Toliman');assert.equal(r.primary.reference,'Rigil Kentaurus');
  assert.equal(r.bary.target,'Toliman');assert.equal(r.bary.reference,'α Centauri barycenter');
  assert.equal(r.bary.samples,r.primary.samples);assert.ok(r.primary.samples>300);
  const ratio=r.bary.span/r.primary.span;assert.ok(Math.abs(ratio-1.0788/(1.0788+.9092))<.005,`${r.mode}: relative orbit scale ratio ${ratio}`);
  assert.ok(Math.abs(r.third.span-r.primary.span)<.05,'Switching the reference back restores the original relative orbit');
  assert.equal(r.multiple.length,2);
  assert.deepEqual(r.multiple.map(p=>p.target),['Toliman','Rigil Kentaurus']);
  for(const p of r.multiple){assert.equal(p.reference,'α Centauri barycenter');assert.ok(p.samples>=5);}
  assert.deepEqual(r.added,['Toliman','α Centauri barycenter']);
  assert.deepEqual(r.removed,['Toliman']);assert.deepEqual(r.lastRemoved,[]);assert.equal(r.lastTrail,false);
  assert.equal(r.picked,'α Centauri barycenter');assert.equal(r.dragged,'');assert.equal(r.cancelled,'');
 }
 if(process.env.SELECTION_SCREENSHOT)await page.screenshot({path:process.env.SELECTION_SCREENSHOT});
 assert.deepEqual(errors,[]);console.log(results);
}finally{await browser?.close();await new Promise(r=>server.close(r));}
