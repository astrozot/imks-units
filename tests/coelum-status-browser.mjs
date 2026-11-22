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
 localStorage.setItem('imks.coelumPlace',JSON.stringify({name:'Carisolo, Comunità delle Giudicarie, Provincia di Trento, Trentino-Alto Adige/Südtirol, Italia',lat:46.1687756,lon:10.7591591,h:798}));
 localStorage.setItem('imks.coelumTimeZone','"utc"');
});
const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
try {
 await page.goto(url+'coelum/');await page.waitForSelector('.coelum-full');
 for(const width of [320,360,390,768]){
  await page.setViewportSize({width,height:844});
  await page.waitForTimeout(100);
  const result=await page.evaluate(()=>{
   const time=document.querySelector('.coelum-status-main [data-action="time"]'),place=document.querySelector('.coelum-status-main [data-action="place"]'),side=document.querySelector('.coelum-clock-side');
   return {text:time.textContent,timeFits:time.scrollWidth<=time.clientWidth,placeClipped:place.scrollWidth>place.clientWidth,ellipsis:getComputedStyle(place).textOverflow,separate:time.getBoundingClientRect().right<=place.getBoundingClientRect().left,sideFits:place.getBoundingClientRect().right<=side.getBoundingClientRect().left,fullLabel:place.title,bodyFits:document.documentElement.scrollWidth<=innerWidth};
  });
  assert.equal(result.text,'2026-11-22 12:34:56');
  assert.ok(result.timeFits&&result.separate&&result.sideFits&&result.bodyFits,JSON.stringify({width,...result}));
  assert.ok(result.placeClipped,'Long location truncates at '+width);
  assert.equal(result.ellipsis,'ellipsis');
  assert.match(result.fullLabel,/Provincia di Trento/);
 }
 assert.deepEqual(errors,[]);
 console.log('Bottom bar: complete seconds timestamp and truncated location passed at 320, 360, 390 and 768 px');
}finally{await browser.close();server.close();}
