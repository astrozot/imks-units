// Simplify a sampled grid without dropping any block-boundary vertices.
// Adjacent blocks therefore share exactly the same edges at every LOD.
// Heights, normals and water boundaries all constrain simplification. The
// angular tolerance is relative to the observer, not a fixed metre budget.
export function simplifyTerrain(mesh, { angularError = 0.005, normalError = 0.08, blockSize = 8 } = {}) {
  const { positions: p, normals: normals, waterMask: water, step, extent, inner = 0 } = mesh;
  const n = Math.sqrt(p.length / 3), divisions = n - 1;
  if (!Number.isInteger(n) || !step || divisions % blockSize) return mesh;
  const indices = [], tolerance = Math.tan(angularError * Math.PI / 180);
  const at = (x, y) => y * n + x;
  function block(x, y, size) {
    const loX = -extent + x * step, loY = -extent + y * step;
    const hiX = loX + size * step, hiY = loY + size * step;
    if (inner && Math.max(Math.abs(loX), Math.abs(hiX), Math.abs(loY), Math.abs(hiY)) <= inner) return;
    if (size === 1) {
      const a = at(x,y), b = a+1, c = a+n, d = c+1;
      indices.push(a,b,c,b,d,c); return;
    }
    const half = size / 2, centre = at(x+half,y+half);
    const distance = Math.hypot(Math.max(0,loX,-hiX), Math.max(0,loY,-hiY));
    // Also limit projected triangle size: stereographic projection bends long
    // edges even when their elevations are perfectly planar.
    let fits = size * step < Math.max(100,distance) * 0.04;
    if (inner && loX < inner && hiX > -inner && loY < inner && hiY > -inner) fits = false;
    for (let j=0; fits && j<=size; j++) for (let i=0; fits && i<=size; i++) {
      const dx=i-half, dy=j-half, t=Math.max(Math.abs(dx),Math.abs(dy))/half;
      if (!t) continue;
      const ex=half+dx/t, ey=half+dy/t;
      let ax,ay,bx,by,u;
      if (Math.abs(dx)>=Math.abs(dy)) { ax=bx=Math.round(ex); ay=Math.min(size-1,Math.floor(ey)); by=ay+1; u=ey-ay; }
      else { ay=by=Math.round(ey); ax=Math.min(size-1,Math.floor(ex)); bx=ax+1; u=ex-ax; }
      const a=at(x+ax,y+ay), b=at(x+bx,y+by), k=at(x+i,y+j);
      const height=p[centre*3+2]*(1-t)+(p[a*3+2]*(1-u)+p[b*3+2]*u)*t;
      const allowed=Math.max(0.05,Math.hypot(p[k*3],p[k*3+1])*tolerance);
      if (Math.abs(height-p[k*3+2])>allowed || water && (water[k]!==water[centre] || water[a]!==water[centre] || water[b]!==water[centre])) { fits=false; break; }
      let error=0;
      for(let axis=0;axis<3;axis++) {
        const normal=normals[centre*3+axis]*(1-t)+(normals[a*3+axis]*(1-u)+normals[b*3+axis]*u)*t;
        error+=(normal-normals[k*3+axis])**2;
      }
      if(error>normalError**2) fits=false;
    }
    if (!fits) {
      block(x,y,half); block(x+half,y,half); block(x,y+half,half); block(x+half,y+half,half); return;
    }
    for(let k=0;k<size;k++) {
      indices.push(centre,at(x+k,y),at(x+k+1,y));
      indices.push(centre,at(x+size,y+k),at(x+size,y+k+1));
      indices.push(centre,at(x+size-k,y+size),at(x+size-k-1,y+size));
      indices.push(centre,at(x,y+size-k),at(x,y+size-k-1));
    }
  }
  // Missing data must keep the original holes rather than invent surfaces.
  if (mesh.missing) return mesh;
  for(let y=0;y<divisions;y+=blockSize) for(let x=0;x<divisions;x+=blockSize) block(x,y,blockSize);
  return {...mesh,indices:Uint32Array.from(indices),angularError};
}
