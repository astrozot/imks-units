// Development-only comparison input. No Stellarium code is linked into the app.
import fs from 'node:fs';
import {MOONS} from '../js/moons.js';
import {moonSeriesPosition} from '../js/moonposition.js';
const R=Math.PI/180;
const rows=JSON.parse(fs.readFileSync(0,'utf8'));
console.log(JSON.stringify(rows.map(({system,moon,ttJD})=>{
 const [a,d]=MOONS[system].pole.map(x=>x*R),z=[Math.cos(d)*Math.cos(a),Math.cos(d)*Math.sin(a),Math.sin(d)],x=[-Math.sin(a),Math.cos(a),0],y=[-Math.sin(d)*Math.cos(a),-Math.sin(d)*Math.sin(a),Math.cos(d)];
 const q=moonSeriesPosition(MOONS[system].moons[moon],ttJD-2451545);
 return [0,1,2].map(i=>q[0]*x[i]+q[1]*y[i]+q[2]*z[i]);
})));
