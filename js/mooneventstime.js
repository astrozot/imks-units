// Event dates are midpoint-local dates. Contact clocks share one zone label;
// day offsets retain unambiguous midnight crossings without repeating dates.
import {skyTimeParts,skyTimeZone,signedYear} from './coelumtime.js';
const pad=n=>String(n).padStart(2,'0');
const day=p=>{const d=new Date(0);d.setUTCFullYear(p.year,p.month-1,p.day);d.setUTCHours(0,0,0,0);return d.getTime()/86400000;};
export function moonEventTimes(zone='device',precise=false){
 if(zone==='utc')zone='UTC';
 const scale=precise?10:1,rounded=t=>Math.round(t*scale)/scale;
 const parts=t=>skyTimeParts(rounded(t),zone);
 return {
  date(t){const p=parts(t);return `${signedYear(p.year)}-${pad(p.month)}-${pad(p.day)}`;},
  clock(t,midpoint=t){const p=parts(t),offset=Math.round(day(p)-day(parts(midpoint))),fraction=precise?'.'+((Math.round(t*scale)%scale+scale)%scale):'';return `${pad(p.hour)}:${pad(p.minute)}:${pad(p.second)}${fraction}${offset?` (${offset>0?'+':''}${offset}d)`:''}`;},
  zone(from,to=from){const a=skyTimeZone(from,zone),b=skyTimeZone(to,zone);if(a===b)return a;const left=a.indexOf(' ('),right=b.indexOf(' (');return left>=0&&right>=0&&a.slice(0,left)===b.slice(0,right)?`${a.slice(0,left)} (${a.slice(left+2,-1)} → ${b.slice(right+2,-1)})`:`${a} → ${b}`;},
 };
}
