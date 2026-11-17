import * as THREE from 'three'
import { height } from './terrain.js'

// Tyre smoke and skid marks. Both use fixed-size buffers that are reused
// in a ring, so nothing is allocated while driving.

const SMOKE_VERT = /* glsl */ `
  attribute float aLife;
  attribute float aSeed;
  uniform float uScale;
  varying float vAlpha;
  void main() {
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    gl_Position = projectionMatrix * mv;
    float alive = step(aLife, 0.999);
    float size = mix(0.6, 3.4, sqrt(aLife)) * (0.8 + 0.4 * aSeed);
    gl_PointSize = alive * size * uScale / -mv.z;
    vAlpha = alive * smoothstep(0.0, 0.08, aLife) * (1.0 - aLife) * 0.18;
  }
`
const SMOKE_FRAG = /* glsl */ `
  varying float vAlpha;
  void main() {
    float d = length(gl_PointCoord - 0.5) * 2.0;
    float a = vAlpha * (1.0 - smoothstep(0.3, 1.0, d));
    if (a < 0.004) discard;
    gl_FragColor = vec4(vec3(0.6, 0.6, 0.62), a);
  }
`

export function createFx(scene) {
  // ---------- smoke ----------
  const N = 360
  const pos = new Float32Array(N * 3)
  const vel = new Float32Array(N * 3)
  const life = new Float32Array(N).fill(1)
  const ttl = new Float32Array(N).fill(1)
  const seed = new Float32Array(N).map(() => Math.random())
  const smokeGeo = new THREE.BufferGeometry()
  smokeGeo.setAttribute('position', new THREE.BufferAttribute(pos, 3))
  smokeGeo.setAttribute('aLife', new THREE.BufferAttribute(life, 1))
  smokeGeo.setAttribute('aSeed', new THREE.BufferAttribute(seed, 1))
  const smokeMat = new THREE.ShaderMaterial({
    uniforms: { uScale: { value: 400 } },
    vertexShader: SMOKE_VERT,
    fragmentShader: SMOKE_FRAG,
    transparent: true,
    depthWrite: false,
  })
  const smoke = new THREE.Points(smokeGeo, smokeMat)
  smoke.frustumCulled = false
  smoke.renderOrder = 2
  scene.add(smoke)
  let next = 0
  let live = 0

  function puff(p, vx, vz) {
    const i = next
    next = (next + 1) % N
    const r = () => Math.random() - 0.5
    pos[i * 3] = p.x + r() * 0.3
    pos[i * 3 + 1] = p.y + 0.15
    pos[i * 3 + 2] = p.z + r() * 0.3
    vel[i * 3] = vx * 0.25 + r() * 1.6
    vel[i * 3 + 1] = 0.5 + Math.random() * 0.6
    vel[i * 3 + 2] = vz * 0.25 + r() * 1.6
    life[i] = 0
    ttl[i] = 1.3 + Math.random() * 1.1
    live = N
  }

  // ---------- skid marks ----------
  const M = 900 // quads
  const markPos = new Float32Array(M * 4 * 3)
  const markIdx = []
  for (let q = 0; q < M; q++) {
    const a = q * 4
    markIdx.push(a, a + 1, a + 2, a + 2, a + 1, a + 3)
  }
  const markGeo = new THREE.BufferGeometry()
  markGeo.setAttribute('position', new THREE.BufferAttribute(markPos, 3))
  markGeo.setIndex(markIdx)
  const marks = new THREE.Mesh(
    markGeo,
    new THREE.MeshBasicMaterial({
      color: 0x000000, transparent: true, opacity: 0.75, depthWrite: false,
      polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4,
    }),
  )
  marks.frustumCulled = false
  marks.renderOrder = 1
  scene.add(marks)
  let quad = 0
  const W = 0.13 // half the width of a tyre track

  // One trail per wheel; `last` is null when that wheel is not leaving a mark.
  const trails = new Map()
  function mark(key, p, on) {
    const t = trails.get(key)
    if (!on) {
      trails.delete(key)
      return
    }
    const y = height(p.x, p.z) + 0.19
    if (!t) {
      trails.set(key, { x: p.x, z: p.z, y })
      return
    }
    const dx = p.x - t.x
    const dz = p.z - t.z
    const d = Math.hypot(dx, dz)
    if (d < 0.35) return
    const nx = (-dz / d) * W
    const nz = (dx / d) * W
    const o = quad * 12
    markPos.set([t.x + nx, t.y, t.z + nz, t.x - nx, t.y, t.z - nz, p.x + nx, y, p.z + nz, p.x - nx, y, p.z - nz], o)
    quad = (quad + 1) % M
    markGeo.attributes.position.needsUpdate = true
    t.x = p.x
    t.z = p.z
    t.y = y
  }

  function update(dt, camera, drawHeight) {
    smokeMat.uniforms.uScale.value = drawHeight / (2 * Math.tan((camera.fov * Math.PI) / 360))
    if (!live) return
    let any = false
    const drag = Math.exp(-1.6 * dt)
    for (let i = 0; i < N; i++) {
      if (life[i] >= 1) continue
      any = true
      life[i] = Math.min(1, life[i] + dt / ttl[i])
      vel[i * 3] *= drag
      vel[i * 3 + 2] *= drag
      vel[i * 3 + 1] = vel[i * 3 + 1] * drag + 0.25 * dt
      pos[i * 3] += vel[i * 3] * dt
      pos[i * 3 + 1] += vel[i * 3 + 1] * dt
      pos[i * 3 + 2] += vel[i * 3 + 2] * dt
    }
    smokeGeo.attributes.position.needsUpdate = true
    smokeGeo.attributes.aLife.needsUpdate = true
    if (!any) live = 0
  }

  return { puff, mark, update }
}
