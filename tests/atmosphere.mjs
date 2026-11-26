import assert from 'node:assert/strict';
import { atmosphereSettings, atmosphericState, atmosphericExtinction, atmosphericTransmission } from '../js/atmosphere.js';
import { refraction } from '../js/coelum.js';
import { skyColours, skyLight } from '../js/skyraster.js';
const dry = atmosphericState({ humidity: 10 }), wet = atmosphericState({ humidity: 90 });
assert.ok(wet.aerosol > dry.aerosol * 3);
assert.ok(atmosphericExtinction(2, wet) > atmosphericExtinction(2, dry));
assert.ok(atmosphericTransmission(0, wet)[2] < atmosphericTransmission(0, dry)[2]);
assert.ok(atmosphericState({}, 3000).rayleigh < dry.rayleigh);
assert.equal(refraction(5, 0, { pressure: 0 }), 0);
assert.ok(refraction(5, 0, { pressure: 1000 }) > refraction(5, 0, { pressure: 500 }));
assert.ok(refraction(5, 0, { temperature: -20 }) > refraction(5, 0, { temperature: 30 }));
assert.equal(atmosphericState({ aerosol: 0, humidity: 100 }).aerosol, 0);
assert.deepEqual(atmosphereSettings(null), atmosphereSettings());
assert.equal(atmosphereSettings({ humidity: NaN, pressure: Infinity }).pressure, null);
const colours = (humidity, sunAlt = -1, extra = {}) => skyColours({ sun: { alt: sunAlt }, moon: { alt: 40, illum: 1 }, atmosphere: true, atmosphereSettings: { humidity, ...extra } });
assert.notDeepEqual(colours(10).horizon, colours(90).horizon);
assert.ok(colours(90).physical.medium.g > colours(10).physical.medium.g);
assert.ok(colours(90).physical.medium.aerosol > colours(10).physical.medium.aerosol);
assert.ok(colours(90, -25, { lightPollution: 9 }).physical.pollution > colours(90, -25).physical.pollution);
assert.ok(skyLight(-25, null, true, { lightPollution: 9 }).limit < skyLight(-25).limit - 3);
assert.equal(skyLight(-25, null, false, { lightPollution: 9 }).limit, skyLight(-25, null, false).limit);
for (const humidity of [0, 40, 95, 100]) for (const temperature of [-80, 60]) {
  const state = atmosphericState({ humidity, temperature, aerosol: 5 });
  assert.ok(atmosphericTransmission(-10, state).every(Number.isFinite));
  assert.ok(Number.isFinite(atmosphericExtinction(-10, state)));
}
console.log('Atmospheric validation, refraction, humid extinction, sky colours, lunar halo and light pollution passed');
