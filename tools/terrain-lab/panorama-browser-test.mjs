// Usage: PLAYWRIGHT=... CHROME=... node panorama-browser-test.mjs URL [OUTPUT_DIR]
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
let chromium;
for (const name of [process.env.PLAYWRIGHT && path.join(process.env.PLAYWRIGHT, 'index.mjs'), 'playwright-core', 'playwright'].filter(Boolean)) { try { ({chromium}=await import(name)); break; } catch {} }
if (!chromium) throw new Error('Playwright required');
const out=path.resolve(process.argv[3]??'/tmp/imks-panorama-verified'); await fs.mkdir(out,{recursive:true});
const browser=await chromium.launch(process.env.CHROME?{executablePath:process.env.CHROME}:{});
try {
  const page=await browser.newPage({viewport:{width:1500,height:1100}}), errors=[], tileRequests=[];
  page.on('pageerror',e=>errors.push(e.message)); page.on('request',r=>{if(r.url().includes('/tile/'))tileRequests.push(r.url());});
  await page.goto(process.argv[2]??'http://127.0.0.1:8766/panorama.html?proxy=1');
  await page.click('#build');
  await page.waitForFunction(()=>window.panoramaLab.ready||document.getElementById('status').textContent.startsWith('Failed'),null,{timeout:180000});
  assert.equal(await page.evaluate(()=>window.panoramaLab.ready),true,await page.locator('#status').textContent());
  async function settled(){await page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));}
  async function pixels(){await settled();return page.evaluate(()=>{const c=document.querySelector('canvas'),g=c.getContext('webgl2'),p=new Uint8Array(c.width*c.height*4);g.readPixels(0,0,c.width,c.height,g.RGBA,g.UNSIGNED_BYTE,p);return Array.from(p.filter((_,i)=>i%4!==3));});}
  const initial=await page.evaluate(()=>window.panoramaLab.getState());
  assert.equal(initial.config.eye,90);assert.equal(initial.config.lat,45.89617);assert.equal(initial.metrics.missingVertices,0);assert.equal(initial.renderMetrics.glError,0);
  assert.equal(initial.metrics.water?.model,'natural-earth-v1');assert.equal(initial.metrics.water?.elevation,undefined);
  const download=page.waitForEvent('download');await page.click('#saveSurface');const saved=await download;await saved.saveAs(path.join(out,'surface.json'));
  const payload=JSON.parse(await fs.readFile(path.join(out,'surface.json'),'utf8'));assert.equal(payload.version,2);
  const count=tileRequests.length;
  const samples={};
  for(const [name,date]of Object.entries({day:'2026-06-21T12:00',afternoon:'2026-11-18T14:00',moonlit:'2026-11-24T22:00',moonless:'2026-11-09T22:00'})){
    await page.selectOption('#preset',date);const data=await pixels();
    samples[name]={mean:data.reduce((s,x)=>s+x,0)/data.length,lighting:(await page.evaluate(()=>window.panoramaLab.getState())).lighting};
    await page.locator('#panorama').screenshot({path:path.join(out,`${name}.png`)});
  }
  assert.ok(samples.day.mean>samples.moonlit.mean*5);
  assert.ok(samples.moonlit.mean>samples.moonless.mean*1.1,'Full Moon must visibly increase terrain brightness');
  await page.selectOption('#preset','2026-06-21T12:00');const shaded=await pixels();
  await page.click('#appearanceButton');
  await page.uncheck('#shadows');const unshaded=await pixels();
  let darker=0,brighter=0,delta=0;for(let i=0;i<shaded.length;i++){delta+=unshaded[i]-shaded[i];if(unshaded[i]-shaded[i]>3)darker++;if(shaded[i]-unshaded[i]>3)brighter++;}
  assert.ok(darker>100,'Shadows must darken mountain surfaces');assert.equal(brighter,0,'Shadows must not brighten surfaces');assert.ok(delta>0);
  await page.check('#shadows');await page.click('#closeAppearance');await page.evaluate(()=>window.panoramaLab.setView({az:214}));await settled();assert.equal(tileRequests.length,count,'Camera and lighting must reuse terrain');
  // Round-trip with all tile requests blocked verifies offline surface restoration.
  await page.route('**/tile/**',route=>route.abort());await page.locator('#restore').setInputFiles(path.join(out,'surface.json'));
  await page.waitForFunction(()=>document.getElementById('status').textContent.startsWith('Saved surface restored'));
  await pixels();assert.equal(tileRequests.length,count);
  // Reject malformed files without replacing the existing surface.
  await page.locator('#restore').setInputFiles({name:'bad.json',mimeType:'application/json',buffer:Buffer.from('{"version":2}')});
  await page.waitForFunction(()=>document.getElementById('status').textContent.startsWith('Failed:'));
  assert.equal((await page.evaluate(()=>window.panoramaLab.getState())).config.eye,90);
  await page.locator('#restore').setInputFiles(path.join(out,'surface.json'));
  await page.waitForFunction(()=>document.getElementById('status').textContent.startsWith('Saved surface restored'));
  await page.setViewportSize({width:390,height:844});await settled();assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),true);
  await page.screenshot({path:path.join(out,'mobile.png'),fullPage:true});
  const timingStart=performance.now();for(let i=0;i<5;i++){await page.evaluate(i=>window.panoramaLab.setView({az:204+i}),i);await pixels();}
  const readbackFrameMs=(performance.now()-timingStart)/5;
  await page.click('#build');await page.click('#cancel');assert.equal(await page.locator('#build').isEnabled(),true);assert.match(await page.locator('#status').textContent(),/cancelled/);
  assert.deepEqual(errors,[]);
  const report={initial, samples, shadowCheck:{darkerChannels:darker,brighterChannels:brighter},tileRequests:count,mobileReadbackRoundTripMs:readbackFrameMs,note:'Readback round trip includes browser automation and GPU synchronisation; desktop with phone viewport, not physical-phone performance.',errors};
  await fs.writeFile(path.join(out,'verification.json'),JSON.stringify(report,null,2));
  console.log(JSON.stringify({status:'passed',out,samples:Object.fromEntries(Object.entries(samples).map(([k,v])=>[k,v.mean])),shadows:{darker,brighter},readbackFrameMs}));
}finally{await browser.close();}
