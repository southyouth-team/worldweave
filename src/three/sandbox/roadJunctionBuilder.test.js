import * as THREE from 'three'
import { describe, expect, it } from 'vitest'
import { buildRoadJunctionPatches, clipConvexPolygon, polygonArea } from './roadJunctionBuilder.js'
import { createPolylineRoadModel } from './proceduralRoadGenerator.js'
import { getRoadFootprint } from './roadEndpointMath.js'

function square(minX, minZ, maxX, maxZ) {
  return [
    { x: minX, z: minZ },
    { x: maxX, z: minZ },
    { x: maxX, z: maxZ },
    { x: minX, z: maxZ },
  ]
}

function roadInfo(points, { width = 6, objectType = 'asphalt-road', topY = 0.08 } = {}) {
  const model = createPolylineRoadModel(THREE, { objectType, width, points })
  return { objectType, topY, footprint: getRoadFootprint(model) }
}

function totalArea(patches) {
  return patches.reduce((sum, patch) => sum + patch.polygons
    .reduce((inner, polygon) => inner + polygonArea(polygon), 0), 0)
}

describe('道路路口拼接面', () => {
  it('凸多边形裁剪保留交叠区域', () => {
    const clipped = clipConvexPolygon(square(0, 0, 4, 4), square(2, 2, 6, 6))
    expect(clipped).toHaveLength(4)
    expect(polygonArea(clipped)).toBeCloseTo(4, 6)
  })

  it('十字交叉生成覆盖交叠区的路口面（高于边线与中线）', () => {
    const patches = buildRoadJunctionPatches([
      roadInfo([{ x: -10, z: 0 }, { x: 10, z: 0 }], { width: 6 }),
      roadInfo([{ x: 0, z: -10 }, { x: 0, z: 10 }], { width: 4 }),
    ])
    expect(patches).toHaveLength(1)
    expect(patches[0].y).toBeCloseTo(0.089, 6)
    expect(totalArea(patches)).toBeCloseTo(24, 1)
  })

  it('丁字路口（支路顶到主路身上）同样生成路口面', () => {
    const patches = buildRoadJunctionPatches([
      roadInfo([{ x: -10, z: 0 }, { x: 10, z: 0 }], { width: 6 }),
      roadInfo([{ x: 0, z: 10 }, { x: 0, z: 0 }], { width: 4 }),
    ])
    expect(patches).toHaveLength(1)
    expect(totalArea(patches)).toBeCloseTo(12, 1)
  })

  it('口对口相接（端部略有重叠）也生成路口面', () => {
    const patches = buildRoadJunctionPatches([
      roadInfo([{ x: -10, z: 0 }, { x: 0, z: 0 }], { width: 6 }),
      roadInfo([{ x: -0.5, z: 0 }, { x: 10, z: 0 }], { width: 6 }),
    ])
    expect(patches).toHaveLength(1)
    expect(totalArea(patches)).toBeCloseTo(3, 1)
  })

  it('不相交的道路不生成路口面', () => {
    const patches = buildRoadJunctionPatches([
      roadInfo([{ x: -10, z: 0 }, { x: 10, z: 0 }], { width: 6 }),
      roadInfo([{ x: -10, z: 20 }, { x: 10, z: 20 }], { width: 6 }),
    ])
    expect(patches).toHaveLength(0)
  })
})
