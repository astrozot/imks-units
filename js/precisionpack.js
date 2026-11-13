// Optional native DE440 records. This module is never imported by the sky
// renderer. Binary records are zero-copy views of one bounded year buffer.
export const PRECISION_LIMITS = Object.freeze({ fileBytes: 512 * 1024, headerBytes: 64 * 1024, residentBytes: 1024 * 1024, diskBytes: 8 * 1024 * 1024 });

export function readPrecisionPack(buffer) {
  if (!(buffer instanceof ArrayBuffer) || buffer.byteLength < 24 || buffer.byteLength > PRECISION_LIMITS.fileBytes) throw new Error('Invalid precision file size');
  const view = new DataView(buffer), decoder = new TextDecoder();
  if (decoder.decode(new Uint8Array(buffer, 0, 8)) !== 'IMKSEPH1') throw new Error('Unknown precision format');
  const length = view.getUint32(8, true), offset = 16 + Math.ceil(length / 8) * 8;
  if (!length || length > PRECISION_LIMITS.headerBytes || offset > buffer.byteLength || (buffer.byteLength - offset) % 8) throw new Error('Invalid precision header');
  const header = JSON.parse(decoder.decode(new Uint8Array(buffer, 16, length))), data = new Float64Array(buffer, offset);
  if (header.version !== 1 || !Array.isArray(header.segments) || header.segments.length > 32 || !Number.isFinite(header.fromJD) || !(header.toJD > header.fromJD)) throw new Error('Invalid precision metadata');
  const segments = new Map();
  for (const s of header.segments) {
    if (![s.center, s.target, s.count, s.degree, s.offset].every(Number.isSafeInteger) || s.count <= 0 || s.count > 512 || s.degree < 1 || s.degree > 32 || s.offset < 0 || !(s.step > 0) || !Number.isFinite(s.step) || !Number.isFinite(s.start) || s.start > header.fromJD || s.start + s.step * s.count < header.toJD || s.offset + s.count * 3 * (s.degree + 1) > data.length || segments.has(`${s.center}:${s.target}`)) throw new Error('Invalid precision record');
    if (s.velocityOffset !== undefined && (!Number.isSafeInteger(s.velocityOffset) || s.velocityOffset < 0 || s.velocityOffset + s.count * 3 * (s.degree + 1) > data.length)) throw new Error('Invalid native velocity record');
    if(s.leftBoundaries!==undefined&&(!header.native||!Array.isArray(s.leftBoundaries)||s.leftBoundaries.length>32||s.leftBoundaries.some(i=>!Number.isSafeInteger(i)||i<1||i>=s.count)))throw new Error('Invalid native epoch boundaries');
    segments.set(`${s.center}:${s.target}`, s);
  }
  if (data.some((x) => !Number.isFinite(x))) throw new Error('Non-finite precision coefficient');
  if (header.eop) {
    const e = header.eop;
    if (!Number.isSafeInteger(e.offset) || !Number.isSafeInteger(e.count) || e.count < 2 || e.count > 400 || e.stride !== 4 || e.offset < 0 || e.offset + e.count * 4 > data.length) throw new Error('Invalid Earth-orientation records');
    for (let i = 0; i < e.count; i++) {
      const at = e.offset + i * 4;
      if (i && Math.abs(data[at] - data[at - 4] - 1) > 1e-9 || Math.abs(data[at + 1]) > 5 || Math.abs(data[at + 2]) > 5 || Math.abs(data[at + 3]) > 2) throw new Error('Invalid Earth-orientation values');
    }
  }
  const native = (center, target, jd) => {
    const s = segments.get(`${center}:${target}`);
    if (!s || !Number.isFinite(jd) || jd < header.fromJD || jd > header.toJD) throw new RangeError('Date outside the loaded precision interval');
    let record = Math.min(s.count - 1, Math.floor((jd - s.start) / s.step));
    if(s.leftBoundaries?.includes(record)&&jd===s.start+record*s.step)record--;
    if (record < 0 || record >= s.count) throw new RangeError('Precision record unavailable');
    const x = 2 * (jd - s.start - record * s.step) / s.step - 1, n = s.degree + 1;
    const position = [], velocity = [];
    for (let axis = 0; axis < 3; axis++) {
      const at = s.offset + (record * 3 + axis) * n;
      let b1 = 0, b2 = 0, d1 = 0, d2 = 0;
      for (let k = s.degree; k >= 1; k--) {
        const b0 = 2 * x * b1 - b2 + data[at + k], d0 = 2 * b1 + 2 * x * d1 - d2;
        b2 = b1; b1 = b0; d2 = d1; d1 = d0;
      }
      position.push(x * b1 - b2 + data[at]); velocity.push((b1 + x * d1 - d2) * 2 / s.step);
      if (s.velocityOffset !== undefined) {
        const vi = s.velocityOffset + (record * 3 + axis) * n; let a = 0, b = 0;
        for (let k = s.degree; k >= 1; k--) { const c = 2 * x * a - b + data[vi + k]; b = a; a = c; }
        velocity[axis] = x * a - b + data[vi];
      }
    }
    return { position, velocity };
  };
  const orientation = (jd) => {
    const e = header.eop;
    if (!e) return null;
    if (!Number.isSafeInteger(e.offset) || !Number.isSafeInteger(e.count) || e.count < 2 || e.offset < 0 || e.offset + e.count * 4 > data.length) throw new Error('Invalid Earth-orientation records');
    const first = data[e.offset], last = data[e.offset + (e.count - 1) * 4];
    if (jd < first || jd > last) return null;
    let i = Math.min(e.count - 2, Math.max(0, Math.floor(jd - first)));
    const at = e.offset + 4 * i, span = data[at + 4] - data[at], f = (jd - data[at]) / span;
    if (!(span > 0 && span <= 2)) return null;
    // Do not interpolate across a UTC leap discontinuity.
    let u1 = data[at + 3], u2 = data[at + 7];
    if (Math.abs(u2 - u1) > 0.5) u2 -= Math.round(u2 - u1);
    return { xp: data[at + 1] + f * (data[at + 5] - data[at + 1]), yp: data[at + 2] + f * (data[at + 6] - data[at + 2]), dut1: u1 + f * (u2 - u1) };
  };
  return { header, byteLength: buffer.byteLength, native, orientation, has: (center, target) => segments.has(`${center}:${target}`) };
}
