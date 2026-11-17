import * as THREE from 'three'
import { height, ROAD_WIDTH } from './terrain.js'

// Set dressing for the night map: cat's-eye road studs, gateposts at each
// stop and low mist in the valley hollows.
// `shared` holds uCar, uDir and uTime, the same uniforms the ground uses.

const AMBER = 'vec3(0.910, 0.639, 0.239)'

// ---------- road studs ----------
// Amber reflectors along both road edges. Like real cat's-eyes they only
// shine back toward a light, so they flare in the headlights and go dim behind.
export function createStuds(scene, curves, shared) {
  const pos = []
  for (const { curve, skipStart } of curves) {
    const n = Math.floor(curve.getLength() / 6)
    for (let i = 0; i <= n; i++) {
      if (!curve.closed && i === n) continue
      const u = i / n
      if (u * curve.getLength() < skipStart) continue
      const p = curve.getPointAt(u)
      const t = curve.getTangentAt(u)
      for (const side of [-1, 1]) {
        const x = p.x + t.z * side * (ROAD_WIDTH / 2 - 0.3)
        const z = p.z - t.x * side * (ROAD_WIDTH / 2 - 0.3)
        pos.push(x, height(x, z) + 0.22, z)
      }
    }
  }
  const geo = new THREE.BufferGeometry()
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
  const mat = new THREE.ShaderMaterial({
    uniforms: { uCar: shared.uCar, uDir: shared.uDir, uScale: { value: 400 } },
    vertexShader: /* glsl */ `
      uniform vec2 uCar;
      uniform vec2 uDir;
      uniform float uScale;
      varying float vB;
      varying float vFog;
      void main() {
        vec2 d = position.xz - uCar;
        float dist = length(d);
        float c = dot(d / max(dist, 0.001), uDir);
        float lit = smoothstep(0.8, 0.975, c) * exp(-dist / 85.0) * smoothstep(2.0, 7.0, dist);
        vB = 0.06 + 1.1 * lit;
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        vFog = smoothstep(110.0, 250.0, -mv.z);
        gl_PointSize = max(1.5, 0.26 * uScale / -mv.z) * (0.8 + 0.4 * lit);
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: /* glsl */ `
      varying float vB;
      varying float vFog;
      void main() {
        float d = length(gl_PointCoord - 0.5) * 2.0;
        float a = 1.0 - smoothstep(0.25, 1.0, d);
        gl_FragColor = vec4(${AMBER} * vB * a * (1.0 - vFog), 1.0);
      }`,
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
  })
  const points = new THREE.Points(geo, mat)
  points.frustumCulled = false
  scene.add(points)
  return mat.uniforms.uScale
}

// ---------- gateposts ----------
// Two short posts either side of the road at each stop, each topped with a
// small amber light that brightens while the car is there.
export function createGates(scene, stops) {
  const postGeo = new THREE.BoxGeometry(0.14, 2.3, 0.14)
  postGeo.translate(0, 1.15, 0)
  const capGeo = new THREE.BoxGeometry(0.22, 0.07, 0.22)
  const postMat = new THREE.MeshStandardMaterial({ color: 0x2a2c30, roughness: 0.7, metalness: 0.2 })
  return stops.map(({ x, z, heading }) => {
    const lamp = new THREE.MeshBasicMaterial({ color: 0xe8a33d })
    const nx = Math.cos(heading)
    const nz = -Math.sin(heading)
    for (const side of [-1, 1]) {
      const px = x + nx * side * (ROAD_WIDTH / 2 + 0.9)
      const pz = z + nz * side * (ROAD_WIDTH / 2 + 0.9)
      const y = height(px, pz)
      const post = new THREE.Mesh(postGeo, postMat)
      post.position.set(px, y, pz)
      post.rotation.y = heading
      const cap = new THREE.Mesh(capGeo, lamp)
      cap.position.set(px, y + 2.34, pz)
      cap.rotation.y = heading
      scene.add(post, cap)
    }
    // on: 0 away, 1 parked here
    return (on) => lamp.color.setRGB(0.91, 0.64, 0.24).multiplyScalar(0.3 + 0.7 * on)
  })
}

// ---------- valley mist ----------
// One sheet laid over the valley at a fixed height. It only shows where the
// ground dips below it, thickening with depth, drifts slowly, takes the
// headlights, and thins out around the car so it parts as you drive through.
export function createMist(scene, shared, level = -0.8) {
  const size = 260
  const geo = new THREE.PlaneGeometry(size, size, 130, 130)
  geo.rotateX(-Math.PI / 2)
  const p = geo.attributes.position
  const depth = new Float32Array(p.count)
  for (let i = 0; i < p.count; i++) {
    p.setY(i, level)
    depth[i] = level - height(p.getX(i), p.getZ(i))
  }
  geo.setAttribute('aDepth', new THREE.BufferAttribute(depth, 1))
  const mat = new THREE.ShaderMaterial({
    uniforms: { uCar: shared.uCar, uDir: shared.uDir, uTime: shared.uTime },
    vertexShader: /* glsl */ `
      attribute float aDepth;
      varying float vDepth;
      varying vec3 vP;
      void main() {
        vDepth = aDepth;
        vP = position;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }`,
    fragmentShader: /* glsl */ `
      uniform vec2 uCar;
      uniform vec2 uDir;
      uniform float uTime;
      varying float vDepth;
      varying vec3 vP;
      float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
      float noise(vec2 p) {
        vec2 i = floor(p), f = fract(p);
        vec2 u = f * f * (3.0 - 2.0 * f);
        return mix(mix(hash(i), hash(i + vec2(1, 0)), u.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), u.x), u.y);
      }
      void main() {
        if (vDepth <= 0.0) discard;
        vec2 q = vP.xz * 0.045 + vec2(uTime * 0.018, uTime * 0.007);
        float n = noise(q) * 0.6 + noise(q * 2.3 + 4.0) * 0.3 + noise(q * 5.1 - 2.0) * 0.1;
        float dist = length(vP.xz - uCar);
        vec2 d = (vP.xz - uCar) / max(dist, 0.001);
        float beam = smoothstep(0.75, 0.97, dot(d, uDir)) * exp(-dist / 40.0);
        float a = smoothstep(0.0, 2.2, vDepth) * smoothstep(0.25, 0.75, n);
        a *= smoothstep(3.0, 11.0, dist); // parts around the car
        a *= 1.0 - smoothstep(120.0, 230.0, distance(vP, cameraPosition));
        vec3 col = vec3(0.42, 0.45, 0.5) * (0.22 + 1.1 * beam);
        gl_FragColor = vec4(col, a * 0.16);
      }`,
    transparent: true, depthWrite: false,
  })
  const mesh = new THREE.Mesh(geo, mat)
  mesh.renderOrder = 1
  scene.add(mesh)
}
