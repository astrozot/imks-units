// Native satellite event geometry, worker-only. All positions are ICRF km;
// epochs are TDB. Never installs a provider in the animation or compact model.
import {NATIVE_SYSTEMS} from './precisioncatalog.js';
import {MOONS} from './moons.js';
import {MOON_RADIUS,planetOf,moonEvents} from './astro.js';
import {moonContactGeometry} from './moongeometry.js';
const C=299792.458,DAY=86400,R=Math.PI/180;
const sub=(a,b)=>a.map((v,i)=>v-b[i]);
const unit=v=>{const n=Math.hypot(...v);return v.map(x=>x/n);};
const flattening={mars:.00589,jupiter:.06487,saturn:.09796,uranus:.02293,neptune:.01708};
// Emission epoch of a body observed at a fixed receiving point/epoch. This
// solves both Earth reception and the extra planet↔moon shadow light path.
function emitted(ephemeris,body,receive,point){
 let jd=receive,state;
 for(let i=0;i<5;i++){state=ephemeris.centre(body,jd);jd=receive-Math.hypot(...sub(state.position,point))/C/DAY;}
 return {jd,position:ephemeris.centre(body,jd).position};
}
export function nativeMoonGeometry(ephemeris,name,t){
 const planet=planetOf(name),sys=MOONS[planet];
 if(!sys||!ephemeris.supports(name)||!ephemeris.supports(planet))throw new Error('Native moon and planet-centre records are required');
 const now=ephemeris.clock(t).tdbJD,earth=ephemeris.centre('earth',now).position;
 const p=emitted(ephemeris,planet,now,earth),m=emitted(ephemeris,name,now,earth);
 const v=sub(m.position,p.position),observer=unit(sub(m.position,earth));
 const [a,d]=sys.pole.map(x=>x*R),pole=[Math.cos(d)*Math.cos(a),Math.cos(d)*Math.sin(a),Math.sin(d)];
 // The visible shadow is on the planet: its Earth ray differs from the
 // separately observed moon ray used for transit/occultation contacts.
 const common={v,observer,shadowObserver:unit(sub(p.position,earth)),pole,radius:sys.radius,flattening:flattening[planet],moonRadius:MOON_RADIUS[name]};
 const sunAtPlanet=emitted(ephemeris,'sun',p.jd,p.position),sunRay=sub(p.position,sunAtPlanet.position);
 const casting=emitted(ephemeris,name,p.jd,p.position),shadowVector=sub(casting.position,p.position);
 const disk=moonContactGeometry({...common,shadowVector,light:unit(sunRay),sunDistance:Math.hypot(...sunRay)});
 const blocking=emitted(ephemeris,planet,m.jd,m.position),sunAtBlock=emitted(ephemeris,'sun',blocking.jd,blocking.position),eclipseRay=sub(blocking.position,sunAtBlock.position);
 const eclipse=moonContactGeometry({...common,eclipseVector:sub(m.position,blocking.position),light:unit(eclipseRay),sunDistance:Math.hypot(...eclipseRay)});
 for(const key of ['eclipsed','eclipsedUmbra','eclipsedFull','eclipsedCenter'])disk[key]=eclipse[key];
 return disk;
}
export function nativePlanetMoonEvents(ephemeris,planet,from,days=1){
 if(!Object.hasOwn(NATIVE_SYSTEMS,planet)||!Number.isFinite(days)||days<=0||days>1)throw new RangeError('Native moon-event searches cover one day of an installed planetary system');
 const list=[];
 const provider={moonGeometry:(name,t)=>nativeMoonGeometry(ephemeris,name,t)};
 for(const moon of Object.keys(MOONS[planet].moons))for(const event of moonEvents(moon,from,days,provider)){
  const [kind,begin,end]=event;list.push({moon,kind,begin,end,t:(begin+end)/2,contacts:event.contacts,errors:event.errors});
 }
 return list.sort((a,b)=>a.begin-b.begin||a.moon.localeCompare(b.moon)||a.kind.localeCompare(b.kind));
}
