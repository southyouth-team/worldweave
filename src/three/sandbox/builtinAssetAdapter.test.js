import * as THREE from 'three'
import { describe, expect, it } from 'vitest'
import { createSceneAssetGeneratorRegistry } from '../world/campus/sceneAssetGeneratorRegistry.js'
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
  it('只暴露 5 类 13 个规范英文 objectType，别名全部去重，每个条目有中文标签', () => {
    const items = listBuiltinAssets()
    expect(items).toHaveLength(13)
    expect(Object.keys(BUILTIN_CATEGORY_LABELS)).toEqual([
      'vegetation', 'structure', 'facility', 'decoration', 'sports',
    ])
    const keys = items.map(item => `${item.category}:${item.objectType}`)
    expect(new Set(keys).size).toBe(13)
    for (const item of items) {
      expect(item.objectType).toMatch(/^[a-z][a-z0-9-]*$/)
      expect(BUILTIN_ASSET_LABELS[`${item.category}:${item.objectType}`]).toBe(item.label)
      expect(typeof item.label).toBe('string')
      expect(item.label.length).toBeGreaterThan(0)
    }
    expect(BUILTIN_ASSET_CATALOG.every(entry => ['vegetation', 'structure', 'facility', 'decoration', 'sports'].includes(entry.category))).toBe(true)
  })

  it('对未覆盖类别（road/water/terrain）与未知 objectType 显式报错而非静默生成', () => {
    expect(() => createBuiltinSandboxModel(THREE, registry, { category: 'road', objectType: 'road' }))
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

  it('其余内置素材不带环境绑定与灯光接线（改动仅限路灯）', () => {
    for (const entry of listBuiltinAssets()) {
      if (entry.objectType === 'lamp') continue
      const root = createBuiltinSandboxModel(THREE, registry, entry)
      expect(root.userData.proceduralModelEnvironmentBindings).toBeUndefined()
      expect(findPointLight(root)).toBeNull()
    }
  })
})
