// Historical engravings, independently registered against Hipparcos stars.
// Original scans are kept intact; paper is made transparent only at render
// time. See data/constellation-art-SOURCE.md for provenance and limitations.
import { CHART_STARS } from './stardata.js';

const R = Math.PI / 180;
const MESH_STEPS = 24;
const dot = (a, b) => a.reduce((s, v, i) => s + v * b[i], 0);
const unit = (a) => { const n = Math.hypot(...a); return a.map(v => v / n); };
const cross = (a, b) => [a[1]*b[2]-a[2]*b[1], a[2]*b[0]-a[0]*b[2], a[0]*b[1]-a[1]*b[0]];
const anchorStars = new Set([27989,25336,26311,49669,57632,54872]);
const stars = new Map(CHART_STARS.filter(([hip]) => anchorStars.has(hip)).map(([hip, ra, dec]) => [hip, [Math.cos(dec*R)*Math.cos(ra*R), Math.cos(dec*R)*Math.sin(ra*R), Math.sin(dec*R)]]));

export const CONSTELLATION_ART = [
  {
    name: 'Orion', file: 'hevelius-orion.jpg', size: [976, 809],
    // Betelgeuse, Bellatrix, Alnilam; pixel positions on the original plate.
    anchors: [[637, 300, 27989], [515, 314, 25336], [550, 451, 26311]],
    outline: [[358,167],[382,116],[435,91],[484,100],[520,168],[519,231],[550,195],[561,146],[565,96],[580,131],[610,166],[663,210],[695,218],[707,172],[699,130],[663,103],[639,77],[632,47],[650,28],[676,36],[703,65],[726,117],[737,162],[737,229],[729,281],[704,299],[672,326],[654,380],[641,428],[644,492],[651,555],[626,578],[691,622],[677,631],[624,614],[610,674],[556,680],[548,641],[526,597],[497,588],[488,608],[459,602],[423,577],[421,551],[435,519],[411,491],[402,455],[411,426],[391,399],[371,344],[358,281]],
  },
  {
    name: 'Leo', file: 'hevelius-leo.jpg', size: [994, 800],
    // Regulus, Denebola, Zosma.
    anchors: [[422, 386, 49669], [800, 181, 57632], [624, 140, 54872]],
    outline: [[168,224],[176,185],[193,151],[222,129],[219,99],[238,91],[285,109],[317,104],[348,117],[385,141],[417,169],[449,190],[496,207],[556,164],[597,139],[648,124],[693,124],[740,132],[790,145],[815,138],[821,113],[805,77],[784,54],[788,34],[809,60],[834,100],[843,142],[837,166],[851,192],[871,209],[839,228],[805,226],[800,280],[813,322],[841,347],[875,370],[896,408],[894,452],[875,502],[853,537],[800,543],[784,530],[791,511],[821,493],[835,448],[827,415],[791,385],[763,363],[739,403],[715,451],[691,483],[661,504],[614,503],[608,489],[630,476],[662,456],[680,421],[675,399],[623,400],[577,397],[541,407],[511,436],[472,456],[409,478],[345,494],[289,506],[252,497],[259,481],[309,463],[363,437],[401,414],[395,399],[353,416],[306,444],[263,463],[219,471],[198,460],[213,442],[250,430],[291,410],[331,387],[331,360],[302,341],[297,306],[305,281],[281,282],[251,288],[217,278],[199,263],[207,252],[181,247]],
  },
];

// Fit an affine map in a tangent plane, then lift it onto the celestial
// sphere. This also handles the mirrored viewpoint of Hevelius's plates.
export function artworkDirection(art) {
  const v = art.anchors.map(a => stars.get(a[2]));
  const center = unit(v[0].map((_, i) => v.reduce((s, p) => s + p[i], 0)));
  const east = unit(cross([0, 0, 1], center)), north = cross(center, east);
  const plane = v.map(p => [dot(p, east)/dot(p, center), dot(p, north)/dot(p, center)]);
  const [[x0,y0], [x1,y1], [x2,y2]] = art.anchors;
  const det = (x1-x0)*(y2-y0)-(x2-x0)*(y1-y0);
  return (x, y) => {
    const b = ((x-x0)*(y2-y0)-(x2-x0)*(y-y0))/det;
    const c = ((x1-x0)*(y-y0)-(x-x0)*(y1-y0))/det;
    const u = plane[0][0]*(1-b-c)+plane[1][0]*b+plane[2][0]*c;
    const w = plane[0][1]*(1-b-c)+plane[1][1]*b+plane[2][1]*c;
    return unit(center.map((p,i) => p + u*east[i] + w*north[i]));
  };
}

const loaded = new Map();
function texture(art, redraw) {
  let entry = loaded.get(art);
  if (!entry && typeof Image !== 'undefined') {
    entry = { image: null, listeners: new Set() }; loaded.set(art, entry);
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      [canvas.width, canvas.height] = art.size;
      const ctx = canvas.getContext('2d');
      const outline = new Path2D();
      art.outline.forEach(([x,y],i) => i ? outline.lineTo(x,y) : outline.moveTo(x,y));
      outline.closePath(); ctx.save(); ctx.clip(outline); ctx.drawImage(img,0,0); ctx.restore();
      const pixels = ctx.getImageData(0,0,...art.size);
      const active = new Uint8Array(MESH_STEPS*MESH_STEPS);
      for (let i=0; i<pixels.data.length; i+=4) {
        const ink = Math.max(0, Math.min(1, (205-pixels.data[i])/180));
        pixels.data[i]=194; pixels.data[i+1]=207; pixels.data[i+2]=228;
        pixels.data[i+3] = Math.round(pixels.data[i+3]*ink);
        if (pixels.data[i+3]) {
          const x = (i/4)%canvas.width, y = Math.floor(i/4/canvas.width);
          active[Math.floor(y*MESH_STEPS/canvas.height)*MESH_STEPS+Math.floor(x*MESH_STEPS/canvas.width)] = 1;
        }
      }
      ctx.putImageData(pixels,0,0); entry.image = canvas; entry.active = active;
      for (const notify of entry.listeners) notify();
      entry.listeners.clear();
    };
    img.onerror = () => { entry.failed = true; entry.listeners.clear(); };
    img.src = new URL(`../img/constellations/${art.file}`, import.meta.url).href;
  }
  if (!entry?.image && redraw && entry && !entry.failed) entry.listeners.add(redraw);
  return entry?.image ? entry : null;
}

const meshes = new Map();
function mesh(art, active) {
  if (meshes.has(art)) return meshes.get(art);
  const direction = artworkDirection(art), n = MESH_STEPS, points = [], triangles = [];
  for (let y=0; y<=n; y++) for (let x=0; x<=n; x++) {
    const px = x*art.size[0]/n, py = y*art.size[1]/n;
    points.push({ x: px, y: py, vector: direction(px,py) });
  }
  for (let y=0; y<n; y++) for (let x=0; x<n; x++) {
    if (!active[y*n+x]) continue;
    const a=y*(n+1)+x, b=a+1, c=a+n+1, d=c+1;
    triangles.push([a,b,c], [b,d,c]);
  }
  const result = { points, triangles }; meshes.set(art,result); return result;
}

// Project a small texture mesh rather than a flat screen rectangle: the
// figures follow both sky projections and remain registered during a drag.
export function drawConstellationArt(ctx, { W, H, radius, project, toHorizontal, opacity = 0.3, onRedraw, minZ = -0.995 }) {
  if (!ctx || !(opacity > 0)) return 0;
  let count = 0;
  ctx.save(); ctx.globalAlpha = Math.min(1,opacity);
  for (const art of CONSTELLATION_ART) {
    const entry = texture(art,onRedraw);
    if (!entry) continue;
    const { image, active } = entry;
    const { points, triangles } = mesh(art,active);
    const screen = points.map(p => project(toHorizontal(p.vector)));
    let painted = false;
    for (const indices of triangles) {
      const [a,b,c] = indices.map(i => screen[i]);
      if ([a,b,c].some(p => !Number.isFinite(p.x+p.y) || p.z < minZ)) continue;
      if (Math.max(a.x,b.x,c.x)<0 || Math.min(a.x,b.x,c.x)>W || Math.max(a.y,b.y,c.y)<0 || Math.min(a.y,b.y,c.y)>H) continue;
      if (Math.max(Math.hypot(a.x-b.x,a.y-b.y),Math.hypot(a.x-c.x,a.y-c.y),Math.hypot(b.x-c.x,b.y-c.y))>radius*0.35) continue;
      const [s,t,u] = indices.map(i => points[i]);
      const det = (t.x-s.x)*(u.y-s.y)-(u.x-s.x)*(t.y-s.y);
      const xx = ((b.x-a.x)*(u.y-s.y)-(c.x-a.x)*(t.y-s.y))/det;
      const xy = ((c.x-a.x)*(t.x-s.x)-(b.x-a.x)*(u.x-s.x))/det;
      const yx = ((b.y-a.y)*(u.y-s.y)-(c.y-a.y)*(t.y-s.y))/det;
      const yy = ((c.y-a.y)*(t.x-s.x)-(b.y-a.y)*(u.x-s.x))/det;
      ctx.save(); ctx.beginPath(); ctx.moveTo(a.x,a.y); ctx.lineTo(b.x,b.y); ctx.lineTo(c.x,c.y); ctx.closePath(); ctx.clip();
      ctx.transform(xx,yx,xy,yy,a.x-xx*s.x-xy*s.y,a.y-yx*s.x-yy*s.y);
      ctx.drawImage(image,0,0); ctx.restore(); painted = true;
    }
    if (painted) count++;
  }
  ctx.restore(); return count;
}
