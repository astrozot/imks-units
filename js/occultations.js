// Occultations by the Moon of the planets and of the stars to magnitude
// OCC_MAG (the chart's, stardata.js), found over some days, from a place
// or anywhere on the Earth; shared by the apps. The Moon's center every
// hour against the targets (the stars as of the middle of the days, the
// planets every 6 hours): those it passes within 1.8° (its parallax, its
// radius, the steps) are computed exactly (astro.js).
import { equatorial, occultation, occultationLocal, horizontal, magnitude, occultationCandidate, aspect } from "./astro.js";
import { CHART_STARS } from "./stardata.js";

const OCC_MAG = 5;
const PLANETS = ["mercury", "venus", "mars", "jupiter", "saturn", "uranus", "neptune"];
const RAD = Math.PI / 180, HOUR = 3600, DAY = 86400;
const unit = (p) => [Math.cos(p.dec * RAD) * Math.cos(p.ra * RAD), Math.cos(p.dec * RAD) * Math.sin(p.ra * RAD), Math.sin(p.dec * RAD)];
const sepOf = (a, b) => Math.acos(Math.min(1, a[0] * b[0] + a[1] * b[1] + a[2] * b[2])) / RAD;

// The stars near the Moon's path, as the chart names them (its name, or
// its first designation), as astro.js takes them
let stars = null;
const starTargets = () => (stars ??= CHART_STARS
  .filter((s) => s[3] <= OCC_MAG && occultationCandidate("moon", s[1], s[2]))
  .map(([hip, ra, dec, mag, , , pmra, pmdec, plx, proper, names]) => ({ name: proper || (names ? names.split("|")[0] : `HIP ${hip}`), ra, dec, pmra, pmdec, plx, rv: 0, mag, kind: "star" })));
const nameOf = (target) => (typeof target === "string" ? target[0].toUpperCase() + target.slice(1) : target.name);
const magOf = (target, t) => (typeof target === "string" ? magnitude(target, t) : target.mag);

// The closest approaches of the Moon's center to the targets within 1.8°,
// from t0 for the days: [{ target, t }]
function candidates(t0, days) {
  const n = Math.ceil(days * 24), moon = [];
  for (let k = 0; k <= n; k++) moon.push(unit(equatorial("moon", t0 + k * HOUR)));
  const out = [];
  const scan = (target, at) => {
    let best = null;
    for (let k = 0; k <= n; k++) {
      const d = sepOf(moon[k], at(k));
      if (d < 1.8) { if (!best || d < best.d) best = { d, k }; } else if (best) { out.push({ target, t: t0 + best.k * HOUR }); best = null; }
    }
    if (best) out.push({ target, t: t0 + best.k * HOUR });
  };
  const mid = t0 + days * DAY / 2;
  for (const s of starTargets()) { const w = unit(equatorial(s, mid)); scan(s, () => w); }
  for (const p of PLANETS) {
    const at = Array.from({ length: Math.ceil(n / 6) + 1 }, (_, j) => unit(equatorial(p, t0 + j * 6 * HOUR)));
    scan(p, (k) => at[Math.round(k / 6)]);
  }
  return out.sort((a, b) => a.t - b.t);
}

// How a contact is seen from the place: the target's and the Sun's
// altitudes, and whether it can be seen: above the horizon, in a dark sky
// (the Sun 6° below the horizon), after sunset for the brightest (to
// magnitude 1.5), in daylight for Venus, Jupiter and the like
function contact(target, t, place, mag) {
  const alt = horizontal(target, t, place).alt, sun = horizontal("sun", t, place).alt;
  const sky = mag <= -1 ? 90 : mag <= 1.5 ? -0.8 : -6;
  return { t, alt, sun, seen: alt > 0 && sun < sky };
}

// The occultations from t0, for the days, in time order (a generator,
// yielding the part done, 0 to 1, after each candidate).
// From a place: those seen there (going in or coming out), { target, name,
// mag, e (occultationLocal), in, out (contact), lit (of the Moon), t: e.first };
// anywhere: { target, name, mag, max, covers, lit, t: max }
function* search(t0, days, place) {
  const list = [], cands = candidates(t0, days), end = t0 + days * DAY;
  for (let i = 0; i < cands.length; i++) {
    const { target, t } = cands[i], name = nameOf(target);
    if (place) {
      const e = occultationLocal(target, "moon", t, place);
      if (e && e.first !== null && e.last !== null && e.last >= t0 && e.first < end) {
        const mag = magOf(target, e.max), into = contact(target, e.first, place, mag), out = contact(target, e.last, place, mag);
        if (into.seen || out.seen) list.push({ target, name, mag, e, in: into, out, lit: (1 + Math.cos(aspect("moon", e.max).phase * RAD)) / 2, t: e.first });
      }
    } else {
      const e = occultation(target, "moon", t - DAY / 2, null, 1 / 365.25);
      if (e && Math.abs(e.max - t) < DAY && e.max >= t0 && e.max < end) {
        list.push({ target, name, mag: magOf(target, e.max), max: e.max, covers: e.covers, lit: (1 + Math.cos(aspect("moon", e.max).phase * RAD)) / 2, t: e.max });
      }
    }
    yield (i + 1) / cands.length;
  }
  return list.sort((a, b) => a.t - b.t);
}

// At once (iMKS's occultations()), or yielding to the page every few
// candidates: job.done (0 to 1) as they are computed, job.progress() now
// and then, job.stop to end (then null)
function lunarOccultationsNow(t0, days, place) {
  const it = search(t0, days, place);
  for (;;) { const r = it.next(); if (r.done) return r.value; }
}
async function lunarOccultations(t0, days, place, job = {}) {
  const it = search(t0, days, place);
  for (let i = 0; ; i++) {
    const r = it.next();
    if (r.done) return r.value;
    job.done = r.value;
    if (i % 4 === 3) {
      job.progress?.();
      await new Promise((res) => setTimeout(res, 0));
      if (job.stop) return null;
    }
  }
}

export { OCC_MAG, lunarOccultations, lunarOccultationsNow };
