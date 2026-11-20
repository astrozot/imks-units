// Trail directions in all mounts; relative trails are transported in the
// fixed Galactic frame so changing a display mount cannot add motion.
import {pointVector,vec,galacticCoordinates,unit3,dot3,cross3} from './coelum.js';
export function trajectoryCoordinates(o,frame) {
  const g=galacticCoordinates(o,frame);
  return {altaz:[...pointVector(o)],equatorial:vec(o.ra,o.dec),galactic:vec(g.lon,g.lat)};
}
// Move the historical reference direction onto its current direction by the
// shortest spherical rotation, applying the same rotation to the target.
// This preserves angular separation even far from the tangent-plane limit.
export function relativeTrajectoryVector(target,from,to) {
  const a=unit3(from),b=unit3(to),c=Math.max(-1,Math.min(1,dot3(a,b)));
  let axis=cross3(a,b),s=Math.hypot(...axis);
  if(s<1e-14&&c>0)return [...target];
  axis=s>1e-14?axis.map(x=>x/s):unit3(cross3(a,Math.abs(a[0])<.9?[1,0,0]:[0,1,0]));
  const w=cross3(axis,target),d=dot3(axis,target);
  return unit3(target.map((x,i)=>c*x+s*w[i]+(1-c)*d*axis[i]));
}
