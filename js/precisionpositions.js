// Explicit, bounded detail-card calculation. The existing fields render either
// model; neither animation nor clock changes initiate a background calculation.
import {mountEphemerisSwitch} from './precisionui.js';
import {nativeBody} from './precisioncatalog.js';
import {EPHEMERIS_YEARS} from './precisionconfig.js';
import {siderealTime} from './astro.js';
const R=Math.PI/180;
// Undo the observer translation for the existing compact-model position. This
// also supports natural moons, whose compact offsets are in the sky frame.
export function geocentricPosition(p,t,[lat,lon,h=0]){
 const u=Math.atan(.99664719*Math.tan(lat*R)),lst=siderealTime(t,lon)*R;
 const rc=6378.137*Math.cos(u)+h/1000*Math.cos(lat*R),rs=6378.137*.99664719*Math.sin(u)+h/1000*Math.sin(lat*R);
 const x=p.dist*Math.cos(p.dec*R)*Math.cos(p.ra*R)+rc*Math.cos(lst),y=p.dist*Math.cos(p.dec*R)*Math.sin(p.ra*R)+rc*Math.sin(lst),z=p.dist*Math.sin(p.dec*R)+rs;
 return {ra:(Math.atan2(y,x)/R+360)%360,dec:Math.atan2(z,Math.hypot(x,y))/R,dist:Math.hypot(x,y,z)};
}
export function precisePositionControls(root,formatTime,changed=()=>{}){
 root.hidden=true;let current=null,lastObject=null,snapshot=null,lastMatrix=null,snapshotMatrix=null;
 const toggle=mountEphemerisSwitch(root,()=>{snapshot=lastObject;snapshotMatrix=lastMatrix?.map(col=>[...col]);return current&&({...current,kind:'position',place:[...current.place]});},()=>changed());
 const toolbar=root.querySelector('.ephemeris-toolbar'),label=document.createElement('label');label.className='ephemeris-frame';
 label.innerHTML='<select data-precise-frame aria-label="Coordinate origin"><option value="topocentric">Local</option><option value="geocentric">Geocentric</option></select>';
 toolbar.insertBefore(label,toolbar.querySelector('[data-precision-status]'));
 const frame=label.querySelector('select');frame.addEventListener('change',()=>changed());
 root.querySelector('[data-precision-run]').setAttribute('data-precise-position','');
 return {
  update(value){
   const year=new Date((value?.t??NaN)*1000).getUTCFullYear();
   if(!value||!nativeBody(value.body)||!Number.isFinite(value.t)||year<EPHEMERIS_YEARS[0]||year>EPHEMERIS_YEARS[1]){if(current)toggle.reset();current=null;root.hidden=true;return;}
   const body=value.body.toLowerCase();
   // A requested snapshot retains its timestamp while the sky animates.
   if(current&&(current.body!==body||current.place.some((x,i)=>x!==value.place[i])))toggle.reset();
   if(toggle.cachedResult&&!toggle.result&&!toggle.pending&&Math.abs(toggle.cachedResult.t-value.t)>.01)toggle.reset();
   current={body,t:value.t,place:[...value.place]};root.hidden=!value.visible;if(!value.visible)toggle.stop();
  },
  position(o,matrix){
   lastObject=o;lastMatrix=matrix;if(!current)return o;
   const r=toggle.result,geo=frame.value==='geocentric';
   const p=r?(geo?r.geocentric:r.position):geo?geocentricPosition(o,current.t,current.place):o;
   const base=r&&snapshot?snapshot:o;
   const result={...base,...p,coordinateOrigin:geo?'geocentric':'topocentric',preciseSource:r?.source,coordinateMatrix:r?snapshotMatrix:null,precisionNote:r?`${r.source}${r.centreModel==='system barycentre'?' · system barycentre':r.centreModel.startsWith('compact')?' · compact centre correction':''} · ${formatTime(r.t)}${r.rotationErrorSeconds!==null?` · Earth-rotation uncertainty ≈${r.rotationErrorSeconds.toFixed(1)} s`:''}. Position snapshot; other properties use standard models. Digits show resolution.`:toggle.error?`JPL ephemeris unavailable: ${toggle.error}. Approximate coordinates of date`:''};
   if(geo){delete result.apparentAlt;delete result.alt;delete result.az;}
   else if(r)delete result.apparentAlt;
   if(base.diameter&&base.dist&&p.dist)result.diameter=base.diameter*base.dist/p.dist;
   return result;
  },
  destroy(){toggle.destroy();current=null;root.hidden=true;},
 };
}
