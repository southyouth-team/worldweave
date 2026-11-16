import * as THREE from 'three'
import { describe, expect, it } from 'vitest'
import { applyTextPlates, getPartTextSpec, normalizeTextSpec, updateTextPlate } from './textPlateRuntime.js'

describe('可编辑文字', () => {
  it('规整文字配置：自动补默认字体、对齐与位置，空文字返回 null', () => {
    expect(normalizeTextSpec({ text: '   ' })).toBeNull()
    expect(normalizeTextSpec(null)).toBeNull()
    const spec = normalizeTextSpec({ text: '南昌工学院', width: 4, height: 1 })
    expect(spec).toMatchObject({
      text: '南昌工学院',
      width: 4,
      height: 1,
      color: '#ffffff',
      align: 'center',
      verticalAlign: 'middle',
    })
    expect(spec.fontFamily).toContain('YaHei')
    expect(spec.position).toEqual({ x: 0, y: 0, z: 0.01 })
    expect(spec.rotation).toEqual({ x: 0, y: 0, z: 0 })
  })

  it('按部件 textSpec 创建文字平面，并可更新文字内容', () => {
    const model = new THREE.Group()
    const part = new THREE.Group()
    part.userData.componentId = 'sign-board'
    part.userData.textSpec = { text: '南昌工学院', width: 4, height: 1 }
    model.add(part)

    expect(applyTextPlates(THREE, model)).toBe(1)
    const plate = part.getObjectByName('host-text-plate')
    expect(plate).toBeTruthy()
    expect(plate.geometry.parameters.width).toBeCloseTo(4, 6)
    expect(plate.geometry.parameters.height).toBeCloseTo(1, 6)

    expect(updateTextPlate(THREE, model, 'sign-board', { text: '致远楼' })).toBe(true)
    expect(getPartTextSpec(model, 'sign-board').text).toBe('致远楼')
    // 更新不会重复创建平面
    const plates = []
    part.traverse(object => { if (object.name === 'host-text-plate') plates.push(object) })
    expect(plates).toHaveLength(1)
    expect(updateTextPlate(THREE, model, 'missing-part', { text: 'x' })).toBe(false)
  })
})
