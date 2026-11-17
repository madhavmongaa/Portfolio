// The map, as plain math. One height function is used for the ground mesh,
// the road, the markers and the car, so everything sits on the same surface.
// x runs east, z runs south, y is up.

// Where each stop sits on the road, and where its light beam stands beside it.
// The six loop stops are evenly spaced along the road (about 87 m apart) in
// the order they are numbered, and About sits at the end of the spur, the
// same distance from the junction as half that gap. `out` points away from
// the loop, toward the side the beam stands on.
export const STOPS = {
  wastewise: { pos: [-42.1, 30.3], beam: [-45.8, 39.6], out: [-0.37, 0.93] },
  mandi: { pos: [-83.1, -39], beam: [-92.6, -42.2], out: [-0.95, -0.32] },
  reels: { pos: [-21.2, -96.4], beam: [-24.2, -105.9], out: [-0.3, -0.95] },
  angaar: { pos: [60.4, -75.9], beam: [64.7, -84.9], out: [0.43, -0.9] },
  beatcut: { pos: [74, -20.9], beam: [81, -28.1], out: [0.7, -0.71] },
  campus: { pos: [42.2, 29.7], beam: [45.7, 39], out: [0.35, 0.94] },
  about: { pos: [0, 82], beam: [0, 91] },
}

export const START = { x: 14, z: 39, heading: -Math.PI / 2 } // facing WasteWise

// Closed loop, with an S-bend on the east side at Mandi.
export const LOOP = [
  [0, 40], [-32, 34], [-62, 18], [-85, -30], [-52, -80], [0, -100],
  [52, -80], [95, -52], [70, -28], [92, -2], [60, 22],
]
// Dead-end spur south to the overlook.
export const SPUR = [[0, 40], [3, 54], [-2, 68], [0, 82]]

export const ROAD_WIDTH = 7
export const STOP_RADIUS = 10
export const WORLD_RADIUS = 165

const bump = (x, z, cx, cz, r) => Math.exp(-((x - cx) ** 2 + (z - cz) ** 2) / (r * r))
const smooth = (t) => t * t * (3 - 2 * t)

export function height(x, z) {
  // Rolling valley floor.
  let h =
    1.6 * Math.sin(x * 0.035 + 1.3) * Math.cos(z * 0.03) +
    0.9 * Math.sin(x * 0.08 - z * 0.06) +
    0.5 * Math.cos(x * 0.05 + z * 0.11)

  // Valley walls: the ground climbs steeply past the playable area.
  const edge = Math.max(0, Math.hypot(x, z) - 125)
  h += edge * edge * 0.03

  const at = (id, k, r) => bump(x, z, STOPS[id].pos[0], STOPS[id].pos[1], r) * k
  h -= at('wastewise', 2.5, 20) // a shallow basin
  h += at('reels', 7, 45) // the high ridge
  h -= at('about', 5, 28) // the low overlook

  // Campus Life Club: stepped terraces climbing away from the road, like seating.
  // They start past the road's edge, so the road itself stays on smooth ground.
  const c = STOPS.campus
  const away = (x - c.pos[0]) * c.out[0] + (z - c.pos[1]) * c.out[1]
  const q = Math.min(4, Math.max(0, (away - 6) / 5))
  const f = q % 1
  const step = Math.floor(q) + smooth(Math.min(1, Math.max(0, (f - 0.75) / 0.25)))
  h += 1.4 * step * bump(x, z, c.pos[0] + c.out[0] * 16, c.pos[1] + c.out[1] * 16, 30)

  return h
}

export function gradient(x, z) {
  const e = 0.5
  return [
    (height(x + e, z) - height(x - e, z)) / (2 * e),
    (height(x, z + e) - height(x, z - e)) / (2 * e),
  ]
}
