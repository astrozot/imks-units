// Bottom-bar layout regression: long place labels must yield to the clock.
// Uses the same PLAYWRIGHT and CHROME options as browser.mjs.
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

let chromium;
for (const name of [process.env.PLAYWRIGHT && path.join(process.env.PLAYWRIGHT, "index.mjs"), "playwright-core", "playwright"].filter(Boolean)) {
  try { ({ [process.env.TERRAIN_BROWSER || 'chromium']: chromium } = await import(name)); break; } catch { /* next */ }
}
if (!chromium) {
  console.log("Skipped: Playwright is not installed (npm install playwright-core, and CHROME=/path/to/chrome)");
  process.exit(0);
}

// a static server for the app
const root = fileURLToPath(new URL("../", import.meta.url));
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".png": "image/png", ".webmanifest": "application/manifest+json", ".ico": "image/x-icon" };
const server = http.createServer((req, res) => {
  const file = path.join(root, decodeURIComponent(new URL(req.url, "http://x").pathname).replace(/\/$/, "/index.html"));
  if (!file.startsWith(root) || !fs.existsSync(file)) { res.writeHead(404); res.end(); return; }
  res.writeHead(200, { "content-type": TYPES[path.extname(file)] || "application/octet-stream" });
  fs.createReadStream(file).pipe(res);
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const url = `http://localhost:${server.address().port}/`;


import assert from "node:assert/strict";
const browser = await chromium.launch(process.env.CHROME ? { executablePath: process.env.CHROME } : {});


const context=await browser.newContext({serviceWorkers:'block'});
await context.clock.setFixedTime(new Date('2026-11-22T12:34:56Z'));
await context.route('https://celestrak.org/**',r=>r.fulfill({json:[]}));
await context.addInitScript(()=>{
 if (!localStorage.getItem('imks.coelumPlace')) localStorage.setItem('imks.coelumPlace',JSON.stringify({name:'Carisolo, Comunità delle Giudicarie, Provincia di Trento, Trentino-Alto Adige/Südtirol, Italia',lat:46.1687756,lon:10.7591591,h:798}));
 localStorage.setItem('imks.coelumTimeZone','"utc"');
});
const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
try {
 await page.goto(url+'coelum/');await page.waitForSelector('.coelum-full');
 for(const width of [320,360,390,768]){
  await page.setViewportSize({width,height:844});
  await page.waitForTimeout(100);
  const result=await page.evaluate(()=>{
   const time=document.querySelector('.coelum-status-main [data-action="time"]'),place=document.querySelector('.coelum-status-main [data-action="place"]'),side=document.querySelector('.coelum-clock-side'),label=place.querySelector('.coelum-place-label'),condition=document.querySelector('.coelum-condition'),main=document.querySelector('.coelum-status-main');
   return {text:time.textContent,timeFits:time.scrollWidth<=time.clientWidth,placeClipped:label.scrollWidth>label.clientWidth,ellipsis:getComputedStyle(label).textOverflow,oneLine:label.clientHeight<=parseFloat(getComputedStyle(label).lineHeight)+1,conditionBelow:condition.getBoundingClientRect().top>=main.getBoundingClientRect().bottom,conditionFits:condition.getBoundingClientRect().bottom<=document.querySelector('.coelum-clock').getBoundingClientRect().bottom,conditionText:condition.textContent,separate:time.getBoundingClientRect().right<=place.getBoundingClientRect().left,sideFits:place.getBoundingClientRect().right<=side.getBoundingClientRect().left,fullLabel:place.title,bodyFits:document.documentElement.scrollWidth<=innerWidth};
  });
  assert.equal(result.text,'2026-11-22 12:34:56');
  assert.ok(result.timeFits&&result.separate&&result.sideFits&&result.bodyFits&&result.oneLine&&result.conditionBelow&&result.conditionFits,JSON.stringify({width,...result}));
  assert.ok(result.placeClipped,'Long location truncates at '+width);
  assert.equal(result.ellipsis,'ellipsis');
  assert.match(result.conditionText,/Sun .*°/);
  assert.match(result.fullLabel,/Provincia di Trento/);
 }
 await page.screenshot({path:'/private/tmp/coelum-status-long-place.png'});
 for (const viewport of [{width:320,height:568},{width:390,height:844},{width:568,height:320},{width:844,height:390}]) {
  await page.setViewportSize(viewport);
  for (const action of ['time','place']) {
   await page.locator(`.coelum-status-main [data-action="${action}"]`).click();
   const panel=page.locator(`.coelum-${action}panel`);
   const box=await panel.boundingBox(), bar=await page.locator('.coelum-timebar').boundingBox();
   if (viewport.width<viewport.height) {
    assert.ok(Math.abs(box.y+box.height-(bar.y-8))<=1, 'Portrait sheet sits directly above the status bar');
    assert.ok(box.y>=8 && box.x===8 && box.width===viewport.width-16);
   } else {
    assert.ok(box.y<=10 && box.y+box.height>=viewport.height-10, 'Landscape sheet uses the full available height');
    assert.ok(box.x>=0 && box.x+box.width<=viewport.width);
    await panel.evaluate(el=>el.scrollTop=el.scrollHeight);
    const last=await panel.locator(':scope > :last-child').boundingBox();
    assert.ok(last.y+last.height<=box.y+box.height, 'The bottom of the sheet remains reachable');
    await panel.evaluate(el=>el.scrollTop=0);
   }
   await page.screenshot({path:`/private/tmp/coelum-${action}-panel-${viewport.width}x${viewport.height}.png`});
   await panel.locator('[data-action="close-panel"]').click();
  }
 }

 await page.locator('[data-action="place"]').click();
 assert.equal(await page.locator('[data-place="barycentric"]').textContent(),'Sun');
 await page.locator('[data-place="barycentric"]').click();
 assert.equal(await page.locator('.coelum-status-main [data-action="place"]').textContent(),'Sun');
 assert.equal(await page.locator('.coelum-condition').textContent(),'Barycentric');
 // Existing saved barycenter names also display the short label.
 await page.evaluate(()=>localStorage.setItem('imks.coelumPlace',JSON.stringify({name:'Solar system barycenter',lat:46,lon:10,h:0,origin:'barycentric'})));
 await page.reload(); await page.waitForSelector('.coelum-full');
 assert.equal(await page.locator('.coelum-status-main [data-action="place"]').textContent(),'Sun');
 assert.deepEqual(errors,[]);
 console.log('Bottom bar: complete seconds timestamp and truncated location passed at 320, 360, 390 and 768 px');
}finally{await browser.close();server.close();}
