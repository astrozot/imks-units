// Small fixed-grid apparent-position samples. Worker generation; lightweight
// interpolation during map playback. No SPK/frame evaluator enters the UI.
const R=Math.PI/180;
export function samplePrecisionEphemeris(ephemeris,from,to,bodies=['sun','moon'],step=30){
 const count=Math.ceil((to-from)/step)+1,stride=1+bodies.length*3;
 if(count>1601||count<2)throw new RangeError('Precision map interval is too large');
 const data=new Float64Array(count*stride);let previous;
 for(let i=0;i<count;i++){
  const t=from+i*step;let gast=ephemeris.siderealTime(t,0);
  if(previous!==undefined)gast+=360*Math.round((previous-gast)/360);data[i*stride]=previous=gast;
  bodies.forEach((body,j)=>{const p=ephemeris.equatorial(body,t),a=p.ra*R,d=p.dec*R,k=i*stride+1+j*3;data[k]=p.dist*Math.cos(d)*Math.cos(a);data[k+1]=p.dist*Math.cos(d)*Math.sin(a);data[k+2]=p.dist*Math.sin(d);});
 }
 return {from,step,count,bodies,data};
}
export function interpolatedPrecisionEphemeris(samples){
 const {from,step,count,bodies,data}=samples,stride=1+3*bodies.length;
 if(!(data instanceof Float64Array)||data.length!==count*stride||count<2||count>1601)throw new Error('Invalid precision map samples');
 const value=(t,k)=>{const n=(t-from)/step;if(n<0||n>count-1||!Number.isFinite(n))throw new RangeError('Time outside precision map interval');const i=Math.min(count-2,Math.floor(n)),f=n-i;return data[i*stride+k]*(1-f)+data[(i+1)*stride+k]*f;};
 const vector=(body,t)=>{const j=bodies.indexOf(body);if(j<0)return null;return [0,1,2].map(k=>value(t,1+j*3+k));};
 const spherical=v=>({ra:(Math.atan2(v[1],v[0])/R+360)%360,dec:Math.atan2(v[2],Math.hypot(v[0],v[1]))/R,dist:Math.hypot(...v)});
 return {
  equatorial(body,t){const v=vector(body,t);return v&&spherical(v);},
  siderealTime(t,lon=0){return (value(t,0)+lon)%360;},
  // Playback only. Exact selected-location contacts remain worker results.
  topocentric(body,t,[lat,lon,h=0]){const v=vector(body,t);if(!v)return null;const phi=lat*R,u=Math.atan(.99664719*Math.tan(phi)),theta=(value(t,0)+lon)*R,rc=6378.137*Math.cos(u)+h/1000*Math.cos(phi),rs=6378.137*.99664719*Math.sin(u)+h/1000*Math.sin(phi);return spherical([v[0]-rc*Math.cos(theta),v[1]-rc*Math.sin(theta),v[2]-rs]);},
 };
}
