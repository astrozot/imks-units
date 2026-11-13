// Explicit official sources: this service is not an arbitrary URL proxy.
const ROOT = 'https://naif.jpl.nasa.gov/pub/naif/generic_kernels/spk/';
export const KERNELS = Object.freeze(Object.fromEntries([
  ['de440', 'planets/de440.bsp'], ['de440s', 'planets/de440s.bsp'],
  ['de441-part1', 'planets/de441_part-1.bsp'], ['de441-part2', 'planets/de441_part-2.bsp'],
  ['mar099', 'satellites/mar099.bsp'], ['jup365', 'satellites/jup365.bsp'],
  ['sat441', 'satellites/sat441.bsp'], ['nep097', 'satellites/nep097.bsp'],
  ['ura184', 'satellites/ura184_part-3.bsp'],
].map(([name, path]) => [name, ROOT + path])));
export const SYSTEMS = Object.freeze({
  mars: { kernel: 'mar099', center: 4, targets: [499,401,402] },
  jupiter: { kernel: 'jup365', center: 5, targets: [599,501,502,503,504] },
  saturn: { kernel: 'sat441', center: 6, targets: [699,601,602,603,604,605,606,607,608] },
  uranus: { kernel: 'ura184', center: 7, targets: [799,705,701,702,703,704] },
  neptune: { kernel: 'nep097', center: 8, targets: [899,801] },
});
