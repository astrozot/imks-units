// Shared clear-sky approximation. Pressure is local station pressure (hPa),
// never sea-level corrected; null follows the observer's elevation.
export const ATMOSPHERE_DEFAULTS = Object.freeze({ pressure: null, temperature: 10, humidity: 40, aerosol: 1, lightPollution: 0 });
const bounded = (v, fallback, lo, hi) => typeof v === 'number' && Number.isFinite(v) ? Math.max(lo, Math.min(hi, v)) : fallback;
export function atmosphereSettings(value = {}) {
  value = value && typeof value === 'object' ? value : {};
  return {
    pressure: value.pressure == null ? null : bounded(value.pressure, null, 0, 1100),
    temperature: bounded(value.temperature, 10, -80, 60),
    humidity: bounded(value.humidity, 40, 0, 100),
    aerosol: bounded(value.aerosol, 1, 0, 5),
    lightPollution: bounded(value.lightPollution, 0, 0, 9),
  };
}
export const standardPressure = (height = 0) => 1013.25 * Math.max(0.001, 1 - 2.25577e-5 * height) ** 5.25588;
// Lightweight path for the thousands of object projections per frame.
export function atmosphericRefractionScale(settings, height = 0) {
  const pressure = bounded(settings?.pressure, null, 0, 1100) ?? standardPressure(height);
  const temperature = bounded(settings?.temperature, 10, -80, 60);
  return pressure / 1013.25 * 283.15 / (273.15 + temperature);
}
export function atmosphericState(settings, height = 0) {
  const p = atmosphereSettings(settings), pressure = p.pressure ?? standardPressure(height);
  const rayleigh = pressure / 1013.25 * 283.15 / (273.15 + p.temperature);
  // Hygroscopic aerosol growth, relative to RH=40%. Water vapour itself
  // does not make visible fog. Actual growth depends on aerosol composition:
  // https://acp.copernicus.org/articles/13/10609/2013/
  // Cap at RH=95%: saturation/cloud microphysics is outside this model.
  const growth = (0.6 / Math.max(0.05, 1 - p.humidity / 100)) ** 0.65;
  const aerosol = p.aerosol * growth * Math.exp(-Math.max(0, height) / 1500);
  const pollution = (10 ** (0.16 * p.lightPollution) - 1) / (10 ** 1.44 - 1);
  return { ...p, pressure, rayleigh, aerosol, growth, pollution,
    extinction: 1.086 * (0.0135 * 8 * rayleigh + 0.03 * 1.5 * aerosol) };
}
export function atmosphericExtinction(alt, state) {
  const s = Math.sin(Math.max(0, alt) * Math.PI / 180);
  return state.extinction * Math.max(0, 1 / (s + 0.025 * Math.exp(-11 * s)) - 1);
}
export function atmosphericTransmission(alt, state) {
  const deg = Math.max(-0.5, alt), s = Math.max(0, Math.sin(alt * Math.PI / 180));
  const m = 1 / (s + 0.50572 * (deg + 6.07995) ** -1.6364);
  return [0.0464, 0.108, 0.2648].map(tau => Math.exp(-m * (tau * state.rayleigh + 0.045 * state.aerosol)));
}
