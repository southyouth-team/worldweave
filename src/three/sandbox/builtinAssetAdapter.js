/**
 * 内置素材适配层：把场景资产生成器注册表的产物转成带完整碰撞声明的沙盒模型。
 *
 * 只做适配与标注，不修改生成器注册表（sceneAssetGeneratorRegistry.js 只读消费）。
 * 每个 Mesh 都会获得稳定 componentId 与显式 collisionPolicy；required 部件
 * 同步生成 box 碰撞声明，产物可直接通过 analyzeModelCollisionCompleteness 门禁。
 */

export const BUILTIN_CATEGORY_LABELS = Object.freeze({
  vegetation: '植被',
  structure: '构筑物',
  facility: '设施',
  decoration: '装饰',
  sports: '运动',
})

export const BUILTIN_ASSET_CATALOG = Object.freeze([
  { category: 'vegetation', objectType: 'tree', label: '乔木' },
  { category: 'vegetation', objectType: 'shrub', label: '灌木' },
  { category: 'vegetation', objectType: 'flower', label: '花卉' },
  { category: 'structure', objectType: 'bridge', label: '人行桥' },
  { category: 'structure', objectType: 'pergola', label: '廊架' },
  { category: 'structure', objectType: 'pavilion', label: '凉亭' },
  { category: 'facility', objectType: 'bench', label: '长椅' },
  { category: 'facility', objectType: 'lamp', label: '路灯' },
  { category: 'facility', objectType: 'bin', label: '垃圾桶' },
  { category: 'facility', objectType: 'sign', label: '指示牌' },
  { category: 'decoration', objectType: 'rock', label: '景观石' },
  { category: 'decoration', objectType: 'flowerbed', label: '花坛' },
  { category: 'sports', objectType: 'basketball-hoop', label: '篮球架' },
])

export const BUILTIN_ASSET_LABELS = Object.freeze(
  Object.fromEntries(
    BUILTIN_ASSET_CATALOG.map(entry => [`${entry.category}:${entry.objectType}`, entry.label]),
  ),
)

// 真实世界默认尺寸（米），以 1.7m 玩家为基准的校园常见规格。
// 生成器内部按这些输入等比派生部件；不传时注册表会退回 2m 立方默认值，比例全错。
export const BUILTIN_ASSET_DIMENSIONS = Object.freeze({
  // 生成器对树冠/灌木有 0.5–0.7 的收缩系数，输入需比目标包络放大；数值经实测包围盒校准
  'vegetation:tree': { width: 5.6, height: 6.5, depth: 5.6 },
  'vegetation:shrub': { width: 1.7, height: 1.3, depth: 1.7 },
  // 花朵数量随 width 增长（floor(width*2)），宽度 ≥2.5 才会形成两排布局、产生真实纵深
  'vegetation:flower': { width: 2.6, height: 0.55, depth: 1.2 },
  'structure:bridge': { width: 6, height: 1.6, depth: 2.5 },
  'structure:pergola': { width: 3, height: 3, depth: 3 },
  'structure:pavilion': { width: 3, height: 3, depth: 3 },
  'facility:bench': { width: 1.8, height: 0.95, depth: 0.65 },
  'facility:lamp': { width: 0.6, height: 3.8, depth: 0.6 },
  'facility:bin': { width: 0.55, height: 1.05, depth: 0.55 },
  'facility:sign': { width: 0.9, height: 2.1, depth: 0.3 },
  // 景观石几何经 radius 系数与非均匀 scale 双重收缩，输入需显著放大
  'decoration:rock': { width: 4, height: 1.8, depth: 3.5 },
  'decoration:flowerbed': { width: 2.1, height: 0.9, depth: 1.1 },
  // 篮筐真实高度 3.05m：生成器 rim.y = height * 0.62，故 height 取 4.9
  'sports:basketball-hoop': { width: 2.9, height: 4.9, depth: 1.8 },
})

// 碰撞规则表（规格 §4.3 的单一来源）：required 前缀的部件生成 box 声明，
// none 前缀的部件纯视觉；noneAll 表示该素材全部部件均不阻挡。
const COLLISION_RULES = Object.freeze({
  'vegetation:tree': { required: ['trunk'], none: ['crown'] },
  'vegetation:shrub': { noneAll: true },
  'vegetation:flower': { noneAll: true },
  'structure:bridge': { required: ['deck', 'railing', 'baluster', 'pier'], none: [] },
  'structure:pergola': { required: ['post'], none: ['roof'] },
  'structure:pavilion': { required: ['post'], none: ['roof'] },
  'facility:bench': { required: ['seat', 'back', 'leg', 'armrest'], none: [] },
  'facility:lamp': { required: ['pole', 'head'], none: ['emitter'] },
  'facility:bin': { required: ['body', 'lid'], none: [] },
  'facility:sign': { required: ['post', 'board'], none: [] },
  'decoration:rock': { required: ['rock-body'], none: [] },
  'decoration:flowerbed': { required: ['border'], none: ['soil', 'flowerbed-flower'] },
  'sports:basketball-hoop': { required: ['support'], none: ['backboard', 'rim'] },
})

// 生成器中部分 Mesh 没有 name（灌木树冠、花卉花朵、景观石、花坛花朵），
// 适配层必须显式兜底语义，禁止让未命名部件落到静默默认策略。
const UNNAMED_SEMANTIC_FALLBACK = Object.freeze({
  'vegetation:shrub': 'shrub-crown',
  'vegetation:flower': 'flower-bloom',
  'decoration:rock': 'rock-body',
  'decoration:flowerbed': 'flowerbed-flower',
})

// 路灯点光源参数与既有开关灯演示（WorldSandboxMvp.addLightSwitchDemo）保持一致。
// castShadow 关闭：点光源阴影是六面立方渲染，内置路灯可能被大量放置，阴影交给场景日月。
const LAMP_POINT_LIGHT = Object.freeze({ color: '#ffd98a', intensity: 2.2, distance: 11, decay: 1.8 })

export function listBuiltinAssets() {
  return BUILTIN_ASSET_CATALOG.map(entry => ({
    category: entry.category,
    objectType: entry.objectType,
    label: entry.label,
  }))
}

function deriveSemantic(meshName, assetKey) {
  const name = String(meshName || '').trim()
  if (!name) {
    const fallback = UNNAMED_SEMANTIC_FALLBACK[assetKey]
    if (!fallback) {
      throw new Error(`内置素材 ${assetKey} 出现未命名 Mesh，适配层缺少语义兜底规则`)
    }
    return fallback
  }
  return name.replace(/-\d+$/, '')
}

function matchesPrefix(semantic, prefix) {
  return semantic === prefix
    || semantic.startsWith(`${prefix}-`)
    || semantic.endsWith(`-${prefix}`)
    || semantic.includes(`-${prefix}-`)
}

function resolvePolicy(assetKey, semantic) {
  const rule = COLLISION_RULES[assetKey]
  if (rule.noneAll) return 'none'
  const isRequired = rule.required.some(prefix => matchesPrefix(semantic, prefix))
  const isNone = rule.none.some(prefix => matchesPrefix(semantic, prefix))
  if (isRequired && isNone) {
    throw new Error(`内置素材碰撞规则表冲突：${assetKey} 的 ${semantic} 同时命中 required 与 none`)
  }
  if (!isRequired && !isNone) {
    throw new Error(`内置素材适配层缺少碰撞分类规则：${assetKey} 的 ${semantic}`)
  }
  return isRequired ? 'required' : 'none'
}

function localBoxSize(THREE, mesh) {
  if (!mesh.geometry) {
    throw new Error(`内置素材部件 ${mesh.name || '(未命名)'} 缺少几何，无法生成 box 碰撞声明`)
  }
  if (!mesh.geometry.boundingBox) mesh.geometry.computeBoundingBox()
  const size = mesh.geometry.boundingBox.getSize(new THREE.Vector3())
  if (!['x', 'y', 'z'].every(axis => Number.isFinite(size[axis]) && size[axis] > 0)) {
    throw new Error(`内置素材部件 ${mesh.name || '(未命名)'} 的局部几何尺寸非法，无法生成 box 碰撞声明`)
  }
  return { x: size.x, y: size.y, z: size.z }
}

/**
 * 为内置路灯补真实光源与环境总开关接线。生成器的 lamp-emitter 只是
 * MeshBasicMaterial 发光片（无 PointLight、无绑定），不接线则环境面板的
 * 「人工灯光总开关」（lighting.artificial.enabled）对它完全无效。
 * 灯光是模型自带功能光源，符合 modelSubtreePolicy（PointLight 且带 componentId）。
 */
function attachLampEnvironmentLighting(THREE, root, { category, objectType, semanticSeq }) {
  const emitter = root.children.find(child => child.isMesh && child.name === 'lamp-emitter')
  if (!emitter?.userData.componentId) {
    throw new Error('内置路灯缺少已标注的 lamp-emitter 部件，无法接线人工灯光环境控制')
  }

  const semantic = 'lamp-light'
  const seq = semanticSeq.get(semantic) ?? 0
  semanticSeq.set(semantic, seq + 1)
  const lightComponentId = `${category}-${objectType}-${semantic}-${seq}`

  const light = new THREE.PointLight(
    LAMP_POINT_LIGHT.color, LAMP_POINT_LIGHT.intensity, LAMP_POINT_LIGHT.distance, LAMP_POINT_LIGHT.decay,
  )
  light.name = 'lamp-light'
  light.position.copy(emitter.position)
  light.castShadow = false
  // 带 componentId 的对象（不限 Mesh）都会进入碰撞分析器，必须显式声明 none
  light.userData.componentId = lightComponentId
  light.userData.collisionPolicy = 'none'
  root.add(light)

  // 与引擎 applySandboxEnvironmentBindings 的全局键一致；intensity 控制真实光源，
  // visible 控制发光片（MeshBasicMaterial 没有 emissiveIntensity，不能用材质分支）。
  root.userData.proceduralModelEnvironmentBindings = [
    {
      variable: 'lighting.artificial.enabled',
      targetPartId: lightComponentId,
      property: 'intensity',
      enabledValue: LAMP_POINT_LIGHT.intensity,
      disabledValue: 0,
      defaultValue: true,
    },
    {
      variable: 'lighting.artificial.enabled',
      targetPartId: emitter.userData.componentId,
      property: 'visible',
      enabledValue: true,
      disabledValue: false,
      defaultValue: true,
    },
  ]
}

export function createBuiltinSandboxModel(THREE, registry, { category, objectType } = {}) {
  const assetKey = `${category}:${objectType}`
  const catalogEntry = BUILTIN_ASSET_CATALOG.find(
    entry => entry.category === category && entry.objectType === objectType,
  )
  if (!catalogEntry) {
    throw new Error(`内置素材适配层暂不支持该素材：${category}/${objectType}`)
  }

  const dimensions = BUILTIN_ASSET_DIMENSIONS[assetKey]
  if (!dimensions) {
    throw new Error(`内置素材适配层缺少真实尺寸配置：${assetKey}`)
  }
  const root = registry.generate({ category, objectType, visualStyle: 'stylized', dimensions })
  const colliders = []
  const semanticSeq = new Map()

  root.traverse(mesh => {
    if (!mesh.isMesh) return
    const semantic = deriveSemantic(mesh.name, assetKey)
    const seq = semanticSeq.get(semantic) ?? 0
    semanticSeq.set(semantic, seq + 1)
    const componentId = `${category}-${objectType}-${semantic}-${seq}`
    const policy = resolvePolicy(assetKey, semantic)

    mesh.userData.componentId = componentId
    mesh.userData.collisionPolicy = policy

    if (policy === 'required') {
      colliders.push({
        id: `collider-${componentId}`,
        targetPartId: componentId,
        shape: 'box',
        center: { x: 0, y: 0, z: 0 },
        size: localBoxSize(THREE, mesh),
      })
    }
  })

  if (assetKey === 'facility:lamp') {
    attachLampEnvironmentLighting(THREE, root, { category, objectType, semanticSeq })
  }

  root.userData.assetName = catalogEntry.label
  root.userData.proceduralModelSource = null
  root.userData.builtinAssetRef = { category, objectType }
  root.userData.proceduralModelCapabilityManifest = {
    version: 1,
    parameters: [],
    capabilities: {
      spatial: { colliders },
    },
  }
  return root
}
