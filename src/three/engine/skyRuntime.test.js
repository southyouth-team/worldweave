import * as THREE from 'three'
import { describe, expect, it } from 'vitest'
import { createSkyRuntime } from './skyRuntime.js'
import { getVirtualSunState } from './solarPosition.js'
import { getSkyVisualState, CELESTIAL_ORBIT_RADIUS, STAR_COUNT } from './skyVisualState.js'

function findByName(root, name) {
  let found = null
  root.traverse((object) => {
    if (object.name === name) found = object
  })
  return found
}

describe('createSkyRuntime 工厂结构与生命周期', () => {
  it('创建穹顶/太阳/月亮/星空四个命名成员，穹顶为 BackSide 且不写深度', () => {
    const runtime = createSkyRuntime(THREE)
    expect(runtime.group).toBeInstanceOf(THREE.Group)
    const dome = findByName(runtime.group, 'sky-dome')
    expect(dome).toBeTruthy()
    expect(dome.material.side).toBe(THREE.BackSide)
    expect(dome.material.depthWrite).toBe(false)
    expect(dome.frustumCulled).toBe(false)
    expect(findByName(runtime.group, 'sky-sun')).toBeTruthy()
    expect(findByName(runtime.group, 'sky-moon')).toBeTruthy()
    expect(findByName(runtime.group, 'sky-stars')).toBeTruthy()
  })

  it('太阳与月亮都是实体球，不再是面向相机的平面贴片', () => {
    const runtime = createSkyRuntime(THREE)
    const sunCore = findByName(runtime.group, 'sky-sun-core')
    const moon = findByName(runtime.group, 'sky-moon')
    expect(sunCore.geometry.type).toBe('SphereGeometry')
    expect(moon.geometry.type).toBe('SphereGeometry')
    // 太阳外层有两层递增范围的加性光晕球
    const halo = findByName(runtime.group, 'sky-sun-halo')
    const glow = findByName(runtime.group, 'sky-sun-glow')
    expect(halo.geometry.type).toBe('SphereGeometry')
    expect(glow.geometry.type).toBe('SphereGeometry')
    expect(halo.material.blending).toBe(THREE.AdditiveBlending)
    expect(glow.material.blending).toBe(THREE.AdditiveBlending)
    expect(glow.geometry.parameters.radius).toBeGreaterThan(halo.geometry.parameters.radius)
    // 球体无朝向依赖：任意外观角度都是立体
    expect(sunCore.material.isShaderMaterial).toBe(true)
    expect(moon.material.isShaderMaterial).toBe(true)
    expect(sunCore.material.depthWrite).toBe(false)
    expect(moon.material.depthWrite).toBe(false)
    expect(sunCore.material.fog).toBe(false)
    expect(moon.material.fog).toBe(false)
  })

  it('update 后太阳落在轨道半径上，且显示仰角被压缩到俯瞰可见范围', () => {
    const runtime = createSkyRuntime(THREE)
    const state = getSkyVisualState(getVirtualSunState(12))
    runtime.update(state)
    const sun = findByName(runtime.group, 'sky-sun')
    // 位置在轨道球面上
    expect(sun.position.length()).toBeCloseTo(CELESTIAL_ORBIT_RADIUS, 3)
    // 正午原始方向仰角约 90°，压缩后应显著更低（俯瞰画面才看得到）
    expect(state.sun.direction[1]).toBeGreaterThan(0.9)
    expect(sun.position.y / CELESTIAL_ORBIT_RADIUS).toBeLessThan(0.5)
    expect(sun.position.y / CELESTIAL_ORBIT_RADIUS).toBeGreaterThan(0)
    // 透明度写入核心材质与光晕
    const core = findByName(runtime.group, 'sky-sun-core')
    expect(core.material.uniforms.uOpacity.value).toBeCloseTo(state.sun.opacity, 6)
    // 光晕为加性 shader 球，透明度经 uOpacity 传入（uPeak 决定各层最大强度）
    expect(findByName(runtime.group, 'sky-sun-halo').material.uniforms.uOpacity.value)
      .toBeCloseTo(state.sun.opacity, 6)
    expect(findByName(runtime.group, 'sky-sun-halo').material.uniforms.uPeak.value).toBeCloseTo(0.34, 6)
    expect(findByName(runtime.group, 'sky-sun-glow').material.uniforms.uOpacity.value)
      .toBeCloseTo(state.sun.opacity, 6)
    expect(findByName(runtime.group, 'sky-sun-glow').material.uniforms.uPeak.value).toBeCloseTo(0.11, 6)
  })

  it('夜晚：太阳隐藏、月亮球显示并有月海着色', () => {
    const runtime = createSkyRuntime(THREE)
    const night = getSkyVisualState(getVirtualSunState(23))
    runtime.update(night)
    const sun = findByName(runtime.group, 'sky-sun')
    const moon = findByName(runtime.group, 'sky-moon')
    expect(night.sun.opacity).toBe(0)
    expect(sun.visible).toBe(false)
    expect(moon.visible).toBe(true)
    expect(moon.material.uniforms.uOpacity.value).toBeGreaterThan(0)
    expect(moon.position.length()).toBeCloseTo(CELESTIAL_ORBIT_RADIUS, 3)
    // 月亮球面着色必须含月海与球体明暗（不再是平面圆盘 shader）
    expect(moon.material.fragmentShader).toContain('maria')
    expect(moon.material.fragmentShader).toContain('limb')
  })

  it('group 位移不影响天体本地轨道位置（球体不依赖朝向）', () => {
    const runtime = createSkyRuntime(THREE)
    runtime.group.position.set(600, 350, 600)
    const state = getSkyVisualState(getVirtualSunState(12))
    runtime.update(state)
    const sun = findByName(runtime.group, 'sky-sun')
    expect(sun.position.length()).toBeCloseTo(CELESTIAL_ORBIT_RADIUS, 3)
    // 球体没有广告牌朝向需求，quaternion 保持单位四元数
    expect(sun.quaternion.equals(new THREE.Quaternion())).toBe(true)
  })

  it('followCamera 三轴复制相机位置；setIndoor 切换 visible', () => {
    const runtime = createSkyRuntime(THREE)
    runtime.followCamera(new THREE.Vector3(12, 88, -5))
    expect(runtime.group.position.toArray()).toEqual([12, 88, -5])
    runtime.setIndoor(true)
    expect(runtime.group.visible).toBe(false)
    runtime.setIndoor(false)
    expect(runtime.group.visible).toBe(true)
  })

  it('dispose 释放资源且重复调用不抛', () => {
    const runtime = createSkyRuntime(THREE)
    expect(() => runtime.dispose()).not.toThrow()
    expect(() => runtime.dispose()).not.toThrow()
  })

  it('星空星数等于 STAR_COUNT 且只分布在上半天球', () => {
    const runtime = createSkyRuntime(THREE)
    const stars = findByName(runtime.group, 'sky-stars')
    expect(stars.geometry.attributes.position.count).toBe(STAR_COUNT)
    const positions = stars.geometry.attributes.position.array
    for (let i = 1; i < positions.length; i += 3) {
      expect(positions[i]).toBeGreaterThan(0)
    }
  })
})
