import * as THREE from 'three'
import { describe, expect, it } from 'vitest'
import { PLAYER_PRESETS, createPlayerPresetModel, getPlayerPreset } from './playerPresets.js'

function torsoWidth(model) {
  const torso = model.getObjectByName('player-torso')
  torso.geometry.computeBoundingBox()
  return torso.geometry.boundingBox.getSize(new THREE.Vector3()).x
}

function hairHeight(model) {
  const hair = model.getObjectByName('player-hair-back')
  hair.geometry.computeBoundingBox()
  return hair.geometry.boundingBox.getSize(new THREE.Vector3()).y * hair.scale.y
}

describe('内置人物预设', () => {
  it('只有两个预设：默认角色（男）与默认角色（女）', () => {
    const ids = Object.keys(PLAYER_PRESETS)
    expect(ids.sort()).toEqual(['female', 'male'])
    expect(PLAYER_PRESETS.male.label).toBe('默认角色（男）')
    expect(PLAYER_PRESETS.female.label).toBe('默认角色（女）')
    expect(PLAYER_PRESETS.male.gender).toBe('male')
    expect(PLAYER_PRESETS.female.gender).toBe('female')
    expect(getPlayerPreset('unknown')).toBeNull()
  })

  it('两个预设模型都是完整人形：含命名关节与网格', () => {
    for (const presetId of ['male', 'female']) {
      const model = createPlayerPresetModel(THREE, presetId)
      expect(model).toBeTruthy()
      let meshes = 0
      model.traverse(object => { if (object.isMesh) meshes += 1 })
      expect(meshes).toBeGreaterThan(10)
      expect(model.getObjectByName('player-left-leg')).toBeTruthy()
      expect(model.getObjectByName('player-head')).toBeTruthy()
    }
  })

  it('女性与男性剪影明显不同：躯干更窄、后发更长、带双马尾与头绳', () => {
    const male = createPlayerPresetModel(THREE, 'male')
    const female = createPlayerPresetModel(THREE, 'female')
    expect(torsoWidth(male)).toBeCloseTo(0.68, 3)
    expect(torsoWidth(female)).toBeCloseTo(0.58, 3)
    expect(hairHeight(female)).toBeGreaterThan(hairHeight(male) * 1.4)
    expect(female.getObjectByName('player-hair-side-left')).toBeTruthy()
    expect(female.getObjectByName('player-hair-side-right')).toBeTruthy()
    expect(female.getObjectByName('player-hair-tie-left')).toBeTruthy()
    expect(male.getObjectByName('player-hair-side-left')).toBeFalsy()
  })

  it('方块版人形：脸与躯干都是方块几何', () => {
    const male = createPlayerPresetModel(THREE, 'male')
    expect(male.getObjectByName('player-face').geometry.type).toBe('BoxGeometry')
    expect(male.getObjectByName('player-torso').geometry.type).toBe('BoxGeometry')
    expect(male.getObjectByName('player-head')).toBeTruthy()
  })

  it('gender 选项可覆盖预设自身性别', () => {
    const overridden = createPlayerPresetModel(THREE, 'male', { gender: 'female' })
    expect(torsoWidth(overridden)).toBeCloseTo(0.58, 3)
  })
})
