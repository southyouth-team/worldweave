import { describe, expect, it } from 'vitest'
import { CAMPUS_WORLD_MIN_SIZE, NCGXY_CAMPUS_LAYOUT, planCampusWorldExpansion } from './ncgxyCampusLayout.js'
import { BUILTIN_ASSET_LABELS } from './builtinAssetAdapter.js'

describe('南工校园示例布局', () => {
  it('包含三个核心地标与足够的道路/绿化', () => {
    const keys = NCGXY_CAMPUS_LAYOUT.map(item => `${item.category}:${item.objectType}`)
    expect(keys).toContain('campus:east-gate')
    expect(keys).toContain('campus:zhiyuan-building')
    expect(keys).toContain('campus:sports-field')
    expect(keys.filter(key => key.startsWith('road:'))).toHaveLength(6)
    expect(keys.filter(key => key === 'vegetation:tree').length).toBeGreaterThanOrEqual(6)
    expect(keys.filter(key => key === 'facility:lamp').length).toBeGreaterThanOrEqual(4)
  })

  it('所有条目都是内置素材库里存在的素材，且都有名称与坐标', () => {
    for (const item of NCGXY_CAMPUS_LAYOUT) {
      const key = `${item.category}:${item.objectType}`
      expect(BUILTIN_ASSET_LABELS[key], key).toBeTruthy()
      expect(typeof item.name).toBe('string')
      expect(item.name.length).toBeGreaterThan(0)
      expect(Number.isFinite(item.x)).toBe(true)
      expect(Number.isFinite(item.z)).toBe(true)
      expect(Number.isFinite(item.ry)).toBe(true)
    }
  })

  it('布局落在扩展后的世界范围内，大门在南侧、操场在东侧', () => {
    for (const item of NCGXY_CAMPUS_LAYOUT) {
      expect(Math.abs(item.x)).toBeLessThanOrEqual(125)
      expect(Math.abs(item.z)).toBeLessThanOrEqual(100)
    }
    const gate = NCGXY_CAMPUS_LAYOUT.find(item => item.objectType === 'east-gate')
    const building = NCGXY_CAMPUS_LAYOUT.find(item => item.objectType === 'zhiyuan-building')
    const field = NCGXY_CAMPUS_LAYOUT.find(item => item.objectType === 'sports-field')
    expect(gate.z).toBeGreaterThan(building.z)
    expect(field.x).toBeGreaterThan(gate.x)
  })

  it('中轴大道沿南北向（旋转 90°），主路沿东西向', () => {
    const mainRoads = NCGXY_CAMPUS_LAYOUT.filter(item => item.name === '主入口大道')
    expect(mainRoads).toHaveLength(2)
    for (const road of mainRoads) expect(road.ry).toBeCloseTo(Math.PI / 2, 6)
    const crossRoads = NCGXY_CAMPUS_LAYOUT.filter(item => item.name === '东西主路')
    expect(crossRoads).toHaveLength(2)
    for (const road of crossRoads) expect(road.ry).toBe(0)
  })

  it('世界扩展计划：54×42 起需要扩到至少 250×190，已足够时不扩', () => {
    const plan = planCampusWorldExpansion({ minX: -27, maxX: 27, minZ: -21, maxZ: 21 })
    expect(plan.east + plan.west).toBeGreaterThanOrEqual(4)
    expect(plan.north + plan.south).toBeGreaterThanOrEqual(4)
    expect(54 * (1 + plan.east + plan.west)).toBeGreaterThanOrEqual(250)
    expect(42 * (1 + plan.north + plan.south)).toBeGreaterThanOrEqual(190)

    const enough = planCampusWorldExpansion({ minX: -150, maxX: 150, minZ: -110, maxZ: 110 })
    expect(enough).toMatchObject({ east: 0, west: 0, north: 0, south: 0 })
  })

  it('世界最小尺寸常量与布局安全范围一致', () => {
    expect(CAMPUS_WORLD_MIN_SIZE.width).toBeGreaterThanOrEqual(250)
    expect(CAMPUS_WORLD_MIN_SIZE.depth).toBeGreaterThanOrEqual(190)
  })
})
