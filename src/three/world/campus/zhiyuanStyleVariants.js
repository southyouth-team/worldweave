/**
 * 临时风格对照试点：致远楼「精致风格化」与「写实细节」双版本。
 * 用户在内置库并排摆放后拍板风格，随后本模块与对应目录项一并删除或转正。
 *
 * 两版共享 80×21×16 主尺度与一楼可进入的开放布局；不含教室家具（仅外观对比）。
 * 风格化 = RoundedBox 形体 + 克制配色 + 遮阳鳍片节奏；
 * 写实 = canvas 砖纹/板材贴图 + 逐窗框/窗台/竖梃 + 入口双开门与落水管。
 */
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js'

const DESIGN = Object.freeze({ width: 80, height: 21, depth: 16 })

function makeBrickTexture(THREE, doc) {
  const canvas = doc?.createElement?.('canvas')
  const ctx = canvas?.getContext?.('2d')
  if (!canvas || !ctx) return null
  canvas.width = 256
  canvas.height = 256
  ctx.fillStyle = '#9b5545'
  ctx.fillRect(0, 0, 256, 256)
  for (let row = 0; row < 16; row += 1) {
    const y = row * 16
    ctx.fillStyle = 'rgba(230,220,205,0.55)'
    ctx.fillRect(0, y, 256, 1.6)
    const offset = row % 2 ? 32 : 0
    for (let x = -offset; x < 256; x += 64) {
      ctx.fillRect(x, y, 1.6, 16)
      ctx.fillStyle = `rgba(0,0,0,${0.04 + ((row * 7 + x) % 5) * 0.015})`
      ctx.fillRect(x + 2, y + 2, 60, 12)
      ctx.fillStyle = 'rgba(230,220,205,0.55)'
    }
  }
  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping
  texture.repeat.set(4, 4)
  texture.anisotropy = 4
  return texture
}

function makePanelTexture(THREE, doc) {
  const canvas = doc?.createElement?.('canvas')
  const ctx = canvas?.getContext?.('2d')
  if (!canvas || !ctx) return null
  canvas.width = 256
  canvas.height = 256
  ctx.fillStyle = '#ded8ca'
  ctx.fillRect(0, 0, 256, 256)
  ctx.strokeStyle = 'rgba(120,110,95,0.35)'
  ctx.lineWidth = 1.5
  for (let y = 0; y <= 256; y += 64) {
    ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(256, y); ctx.stroke()
  }
  for (let x = 0; x <= 256; x += 128) {
    ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, 256); ctx.stroke()
  }
  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping
  texture.repeat.set(3, 2)
  return texture
}

// RoundedBoxGeometry 继承 BoxGeometry，其 toJSON 只写构造参数、不写顶点数据，
// ObjectLoader 无法据此重建（存档恢复会抛错）。这里把它展开为标准 BufferGeometry，
// 让 toJSON 走通用属性序列化路径，保证沙盒存档可完整往返。
function toSerializableGeometry(THREE, source) {
  const geometry = new THREE.BufferGeometry()
  for (const name of Object.keys(source.attributes)) {
    geometry.setAttribute(name, source.attributes[name].clone())
  }
  if (source.index) geometry.setIndex(source.index.clone())
  return geometry
}

function makeBuilder(THREE, group, materials, rounded) {
  return function addBox(name, w, h, d, x, y, z, materialKey, radius = 0) {
    let geometry
    if (rounded && radius > 0) {
      const source = new RoundedBoxGeometry(w, h, d, 2, Math.min(radius, w / 2, h / 2, d / 2))
      geometry = toSerializableGeometry(THREE, source)
      source.dispose()
    } else {
      geometry = new THREE.BoxGeometry(w, h, d)
    }
    const mesh = new THREE.Mesh(geometry, materials[materialKey])
    mesh.name = name
    mesh.position.set(x, y, z)
    mesh.castShadow = true
    mesh.receiveShadow = true
    group.add(mesh)
    return mesh
  }
}

// 两版共用的一楼开放结构：地板、顶板、带真实窗洞的前后墙、入口。
function buildOpenGroundFloor(THREE, addBox, palette) {
  addBox('zhiyuan-floor', 36, 0.2, 16, 0, -0.1, 0, 'floor')
  addBox('zhiyuan-solid-ceiling', 36, 0.3, 16, 0, 3.75, 0, 'trim')
  const windowWall = (xMin, xMax, z, bays) => {
    const bayWidth = (xMax - xMin) / bays
    for (let i = 0; i <= bays; i += 1) {
      addBox('zhiyuan-wall', 0.6, 3.9, 0.3, xMin + i * bayWidth, 1.95, z, 'trim')
    }
    for (let i = 0; i < bays; i += 1) {
      const cx = xMin + (i + 0.5) * bayWidth
      const clear = bayWidth - 0.6
      addBox('zhiyuan-wall', clear, 0.9, 0.3, cx, 0.45, z, 'wall')
      addBox('zhiyuan-wall', clear, 1, 0.3, cx, 3.4, z, 'wall')
      addBox('zhiyuan-window-glass', clear, 2, 0.05, cx, 1.9, z, 'glass')
      addBox('zhiyuan-frame', clear + 0.08, 0.08, 0.12, cx, 0.94, z, 'frame')
      addBox('zhiyuan-frame', clear + 0.08, 0.08, 0.12, cx, 2.9, z, 'frame')
    }
  }
  windowWall(-18, -1.5, 8, 4)
  windowWall(1.5, 18, 8, 4)
  windowWall(-18, 18, -8, 8)
  addBox('zhiyuan-wall', 3, 1.3, 0.3, 0, 3.25, 8, 'trim')
}

function scaleToDimensions(THREE, group, dimensions) {
  const { width = 80, height = 21, depth = 16 } = dimensions || {}
  const kx = width / DESIGN.width
  const ky = height / DESIGN.height
  const kz = depth / DESIGN.depth
  if (kx === 1 && ky === 1 && kz === 1) return
  group.traverse(object => {
    if (object.isMesh) {
      object.geometry.scale(kx, ky, kz)
      object.position.set(object.position.x * kx, object.position.y * ky, object.position.z * kz)
    }
  })
}

/** 精致风格化：形体与比例优先，遮阳鳍片 + 圆角 + 克制配色。 */
export function createZhiyuanStylized(THREE, dimensions, options = {}) {
  const group = new THREE.Group()
  group.name = 'campus-zhiyuan-stylized'
  const materials = {
    brick: new THREE.MeshStandardMaterial({ color: '#a45a46', roughness: 0.85 }),
    wall: new THREE.MeshStandardMaterial({ color: '#e7e1d4', roughness: 0.9 }),
    trim: new THREE.MeshStandardMaterial({ color: '#f2eee4', roughness: 0.85 }),
    frame: new THREE.MeshStandardMaterial({ color: '#4a4238', roughness: 0.5, metalness: 0.3 }),
    glass: new THREE.MeshStandardMaterial({ color: '#7d9aa8', roughness: 0.28, metalness: 0.15 }),
    coping: new THREE.MeshStandardMaterial({ color: '#cfc6b6', roughness: 0.8 }),
    plinth: new THREE.MeshStandardMaterial({ color: '#8f8678', roughness: 0.9 }),
    floor: new THREE.MeshStandardMaterial({ color: '#aaa99f', roughness: 0.8 }),
  }
  const addBox = makeBuilder(THREE, group, materials, true)

  for (const x of [-29, 29]) {
    addBox('zhiyuan-wing', 22, 21, 16, x, 10.5, 0, 'brick', 0.12)
    addBox('zhiyuan-coping', 22.3, 0.35, 16.3, x, 21.0, 0, 'coping', 0.06)
    addBox('zhiyuan-plinth', 22.3, 0.6, 16.3, x, 0.3, 0, 'plinth', 0.04)
    // 翼楼竖向大窗：圆角深色框 + 内嵌玻璃，形成简洁竖线条。
    for (let floor = 0; floor < 5; floor += 1) {
      const y = 2.4 + floor * 3.9
      addBox('zhiyuan-frame', 16.6, 2.1, 0.18, x, y, 8.06, 'frame', 0.05)
      addBox('zhiyuan-window-glass', 16.2, 1.8, 0.08, x, y, 8.16, 'glass')
    }
  }
  addBox('zhiyuan-upper', 36, 17.1, 16, 0, 12.45, 0, 'wall', 0.1)
  addBox('zhiyuan-coping', 36.4, 0.35, 16.4, 0, 21.0, 0, 'coping', 0.06)
  addBox('zhiyuan-plinth', 36.3, 0.5, 16.3, 0, 0.25, 0, 'plinth', 0.04)

  // 上层：通长玻璃带 + 每层出挑遮阳鳍片（风格化的核心阴影节奏）。
  for (let floor = 0; floor < 4; floor += 1) {
    const y = 5.9 + floor * 3.9
    for (const z of [-8.06, 8.06]) {
      addBox('zhiyuan-frame', 34.4, 2.0, 0.16, 0, y, z, 'frame', 0.04)
      addBox('zhiyuan-window-glass', 34, 1.8, 0.07, 0, y, z + Math.sign(z) * 0.08, 'glass')
      addBox('zhiyuan-fin', 36.2, 0.16, 0.85, 0, y + 1.35, z + Math.sign(z) * 0.35, 'trim', 0.03)
    }
  }

  buildOpenGroundFloor(THREE, addBox)

  for (const x of [-18, -15, -12, -9, -6, -3, 3, 6, 9, 12, 15, 18]) {
    addBox('zhiyuan-colonnade', 0.35, 21, 0.45, x, 10.5, 8.35, 'trim', 0.06)
  }
  // 入口：两级台阶 + 双圆柱 + 大挑檐。
  addBox('zhiyuan-step', 10, 0.15, 3.2, 0, 0.075, 9.6, 'plinth', 0.03)
  addBox('zhiyuan-step', 9.4, 0.15, 2.6, 0, 0.225, 9.3, 'plinth', 0.03)
  for (const x of [-4, 4]) {
    const column = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.16, 3.4, 12), materials.trim)
    column.name = 'zhiyuan-colonnade'
    column.position.set(x, 1.7, 9.4)
    column.castShadow = true
    group.add(column)
  }
  addBox('zhiyuan-canopy', 9.6, 0.22, 3.4, 0, 3.5, 9.0, 'trim', 0.08)
  addBox('zhiyuan-window-glass', 8.8, 0.06, 2.8, 0, 3.66, 9.0, 'glass')

  scaleToDimensions(THREE, group, dimensions)
  group.userData.sceneAsset = { category: 'campus', objectType: 'zhiyuan-stylized', visualStyle: 'stylized-plus' }
  return group
}

/** 写实细节：贴图 + 逐窗构件 + 入口双开门 + 落水管与窗台。 */
export function createZhiyuanRealistic(THREE, dimensions, options = {}) {
  const doc = options.document ?? globalThis.document
  const group = new THREE.Group()
  group.name = 'campus-zhiyuan-realistic'
  const brickMap = makeBrickTexture(THREE, doc)
  const panelMap = makePanelTexture(THREE, doc)
  const materials = {
    brick: new THREE.MeshStandardMaterial({ color: brickMap ? '#ffffff' : '#9b5545', map: brickMap || null, roughness: 0.92 }),
    wall: new THREE.MeshStandardMaterial({ color: panelMap ? '#ffffff' : '#ded8ca', map: panelMap || null, roughness: 0.9 }),
    trim: new THREE.MeshStandardMaterial({ color: '#ece9df', roughness: 0.85 }),
    frame: new THREE.MeshStandardMaterial({ color: '#3c444a', roughness: 0.4, metalness: 0.55 }),
    glass: new THREE.MeshStandardMaterial({ color: '#8fb0bd', roughness: 0.12, metalness: 0.25 }),
    sill: new THREE.MeshStandardMaterial({ color: '#c9c2b2', roughness: 0.85 }),
    floor: new THREE.MeshStandardMaterial({ color: '#aaa99f', roughness: 0.8 }),
    door: new THREE.MeshStandardMaterial({ color: '#5a4636', roughness: 0.6 }),
  }
  const addBox = makeBuilder(THREE, group, materials, false)

  for (const x of [-29, 29]) {
    addBox('zhiyuan-wing', 22, 21, 16, x, 10.5, 0, 'brick')
    addBox('zhiyuan-coping', 22.25, 0.3, 16.25, x, 21.0, 0, 'sill')
    // 砖翼白框窗：每翼 5 层 × 4 窗，含窗台与窗楣。
    for (let floor = 0; floor < 5; floor += 1) {
      for (let col = 0; col < 4; col += 1) {
        const wx = x - 7.5 + col * 5
        const wy = 2.2 + floor * 3.9
        addBox('zhiyuan-frame', 2.6, 2.0, 0.16, wx, wy, 8.04, 'trim')
        addBox('zhiyuan-window-glass', 2.2, 1.7, 0.06, wx, wy, 8.13, 'glass')
        addBox('zhiyuan-mullion', 0.07, 1.7, 0.08, wx, wy, 8.16, 'frame')
        addBox('zhiyuan-sill', 2.9, 0.12, 0.4, wx, wy - 1.05, 8.12, 'sill')
        addBox('zhiyuan-frame', 2.9, 0.14, 0.2, wx, wy + 1.05, 8.06, 'trim')
      }
    }
    // 转角落水管。
    const pipe = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 20.4, 8), materials.frame)
    pipe.name = 'zhiyuan-pipe'
    pipe.position.set(x + Math.sign(x) * 10.6, 10.2, 8.15)
    group.add(pipe)
  }
  addBox('zhiyuan-upper', 36, 17.1, 16, 0, 12.45, 0, 'wall')
  addBox('zhiyuan-coping', 36.3, 0.3, 16.3, 0, 21.0, 0, 'sill')

  // 上层：逐窗网格（替代通长横带），每层楼 12 窗，带竖梃/窗台/层间石材线脚。
  for (let floor = 0; floor < 4; floor += 1) {
    const wy = 5.9 + floor * 3.9
    for (const z of [-8.04, 8.04]) {
      const sign = Math.sign(z)
      for (let col = 0; col < 12; col += 1) {
        const wx = -16.5 + col * 3
        addBox('zhiyuan-frame', 2.3, 1.95, 0.14, wx, wy, z, 'frame')
        addBox('zhiyuan-window-glass', 2.0, 1.7, 0.05, wx, wy, z + sign * 0.08, 'glass')
        addBox('zhiyuan-mullion', 0.06, 1.7, 0.07, wx, wy, z + sign * 0.11, 'frame')
        addBox('zhiyuan-sill', 2.5, 0.1, 0.3, wx, wy - 1.0, z + sign * 0.08, 'sill')
      }
      addBox('zhiyuan-band', 36.15, 0.16, 0.18, 0, wy + 1.6, z, 'sill')
    }
  }

  buildOpenGroundFloor(THREE, addBox)

  for (const x of [-18, -15, -12, -9, -6, -3, 3, 6, 9, 12, 15, 18]) {
    addBox('zhiyuan-colonnade', 0.35, 21, 0.45, x, 10.5, 8.35, 'trim')
  }
  // 入口：台阶、玻璃双开门、门框、钢构雨棚。
  addBox('zhiyuan-step', 8.6, 0.15, 2.8, 0, 0.075, 9.4, 'sill')
  addBox('zhiyuan-step', 8.0, 0.15, 2.2, 0, 0.225, 9.1, 'sill')
  for (const x of [-0.8, 0.8]) {
    addBox('zhiyuan-door', 1.5, 2.6, 0.08, x, 1.3, 8.05, 'door')
    addBox('zhiyuan-window-glass', 1.2, 1.9, 0.04, x, 1.55, 8.1, 'glass')
  }
  addBox('zhiyuan-frame', 3.4, 0.16, 0.2, 0, 2.72, 8.05, 'frame')
  for (const x of [-4, 4]) {
    addBox('zhiyuan-colonnade', 0.22, 3.4, 0.22, x, 1.7, 9.4, 'frame')
    addBox('zhiyuan-frame', 0.12, 0.12, 1.8, x, 3.15, 8.6, 'frame')
  }
  addBox('zhiyuan-canopy', 8.8, 0.16, 2.6, 0, 3.45, 8.9, 'frame')
  addBox('zhiyuan-window-glass', 8.4, 0.05, 2.3, 0, 3.56, 8.9, 'glass')

  scaleToDimensions(THREE, group, dimensions)
  group.userData.sceneAsset = { category: 'campus', objectType: 'zhiyuan-realistic', visualStyle: 'realistic-detail' }
  return group
}
