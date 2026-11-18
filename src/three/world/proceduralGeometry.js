import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js'

const roundedBoxCache = new Map()
const cylinderCache = new Map()
const replacementCylinderCache = new Map()
const cacheOwnedGeometry = Symbol('cacheOwnedProceduralGeometry')

/** 缓存几何由模块持有；模型/合批只释放自己独占的几何，避免跨实例提前释放。 */
export function disposeOwnedGeometry(geometry) {
  if (geometry && !geometry[cacheOwnedGeometry]) geometry.dispose?.()
}

function retainInCache(cache, key, geometry) {
  geometry[cacheOwnedGeometry] = true
  cache.set(key, geometry)
  return geometry
}

/** 将盒状杆件换为圆柱，方向由 Mesh 四元数表达，保证 ObjectLoader 与碰撞变换可还原。 */
export function replaceBoxWithCylinder(THREE, mesh, options = {}) {
  if (mesh.geometry?.type !== 'BoxGeometry') {
    throw new Error(`圆柱替换需要 BoxGeometry：${mesh.name || '(未命名)'}`)
  }
  const { width, height, depth } = mesh.geometry.parameters
  const dimensions = { x: width, y: height, z: depth }
  const axis = options.axis ?? Object.entries(dimensions).sort((a, b) => b[1] - a[1])[0][0]
  const crossAxes = ['x', 'y', 'z'].filter(candidate => candidate !== axis)
  const radius = options.radius ?? Math.max(...crossAxes.map(candidate => dimensions[candidate])) / 2
  const length = dimensions[axis]
  const radialSegments = options.radialSegments ?? 12
  const key = [radius, length, radialSegments].join(':')
  let geometry = replacementCylinderCache.get(key)
  if (!geometry) {
    geometry = new THREE.CylinderGeometry(radius, radius, length, radialSegments, 1)
    retainInCache(replacementCylinderCache, key, geometry)
  }
  mesh.geometry = geometry
  if (axis === 'x') {
    mesh.quaternion.multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), -Math.PI / 2))
  } else if (axis === 'z') {
    mesh.quaternion.multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), Math.PI / 2))
  }
  return mesh
}

/**
 * 将实体直角盒替换为一段圆角盒；几何按尺寸共享，Mesh 的名称、变换和材质不变。
 * options.filter 可排除不应圆角化的特殊部件。
 */
export function bevelBoxMeshes(THREE, root, options = {}) {
  const radiusLimit = options.radius ?? 0.08
  const segments = options.segments ?? 1
  const meshes = []
  root.traverse(object => {
    if (object.isMesh && object.geometry?.type === 'BoxGeometry'
      && (!options.filter || options.filter(object))) {
      meshes.push(object)
    }
  })

  for (const mesh of meshes) {
    const { width, height, depth } = mesh.geometry.parameters
    const shortest = Math.min(width, height, depth)
    const radius = Math.max(0.0001, Math.min(radiusLimit, shortest * 0.22))
    const key = [width, height, depth, segments, radius].join(':')
    let geometry = roundedBoxCache.get(key)
    if (!geometry) {
      const rounded = new RoundedBoxGeometry(width, height, depth, segments, radius)
      // ObjectLoader 核心只认识内置几何；烘焙成标准 BufferGeometry 才能存档往返。
      geometry = new THREE.BufferGeometry()
      geometry.copy(rounded)
      geometry.userData.proceduralShape = 'rounded-box'
      geometry.computeBoundingBox()
      rounded.dispose()
      retainInCache(roundedBoxCache, key, geometry)
    }
    mesh.geometry = geometry
  }
  return root
}

/** 创建两点之间的圆柱杆件，几何长度直接烘焙，避免依赖 Mesh.scale 表达碰撞尺寸。 */
export function createCylinderBetween(
  THREE, start, end, radius, material, name, radialSegments = 12,
) {
  const from = new THREE.Vector3(start.x, start.y, start.z)
  const to = new THREE.Vector3(end.x, end.y, end.z)
  const direction = to.clone().sub(from)
  const length = direction.length()
  if (!(length > 0) || !(radius > 0)) {
    throw new Error('圆柱杆件需要正长度与正半径')
  }
  const key = [radius, length, radialSegments].join(':')
  let geometry = cylinderCache.get(key)
  if (!geometry) {
    geometry = new THREE.CylinderGeometry(radius * 0.78, radius, length, radialSegments, 1)
    retainInCache(cylinderCache, key, geometry)
  }
  const mesh = new THREE.Mesh(geometry, material)
  mesh.name = name
  mesh.position.copy(from).add(to).multiplyScalar(0.5)
  mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction.normalize())
  mesh.castShadow = true
  mesh.receiveShadow = true
  return mesh
}
