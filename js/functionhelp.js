// Structured presentation metadata. Computation and interpreter diagnostics
// continue to use functionDocs; this catalog describes the public calling forms.
const FUNCTIONS = {};
const add = (names, forms, returns, args = {}, examples = [], description = null) => {
  for (const name of names.split(' ')) FUNCTIONS[name] = {
    signatures: (Array.isArray(forms) ? forms : [forms]).map((s) => name + '(' + s + ')'),
    returns, args, examples, description,
  };
};

const value = { x: 'Input value; units are allowed.' };
const pure = { x: 'Dimensionless input.' };
add('sqrt cbrt abs', 'x', 'A value with the corresponding units (square root, cube root, or unchanged units for absolute value).', value, ['sqrt(4 m^2)', 'cbrt(8 m^3)']);
add('exp ln log10 log2', 'x', 'A dimensionless value.', { x: 'Dimensionless input; logarithms require x > 0.' });
add('log', ['x', 'b, x'], 'A dimensionless logarithm.', { x: 'Positive dimensionless value.', b: 'Logarithm base: positive and different from 1. Omit it for the natural logarithm.' }, ['log(2, 8)']);
add('sin cos tan', 'x', 'A dimensionless value.', { x: 'Angle with units, such as 30 deg, or a dimensionless angle in radians.' }, ['sin(30 deg)']);
add('asin acos atan', 'x', 'An angle in radians; use @ deg to convert to degrees.', { x: 'Dimensionless input. For asin and acos, −1 ≤ x ≤ 1.' });
add('sinh cosh tanh asinh acosh atanh', 'x', 'A dimensionless value.', pure);
add('sgn sign', 'x', '−1, 0, or 1 according to the sign of x.', value);
add('floor ceil', 'x', 'A rounded value with the units of x.', { x: 'Value to round. Rounding is performed in base SI units.' });
add('round', 'x[, n]', 'A rounded value with the units of x.', { ...value, n: 'Number of decimal places in base SI units; default 0. Negative values round to tens, hundreds, etc.' }, ['round(1.234 m, 2)']);
add('factorial', 'n', 'n! as a dimensionless value.', { n: 'Nonnegative integer.' }, ['factorial(5)']);
add('gcd lcm', 'a, b, …', 'A nonnegative dimensionless integer.', { 'a, b, …': 'Dimensionless integer arguments; their signs are ignored.' }, ['gcd(12, 18)']);
add('fraction', 'a, b', 'The quotient a/b.', { a: 'Numerator.', b: 'Nonzero denominator.' });
add('nominal err', 'x', 'The nominal value or standard uncertainty, with the units of x.', { x: 'A value with or without uncertainty.' }, ['nominal(3 ± 0.1 m)', 'err(3 ± 0.1 m)']);
add('atan2', 'y, x', 'An angle in radians, with the quadrant determined by both signs.', { 'y, x': 'Coordinates with compatible units; y is the first argument.' }, ['atan2(1 m, -1 m) @ deg']);
add('hypot', ['x, y, …', 'list'], 'The square root of the sum of squares, with the units of the inputs.', { 'x, y, … / list': 'Values, or one list of values, with compatible units.' }, ['hypot(3 m, 4 m)']);
add('min max', ['a, b, …', 'list'], 'The smallest or largest value, preserving its units.', { 'a, b, … / list': 'Compatible values, or a nonempty list. Multiple list arguments are compared element by element.' });
add('sum', ['list', 'f(k), k, a, b'], 'The sum, with the units of its terms.', { list: 'Nonempty list of values with compatible units.', 'f(k)': 'Expression to evaluate at each integer k.', k: 'Summation variable; it need not already be defined.', 'a, b': 'Integer bounds, inclusive. Infinite bounds are supported for convergent series.' }, ['sum((1, 2, 3) m)', 'sum(1/k^2, k, 1, inf)']);
add('mean', 'list', 'The arithmetic mean, with the units of the values.', { list: 'Nonempty list of values with compatible units.' }, ['mean((2, 4, 6) m)']);
add('len', 'list', 'The number of elements as a dimensionless integer.', { list: 'A list or a table (a list of lists).' }, ['len((2, 4, 6))']);
add('item', ['list, n', 'table, name'], 'The selected element or named row.', { list: 'List to index; nested lists can be indexed repeatedly.', n: 'Index starting at 1. Negative indices count from the end; −1 selects the last element.', table: 'A table with named rows, such as moonphases(today).', name: 'Quoted row name.' }, ['item((10, 20, 30), -1)', 'item(moonphases(today), "full moon")']);
add('linspace logspace', 'a, b, n', 'A list of n values, including both endpoints.', { 'a, b': 'Endpoints with compatible units. For logspace they must be positive.', n: 'Integer number of values, from 2 to 10000.' }, ['linspace(0 m, 10 m, 6)', 'logspace(1, 1000, 4)']);
add('dot cross angle', 'a, b', 'dot: scalar product; cross: 3-vector; angle: angle in radians.', { 'a, b': 'Vectors of equal length. Components within each vector must have compatible units; cross requires three components.' }, [], null);
add('norm', 'v', 'The vector length, with the units of its components.', { v: 'A vector (list) with compatible component units.' }, ['norm((3, 4) m)']);
add('solve', ['f(x) = y, x, guess', 'f(x) = y, x, a, b'], 'One value of x satisfying the equation, with its units.', { 'f(x) = y': 'Equation to solve. Both sides must have compatible units.', x: 'Unknown variable; it need not already be defined.', guess: 'Initial estimate; also sets the units and scale of x.', 'a, b': 'Bounds of a search interval, with compatible units.' }, ['solve(x^2 = 4 m^2, x, 1 m)']);
add('roots', ['f(x) = y, x', 'f(x) = y, x, scale', 'f(x) = y, x, a, b'], 'A list of real roots found numerically.', { 'f(x) = y': 'Equation whose roots are required.', x: 'Unknown variable.', scale: 'Value setting the units and scale of x.', 'a, b': 'Search interval; either endpoint may be infinite.' }, ['roots(x^2 = 4, x)']);
add('polyroots', '(a0, a1, …, an)', 'A table with real (Re) and imaginary (Im) parts of all n roots.', { 'a0, a1, …, an': 'Polynomial coefficients in increasing power order: a0 + a1 x + … + an x^n. Coefficients can have units and uncertainties.' }, ['polyroots((1, 0, 1))']);
add('limit', 'f(x), x, x0[, side]', 'The numerical limit, possibly ±inf.', { 'f(x)': 'Expression whose limit is required.', x: 'Variable approaching x0.', x0: 'Approach point, including −inf or inf.', side: '1 approaches from above, −1 from below; omit for a two-sided limit.' }, ['limit(sin(x)/x, x, 0)', 'limit(1/x, x, 0, 1)']);
add('integrate', 'f(x), x, a, b', 'The definite integral, with the units of f multiplied by those of x.', { 'f(x)': 'Expression to integrate.', x: 'Integration variable.', 'a, b': 'Lower and upper bounds with compatible units; infinite bounds are supported.' }, ['integrate(exp(-x^2), x, -inf, inf)']);
add('diff', 'f(x), x, x0[, h]', 'The derivative at x0, with units of f divided by those of x.', { 'f(x)': 'Expression to differentiate.', x: 'Differentiation variable.', x0: 'Point at which to evaluate the derivative.', h: 'Optional numerical step, with the units of x0.' }, ['diff(x^2, x, 3 m)']);
add('plot', ['f(x), x, a, b', '(f(x), g(x)), x, a, b', 'ys', 'xs, ys'], 'An interactive plot; uncertainties appear as a band.', { 'f(x), g(x)': 'One expression or a list of expressions.', x: 'Independent variable.', 'a, b': 'Plot limits, with compatible units.', 'xs, ys': 'Lists of horizontal and vertical coordinates; plot(ys) uses element indices.' }, ['plot(sin(x), x, 0, 2 pi)']);

const observing = { t: 'Date/time, such as now, today, or 2026.11.01 20:00. Events are searched after this time.', place: 'Quoted place name, (latitude, longitude), or (latitude, longitude, height). Give coordinates with angle units, for example (45.46, 9.19) deg; plain numbers mean radians. Height has length units. If omitted, use the location in Settings.' };
add('coelum', 't[, place]', 'An interactive sky, as a map-like chart or a realistic view, and a table of solar-system altitudes and azimuths.', { ...observing, t: 'The date/time to display, such as now or 2026.11.06 21:00.' }, ['coelum(now, "Rome")', 'coelum(now, here)'], 'The sky above the horizon at a date and place.');
const bodies = { body: 'Quoted body name: Sun, Moon, a planet, star, or supported catalog object. Names not built in may require an online lookup.' };
add('sun moon', 't[, place]', '(altitude, azimuth), without atmospheric refraction.', observing, ['sun(now, "Rome")']);
add('sunrise sunset', 't[, place[, horizon]]', 'The next event as a date/time.', { ...observing, horizon: 'Altitude of the Sun’s center; use −6 deg for civil twilight. Omit for the standard horizon.' }, ['sunrise(today, "Rome")', 'sunset(today, "Rome", -6 deg)']);
add('moonrise moonset noon', 't[, place]', 'The next event as a date/time.', observing);
add('sunday', 't[, place]', 'A named table of civil dawn, sunrise, solar noon, sunset, civil dusk, and day length.', observing, ['sunday(today, "Rome")']);
add('phase', 't', '(illuminated fraction, age in days since new moon).', { t: observing.t }, ['phase(now)']);
add('newmoon firstquarter fullmoon lastquarter', 't', 'The next phase as a date/time.', { t: observing.t });
add('moonphases', 't', 'A named table of the next four principal phases, in time order.', { t: observing.t }, ['moonphases(today)']);
add('seasons equinox solstice', 'year', 'seasons: a named table of four events; equinox: (March, September); solstice: (June, December), as dates.', { year: 'Gregorian year. Equinox and solstice calculations cover years −1000 to 3000.' }, ['seasons(2027)']);
add('place', 'name', '(latitude, longitude, height), with location uncertainties when available.', { name: 'Quoted city, place, or address. Large cities are built in; other places require an online lookup and are then kept.' }, ['place("Milan")']);
add('altaz', 'body, t[, place]', '(altitude, azimuth), without atmospheric refraction.', { ...bodies, ...observing }, ['altaz("Mars", now, "Rome")']);
add('radec dist', ['body', 'body, t[, place]'], 'radec: (right ascension, declination) in degrees; dist: distance, with length units.', { ...bodies, ...observing }, ['radec("Vega")', 'dist("Mars", now)']);
add('mag', ['body', 'body, t'], 'Visual magnitude, dimensionless.', { ...bodies, t: observing.t }, ['mag("Vega")', 'mag("Venus", now)']);
add('ecl illum elong', 'body, t', 'ecl: (ecliptic longitude, latitude); illum: (illuminated fraction, phase angle); elong: signed angle from the Sun.', { ...bodies, t: observing.t });
add('diam', 'body, t[, place]', 'Angular equatorial diameter: arcmin for the Sun and Moon, arcsec for planets.', { body: 'Quoted name of the Sun, Moon, or a planet.', ...observing }, ['diam("Moon", now)']);
add('rising setting', 'body, t[, place[, horizon]]', 'The next event as a date/time.', { ...bodies, ...observing, horizon: 'Altitude of the body’s center; default −34 arcmin.' });
add('transit', 'body, t[, place]', 'The next upper meridian passage as a date/time.', { ...bodies, ...observing });
add('passes', 'satellite, t[, place[, days]]', 'A table of risings, highest points, settings, directions, and visibility.', { satellite: 'Quoted satellite name or NORAD number, such as "ISS". The space stations and the brightest satellites are kept on the device and updated daily; others are looked up online.', ...observing, days: 'Search duration in days, from 1 to 10; default 1.' }, ['passes("ISS", today, "Rome")']);
add('moons', 'planet, t', 'A table and diagram of moon offsets and events, viewed from Earth.', { planet: '"Mars", "Jupiter", "Saturn", "Uranus", or "Neptune".', t: observing.t }, ['moons("Jupiter", now)']);
add('moonpos', 'moon, t', '(eastward offset, northward offset) from the parent planet.', { moon: 'Quoted moon name, such as "Io" or "Titan".', t: observing.t });
add('moonevents', 'moon, t[, kind]', 'All kinds: a table of beginnings and ends. One kind: (begin, end) of the next event.', { moon: 'Quoted name of a supported planetary moon.', t: observing.t, kind: '"eclipse", "occultation", "transit", or "shadow". Omit for all kinds. Searches the next 30 days.' }, ['moonevents("Io", today, "eclipse")']);
add('lunareclipse solareclipse', 't[, place]', 'A named table of eclipse contacts, maximum, and magnitudes, with an interactive diagram or map.', observing);
add('conjunction', 'body1, body2, t[, place]', 'A table of conjunction time and separation, closest approach, elongation, and (for a place) altitude.', { 'body1, body2': 'Quoted names of the Sun, Moon, planets, stars, minor planets, or comets.', ...observing }, ['conjunction("Venus", "Jupiter", today)']);
add('opposition', 'body1, body2, t[, place]', 'A table of opposition time, angular separation, greatest separation nearby, and (for a place) altitude.', { 'body1, body2': 'Two explicit quoted names of the Sun, Moon, planets, stars, minor planets, or comets.', ...observing }, ['opposition("Mars", "Sun", today)']);
add('occultation', 'front, target, t[, place]', 'A named table of contact times, limb position angles, altitudes, and illumination, with a visibility map.', { front: 'Required foreground body: "Moon" or a planet from Mercury to Neptune. It must be nearer than the target at the event.', target: 'Required quoted name of the background star, planet, or minor planet being covered.', ...observing }, ['occultation("Moon", "Regulus", today, "Rome")', 'occultation("Venus", "Jupiter", today, "Rome")'], 'Find the next occultation visible from a place while the target is above the horizon during at least part of the event. For a solar eclipse, use solareclipse(t[, place]).');
add('occultations', 't[, place[, days]]', 'A table of the coming occultations by the Moon of the planets and of the stars to magnitude 5, in time order.', { ...observing, place: 'Optional observing place: a quoted name or coordinate tuple with angle units. Omit for those seen anywhere on Earth, independently of the location in Settings; supply a place for those seen there.', days: 'Search duration in days, from 1 to 90; default 30.' }, ['occultations(today, "Rome")', 'occultations(today)']);
add('eq2hor hor2eq', 'point, t[, place]', 'eq2hor: (altitude, azimuth); hor2eq: (right ascension, declination), in degrees.', { point: 'Input pair: (ra, dec) for eq2hor, (alt, az) for hor2eq. Plain numbers are radians; angle units and right ascension as a time are accepted.', ...observing });
add('eq2ecl ecl2eq', 'point[, t]', 'A pair of angular coordinates, in degrees.', { point: 'Input (ra, dec) for eq2ecl or (longitude, latitude) for ecl2eq; plain numbers are radians.', t: 'Date for the true obliquity. Omit for the mean obliquity of J2000.' });
add('eq2gal gal2eq', 'point', 'A pair of angular coordinates, in degrees.', { point: 'eq2gal: equatorial J2000 (ra, dec). gal2eq: galactic (longitude, latitude). Plain numbers are radians.' });
add('precess', 'point, from, to', '(right ascension, declination), precessed to the destination epoch.', { point: 'Mean equatorial (ra, dec), with angle units (plain numbers are radians).', 'from, to': 'Source and destination epochs, each a year number or date.' }, ['precess((10, 20) deg, 2000, today)']);
add('sep pa', 'point1, point2', 'An angle with units: separation or position angle measured north through east.', { 'point1, point2': 'Angular coordinate pairs in the same coordinate system; plain numbers are radians.' });
add('lst', 't[, longitude]', 'Local sidereal time.', { t: observing.t, longitude: 'Longitude with angle units (plain numbers are radians), or a place tuple/name; omit to use Settings.' });
add('refract', ['alt', 'alt, pressure, temperature'], 'Refraction angle to add to the true altitude.', { alt: 'True altitude with angle units (plain numbers are radians).', pressure: 'Air pressure; default 101 kPa.', temperature: 'Air temperature; default 10 °C.' }, ['refract(5 deg, 101 kPa, 10 °C)']);
add('dip', 'height', 'Positive dip angle of the sea horizon, including terrestrial refraction.', { height: 'Height above the sea, with length units.' }, ['dip(100 m)']);

const calendarArgs = { year: 'Year number in the chosen calendar.', month: 'Month number in the chosen calendar.', day: 'Day of the month, starting at 1.', hour: 'Hour of day; default 0.', minute: 'Minute; default 0.', second: 'Second; default 0.' };
add('date', 'year, month[, day[, hour[, minute[, second[, offset]]]]]', 'A date/time in the Gregorian calendar.', { ...calendarArgs, day: 'Day of the month; default 1.', offset: 'UTC offset in hours, or with time units. Omit to use the local/UTC setting.' }, ['date(2026, 11, 1, 20, 30)']);
add('julian hebrew islamic persian coptic ethiopic french saka umalqura', 'year, month, day[, hour[, minute[, second]]]', 'A date/time, displayed in the current output calendar.', calendarArgs);
add('chinese', 'year, month, day[, leap[, hour[, minute[, second]]]]', 'A date/time in the Chinese calendar.', { ...calendarArgs, year: 'Gregorian year in which the Chinese year begins.', leap: '1 for a leap month, 0 for an ordinary month; default 0.' });
add('japanese', 'era, year, month, day[, hour[, minute[, second]]]', 'A date/time in the Japanese calendar.', { era: 'Quoted era name, such as "Reiwa".', ...calendarArgs, year: 'Year within the era, starting at 1.' }, ['japanese("Reiwa", 8, 11, 1)']);
add('hindu', 'year, month, tithi[, leap_month[, leap_day]]', 'A date in the Hindu lunisolar calendar.', { year: 'Saka year.', month: 'Amanta month, starting with Chaitra = 1.', tithi: 'Lunar day from 1 to 30; 16–30 are the dark half.', leap_month: '1 for an adhika month; default 0.', leap_day: '1 for the second occurrence of a tithi; default 0.' });
add('mayan', 'baktun, katun, tun, uinal, kin[, hour[, minute[, second]]]', 'A date/time from the Mayan long count.', { 'baktun, katun, tun, uinal, kin': 'The five integer components of the long count.', hour: calendarArgs.hour, minute: calendarArgs.minute, second: calendarArgs.second }, ['mayan(13, 0, 0, 0, 0)']);
add('ymd', 't[, calendar]', '(year, month, day) as a list.', { t: 'Date/time to decompose.', calendar: 'Quoted calendar name, such as "hebrew" or "julian". Omit for the Gregorian calendar.' }, ['ymd(today, "hebrew")']);
add('easter easter_orthodox', 'year', 'Easter Sunday as a date.', { year: 'Gregorian year.' }, ['easter(2027)']);
add('holiday', 'name, year', 'The holiday’s date in the given Gregorian year.', { name: 'Quoted holiday name; an unknown name lists the supported holidays.', year: 'Gregorian year; when a holiday occurs twice, the first occurrence is returned.' }, ['holiday("Passover", 2027)']);

const redshift = { z: 'Dimensionless redshift; z = 0 is today.', 'z1, z2': 'Two dimensionless redshifts for a distance between epochs.' };
add('E H D_L distmod t_L age V_C scale', 'z', 'E: dimensionless H(z)/H₀; H: expansion rate; D_L: length; distmod: dimensionless magnitude; t_L and age: time; V_C: volume; scale: proper length per arcsecond.', redshift);
add('D_C D_M D_A', ['z', 'z1, z2'], 'A distance with length units, in the current ΛCDM model.', redshift, ['D_A(0.5, 2) @ Mpc']);
const lens = { z_l: 'Lens redshift, dimensionless.', z_s: 'Source redshift, greater than the lens redshift.' };
add('Sigma_cr D_dt', 'z_l, z_s', 'Sigma_cr: critical mass per area; D_dt: time-delay distance.', lens);
add('theta_E', 'M, z_l, z_s', 'An Einstein angular radius.', { M: 'Point-lens mass, with mass units.', ...lens }, ['theta_E(1e12 M_Sun, 0.5, 2) @ arcsec']);
add('theta_E_SIS', 'sigma_v, z_l, z_s', 'An Einstein angular radius.', { sigma_v: 'One-dimensional velocity dispersion, with speed units.', ...lens });
add('M_E', 'theta, z_l, z_s', 'The projected mass enclosed by the Einstein radius.', { theta: 'Einstein radius with angle units, or a dimensionless value in radians.', ...lens });
add('R_s L_Edd', 'M', 'R_s: Schwarzschild radius; L_Edd: Eddington luminosity.', { M: 'Mass, with mass units.' });
add('erf erfc lgamma', 'x', 'A dimensionless value.', pure);
add('erf_inv', 'y', 'A dimensionless value.', { y: 'Dimensionless value between −1 and 1.' });
add('Phi', 'x', 'A cumulative probability between 0 and 1.', { x: 'Standard normal variate, dimensionless.' });
add('Phi_inv nsigma', 'p', 'A dimensionless normal variate or Gaussian significance.', { p: 'Probability between 0 and 1. nsigma uses a one-sided tail.' });
add('pvalue conf', 'n', 'A probability between 0 and 1.', { n: 'Dimensionless number of standard deviations; pvalue is one-sided, conf is inside ±n.' }, ['pvalue(5)', 'conf(2)']);
add('B', 'a, b', 'The dimensionless beta function.', { 'a, b': 'Positive dimensionless shape parameters.' });
add('binom', 'n, k', 'The dimensionless binomial coefficient n choose k.', { n: 'Number of objects.', k: 'Number selected; for combinations, integers with 0 ≤ k ≤ n.' });
add('p_chi2', 'x, k', 'The upper-tail probability P(χ² ≥ x).', { x: 'Nonnegative dimensionless chi-squared statistic.', k: 'Positive degrees of freedom.' });
add('p_t', 't, nu', 'The two-sided Student t tail probability.', { t: 'Dimensionless t statistic.', nu: 'Positive degrees of freedom.' });
add('N', 'mu, sigma', 'An uncertain value with the units of mu.', { mu: 'Mean.', sigma: 'Standard deviation, with the same units as mu.' }, ['N(10 m, 0.2 m)']);
add('U', 'a, b', 'An uncertain value uniformly distributed between the endpoints.', { 'a, b': 'Lower and upper endpoints, with compatible units.' });
add('LogN', 'm, s', 'A log-normal uncertain value with the units of m.', { m: 'Positive median, optionally with units.', s: 'Dimensionless logarithmic width.' });
add('Gamma', ['x', 'k, theta'], 'One argument: Euler’s Γ(x). Two arguments: a gamma-distributed uncertain value with the units of theta.', { x: 'Dimensionless argument of Euler’s gamma function.', k: 'Positive dimensionless shape parameter.', theta: 'Positive scale parameter, optionally with units.' }, ['Gamma(5)', 'Gamma(2, 3 s)'], 'Evaluate Euler’s gamma function, or construct a gamma distribution when both shape and scale are supplied.');
add('Beta', 'a, b', 'A dimensionless beta-distributed uncertain value on [0, 1].', { 'a, b': 'Positive dimensionless shape parameters.' });
add('T', 'nu, mu, s', 'A Student t distributed uncertain value with the units of mu.', { nu: 'Positive dimensionless degrees of freedom.', mu: 'Location (center).', s: 'Positive scale with the units of mu; this is not generally the standard deviation.' });
add('Tri', 'a, c, b', 'A triangularly distributed uncertain value.', { a: 'Minimum.', c: 'Mode (most likely value), between a and b.', b: 'Maximum. All three values must have compatible units.' });
add('trunc', ['x', 'X, lo[, hi]'], 'One argument: x rounded toward zero. Distribution form: X conditioned on the interval.', { x: 'Value to round, in base SI units.', X: 'An uncertain value/distribution.', lo: 'Lower bound, with compatible units, or −inf.', hi: 'Upper bound, with compatible units, or inf; default inf.' }, ['trunc(3.7)', 'trunc(N(1.4 M_Sun, 0.5 M_Sun), 0 kg)'], 'Round a value toward zero, or restrict a distribution to a specified interval.');

// Specific return descriptions keep each page focused on its own function.
const returns = {
  sqrt: 'Square root, with square-root units.', cbrt: 'Cube root, with cube-root units.', abs: 'Nonnegative magnitude, with the units of x.',
  dot: 'Scalar product with the product of the input units.', cross: 'A three-component vector with the product of the input units.', angle: 'The angle between the vectors, in radians.',
  nominal: 'The nominal value with its uncertainty removed.', err: 'The standard uncertainty, with the units of x.',
  seasons: 'A named table of the March equinox, June solstice, September equinox, and December solstice.', equinox: '(March equinox, September equinox), as dates.', solstice: '(June solstice, December solstice), as dates.',
  radec: '(Right ascension, declination), in degrees. Convert the first component with @ hms for hours.', dist: 'Distance: au for solar-system bodies, km for the Moon, pc for stars.',
  ecl: '(Ecliptic longitude, latitude), in degrees.', illum: '(Illuminated fraction, phase angle).', elong: 'Angle from the Sun: positive east (evening), negative west (morning).',
  E: 'Dimensionless expansion rate H(z)/H₀.', H: 'The Hubble parameter, with units of inverse time.', D_L: 'Luminosity distance, with length units.', distmod: 'Distance modulus, a dimensionless magnitude.', t_L: 'Lookback time.', age: 'Age of the universe at z.', V_C: 'All-sky comoving volume within z.', scale: 'Proper length corresponding to one arcsecond at z.',
  Sigma_cr: 'Critical surface mass density.', D_dt: 'Time-delay distance, with length units.', R_s: 'Schwarzschild radius, with length units.', L_Edd: 'Eddington luminosity, with power units.',
};
for (const [name, text] of Object.entries(returns)) FUNCTIONS[name].returns = text;

FUNCTIONS.eq2hor.returns = '(Altitude, azimuth), in degrees.';
FUNCTIONS.hor2eq.returns = '(Right ascension, declination), in degrees.';
FUNCTIONS.lst.returns = 'Local sidereal time, formatted as hours, minutes, and seconds.';
FUNCTIONS.sqrt.args = { x: 'Nonnegative value; units are allowed.' };
FUNCTIONS.acosh.args = { x: 'Dimensionless input, x ≥ 1.' };
FUNCTIONS.atanh.args = { x: 'Dimensionless input, −1 < x < 1.' };
FUNCTIONS.ymd.returns = 'A list of calendar components: (year, month, day) for Gregorian dates. Other calendars can include additional components, such as the leap-month flag or the five Mayan long-count values.';
FUNCTIONS.dist.returns += ' Artificial-satellite distances are in km.';
for (const name of ['radec', 'dist', 'diam', 'conjunction', 'opposition']) {
  FUNCTIONS[name].args = { ...FUNCTIONS[name].args, place: 'Optional observing place: a quoted name or (latitude, longitude[, height]). Give coordinates with angle units. Omit for a geocentric calculation, from Earth’s center.' };
}
for (const name of ['radec', 'dist', 'mag']) {
  FUNCTIONS[name].args = { ...FUNCTIONS[name].args, t: 'Date/time, required for solar-system bodies. The one-argument form gives a star’s catalog position, parallax distance, or catalog visual magnitude.' };
}
FUNCTIONS.lunareclipse.args = { ...observing, place: 'Optional observing place: a quoted name or coordinate tuple with angle units. Omit to find the next eclipse globally; supply a place to find the next one visible there.' };
FUNCTIONS.refract.signatures = ['refract(alt[, pressure[, temperature]])'];
FUNCTIONS.T.args.nu += ' Linear propagation requires nu > 2; Monte Carlo also supports smaller values.';
for (const name of ['E', 'H', 'D_L', 'distmod', 't_L', 'age', 'V_C', 'scale']) FUNCTIONS[name].args = { z: redshift.z };
for (const name of ['E', 'H', 'D_C', 'D_M', 'D_A', 'D_L', 'distmod', 't_L', 'age', 'V_C', 'scale', 'Sigma_cr', 'theta_E', 'theta_E_SIS', 'M_E', 'D_dt']) {
  FUNCTIONS[name].notes = ['The calculation uses the current ΛCDM parameters H_0, Omega_M, Omega_L, and the radiation density. Uncertainties in the parameters and redshifts propagate into the result.'];
}
FUNCTIONS.occultation.args.place = 'Optional observing place: a quoted name or coordinate tuple with angle units. Omit to find the next occultation globally, independently of the location in Settings; supply a place for local contact times.';
FUNCTIONS.occultation.returns = 'Globally: the time of greatest occultation and a visibility map. With a place: local contact times, limb position angles, altitudes, illumination, and a map.';
FUNCTIONS.occultation.notes = [
  'For an extended target, the table includes first and last contact and when the disk is wholly covered. Saturn also includes contacts of the outer edge of the A ring. Moon events identify the bright or dark limb.',
  'The map shows visibility limits, lines of event times, rising and setting boundaries, and the night side of Earth.',
  'Times are accurate to a few seconds. Lunar mountains and valleys are not modeled, so predictions are unsuitable for grazing occultations. Planetary disk flattening is included.',
  'The search spans 20 years for the Moon and 100 years for a planet. Planet-on-planet occultations are rare. The Sun cannot be the target: use solareclipse(t[, place]).',
];
FUNCTIONS.occultations.returns = 'Globally: each target with its time of greatest occultation. With a place: those seen there, each with the time it disappears (or reappears, when only that is seen) and the limb of the Moon, dark or bright.';
FUNCTIONS.occultations.notes = [
  'An occultation is seen when the target is above the horizon in a dark enough sky: twilight for the brightest stars and planets, daylight for Venus, Jupiter and the brightest stars, night (the Sun 6° below the horizon) for the others.',
  'For the whole of one, its contacts, limbs and map, use occultation("Moon", target, t[, place]).',
];
const distributionNote = 'Use Settings → Uncertainties → Monte Carlo to retain the full distribution in calculations. Linear propagation represents distributions by their mean and standard deviation.';
for (const name of ['N', 'U', 'LogN', 'Gamma', 'Beta', 'T', 'Tri']) {
  FUNCTIONS[name].notes = [distributionNote];
}
FUNCTIONS.trunc.notes = ['Use −inf or inf for an open side. Truncation requires nonzero probability inside the interval.', distributionNote];
const examples = {
  sqrt: ['sqrt(4 m^2)'], cbrt: ['cbrt(8 m^3)'], abs: ['abs(-3 m)'],
  sin: ['sin(30 deg)'], cos: ['cos(60 deg)'], tan: ['tan(45 deg)'],
  gcd: ['gcd(12, 18)'], lcm: ['lcm(12, 18)'],
  nominal: ['nominal(3 ± 0.1 m)'], err: ['err(3 ± 0.1 m)'],
  linspace: ['linspace(0 m, 10 m, 6)'], logspace: ['logspace(1, 1000, 4)'],
  dot: ['dot((3, 4) N, (2, 0) m)'], cross: ['cross((1, 0, 0) m, (0, 1, 0) N)'], angle: ['angle((1, 0), (0, 1)) @ deg'],
  sun: ['sun(now, "Rome")'], moon: ['moon(now, "Rome")'],
  sunrise: ['sunrise(today, "Rome")', 'sunrise(today, "Rome", -6 deg)'], sunset: ['sunset(today, "Rome")', 'sunset(today, "Rome", -6 deg)'],
  radec: ['radec("Vega")', 'radec("Mars", now)'], dist: ['dist("Sirius")', 'dist("Mars", now)'],
  seasons: ['seasons(2027)'], equinox: ['equinox(2027)'], solstice: ['solstice(2027)'],
  easter: ['easter(2027)'], easter_orthodox: ['easter_orthodox(2027)'], pvalue: ['pvalue(5)'], conf: ['conf(2)'],
};
for (const [name, list] of Object.entries(examples)) FUNCTIONS[name].examples = list;
// Opening descriptions are deliberately separate from legacy usage strings:
// examples belong in Examples, and calling forms belong in the signature block.
const summaries = {
  sqrt: 'Square root of x.', cbrt: 'Cube root of x.', abs: 'Absolute value of x.',
  exp: 'Exponential of x.', ln: 'Natural logarithm of x.', log: 'Natural logarithm, or logarithm to base b.', log10: 'Base-10 logarithm of x.', log2: 'Base-2 logarithm of x.',
  sin: 'Sine of x.', cos: 'Cosine of x.', tan: 'Tangent of x.', asin: 'Inverse sine of x.', acos: 'Inverse cosine of x.', atan: 'Inverse tangent of x.', atan2: 'Angle of the point (x, y), using both signs to determine the quadrant.',
  sinh: 'Hyperbolic sine of x.', cosh: 'Hyperbolic cosine of x.', tanh: 'Hyperbolic tangent of x.', asinh: 'Inverse hyperbolic sine of x.', acosh: 'Inverse hyperbolic cosine of x.', atanh: 'Inverse hyperbolic tangent of x.',
  sgn: 'Sign of x: −1, 0, or 1.', sign: 'Sign of x: −1, 0, or 1.', floor: 'Round x down in base SI units.', ceil: 'Round x up in base SI units.', round: 'Round x to n decimal places in base SI units.',
  factorial: 'Factorial of n.', gcd: 'Greatest common divisor of integers.', lcm: 'Least common multiple of integers.', fraction: 'Divide a by b.',
  nominal: 'The value of x without its uncertainty.', err: 'The standard uncertainty of x.', hypot: 'Square root of the sum of squares.', min: 'Smallest value.', max: 'Largest value.',
  sum: 'Sum a list, or sum an expression over integer values of k.', mean: 'Arithmetic mean of a list.', len: 'Number of elements in a list.', item: 'Select a list element by index or a table row by name.',
  linspace: 'Generate n equally spaced values from a to b.', logspace: 'Generate n values from a to b in equal ratios.',
  dot: 'Scalar product of two vectors.', cross: 'Vector product of two three-component vectors.', norm: 'Length of a vector.', angle: 'Angle between two vectors.',
  solve: 'Find one value of x that satisfies an equation.', roots: 'Find the real roots of an equation numerically.', polyroots: 'Find all roots of a polynomial, including complex roots.',
  limit: 'Numerical limit of an expression as x approaches x0.', integrate: 'Definite integral of an expression over x from a to b.', diff: 'Derivative of an expression with respect to x, evaluated at x0.', plot: 'Plot one or more expressions or lists of values.',
  sun: 'Altitude and azimuth of the Sun at t.', moon: 'Altitude and azimuth of the Moon at t.', sunrise: 'The next sunrise after t.', sunset: 'The next sunset after t.', moonrise: 'The next moonrise after t.', moonset: 'The next moonset after t.', noon: 'The next solar noon after t.',
  sunday: 'Civil dawn, sunrise, solar noon, sunset, civil dusk, and day length for a place after t.', phase: 'Illuminated fraction and age of the Moon at t.',
  newmoon: 'The next new moon after t.', firstquarter: 'The next first quarter of the Moon after t.', fullmoon: 'The next full moon after t.', lastquarter: 'The next last quarter of the Moon after t.', moonphases: 'The next four principal phases of the Moon after t.',
  seasons: 'Equinoxes and solstices in year.', equinox: 'March and September equinoxes in year.', solstice: 'June and December solstices in year.', place: 'Find the coordinates and elevation of a named place.',
  altaz: 'Altitude and azimuth of a body at t.', radec: 'Right ascension and declination of a body.', dist: 'Distance to a body.', mag: 'Visual magnitude of a body.',
  ecl: 'Apparent geocentric ecliptic longitude and latitude of a body at t.', illum: 'Illuminated fraction and phase angle of a body at t.', elong: 'Signed angular separation of a body from the Sun at t.', diam: 'Apparent equatorial diameter of a body at t.',
  rising: 'The next rising of a body after t.', setting: 'The next setting of a body after t.', transit: 'The next upper meridian passage of a body after t.', passes: 'Passes of an artificial satellite over a place, starting at t.',
  moons: 'Positions and events of a planet’s major moons at t, viewed from Earth.', moonpos: 'Offsets of a moon from its parent planet at t.', moonevents: 'The next events of a planetary moon after t.',
  lunareclipse: 'The next lunar eclipse after t.', solareclipse: 'The next solar eclipse after t.', conjunction: 'The next conjunction in ecliptic longitude of two bodies after t.', opposition: 'The next opposition in ecliptic longitude of two bodies after t.',
  occultations: 'The occultations by the Moon after t, anywhere on Earth or seen from a place.',
  occultation: 'The next occultation after t anywhere on Earth; with a place, the next visible there while the target is above the horizon during at least part of the event.',
  eq2hor: 'Convert equatorial coordinates to altitude and azimuth.', hor2eq: 'Convert altitude and azimuth to equatorial coordinates.', eq2ecl: 'Convert equatorial coordinates to ecliptic coordinates.', ecl2eq: 'Convert ecliptic coordinates to equatorial coordinates.', eq2gal: 'Convert equatorial J2000 coordinates to galactic coordinates.', gal2eq: 'Convert galactic coordinates to equatorial J2000 coordinates.',
  precess: 'Precess a mean equatorial position between two epochs.', sep: 'Angular separation between two sky positions.', pa: 'Position angle of the second sky position from the first, measured north through east.', lst: 'Local sidereal time at t.', refract: 'Atmospheric refraction to add to the true altitude alt.', dip: 'Dip of the sea horizon viewed from height, including terrestrial refraction.',
  date: 'Construct a Gregorian date and time.', julian: 'Construct a date in the Julian calendar.', hebrew: 'Construct a date in the Hebrew calendar.', islamic: 'Construct a date in the arithmetic Islamic civil calendar.', persian: 'Construct a date in the Persian Solar Hijri calendar.', coptic: 'Construct a date in the Coptic calendar.', ethiopic: 'Construct a date in the Ethiopian calendar.', french: 'Construct a date in the French Republican calendar.', saka: 'Construct a date in the Indian national Saka calendar.', umalqura: 'Construct a date in the Umm al-Qura calendar of Saudi Arabia.',
  chinese: 'Construct a date in the Chinese calendar.', japanese: 'Construct a date in the Japanese era calendar.', hindu: 'Construct a date in the Hindu lunisolar calendar.', mayan: 'Construct a date from the Mayan long count.', ymd: 'Extract the calendar components of t.', easter: 'Easter Sunday in the Gregorian calendar.', easter_orthodox: 'Orthodox Easter Sunday calculated from the Julian calendar.', holiday: 'Find a named holiday in a Gregorian year.',
  E: 'Dimensionless Hubble expansion rate at redshift z.', H: 'Hubble parameter at redshift z.', D_C: 'Line-of-sight comoving distance.', D_M: 'Transverse comoving distance.', D_A: 'Angular diameter distance.', D_L: 'Luminosity distance at redshift z.', distmod: 'Distance modulus at redshift z.', t_L: 'Lookback time to redshift z.', age: 'Age of the universe at redshift z.', V_C: 'All-sky comoving volume within redshift z.', scale: 'Proper length subtended by one arcsecond at redshift z.',
  Sigma_cr: 'Critical surface density for gravitational lensing.', D_dt: 'Time-delay distance for a lens and source.', theta_E: 'Einstein radius of a point-mass lens.', theta_E_SIS: 'Einstein radius of a singular isothermal sphere.', M_E: 'Projected mass enclosed by an Einstein radius.', R_s: 'Schwarzschild radius of mass M.', L_Edd: 'Eddington luminosity of mass M.',
  erf: 'Error function of x.', erfc: 'Complementary error function of x.', erf_inv: 'Inverse error function of y.', lgamma: 'Logarithm of Euler’s gamma function.', Phi: 'Standard normal cumulative distribution at x.', Phi_inv: 'Standard normal quantile at probability p.', nsigma: 'Gaussian significance corresponding to a one-sided tail probability p.', pvalue: 'One-sided Gaussian tail probability at n standard deviations.', conf: 'Gaussian probability within n standard deviations of the mean.', B: 'Euler’s beta function.', binom: 'Binomial coefficient: n choose k.', p_chi2: 'Upper-tail probability of a chi-squared statistic x with k degrees of freedom.', p_t: 'Two-sided tail probability of Student’s t statistic with nu degrees of freedom.',
  N: 'Construct a normal distribution.', U: 'Construct a uniform distribution.', LogN: 'Construct a log-normal distribution.', Gamma: 'Evaluate Euler’s gamma function, or construct a gamma distribution from shape and scale.', Beta: 'Construct a beta distribution on the unit interval.', T: 'Construct a Student t distribution.', Tri: 'Construct a triangular distribution.', trunc: 'Round x toward zero, or restrict a distribution X to an interval.',
};
for (const [name, description] of Object.entries(summaries)) FUNCTIONS[name].description = description;
// Keep calendar conventions explicit rather than relying on the old prose
// that combined a description, a calling example and the month numbering.
for (const [name, month] of Object.entries({
  hebrew: 'Month from Nisan = 1; Tishri = 7 and Adar II = 13.',
  coptic: 'Month number; month 13 contains the epagomenal days.',
  ethiopic: 'Month number; month 13 is Pagume.',
  french: 'Month number; month 13 contains the complementary days.',
  saka: 'Month from Chaitra = 1.',
})) FUNCTIONS[name].args = { ...FUNCTIONS[name].args, month };
// Notes are edited prose, not fragments split out of interpreter usage text.
// Omit a Notes section when its information is already covered above.
const notes = {
  sqrt: ['The square root also applies to units; for example, the square root of a quantity in m^2 has units of m.'],
  cbrt: ['The cube root also applies to units; for example, the cube root of a quantity in m^3 has units of m.'],
  exp: ['The value exp(1) is Euler’s number. The name e represents the elementary charge instead.'],
  sum: [
    'The expression form evaluates f(k) at each integer from a through b, including both endpoints.',
    'Infinite bounds are supported for convergent series. For terms of one sign, convergence requires decay faster than 1/k; convergence can be difficult to establish when the decay is only slightly faster.',
  ],
  item: ['Negative indices count backward from the end of the list. The index −1 selects the last element.', 'You can also use dot notation to index nested lists; for example, t.2.1 selects the first element of the second list.'],
  solve: ['The initial guess or interval bounds determine the units and numerical scale of x.'],
  roots: ['Without explicit bounds, the search samples both sides of zero at scales from 10⁻¹⁰ to 10¹⁰ times the chosen scale. Roots closer together than the sampling interval may be missed.', 'A single scale argument sets the units and scale of x. Two bounds restrict the search to an interval, and either bound may be infinite.'],
  polyroots: ['Coefficients can have units and uncertainties. When a0 and a1 are nonzero, the root units are those of a0/a1.', 'Uncertainties for repeated roots are available only in Monte Carlo mode.'],
  limit: ['The limit is estimated numerically by extrapolating values progressively closer to x0. The approach point may be −inf or inf.', 'An infinite limit is reported when the reciprocal approaches zero and the expression keeps the same sign. An expression that continues to oscillate produces an error.'],
  integrate: ['Either integration bound may be infinite, provided the integral converges.'],
  diff: ['Supply h to choose the numerical differentiation step explicitly.'],
  plot: ['A list of expressions produces several curves. Lists of values can be plotted directly, and uncertainties are shown as a band.'],
  sunrise: ['Supply horizon to find when the Sun’s center reaches a chosen altitude. Use −6 deg for civil twilight.', 'For a sea horizon viewed from height, use a horizon altitude of −50 arcmin − dip(height).'],
  sunset: ['Supply horizon to find when the Sun’s center reaches a chosen altitude. Use −6 deg for civil twilight.'],
  sunday: ['Named table entries can be selected with dot notation; for example, sunday(today)."sunset" selects the sunset time.'],
  moonphases: ['Named table entries can be selected with dot notation; for example, moonphases(today)."full moon" selects the full-moon time.'],
  seasons: ['Named table entries can be selected with dot notation; for example, seasons(2027)."June solstice" selects the June solstice.'],
  equinox: ['The supported years range from −1000 to 3000. Times are accurate to about a minute near the present day; uncertainty in Earth’s rotation makes distant dates less precise.'],
  solstice: ['The supported years range from −1000 to 3000. Times are accurate to about a minute near the present day; uncertainty in Earth’s rotation makes distant dates less precise.'],
  place: ['Large cities are built in. Other places and addresses are looked up online through OpenStreetMap, with elevations from a terrain map, and the results are saved for reuse.'],
  altaz: ['Supported bodies include the Sun, Moon, planets, stars, deep-sky objects, minor planets, comets, and artificial satellites. Names such as "Vega", "M31", "Ceres", "12P", and "ISS" are accepted; objects not built in require an online lookup.'],
  radec: ['For a star, the one-argument form returns its catalog position in the ICRS frame at epoch J2000. Supplying t gives the apparent position at that date.'],
  dist: ['Stellar distances are calculated from catalog parallaxes and are returned in parsecs. A star must have a known positive parallax.'],
  mag: ['Planetary magnitudes follow Mallama and Hilton (2018), including the contribution of Saturn’s rings.', 'Minor-planet magnitudes use the H–G model. Comet magnitudes use approximate total-brightness estimates.', 'For stars and other catalog objects, the result is the catalog V-band magnitude.'],
  passes: ['The visibility flag indicates whether the satellite is sunlit while the observing sky is dark.'],
  moonpos: ['The supported moons are the same major planetary moons shown by the moons function.'],
  moonevents: ['The search covers the next 30 days. Event times refer to the moon’s center.'],
  lunareclipse: ['With place supplied, the search finds the next eclipse visible there. The table marks contacts below the horizon and includes any moonrise or moonset during the eclipse, together with the Moon’s altitude.'],
  solareclipse: ['The local table includes contact times, maximum eclipse, any sunrise or sunset during the event, magnitude, obscured fraction, and the Sun’s altitude.', 'The map shows the eclipse path, UTC time contours for the beginning and end, and locations where maximum eclipse occurs at sunrise or sunset.'],
  opposition: ['The apparent ecliptic longitudes differ by 180°; angular separation need not be 180°.', 'A place selects a topocentric calculation and adds the altitude of the first body at greatest separation. Without a place, the calculation is geocentric.'],
  conjunction: ['The apparent ecliptic longitudes are equal; closest angular approach is calculated separately.', 'A place selects a topocentric calculation and adds the altitude of the first body. Without a place, the calculation is geocentric.', 'The separation is positive when the second body is toward ecliptic north from the first and negative when it is toward ecliptic south.'],
  eq2hor: ['Right ascension may also be supplied as a time, such as 5h 34m 32s.'],
  dip: ['For sunrise over a sea horizon viewed from height, use a horizon altitude of −50 arcmin − dip(height).'],
  date: ['Dates may also be entered directly as literals, such as 2026.10.30 18:42.'],
  julian: ['Years use astronomical numbering: year 0 is 1 BC, year −1 is 2 BC, and so on.'],
  islamic: ['This function uses the arithmetic Islamic civil calendar. Use the umalqura function for the Umm al-Qura calendar of Saudi Arabia.'],
  french: ['For example, french(8, 2, 18) represents 18 Brumaire VIII.'],
  japanese: ['Eras from Meiji onward are supported. Dates use the Gregorian calendar from Meiji 6 (1873).'],
  ymd: ['Use calendar to choose another calendar. The supported names include "julian", "hebrew", "islamic", "umalqura", "persian", "coptic", "ethiopic", "french", "saka", and "mayan".', 'Calendar components are determined using days that begin at midnight.'],
  holiday: ['Supported holidays include Christian, Jewish, Islamic, and Chinese holidays, as well as Nowruz and Enkutatash. An unknown name lists the available holidays.', 'An Islamic holiday can occur twice in one Gregorian year. This function returns its first occurrence.'],
};
for (const [name, paragraphs] of Object.entries(notes)) FUNCTIONS[name].notes = paragraphs;
// No HTML here: the renderer escapes descriptions, signatures and user docs.
export function functionHelp(name, source = '', user = null) {
  if (user?.fn) return {
    signatures: [`${name}(${user.fn.params.join(', ')})`],
    description: user.doc || 'A function defined in My definitions.',
    args: Object.fromEntries(user.fn.params.map((p) => [p, 'Argument supplied to your function.'])),
    returns: 'The value of the function expression, including its units and uncertainty.',
    examples: [], notes: [], definition: user.src || '',
  };
  const entry = FUNCTIONS[name];
  if (!entry) return { signatures: [`${name}(…)`], description: source || 'Function documentation is not available.', args: {}, examples: [] };
  return {
    ...entry,
    description: entry.description || source,
    notes: entry.notes || [],
  };
}

export const functionHelpNames = Object.keys(FUNCTIONS);
