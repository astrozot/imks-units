// Startup definitions (a port of imks' Startup.imks and Astro.imks) and the
// factory that builds a ready-to-use calculator.

import { Interpreter } from "./interp.js";
import { Q, UnitError, currencySymbols } from "./units.js";

const STARTUP = String.raw`
######################################################################
##                   iMKS startup file, v. 1.0                      ##
##    (c) 2000-2014 by Marco Lombardi                               ##
######################################################################

%newbaseunit m   # "Meter\n\nThe meter is the length of the path travelled by light in vacuum during a time interval of 1/299 792 458 of a second."
%newbaseunit g   # "Gram\n\nThe kilogram is the unit of mass."
%newbaseunit s   # "Second\n\nThe second is the duration of 9 192 631 770 periods of the radiation corresponding to the transition between the two hyperfine levels of the ground state of the cesium 133 atom."
%newbaseunit A   # "Ampere\n\nThe ampere is that constant current which, if maintained in two straight parallel conductors of infinite length, of negligible circular cross-section, and placed 1 meter apart in vacuum, would produce between these conductors a force equal to 2 x 10^-7 newton per meter of length."
%newbaseunit K   # "Kelvin\n\nThe kelvin, unit of thermodynamic temperature, is the fraction 1/273.16 of the thermodynamic temperature of the triple point of water."
%newbaseunit mol # "Mole\n\nThe mole is the amount of substance of a system which contains as many elementary entities as there are atoms in 0.012 kilogram of carbon 12."
%newbaseunit cd  # "Candela\n\nThe candela is the luminous intensity, in a given direction, of a source that emits monochromatic radiation of frequency 540 x 10^12 hertz and that has a radiant intensity in that direction of 1/683 watt per steradian."

%newunit K=(0[K], 1[K]) # "Kelvin\n\nThe kelvin, unit of thermodynamic temperature, is the fraction 1/273.16 of the thermodynamic temperature of the triple point of water."

%newbasecurrency EUR # "Euro"

%newprefix Y=1e24   # "Yotta"
%newprefix Z=1e21   # "Zetta"
%newprefix E=1e18   # "Exa"
%newprefix P=1e15   # "Peta"
%newprefix T=1e12   # "Tera"
%newprefix G=1e9    # "Giga"
%newprefix M=1e6    # "Mega"
%newprefix k=1e3    # "Kilo"
%newprefix h=1e2    # "Hecto"
%newprefix da=1e1   # "Deka"
%newprefix d=fraction(1, 10^1)  # "Deci"
%newprefix c=fraction(1, 10^2)  # "Centi"
%newprefix m=fraction(1, 10^3)  # "Milli"
%newprefix µ=u=μ=fraction(1, 10^6)  # "Micro"
%newprefix n=fraction(1, 10^9)  # "Nano"
%newprefix p=fraction(1, 10^12) # "Pico"
%newprefix f=fraction(1, 10^15) # "Femto"
%newprefix a=fraction(1, 10^18) # "Atto"
%newprefix z=fraction(1, 10^21) # "Zepto"
%newprefix y=fraction(1, 10^24) # "Yocto"

%newsystem si=[m|s|kg|K|A|cd|mol] # "International system (SI)"
%newsystem SI=[*|si] # "International system (SI) with prefixes"

## Derived units and symbols

%newunit in=2.54[cm]              # "Inch"
%newunit ft=12[in]                # "Foot"
%newunit yd=3[ft]                 # "Yard"
%newunit mi=5280[ft]              # "Mile"
%newunit nmi=1852[m]              # "Nautical Mile"
%newunit fath=6[ft]               # "Fathom"
%newunit micron=1[um]             # "Micron"
%newunit mil=1[in]/1000           # "Mil"
%newunit point=1[in]/72           # "Point"
%newunit Å=Ang=1e-10[m]           # "Angstrom"
%newunit fermi=1e-15[m]           # "Fermi"

%newunit °C=Celsius=(273.15[K], 1[K])          # "Celsius degree"
%newunit °F=Fahrenheit=(459.67[K]*5/9, 5[K]/9) # "Fahrenheit degree"

%newunit hect=ha=10000[m^2]       # "Hectare"
%newunit acre=1[mi^2] / 640       # "Acre"
%newunit barn=1e-28[m^2]          # "Barn"

%newunit l=L=liter=1e-3[m^3]      # "Liter"
%newunit tsp=4.92892159375[ml]    # "Teaspoon"
%newunit tbsp=3[tsp]              # "Tablespoon"
%newunit ozfl=2[tbsp]             # "Fluid Ounce"
%newunit cup=8[ozfl]              # "Cup"
%newunit pt=2[cup]                # "Pint"
%newunit qt=2[pt]                 # "Quart"
%newunit gal=4[qt]                # "US Gallon"

%newunit min=60[s]                # "Minute"
%newunit hr=h=hour=60[min]        # "Hour"
%newunit day=24[hr]               # "Day"
%newunit week=7[day]              # "Week"
%newunit yr=365.25[day]           # "Year\n\nJulian year"
%newunit Cy=36525[day]            # "Century\n\nJulian century"
%newunit Hz=1[s^-1]               # "Hertz"
%newunit rpm=1[min^-1]            # "Revolutions per minute"

%newunit mph=1[mi/hr]             # "Miles per hour"
%newunit kph=1[km/hr]             # "Kilometers per hour"
%newunit knot=1[nmi/hr]           # "Knot"

%newunit oz=28.349523125[g]       # "Ounce"
%newunit lb=16[oz]                # "Pound"
%newunit carat=0.2[g]             # "Carat"
%newunit t=tonne=1000[kg]         # "Tonne\n\nMetric ton"

%newunit ga=9.80665[m/s^2]        # "g acceleration"

%newunit N=1[m kg/s^2]            # "Newton"
%newunit dyn=1e-5[N]              # "Dyne"
%newunit lbf=1[lb ga]             # "Pound-force"
%newunit kgf=1[kg ga]             # "Kilogram-force"

%newunit J=1[N m]                 # "Joule"
%newunit erg=1e-7[J]              # "Erg"
%newunit cal=4.1868[J]            # "International Table Calorie"
%newunit BTU=1055.05585262[J]     # "British thermal unit"

%newunit W=1[J/s]                 # "Watt"
%newunit Wh=1[W hr]               # "Watt hour"
%newunit hp=745.7[W]              # "Horsepower"

%newunit Pa=1[N/m^2]              # "Pascal"
%newunit bar=1e5[Pa]              # "Bar"
%newunit psi=6894.75729317[Pa]    # "Pound per square inch"
%newunit mmHg=133.322387415[Pa]   # "Millimeter of mercury"

%newunit P=0.1[Pa s]              # "Poise"
%newunit St=1e-4[m^2/s]           # "Stokes"
%newunit C=1[A s]                 # "Coulomb"
%newunit V=1[W/A]                 # "Volt"
%newunit Ω=ohm=1[V/A]             # "Ohm"
%newunit S=1[A/V]                 # "Siemens"
%newunit F=1[C/V]                 # "Farad"
%newunit Wb=1[V s]                # "Weber"
%newunit H=1[Wb/A]                # "Henry"
%newunit T=1[Wb/m^2]              # "Tesla"
%newunit Gs=1e-4[T]               # "Gauss"

%newunit sr=1                     # "Steradian"
%newunit lm=4*pi*1[cd]            # "Lumen"
%newunit lx=1[lm/m^2]             # "Lux"
%newunit ph=1e4[lx]               # "Phot"

%newunit Bq=1[s^-1]               # "Becquerel"
%newunit Ci=3.7e10[Bq]            # "Curie"
%newunit Gy=1[J/kg]               # "Gray"
%newunit Sv=1[J/kg]               # "Sievert"

%newunit rad=1                    # "Radian"
%newunit °=deg=pi/180             # "Degree"
%newunit arcmin=1[deg]/60         # "Arcminute"
%newunit arcsec=1[arcmin]/60      # "Arcsecond"

# Physical constants
%newunit u=const["atomic mass unit-kilogram relationship"] # "amu\n\nAtomic mass unit"
%newunit atm=const["standard atmosphere"] # "Atmosphere\n\nStandard atmosphere at sea level"
%newunit torr=1[atm]/760          # "Torr"
%let c=const["speed of light in vacuum"]         # "Speed of light in vacuum"
%let G=const["Newtonian constant of gravitation"] # "Newtonian constant of gravitation"
%let h=const["Planck constant"]                   # "Planck constant"
%let hbar=h/(2*pi)                                # "Planck constant over 2 pi"
%let k=const["Boltzmann constant"]                # "Boltzmann constant"
%let alpha=const["fine-structure constant"]       # "Fine-structure constant"
%let Nav=const["Avogadro constant"]               # "Avogadro constant"

%let m_e=const["electron mass"]   # "Electron mass"
%let m_p=const["proton mass"]     # "Proton mass"
%let m_d=const["deuteron mass"]   # "Deuteron mass"
%let m_n=const["neutron mass"]    # "Neutron mass"
%let m_mu=const["muon mass"]      # "Muon mass"
%let m_tau=const["tau mass"]      # "Tau mass"

%let e=const["elementary charge"] # "Elementary charge"
%newunit eV=1[V]*e                # "Electron Volt"
%newunit E_h=const["Hartree energy"] # "Hartree energy"
%let Gfermi=const["Fermi coupling constant"] # "Fermi coupling constant"
%let me=const["electron mass"]    # "Electron mass"
%let mp=const["proton mass"]      # "Proton mass"
%let muBohr=e*hbar/(2*me)         # "Bohr magneton"
%let faraday=e*Nav                # "Faraday constant"

%let g=const["standard acceleration of gravity"] # "Standard acceleration of gravity"
%let atmosphere=const["standard atmosphere"]     # "Standard atmosphere"

%let mu0=4*pi*1e-7[H/m]           # "Permeability of vacuum"
%let epsilon0=1/(mu0*c^2)         # "Permittivity of vacuum"
%let ke=1/(4*pi*epsilon0)         # "Coulomb constant"

%let sigma=2*pi^5*k^4/(15*h^3*c^2) # "Stefan-Boltzmann constant"
%let R=Nav*k                       # "Molar gas constant"

%newsystem easy=[m|s|kg|K|A|lx|mol|EUR|N|J|W|Pa|C|V|ohm|F|H|T|lx] # "Easy system: SI with derived units"
%newsystem Easy=[*|easy] # "Easy system with prefixes"

# Natural units
%newsystem planck=["c"|"hbar"|"G"|"ke"|"k"]  # "Planck unit system"
%newsystem stoney=["c"|"G"|"ke"|"e"|"k"]     # "Stoney unit system"
%newsystem atomic=["e"|"me"|"hbar"|"ke"|"k"] # "Hartree atomic unit"
%newsystem qcdunits=["c"|"mp"|"hbar"|"k"]    # "Quantum chromodynamics (QCD) unit system"

######################################################################
##                    iMKS library file: Astro                      ##
######################################################################

%newunit AU=au=149597870700[m]          # "Astronomical Unit"
%newunit ly=9460536207068016[m]         # "Light Year"
%newunit pc=3600*180/pi*1[au]           # "Parsec"
%newunit Jy=1e-26[W/m^2 Hz]             # "Jansky"

%let siderealyear=365.25636[day]        # "Sidereal year"
%let siderealday=86164.09054[s]         # "Sidereal day"

%let Msun=1.98889e30[kg]                # "Mass of the Sun"
%let Rsun=6.961e8[m]                    # "Radius of the Sun"
%let Lsun=3.847e26[W]                   # "Luminosity of the Sun"
%newunit Msun=Msun                      # "Mass of the Sun"
%newunit Lsun=Lsun                      # "Luminosity of the Sun"

# CMB related quantities
%let T_CMB = 2.725[K]                   # "CMB temperature"
%lazy rho_CMB = pi^2/(c^2*15) * (k*T_CMB)^4 / (hbar*c)^3 # "CMB energy density"
%lazy n_CMB = 2*1.2020569031596*(k*T_CMB)^3 / (pi^2*hbar^3*c^3) @ cm # "CMB number density"
%lazy n_nu = (3.0/11.0) * n_CMB @ cm    # "Neutrino number density"
%let T_nu = (4.0/11.0)^(1/3) * T_CMB    # "Neutrino temperature"

# Cosmological quantities
%let H0 = 70[km s^-1 Mpc^-1]            # "Hubble's constant"
%lazy rho_c = 3*H0^2/(8*pi*G)           # "Critical density"
%let OmegaM = 0.3                       # "Mass density parameter"
%let OmegaL = 0.7                       # "Cosmological constant parameter"
%lazy OmegaCMB = rho_CMB / rho_c        # "CMB density parameter"
%lazy OmegaK = 1 - OmegaM - OmegaL      # "Curvature parameter"
%lazy dH = c / H0 @ Mpc                 # "Hubble's distance"
%lazy tH = 1 / H0 @ Gyr                 # "Hubble's time"

%newsystem astro=[pc|km/s|Msun|K|A|cd|mol|EUR] # "Astronomical system"

%defaultsystem si
`;

// ---------------------------------------------------------------------
// Output formats

function gfmt(x) {
  return String(Number(x.toPrecision(6)));
}

function addFormats(env) {
  const hour = 3600, day = 86400;
  const time = (q) => {
    if (!q.pure && !(q.d[2] === 1 && q.d.every((e, i) => i === 2 || e === 0))) {
      throw new UnitError("Not a time");
    }
    return q.relative().x.n;
  };
  env.formats.set("hms", {
    doc: "A format for strings like 12h 30m 25.2s",
    fn: (q) => {
      const t = time(q);
      const sgn = t < 0 ? "-" : "";
      let x = (Math.abs(t) + 0.0005) / hour;
      const h = Math.floor(x); x = (x - h) * 60;
      const m = Math.floor(x); x = (x - m) * 60;
      return `${sgn}${h}h ${m}m ${gfmt(Math.floor(x * 1000) / 1000)}s`;
    },
  });
  env.formats.set("dhms", {
    doc: "A format for strings like 1d 12h 30m 25.2s",
    fn: (q) => {
      const t = time(q);
      const sgn = t < 0 ? "-" : "";
      let x = (Math.abs(t) + 0.0005) / day;
      const d = Math.floor(x); x = (x - d) * 24;
      const h = Math.floor(x); x = (x - h) * 60;
      const m = Math.floor(x); x = (x - m) * 60;
      return `${sgn}${d}d ${h}h ${m}m ${gfmt(Math.floor(x * 1000) / 1000)}s`;
    },
  });
  env.formats.set("dms", {
    doc: "A format for angles like 12° 30' 25.2\"",
    fn: (q) => {
      if (!q.pure) throw new UnitError("Not an angle");
      const a = q.x.n;
      const sgn = a < 0 ? "-" : "";
      let x = (Math.abs(a) + 0.0005 * Math.PI / 180 / 3600) * 180 / Math.PI;
      const d = Math.floor(x); x = (x - d) * 60;
      const m = Math.floor(x); x = (x - m) * 60;
      return `${sgn}${d}° ${m}' ${gfmt(Math.floor(x * 1000) / 1000)}"`;
    },
  });
  env.formats.set("frac", {
    doc: "Show a pure number as a fraction",
    fn: (q) => {
      if (!q.pure) throw new UnitError("Not a pure number");
      const x = q.x.n;
      let [h0, h1, k0, k1] = [0, 1, 1, 0], y = x;
      for (let i = 0; i < 30; i++) {
        const a = Math.floor(y);
        [h0, h1] = [h1, a * h1 + h0];
        [k0, k1] = [k1, a * k1 + k0];
        if (Math.abs(x - h1 / k1) < 1e-12 * Math.abs(x) || k1 > 1e9) break;
        y = 1 / (y - a);
      }
      return k1 === 1 ? String(h1) : `${h1}/${k1}`;
    },
  });
}

// ---------------------------------------------------------------------
// Currencies (rates relative to `base`, as in openexchangerates.org)

function loadCurrencies(env, data) {
  if (!data || !data.rates || !env.basecurrency) return 0;
  const base = env.basecurrency;
  const rates = data.rates;
  if (!rates[base]) return 0;
  const bq = env.units.get(base);
  let n = 0;
  for (const [k, v] of Object.entries(rates)) {
    if (!v || k === base) continue;
    if (env.units.has(k) && !env.units.get(k).currency) continue;
    const q = new Q(rates[base] / v, bq.d);
    q.doc = `${data.names?.[k] || k}\n\nExchange rate of ${data.timestamp || "unknown date"}`;
    q.currency = true;
    env.units.set(k, q);
    n++;
  }
  for (const [code, sym] of Object.entries(currencySymbols)) {
    const u = env.units.get(code);
    if (u && (!env.units.has(sym) || env.units.get(sym).currency)) {
      const q = new Q(u.x, u.d);
      q.doc = u.doc;
      q.currency = true;
      env.units.set(sym, q);
    }
  }
  env.currencyTime = data.timestamp;
  env.touch();
  return n;
}

// Build a calculator with startup definitions, constants and currencies
function createCalculator({ constants = {}, currencies = null, extra = "", correlations = null } = {}) {
  const calc = new Interpreter();
  calc.const.data = constants;
  calc.const.corr = correlations;
  addFormats(calc.env);
  const errors = calc.runScript(STARTUP);
  // currencies before the user definitions, so these can use them
  loadCurrencies(calc.env, currencies);
  calc.systemNames = new Set(calc.env.vars.keys());
  const userErrors = extra ? calc.runScript(extra) : [];
  return { calc, errors, userErrors };
}

export { STARTUP, loadCurrencies, createCalculator };
