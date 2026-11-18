import { createAudio } from './audio.js'
import * as THREE from 'three'
import { projects } from './data/projects.js'
import { panelHtml, num } from './ui/html.js'
import {
  STOPS, START, LOOP, SPUR, ROAD_WIDTH, STOP_RADIUS, WORLD_RADIUS, height, gradient,
} from './world/terrain.js'
import { createCar, loadModel } from './world/car.js'
import { createFx } from './world/fx.js'
import { createRoutes } from './world/route.js'
import { createStuds, createGates, createMist } from './world/scenery.js'

const BG = 0x0e0f11
// Gearbox: seven gears and reverse. RATIO is engine rpm per m/s in each gear,
// stepping down evenly so every upshift lands near 5,100 rpm; top speed
// (50 m/s, 180 km/h) sits just under the shift point in seventh.
const IDLE = 800
const REDLINE = 7000
const SHIFT_UP = 6600
const SHIFT_DOWN = 3000
const TOP = 50
const GEARS = 7
const RATIO = Array.from({ length: GEARS }, (_, k) => 618 * (132 / 618) ** (k / (GEARS - 1)))
const COUNT = projects.length
const root = document.documentElement
const $ = (id) => document.getElementById(id)

// ---------- shaders ----------
// Colours are written as final sRGB values; these materials skip colour conversion.
const COMMON = /* glsl */ `
  const vec3 GROUND = vec3(0.055, 0.059, 0.067);
  const vec3 ROAD = vec3(0.094, 0.098, 0.112);
  const vec3 LINE = vec3(0.165, 0.173, 0.188);
  const vec3 BRIGHT = vec3(0.541, 0.561, 0.596);
  const vec3 AMBER = vec3(0.910, 0.639, 0.239);
  uniform vec2 uCar;
  uniform vec2 uDir;
  uniform vec2 uStops[${COUNT}];
  uniform float uActive;
  uniform float uBrake;
  varying vec3 vP;

  // How much of the car's headlights reach this point on the ground: a low-beam
  // throw that starts at the bumper, widens ahead and has a soft edge, with a
  // brighter patch a few metres out.
  float headlight(vec2 p) {
    vec2 d = p - uCar;
    float along = dot(d, uDir);
    float side = d.x * uDir.y - d.y * uDir.x;
    float halfW = 0.9 + max(along, 0.0) * 0.36;
    float across = 1.0 - smoothstep(halfW * 0.55, halfW, abs(side));
    float reach = smoothstep(-0.5, 2.5, along) * exp(-max(along, 0.0) / 30.0);
    float spot = 1.0 + 0.45 * exp(-pow((along - 9.0) / 7.0, 2.0));
    return clamp(across * reach * spot, 0.0, 1.0);
  }
  float ring(float d, float r) { return 1.0 - smoothstep(0.0, 0.2, abs(d - r)); }
  // Amber survey rings around each stop. The first stop gets three, for sorting.
  float stops(vec2 p) {
    float a = 0.0;
    for (int i = 0; i < ${COUNT}; i++) {
      float d = length(p - uStops[i]);
      float on = float(i) == uActive ? 1.0 : 0.4;
      a += on * (ring(d, ${STOP_RADIUS.toFixed(1)}) * 0.8 + exp(-d * d / 90.0) * 0.08);
      if (i == 0) a += on * 0.45 * (ring(d, 14.0) + ring(d, 18.0));
    }
    return a;
  }
  // Light the car throws on the ground: amber underglow beneath it and a red
  // pool behind the taillights that brightens under braking.
  vec3 carGlow(vec2 p) {
    vec2 d = p - (uCar - uDir * 2.0); // uCar is the nose; step back to the middle
    float along = dot(d, uDir);
    float side = d.x * uDir.y - d.y * uDir.x;
    float under = exp(-(along * along / 7.0 + side * side / 1.6));
    vec2 t = d + uDir * 2.9;
    float tail = exp(-dot(t, t) / 1.8);
    return AMBER * under * 0.9 + vec3(0.95, 0.07, 0.05) * tail * (0.22 + 0.4 * uBrake);
  }
  vec3 fogged(vec3 col) {
    return mix(col, GROUND, smoothstep(110.0, 250.0, length(vP - cameraPosition)));
  }
`
const VERT = /* glsl */ `
  varying vec3 vP;
  varying vec2 vUv;
  void main() {
    vec4 world = modelMatrix * vec4(position, 1.0);
    vP = world.xyz;
    vUv = uv;
    gl_Position = projectionMatrix * viewMatrix * world;
  }
`
const ROAD_VERT = /* glsl */ `
  attribute float aLine;
  attribute vec2 aTan;
  varying vec3 vP;
  varying vec2 vUv;
  varying float vLine;
  varying vec2 vTan;
  void main() {
    vP = position;
    vUv = uv;
    vLine = aLine;
    vTan = aTan;
    gl_Position = projectionMatrix * viewMatrix * vec4(position, 1.0);
  }
`
const GROUND_FRAG = /* glsl */ `
  ${COMMON}
  void main() {
    float L = headlight(vP.xz);

    // Contour line every 0.25 of height, heavier every fifth.
    float v = vP.y / 0.25;
    float fw = fwidth(v);
    float d = abs(fract(v - 0.5) - 0.5) / max(fw, 0.0001);
    float major = step(mod(floor(v + 0.5), 5.0), 0.5);
    float w = mix(0.55, 1.05, major);
    float contour = (1.0 - smoothstep(w - 0.5, w + 0.5, d)) * clamp(1.2 - fw * 1.6, 0.0, 1.0);

    // Faint coordinate grid.
    vec2 g = vP.xz / 20.0;
    vec2 gd = abs(fract(g - 0.5) - 0.5) / max(fwidth(g), vec2(0.0001));
    float grid = 1.0 - smoothstep(0.3, 0.9, min(gd.x, gd.y));

    vec3 col = GROUND + vec3(1.0, 0.92, 0.78) * L * 0.08;
    col = mix(col, LINE * 0.8, grid * (0.3 + 0.5 * L));
    col = mix(col, mix(LINE * (0.8 + 0.45 * major), BRIGHT, L), contour);
    col += AMBER * stops(vP.xz) + carGlow(vP.xz);
    gl_FragColor = vec4(fogged(col), 1.0);
  }
`
const ROAD_FRAG = /* glsl */ `
  ${COMMON}
  uniform float uTime;
  uniform vec3 uRoute; // from, to (arc length along this road), on
  uniform float uLen;
  varying vec2 vUv;
  varying float vLine;
  varying vec2 vTan;
  void main() {
    float L = headlight(vP.xz);
    float edge = step(vUv.x, 0.028) + step(0.972, vUv.x);
    vec3 col = ROAD + vec3(1.0, 0.92, 0.78) * L * 0.14;
    col = mix(col, mix(LINE * 1.6, BRIGHT * 1.1, L), edge);

    // Racing line: amber dashes that cut to the inside of each corner and
    // run in whichever direction the car is facing. Bright near the car, faint beyond.
    float across = abs(vUv.x - vLine);
    float aa = fwidth(vUv.x) * 1.2;
    float body = 1.0 - smoothstep(0.009, 0.009 + aa, across);
    float way = dot(vTan, uDir) < 0.0 ? -1.0 : 1.0;
    float dashes = step(fract(vUv.y / 3.2 - way * uTime * 1.1), 0.55);
    float near = exp(-length(vP.xz - uCar) / 38.0);
    // The way to the next stop is lit; the rest of the line fades back.
    float span = mod(uRoute.y - uRoute.x, uLen);
    float route = uRoute.z * step(mod(vUv.y - uRoute.x, uLen), span);
    float lit = mix(uRoute.z > 0.5 ? 0.35 : 1.0, 1.35, route);
    col += AMBER * body * dashes * (0.10 + 0.65 * near) * lit;
    col += AMBER * body * route * 0.05; // a faint unbroken thread between the dashes
    col += AMBER * stops(vP.xz) + carGlow(vP.xz);
    // Under braking the taillights catch the road surface in a long red streak.
    vec2 bd = vP.xz - (uCar - uDir * 2.0);
    float bAlong = dot(bd, uDir) + 6.0;
    float bSide = bd.x * uDir.y - bd.y * uDir.x;
    col += vec3(0.95, 0.09, 0.06) * exp(-(bAlong * bAlong / 26.0 + bSide * bSide / 1.1)) * uBrake * 0.2;
    gl_FragColor = vec4(fogged(col), 1.0);
  }
`
const BEAM_FRAG = /* glsl */ `
  uniform float uOn;
  uniform float uGain;
  varying vec2 vUv;
  void main() {
    float a = pow(1.0 - vUv.y, 1.7) * mix(0.4, 1.0, uOn) * uGain;
    gl_FragColor = vec4(vec3(0.910, 0.639, 0.239) * a, 1.0);
  }
`

// ---------- world building ----------
const toCurve = (pts, closed) =>
  new THREE.CatmullRomCurve3(pts.map(([x, z]) => new THREE.Vector3(x, 0, z)), closed, 'centripetal')

function ribbon(curve, lift, samples) {
  const n = Math.ceil(curve.getLength() / 1.5)
  const across = 4
  const len = curve.getLength()
  const pts = curve.getSpacedPoints(n)
  const pos = []
  const uv = []
  const idx = []
  const line = []
  const tan = []
  const tans = pts.map((_, i) => curve.getTangentAt(i / n))

  // Where the racing line sits across the road (0..1): pulled toward the inside
  // of each bend, then smoothed so it drifts out wide between corners.
  const raw = tans.map((t, i) => {
    const a = tans[Math.max(0, i - 1)]
    const b = tans[Math.min(n, i + 1)]
    const bend = ((b.x - a.x) * t.z - (b.z - a.z) * t.x) / (2 * (len / n))
    return THREE.MathUtils.clamp(bend * 9, -0.3, 0.3)
  })
  const at = (i) => (curve.closed ? raw[((i % n) + n) % n] : raw[Math.min(n, Math.max(0, i))])
  const offset = raw.map((_, i) => {
    let sum = 0
    for (let k = -10; k <= 10; k++) sum += at(i + k)
    return sum / 21
  })

  for (let i = 0; i <= n; i++) {
    const p = pts[i]
    const t = tans[i]
    samples.push([p.x, p.z])
    for (let j = 0; j <= across; j++) {
      const u = j / across
      const x = p.x + t.z * (u - 0.5) * ROAD_WIDTH
      const z = p.z - t.x * (u - 0.5) * ROAD_WIDTH
      pos.push(x, height(x, z) + lift, z)
      uv.push(u, (i / n) * len)
      line.push(0.5 + offset[i])
      tan.push(t.x, t.z)
    }
    if (i < n) {
      for (let j = 0; j < across; j++) {
        const a = i * (across + 1) + j
        const b = a + across + 1
        idx.push(a, a + 1, b, b, a + 1, b + 1)
      }
    }
  }
  const geo = new THREE.BufferGeometry()
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2))
  geo.setAttribute('aLine', new THREE.Float32BufferAttribute(line, 1))
  geo.setAttribute('aTan', new THREE.Float32BufferAttribute(tan, 2))
  geo.setIndex(idx)
  return geo
}

export function createDrive({ reduced }) {
  const audio = createAudio()
  const soundBtn = document.getElementById('sound')
  const showSound = () => {
    soundBtn.textContent = audio.on ? 'Sound on' : 'Sound off'
    soundBtn.setAttribute('aria-pressed', String(audio.on))
  }
  showSound()
  soundBtn.addEventListener('click', () => {
    audio.setOn(!audio.on)
    showSound()
  })
  const canvas = $('scene')
  const stage = $('stage')
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' })
  let pixelRatio = Math.min(devicePixelRatio, 2)
  renderer.setPixelRatio(pixelRatio)

  const scene = new THREE.Scene()
  scene.background = new THREE.Color(BG)
  scene.fog = new THREE.Fog(BG, 110, 250)
  const camera = new THREE.PerspectiveCamera(36, 1, 0.5, 600)

  scene.add(new THREE.HemisphereLight(0xaab3c5, 0x1a1c20, 0.35))
  const moon = new THREE.DirectionalLight(0xdfe6ff, 0.5)
  moon.position.set(30, 60, -20)
  scene.add(moon)

  const stopList = projects.map((p) => ({ ...STOPS[p.id], id: p.id }))
  const uniforms = {
    uCar: { value: new THREE.Vector2() },
    uDir: { value: new THREE.Vector2(0, 1) },
    uStops: { value: stopList.map((s) => new THREE.Vector2(...s.pos)) },
    uActive: { value: -1 },
    uTime: { value: 0 },
    uBrake: { value: 0 },
  }

  // Ground
  const groundGeo = new THREE.PlaneGeometry(400, 400, 230, 230)
  groundGeo.rotateX(-Math.PI / 2)
  const gp = groundGeo.attributes.position
  for (let i = 0; i < gp.count; i++) gp.setY(i, height(gp.getX(i), gp.getZ(i)))
  scene.add(new THREE.Mesh(groundGeo, new THREE.ShaderMaterial({ uniforms, vertexShader: VERT, fragmentShader: GROUND_FRAG })))

  // Road
  const roadMat = (len) =>
    new THREE.ShaderMaterial({
      uniforms: { ...uniforms, uRoute: { value: new THREE.Vector3() }, uLen: { value: len } },
      vertexShader: ROAD_VERT, fragmentShader: ROAD_FRAG,
      side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
    })
  const loopPts = []
  const spurPts = []
  const loopCurve = toCurve(LOOP, true)
  const spurCurve = toCurve(SPUR, false)
  const loopMat = roadMat(loopCurve.getLength())
  const spurMat = roadMat(spurCurve.getLength() + 1) // +1: the spur never wraps
  scene.add(new THREE.Mesh(ribbon(loopCurve, 0.14, loopPts), loopMat))
  scene.add(new THREE.Mesh(ribbon(spurCurve, 0.17, spurPts), spurMat))
  const roadPts = [...loopPts, ...spurPts]
  const routes = createRoutes(loopPts, spurPts, loopCurve.getLength(), spurCurve.getLength())
  const stopLoc = stopList.map((st) => routes.locate(...st.pos))

  // Set dressing
  const studScale = createStuds(scene, [{ curve: loopCurve, skipStart: 0 }, { curve: spurCurve, skipStart: 9 }], uniforms)
  const gates = createGates(scene, stopList.map((st) => ({ x: st.pos[0], z: st.pos[1], heading: roadHeading(...st.pos) })))
  createMist(scene, uniforms)

  // Marker beams and their labels
  const beamGeo = new THREE.CylinderGeometry(0.2, 0.2, 46, 8, 1, true)
  beamGeo.translate(0, 23, 0)
  const haloGeo = new THREE.CylinderGeometry(0.7, 0.7, 46, 12, 1, true)
  haloGeo.translate(0, 23, 0)
  const labelBox = $('labels')
  const markers = stopList.map((s, i) => {
    const on = { value: 0 }
    const mat = (gain) =>
      new THREE.ShaderMaterial({
        uniforms: { uOn: on, uGain: { value: gain } },
        vertexShader: VERT, fragmentShader: BEAM_FRAG,
        transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide,
      })
    const [bx, bz] = s.beam
    const y = height(bx, bz)
    const beam = new THREE.Mesh(beamGeo, mat(1))
    const halo = new THREE.Mesh(haloGeo, mat(0.14))
    beam.position.set(bx, y, bz)
    halo.position.copy(beam.position)
    scene.add(beam, halo)
    const el = document.createElement('span')
    el.innerHTML = `<b>${num(i)}</b>${projects[i].title}`
    labelBox.append(el)
    return { on, el, anchor: new THREE.Vector3(bx, y + 6.5, bz) }
  })

  // Car
  const parts = createCar()
  const { car, wheels } = parts
  scene.add(car)
  // Reflections for the paint: a black room with three strip lights. The body
  // stays black and only picks up thin highlights along its edges.
  const studio = new THREE.Scene()
  const strip = (w, h, d, x, y, z, v) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), new THREE.MeshBasicMaterial({ color: new THREE.Color(v, v, v) }))
    m.position.set(x, y, z)
    studio.add(m)
  }
  strip(1.0, 0.1, 16, 0, 6, 0, 5)
  strip(0.1, 0.5, 12, -8, 2.2, 0, 2.5)
  strip(0.1, 0.5, 12, 8, 2.2, 0, 2.5)
  const pmrem = new THREE.PMREMGenerator(renderer)
  scene.environment = pmrem.fromScene(studio, 0.02).texture
  pmrem.dispose()
  loadModel(parts).then((api) => (parts.api = api)).catch((err) => console.warn('Car model did not load; keeping the stand-in.', err))
  const state = {
    x: START.x, z: START.z, th: START.heading, vx: 0, vz: 0, vf: 0, vl: 0,
    w: 0, // yaw rate
    drift: false, launch: 0, skid: 0, steer: 0, lean: 0, dip: 0, camTh: START.heading,
    hand: false, braking: 0, throttle: 0, gear: 1, rpm: IDLE, shift: 0, corner: 0, off: false,
  }
  const effects = createFx(scene)

  // ---------- minimap ----------
  const mapEl = $('map')
  const path = (pts) => pts.map(([x, z], i) => `${i ? 'L' : 'M'}${x.toFixed(1)} ${z.toFixed(1)}`).join('')
  const TRAIL = 80 // samples, one every quarter second: the last 20 seconds
  mapEl.innerHTML = `<svg viewBox="-125 -125 250 250" role="group">
    <g class="world">
    <path class="road" d="${path(loopPts)}Z"/><path class="road" d="${path(spurPts)}"/>
    <g class="trail">${'<line/>'.repeat(TRAIL - 1)}</g>
    ${stopList
      .map(
        (s, i) => `<g class="stop" data-i="${i}" role="button" tabindex="0" aria-label="Go to ${projects[i].title}">
        <circle class="hit" cx="${s.pos[0]}" cy="${s.pos[1]}" r="20"/><circle class="dot" cx="${s.pos[0]}" cy="${s.pos[1]}" r="7"/>
        <text class="lbl" x="${s.pos[0] - 13}" y="${s.pos[1] + 6}" text-anchor="end">${num(i)} ${projects[i].title}</text></g>`,
      )
      .join('')}
    <path class="car" d="M0 11 L6 -7 L0 -3 L-6 -7Z"/>
    </g>
  </svg>`
  const mapWorld = mapEl.querySelector('.world')
  const mapCar = mapEl.querySelector('.car')
  const mapStops = [...mapEl.querySelectorAll('.stop')]
  const mapLabels = [...mapEl.querySelectorAll('.lbl')]
  const trailLines = [...mapEl.querySelectorAll('.trail line')]
  const trail = [] // [x, z] samples, newest last
  let trailTimer = 0

  // ---------- progress ----------
  // Which stops this visitor has pulled up at. Kept in the browser so a
  // returning visitor picks up where they left off; works without it too.
  const STORE = 'mm-visited'
  const visited = new Set()
  try {
    for (const id of JSON.parse(localStorage.getItem(STORE) || '[]')) {
      const i = projects.findIndex((p) => p.id === id)
      if (i >= 0) visited.add(i)
    }
  } catch {}
  let lastSeen = -1 // most recent stop reached, so "next" follows on from it
  const allSeen = () => visited.size === COUNT
  const progressEl = $('progress')
  const guide = $('guide')
  guide.innerHTML = `<svg class="arrow" viewBox="-8 -8 16 16" aria-hidden="true"><path d="M0 -6 L5 4 L0 1.5 L-5 4Z"/></svg><span class="text"></span><button type="button" class="go"></button>`
  const guideArrow = guide.querySelector('.arrow')
  const guideText = guide.querySelector('.text')
  const guideGo = guide.querySelector('.go')
  let unlockedNote = 0 // seconds left on the "drift unlocked" note

  function markSeen(i) {
    lastSeen = i
    if (visited.has(i)) return
    visited.add(i)
    try {
      localStorage.setItem(STORE, JSON.stringify([...visited].map((k) => projects[k].id)))
    } catch {}
    if (allSeen()) {
      unlockedNote = 8
      audio.fanfare()
    }
    showProgress()
  }
  function showProgress() {
    progressEl.textContent = `${visited.size} / ${COUNT} seen`
    mapStops.forEach((g, i) => g.classList.toggle('seen', visited.has(i)))
  }
  showProgress()

  // The next stop to suggest: the first one not yet seen, counting on from
  // the last stop reached. Once all are seen, simply the one after it.
  function nextStop(from = lastSeen) {
    for (let s = 1; s <= COUNT; s++) {
      const i = (((from + s) % COUNT) + COUNT) % COUNT
      if (!visited.has(i)) return i
    }
    return from < 0 ? 0 : (from + 1) % COUNT
  }

  // ---------- input ----------
  const keys = new Set()
  const touch = { steer: 0, gas: false, brake: false, id: null, x0: 0 }
  // Self-driving: { i, path, k } follows the road to stop i; { i } with no
  // path just rolls the last few metres into a stop the car is coasting toward.
  let auto = null
  let glided = -1 // stop the car last glided into, so it doesn't pull in again
  const hint = $('hint')
  const coarse = matchMedia('(pointer: coarse)').matches
  hint.textContent = coarse
    ? 'Drag on the left to steer. Pedals on the right.'
    : 'WASD or arrow keys to drive. Lift off near a light to pull in.'
  const touched = () => {
    auto = null
    hint.classList.add('gone')
  }

  const DRIVE_KEYS = ['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space']
  addEventListener('keydown', (e) => {
    if (!running || e.metaKey || e.ctrlKey || e.altKey) return
    if (DRIVE_KEYS.includes(e.code)) {
      if (e.code === 'Space' && e.target.closest?.('a, button, [role=button]')) return
      keys.add(e.code)
      touched()
      e.preventDefault()
    } else if (e.code === 'KeyM') {
      soundBtn.click()
    } else if (e.code === 'Escape') {
      closePanel(true)
    } else if (e.code === 'Enter' && !e.target.closest?.('a, button, [role=button]') && active >= 0) {
      panelOpen ? closePanel(true) : openPanel(active)
    }
  })
  addEventListener('keyup', (e) => keys.delete(e.code))
  addEventListener('blur', () => keys.clear())

  canvas.addEventListener('pointerdown', (e) => {
    if (touch.id !== null) return
    touch.id = e.pointerId
    touch.x0 = e.clientX
    canvas.setPointerCapture(e.pointerId)
    touched()
  })
  canvas.addEventListener('pointermove', (e) => {
    if (e.pointerId === touch.id) touch.steer = THREE.MathUtils.clamp((touch.x0 - e.clientX) / 60, -1, 1)
  })
  const release = (e) => {
    if (e.pointerId !== touch.id) return
    touch.id = null
    touch.steer = 0
  }
  canvas.addEventListener('pointerup', release)
  canvas.addEventListener('pointercancel', release)

  for (const name of ['gas', 'brake']) {
    const b = $(name)
    const set = (v) => (e) => {
      e.preventDefault()
      touch[name] = v
      b.classList.toggle('down', v)
      if (v) touched()
    }
    b.addEventListener('pointerdown', set(true))
    b.addEventListener('pointerup', set(false))
    b.addEventListener('pointercancel', set(false))
    b.addEventListener('pointerleave', set(false))
  }

  // Direction of the road at a point: along the loop in driving order, or
  // out along the spur.
  function roadHeading(x, z) {
    let best = Infinity
    let pts = loopPts
    let at = 0
    for (const list of [loopPts, spurPts]) {
      list.forEach(([px, pz], k) => {
        const d = (px - x) ** 2 + (pz - z) ** 2
        if (d < best) [best, pts, at] = [d, list, k]
      })
    }
    const a = pts[Math.max(0, at - 1)]
    const b = pts[Math.min(pts.length - 1, at + 1)]
    return Math.atan2(b[0] - a[0], b[1] - a[1])
  }

  const goTo = (i) => {
    audio.click()
    hint.classList.add('gone')
    dismissed = -1
    if (reduced) {
      // No animated trip: cut straight to the stop.
      // Park at the stop facing along the road, in the direction of travel.
      const [x, z] = stopList[i].pos
      const th = roadHeading(x, z)
      Object.assign(state, { x, z, th, vx: 0, vz: 0, vf: 0, vl: 0, w: 0, drift: false })
      state.camTh = state.th
      auto = null
      snapCamera = true
    } else {
      const r = routes.between(routes.locate(state.x, state.z), stopLoc[i])
      auto = { i, path: r.pts, k: 0 }
    }
  }
  guideGo.addEventListener('click', () => goTo(nextStop()))
  mapStops.forEach((g) => {
    const i = +g.dataset.i
    g.addEventListener('click', () => goTo(i))
    g.addEventListener('keydown', (e) => {
      if (e.code === 'Enter' || e.code === 'Space') {
        e.preventDefault()
        e.stopPropagation()
        goTo(i)
      }
    })
  })

  // On narrow screens the panel is a bottom sheet, so slide the view up to keep the car in sight.
  function frameCar() {
    const w = stage.clientWidth
    const h = stage.clientHeight
    if (panelOpen && w <= 720) camera.setViewOffset(w, h, 0, h * 0.24, w, h)
    else camera.clearViewOffset()
  }

  // ---------- panel ----------
  const panel = $('panel')
  let active = -1
  let dismissed = -1
  let panelOpen = false
  function openPanel(i) {
    const n = nextStop(i)
    panel.innerHTML =
      panelHtml(projects[i], i, projects.length) +
      `<button type="button" class="next mono">Next stop · ${num(n)} ${projects[n].title} →</button>`
    panel.querySelector('.next').addEventListener('click', () => {
      closePanel(true)
      goTo(n)
    })
    panel.hidden = false
    panel.scrollTop = 0
    panelOpen = true
    root.classList.add('panel-open')
    audio.arrive()
    audio.dim(true)
    frameCar()
  }
  function closePanel(byUser) {
    if (byUser && active >= 0) dismissed = active
    panel.hidden = true
    panelOpen = false
    root.classList.remove('panel-open')
    audio.dim(false)
    frameCar()
  }

  // ---------- simulation ----------
  const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a))
  function offRoad(x, z) {
    let best = Infinity
    for (const [px, pz] of roadPts) best = Math.min(best, (px - x) ** 2 + (pz - z) ** 2)
    return best > (ROAD_WIDTH * 0.5 + 0.8) ** 2
  }

  // ---------- lane keeping ----------
  // A quiet steering assist. It looks a little way down the road and steers
  // for that point, holding whatever line across the road the driver has
  // chosen, and only pulls back near the edges. The driver's own steering is
  // added on top. Holding full lock toward the edge for 1.2 s is read as
  // meaning it: the assist lets go and the car can leave the road. It takes
  // over again once the car is back on the tarmac, or when the driver lets go
  // of the wheel for two seconds within reach of the road.
  const lane = { a: 0, push: 0, idle: 0, override: false, cap: Infinity }
  if (import.meta.env.DEV) window.__drive = { state, lane, keys, offRoad: (x, z) => offRoad(x, z), tick: (dt) => (step(dt), place(dt)) }
  const LANE_EDGE = ROAD_WIDTH / 2 - 1.1 // furthest the held line may sit from the centre
  function nearestRoad(x, z) {
    let best = Infinity
    let pts = loopPts
    let k = 0
    for (const list of [loopPts, spurPts]) {
      for (let i = 0; i < list.length; i++) {
        const d = (list[i][0] - x) ** 2 + (list[i][1] - z) ** 2
        if (d < best) [best, pts, k] = [d, list, i]
      }
    }
    return { pts, k, dist: Math.sqrt(best) }
  }
  function sample(pts, k) {
    if (pts === loopPts) {
      const n = loopPts.length - 1 // the last sample repeats the first
      return pts[((k % n) + n) % n]
    }
    return pts[THREE.MathUtils.clamp(k, 0, pts.length - 1)]
  }
  function keepLane(driver, dt, hand) {
    const v = state.vf
    const road = nearestRoad(state.x, state.z)
    const { pts, k } = road
    // Road direction here, as sample order; and which way along it we face.
    const a = sample(pts, k - 1)
    const b = sample(pts, k + 1)
    let tx = b[0] - a[0]
    let tz = b[1] - a[1]
    const tl = Math.hypot(tx, tz) || 1
    tx /= tl
    tz /= tl
    const dir = tx * Math.sin(state.th) + tz * Math.cos(state.th) >= 0 ? 1 : -1
    // Signed offset from the centre line, kept inside the edges.
    const c = pts[k]
    const off = (state.x - c[0]) * tz - (state.z - c[1]) * tx
    const hold = THREE.MathUtils.clamp(off, -LANE_EDGE, LANE_EDGE) * 0.8 // drifts gently back toward the middle
    // Aim point: the same line, further down the road the faster we go.
    const steps = Math.round((5 + Math.abs(v) * 0.28) / 1.5) // short, so it doesn't cut the inside of bends
    const p = sample(pts, k + dir * steps)
    const q = sample(pts, k + dir * (steps + 1))
    let ux = q[0] - p[0]
    let uz = q[1] - p[1]
    const ul = Math.hypot(ux, uz) || 1
    ux = (ux / ul) * dir
    uz = (uz / ul) * dir
    // Same side-vector convention as `off`, flipped back for direction of travel.
    const ax = p[0] + uz * hold * dir
    const az = p[1] - ux * hold * dir
    // Steer by where the car is actually going, not where its nose points, so a
    // car sliding wide in a fast bend is still brought round.
    const sp = Math.hypot(state.vx, state.vz)
    const course = sp > 4 && v > 0 ? Math.atan2(state.vx, state.vz) : state.th
    const assist = THREE.MathUtils.clamp(wrap(Math.atan2(ax - state.x, az - state.z) - course) * 2.6, -1, 1)

    // Does the driver mean to leave? Full lock against the assist, at the edge.
    const edge = THREE.MathUtils.smoothstep(Math.abs(off), LANE_EDGE - 2.5, LANE_EDGE + 0.5)
    const atEdge = edge > 0.2
    // Positive steer moves the car toward +off when facing along the samples
    // (dir 1), so `excess` is how much harder than the assist the driver is
    // steering toward the nearer edge.
    const excess = (driver - assist) * Math.sign(off) * dir
    const fighting = Math.abs(driver) > 0.85 && excess > 0.5
    lane.push = atEdge && fighting ? lane.push + dt : 0 // must be one unbroken hold
    if (lane.push > 1.2) lane.override = true
    // Let go of the wheel for two seconds near the road and it guides you back.
    lane.idle = Math.abs(driver) < 0.1 ? lane.idle + dt : 0
    if (lane.override && lane.idle > 2 && road.dist < ROAD_WIDTH / 2 + 14) lane.override = false
    const onRoad = road.dist < ROAD_WIDTH / 2 - 0.4
    if (lane.override && onRoad && Math.abs(off) < LANE_EDGE - 0.8 && Math.abs(driver) < 0.5) lane.override = false

    // How much help to give: none at a crawl, in reverse, when overridden or
    // well off the road; less while drifting, so slides stay the driver's.
    let want = THREE.MathUtils.smoothstep(v, 3, 9)
    if (!onRoad && v > 0.5) want = Math.max(want, 0.8) // crawling back out of a ditch
    if (lane.override || road.dist > ROAD_WIDTH / 2 + 14) want = 0
    if (state.drift || hand) want *= 0.3
    lane.a += (want - lane.a) * Math.min(1, dt * (want > lane.a ? 3 : 6))

    // Corner speed: for each bend in the next 80 m, the fastest the car can
    // take it (the yaw rate it needs, v·κ, against what the steering gives, with
    // a margin), and from that the fastest it can be going now and still slow
    // down in time. Over that, lift; well over, brake.
    lane.cap = Infinity
    if (lane.a > 0.3 && !state.drift && v > 10) {
      const span = 54
      const heads = []
      let prev = null
      for (let i = 0; i <= span; i++) {
        const p0 = sample(pts, k + dir * i)
        const p1 = sample(pts, k + dir * (i + 1))
        const h = Math.atan2(p1[0] - p0[0], p1[1] - p0[1])
        if (prev !== null) heads.push(Math.abs(wrap(h - prev)))
        prev = h
      }
      for (let i = 0; i + 4 <= heads.length; i++) {
        const kappa = (heads[i] + heads[i + 1] + heads[i + 2] + heads[i + 3]) / 6
        const corner = 1.3 / (kappa + 0.013)
        lane.cap = Math.min(lane.cap, Math.sqrt(corner * corner + 2 * 11 * i * 1.5))
      }
    }
    // Near the edge, steering that pushes outward against the assist counts
    // for less (until it has been held long enough to be an override). Taps
    // at speed then can't throw the car off the road.
    const outward = excess > 0.1
    const scale = (1 - 0.45 * lane.a) * (outward ? 1 - 0.85 * edge * lane.a * (1 - Math.min(1, lane.push / 1.2)) : 1) * (1 - 0.4 * lane.a * THREE.MathUtils.smoothstep(v, 15, 40))
    return driver * scale + assist * lane.a
  }

  function step(dt) {
    let throttle = keys.has('KeyW') || keys.has('ArrowUp') || touch.gas ? 1 : 0
    let brake = keys.has('KeyS') || keys.has('ArrowDown') || touch.brake ? 1 : 0
    const hand = keys.has('Space') && allSeen() // drifting is the reward for seeing every stop
    let steer =
      (keys.has('KeyA') || keys.has('ArrowLeft') ? 1 : 0) - (keys.has('KeyD') || keys.has('ArrowRight') ? 1 : 0) + touch.steer

    if (auto?.path) {
      // Follow the road: aim at a point a little way ahead along the route.
      const { path } = auto
      let best = Infinity
      for (let k = auto.k; k < Math.min(path.length, auto.k + 25); k++) {
        const d = (path[k][0] - state.x) ** 2 + (path[k][1] - state.z) ** 2
        if (d < best) [best, auto.k] = [d, k]
      }
      const ahead = path[Math.min(path.length - 1, auto.k + 4 + Math.round(Math.abs(state.vf) * 0.25))]
      const left = (path.length - 1 - auto.k) * 1.5
      steer = THREE.MathUtils.clamp(wrap(Math.atan2(ahead[0] - state.x, ahead[1] - state.z) - state.th) * 2.2, -1, 1)
      const cruise = left > 40 ? 22 : Math.max(4, left * 0.55)
      throttle = state.vf < cruise ? 1 : 0
      brake = state.vf > cruise + 3 ? 1 : 0
      if (left < 4) {
        throttle = 0
        brake = state.vf > 0.5 ? 1 : 0
        if (state.vf <= 0.5) auto = null
      }
    } else if (auto) {
      // Gliding in: roll to a stop at the light.
      const [tx, tz] = stopList[auto.i].pos
      const dx = tx - state.x
      const dz = tz - state.z
      const dist = Math.hypot(dx, dz)
      steer = THREE.MathUtils.clamp(wrap(Math.atan2(dx, dz) - state.th) * 2.2, -1, 1)
      throttle = 0
      const want = Math.max(2.5, dist * 0.7)
      brake = state.vf > want ? 1 : 0
      if (dist < 4 || state.vf <= 0.4) auto = null
    } else if (!throttle && !brake && state.vf > 2 && state.vf < 24) {
      // Coasting toward a stop that is close and ahead: pull in on our own.
      const fx = Math.sin(state.th)
      const fz = Math.cos(state.th)
      stopList.forEach((st, i) => {
        if (auto || i === glided) return
        const dx = st.pos[0] - state.x
        const dz = st.pos[1] - state.z
        const dist = Math.hypot(dx, dz)
        if (dist > 4 && dist < 26 && (dx * fx + dz * fz) / dist > 0.55) {
          auto = { i }
          glided = i
        }
      })
    }
    if (glided >= 0 && Math.hypot(stopList[glided].pos[0] - state.x, stopList[glided].pos[1] - state.z) > 34) glided = -1
    let assistBrake = false
    if (!auto) {
      steer = keepLane(steer, dt, hand)
      if (state.vf > lane.cap) throttle = 0
      assistBrake = state.vf > lane.cap + 3
    }
    steer = THREE.MathUtils.clamp(steer, -1, 1)

    // Split velocity into along-the-car and sideways parts.
    const fx = Math.sin(state.th)
    const fz = Math.cos(state.th)
    let vf = state.vx * fx + state.vz * fz
    let vl = state.vx * fz - state.vz * fx

    // Drifting: the handbrake, or braking hard into a turn, breaks the rear
    // loose. Sideways grip then drops and the car turns faster than it travels,
    // so it slides. Counter-steer and throttle hold the slide; it ends once the
    // car is pointing where it is going again.
    if (!state.drift && vf > 9 && (hand || (allSeen() && brake && Math.abs(steer) > 0.5 && vf > 16))) {
      state.drift = true
      state.w += steer * 0.45 // the kick that starts the slide
    }
    if (state.drift && ((!hand && Math.abs(vl) < 1.1) || vf < 4)) state.drift = false

    // Wheelspin when pulling away hard from a near stop.
    if (throttle && !state.throttle && vf < 3) state.launch = 0.7
    if (!throttle && state.throttle && vf > 20 && !reduced) (parts.api?.pop(), audio.pop()) // lift-off crackle
    state.launch = Math.max(0, state.launch - dt)
    state.throttle = throttle

    if (assistBrake) vf -= 12 * dt // the assist trimming speed for a bend
    if (throttle && !state.shift) vf += (state.drift ? 12 : 17) * dt * (state.launch > 0 ? 0.8 : 1)
    if (brake) vf -= (vf > 0.5 ? 34 : 9) * dt
    if (hand) vf -= Math.sign(vf) * Math.min(Math.abs(vf), 10 * dt)
    const off = offRoad(state.x, state.z)
    state.off = off
    vf -= vf * (off ? 1.1 : 0.3) * dt
    vf = THREE.MathUtils.clamp(vf, -9, TOP)
    const scrub = state.drift ? (hand ? 1.2 : throttle ? 0.9 : 1.7) : 6.5
    vl *= Math.exp(-scrub * dt) // tyres scrub off sideways speed
    vl = THREE.MathUtils.clamp(vl, -0.75 * Math.abs(vf) - 1, 0.75 * Math.abs(vf) + 1) // no spinning out

    state.vx = fx * vf + fz * vl
    state.vz = fz * vf - fx * vl

    // Slopes push back, which is what keeps the car in the valley.
    const [gx, gz] = gradient(state.x, state.z)
    state.vx -= gx * 9 * dt
    state.vz -= gz * 9 * dt

    const grip = THREE.MathUtils.clamp(vf / 8, -1, 1)
    const yaw = steer * grip * (state.drift ? 2.1 : 2.0 - 1.0 * Math.min(1, Math.abs(vf) / TOP))
    state.w += (yaw - state.w) * Math.min(1, dt * (state.drift ? 3.5 : 12))
    state.th += state.w * dt
    state.x += state.vx * dt
    state.z += state.vz * dt
    const r = Math.hypot(state.x, state.z)
    if (r > WORLD_RADIUS) {
      state.x *= WORLD_RADIUS / r
      state.z *= WORLD_RADIUS / r
    }
    state.vf = vf
    state.vl = vl
    state.hand = hand
    state.steer += (steer - state.steer) * Math.min(1, dt * 10)
    state.braking = brake && vf > 0.5 ? 1 : 0

    // How hard the tyres are working, 0..1: smoke and marks follow this.
    const slide = Math.min(1, Math.max(0, Math.abs(vl) - 1.2) / 5)
    const lock = (brake && vf > 9 ? 0.55 : 0) + (hand && vf > 3 ? 0.7 : 0)
    const spin = state.launch > 0 && throttle ? 0.8 : 0
    state.skid = Math.min(1, Math.max(slide, lock, spin))
    state.corner = Math.abs(vf * state.w) // sideways load, m/s²

    // Gearbox. Changes up at the shift point under power (with a short torque
    // cut), down when the revs sag. The engine speed follows the wheels, except
    // pulling away in first, when the clutch slips and the revs run ahead.
    const v = Math.abs(vf)
    state.shift = Math.max(0, state.shift - dt)
    if (vf < -0.3) state.gear = -1
    else if (state.gear < 1) state.gear = 1
    if (state.gear > 0 && !state.shift) {
      const wheelRpm = v * RATIO[state.gear - 1]
      // Shift when the needle itself reaches the shift point, so it never changes early.
      if (state.gear < GEARS && state.rpm >= SHIFT_UP && wheelRpm > SHIFT_UP - 400 && (throttle || wheelRpm > REDLINE)) {
        state.gear++
        state.shift = 0.16
      } else if (state.gear > 1 && wheelRpm < SHIFT_DOWN) state.gear--
    }
    let target = v * RATIO[Math.abs(state.gear) - 1]
    if (throttle && Math.abs(state.gear) === 1) target = Math.max(target, 3000 + 200 * v)
    if (spin) target = Math.max(target, 6200) // wheelspin flare
    if (!throttle && v < 1) target = IDLE
    target = THREE.MathUtils.clamp(target, IDLE, REDLINE + 150)
    state.rpm += (target - state.rpm) * Math.min(1, dt * (state.shift ? 22 : 14))

    for (const w of wheels) {
      const front = w.userData.front
      let turn = vf * dt / 0.34
      if (!front && hand) turn = 0 // handbrake locks the rear
      else if (!front && (spin || (state.drift && throttle))) turn *= 2.2
      w.rotation.x += turn
      if (front) w.rotation.y = state.steer * 0.42
    }
  }

  // ---------- guide ----------
  // One line at the bottom: where the next stop is and how far by road,
  // with the road itself lit along the way.
  let guideKey = ''
  let routeTimer = 0
  let route = null
  function guideFrame(dt) {
    unlockedNote = Math.max(0, unlockedNote - dt)
    const done = allSeen()
    const target = auto ? auto.i : nextStop()
    // Re-plan the route a few times a second; it only changes as the car moves along.
    routeTimer -= dt
    if (routeTimer <= 0 || !route || route.target !== target) {
      routeTimer = 0.25
      route = { target, ...routes.between(routes.locate(state.x, state.z), stopLoc[target]) }
      const show = !done || auto
      loopMat.uniforms.uRoute.value.set(...(route.loop || [0, 0]), show && route.loop ? 1 : 0)
      spurMat.uniforms.uRoute.value.set(...(route.spur || [0, 0]), show && route.spur ? 1 : 0)
    }
    mapStops.forEach((g, i) => g.classList.toggle('next', i === target && (!done || !!auto)))

    let text
    let button = ''
    if (unlockedNote > 0) text = coarse ? 'All seven seen. Brake while turning to drift.' : 'All seven seen. Space to drift is unlocked.'
    else if (done && !auto) text = coarse ? 'All seven seen · brake while turning to drift' : 'All seven seen · space to drift'
    else {
      const m = Math.max(10, Math.round(route.length / 10) * 10)
      text = `${auto ? 'Driving to' : 'Next'} · ${num(target)} ${projects[target].title} · ${m} m`
      if (!auto) button = visited.size === 0 && lastSeen < 0 ? 'Take the tour' : 'Drive me there'
    }
    const key = text + button
    if (key !== guideKey) {
      guideKey = key
      guideText.textContent = text
      guideGo.textContent = button
      guideGo.hidden = !button
    }
    // Arrow: points at the stop relative to the way the car faces (up = ahead).
    const showArrow = !done || !!auto
    guideArrow.style.visibility = showArrow && unlockedNote <= 0 ? 'visible' : 'hidden'
    if (showArrow) {
      const [tx, tz] = stopList[target].pos
      const rel = wrap(Math.atan2(tx - state.x, tz - state.z) - state.th)
      guideArrow.style.transform = `rotate(${((-rel * 180) / Math.PI).toFixed(1)}deg)`
    }
  }

  // ---------- per-frame placement ----------
  const camTarget = new THREE.Vector3()
  const look = new THREE.Vector3()
  const tmp = new THREE.Vector3()
  let snapCamera = true
  let baseFov = 36
  let wide = 1

  // ---------- rev meter ----------
  // A small arc gauge to the left of the minimap: 0 to 8,000 rpm with the
  // redline marked, the gear in the middle and the speed under it. The gear
  // turns amber at the shift point.
  const tach = $('tach')
  {
    const A0 = 225 // degrees, at 0 rpm (measured clockwise from up, mirrored)
    const SWEEP = 270
    const pt = (rpm, r) => {
      const a = ((A0 - (rpm / 8000) * SWEEP) * Math.PI) / 180
      return [60 + r * Math.cos(a), 60 - r * Math.sin(a)]
    }
    const arc = (a, b, r) => {
      const [x0, y0] = pt(a, r)
      const [x1, y1] = pt(b, r)
      const large = ((b - a) / 8000) * SWEEP > 180 ? 1 : 0
      return `M${x0.toFixed(1)} ${y0.toFixed(1)}A${r} ${r} 0 ${large} 1 ${x1.toFixed(1)} ${y1.toFixed(1)}`
    }
    let ticks = ''
    for (let k = 0; k <= 8; k++) {
      const [x0, y0] = pt(k * 1000, 50)
      const [x1, y1] = pt(k * 1000, 43)
      const [lx, ly] = pt(k * 1000, 34)
      ticks += `<line x1="${x0.toFixed(1)}" y1="${y0.toFixed(1)}" x2="${x1.toFixed(1)}" y2="${y1.toFixed(1)}"/>`
      ticks += `<text x="${lx.toFixed(1)}" y="${(ly + 3).toFixed(1)}">${k}</text>`
    }
    tach.innerHTML = `<svg viewBox="0 0 120 120">
      <path class="track" d="${arc(0, 8000, 50)}"/>
      <path class="red" d="${arc(REDLINE - 500, 8000, 50)}"/>
      <g class="ticks">${ticks}</g>
      <line class="needle" x1="60" y1="60" x2="60" y2="14"/>
      <circle class="hub" cx="60" cy="60" r="3"/>
      <text class="gear" x="60" y="88">1</text>
      <text class="speed" x="60" y="104">0 km/h</text>
    </svg>`
  }
  const needle = tach.querySelector('.needle')
  const gearText = tach.querySelector('.gear')
  const speedText = tach.querySelector('.speed')
  let tachShown = ''
  function tachFrame() {
    const deg = -135 + (Math.min(state.rpm, 8000) / 8000) * 270
    needle.setAttribute('transform', `rotate(${deg.toFixed(1)} 60 60)`)
    const g = state.gear < 0 ? 'R' : String(state.gear)
    const kmh = Math.round(Math.abs(state.vf) * 3.6)
    const hot = state.rpm > SHIFT_UP - 300 && state.gear > 0 && state.gear < GEARS
    const key = g + kmh + hot
    if (key === tachShown) return
    tachShown = key
    gearText.textContent = g
    speedText.textContent = `${kmh} km/h`
    gearText.classList.toggle('hot', hot)
  }

  function place(dt) {
    const { x, z, th } = state
    const fx = Math.sin(th)
    const fz = Math.cos(th)
    const y = height(x, z)
    car.position.set(x, y, z)
    const pitch = -Math.atan2(height(x + fx * 1.4, z + fz * 1.4) - height(x - fx * 1.4, z - fz * 1.4), 2.8)
    const roll = Math.atan2(height(x + fz, z - fx) - height(x - fz, z + fx), 2)
    // Weight transfer: the body leans out of a slide and dips under braking.
    state.lean += (THREE.MathUtils.clamp(state.vl * 0.012 + state.w * state.vf * 0.0015, -0.07, 0.07) - state.lean) * Math.min(1, dt * 6)
    state.dip += ((state.braking ? 0.025 : state.throttle ? -0.012 : 0) - state.dip) * Math.min(1, dt * 6)
    car.rotation.set(pitch + state.dip, th, roll + state.lean)

    // Tyre smoke and skid marks from the rear wheels (all four when braking).
    car.updateMatrixWorld()
    const smoking = state.skid > 0.05
    for (let k = 0; k < wheels.length; k++) {
      const wh = wheels[k]
      const rear = !wh.userData.front
      tmp.set(wh.position.x, 0, wh.position.z).applyMatrix4(car.matrixWorld)
      const on = smoking && (rear || (state.braking && !state.drift))
      effects.mark(k, tmp, on)
      if (on && Math.random() < state.skid * (rear ? 1 : 0.4) * dt * 24) effects.puff(tmp, state.vx, state.vz)
    }

    uniforms.uCar.value.set(x + fx * 2, z + fz * 2)
    uniforms.uDir.value.set(fx, fz)
    uniforms.uBrake.value += (state.braking - uniforms.uBrake.value) * Math.min(1, dt * 12)
    parts.api?.tail(uniforms.uBrake.value)
    parts.api?.frame(dt, state.vf)
    tachFrame()

    // Which stop are we at? Leave radius is wider than enter radius so it doesn't flicker.
    let now = -1
    stopList.forEach((s, i) => {
      const d = Math.hypot(s.pos[0] - x, s.pos[1] - z)
      if (d < (i === active ? STOP_RADIUS + 3 : STOP_RADIUS)) now = i
    })
    if (now !== active) {
      active = now
      uniforms.uActive.value = now
      mapStops.forEach((g, i) => g.classList.toggle('on', i === now))
      if (now < 0) {
        dismissed = -1
        closePanel(false)
      } else {
        markSeen(now)
        glided = now // don't pull back into this stop when coasting away from it
        if (now !== dismissed) openPanel(now)
      }
    }
    guideFrame(dt)
    markers.forEach((m, i) => {
      m.on.value += ((i === active ? 1 : 0) - m.on.value) * Math.min(1, dt * 4)
      gates[i](m.on.value)
    })

    // Camera
    // Same chase view either way. With reduced motion the camera is locked to
    // the car: no swing on corners, no zoom at speed, no pull-out at a stop.
    if (!reduced) wide += ((projects[active]?.id === 'reels' ? 1.6 : 1) - wide) * Math.min(1, dt * 1.5)
    // A longer lens from further back: less wide-angle stretch on the car.
    // The camera follows a mix of where the car points and where it is going,
    // so a drift reads as a slide instead of the world swinging round.
    const speed = Math.hypot(state.vx, state.vz)
    const goTh = speed > 3 && state.vf > 0 ? Math.atan2(state.vx, state.vz) : th
    const camGoal = reduced ? th : th + wrap(goTh - th) * 0.6
    state.camTh = reduced || snapCamera ? camGoal : state.camTh + wrap(camGoal - state.camTh) * Math.min(1, dt * 4)
    const cx = Math.sin(state.camTh)
    const cz = Math.cos(state.camTh)
    camTarget.set(x - cx * 15.5 * wide, 0, z - cz * 15.5 * wide)
    camTarget.y = Math.max(y + 5.2 * wide, height(camTarget.x, camTarget.z) + 2)
    if (snapCamera || reduced) camera.position.copy(camTarget)
    else camera.position.lerp(camTarget, 1 - Math.exp(-dt * 3.2))
    look.set(x + cx * 5, y + 1.0, z + cz * 5)
    camera.lookAt(look)
    const fov = baseFov + (reduced ? 0 : 8 * Math.min(1, Math.abs(state.vf) / TOP))
    if (Math.abs(fov - camera.fov) > 0.05) {
      camera.fov = fov
      camera.updateProjectionMatrix()
    }
    snapCamera = false
    camera.updateMatrixWorld()

    // Labels and minimap
    const w = stage.clientWidth
    const h = stage.clientHeight
    for (const m of markers) {
      tmp.copy(m.anchor).project(camera)
      const dist = m.anchor.distanceTo(camera.position)
      const sy = (1 - tmp.y) * 0.5 * h
      const show = tmp.z < 1 && Math.abs(tmp.x) < 1.2 && dist < 190 && sy > 72 // stay clear of the header
      m.el.style.opacity = show ? Math.min(1, (190 - dist) / 60).toFixed(2) : 0
      if (show) m.el.style.transform = `translate(${((tmp.x + 1) * 0.5 * w + 8).toFixed(1)}px, ${sy.toFixed(1)}px)`
    }
    mapCar.setAttribute('transform', `translate(${x.toFixed(1)} ${z.toFixed(1)}) rotate(${((-th * 180) / Math.PI).toFixed(1)})`)

    // Heading-up: the map turns so the car always points up, and the labels
    // turn back so they stay level. Reduced motion keeps north up.
    if (!reduced) {
      const deg = -90 - (Math.atan2(Math.cos(state.camTh), Math.sin(state.camTh)) * 180) / Math.PI
      mapWorld.setAttribute('transform', `rotate(${deg.toFixed(1)})`)
      mapLabels.forEach((t, i) => t.setAttribute('transform', `rotate(${(-deg).toFixed(1)} ${stopList[i].pos[0]} ${stopList[i].pos[1]})`))
    }

    // Trail: where the car has been in the last 20 seconds, fading with age.
    trailTimer -= dt
    if (trailTimer <= 0) {
      trailTimer = 0.25
      const lastPt = trail[trail.length - 1]
      if (!lastPt || Math.hypot(lastPt[0] - x, lastPt[1] - z) > 0.5) trail.push([x, z])
      else trail.push(lastPt) // standing still: let the old trail age out
      if (trail.length > TRAIL) trail.shift()
      trailLines.forEach((ln, k) => {
        const a = trail[trail.length - 2 - k]
        const b = trail[trail.length - 1 - k]
        if (!a || (a[0] === b[0] && a[1] === b[1])) return ln.setAttribute('opacity', 0)
        ln.setAttribute('x1', a[0].toFixed(1))
        ln.setAttribute('y1', a[1].toFixed(1))
        ln.setAttribute('x2', b[0].toFixed(1))
        ln.setAttribute('y2', b[1].toFixed(1))
        ln.setAttribute('opacity', (0.75 * (1 - k / (TRAIL - 1))).toFixed(2))
      })
    }
  }

  // ---------- loop ----------
  function resize() {
    const w = stage.clientWidth
    const h = stage.clientHeight
    renderer.setSize(w, h, false)
    camera.aspect = w / h
    // Keep roughly the same sideways view on narrow, portrait screens.
    const rad = Math.PI / 180
    baseFov = THREE.MathUtils.clamp((2 * Math.atan(Math.tan(28 * rad) / camera.aspect)) / rad, 36, 58)
    camera.updateProjectionMatrix()
    frameCar()
  }
  addEventListener('resize', resize)

  let running = false
  let last = 0
  let raf = 0
  // Slow-device watchdog: two three-second windows after the drive starts.
  const watch = { t: 0, frames: 0, stage: 0 }

  function frame(now) {
    if (!running) return
    raf = requestAnimationFrame(frame)
    const dt = Math.min(0.05, (now - last) / 1000)
    last = now
    step(dt)
    place(dt)
    audio.drive(dt, { ...state, IDLE, REDLINE })
    effects.update(dt, camera, renderer.domElement.height)
    studScale.value = renderer.domElement.height / (2 * Math.tan((camera.fov * Math.PI) / 360))
    if (!reduced) uniforms.uTime.value += dt // the dashes stay still for reduced motion
    renderer.render(scene, camera)

    if (watch.stage < 2 && !document.hidden) {
      watch.t += dt
      watch.frames++
      if (watch.t >= 3) {
        const slow = watch.frames / watch.t < 30
        if (slow && watch.stage === 0 && pixelRatio > 1) {
          pixelRatio = 1
          renderer.setPixelRatio(1)
          resize()
          watch.stage = 1
        } else {
          if (slow) $('notice').hidden = false
          watch.stage = 2
        }
        watch.t = watch.frames = 0
      }
    }
  }

  return {
    start() {
      if (running) return
      running = true
      resize()
      snapCamera = true
      last = performance.now()
      raf = requestAnimationFrame(frame)
      audio.start()
    },
    stop() {
      running = false
      cancelAnimationFrame(raf)
      audio.stop()
      keys.clear()
      auto = null
      closePanel(false)
      active = -1 // so the panel reopens if the visitor comes back parked at a stop
    },
  }
}
