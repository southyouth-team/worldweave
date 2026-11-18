// 道路路口拼接：两条路的占地重叠区域生成一块铺装面，
// 盖住交叠处的边线/中线，让“口对口”和“口接路身”的交接区域自然过渡。

function footprintQuads(footprint) {
  const quads = []
  for (let index = 1; index < footprint.left.length; index += 1) {
    quads.push([
      footprint.left[index - 1],
      footprint.right[index - 1],
      footprint.right[index],
      footprint.left[index],
    ])
  }
  return quads
}

function signedArea(points) {
  let sum = 0
  for (let index = 0; index < points.length; index += 1) {
    const current = points[index]
    const next = points[(index + 1) % points.length]
    sum += current.x * next.z - next.x * current.z
  }
  return sum / 2
}

function boundsOf(points) {
  let minX = Infinity
  let maxX = -Infinity
  let minZ = Infinity
  let maxZ = -Infinity
  for (const point of points) {
    if (point.x < minX) minX = point.x
    if (point.x > maxX) maxX = point.x
    if (point.z < minZ) minZ = point.z
    if (point.z > maxZ) maxZ = point.z
  }
  return { minX, maxX, minZ, maxZ }
}

function boundsOverlap(a, b) {
  return a.minX <= b.maxX + 1e-6 && a.maxX >= b.minX - 1e-6
    && a.minZ <= b.maxZ + 1e-6 && a.maxZ >= b.minZ - 1e-6
}

export function polygonArea(points) {
  return Math.abs(signedArea(points))
}

function segmentIntersection(a, b, p, q) {
  const rx = b.x - a.x
  const rz = b.z - a.z
  const sx = q.x - p.x
  const sz = q.z - p.z
  const denominator = rx * sz - rz * sx
  if (Math.abs(denominator) < 1e-12) return { x: p.x, z: p.z }
  const t = ((p.x - a.x) * sz - (p.z - a.z) * sx) / denominator
  return { x: a.x + rx * t, z: a.z + rz * t }
}

/**
 * Sutherland–Hodgman：用凸多边形 clip 裁剪 subject，返回交叠多边形（可能为空）。
 * 用于把一段道路面片裁到另一条路的占地范围内。
 */
export function clipConvexPolygon(subject, clip) {
  if (!Array.isArray(subject) || subject.length < 3) return []
  if (!Array.isArray(clip) || clip.length < 3) return []
  const polygon = signedArea(clip) >= 0 ? clip : [...clip].reverse()
  let output = subject.map(point => ({ x: point.x, z: point.z }))
  for (let index = 0; index < polygon.length && output.length; index += 1) {
    const a = polygon[index]
    const b = polygon[(index + 1) % polygon.length]
    const inside = point => (b.x - a.x) * (point.z - a.z) - (b.z - a.z) * (point.x - a.x) >= -1e-9
    const input = output
    output = []
    let previous = input[input.length - 1]
    let previousInside = inside(previous)
    for (const current of input) {
      const currentInside = inside(current)
      if (currentInside !== previousInside) {
        output.push(segmentIntersection(a, b, previous, current))
      }
      if (currentInside) output.push(current)
      previous = current
      previousInside = currentInside
    }
  }
  return output
}

/**
 * 计算所有道路两两之间的路口拼接面。
 * @param {Array<{objectType: string, topY: number, footprint: {left: Array, right: Array}}>} roads
 * @returns {Array<{objectType: string, y: number, polygons: Array<Array<{x: number, z: number}>>}>}
 */
export function buildRoadJunctionPatches(roads) {
  const entries = (roads || [])
    .filter(road => Array.isArray(road?.footprint?.left) && road.footprint.left.length >= 2)
    .map(road => {
      const points = [...road.footprint.left, ...road.footprint.right]
      return {
        ...road,
        quads: footprintQuads(road.footprint),
        bounds: boundsOf(points),
      }
    })
  const patches = []
  for (let first = 0; first < entries.length; first += 1) {
    for (let second = first + 1; second < entries.length; second += 1) {
      const a = entries[first]
      const b = entries[second]
      if (!boundsOverlap(a.bounds, b.bounds)) continue
      const polygons = []
      for (const quadA of a.quads) {
        const quadBounds = boundsOf(quadA)
        if (!boundsOverlap(quadBounds, b.bounds)) continue
        for (const quadB of b.quads) {
          if (!boundsOverlap(quadBounds, boundsOf(quadB))) continue
          const clipped = clipConvexPolygon(quadA, quadB)
          if (clipped.length >= 3 && polygonArea(clipped) > 1e-4) polygons.push(clipped)
        }
      }
      if (!polygons.length) continue
      const top = a.topY >= b.topY ? a : b
      patches.push({
        objectType: top.objectType,
        // 高于边线（+0.004）与柏油中线（+0.007），路口面盖住内部标线
        y: Math.max(a.topY, b.topY) + 0.009,
        polygons,
      })
    }
  }
  return patches
}
