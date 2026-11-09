// Shared phone attitude estimator. Sensor callbacks never draw. Angles in
// degrees, timestamps in performance.now() milliseconds; quaternions [x,y,z,w].
const R = Math.PI / 180;
const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
const norm = (q) => { const n = Math.hypot(...q); return q.map((v) => v / n); };
const dot = (a, b) => a.reduce((s, x, i) => s + x * b[i], 0);
const wrap = (a) => ((a + 540) % 360 + 360) % 360 - 180;
export const multiply = (a, b) => [
  a[3]*b[0]+a[0]*b[3]+a[1]*b[2]-a[2]*b[1],
  a[3]*b[1]-a[0]*b[2]+a[1]*b[3]+a[2]*b[0],
  a[3]*b[2]+a[0]*b[1]-a[1]*b[0]+a[2]*b[3],
  a[3]*b[3]-a[0]*b[0]-a[1]*b[1]-a[2]*b[2],
];
const inverse = (q) => [-q[0],-q[1],-q[2],q[3]];
const axis = (i, degrees) => { const q = [0,0,0,Math.cos(degrees*R/2)]; q[i] = Math.sin(degrees*R/2); return q; };
export const attitude = (alpha, beta, gamma) => multiply(multiply(axis(2, alpha), axis(0, beta)), axis(1, gamma));
export const rotate = (q, v) => multiply(multiply(q, [...v, 0]), [-q[0],-q[1],-q[2],q[3]]).slice(0,3);
export const distance = (a, b) => 2 * Math.acos(clamp(Math.abs(dot(a,b)), 0, 1)) / R;
const interpolate = (a, b, k) => {
  const d = dot(a,b), sign = d < 0 ? -1 : 1, angle = Math.acos(clamp(Math.abs(d),0,1));
  if (angle < 1e-5) return norm(a.map((v,i) => v + k*(sign*b[i]-v)));
  const x = Math.sin((1-k)*angle)/Math.sin(angle), y = sign*Math.sin(k*angle)/Math.sin(angle);
  return a.map((v,i) => x*v+y*b[i]);
};
const bearing = (v) => Math.atan2(v[0],v[1])/R;
// Camera projection uses negative screen x, positive screen up and the back
// of the phone. Rotating the screen does not rotate the sensor's axes.
export function camera(q, screenAngle = 0) {
  const s = multiply(q, axis(2, -screenAngle));
  return [...rotate(s,[-1,0,0]), ...rotate(s,[0,1,0]), ...rotate(s,[0,0,-1])];
}

// A camera stores world-to-camera rows. Convert its transpose to a unit
// quaternion so a drag can calibrate all three axes without losing roll.
function cameraAttitude(m) {
  const a = [m[0],m[3],m[6],m[1],m[4],m[7],m[2],m[5],m[8]], t = a[0]+a[4]+a[8];
  if (t > 0) { const s = Math.sqrt(t+1)*2; return [(a[7]-a[5])/s,(a[2]-a[6])/s,(a[3]-a[1])/s,s/4]; }
  const i = a[0] > a[4] && a[0] > a[8] ? 0 : a[4] > a[8] ? 1 : 2, j = (i+1)%3, k = (i+2)%3;
  const s = Math.sqrt(1+a[i*3+i]-a[j*3+j]-a[k*3+k])*2, q = [0,0,0,0];
  q[i]=s/4; q[j]=(a[j*3+i]+a[i*3+j])/s; q[k]=(a[k*3+i]+a[i*3+k])/s; q[3]=(a[k*3+j]-a[j*3+k])/s;
  return norm(q);
}

export class PhoneOrientation {
  constructor() {
    this.raw = this.filtered = null;
    this.last = this.relativeAt = this.motionAt = -Infinity;
    this.correction = [0,0,0,1];
    this.yaw = 0; this.anchored = false; this.aligned = false;
    this.quality = 'Waiting for orientation'; this.source = null;
    this.intervals = []; this.drawTimes = [];
    this.gyro = null; this.absolute = null;
  }
  motion(ev, now) {
    const r = ev.rotationRate;
    if (r && [r.alpha,r.beta,r.gamma].every(Number.isFinite)) {
      this.gyro = Math.hypot(r.alpha,r.beta,r.gamma); this.motionAt = now;
    }
  }
  update(ev, now, absoluteEvent = false) {
    if (![ev.alpha,ev.beta,ev.gamma].every(Number.isFinite)) return false;
    const q = attitude(ev.alpha,ev.beta,ev.gamma);
    const ios = Number.isFinite(ev.webkitCompassHeading);
    const absolute = !ios && (absoluteEvent || ev.absolute === true);
    if (absolute) {
      if (absoluteEvent) this.absoluteEventAt = now;
      else if (now - (this.absoluteEventAt ?? -Infinity) < 250) return false;
      this.absolute = { q, time: now };
      // A fresh relative stream supplies movement without magnetic jumps.
      if (now - this.relativeAt < 300) return false;
    } else this.relativeAt = now;
    const dt = clamp((now-this.last)/1000, .001, .1);
    const gap = now-this.last > 300;
    if (!gap && now > this.last) {
      this.intervals.push(now-this.last); if (this.intervals.length > 120) this.intervals.shift();
    }
    // Do not mix reference frames when a preferred stream becomes available.
    const source = ios ? 'relative-compass' : absolute ? 'absolute' : 'relative';
    const changed = this.source && this.source !== source;
    if (changed && this.raw) {
      const old = rotate(multiply(axis(2,this.yaw),this.raw),[0,0,-1]);
      const next = rotate(q,[0,0,-1]);
      if (Math.hypot(old[0],old[1]) > .1 && Math.hypot(next[0],next[1]) > .1) this.yaw = wrap(bearing(next)-bearing(old));
    }
    if (ios) {
      const good = ev.webkitCompassHeading >= 0 && Number.isFinite(ev.webkitCompassAccuracy) && ev.webkitCompassAccuracy >= 0 && ev.webkitCompassAccuracy <= 20;
      // Safari combines relative attitude with a separate CLHeading reading,
      // without exposing the heading timestamp. Recomputing this offset on
      // every event cancels real motion whenever that heading is stale. Anchor
      // once; thereafter retain relative movement, even if the compass changes.
      if (!this.anchored && !this.aligned && good) {
        this.yaw = wrap(360-ev.webkitCompassHeading-ev.alpha); this.anchored = true;
      }
      this.quality = this.aligned ? 'Aligned with the sky' : this.anchored ? (good ? 'Compass north held · align with an object for accuracy' : 'Compass unreliable · keeping the heading') : 'Compass unavailable or unreliable · align with an object';
    } else if (!absolute && this.absolute && now-this.absolute.time < 100 && !this.aligned) {
      const a = rotate(this.absolute.q,[0,0,-1]), b = rotate(q,[0,0,-1]);
      if (Math.hypot(a[0],a[1]) > .1 && Math.hypot(b[0],b[1]) > .1) {
        const yaw = wrap(bearing(b)-bearing(a));
        if (!this.northCandidate || Math.abs(wrap(yaw-this.northCandidate.yaw)) > 2) this.northCandidate = { yaw, since: now };
        else if (now-this.northCandidate.since > 500) {
          const error = wrap(yaw-this.yaw);
          // Establish north only from sustained consistent observations. Later
          // corrections have a dead band and a 0.3 degree/s speed limit; manual
          // alignment always wins. Reject large inconsistent magnetic jumps.
          if (!this.anchored) { this.yaw = yaw; this.anchored = true; }
          else if (Math.abs(error) > 1 && Math.abs(error) < 10) this.yaw += clamp(error,-.3*dt,.3*dt);
        }
      }
    }
    if (!ios) this.quality = this.aligned ? 'Aligned with the sky' : absolute || this.anchored ? 'Magnetic north · align with an object for accuracy' : 'Relative directions · align with an object';
    // With only an absolute stream, a large attitude jump contradicted by
    // a fresh quiet gyro is a compass reset, not physical phone movement.
    if (absolute && this.raw && !gap && !changed && now-this.motionAt < 250 &&
        distance(this.raw,q) > Math.max(.5,this.gyro*dt*3+.3)) {
      this.correction = norm(multiply(this.filtered,inverse(multiply(axis(2,this.yaw),q))));
      this.raw = q; this.last = now; this.quality = 'Compass disturbed · keeping the heading';
      return true;
    }
    const target = multiply(this.correction,multiply(axis(2,this.yaw),q));
    const rate = this.raw && !gap && !changed ? distance(this.raw,q)/dt : 0;
    const still = now-this.motionAt < 250 ? this.gyro < .3 : true;
    const error = this.filtered ? distance(this.filtered,target) : 0;
    // Angular hysteresis suppresses stationary noise without a sticky large
    // dead zone. Fast motion uses a 12 ms time constant, quiet motion 80 ms.
    if (!this.filtered || gap || changed) this.filtered = target;
    else if (!(still && error < .12)) {
      const speed = Math.max(now-this.motionAt < 250 ? this.gyro : rate, error/.03);
      const tau = .08 + (.012-.08)*clamp(speed/15,0,1);
      this.filtered = interpolate(this.filtered,target,1-Math.exp(-dt/tau));
    }
    this.raw = q; this.last = now; this.source = source;
    this.filterDegrees = distance(this.filtered,target);
    return true;
  }
  rotation(screenAngle = 0) { return this.filtered && camera(this.filtered,screenAngle); }
  align(direction) {
    if (!this.filtered) return false;
    const from = rotate(this.filtered,[0,0,-1]);
    // Near zenith/nadir a single object cannot constrain heading.
    if (Math.hypot(from[0],from[1]) < .15 || Math.hypot(direction[0],direction[1]) < .15) return false;
    const correction = wrap(bearing(from)-bearing(direction));
    this.correction = multiply(axis(2,correction),this.correction);
    this.filtered = multiply(axis(2,correction),this.filtered);
    this.aligned = this.anchored = true; this.quality = 'Aligned with the sky';
    return true;
  }
  calibrate(from, to) {
    if (!this.filtered) return;
    const delta = multiply(cameraAttitude(to),inverse(cameraAttitude(from)));
    this.correction = norm(multiply(delta,this.correction));
    this.filtered = norm(multiply(delta,this.filtered));
    this.aligned = this.anchored = true; this.quality = 'Aligned by panning';
  }
  drawn(ms) { this.drawTimes.push(ms); if (this.drawTimes.length > 120) this.drawTimes.shift(); }
  diagnostics(now) {
    const sorted = [...this.drawTimes].sort((a,b)=>a-b);
    return { source:this.source, quality:this.quality, sampleAgeMs:now-this.last,
      eventHz:this.intervals.length ? 1000*this.intervals.length/this.intervals.reduce((a,b)=>a+b,0) : null,
      filterDegrees:this.filterDegrees, drawP95Ms:sorted.length ? sorted[Math.floor((sorted.length-1)*.95)] : null };
  }
}
