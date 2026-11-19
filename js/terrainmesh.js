// Terrain surface geometry and lighting; ENU metres, azimuth north through east.
import { EARTH, RAD, destination } from './terrainmodel.js';
export const PANORAMA_RINGS = [[14, 1000], [14, 4000], [12, 16000], [11, 64000], [10, 150000]];
// Match the finer samples with adaptive triangulation rather than paying for
// every cell on the GPU. Tile downloads and native DEM resolution are unchanged.
export const terrainDivisions = extent => extent === 150000 ? 600 : extent >= 16000 ? 512 : 256;

// Height of the existing regular grid's actual triangle, not a bilinear patch.
export function meshHeightAt(mesh,x,y) {
  const n=Math.sqrt(mesh.positions.length/3),cx=(x+mesh.extent)/mesh.step,cy=(y+mesh.extent)/mesh.step;
  const i=Math.max(0,Math.min(n-2,Math.floor(cx))),j=Math.max(0,Math.min(n-2,Math.floor(cy))),u=cx-i,v=cy-j;
  const a=j*n+i,h=k=>mesh.positions[k*3+2];
  return u+v<=1?h(a)*(1-u-v)+h(a+1)*u+h(a+n)*v:h(a+1)*(1-v)+h(a+n)*(1-u)+h(a+n+1)*(u+v-1);
}

// The shaded surface supplies the mountain silhouette. Only the omitted near
// field needs a neutral fill: never paint an independently traced distant hill
// behind the mesh, where it can protrude as a black band when zoomed.
const foregrounds=new WeakMap();
export function terrainForeground(surface) {
  if(!foregrounds.has(surface)) {
    const mesh=surface.meshes[0],distance=surface.metrics?.nearField??100;
    foregrounds.set(surface,az=>{
      const a=az*RAD;
      return Math.atan2(meshHeightAt(mesh,Math.sin(a)*distance,Math.cos(a)*distance),distance)/RAD;
    });
  }
  return foregrounds.get(surface);
}

// Trace the *rendered triangles* in horizontal ray planes. This includes the
// exact 100 m cutoff and ring seams and avoids a second, expensive geodetic DEM
// march whose peaks do not necessarily exist in the displayed mesh.
export function meshHorizon(meshes,{step=.1,nearField=100,radius=150000}={}) {
  const count=Math.round(360/step),slopes=new Float64Array(count).fill(-Infinity);
  const directions=Array.from({length:count},(_,i)=>[Math.sin(i*2*Math.PI/count),Math.cos(i*2*Math.PI/count)]);
  const bearing=(x,y)=>(Math.atan2(x,y)/RAD+360)%360;
  for(const {positions:p,indices} of meshes)for(let i=0;i<indices.length;i+=3){
    const a=indices[i]*3,b=indices[i+1]*3,c=indices[i+2]*3;
    const ax=p[a],ay=p[a+1],az=p[a+2],bx=p[b],by=p[b+1],cx=p[c],cy=p[c+1];
    if(Math.max(Math.hypot(ax,ay),Math.hypot(bx,by),Math.hypot(cx,cy))<nearField)continue;
    const ux=bx-ax,uy=by-ay,vx=cx-ax,vy=cy-ay,uz=p[b+2]-az,vz=p[c+2]-az,det=ux*vy-uy*vx;
    if(!det)continue;
    const u0=(-ax*vy+ay*vx)/det,v0=(-ux*ay+uy*ax)/det,w0=1-u0-v0,z0=az+u0*uz+v0*vz;
    let first=0,last=count-1;
    if(Math.min(u0,v0,w0)<-1e-9){
      const angles=[bearing(ax,ay),bearing(bx,by),bearing(cx,cy)].sort((a,b)=>a-b);
      let gap=-1,start=0,end=0;
      for(let k=0;k<3;k++){const next=angles[(k+1)%3]+(k===2?360:0),d=next-angles[k];if(d>gap){gap=d;start=next%360;end=angles[k];}}
      if(end<start)end+=360;
      first=Math.ceil(start/step-1e-8);last=Math.floor(end/step+1e-8);
    }
    for(let bin=first;bin<=last;bin++){
      const k=bin%count,[dx,dy]=directions[k],us=(dx*vy-dy*vx)/det,vs=(ux*dy-uy*dx)/det;
      let lo=nearField,hi=radius;
      for(const [base,slope]of [[u0,us],[v0,vs],[w0,-us-vs]]){
        if(Math.abs(slope)<1e-15){if(base< -1e-9){hi=-1;break;}}
        else if(slope>0)lo=Math.max(lo,-base/slope);else hi=Math.min(hi,-base/slope);
      }
      if(hi+1e-7<lo)continue;
      const slope=us*uz+vs*vz+z0/(z0>=0?lo:hi);
      slopes[k]=Math.max(slopes[k],slope);
    }
  }
  return Float32Array.from(slopes,s=>Number.isFinite(s)?Math.atan(s)/RAD:-90);
}
export const lightVector = (az, alt) => [Math.sin(az * RAD) * Math.cos(alt * RAD), Math.cos(az * RAD) * Math.cos(alt * RAD), Math.sin(alt * RAD)];
// Krisciunas & Schaefer (1991) phase law, normalised at full Moon.
// This is direct source brightness, not their scattered-sky model.
export function moonFlux(phase, distance = 384400) {
  const a = Math.abs(phase);
  return 2.5e-6 * 10 ** (-0.4 * (0.026 * a + 4e-9 * a ** 4)) * (384400 / distance) ** 2;
}
export function makeRing({ place, sample, extent, inner = 0, divisions = 512, zoom, water = null }) {
  const n = divisions + 1, step = extent * 2 / divisions, positions = new Float32Array(n * n * 3), normals = new Float32Array(n * n * 3), valid = new Uint8Array(n * n), waterMask = new Float32Array(n * n);
  let missing = 0;
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
    const x = -extent + i * step, y = -extent + j * step, k = j * n + i, d = Math.hypot(x, y);
    const [lat, lon] = destination(place[0], place[1], Math.atan2(x, y) / RAD, d), raw = sample(lat, lon, zoom);
    const lake = raw !== null && (water?.at ? water.at(lat, lon, raw) : water?.contains(lat, lon));
    const h = raw;
    waterMask[k] = lake ? 1 : 0;
    valid[k] = h !== null && Number.isFinite(h) ? 1 : 0;
    if (!valid[k] && Math.max(Math.abs(x), Math.abs(y)) >= inner) missing++;
    positions.set([x, y, valid[k] ? h - place[2] - d * d * 0.87 / (2 * EARTH) : -10000], k * 3);
  }
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
    const k = j * n + i, left = j * n + Math.max(0, i - 1), right = j * n + Math.min(divisions, i + 1), down = Math.max(0, j - 1) * n + i, up = Math.min(divisions, j + 1) * n + i;
    const dx = (positions[right * 3 + 2] - positions[left * 3 + 2]) / ((right - left) * step), dy = (positions[up * 3 + 2] - positions[down * 3 + 2]) / ((up - down) / n * step), len = Math.hypot(dx, dy, 1);
    normals.set([-dx / len, -dy / len, 1 / len], k * 3);
  }
  const indices = [];
  for (let j = 0; j < divisions; j++) for (let i = 0; i < divisions; i++) {
    const x = -extent + (i + 0.5) * step, y = -extent + (j + 0.5) * step;
    if (Math.max(Math.abs(x), Math.abs(y)) < inner) continue;
    const a = j * n + i, b = a + 1, c = a + n, d = c + 1;
    if (valid[a] && valid[b] && valid[c]) indices.push(a, b, c);
    if (valid[b] && valid[d] && valid[c]) indices.push(b, d, c);
  }
  return { positions, normals, waterMask, indices: Uint32Array.from(indices), missing, step, extent, inner };
}
export function shadowBasis(light) {
  const len = Math.hypot(light[0], light[1]);
  const right = len > 1e-8 ? [-light[1] / len, light[0] / len, 0] : [1, 0, 0];
  const up = [light[1] * right[2] - light[2] * right[1], light[2] * right[0] - light[0] * right[2], light[0] * right[1] - light[1] * right[0]];
  return { right, up };
}

// OSM multipolygon: islands remain land. Bounds avoid testing distant vertices.
export function waterSampler(data) {
  const points = data.outer.flat(), xs = points.map(p => p[0]), ys = points.map(p => p[1]);
  const bounds = [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
  const inside = (lat, lon, ring) => {
    let hit = false;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const [x, y] = ring[i], [a, b] = ring[j];
      if ((y > lat) !== (b > lat) && lon < (a - x) * (lat - y) / (b - y) + x) hit = !hit;
    }
    return hit;
  };
  return { elevation: data.elevation, contains(lat, lon) {
    return lon >= bounds[0] && lon <= bounds[2] && lat >= bounds[1] && lat <= bounds[3] && data.outer.some(r => inside(lat, lon, r)) && !data.inner.some(r => inside(lat, lon, r));
  } };
}
// Match each fine outer edge to the next ring's piecewise-linear inner edge.
// Without this, different grid spacings leave cracks at shared boundaries.
export function stitchRings(meshes) {
  for (let r = 0; r + 1 < meshes.length; r++) {
    const fine = meshes[r], coarse = meshes[r + 1], fn = Math.sqrt(fine.positions.length / 3), cn = Math.sqrt(coarse.positions.length / 3);
    for (let j = 0; j < fn; j++) for (let i = 0; i < fn; i++) {
      if (i !== 0 && j !== 0 && i !== fn - 1 && j !== fn - 1) continue;
      const k = j * fn + i, x = fine.positions[k * 3], y = fine.positions[k * 3 + 1], cx = (x + coarse.extent) / coarse.step, cy = (y + coarse.extent) / coarse.step;
      const a = Math.floor(cx + 1e-7), b = Math.floor(cy + 1e-7), u = Math.max(0, cx - a), v = Math.max(0, cy - b);
      const points = [b * cn + a, b * cn + Math.min(cn - 1, a + 1), Math.min(cn - 1, b + 1) * cn + a, Math.min(cn - 1, b + 1) * cn + Math.min(cn - 1, a + 1)], weights = [(1-u)*(1-v), u*(1-v), (1-u)*v, u*v];
      fine.positions[k * 3 + 2] = points.reduce((s, p, t) => s + coarse.positions[p * 3 + 2] * weights[t], 0);
      const normal = [0, 1, 2].map(axis => points.reduce((s, p, t) => s + coarse.normals[p * 3 + axis] * weights[t], 0)), len = Math.hypot(...normal);
      fine.normals.set(normal.map(n => n / len), k * 3);
    }
  }
}
