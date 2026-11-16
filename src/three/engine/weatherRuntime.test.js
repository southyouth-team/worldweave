import * as THREE from 'three'
import { describe, expect, it } from 'vitest'
import {
  WEATHER_CLOUD_COUNT,
  WEATHER_MODES,
  createCloudLayerRuntime,
  createSnowFieldRuntime,
  getCloudTint,
  getWeatherMode,
  resolveWeatherMode,
} from './weatherRuntime.js'

describe('天气模式', () => {
  it('在晴天/下雨基础上扩充五种新天气，字段完整且不含时间/风力', () => {
    const names = Object.keys(WEATHER_MODES)
    expect(names).toEqual(['clear', 'cloudy', 'overcast', 'rain', 'snow', 'fog'])
    for (const mode of Object.values(WEATHER_MODES)) {
      expect(typeof mode.label).toBe('string')
      // 每种天气必须有强度维度标签，供统一强度滑杆显示
      expect(typeof mode.intensityLabel).toBe('string')
      expect(mode.intensityLabel.length).toBeGreaterThan(0)
      expect(['clear', 'rain']).toContain(mode.weather)
      // 天气模式不得携带 time/wind：时间与风力归各自控件，避免互相覆盖
      expect(mode.time).toBeUndefined()
      expect(mode.wind).toBeUndefined()
    }
    expect(WEATHER_MODES.rain.weather).toBe('rain')
    expect(WEATHER_MODES.snow.snow).toBe(true)
    expect(WEATHER_MODES.clear.skyTint).toBeNull()
  })

  it('未知天气回退晴天，非法输入不抛错', () => {
    expect(getWeatherMode('unknown')).toBe(WEATHER_MODES.clear)
    expect(getWeatherMode(undefined)).toBe(WEATHER_MODES.clear)
  })

  it('强度滑杆按模式映射：晴天阳光、云量、暗度、雨量、雪量、雾浓度', () => {
    // 晴天：强度越高直射光越强（刺眼）
    expect(resolveWeatherMode('clear', 0).sunScale).toBeCloseTo(0.85)
    expect(resolveWeatherMode('clear', 1).sunScale).toBeCloseTo(1.45)
    // 多云：强度控制云量
    expect(resolveWeatherMode('cloudy', 0).cloudiness).toBe(6)
    expect(resolveWeatherMode('cloudy', 1).cloudiness).toBe(24)
    // 阴天：强度越高越暗、天空越灰
    expect(resolveWeatherMode('overcast', 0).sunScale).toBeGreaterThan(resolveWeatherMode('overcast', 1).sunScale)
    expect(resolveWeatherMode('overcast', 1).skyMix).toBeGreaterThan(resolveWeatherMode('overcast', 0).skyMix)
    // 下雨：进入模式即有雨量，强度控制雨量大小
    expect(resolveWeatherMode('rain', 0).rainIntensity).toBeCloseTo(0.25)
    expect(resolveWeatherMode('rain', 1).rainIntensity).toBe(1)
    expect(resolveWeatherMode('rain', 0.5).weather).toBe('rain')
    // 下雪：强度控制雪量
    expect(resolveWeatherMode('snow', 0).snowIntensity).toBeCloseTo(0.2)
    expect(resolveWeatherMode('snow', 1).snowIntensity).toBe(1)
    expect(resolveWeatherMode('snow', 0.5).snow).toBe(true)
    // 大雾：强度越高能见度越低
    expect(resolveWeatherMode('fog', 1).fog.far).toBeLessThan(resolveWeatherMode('fog', 0).fog.far)
    expect(resolveWeatherMode('fog', 1).fog.near).toBeLessThan(resolveWeatherMode('fog', 0).fog.near)
  })

  it('强度夹取到 0–1，未知模式解析为晴天，云量始终合法', () => {
    expect(resolveWeatherMode('clear', 5).intensity).toBe(1)
    expect(resolveWeatherMode('clear', -3).intensity).toBe(0)
    expect(resolveWeatherMode('nope', 0.5).key).toBe('clear')
    for (const name of Object.keys(WEATHER_MODES)) {
      for (const t of [0, 0.25, 0.5, 0.75, 1]) {
        const resolved = resolveWeatherMode(name, t)
        expect(resolved.cloudiness).toBeGreaterThanOrEqual(0)
        expect(resolved.cloudiness).toBeLessThanOrEqual(WEATHER_CLOUD_COUNT)
      }
    }
  })

  it('云色随昼夜切换：白天白、黄昏暖、夜晚压暗', () => {
    expect(getCloudTint(14)).toBe('#ffffff')
    expect(getCloudTint(18)).toBe('#e8c6a8')
    expect(getCloudTint(22)).toBe('#3d4a63')
    expect(getCloudTint(NaN)).toBe('#ffffff')
  })
})

describe('云层运行时', () => {
  it('创建云池，setCloudiness 控制可见数量并夹取范围', () => {
    const layer = createCloudLayerRuntime(THREE, { document: null })
    const meshes = layer.object.children
    expect(meshes).toHaveLength(WEATHER_CLOUD_COUNT)
    expect(meshes.every(mesh => !mesh.visible)).toBe(true)

    layer.setCloudiness(6)
    expect(meshes.filter(mesh => mesh.visible)).toHaveLength(6)
    expect(layer.cloudiness).toBe(6)

    layer.setCloudiness(999)
    expect(layer.cloudiness).toBe(WEATHER_CLOUD_COUNT)
    layer.setCloudiness(-5)
    expect(layer.cloudiness).toBe(0)
    layer.dispose()
  })

  it('update 让可见云随风漂移并在越界后回卷', () => {
    const layer = createCloudLayerRuntime(THREE, { document: null })
    layer.setCloudiness(3)
    const first = layer.object.children[0]
    const before = first.position.x
    layer.update(1, 0.5)
    expect(first.position.x).toBeGreaterThan(before)
    first.position.x = 700
    layer.update(0.1, 0)
    expect(first.position.x).toBeLessThan(0)
    layer.dispose()
  })

  it('followCamera 只跟随水平位置，setTint 改云色', () => {
    const layer = createCloudLayerRuntime(THREE, { document: null })
    layer.setCloudiness(2)
    layer.followCamera(new THREE.Vector3(10, 50, -20))
    expect(layer.object.position.x).toBe(10)
    expect(layer.object.position.z).toBe(-20)
    expect(layer.object.position.y).toBe(0)
    layer.setTint('#3d4a63')
    expect(layer.object.children[0].material.color.getHexString()).toBe('3d4a63')
    layer.dispose()
  })

  it('dispose 释放几何与材质', () => {
    const layer = createCloudLayerRuntime(THREE, { document: null })
    const first = layer.object.children[0]
    let geometryDisposed = false
    let materialDisposed = false
    first.geometry.addEventListener('dispose', () => { geometryDisposed = true })
    first.material.addEventListener('dispose', () => { materialDisposed = true })
    layer.dispose()
    expect(geometryDisposed).toBe(true)
    expect(materialDisposed).toBe(true)
  })
})

describe('雪场运行时', () => {
  it('默认隐藏，setVisible 控制显示', () => {
    const snow = createSnowFieldRuntime(THREE)
    expect(snow.visible).toBe(false)
    snow.setVisible(true)
    expect(snow.visible).toBe(true)
    snow.dispose()
  })

  it('可见时粒子下落并在落地后回到高空', () => {
    const snow = createSnowFieldRuntime(THREE)
    snow.setVisible(true)
    const positions = snow.object.geometry.attributes.position.array
    // 第二个粒子的初始 y = (1*13)%24 = 13，不会一更新就触底重置
    const beforeY = positions[4]
    snow.update(0.5, 0)
    expect(positions[4]).toBeLessThan(beforeY)

    positions[4] = -0.1
    snow.update(0.016, 0)
    expect(positions[4]).toBeGreaterThan(10)
    snow.dispose()
  })

  it('followCamera 只跟随水平位置', () => {
    const snow = createSnowFieldRuntime(THREE)
    snow.followCamera(new THREE.Vector3(5, 30, 8))
    expect(snow.object.position.x).toBe(5)
    expect(snow.object.position.z).toBe(8)
    expect(snow.object.position.y).toBe(0)
    snow.dispose()
  })

  it('setIntensity 控制雪量（drawRange 粒子数）并夹取 0–1', () => {
    const snow = createSnowFieldRuntime(THREE)
    snow.setIntensity(1)
    expect(snow.object.geometry.drawRange.count).toBe(900)
    snow.setIntensity(0.5)
    expect(snow.object.geometry.drawRange.count).toBe(450)
    snow.setIntensity(0)
    expect(snow.object.geometry.drawRange.count).toBe(0)
    snow.setIntensity(5)
    expect(snow.object.geometry.drawRange.count).toBe(900)
    snow.dispose()
  })
})
