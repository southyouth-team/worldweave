// 天气运行时：云层（噪声贴图 billboard 池）与雪场粒子。
// 与 rainFieldRuntime 保持同一套约定：粒子/云在本地盒内循环，整体跟随相机 X/Z，
// 材质与几何在 dispose 中释放。贴图在无 2D canvas 环境（Node 测试）降级为纯色。
export const WEATHER_CLOUD_COUNT = 24
export const SNOW_PARTICLE_COUNT = 900
export const SNOW_FIELD_HALF_SPAN = 26

const CLOUD_MIN_DISTANCE = 240
const CLOUD_MAX_DISTANCE = 500
const CLOUD_MIN_HEIGHT = 150
const CLOUD_MAX_HEIGHT = 320
const CLOUD_MIN_WIDTH = 55
const CLOUD_MAX_WIDTH = 125

const SNOW_FALL_SPEED = 1.6
const SNOW_INITIAL_TOP = 24
const SNOW_RESET_BASE_Y = 18

// 天气模式：扩展原沙盒「天气模式」下拉的选项集合（原只有晴天/下雨）。
// 模式只描述天气本身（降水、云量、雾、光照修正），不包含时间与风力——
// 时间始终由时间滑杆控制，风力始终由风力开关/风速滑杆控制，三者互不覆盖。
// 每种模式自带一个强度维度（intensityLabel），由统一的天气强度滑杆控制：
// 晴天=阳光刺眼度、多云=云量、阴天=暗度、下雨=雨量、下雪=雪量、大雾=浓度。
// sunScale/hemiScale 是对 setEnvironment 按当前时间算出的光照做乘性修正；
// skyTint/skyMix 把天空背景与穹顶向天气色混合，避免"灰天空 + 强阳光"的割裂。
export const WEATHER_MODES = Object.freeze({
  clear: {
    label: '晴天', weather: 'clear', snow: false, fog: null,
    intensityLabel: '阳光强度',
    // 强度 0→柔和、1→刺眼（直射光与曝光感）
    sunScale: [0.85, 1.45], hemiScale: 1, skyTint: null, skyMix: 0,
    cloudiness: [4, 10], rainIntensity: 0, snowIntensity: 0,
  },
  cloudy: {
    label: '多云', weather: 'clear', snow: false, fog: null,
    intensityLabel: '云量',
    sunScale: 0.72, hemiScale: 1.12, skyTint: '#c8d4dc', skyMix: 0.22,
    cloudiness: [6, 24], rainIntensity: 0, snowIntensity: 0,
  },
  overcast: {
    label: '阴天', weather: 'clear', snow: false,
    intensityLabel: '阴天程度',
    fog: { color: '#b6bcc2', near: 55, far: 220 },
    sunScale: [0.34, 0.08], hemiScale: [1.12, 1.45], skyTint: '#9aa2ab', skyMix: [0.4, 0.85],
    cloudiness: [14, 24], rainIntensity: 0, snowIntensity: 0,
  },
  rain: {
    label: '下雨', weather: 'rain', snow: false, fog: null,
    intensityLabel: '雨量',
    // 进入下雨模式即自动下雨，强度控制雨量与压暗程度
    sunScale: [0.45, 0.14], hemiScale: [1.08, 1.24], skyTint: '#6f7a85', skyMix: [0.38, 0.68],
    cloudiness: 20, rainIntensity: [0.25, 1], snowIntensity: 0,
  },
  snow: {
    label: '下雪', weather: 'clear', snow: true,
    intensityLabel: '雪量',
    fog: { color: '#cfdae5', near: 40, far: 180 },
    sunScale: [0.62, 0.38], hemiScale: [1.18, 1.38], skyTint: '#c3d0dc', skyMix: [0.35, 0.6],
    cloudiness: [10, 24], rainIntensity: 0, snowIntensity: [0.2, 1],
  },
  fog: {
    label: '大雾', weather: 'clear', snow: false,
    intensityLabel: '雾浓度',
    fog: { color: '#d7dee3', near: [34, 4], far: [170, 45] },
    sunScale: [0.36, 0.08], hemiScale: [1.2, 1.5], skyTint: '#d0d8de', skyMix: [0.55, 0.92],
    cloudiness: 0, rainIntensity: 0, snowIntensity: 0,
  },
})

export function getWeatherMode(name) {
  return WEATHER_MODES[name] || WEATHER_MODES.clear
}

const clamp01 = value => Math.max(0, Math.min(1, Number(value) || 0))
const rangeAt = (value, t) => (Array.isArray(value) ? value[0] + (value[1] - value[0]) * t : value)

// 把「模式 + 强度(0–1)」解析成一组具体参数。强度滑杆是每种天气的统一调节维度，
// 解析后引擎只消费具体数值，不再关心区间定义。
export function resolveWeatherMode(name, intensity = 0.5) {
  const key = Object.prototype.hasOwnProperty.call(WEATHER_MODES, name) ? name : 'clear'
  const mode = WEATHER_MODES[key]
  const t = clamp01(intensity)
  let fog = mode.fog
  if (fog) {
    fog = {
      color: fog.color,
      near: rangeAt(fog.near, t),
      far: rangeAt(fog.far, t),
    }
  }
  return {
    key,
    label: mode.label,
    intensityLabel: mode.intensityLabel,
    weather: mode.weather,
    snow: mode.snow === true,
    cloudiness: Math.round(rangeAt(mode.cloudiness, t)),
    sunScale: rangeAt(mode.sunScale, t),
    hemiScale: rangeAt(mode.hemiScale, t),
    skyTint: mode.skyTint,
    skyMix: rangeAt(mode.skyMix ?? 0, t),
    fog,
    rainIntensity: rangeAt(mode.rainIntensity ?? 0, t),
    snowIntensity: rangeAt(mode.snowIntensity ?? 0, t),
    intensity: t,
  }
}

// 云色随昼夜变化：夜晚与黄昏的云压暗，白天保持亮白。
export function getCloudTint(time) {
  const hour = Number(time)
  if (!Number.isFinite(hour)) return '#ffffff'
  if (hour < 7 || hour > 19.5) return '#3d4a63'
  if (hour < 8.5 || hour > 17.5) return '#e8c6a8'
  return '#ffffff'
}

// 噪声云贴图：4 层 fbm 生成不规则轮廓与自然明暗，无 canvas 环境返回 null。
export function makeCloudTexture(THREE, seed, doc = globalThis.document) {
  const canvas = doc?.createElement?.('canvas')
  const ctx = canvas?.getContext?.('2d')
  if (!canvas || !ctx) return null
  const W = 256
  const H = 170
  canvas.width = W
  canvas.height = H
  let state = seed * 9137
  const rand = () => {
    state = (state * 16807) % 2147483647
    return (state - 1) / 2147483646
  }
  const octaves = []
  for (let o = 0; o < 4; o += 1) {
    const gridSize = 4 << o
    const grid = new Float32Array((gridSize + 1) * (gridSize + 1))
    for (let i = 0; i < grid.length; i += 1) grid[i] = rand()
    octaves.push({ gridSize, grid })
  }
  const smooth = t => t * t * (3 - 2 * t)
  function noiseAt(x, y, oct) {
    const { gridSize, grid } = oct
    const gx = x * gridSize
    const gy = y * gridSize
    const x0 = Math.floor(gx)
    const y0 = Math.floor(gy)
    const fx = smooth(gx - x0)
    const fy = smooth(gy - y0)
    const xa = ((x0 % gridSize) + gridSize) % gridSize
    const ya = ((y0 % gridSize) + gridSize) % gridSize
    const xb = (xa + 1) % gridSize
    const yb = (ya + 1) % gridSize
    const row = gridSize + 1
    const a = grid[ya * row + xa] * (1 - fx) + grid[ya * row + xb] * fx
    const b = grid[yb * row + xa] * (1 - fx) + grid[yb * row + xb] * fx
    return a * (1 - fy) + b * fy
  }
  function fbm(x, y) {
    let value = 0
    let amp = 0.5
    let total = 0
    for (const oct of octaves) {
      value += noiseAt(x, y, oct) * amp
      total += amp
      amp *= 0.5
    }
    return value / total
  }
  const image = ctx.createImageData(W, H)
  for (let y = 0; y < H; y += 1) {
    for (let x = 0; x < W; x += 1) {
      const nx = x / W
      const ny = y / H
      const dx = (nx - 0.5) * 2
      const dy = (ny - 0.62) * 2.2
      let field = Math.sqrt(dx * dx + dy * dy)
      field += (fbm(nx * 2.4, ny * 2.8) - 0.5) * 0.62
      let density = Math.max(0, 1 - field * 1.28)
      if (density <= 0.01) continue
      const detail = fbm(nx * 7 + 3.1, ny * 7 + 1.7)
      density *= 0.5 + detail * 0.85
      density = Math.min(1, Math.max(0, density))
      const alpha = Math.pow(density, 1.45)
      if (alpha < 0.012) continue
      const lit = Math.min(1, Math.max(0, 0.42 + (0.6 - ny) * 1.25 + (detail - 0.5) * 0.4))
      const idx = (y * W + x) * 4
      image.data[idx] = 214 + lit * 41
      image.data[idx + 1] = 225 + lit * 30
      image.data[idx + 2] = 240 + lit * 15
      image.data[idx + 3] = alpha * 255
    }
  }
  ctx.putImageData(image, 0, 0)
  const tex = new THREE.CanvasTexture(canvas)
  tex.colorSpace = THREE.SRGBColorSpace
  return tex
}

export function createCloudLayerRuntime(THREE, options = {}) {
  const doc = options.document ?? globalThis.document
  const textures = []
  for (let i = 0; i < 6; i += 1) textures.push(makeCloudTexture(THREE, i + 3, doc))
  const group = new THREE.Group()
  group.name = 'world-cloud-layer'
  group.frustumCulled = false
  const clouds = []
  for (let index = 0; index < WEATHER_CLOUD_COUNT; index += 1) {
    const material = new THREE.MeshBasicMaterial({
      map: textures[index % textures.length] || null,
      color: textures[index % textures.length] ? '#ffffff' : '#eef3fa',
      transparent: true,
      depthWrite: false,
      fog: false,
      side: THREE.DoubleSide,
    })
    const cloud = new THREE.Mesh(new THREE.PlaneGeometry(1, 0.664), material)
    const angle = ((index * 2.399963) % (Math.PI * 2)) + (index % 3) * 0.21
    const radius = CLOUD_MIN_DISTANCE + ((index * 97) % 260)
    const height = CLOUD_MIN_HEIGHT + ((index * 53) % 170)
    cloud.position.set(Math.cos(angle) * radius, height, Math.sin(angle) * radius)
    const width = CLOUD_MIN_WIDTH + ((index * 31) % 70)
    cloud.scale.set(width, width, 1)
    cloud.renderOrder = 998
    cloud.visible = false
    group.add(cloud)
    clouds.push(cloud)
  }
  let cloudiness = 0

  function setCloudiness(count) {
    cloudiness = Math.max(0, Math.min(WEATHER_CLOUD_COUNT, Math.round(Number(count) || 0)))
    clouds.forEach((cloud, index) => { cloud.visible = index < cloudiness })
  }

  function update(delta, wind) {
    const windValue = Number(wind) || 0
    for (const cloud of clouds) {
      if (!cloud.visible) continue
      cloud.position.x += windValue * 4.2 * delta
      if (cloud.position.x > 620) cloud.position.x = -620
    }
  }

  function followCamera(position) {
    // 云层跟随相机水平位置，保证任意地块上空都有云；高度沿用各自随机值。
    group.position.x = position.x
    group.position.z = position.z
    group.position.y = 0
  }

  function setTint(color) {
    for (const cloud of clouds) cloud.material.color.set(color)
  }

  function setOrientation(camera) {
    for (const cloud of clouds) cloud.quaternion.copy(camera.quaternion)
  }

  let disposed = false
  function dispose() {
    if (disposed) return
    disposed = true
    for (const cloud of clouds) {
      cloud.geometry.dispose()
      cloud.material.dispose()
    }
    for (const texture of textures) texture?.dispose?.()
  }

  return {
    object: group,
    setCloudiness,
    update,
    followCamera,
    setTint,
    setOrientation,
    get cloudiness() {
      return cloudiness
    },
    dispose,
  }
}

export function createSnowFieldRuntime(THREE) {
  const positions = new Float32Array(SNOW_PARTICLE_COUNT * 3)
  const seeds = []
  for (let index = 0; index < SNOW_PARTICLE_COUNT; index += 1) {
    const x = ((index * 17) % 53) - SNOW_FIELD_HALF_SPAN
    const y = (index * 13) % SNOW_INITIAL_TOP
    const z = ((index * 29) % 53) - SNOW_FIELD_HALF_SPAN
    positions[index * 3] = x
    positions[index * 3 + 1] = y
    positions[index * 3 + 2] = z
    seeds.push({ sway: ((index * 7) % 628) / 100 })
  }
  const geometry = new THREE.BufferGeometry()
  const attribute = new THREE.BufferAttribute(positions, 3)
  attribute.setUsage(THREE.DynamicDrawUsage)
  geometry.setAttribute('position', attribute)
  const material = new THREE.PointsMaterial({
    color: '#ffffff', size: 0.28, transparent: true, opacity: 0.92, depthWrite: false, sizeAttenuation: true,
  })
  const object = new THREE.Points(geometry, material)
  object.name = 'world-snow-effect'
  object.frustumCulled = false
  object.visible = false

  function update(delta, wind) {
    if (!object.visible) return
    const windValue = Number(wind) || 0
    for (let index = 0; index < SNOW_PARTICLE_COUNT; index += 1) {
      const seed = seeds[index]
      seed.sway += delta * 1.8
      positions[index * 3] += Math.sin(seed.sway) * 0.55 * delta + windValue * 1.6 * delta
      positions[index * 3 + 1] -= SNOW_FALL_SPEED * delta
      if (positions[index * 3 + 1] < 0) {
        positions[index * 3] = ((index * 17) % 53) - SNOW_FIELD_HALF_SPAN
        positions[index * 3 + 1] = SNOW_RESET_BASE_Y + ((index * 11) % 10)
        positions[index * 3 + 2] = ((index * 29) % 53) - SNOW_FIELD_HALF_SPAN
      }
    }
    geometry.attributes.position.needsUpdate = true
  }

  function followCamera(position) {
    object.position.x = position.x
    object.position.z = position.z
    object.position.y = 0
  }

  function setVisible(visible) {
    object.visible = Boolean(visible)
  }

  // 雪量强度：drawRange 控制可见粒子数，颗粒大小与不透明度同步微调。
  function setIntensity(value) {
    const intensity = Math.max(0, Math.min(1, Number(value) || 0))
    const count = Math.max(0, Math.round(SNOW_PARTICLE_COUNT * intensity))
    geometry.setDrawRange(0, count)
    material.size = 0.16 + 0.26 * intensity
    material.opacity = 0.5 + 0.45 * intensity
  }

  let disposed = false
  function dispose() {
    if (disposed) return
    disposed = true
    geometry.dispose()
    material.dispose()
  }

  return {
    object,
    update,
    followCamera,
    setVisible,
    setIntensity,
    get visible() {
      return object.visible
    },
    dispose,
  }
}
