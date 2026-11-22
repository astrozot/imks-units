// Timezone controls, offline map selection, and embedded explorer:
// node tests/coelum-timezone-map-browser.mjs. PLAYWRIGHT/CHROME as browser.mjs;
// BROWSER=webkit and BROWSER_EXECUTABLE select another engine.
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
let browserType;
for (const name of [process.env.PLAYWRIGHT && path.join(process.env.PLAYWRIGHT, 'index.mjs'), 'playwright-core', 'playwright'].filter(Boolean)) {
  try { browserType = (await import(name))[process.env.BROWSER || 'chromium']; break; } catch { /* try next */ }
}
if (!browserType) { console.log('Skipped: Playwright is not installed'); process.exit(0); }
const root = fileURLToPath(new URL('../', import.meta.url));
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.png': 'image/png', '.webp': 'image/webp' };
const server = http.createServer((req, res) => {
  const filename = path.join(root, new URL(req.url, 'http://localhost').pathname.replace(/\/$/, '/index.html'));
  if (!filename.startsWith(root) || !fs.existsSync(filename)) { res.writeHead(404); res.end(); return; }
  res.writeHead(200, { 'content-type': types[path.extname(filename)] || 'application/octet-stream' });
  fs.createReadStream(filename).pipe(res);
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const url = `http://localhost:${server.address().port}/coelum/`;
let browser;
try {
 browser=await browserType.launch(process.env.BROWSER_EXECUTABLE||process.env.CHROME?{executablePath:process.env.BROWSER_EXECUTABLE||process.env.CHROME}:{});
 const page=await browser.newPage({viewport:{width:390,height:844}});const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto(url);await page.waitForSelector('.coelum-full');
 page.on('console',message=>{if(message.text().startsWith('GPU test:'))console.log(message.text());});
 const result=await page.evaluate(async()=>{
  const {createGlobeGL}=await import('../js/globegl.js');const {loadTimezoneBoundaries}=await import('../js/timezoneboundaries.js');
  const data=await loadTimezoneBoundaries();console.log('GPU test: loaded polygons');const box=document.createElement('div');box.style.cssText='position:fixed;z-index:10000;left:20px;top:80px;width:320px;height:352px;background:#0b1425';document.body.append(box);
  const svg=document.createElementNS('http://www.w3.org/2000/svg','svg');svg.setAttribute('width','320');svg.setAttribute('height','352');box.append(svg);
  const renderer=createGlobeGL(svg,{boundaries:data,selected:()=> 'Europe/Rome'});
  if(!renderer)return {error:svg.dataset.gpuFallback||'WebGL renderer unavailable'};console.log('GPU test: renderer ready');
  const read=WebGLRenderingContext.prototype.readPixels;let reads=0;WebGLRenderingContext.prototype.readPixels=function(...args){reads++;return read.apply(this,args)};
  const frames=[];for(const zoom of [1,8,16]){renderer.draw({lat0:45.46,lon0:9.19,s:152*zoom},320,352,[45.46,9.19]);await new Promise(requestAnimationFrame);let submit=0;for(let i=0;i<3;i++){await new Promise(requestAnimationFrame);const start=performance.now();renderer.draw({lat0:45.46,lon0:9.19+i*.2,s:152*zoom},320,352,[45.46,9.19]);submit+=performance.now()-start;}frames.push({zoom,submitMs:submit/3});}
  console.log('GPU test: rendered frames');const renderReads=reads;const gl=renderer.canvas.getContext('webgl'),debug=gl.getExtension('WEBGL_debug_renderer_info');const driver=debug?gl.getParameter(debug.UNMASKED_RENDERER_WEBGL):gl.getParameter(gl.RENDERER);const cases=[[42.4791,3.3699],[42.4791165,3.369903005],[41.1155,85.1845],[22.3193,114.1694],[22.1987,113.5439],[43.7384,7.4246],[46.345,48.766],[24.881,59.984],[38.012,.082]];
  for(const point of data.points.values())cases.push(point);
  for(let i=0;i<200;i++)cases.push([-80+(i*37.137)%160,-179+(i*79.317)%358]);
  const mismatches=[];const start=performance.now();for(const [lat,lon]of cases){const actual=renderer.pick(lat,lon),expected=data.lookupAll(lat,lon);if(JSON.stringify(actual?.slice().sort())!==JSON.stringify(expected.slice().sort()))mismatches.push({lat,lon,actual,expected});}
  const pickMs=(performance.now()-start)/cases.length;console.log('GPU test: validated picks');
  renderer.draw({lat0:45.46,lon0:9.19,s:152},320,352,[45.46,9.19]);
  WebGLRenderingContext.prototype.readPixels=read;
  window.gpuTest={renderer,svg};return {driver,frames,pickMs,renderReads,pickReads:reads-renderReads,cases:cases.length,mismatches,picking:svg.dataset.picking};
 });
 console.log(JSON.stringify(result));assert.ok(!result.error,result.error);assert.equal(result.picking,'gpu');assert.equal(result.renderReads,0);assert.deepEqual(result.mismatches,[]);
 await page.screenshot({path:'/private/tmp/globe-webgl.png'});fs.writeFileSync('/private/tmp/globe-gpu-results.json',JSON.stringify(result,null,2));
 const fallback=await page.evaluate(async()=>{const {renderer}=window.gpuTest;renderer.canvas.getContext('webgl').getExtension('WEBGL_lose_context').loseContext();await new Promise(r=>setTimeout(r,30));const draws=renderer.draw({lat0:0,lon0:0,s:152},320,352,null);renderer.destroy();return draws;});assert.equal(fallback,false,'Context loss requests the CPU fallback');assert.deepEqual(errors,[]);
 console.log('GPU globe: no per-frame readback; polygon, hole, tiny-region, and overlap picking match CPU');
}finally{await browser?.close();server.closeAllConnections();await new Promise(r=>server.close(r));}
