// Phone sensors, read when their key is tapped: each samples for a moment
// and returns a value with its uncertainty, { v, s, unit } or a list
// { list: [[v, s], …], unit }, which the key types in as a number, so that
// results do not change when they are calculated again.
//
// Each reader starts synchronously (before its first await): iOS asks for
// permission only during the tap.

const R_EARTH = 6371000;
const DEG = 180 / Math.PI;

function need(ok, what) {
  if (!window.isSecureContext) throw new Error("Sensors need the app served over HTTPS");
  if (!ok) throw new Error(`No ${what} on this device`);
}

// Mean and standard error from the means of 10 blocks of samples: the
// samples of a sensor are correlated, so their own scatter would give too
// small an error
function blockStats(xs) {
  const k = 10, n = Math.floor(xs.length / k);
  const mean = (a) => a.reduce((s, x) => s + x, 0) / a.length;
  const m = mean(xs);
  const bm = Array.from({ length: k }, (_, i) => mean(xs.slice(i * n, (i + 1) * n)));
  const v = bm.reduce((s, x) => s + (x - m) ** 2, 0) / (k - 1);
  return [m, Math.sqrt(v / k)];
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------------------------------------------------------------------
// Position: one fix serves lat, lon, alt and here for a minute

let lastFix = null;

function locate(fresh = false) {
  need(navigator.geolocation, "location");
  if (!fresh && lastFix && Date.now() - lastFix.time < 60000) return Promise.resolve(lastFix.c);
  return new Promise((resolve, reject) => navigator.geolocation.getCurrentPosition(
    (p) => { lastFix = { time: Date.now(), c: p.coords }; resolve(p.coords); },
    (e) => reject(new Error(e.code === 1 ? "Location permission denied" : e.code === 3 ? "No location fix (timed out)" : "Location unavailable")),
    { enableHighAccuracy: true, timeout: 20000, maximumAge: 0 },
  ));
}

// the accuracy of a fix is the radius of 95 % confidence: 2.45σ in two
// dimensions, 1.96σ for the altitude
const latLon = (c) => {
  const s = c.accuracy / 2.45 / R_EARTH * DEG;
  return [[c.latitude, s], [c.longitude, s / Math.cos(c.latitude / DEG)]];
};

// ---------------------------------------------------------------------
// Motion and orientation

function permission(C, what) {
  if (typeof C?.requestPermission !== "function") return Promise.resolve();
  return C.requestPermission().then((r) => { if (r !== "granted") throw new Error(`${what} permission denied`); });
}

async function motion(ms = 2000) {
  need("DeviceMotionEvent" in window, "motion sensor");
  await permission(window.DeviceMotionEvent, "Motion");
  const xs = [];
  const on = (e) => {
    const a = e.accelerationIncludingGravity;
    if (a && a.x !== null) xs.push([a.x, a.y, a.z]);
  };
  addEventListener("devicemotion", on);
  await sleep(ms);
  removeEventListener("devicemotion", on);
  if (xs.length < 20) throw new Error("No motion sensor on this device");
  return xs;
}

// The compass heading, clockwise from magnetic north: webkitCompassHeading
// on iOS, the absolute orientation elsewhere (with the phone flat)
async function compass(ms = 1500) {
  need("DeviceOrientationEvent" in window, "compass");
  await permission(window.DeviceOrientationEvent, "Orientation");
  const xs = [];
  const on = (e) => {
    if (typeof e.webkitCompassHeading === "number") xs.push(e.webkitCompassHeading);
    else if (e.absolute && e.alpha !== null) xs.push((360 - e.alpha) % 360);
  };
  addEventListener("deviceorientationabsolute", on);
  addEventListener("deviceorientation", on);
  await sleep(ms);
  removeEventListener("deviceorientationabsolute", on);
  removeEventListener("deviceorientation", on);
  if (xs.length < 10) throw new Error("No compass on this device");
  // around the first reading, so that 359° and 1° average to 0°
  const d = xs.map((x) => ((x - xs[0] + 540) % 360) - 180);
  const [m, s] = blockStats(d);
  return [(m + xs[0] + 360) % 360, s];
}

// ---------------------------------------------------------------------
// Sound: the frequency of a tone, from the normalized autocorrelation of
// frames of the microphone signal (the square difference function of
// McLeod and Wyvill), which finds the fundamental even when a harmonic is
// louder

function frameFrequency(buf, rate) {
  const n = buf.length;
  let e = 0;
  for (const x of buf) e += x * x;
  if (Math.sqrt(e / n) < 0.01) return null;   // silence
  const lo = Math.floor(rate / 2000), hi = Math.min(Math.floor(rate / 40), n >> 1);
  const f = new Float32Array(hi + 2);
  for (let lag = lo - 1; lag <= hi + 1; lag++) {
    let acf = 0, m = 0;
    for (let i = 0; i + lag < n; i++) {
      acf += buf[i] * buf[i + lag];
      m += buf[i] * buf[i] + buf[i + lag] * buf[i + lag];
    }
    f[lag] = m ? 2 * acf / m : 0;
  }
  let top = 0;
  for (let l = lo; l <= hi; l++) top = Math.max(top, f[l]);
  if (top < 0.8) return null;   // no clear tone
  // the first peak close to the highest: the fundamental, not an octave below
  for (let l = lo; l <= hi; l++) {
    if (f[l] > f[l - 1] && f[l] >= f[l + 1] && f[l] >= 0.9 * top) {
      const a = f[l - 1], b = f[l], c = f[l + 1];
      const den = a - 2 * b + c;
      return rate / (l + (den ? (a - c) / (2 * den) : 0));
    }
  }
  return null;
}

async function tone(ms = 1500) {
  need(navigator.mediaDevices?.getUserMedia, "microphone");
  const Ctx = window.AudioContext || window.webkitAudioContext;
  const ctx = new Ctx();
  let stream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false } });
  } catch (e) {
    ctx.close();
    // denied by the system (macOS: Privacy & Security), by the site, or no microphone
    if (e.name === "NotAllowedError" && /system/i.test(e.message)) throw new Error("The system does not let this browser use the microphone: allow it in the system settings (on a Mac, Privacy & Security → Microphone)");
    if (e.name === "NotAllowedError") throw new Error("Microphone permission denied: allow it in the browser's site settings");
    if (e.name === "NotFoundError") throw new Error("No microphone on this device");
    throw new Error("The microphone is not available (is another app using it?)");
  }
  try {
    // resume can wait forever when the browser blocks audio
    await Promise.race([ctx.resume(), sleep(1000)]);
    if (ctx.state !== "running") throw new Error("The browser blocked the microphone audio");
    const an = ctx.createAnalyser();
    an.fftSize = 4096;
    ctx.createMediaStreamSource(stream).connect(an);
    const buf = new Float32Array(an.fftSize);
    const fs = [];
    const step = an.fftSize / ctx.sampleRate * 1000;   // frames that do not overlap
    for (let t = 0; t < ms; t += step) {
      await sleep(step);
      an.getFloatTimeDomainData(buf);
      const x = frameFrequency(buf, ctx.sampleRate);
      if (x) fs.push(x);
    }
    if (fs.length < 5) throw new Error("No clear tone: try a steady note, closer to the phone");
    const m = fs.reduce((s, x) => s + x, 0) / fs.length;
    const sd = Math.sqrt(fs.reduce((s, x) => s + (x - m) ** 2, 0) / (fs.length - 1));
    return [m, sd / Math.sqrt(fs.length)];
  } finally {
    stream.getTracks().forEach((t) => t.stop());
    ctx.close();
  }
}

// ---------------------------------------------------------------------

const SENSORS = {
  here: { hint: "Locating…", read: async () => ({ list: latLon(await locate()), unit: "deg" }) },
  lat: { hint: "Locating…", read: async () => ({ list: [latLon(await locate())[0]], unit: "deg" }) },
  lon: { hint: "Locating…", read: async () => ({ list: [latLon(await locate())[1]], unit: "deg" }) },
  alt: {
    hint: "Locating…",
    read: async () => {
      const c = await locate();
      if (c.altitude === null) throw new Error("No altitude from this device");
      return { list: [[c.altitude, (c.altitudeAccuracy || 0) / 1.96]], unit: "m" };
    },
  },
  speed: {
    hint: "Locating…",
    read: async () => {
      const c = await locate(true);
      if (c.speed === null || Number.isNaN(c.speed)) throw new Error("No speed: it needs GPS and motion");
      return { list: [[c.speed, 0]], unit: "m/s" };
    },
  },
  g: {
    hint: "Hold the phone still…",
    read: async () => ({ list: [blockStats((await motion()).map(([x, y, z]) => Math.hypot(x, y, z)))], unit: "m/s^2" }),
  },
  accel: {
    hint: "Hold the phone still…",
    read: async () => {
      const xs = await motion();
      return { list: [0, 1, 2].map((i) => blockStats(xs.map((a) => a[i]))), unit: "m/s^2", vector: true };
    },
  },
  tilt: {
    hint: "Hold the phone still…",
    read: async () => ({ list: [blockStats((await motion()).map(([x, y, z]) => Math.acos(Math.min(1, Math.abs(z) / Math.hypot(x, y, z))) * DEG))], unit: "deg" }),
  },
  heading: { hint: "Hold the phone flat…", read: async () => ({ list: [await compass()], unit: "deg" }) },
  pitch: { hint: "Listening…", read: async () => ({ list: [await tone()], unit: "Hz" }) },
};

// The readings of the last position fix, as the keys give them: here,
// lat, lon, and alt when the device reports it
function fixReadings() {
  if (!lastFix) return {};
  const c = lastFix.c, [lat, lon] = latLon(c);
  const r = { here: { list: [lat, lon], unit: "deg" }, lat: { list: [lat], unit: "deg" }, lon: { list: [lon], unit: "deg" } };
  if (c.altitude !== null) r.alt = { list: [[c.altitude, (c.altitudeAccuracy || 0) / 1.96]], unit: "m" };
  return r;
}

function sensorAvailable(name) {
  if (!window.isSecureContext) return false;
  if (["here", "lat", "lon", "alt", "speed"].includes(name)) return "geolocation" in navigator;
  if (["g", "accel", "tilt"].includes(name)) return "DeviceMotionEvent" in window;
  if (name === "heading") return "DeviceOrientationEvent" in window;
  if (name === "pitch") return Boolean(navigator.mediaDevices?.getUserMedia);
  return false;
}

export { SENSORS, fixReadings, sensorAvailable, frameFrequency, blockStats };
