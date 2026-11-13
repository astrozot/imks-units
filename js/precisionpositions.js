// Optional detail-card snapshots. Never refreshes a position or downloads
// data automatically while the sky clock or animation is running.
import {precisionEvent,clearPrecisionData} from './precisionui.js';
import {nativeBody} from './precisioncatalog.js';
import {EPHEMERIS_YEARS} from './precisionconfig.js';
const coordinate=(value,hours=false)=>{
 const units=hours?24:360,sign=!hours&&value<0?'−':!hours?'+':'';
 const digits=hours?3:2,scale=10**digits,total=Math.round((hours?((value/15)%24+24)%24:Math.abs(value))*3600*scale),a=Math.floor(total/(3600*scale))%units,b=Math.floor(total%(3600*scale)/(60*scale)),c=(total%(60*scale)/scale).toFixed(digits).padStart(digits+3,'0');
 return `${sign}${String(a).padStart(2,'0')}${hours?'h':'°'} ${String(b).padStart(2,'0')}${hours?'m':'′'} ${c}${hours?'s':'″'}`;
};
export function precisePositionControls(root,formatTime=t=>new Date(t*1000).toISOString()){
 root.hidden=true;let current=null,pending=null,result=null,serial=0,observer=null;
 root.innerHTML='<p><button type="button" class="coelum-chip" data-precise-position>Calculate precise position</button> <button type="button" class="coelum-chip" data-precise-clear>Clear downloaded ephemerides</button></p><label>Coordinates <select data-precise-frame><option value="topocentric">Seen from this place</option><option value="geocentric">Seen from Earth’s centre</option></select></label><p class="coelum-coordinate-note" data-precise-status aria-live="polite">Downloads native JPL data on request. Downloaded ephemerides are limited to 8 MiB.</p><div data-precise-result></div><p class="coelum-coordinate-note" data-precise-stale></p>';
 const run=root.querySelector('[data-precise-position]'),status=root.querySelector('[data-precise-status]'),output=root.querySelector('[data-precise-result]'),frame=root.querySelector('[data-precise-frame]'),stale=root.querySelector('[data-precise-stale]');
 const stop=()=>{serial++;pending?.cancel();pending=null;observer?.disconnect();observer=null;run.textContent='Calculate precise position';};
 const reset=()=>{stop();result=null;output.replaceChildren();stale.textContent='';status.textContent='Downloads native JPL data on request. Downloaded ephemerides are limited to 8 MiB.';};
 const staleNote=()=>{const text=result&&current&&(Math.abs(result.t-current.t)>.01||result.place.some((x,i)=>x!==current.place[i]))?'The sky time or place has changed. Calculate again to update this snapshot.':'';if(stale.textContent!==text)stale.textContent=text;};
 const show=()=>{
  output.replaceChildren();if(!result)return;
  const r=result,p=frame.value==='geocentric'?r.geocentric:r.position,title=document.createElement('p');
  title.textContent=`${r.body[0].toUpperCase()+r.body.slice(1)}${r.centreModel==='system barycentre'?' system barycentre':''} · ${r.source}${r.kernels.filter(k=>!k.startsWith('de44')).map(k=>' + '+k.toUpperCase()).join('')} · ${formatTime(r.t)}`;output.append(title);
  const dl=document.createElement('dl'),row=(label,value)=>{const div=document.createElement('div'),dt=document.createElement('dt'),dd=document.createElement('dd');dt.textContent=label;dd.textContent=value;div.append(dt,dd);dl.append(div);};
  row('Right ascension (RA)',coordinate(p.ra,true));row('Declination (Dec)',coordinate(p.dec));row('Distance',`${p.dist.toLocaleString('en',{maximumFractionDigits:3})} km`);
  if(frame.value==='topocentric'){row('Altitude (Alt)',coordinate(p.alt));row('Azimuth (Az)',coordinate(p.az));}
  output.append(dl);const note=document.createElement('p');note.className='coelum-coordinate-note';
  const centre=r.centreModel==='system barycentre'?'The planet’s system barycentre is shown: native planet-centre data does not cover this date.':r.centreModel.startsWith('compact')?'The planet centre uses the compact satellite correction.':'Native body-centre position.';
  note.textContent=`Apparent coordinates of date${frame.value==='topocentric'?`, at ${r.place[0].toFixed(4)}°, ${r.place[1].toFixed(4)}°; altitude without refraction`:', seen from Earth’s centre'}. ${centre} ${r.earthOrientation}${r.rotationErrorSeconds!==null?`; estimated Earth-rotation uncertainty ${r.rotationErrorSeconds.toFixed(1)} s`:''}. Displayed digits are calculation resolution, not an accuracy guarantee.`;
  output.append(note);staleNote();
 };
 run.addEventListener('click',async()=>{
  if(pending){stop();status.textContent='Calculation cancelled.';return;}if(!current)return;
  const token=++serial,job={...current,kind:'position',place:[...current.place]};
  run.textContent='Cancel precise position';status.textContent='Loading native ephemeris data…';
  observer=new MutationObserver(()=>{if(!root.isConnected||root.closest('[hidden], [aria-hidden="true"]')||root.closest('dialog')?.open===false){stop();status.textContent='Calculation cancelled.';}});
  for(let element=root;element;element=element.parentElement)observer.observe(element,{attributes:true,attributeFilter:['hidden','aria-hidden','open'],childList:true});
  try{
   pending=precisionEvent(job,text=>{if(token===serial)status.textContent=text;});const r=await pending.promise;
   if(token===serial&&root.isConnected){result=r;show();status.textContent=`${r.fromCache?'Used downloaded native data':`Loaded native data (${Math.ceil((r.downloadedBytes||r.residentBytes)/1024)} KiB downloaded)`}. Calculation complete.`;}
  }catch(error){if(token===serial)status.textContent=error.name==='AbortError'?'Calculation cancelled.':`${error.message}. The chart’s coordinates remain available.`;}
  finally{if(token===serial){pending=null;observer?.disconnect();observer=null;run.textContent='Calculate precise position';}}
 });
 frame.addEventListener('change',show);
 root.querySelector('[data-precise-clear]').addEventListener('click',async()=>{reset();try{await clearPrecisionData();status.textContent='Downloaded ephemerides cleared.';}catch{status.textContent='Browser storage is unavailable.';}});
 return {
  update(value){
   const year=new Date((value?.t??NaN)*1000).getUTCFullYear();
   if(!value||!nativeBody(value.body)||!Number.isFinite(value.t)||year<EPHEMERIS_YEARS[0]||year>EPHEMERIS_YEARS[1]){if(current)reset();current=null;root.hidden=true;return;}
   const body=value.body.toLowerCase();if(current?.body!==body)reset();
   current={body,t:value.t,place:[...value.place]};root.hidden=!value.visible;if(!value.visible&&pending){stop();status.textContent='Calculation cancelled.';}staleNote();
  },
  destroy(){stop();current=null;result=null;root.hidden=true;},
 };
}
