import { describe, expect, it } from 'vitest'
import {
  buildFootprintProbes,
  localizePolygon,
  polygonArea,
  polygonBounds,
  polygonCentroid,
  polygonSelfIntersects,
  triangulatePolygon,
} from './footprintPolygon.js'

const square = [
  { x: 10, z: 10 },
  { x: 14, z: 10 },
  { x: 14, z: 14 },
  { x: 10, z: 14 },
]

// L 形：20×20 去掉右上角 8×8 的缺口
const lShape = [
  { x: 0, z: 0 },
  { x: 20, z: 0 },
  { x: 20, z: 12 },
  { x: 12, z: 12 },
  { x: 12, z: 20 },
  { x: 0, z: 20 },
]

function triangleArea(triangle) {
  const [a, b, c] = triangle
  return Math.abs((b.x - a.x) * (c.z - a.z) - (c.x - a.x) * (b.z - a.z)) / 2
}

describe('占地多边形工具', () => {
  it('计算面积与重心，并把多边形移到以重心为原点的局部坐标', () => {
    expect(polygonArea(square)).toBeCloseTo(16, 6)
    expect(polygonArea(lShape)).toBeCloseTo(20 * 20 - 8 * 8, 6)
    const center = polygonCentroid(square)
    expect(center.x).toBeCloseTo(12, 6)
    expect(center.z).toBeCloseTo(12, 6)

    const localized = localizePolygon(square)
    expect(localized.center).toEqual({ x: 12, z: 12 })
    expect(localized.points[0]).toEqual({ x: -2, z: -2 })
    expect(localized.points[2]).toEqual({ x: 2, z: 2 })
  })

  it('给出多边形包围盒尺寸', () => {
    const bounds = polygonBounds(square)
    expect(bounds).toMatchObject({ minX: 10, maxX: 14, minZ: 10, maxZ: 14, width: 4, depth: 4 })
  })

  it('三角化后三角形面积之和等于多边形面积（含凹多边形）', () => {
    for (const polygon of [square, lShape]) {
      const triangles = triangulatePolygon(polygon)
      expect(triangles.length).toBe(polygon.length - 2)
      const total = triangles.reduce((sum, triangle) => sum + triangleArea(triangle), 0)
      expect(total).toBeCloseTo(polygonArea(polygon), 6)
    }
  })

  it('为摆放冲突生成覆盖多边形的三角探针', () => {
    const probes = buildFootprintProbes(lShape, 0.2)
    expect(probes).toHaveLength(lShape.length - 2)
    const inside = { x: 6, z: 6 }
    expect(probes.some(probe => inside.x >= probe.min.x && inside.x <= probe.max.x
      && inside.z >= probe.min.z && inside.z <= probe.max.z)).toBe(true)
  })

  it('识别自相交的轮廓（按标点顺序连边后交叉）', () => {
    expect(polygonSelfIntersects(square)).toBe(false)
    expect(polygonSelfIntersects(lShape)).toBe(false)
    const bowtie = [
      { x: 0, z: 0 },
      { x: 10, z: 10 },
      { x: 10, z: 0 },
      { x: 0, z: 10 },
    ]
    expect(polygonSelfIntersects(bowtie)).toBe(true)
  })
})
