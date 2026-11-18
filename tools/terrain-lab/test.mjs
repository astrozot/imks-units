import assert from 'node:assert/strict';
import { tileXY, destination, spacing, tileSampler, hgtTile, profile, difference, currentRings } from './model.mjs';
// Geometry conventions and metric scale.
assert.deepEqual(tileXY(0, 0, 0), [0.5, 0.5]);
assert.ok(Math.abs(destination(0, 0, 90, Math.PI * 6371008.8 / 2)[1] - 90) < 1e-9);
assert.ok(Math.abs(spacing(45.89615, 12, 256) - 26.6) < 0.1);
// Crossing a tile edge must interpolate both tiles, not clamp one side.
const tiles = new Map([['1/0/1', { size: 2, h: new Float32Array([0, 0, 0, 0]) }], ['1/1/1', { size: 2, h: new Float32Array([100, 100, 100, 100]) }]]);
assert.equal(tileSampler(tiles)(-50, 0, 1), 50);
assert.equal(tileSampler(tiles)(-50, -90, 1), 0);
assert.equal(tileSampler(new Map())(0, 0, 1), null);
const fallback = tileSampler(tiles, false, true);
assert.equal(fallback(-50, 0, 2), 50); assert.equal(fallback.stats.fallbackSamples, 1);
assert.equal(tileSampler(tiles)(-50, 0, 2), null);
// HGT uses north-first rows, big endian heights and explicit voids.
const buffer = new ArrayBuffer(1201 * 1201 * 2), view = new DataView(buffer);
view.setInt16(0, 1200); view.setInt16(2, 1400);
const hgt = hgtTile(buffer, 'N45E010.hgt');
assert.equal(hgt.at(46, 10), 1200);
assert.ok(Math.abs(hgt.at(46, 10 + 0.5 / 1200) - 1300) < 1e-6);
assert.equal(hgt.at(44, 10), null);
view.setInt16(0, -32768); assert.equal(hgt.at(46, 10), null);
assert.throws(() => hgtTile(new ArrayBuffer(4), 'N45E010.hgt'));
// Known mountain, observer-height heuristic, and absent coverage.
const sample = (lat, lon) => Math.abs(lat) < 0.00001 && Math.abs(lon) < 0.00001 ? 0 : 100;
const fixed = await profile({ place: [0, 0, 0], sample, rings: [[12, 1000]], radius: 1000, step: 90 });
assert.equal(fixed.eye, 2); assert.ok(fixed.alt.every((a) => a > 75));
const legacy = await profile({ place: [0, 0, 0], sample, rings: [[12, 1000]], radius: 1000, step: 90, legacy: true });
assert.equal(legacy.eye, 102); assert.ok(legacy.alt.every((a) => a < 0));
const absent = await profile({ place: [0, 0, 0], sample: (a, b) => a === 0 && b === 0 ? 0 : null, rings: [[12, 1000]], radius: 1000, step: 90 });
assert.deepEqual(absent.alt, [null, null, null, null]); assert.ok(absent.missing.every((a) => a === 1));
assert.equal(difference(fixed, fixed).max, 0);
// Check the legacy reproduction against the actual production routine, with
// entirely synthetic tile images and a temporary in-memory localStorage.
const saved = new Map(['fetch', 'document', 'createImageBitmap', 'localStorage'].map((k) => [k, Object.getOwnPropertyDescriptor(globalThis, k)]));
try {
  const pixels = new Uint8ClampedArray(256 * 256 * 4);
  for (let i = 0; i < pixels.length; i += 4) pixels.set([128, 100, 0, 255], i); // 100 m
  globalThis.fetch = async () => ({ ok: true, blob: async () => new Blob() });
  globalThis.createImageBitmap = async () => ({ width: 256, height: 256 });
  globalThis.document = { createElement: () => ({ getContext: () => ({ drawImage() {}, getImageData: () => ({ data: pixels }) }) }) };
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: { getItem: () => null, setItem() {} } });
  const { computeHorizon } = await import('../../js/skyhorizon.js');
  const production = await computeHorizon([45.89615, 10.84330, 90]);
  const reproduced = await profile({ place: [45.89615, 10.84330, 90], sample: () => 100, rings: currentRings, radius: 150000, legacy: true, size: 256, step: 0.5 });
  assert.ok(reproduced.alt.every((h, i) => Math.abs(h - production[i]) < 1e-6));
} finally { for (const [key, descriptor] of saved) { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else delete globalThis[key]; } }
console.log('Terrain lab checks passed: geometry, tile seams, HGT decoding, observer height, missing data.');
