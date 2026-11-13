// Lightweight body identifiers shared by optional UI and worker code.
export const PLANET_IDS={mercury:1,venus:2,mars:4,jupiter:5,saturn:6,uranus:7,neptune:8};
export const NATIVE_SYSTEMS={
 mars:{kernel:'mar099',center:4,targets:[499,401,402]},
 jupiter:{kernel:'jup365',center:5,targets:[599,501,502,503,504]},
 saturn:{kernel:'sat441',center:6,targets:[699,601,602,603,604,605,606,607,608]},
 uranus:{kernel:'ura184',center:7,targets:[799,705,701,702,703,704]},
 neptune:{kernel:'nep097',center:8,targets:[899,801]},
};
export const NATIVE_MOONS={
 phobos:[4,401],deimos:[4,402],io:[5,501],europa:[5,502],ganymede:[5,503],callisto:[5,504],
 mimas:[6,601],enceladus:[6,602],tethys:[6,603],dione:[6,604],rhea:[6,605],titan:[6,606],hyperion:[6,607],iapetus:[6,608],
 miranda:[7,705],ariel:[7,701],umbriel:[7,702],titania:[7,703],oberon:[7,704],triton:[8,801],
};
export const nativeBody=name=>typeof name==='string'&&(['sun','moon'].includes(name.toLowerCase())||Object.hasOwn(PLANET_IDS,name.toLowerCase())||Object.hasOwn(NATIVE_MOONS,name.toLowerCase()));
export const systemOf=name=>Object.keys(NATIVE_SYSTEMS).find(key=>NATIVE_SYSTEMS[key].center===NATIVE_MOONS[name]?.[0]);

// The app accepts astronomical years -1000 through 3000. Extending its UI
// further also requires auditing the compact search and date-frame models.
export const HISTORICAL_YEARS=[-1000,3000];
export function selectNativeKernel(descriptors,jd,interval={fromJD:jd,toJD:jd}){
 const d=descriptors.de440;
 if(d&&interval.fromJD>=(d.fromJD??2287184.5)&&interval.toJD<=(d.toJD??2688976.5))return {id:'de440',source:'DE440'};
 for(const id of ['de441-part1','de441-part2']){
  const k=descriptors[id];if(k&&Number.isFinite(k.fromJD)&&Number.isFinite(k.toJD)&&interval.fromJD>=k.fromJD&&interval.toJD<=k.toJD)return {id,source:'DE441'};
 }
 // Older catalogues have no coverage metadata; let the SPK index give a
 // precise coverage error rather than guessing or extrapolating.
 if(d)return {id:'de440',source:'DE440'};
 throw new RangeError('No installed planetary kernel covers this date');
}
