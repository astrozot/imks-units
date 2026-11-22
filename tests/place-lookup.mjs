// Regression fixtures from Nominatim/Photon, checked 2026-11-22. No network.
import assert from 'node:assert/strict';
import { fetchPlace } from '../js/lookup.js';
const province = { name:'Rieti', display_name:'Rieti, Lazio, Italia', lat:'42.4147364', lon:'12.8858881', category:'boundary', addresstype:'county', boundingbox:['42.0889167','42.7409686','12.4372963','13.4099792'] };
const city = { name:'Rieti', display_name:'Rieti, Lazio, 02100, Italia', lat:'42.4025479', lon:'12.8605297', category:'boundary', addresstype:'city', extratags:{linked_place:'city'} };
const municipality = { name:'Carisolo', display_name:'Carisolo, Trentino, Italia', lat:'46.2258024', lon:'10.7186366', category:'boundary', addresstype:'city', boundingbox:['46.1585462','46.2412545','10.6782764','10.7739220'] };
const village = { properties:{name:'Carisolo',osm_key:'place',osm_value:'village'},geometry:{type:'Point',coordinates:[10.7591591,46.1687756]} };
let nominatim, photon, calls;
const originalFetch = globalThis.fetch;
globalThis.fetch = async input => {
  const url = new URL(input); calls.push(url);
  if (url.hostname === 'nominatim.openstreetmap.org') return Response.json(nominatim);
  if (url.hostname === 'photon.komoot.io') return Response.json(photon);
  assert.equal(url.hostname, 'api.open-meteo.com');
  return Response.json({elevation:[url.searchParams.get('latitude') === '46.1687756' ? 798 : 404]});
};
const reset = (n, p = {}) => { nominatim=n; photon=p; calls=[]; };
try {
  reset([province,{...city,lat:'56.690704',lon:'23.8984015'},city]);
  const [,rieti] = await fetchPlace('Rieti');
  assert.deepEqual([rieti.lat,rieti.lon,rieti.h],[42.4025479,12.8605297,404]);
  assert.equal(calls.length,2,'Linked city centre needs no supplementary lookup');
  reset([municipality],{features:[{...village,geometry:{coordinates:[11,47]}},village]});
  const [key,carisolo] = await fetchPlace('Carisolo');
  assert.equal(key,'carisolo');
  assert.deepEqual([carisolo.lat,carisolo.lon,carisolo.h],[46.1687756,10.7591591,798]);
  assert.equal(calls.at(-1).searchParams.get('longitude'),'10.7591591','Elevation uses the corrected centre');
  reset([municipality],{features:[{...village,properties:{name:'Pinzolo',osm_key:'place',osm_value:'village'}}, {...village,geometry:{coordinates:[11,47]}}]});
  await assert.rejects(fetchPlace('Carisolo'),/Could not resolve the inhabited centre/);
  assert.equal(calls.length,2,'Never fetch elevation for an unrelated settlement or the boundary centroid');
  reset([{display_name:'Torre pendente, Pisa, Italia',lat:'43.723',lon:'10.3966'}]);
  assert.equal((await fetchPlace('Leaning Tower of Pisa'))[1].lat,43.723,'Keep arbitrary POIs and translated queries');
  reset([province,city]);
  assert.equal((await fetchPlace('Provincia di Rieti'))[1].lat,42.4147364,'Explicit province searches keep their meaning');
  reset([]);await assert.rejects(fetchPlace('Unknown'),/not known to OpenStreetMap/);
  reset([{lat:'NaN',lon:'12'}]);await assert.rejects(fetchPlace('Invalid'),/Invalid place coordinates/);
  console.log('Place lookup settlement centres, administrative ranking, elevation and failure checks passed');
} finally { globalThis.fetch = originalFetch; }
