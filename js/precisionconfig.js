// Set to the deployed astrolabium-ephemeris Worker URL (no trailing path),
// e.g. https://astrolabium-ephemeris.YOUR-SUBDOMAIN.workers.dev .
// Until deployment, retain the verified local data rather than a dead URL.
export const EPHEMERIS_SERVICE = '';
// Public R2 bucket origin/prefix containing manifest.json. The temporary
// r2.dev URL is for the initial pilot; use a custom domain for production.
export const R2_DATA_URL = '';
// Free static hosting with immutable, checksum-verified native SPK chunks.
export const STATIC_DATA_URL = 'https://astrolabium-ephemeris-data.marco-lombardi.workers.dev/';
export const EPHEMERIS_YEARS = STATIC_DATA_URL || R2_DATA_URL || EPHEMERIS_SERVICE ? [1550, 2650] : [1900, 2100];
