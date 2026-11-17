import * as THREE from 'three'

// Low-poly sports sedan built from a side profile, so there is no model to download.
// The car faces +z and sits with its wheels on y = 0.

function profile(points, width) {
  const shape = new THREE.Shape(points.map(([x, y]) => new THREE.Vector2(x, y)))
  const geo = new THREE.ExtrudeGeometry(shape, { depth: width, bevelEnabled: false })
  geo.translate(0, 0, -width / 2)
  geo.rotateY(-Math.PI / 2) // profile x becomes forward (+z)
  return geo
}

export function createCar() {
  const car = new THREE.Group()
  const stand = new THREE.Group() // the box car, shown until the real model arrives
  car.add(stand)

  const paint = new THREE.MeshStandardMaterial({ color: 0x4a4e55, roughness: 0.5, metalness: 0.35, flatShading: true })
  const glass = new THREE.MeshStandardMaterial({ color: 0x16181c, roughness: 0.25, metalness: 0.4, flatShading: true })
  const rubber = new THREE.MeshStandardMaterial({ color: 0x0b0b0c, roughness: 0.9, flatShading: true })

  const body = new THREE.Mesh(
    profile(
      [
        [-2.15, 0.3], [-2.2, 0.78], [-2.05, 0.9], [-1.3, 0.93], [1.0, 0.86],
        [1.95, 0.7], [2.2, 0.52], [2.18, 0.3],
      ],
      1.86,
    ),
    paint,
  )
  const cabin = new THREE.Mesh(
    profile([[-1.75, 0.9], [-0.95, 1.3], [0.2, 1.33], [1.1, 0.85]], 1.52),
    glass,
  )
  stand.add(body, cabin)

  const wheelGeo = new THREE.CylinderGeometry(0.35, 0.35, 0.28, 12)
  wheelGeo.rotateZ(Math.PI / 2)
  const wheels = []
  for (const [x, z] of [[0.9, 1.38], [-0.9, 1.38], [0.9, -1.36], [-0.9, -1.36]]) {
    const w = new THREE.Mesh(wheelGeo, rubber)
    w.position.set(x, 0.35, z)
    w.rotation.order = 'YXZ'
    w.userData.front = z > 0
    wheels.push(w)
    stand.add(w)
  }

  const tail = new THREE.Mesh(
    new THREE.BoxGeometry(1.62, 0.06, 0.06),
    new THREE.MeshBasicMaterial({ color: 0xe8a33d }),
  )
  tail.position.set(0, 0.74, -2.2)
  const lampMat = new THREE.MeshBasicMaterial({ color: 0xf4f1e8 })
  const lampGeo = new THREE.BoxGeometry(0.42, 0.06, 0.06)
  const lampL = new THREE.Mesh(lampGeo, lampMat)
  const lampR = new THREE.Mesh(lampGeo, lampMat)
  lampL.position.set(0.62, 0.6, 2.13)
  lampR.position.set(-0.62, 0.6, 2.13)
  stand.add(tail, lampL, lampR)

  car.rotation.order = 'YXZ'
  return { car, wheels, stand }
}

function splitWheels(car, mesh) {
  car.updateMatrixWorld(true)
  const toCar = new THREE.Matrix4().copy(car.matrixWorld).invert().multiply(mesh.matrixWorld)
  const nm = new THREE.Matrix3().getNormalMatrix(toCar)
  const src = mesh.geometry.index ? mesh.geometry.toNonIndexed() : mesh.geometry
  const P = src.attributes.position
  const Nr = src.attributes.normal
  const U = src.attributes.uv
  const v = new THREE.Vector3()
  const buckets = [[], [], [], []]
  for (let t = 0; t < P.count; t += 3) {
    let cx = 0
    let cz = 0
    for (let k = 0; k < 3; k++) {
      v.fromBufferAttribute(P, t + k).applyMatrix4(toCar)
      cx += v.x
      cz += v.z
    }
    buckets[(cx > 0 ? 1 : 0) + (cz > 0 ? 2 : 0)].push(t)
  }
  return buckets
    .filter((b) => b.length)
    .map((tris) => {
      const n = tris.length * 3
      const pos = new Float32Array(n * 3)
      const nor = Nr ? new Float32Array(n * 3) : null
      const uv = U ? new Float32Array(n * 2) : null
      let i = 0
      for (const t of tris) {
        for (let k = 0; k < 3; k++, i++) {
          v.fromBufferAttribute(P, t + k).applyMatrix4(toCar).toArray(pos, i * 3)
          if (nor) v.fromBufferAttribute(Nr, t + k).applyMatrix3(nm).normalize().toArray(nor, i * 3)
          if (uv) {
            uv[i * 2] = U.getX(t + k)
            uv[i * 2 + 1] = U.getY(t + k)
          }
        }
      }
      const g = new THREE.BufferGeometry()
      g.setAttribute('position', new THREE.BufferAttribute(pos, 3))
      if (nor) g.setAttribute('normal', new THREE.BufferAttribute(nor, 3))
      if (uv) g.setAttribute('uv', new THREE.BufferAttribute(uv, 2))
      g.computeBoundingBox()
      const c = g.boundingBox.getCenter(new THREE.Vector3())
      g.translate(-c.x, -c.y, -c.z)
      const w = new THREE.Mesh(g, mesh.material)
      w.position.copy(c)
      w.rotation.order = 'YXZ'
      w.userData.front = c.z > 0
      car.add(w)
      return w
    })
}

const FLIP = Math.PI // the file's nose points the other way from our +z
const TAIL_Y = 0.86 // height of the rear light bar
const LENGTH = 4.5 // metres, a 991-generation 911

// Swap the box car for the Porsche 911 Carrera S model once it has downloaded.
// Model: "Porsche 911 Carrera S (991.2)" by Mona x Supercars, CC BY 4.0.
export async function loadModel({ car, wheels, stand }) {
  const [{ GLTFLoader }, { MeshoptDecoder }] = await Promise.all([
    import('three/addons/loaders/GLTFLoader.js'),
    import('three/addons/libs/meshopt_decoder.module.js'), // the file is meshopt-compressed
  ])
  const gltf = await new GLTFLoader().setMeshoptDecoder(MeshoptDecoder).loadAsync(`${import.meta.env.BASE_URL}911.glb`)
  const model = gltf.scene

  // The file sits far from its origin and in its own units: centre it, put the
  // wheels on the ground, and scale it to real length.
  const box = new THREE.Box3().setFromObject(model)
  const size = box.getSize(new THREE.Vector3())
  const mid = box.getCenter(new THREE.Vector3())
  const k = LENGTH / Math.max(size.x, size.z)
  model.position.set(-mid.x, -box.min.y, -mid.z)
  const holder = new THREE.Group()
  holder.add(model)
  holder.scale.setScalar(k)
  if (size.x > size.z) holder.rotation.y = Math.PI / 2
  holder.rotation.y += FLIP

  let wheelMesh = null
  model.traverse((o) => {
    if (!o.isMesh) return
    const m = o.material
    if (/whrear/i.test(m.name)) wheelMesh = o
    if (/^Bonnet/.test(m.name)) {
      // Body paint: gloss black.
      m.color.set(0x000000)
      m.metalness = 0
      m.roughness = 0.35
      m.clearcoat = 1
      m.clearcoatRoughness = 0.06
    } else if (/^Glass/.test(m.name)) {
      m.color.set(0x0a0c0e)
      m.opacity = 0.82
      m.roughness = 0.05
    }
  })

  car.remove(stand)
  wheels.length = 0
  car.add(holder)
  // The file has all four wheels as one mesh. Cut it into four, each centred
  // on its own axle, so they can spin and the front pair can steer.
  if (wheelMesh) {
    wheels.push(...splitWheels(car, wheelMesh))
    wheelMesh.visible = false
  }

  // Red taillight glow: a light bar across the rear with a soft halo at each lamp.
  const c = document.createElement('canvas')
  c.width = c.height = 64
  const g = c.getContext('2d')
  const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32)
  grad.addColorStop(0, 'rgba(255,255,255,1)')
  grad.addColorStop(0.25, 'rgba(255,255,255,0.45)')
  grad.addColorStop(1, 'rgba(255,255,255,0)')
  g.fillStyle = grad
  g.fillRect(0, 0, 64, 64)
  const halo = new THREE.SpriteMaterial({
    map: new THREE.CanvasTexture(c), color: 0xff1c10, transparent: true,
    blending: THREE.AdditiveBlending, depthWrite: false,
  })
  const barMat = new THREE.MeshBasicMaterial({ color: 0xff2010 })
  const bar = new THREE.Mesh(new THREE.BoxGeometry(1.46, 0.03, 0.03), barMat)
  bar.position.set(0, TAIL_Y, -LENGTH / 2 - 0.01)
  car.add(bar)
  for (const x of [-0.64, 0.64]) {
    const s = new THREE.Sprite(halo)
    s.position.set(x, TAIL_Y, -LENGTH / 2 - 0.06)
    s.scale.set(1.1, 0.7, 1)
    car.add(s)
  }
  // brake: 0 cruising, 1 braking
  return (brake) => {
    halo.opacity = 0.55 + 0.45 * brake
    barMat.color.setRGB(0.75 + 0.25 * brake, 0.1, 0.05)
  }
}

