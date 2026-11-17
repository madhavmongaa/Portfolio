// Routes along the road. The road is a closed loop plus one spur that leaves
// the loop at its first point, both sampled every ~1.5 m. A route is the list
// of samples from one place to another, taking the shorter way round the loop.

export function createRoutes(loopPts, spurPts, loopLen, spurLen) {
  const N = loopPts.length - 1 // the last loop sample repeats the first
  const M = spurPts.length - 1
  const dl = loopLen / N
  const ds = spurLen / M

  // Nearest road sample to a point: { spur: bool, k: index }.
  function locate(x, z) {
    let best = Infinity
    let at = { spur: false, k: 0 }
    for (let k = 0; k < N; k++) {
      const d = (loopPts[k][0] - x) ** 2 + (loopPts[k][1] - z) ** 2
      if (d < best) [best, at] = [d, { spur: false, k }]
    }
    for (let k = 1; k <= M; k++) {
      const d = (spurPts[k][0] - x) ** 2 + (spurPts[k][1] - z) ** 2
      if (d < best) [best, at] = [d, { spur: true, k }]
    }
    return at
  }

  // Walk the loop from sample a to b the shorter way. Returns the samples and
  // the covered stretch as [from, to] in increasing arc length (wrapping).
  function loopWalk(a, b, pts) {
    const fwd = (((b - a) % N) + N) % N
    const dir = fwd <= N - fwd ? 1 : -1
    const steps = dir > 0 ? fwd : N - fwd
    for (let s = 0; s <= steps; s++) pts.push(loopPts[(((a + dir * s) % N) + N) % N])
    return dir > 0 ? [a * dl, b * dl] : [b * dl, a * dl]
  }

  // Route between two road locations. `loop` and `spur` are the stretches to
  // light up on each road, or null.
  function between(from, to) {
    const pts = []
    let loop = null
    let spur = null
    if (!from.spur && !to.spur) {
      loop = loopWalk(from.k, to.k, pts)
    } else if (from.spur && to.spur) {
      const dir = to.k >= from.k ? 1 : -1
      for (let k = from.k; k !== to.k + dir; k += dir) pts.push(spurPts[k])
      spur = [Math.min(from.k, to.k) * ds, Math.max(from.k, to.k) * ds]
    } else if (from.spur) {
      for (let k = from.k; k >= 1; k--) pts.push(spurPts[k])
      spur = [0, from.k * ds]
      loop = loopWalk(0, to.k, pts)
    } else {
      loop = loopWalk(from.k, 0, pts)
      for (let k = 1; k <= to.k; k++) pts.push(spurPts[k])
      spur = [0, to.k * ds]
    }
    let length = 0
    for (let k = 1; k < pts.length; k++) length += Math.hypot(pts[k][0] - pts[k - 1][0], pts[k][1] - pts[k - 1][1])
    return { pts, loop, spur, length }
  }

  return { locate, between }
}
