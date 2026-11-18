// Compact typed buffers avoid enormous decimal-array exports at fine detail.
const limits = { positions: 2000000, normals: 2000000, waterMask: 700000, indices: 4000000 };
const byteOrder = new Uint8Array(Uint32Array.of(1).buffer)[0] === 1 ? 'LE' : 'BE';
function encode(array) {
  const bytes = new Uint8Array(array.buffer, array.byteOffset, array.byteLength), chunks = [];
  for (let i = 0; i < bytes.length; i += 32768) chunks.push(String.fromCharCode(...bytes.subarray(i, i + 32768)));
  return btoa(chunks.join(''));
}
export function packSurface(config, metrics, meshes) {
  return { version: 2, byteOrder, config, metrics, meshes: meshes.map((m) => ({ extent: m.extent, inner: m.inner, step: m.step, missing: m.missing, ...Object.fromEntries(Object.keys(limits).map(k => [k, encode(m[k])])) })) };
}
export function unpackSurface(d) {
  if (![1, 2].includes(d.version) || !Array.isArray(d.meshes) || d.meshes.length !== 4 || ![d.config?.lat, d.config?.lon, d.config?.eye, d.metrics?.pointGround].every(Number.isFinite)) throw new Error('Invalid surface file');
  if (d.version === 2 && d.byteOrder !== byteOrder) throw new Error('Surface byte order differs from this device');
  const meshes = d.meshes.map(m => {
    const out = { ...m };
    for (const [key, max] of Object.entries(limits)) {
      const type = key === 'indices' ? Uint32Array : Float32Array, value = m[key];
      if (d.version === 1) {
        if (value == null && key === 'waterMask') { out[key] = new Float32Array(m.positions.length / 3); continue; }
        if (!Array.isArray(value) || value.length > max || !value.every(Number.isFinite)) throw new Error(`Invalid ${key} buffer`);
        if (key === 'indices' && !value.every(Number.isInteger)) throw new Error('Noninteger triangle index');
        out[key] = type.from(value);
      } else {
        if (typeof value !== 'string' || value.length > Math.ceil(max * 4 / 3) * 4) throw new Error(`Invalid ${key} buffer`);
        const bytes = Uint8Array.from(atob(value), c => c.charCodeAt(0));
        if (bytes.length % 4 || bytes.length / 4 > max) throw new Error(`Invalid ${key} buffer size`);
        out[key] = new type(bytes.buffer);
      }
    }
    if (out.positions.length % 3 || out.normals.length !== out.positions.length || out.waterMask.length !== out.positions.length / 3 || out.indices.length % 3 || !out.positions.every(Number.isFinite) || !out.normals.every(Number.isFinite) || !out.waterMask.every(v=>v===0||v===1) || !out.indices.every(i => i < out.positions.length / 3)) throw new Error('Invalid mesh geometry');
    return out;
  });
  return { config: d.config, metrics: d.metrics, meshes };
}
