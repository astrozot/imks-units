// Rigil Kentaurus lock and Toliman trajectory at 28 Mx in Galactic coordinates.
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
 const page=await browser.newPage({viewport:{width:640,height:720}}),errors=[];
 page.on('pageerror',e=>errors.push(e.message));
 await page.route('https://**',route=>route.abort());
 await page.goto(`http://localhost:${server.address().port}/coelum/`);
 const results=await page.evaluate(async()=>{
  const {mountCoelum}=await import('/js/coelumui.js');
  const {binaryState}=await import('/js/starmotion.js');
  const {relativeTrajectoryVector}=await import('/js/skytrajectory.js');
  const {centuries}=await import('/js/astro.js');
  const {galacticCoordinates,vec,lookAt,projectVector}=await import('/js/coelum.js');
  const wait=ms=>new Promise(r=>setTimeout(r,ms)),results=[];
  const galactic=v=>{const g=galacticCoordinates({ra:Math.atan2(v[1],v[0])*180/Math.PI,dec:Math.atan2(v[2],Math.hypot(v[0],v[1]))*180/Math.PI},{matrix:[[1,0,0],[0,1,0],[0,0,1]]});return vec(g.lon,g.lat);};
  // Fit only a fixed screen scale/rotation/translation. Any spurious wiggles
  // in stored sky positions remain as residuals against the Kepler model.
  const solve=(a,b)=>{
   const m=a.map((row,i)=>[...row,b[i]]);
   for(let i=0;i<3;i++){
    let pivot=i;for(let j=i+1;j<3;j++)if(Math.abs(m[j][i])>Math.abs(m[pivot][i]))pivot=j;
    [m[i],m[pivot]]=[m[pivot],m[i]];
    const d=m[i][i];for(let j=i;j<4;j++)m[i][j]/=d;
    for(let k=0;k<3;k++)if(k!==i){const d=m[k][i];for(let j=i;j<4;j++)m[k][j]-=d*m[i][j];}
   }
   return m.map(row=>row[3]);
  };
  for(const mode of ['chart','sky']){
   localStorage.setItem('imks-coelum-mount','galactic');localStorage.setItem('imks-coelum-mode',mode);
   const host=document.createElement('div');host.className='coelum-explorer';document.body.replaceChildren(host);
   const t=Date.parse('2026-11-20T00:00:00Z')/1000;
   const app=mountCoelum(host,{t,place:[41.9,12.5,0,'barycentric'],label:'Solar system barycenter'},String,{standalone:true});
   app.focus('Rigil Kentaurus',{fit:true,field:.15});await wait(800);
   host.querySelector('[data-action="lock"]').click();
   app.select('Toliman',{longPress:true});
   const lock=host.querySelector('[data-action="lock"]').getAttribute('aria-label');
   const svg=host.querySelector('.coelum-full'),play=host.querySelector('[data-action="play"]');
   // Deterministic animation timestamps retain the real 28-million-times tick
   // path while covering decades without waiting for a real-time minute.
   const originalRAF=window.requestAnimationFrame,originalCancel=window.cancelAnimationFrame;
   let id=0;const callbacks=new Map();
   window.requestAnimationFrame=fn=>{callbacks.set(++id,fn);return id;};
   window.cancelAnimationFrame=i=>callbacks.delete(i);
   app.setSpeed(28000000);play.click();
   const times=[app.time];let now=performance.now();
   try{
    for(let k=0;k<480;k++){
     now+=100;const scheduled=[...callbacks.values()];callbacks.clear();for(const fn of scheduled)fn(now);
     const samples=Number(svg.querySelector('.coelum-trajectory')?.dataset.samples||0);
     if(samples>times.length)times.push(app.time);
    }
    play.click();
   }finally{window.requestAnimationFrame=originalRAF;window.cancelAnimationFrame=originalCancel;}
   const line=svg.querySelector('.coelum-trajectory');
   const points=[...line.getAttribute('d').matchAll(/[ML](-?[\d.]+),(-?[\d.]+)/g)].map(m=>[+m[1],+m[2]]);
   const jd=time=>2451545+centuries(time)*36525;
   const primary=galactic(binaryState('0:A',jd(app.time)).vector);
   const camera=lookAt(Math.atan2(primary[0],primary[1])*180/Math.PI,Math.asin(primary[2])*180/Math.PI);
   const expected=times.map(time=>{const relative=relativeTrajectoryVector(galactic(binaryState('0:B',jd(time)).vector),galactic(binaryState('0:A',jd(time)).vector),primary);const p=projectVector(relative,camera,mode==='sky');return [p.x*1e6,p.y*1e6,1];});
   const normal=[0,1,2].map(i=>[0,1,2].map(j=>expected.reduce((s,p)=>s+p[i]*p[j],0)));
   const coefficients=[0,1].map(axis=>solve(normal, [0,1,2].map(j=>expected.reduce((s,p,i)=>s+p[j]*points[i][axis],0))));
   const maxResidual=Math.max(...expected.map((p,i)=>Math.hypot(...coefficients.map((cs,axis)=>cs.reduce((s,x,j)=>s+x*p[j],0)-points[i][axis]))));
   results.push({mode,lock,samples:times.length,points:points.length,years:(app.time-t)/31557600,maxResidual,red:line.getAttribute('stroke')});
  }
  return results;
 });
 for(const r of results){
  assert.equal(r.lock,'Unlock Rigil Kentaurus');assert.equal(r.red,'#ff5555');
  assert.ok(r.samples>400);assert.equal(r.points,r.samples);assert.ok(r.years>40);
  assert.ok(r.maxResidual<.03,`${r.mode}: ${r.maxResidual} pixels from the relative Kepler orbit`);
 }
 assert.deepEqual(errors,[]);console.log(results);
}finally{await browser?.close();await new Promise(r=>server.close(r));}
