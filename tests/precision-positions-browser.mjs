// Detail-card integration, no automatic work, snapshots, caching and cancel.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import crypto from 'node:crypto';
import {fileURLToPath} from 'node:url';
let engines;for(const name of [process.env.PLAYWRIGHT&&path.join(process.env.PLAYWRIGHT,'index.mjs'),'playwright-core','playwright'].filter(Boolean)){try{engines=await import(name);break;}catch{}}
if(!engines)throw new Error('Playwright is required');
const staged=process.env.EXTENDED_STAGED,remote=process.env.EXTENDED_URL,stamp=process.env.POSITION_TIME||'2024-04-08T18:42:00Z';
const historical=new Date(stamp).getUTCFullYear()<1550;
const root=fileURLToPath(new URL('../',import.meta.url)),hash=b=>crypto.createHash('sha256').update(b).digest('hex'),objects=new Map(),manifest=staged?JSON.parse(fs.readFileSync(process.env.NATIVE_CATALOGUE||path.join(staged,'manifest.json'))):{version:2,chunkBytes:262144,kernels:{}};
if(!staged)for(const [id,name] of [['de440','de440-native.bsp'],['jup365','jup365-native.bsp'],['sat441','sat441-native.bsp'],['iers','iers-native.txt']]){
 const bytes=fs.readFileSync(path.join(root,'tests/fixtures',name)),prefix=`${id==='iers'?'iers':'kernels'}/${id}-${hash(bytes)}`,index=Buffer.from(hash(bytes),'hex');
 objects.set(prefix+'/000000.bin',bytes);objects.set(prefix+'/index.bin',index);
 const d={path:prefix,bytes:bytes.length,sha256:hash(bytes),indexBytes:32,indexSha256:hash(index)};
 if(id==='iers')manifest.earthOrientation=d;else manifest.kernels[id]=d;
}
let requests=0;
const server=http.createServer((req,res)=>{
 const url=new URL(req.url,'http://localhost');
 if(url.pathname==='/js/precisionconfig.js'){res.writeHead(200,{'Content-Type':'text/javascript'}).end(`export const STATIC_DATA_URL=${JSON.stringify(remote||`http://localhost:${server.address().port}/_native/`)};export const R2_DATA_URL='';export const EPHEMERIS_SERVICE='';export const EPHEMERIS_YEARS=[-1000,3000];`);return;}
 if(url.pathname.startsWith('/_native/')){requests++;const key=url.pathname.slice('/_native/'.length),bytes=key==='manifest.json'?Buffer.from(JSON.stringify(manifest)):staged?fs.readFileSync(path.join(staged,key)):objects.get(key);if(!bytes){res.writeHead(404).end();return;}res.writeHead(200,{'Content-Type':key.endsWith('.json')?'application/json':'application/octet-stream','Content-Length':String(bytes.length)}).end(bytes);return;}
 const file=path.join(root,url.pathname.replace(/\/$/,'/index.html'));if(!file.startsWith(root)||!fs.existsSync(file)){res.writeHead(404).end();return;}
 res.writeHead(200,{'Content-Type':({'.js':'text/javascript','.html':'text/html','.css':'text/css','.json':'application/json'})[path.extname(file)]||'application/octet-stream'});fs.createReadStream(file).pipe(res);
});
await new Promise(r=>server.listen(0,'127.0.0.1',r));let browser;
try{
 const safari=process.env.ENGINE==='webkit',engine=safari?'webkit':'chromium',executablePath=safari?process.env.WEBKIT:process.env.CHROME;
 browser=await engines[engine].launch(executablePath?{executablePath}:{});const context=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true});
 await context.route('https://celestrak.org/**',r=>r.fulfill({contentType:'application/json',body:'[]'}));
 await context.addInitScript(()=>{const Native=Worker;window.workers=0;window.Worker=class extends Native{constructor(...a){super(...a);workers++;this.alive=true;}terminate(){if(this.alive){workers--;this.alive=false;}super.terminate();}postMessage(message,...rest){if(message.kind==='position')window.lastPositionTime=message.t;return super.postMessage(message,...rest);}};});
 const page=await context.newPage(),errors=[];page.setDefaultTimeout(remote?60000:20000);page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>{if(remote&&r.url().startsWith(remote))requests++;});
 await page.goto(`http://localhost:${server.address().port}/coelum/`);await page.waitForSelector('.coelum-full');await page.waitForFunction(()=>Boolean(navigator.serviceWorker.controller));
 assert.equal(requests,0);assert.equal(await page.evaluate(()=>workers),0);
 await page.evaluate(async stamp=>{
  document.querySelector('#coelum').remove();const root=document.createElement('main');root.id='coelum';root.className='coelum-explorer';document.body.append(root);
  const {mountCoelum}=await import('/js/coelumui.js');window.startTime=Date.parse(stamp)/1000;
  window.explorer=mountCoelum(root,{t:startTime,place:[45.4642,9.19,120],label:'Milan'},t=>new Date(t*1000).toISOString(),{standalone:true});
  explorer.select('Moon',{details:true});
 },stamp);
 try{await page.locator('[data-precise-position]').waitFor({state:'visible'});}catch(error){console.log(await page.evaluate(()=>({root:document.querySelector('#coelum').className,hidden:document.querySelector('[data-object-precision]').hidden,basic:document.querySelector('[data-object-basic]').textContent})),errors);throw error;}assert.equal(requests,0,'Opening details never downloads or calculates');
 if(!safari){const cdp=await context.newCDPSession(page);await cdp.send('Emulation.setCPUThrottlingRate',{rate:6});}
 await page.locator('[data-action="play"]').click();
 const responsiveness=await page.evaluate(async()=>{
  window.measureFrames=untilDone=>new Promise(resolve=>{const gaps=[];let first=performance.now(),last=first;const frame=now=>{gaps.push(now-last);last=now;if(untilDone?!window.endPositionFrames:now-first<1200)requestAnimationFrame(frame);else{gaps.sort((a,b)=>a-b);resolve({frames:gaps.length,p95GapMs:gaps[Math.floor(gaps.length*.95)],maxGapMs:Math.max(...gaps)});}};requestAnimationFrame(frame);});
  const before=await measureFrames(false);window.endPositionFrames=false;window.positionFrames=measureFrames(true);return {before};
 });
 const button=page.locator('[data-precise-position]'),basic=page.locator('[data-object-basic]');
 const initialBox=await button.boundingBox();
 await button.click();await page.waitForFunction(()=>document.querySelector('[data-precise-position]').getAttribute('aria-pressed')==='true');
 responsiveness.during=await page.evaluate(()=>{endPositionFrames=true;return positionFrames;});
 assert.ok(responsiveness.during.p95GapMs<=Math.max(100,responsiveness.before.p95GapMs*1.5),'Precise detail calculation preserves the throttled animation budget');
 await page.locator('[data-action="play"]').click();await page.evaluate(()=>explorer.setTime(lastPositionTime));
 assert.match(await basic.textContent(),historical?/DE441/:/DE440/);assert.equal(await page.evaluate(()=>workers),0);
 assert.equal(await page.locator('[data-precise-clear], [data-precise-result]').count(),0,'No extra result or clear-cache controls');
 assert.equal((await button.boundingBox()).width,initialBox.width,'Button size stays fixed');
 const topocentric=await basic.textContent();await page.selectOption('[data-precise-frame]','geocentric');
 assert.notEqual(await basic.textContent(),topocentric);assert.doesNotMatch(await basic.textContent(),/Altitude \(Alt\)/);
 const count=requests;
 await button.click();assert.match(await button.textContent(),/Approx/);assert.doesNotMatch(await basic.textContent(),/DE440|DE441/);
 const approxGeo=await basic.textContent();await page.selectOption('[data-precise-frame]','topocentric');assert.notEqual(await basic.textContent(),approxGeo);assert.match(await basic.textContent(),/Altitude \(Alt\)/);
 if(!safari)await context.setOffline(true);await button.click();assert.equal(await button.getAttribute('aria-pressed'),'true');assert.equal(requests,count,'Switching models does not fetch or calculate');assert.equal(await page.evaluate(()=>workers),0);await context.setOffline(false);
 await page.evaluate(()=>explorer.setTime(startTime+30));assert.equal(requests,count,'Changing the clock never downloads automatically');assert.match(await basic.textContent(),/DE440|DE441/,'JPL snapshot keeps its explicit timestamp during animation');
 await button.click();assert.equal(await button.getAttribute('aria-pressed'),'false');assert.equal(await button.textContent(),'JPL Ephemeris','A changed epoch requests a fresh calculation on the next explicit click');assert.equal(requests,count);
 const extraBodies=historical?['Sun','Mercury','Venus','Jupiter']:['Jupiter','Io','Saturn','Titan'];
 for(const body of extraBodies){
  await page.evaluate(name=>explorer.select(name,{details:true}),body);await button.waitFor({state:'visible'});
  await button.click();await page.waitForFunction(()=>document.querySelector('[data-precise-position]').getAttribute('aria-pressed')==='true');
  assert.match(await basic.textContent(),historical&&body==='Jupiter'?/system barycentre/:/DE440|DE441/);assert.equal(await page.evaluate(()=>workers),0);
 }
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,'Detail UI fits phone width');
 const toolbar=await page.locator('[data-object-precision]').boundingBox(),selector=await page.locator('[data-precise-frame]').boundingBox(),toggleBox=await button.boundingBox();assert.ok(Math.abs(selector.y-toggleBox.y)<2,'Coordinates and toggle fit one line');assert.ok(toolbar.y<(await basic.boundingBox()).y,'Toolbar is above existing fields');
 const headingBox=await page.locator('[data-object-heading]').boundingBox();assert.ok(headingBox.y+headingBox.height<=toolbar.y+1,'Name stays above the smaller ephemeris controls');
 assert.ok(Number.parseFloat(await button.evaluate(el=>getComputedStyle(el).fontSize))<13);
 assert.ok(Number.parseFloat(await page.locator('[data-precise-frame]').evaluate(el=>getComputedStyle(el).fontSize))<13);
 if(process.env.SCREENSHOT)await page.screenshot({path:process.env.SCREENSHOT,fullPage:true});
 // Long lunar classifications must wrap without squeezing the feature name.
 for(const width of [390,320]){
  await page.setViewportSize({width,height:844});
  const layout=await page.evaluate(async()=>{
   const {lunarFeatureDetails,searchLunarFeatures}=await import('/js/lunarfeatures.js'),heading=document.querySelector('[data-object-heading]'),old=heading.innerHTML,holder=document.createElement('div');
   holder.innerHTML=lunarFeatureDetails(searchLunarFeatures('Montes Jura')[0]);heading.replaceChildren(holder.firstElementChild);
   const title=heading.querySelector('h3'),type=heading.querySelector('.coelum-object-head > span'),a=title.getBoundingClientRect(),b=type.getBoundingClientRect(),line=Number.parseFloat(getComputedStyle(title).lineHeight),box=heading.getBoundingClientRect();
   const result={title:title.textContent,height:a.height,line,typeBelow:b.y>=a.bottom-1,fits:b.right<=box.right+1};heading.innerHTML=old;return result;
  });
  assert.equal(layout.title,'Montes Jura');assert.ok(layout.height<=layout.line*1.1,'Feature name stays on one readable line');assert.ok(layout.typeBelow&&layout.fits,'Long classification wraps below the name');
 }
 await page.setViewportSize({width:390,height:844});
 // Guarantee a pending Fetch API read, then close the detail card.
 await page.evaluate(async()=>{await (await import('/js/precisionui.js')).clearPrecisionData();explorer.select('Moon',{details:true});});
 await page.evaluate(()=>{
  window.realFetch=fetch;window.positionReads=0;window.positionAborts=0;
  window.fetch=(url,options={})=>(String(url).includes('/_native/')||String(url).includes('/kernels/'))?new Promise((resolve,reject)=>{positionReads++;options.signal.addEventListener('abort',()=>{positionAborts++;reject(new DOMException('Cancelled','AbortError'));},{once:true});}):realFetch(url,options);
  document.querySelector('[data-precise-position]').click();
 });
 await page.waitForFunction(()=>positionReads>0&&workers===1);await page.locator('[data-action="deselect"]').click();
 await page.waitForFunction(()=>workers===0&&positionAborts>0);
 await page.evaluate(()=>explorer.select('Jupiter',{details:true}));await page.locator('[data-precise-position]').click();
 await page.waitForFunction(()=>positionReads>1&&workers===1);await page.locator('[data-action="layers"]').click();
 await page.waitForFunction(()=>workers===0&&positionAborts>1);await page.locator('[data-action="layers"]').click();
 await page.locator('[data-precise-position]').click();await page.waitForFunction(()=>positionReads>2&&workers===1);
 await page.locator('.coelum-moons-button').click();await page.waitForFunction(()=>workers===0&&positionAborts>2);
 assert.deepEqual(errors,[]);const report={engine,source:remote||'local native fixtures',cpuThrottleRate:safari?1:6,responsiveness,requests,autoDownloads:0,positionCases:['Moon',...extraBodies],offline:safari?'Cache-only reuse (WebKit emulator limitation)':'Passed',cancel:'Fetch aborted and worker terminated',errors};console.log(JSON.stringify(report,null,2));if(process.env.REPORT)fs.writeFileSync(process.env.REPORT,JSON.stringify(report,null,2)+'\n');
}finally{await browser?.close();await new Promise(r=>server.close(r));}
