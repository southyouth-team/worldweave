// 程序化天空层：渐变穹顶 + 太阳/月亮实体球 + 上半球星空。
// 所有视觉参数来自 skyVisualState 的纯数据，本模块只负责 three 对象装配与生命周期。
import {
  SKY_DOME_RADIUS,
  CELESTIAL_ORBIT_RADIUS,
  SUN_DISK_RADIUS,
  MOON_DISK_RADIUS,
  STAR_COUNT,
  STAR_SHELL_RADIUS,
} from './skyVisualState.js'

const DOME_VERTEX_SHADER = /* glsl */ `
  varying vec3 vDirection;
  void main() {
    vDirection = position;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`

const DOME_FRAGMENT_SHADER = /* glsl */ `
  uniform vec3 topColor;
  uniform vec3 horizonColor;
  varying vec3 vDirection;
  void main() {
    float h = normalize(vDirection).y;
    float mixAmount = smoothstep(-0.15, 0.4, h);
    gl_FragColor = vec4(mix(horizonColor, topColor, mixAmount), 1.0);
    #include <colorspace_fragment>
  }
`

// 天体显示仰角压缩：真实太阳 14 点仰角约 60°，总览俯瞰视角够不到画面。
// 只压缩「显示位置」的 y 分量（球体无朝向，不影响光照方向与透明度计算），
// 让太阳/月亮稳定出现在随视角可见的天空带里。
const CELESTIAL_HEIGHT_SQUASH = 0.42

// 球体天体通用顶点着色器：球面法线 + 视线方向，用于体积明暗
const BODY_VERTEX_SHADER = /* glsl */ `
  varying vec2 vUv;
  varying vec3 vNormalView;
  varying vec3 vViewDirection;
  void main() {
    vUv = uv;
    vNormalView = normalize(normalMatrix * normal);
    vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
    vViewDirection = -mvPosition.xyz;
    gl_Position = projectionMatrix * mvPosition;
  }
`

// 太阳球体：核心炽白、边缘暖黄，facing 决定体积明暗
const SUN_BODY_FRAGMENT_SHADER = /* glsl */ `
  uniform float uOpacity;
  uniform vec3 uCoreColor;
  uniform vec3 uEdgeColor;
  varying vec2 vUv;
  varying vec3 vNormalView;
  varying vec3 vViewDirection;
  void main() {
    float facing = clamp(dot(normalize(vNormalView), normalize(vViewDirection)), 0.0, 1.0);
    vec3 color = mix(uEdgeColor, uCoreColor, pow(facing, 1.5));
    gl_FragColor = vec4(color, uOpacity);
    #include <colorspace_fragment>
  }
`

// 太阳辉光球：中心亮、边缘 alpha 渐隐到 0，避免露出球体轮廓（加性混合）。
const SUN_HALO_FRAGMENT_SHADER = /* glsl */ `
  uniform float uOpacity;
  uniform float uPeak;
  uniform vec3 uColor;
  varying vec2 vUv;
  varying vec3 vNormalView;
  varying vec3 vViewDirection;
  void main() {
    float facing = clamp(dot(normalize(vNormalView), normalize(vViewDirection)), 0.0, 1.0);
    float alpha = uPeak * pow(facing, 2.4) * uOpacity;
    gl_FragColor = vec4(uColor * alpha, alpha);
    #include <colorspace_fragment>
  }
`

// 月亮球体：球面 fbm 画月海，边缘做球体明暗，不再是平面贴片
const MOON_BODY_FRAGMENT_SHADER = /* glsl */ `
  uniform float uOpacity;
  varying vec2 vUv;
  varying vec3 vNormalView;
  varying vec3 vViewDirection;

  float hash21(vec2 p) {
    return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
  }
  float valueNoise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    float a = hash21(i);
    float b = hash21(i + vec2(1.0, 0.0));
    float c = hash21(i + vec2(0.0, 1.0));
    float e = hash21(i + vec2(1.0, 1.0));
    return mix(mix(a, b, u.x), mix(c, e, u.x), u.y);
  }
  float fbm(vec2 p) {
    float value = 0.0;
    float amplitude = 0.5;
    for (int i = 0; i < 4; i += 1) {
      value += amplitude * valueNoise(p);
      p *= 2.0;
      amplitude *= 0.5;
    }
    return value;
  }

  // 环形山：网格化随机圆坑，坑内略暗、坑缘略亮（月面典型地貌）
  float craterField(vec2 p) {
    vec2 cell = floor(p * 7.0);
    vec2 f = fract(p * 7.0) - 0.5;
    float r = hash21(cell) * 0.26 + 0.08;
    vec2 offset = (vec2(hash21(cell + 3.1), hash21(cell + 7.7)) - 0.5) * 0.55;
    float d = length(f - offset);
    float bowl = 1.0 - smoothstep(r * 0.65, r, d);
    float rim = smoothstep(r, r * 1.12, d) * (1.0 - smoothstep(r * 1.12, r * 1.3, d));
    return bowl - rim * 0.7;
  }

  void main() {
    float maria = smoothstep(0.52, 0.74, fbm(vUv * 4.0 + 5.0));
    vec3 surface = mix(vec3(0.91, 0.94, 1.0), vec3(0.6, 0.66, 0.79), maria * 0.85);
    // 环形山明暗（坑暗、缘亮），频率与月海错开
    float craters = craterField(vUv * 1.35 + 2.7);
    surface *= 1.0 - clamp(craters, -0.12, 0.22);
    float facing = clamp(dot(normalize(vNormalView), normalize(vViewDirection)), 0.0, 1.0);
    float limb = mix(0.55, 1.0, pow(facing, 0.55));
    gl_FragColor = vec4(surface * limb, uOpacity);
    #include <colorspace_fragment>
  }
`

function createDome(THREE) {
  const geometry = new THREE.SphereGeometry(SKY_DOME_RADIUS, 32, 16)
  const material = new THREE.ShaderMaterial({
    uniforms: {
      topColor: { value: new THREE.Color(0x111d31) },
      horizonColor: { value: new THREE.Color(0xb9d0c2) },
    },
    vertexShader: DOME_VERTEX_SHADER,
    fragmentShader: DOME_FRAGMENT_SHADER,
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
  })
  const dome = new THREE.Mesh(geometry, material)
  dome.name = 'sky-dome'
  dome.frustumCulled = false
  dome.renderOrder = -1
  return { dome, material }
}

// 太阳：高亮核心 + 两层递增范围的加性辉光。真实太阳是刺眼光核被大面积柔光包围，
// 清晰的实体球边缘会显得像"挂了个球"，因此核心缩小、辉光层放大。
function createSunBody(THREE) {
  const group = new THREE.Group()
  group.name = 'sky-sun'
  const coreMaterial = new THREE.ShaderMaterial({
    uniforms: {
      uOpacity: { value: 0 },
      uCoreColor: { value: new THREE.Color(0xffffff) },
      uEdgeColor: { value: new THREE.Color(0xffeec0) },
    },
    vertexShader: BODY_VERTEX_SHADER,
    fragmentShader: SUN_BODY_FRAGMENT_SHADER,
    transparent: true,
    depthWrite: false,
    fog: false,
  })
  const core = new THREE.Mesh(new THREE.SphereGeometry(SUN_DISK_RADIUS * 0.55, 24, 18), coreMaterial)
  core.name = 'sky-sun-core'
  core.castShadow = false
  core.receiveShadow = false

  function makeHalo(name, radius, color, peakOpacity) {
    const material = new THREE.ShaderMaterial({
      uniforms: {
        uOpacity: { value: 0 },
        uPeak: { value: peakOpacity },
        uColor: { value: new THREE.Color(color) },
      },
      vertexShader: BODY_VERTEX_SHADER,
      fragmentShader: SUN_HALO_FRAGMENT_SHADER,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      fog: false,
    })
    const mesh = new THREE.Mesh(new THREE.SphereGeometry(radius, 20, 14), material)
    mesh.name = name
    mesh.castShadow = false
    mesh.receiveShadow = false
    return mesh
  }
  const halo = makeHalo('sky-sun-halo', SUN_DISK_RADIUS * 1.7, 0xffe9b0, 0.34)
  const glow = makeHalo('sky-sun-glow', SUN_DISK_RADIUS * 3.6, 0xffd98c, 0.11)

  group.add(core, halo, glow)
  group.userData.coreMaterial = coreMaterial
  group.userData.halos = [halo, glow]
  return group
}

// 月亮：实体球，球面 fbm 月海 + 球体明暗。
function createMoonBody(THREE) {
  const material = new THREE.ShaderMaterial({
    uniforms: { uOpacity: { value: 0 } },
    vertexShader: BODY_VERTEX_SHADER,
    fragmentShader: MOON_BODY_FRAGMENT_SHADER,
    transparent: true,
    depthWrite: false,
    fog: false,
  })
  const body = new THREE.Mesh(new THREE.SphereGeometry(MOON_DISK_RADIUS, 24, 18), material)
  body.name = 'sky-moon'
  body.castShadow = false
  body.receiveShadow = false
  return body
}

function createStars(THREE) {
  const positions = new Float32Array(STAR_COUNT * 3)
  for (let i = 0; i < STAR_COUNT; i += 1) {
    // 均匀球面采样，拒绝低仰角方向，保证星点只出现在上半天球。
    let x = 0
    let y = 0
    let z = 0
    do {
      const u = Math.random() * 2 - 1
      const theta = Math.random() * Math.PI * 2
      const radial = Math.sqrt(Math.max(0, 1 - u * u))
      x = radial * Math.cos(theta)
      y = u
      z = radial * Math.sin(theta)
    } while (y <= 0.02)
    positions[i * 3] = x * STAR_SHELL_RADIUS
    positions[i * 3 + 1] = y * STAR_SHELL_RADIUS
    positions[i * 3 + 2] = z * STAR_SHELL_RADIUS
  }
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3))
  const material = new THREE.PointsMaterial({
    color: 0xffffff,
    size: 1.4,
    sizeAttenuation: true,
    transparent: true,
    opacity: 0,
    depthWrite: false,
    fog: false,
  })
  const stars = new THREE.Points(geometry, material)
  stars.name = 'sky-stars'
  return stars
}

export function createSkyRuntime(THREE) {
  const group = new THREE.Group()
  const { dome, material: domeMaterial } = createDome(THREE)
  const sun = createSunBody(THREE)
  const moon = createMoonBody(THREE)
  const stars = createStars(THREE)
  group.add(dome, sun, moon, stars)
  const sunCoreMaterial = sun.userData.coreMaterial
  const sunHalos = sun.userData.halos

  // 显示方向：压缩 y 分量后重新归一化，让天体落在俯瞰视角可见的天空带里。
  function displayDirection(direction) {
    const y = Math.max(0.06, direction[1] * CELESTIAL_HEIGHT_SQUASH)
    const horizontal = Math.sqrt(Math.max(0, 1 - y * y))
    const length = Math.hypot(direction[0], direction[2])
    if (length < 1e-6) return new THREE.Vector3(0, y, horizontal)
    return new THREE.Vector3(
      (direction[0] / length) * horizontal,
      y,
      (direction[2] / length) * horizontal,
    )
  }

  function placeBody(body, direction) {
    body.position.copy(displayDirection(direction)).multiplyScalar(CELESTIAL_ORBIT_RADIUS)
  }

  function update(state) {
    domeMaterial.uniforms.topColor.value.setRGB(state.skyTop.r, state.skyTop.g, state.skyTop.b)
    domeMaterial.uniforms.horizonColor.value.setRGB(
      state.skyHorizon.r,
      state.skyHorizon.g,
      state.skyHorizon.b,
    )
    placeBody(sun, state.sun.direction)
    placeBody(moon, state.moon.direction)
    sunCoreMaterial.uniforms.uOpacity.value = state.sun.opacity
    for (const halo of sunHalos) {
      halo.material.uniforms.uOpacity.value = state.sun.opacity
    }
    sun.visible = state.sun.opacity > 0.001
    moon.material.uniforms.uOpacity.value = state.moon.opacity
    moon.visible = state.moon.opacity > 0.001
    stars.material.opacity = state.starsOpacity
  }

  function followCamera(position) {
    group.position.copy(position)
  }

  function setIndoor(indoor) {
    group.visible = !indoor
  }

  let disposed = false
  function dispose() {
    if (disposed) return
    disposed = true
    group.traverse((object) => {
      object.geometry?.dispose?.()
      const materials = Array.isArray(object.material) ? object.material : [object.material]
      for (const material of materials) material?.dispose?.()
    })
  }

  return { group, update, followCamera, setIndoor, dispose }
}
