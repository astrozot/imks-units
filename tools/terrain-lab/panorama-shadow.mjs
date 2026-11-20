// Frozen copy of the lab prototype's shadow-map receiver and face-normal mesh
// packing. Production (js/terrain*.js) now uses heightfield horizon shadows.
// Shared by production and the isolated lab. Each PCF comparison uses the
// receiver triangle's depth at the sampled texel centre, not at the fragment.
// A constant bias alone self-shadows steep slopes as the light grid moves.
export const TERRAIN_SHADOW_GLSL = `
uniform vec3 shadowLight;
uniform vec2 shadowExtents;
uniform float shadowDepthRange,shadowRasterStep;
float shadowSample(highp sampler2D map,float extent,vec2 q,vec2 planeGradient){
 vec2 uv=q/(extent*2.0)+0.5;
 if(any(lessThan(uv,vec2(0)))||any(greaterThan(uv,vec2(1))))return 1.0;
 float size=float(textureSize(map,0).x);
 // Offset the receiver along its smooth normal by a few shadow texels. This
 // keeps neighbouring facets from shadowing the interpolated smooth surface.
 vec3 receiverP=P+normalize(N)*min(100.0,(extent*2.0/size)*4.0);
 uv=vec2(dot(receiverP,lightRight),dot(receiverP,lightUp))/(extent*2.0)+0.5;
 float depth=0.5-dot(receiverP,shadowLight)/shadowDepthRange;
 // Shadow vertices snap to the rasteriser's subpixel grid. Bound the
 // resulting receiver-depth error using this plane's slope and texel size.
 float bias=max(0.25,extent/size*0.02)/shadowDepthRange
   +(abs(planeGradient.x)+abs(planeGradient.y))*(extent*2.0/size)*shadowRasterStep*1.5;
 float value=0.0;
 for(int y=-1;y<=1;y++)for(int x=-1;x<=1;x++){
  vec2 centre=(floor(uv*size)+vec2(x,y)+0.5)/size;
  float receiver=depth+dot(planeGradient,(centre-uv)*extent*2.0);
  value+=receiver-bias<=texture(map,centre).r?1.0:0.0;
 }
 return value/9.0;
}
float visibility(vec3 face){
 if(!shadows)return 1.0;
 float facing=dot(face,shadowLight);
 // The direct term is negligible at grazing incidence; avoid an unstable
 // division at a triangle exactly parallel to the light.
 if(abs(facing)<0.015)return 1.0;
 vec2 gradient=vec2(dot(face,lightRight),dot(face,lightUp))/(facing*shadowDepthRange);
 vec2 q=vec2(dot(P,lightRight),dot(P,lightUp));
 float edge=max(abs(q.x),abs(q.y));
 float blend=smoothstep(shadowExtents.x*0.75,shadowExtents.x*0.92,edge);
 if(blend==0.0)return shadowSample(nearShadow,shadowExtents.x,q,gradient);
 if(blend==1.0)return shadowSample(farShadow,shadowExtents.y,q,gradient);
 return mix(shadowSample(nearShadow,shadowExtents.x,q,gradient),shadowSample(farShadow,shadowExtents.y,q,gradient),blend);
}`;
// Stable per-triangle planes for shadow receivers. Screen derivatives of large
// world coordinates lose precision at high zoom, particularly for grazing Sun.
// Give a shared vertex a second GPU copy only when it provokes a different face.
export function terrainGpuMesh(mesh){
 // Adaptive grids retain their dense samples for CPU geometry queries. Only
 // upload referenced vertices; the hollow centres of rings need no GPU memory.
 const {positions:p,normals:n,indices:source}=mesh,remap=new Int32Array(p.length/3).fill(-1),used=[],indices=new Uint32Array(source.length);
 for(let i=0;i<source.length;i++){const k=source[i];if(remap[k]<0){remap[k]=used.length;used.push(k);}indices[i]=remap[k];}
 const V=used.length,assigned=new Uint8Array(V),face=new Float32Array(V*3);let count=V;
 const normal=(a,b,c)=>{
  const ux=p[b*3]-p[a*3],uy=p[b*3+1]-p[a*3+1],uz=p[b*3+2]-p[a*3+2],vx=p[c*3]-p[a*3],vy=p[c*3+1]-p[a*3+1],vz=p[c*3+2]-p[a*3+2];
  const x=uy*vz-uz*vy,y=uz*vx-ux*vz,z=ux*vy-uy*vx,l=Math.hypot(x,y,z)||1;
  return [x/l,y/l,z/l];
 };
 for(let i=0;i<source.length;i+=3){const a=source[i],b=source[i+1],c=source[i+2],k=remap[c],g=normal(a,b,c);
  if(!assigned[k]){assigned[k]=1;face.set(g,k*3);}
  else if(Math.abs(g[0]-face[k*3])>1e-6||Math.abs(g[1]-face[k*3+1])>1e-6||Math.abs(g[2]-face[k*3+2])>1e-6)indices[i+2]=count++;
 }
 const vertices=new Float32Array(count*10);
 const put=(to,from,g)=>{const k=to*10,j=from*3;for(let a=0;a<3;a++){vertices[k+a]=p[j+a];vertices[k+3+a]=n[j+a];vertices[k+7+a]=g[a];}vertices[k+6]=mesh.waterMask?.[from]||0;};
 for(let i=0;i<V;i++)put(i,used[i],face.subarray(i*3,i*3+3));
 for(let i=0;i<source.length;i+=3)if(indices[i+2]>=V)put(indices[i+2],source[i+2],normal(source[i],source[i+1],source[i+2]));
 return {vertices,indices};
}
