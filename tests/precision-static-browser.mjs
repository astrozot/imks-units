// Run with optional STATIC_STAGED or STATIC_URL to exercise full/public data.
process.env.STATIC_TEST='1';
await import('./precision-r2-browser.mjs');
