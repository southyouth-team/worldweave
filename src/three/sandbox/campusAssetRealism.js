import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'
import { createCylinderBetween, replaceBoxWithCylinder } from '../world/proceduralGeometry.js'

function collectMeshes(root) {
  const meshes = []
  root.traverse(object => {
    if (object.isMesh) meshes.push(object)
  })
  return meshes
}

function bakeGeometry(THREE, geometry, proceduralShape) {
  const baked = new THREE.BufferGeometry()
  baked.copy(geometry)
  baked.userData.proceduralShape = proceduralShape
  baked.computeBoundingBox()
  geometry.dispose()
  return baked
}

function addBox(THREE, root, name, size, position, material) {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(size.x, size.y, size.z), material)
  mesh.name = name
  mesh.position.set(position.x, position.y, position.z)
  mesh.castShadow = true
  mesh.receiveShadow = true
  root.add(mesh)
  return mesh
}

function buildGridGeometry(THREE, sample, uSegments, vSegments, flip = false) {
  const positions = []
  const indices = []
  for (let row = 0; row <= vSegments; row += 1) {
    for (let column = 0; column <= uSegments; column += 1) {
      const point = sample(column / uSegments, row / vSegments)
      positions.push(point.x, point.y, point.z)
    }
  }
  for (let row = 0; row < vSegments; row += 1) {
    for (let column = 0; column < uSegments; column += 1) {
      const a = row * (uSegments + 1) + column
      const b = a + 1
      const d = (row + 1) * (uSegments + 1) + column
      const c = d + 1
      if (flip) indices.push(a, c, b, a, d, c)
      else indices.push(a, b, c, a, c, d)
    }
  }
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  geometry.setIndex(indices)
  geometry.computeVertexNormals()
  return geometry
}

function createCurvedHipRoof(THREE, width, depth, height) {
  const baseY = -height / 2
  const ridgeHalf = width * 0.15
  const cornerLift = height * 0.1
  const heightAt = (u, t) => baseY + height * (0.28 * t + 0.72 * t * t)
    + cornerLift * (1 - t) ** 3 * Math.abs(2 * u - 1) ** 4
  const samples = {
    front: (u, t) => ({
      x: THREE.MathUtils.lerp((u - 0.5) * width, (u - 0.5) * ridgeHalf * 2, t),
      y: heightAt(u, t),
      z: depth / 2 * (1 - t),
    }),
    back: (u, t) => ({
      x: THREE.MathUtils.lerp(-(u - 0.5) * width, -(u - 0.5) * ridgeHalf * 2, t),
      y: heightAt(u, t),
      z: -depth / 2 * (1 - t),
    }),
    left: (u, t) => ({
      x: -width / 2 * (1 - t) - ridgeHalf * t,
      y: heightAt(u, t),
      z: (u - 0.5) * depth * (1 - t),
    }),
    right: (u, t) => ({
      x: width / 2 * (1 - t) + ridgeHalf * t,
      y: heightAt(u, t),
      z: -(u - 0.5) * depth * (1 - t),
    }),
  }
  const parts = [
    buildGridGeometry(THREE, samples.front, 12, 5),
    buildGridGeometry(THREE, samples.back, 12, 5),
    buildGridGeometry(THREE, samples.left, 6, 5),
    buildGridGeometry(THREE, samples.right, 6, 5, true),
  ]
  const geometry = mergeGeometries(parts, false)
  for (const part of parts) part.dispose()
  geometry.computeVertexNormals()
  geometry.computeBoundingBox()
  geometry.userData.proceduralShape = 'curved-hip-roof'
  return { geometry, samples }
}

function createCurvedRoofTileGeometry(THREE, sample, radius = 0.045) {
  const geometry = buildGridGeometry(THREE, (u, v) => {
    const t = 0.025 + v * (0.96 - 0.025)
    const point = sample(t)
    const next = sample(Math.min(0.96, t + 0.001))
    const tangentX = next.x - point.x
    const tangentZ = next.z - point.z
    const crossLength = Math.hypot(tangentZ, tangentX) || 1
    const crossX = -tangentZ / crossLength
    const crossZ = tangentX / crossLength
    const angle = u * Math.PI
    const crossOffset = Math.cos(angle) * radius
    return {
      x: point.x + crossX * crossOffset,
      y: point.y + Math.sin(angle) * radius,
      z: point.z + crossZ * crossOffset,
    }
  }, 4, 4, true)
  geometry.computeBoundingBox()
  geometry.userData.proceduralShape = 'curved-roof-tile'
  return geometry
}

function createArchBandGeometry(THREE, radiusX, radiusY, thickness, depth) {
  const positions = []
  const pushTriangle = (a, b, c) => positions.push(...a, ...b, ...c)
  const pushQuad = (a, b, c, d) => {
    pushTriangle(a, b, c)
    pushTriangle(a, c, d)
  }
  const point = (angle, inner, z) => [
    (radiusX - (inner ? thickness : 0)) * Math.cos(angle),
    (radiusY - (inner ? thickness : 0)) * Math.sin(angle),
    z,
  ]
  const segments = 20
  for (let index = 0; index < segments; index += 1) {
    const a = index * Math.PI / segments
    const b = (index + 1) * Math.PI / segments
    for (const z of [-depth / 2, depth / 2]) {
      pushQuad(point(a, false, z), point(b, false, z), point(b, true, z), point(a, true, z))
    }
    pushQuad(point(a, false, -depth / 2), point(b, false, -depth / 2),
      point(b, false, depth / 2), point(a, false, depth / 2))
    pushQuad(point(a, true, depth / 2), point(b, true, depth / 2),
      point(b, true, -depth / 2), point(a, true, -depth / 2))
  }
  for (const angle of [0, Math.PI]) {
    pushQuad(point(angle, false, -depth / 2), point(angle, true, -depth / 2),
      point(angle, true, depth / 2), point(angle, false, depth / 2))
  }
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  geometry.computeVertexNormals()
  geometry.computeBoundingBox()
  geometry.userData.proceduralShape = 'elliptical-arch'
  return geometry
}

function refineEastGate(THREE, root) {
  const meshes = collectMeshes(root)
  const piers = meshes.filter(mesh => mesh.name === 'gate-pier')
  for (const pier of piers) {
    addBox(THREE, root, 'gate-pier-base',
      { x: 2, y: 0.45, z: 3.4 },
      { x: pier.position.x, y: 0.225, z: pier.position.z }, pier.material)
  }

  const roofs = meshes.filter(mesh => ['gate-roof-center', 'gate-roof-wing'].includes(mesh.name))
  for (const roof of roofs) {
    roof.geometry.computeBoundingBox()
    const size = roof.geometry.boundingBox.getSize(new THREE.Vector3())
    const { geometry, samples } = createCurvedHipRoof(THREE, size.x, size.z, size.y)
    roof.geometry = geometry
    roof.material.side = THREE.DoubleSide
    const tileCount = roof.name === 'gate-roof-center' ? 7 : 5
    for (const face of ['front', 'back']) {
      for (let index = 0; index < tileCount; index += 1) {
        const u = (index + 1) / (tileCount + 1)
        const geometry = createCurvedRoofTileGeometry(THREE, t => {
          const point = samples[face](u, t)
          point.x += roof.position.x
          point.y += roof.position.y
          point.z += roof.position.z
          return point
        })
        const tile = new THREE.Mesh(geometry, roof.material)
        tile.name = 'gate-roof-tile'
        tile.castShadow = true
        tile.receiveShadow = true
        root.add(tile)
      }
    }
  }

  const lintel = meshes.find(mesh => mesh.name === 'gate-lintel')
  const sideLintel = meshes.find(mesh => mesh.name === 'gate-lintel-side')
  const centralArch = new THREE.Mesh(createArchBandGeometry(THREE, 4, 2, 0.28, 0.18), lintel.material)
  centralArch.name = 'gate-lintel-arch'
  centralArch.position.set(0, 4.05, 1.36)
  root.add(centralArch)
  for (const x of [-7.1, 7.1]) {
    const arch = new THREE.Mesh(createArchBandGeometry(THREE, 1.85, 1.05, 0.2, 0.16), sideLintel.material)
    arch.name = 'gate-lintel-arch'
    arch.position.set(x, 3.1, 1.25)
    root.add(arch)
  }
}

function restoreSportsSurfaceTransforms(THREE, meshes) {
  for (const mesh of meshes) {
    if (mesh.name === 'sports-track' && mesh.geometry.type === 'ExtrudeGeometry') {
      const p = mesh.geometry.parameters
      mesh.geometry = new THREE.ExtrudeGeometry(p.shapes, p.options)
      mesh.rotation.x = -Math.PI / 2
    } else if (mesh.name === 'sports-lane-line' && mesh.geometry.type === 'ShapeGeometry') {
      const p = mesh.geometry.parameters
      mesh.geometry = new THREE.ShapeGeometry(p.shapes, p.curveSegments)
      mesh.rotation.x = -Math.PI / 2
    }
  }
}

function createLChairGeometry(THREE, width, depth, height, seatHeight = 0.44) {
  const seatThickness = Math.min(0.12, height * 0.18)
  const backThickness = Math.min(0.1, depth * 0.22)
  const bottom = -height / 2
  const seatTop = bottom + seatHeight
  const seatBottom = seatTop - seatThickness
  if (!(seatBottom > bottom) || !(seatTop < height / 2)) {
    throw new Error('椅子座面必须位于底面与靠背顶之间')
  }
  // 单一侧轮廓包含座面、靠背与前后支撑；挤出后仍保持几何中心与 collider 对齐。
  const profile = new THREE.Shape()
  profile.moveTo(-depth / 2, bottom)
  profile.lineTo(-depth / 2 + backThickness, bottom)
  profile.lineTo(-depth / 2 + backThickness, seatBottom)
  profile.lineTo(depth / 2 - backThickness, seatBottom)
  profile.lineTo(depth / 2 - backThickness, bottom)
  profile.lineTo(depth / 2, bottom)
  profile.lineTo(depth / 2, seatTop)
  profile.lineTo(-depth / 2 + backThickness, seatTop)
  profile.lineTo(-depth / 2 + backThickness, height / 2)
  profile.lineTo(-depth / 2, height / 2)
  profile.closePath()
  const geometry = new THREE.ExtrudeGeometry(profile, { depth: width, bevelEnabled: false })
  geometry.rotateY(Math.PI / 2)
  geometry.translate(-width / 2, 0, 0)
  geometry.computeVertexNormals()
  return bakeGeometry(THREE, geometry, 'l-chair-with-supports')
}

function createStandRoofGeometry(THREE, width, depth) {
  const geometry = buildGridGeometry(THREE, (u, t) => {
    const z = (t - 0.5) * depth
    return {
      x: (u - 0.5) * width,
      y: -0.125 + 0.6 * (1 - (z / (depth / 2)) ** 2),
      z,
    }
  }, 11, 8)
  geometry.computeBoundingBox()
  geometry.userData.proceduralShape = 'curved-stand-roof'
  return geometry
}

function createWaveFlagGeometry(THREE, width, height) {
  const geometry = new THREE.PlaneGeometry(width, height, 12, 4)
  const position = geometry.getAttribute('position')
  for (let index = 0; index < position.count; index += 1) {
    const x = position.getX(index)
    const y = position.getY(index)
    const u = (x + width / 2) / width
    position.setZ(index, Math.sin(u * Math.PI * 2.2 + y / height * 0.8) * 0.16 * u)
  }
  position.needsUpdate = true
  geometry.computeVertexNormals()
  return bakeGeometry(THREE, geometry, 'wave-flag')
}

function refineSportsField(THREE, root) {
  const meshes = collectMeshes(root)
  restoreSportsSurfaceTransforms(THREE, meshes)
  const goalposts = meshes.filter(mesh => mesh.name === 'sports-goalpost')
  for (const post of goalposts) replaceBoxWithCylinder(THREE, post, { radialSegments: 12 })

  for (const x of [-52.5, 52.5]) {
    const material = goalposts[0].material
    const backX = x + Math.sign(x) * 1.25
    for (let index = 0; index < 9; index += 1) {
      const z = -3.54 + index * 7.08 / 8
      root.add(createCylinderBetween(THREE,
        { x, y: 2.48, z }, { x: backX, y: 0.15, z },
        0.012, material, 'sports-goal-net', 5))
    }
    for (const y of [0.55, 1.15, 1.75]) {
      root.add(createCylinderBetween(THREE,
        { x: backX, y, z: -3.58 }, { x: backX, y, z: 3.58 },
        0.012, material, 'sports-goal-net', 5))
    }
  }

  const rows = meshes.filter(mesh => mesh.name === 'sports-stand-step')
  const roof = meshes.find(mesh => mesh.name === 'sports-stand-roof')
  const seatGeometry = createLChairGeometry(THREE, 0.62, 0.5, 0.72)
  for (const row of rows) {
    const p = row.geometry.parameters
    for (let index = 0; index < 8; index += 1) {
      const seat = new THREE.Mesh(seatGeometry, roof.material)
      seat.name = 'sports-stand-seat'
      seat.position.set((index - 3.5) * 1.05, p.height + 0.36, row.position.z)
      seat.rotation.y = Math.PI
      seat.castShadow = true
      root.add(seat)
    }
  }
  const roofSize = roof.geometry.parameters
  roof.geometry = createStandRoofGeometry(THREE, roofSize.width, roofSize.depth)

  const flag = meshes.find(mesh => mesh.name === 'sports-flag')
  const flagSize = flag.geometry.parameters
  flag.geometry = createWaveFlagGeometry(THREE, flagSize.width, flagSize.height)
}

function createDeskSupportsGeometry(THREE) {
  const panels = []
  for (const z of [-0.22, 0.22]) {
    const panel = new THREE.BoxGeometry(1.2, 0.67, 0.06)
    panel.translate(0, 0, z)
    panels.push(panel)
  }
  const geometry = mergeGeometries(panels, false)
  for (const panel of panels) panel.dispose()
  return bakeGeometry(THREE, geometry, 'desk-supports')
}

function refineZhiyuanBuilding(THREE, root) {
  const meshes = collectMeshes(root)
  const frameMaterial = meshes.find(mesh => mesh.name === 'zhiyuan-colonnade').material
  const windows = meshes.filter(mesh => mesh.name === 'zhiyuan-window-glass')
  for (const window of windows) {
    const p = window.geometry.parameters
    addBox(THREE, root, 'zhiyuan-window-glass-mullion',
      { x: 0.065, y: p.height, z: 0.075 },
      { x: window.position.x, y: window.position.y, z: window.position.z + Math.sign(window.position.z) * 0.04 },
      frameMaterial)
  }

  for (let floor = 0; floor < 5; floor += 1) {
    for (const z of [-8.12, 8.12]) {
      addBox(THREE, root, 'zhiyuan-upper-band',
        { x: 80, y: 0.12, z: 0.16 },
        { x: 0, y: 3.95 + floor * 3.9, z }, frameMaterial)
    }
  }
  for (const x of [-1.47, 1.47]) {
    addBox(THREE, root, 'zhiyuan-window-glass-door-frame',
      { x: 0.1, y: 2.6, z: 0.12 }, { x, y: 1.3, z: 8.17 }, frameMaterial)
  }
  addBox(THREE, root, 'zhiyuan-window-glass-door-frame',
    { x: 3, y: 0.1, z: 0.12 }, { x: 0, y: 2.58, z: 8.17 }, frameMaterial)

  const chairs = meshes.filter(mesh => mesh.name === 'zhiyuan-chair')
  const chairGeometry = createLChairGeometry(THREE, 0.45, 0.45, 0.8)
  for (const chair of chairs) {
    chair.geometry = chairGeometry
    chair.position.y = 0.4
  }

  const desks = meshes.filter(mesh => mesh.name === 'zhiyuan-desk')
  const supportsGeometry = createDeskSupportsGeometry(THREE)
  for (const desk of desks) {
    desk.geometry = supportsGeometry
    desk.position.y = 0.335
    addBox(THREE, root, 'zhiyuan-desk-top',
      { x: 1.2, y: 0.08, z: 0.5 },
      { x: desk.position.x, y: 0.71, z: desk.position.z }, desk.material)
  }
}

/** 校园地标专用曲面与近人尺度细节；仍在适配层碰撞标注之前执行。 */
export function refineCampusAssetVisuals(THREE, root, { objectType }) {
  if (objectType === 'east-gate') refineEastGate(THREE, root)
  if (objectType === 'sports-field') refineSportsField(THREE, root)
  if (objectType === 'zhiyuan-building') refineZhiyuanBuilding(THREE, root)
  return root
}
