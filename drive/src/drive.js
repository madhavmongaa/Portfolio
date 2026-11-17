import * as THREE from 'three'
import { projects } from './data/projects.js'
import { panelHtml, num } from './ui/html.js'
import {
  STOPS, START, LOOP, SPUR, ROAD_WIDTH, STOP_RADIUS, WORLD_RADIUS, height, gradient,
} from './world/terrain.js'
import { createCar, loadModel } from './world/car.js'

const BG = 0x0e0f11
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
  uniform vec2 uStops[5];
  uniform float uActive;
  uniform float uBrake;
  varying vec3 vP;

  // How much of the car's headlights reach this point on the ground.
  float headlight(vec2 p) {
    vec2 d = p - uCar;
    float dist = length(d);
    float c = dot(d / max(dist, 0.001), uDir);
    float cone = smoothstep(0.72, 0.96, c) * exp(-dist / 48.0) * smoothstep(1.0, 5.0, dist);
    float pool = exp(-dist * dist / 70.0) * 0.3;
    return clamp(cone * 1.3 + pool, 0.0, 1.0);
  }
  float ring(float d, float r) { return 1.0 - smoothstep(0.0, 0.2, abs(d - r)); }
  // Amber survey rings around each stop. The first stop gets three, for sorting.
  float stops(vec2 p) {
    float a = 0.0;
    for (int i = 0; i < 5; i++) {
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

    vec3 col = GROUND + L * 0.075;
    col = mix(col, LINE * 0.8, grid * (0.3 + 0.5 * L));
    col = mix(col, mix(LINE * (0.8 + 0.45 * major), BRIGHT, L), contour);
    col += AMBER * stops(vP.xz) + carGlow(vP.xz);
    gl_FragColor = vec4(fogged(col), 1.0);
  }
`
const ROAD_FRAG = /* glsl */ `
  ${COMMON}
  uniform float uTime;
  varying vec2 vUv;
  varying float vLine;
  varying vec2 vTan;
  void main() {
    float L = headlight(vP.xz);
    float edge = step(vUv.x, 0.028) + step(0.972, vUv.x);
    vec3 col = ROAD + L * 0.11;
    col = mix(col, mix(LINE * 1.6, BRIGHT * 1.1, L), edge);

    // Racing line: amber dashes that cut to the inside of each corner and
    // run in whichever direction the car is facing. Bright near the car, faint beyond.
    float across = abs(vUv.x - vLine);
    float aa = fwidth(vUv.x) * 1.2;
    float body = 1.0 - smoothstep(0.009, 0.009 + aa, across);
    float way = dot(vTan, uDir) < 0.0 ? -1.0 : 1.0;
    float dashes = step(fract(vUv.y / 3.2 - way * uTime * 1.1), 0.55);
    float near = exp(-length(vP.xz - uCar) / 38.0);
    col += AMBER * body * dashes * (0.10 + 0.65 * near);
    col += AMBER * stops(vP.xz) + carGlow(vP.xz);
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
  const roadMat = new THREE.ShaderMaterial({
    uniforms, vertexShader: ROAD_VERT, fragmentShader: ROAD_FRAG,
    side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
  })
  const loopPts = []
  const spurPts = []
  scene.add(new THREE.Mesh(ribbon(toCurve(LOOP, true), 0.14, loopPts), roadMat))
  scene.add(new THREE.Mesh(ribbon(toCurve(SPUR, false), 0.17, spurPts), roadMat))
  const roadPts = [...loopPts, ...spurPts]

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
  loadModel(parts).then((setTail) => (parts.setTail = setTail)).catch((err) => console.warn('Car model did not load; keeping the stand-in.', err))
  const state = { x: START.x, z: START.z, th: START.heading, vx: 0, vz: 0, vf: 0 }

  // ---------- minimap ----------
  const mapEl = $('map')
  const path = (pts) => pts.map(([x, z], i) => `${i ? 'L' : 'M'}${x.toFixed(1)} ${z.toFixed(1)}`).join('')
  mapEl.innerHTML = `<svg viewBox="-125 -125 250 255" role="group">
    <path class="road" d="${path(loopPts)}Z"/><path class="road" d="${path(spurPts)}"/>
    ${stopList
      .map(
        (s, i) => `<g class="stop" data-i="${i}" role="button" tabindex="0" aria-label="Go to ${projects[i].title}">
        <circle cx="${s.pos[0]}" cy="${s.pos[1]}" r="20"/><circle cx="${s.pos[0]}" cy="${s.pos[1]}" r="7"/></g>`,
      )
      .join('')}
    <path class="car" d="M0 11 L6 -7 L0 -3 L-6 -7Z"/>
  </svg>`
  const mapCar = mapEl.querySelector('.car')
  const mapStops = [...mapEl.querySelectorAll('.stop')]

  // ---------- input ----------
  const keys = new Set()
  const touch = { steer: 0, gas: false, brake: false, id: null, x0: 0 }
  let auto = null // index of the stop being driven to
  const hint = $('hint')
  const coarse = matchMedia('(pointer: coarse)').matches
  hint.textContent = coarse
    ? 'Drag on the left to steer. Pedals on the right.'
    : 'WASD or arrow keys to drive. Pull up to a light.'
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

  const goTo = (i) => {
    hint.classList.add('gone')
    dismissed = -1
    if (reduced) {
      // No animated trip: cut straight to the stop.
      // Park at the stop facing away from where the car was, so the beam is in view.
      const [x, z] = stopList[i].pos
      const th = Math.atan2(x - state.x, z - state.z)
      Object.assign(state, { x, z, th: Number.isFinite(th) ? th : state.th, vx: 0, vz: 0, vf: 0 })
      auto = null
      snapCamera = true
    } else auto = i
  }
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
    panel.innerHTML = panelHtml(projects[i], i, projects.length)
    panel.hidden = false
    panel.scrollTop = 0
    panelOpen = true
    root.classList.add('panel-open')
    frameCar()
  }
  function closePanel(byUser) {
    if (byUser && active >= 0) dismissed = active
    panel.hidden = true
    panelOpen = false
    root.classList.remove('panel-open')
    frameCar()
  }

  // ---------- simulation ----------
  const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a))
  function offRoad(x, z) {
    let best = Infinity
    for (const [px, pz] of roadPts) best = Math.min(best, (px - x) ** 2 + (pz - z) ** 2)
    return best > (ROAD_WIDTH * 0.5 + 0.8) ** 2
  }

  function step(dt) {
    let throttle = keys.has('KeyW') || keys.has('ArrowUp') || touch.gas ? 1 : 0
    let brake = keys.has('KeyS') || keys.has('ArrowDown') || touch.brake ? 1 : 0
    const hand = keys.has('Space')
    let steer =
      (keys.has('KeyA') || keys.has('ArrowLeft') ? 1 : 0) - (keys.has('KeyD') || keys.has('ArrowRight') ? 1 : 0) + touch.steer

    if (auto !== null) {
      const [tx, tz] = stopList[auto].pos
      const dx = tx - state.x
      const dz = tz - state.z
      const dist = Math.hypot(dx, dz)
      steer = THREE.MathUtils.clamp(wrap(Math.atan2(dx, dz) - state.th) * 2.2, -1, 1)
      const cruise = dist > 30 ? 26 : Math.max(5, dist * 0.8)
      throttle = state.vf < cruise ? 1 : 0
      brake = state.vf > cruise + 3 ? 1 : 0
      if (dist < 5) {
        throttle = 0
        brake = state.vf > 0.5 ? 1 : 0
        if (state.vf <= 0.5) auto = null
      }
    }
    steer = THREE.MathUtils.clamp(steer, -1, 1)

    // Split velocity into along-the-car and sideways parts.
    const fx = Math.sin(state.th)
    const fz = Math.cos(state.th)
    let vf = state.vx * fx + state.vz * fz
    let vl = state.vx * fz - state.vz * fx

    if (throttle) vf += 17 * dt
    if (brake) vf -= (vf > 0.5 ? 34 : 9) * dt
    if (hand) vf -= Math.sign(vf) * Math.min(Math.abs(vf), 30 * dt)
    const off = offRoad(state.x, state.z)
    vf -= vf * (off ? 1.1 : 0.42) * dt
    vf = THREE.MathUtils.clamp(vf, -9, 32)
    vl *= Math.exp(-(hand ? 2 : 6.5) * dt) // tyres scrub off sideways speed

    state.vx = fx * vf + fz * vl
    state.vz = fz * vf - fx * vl

    // Slopes push back, which is what keeps the car in the valley.
    const [gx, gz] = gradient(state.x, state.z)
    state.vx -= gx * 9 * dt
    state.vz -= gz * 9 * dt

    const grip = THREE.MathUtils.clamp(vf / 8, -1, 1)
    state.th += steer * grip * (2.0 - 0.8 * Math.min(1, Math.abs(vf) / 32)) * dt
    state.x += state.vx * dt
    state.z += state.vz * dt
    const r = Math.hypot(state.x, state.z)
    if (r > WORLD_RADIUS) {
      state.x *= WORLD_RADIUS / r
      state.z *= WORLD_RADIUS / r
    }
    state.vf = vf
    state.braking = brake && vf > 0.5 ? 1 : 0
    for (const w of wheels) w.rotation.x += (vf * dt) / 0.35
  }

  // ---------- per-frame placement ----------
  const camTarget = new THREE.Vector3()
  const look = new THREE.Vector3()
  const tmp = new THREE.Vector3()
  let snapCamera = true
  let baseFov = 36
  let wide = 1

  function place(dt) {
    const { x, z, th } = state
    const fx = Math.sin(th)
    const fz = Math.cos(th)
    const y = height(x, z)
    car.position.set(x, y, z)
    const pitch = -Math.atan2(height(x + fx * 1.4, z + fz * 1.4) - height(x - fx * 1.4, z - fz * 1.4), 2.8)
    const roll = Math.atan2(height(x + fz, z - fx) - height(x - fz, z + fx), 2)
    car.rotation.set(pitch, th, roll)

    uniforms.uCar.value.set(x + fx * 2, z + fz * 2)
    uniforms.uDir.value.set(fx, fz)
    uniforms.uBrake.value += (state.braking - uniforms.uBrake.value) * Math.min(1, dt * 12)
    parts.setTail?.(uniforms.uBrake.value)

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
      } else if (now !== dismissed) openPanel(now)
    }
    markers.forEach((m, i) => {
      m.on.value += ((i === active ? 1 : 0) - m.on.value) * Math.min(1, dt * 4)
    })

    // Camera
    // Same chase view either way. With reduced motion the camera is locked to
    // the car: no swing on corners, no zoom at speed, no pull-out at a stop.
    if (!reduced) wide += ((projects[active]?.id === 'reels' ? 1.6 : 1) - wide) * Math.min(1, dt * 1.5)
    // A longer lens from further back: less wide-angle stretch on the car.
    camTarget.set(x - fx * 15.5 * wide, 0, z - fz * 15.5 * wide)
    camTarget.y = Math.max(y + 5.2 * wide, height(camTarget.x, camTarget.z) + 2)
    if (snapCamera || reduced) camera.position.copy(camTarget)
    else camera.position.lerp(camTarget, 1 - Math.exp(-dt * 3.2))
    look.set(x + fx * 5, y + 1.0, z + fz * 5)
    camera.lookAt(look)
    const fov = baseFov + (reduced ? 0 : 6 * Math.min(1, Math.abs(state.vf) / 32))
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
    },
    stop() {
      running = false
      cancelAnimationFrame(raf)
      keys.clear()
      auto = null
      closePanel(false)
      active = -1 // so the panel reopens if the visitor comes back parked at a stop
    },
  }
}
