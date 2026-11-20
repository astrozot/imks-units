// Simplify a sampled grid without dropping any block-boundary vertices.
// Adjacent blocks therefore share exactly the same edges at every LOD.
// Only heights constrain simplification: shading and water come from the
// separate height textures, so the mesh only carries shape. The
// angular tolerance is relative to the observer, not a fixed metre budget.
// Blocks start as large as `maxBlock` (a power of two dividing the grid), so
// level or smooth areas such as lakes collapse to a few large fans.
export function simplifyTerrain(mesh, { angularError = 0.005, maxBlock = 32 } = {}) {
  const { positions: p, step, extent, inner = 0 } = mesh;
  const n = Math.sqrt(p.length / 3), divisions = n - 1;
  let blockSize = maxBlock; while (blockSize > 1 && divisions % blockSize) blockSize /= 2;
  if (!Number.isInteger(n) || !step || blockSize < 2) return mesh;
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
    // edges even when their elevations are perfectly planar. A segment
    // subtending θ sags by about θ²/8, kept within the same angular tolerance.
    let fits = size * step < Math.max(100,distance) * Math.max(0.04, Math.sqrt(8 * tolerance));
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
      if (Math.abs(height-p[k*3+2])>allowed) { fits=false; break; }
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

// Right-triangulated irregular network (RTIN, as in Mapbox "Martini"): error-
// driven bintree refinement of a (2^k+1)² grid. Each midpoint stores its
// error divided by the error allowed there (the angular tolerance seen from
// the observer at the nearest point of the diamond around that edge, and the
// projection-bending limit), maximised over the subtree; triangles split while
// it exceeds 1. Decisions belong to shared edges, so the mesh has no
// T-junctions. Ring edges and the hollow's boundary keep every vertex, so
// neighbouring rings meet without cracks; triangles inside the hollow drop.
const rtinCoords = new Map();
function rtinTriangles(tile) {
  if (rtinCoords.has(tile)) return rtinCoords.get(tile);
  const count = tile * tile * 2 - 2, coords = new Uint16Array(count * 4);
  for (let i = 0; i < count; i++) {
    let id = i + 2, ax = 0, ay = 0, bx = 0, by = 0, cx = 0, cy = 0;
    if (id & 1) bx = by = cx = tile; else ax = ay = cy = tile;
    while ((id >>= 1) > 1) {
      const mx = (ax + bx) >> 1, my = (ay + by) >> 1;
      if (id & 1) { bx = ax; by = ay; ax = cx; ay = cy; } else { ax = bx; ay = by; bx = cx; by = cy; }
      cx = mx; cy = my;
    }
    coords[i * 4] = ax; coords[i * 4 + 1] = ay; coords[i * 4 + 2] = bx; coords[i * 4 + 3] = by;
  }
  const result = { count, parents: count - tile * tile, coords };
  rtinCoords.clear(); rtinCoords.set(tile, result);
  return result;
}
export function simplifyTerrainRTIN(mesh, { angularError = 0.005 } = {}) {
  const { positions: p, step, extent, inner = 0 } = mesh, n = Math.round(Math.sqrt(p.length / 3)), tile = n - 1;
  if (mesh.missing || !step || n * n * 3 !== p.length || tile & (tile - 1) || tile < 2) return simplifyTerrain(mesh, { angularError });
  const tolerance = Math.tan(angularError * Math.PI / 180), bend = Math.max(0.04, Math.sqrt(8 * tolerance));
  const { count, parents, coords } = rtinTriangles(tile), errors = new Float32Array(n * n);
  const holeLo = inner ? Math.round((extent - inner) / step) : -1, holeHi = inner ? tile - holeLo : -1;
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++)
    if (i === 0 || j === 0 || i === tile || j === tile || inner && ((i === holeLo || i === holeHi) && j >= holeLo && j <= holeHi || (j === holeLo || j === holeHi) && i >= holeLo && i <= holeHi)) errors[j * n + i] = Infinity;
  const h = k => p[k * 3 + 2];
  for (let i = count - 1; i >= 0; i--) {
    const k = i * 4, ax = coords[k], ay = coords[k + 1], bx = coords[k + 2], by = coords[k + 3];
    const mx = (ax + bx) >> 1, my = (ay + by) >> 1, cx = mx + my - ay, cy = my + ax - mx, middle = my * n + mx;
    // The diamond around edge ab: a, b and the two apexes m ± rot90(a - m).
    const dx = Math.abs(ax - mx) + Math.abs(ay - my), x0 = -extent + (mx - dx) * step, x1 = -extent + (mx + dx) * step, y0 = -extent + (my - dx) * step, y1 = -extent + (my + dx) * step;
    const distance = Math.hypot(Math.max(0, x0, -x1), Math.max(0, y0, -y1));
    let e = Math.max(errors[middle], Math.abs((h(ay * n + ax) + h(by * n + bx)) / 2 - h(middle)) / Math.max(0.05, distance * tolerance), (x1 - x0) / (Math.max(100, distance) * bend));
    if (i < parents) e = Math.max(e, errors[((ay + cy) >> 1) * n + ((ax + cx) >> 1)], errors[((by + cy) >> 1) * n + ((bx + cx) >> 1)]);
    errors[middle] = e;
  }
  const out = [], coordinate = i => -extent + i * step;
  function triangle(ax, ay, bx, by, cx, cy) {
    if (inner) {
      const x0 = coordinate(Math.min(ax, bx, cx)), x1 = coordinate(Math.max(ax, bx, cx)), y0 = coordinate(Math.min(ay, by, cy)), y1 = coordinate(Math.max(ay, by, cy));
      if (Math.max(Math.abs(x0), Math.abs(x1)) <= inner + 1e-6 && Math.max(Math.abs(y0), Math.abs(y1)) <= inner + 1e-6) return;
    }
    const mx = (ax + bx) >> 1, my = (ay + by) >> 1;
    if (Math.abs(ax - cx) + Math.abs(ay - cy) > 1 && errors[my * n + mx] > 1) { triangle(cx, cy, ax, ay, mx, my); triangle(bx, by, cx, cy, mx, my); return; }
    out.push(ay * n + ax, cy * n + cx, by * n + bx);
  }
  triangle(0, 0, tile, tile, tile, 0); triangle(tile, tile, 0, 0, 0, tile);
  return { ...mesh, indices: Uint32Array.from(out), angularError };
}
