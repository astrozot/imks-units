import assert from 'node:assert/strict';
import { PhoneOrientation, attitude, camera, rotate, distance, multiply } from '../js/phoneorientation.js';
import { rotateSky, unprojectSky, SKY_IDENTITY, horizontalVector } from '../js/coelum.js';
const event = (alpha=0,beta=90,gamma=0,extra={}) => ({alpha,beta,gamma,absolute:false,...extra});
const heading = (t) => { const d=t.rotation().slice(6); return (Math.atan2(d[0],d[1])*180/Math.PI+360)%360; };
const near = (a,b,eps=1e-6) => assert.ok(Math.abs(a-b)<eps,`${a} vs ${b}`);
const vectorNear = (a,b,eps=1e-6) => a.forEach((x,i)=>near(x,b[i],eps));
// Coordinate conventions independently checked at cardinal directions and roll.
vectorNear(camera(attitude(0,90,0)).slice(6),[0,1,0]);
vectorNear(camera(attitude(270,90,0)).slice(6),[1,0,0]);
vectorNear(camera(attitude(0,180,0)).slice(6),[0,0,1]);
vectorNear(camera(attitude(0,90,0),90).slice(3,6),[1,0,0]);
// A phone turned counterclockwise to landscape (screen angle +90) keeps
// the same world camera after the display compensates for the rotation.
vectorNear(camera(multiply(attitude(0,90,0),[0,0,Math.SQRT1_2,Math.SQRT1_2]),90),camera(attitude(0,90,0)));
for(const a of [0,70,180,270]) for(const b of [-179,-90,0,89,179]) {
 const m=camera(attitude(a,b,37),90);
 for(let i=0;i<3;i++)for(let j=0;j<3;j++)near(m.slice(i*3,i*3+3).reduce((n,v,k)=>n+v*m[j*3+k],0),i===j?1:0);
}
// Fast response has comparable elapsed-time behavior at different event rates.
for(const hz of [20,30,60,120]) {
 const t=new PhoneOrientation(); t.update(event(),0);
 for(let i=1;i<=Math.ceil(.1*hz);i++)t.update(event(350),i*1000/hz);
 assert.ok(heading(t)>9.8,`Fast response at ${hz} Hz: ${heading(t)}`);
}
// Heading acquisition must reject uncalibrated readings, including a plausible 0.
{
 const t=new PhoneOrientation();
 t.update(event(0,90,0,{webkitCompassHeading:0,webkitCompassAccuracy:-1}),0);
 assert.equal(t.anchored,false);
 t.update(event(0,90,0,{webkitCompassHeading:12,webkitCompassAccuracy:3}),17);
 assert.equal(t.anchored,true);
 for(let n=2;n<120;n++)t.update(event(0,90,0,{webkitCompassHeading:35,webkitCompassAccuracy:-1}),n*17);
 near(heading(t),12,.12); assert.match(t.quality,/unreliable/);
}
// Stale compass must not pull a real relative turn back after the phone stops.
{
 const t=new PhoneOrientation();
 const e=(a)=>event(a,90,0,{webkitCompassHeading:0,webkitCompassAccuracy:2});
 t.update(e(0),0);
 for(let n=1;n<=120;n++)t.update(e(350),n*1000/60);
 near(heading(t),10,.12);
}
// Resting noise is held below the angular hysteresis threshold.
{
 const t=new PhoneOrientation();t.update(event(),0);
 for(let n=1;n<240;n++)t.update(event(.04*Math.sin(n),90+.03*Math.cos(n)),n*1000/60);
 near(heading(t),0,.00001);
}
// Zenith crossings, Euler wrap and quaternion sign changes retain camera roll.
{
 const a=camera(attitude(0,179.999,0)),b=camera(attitude(0,-179.999,0));
 vectorNear(a,b,.00004);
 near(distance(attitude(359.99,90,0),attitude(.01,90,0)),.02,.000001);
 const t=new PhoneOrientation();t.update(event(0,90,0),0);t.update(event(0,60,45),17);
 assert.ok(Math.abs(t.rotation()[2])>.2,'Roll retained');
}
// Relative attitude wins over a contemporaneous magnetic disturbance.
{
 const t=new PhoneOrientation();t.update(event(),0);
 t.update(event(350),17);
 assert.equal(t.update(event(90,90,0,{absolute:true}),18,true),false);
 for(let n=2;n<60;n++)t.update(event(350),n*17);
 near(heading(t),10,.12);
}
// A compass reset contradicted by the gyro preserves the current view, but
// must not prevent subsequent physical movement from being followed.
{
 const t=new PhoneOrientation();
 t.update(event(0,90,0,{absolute:true}),0,true);
 t.motion({rotationRate:{alpha:0,beta:0,gamma:0}},16);
 t.update(event(60,90,0,{absolute:true}),17,true);
 near(heading(t),0,.00001);assert.match(t.quality,/disturbed/);
 t.motion({rotationRate:{alpha:60,beta:0,gamma:0}},33);
 t.update(event(59,90,0,{absolute:true}),34,true);
 assert.ok(heading(t)>.1 && heading(t)<2,'Movement continues after a compass reset');
}
// Continuous absolute samples can establish north, but later corrections are
// bounded and are disabled after the user supplies a calibration.
{
 const t=new PhoneOrientation();t.update(event(),0);
 for(let n=1;n<=60;n++){
  t.update(event(355,90,0,{absolute:true}),n*17-1,true);
  t.update(event(),n*17);
 }
 near(heading(t),5,.12);assert.equal(t.anchored,true);
 const yaw=t.yaw;
 for(let n=61;n<=120;n++){
  t.update(event(352,90,0,{absolute:true}),n*17-1,true);
  t.update(event(),n*17);
 }
 assert.ok(Math.abs(t.yaw-yaw)<.31,'North correction is rate limited');
 t.align(horizontalVector(0,45));
 for(let n=121;n<=240;n++){
  t.update(event(350,90,0,{absolute:true}),n*17-1,true);
  t.update(event(),n*17);
 }
 near(heading(t),45,.12);
}
// Alignment changes heading, preserves tilt, survives future sensor events.
{
 const t=new PhoneOrientation();t.update(event(0,110),0);
 assert.equal(t.align(horizontalVector(20,70)),true);
 for(let n=1;n<30;n++)t.update(event(0,110),n*17);
 near(heading(t),70,.01);near(t.rotation()[8],Math.sin(20*Math.PI/180));
 assert.equal(t.align([0,0,1]),false);
}
// A pan calibrates the full attitude to the dragged camera, including roll;
// subsequent sensor movement is retained rather than overwritten by calibration.
{
 const t=new PhoneOrientation(); t.update(event(20,115,23),0);
 const from=t.rotation(90), target=rotateSky(from,[0,0,1],unprojectSky(.2,.1,SKY_IDENTITY,true));
 t.calibrate(from,target);vectorNear(t.rotation(90),target);
 for(let n=1;n<30;n++)t.update(event(20,115,23),n*17);
 vectorNear(t.rotation(90),target);
 t.update(event(10,115,23),30*17);
 assert.ok(t.rotation().some((v,i)=>Math.abs(v-camera(attitude(20,115,23))[i])>.1));
 for(let n=0;n<30;n++){
  const old=t.rotation(), next=rotateSky(old,[0,0,1],unprojectSky(.03,-.02));
  t.calibrate(old,next);vectorNear(t.rotation(),next);
 }
}
// Invalid readings do not poison state; suspend/resume never integrates a gap.
{
 const t=new PhoneOrientation(); assert.equal(t.update(event(NaN),0),false);
 assert.equal(t.update(event(null),1),false);
 t.update(event(),10);t.update(event(350),10000);near(heading(t),10,.0001);
 t.drawn(10);t.drawn(20);assert.equal(t.diagnostics(10010).sampleAgeMs,10);
}
console.log('Phone orientation: response, compass rejection, stale heading, rest, roll, zenith, screen rotation and calibration passed.');
