import * as THREE from 'three'

export const ROAD_LENGTH_LIMITS = Object.freeze({ min: 2, max: 120 })

export const ROAD_OBJECT_TYPES = Object.freeze([
  'asphalt-road',
  'concrete-road',
  'brick-walkway',
  'stone-path',
])

export function clampRoadLength(length) {
  if (typeof length !== 'number' || !Number.isFinite(length)) {
    throw new TypeError('道路长度必须是有限数值')
  }
  return THREE.MathUtils.clamp(length, ROAD_LENGTH_LIMITS.min, ROAD_LENGTH_LIMITS.max)
}

export function isStretchableRoadModel(root) {
  const road = root?.userData?.proceduralRoad
  const ref = root?.userData?.builtinAssetRef
  return Boolean(
    road
    && road.version === 1
    && ROAD_OBJECT_TYPES.includes(road.objectType)
    && typeof road.length === 'number'
    && Number.isFinite(road.length)
    && road.length >= ROAD_LENGTH_LIMITS.min
    && road.length <= ROAD_LENGTH_LIMITS.max
    && typeof road.width === 'number'
    && Number.isFinite(road.width)
    && road.width > 0
    && ref?.category === 'road'
    && ref.objectType === road.objectType
  )
}

export function getRoadEndpoints(root) {
  if (!isStretchableRoadModel(root)) {
    throw new TypeError('无效的道路参数')
  }
  root.updateWorldMatrix(true, false)
  const halfLength = root.userData.proceduralRoad.length / 2
  return [-halfLength, halfLength].map(x => (
    root.localToWorld(new THREE.Vector3(x, 0, 0))
  ))
}

function requireFinitePoint(point, label) {
  if (!Number.isFinite(point?.x) || !Number.isFinite(point?.z)) {
    throw new TypeError(`${label}必须包含有限 X/Z 坐标`)
  }
}

export function solveRoadEndpointDrag({
  fixedEnd,
  pointer,
  fallbackDirection,
  rootY,
}) {
  requireFinitePoint(fixedEnd, '固定端')
  requireFinitePoint(pointer, '指针')
  requireFinitePoint(fallbackDirection, '原方向')
  if (!Number.isFinite(rootY)) throw new TypeError('道路根 Y 必须是有限数值')

  let dx = pointer.x - fixedEnd.x
  let dz = pointer.z - fixedEnd.z
  const distance = Math.hypot(dx, dz)
  if (distance > 0) {
    dx /= distance
    dz /= distance
  } else {
    const fallbackLength = Math.hypot(fallbackDirection.x, fallbackDirection.z)
    if (fallbackLength > 0) {
      dx = fallbackDirection.x / fallbackLength
      dz = fallbackDirection.z / fallbackLength
    } else {
      dx = 1
      dz = 0
    }
  }

  const length = clampRoadLength(distance)
  return {
    length,
    direction: { x: dx, z: dz },
    movingEnd: {
      x: fixedEnd.x + dx * length,
      y: rootY,
      z: fixedEnd.z + dz * length,
    },
    position: {
      x: fixedEnd.x + dx * length / 2,
      y: rootY,
      z: fixedEnd.z + dz * length / 2,
    },
    rotation: { x: 0, y: Math.atan2(-dz, dx), z: 0 },
    scale: { x: 1, y: 1, z: 1 },
  }
}
