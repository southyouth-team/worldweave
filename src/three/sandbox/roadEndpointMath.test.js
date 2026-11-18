import * as THREE from 'three'
import { describe, expect, it } from 'vitest'
import {
  ROAD_LENGTH_LIMITS,
  ROAD_OBJECT_TYPES,
  clampRoadLength,
  getRoadEndpoints,
  isStretchableRoadModel,
  solveRoadEndpointDrag,
} from './roadEndpointMath.js'

function createRoad(objectType = 'asphalt-road', overrides = {}) {
  const root = new THREE.Object3D()
  root.userData.builtinAssetRef = { category: 'road', objectType }
  root.userData.proceduralRoad = {
    version: 1,
    objectType,
    length: 24,
    width: 6,
    ...overrides,
  }
  return root
}

describe('道路长度和参数校验', () => {
  it('长度限制为 2–120m，非有限输入显式拒绝', () => {
    expect(ROAD_LENGTH_LIMITS).toEqual({ min: 2, max: 120 })
    expect(clampRoadLength(2)).toBe(2)
    expect(clampRoadLength(120)).toBe(120)
    expect(clampRoadLength(1.9)).toBe(2)
    expect(clampRoadLength(120.1)).toBe(120)
    expect(clampRoadLength(12.345)).toBe(12.345)
    for (const value of [NaN, Infinity, -Infinity, undefined, null, '12']) {
      expect(() => clampRoadLength(value)).toThrow(TypeError)
    }
  })

  it('只接受四种参数完整且身份一致的道路根', () => {
    expect(ROAD_OBJECT_TYPES).toEqual([
      'asphalt-road', 'concrete-road', 'brick-walkway', 'stone-path',
    ])
    for (const objectType of ROAD_OBJECT_TYPES) {
      expect(isStretchableRoadModel(createRoad(objectType))).toBe(true)
    }
    expect(isStretchableRoadModel(createRoad('gravel-road'))).toBe(false)
    expect(isStretchableRoadModel(null)).toBe(false)
  })

  it.each([
    [{ version: 2 }],
    [{ length: NaN }],
    [{ length: 1.9 }],
    [{ length: 120.1 }],
    [{ width: 0 }],
    [{ width: Infinity }],
  ])('损坏道路参数不进入端点编辑：%j', overrides => {
    expect(isStretchableRoadModel(createRoad('asphalt-road', overrides))).toBe(false)
  })

  it('分类或 objectType 身份不一致时拒绝编辑', () => {
    const wrongCategory = createRoad()
    wrongCategory.userData.builtinAssetRef.category = 'structure'
    expect(isStretchableRoadModel(wrongCategory)).toBe(false)
    const wrongType = createRoad()
    wrongType.userData.builtinAssetRef.objectType = 'concrete-road'
    expect(isStretchableRoadModel(wrongType)).toBe(false)
    const missingRef = createRoad()
    delete missingRef.userData.builtinAssetRef
    expect(isStretchableRoadModel(missingRef)).toBe(false)
  })
})

describe('道路端点数学', () => {
  it('从根 matrixWorld 计算两个端点，而不是读取合批 Mesh', () => {
    const root = createRoad('stone-path', { length: 12, width: 2 })
    root.position.set(10, 0.04, -2)
    root.rotation.y = Math.PI / 2

    const [start, end] = getRoadEndpoints(root)
    expect(start.x).toBeCloseTo(10, 8)
    expect(start.y).toBeCloseTo(0.04, 8)
    expect(start.z).toBeCloseTo(4, 8)
    expect(end.x).toBeCloseTo(10, 8)
    expect(end.y).toBeCloseTo(0.04, 8)
    expect(end.z).toBeCloseTo(-8, 8)
  })

  it('固定另一端，由移动端求真实长度、中心和 Y-only 朝向', () => {
    const result = solveRoadEndpointDrag({
      fixedEnd: { x: 4, z: -3 },
      pointer: { x: 9, z: 2 },
      fallbackDirection: { x: 1, z: 0 },
      rootY: 0.04,
    })
    expect(result.length).toBeCloseTo(Math.sqrt(50), 8)
    expect(result.direction.x).toBeCloseTo(Math.SQRT1_2, 8)
    expect(result.direction.z).toBeCloseTo(Math.SQRT1_2, 8)
    expect(result.movingEnd).toEqual({ x: 9, y: 0.04, z: 2 })
    expect(result.position).toEqual({ x: 6.5, y: 0.04, z: -0.5 })
    expect(result.rotation).toEqual({ x: 0, y: -Math.PI / 4, z: 0 })
    expect(result.scale).toEqual({ x: 1, y: 1, z: 1 })
  })

  it('超过 120m 时移动端和中心停在有效钳制位置', () => {
    const result = solveRoadEndpointDrag({
      fixedEnd: { x: 0, z: 0 },
      pointer: { x: 200, z: 0 },
      fallbackDirection: { x: 1, z: 0 },
      rootY: 0.04,
    })
    expect(result.length).toBe(120)
    expect(result.movingEnd).toEqual({ x: 120, y: 0.04, z: 0 })
    expect(result.position).toEqual({ x: 60, y: 0.04, z: 0 })
  })

  it('零向量沿用拖动前方向并钳制到 2m，所有输出保持有限', () => {
    const result = solveRoadEndpointDrag({
      fixedEnd: { x: 4, z: -3 },
      pointer: { x: 4, z: -3 },
      fallbackDirection: { x: 0, z: 2 },
      rootY: 0.04,
    })
    expect(result.length).toBe(2)
    expect(result.direction).toEqual({ x: 0, z: 1 })
    expect(result.movingEnd).toEqual({ x: 4, y: 0.04, z: -1 })
    expect(result.position).toEqual({ x: 4, y: 0.04, z: -2 })
    expect(result.rotation.y).toBeCloseTo(-Math.PI / 2, 8)
    for (const value of [
      result.length, result.direction.x, result.direction.z,
      result.position.x, result.position.y, result.position.z,
      result.movingEnd.x, result.movingEnd.y, result.movingEnd.z,
      result.rotation.x, result.rotation.y, result.rotation.z,
    ]) expect(Number.isFinite(value)).toBe(true)
  })
})
