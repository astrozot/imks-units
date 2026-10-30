// The Sun and the Moon in the interpreter: sun(t, place), sunrise(t,
// place)…, where the place is (latitude, longitude), or the location of
// the settings (env.location). The astronomy is in astro.js.

import { Q, UnitError } from "./units.js";
import { UNum } from "./unum.js";
import { isDate, dateQ, yearArg } from "./dates.js";
import { horizontal, riseSet, crossing, nextPhase, moonPhase, siderealTime, season, hourAngle } from "./astro.js";

const RAD = Math.PI / 180;
// the functions that take a place, (latitude, longitude): their lists
// are not taken elementwise
const SKY_FNS = ["sun", "moon", "sunrise", "sunset", "noon", "moonrise", "moonset", "lst"];

function skyBuiltins(env, b) {
  const when = (name, t) => {
    if (!isDate(env, t)) throw new UnitError(`${name}: the first argument is a date, as in ${name}(today)`);
    const x = t.relative().x.n;
    if (!(Math.abs(x) <= 8.64e12)) throw new UnitError(`${name}: the date is out of range`);
    return x;
  };
  const where = (name, p) => {
    if (p === undefined) {
      if (env.location) return env.location;
      throw new UnitError(`${name}: give the place, as in ${name}(today, (45.46, 9.19)[deg]), or set a location in Settings`);
    }
    if (!Array.isArray(p) || p.length < 2 || !p.every((q) => q instanceof Q)) throw new UnitError(`${name}: the place is (latitude, longitude)`);
    return [p[0], p[1]].map((q) => env.checkPure(q, name).n / RAD);
  };
  const deg = (x, err) => env.convert(new Q(UNum.uncertain(x * RAD, err * RAD)), ["deg"]);
  const days = (x) => env.convert(env.mul(new Q(x), env.unitValue("day")), ["day"]);

  for (const body of ["sun", "moon"]) {
    // errors from the comparison with precise ephemerides (95 %)
    const err = body === "sun" ? 0.005 : 0.01;
    b[body] = (t, p) => {
      const h = horizontal(body, when(body, t), where(body, p));
      return [deg(h.alt, err), deg(h.az, err)];
    };
    for (const rising of [true, false]) {
      const name = body + (rising ? "rise" : "set");
      b[name] = (t, p, h0) => {
        const e = riseSet(body, when(name, t), where(name, p), rising, h0 === undefined ? null : env.checkPure(h0, name).n / RAD);
        if (!e) throw new UnitError(`${name}: the ${body === "sun" ? "Sun" : "Moon"} does not ${rising ? "rise" : "set"} here within two days`);
        // refraction near the horizon varies by about 0.15°
        return dateQ(env, UNum.uncertain(e.t, Math.min(0.15 / e.rate, 3600)));
      };
    }
  }
  // solar noon: the Sun on the meridian, to a few seconds
  b.noon = (t, p) => {
    const place = where("noon", p);
    const e = crossing((x) => hourAngle("sun", x, place[1]), when("noon", t), true);
    return dateQ(env, UNum.uncertain(e, 2));
  };
  // the phases agree with precise ephemerides to about a minute
  for (const [name, target] of [["newmoon", 0], ["firstquarter", 90], ["fullmoon", 180], ["lastquarter", 270]]) {
    b[name] = (t) => dateQ(env, UNum.uncertain(nextPhase(when(name, t), target), 60));
  }
  // equinoxes and solstices of a year, (March, September) and (June,
  // December), to about a minute
  for (const [name, ks] of [["equinox", [0, 2]], ["solstice", [1, 3]]]) {
    b[name] = (y) => {
      const year = yearArg(env, name, y);
      return ks.map((k) => {
        const t = season(year, k);
        if (t === null) throw new UnitError(`${name}: the years from 1000 to 3000`);
        return dateQ(env, UNum.uncertain(t, 60));
      });
    };
  }
  b.phase = (t) => {
    const m = moonPhase(when("phase", t));
    return [new Q(UNum.uncertain(m.fraction, 0.001)), days(UNum.uncertain(m.age, 60 / 86400))];
  };
  // lst(t), lst(t, longitude) or lst(t, place)
  b.lst = (t, p) => {
    const lon = p instanceof Q ? env.checkPure(p, "lst").n / RAD : where("lst", p)[1];
    const s = siderealTime(when("lst", t), lon) / 15 * 3600;
    return env.convert(env.mul(new Q(s), env.unitValue("s")), ["hms"]);
  };
  // for the Hebrew calendar, whose days begin at sunset: whether the time
  // t is after the sunset of the day beginning at start
  env.afterSunset = (t, start) => {
    if (!env.location) return false;
    const e = riseSet("sun", start, env.location, false);
    return Boolean(e && e.t - start < 86400 + 3600 && t >= e.t);
  };
}

export { SKY_FNS, skyBuiltins };
