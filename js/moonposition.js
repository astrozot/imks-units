// Planet-equatorial satellite series, geometric km at TT days since J2000.
// Secular amplitudes share each term's sin/cos evaluation with the base
// series; fitting more realistic long-term evolution need not add trig calls.
function moonSeriesPosition(model, days) {
  const [xy, z, , secular] = model, T = days / 36525;
  const amplitude = (terms, coeffs, i) => {
    let a = 0, b = 0;
    if (secular && coeffs) {
      const offset = i / 3 * 2 * secular.order;
      for (let k = secular.order - 1; k >= 0; k--) {
        a = (a + coeffs[offset + 2 * k]) * T;
        b = (b + coeffs[offset + 2 * k + 1]) * T;
      }
    }
    return [terms[i + 1] + a, terms[i + 2] + b];
  };
  let x = 0, y = 0, height = 0;
  for (let i = 0; i < xy.length; i += 3) {
    const c = Math.cos(xy[i] * days), s = Math.sin(xy[i] * days), [a, b] = amplitude(xy, secular?.xy, i);
    x += a * c - b * s; y += a * s + b * c;
  }
  for (let i = 0; i < z.length; i += 3) {
    const [a, b] = amplitude(z, secular?.z, i);
    height += a * Math.cos(z[i] * days) + b * Math.sin(z[i] * days);
  }
  return [x, y, height];
}

export { moonSeriesPosition };
