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

// ---- 多端点折线道路（version 2 均匀宽 / version 3 逐点宽 / version 4 左右边缘点）----
export const ROAD_SEGMENT_MIN_LENGTH = 1
export const ROAD_MIN_EDGE_SEPARATION = 0.8

export function isPolylineRoadModel(root) {
  const road = root?.userData?.proceduralRoad
  const ref = root?.userData?.builtinAssetRef
  return Boolean(
    road
    && (road.version === 2 || road.version === 3 || road.version === 4)
    && ROAD_OBJECT_TYPES.includes(road.objectType)
    && Array.isArray(road.points)
    && road.points.length >= 2
    && road.points.every(point => {
      if (Number.isFinite(point?.x) && Number.isFinite(point?.z)) return true
      return Number.isFinite(point?.lx) && Number.isFinite(point?.lz)
        && Number.isFinite(point?.rx) && Number.isFinite(point?.rz)
    })
    && typeof road.width === 'number'
    && Number.isFinite(road.width)
    && road.width > 0
    && ref?.category === 'road'
    && ref.objectType === road.objectType
  )
}

// 每条控制点站位的左右边缘点（世界坐标）。
export function getRoadEdgeStations(root) {
  const road = root?.userData?.proceduralRoad
  if (!road) throw new TypeError('无效的道路参数')
  if (road.version === 4) {
    root.updateWorldMatrix?.(true, false)
    const transform = (x, z) => {
      const point = new THREE.Vector3(x, 0, z).applyMatrix4(root.matrixWorld)
      return { x: point.x, z: point.z }
    }
    return road.points.map(point => ({
      left: transform(point.lx, point.lz),
      right: transform(point.rx, point.rz),
    }))
  }
  const stations = getRoadStations(root)
  const normals = getRoadStationNormals(stations)
  return stations.map((station, index) => {
    const hw = Number.isFinite(station.hw) ? station.hw : Number(road.width) / 2
    return {
      left: { x: station.x + normals[index].x * hw, z: station.z + normals[index].z * hw },
      right: { x: station.x - normals[index].x * hw, z: station.z - normals[index].z * hw },
    }
  })
}

export function edgeStationCenter(edgeStation) {
  return {
    x: (edgeStation.left.x + edgeStation.right.x) / 2,
    z: (edgeStation.left.z + edgeStation.right.z) / 2,
  }
}

export function isAnyStretchableRoadModel(root) {
  return isStretchableRoadModel(root) || isPolylineRoadModel(root)
}

// 折线道路的控制点（世界坐标）；直线道路返回两端点世界坐标。
export function getRoadPoints(root) {
  if (isPolylineRoadModel(root)) {
    return getRoadStations(root).map(station => new THREE.Vector3(station.x, root.position.y, station.z))
  }
  if (isStretchableRoadModel(root)) return getRoadEndpoints(root)
  throw new TypeError('无效的道路参数')
}

export function pointsTotalLength(points) {
  const centers = points.map(point => (
    Number.isFinite(point?.x)
      ? { x: point.x, z: point.z }
      : { x: (point.lx + point.rx) / 2, z: (point.lz + point.rz) / 2 }
  ))
  let total = 0
  for (let index = 1; index < centers.length; index += 1) {
    total += Math.hypot(centers[index].x - centers[index - 1].x, centers[index].z - centers[index - 1].z)
  }
  return total
}

// 控制点中心（兼容中心点 {x,z} 与左右边缘点 {lx,lz,rx,rz}）。
function pointCenter(point) {
  if (Number.isFinite(point?.x)) return { x: point.x, z: point.z }
  return { x: (point.lx + point.rx) / 2, z: (point.lz + point.rz) / 2 }
}

function lerpPoint(start, end, t) {
  if (Number.isFinite(start?.lx) && Number.isFinite(end?.lx)) {
    return {
      lx: start.lx + (end.lx - start.lx) * t,
      lz: start.lz + (end.lz - start.lz) * t,
      rx: start.rx + (end.rx - start.rx) * t,
      rz: start.rz + (end.rz - start.rz) * t,
    }
  }
  const point = { x: start.x + (end.x - start.x) * t, z: start.z + (end.z - start.z) * t }
  if (Number.isFinite(start.hw) && Number.isFinite(end.hw)) {
    point.hw = start.hw + (end.hw - start.hw) * t
  }
  return point
}

// 在最长的线段中点插入一个控制点；返回新数组，不改原数组。
export function insertRoadMidpoint(points) {
  if (!Array.isArray(points) || points.length < 2) throw new TypeError('折线道路至少需要两个控制点')
  let bestIndex = 0
  let bestLength = -1
  for (let index = 1; index < points.length; index += 1) {
    const prev = pointCenter(points[index - 1])
    const next = pointCenter(points[index])
    const length = Math.hypot(next.x - prev.x, next.z - prev.z)
    if (length > bestLength) {
      bestLength = length
      bestIndex = index
    }
  }
  const midpoint = lerpPoint(points[bestIndex - 1], points[bestIndex], 0.5)
  return [...points.slice(0, bestIndex), midpoint, ...points.slice(bestIndex)]
}

/**
 * 添加断点：
 * - 直线道路（两个控制点）一次性给出四个控制点（两端 + 1/3、2/3 两个内部点），
 *   用户直接拖动边缘手柄就能把路拉弯；
 * - 折线道路在最长一段中点再加一个断点。
 */
export function insertRoadBreakpoints(points) {
  if (!Array.isArray(points) || points.length < 2) throw new TypeError('道路至少需要两个控制点')
  if (points.length === 2) {
    const [start, end] = points
    return [start, lerpPoint(start, end, 1 / 3), lerpPoint(start, end, 2 / 3), end]
  }
  return insertRoadMidpoint(points)
}

// 删除一个控制点（保持至少两个）；默认删最后一个，优先删线段最短的内部点。
export function removeRoadPoint(points, index = null) {
  if (!Array.isArray(points) || points.length <= 2) throw new TypeError('折线道路至少保留两个控制点')
  const target = index === null || index === undefined ? points.length - 1 : index
  if (!Number.isInteger(target) || target < 0 || target >= points.length) throw new TypeError('控制点索引无效')
  return points.filter((_, itemIndex) => itemIndex !== target)
}

/**
 * 在离目标位置最近的线段上插入“一个”控制点（点在线上投影处），
 * 兼容中心点与左右边缘点两种格式，保持左右缘插值比例。
 */
export function insertRoadBreakpointAt(points, target) {
  if (!Array.isArray(points) || points.length < 2) throw new TypeError('折线道路至少需要两个控制点')
  requireFinitePoint(target, '断点位置')
  let bestIndex = 1
  let bestT = 0.5
  let bestDistance = Infinity
  for (let index = 1; index < points.length; index += 1) {
    const start = pointCenter(points[index - 1])
    const end = pointCenter(points[index])
    const dx = end.x - start.x
    const dz = end.z - start.z
    const lengthSquared = dx * dx + dz * dz
    const t = lengthSquared > 1e-9
      ? THREE.MathUtils.clamp(((target.x - start.x) * dx + (target.z - start.z) * dz) / lengthSquared, 0, 1)
      : 0.5
    const distance = Math.hypot(target.x - (start.x + dx * t), target.z - (start.z + dz * t))
    if (distance < bestDistance) {
      bestDistance = distance
      bestIndex = index
      bestT = t
    }
  }
  const inserted = lerpPoint(points[bestIndex - 1], points[bestIndex], bestT)
  return [...points.slice(0, bestIndex), inserted, ...points.slice(bestIndex)]
}

// 单段长度限制校验：相邻控制点过近视为无效。
export function areRoadPointsValid(points) {
  if (!Array.isArray(points) || points.length < 2) return false
  const centers = points.map(point => (
    Number.isFinite(point?.x)
      ? { x: point.x, z: point.z }
      : (Number.isFinite(point?.lx) && Number.isFinite(point?.rx)
        ? { x: (point.lx + point.rx) / 2, z: (point.lz + point.rz) / 2 }
        : null)
  ))
  if (centers.some(center => !center)) return false
  return centers.every((center, index) => {
    if (index === 0) return true
    return Math.hypot(center.x - centers[index - 1].x, center.z - centers[index - 1].z) >= ROAD_SEGMENT_MIN_LENGTH
  })
}

// ---- 绘制道路：端点吸附与自动接合 ----
export const ROAD_POINT_SNAP_RADIUS = 2.5

// 新端点若落在已有道路控制点附近，直接吸到那个点上（为自动接合做准备）。
export function snapRoadPointToExisting(point, candidates, radius = ROAD_POINT_SNAP_RADIUS) {
  if (!Number.isFinite(point?.x) || !Number.isFinite(point?.z)) throw new TypeError('道路端点必须包含有限 X/Z 坐标')
  let best = null
  let bestDistance = Infinity
  for (const candidate of candidates || []) {
    if (!Number.isFinite(candidate?.x) || !Number.isFinite(candidate?.z)) continue
    const distance = Math.hypot(candidate.x - point.x, candidate.z - point.z)
    if (distance <= radius && distance < bestDistance) {
      best = candidate
      bestDistance = distance
    }
  }
  return best
    ? { x: best.x, z: best.z, snapped: true }
    : { x: point.x, z: point.z, snapped: false }
}

// 合并两段控制点序列：仅当端点重合（容差内）时按正确顺序拼接，否则返回 null。
export function mergeRoadPointSequences(existing, added, tolerance = 0.02) {
  if (!Array.isArray(existing) || existing.length < 2 || !Array.isArray(added) || added.length < 2) return null
  const same = (a, b) => Math.hypot(a.x - b.x, a.z - b.z) <= tolerance
  const eStart = existing[0]
  const eEnd = existing[existing.length - 1]
  const aStart = added[0]
  const aEnd = added[added.length - 1]
  if (same(eEnd, aStart)) return [...existing, ...added.slice(1)]
  if (same(eEnd, aEnd)) return [...existing, ...added.slice(0, -1).reverse()]
  if (same(eStart, aEnd)) return [...added, ...existing.slice(1)]
  if (same(eStart, aStart)) return [...added.slice(1).reverse(), ...existing]
  return null
}

// ---- 边缘手柄：把控制点放在路的左右边缘，拖动边缘时路跟着变 ----
export const ROAD_EDGE_HALF_WIDTH_LIMITS = Object.freeze({ min: 0.5, max: 10 })

// 道路控制点（中心线 + 每点半宽，世界坐标）；直线道路由两端点推导。
export function getRoadStations(root) {
  const road = root?.userData?.proceduralRoad
  if (road?.version === 4) {
    root.updateWorldMatrix?.(true, false)
    const transform = (x, z) => {
      const point = new THREE.Vector3(x, 0, z).applyMatrix4(root.matrixWorld)
      return { x: point.x, z: point.z }
    }
    return road.points.map(point => {
      const left = transform(point.lx, point.lz)
      const right = transform(point.rx, point.rz)
      return {
        x: (left.x + right.x) / 2,
        z: (left.z + right.z) / 2,
        hw: Math.hypot(right.x - left.x, right.z - left.z) / 2,
      }
    })
  }
  if (isPolylineRoadModel(root)) {
    const uniformHalf = Number(road.width) / 2
    return road.points.map(point => ({
      x: point.x,
      z: point.z,
      hw: Number.isFinite(point.hw) ? point.hw : uniformHalf,
    }))
  }
  if (isStretchableRoadModel(root)) {
    const uniformHalf = Number(root.userData.proceduralRoad.width) / 2
    return getRoadEndpoints(root).map(point => ({ x: point.x, z: point.z, hw: uniformHalf }))
  }
  throw new TypeError('无效的道路参数')
}

function clampHalfWidth(value) {
  return THREE.MathUtils.clamp(value, ROAD_EDGE_HALF_WIDTH_LIMITS.min, ROAD_EDGE_HALF_WIDTH_LIMITS.max)
}

// 每个控制点的单位法线：取相邻线段法线的平均值（端点用相邻段法线）。
export function getRoadStationNormals(stations) {
  const normals = []
  for (let index = 0; index < stations.length; index += 1) {
    const prev = stations[Math.max(0, index - 1)]
    const next = stations[Math.min(stations.length - 1, index + 1)]
    let dx = next.x - prev.x
    let dz = next.z - prev.z
    const length = Math.hypot(dx, dz)
    if (length > 1e-6) { dx /= length; dz /= length } else { dx = 1; dz = 0 }
    // 左手边法线
    normals.push({ x: -dz, z: dx })
  }
  return normals
}

// 边缘手柄世界坐标：每个控制点左右两个边缘点（直线道路共四个）。
export function getRoadEdgeHandles(root) {
  const edgeStations = getRoadEdgeStations(root)
  const handles = []
  edgeStations.forEach((station, stationIndex) => {
    handles.push({ stationIndex, side: 'left', x: station.left.x, z: station.left.z })
    handles.push({ stationIndex, side: 'right', x: station.right.x, z: station.right.z })
  })
  return handles
}

/**
 * 拖动某个边缘手柄：直接移动该控制点对应一侧的边缘点（角点跟手），
 * 另一侧边缘保持不动；两边缘过近时沿拖动方向夹到最小间距。
 */
export function solveRoadEdgeDrag({ edgeStations, stationIndex, side, pointer }) {
  if (!Array.isArray(edgeStations) || edgeStations.length < 2) throw new TypeError('道路至少需要两个控制点')
  if (!Number.isInteger(stationIndex) || stationIndex < 0 || stationIndex >= edgeStations.length) {
    throw new TypeError('控制点索引无效')
  }
  if (side !== 'left' && side !== 'right') throw new TypeError('边缘方向必须是 left 或 right')
  requireFinitePoint(pointer, '指针')
  const points = edgeStations.map(station => ({
    left: { x: station.left.x, z: station.left.z },
    right: { x: station.right.x, z: station.right.z },
  }))
  const target = points[stationIndex]
  let moving = { x: pointer.x, z: pointer.z }
  const anchor = side === 'left' ? target.right : target.left
  const separation = Math.hypot(moving.x - anchor.x, moving.z - anchor.z)
  if (separation < ROAD_MIN_EDGE_SEPARATION) {
    const dx = separation > 1e-6 ? (moving.x - anchor.x) / separation : 1
    const dz = separation > 1e-6 ? (moving.z - anchor.z) / separation : 0
    moving = {
      x: anchor.x + dx * ROAD_MIN_EDGE_SEPARATION,
      z: anchor.z + dz * ROAD_MIN_EDGE_SEPARATION,
    }
  }
  if (side === 'left') target.left = moving
  else target.right = moving
  const widths = points.map(station => Math.hypot(
    station.right.x - station.left.x,
    station.right.z - station.left.z,
  ))
  return {
    points: points.map(station => ({
      lx: station.left.x,
      lz: station.left.z,
      rx: station.right.x,
      rz: station.right.z,
    })),
    edgeStations: points,
    width: Math.max(...widths),
    movingEdge: moving,
  }
}

/**
 * 整体平移某个控制截面（中心手柄）：左右路缘一起移动，宽度和朝向保持不变。
 * 返回新数组，不改原数组。
 */
export function translateRoadStation(edgeStations, stationIndex, delta) {
  if (!Array.isArray(edgeStations) || edgeStations.length < 2) throw new TypeError('道路至少需要两个控制点')
  if (!Number.isInteger(stationIndex) || stationIndex < 0 || stationIndex >= edgeStations.length) {
    throw new TypeError('控制点索引无效')
  }
  requireFinitePoint(delta, '平移量')
  return edgeStations.map((station, index) => {
    if (index !== stationIndex) {
      return { left: { x: station.left.x, z: station.left.z }, right: { x: station.right.x, z: station.right.z } }
    }
    return {
      left: { x: station.left.x + delta.x, z: station.left.z + delta.z },
      right: { x: station.right.x + delta.x, z: station.right.z + delta.z },
    }
  })
}

// ---- 弧度：左右路缘各自做单调三次插值，控制点位置保持不变 ----
export const ROAD_CURVE_SUBDIVISIONS = 8

function monotoneTangents(values) {
  const last = values.length - 1
  const slopes = []
  for (let index = 0; index < last; index += 1) slopes.push(values[index + 1] - values[index])
  const tangents = [slopes[0]]
  for (let index = 1; index < last; index += 1) tangents.push((slopes[index - 1] + slopes[index]) / 2)
  tangents.push(slopes[last - 1])
  for (let index = 0; index < last; index += 1) {
    if (slopes[index] === 0) {
      tangents[index] = 0
      tangents[index + 1] = 0
      continue
    }
    const alpha = tangents[index] / slopes[index]
    const beta = tangents[index + 1] / slopes[index]
    const magnitude = alpha * alpha + beta * beta
    if (magnitude > 9) {
      const scale = 3 / Math.sqrt(magnitude)
      tangents[index] = scale * alpha * slopes[index]
      tangents[index + 1] = scale * beta * slopes[index]
    }
  }
  return tangents
}

// 逐坐标单调三次插值（Fritsch–Carlson）：经过控制点、C1 连续，
// 且每个坐标都不会冲过相邻控制点的范围——转弯处不会鼓到路外。
function sampleMonotoneChain(values, subdivisions) {
  if (values.length < 3) return values.slice()
  const tangents = monotoneTangents(values)
  const samples = []
  for (let index = 0; index < values.length - 1; index += 1) {
    for (let step = 0; step < subdivisions; step += 1) {
      const t = step / subdivisions
      const t2 = t * t
      const t3 = t2 * t
      samples.push(
        (2 * t3 - 3 * t2 + 1) * values[index]
        + (t3 - 2 * t2 + t) * tangents[index]
        + (-2 * t3 + 3 * t2) * values[index + 1]
        + (t3 - t2) * tangents[index + 1],
      )
    }
  }
  samples.push(values[values.length - 1])
  return samples
}

/**
 * 把控制点边缘序列平滑成连续路缘：三个以上控制点时在每段之间插值出弧度，
 * 两个控制点时原样返回（直线不带弯）。
 *
 * 左右路缘各自独立插值：拖哪一侧就只改哪一侧的曲线，对面路缘逐点保持不变；
 * 插值用单调三次曲线，不会冲过控制点范围，转弯处不会一侧鼓包。
 */
export function smoothRoadEdgeStations(stations, { subdivisions = ROAD_CURVE_SUBDIVISIONS } = {}) {
  if (!Array.isArray(stations) || stations.length < 2) throw new TypeError('道路至少需要两个控制点')
  if (stations.length < 3) {
    return stations.map(station => ({
      left: { x: station.left.x, z: station.left.z },
      right: { x: station.right.x, z: station.right.z },
    }))
  }
  const steps = Math.max(1, Math.floor(Number(subdivisions) || ROAD_CURVE_SUBDIVISIONS))
  const leftX = sampleMonotoneChain(stations.map(station => station.left.x), steps)
  const leftZ = sampleMonotoneChain(stations.map(station => station.left.z), steps)
  const rightX = sampleMonotoneChain(stations.map(station => station.right.x), steps)
  const rightZ = sampleMonotoneChain(stations.map(station => station.right.z), steps)
  return leftX.map((x, index) => ({
    left: { x, z: leftZ[index] },
    right: { x: rightX[index], z: rightZ[index] },
  }))
}

/**
 * 道路占地轮廓（世界坐标）：沿平滑后的左右路缘给出两条链，
 * 左链正向 + 右链反向即闭合多边形 —— 占地/选择轮廓都按道路形状而不是包围盒。
 */
export function getRoadFootprint(root) {
  const outline = smoothRoadEdgeStations(getRoadEdgeStations(root))
  return {
    left: outline.map(station => ({ x: station.left.x, z: station.left.z })),
    right: outline.map(station => ({ x: station.right.x, z: station.right.z })),
  }
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
