// 可编辑文字：生成的模型不自己画字形，而是在部件上声明 userData.textSpec，
// 由宿主用支持中文的字体渲染成贴图平面。文字内容可随时修改并重新渲染，
// 也能跨 Worker 序列化（CanvasTexture 本身不会被保存，textSpec 会）。

const DEFAULT_FONT_FAMILY = '"Microsoft YaHei", "PingFang SC", "Noto Sans CJK SC", "Source Han Sans SC", "WenQuanYi Micro Hei", sans-serif'
const MAX_TEXT_LENGTH = 200

function normalizeVector(value, fallback) {
  if (!value || typeof value !== 'object') return { ...fallback }
  return {
    x: Number.isFinite(Number(value.x)) ? Number(value.x) : fallback.x,
    y: Number.isFinite(Number(value.y)) ? Number(value.y) : fallback.y,
    z: Number.isFinite(Number(value.z)) ? Number(value.z) : fallback.z,
  }
}

export function normalizeTextSpec(spec) {
  if (!spec || typeof spec !== 'object') return null
  const text = typeof spec.text === 'string' ? spec.text.slice(0, MAX_TEXT_LENGTH) : ''
  if (!text.trim()) return null
  const width = Number(spec.width) > 0 ? Number(spec.width) : 4
  const height = Number(spec.height) > 0 ? Number(spec.height) : 1
  return {
    text,
    width,
    height,
    color: typeof spec.color === 'string' && spec.color ? spec.color : '#ffffff',
    backgroundColor: typeof spec.backgroundColor === 'string' ? spec.backgroundColor : '',
    fontFamily: typeof spec.fontFamily === 'string' && spec.fontFamily ? spec.fontFamily : DEFAULT_FONT_FAMILY,
    fontSize: Number(spec.fontSize) > 0 ? Number(spec.fontSize) : 0,
    align: ['left', 'center', 'right'].includes(spec.align) ? spec.align : 'center',
    verticalAlign: ['top', 'middle', 'bottom'].includes(spec.verticalAlign) ? spec.verticalAlign : 'middle',
    position: normalizeVector(spec.position, { x: 0, y: 0, z: 0.01 }),
    rotation: normalizeVector(spec.rotation, { x: 0, y: 0, z: 0 }),
    pixelsPerUnit: Number(spec.pixelsPerUnit) > 0 ? Number(spec.pixelsPerUnit) : 256,
  }
}

export function renderTextTexture(THREE, spec) {
  if (typeof document === 'undefined') return null
  const width = Math.max(64, Math.min(2048, Math.round(spec.width * spec.pixelsPerUnit)))
  const height = Math.max(32, Math.min(2048, Math.round(spec.height * spec.pixelsPerUnit)))
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const context = canvas.getContext('2d')
  if (!context) return null
  if (spec.backgroundColor) {
    context.fillStyle = spec.backgroundColor
    context.fillRect(0, 0, width, height)
  }
  // 自动字号：从画布高度的 60% 开始，按文字宽度收缩，避免中文被裁掉
  let fontSize = spec.fontSize > 0 ? spec.fontSize : Math.round(height * 0.6)
  const maxTextWidth = width * 0.88
  context.font = '600 ' + fontSize + 'px ' + spec.fontFamily
  let measured = context.measureText(spec.text).width
  while (measured > maxTextWidth && fontSize > 10) {
    fontSize = Math.max(10, Math.floor(fontSize * 0.92))
    context.font = '600 ' + fontSize + 'px ' + spec.fontFamily
    measured = context.measureText(spec.text).width
  }
  context.fillStyle = spec.color
  context.textAlign = spec.align
  context.textBaseline = 'middle'
  const x = spec.align === 'left' ? width * 0.06 : spec.align === 'right' ? width * 0.94 : width / 2
  const y = spec.verticalAlign === 'top' ? height * 0.22 : spec.verticalAlign === 'bottom' ? height * 0.78 : height / 2
  context.fillText(spec.text, x, y)
  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  texture.anisotropy = 4
  return texture
}

function findPart(root, partId) {
  let match = null
  root?.traverse?.(object => {
    if (!match && String(object.userData?.componentId || '') === String(partId)) match = object
  })
  return match
}

/**
 * 为模型里所有带 userData.textSpec 的部件创建/刷新文字平面。
 * 返回处理的部件数量；无画布环境（如 Node 测试）时安全跳过。
 */
export function applyTextPlates(THREE, model) {
  if (!model?.isObject3D) return 0
  let applied = 0
  model.traverse(object => {
    const spec = normalizeTextSpec(object?.userData?.textSpec)
    if (!spec) return
    let plate = object.getObjectByName('host-text-plate')
    if (!plate) {
      plate = new THREE.Mesh(
        new THREE.PlaneGeometry(spec.width, spec.height),
        new THREE.MeshStandardMaterial({ transparent: true, roughness: 0.9, metalness: 0 }),
      )
      plate.name = 'host-text-plate'
      plate.userData.hostTextPlate = true
      plate.userData.collisionPolicy = 'none'
      object.add(plate)
    } else {
      plate.geometry?.dispose?.()
      plate.geometry = new THREE.PlaneGeometry(spec.width, spec.height)
    }
    const texture = renderTextTexture(THREE, spec)
    if (texture) {
      plate.material.map?.dispose?.()
      plate.material.map = texture
      plate.material.transparent = true
      plate.material.needsUpdate = true
    }
    plate.position.set(spec.position.x, spec.position.y, spec.position.z)
    plate.rotation.set(spec.rotation.x, spec.rotation.y, spec.rotation.z)
    applied += 1
  })
  return applied
}

/** 修改某个部件的文字并重新渲染；返回是否找到该部件。 */
export function updateTextPlate(THREE, model, partId, patch) {
  const part = findPart(model, partId)
  if (!part) return false
  part.userData.textSpec = { ...(part.userData.textSpec || {}), ...(patch || {}) }
  applyTextPlates(THREE, model)
  return true
}

export function getPartTextSpec(model, partId) {
  const part = findPart(model, partId)
  return part?.userData?.textSpec || null
}
