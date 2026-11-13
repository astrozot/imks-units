// Bounded native SPK type 2/3 reader. read(offset, length) must return
// exactly that byte range; neither the file nor its full arrays are loaded.
const DAY = 86400, J2000 = 2451545;
const integer = (n) => Number.isSafeInteger(n) && n > 0;
const decoder = new TextDecoder('ascii');

export async function openSpk(read) {
  const first = await read(0, 1024), format = decoder.decode(first.subarray(88, 96));
  if (decoder.decode(first.subarray(0, 8)).trim() !== 'DAF/SPK' || !['LTL-IEEE','BIG-IEEE'].includes(format)) throw new Error('Unsupported SPK file format');
  const little = format === 'LTL-IEEE', header = new DataView(first.buffer, first.byteOffset, first.byteLength);
  if (header.getInt32(8, little) !== 2 || header.getInt32(12, little) !== 6) throw new Error('Invalid SPK summary format');
  let next = header.getInt32(76, little);
  const segments = [], visited = new Set();
  while (next) {
    if (!integer(next) || visited.has(next) || visited.size >= 128) throw new Error('Invalid or oversized SPK index');
    visited.add(next);
    const bytes = await read((next - 1) * 1024, 1024), view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const count = view.getFloat64(16, little);
    if (!Number.isInteger(count) || count < 0 || count > 25 || segments.length + count > 2048) throw new Error('Invalid SPK summary count');
    for (let i = 0; i < count; i++) {
      const at = 24 + i * 40;
      const s = { from: view.getFloat64(at, little), to: view.getFloat64(at + 8, little), target: view.getInt32(at + 16, little), center: view.getInt32(at + 20, little), frame: view.getInt32(at + 24, little), type: view.getInt32(at + 28, little), first: view.getInt32(at + 32, little), last: view.getInt32(at + 36, little) };
      if (!Number.isFinite(s.from) || !(s.to > s.from) || !integer(s.first) || !integer(s.last) || s.last < s.first) throw new Error('Invalid SPK segment');
      segments.push(s);
    }
    next = view.getFloat64(0, little);
  }
  const layout = async (s) => {
    if (s.layout) return s.layout;
    if (![2, 3].includes(s.type) || s.frame !== 1) throw new Error('Only native SPK type 2/3 in the ICRF frame is supported');
    const bytes = await read((s.last - 4) * 8, 32), v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const init = v.getFloat64(0, little), step = v.getFloat64(8, little), size = v.getFloat64(16, little), count = v.getFloat64(24, little), axes = s.type === 2 ? 3 : 6, terms = (size - 2) / axes;
    if (!Number.isFinite(init) || !(step > 0) || !Number.isFinite(step) || !integer(size) || !integer(count) || !integer(terms) || terms < 2 || terms > 33 || count * size + 4 !== s.last - s.first + 1) throw new Error('Invalid SPK record directory');
    return s.layout = { init, step, size, count, terms };
  };
  const extract = async (center, target, fromJD, toJD) => {
    if (!Number.isFinite(fromJD) || !(toJD > fromJD) || toJD - fromJD > 32) throw new RangeError('SPK extraction needs an interval of at most 32 days');
    const from = (fromJD - J2000) * DAY, to = (toJD - J2000) * DAY;
    // SPICE gives later summaries precedence. Keep a request within one
    // continuous native segment; never extrapolate a polynomial.
    const s = segments.findLast((s) => s.center === center && s.target === target && s.from <= from && s.to >= to);
    if (!s) throw new RangeError(`No native SPK coverage for ${center} → ${target} over the requested interval`);
    const l = await layout(s), first = Math.max(0, Math.floor((from - l.init) / l.step)), last = Math.min(l.count, Math.floor((to - l.init) / l.step) + 1), count = last - first;
    if (count < 1 || count > 512 || l.init + first * l.step > from || l.init + last * l.step < to || count * l.size * 8 > 512 * 1024) throw new RangeError('Requested SPK interval is too large or crosses native coverage');
    const raw = await read((s.first - 1 + first * l.size) * 8, count * l.size * 8), view = new DataView(raw.buffer, raw.byteOffset, raw.byteLength);
    const positions = new Float64Array(count * 3 * l.terms), velocities = s.type === 3 ? new Float64Array(positions.length) : null;
    for (let i = 0; i < count; i++) {
      const at = i * l.size * 8, mid = view.getFloat64(at, little), radius = view.getFloat64(at + 8, little);
      if (Math.abs(mid - (l.init + (first + i + .5) * l.step)) > .01 || Math.abs(radius - l.step / 2) > .001) throw new Error('Inconsistent SPK record epoch');
      for (let axis = 0; axis < (velocities ? 6 : 3); axis++) for (let k = 0; k < l.terms; k++) {
        const x = view.getFloat64(at + (2 + axis * l.terms + k) * 8, little);
        if (!Number.isFinite(x)) throw new Error('Non-finite SPK coefficient');
        if (axis < 3) positions[(i * 3 + axis) * l.terms + k] = x;
        else velocities[(i * 3 + axis - 3) * l.terms + k] = x * DAY;
      }
    }
    return { center, target, start: J2000 + (l.init + first * l.step) / DAY, step: l.step / DAY, count, degree: l.terms - 1, positions, velocities };
  };
  return { segments, extract };
}

// Retain native coefficients; there is no sampling or new polynomial fit.
export function encodeSpkPack(records, metadata, orientation = []) {
  if (!records.length || records.length > 32) throw new Error('Invalid SPK selection');
  const header = { ...metadata, version: 1, timeScale: 'TDB', segments: [] }, payload = [];
  let offset = 0;
  for (const { positions, velocities, ...record } of records) {
    const s = { ...record, offset }; payload.push(positions); offset += positions.length;
    if (velocities) { s.velocityOffset = offset; payload.push(velocities); offset += velocities.length; }
    header.segments.push(s);
  }
  if (orientation.length > 1) {
    header.eop = { offset, count: orientation.length, stride: 4 };
    const daily = new Float64Array(orientation.flat()); payload.push(daily); offset += daily.length;
  }
  const json = new TextEncoder().encode(JSON.stringify(header)), start = 16 + Math.ceil(json.length / 8) * 8;
  if (json.length > 64 * 1024 || start + offset * 8 > 512 * 1024) throw new RangeError('Native SPK extract exceeds the phone download limit');
  const buffer = new ArrayBuffer(start + offset * 8), bytes = new Uint8Array(buffer), view = new DataView(buffer);
  bytes.set(new TextEncoder().encode('IMKSEPH1')); view.setUint32(8, json.length, true); bytes.set(json, 16);
  let at = start;
  for (const array of payload) for (const x of array) { view.setFloat64(at, x, true); at += 8; }
  return buffer;
}
