// The map, as plain math. One height function is used for the ground mesh,
// the road, the markers and the car, so everything sits on the same surface.
// x runs east, z runs south, y is up.

// Where each stop sits on the road, and where its light beam stands beside it.
export const STOPS = {
  wastewise: { pos: [-32, 34], beam: [-35, 44] },
  mandi: { pos: [70, -28], beam: [60, -31] },
  campus: { pos: [-85, -30], beam: [-95, -30] },
  reels: { pos: [0, -100], beam: [0, -110] },
  angaar: { pos: [-62, 18], beam: [-71, 22] },
  beatcut: { pos: [52, -80], beam: [58, -88] },
  about: { pos: [0, 105], beam: [0, 114] },
}

export const START = { x: 14, z: 39, heading: -Math.PI / 2 } // facing WasteWise

// Closed loop, with an S-bend on the east side at Mandi.
export const LOOP = [
  [0, 40], [-32, 34], [-62, 18], [-85, -30], [-52, -80], [0, -100],
  [52, -80], [95, -52], [70, -28], [92, -2], [60, 22],
]
// Dead-end spur south to the overlook.
export const SPUR = [[0, 40], [4, 62], [-4, 85], [0, 105]]

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

  h -= 2.5 * bump(x, z, -32, 34, 20) // WasteWise: shallow basin
  h += 7 * bump(x, z, 0, -100, 45) // Reels: the high ridge
  h -= 5 * bump(x, z, 0, 105, 35) // About: the low overlook

  // Campus Life Club: stepped terraces climbing west, like seating.
  const q = Math.min(4, Math.max(0, (-x - 70) / 6))
  const f = q % 1
  const step = Math.floor(q) + smooth(Math.min(1, Math.max(0, (f - 0.75) / 0.25)))
  h += 1.4 * step * bump(x, z, -90, -30, 30)

  return h
}

export function gradient(x, z) {
  const e = 0.5
  return [
    (height(x + e, z) - height(x - e, z)) / (2 * e),
    (height(x, z + e) - height(x, z - e)) / (2 * e),
  ]
}
