// The map of a solar eclipse on map tiles (OpenStreetMap and other free
// services), with Leaflet, loaded the first time from cdnjs: online only.
// The same lines as eclipsemap.js, from eclipseTrack() in astro.js.

const LEAFLET = "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/";

// the services, free without a key: tiles, credit, and whether the map is
// dark (for the colors)
const OSM = '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors';
const TILES = {
  osm: { name: "OpenStreetMap", url: "https://tile.openstreetmap.org/{z}/{x}/{y}.png", max: 19, credit: OSM },
  topo: {
    name: "Topographic", url: "https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png", max: 17,
    credit: `${OSM}, SRTM | © <a href="https://opentopomap.org">OpenTopoMap</a> (CC-BY-SA)`,
  },
  dark: {
    name: "Dark", url: "https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}", max: 16, dark: true,
    credit: "Tiles © Esri — Esri, HERE, Garmin, © OpenStreetMap contributors",
  },
  satellite: {
    name: "Satellite", url: "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}", max: 18, dark: true,
    credit: "Tiles © Esri — Esri, Maxar, Earthstar Geographics, and the GIS User Community",
  },
};

let loading = null;
// Leaflet, once
function loadLeaflet() {
  if (window.L) return Promise.resolve(window.L);
  if (!loading) {
    loading = new Promise((resolve, reject) => {
      const css = document.createElement("link");
      css.rel = "stylesheet";
      css.href = LEAFLET + "leaflet.min.css";
      document.head.appendChild(css);
      const js = document.createElement("script");
      js.src = LEAFLET + "leaflet.min.js";
      js.onload = () => resolve(window.L);
      js.onerror = () => { loading = null; reject(new Error("The map needs a connection")); };
      document.head.appendChild(js);
    });
  }
  return loading;
}

// a line with its longitudes going on across 180° (no jump on the map)
function unwrap(line) {
  let off = 0, prev = null;
  return line.map(([lat, lon]) => {
    if (prev !== null) {
      const d = lon + off - prev;
      if (d > 180) off -= 360;
      else if (d < -180) off += 360;
    }
    prev = lon + off;
    return [lat, prev];
  });
}

// the night side at the greatest phase: from the terminator to the pole in
// the dark (the Sun overhead at sun = [lat, lon])
function night([dec, lon0]) {
  const d = Math.abs(dec) < 0.01 ? 0.01 : dec, pts = [];
  for (let lon = -540; lon <= 540; lon += 2) {
    const h = ((lon - lon0) * Math.PI) / 180;
    pts.push([(Math.atan(-Math.cos(h) / Math.tan((d * Math.PI) / 180)) * 180) / Math.PI, lon]);
  }
  const pole = d > 0 ? -85 : 85;
  return [[pole, -540], ...pts, [pole, 540]];
}

// a line with points at most 2° of longitude apart, along great circles
// (straight on the map, long steps near the poles would cut across)
function dense(line) {
  const RAD = Math.PI / 180, unit = ([lat, lon]) => [Math.cos(lat * RAD) * Math.cos(lon * RAD), Math.cos(lat * RAD) * Math.sin(lon * RAD), Math.sin(lat * RAD)];
  const out = [line[0]];
  for (let i = 1; i < line.length; i++) {
    const p = line[i - 1], q = line[i], n = Math.ceil(Math.abs(((q[1] - p[1] + 540) % 360) - 180) / 2);
    const a = unit(p), b = unit(q), w = Math.acos(Math.max(-1, Math.min(1, a[0] * b[0] + a[1] * b[1] + a[2] * b[2])));
    for (let j = 1; j < n && w > 1e-9; j++) {
      const f = j / n, ka = Math.sin((1 - f) * w) / Math.sin(w), kb = Math.sin(f * w) / Math.sin(w), v = a.map((x, k) => ka * x + kb * b[k]);
      out.push([Math.asin(v[2]) / RAD, Math.atan2(v[1], v[0]) / RAD]);
    }
    out.push(q);
  }
  return out;
}

// a closed outline unwrapped, its edge and the area: one around a pole
// (its longitudes going all the way round) closed through that pole
function ring(line) {
  const u = unwrap(dense([...line, line[0]])), turn = u[u.length - 1][1] - u[0][1];
  if (Math.abs(turn) < 180) return { edge: u, area: u };
  const pole = u.reduce((s, p) => s + p[0], 0) > 0 ? 85 : -85;
  return { edge: u, area: [...u, [pole, u[u.length - 1][1]], [pole, u[0][1]]] };
}

// The map of m (eclipseTrack) in the element el, on the service of key;
// returns { remove, shade }: shade(at) draws the shadow at a moment
// (shadowMap() in astro.js) instead of the night and the hours
async function osmMap(el, m, key, sim = false) {
  const L = await loadLeaflet();
  const tiles = TILES[key] || TILES.osm, dark = Boolean(tiles.dark);
  const map = L.map(el, { worldCopyJump: true, zoomControl: true, attributionControl: true });
  L.tileLayer(tiles.url, { maxZoom: tiles.max, attribution: tiles.credit }).addTo(map);
  // colors that show on light maps and on dark ones
  const C = dark
    ? { band: "#ff7a45", center: "#ffe0c8", partial: "#e8c070", begin: "#7fc8ff", end: "#c3a6ff", rise: "#ffffff", place: "#2f6fde" }
    : { band: "#e8501a", center: "#7a2000", partial: "#b07a00", begin: "#1f6fd1", end: "#7b3fc4", rise: "#333333", place: "#2f6fde" };
  const line = (ls, style) => ls.forEach((l) => L.polyline(unwrap(l), { interactive: false, ...style }).addTo(map));
  const label = (latlng, text, color) => L.marker(latlng, {
    interactive: false,
    icon: L.divIcon({ className: "osm-label", html: `<span style="color:${color}">${text}</span>`, iconSize: null }),
  }).addTo(map);
  const nightLayer = L.polygon(night(m.sun), { stroke: false, fillColor: "#000", fillOpacity: dark ? 0.35 : 0.18, interactive: false }).addTo(map);
  line(m.outline || [...m.penN, ...m.penS], { color: C.partial, weight: sim ? 1 : 2, dashArray: "6 4", opacity: sim ? 0.6 : 1 });
  for (const [kind, color] of sim ? [] : [["begin", C.begin], ["end", C.end]]) {
    for (const [h, ls] of m[kind] || []) {
      line(ls, { color, weight: 1.5 });
      const hh = `${String(((h % 24) + 24) % 24).padStart(2, "0")}h`;
      for (const l of ls) if (l.length > 8) label(unwrap(l)[Math.floor(l.length / 2)], hh, color);
    }
  }
  if (m.rise && !sim) {
    line([...m.rise.begin, ...m.rise.end], { color: C.rise, weight: 1, opacity: 0.6, dashArray: "1 4" });
    line(m.rise.max, { color: C.rise, weight: 1.5, dashArray: "2 4" });
  }
  for (const b of m.band || []) if (Array.isArray(b?.[0])) L.polygon(unwrap(b), { color: C.band, weight: 1, fillColor: C.band, fillOpacity: sim ? 0.2 : 0.45, interactive: false }).addTo(map);
  line(m.center, { color: C.center, weight: sim ? 1 : 1.5 });
  // the times on the central line, every half hour
  for (const seg of sim ? [] : m.center) {
    const u = unwrap(seg);
    for (let i = 1; i < seg.length; i++) {
      if (seg[i].length < 3 || Math.floor(seg[i - 1][2] * 2) === Math.floor(seg[i][2] * 2)) continue;
      const h = Math.floor(seg[i][2] * 2) / 2;
      L.circleMarker(u[i], { radius: 2.5, color: C.center, fillOpacity: 1, interactive: false }).addTo(map);
      label(u[i], `${String(((Math.floor(h) % 24) + 24) % 24).padStart(2, "0")}:${h % 1 ? "30" : "00"}`, C.center);
    }
  }
  if (m.greatest) L.circleMarker(m.greatest, { radius: 5, color: dark ? "#0b0f1a" : "#ffffff", weight: 1.5, fillColor: C.band, fillOpacity: 1 }).bindTooltip("Greatest eclipse").addTo(map);
  if (m.place) L.circleMarker(m.place, { radius: 6, color: C.place, weight: 3, fillColor: "#ffffff", fillOpacity: 1 }).bindTooltip("Place").addTo(map);
  // the whole eclipse in view
  // (within 80° of latitude: the map has no tiles near the poles)
  const all = [...(m.penN || []), ...(m.penS || []), ...(m.band || []).filter((b) => Array.isArray(b?.[0])), ...(m.outline || [])].flatMap(unwrap)
    .map(([lat, lon]) => [Math.max(-80, Math.min(80, lat)), lon]);
  if (all.length) map.fitBounds(L.latLngBounds(all), { padding: [10, 10] });
  else map.setView(m.greatest || [0, 0], 2);
  // the shadow: the penumbra darker where more of the Sun is covered, the
  // umbra (or antumbra) with a ring around it; on the copies of the world
  // on either side too
  let shadow = null;
  const shade = (at) => {
    if (shadow) shadow.remove();
    shadow = L.layerGroup().addTo(map);
    nightLayer.setLatLngs(night(at.sun));
    const poly = (l, fill, edge = null) => {
      const r = ring(l);
      for (const k of [-360, 0, 360]) {
        const off = (pts) => pts.map(([a, b]) => [a, b + k]);
        L.polygon(off(r.area), { interactive: false, stroke: false, fillOpacity: 0.85, ...fill }).addTo(shadow);
        if (edge) L.polyline(off(r.edge), { interactive: false, weight: 1, ...edge }).addTo(shadow);
      }
    };
    const shadeFill = { fillColor: "#000", fillOpacity: dark ? 0.24 : 0.1 };
    for (const p of at.partial) poly(p.line, shadeFill, p.m ? null : { color: C.partial, weight: 1.5 });
    if (at.umbra) {
      const u = at.umbra.kind === "total" ? { color: "#000", fill: "#000" } : { color: C.band, fill: "#3a1a00" };
      poly(at.umbra.line, { fillColor: u.fill }, { color: u.color });
      if (at.umbra.center) L.circleMarker(at.umbra.center, { radius: 7, color: dark ? "#ffffff" : C.band, weight: 1.5, fill: false, interactive: false }).addTo(shadow);
    }
  };
  return { remove: () => map.remove(), shade };
}

export { osmMap, TILES };
