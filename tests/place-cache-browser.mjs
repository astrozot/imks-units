// Browser regression checks for online search in the Places modal.
// Uses the same PLAYWRIGHT and CHROME options as browser.mjs.
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

let chromium;
for (const name of [process.env.PLAYWRIGHT && path.join(process.env.PLAYWRIGHT, "index.mjs"), "playwright-core", "playwright"].filter(Boolean)) {
  try { ({ chromium } = await import(name)); break; } catch { /* next */ }
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

const context = await browser.newContext({serviceWorkers:'block'});
await context.route('https://celestrak.org/**',r=>r.fulfill({json:[]}));
let requests=0, offline=false;
await context.route('https://nominatim.openstreetmap.org/search?**',r=>{
 requests++;if(offline)return r.abort();return r.fulfill({json:[{name:'Carisolo',display_name:'Carisolo, Trentino, Italia',lat:'46.2258024',lon:'10.7186366',category:'boundary',addresstype:'city',boundingbox:['46.1585462','46.2412545','10.6782764','10.7739220']}]});
});
await context.route('https://photon.komoot.io/**',r=>offline?r.abort():r.fulfill({json:{features:[{properties:{name:'Carisolo',osm_key:'place',osm_value:'village'},geometry:{type:'Point',coordinates:[10.7591591,46.1687756]}}]}}));
await context.route('https://api.open-meteo.com/**',r=>offline?r.abort():r.fulfill({json:{elevation:[798]}}));
const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
const old={name:'Carisolo, Trentino, Italia',lat:46.2258024,lon:10.7186366,h:2417};
const seed=async(selected)=>page.evaluate(({old,selected})=>{
 localStorage.setItem('imks.lookups',JSON.stringify({objects:{},places:{carisolo:old}}));
 localStorage.setItem('imks.coelumPlace',JSON.stringify(selected));
}, {old,selected});
const waitCorrect=()=>page.waitForFunction(()=>{
 const p=JSON.parse(localStorage.getItem('imks.coelumPlace'));return p?.h===798&&p.lat===46.1687756&&p.lon===10.7591591;
});
try {
 await page.goto(url+'coelum/');
 await seed(old);await page.reload();await waitCorrect();
 assert.equal(requests,1,'Opening the old selected place refreshes its cached coordinates');
 assert.equal(await page.evaluate(()=>JSON.parse(localStorage.getItem('imks.lookups')).places.carisolo.lookupVersion),1);
 offline=true;await page.reload();await page.waitForSelector('.coelum-full');
 await page.click('[data-action="place"]');
 assert.equal(await page.locator('[data-place-elevation]').inputValue(),'798','Corrected location survives an offline restart');
 assert.equal(requests,1);
 offline=false;
 await seed({name:'Greenwich',lat:51.4769,lon:-.0005,h:46});await page.reload();
 await page.click('[data-action="place"]');await page.fill('.coelum-place-form input','Carisolo');
 assert.match(await page.locator('.coelum-place-results').textContent(),/Update saved coordinates online/);
 assert.doesNotMatch(await page.locator('.coelum-place-results').textContent(),/2417/);
 await page.click('[data-place-index="0"]');await waitCorrect();assert.equal(requests,2,'Selecting a legacy suggestion refreshes it before use');
 await seed({...old,h:3000});await page.reload();await page.click('[data-action="place"]');
 assert.equal(await page.locator('[data-place-elevation]').inputValue(),'3000','Manually changed elevations are preserved');
 assert.equal(requests,2);
 assert.deepEqual(errors,[]);
 console.log('Legacy Carisolo selection, startup migration, offline persistence and manual-height checks passed');
} finally {await browser.close();server.close();}
