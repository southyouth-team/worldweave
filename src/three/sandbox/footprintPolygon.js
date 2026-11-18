import * as THREE from 'three'

// 占地多边形工具：AI 生成模型前在地块上勾绘的区域，
// 用于生成提示、摆放预览与空间占用判定。

export function polygonArea(points) {
  if (!Array.isArray(points) || points.length < 3) return 0
  let sum = 0
  for (let index = 0; index < points.length; index += 1) {
    const current = points[index]
    const next = points[(index + 1) % points.length]
    sum += current.x * next.z - next.x * current.z
  }
  return Math.abs(sum) / 2
}

export function polygonCentroid(points) {
  if (!Array.isArray(points) || points.length < 3) throw new TypeError('占地多边形至少需要三个点')
  let twiceArea = 0
  let x = 0
  let z = 0
  for (let index = 0; index < points.length; index += 1) {
    const current = points[index]
    const next = points[(index + 1) % points.length]
    const cross = current.x * next.z - next.x * current.z
    twiceArea += cross
    x += (current.x + next.x) * cross
    z += (current.z + next.z) * cross
  }
  if (Math.abs(twiceArea) < 1e-9) {
    const sum = points.reduce((acc, point) => ({ x: acc.x + point.x, z: acc.z + point.z }), { x: 0, z: 0 })
    return { x: sum.x / points.length, z: sum.z / points.length }
  }
  return { x: x / (3 * twiceArea), z: z / (3 * twiceArea) }
}

export function localizePolygon(points) {
  const center = polygonCentroid(points)
  return {
    center,
    points: points.map(point => ({ x: point.x - center.x, z: point.z - center.z })),
  }
}

export function polygonBounds(points) {
  let minX = Infinity
  let maxX = -Infinity
  let minZ = Infinity
  let maxZ = -Infinity
  for (const point of points || []) {
    if (point.x < minX) minX = point.x
    if (point.x > maxX) maxX = point.x
    if (point.z < minZ) minZ = point.z
    if (point.z > maxZ) maxZ = point.z
  }
  if (!Number.isFinite(minX)) return { minX: 0, maxX: 0, minZ: 0, maxZ: 0, width: 0, depth: 0 }
  return { minX, maxX, minZ, maxZ, width: maxX - minX, depth: maxZ - minZ }
}

// 任意简单多边形三角化（支持凹多边形），返回三角形数组 [{x,z}, {x,z}, {x,z}]。
export function triangulatePolygon(points) {
  if (!Array.isArray(points) || points.length < 3) return []
  const contour = points.map(point => new THREE.Vector2(point.x, point.z))
  const faces = THREE.ShapeUtils.triangulateShape(contour, [])
  return faces
    .filter(face => Array.isArray(face) && face.length === 3)
    .map(face => face.map(index => ({ x: points[index].x, z: points[index].z })))
}

// 摆放冲突探针：每个三角面片一个盒，覆盖整个占地多边形。
export function buildFootprintProbes(points, topY) {  const maxY = Math.max(Number(topY) || 0, 0.05)
  const probes = []
  for (const triangle of triangulatePolygon(points)) {
    const xs = triangle.map(point => point.x)
    const zs = triangle.map(point => point.z)
    probes.push(new THREE.Box3(
      new THREE.Vector3(Math.min(...xs), 0, Math.min(...zs)),
      new THREE.Vector3(Math.max(...xs), maxY, Math.max(...zs)),
    ))
  }
  return probes
}

function orientation(a, b, c) {
  const value = (b.x - a.x) * (c.z - a.z) - (b.z - a.z) * (c.x - a.x)
  if (Math.abs(value) < 1e-9) return 0
  return value > 0 ? 1 : -1
}

function onSegment(a, b, point) {
  return point.x >= Math.min(a.x, b.x) - 1e-9 && point.x <= Math.max(a.x, b.x) + 1e-9
    && point.z >= Math.min(a.z, b.z) - 1e-9 && point.z <= Math.max(a.z, b.z) + 1e-9
}

function segmentsIntersect(p1, p2, q1, q2) {
  const o1 = orientation(p1, p2, q1)
  const o2 = orientation(p1, p2, q2)
  const o3 = orientation(q1, q2, p1)
  const o4 = orientation(q1, q2, p2)
  if (o1 !== o2 && o3 !== o4) return true
  if (o1 === 0 && onSegment(p1, p2, q1)) return true
  if (o2 === 0 && onSegment(p1, p2, q2)) return true
  if (o3 === 0 && onSegment(q1, q2, p1)) return true
  if (o4 === 0 && onSegment(q1, q2, p2)) return true
  return false
}

// 按标点顺序连成闭合多边形后，是否有两条不相邻的边交叉（画错顺序/自交）。
export function polygonSelfIntersects(points) {
  if (!Array.isArray(points) || points.length < 4) return false
  const count = points.length
  for (let first = 0; first < count; first += 1) {
    const a1 = points[first]
    const a2 = points[(first + 1) % count]
    for (let second = first + 1; second < count; second += 1) {
      // 跳过相邻边（共享端点）
      if (second === (first + 1) % count || (second + 1) % count === first) continue
      if (segmentsIntersect(a1, a2, points[second], points[(second + 1) % count])) return true
    }
  }
  return false
}
