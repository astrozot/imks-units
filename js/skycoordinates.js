// Parse whole coordinate queries before catalogue-name normalization removes
// signs and units. Only the final sexagesimal field may have a fraction.
const number = String.raw`(?:\d+(?:\.\d*)?|\.\d+)`;
const decimal = new RegExp(`^([+-]?)(${number})$`);
const labelled = new RegExp(`^([+-]?)(${number})\\s*([hd°])(?:\\s*(${number})\\s*[m'](?:\\s*(${number})\\s*[s"])?)?$`, 'i');
const colon = new RegExp(`^([+-]?)(\\d+)\\s*:\\s*(${number})(?:\\s*:\\s*(${number}))?$`);
const spaced = new RegExp(`^([+-]?)(\\d+)\\s+(${number})(?:\\s+(${number}))?$`);

function angle(text, hours) {
  const m = labelled.exec(text) || colon.exec(text) || spaced.exec(text) || decimal.exec(text);
  if (!m) return null;
  const explicit = /[hd°]/i.test(m[3] || '');
  const unit = explicit ? m[3].toLowerCase() : null;
  const minutes = explicit ? m[4] : m[3], seconds = explicit ? m[5] : m[4];
  if (minutes !== undefined && (Number(minutes) >= 60 || !Number.isInteger(Number(m[2])))) return null;
  if (seconds !== undefined && (Number(seconds) >= 60 || !Number.isInteger(Number(minutes)))) return null;
  if (unit === 'h' && !hours) return null;
  const inHours = unit === 'h' || (!unit && minutes !== undefined && hours);
  const value = (Number(m[2]) + Number(minutes || 0) / 60 + Number(seconds || 0) / 3600) * (m[1] === '-' ? -1 : 1) * (inHours ? 15 : 1);
  return Number.isFinite(value) ? value : null;
}

export function parseSkyCoordinates(query) {
  const text = String(query).trim().replace(/−/g, '-').replace(/[′’]/g, "'").replace(/[″”]/g, '"');
  const prefix = /^(GA|AZ)\s+/i.exec(text), system = prefix ? prefix[1].toUpperCase() : 'EQ';
  const body = prefix ? text.slice(prefix[0].length) : text;
  // Try boundaries between complete angles, including compact unit notation.
  // The second angle must always start with an explicit sign.
  const pairs = new Map();
  for (let i = 1; i < body.length; i++) {
    if (!/[\s,]/.test(body[i]) && !/[+-]/.test(body[i])) continue;
    const left = body.slice(0, i).trim(), right = body.slice(i).replace(/^\s*,?\s*/, '').trim();
    if (!/^[+-]/.test(right)) continue;
    const lon = angle(left, system === 'EQ'), lat = angle(right, false);
    if (lon === null || lat === null || Math.abs(lat) > 90) continue;
    if (system === 'EQ' ? lon < 0 || lon > 360 : Math.abs(lon) > 360) continue;
    pairs.set(`${lon},${lat}`, { system, lon: (lon + 360) % 360, lat });
  }
  return pairs.size === 1 ? pairs.values().next().value : null;
}
