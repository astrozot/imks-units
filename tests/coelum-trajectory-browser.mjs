// Selection and playback trails with and without camera locking.
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
  const wait=ms=>new Promise(r=>setTimeout(r,ms));
  const results=[];
  for(const mount of ['altaz','equatorial','galactic']) for(const mode of ['sky','chart']) for(const locked of [false,true]) {
   localStorage.setItem('imks-coelum-mount',mount);
   localStorage.setItem('imks-coelum-mode',mode);
   const host=document.createElement('div');host.className='coelum-explorer';document.body.replaceChildren(host);
   const t=Date.parse('2026-11-24T21:00:00Z')/1000;
   const explorer=mountCoelum(host,{t,place:[41.892,12.511,20],label:'Rome'},String,{standalone:true});
   explorer.focus('Moon');await wait(800);
   const play=host.querySelector('[data-action="play"]');
   const playSteps=async()=>{
    play.click();await wait(60);
    for(let i=1;i<=3;i++){explorer.setTime(t+i*3600);play.click();await wait(40);}
    play.click();await wait(40);
   };
   await playSteps();
   const ordinaryTrail=!!host.querySelector('.coelum-trajectory');
   explorer.setTime(t);explorer.focus('Moon');await wait(800);
   const svg=host.querySelector('.coelum-full'),box=svg.getBoundingClientRect();
   const pointer=type=>svg.dispatchEvent(new PointerEvent(type,{pointerId:11,isPrimary:true,pointerType:'touch',clientX:box.x+box.width/2,clientY:box.y+box.height/2,bubbles:true}));
   pointer('pointerdown');await wait(550);pointer('pointerup');
   const heldDetail=host.classList.contains('coelum-show-detail');
   const redSelection=mode==='chart' && !!svg.querySelector('path[stroke="#ff5555"]');
   explorer.select('Moon');
   if(locked)host.querySelector('[data-action="lock"]').click();
   play.click();await wait(60);
   for(let i=1;i<=3;i++){explorer.setTime(t+i*3600);play.click();await wait(40);}
   const samples=Number(svg.querySelector('.coelum-trajectory')?.dataset.samples||0);
   play.click();await wait(40);
   const trail=svg.querySelector('.coelum-trajectory');
   const paused=!!trail;
   const span=trail?.getBBox().width+trail?.getBBox().height;
   const redTrail=trail?.getAttribute('stroke')==='#ff5555';
   explorer.select('Moon',{longPress:true});
   await playSteps();
   const untrackedTrail=!!svg.querySelector('.coelum-trajectory');
   explorer.select(null);
   results.push({mount,mode,locked,ordinaryTrail,heldDetail,redSelection,samples,span,paused,redTrail,untrackedTrail,cleared:!svg.querySelector('.coelum-trajectory')});
  }
  return results;
 });
 for(const r of results){
  assert.equal(r.ordinaryTrail,false,JSON.stringify(r));
  assert.equal(r.heldDetail,false,JSON.stringify(r));
  if(r.mode==='chart')assert.equal(r.redSelection,true,JSON.stringify(r));
  assert.ok(r.samples>=3,JSON.stringify(r));
  assert.equal(r.paused,true,JSON.stringify(r));
  assert.equal(r.redTrail,true,JSON.stringify(r));
  assert.equal(r.untrackedTrail,false,JSON.stringify(r));
  assert.equal(r.cleared,true,JSON.stringify(r));
 }
 for(const r of results.filter(r=>r.mount!=='altaz')) {
  const az=results.find(a=>a.mount==='altaz'&&a.mode===r.mode&&a.locked===r.locked);
  assert.ok(r.span<az.span/5,`The Moon should move much less in ${r.mount}: ${JSON.stringify({r,az})}`);
 }
 assert.deepEqual(errors,[]);
 console.log('Long press and playback trajectories passed',results);
} finally { await browser?.close();await new Promise(r=>server.close(r)); }
