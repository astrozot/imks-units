# Astronomical accuracy

Updated: 14 November 2026.

This document records the astronomical models in Astrolabium/Coelum, what has
been validated, the remaining limitations, and possible future improvements.
It is a record of engineering decisions as well as an accuracy reference.
Update it when changing a model, reference frame, catalog, event geometry or
accuracy claim. Implementation and regeneration details remain in [README.md](README.md).

## How to interpret the results

The compact model powers normal calculator use and sky drawing without an
ephemeris download. Optional JPL calculations provide a more precise reduction
for supported position and event requests. Selecting that refinement does not
turn the entire animated sky into a JPL calculation.

Keep these kinds of evidence separate:

- A sampled maximum describes the stated dates and objects, not every possible
  observation or a statistical confidence interval.
- Agreement between implementations using the same JPL kernel tests the
  evaluator/reduction. It does not measure the kernel's observational error.
- Frame agreement does not establish the accuracy of an orbit, catalog, clock,
  atmospheric model, terrain or physical limb.
- More displayed digits do not establish greater accuracy.

The sky explorer accepts astronomical years −1000 through 3000, including year
0. Individual models and validation sets cover narrower intervals. A supported
UI date is not a uniform accuracy promise.

## Implemented stellar corrections and shared frame

| Component | Current treatment |
|---|---|
| Catalog position and motion | ICRS/J2000 catalog directions; proper motion propagated in space. Calculator and precision reductions can include radial velocity where supplied. Chart catalogs do not supply radial velocity. |
| Annual stellar parallax | Included where a positive catalog parallax is known. Missing/nonpositive parallax is treated as unknown. |
| Observer position | Local WGS 84 position includes stellar diurnal parallax naturally. It is much smaller than annual parallax. |
| Annual aberration | Included in drawing, selection/detail coordinates and calculator positions. Compact reduction uses an approximate heliocentric Earth velocity and first-order aberration. |
| Diurnal aberration | Included in local apparent positions from Earth's rotational velocity; excluded from geocentric positions. |
| Solar gravitational deflection | Included for stars and distant catalog objects before aberration. A bounded solar monopole model handles directions within the opaque solar disk safely. Detail cards report the included angular shift. |
| Bias and precession | Shared IAU 2006 frame. Compact analytic ephemerides retain their original frame internally and their outputs are converted. |
| Nutation | Shared 77-term IAU 2000B series with full fundamental arguments; tested against ERFA's full IAU 2000A model. |
| Earth rotation | Shared frame uses CIO/equation-of-origins rotation. Compact calculations retain modelled TT/UT1; native refinement can use available IERS information. |
| Coordinate conversions | Dated `radec`, `ecl`, `eq2ecl` and `ecl2eq` use a consistent equinox/obliquity, also used in longitude-event searches. |

Solar deflection here is an astrometric direction correction. Magnification,
multiple images and gravitational deflection by planets are not simulated in
the compact drawing. Artificial satellites retain the geometric SGP4
convention rather than receiving the stellar reduction.

The shared frame and Earth/observer quantities are computed per timestamp,
not independently for every star. Downloaded catalogs retain spatial tile
culling, with conservative bounds for motion and apparent displacement.
Double-precision tile centres prevent omissions in very narrow cones.
Playback caches catalog space motion for at most a day while updating the
shared frame, parallax, deflection and aberration. Selection coordinates for
downloaded stars follow the drawing's current observer state.

### Measured stellar results

| Measurement | Sampled result | Evidence |
|---|---:|---|
| Compact stellar apparent positions against full ERFA reduction, 1900–2099 | Maximum discrepancy ≈0.0123″ (12.3 mas) | [Stellar checks](tests/stellar-positions.mjs), [independent references](tests/fixtures/stellar-positions.json) |
| Shared frame against ERFA IAU 2006/2000A, selected dates from −1000 through 3000 | Maximum axis discrepancy ≈0.000919″ | Same checks/references |
| Shared Earth rotation at those dates | Maximum discrepancy ≈0.000692″ | Same checks/references |

The full stellar comparison shares the app's TT/UT1 clock assumptions and
disables atmospheric refraction and polar motion. Its synthetic catalog
entries have zero radial velocity. It tests the reduction, not the errors of
real stars' catalog parameters. The dated frame checks are sparse samples,
not an exhaustive audit over four millennia.

During development the largest sampled stellar discrepancy changed from
0.924″ to 0.1681″ after solar deflection, then to 0.0123″ after the frame
upgrade. The original 0.924″ case was a synthetic star near the Sun on
21 March 2026; most of that discrepancy was omitted solar deflection.

### Remaining stellar discrepancy and decision

The main remaining contribution is the compact Earth state: truncated
VSOP87 heliocentric position/velocity, versus the barycentric observer state
needed for more precise stellar parallax and aberration. Other contributions
include first-order aberration, the finite nutation series and small
differences in space-motion propagation.

An exploratory substitution study with the **full ERFA frame** reduced the
sampled maximum from about 0.01235″ to 0.000521″ when the Earth/observer state
was replaced by ERFA's, and to 0.000153″ after relativistic aberration. These
are successive diagnostic substitutions, not independent additive error
terms or the accuracy of the shipped 77-term implementation. This diagnostic
is explanatory evidence from implementation work; it is not a separate
checked-in regression fixture.

**Decision, 14 November 2026:** defer a barycentric Earth-state model and fully
relativistic aberration for the compact renderer. The current sampled stellar
agreement is sufficient for visualization and the intended compact-model
uses. The existing JPL precision engine already provides a barycentric
reduction where higher accuracy matters.

This decision is about model maintenance, dependencies, consistency and
validation, not a claim that barycentric calculations would be too slow.
Earth state is shared across stars, so runtime cost could be modest.
Revisit the decision if a concrete requirement arises for precise stellar
occultation timing, telescope pointing, or milliarcsecond astrometry in the
normal calculator/renderer. A future change must use consistent barycentric
position **and** velocity, declare its date range and data dependencies, and
be validated and benchmarked before changing the default.

## Solar-system models and events

The compact Sun/planet model uses truncated VSOP87D with planetary light time
and observer aberration. “Planetary aberration” is the combined effect of light
time and aberration, not a third independent correction to add. The Moon uses
a refined compact series over 1600–2400 and a Meeus fallback outside that
interval. Major planetary-moon series were fitted and audited over 1900–2100.

Implemented event geometry includes finite disks, planetary flattening,
differential light time, the Sun's angular size, umbra/penumbra, visible
shadow contacts and searches for short grazes. Optional native JPL refinement
uses barycentric light time, solar deflection, relativistic aberration and
modern frames, with available IERS UT1/polar motion. Its data may include
predictions as well as observations; it is not a live Earth-orientation feed.

Representative committed validation results:

| Scope | Result and interpretation | Evidence |
|---|---|---|
| Refined compact Moon, independent audit including 1600 and 2400 | Sampled maximum geometric error 1.42″; RMS 0.37″, versus 3.47″/0.59″ before refinement. The separate validation set has different maxima. | [Astronomy audit](data/astronomy-accuracy.json) |
| Compact planetary moons, 1,002 audit dates per moon over 1900–2100 | Examples: maximum errors ≈21 km for Io, 22 km for Europa, 4 km for Triton. Hyperion and Iapetus remain much less accurate, at ≈2,727 km and 1,122 km. | Same audit; individual allowances and interval bins are recorded there. |
| Native DE440s evaluator | 588 state checks; maximum recorded position-component difference ≈0.029 m. This is evaluator agreement on the same kernel. | [Precision audit](data/precision-accuracy.json) |
| Native apparent positions against Skyfield | 108 comparisons; recorded maxima for Sun, Moon, Mercury and Venus ≈0.0016″. | Same audit |
| Native eclipse/occultation event comparisons | 13 cases; maximum contact difference ≈0.079 s, maximum-time difference ≈0.133 s, under declared common physical/time assumptions. | Same audit |
| Independently solved native planetary-moon contacts | 246 contacts; consult the current report for the maximum timing difference. Seeded checks do not prove every event is found. | [Moon-event audit](data/precision-moon-events-validation.json), [method and data requirements](workers/ephemeris-static/README.md) |

Prefer native refinement for critical outer-planet occultation calculations.
More accurate parent-planet positions alone do not make compact satellite
orbits or event geometry authoritative.

## Limits that remain important

| Area | Limitation / possible improvement |
|---|---|
| Stellar catalogs | Missing or uncertain parallax/radial velocity, catalog epoch transformations, binaries and long extrapolations can dominate numerical reduction errors. Chart propagation does not include radial velocity. |
| Earth rotation and civil time | Modelled ΔT, future UT1 and unknown future leap seconds limit event timing/geography. Native calculations report rotation uncertainty where IERS data are unavailable. |
| Lunar terrain | Solar-eclipse and lunar-occultation contacts use a smooth mean limb. Terrain-dependent grazing contacts and Baily's beads require a validated DEM, orientation and line-of-sight limb model. The rendered relief is not a terrain-aware contact prediction. |
| Planetary-moon events | Compact orbit errors, adopted radii, atmospheric limbs and grazing geometry affect timing. Mutual moon events, rings covering moons and local-observer parallax are outside the current geocentric event model. |
| Atmospheric refraction | Standard-atmosphere approximation; real weather and near-horizon conditions can dominate the astrometric improvements. |
| Local landscape | Local-horizon data, sampling, observer height and vertical datum need validation. Terrain experiments are separate from production accuracy claims. |
| Artificial satellites | SGP4/TLE age and orbit quality dominate; brightness and attitude are approximate. Stellar correction accuracy does not describe satellite accuracy. |
| Photometry and appearance | Gaia-derived visual magnitudes/colours, approximate stellar temperatures, cloud patterns and rendered textures are not precision observational predictions. |

## Future work and priorities

| Status | Work | Reason to revisit |
|---|---|---|
| Deferred by explicit decision | Barycentric Earth state and relativistic aberration in the compact path | A demonstrated requirement below the present ≈12 mas sampled residual; use existing native refinement first. |
| Candidate | Better stellar space-motion/radial-velocity coverage and explicit catalog uncertainty | High-proper-motion/nearby stars or long extrapolations become limiting. |
| Candidate | Denser stellar/frame audits, especially near the Sun, poles, high proper motion and date limits | Expand evidence before tightening accuracy claims. |
| Candidate | Full nutation series | A requirement below the present sub-mas sampled frame discrepancy justifies the additional model. |
| Candidate | Planetary gravitational deflection | A specific close planetary encounter requires milliarcsecond astrometry; benchmark and validate separately. |
| Candidate | More precise planetary-moon orbits and event models | Required event uncertainty is dominated by orbit/limb geometry rather than parent-planet ephemeris. |
| Candidate | Terrain-aware lunar contacts | DEM preparation, orientation and limb validation are complete; account for Earth rotation and physical radii in the timing budget. |
| Candidate | Better local terrain, atmospheric inputs and Earth-orientation updates | Actual observing conditions or event geography dominate the error budget. |

These are options, not scheduled work or promises of an accuracy level.

## Comparisons and performance

Normalize reference frames, clocks, observer origin and enabled corrections
before comparing positions. Saved Horizons observer RA/Dec uses an IAU76/80
frame; the main tests use independently generated ERFA rotations to compare
it with modern apparent coordinates. Original Horizons values remain intact.
See [frame references](tests/fixtures/horizons-frames.json) and their
[generator](tools/horizons-frame-reference.py).

The Stellarium desktop Accuracy chapter inspected during this work explicitly
excludes solar gravitational light deflection, so near-Sun stellar coordinates
can intentionally differ. This is a documented difference, not a measured
end-to-end accuracy ranking. See the [Stellarium guide source](https://github.com/Stellarium/stellarium/blob/master/guide/app_accuracy.tex).

The pinned [Stellarium 26.3 comparison](data/stellarium-comparison-validation.json)
uses commit `3f23cf3a1a59523a9c7b1ec4540c33bca77addfa` and six epochs in
1900–2099. It compares selected satellite **orbit models** with JUP365/SAT441;
it does not compare full apparent positions, event timings, or Stellarium's
optional JPL configuration.

Performance reports use interleaved, warmed before/after measurements with
2,308,825 catalog stars, a 390×844 viewport and 4× desktop CPU throttling.
The solar-deflection upgrade added at most about 0.7 ms in the sampled drawing
fields and 0.6 ms to default playback updates. The frame upgrade changed
default playback updates from 9.7 to 9.8 ms. These measurements exclude catalog
loading/network, time drawing and updates separately, and do not substitute
for physical-phone measurements. Raw results:
[stellar corrections](data/stellar-performance.json),
[solar deflection](data/solar-deflection-performance.json),
[modern frame](data/modern-frame-performance.json).

## Maintaining this document

For each future accuracy change, record the model and date range, coordinate
and time conventions, reference implementation/dataset and version, sampled
errors and remaining limits, relevant commands, and any rendering/data cost.
Keep implementation-completed work distinct from proposed improvements.

Useful regression entry points:

```sh
node tests/stellar-positions.mjs
node tests/run.mjs
node tests/astronomy-accuracy.mjs
node tests/precision.mjs
node tests/precision-moon-events.mjs
node tests/coelum.mjs
node tests/gaia-stars.mjs
node tests/gaia-stars-browser.mjs
```

Browser checks need the Playwright/Chrome configuration in the README; native
moon-event checks need their staged ephemeris data. Reference regeneration
uses development dependencies, including pyerfa, Skyfield or jplephem/SciPy as
specified by the individual tools. Do not infer a scientific accuracy result
from a skipped check or from a test whose required data were unavailable.
