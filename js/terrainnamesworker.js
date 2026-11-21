import { visibleTerrainFeatures } from './terrainfeatures.js';
self.onmessage = ({ data }) => {
  try { self.postMessage({ features: visibleTerrainFeatures(data.surface, data.features) }); }
  catch (e) { self.postMessage({ error: e.message }); }
};
