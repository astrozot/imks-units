// Heightfield horizon shadows: a lit plane never darkens, a ridge's shadow ends
// where geometry says (height / tan altitude), and its penumbra matches the
// Sun's disc. No external imagery or elevation provider is used.
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
let type;
for(const name of [process.env.PLAYWRIGHT&&path.join(process.env.PLAYWRIGHT,'index.mjs'),'playwright-core','playwright'].filter(Boolean)){try{type=(await import(name))[process.env.TERRAIN_BROWSER||'chromium'];break;}catch{}}
if(!type)throw new Error('Playwright required');
const root=fileURLToPath(new URL('../',import.meta.url)),server=http.createServer((req,res)=>{
 const name=path.join(root,new URL(req.url,'http://localhost').pathname);
 if(!name.startsWith(root)||!fs.existsSync(name)||fs.statSync(name).isDirectory()){res.writeHead(404);res.end();return;}
 res.writeHead(200,{'content-type':name.endsWith('.js')?'text/javascript':'text/html'});fs.createReadStream(name).pipe(res);
});await new Promise(r=>server.listen(0,'127.0.0.1',r));
const browser=await type.launch(process.env.CHROME?{executablePath:process.env.CHROME}:{});
try{
 const page=await browser.newPage({viewport:{width:900,height:600}});await page.goto(`http://127.0.0.1:${server.address().port}/coelum/index.html`);
 const results=await page.evaluate(async()=>{
  const{createTerrainRenderer}=await import('/js/terrainrender.js'),{lookAt}=await import('/js/coelum.js'),{makeRing}=await import('/js/terrainmesh.js');
  const metres=111194.9,c=document.createElement('canvas'),r=createTerrainRenderer(c);
  const pixels=()=>{const g=c.getContext('webgl2'),p=new Uint8Array(c.width*c.height*4);g.readPixels(0,0,c.width,c.height,g.RGBA,g.UNSIGNED_BYTE,p);return p;};
  // An inclined plane: every point either faces the light or not, so cast
  // shadows may never darken anything that diffuse lighting leaves lit.
  r.setMeshes([makeRing({place:[0,0,0],sample:(lat,lon)=>.35*lon*metres+.18*lat*metres-200,extent:30000,divisions:64,gridSize:512})]);
  const plane=[];
  for(const az of [140,180,220,260])for(const alt of [8,17,35,60]){
   const options={W:700,H:400,radius:550,rotation:lookAt(0,10),sun:{az,alt},moon:{az:0,alt:-90},flux:0,exposure:1.6,outlines:false};
   r.draw({...options,shadows:false});const lit=pixels(),info=r.draw({...options,shadows:true}),shaded=pixels();let compared=0,dark=0,max=0;
   for(let i=0;i<lit.length;i+=4)if(lit[i+3]&&shaded[i+3]){compared++;for(let j=0;j<3;j++){const d=lit[i+j]-shaded[i+j];if(d>3)dark++;max=Math.max(max,d);}}
   plane.push({az,alt,compared,dark,max,error:info.glError});
  }
  // An east-west ridge 300 m high (slopes up to 60°), 2 km north, lit from
  // due north. The crest lies on a texel centre so the grid has its height.
  const crest=-4000+768.5*8000/1024,ridge=(lat,lon)=>300*Math.exp(-(((lat*metres-crest)/100)**2));
  r.setMeshes([makeRing({place:[0,0,0],sample:ridge,extent:4000,divisions:64,gridSize:1024})]);
  const ends=[];
  for(const alt of [10,20,40]){
   r.draw({W:700,H:400,radius:550,rotation:lookAt(0,-10),sun:{az:0,alt},moon:{az:0,alt:-90},flux:0,exposure:1.6,shadows:true});
   const {size,extent,values}=r.readShadow(0),column=size/2,step=2*extent/size;
   // Walk south from the ridge to the last shadowed texel, then measure the
   // penumbra between 90% and 10% shadow.
   let end=null,outer=null,inner=null,reversals=0,previous=null,trend=0;
   for(let j=size-1;j>=0;j--){const y=-extent+(j+.5)*step,v=values[j*size+column];if(y>crest-250)continue;if(previous!==null&&v!==previous){const d=Math.sign(v-previous);if(trend&&d!==trend)reversals++;trend=d;}previous=v;if(v<230)inner=y;if(v<128)end=y;if(v<25)outer=y;}
   ends.push({alt,reversals,expected:crest-300/Math.tan(alt*Math.PI/180),crest,end,penumbra:outer-inner,expectedPenumbra:300/Math.sin(alt*Math.PI/180)**2*0.5332*Math.PI/180*.8,step});
  }
  r.destroy();return {plane,ends};
 });
 for(const result of results.plane){assert.equal(result.error,0);assert.ok(result.compared>1000);assert.ok(result.dark<result.compared*.001,JSON.stringify(result));}
 for(const e of results.ends){
  assert.equal(e.reversals,0,`Shadow edges must be smooth, not striped: ${JSON.stringify(e)}`);
  assert.ok(Math.abs(e.end-e.expected)<2*e.step+.03*(e.crest-e.expected),`Ridge shadow must end at height/tan(altitude): ${JSON.stringify(e)}`);
  // Penumbrae narrower than a few shadow texels cannot be resolved.
  assert.ok(e.penumbra<e.expectedPenumbra*2+3*e.step&&(e.expectedPenumbra<3*e.step||e.penumbra>e.expectedPenumbra*.5),`Penumbra must follow the solar disc: ${JSON.stringify(e)}`);
 }
 console.log(JSON.stringify({status:'passed',planeCases:results.plane.length,maxFalseDarkChannels:Math.max(...results.plane.map(x=>x.dark)),ridge:results.ends}));
}finally{await browser.close();await new Promise(r=>server.close(r));}
