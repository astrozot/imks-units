import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createWaterMask,decodeWaterTile } from '../js/terrainwater.js';
const root=new URL('../data/water/',import.meta.url),index=JSON.parse(fs.readFileSync(new URL('index.json',root))),tiles=new Map();
const samples=[['Pacific',0,179,'ocean',0],['North Sea',54,4,'ocean',0],['Adriatic',44,14,'ocean',0],['Geneva',46.45,6.6,'lake',372],['Superior',47.7,-87.5,'lake',183],['Victoria',-1,33,'lake',1135],['London',51.5,-.1,null,0],['Isle of Wight',50.7,-1.3,null,0],['Riva land',45.89617,10.84333,null,91]];
for(const[name,lat,lon,expected,height]of samples){const key=`${Math.floor((lon+180)/5)}_${Math.floor((lat+85)/5)}`;if(index.tiles[key]==='p'&&!tiles.has(key))tiles.set(key,decodeWaterTile(JSON.parse(fs.readFileSync(new URL(key+'.json',root)))));const water=createWaterMask(index,tiles).at(lat,lon,height);assert.equal(water,expected,`${name}: ${water}`);}
assert.equal(createWaterMask(index,tiles).at(0,179,1000),null,'A generalised ocean polygon cannot paint elevated terrain');
assert.equal(createWaterMask(index,tiles).at(0,-181,0),'ocean','Longitude wraps at the date line');
console.log('Global water polygons passed: oceans, lakes, land, islands, height guard, longitude wrapping; no regional overrides');
