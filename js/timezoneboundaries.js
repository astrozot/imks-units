// Geographic polygons from Timezone Boundary Builder, shared by the globe
// overlay and point-in-polygon selection. See data/timezones-SOURCE.md.
let cached = null, pending = null;
const aliases = new Map();
export function canonicalTimezone(zone) {
  if (!aliases.has(zone)) {
    try { aliases.set(zone, new Intl.DateTimeFormat('en', { timeZone: zone }).resolvedOptions().timeZone); }
    catch { aliases.set(zone, zone); }
  }
  return aliases.get(zone);
}
const onSegment = (x, y, a, b) => {
  const cross = (x - a[1]) * (b[0] - a[0]) - (y - a[0]) * (b[1] - a[1]);
  return Math.abs(cross) < 1e-10 && x >= Math.min(a[1], b[1]) - 1e-10 && x <= Math.max(a[1], b[1]) + 1e-10 && y >= Math.min(a[0], b[0]) - 1e-10 && y <= Math.max(a[0], b[0]) + 1e-10;
};
const inRing = (lat, lon, ring) => {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[j], b = ring[i];
    if (onSegment(lon, lat, a, b)) return true;
    if ((a[0] > lat) !== (b[0] > lat) && lon < (b[1] - a[1]) * (lat - a[0]) / (b[0] - a[0]) + a[1]) inside = !inside;
  }
  return inside;
};
export function decodeTimezoneBoundaries(topology) {
  const { scale, translate } = topology.transform;
  const arcs = topology.arcs.map(arc => {
    let x = 0, y = 0;
    return arc.map(([dx, dy]) => { x += dx; y += dy; return [y * scale[1] + translate[1], x * scale[0] + translate[0]]; });
  });
  // Subdivide long straight geographic edges only for globe projection;
  // hit-testing uses the original generalized polygon coordinates.
  const lines = arcs.map(arc => {
    const line = [];
    for (let i = 0; i < arc.length; i++) {
      const p = arc[i], previous = arc[i - 1];
      if (previous) {
        const steps = Math.ceil(Math.max(Math.abs(p[0] - previous[0]), Math.abs(p[1] - previous[1])) / 2);
        for (let j = 1; j < steps; j++) line.push([previous[0] + (p[0] - previous[0]) * j / steps, previous[1] + (p[1] - previous[1]) * j / steps]);
      }
      line.push(p);
    }
    return line;
  });
  const ringFromArcs = ids => {
    const ring = [];
    for (const id of ids) {
      const arc = id < 0 ? [...arcs[~id]].reverse() : arcs[id];
      for (let i = ring.length ? 1 : 0; i < arc.length; i++) ring.push(arc[i]);
    }
    return ring;
  };
  const byZone = new Map(), points = new Map(), records = [], buckets = new Map();
  for (const geometry of topology.objects.timezones.geometries) {
    const zone = geometry.properties.tzid, canonical = canonicalTimezone(zone);
    const polygons = geometry.type === 'Polygon' ? [geometry.arcs] : geometry.arcs;
    if (!byZone.has(canonical)) byZone.set(canonical, new Set());
    for (const polygon of polygons) {
      for (const ring of polygon) for (const id of ring) byZone.get(canonical).add(id < 0 ? ~id : id);
      const rings = polygon.map(ringFromArcs);
      if (!rings[0]?.length) continue;
      let south = 90, north = -90, west = 180, east = -180;
      for (const [lat, lon] of rings[0]) { south = Math.min(south, lat); north = Math.max(north, lat); west = Math.min(west, lon); east = Math.max(east, lon); }
      const record = { zone, rings, south, north, west, east }; records.push(record);
      const col = lon => Math.max(0, Math.min(71, Math.floor((lon + 180) / 5)));
      const row = lat => Math.max(0, Math.min(35, Math.floor((lat + 90) / 5)));
      for (let y = row(south); y <= row(north); y++) for (let x = col(west); x <= col(east); x++) {
        const key = y * 72 + x;
        if (!buckets.has(key)) buckets.set(key, []);
        buckets.get(key).push(record);
      }
    }
    if (geometry.properties.center) points.set(canonical, geometry.properties.center);
  }
  for (const [zone, ids] of byZone) byZone.set(zone, [...ids].map(id => lines[id]));
  const candidates = (lat, lon) => {
    if (!Number.isFinite(lat) || !Number.isFinite(lon) || lat < -90 || lat > 90 || lon < -180 || lon > 180) return [];
    const key = Math.min(35, Math.floor((lat + 90) / 5)) * 72 + Math.min(71, Math.floor((lon + 180) / 5));
    return (buckets.get(key) || []).filter(p => lat >= p.south && lat <= p.north && lon >= p.west && lon <= p.east);
  };
  const lookupAll = (lat, lon) => {
    const matches = new Set();
    for (const p of candidates(lat, lon)) {
      if (inRing(lat, lon, p.rings[0]) && !p.rings.slice(1).some(ring => inRing(lat, lon, ring))) matches.add(p.zone);
    }
    return [...matches];
  };
  const lookup = (lat, lon) => lookupAll(lat, lon)[0] || null;
  return { lines, byZone, points, polygons: records, candidates, lookup, lookupAll, source: topology.source, polygonCount: records.length };
}
export function loadTimezoneBoundaries() {
  if (cached) return Promise.resolve(cached);
  if (!pending) pending = fetch(new URL('../data/timezones.topo.json', import.meta.url)).then(response => {
    if (!response.ok) throw new Error('Unable to load timezone boundaries.');
    return response.json();
  }).then(data => cached = decodeTimezoneBoundaries(data)).catch(error => { pending = null; throw error; });
  return pending;
}
export const timezoneBoundaries = () => cached;
export const timezoneAt = (lat, lon) => cached?.lookup(lat, lon) || null;

export const timezonesAt = (lat, lon) => cached?.lookupAll(lat, lon) || [];
