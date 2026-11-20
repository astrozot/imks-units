export const TERRAIN_EXPOSURE_BASE = Object.freeze({day:2**.7,night:4});
export const terrainExposure = (offset,night=false) => TERRAIN_EXPOSURE_BASE[night?'night':'day'] * 2**offset;

// GPU vertices: positions only. Shading normals, shadows and water come
// from per-ring textures, so triangles carry no lighting information.
// Adaptive grids retain their dense samples for CPU geometry queries; only
// referenced vertices are uploaded, so the hollow ring centres cost nothing.
export const TERRAIN_VERTEX_STRIDE=3;
export function terrainGpuMesh(mesh){
 const {positions:p,indices:source}=mesh,remap=new Int32Array(p.length/3).fill(-1),used=[],indices=new Uint32Array(source.length);
 for(let i=0;i<source.length;i++){const k=source[i];if(remap[k]<0){remap[k]=used.length;used.push(k);}indices[i]=remap[k];}
 const vertices=new Float32Array(used.length*3);
 for(let i=0;i<used.length;i++){const j=used[i];vertices[i*3]=p[j*3];vertices[i*3+1]=p[j*3+1];vertices[i*3+2]=p[j*3+2];}
 return {vertices,indices};
}

// Group draw indices by bearing once at upload time. Each group's cone encloses
// all of its triangle directions, so the scene can skip off-camera geometry.
export function terrainDrawGroups({vertices,indices}, sectors=32,stride=TERRAIN_VERTEX_STRIDE){
 const buckets=Array.from({length:sectors},()=>[]);
 for(let i=0;i<indices.length;i+=3){
  let x=0,y=0;for(let j=0;j<3;j++){const k=indices[i+j]*stride;x+=vertices[k];y+=vertices[k+1];}
  const sector=Math.floor(((Math.atan2(x,y)/(2*Math.PI)+1)%1)*sectors);
  buckets[sector].push(indices[i],indices[i+1],indices[i+2]);
 }
 const ordered=new Uint32Array(indices.length),groups=[];let offset=0;
 for(const bucket of buckets){
  if(!bucket.length)continue;
  const axis=[0,0,0],lo=[Infinity,Infinity,Infinity],hi=[-Infinity,-Infinity,-Infinity];
  for(const index of bucket){const k=index*stride,d=Math.hypot(vertices[k],vertices[k+1],vertices[k+2])||1;for(let a=0;a<3;a++){axis[a]+=vertices[k+a]/d;lo[a]=Math.min(lo[a],vertices[k+a]);hi[a]=Math.max(hi[a],vertices[k+a]);}}
  const length=Math.hypot(...axis)||1;for(let a=0;a<3;a++)axis[a]/=length;
  let cosine=1;
  for(const index of bucket){const k=index*stride,d=Math.hypot(vertices[k],vertices[k+1],vertices[k+2]);cosine=Math.min(cosine,d?(vertices[k]*axis[0]+vertices[k+1]*axis[1]+vertices[k+2]*axis[2])/d:-1);}
  const centre=lo.map((v,i)=>(v+hi[i])/2),half=lo.map((v,i)=>(hi[i]-v)/2);
  ordered.set(bucket,offset);groups.push({offset:offset*4,count:bucket.length,axis,angle:Math.acos(Math.max(-1,Math.min(1,cosine))),centre,half});offset+=bucket.length;
 }
 return {indices:ordered,groups};
}
