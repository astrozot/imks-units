// Explicit, bounded detail-card ephemeris. After selection, playback evaluates
// the loaded records in a worker; clock changes never initiate downloads.
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
 root.hidden=true;let current=null,refreshing=false,refreshTimer=0,lastRefresh=-Infinity,note='';
 const cancelRefresh=()=>{clearTimeout(refreshTimer);refreshTimer=0;};
 const toggle=mountEphemerisSwitch(root,()=>{note='';return current&&({...current,kind:'position',livePosition:true,place:[...current.place]});},()=>changed());
 const toolbar=root.querySelector('.ephemeris-toolbar'),label=document.createElement('label');label.className='ephemeris-frame';
 label.innerHTML='<select data-precise-frame aria-label="Coordinate origin"><option value="topocentric">Local</option><option value="geocentric">Geocentric</option></select>';
 toolbar.insertBefore(label,toolbar.querySelector('[data-precision-status]'));
 const frame=label.querySelector('select');frame.addEventListener('change',()=>changed());
 root.querySelector('[data-precision-run]').setAttribute('data-precise-position','');
 const refresh=()=>{
  const r=toggle.result;
  if(!r?.live||!current?.visible)return;
  if(current.t<r.interval.from||current.t>r.interval.to){
   note='Outside the loaded JPL interval. Approximate coordinates of date; select JPL Ephemeris to load this time.';
   cancelRefresh();toggle.reset();return;
  }
  if(refreshing||r.t===current.t)return;
  // Match the detail card cadence and coalesce fast clock changes. There is
  // at most one calculation in flight, all from the already loaded pack.
  const delay=200-(performance.now()-lastRefresh);
  if(delay>0){if(!refreshTimer)refreshTimer=setTimeout(()=>{refreshTimer=0;changed();},delay);return;}
  refreshing=true;lastRefresh=performance.now();
  const time=current.t;
  r.live.update(time).then(value=>{
   if(toggle.cachedResult?.live!==r.live)return;
   toggle.replace({...r,...value});
  }).catch(error=>{
   if(toggle.cachedResult?.live!==r.live)return;
   note=`JPL ephemeris unavailable: ${error.message}. Approximate coordinates of date`;toggle.reset();
  }).finally(()=>{refreshing=false;if(current?.visible)changed();});
 };
 return {
  update(value){
   const year=new Date((value?.t??NaN)*1000).getUTCFullYear();
   if(!value||!nativeBody(value.body)||!Number.isFinite(value.t)||year<EPHEMERIS_YEARS[0]||year>EPHEMERIS_YEARS[1]){cancelRefresh();if(current)toggle.reset();current=null;note='';root.hidden=true;return;}
   const body=value.body.toLowerCase();
   if(current&&(current.body!==body||current.place.length!==value.place.length||current.place.some((x,i)=>x!==value.place[i]))){cancelRefresh();toggle.reset();note='';}
   current={body,t:value.t,place:[...value.place],visible:value.visible};root.hidden=!value.visible;
   const cached=toggle.cachedResult;
   if(cached?.interval&&!toggle.result&&(value.t<cached.interval.from||value.t>cached.interval.to))toggle.reset();
   if(!value.visible){cancelRefresh();toggle.stop();}
  },
  position(o){
   if(!current)return o;
   refresh();
   const r=toggle.result,geo=frame.value==='geocentric';
   const p=r?(geo?r.geocentric:r.position):geo?geocentricPosition(o,current.t,current.place):o;
   const result={...o,...p,coordinateOrigin:geo?'geocentric':'topocentric',preciseSource:r?.source,coordinateMatrix:r?.coordinateMatrix,precisionNote:r?`${r.source}${r.centreModel==='system barycentre'?' · system barycentre':r.centreModel.startsWith('compact')?' · compact centre correction':''} · ${formatTime(r.t)}${r.rotationErrorSeconds!==null?` · Earth-rotation uncertainty ≈${r.rotationErrorSeconds.toFixed(1)} s`:''}. Position follows chart time within the loaded interval; other properties use standard models. Digits show resolution.`:toggle.error?`JPL ephemeris unavailable: ${toggle.error}. Approximate coordinates of date`:note};
   if(geo){delete result.apparentAlt;delete result.alt;delete result.az;}
   else if(r)delete result.apparentAlt;
   if(o.diameter&&o.dist&&p.dist)result.diameter=o.diameter*o.dist/p.dist;
   return result;
  },
  destroy(){cancelRefresh();toggle.destroy();current=null;root.hidden=true;},
 };
}
