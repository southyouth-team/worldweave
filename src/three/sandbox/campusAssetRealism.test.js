import * as THREE from 'three'
import RAPIER from '@dimforge/rapier3d-compat'
import { beforeAll, describe, expect, it } from 'vitest'
import { createSceneAssetGeneratorRegistry } from '../world/campus/sceneAssetGeneratorRegistry.js'
import { applyEnvironmentBindings } from '../engine/worldStateRuntime.js'
import { createBuiltinSandboxModel } from './builtinAssetAdapter.js'
import { testModelTraversalRoutes } from './modelTraversalTester.js'

const registry = createSceneAssetGeneratorRegistry(THREE)

beforeAll(async () => {
  await RAPIER.init()
})

function createCampus(objectType) {
  return createBuiltinSandboxModel(THREE, registry, { category: 'campus', objectType })
}

function collectMeshes(root) {
  const meshes = []
  root.traverse(object => {
    if (object.isMesh) meshes.push(object)
  })
  return meshes
}

function boundsSize(object) {
  return new THREE.Box3().setFromObject(object).getSize(new THREE.Vector3())
}

function triangleCount(root) {
  let total = 0
  root.traverse(object => {
    if (!object.isMesh) return
    total += (object.geometry.index?.count ?? object.geometry.getAttribute('position').count) / 3
  })
  return total
}

function addProbeWorldGround(root) {
  const ground = new THREE.Group()
  ground.name = 'test-world-ground'
  ground.userData.componentId = 'test-world-ground'
  ground.userData.collisionPolicy = 'none'
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(100, 0.2, 30), new THREE.MeshBasicMaterial())
  mesh.position.y = -0.11
  ground.add(mesh)
  root.add(ground)
  root.userData.proceduralModelCapabilityManifest.capabilities.spatial.surfaces.push({
    id: 'test-world-ground-surface',
    targetPartId: 'test-world-ground',
    shape: 'mesh',
    supportsStanding: true,
    walkable: true,
  })
}

describe('校园真实感：南工东大门', () => {
  it('三重檐是连续曲面，并有瓦垄、三道拱券和四个门墩底座', () => {
    const meshes = collectMeshes(createCampus('east-gate'))
    const roofs = meshes.filter(mesh => ['gate-roof-center', 'gate-roof-wing'].includes(mesh.name))
    expect(roofs).toHaveLength(3)
    for (const roof of roofs) {
      expect(roof.geometry.type).not.toBe('BoxGeometry')
      const position = roof.geometry.getAttribute('position')
      const levels = new Set()
      for (let index = 0; index < position.count; index += 1) levels.add(position.getY(index).toFixed(4))
      expect(levels.size).toBeGreaterThan(4)
      expect(position.count).toBeGreaterThan(100)
    }
    expect(meshes.filter(mesh => mesh.name === 'gate-roof-tile').length).toBeGreaterThanOrEqual(12)
    expect(meshes.filter(mesh => mesh.name === 'gate-lintel-arch')).toHaveLength(3)
    expect(meshes.filter(mesh => mesh.name === 'gate-pier-base')).toHaveLength(4)
  })

  it('瓦垄中段贴合曲面，而不是在屋檐与屋脊之间悬空拉直', () => {
    const root = createCampus('east-gate')
    root.updateMatrixWorld(true)
    const meshes = collectMeshes(root)
    const roofs = meshes.filter(mesh => ['gate-roof-center', 'gate-roof-wing'].includes(mesh.name))
    const tiles = meshes.filter(mesh => mesh.name === 'gate-roof-tile')
    for (const roof of roofs) {
      roof.geometry.computeBoundingBox()
      const size = roof.geometry.boundingBox.getSize(new THREE.Vector3())
      for (const side of [-1, 1]) {
        const surface = new THREE.Vector3(
          roof.position.x, roof.position.y, roof.position.z + side * size.z * 0.25,
        )
        const raycaster = new THREE.Raycaster(
          surface.clone().add(new THREE.Vector3(0, 3, 0)), new THREE.Vector3(0, -1, 0),
        )
        const roofHit = raycaster.intersectObject(roof, false)[0]
        expect(roofHit).toBeTruthy()
        const tileHit = raycaster.intersectObjects(tiles, false)
          .filter(hit => hit.point.y >= roofHit.point.y - 0.001)
          .sort((a, b) => a.point.y - b.point.y)[0]
        expect(tileHit).toBeTruthy()
        expect(tileHit.point.y - roofHit.point.y).toBeLessThan(0.12)
      }
    }
  })

  it('曲面细节不侵占中央门洞，整体包络保持约 36×13×8m', () => {
    const root = createCampus('east-gate')
    root.updateMatrixWorld(true)
    const opening = new THREE.Box3(new THREE.Vector3(-3.5, 0.2, -4.5), new THREE.Vector3(3.5, 5.5, 4.5))
    const blockers = collectMeshes(root).filter(mesh => mesh.userData.collisionPolicy === 'required')
    for (const blocker of blockers) {
      expect(new THREE.Box3().setFromObject(blocker).intersectsBox(opening)).toBe(false)
    }
    const size = boundsSize(root)
    expect(size.x).toBeCloseTo(36, 0)
    expect(size.y).toBeCloseTo(13, 0)
    expect(size.z).toBeCloseTo(8, 0)
  })
})

describe('校园真实感：天工体育场', () => {
  it('球门改圆管并带网，看台有座椅和弧形顶棚，旗面有真实波浪', () => {
    const meshes = collectMeshes(createCampus('sports-field'))
    const goalposts = meshes.filter(mesh => mesh.name === 'sports-goalpost')
    expect(goalposts.length).toBeGreaterThanOrEqual(6)
    expect(goalposts.every(mesh => mesh.geometry.type === 'CylinderGeometry')).toBe(true)
    expect(meshes.filter(mesh => mesh.name === 'sports-goal-net').length).toBeGreaterThanOrEqual(16)
    expect(meshes.filter(mesh => mesh.name === 'sports-stand-seat').length).toBeGreaterThanOrEqual(32)
    const seats = meshes.filter(mesh => mesh.name === 'sports-stand-seat')
    for (const seat of seats) {
      const position = seat.geometry.getAttribute('position')
      const expectedSeatY = seat.position.y + 0.08
      const hasSeatTop = Array.from({ length: position.count }, (_, index) => position.getY(index) + seat.position.y)
        .some(y => Math.abs(y - expectedSeatY) < 0.0001)
      expect(hasSeatTop).toBe(true)
    }

    const roof = meshes.find(mesh => mesh.name === 'sports-stand-roof')
    roof.geometry.computeBoundingBox()
    expect(roof.geometry.getAttribute('position').count).toBeGreaterThan(100)
    expect(roof.geometry.boundingBox.getSize(new THREE.Vector3()).y).toBeGreaterThan(0.4)

    const flag = meshes.find(mesh => mesh.name === 'sports-flag')
    flag.geometry.computeBoundingBox()
    expect(flag.geometry.boundingBox.getSize(new THREE.Vector3()).z).toBeGreaterThan(0.05)
  })
})

describe('校园真实感：致远楼', () => {
  it('窗带有竖向分格，主入口有门框，36 把椅子都有高出座面的靠背', () => {
    const meshes = collectMeshes(createCampus('zhiyuan-building'))
    expect(meshes.filter(mesh => mesh.name === 'zhiyuan-window-glass-mullion').length).toBeGreaterThanOrEqual(34)
    expect(meshes.filter(mesh => mesh.name === 'zhiyuan-window-glass-door-frame').length).toBeGreaterThanOrEqual(3)
    const chairs = meshes.filter(mesh => mesh.name === 'zhiyuan-chair')
    expect(chairs).toHaveLength(36)
    for (const chair of chairs) {
      chair.geometry.computeBoundingBox()
      expect(chair.geometry.boundingBox.getSize(new THREE.Vector3()).y).toBeGreaterThan(0.6)
      const position = chair.geometry.getAttribute('position')
      const hasSeatTop = Array.from({ length: position.count }, (_, index) => position.getY(index) + chair.position.y)
        .some(y => Math.abs(y - 0.44) < 0.0001)
      expect(hasSeatTop).toBe(true)
    }
    expect(meshes.filter(mesh => mesh.name === 'zhiyuan-desk-top')).toHaveLength(36)
  })

  it('真实 Rapier 主入口、教室正向与实心翼反向路线不回归', async () => {
    const root = createCampus('zhiyuan-building')
    const spatial = root.userData.proceduralModelCapabilityManifest.capabilities.spatial
    spatial.traversability.passages.push({
      id: 'test-solid-wing-entry',
      targetPartId: 'campus-zhiyuan-building-zhiyuan-route-main',
      startPoint: { x: 27, y: 0.1, z: 2.2 },
      endPoint: { x: 10, y: 0.1, z: 2.2 },
    })
    addProbeWorldGround(root)
    const result = await testModelTraversalRoutes(THREE, RAPIER, root, { maxDuration: 10, speed: 2 })
    expect(result.routes.find(route => route.id === 'zhiyuan-main-entry')?.status).toBe('passed')
    expect(result.routes.find(route => route.id === 'zhiyuan-classroom-entry')?.status).toBe('passed')
    expect(result.routes.find(route => route.id === 'test-solid-wing-entry')).toMatchObject({
      status: 'failed', reason: 'blocked-or-stuck',
    })
  })
})

describe('校园真实感：预算与持久化', () => {
  it('三件默认实例合计少于 40000 三角', () => {
    const total = ['east-gate', 'sports-field', 'zhiyuan-building']
      .reduce((sum, objectType) => sum + triangleCount(createCampus(objectType)), 0)
    expect(total).toBeLessThan(40000)
  })

  it.each(['east-gate', 'sports-field', 'zhiyuan-building'])('%s 的曲面与细节经 ObjectLoader 后包络和网格数不变', objectType => {
    const root = createCampus(objectType)
    root.updateMatrixWorld(true)
    const before = boundsSize(root)
    const restored = new THREE.ObjectLoader().parse(root.toJSON())
    restored.updateMatrixWorld(true)
    const after = boundsSize(restored)
    expect(after.x).toBeCloseTo(before.x, 4)
    expect(after.y).toBeCloseTo(before.y, 4)
    expect(after.z).toBeCloseTo(before.z, 4)
    expect(collectMeshes(restored)).toHaveLength(collectMeshes(root).length)

    if (objectType === 'zhiyuan-building') {
      expect(applyEnvironmentBindings(restored, { 'lighting.artificial.enabled': false })).toBe(9)
      const lights = []
      restored.traverse(object => {
        if (object.isPointLight) lights.push(object)
      })
      expect(lights).toHaveLength(3)
      expect(lights.every(light => light.intensity === 0)).toBe(true)
    }
  })
})
