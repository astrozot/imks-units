const MODES = ['altaz', 'equatorial', 'galactic'];
// A fast sequence replaces the active pair with its endpoints. Intermediate
// modes are skipped when later clicks are more than three seconds apart.
export class MountSwitcher {
  constructor(mode = 'altaz', pair = ['altaz', 'equatorial']) {
    this.pair = Array.isArray(pair) && pair.length === 2 && pair[0] !== pair[1] && pair.every((m) => MODES.includes(m)) ? [...pair] : ['altaz', 'equatorial'];
    this.reset(mode);
  }
  reset(mode) {
    if (!this.pair.includes(mode)) this.pair = [this.mode || this.pair[0], mode];
    this.mode = mode;
    this.last = -Infinity;
    this.cycle = null;
  }
  next(now) {
    if (now - this.last > 3000) {
      this.origin = this.mode;
      this.originalPair = [...this.pair];
      const other = this.pair.find((m) => m !== this.mode);
      this.cycle = [this.mode, other, MODES.find((m) => !this.pair.includes(m))];
      this.mode = other;
    } else this.mode = this.cycle[(this.cycle.indexOf(this.mode) + 1) % 3];
    this.pair = this.mode === this.origin ? [...this.originalPair] : [this.origin, this.mode];
    this.last = now;
    return this.mode;
  }
}
