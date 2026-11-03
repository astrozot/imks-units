// Pictures of the diagrams, to share: the canvases, images and SVG drawings
// inside an element, where they are on the page, and some of its text,
// drawn into a PNG under a caption

// the styles of the SVG elements, from the stylesheet into each element:
// a drawing made an image sees no stylesheet
const PROPS = ["fill", "fill-opacity", "fill-rule", "stroke", "stroke-width", "stroke-opacity", "stroke-dasharray", "stroke-linecap", "stroke-linejoin",
  "opacity", "font-family", "font-size", "font-weight", "font-style", "text-anchor", "dominant-baseline", "letter-spacing", "paint-order", "mix-blend-mode", "visibility", "display"];

// url(#id) as some browsers give it back, with the page's address in front
const localUrl = (v) => v.replace(/url\(\s*"?[^#")]*#([^")]*)"?\s*\)/g, "url(#$1)");

function styledClone(svg, w, h) {
  const out = svg.cloneNode(true), from = [svg, ...svg.querySelectorAll("*")], to = [out, ...out.querySelectorAll("*")];
  from.forEach((el, i) => {
    const cs = getComputedStyle(el);
    for (const p of PROPS) to[i].style.setProperty(p, localUrl(cs.getPropertyValue(p)));
  });
  // its place is where it is drawn: not moved again (Leaflet's overlay)
  out.style.transform = "none";
  out.setAttribute("xmlns", "http://www.w3.org/2000/svg");
  out.setAttribute("width", w);
  out.setAttribute("height", h);
  return out;
}

// the files of the <image>s of a drawing (img/moon.webp) into it, as data
const dataUrls = new Map();
async function dataUrl(src) {
  if (!dataUrls.has(src)) {
    dataUrls.set(src, fetch(src).then((r) => r.blob()).then((b) => new Promise((ok, no) => {
      const f = new FileReader();
      f.onload = () => ok(f.result);
      f.onerror = no;
      f.readAsDataURL(b);
    })));
  }
  return dataUrls.get(src);
}
async function inlineImages(svg) {
  for (const im of svg.querySelectorAll("image")) {
    const src = im.getAttribute("href") || im.getAttribute("xlink:href");
    if (!src || src.startsWith("data:")) continue;
    try { im.setAttribute("href", await dataUrl(new URL(src, location.href).href)); } catch { im.remove(); }
  }
}

function load(src, cors) {
  const img = new Image();
  if (cors) img.crossOrigin = "anonymous";
  img.src = src;
  return img.decode().then(() => img);
}

// the layers inside root, in the order they are painted, at their places
// from its corner; the text of the elements matching textSel
function layers(root, textSel) {
  const box = root.getBoundingClientRect(), out = [];
  const place = (el) => {
    const r = el.getBoundingClientRect();
    return { x: r.left - box.left, y: r.top - box.top, w: r.width, h: r.height };
  };
  const visit = (el) => {
    const cs = getComputedStyle(el);
    if (cs.display === "none" || cs.visibility === "hidden") return;
    const at = place(el);
    if (el instanceof SVGSVGElement) { if (at.w && at.h) out.push({ svg: styledClone(el, at.w, at.h), ...at }); return; }
    if (el instanceof HTMLCanvasElement) {
      if (!at.w || !at.h || !el.width) return;
      // a copy: the canvas may be drawn again before the picture is made
      const c = document.createElement("canvas");
      c.width = el.width;
      c.height = el.height;
      c.getContext("2d").drawImage(el, 0, 0);
      out.push({ canvas: c, ...at });
      return;
    }
    if (el instanceof HTMLImageElement) {
      if (at.w && at.h && el.complete && el.naturalWidth) out.push({ src: el.currentSrc || el.src, opacity: Number(cs.opacity), ...at });
      return;
    }
    if (textSel && el.matches(textSel)) {
      const text = el.textContent.replace(/\s+/g, " ").trim();
      if (text) {
        out.push({
          text, ...at,
          font: `${cs.fontStyle} ${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`,
          size: parseFloat(cs.fontSize), line: parseFloat(cs.lineHeight) || 1.25 * parseFloat(cs.fontSize),
          color: cs.color, back: cs.backgroundColor, wrap: cs.whiteSpace !== "nowrap",
          align: cs.textAlign === "right" || cs.textAlign === "end" ? "right" : cs.textAlign === "center" ? "center" : "left",
          halo: cs.textShadow === "none" ? null : /rgba?\([^)]*\)|#[0-9a-f]+/i.exec(cs.textShadow)?.[0],
          pad: [parseFloat(cs.paddingTop), parseFloat(cs.paddingLeft)],
        });
      }
      return;
    }
    for (const c of el.children) visit(c);
  };
  visit(root);
  return { w: box.width, h: box.height, layers: out };
}

// the lines of text within the width w
function wrap(ctx, text, w) {
  const lines = [];
  let line = "";
  for (const word of text.split(" ")) {
    const t = line ? `${line} ${word}` : word;
    if (line && ctx.measureText(t).width > w) { lines.push(line); line = word; } else line = t;
  }
  if (line) lines.push(line);
  return lines;
}

function drawText(ctx, l) {
  if (l.back && !/^(transparent|rgba\(.*,\s*0\))$/.test(l.back)) {
    ctx.fillStyle = l.back;
    ctx.fillRect(l.x, l.y, l.w, l.h);
  }
  ctx.font = l.font;
  ctx.textBaseline = "middle";
  ctx.textAlign = l.align;
  const inner = l.w - 2 * l.pad[1] + 2, lines = l.wrap ? wrap(ctx, l.text, inner) : [l.text];
  const x = l.align === "right" ? l.x + l.w - l.pad[1] : l.align === "center" ? l.x + l.w / 2 : l.x + l.pad[1];
  lines.forEach((s, i) => {
    const y = l.y + l.pad[0] + l.line * (i + 0.5);
    if (l.halo) {
      ctx.strokeStyle = l.halo;
      ctx.lineWidth = 3;
      ctx.lineJoin = "round";
      ctx.strokeText(s, x, y);
    }
    ctx.fillStyle = l.color;
    ctx.fillText(s, x, y);
  });
}

// the background of el: its own, or the first one under it
function background(el) {
  for (let e = el; e; e = e.parentElement) {
    const b = getComputedStyle(e).backgroundColor;
    if (b && !/^(transparent|rgba\(.*,\s*0\))$/.test(b)) return b;
  }
  return "#fff";
}

// A PNG of what root shows, without the elements matching hide, under the
// caption (lines, in the font and colour of the page); the text of the
// elements matching text is drawn too. The page is read at once (the
// drawings may change right after), the picture made after
export async function snapshot(root, { hide = "", text = "", caption = [] } = {}) {
  const hidden = hide ? [...root.querySelectorAll(hide)] : [];
  const was = hidden.map((el) => el.style.display);
  hidden.forEach((el) => { el.style.display = "none"; });
  let shot;
  try { shot = layers(root, text); } finally { hidden.forEach((el, i) => { el.style.display = was[i]; }); }
  const page = getComputedStyle(document.body), bg = background(root.parentElement || root);
  const k = Math.max(2, Math.min(3, window.devicePixelRatio || 1)), pad = 12, mono = `14px ${page.getPropertyValue("--mono") || "monospace"}`;
  // the caption: its lines wrapped to the width of the picture
  const measure = document.createElement("canvas").getContext("2d");
  measure.font = mono;
  const lines = caption.filter(Boolean).flatMap((c) => wrap(measure, c, shot.w));
  const top = lines.length ? pad + 19 * lines.length + 6 : pad;
  const out = document.createElement("canvas");
  out.width = Math.round((shot.w + 2 * pad) * k);
  out.height = Math.round((shot.h + top + pad) * k);
  const ctx = out.getContext("2d");
  ctx.scale(k, k);
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, shot.w + 2 * pad, shot.h + top + pad);
  ctx.font = mono;
  ctx.fillStyle = page.color;
  ctx.textBaseline = "middle";
  lines.forEach((s, i) => ctx.fillText(s, pad, pad + 19 * i + 9.5));
  // the layers clipped to root, over its background (the sky of the moons,
  // the grey of a map beyond the tiles)
  const own = getComputedStyle(root);
  ctx.save();
  ctx.translate(pad, top);
  ctx.beginPath();
  if (ctx.roundRect) ctx.roundRect(0, 0, shot.w, shot.h, parseFloat(own.borderTopLeftRadius) || 0);
  else ctx.rect(0, 0, shot.w, shot.h);
  ctx.clip();
  if (!/^(transparent|rgba\(.*,\s*0\))$/.test(own.backgroundColor)) {
    ctx.fillStyle = own.backgroundColor;
    ctx.fillRect(0, 0, shot.w, shot.h);
  }
  // the images first loaded, all together; a tile that cannot be read
  // (a server without CORS) is left out, or the canvas could not be saved
  const ready = await Promise.all(shot.layers.map(async (l) => {
    try {
      if (l.svg) {
        await inlineImages(l.svg);
        return { ...l, img: await load(`data:image/svg+xml;charset=utf-8,${encodeURIComponent(new XMLSerializer().serializeToString(l.svg))}`) };
      }
      if (l.src) return { ...l, img: await load(l.src, !l.src.startsWith("data:") && new URL(l.src, location.href).origin !== location.origin) };
      return l;
    } catch { return null; }
  }));
  for (const l of ready) {
    if (!l) continue;
    if (l.text) { drawText(ctx, l); continue; }
    ctx.globalAlpha = l.opacity ?? 1;
    ctx.drawImage(l.canvas || l.img, l.x, l.y, l.w, l.h);
    ctx.globalAlpha = 1;
  }
  ctx.restore();
  return new Promise((ok, no) => out.toBlob((b) => (b ? ok(b) : no(new Error("No picture"))), "image/png"));
}
