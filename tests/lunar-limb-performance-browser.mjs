// Changing-time lunar silhouette performance; PLAYWRIGHT/CHROME as in browser.mjs.
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
let chromium;
for (const name of [process.env.PLAYWRIGHT && path.join(process.env.PLAYWRIGHT, 'index.mjs'), 'playwright-core', 'playwright'].filter(Boolean)) {
  try { ({ chromium } = await import(name)); break; } catch { /* try next */ }
}
if (!chromium) { console.log('Skipped: Playwright is not installed'); process.exit(0); }
const root = fileURLToPath(new URL('../', import.meta.url));
const server = http.createServer((req, res) => {
  const filename = path.join(root, new URL(req.url, 'http://localhost').pathname.replace(/\/$/, '/index.html'));
  if (!filename.startsWith(root) || !fs.existsSync(filename)) { res.writeHead(404); res.end(); return; }
  const types = { '.js': 'text/javascript', '.css': 'text/css', '.html': 'text/html', '.jpg': 'image/jpeg', '.webp': 'image/webp' };
  res.writeHead(200, { 'content-type': types[path.extname(filename)] || 'application/octet-stream' });
  fs.createReadStream(filename).pipe(res);
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
let browser;
try {
  browser = await chromium.launch(process.env.CHROME ? { executablePath: process.env.CHROME } : {});
  const page = await browser.newPage({ viewport: { width: 1200, height: 850 }, serviceWorkers: 'block' });
  await page.goto(`http://localhost:${server.address().port}/coelum/`);
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  const result = await page.evaluate(async () => {
    const { planetMap, downloadMoonDetail, lunarLimb, tracePlanet }=await import('/js/skyview.js');
    const { moonDisk }=await import('/js/astro.js');
    const { skyFrame }=await import('/js/coelum.js');
    const { buildLunarLimb }=await import('/js/lunarlimb.js');
    const map=planetMap('moon');await map.ready;
    const t=Date.parse('2026-08-12T18:30:00Z')/1000;
    const canvas=document.createElement('canvas'), results=[];
    for(const high of [false,true]) {
      if(high)await downloadMoonDetail();
      const times=[], cpuTimes=[];
      const dem=document.createElement('canvas');dem.width=map.heights.width;dem.height=map.heights.height;
      const ctx=dem.getContext('2d',{willReadFrequently:true});ctx.drawImage(map.heights,0,0);
      const rgba=ctx.getImageData(0,0,dem.width,dem.height).data, data=new Uint16Array(dem.width*dem.height);
      for(let i=0;i<data.length;i++)data[i]=high ? rgba[4*i]*256+rgba[4*i+1] : Math.round(2000+40000*rgba[4*i]/255);
      const field={width:dem.width,height:dem.height,data};
      let gpuPasses=0, maxModelError=0;
      const countReads=WebGLRenderingContext.prototype.readPixels;
      WebGLRenderingContext.prototype.readPixels=function(...args) {
        if(this.getParameter(this.FRAMEBUFFER_BINDING))gpuPasses++;
        return countReads.apply(this,args);
      };
      // Warm compilation, texture uploads and the GPU before timing playback.
      for(let i=-3;i<16;i++) {
        const frame=skyFrame(t+i*900,[40.4,-3.7,600]);
        const disk=moonDisk(frame.t,frame.bodies.find(o=>o.body==='moon'));
        const start=performance.now();
        const profile=lunarLimb(disk,500,canvas);
        tracePlanet(canvas,disk,.96,.04,256,256,3000);
        const gl=canvas.getContext('webgl');gl.finish();
        if(i>=0)times.push(performance.now()-start);
        if(i>=0&&i<4) {
          const cpuStart=performance.now(), reference=buildLunarLimb(disk,field);
          cpuTimes.push(performance.now()-cpuStart);
          for(let j=0;j<profile.length;j++)maxModelError=Math.max(maxModelError,Math.abs(profile[j]-reference[j]));
        }
      }
      WebGLRenderingContext.prototype.readPixels=countReads;
      if(gpuPasses<10)throw Error('Playback must compute fresh GPU silhouettes as the geometry changes');
      if(maxModelError>2e-6)throw Error(`GPU silhouette disagrees with the independent model: ${maxModelError}`);
      const mean=times.reduce((a,b)=>a+b)/times.length, cpuMean=cpuTimes.reduce((a,b)=>a+b)/cpuTimes.length;
      if(high&&mean>cpuMean/3)throw Error(`Accelerated changing-frame playback regressed: ${mean} ms vs CPU ${cpuMean} ms`);
      results.push({high,mean,max:Math.max(...times),cpuMean,speedup:cpuMean/mean,gpuPasses,maxModelError});
    }
    return results;
  });
  assert.deepEqual(errors,[]);
  console.log('Lunar silhouette playback checks passed:',JSON.stringify(result));
} finally {
  if(browser)await browser.close();
  await new Promise(r=>server.close(r));
}
