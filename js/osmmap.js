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

// The map of m (eclipseTrack) in the element el, on the service of key;
// returns a function that removes it
async function osmMap(el, m, key) {
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
  L.polygon(night(m.sun), { stroke: false, fillColor: "#000", fillOpacity: dark ? 0.35 : 0.18, interactive: false }).addTo(map);
  line(m.outline || [...m.penN, ...m.penS], { color: C.partial, weight: 2, dashArray: "6 4" });
  for (const [kind, color] of [["begin", C.begin], ["end", C.end]]) {
    for (const [h, ls] of m[kind] || []) {
      line(ls, { color, weight: 1.5 });
      const hh = `${String(((h % 24) + 24) % 24).padStart(2, "0")}h`;
      for (const l of ls) if (l.length > 8) label(unwrap(l)[Math.floor(l.length / 2)], hh, color);
    }
  }
  if (m.rise) {
    line([...m.rise.begin, ...m.rise.end], { color: C.rise, weight: 1, opacity: 0.6, dashArray: "1 4" });
    line(m.rise.max, { color: C.rise, weight: 1.5, dashArray: "2 4" });
  }
  for (const b of m.band || []) if (Array.isArray(b[0])) L.polygon(unwrap(b), { color: C.band, weight: 1, fillColor: C.band, fillOpacity: 0.45, interactive: false }).addTo(map);
  line(m.center, { color: C.center, weight: 1.5 });
  // the times on the central line, every half hour
  for (const seg of m.center) {
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
  const all = [...(m.penN || []), ...(m.penS || []), ...(m.band || []).filter((b) => Array.isArray(b[0])), ...(m.outline || [])].flatMap(unwrap)
    .map(([lat, lon]) => [Math.max(-80, Math.min(80, lat)), lon]);
  if (all.length) map.fitBounds(L.latLngBounds(all), { padding: [10, 10] });
  else map.setView(m.greatest || [0, 0], 2);
  return () => map.remove();
}

export { osmMap, TILES };
