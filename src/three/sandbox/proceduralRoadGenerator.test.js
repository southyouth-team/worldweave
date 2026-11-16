import * as THREE from 'three'
import RAPIER from '@dimforge/rapier3d-compat'
import { beforeAll, describe, expect, it } from 'vitest'
import { analyzeModelCollisionCompleteness } from './modelCollisionAnalyzer.js'
import { testModelTraversalRoutes } from './modelTraversalTester.js'
import {
  ROAD_DEFINITIONS,
  createProceduralRoadModel,
} from './proceduralRoadGenerator.js'
import {
  createBuiltinSandboxModel,
  listBuiltinAssets,
} from './builtinAssetAdapter.js'
import { getRoadEndpoints, isStretchableRoadModel } from './roadEndpointMath.js'

beforeAll(async () => {
  await RAPIER.init()
})

const TEST_LENGTHS = [2, undefined, 12.375, 120]

function collectMeshes(root) {
  const meshes = []
  root.traverse(object => {
    if (object.isMesh) meshes.push(object)
  })
  return meshes
}

function triangleCount(root) {
  return collectMeshes(root).reduce((sum, mesh) => {
    const geometry = mesh.geometry
    const count = geometry.index ? geometry.index.count : geometry.attributes.position.count
    return sum + count / 3
  }, 0)
}

function boundsOf(root) {
  root.updateMatrixWorld(true)
  return new THREE.Box3().setFromObject(root)
}

function uniqueSortedX(mesh) {
  const position = mesh.geometry.getAttribute('position')
  return [...new Set(Array.from({ length: position.count }, (_, index) =>
    Number(position.getX(index).toFixed(4))))].sort((a, b) => a - b)
}

function uniqueSortedAxis(mesh, axis) {
  const position = mesh.geometry.getAttribute('position')
  const getter = axis === 'x' ? position.getX.bind(position) : position.getZ.bind(position)
  return [...new Set(Array.from({ length: position.count }, (_, index) =>
    Number(getter(index).toFixed(4))))].sort((a, b) => a - b)
}

function adjacentSpans(values) {
  const spans = []
  for (let index = 1; index < values.length; index += 1) {
    const span = values[index] - values[index - 1]
    if (span > 0.001) spans.push(span)
  }
  return spans
}

function unitSpansOnAxis(mesh, axis) {
  const position = mesh.geometry.getAttribute('position')
  const index = mesh.geometry.index
  const vertexCount = index ? index.count : position.count
  const vertexIdAt = item => (index ? index.getX(item) : item)
  const readAxis = item => (axis === 'x' ? position.getX(item) : position.getZ(item))
  const spans = []
  for (let face = 0; face < vertexCount; face += 3) {
    const ids = [vertexIdAt(face), vertexIdAt(face + 1), vertexIdAt(face + 2)]
    const values = ids.map(readAxis)
    const span = Math.max(...values) - Math.min(...values)
    if (span > 0.001) spans.push(span)
  }
  return [...new Set(spans.map(value => Number(value.toFixed(4))))]
}

function attachTestGround(root) {
  const road = root.userData.proceduralRoad
  const ground = new THREE.Group()
  ground.name = 'test-world-ground'
  ground.userData.componentId = 'test-world-ground'
  ground.userData.collisionPolicy = 'none'
  const mesh = new THREE.Mesh(
    new THREE.BoxGeometry(road.length + 4, 0.2, road.width + 4),
    new THREE.MeshBasicMaterial(),
  )
  mesh.position.y = -0.1
  ground.add(mesh)
  root.add(ground)

  root.userData.proceduralModelCapabilityManifest.capabilities.spatial.surfaces = [{
    id: 'test-world-ground-surface',
    targetPartId: 'test-world-ground',
    shape: 'mesh',
    supportsStanding: true,
    walkable: true,
  }]
  root.userData.proceduralModelCapabilityManifest.capabilities.spatial.traversability = {
    passages: [{
      id: 'test-along-road',
      targetPartId: 'test-world-ground',
      startPoint: { x: -road.length / 2 - 1, y: 0.1, z: 0 },
      endPoint: { x: road.length / 2 + 1, y: 0.1, z: 0 },
    }],
  }
  return root
}

describe('四种可拉扯道路的参数化几何', () => {
  it('导出四种固定宽度和默认长度的道路定义', () => {
    expect(ROAD_DEFINITIONS.map(def => def.objectType)).toEqual([
      'asphalt-road', 'concrete-road', 'brick-walkway', 'stone-path',
    ])
    expect(ROAD_DEFINITIONS.map(def => [def.defaultLength, def.width])).toEqual([
      [24, 6], [20, 4], [16, 2.4], [12, 2],
    ])
    for (const def of ROAD_DEFINITIONS) {
      expect(def.label.length).toBeGreaterThan(0)
      expect(def.width).toBeGreaterThan(0)
    }
  })

  it.each(ROAD_DEFINITIONS.flatMap(def =>
    TEST_LENGTHS.map(length => ({ objectType: def.objectType, width: def.width, length }))))(
    '$objectType 在长度 $length 下包络、有限顶点和道路参数正确',
    ({ objectType, width, length }) => {
      const requestedLength = length ?? ROAD_DEFINITIONS.find(def => def.objectType === objectType).defaultLength
      const root = createProceduralRoadModel(THREE, { objectType, length })
      expect(isStretchableRoadModel(root)).toBe(true)
      expect(root.userData.proceduralRoad).toEqual({
        version: 1, objectType, length: requestedLength, width,
      })
      expect(root.scale.toArray()).toEqual([1, 1, 1])

      const bounds = boundsOf(root)
      const size = bounds.getSize(new THREE.Vector3())
      expect(size.x).toBeCloseTo(requestedLength, 6)
      expect(size.z).toBeCloseTo(width, 6)
      expect(size.y).toBeLessThanOrEqual(0.24)
      expect(bounds.min.x).toBeCloseTo(-requestedLength / 2, 6)
      expect(bounds.max.x).toBeCloseTo(requestedLength / 2, 6)
      expect(bounds.min.y).toBeCloseTo(0, 6)

      collectMeshes(root).forEach(mesh => {
        const position = mesh.geometry.getAttribute('position')
        for (let index = 0; index < position.count; index += 1) {
          expect([position.getX(index), position.getY(index), position.getZ(index)])
            .toEqual([expect.any(Number), expect.any(Number), expect.any(Number)])
          expect(Number.isFinite(position.getX(index))).toBe(true)
          expect(Number.isFinite(position.getY(index))).toBe(true)
          expect(Number.isFinite(position.getZ(index))).toBe(true)
        }
      })
    },
  )

  it('沥青标线使用固定线宽，长度变化只增减线段而不拉伸线宽', () => {
    const shortRoad = createProceduralRoadModel(THREE, { objectType: 'asphalt-road', length: 12.5 })
    const longRoad = createProceduralRoadModel(THREE, { objectType: 'asphalt-road', length: 80 })
    for (const root of [shortRoad, longRoad]) {
      const edge = collectMeshes(root).find(mesh => mesh.name === 'asphalt-edge-line')
      const yellow = collectMeshes(root).find(mesh => mesh.name === 'asphalt-center-yellow')
      const edgeSpansZ = unitSpansOnAxis(edge, 'z')
      const yellowSpansZ = unitSpansOnAxis(yellow, 'z')
      expect(Math.max(...edgeSpansZ)).toBeCloseTo(0.12, 5)
      expect(Math.max(...yellowSpansZ)).toBeCloseTo(0.08, 5)
      expect(yellow.userData.roadFeature).toMatchObject({ unitDepth: 0.08, gap: 0.06 })
      expect(new THREE.Box3().setFromObject(yellow).getSize(new THREE.Vector3()).z).toBeCloseTo(0.22, 5)
      expect(new THREE.Box3().setFromObject(edge).max.x).toBeLessThanOrEqual(root.userData.proceduralRoad.length / 2 + 1e-6)
      expect(new THREE.Box3().setFromObject(yellow).max.x).toBeLessThanOrEqual(root.userData.proceduralRoad.length / 2 + 1e-6)
    }
  })

  it('水泥路伸缩缝保持 4m 间距且末段不越过端面', () => {
    const root = createProceduralRoadModel(THREE, { objectType: 'concrete-road', length: 18.25 })
    const seam = collectMeshes(root).find(mesh => mesh.name === 'concrete-expansion-seam')
    expect(seam.userData.roadFeature).toMatchObject({ spacing: 4, unitDepth: 4 })
    const xs = uniqueSortedX(seam)
    const centers = []
    for (let index = 0; index < xs.length; index += 2) {
      centers.push((xs[index] + xs[index + 1]) / 2)
    }
    expect(centers).toEqual([-8, -4, 0, 4, 8])
    expect(Math.max(...centers) + 0.0175).toBeLessThanOrEqual(18.25 / 2)
    expect(Math.min(...centers) - 0.0175).toBeGreaterThanOrEqual(-18.25 / 2)
  })

  it('砖石采用约 0.6×0.3m 错缝铺装，色差只合并为两个有界 Mesh', () => {
    const root = createProceduralRoadModel(THREE, { objectType: 'brick-walkway', length: 12.75 })
    const bricks = collectMeshes(root).filter(mesh => mesh.name.startsWith('brick-paver-'))
    expect(bricks).toHaveLength(2)
    for (const mesh of bricks) {
      expect(mesh.userData.roadFeature).toMatchObject({ unitLength: 0.6, unitDepth: 0.3 })
      const xSpans = unitSpansOnAxis(mesh, 'x')
      const zSpans = unitSpansOnAxis(mesh, 'z')
      expect(Math.max(...xSpans)).toBeCloseTo(0.6, 5)
      expect(Math.max(...zSpans)).toBeCloseTo(0.3, 5)
    }
  })

  it('石板保持约 1.2m 分段，重复大板按少量色差材质合并', () => {
    const root = createProceduralRoadModel(THREE, { objectType: 'stone-path', length: 13.4 })
    const slabs = collectMeshes(root).filter(mesh => mesh.name.startsWith('stone-slab-'))
    expect(slabs.length).toBeGreaterThan(0)
    expect(slabs.length).toBeLessThanOrEqual(2)
    for (const mesh of slabs) {
      expect(mesh.userData.roadFeature.unitLength).toBeCloseTo(1.2, 5)
      const xSpans = unitSpansOnAxis(mesh, 'x')
      expect(Math.max(...xSpans)).toBeCloseTo(1.2, 5)
      const bounds = new THREE.Box3().setFromObject(mesh)
      expect(bounds.max.x).toBeLessThanOrEqual(13.4 / 2 + 1e-6)
      expect(bounds.min.x).toBeGreaterThanOrEqual(-13.4 / 2 - 1e-6)
    }
  })

  it('默认长度与 120m 的 Mesh 数固定，120m 三角数低于 50,000', () => {
    for (const def of ROAD_DEFINITIONS) {
      const defaultRoad = createProceduralRoadModel(THREE, { objectType: def.objectType })
      const longRoad = createProceduralRoadModel(THREE, { objectType: def.objectType, length: 120 })
      expect(collectMeshes(defaultRoad)).toHaveLength(collectMeshes(longRoad).length)
      expect(collectMeshes(longRoad).length).toBeLessThanOrEqual(5)
      expect(triangleCount(longRoad)).toBeLessThan(50000)
    }
  })

  it('非法道路类型或长度显式拒绝', () => {
    expect(() => createProceduralRoadModel(THREE, { objectType: 'gravel-road', length: 10 })).toThrow()
    expect(createProceduralRoadModel(THREE, { objectType: 'asphalt-road', length: 1 }).userData.proceduralRoad.length).toBe(2)
    expect(() => createProceduralRoadModel(THREE, { objectType: 'asphalt-road', length: NaN })).toThrow(TypeError)
  })
})

describe('道路 adapter、碰撞清单与持久化', () => {
  it('真实 adapter 支持 registry=null，所有道路部件均为 none 且没有 surfaces', () => {
    for (const def of ROAD_DEFINITIONS) {
      const root = createBuiltinSandboxModel(THREE, null, {
        category: 'road',
        objectType: def.objectType,
        parameters: { length: 17.5 },
      })
      const meshes = collectMeshes(root)
      expect(meshes.length).toBeGreaterThan(0)
      expect(new Set(meshes.map(mesh => mesh.userData.componentId)).size).toBe(meshes.length)
      expect(meshes.every(mesh => mesh.userData.collisionPolicy === 'none')).toBe(true)
      const spatial = root.userData.proceduralModelCapabilityManifest.capabilities.spatial
      expect(spatial.colliders).toEqual([])
      expect(spatial.surfaces).toBeUndefined()
      expect(spatial.traversability).toBeUndefined()
      expect(analyzeModelCollisionCompleteness(root).status).toBe('complete')
      expect(root.userData.builtinAssetRef).toEqual({ category: 'road', objectType: def.objectType })
    }
  })

  it('目录在校园地标后追加常规道路，总计 7 类 22 件且旧 16 件键不变', () => {
    const items = listBuiltinAssets()
    expect(items).toHaveLength(22)
    const categories = [...new Set(items.map(item => item.category))]
    expect(categories).toEqual([
      'vegetation', 'structure', 'facility', 'decoration', 'sports', 'campus', 'road',
    ])
    expect(items.slice(-4).map(item => item.objectType)).toEqual(ROAD_DEFINITIONS.map(def => def.objectType))
    for (const key of [
      'vegetation:tree', 'structure:bridge', 'facility:lamp', 'decoration:rock',
      'sports:basketball-hoop', 'campus:east-gate', 'campus:sports-field', 'campus:zhiyuan-building',
    ]) {
      const [category, objectType] = key.split(':')
      expect(items.some(item => item.category === category && item.objectType === objectType)).toBe(true)
    }
  })

  it.each(ROAD_DEFINITIONS)('$objectType 经 toJSON/ObjectLoader 后包络、Mesh 数和端点一致', def => {
    const root = createBuiltinSandboxModel(THREE, null, {
      category: 'road',
      objectType: def.objectType,
      parameters: { length: 15.25 },
    })
    root.position.set(8, 0.04, -3)
    root.rotation.y = Math.PI / 2
    root.updateMatrixWorld(true)
    const expectedBounds = new THREE.Box3().setFromObject(root)
    const expectedEndpoints = getRoadEndpoints(root)
    const expectedMeshes = collectMeshes(root).length

    const restored = new THREE.ObjectLoader().parse(root.toJSON())
    restored.updateMatrixWorld(true)
    const restoredBounds = new THREE.Box3().setFromObject(restored)
    expect(restored.userData.proceduralRoad).toEqual(root.userData.proceduralRoad)
    expect(restored.userData.builtinAssetRef).toEqual(root.userData.builtinAssetRef)
    expect(collectMeshes(restored)).toHaveLength(expectedMeshes)
    for (const axis of ['min', 'max']) {
      for (const coordinate of ['x', 'y', 'z']) {
        const actual = restoredBounds[axis][coordinate]
        const expected = expectedBounds[axis][coordinate]
        if (Math.abs(expected) < 0.1) {
          expect(Math.abs(actual - expected)).toBeLessThan(0.041)
        } else {
          expect(actual).toBeCloseTo(expected, 5)
        }
      }
    }
    const restoredEndpoints = getRoadEndpoints(restored)
    for (const index of [0, 1]) {
      expect(restoredEndpoints[index].distanceTo(expectedEndpoints[index])).toBeLessThan(1e-5)
    }
  })

  it.each(ROAD_DEFINITIONS)('$objectType 的测试地面路线可由真实 Rapier 角色进入、通过并离开', async def => {
    const root = createBuiltinSandboxModel(THREE, null, {
      category: 'road',
      objectType: def.objectType,
      parameters: { length: 10.5 },
    })
    expect(collectMeshes(root).some(mesh => mesh.name === 'test-world-ground')).toBe(false)
    attachTestGround(root)

    const result = await testModelTraversalRoutes(THREE, RAPIER, root, {
      maxDuration: 12,
      speed: 2.5,
    })
    expect(result.routes.find(route => route.id === 'test-along-road')?.status).toBe('passed')
    expect(result.certifiedWalkable).toBe(true)
  })
})
