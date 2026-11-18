import * as THREE from 'three'
import { describe, expect, it } from 'vitest'
import { fitModelToFootprint } from './footprintFit.js'

// 以重心为原点的 20 × 10 米占地区域（调用方先用 localizePolygon 处理）
const plot = [
  { x: -10, z: -5 },
  { x: 10, z: -5 },
  { x: 10, z: 5 },
  { x: -10, z: 5 },
]

function createModel(width, height, depth, options = {}) {
  const group = new THREE.Group()
  const mesh = new THREE.Mesh(
    new THREE.BoxGeometry(width, height, depth),
    new THREE.MeshStandardMaterial(),
  )
  mesh.position.set(options.x || 0, height / 2 + (options.y || 0), options.z || 0)
  group.add(mesh)
  return group
}

function boundsOf(model) {
  return new THREE.Box3().setFromObject(model)
}

describe('模型底面匹配勾绘轮廓', () => {
  it('area 模式把底面外接框缩放到占地范围，并贴地居中', () => {
    const model = createModel(5, 2, 4, { x: 3, z: -2, y: 1 })

    const result = fitModelToFootprint(model, plot, 'area')
    const bounds = boundsOf(model)
    const size = bounds.getSize(new THREE.Vector3())
    const center = bounds.getCenter(new THREE.Vector3())

    expect(result).toMatchObject({ mode: 'area' })
    expect(size.x).toBeCloseTo(20, 5)
    expect(size.z).toBeCloseTo(10, 5)
    expect(bounds.min.y).toBeCloseTo(0, 5)
    expect(center.x).toBeCloseTo(0, 5)
    expect(center.z).toBeCloseTo(0, 5)
  })

  it('space 模式等比缩小到区域内，但不把模型放大', () => {
    const model = createModel(40, 2, 10)
    fitModelToFootprint(model, plot, 'space')
    let size = boundsOf(model).getSize(new THREE.Vector3())
    expect(size.x).toBeCloseTo(20, 5)
    expect(size.z).toBeCloseTo(5, 5)

    const small = createModel(5, 2, 4)
    fitModelToFootprint(small, plot, 'space')
    size = boundsOf(small).getSize(new THREE.Vector3())
    expect(size.x).toBeCloseTo(5, 5)
    expect(size.z).toBeCloseTo(4, 5)
  })

  it('轮廓不足三个点时不做任何变换', () => {
    const model = createModel(5, 2, 4, { x: 3 })
    const before = boundsOf(model)
    expect(fitModelToFootprint(model, [{ x: 0, z: 0 }, { x: 1, z: 1 }], 'area')).toBeNull()
    expect(boundsOf(model).equals(before)).toBe(true)
  })
})
