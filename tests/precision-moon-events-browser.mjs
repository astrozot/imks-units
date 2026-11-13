// Detail-card integration, no automatic work, snapshots, caching and cancel.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import crypto from 'node:crypto';
import {fileURLToPath} from 'node:url';
let engines;for(const name of [process.env.PLAYWRIGHT&&path.join(process.env.PLAYWRIGHT,'index.mjs'),'playwright-core','playwright'].filter(Boolean)){try{engines=await import(name);break;}catch{}}
if(!engines)throw new Error('Playwright is required');
const staged=process.env.EXTENDED_STAGED,remote=process.env.EXTENDED_URL,stamp=process.env.POSITION_TIME||'2024-04-08T00:00:00Z';
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
 await page.evaluate(async stamp=>{
  document.querySelector('#coelum').remove();const root=document.createElement('main');root.id='coelum';root.className='coelum-explorer';document.body.append(root);
  const {mountCoelum}=await import('/js/coelumui.js');window.explorer=mountCoelum(root,{t:Date.parse(stamp)/1000,place:[45.4642,9.19,120],label:'Milan'},t=>new Date(t*1000).toISOString(),{standalone:true});
 },stamp);
 if(!safari){const cdp=await context.newCDPSession(page);await cdp.send('Emulation.setCPUThrottlingRate',{rate:6});}
 const open=async name=>{await page.evaluate(name=>explorer.select(name,{details:true}),name);await page.locator('.coelum-moons-button').click();await page.locator('[data-action="moon-events"]').click();await page.locator('[data-moon-events-more]').waitFor({state:'visible'});};
 const panel=page.locator('.coelum-moon-events'),button=panel.locator('[data-precision-run]');
 let first=true;const cases=[];
 for(const [name,date] of (staged?[['Mars',stamp],['Jupiter',stamp],['Saturn',stamp],['Uranus','2007-12-07T00:00:00Z'],['Neptune','2046-06-01T00:00:00Z']]:[['Jupiter',stamp],['Saturn',stamp]])){
  await page.evaluate(s=>explorer.setTime(Date.parse(s)/1000),date);await open(name);if(first){assert.equal(requests,0);assert.equal(await page.evaluate(()=>workers),0);first=false;}
  const approx=await panel.locator('[data-moon-event]').allTextContents();assert.ok(approx.length>0);
  const before=requests;await button.click();await page.waitForFunction(()=>document.querySelector('.coelum-moon-events [data-precision-run]').getAttribute('aria-pressed')==='true');
  assert.equal(await page.evaluate(()=>workers),0);assert.ok(requests>=before);assert.match(await panel.textContent(),/Native orbits/);
  const clockRows=await panel.locator('[data-moon-event]').allTextContents();assert.ok(clockRows.every(s=>/\d{2}:\d{2}:\d{2}\.\d/.test(s)),'JPL contacts have tenths of a second');assert.ok(clockRows.every(s=>!s.includes('UTC')&&!s.includes('Europe/')),'Timezone appears once in the panel, not in every contact');assert.equal(await panel.locator('.coelum-event-date').count(),await panel.locator('[data-moon-event]').count());
  const precise=await panel.locator('[data-moon-event]').allTextContents();assert.ok(precise.length>0);assert.notDeepEqual(precise,approx);
  const count=requests;if(!safari)await context.setOffline(true);await button.click();assert.deepEqual(await panel.locator('[data-moon-event]').allTextContents(),approx);await button.click();assert.deepEqual(await panel.locator('[data-moon-event]').allTextContents(),precise);assert.equal(requests,count);assert.equal(await page.evaluate(()=>workers),0);await context.setOffline(false);
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
  cases.push({system:name,nativeRows:precise.length});
  if(process.env.SCREENSHOT)await page.screenshot({path:process.env.SCREENSHOT,fullPage:true});
  await panel.locator('[data-moon-events-close]').click();await page.locator('[data-action="close-moons"]').click();
 }
 // UI cancellation while source data is in flight, then closing a panel.
 await page.evaluate(async()=>{await (await import('/js/precisionui.js')).clearPrecisionData();});await open('Jupiter');
 await page.evaluate(()=>{window.realFetch=fetch;window.held=0;window.aborted=0;window.fetch=(url,options={})=>String(url).includes('/_native/')?new Promise((resolve,reject)=>{held++;options.signal.addEventListener('abort',()=>{aborted++;reject(new DOMException('Cancelled','AbortError'));},{once:true});}):realFetch(url,options);});
 await button.click();await page.waitForFunction(()=>workers===1&&held>0);assert.equal(await button.textContent(),'Downloading…');await button.click();await page.waitForFunction(()=>workers===0&&aborted>0);
 await button.click();await page.waitForFunction(()=>workers===1&&held>1);await panel.locator('[data-moon-events-close]').click();await page.waitForFunction(()=>workers===0&&aborted>1);
 assert.deepEqual(errors,[]);const report={engine,cpuThrottleRate:safari?1:6,cases,optionalStartupRequests:0,requests,cancel:'Passed',reuse:safari?'Cache-only (WebKit offline emulator limitation)':'Offline',errors};console.log(JSON.stringify(report,null,2));if(process.env.REPORT)fs.writeFileSync(process.env.REPORT,JSON.stringify(report,null,2)+'\n');
}finally{await browser?.close();await new Promise(r=>server.close(r));}
