import * as THREE from 'three'
import RAPIER from '@dimforge/rapier3d-compat'
import { beforeAll, describe, expect, it } from 'vitest'
import { createSceneAssetGeneratorRegistry } from '../world/campus/sceneAssetGeneratorRegistry.js'
import { createEastGate, createSportsField, createZhiyuanBuilding } from '../world/campus/ncgxyLandmarkGenerators.js'
import { testModelTraversalRoutes } from './modelTraversalTester.js'
import { applyEnvironmentBindings } from '../engine/worldStateRuntime.js'
import { analyzeModelCollisionCompleteness } from './modelCollisionAnalyzer.js'
import {
  BUILTIN_ASSET_CATALOG,
  BUILTIN_ASSET_LABELS,
  BUILTIN_CATEGORY_LABELS,
  createBuiltinSandboxModel,
  listBuiltinAssets,
} from './builtinAssetAdapter.js'

const registry = createSceneAssetGeneratorRegistry(THREE)

beforeAll(async () => {
  await RAPIER.init()
})

function collectTaggedParts(root) {
  const parts = []
  root.traverse(object => {
    if (object.isMesh && object.userData.componentId) parts.push(object)
  })
  return parts
}

// 分析器的部件概念包含 Mesh 之外的对象（如 PointLight），按 componentId 全量计数
function countTaggedComponents(root) {
  let count = 0
  root.traverse(object => {
    if (object.userData.componentId) count += 1
  })
  return count
}

function colliderTargetIds(root) {
  return (root.userData.proceduralModelCapabilityManifest.capabilities.spatial.colliders || [])
    .map(declaration => declaration.targetPartId)
}

describe('内置素材目录与标签', () => {
  it('只暴露 7 类 20 个规范英文 objectType，别名全部去重，每个条目有中文标签', () => {
    const items = listBuiltinAssets()
    expect(items).toHaveLength(20)
    expect(Object.keys(BUILTIN_CATEGORY_LABELS)).toEqual([
      'vegetation', 'structure', 'facility', 'decoration', 'sports', 'campus', 'road',
    ])
    const keys = items.map(item => `${item.category}:${item.objectType}`)
    expect(new Set(keys).size).toBe(20)
    for (const item of items) {
      expect(item.objectType).toMatch(/^[a-z][a-z0-9-]*$/)
      expect(BUILTIN_ASSET_LABELS[`${item.category}:${item.objectType}`]).toBe(item.label)
      expect(typeof item.label).toBe('string')
      expect(item.label.length).toBeGreaterThan(0)
    }
    expect(BUILTIN_ASSET_CATALOG.every(entry => ['vegetation', 'structure', 'facility', 'decoration', 'sports', 'campus', 'road'].includes(entry.category))).toBe(true)
  })

  it('对未覆盖类别（water/terrain）与未知 objectType 显式报错而非静默生成', () => {
    expect(() => createBuiltinSandboxModel(THREE, registry, { category: 'water', objectType: 'lake' }))
      .toThrow('暂不支持')
    expect(() => createBuiltinSandboxModel(THREE, registry, { category: 'vegetation', objectType: 'spaceship' }))
      .toThrow('暂不支持')
  })
})

describe('createBuiltinSandboxModel 部件标注', () => {
  it('乔木：树干 required 且绑定正数 box，树冠全部 none，根 userData 身份字段齐全', () => {
    const root = createBuiltinSandboxModel(THREE, registry, { category: 'vegetation', objectType: 'tree' })
    const parts = collectTaggedParts(root)
    const trunk = parts.find(part => part.name === 'vegetation-trunk')
    expect(trunk.userData.collisionPolicy).toBe('required')

    const targets = colliderTargetIds(root)
    expect(targets).toContain(trunk.userData.componentId)
    const trunkCollider = root.userData.proceduralModelCapabilityManifest.capabilities.spatial.colliders
      .find(declaration => declaration.targetPartId === trunk.userData.componentId)
    expect(trunkCollider.shape).toBe('box')
    expect(trunkCollider.center).toEqual({ x: 0, y: 0, z: 0 })
    for (const axis of ['x', 'y', 'z']) {
      expect(trunkCollider.size[axis]).toBeGreaterThan(0)
      expect(Number.isFinite(trunkCollider.size[axis])).toBe(true)
    }

    const crowns = parts.filter(part => part.name.startsWith('vegetation-crown'))
    expect(crowns.length).toBeGreaterThan(0)
    expect(crowns.every(part => part.userData.collisionPolicy === 'none')).toBe(true)
    expect(crowns.some(part => targets.includes(part.userData.componentId))).toBe(false)

    expect(root.userData.assetName).toBe(BUILTIN_ASSET_LABELS['vegetation:tree'])
    expect(root.userData.proceduralModelSource).toBeNull()
    expect(root.userData.builtinAssetRef).toEqual({ category: 'vegetation', objectType: 'tree' })
    expect(root.userData.sceneAsset).toBeTruthy()
  })

  it('灌木与花卉：全部部件 none，colliders 为空数组', () => {
    for (const objectType of ['shrub', 'flower']) {
      const root = createBuiltinSandboxModel(THREE, registry, { category: 'vegetation', objectType })
      const parts = collectTaggedParts(root)
      expect(parts.length).toBeGreaterThan(0)
      expect(parts.every(part => part.userData.collisionPolicy === 'none')).toBe(true)
      expect(root.userData.proceduralModelCapabilityManifest.capabilities.spatial.colliders).toEqual([])
    }
  })

  it('篮球架：支柱 required，篮板与篮筐 none', () => {
    const root = createBuiltinSandboxModel(THREE, registry, { category: 'sports', objectType: 'basketball-hoop' })
    const parts = collectTaggedParts(root)
    const support = parts.find(part => part.name === 'basketball-support')
    const backboard = parts.find(part => part.name === 'basketball-backboard')
    const rim = parts.find(part => part.name === 'basketball-rim')
    expect(support.userData.collisionPolicy).toBe('required')
    expect(backboard.userData.collisionPolicy).toBe('none')
    expect(rim.userData.collisionPolicy).toBe('none')
    expect(colliderTargetIds(root)).toEqual([support.userData.componentId])
  })

  it('componentId 在同一模型内全局唯一，且每个被标注 Mesh 都有显式 collisionPolicy', () => {
    const root = createBuiltinSandboxModel(THREE, registry, { category: 'structure', objectType: 'bridge' })
    const parts = collectTaggedParts(root)
    const ids = parts.map(part => part.userData.componentId)
    expect(new Set(ids).size).toBe(ids.length)
    expect(parts.every(part => ['required', 'none'].includes(part.userData.collisionPolicy))).toBe(true)
    // 桥的重复命名部件（baluster）序号化后各自有独立碰撞声明
    const balusters = parts.filter(part => part.name === 'bridge-baluster')
    expect(balusters.length).toBeGreaterThan(1)
    expect(new Set(balusters.map(part => part.userData.componentId)).size).toBe(balusters.length)
  })
})

describe('内置素材真实比例（以 1.7m 玩家为基准）', () => {
  // 真人尺寸包络（米）：取校园场景常见真实规格的宽容区间，防止生成器默认 2m 立方回归。
  const REALISTIC_ENVELOPES = {
    'vegetation:tree': { width: [2.4, 4.5], height: [4.5, 7], depth: [2.4, 4.5] },
    'vegetation:shrub': { width: [0.8, 1.8], height: [0.7, 1.4], depth: [0.8, 1.8] },
    'vegetation:flower': { width: [1.4, 2.2], height: [0.35, 0.8], depth: [0.45, 1.0] },
    'structure:bridge': { width: [5, 8], height: [1.0, 1.8], depth: [2, 3.5] },
    'structure:pergola': { width: [2.5, 4], height: [2.5, 3.6], depth: [2.5, 4] },
    'structure:pavilion': { width: [2.5, 4], height: [2.5, 3.6], depth: [2.5, 4] },
    'facility:bench': { width: [1.5, 2.4], height: [0.75, 1.1], depth: [0.5, 1.0] },
    // 灯杆/牌面本身就是细薄构件，宽度下界按真实灯杆与牌面厚度校准
    'facility:lamp': { width: [0.2, 1.0], height: [3.2, 4.2], depth: [0.2, 1.0] },
    'facility:bin': { width: [0.4, 0.8], height: [0.8, 1.3], depth: [0.4, 0.8] },
    'facility:sign': { width: [0.7, 1.3], height: [1.8, 2.4], depth: [0.05, 0.6] },
    'decoration:rock': { width: [1.0, 2.0], height: [0.6, 1.2], depth: [0.8, 1.6] },
    'decoration:flowerbed': { width: [1.6, 2.6], height: [0.4, 0.8], depth: [0.8, 1.4] },
    'sports:basketball-hoop': { width: [1.7, 3.2], height: [4.2, 5.2], depth: [1.0, 1.8] },
    // 校园地标为估算尺寸 ±15%（spec §4）
    'campus:east-gate': { width: [30.6, 41.4], height: [11.05, 14.95], depth: [6.8, 9.2] },
    'campus:sports-field': { width: [158.1, 213.9], height: [10.2, 13.8], depth: [85, 115] },
    'campus:zhiyuan-building': { width: [68, 92], height: [17.85, 24.15], depth: [13.6, 18.4] },
    'road:asphalt-road': { width: [23.5, 24.5], height: [0.01, 0.24], depth: [5.8, 6.2] },
    'road:concrete-road': { width: [19.5, 20.5], height: [0.01, 0.24], depth: [3.8, 4.2] },
    'road:brick-walkway': { width: [15.5, 16.5], height: [0.01, 0.24], depth: [2.2, 2.6] },
    'road:stone-path': { width: [11.5, 12.5], height: [0.01, 0.24], depth: [1.8, 2.2] },
  }

  it.each(BUILTIN_ASSET_CATALOG)('$category/$objectType 的包围盒落在真实尺寸区间', ({ category, objectType }) => {
    const root = createBuiltinSandboxModel(THREE, registry, { category, objectType })
    const size = new THREE.Box3().setFromObject(root).getSize(new THREE.Vector3())
    const envelope = REALISTIC_ENVELOPES[`${category}:${objectType}`]
    expect(size.x).toBeGreaterThanOrEqual(envelope.width[0])
    expect(size.x).toBeLessThanOrEqual(envelope.width[1])
    expect(size.y).toBeGreaterThanOrEqual(envelope.height[0])
    expect(size.y).toBeLessThanOrEqual(envelope.height[1])
    expect(size.z).toBeGreaterThanOrEqual(envelope.depth[0])
    expect(size.z).toBeLessThanOrEqual(envelope.depth[1])
  })

  it('篮球架篮筐高度为真实篮筐 3.05m（允许 ±0.1m 造型误差），明显高于 1.7m 玩家', () => {
    const root = createBuiltinSandboxModel(THREE, registry, { category: 'sports', objectType: 'basketball-hoop' })
    const rim = collectTaggedParts(root).find(part => part.name === 'basketball-rim')
    expect(rim).toBeTruthy()
    const worldPosition = rim.getWorldPosition(new THREE.Vector3())
    expect(worldPosition.y).toBeGreaterThan(2.95)
    expect(worldPosition.y).toBeLessThan(3.15)
  })

  it('乔木高度至少为玩家身高（1.7m）的 2.8 倍，形成真实树冠压迫感', () => {
    const root = createBuiltinSandboxModel(THREE, registry, { category: 'vegetation', objectType: 'tree' })
    const height = new THREE.Box3().setFromObject(root).getSize(new THREE.Vector3()).y
    expect(height).toBeGreaterThan(1.7 * 2.8)
  })
})

describe('真实碰撞完整性分析器全量门禁', () => {
  it.each(listBuiltinAssets())('$category/$objectType 达到 complete 且零 issue，部件数与全量 componentId 标注数一致', ({ category, objectType }) => {
    const root = createBuiltinSandboxModel(THREE, registry, { category, objectType })
    const report = analyzeModelCollisionCompleteness(root)

    // 含非 Mesh 部件（如路灯 PointLight）的完整部件视图，与分析器口径一致
    expect(report.summary.componentCount).toBe(countTaggedComponents(root))
    expect(report.issues).toEqual([])
    expect(report.status).toBe('complete')
    expect(report.canRegisterDeclaredColliders).toBe(true)
  })

  it('门禁前提：漏标 collisionPolicy 的部件会被分析器判为 needs-review，而不是静默通过', () => {
    const root = createBuiltinSandboxModel(THREE, registry, { category: 'vegetation', objectType: 'tree' })
    const trunk = collectTaggedParts(root).find(part => part.name === 'vegetation-trunk')
    // 仅在本测试构造的对象上模拟「适配层漏标」，不影响其他用例
    delete trunk.userData.collisionPolicy

    const report = analyzeModelCollisionCompleteness(root)
    expect(report.issues.some(issue => issue.code === 'collision.policy.unclassified')).toBe(true)
    expect(report.status).not.toBe('complete')
  })
})

describe('内置路灯接入人工灯光环境总开关', () => {
  function createLamp() {
    return createBuiltinSandboxModel(THREE, registry, { category: 'facility', objectType: 'lamp' })
  }

  function findPointLight(root) {
    let light = null
    root.traverse(object => {
      if (object.isPointLight) light = object
    })
    return light
  }

  it('路灯含真实 PointLight，带 componentId 与 collisionPolicy none，位置对齐发光体', () => {
    const root = createLamp()
    const light = findPointLight(root)
    expect(light).toBeTruthy()
    expect(light.isLight).toBe(true)
    expect(typeof light.userData.componentId).toBe('string')
    expect(light.userData.componentId.length).toBeGreaterThan(0)
    expect(light.userData.collisionPolicy).toBe('none')

    const emitter = collectTaggedParts(root).find(part => part.name === 'lamp-emitter')
    expect(emitter).toBeTruthy()
    root.updateMatrixWorld(true)
    const lightPosition = light.getWorldPosition(new THREE.Vector3())
    const emitterPosition = emitter.getWorldPosition(new THREE.Vector3())
    expect(lightPosition.distanceTo(emitterPosition)).toBeLessThan(0.35)
  })

  it('根 userData 声明 intensity 与 visible 两条环境绑定，目标部件可被解析', () => {
    const root = createLamp()
    const bindings = root.userData.proceduralModelEnvironmentBindings
    expect(Array.isArray(bindings)).toBe(true)

    const light = findPointLight(root)
    const emitter = collectTaggedParts(root).find(part => part.name === 'lamp-emitter')
    const intensityBinding = bindings.find(binding =>
      binding.property === 'intensity' && binding.variable === 'lighting.artificial.enabled')
    const visibleBinding = bindings.find(binding =>
      binding.property === 'visible' && binding.variable === 'lighting.artificial.enabled')

    expect(intensityBinding?.targetPartId).toBe(light.userData.componentId)
    expect(intensityBinding.enabledValue).toBeGreaterThan(0)
    expect(intensityBinding.disabledValue).toBe(0)
    expect(intensityBinding.defaultValue).toBe(true)
    expect(visibleBinding?.targetPartId).toBe(emitter.userData.componentId)
    expect(visibleBinding.defaultValue).toBe(true)
  })

  it('驱动真实 applyEnvironmentBindings：总开关关闭灯光与发光体，开启恢复', () => {
    const root = createLamp()
    const light = findPointLight(root)
    const emitter = collectTaggedParts(root).find(part => part.name === 'lamp-emitter')
    const initialIntensity = light.intensity
    expect(initialIntensity).toBeGreaterThan(0)

    expect(applyEnvironmentBindings(root, { 'lighting.artificial.enabled': false })).toBe(2)
    expect(light.intensity).toBe(0)
    expect(emitter.visible).toBe(false)

    applyEnvironmentBindings(root, { 'lighting.artificial.enabled': true })
    expect(light.intensity).toBe(initialIntensity)
    expect(emitter.visible).toBe(true)
  })

  it('未提供全局值时按 defaultValue 渲染为开启（新放置路灯默认亮）', () => {
    const root = createLamp()
    const light = findPointLight(root)
    light.intensity = 0

    applyEnvironmentBindings(root, {})
    expect(light.intensity).toBeGreaterThan(0)
  })

  it('其余内置素材不带环境绑定与灯光接线（改动仅限路灯与致远楼）', () => {
    for (const entry of listBuiltinAssets()) {
      if (entry.objectType === 'lamp' || entry.objectType === 'zhiyuan-building') continue
      const root = createBuiltinSandboxModel(THREE, registry, entry)
      expect(root.userData.proceduralModelEnvironmentBindings).toBeUndefined()
      expect(findPointLight(root)).toBeNull()
    }
  })
})

describe('南工东大门（校园地标）', () => {
  const EAST_GATE_DIMENSIONS = { width: 36, height: 13, depth: 8 }

  function createGate() {
    return createBuiltinSandboxModel(THREE, registry, { category: 'campus', objectType: 'east-gate' })
  }

  it('门墩 required 且绑定 box，屋顶/匾额/门楣 none，目录带中文标签与 note', () => {
    const root = createGate()
    const parts = collectTaggedParts(root)
    const piers = parts.filter(part => part.name === 'gate-pier')
    const bases = parts.filter(part => part.name === 'gate-pier-base')
    expect(piers.length).toBe(4)
    expect(bases.length).toBe(4)
    const targets = colliderTargetIds(root)
    for (const pier of [...piers, ...bases]) {
      expect(pier.userData.collisionPolicy).toBe('required')
      expect(targets).toContain(pier.userData.componentId)
    }
    const decorative = parts.filter(part => /^(gate-roof|gate-plaque|gate-lintel)/.test(part.name))
    expect(decorative.length).toBeGreaterThanOrEqual(4)
    expect(decorative.every(part => part.userData.collisionPolicy === 'none')).toBe(true)
    expect(root.userData.sceneAsset).toBeTruthy()
    const entry = listBuiltinAssets().find(item => item.objectType === 'east-gate')
    expect(entry.label).toBe('南工东大门')
    expect(entry.note).toBe('古典三重檐门楼，中央拱门可穿行')
  })

  it('中央拱门净空：required 部件的世界包围盒均不与门洞区域相交', () => {
    const root = createGate()
    root.updateMatrixWorld(true)
    const archOpening = new THREE.Box3(
      new THREE.Vector3(-3.5, 0.2, -4.5),
      new THREE.Vector3(3.5, 5.5, 4.5),
    )
    const blockers = collectTaggedParts(root).filter(part => part.userData.collisionPolicy === 'required')
    expect(blockers.length).toBeGreaterThan(0)
    for (const part of blockers) {
      const bounds = new THREE.Box3().setFromObject(part)
      expect(bounds.intersectsBox(archOpening)).toBe(false)
    }
  })

  it('Node 无 canvas 环境：匾额降级为无字黑匾且不抛错', () => {
    const root = createGate()
    const plaque = collectTaggedParts(root).find(part => part.name === 'gate-plaque')
    expect(plaque).toBeTruthy()
    expect(plaque.material.map).toBeFalsy()
  })

  it('注入假 2D 上下文：匾额使用 CanvasTexture 并书写「南昌工学院」', () => {
    const texts = []
    const ctx = {
      fillStyle: '', font: '', textAlign: '', textBaseline: '',
      fillRect() {},
      fillText(text) { texts.push(String(text)) },
      measureText: text => ({ width: String(text).length * 64 }),
    }
    const canvas = { width: 0, height: 0, getContext: () => ctx }
    const fakeDocument = { createElement: tag => (tag === 'canvas' ? canvas : {}) }
    const root = createEastGate(THREE, EAST_GATE_DIMENSIONS, { document: fakeDocument })
    let plaque = null
    root.traverse(object => { if (object.name === 'gate-plaque') plaque = object })
    expect(plaque).toBeTruthy()
    expect(plaque.material.map).toBeTruthy()
    expect(plaque.material.map.image).toBe(canvas)
    expect(texts).toContain('南昌工学院')
  })
})

describe('天工体育场（校园地标）', () => {
  function createField() {
    return createBuiltinSandboxModel(THREE, registry, { category: 'campus', objectType: 'sports-field' })
  }

  it('跑道外沿约 176×92m、厚度不超过 0.2m，足球场为 105×68m', () => {
    const root = createField()
    root.updateMatrixWorld(true)
    const parts = collectTaggedParts(root)
    const trackSize = new THREE.Box3()
      .setFromObject(parts.find(part => part.name === 'sports-track'))
      .getSize(new THREE.Vector3())
    expect(trackSize.x).toBeGreaterThanOrEqual(174)
    expect(trackSize.x).toBeLessThanOrEqual(178)
    expect(trackSize.z).toBeGreaterThanOrEqual(90)
    expect(trackSize.z).toBeLessThanOrEqual(94)
    expect(trackSize.y).toBeLessThanOrEqual(0.2)

    const pitchSize = new THREE.Box3()
      .setFromObject(parts.find(part => part.name === 'sports-pitch'))
      .getSize(new THREE.Vector3())
    expect(pitchSize.x).toBeGreaterThanOrEqual(104.5)
    expect(pitchSize.x).toBeLessThanOrEqual(105.5)
    expect(pitchSize.z).toBeGreaterThanOrEqual(67.5)
    expect(pitchSize.z).toBeLessThanOrEqual(68.5)
  })

  it('可行走薄层与顶棚全部 none，球门/看台实心体/旗杆 required 且有 box', () => {
    const root = createField()
    const parts = collectTaggedParts(root)
    const nonePrefixes = [
      'sports-track', 'sports-lane-line', 'sports-pitch', 'sports-pitch-line',
      'sports-flag', 'sports-stand-roof',
    ]
    for (const prefix of nonePrefixes) {
      // 完整名匹配，避免 sports-flag 把 required 的 sports-flagpole 一并选中
      const matches = parts.filter(part => part.name === prefix)
      expect(matches.length).toBeGreaterThan(0)
      expect(matches.every(part => part.userData.collisionPolicy === 'none')).toBe(true)
    }

    const targets = colliderTargetIds(root)
    for (const prefix of ['sports-goalpost', 'sports-stand-step', 'sports-flagpole']) {
      const matches = parts.filter(part => part.name.startsWith(prefix))
      expect(matches.length).toBeGreaterThan(0)
      for (const part of matches) {
        expect(part.userData.collisionPolicy).toBe('required')
        expect(targets).toContain(part.userData.componentId)
      }
    }
  })

  it('目录标注真实 400m 操场并在放置前提示先扩地', () => {
    const entry = listBuiltinAssets().find(item => item.objectType === 'sports-field')
    expect(entry.label).toBe('天工体育场（操场）')
    expect(entry.note).toBe('真实 400m 操场，占地约 186×100 米，需先扩地再放置')
    expect(createSportsField).toBeTypeOf('function')
  })
})

describe('致远楼（一楼教室与真实通行）', () => {
  function createBuilding() {
    return createBuiltinSandboxModel(THREE, registry, { category: 'campus', objectType: 'zhiyuan-building' })
  }

  // 隔离探针没有沙盒世界地面。注入顶面 -0.01m 的测试地面，衔接楼内 0m 地板；
  // 它只属于测试场景，不进入生成器产物，也不参与素材包络/碰撞完整性用例。
  function addProbeWorldGround(root) {
    const ground = new THREE.Group()
    ground.name = 'test-world-ground'
    ground.userData.componentId = 'test-world-ground'
    ground.userData.collisionPolicy = 'none'
    const mesh = new THREE.Mesh(
      new THREE.BoxGeometry(100, 0.2, 30),
      new THREE.MeshBasicMaterial(),
    )
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

  it('外观/家具部件分类正确，3 间教室共 36 桌 36 椅、3 讲台 3 黑板', () => {
    const root = createBuilding()
    const parts = collectTaggedParts(root)
    const targets = colliderTargetIds(root)
    for (const prefix of ['zhiyuan-wing', 'zhiyuan-colonnade', 'zhiyuan-desk', 'zhiyuan-chair', 'zhiyuan-podium']) {
      const matches = parts.filter(part => part.name === prefix)
      expect(matches.length).toBeGreaterThan(0)
      for (const part of matches) {
        expect(part.userData.collisionPolicy).toBe('required')
        expect(targets).toContain(part.userData.componentId)
      }
    }
    for (const prefix of ['zhiyuan-glass-canopy', 'zhiyuan-blackboard', 'zhiyuan-window-glass', 'zhiyuan-lamptube', 'zhiyuan-floor']) {
      const matches = parts.filter(part => part.name === prefix)
      expect(matches.length).toBeGreaterThan(0)
      expect(matches.every(part => part.userData.collisionPolicy === 'none')).toBe(true)
    }
    expect(parts.filter(part => part.name === 'zhiyuan-desk')).toHaveLength(36)
    expect(parts.filter(part => part.name === 'zhiyuan-chair')).toHaveLength(36)
    expect(parts.filter(part => part.name === 'zhiyuan-podium')).toHaveLength(3)
    expect(parts.filter(part => part.name === 'zhiyuan-blackboard')).toHaveLength(3)
    expect(parts.filter(part => part.name === 'zhiyuan-lamptube')).toHaveLength(6)

    const entry = listBuiltinAssets().find(item => item.objectType === 'zhiyuan-building')
    expect(entry.label).toBe('致远楼（教学楼）')
    expect(entry.note).toBe('一楼可进入，含 3 间教室，灯光受人工灯光总开关控制')
    expect(createZhiyuanBuilding).toBeTypeOf('function')
  })

  it('z=3.4 走廊前侧有左右实心墙，仅保留连接主入口的中央通道', () => {
    const root = createBuilding()
    const targets = colliderTargetIds(root)
    const walls = collectTaggedParts(root)
      .filter(part => part.name === 'zhiyuan-corridor-wall')
      .sort((a, b) => a.position.x - b.position.x)

    expect(walls).toHaveLength(2)
    const spans = walls.map(part => {
      const bounds = new THREE.Box3().setFromObject(part)
      expect(part.userData.collisionPolicy).toBe('required')
      expect(targets).toContain(part.userData.componentId)
      expect(bounds.min.z).toBeCloseTo(3.3, 5)
      expect(bounds.max.z).toBeCloseTo(3.5, 5)
      expect(bounds.min.y).toBeCloseTo(0, 5)
      expect(bounds.max.y).toBeCloseTo(3.6, 5)
      return [bounds.min.x, bounds.max.x]
    })
    expect(spans[0][0]).toBeCloseTo(-18, 5)
    expect(spans[0][1]).toBeCloseTo(-1.5, 5)
    expect(spans[1][0]).toBeCloseTo(1.5, 5)
    expect(spans[1][1]).toBeCloseTo(18, 5)
  })

  it('清单声明地板与两条路线，Rapier 角色可经主入口进走廊并进入教室', async () => {
    const root = createBuilding()
    const spatial = root.userData.proceduralModelCapabilityManifest.capabilities.spatial
    expect(spatial.surfaces).toEqual(expect.arrayContaining([
      expect.objectContaining({ shape: 'mesh', supportsStanding: true, walkable: true }),
    ]))
    expect(spatial.traversability.passages).toEqual(expect.arrayContaining([
      {
        id: 'zhiyuan-main-entry',
        targetPartId: 'campus-zhiyuan-building-zhiyuan-route-main',
        startPoint: { x: 0, y: 0.1, z: 10.5 },
        endPoint: { x: 0, y: 0.1, z: 2.2 },
      },
      {
        id: 'zhiyuan-classroom-entry',
        targetPartId: 'campus-zhiyuan-building-zhiyuan-route-classroom',
        startPoint: { x: -4.5, y: 0.1, z: 2.2 },
        endPoint: { x: -4.5, y: 0.1, z: -2.5 },
      },
    ]))

    addProbeWorldGround(root)
    const result = await testModelTraversalRoutes(THREE, RAPIER, root, { maxDuration: 10, speed: 2 })
    expect(result.routes.find(route => route.id === 'zhiyuan-main-entry')?.status).toBe('passed')
    expect(result.routes.find(route => route.id === 'zhiyuan-classroom-entry')?.status).toBe('passed')
    expect(result.certifiedWalkable).toBe(true)
  })

  it('反向路线不能从实心未开放翼穿入走廊', async () => {
    const root = createBuilding()
    const passages = root.userData.proceduralModelCapabilityManifest.capabilities.spatial.traversability.passages
    passages.push({
      id: 'test-solid-wing-entry',
      targetPartId: 'campus-zhiyuan-building-zhiyuan-route-main',
      startPoint: { x: 27, y: 0.1, z: 2.2 },
      endPoint: { x: 10, y: 0.1, z: 2.2 },
    })
    addProbeWorldGround(root)
    const result = await testModelTraversalRoutes(THREE, RAPIER, root, { maxDuration: 10, speed: 2 })
    expect(result.routes.find(route => route.id === 'test-solid-wing-entry')).toMatchObject({
      status: 'failed',
      reason: 'blocked-or-stuck',
    })
    expect(result.certifiedWalkable).toBe(false)
  })
})

describe('致远楼教室灯光接人工灯光总开关', () => {
  function createLitBuilding() {
    return createBuiltinSandboxModel(THREE, registry, { category: 'campus', objectType: 'zhiyuan-building' })
  }

  function findPointLights(root) {
    const lights = []
    root.traverse(object => { if (object.isPointLight) lights.push(object) })
    return lights
  }

  function findLamptubes(root) {
    return collectTaggedParts(root).filter(part => part.name === 'zhiyuan-lamptube')
  }

  it('3 个 PointLight 位于三间教室，均有 componentId、none 策略且关闭阴影', () => {
    const lights = findPointLights(createLitBuilding())
    expect(lights).toHaveLength(3)
    expect(lights.map(light => light.position.x).sort((a, b) => a - b)).toEqual([-13.5, -4.5, 4.5])
    for (const light of lights) {
      expect(light.name).toBe('zhiyuan-light')
      expect(light.position.y).toBeCloseTo(3.1)
      expect(light.position.z).toBeCloseTo(-2.5)
      expect(light.castShadow).toBe(false)
      expect(light.userData.componentId).toMatch(/^campus-zhiyuan-building-zhiyuan-light-\d+$/)
      expect(light.userData.collisionPolicy).toBe('none')
    }
  })

  it('根 userData 含 3 条 intensity 与 6 条 visible 绑定，目标全部可解析', () => {
    const root = createLitBuilding()
    const bindings = root.userData.proceduralModelEnvironmentBindings
    expect(bindings).toHaveLength(9)
    const intensity = bindings.filter(binding => binding.property === 'intensity')
    const visible = bindings.filter(binding => binding.property === 'visible')
    expect(intensity).toHaveLength(3)
    expect(visible).toHaveLength(6)
    expect(new Set(intensity.map(binding => binding.targetPartId)))
      .toEqual(new Set(findPointLights(root).map(light => light.userData.componentId)))
    expect(new Set(visible.map(binding => binding.targetPartId)))
      .toEqual(new Set(findLamptubes(root).map(tube => tube.userData.componentId)))
    for (const binding of bindings) {
      expect(binding.variable).toBe('lighting.artificial.enabled')
      expect(binding.defaultValue).toBe(true)
      expect(binding.enabledValue).toBe(binding.property === 'intensity' ? 1.6 : true)
      expect(binding.disabledValue).toBe(binding.property === 'intensity' ? 0 : false)
    }
  })

  it('真实 applyEnvironmentBindings 关闭全部光源与灯管，重新开启后恢复', () => {
    const root = createLitBuilding()
    const lights = findPointLights(root)
    const tubes = findLamptubes(root)
    expect(applyEnvironmentBindings(root, { 'lighting.artificial.enabled': false })).toBe(9)
    expect(lights.every(light => light.intensity === 0)).toBe(true)
    expect(tubes.every(tube => tube.visible === false)).toBe(true)

    applyEnvironmentBindings(root, { 'lighting.artificial.enabled': true })
    expect(lights.every(light => light.intensity === 1.6)).toBe(true)
    expect(tubes.every(tube => tube.visible === true)).toBe(true)
  })

  it('新模型首次应用全局关灯值就直接全灭，不依赖先开后关', () => {
    const root = createLitBuilding()
    applyEnvironmentBindings(root, { 'lighting.artificial.enabled': false })
    expect(findPointLights(root).every(light => light.intensity === 0)).toBe(true)
    expect(findLamptubes(root).every(tube => tube.visible === false)).toBe(true)
  })

  it('toJSON→ObjectLoader 往返保留绑定、碰撞清单与灯光，关灯仍生效', () => {
    const root = createLitBuilding()
    const restored = new THREE.ObjectLoader().parse(root.toJSON())
    expect(restored.userData.proceduralModelEnvironmentBindings)
      .toEqual(root.userData.proceduralModelEnvironmentBindings)
    expect(restored.userData.proceduralModelCapabilityManifest.capabilities.spatial.colliders)
      .toEqual(root.userData.proceduralModelCapabilityManifest.capabilities.spatial.colliders)
    const lights = findPointLights(restored)
    const tubes = findLamptubes(restored)
    expect(lights).toHaveLength(3)
    expect(tubes).toHaveLength(6)

    applyEnvironmentBindings(restored, { 'lighting.artificial.enabled': false })
    expect(lights.every(light => light.intensity === 0)).toBe(true)
    expect(tubes.every(tube => tube.visible === false)).toBe(true)
  })
})
