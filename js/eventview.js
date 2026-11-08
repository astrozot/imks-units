// The drawings of eclipses and occultations, shared by iMKS (app.js) and
// Coelum (coelumapp.js): a lunar eclipse (the Moon through the Earth's
// shadow) and the map of a solar eclipse or an occultation, small (a
// history entry, a list) or mounted in a sheet to explore.
//
// The host of a sheet: { store: { get, set }, utc (times in UTC only),
// toast(message), sky(t, place, focus)?: Show in the sky, calc(place)?:
// Calculate here, onResize(fn)?: fn on resizing the window }
import { mapSVG, mapView, unproject } from "./eclipsemap.js";
import { osmMap, TILES } from "./osmmap.js";
import { shadowMap, solarContacts, solarLocal, solarPhase, occultationLocal, horizontal } from "./astro.js";

const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
// the Moon's near side, wherever the page is
const MOON_IMAGE = new URL("../img/moon.webp", import.meta.url).href;

// A lunar eclipse: the Earth's penumbra and umbra, the Moon's path across
// them (dashed where it is down at the place); north up, east to the left.
// The frame of a drawing W wide: its height and the mapping of the
// offsets (degrees) to it, and the shadow and the path drawn
function lunarFrame(d, W) {
  const f1 = (x) => x.toFixed(1);
  const pts = d.marks, xs = [...pts.map((p) => p.x), -d.penumbra, d.penumbra], ys = [...pts.map((p) => p.y), -d.penumbra, d.penumbra];
  const x0 = Math.min(...xs) - d.moon, x1 = Math.max(...xs) + d.moon, y0 = Math.min(...ys) - d.moon, y1 = Math.max(...ys) + d.moon;
  const k = (W - 24) / (x1 - x0), H = Math.round((y1 - y0) * k + 44);
  const X = (x) => W / 2 - (x - (x0 + x1) / 2) * k, Y = (y) => H / 2 + 6 - (y - (y0 + y1) / 2) * k;
  let svg = `<rect class="sky-bg" width="${W}" height="${H}" rx="10"/>`;
  svg += `<circle class="lunar-pen" cx="${f1(X(0))}" cy="${f1(Y(0))}" r="${f1(d.penumbra * k)}"/><circle class="lunar-umb" cx="${f1(X(0))}" cy="${f1(Y(0))}" r="${f1(d.umbra * k)}"/>`;
  // the path, in pieces with the Moon up or down
  let seg = [], up = null;
  const flush = () => { if (seg.length > 1) svg += `<path class="lunar-path${up === false ? " down" : ""}" d="M${seg.join("L")}"/>`; };
  d.path.forEach((p) => {
    const u = p.up !== false;
    if (up !== null && u !== up) { flush(); seg = [seg[seg.length - 1]]; }
    up = u;
    seg.push(`${f1(X(p.x))} ${f1(Y(p.y))}`);
  });
  flush();
  return { H, k, X, Y, f1, svg };
}
const hhmm = (t) => new Date(t * 1000).toISOString().slice(11, 16);

// A time slider moved by a touch anywhere on its track, not only on its
// thumb (iOS selects the bar instead); set(t) gets the time there
function dragTrack(slider, set) {
  const at = (ev) => {
    const b = slider.getBoundingClientRect(), f = Math.max(0, Math.min(1, (ev.clientX - b.left) / b.width));
    return Number(slider.min) + f * (Number(slider.max) - Number(slider.min));
  };
  slider.addEventListener("pointerdown", (ev) => {
    if (ev.pointerType === "mouse") return;
    ev.preventDefault();
    slider.setPointerCapture(ev.pointerId);
    set(at(ev));
  });
  slider.addEventListener("pointermove", (ev) => { if (slider.hasPointerCapture(ev.pointerId)) set(at(ev)); });
}

// Small (a history entry, a list): the Moon at the contacts, with their
// times (UTC); tap for mountLunar
function lunarHTML(d) {
  const W = 320, { H, k, X, Y, f1, svg: base } = lunarFrame(d, W), pts = d.marks;
  let svg = base;
  // outlines, the maximum filled, red where it is in the umbra; the labels
  // on either side of the path in turn, across it
  const first = pts[0], last = pts[pts.length - 1];
  let nx = -(Y(last.y) - Y(first.y)), ny = X(last.x) - X(first.x);
  const nn = Math.hypot(nx, ny) || 1;
  nx /= nn;
  ny /= nn;
  pts.forEach((p, i) => {
    const inUmbra = Math.hypot(p.x, p.y) < d.umbra, cx = X(p.x), cy = Y(p.y), r = d.moon * k;
    svg += `<circle class="lunar-moon${p.name === "max" ? " max" : ""}${inUmbra ? " red" : ""}${p.up === false ? " down" : ""}" cx="${f1(cx)}" cy="${f1(cy)}" r="${f1(r)}"/>`;
    const side = i % 2 ? 1 : -1, lx = cx + side * nx * (r + 12), ly = cy + side * ny * (r + 12) + 3;
    svg += `<text class="sky-label" x="${f1(Math.max(30, Math.min(W - 30, lx)))}" y="${f1(Math.max(26, Math.min(H - 4, ly)))}" text-anchor="middle">${p.name} ${hhmm(p.t)}</text>`;
  });
  svg += `<text class="sky-label" x="${W - 8}" y="14" text-anchor="end">N ↑ E ← UTC</text>`;
  return `<svg class="lunar-svg" viewBox="0 0 ${W} ${H}" role="img" aria-label="The lunar eclipse">${svg}</svg>`;
}

// The Moon at the time t, from the path (every 5 minutes; older entries
// have no times, which then run from P1 − 30 min): its offsets, and whether
// it is up
function lunarAtTime(d, t) {
  const p = d.path, t0 = d.marks[0].t - 1800, ts = p.map((q, i) => q.t ?? t0 + 300 * i);
  let i = ts.findIndex((x) => x > t);
  if (i < 0) i = p.length - 1;
  if (i === 0) i = 1;
  const a = p[i - 1], b = p[i], w = Math.max(0, Math.min(1, (t - ts[i - 1]) / (ts[i] - ts[i - 1])));
  return { x: a.x + (b.x - a.x) * w, y: a.y + (b.y - a.y) * w, up: (w < 0.5 ? a : b).up, from: ts[0], to: ts.at(-1) };
}

// The zoom view of a lunar eclipse d (lunarDiagram of astro.js), in root
// under head: the diagram, larger, or the simulation: the Moon at a time
// chosen (slider, play, the contacts), dimmed in the penumbra and red in
// the umbra, with the phase and the umbral magnitude then. It returns
// { share() }, the picture to share, with caption under it
function mountLunar(root, d, host, { head = "", caption = [] } = {}) {
  const W = 360, { H, k, X, Y, f1, svg: base } = lunarFrame(d, W);
  const span = lunarAtTime(d, 0);
  const local = (t) => new Date(t * 1000).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: false });
  const views = [["diagram", "Diagram"], ["sim", "Simulation"]];
  root.innerHTML = `${head}
      <div class="seg lunar-views" role="tablist">${views.map(([v, n]) => `<button data-lunar-view="${v}" role="tab">${n}</button>`).join("")}</div>
      <div class="lunar-diagram">${lunarHTML(d).replace('class="lunar-svg"', 'class="lunar-svg lunar-full"')}
      <p class="sky-hint">The Moon at the contacts, with their times (UTC): P penumbral, U umbral</p></div>
      <div class="lunar-sim">
      <svg class="lunar-svg lunar-full" viewBox="0 0 ${W} ${H}" role="img" aria-label="The lunar eclipse"></svg>
      <div class="lunar-play"><button class="chip" data-lunar="play" aria-label="Play">▶</button><input type="range" class="lunar-time" min="${span.from}" max="${span.to}" step="30" value="${d.marks.find((m) => m.name === "max")?.t ?? span.from}" aria-label="Time"></div>
      <div class="sky-time lunar-chips">${d.marks.map((m) => `<button class="chip" data-lunar-t="${m.t}">${m.name}</button>`).join("")}${d.place && host.sky ? `<button class="chip" data-lunar-sky>Show in the sky</button>` : ""}</div>
      <div class="lunar-view"><svg class="lunar-close" viewBox="0 0 140 140" role="img" aria-label="The Moon"></svg><p class="lunar-when"></p></div>
      <p class="sky-hint">Drag the slider or tap a contact: P penumbral, U umbral; times as the eclipse is seen anywhere the Moon is up</p></div>`;
  const svg = root.querySelector(".lunar-sim .lunar-full"), close = root.querySelector(".lunar-close"), slider = root.querySelector(".lunar-time"), when = root.querySelector(".lunar-when");
  const r = d.moon * k, cx0 = f1(X(0)), cy0 = f1(Y(0));
  // Both drawings are built once and only moved on each frame: an <image>
  // made anew every frame would not be decoded in time, and the play would
  // show the plain disk under it
  // the penumbra darkens toward the umbra; the near side (img/moon.webp,
  // over a plain disk if it is missing), dimmed by the penumbra, and copper
  // in the umbra (multiplied, so that the maria show)
  svg.innerHTML = `<defs><clipPath id="lunar-disk"><circle class="lunar-clip" r="${f1(r)}"/></clipPath>
    <radialGradient id="lunar-pg" gradientUnits="userSpaceOnUse" cx="${cx0}" cy="${cy0}" r="${f1(d.penumbra * k)}">
      <stop offset="${(d.umbra / d.penumbra).toFixed(3)}" stop-color="#000" stop-opacity="0.5"/><stop offset="1" stop-color="#000" stop-opacity="0"/></radialGradient></defs>` + base +
    `<g class="lunar-body"><circle r="${f1(r)}" class="lunar-disk"/><image href="${MOON_IMAGE}" width="${f1(2 * r)}" height="${f1(2 * r)}"/>` +
    `<g clip-path="url(#lunar-disk)" class="lunar-shade"><circle cx="${cx0}" cy="${cy0}" r="${f1(d.penumbra * k)}" fill="url(#lunar-pg)"/><circle cx="${cx0}" cy="${cy0}" r="${f1(d.umbra * k)}" class="lunar-umbra-on"/></g></g>` +
    `<text class="sky-label" x="${W - 8}" y="14" text-anchor="end">N ↑ E ←</text>`;
  // the Moon close, as it looks: the shadow across the near side, its
  // edges soft, the umbra darker inside
  const s = 62 / d.moon;
  close.innerHTML = `<defs><clipPath id="lunar-c"><circle cx="70" cy="70" r="62"/></clipPath>
    <radialGradient id="lunar-cp" gradientUnits="userSpaceOnUse" r="${(d.penumbra * s).toFixed(1)}"><stop offset="${(d.umbra / d.penumbra).toFixed(3)}" stop-color="#000" stop-opacity="0.55"/><stop offset="1" stop-color="#000" stop-opacity="0"/></radialGradient>
    <radialGradient id="lunar-cu" gradientUnits="userSpaceOnUse" r="${(d.umbra * s).toFixed(1)}"><stop offset="0"/><stop offset="0.85"/><stop offset="0.95"/><stop offset="1" stop-opacity="0"/></radialGradient></defs>
    <g class="lunar-body"><circle cx="70" cy="70" r="62" class="lunar-disk"/><image href="${MOON_IMAGE}" x="8" y="8" width="124" height="124"/>
    <g clip-path="url(#lunar-c)" class="lunar-shade"><circle r="${(d.penumbra * s).toFixed(1)}" fill="url(#lunar-cp)"/><circle r="${(d.umbra * s).toFixed(1)}" fill="url(#lunar-cu)"/></g></g>`;
  const set = (el, a) => { for (const n in a) el.setAttribute(n, a[n]); };
  const big = { clip: svg.querySelector(".lunar-clip"), body: svg.querySelector(".lunar-body"), disk: svg.querySelector(".lunar-disk"), img: svg.querySelector("image") };
  const near = { body: close.querySelector(".lunar-body"), cp: close.querySelector("#lunar-cp"), cu: close.querySelector("#lunar-cu"), shade: close.querySelectorAll(".lunar-shade circle") };
  // the time shown (the slider rounds it to its steps: the play keeps its own)
  let cur = 0;
  const draw = (t) => {
    cur = t;
    const m = lunarAtTime(d, t), cx = f1(X(m.x)), cy = f1(Y(m.y)), dist = Math.hypot(m.x, m.y);
    set(big.clip, { cx, cy });
    set(big.disk, { cx, cy });
    set(big.img, { x: f1(X(m.x) - r), y: f1(Y(m.y) - r) });
    big.body.classList.toggle("down", m.up === false);
    // Keep the penumbral dimming continuous across the umbral contacts;
    // brightening the whole image in partial phases would cancel it out.
    // The umbra is a little darker in partial phases for contrast.
    const sx = (70 + m.x * s).toFixed(1), sy = (70 + m.y * s).toFixed(1);
    const part = (d.umbra + d.moon - dist) / (2 * d.moon), partial = part > 0 && part < 1;
    const dim = (hex) => "#" + [1, 3, 5].map((i) => Math.round(parseInt(hex.slice(i, i + 2), 16) / (partial ? 1.2 : 1)).toString(16).padStart(2, "0")).join("");
    set(near.cp, { cx: sx, cy: sy });
    set(near.cu, { cx: sx, cy: sy });
    ["#4a140c", "#93361f", "#b5462a", "#b5462a"].forEach((c, i) => near.cu.children[i].setAttribute("stop-color", dim(c)));
    near.shade.forEach((c) => set(c, { cx: sx, cy: sy }));
    near.body.classList.toggle("down", m.up === false);
    const umbral = (d.umbra + d.moon - dist) / (2 * d.moon), penumbral = (d.penumbra + d.moon - dist) / (2 * d.moon);
    const phase = umbral >= 1 ? "total" : umbral > 0 ? "partial" : penumbral > 0 ? "penumbral" : "no eclipse";
    const mag = umbral > 0 ? `, umbral magnitude ${umbral.toFixed(3)}` : penumbral > 0 ? `, penumbral magnitude ${penumbral.toFixed(3)}` : "";
    when.textContent = `${hhmm(t)} UTC${host.utc ? "" : ` (${local(t)} local)`}: ${phase}${mag}${m.up === false ? " · the Moon is down at the place" : ""}`;
  };
  let raf = 0, last = 0;
  const stop = () => { cancelAnimationFrame(raf); raf = 0; root.querySelector('[data-lunar="play"]').textContent = "▶"; };
  // the whole eclipse in about 20 s
  const step = (now) => {
    if (!svg.isConnected) return;
    const dt = last ? (now - last) / 1000 : 0;
    last = now;
    let t = cur + dt * (span.to - span.from) / 20;
    if (t >= span.to) { t = span.to; stop(); }
    slider.value = t;
    draw(t);
    if (raf) raf = requestAnimationFrame(step);
  };
  // the diagram or the simulation, as last chosen
  const show = (view) => {
    if (view !== "diagram") view = "sim";
    host.store.set("lunarView", view);
    root.querySelectorAll("[data-lunar-view]").forEach((b) => b.setAttribute("aria-selected", String(b.dataset.lunarView === view)));
    root.querySelector(".lunar-diagram").hidden = view !== "diagram";
    root.querySelector(".lunar-sim").hidden = view === "diagram";
    if (view === "diagram" && raf) stop();
  };
  root.addEventListener("click", (ev) => {
    const v = ev.target.closest("[data-lunar-view]");
    if (v) return show(v.dataset.lunarView);
    if (ev.target.closest("[data-lunar-sky]")) { stop(); return host.sky(cur, d.place, ["Moon"]); }
    const b = ev.target.closest("[data-lunar], [data-lunar-t]");
    if (!b) return;
    if (b.dataset.lunarT) { stop(); slider.value = b.dataset.lunarT; draw(Number(b.dataset.lunarT)); return; }
    if (raf) return stop();
    if (cur >= span.to) draw(span.from);
    b.textContent = "❚❚";
    last = 0;
    raf = requestAnimationFrame(step);
  });
  slider.addEventListener("input", () => { stop(); draw(Number(slider.value)); });
  dragTrack(slider, (t) => { stop(); slider.value = t; draw(t); });
  draw(Number(slider.value));
  show(host.store.get("lunarView", "sim"));
  // the picture to share: the diagram, or the simulation as it is
  return {
    share: () => (root.querySelector(".lunar-diagram").hidden
      ? { root: root.querySelector(".lunar-sim"), hide: ".lunar-play, .lunar-chips, .sky-hint", text: ".lunar-when", caption, name: "lunar-eclipse" }
      : { root: root.querySelector(".lunar-diagram"), hide: ".sky-hint", caption, name: "lunar-eclipse" }),
  };
}

// The map of a solar eclipse, or of an occultation, small (tap for
// mountMap)
const occName = (o) => (typeof o.target === "string" ? o.target[0].toUpperCase() + o.target.slice(1) : o.target.name || o.names[0]);
function mapHTML(m) {
  const W = 320, H = 240, o = m.occ;
  const key = o
    ? `${m.band.length ? `<i class="k-path"></i>${o.covers ? "wholly covered" : `${o.names[1]} wholly in front`} ` : ""}${m.penN.length || m.penS.length ? '<i class="k-partial"></i>limits ' : ""}<i class="k-begin"></i>begins <i class="k-end"></i>ends (${m.step < 1 ? "UTC" : "hour UTC"}) <i class="k-horizon"></i>${esc(occName(o))} rising or setting <i class="k-place"></i>place`
    : '<i class="k-path"></i>central path (UTC) <i class="k-partial"></i>where it is seen <i class="k-begin"></i>begins <i class="k-end"></i>ends (hour UTC) <i class="k-horizon"></i>at sunrise or sunset (bright: maximum) <i class="k-place"></i>place';
  return `<svg class="map-svg" viewBox="0 0 ${W} ${H}" role="img" aria-label="Map of the ${o ? "occultation" : "eclipse"}">${mapSVG(m, W, H, mapView(m, W, H), m.place)}</svg><p class="sky-hint map-key">${key}</p>`;
}

// The zoom view of the map m (eclipseTrack or occultationTrack of
// astro.js), in root under head, as mountLunar: drag to turn the Earth,
// pinch or scroll to zoom, double-tap to go back; tap a place for the
// eclipse seen from it. The map, or the simulation: the shadow at a time
// chosen (slider, play, the contacts), the penumbra darker where more of
// the Sun is covered, the umbra, and the night; with the phase at the
// place then. The globe and the maps of tiles keep the same view
const SHADES = [0, 0.2, 0.4, 0.6, 0.8];
// the scale of the globe (pixels per Earth radius) at the latitude lat and
// the zoom of a map of tiles (Web Mercator, 256 pixels around the Earth at
// zoom 0) that match at the center of the view
const zoomOf = (s, lat) => Math.log2((s * 2 * Math.PI * Math.cos(lat * Math.PI / 180)) / 256);
const scaleOf = (zoom, lat) => (256 * 2 ** zoom) / (2 * Math.PI * Math.cos(lat * Math.PI / 180));
function mountMap(root, m, host, { head = "", caption = [] } = {}) {
  const views = [["globe", "Globe"], ...Object.entries(TILES).map(([k, t]) => [k, t.name])];
  // an occultation: no simulation of the shadow (made for the Sun), but
  // places tapped for the occultation there
  const occ = m.occ || null, canSim = typeof m.t === "number" && !occ, canPick = canSim || Boolean(occ);
  const localAt = (p) => (occ ? occultationLocal(occ.target, occ.front, m.t, p) : solarLocal(m.t, p));
  const what = occ ? "occultation" : "eclipse";
  // the place: of the calculation, or tapped on the map
  let place = m.place || null;
  // the contacts on the Earth, and at the place; 2 s into the phase they
  // begin or end, not on its edge
  const c = canSim ? solarContacts(m.t) : null;
  let l = canPick && place ? localAt(place) : null;
  const marks = () => [["P1", c.P1], ["U1", c.U1], ["max", m.t], ["U4", c.U4], ["P4", c.P4], ...(l ? [["C1", l.C1], ["C2", l.C2], ["C3", l.C3], ["C4", l.C4]] : [])]
    .filter(([, t]) => t !== null).map(([n, t]) => [n, t + (/[12]$/.test(n) ? 2 : /[34]$/.test(n) ? -2 : 0)]).sort((a, b) => a[1] - b[1]);
  const chips = () => (canSim ? marks().map(([n, t]) => `<button class="chip" data-map-t="${t}">${n}</button>`).join("") : "");
  const from = canSim ? (c.P1 ?? m.t - 3 * 3600) - 600 : 0, to = canSim ? (c.P4 ?? m.t + 3 * 3600) + 600 : 0;
  const modes = [["map", "Map"], ["sim", "Simulation"]];
  root.innerHTML = `${head}
      ${canSim ? `<div class="seg map-modes" role="tablist">${modes.map(([v, n]) => `<button data-map-mode="${v}" role="tab">${n}</button>`).join("")}</div>` : ""}
      <label class="map-views">Map <select class="map-select" aria-label="Map">${views.map(([k, n]) => `<option value="${k}">${esc(n)}</option>`).join("")}</select></label>
      <svg class="map-svg map-full" role="img" aria-label="Map of the ${what}"></svg><div class="osm-map" hidden></div>
      <div class="map-sim" hidden>
      <p class="map-when"></p>
      <div class="lunar-play"><button class="chip" data-map="play" aria-label="Play">▶</button><input type="range" class="map-slider" min="${from}" max="${to}" step="30" value="${m.t}" aria-label="Time"></div>
      <div class="sky-time lunar-chips">${chips()}</div></div>
      <div class="map-local"></div>
      <p class="sky-hint map-hint">Drag to turn the Earth, pinch or scroll to zoom, double-tap to go back</p>`;
  const svg = root.querySelector(".map-svg"), osm = root.querySelector(".osm-map"), hint = root.querySelector(".map-hint");
  const slider = root.querySelector(".map-slider"), when = root.querySelector(".map-when"), localBox = root.querySelector(".map-local");
  let sim = false, at = null;
  // the view of the globe, and whether it is one chosen (then kept by the
  // maps of tiles; else they show the whole eclipse)
  let W = 320, H = 320, v = null, raf = 0, chosen = false;
  const base0 = () => mapView(m, W, H).s;
  const clampS = (s) => Math.min(base0() * 30, Math.max(base0() * 0.8, s));
  // the globe (drawn here, offline too) or a map of tiles (osmmap.js, online)
  let osmNow = null, shown = 0;
  const show = async (view) => {
    const token = ++shown;
    if (osmNow) {
      // the view of the map left, for the next one
      if (osmNow.moved() || chosen) {
        const o = osmNow.view(), lat0 = Math.max(-89, Math.min(89, o.center[0]));
        v = { lat0, lon0: o.center[1], s: clampS(scaleOf(o.zoom, lat0)) };
        chosen = true;
      }
      osmNow.remove();
      osmNow = null;
    }
    const globe = view === "globe" || !TILES[view];
    root.querySelector(".map-select").value = globe ? "globe" : view;
    svg.style.display = globe ? "" : "none";
    osm.hidden = globe;
    osm.classList.toggle("dark", Boolean(TILES[view]?.dark));
    hint.textContent = (globe ? "Drag to turn the Earth, pinch or scroll to zoom, double-tap to go back" : "Online map: drag to move, pinch or scroll to zoom") + (canPick ? `; tap a place for the ${what} there` : "");
    if (sim) hint.textContent += "; the penumbra darker where more of the Sun is covered, the umbra in a ring";
    host.store.set("mapView", view);
    if (globe) return redraw();
    osm.style.height = `${Math.round(Math.max(240, Math.min(root.clientWidth * (sim ? 1 : 1.1), window.innerHeight - (sim ? 380 : 260))))}px`;
    try {
      const o = await osmMap(osm, m, view, { sim, place, pick: canPick ? pick : null, view: chosen ? { center: [v.lat0, v.lon0], zoom: zoomOf(v.s, v.lat0) } : null });
      if (!osm.isConnected || token !== shown) o.remove();
      else {
        osmNow = o;
        if (sim && at) o.shade(at);
      }
    } catch (err) {
      host.toast(err.message);
      show("globe");
    }
  };
  root.querySelector(".map-select").addEventListener("change", (ev) => show(ev.target.value));
  const draw = () => { if (svg.style.display !== "none") svg.innerHTML = mapSVG(m, W, H, v, place, sim ? at : null); };
  function redraw() { if (!raf) raf = requestAnimationFrame(() => { raf = 0; draw(); }); }
  const size = () => {
    W = Math.max(240, Math.round(svg.parentElement.clientWidth));
    H = Math.round(Math.max(240, Math.min(W * (sim ? 1 : 1.1), window.innerHeight - (sim ? 340 : 220))));
    svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
    if (!v) v = mapView(m, W, H);
    draw();
  };
  // the shadow at the time t, and what is seen then
  const localTime = (t) => new Date(t * 1000).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: false });
  const ll = ([lat, lon]) => `${Math.abs(lat).toFixed(1)}° ${lat < 0 ? "S" : "N"}, ${Math.abs(lon).toFixed(1)}° ${lon < 0 ? "W" : "E"}`;
  // the time shown (the slider rounds it to its steps: the play keeps its own)
  let cur = m.t;
  const setTime = (t) => {
    cur = t;
    at = shadowMap(t, SHADES);
    const u = at.umbra, kind = u && (u.kind === "total" ? "umbra" : "antumbra");
    let text = `${hhmm(t)} UTC${host.utc ? "" : ` (${localTime(t)} local)`}: `;
    text += u ? (u.center ? `the ${kind} at ${ll(u.center)}` : `the ${kind} at the edge of the Earth`) : at.partial.length ? "partial eclipse only" : "the shadow misses the Earth";
    if (place) {
      const p = solarPhase(t, place);
      text += p.alt < -0.833 ? " · the Sun is down at the place"
        : p.phase === "none" ? " · no eclipse at the place"
        : ` · at the place: ${p.phase}, magnitude ${p.magnitude.toFixed(3)}, ${(p.obscuration * 100).toFixed(p.obscuration > 0.995 && p.obscuration < 1 ? 1 : 0)}% of the Sun covered`;
    }
    when.textContent = text;
    if (osmNow && sim) osmNow.shade(at);
    redraw();
  };
  // under the place's details: the whole calculation there (iMKS), and the
  // sky then
  const actions = [host.calc && '<button class="chip" data-map="calc">Calculate here</button>', host.sky && '<button class="chip" data-map="sky">Show in the sky</button>'].filter(Boolean).join(" ");
  // the eclipse seen from the place: its kind, magnitude, the part of the
  // Sun covered, the contacts (UTC, and local), the Sun's altitude; and a
  // button for the whole calculation there
  const showLocal = () => {
    if (!place) { localBox.innerHTML = ""; return; }
    const head = `<b>${ll(place)}</b>`;
    if (occ) return showOccultation(head);
    const up = (a) => a !== null && a > -0.833;
    if (!l) { localBox.innerHTML = `<p>${head}: no eclipse</p>`; return; }
    const seen = up(l.altC1) || up(l.altMax) || up(l.altC4);
    const hms = (t) => new Date(t * 1000).toISOString().slice(11, 19);
    const lt = (t) => new Date(t * 1000).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false });
    const rows = [["begins", l.C1, l.altC1], [`${l.kind} begins`, l.C2], ["maximum", l.max, l.altMax], [`${l.kind} ends`, l.C3], ["ends", l.C4, l.altC4]]
      .filter(([, t]) => t !== null)
      .map(([n, t, a]) => `<tr><td>${n}${a !== undefined && !up(a) ? " (Sun down)" : ""}</td><td>${hms(t)}</td>${host.utc ? "" : `<td>${lt(t)}</td>`}</tr>`).join("");
    localBox.innerHTML = `<p>${head}: ${l.kind} eclipse${seen ? "" : ", the Sun down"}, magnitude ${l.magnitude.toFixed(3)}, ${(l.obscuration * 100).toFixed(l.obscuration > 0.995 && l.obscuration < 1 ? 1 : 0)}% of the Sun covered, the Sun ${Math.round(l.altMax)}° high at the maximum</p>
      <table class="map-contacts"><tr><th></th><th>UTC</th>${host.utc ? "" : "<th>local</th>"}</tr>${rows}</table>
      ${actions}`;
  };
  // the occultation seen from the place: its contacts (UTC, and local),
  // the target's altitude (below the horizon marked) and the Sun's
  const showOccultation = (head) => {
    const TN = occName(occ);
    if (!l) { localBox.innerHTML = `<p>${head}: no occultation</p>`; return; }
    const alt = (t) => horizontal(occ.target, t, place).alt, up = (t) => alt(t) > -0.5;
    const hms = (t) => new Date(t * 1000).toISOString().slice(11, 19);
    const lt = (t) => new Date(t * 1000).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false });
    const rows = (l.r ? [["first contact", l.first], [l.covers ? "disappears" : "second contact", l.C2], [l.covers ? "reappears" : "third contact", l.C3], ["last contact", l.last]]
      : [["disappears", l.first], ["reappears", l.last]])
      .filter(([, t]) => t !== null)
      .map(([n, t]) => `<tr><td>${n}${up(t) ? "" : ` (${esc(TN)} down)`}</td><td>${hms(t)}</td>${host.utc ? "" : `<td>${lt(t)}</td>`}</tr>`).join("");
    const seen = [l.first, l.max, l.last].some(up), sun = horizontal("sun", l.max, place).alt;
    localBox.innerHTML = `<p>${head}: ${esc(TN)} occulted${seen ? `, ${Math.round(alt(l.max))}° high` : ", below the horizon"}, the Sun ${Math.abs(Math.round(sun))}° ${sun < 0 ? "below the horizon" : "high"}</p>
      <table class="map-contacts"><tr><th></th><th>UTC</th>${host.utc ? "" : "<th>local</th>"}</tr>${rows}</table>
      ${actions}`;
  };
  function pick(p) {
    place = [Math.round(p[0] * 1e4) / 1e4, Math.round(p[1] * 1e4) / 1e4];
    l = canPick ? localAt(place) : null;
    showLocal();
    root.querySelector(".lunar-chips").innerHTML = chips();
    if (osmNow) osmNow.setPlace(place);
    if (sim) setTime(cur);
    else redraw();
  }
  let play = 0, last = 0;
  const playBtn = root.querySelector('[data-map="play"]');
  const stop = () => { cancelAnimationFrame(play); play = 0; playBtn.textContent = "▶"; };
  // the whole eclipse in about 30 s
  const step = (now) => {
    if (!svg.isConnected) return;
    const dt = last ? (now - last) / 1000 : 0;
    last = now;
    let t = cur + dt * (to - from) / 30;
    if (t >= to) { t = to; stop(); }
    slider.value = t;
    setTime(t);
    if (play) play = requestAnimationFrame(step);
  };
  // the map or the simulation, as last chosen
  const mode = (which) => {
    sim = canSim && which !== "map";
    if (canSim) host.store.set("solarView", sim ? "sim" : "map");
    root.querySelectorAll("[data-map-mode]").forEach((b) => b.setAttribute("aria-selected", String((b.dataset.mapMode === "sim") === sim)));
    root.querySelector(".map-sim").hidden = !sim;
    if (!sim && play) stop();
    if (sim) setTime(cur);
    size();
    show(host.store.get("mapView", "globe"));
  };
  root.addEventListener("click", (ev) => {
    const md = ev.target.closest("[data-map-mode]");
    if (md) return mode(md.dataset.mapMode);
    const b = ev.target.closest("[data-map], [data-map-t]");
    if (!b) return;
    if (b.dataset.mapT) { stop(); slider.value = b.dataset.mapT; setTime(Number(b.dataset.mapT)); return; }
    if (b.dataset.map === "calc") return host.calc(place);
    if (b.dataset.map === "sky" && l) return host.sky(l.max, place, occ ? [occName(occ), typeof occ.front === "string" ? occ.front[0].toUpperCase() + occ.front.slice(1) : occ.front.name] : ["Sun"]);
    if (play) return stop();
    if (cur >= to) setTime(from);
    b.textContent = "❚❚";
    last = 0;
    play = requestAnimationFrame(step);
  });
  slider.addEventListener("input", () => { stop(); setTime(Number(slider.value)); });
  dragTrack(slider, (t) => { stop(); slider.value = t; setTime(t); });
  showLocal();
  mode(host.store.get("solarView", "sim"));
  host.onResize?.(() => { if (svg.isConnected) size(); });
  const local = (ev) => {
    const b = svg.getBoundingClientRect();
    return { x: ((ev.clientX - b.left) * W) / b.width, y: ((ev.clientY - b.top) * H) / b.height };
  };
  const pts = new Map();
  let base = null, moved = false, lastTap = 0, tapPick = 0;
  const start = () => { base = { v: { ...v }, pts: new Map([...pts].map(([id, p]) => [id, { ...p }])) }; };
  svg.addEventListener("pointerdown", (ev) => {
    svg.setPointerCapture(ev.pointerId);
    pts.set(ev.pointerId, local(ev));
    moved = false;
    start();
  });
  svg.addEventListener("pointermove", (ev) => {
    if (!pts.has(ev.pointerId)) return;
    pts.set(ev.pointerId, local(ev));
    const ids = [...pts.keys()].filter((id) => base.pts.has(id));
    if (ids.length === 1) {
      const p0 = base.pts.get(ids[0]), p1 = pts.get(ids[0]);
      if (Math.hypot(p1.x - p0.x, p1.y - p0.y) > 4) moved = true;
      // turn the Earth: a radian for every radius of the drag
      const lat0 = Math.max(-89, Math.min(89, base.v.lat0 + ((p1.y - p0.y) / base.v.s) * 57.3));
      v = { ...base.v, lat0, lon0: base.v.lon0 - ((p1.x - p0.x) / base.v.s) * 57.3 / Math.max(0.2, Math.cos(lat0 * Math.PI / 180)) };
    } else if (ids.length >= 2) {
      const [a0, b0] = ids.slice(0, 2).map((id) => base.pts.get(id)), [a1, b1] = ids.slice(0, 2).map((id) => pts.get(id));
      const d0 = Math.hypot(a0.x - b0.x, a0.y - b0.y), d1 = Math.hypot(a1.x - b1.x, a1.y - b1.y);
      v = { ...base.v, s: clampS(base.v.s * (d0 > 20 ? d1 / d0 : 1)) };
      moved = true;
    }
    if (moved) chosen = true;
    redraw();
  });
  const up = (ev) => {
    if (!pts.delete(ev.pointerId)) return;
    if (!moved && !pts.size) {
      clearTimeout(tapPick);
      if (ev.timeStamp - lastTap < 350) { v = mapView(m, W, H); chosen = false; redraw(); lastTap = 0; } else {
        lastTap = ev.timeStamp;
        const q = local(ev), p = unproject(v, W, H, q.x, q.y);
        if (p && canPick) tapPick = setTimeout(() => pick(p), 350);
      }
    }
    start();
  };
  svg.addEventListener("pointerup", up);
  svg.addEventListener("pointercancel", up);
  svg.addEventListener("wheel", (ev) => {
    ev.preventDefault();
    v = { ...v, s: clampS(v.s * Math.exp(-ev.deltaY * 0.002)) };
    chosen = true;
    redraw();
  }, { passive: false });
  // the picture to share: the globe or the map of tiles, with the time of
  // the simulation
  return {
    share: () => {
      const cap = sim ? [...caption, when.textContent] : caption, name = occ ? "occultation" : "solar-eclipse";
      return osm.hidden
        ? { root: svg, caption: cap, name }
        : { root: osm, hide: ".leaflet-control-zoom", text: ".osm-label span, .leaflet-control-attribution", caption: cap, name };
    },
  };
}

export { lunarHTML, mountLunar, mapHTML, mountMap, occName, hhmm, dragTrack };
