import {
  bevelBoxMeshes,
  createCylinderBetween,
  replaceBoxWithCylinder,
} from '../world/proceduralGeometry.js'
import { refineCampusAssetVisuals } from './campusAssetRealism.js'

function collectMeshes(root) {
  const meshes = []
  root.traverse(object => {
    if (object.isMesh) meshes.push(object)
  })
  return meshes
}

function forEachMaterial(mesh, callback) {
  const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material]
  for (const material of materials) {
    if (material) callback(material)
  }
}

function smoothMaterials(root) {
  root.traverse(object => {
    if (!object.isMesh) return
    forEachMaterial(object, material => {
      if ('flatShading' in material) {
        material.flatShading = false
        material.needsUpdate = true
      }
      if ('roughness' in material) material.roughness = Math.min(material.roughness, 0.82)
    })
  })
}

// 修改过顶点的参数化几何不能依赖 parameters 序列化，否则读档会恢复成未变形状态。
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

function replaceWithOrganicSphere(THREE, mesh, { widthSegments = 16, heightSegments = 10, irregular = false } = {}) {
  mesh.geometry.computeBoundingBox()
  const originalBox = mesh.geometry.boundingBox.clone()
  const originalSize = originalBox.getSize(new THREE.Vector3())
  const originalCenter = originalBox.getCenter(new THREE.Vector3())
  const radius = mesh.geometry.parameters?.radius ?? Math.max(originalSize.x, originalSize.y, originalSize.z) / 2
  let geometry = new THREE.SphereGeometry(radius, widthSegments, heightSegments)

  if (irregular) {
    const position = geometry.getAttribute('position')
    for (let index = 0; index < position.count; index += 1) {
      const x = position.getX(index)
      const y = position.getY(index)
      const z = position.getZ(index)
      const variation = 1 + Math.sin(x * 3.1 + y * 1.7) * Math.cos(z * 2.9 - y) * 0.035
      position.setXYZ(index, x * variation, y * variation, z * variation)
    }
    position.needsUpdate = true
    geometry.computeBoundingBox()
    const refinedSize = geometry.boundingBox.getSize(new THREE.Vector3())
    geometry.scale(
      originalSize.x / refinedSize.x,
      originalSize.y / refinedSize.y,
      originalSize.z / refinedSize.z,
    )
    geometry.computeBoundingBox()
    const center = geometry.boundingBox.getCenter(new THREE.Vector3())
    geometry.translate(originalCenter.x - center.x, originalCenter.y - center.y, originalCenter.z - center.z)
    geometry.computeVertexNormals()
    geometry = bakeGeometry(THREE, geometry, 'organic-crown')
  }
  geometry.computeBoundingBox()
  mesh.geometry = geometry
}

function refineTree(THREE, root) {
  const meshes = collectMeshes(root)
  const trunk = meshes.find(mesh => mesh.name === 'vegetation-trunk')
  if (trunk?.geometry.type === 'CylinderGeometry') {
    const p = trunk.geometry.parameters
    trunk.geometry = new THREE.CylinderGeometry(
      p.radiusTop, p.radiusBottom, p.height, 12, p.heightSegments,
    )
  }

  const crowns = meshes.filter(mesh => mesh.name.startsWith('vegetation-crown-'))
  for (const crown of crowns) {
    replaceWithOrganicSphere(THREE, crown, { widthSegments: 18, heightSegments: 12, irregular: true })
  }

  if (trunk && crowns.length) {
    const trunkHeight = trunk.geometry.parameters.height
    const crown = crowns[0]
    crown.geometry.computeBoundingBox()
    const crownRadius = Math.max(
      crown.geometry.boundingBox.max.x - crown.geometry.boundingBox.min.x,
      crown.geometry.boundingBox.max.z - crown.geometry.boundingBox.min.z,
    ) * 0.5 * Math.max(crown.scale.x, crown.scale.z)
    for (let index = 0; index < 6; index += 1) {
      const angle = index * Math.PI * 2 / 6 + 0.18
      const start = { x: 0, y: trunkHeight * (0.68 + (index % 2) * 0.08), z: 0 }
      const end = {
        x: Math.cos(angle) * crownRadius * 0.72,
        y: crown.position.y - crownRadius * 0.12 + (index % 2) * crownRadius * 0.16,
        z: Math.sin(angle) * crownRadius * 0.72,
      }
      root.add(createCylinderBetween(
        THREE, start, end, trunk.geometry.parameters.radiusBottom * 0.34,
        trunk.material, 'vegetation-crown-branch', 10,
      ))
    }
  }
}

function refineShrub(THREE, root) {
  for (const object of collectMeshes(root)) {
    object.name = 'shrub-crown'
    replaceWithOrganicSphere(THREE, object, { widthSegments: 16, heightSegments: 10 })
  }
}

function refineFlowers(THREE, root) {
  const blooms = []
  for (const object of collectMeshes(root)) {
    if (object.name.startsWith('flower-stem')) {
      const p = object.geometry.parameters
      object.geometry = new THREE.CylinderGeometry(p.radiusTop, p.radiusBottom, p.height, 8)
    } else {
      object.name = 'flower-bloom'
      blooms.push(object)
    }
  }

  const petalGeometry = new THREE.SphereGeometry(1, 8, 6)
  for (const bloom of blooms) {
    const radius = bloom.geometry.parameters?.radius ?? 0.12
    replaceWithOrganicSphere(THREE, bloom, { widthSegments: 12, heightSegments: 8 })
    for (let petal = 0; petal < 6; petal += 1) {
      const angle = petal * Math.PI * 2 / 6
      const mesh = new THREE.Mesh(petalGeometry, bloom.material)
      mesh.name = 'flower-bloom-petal'
      mesh.position.copy(bloom.position)
      mesh.position.x += Math.cos(angle) * radius * 0.72
      mesh.position.z += Math.sin(angle) * radius * 0.72
      mesh.position.y += radius * 0.06
      mesh.scale.set(radius * 0.68, radius * 0.2, radius * 0.42)
      mesh.rotation.y = -angle
      mesh.castShadow = true
      root.add(mesh)
    }
  }
}

function createHipRoofGeometry(THREE, width, depth, thickness, rise) {
  const x = width / 2
  const z = depth / 2
  const ridge = width * 0.28
  const baseY = -thickness / 2
  const positions = []
  const triangle = (a, b, c) => positions.push(...a, ...b, ...c)
  const leftFront = [-x, baseY, z]
  const rightFront = [x, baseY, z]
  const leftBack = [-x, baseY, -z]
  const rightBack = [x, baseY, -z]
  const ridgeLeft = [-ridge, rise, 0]
  const ridgeRight = [ridge, rise, 0]
  triangle(leftFront, rightFront, ridgeRight)
  triangle(leftFront, ridgeRight, ridgeLeft)
  triangle(rightBack, leftBack, ridgeLeft)
  triangle(rightBack, ridgeLeft, ridgeRight)
  triangle(leftBack, leftFront, ridgeLeft)
  triangle(rightFront, rightBack, ridgeRight)
  triangle(leftBack, rightBack, rightFront)
  triangle(leftBack, rightFront, leftFront)
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  geometry.computeVertexNormals()
  geometry.computeBoundingBox()
  geometry.userData.proceduralShape = 'hip-roof'
  return geometry
}

function refineStructure(THREE, root, objectType) {
  const meshes = collectMeshes(root)
  if (objectType === 'bridge') {
    for (const mesh of meshes) {
      if (['bridge-railing', 'bridge-baluster'].includes(mesh.name)) {
        replaceBoxWithCylinder(THREE, mesh, { radialSegments: 12 })
      }
    }
    return
  }

  const roof = meshes.find(mesh => mesh.name === 'pavilion-roof')
  const cap = meshes.find(mesh => mesh.name === 'pavilion-roof-cap')
  if (!roof || !cap) return
  const p = roof.geometry.parameters
  if (objectType === 'pergola') {
    for (let index = 0; index < 7; index += 1) {
      addBox(THREE, root, 'pavilion-roof-slat',
        { x: p.width / 12, y: 0.08, z: p.depth * 1.02 },
        { x: (index - 3) * p.width / 8, y: roof.position.y + p.height / 2 + 0.04, z: 0 },
        roof.material)
    }
    return
  }

  const post = meshes.find(mesh => mesh.name === 'pavilion-post')
  const rise = Math.max(0.36, post.geometry.parameters.width * 2.8)
  roof.geometry = createHipRoofGeometry(THREE, p.width, p.depth, p.height, rise)
  cap.geometry = new THREE.CylinderGeometry(0.065, 0.09, 0.1, 12)
  cap.position.y = roof.position.y + rise + 0.015
}

function refineBench(THREE, root) {
  const meshes = collectMeshes(root)
  const seat = meshes.find(mesh => mesh.name.startsWith('bench-seat-'))
  const back = meshes.find(mesh => mesh.name === 'bench-back')
  if (!seat || !back) return
  const seatSize = seat.geometry.parameters
  const backSize = back.geometry.parameters
  const seatWidth = seatSize.width
  const seatDepth = seatSize.depth
  const originalSeatCenterY = seat.position.y
  const originalBackCenterY = back.position.y
  seat.geometry = new THREE.BoxGeometry(seatWidth, 0.035, seatDepth * 0.84)
  seat.position.y = seat.position.y - seatSize.height / 2 + 0.0175
  for (let index = 0; index < 4; index += 1) {
    addBox(THREE, root, 'bench-seat-slat',
      { x: seatWidth, y: 0.07, z: seatDepth * 0.22 },
      { x: seat.position.x, y: originalSeatCenterY + 0.02, z: (index - 1.5) * seatDepth * 0.25 },
      seat.material)
  }

  back.geometry = new THREE.BoxGeometry(backSize.width, 0.06, backSize.depth)
  back.position.y = back.position.y - backSize.height / 2 + 0.03
  for (let index = 0; index < 3; index += 1) {
    addBox(THREE, root, 'bench-back-slat',
      { x: backSize.width * 0.98, y: backSize.height * 0.26, z: backSize.depth * 1.08 },
      { x: 0, y: originalBackCenterY + (index - 1) * backSize.height * 0.32, z: back.position.z },
      back.material)
  }
}

function refineLamp(THREE, root) {
  const meshes = collectMeshes(root)
  const pole = meshes.find(mesh => mesh.name === 'lamp-pole')
  const head = meshes.find(mesh => mesh.name === 'lamp-head')
  const emitter = meshes.find(mesh => mesh.name === 'lamp-emitter')
  const p = pole.geometry.parameters
  pole.geometry = new THREE.CylinderGeometry(p.radiusTop, p.radiusBottom, p.height, 12)
  const base = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.12, 0.18, 16), pole.material)
  base.name = 'lamp-pole-base'
  base.position.y = 0.09
  base.castShadow = true
  root.add(base)

  const headSize = head.geometry.parameters
  const shadeRadius = headSize.width * 0.58
  const halfHeight = Math.min(0.18, headSize.height * 0.4)
  const profile = [
    new THREE.Vector2(shadeRadius * 0.3, halfHeight),
    new THREE.Vector2(shadeRadius * 0.44, halfHeight * 0.72),
    new THREE.Vector2(shadeRadius, -halfHeight * 0.78),
    new THREE.Vector2(shadeRadius, -halfHeight),
    new THREE.Vector2(shadeRadius * 0.88, -halfHeight),
    new THREE.Vector2(shadeRadius * 0.82, -halfHeight * 0.68),
    new THREE.Vector2(shadeRadius * 0.32, halfHeight * 0.68),
  ]
  head.geometry = new THREE.LatheGeometry(profile, 18)
  emitter.geometry = new THREE.CylinderGeometry(shadeRadius * 0.62, shadeRadius * 0.62, 0.025, 16)
}

function refineBin(THREE, root) {
  const meshes = collectMeshes(root)
  const body = meshes.find(mesh => mesh.name === 'bin-body')
  const lid = meshes.find(mesh => mesh.name === 'bin-lid')
  replaceBoxWithCylinder(THREE, body, { radialSegments: 18 })
  const lidSize = lid.geometry.parameters
  replaceBoxWithCylinder(THREE, lid, { axis: 'y', radialSegments: 18 })
  const rim = new THREE.Mesh(
    new THREE.TorusGeometry(body.geometry.parameters.radiusTop * 0.94, 0.022, 6, 20),
    lid.material,
  )
  rim.name = 'bin-lid-rim'
  rim.position.y = lid.position.y + lidSize.height / 2
  rim.rotation.x = Math.PI / 2
  rim.castShadow = true
  root.add(rim)
}

function refineSign(THREE, root) {
  const meshes = collectMeshes(root)
  const post = meshes.find(mesh => mesh.name === 'sign-post')
  const board = meshes.find(mesh => mesh.name === 'sign-board')
  const p = post.geometry.parameters
  const boardSize = board.geometry.parameters
  post.geometry = new THREE.CylinderGeometry(p.radiusTop, p.radiusBottom, p.height, 12)
  post.position.x = -boardSize.width * 0.32
  const otherPost = post.clone()
  otherPost.position.x = boardSize.width * 0.32
  root.add(otherPost)

  const frameDepth = Math.max(0.045, boardSize.depth * 1.35)
  const frameWidth = 0.045
  for (const side of [-1, 1]) {
    addBox(THREE, root, 'sign-board-frame',
      { x: boardSize.width + frameWidth, y: frameWidth, z: frameDepth },
      { x: 0, y: board.position.y + side * boardSize.height / 2, z: board.position.z }, post.material)
    addBox(THREE, root, 'sign-board-frame',
      { x: frameWidth, y: boardSize.height, z: frameDepth },
      { x: side * boardSize.width / 2, y: board.position.y, z: board.position.z }, post.material)
  }
}

function refineFacility(THREE, root, objectType) {
  if (objectType === 'bench') refineBench(THREE, root)
  if (objectType === 'lamp') refineLamp(THREE, root)
  if (objectType === 'bin') refineBin(THREE, root)
  if (objectType === 'sign') refineSign(THREE, root)
}

function refineRock(THREE, root) {
  for (const rock of collectMeshes(root)) {
    rock.name = 'rock-body'
    rock.geometry.computeBoundingBox()
    const originalBox = rock.geometry.boundingBox.clone()
    const originalSize = originalBox.getSize(new THREE.Vector3())
    const originalCenter = originalBox.getCenter(new THREE.Vector3())
    let geometry = new THREE.IcosahedronGeometry(rock.geometry.parameters.radius, 2)
    const position = geometry.getAttribute('position')
    for (let index = 0; index < position.count; index += 1) {
      const x = position.getX(index)
      const y = position.getY(index)
      const z = position.getZ(index)
      const variation = 1 + Math.sin(x * 2.3 + y * 0.7) * Math.cos(z * 1.9 - y * 0.4) * 0.12
        + Math.sin(y * 4.1) * 0.05
      position.setXYZ(index, x * variation + y * z * 0.035, y * variation, z * variation)
    }
    position.needsUpdate = true
    geometry.computeBoundingBox()
    const size = geometry.boundingBox.getSize(new THREE.Vector3())
    geometry.scale(originalSize.x / size.x, originalSize.y / size.y, originalSize.z / size.z)
    geometry.computeBoundingBox()
    const center = geometry.boundingBox.getCenter(new THREE.Vector3())
    geometry.translate(originalCenter.x - center.x, originalCenter.y - center.y, originalCenter.z - center.z)
    geometry.computeVertexNormals()
    rock.geometry = bakeGeometry(THREE, geometry, 'asymmetric-rock')
  }
}

function refineFlowerbed(THREE, root) {
  const meshes = collectMeshes(root)
  const soil = meshes.find(mesh => mesh.name === 'flowerbed-soil')
  const flowers = meshes.filter(mesh => !['flowerbed-border', 'flowerbed-soil'].includes(mesh.name))
  const soilTop = soil.position.y + soil.geometry.parameters.height / 2
  for (const flower of flowers) {
    flower.name = 'flowerbed-flower'
    const radius = flower.geometry.parameters.radius
    flower.geometry = new THREE.SphereGeometry(radius, 10, 6)
    root.add(createCylinderBetween(THREE,
      { x: flower.position.x, y: soilTop, z: flower.position.z },
      { x: flower.position.x, y: flower.position.y - radius * 0.25, z: flower.position.z },
      0.012, soil.material, 'flowerbed-flower-stem', 7))
  }
}

function refineDecoration(THREE, root, objectType) {
  if (objectType === 'rock') refineRock(THREE, root)
  if (objectType === 'flowerbed') refineFlowerbed(THREE, root)
}

function refineBasketballHoop(THREE, root) {
  const meshes = collectMeshes(root)
  const support = meshes.find(mesh => mesh.name === 'basketball-support')
  const rim = meshes.find(mesh => mesh.name === 'basketball-rim')
  replaceBoxWithCylinder(THREE, support, { radialSegments: 14 })
  const netMaterial = rim.material.clone()
  netMaterial.color.set('#d7d5c8')
  netMaterial.roughness = 0.9
  const topRadius = rim.geometry.parameters.radius * 0.94
  const bottomRadius = topRadius * 0.56
  for (let index = 0; index < 12; index += 1) {
    const angle = index * Math.PI * 2 / 12
    const nextAngle = angle + 0.16
    root.add(createCylinderBetween(THREE,
      {
        x: rim.position.x + Math.cos(angle) * topRadius,
        y: rim.position.y - 0.025,
        z: rim.position.z + Math.sin(angle) * topRadius,
      },
      {
        x: rim.position.x + Math.cos(nextAngle) * bottomRadius,
        y: rim.position.y - 0.48,
        z: rim.position.z + Math.sin(nextAngle) * bottomRadius,
      },
      0.009, netMaterial, 'basketball-rim-net', 5))
  }
}

/** 内置素材视觉后处理：必须先于 componentId 与碰撞分类运行。 */
export function refineBuiltinAssetVisuals(THREE, root, { category, objectType }) {
  if (category === 'vegetation') {
    if (objectType === 'tree') refineTree(THREE, root)
    if (objectType === 'shrub') refineShrub(THREE, root)
    if (objectType === 'flower') refineFlowers(THREE, root)
  }
  if (category === 'structure') refineStructure(THREE, root, objectType)
  if (category === 'facility') refineFacility(THREE, root, objectType)
  if (category === 'decoration') refineDecoration(THREE, root, objectType)
  if (category === 'sports' && objectType === 'basketball-hoop') refineBasketballHoop(THREE, root)
  if (category === 'campus') refineCampusAssetVisuals(THREE, root, { objectType })
  // 道路长度是连续参数；若进入圆角盒缓存，会按任意长度产生无界几何 Map。
  if (category !== 'road') bevelBoxMeshes(THREE, root)
  smoothMaterials(root)
  return root
}
