import * as THREE from 'three'
import { describe, expect, it } from 'vitest'
import { analyzeHumanoidModel, buildHumanoidRetryPrompt } from './humanoidValidation.js'

function humanoidModel() {
  const root = new THREE.Group()
  const add = (name, size, x, y, z) => {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(...size), new THREE.MeshBasicMaterial())
    mesh.name = name
    mesh.position.set(x, y, z)
    root.add(mesh)
    return mesh
  }
  add('head', [0.5, 0.5, 0.45], 0, 1.6, 0)
  add('torso', [0.6, 0.7, 0.35], 0, 1.0, 0)
  add('left-arm', [0.16, 0.6, 0.16], -0.4, 1.0, 0)
  add('right-arm', [0.16, 0.6, 0.16], 0.4, 1.0, 0)
  add('left-leg', [0.2, 0.7, 0.2], -0.15, 0.35, 0)
  add('right-leg', [0.2, 0.7, 0.2], 0.15, 0.35, 0)
  return root
}

function sphereBlob() {
  const root = new THREE.Group()
  const add = (x, y, r) => {
    const mesh = new THREE.Mesh(new THREE.SphereGeometry(r, 12, 10), new THREE.MeshBasicMaterial())
    mesh.position.set(x, y, 0)
    root.add(mesh)
  }
  add(0, 0.8, 0.8)
  add(0, 1.6, 0.6)
  add(0, 2.3, 0.5)
  return root
}

describe('人形自检', () => {
  it('标准人形通过：网格数、高宽比、命名肢体都达标', () => {
    const result = analyzeHumanoidModel(THREE, humanoidModel())
    expect(result.humanoid).toBe(true)
    expect(result.reasons).toEqual([])
    expect(result.metrics.meshCount).toBe(6)
    expect(result.metrics.heightRatio).toBeGreaterThan(1.6)
    expect(result.metrics.limbKinds).toEqual(expect.arrayContaining(['head', 'leg', 'arm', 'torso']))
  })

  it('三个球拼成的模型判定为非人形，并给出可读原因', () => {
    const result = analyzeHumanoidModel(THREE, sphereBlob())
    expect(result.humanoid).toBe(false)
    expect(result.reasons.length).toBeGreaterThan(0)
    // 球堆网格数不足、无命名肢体；高宽比取决于堆叠方式，不强制断言
    expect(result.reasons.join('')).toMatch(/网格数量过少/)
    expect(result.reasons.join('')).toMatch(/头\/腿\/臂|下半身/)
  })

  it('只有躯干与头、没有下半身部件的模型也判定为非人形', () => {
    const root = new THREE.Group()
    const head = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.5, 0.5), new THREE.MeshBasicMaterial())
    head.name = 'head'
    head.position.set(0, 1.8, 0)
    root.add(head)
    const torso = new THREE.Mesh(new THREE.BoxGeometry(0.6, 1.4, 0.35), new THREE.MeshBasicMaterial())
    torso.name = 'body'
    torso.position.set(0, 0.9, 0)
    root.add(torso)
    // 补足网格数量到 5，但都在上半身
    for (let i = 0; i < 3; i += 1) {
      const part = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.4, 0.2), new THREE.MeshBasicMaterial())
      part.position.set(-0.4 + i * 0.2, 1.0, 0)
      root.add(part)
    }
    const result = analyzeHumanoidModel(THREE, root)
    expect(result.humanoid).toBe(false)
    expect(result.metrics.lowerBodyMeshes).toBeLessThan(2)
  })

  it('空模型直接判负且不抛错', () => {
    expect(analyzeHumanoidModel(THREE, null).humanoid).toBe(false)
    expect(analyzeHumanoidModel(THREE, new THREE.Group()).humanoid).toBe(false)
  })

  it('纠正提示包含失败原因与重建要求', () => {
    const prompt = buildHumanoidRetryPrompt({ reasons: ['网格数量过少（3 < 5）', '高宽比不足（1.10 < 1.6）'] })
    expect(prompt).toContain('网格数量过少')
    expect(prompt).toContain('高宽比不足')
    expect(prompt).toContain('独立网格')
  })
})
