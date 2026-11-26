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
   r.draw({...options,shadows:false});const lit=pixels(),info=r.draw({...options,shadows:true,profile:true}),shaded=pixels();let compared=0,dark=0,max=0;
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
  // Progressive updates: the old shadows stay until a complete new set
  // replaces them, identical to an all-at-once computation.
  const view={W:300,H:200,radius:550,rotation:lookAt(0,-10),moon:{az:0,alt:-90},flux:0,exposure:1.6,shadows:true};
  r.draw({...view,sun:{az:0,alt:10}});const reference=r.readShadow(0).values;
  const p=createTerrainRenderer(document.createElement('canvas'));p.setMeshes([makeRing({place:[0,0,0],sample:ridge,extent:4000,divisions:64,gridSize:1024})]);
  p.draw({...view,sun:{az:0,alt:20},progressive:true});const before=p.readShadow(0).values;
  let frames=0,unchanged=true;
  for(let pending=true;pending&&frames<500;frames++){const result=p.draw({...view,sun:{az:0,alt:10},progressive:true,shadowBudgetMs:.01});pending=result.shadowsPending;if(pending&&p.readShadow(0).values.some((v,i)=>v!==before[i]))unchanged=false;}
  const after=p.readShadow(0).values;let different=0;for(let i=0;i<after.length;i++)if(after[i]!==reference[i])different++;
  // The light moves during an update (playback), then stops (pause): drawing
  // only while shadows report pending must end with the latest light's shadows.
  r.draw({...view,sun:{az:0,alt:12}});const latest=r.readShadow(0).values;
  p.draw({...view,sun:{az:0,alt:20},progressive:true});for(let i=0;i<3;i++)p.draw({...view,sun:{az:0,alt:10},progressive:true});
  let catchUp=0;for(let pending=true;pending&&catchUp<800;catchUp++)pending=p.draw({...view,sun:{az:0,alt:12},progressive:true}).shadowsPending;
  const caught=p.readShadow(0).values;let stale=0;for(let i=0;i<caught.length;i++)if(caught[i]!==latest[i])stale++;
  p.destroy();
  // A ridge oblique to the grid, 1.7 km from where its shadow ends: the march
  // reads it from the coarser second ring (31 m texels). Its shadow edge on
  // level ground must be a straight line, not a sawtooth of occluder texels.
  const toSun=[Math.sin(150*Math.PI/180),Math.cos(150*Math.PI/180)],along=[-toSun[1],toSun[0]];
  const oblique=(lat,lon)=>300*Math.exp(-((((lon*toSun[0]+lat*toSun[1])*metres-1500)/150)**2));
  const pair=[makeRing({place:[0,0,0],sample:oblique,extent:2000,divisions:64,gridSize:512}),makeRing({place:[0,0,0],sample:oblique,extent:8000,inner:2000,divisions:64,gridSize:512})];
  r.setMeshes(pair);r.draw({W:300,H:200,radius:550,rotation:lookAt(150,-10),sun:{az:150,alt:10},moon:{az:0,alt:-90},flux:0,exposure:1.6,shadows:true});
  const fine=r.readShadow(0),marginAt=(x,y)=>{const t=(x+fine.extent)/(2*fine.extent)*fine.size-.5,u=(y+fine.extent)/(2*fine.extent)*fine.size-.5,i=Math.floor(t),j=Math.floor(u),a=t-i,b=u-j,M=(i,j)=>fine.margin[j*fine.size+i];return (M(i,j)*(1-a)+M(i+1,j)*a)*(1-b)+(M(i,j+1)*(1-a)+M(i+1,j+1)*a)*b;};
  const edges=[];
  for(let s=-600;s<=600;s+=10){let previous=null;for(let d=-700;d<400;d+=1){const m=marginAt(s*along[0]+d*toSun[0],s*along[1]+d*toSun[1]);if(previous!==null&&previous>=0&&m<0){edges.push([s,d-1+previous/(previous-m)]);break;}previous=m;}}
  const n=edges.length,ms=edges.reduce((a,[s])=>a+s,0)/n,md=edges.reduce((a,[,d])=>a+d,0)/n,slope=edges.reduce((a,[s,d])=>a+(s-ms)*(d-md),0)/edges.reduce((a,[s])=>a+(s-ms)**2,0);
  const obliqueEdge={count:n,mean:md,expected:1500-300/Math.tan(10*Math.PI/180),maxResidual:Math.max(...edges.map(([s,d])=>Math.abs(d-md-slope*(s-ms)))),texel:2*fine.extent/fine.size};
  r.destroy();return {plane,ends,obliqueEdge,progressive:{frames,unchanged,different,catchUp,stale}};
 });
 for(const result of results.plane){assert.equal(result.error,0);assert.ok(result.compared>1000);assert.ok(result.dark<result.compared*.001,JSON.stringify(result));}
 for(const e of results.ends){
  assert.equal(e.reversals,0,`Shadow edges must be smooth, not striped: ${JSON.stringify(e)}`);
  assert.ok(Math.abs(e.end-e.expected)<2*e.step+.03*(e.crest-e.expected),`Ridge shadow must end at height/tan(altitude): ${JSON.stringify(e)}`);
  // Penumbrae narrower than a few shadow texels cannot be resolved.
  assert.ok(e.penumbra<e.expectedPenumbra*2+3*e.step&&(e.expectedPenumbra<3*e.step||e.penumbra>e.expectedPenumbra*.5),`Penumbra must follow the solar disc: ${JSON.stringify(e)}`);
 }
 const o=results.obliqueEdge;
 assert.ok(o.count>100,`The oblique ridge must cast a shadow edge: ${JSON.stringify(o)}`);
 assert.ok(Math.abs(o.mean-o.expected)<.03*300/Math.tan(10*Math.PI/180),`The oblique ridge's shadow must end at height/tan(altitude): ${JSON.stringify(o)}`);
 assert.ok(o.maxResidual<o.texel,`Shadow edges of distant occluders must be straight, not a sawtooth of their grid: ${JSON.stringify(o)}`);
 assert.ok(results.progressive.frames>2,'The update must be spread over frames');
 assert.ok(results.progressive.unchanged,'Partial updates must not be visible');
 assert.equal(results.progressive.different,0,'A finished progressive update equals a full one');
 assert.equal(results.progressive.stale,0,'After the light stops, shadows catch up with it');
 console.log(JSON.stringify({status:'passed',planeCases:results.plane.length,maxFalseDarkChannels:Math.max(...results.plane.map(x=>x.dark)),ridge:results.ends,obliqueEdge:results.obliqueEdge}));
}finally{await browser.close();await new Promise(r=>server.close(r));}
