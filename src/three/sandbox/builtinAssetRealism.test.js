import * as THREE from 'three'
import { describe, expect, it } from 'vitest'
import { createSceneAssetGeneratorRegistry } from '../world/campus/sceneAssetGeneratorRegistry.js'
import { applyEnvironmentBindings } from '../engine/worldStateRuntime.js'
import { analyzeModelCollisionCompleteness } from './modelCollisionAnalyzer.js'
import {
  BUILTIN_ASSET_CATALOG,
  BUILTIN_ASSET_DIMENSIONS,
  createBuiltinSandboxModel,
} from './builtinAssetAdapter.js'

const registry = createSceneAssetGeneratorRegistry(THREE)
const THIN_SURFACE_GEOMETRIES = new Set(['PlaneGeometry', 'ShapeGeometry', 'RingGeometry'])

function createAsset(category, objectType) {
  return createBuiltinSandboxModel(THREE, registry, { category, objectType })
}

function collectMeshes(root) {
  const meshes = []
  root.traverse(object => {
    if (object.isMesh) meshes.push(object)
  })
  return meshes
}

describe('内置素材真实感：通用几何', () => {
  it.each(BUILTIN_ASSET_CATALOG)('$category/$objectType 不残留直角盒体，实体几何不退化', ({ category, objectType }) => {
    const meshes = collectMeshes(createAsset(category, objectType))
    expect(meshes.length).toBeGreaterThan(0)
    expect(meshes.filter(mesh => mesh.geometry.type === 'BoxGeometry')).toEqual([])

    for (const mesh of meshes) {
      mesh.geometry.computeBoundingBox()
      const box = mesh.geometry.boundingBox
      for (const axis of ['x', 'y', 'z']) {
        expect(Number.isFinite(box.min[axis]), `${mesh.name} ${axis} min`).toBe(true)
        expect(Number.isFinite(box.max[axis]), `${mesh.name} ${axis} max`).toBe(true)
        if (!THIN_SURFACE_GEOMETRIES.has(mesh.geometry.type)) {
          expect(box.max[axis] - box.min[axis], `${mesh.name} ${axis} size`).toBeGreaterThan(0)
        }
      }
    }
  })
})

describe('内置素材真实感：植被', () => {
  it('乔木有细分树干、至少五条树冠分支与比原 Ico detail 1 更密的连续树冠', () => {
    const meshes = collectMeshes(createAsset('vegetation', 'tree'))
    const trunk = meshes.find(mesh => mesh.name === 'vegetation-trunk')
    const branches = meshes.filter(mesh => mesh.name === 'vegetation-crown-branch')
    const crowns = meshes.filter(mesh => mesh.name.startsWith('vegetation-crown-')
      && mesh.name !== 'vegetation-crown-branch')

    expect(trunk.geometry.type).toBe('CylinderGeometry')
    expect(trunk.geometry.parameters.radialSegments).toBeGreaterThanOrEqual(12)
    expect(branches.length).toBeGreaterThanOrEqual(5)
    expect(branches.every(mesh => mesh.geometry.type === 'CylinderGeometry')).toBe(true)
    expect(crowns.length).toBeGreaterThan(0)
    expect(crowns.every(mesh => mesh.geometry.getAttribute('position').count > 240)).toBe(true)
  })

  it('灌木使用细分球面而非零碎二十面体', () => {
    const crowns = collectMeshes(createAsset('vegetation', 'shrub'))
      .filter(mesh => mesh.userData.componentId?.includes('shrub-crown'))
    expect(crowns.length).toBeGreaterThan(0)
    for (const crown of crowns) {
      expect(crown.geometry.type).toBe('SphereGeometry')
      expect(crown.geometry.parameters.widthSegments).toBeGreaterThanOrEqual(12)
      expect(crown.geometry.parameters.heightSegments).toBeGreaterThanOrEqual(8)
    }
  })

  it('花卉每朵花有可辨花瓣，保留原有花茎', () => {
    const meshes = collectMeshes(createAsset('vegetation', 'flower'))
    const stems = meshes.filter(mesh => mesh.name.startsWith('flower-stem'))
    const petals = meshes.filter(mesh => mesh.name === 'flower-bloom-petal')
    expect(stems.length).toBeGreaterThanOrEqual(3)
    expect(petals.length).toBeGreaterThanOrEqual(stems.length * 5)
    expect(petals.every(mesh => mesh.geometry.type !== 'BoxGeometry')).toBe(true)
  })
})

describe('内置素材真实感：旧构筑物与设施', () => {
  it('人行桥扶手与立柱都是圆柱杆件', () => {
    const rails = collectMeshes(createAsset('structure', 'bridge'))
      .filter(mesh => ['bridge-railing', 'bridge-baluster'].includes(mesh.name))
    expect(rails.length).toBeGreaterThan(4)
    expect(rails.every(mesh => mesh.geometry.type === 'CylinderGeometry')).toBe(true)
    expect(rails.every(mesh => mesh.geometry.parameters.radialSegments >= 10)).toBe(true)
  })

  it('廊架有至少六块可辨屋顶板条', () => {
    const slats = collectMeshes(createAsset('structure', 'pergola'))
      .filter(mesh => mesh.name === 'pavilion-roof-slat')
    expect(slats.length).toBeGreaterThanOrEqual(6)
  })

  it('凉亭使用有真实坡度的屋顶而非圆角平盖板', () => {
    const meshes = collectMeshes(createAsset('structure', 'pavilion'))
    const roof = meshes.find(mesh => mesh.name === 'pavilion-roof')
    const post = meshes.find(mesh => mesh.name === 'pavilion-post')
    roof.geometry.computeBoundingBox()
    const roofHeight = roof.geometry.boundingBox.getSize(new THREE.Vector3()).y
    const postWidth = post.geometry.boundingBox.getSize(new THREE.Vector3()).x
    expect(roofHeight).toBeGreaterThan(postWidth * 1.2 * 2)
  })

  it('长椅有四条座板和三条独立背板', () => {
    const meshes = collectMeshes(createAsset('facility', 'bench'))
    expect(meshes.filter(mesh => mesh.name === 'bench-seat-slat')).toHaveLength(4)
    expect(meshes.filter(mesh => mesh.name === 'bench-back-slat')).toHaveLength(3)
  })

  it('路灯有圆柱底座和圆锥灯罩，保留原发光片', () => {
    const meshes = collectMeshes(createAsset('facility', 'lamp'))
    const base = meshes.find(mesh => mesh.name === 'lamp-pole-base')
    const head = meshes.find(mesh => mesh.name === 'lamp-head')
    expect(base.geometry.type).toBe('CylinderGeometry')
    expect(['CylinderGeometry', 'LatheGeometry']).toContain(head.geometry.type)
    expect(meshes.some(mesh => mesh.name === 'lamp-emitter')).toBe(true)
  })

  it('垃圾桶使用细分椭圆桶身，水平薄盖不会埋住桶口沿', () => {
    const root = createAsset('facility', 'bin')
    root.updateMatrixWorld(true)
    const meshes = collectMeshes(root)
    const body = meshes.find(mesh => mesh.name === 'bin-body')
    const lid = meshes.find(mesh => mesh.name === 'bin-lid')
    const rim = meshes.find(mesh => mesh.name === 'bin-lid-rim')
    expect(body.geometry.type).toBe('CylinderGeometry')
    expect(body.geometry.parameters.radialSegments).toBeGreaterThanOrEqual(16)
    const lidHeight = new THREE.Box3().setFromObject(lid).getSize(new THREE.Vector3()).y
    expect(lidHeight).toBeCloseTo(0.105, 5)
    expect(rim.position.y).toBeGreaterThanOrEqual(new THREE.Box3().setFromObject(lid).max.y - 0.001)
  })

  it('指示牌有双立柱和四边边框', () => {
    const meshes = collectMeshes(createAsset('facility', 'sign'))
    expect(meshes.filter(mesh => mesh.name === 'sign-post')).toHaveLength(2)
    expect(meshes.filter(mesh => mesh.name === 'sign-board-frame')).toHaveLength(4)
  })

  it('景观石有细分顶点和非对称径向轮廓', () => {
    const rocks = collectMeshes(createAsset('decoration', 'rock'))
      .filter(mesh => mesh.userData.componentId?.includes('rock-body'))
    expect(rocks.length).toBeGreaterThan(0)
    for (const rock of rocks) {
      const position = rock.geometry.getAttribute('position')
      expect(position.count).toBeGreaterThan(108)
      const radii = new Set()
      for (let index = 0; index < position.count; index += 1) {
        radii.add(Math.hypot(position.getX(index), position.getY(index), position.getZ(index)).toFixed(4))
      }
      expect(radii.size).toBeGreaterThan(20)
    }
  })

  it('花坛每朵花有独立花茎', () => {
    const meshes = collectMeshes(createAsset('decoration', 'flowerbed'))
    const flowers = meshes.filter(mesh => mesh.userData.componentId?.includes('flowerbed-flower-')
      && mesh.name !== 'flowerbed-flower-stem')
    const stems = meshes.filter(mesh => mesh.name === 'flowerbed-flower-stem')
    expect(stems.length).toBeGreaterThanOrEqual(7)
    expect(stems.length).toBe(flowers.length)
  })

  it('篮球架有圆柱支撑和至少八条篮筐网绳', () => {
    const meshes = collectMeshes(createAsset('sports', 'basketball-hoop'))
    const support = meshes.find(mesh => mesh.name === 'basketball-support')
    const net = meshes.filter(mesh => mesh.name === 'basketball-rim-net')
    expect(support.geometry.type).toBe('CylinderGeometry')
    expect(net.length).toBeGreaterThanOrEqual(8)
    expect(net.every(mesh => mesh.geometry.type === 'CylinderGeometry')).toBe(true)
  })
})

describe('内置素材真实感：既有契约保护', () => {
  it.each(BUILTIN_ASSET_CATALOG)('$category/$objectType 细化后碰撞分类仍完整', ({ category, objectType }) => {
    const report = analyzeModelCollisionCompleteness(createAsset(category, objectType))
    expect(report.issues).toEqual([])
    expect(report.status).toBe('complete')
  })

  it.each(BUILTIN_ASSET_CATALOG)('$category/$objectType 细化不超出真实尺寸的 ±15% 包容区间', ({ category, objectType }) => {
    const dimensions = BUILTIN_ASSET_DIMENSIONS[`${category}:${objectType}`]
    const size = new THREE.Box3().setFromObject(createAsset(category, objectType)).getSize(new THREE.Vector3())
    // 注册表旧素材本身有收缩系数，这里只防止细化把既有包络扩到失控；精确区间由 adapter 测试固定。
    expect(size.x).toBeLessThanOrEqual(Math.max(dimensions.width * 1.15, 0.2))
    expect(size.y).toBeLessThanOrEqual(dimensions.height * 1.15)
    expect(size.z).toBeLessThanOrEqual(Math.max(dimensions.depth * 1.15, 0.2))
  })

  it('路灯两条人工灯光绑定仍可解析并驱动原发光片', () => {
    const root = createAsset('facility', 'lamp')
    const bindings = root.userData.proceduralModelEnvironmentBindings
    expect(bindings).toHaveLength(2)
    expect(applyEnvironmentBindings(root, { 'lighting.artificial.enabled': false })).toBe(2)
    const emitter = collectMeshes(root).find(mesh => mesh.name === 'lamp-emitter')
    expect(emitter.visible).toBe(false)
  })

  it.each(BUILTIN_ASSET_CATALOG.filter(entry => entry.category !== 'campus'))('$category/$objectType 的细化几何可经 ObjectLoader 原样往返', ({ category, objectType }) => {
    const root = createAsset(category, objectType)
    root.updateMatrixWorld(true)
    const before = new THREE.Box3().setFromObject(root).getSize(new THREE.Vector3())
    const restored = new THREE.ObjectLoader().parse(root.toJSON())
    restored.updateMatrixWorld(true)
    const after = new THREE.Box3().setFromObject(restored).getSize(new THREE.Vector3())
    expect(after.x).toBeCloseTo(before.x, 5)
    expect(after.y).toBeCloseTo(before.y, 5)
    expect(after.z).toBeCloseTo(before.z, 5)
    expect(collectMeshes(restored)).toHaveLength(collectMeshes(root).length)
  })
})
