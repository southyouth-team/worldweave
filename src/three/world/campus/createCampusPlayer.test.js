import { describe, expect, it } from 'vitest'
import * as THREE from 'three'
import { createCampusPlayer } from './createCampusPlayer.js'

describe('createCampusPlayer gender variants', () => {
  it('女性体型：躯干更窄、肩部更收、后发更长；默认男性保持原尺寸', () => {
    const male = createCampusPlayer(THREE)
    const female = createCampusPlayer(THREE, { gender: 'female' })
    const torsoWidth = root => {
      let width = 0
      const torso = root.getObjectByName('player-torso')
      torso?.geometry?.computeBoundingBox?.()
      torso?.geometry?.boundingBox?.getSize(new THREE.Vector3()) && (width = torso.geometry.boundingBox.getSize(new THREE.Vector3()).x)
      return width
    }
    const hairHeight = root => {
      const hair = root.getObjectByName('player-hair-back')
      hair?.geometry?.computeBoundingBox?.()
      return hair.geometry.boundingBox.getSize(new THREE.Vector3()).y * hair.scale.y
    }
    expect(torsoWidth(male)).toBeCloseTo(0.68, 3)
    expect(torsoWidth(female)).toBeCloseTo(0.58, 3)
    expect(hairHeight(female)).toBeGreaterThan(hairHeight(male))
    // 方块版：脸与躯干都是 BoxGeometry
    expect(male.getObjectByName('player-face').geometry.type).toBe('BoxGeometry')
    expect(male.getObjectByName('player-torso').geometry.type).toBe('BoxGeometry')
    // 女性额外带两侧长发与头绳，男性没有
    expect(female.getObjectByName('player-hair-side-left')).toBeTruthy()
    expect(male.getObjectByName('player-hair-side-left')).toBeFalsy()
    expect(createCampusPlayer(THREE, { gender: 'male' }).getObjectByName('player-torso')).toBeTruthy()
  })
})

describe('createCampusPlayer locomotion presentation', () => {
  it('advances gait from one continuous clock at different render cadences', () => {
    const runCadence = (hz) => {
      const player = createCampusPlayer(THREE)
      const update = player.userData.updateAnimation
      update.call(player, false, 0)
      for (let frame = 1; frame <= hz; frame += 1) {
        update.call(player, true, frame / hz, 0, 0, 1, false)
      }
      return player.userData.gaitPhase
    }

    expect(runCadence(30)).toBeCloseTo(runCadence(60), 8)
    expect(runCadence(60)).toBeCloseTo(runCadence(144), 8)
  })

  it('does not let tiny render-position jitter change gait phase', () => {
    const player = createCampusPlayer(THREE)
    const update = player.userData.updateAnimation
    update.call(player, false, 0)
    update.call(player, true, 1 / 60, 0, 0, 1, false)
    const firstPhase = player.userData.gaitPhase
    update.call(player, true, 2 / 60, 0.0002, 0, 1, false)
    const secondPhase = player.userData.gaitPhase
    update.call(player, true, 3 / 60, -0.00015, 0, 1, false)

    expect(secondPhase - firstPhase).toBeCloseTo(player.userData.gaitPhase - secondPhase, 8)
  })

  it('uses distinct nominal cadence for walking and running', () => {
    const walking = createCampusPlayer(THREE)
    const running = createCampusPlayer(THREE)
    walking.userData.updateAnimation.call(walking, false, 0)
    running.userData.updateAnimation.call(running, false, 0)
    walking.userData.updateAnimation.call(walking, true, 1 / 60, 0, 0, 1, false)
    running.userData.updateAnimation.call(running, true, 1 / 60, 0, 0, 1, true)

    expect(running.userData.gaitPhase - 0.85).toBeGreaterThan(walking.userData.gaitPhase - 0.85)
  })

  it('keeps restrained in-place feedback when movement is blocked', () => {
    const player = createCampusPlayer(THREE)
    const update = player.userData.updateAnimation
    update.call(player, false, 0)
    update.call(player, true, 1 / 60, 0, 0, 0.42, false)
    const firstPhase = player.userData.gaitPhase
    update.call(player, true, 2 / 60, 0, 0, 0.42, false)

    expect(player.userData.gaitPhase).toBeGreaterThan(firstPhase)
  })
})
