import { describe, expect, it, vi } from 'vitest'
import * as THREE from 'three'
import { PlayerCharacterRuntime } from './PlayerCharacterRuntime.js'

function createAnchor() {
  const anchor = new THREE.Group()
  const body = new THREE.Mesh(new THREE.BoxGeometry(0.5, 1, 0.3), new THREE.MeshBasicMaterial())
  body.name = 'avatar-body'
  anchor.add(body)
  const marker = new THREE.Mesh(new THREE.RingGeometry(0.4, 0.5), new THREE.MeshBasicMaterial())
  marker.name = 'avatar-ground-marker'
  anchor.add(marker)
  anchor.userData.updateAnimation = vi.fn()
  return anchor
}

function createLimbModel() {
  const model = new THREE.Group()
  const addLimb = name => {
    const group = new THREE.Group()
    group.name = name
    group.add(new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.5, 0.2), new THREE.MeshBasicMaterial()))
    model.add(group)
    return group
  }
  return {
    model,
    leftLeg: addLimb('player-left-leg'),
    rightLeg: addLimb('player-right-leg'),
    leftArm: addLimb('player-left-arm'),
    rightArm: addLimb('player-right-arm'),
  }
}

describe('PlayerCharacterRuntime', () => {
  it('无动画片段的生成角色复用默认关节步态：腿部反相摆动、整体起伏', () => {
    const anchor = createAnchor()
    const runtime = new PlayerCharacterRuntime(THREE, anchor)
    const { model, leftLeg, rightLeg, leftArm, rightArm } = createLimbModel()
    runtime.setModel(model, [], { assetId: 'procedural-character' })
    const wrapper = anchor.getObjectByName('player-character-asset')
    const baseY = wrapper.position.y

    runtime.updateAnimation(true, 0, 0.1, 0, false, 1, false)
    runtime.updateAnimation(true, 0.1, 0.1, 0, false, 1, false)

    expect(Math.abs(leftLeg.rotation.x)).toBeGreaterThan(0.01)
    expect(leftLeg.rotation.x).toBeCloseTo(-rightLeg.rotation.x, 6)
    expect(leftArm.rotation.x).toBeCloseTo(-rightArm.rotation.x, 6)
    expect(wrapper.position.y).not.toBe(baseY)
  })

  it('空中状态给生成角色跳跃姿态：双腿收拢、双臂上举', () => {
    const anchor = createAnchor()
    const runtime = new PlayerCharacterRuntime(THREE, anchor)
    const { model, leftLeg, rightLeg, leftArm } = createLimbModel()
    runtime.setModel(model, [], { assetId: 'jump-character' })
    runtime.updateAnimation(true, 0, 0, 0, false, 1, true)
    expect(leftLeg.rotation.x).toBeCloseTo(0.35, 6)
    expect(rightLeg.rotation.x).toBeCloseTo(-0.35, 6)
    expect(leftArm.rotation.x).toBeCloseTo(-1.0, 6)
  })

  it('无命名无骨架的多部件模型按空间位置分段绑定到默认关节', () => {
    const anchor = createAnchor()
    const runtime = new PlayerCharacterRuntime(THREE, anchor)
    const model = new THREE.Group()
    const addPart = (x, y, z) => {
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.3, 0.2), new THREE.MeshBasicMaterial())
      mesh.position.set(x, y, z)
      model.add(mesh)
      return mesh
    }
    addPart(0, 1.9, 0) // 头
    addPart(0, 1.2, 0) // 躯干
    addPart(-0.15, 0.2, 0) // 左腿
    addPart(0.15, 0.2, 0) // 右腿
    addPart(-0.6, 1.2, 0) // 左臂
    addPart(0.6, 1.2, 0) // 右臂
    runtime.setModel(model, [], { assetId: 'segmented-character' })

    const wrapper = anchor.getObjectByName('player-character-asset')
    const leftLeg = wrapper.getObjectByName('player-left-leg')
    const rightLeg = wrapper.getObjectByName('player-right-leg')
    const leftArm = wrapper.getObjectByName('player-left-arm')
    expect(leftLeg).toBeTruthy()
    expect(rightLeg).toBeTruthy()
    expect(leftArm).toBeTruthy()

    runtime.updateAnimation(true, 0, 0, 0, false, 1, false)
    runtime.updateAnimation(true, 0.1, 0, 0, false, 1, false)
    expect(Math.abs(leftLeg.rotation.x)).toBeGreaterThan(0.01)
    expect(leftLeg.rotation.x).toBeCloseTo(-rightLeg.rotation.x, 6)
    expect(Math.abs(leftArm.rotation.x)).toBeGreaterThan(0.01)
  })

  it('没有可识别肢体的整体模型也有走跳反馈，不保持静止', () => {
    const anchor = createAnchor()
    const runtime = new PlayerCharacterRuntime(THREE, anchor)
    const model = new THREE.Group()
    model.add(new THREE.Mesh(new THREE.BoxGeometry(1, 2, 1), new THREE.MeshBasicMaterial()))
    runtime.setModel(model, [], { assetId: 'single-mesh-character' })
    const wrapper = anchor.getObjectByName('player-character-asset')
    runtime.updateAnimation(true, 0, 0, 0, false, 1, false)
    runtime.updateAnimation(true, 0.1, 0, 0, false, 1, false)
    expect(wrapper.rotation.z).not.toBe(0)
  })

  it('有动画片段时仍走片段，不叠加程序化关节驱动', () => {
    const anchor = createAnchor()
    const runtime = new PlayerCharacterRuntime(THREE, anchor)
    const { model, leftLeg } = createLimbModel()
    const clip = new THREE.AnimationClip('walk', 1, [])
    runtime.setModel(model, [clip], { assetId: 'clip-character' })
    runtime.updateAnimation(true, 0, 0, 0, false, 1, false)
    runtime.updateAnimation(true, 0.1, 0, 0, false, 1, false)
    expect(leftLeg.rotation.x).toBe(0)
  })

  it('keeps the movement anchor stable while replacing only its visual model', () => {
    const anchor = createAnchor()
    anchor.position.set(4, 0, 7)
    const runtime = new PlayerCharacterRuntime(THREE, anchor)
    const model = new THREE.Group()
    model.add(new THREE.Mesh(new THREE.BoxGeometry(1, 2, 1), new THREE.MeshStandardMaterial()))

    const info = runtime.setModel(model, [], { assetId: 'character-test' })

    expect(anchor.position.toArray()).toEqual([4, 0, 7])
    expect(info).toMatchObject({ assetId: 'character-test', hasExternalModel: true })
    const assetMeshes = []
    anchor.getObjectByName('player-character-asset').traverse(object => { if (object.isMesh) assetMeshes.push(object) })
    expect(assetMeshes.length).toBe(1)
    expect(assetMeshes[0].castShadow).toBe(true)
    expect(assetMeshes[0].receiveShadow).toBe(true)
    expect(anchor.getObjectByName('avatar-ground-marker')).toBeTruthy()
    expect(anchor.getObjectByName('player-character-asset')).toBeTruthy()
    expect(anchor.getObjectByName('avatar-body')).toBeTruthy()
    expect(runtime.fallbackVisual.visible).toBe(false)
  })

  it('reports normalized visual dimensions and derives a stable movement footprint', () => {
    const anchor = createAnchor()
    const runtime = new PlayerCharacterRuntime(THREE, anchor)
    const model = new THREE.Group()
    model.add(new THREE.Mesh(new THREE.BoxGeometry(1, 2, 0.8), new THREE.MeshStandardMaterial()))

    const info = runtime.setModel(model, [], { assetId: 'dimensioned-character', targetHeight: 2.4 })

    expect(info.dimensions.height).toBeCloseTo(2.4)
    expect(info.dimensions.width).toBeCloseTo(1.2)
    expect(info.dimensions.depth).toBeCloseTo(0.96)
    expect(info.dimensions.eyeHeight).toBeCloseTo(1.824)
    expect(info.dimensions.colliderRadius).toBeCloseTo(0.336)
  })

  it('maps named clips to idle, walk and run states', () => {
    const anchor = createAnchor()
    const runtime = new PlayerCharacterRuntime(THREE, anchor)
    const model = new THREE.Group()
    model.add(new THREE.Mesh(new THREE.BoxGeometry(1, 2, 1), new THREE.MeshStandardMaterial()))
    const clips = [
      new THREE.AnimationClip('Idle', 1, []),
      new THREE.AnimationClip('Walk Cycle', 1, []),
      new THREE.AnimationClip('Run', 1, []),
    ]

    const info = runtime.setModel(model, clips, { assetId: 'animated-character' })
    expect(info.animations).toEqual(['idle', 'walk', 'run'])
    expect(runtime.setAnimationState('run')).toBe(true)
    runtime.update(1 / 60)
    expect(runtime.getInfo().animationState).toBe('run')
  })

  it('restores the built-in placeholder and delegates its original animation callback', () => {
    const anchor = createAnchor()
    const updater = anchor.userData.updateAnimation
    const runtime = new PlayerCharacterRuntime(THREE, anchor)
    const model = new THREE.Group()
    model.add(new THREE.Mesh(new THREE.BoxGeometry(1, 2, 1), new THREE.MeshBasicMaterial()))
    runtime.setModel(model)

    expect(runtime.restoreFallback()).toBe(true)
    anchor.userData.updateAnimation.call(anchor, true, 1, 0.2, 0.1)
    expect(updater).toHaveBeenCalled()
    expect(runtime.getInfo()).toMatchObject({ assetId: 'builtin-placeholder', hasExternalModel: false })
  })

  it('keeps walk intent active while blocked and forwards a low gait rate', () => {
    const anchor = createAnchor()
    const updater = anchor.userData.updateAnimation
    const runtime = new PlayerCharacterRuntime(THREE, anchor)
    anchor.userData.updateAnimation.call(anchor, true, 1, 0, 0, false, 0.42)
    expect(updater).toHaveBeenCalledWith(true, 1, 0, 0, 0.42)
    runtime.dispose()
  })

  it('switches an external character action immediately without a crossfade delay', () => {
    const anchor = createAnchor()
    const runtime = new PlayerCharacterRuntime(THREE, anchor)
    const idle = { reset: vi.fn().mockReturnThis(), play: vi.fn().mockReturnThis(), stop: vi.fn() }
    const walk = { reset: vi.fn().mockReturnThis(), play: vi.fn().mockReturnThis(), stop: vi.fn() }
    runtime.activeVisual = new THREE.Group()
    runtime.actions.set('idle', idle)
    runtime.actions.set('walk', walk)
    runtime.activeAction = idle
    runtime.playState('walk')
    expect(walk.play).toHaveBeenCalledOnce()
    expect(idle.stop).toHaveBeenCalledOnce()
    runtime.dispose()
  })

  it('序列化角色保留分段骨架接管前的原始模型，默认角色返回 null', () => {
    const anchor = createAnchor()
    const runtime = new PlayerCharacterRuntime(THREE, anchor)
    expect(runtime.serialize()).toBeNull()

    const model = new THREE.Group()
    model.add(new THREE.Mesh(new THREE.BoxGeometry(1, 2, 1), new THREE.MeshBasicMaterial()))
    const limb = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.5, 0.2), new THREE.MeshBasicMaterial())
    limb.position.set(-0.3, 0.2, 0)
    model.add(limb)
    runtime.setModel(model, [], { assetId: 'saved-character', prompt: '测试角色' })
    const serialized = runtime.serialize()
    expect(serialized).toBeTruthy()
    expect(serialized.assetId).toBe('saved-character')
    expect(serialized.prompt).toBe('测试角色')
    // 分段骨架会把部件 attach 到关节组；快照必须是接管前的完整模型。
    const snapshotObjects = serialized.object.object?.children?.length || 0
    expect(snapshotObjects).toBeGreaterThanOrEqual(2)

    runtime.restoreFallback()
    expect(runtime.serialize()).toBeNull()
    runtime.dispose()
  })

  it('rejects invalid or already-mounted models', () => {
    const anchor = createAnchor()
    const runtime = new PlayerCharacterRuntime(THREE, anchor)
    expect(() => runtime.setModel(new THREE.Group())).toThrow('有效的三维尺寸')
    const parent = new THREE.Group()
    const child = new THREE.Group()
    parent.add(child)
    expect(() => runtime.setModel(child)).toThrow('未挂载')
  })
})


describe('PlayerCharacterRuntime gait presentation', () => {
  it('smooths fixed-step gait-rate changes across render updates', () => {
    const anchor = createAnchor()
    const updater = anchor.userData.updateAnimation
    const runtime = new PlayerCharacterRuntime(THREE, anchor)

    anchor.userData.updateAnimation.call(anchor, true, 1, 0, 0, false, 1)
    expect(updater).toHaveBeenCalledWith(true, 1, 0, 0, 1)

    updater.mockClear()
    anchor.userData.updateAnimation.call(anchor, true, 1 + 1 / 60, 0, 0, false, 0.42)
    const filtered = updater.mock.calls[0][4]
    expect(filtered).toBeGreaterThan(0.42)
    expect(filtered).toBeLessThan(1)

    updater.mockClear()
    anchor.userData.updateAnimation.call(anchor, true, 1 + 2 / 60, 0, 0, false, 0.42)
    expect(updater.mock.calls[0][4]).toBeLessThan(filtered)
    expect(updater.mock.calls[0][4]).toBeGreaterThan(0.42)
    runtime.dispose()
  })
})
