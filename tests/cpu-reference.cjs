// Independent bisection followed by successive orbital-plane rotations.
// Keep this separate from production's Newton solver and projection basis.
module.exports = function reference(eph, jed) {
  const rad = Math.PI / 180, tau = Math.PI * 2;
  let mean = (eph.M * rad + (eph.n ? eph.n * rad : tau / eph.P) * (jed - eph.epoch)) % tau;
  if (mean > Math.PI) mean -= tau;
  if (mean < -Math.PI) mean += tau;
  let lo = -Math.PI, hi = Math.PI;
  for (let i = 0; i < 96; i++) {
    const mid = (lo + hi) / 2;
    // Avoid cancellation when independently checking tiny near-parabolic phases.
    const m2 = mid * mid;
    const eccentric = Math.abs(mid) < 0.01
      ? (1 - eph.e) * mid + eph.e * mid * m2 * (1 / 6 - m2 / 120 + m2 * m2 / 5040)
      : mid - eph.e * Math.sin(mid);
    if (eccentric < mean) lo = mid;
    else hi = mid;
  }
  const E = (lo + hi) / 2;
  const x = eph.a * 100 * (Math.cos(E) - eph.e);
  const y = eph.a * 100 * Math.sqrt((1 - eph.e) * (1 + eph.e)) * Math.sin(E);
  const w = ((eph.wbar ?? eph.w + eph.W) - eph.W) * rad;
  const px = x * Math.cos(w) - y * Math.sin(w);
  const py = (x * Math.sin(w) + y * Math.cos(w)) * Math.cos(eph.i * rad);
  return { x: -(px * Math.cos(eph.W * rad) - py * Math.sin(eph.W * rad)),
    y: px * Math.sin(eph.W * rad) + py * Math.cos(eph.W * rad) };
};
