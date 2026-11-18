/**
 * 南昌工学院校园地标生成器（独立模块，只读注册表之外的 campus 类别数据源）。
 *
 * 每个生成器是纯函数：返回命名完整的 THREE.Group，供内置素材适配层统一标注
 * componentId / collisionPolicy / 碰撞声明。尺寸为米制估算值（spec §4），
 * 以 1.7m 玩家为基准；布局常数按设计尺寸 36×13×8（东大门）等比例参数化。
 *
 * 实景依据：招生网「美丽校园」官方照片（URL 见设计文档 §9），低多边形 stylized。
 */

const GATE_DESIGN = Object.freeze({ width: 36, height: 13, depth: 8 })

function std(color, extra = {}) {
  return { color, roughness: 0.85, metalness: 0.05, ...extra }
}

/**
 * 四坡屋顶（庑殿近似）：4 段圆柱台旋转 45° 成轴对齐方台，顶部小平台作正脊。
 * 返回的 Mesh 已按目标宽/深缩放并摆位，name 由调用方赋。
 */
function makeHipRoof(THREE, material, { width, depth, height, bottomY, x = 0, z = 0 }) {
  const radiusBottom = width / Math.SQRT2
  const radiusTop = radiusBottom * 0.3
  const geometry = new THREE.CylinderGeometry(radiusTop, radiusBottom, height, 4, 1)
  // 四段圆柱的原始截面是菱形：先旋转成轴对齐方形，再烘焙深度比例。
  // 若先缩放再旋转，非等比缩放会把方形变成斜菱形并放大世界 X 包围盒。
  geometry.rotateY(Math.PI / 4)
  geometry.scale(1, 1, depth / width)
  const mesh = new THREE.Mesh(geometry, material)
  mesh.position.set(x, bottomY + height / 2, z)
  return mesh
}

/**
 * 匾额贴图：浏览器端用 CanvasTexture 写金色「南昌工学院」；
 * Node/Worker 等无 2D canvas 环境显式降级为无字黑匾（返回 null），不抛错。
 */
function makePlaqueTexture(THREE, doc) {
  const canvas = doc?.createElement?.('canvas')
  const ctx = canvas?.getContext?.('2d')
  if (!canvas || !ctx) return null
  canvas.width = 1024
  canvas.height = 288
  ctx.fillStyle = '#141414'
  ctx.fillRect(0, 0, canvas.width, canvas.height)
  ctx.fillStyle = '#d8b84a'
  ctx.font = 'bold 190px "SimSun", "Songti SC", serif'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillText('南昌工学院', canvas.width / 2, canvas.height / 2)
  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  return texture
}

/**
 * 南工东大门：灰白四墩 + 棕红三重檐（中央高两翼低）+ 黑底金字匾额。
 * 中央拱门净宽 8m、净高 6m，两侧小门洞净宽 3m；门洞无任何碰撞体。
 * options.document 仅供测试注入假 2D 上下文；缺省取 globalThis.document。
 */
export function createEastGate(THREE, dimensions, options = {}) {
  const { width = 36, height = 13, depth = 8 } = dimensions || {}
  const group = new THREE.Group()
  group.name = 'campus-east-gate'

  const pierMaterial = new THREE.MeshStandardMaterial(std('#e8e4dc'))
  const roofMaterial = new THREE.MeshStandardMaterial(std('#7a4a38'))
  const lintelMaterial = new THREE.MeshStandardMaterial(std('#ddd6ca'))

  // 主墩（中央拱门两侧）与侧墩（外侧），顶部分别衔接中央/两翼屋顶
  const pierSpecs = [
    { x: -4.8, height: 7.6 }, { x: 4.8, height: 7.6 },
    { x: -9.4, height: 5.8 }, { x: 9.4, height: 5.8 },
  ]
  for (const spec of pierSpecs) {
    const pier = new THREE.Mesh(new THREE.BoxGeometry(1.6, spec.height, 3), pierMaterial)
    pier.name = 'gate-pier'
    pier.position.set(spec.x, spec.height / 2, 0)
    group.add(pier)
  }

  // 中央门楣（梁底 y=6 → 拱门净高 6m）与两侧小门楣（梁底 y=4）
  const lintel = new THREE.Mesh(new THREE.BoxGeometry(9.6, 1.6, 2.6), lintelMaterial)
  lintel.name = 'gate-lintel'
  lintel.position.set(0, 6.8, 0)
  group.add(lintel)
  for (const x of [-7.1, 7.1]) {
    const side = new THREE.Mesh(new THREE.BoxGeometry(4.2, 1.2, 2.4), lintelMaterial)
    side.name = 'gate-lintel-side'
    side.position.set(x, 4.6, 0)
    group.add(side)
  }

  // 三重檐：中央屋顶 14×8 底、两翼各 11×7 底，翼檐外伸至 ±18 形成 36m 总宽
  const centerRoof = makeHipRoof(THREE, roofMaterial, { width: 14, depth: 8, height: 4.6, bottomY: 7.6 })
  centerRoof.name = 'gate-roof-center'
  group.add(centerRoof)
  const ridge = new THREE.Mesh(new THREE.BoxGeometry(6, 0.8, 1.2), roofMaterial)
  ridge.name = 'gate-roof-center-ridge'
  ridge.position.set(0, 12.6, 0)
  group.add(ridge)
  for (const x of [-12.5, 12.5]) {
    const wing = makeHipRoof(THREE, roofMaterial, { width: 11, depth: 7, height: 3, bottomY: 5.8, x })
    wing.name = 'gate-roof-wing'
    group.add(wing)
    const wingRidge = new THREE.Mesh(new THREE.BoxGeometry(4, 0.5, 1), roofMaterial)
    wingRidge.name = 'gate-roof-wing-ridge'
    wingRidge.position.set(x, 9.05, 0)
    group.add(wingRidge)
  }

  // 黑底金字匾额（无 canvas 环境降级为纯黑匾），贴在中央门楣正面
  const plaqueTexture = makePlaqueTexture(THREE, options.document ?? globalThis.document)
  const plaqueMaterial = new THREE.MeshBasicMaterial({
    color: plaqueTexture ? '#ffffff' : '#141414',
    map: plaqueTexture || null,
    side: THREE.DoubleSide,
  })
  const plaque = new THREE.Mesh(new THREE.PlaneGeometry(5.4, 1.5), plaqueMaterial)
  plaque.name = 'gate-plaque'
  plaque.position.set(0, 6.8, 1.34)
  group.add(plaque)

  // 非设计尺寸输入：把比例直接烘焙进几何与摆位（不用 root.scale，保证碰撞声明正确）
  const kx = width / GATE_DESIGN.width
  const ky = height / GATE_DESIGN.height
  const kz = depth / GATE_DESIGN.depth
  if (kx !== 1 || ky !== 1 || kz !== 1) {
    group.traverse(object => {
      if (!object.isMesh) return
      object.geometry.scale(kx, ky, kz)
      object.position.set(object.position.x * kx, object.position.y * ky, object.position.z * kz)
    })
  }

  group.userData.sceneAsset = { category: 'campus', objectType: 'east-gate', visualStyle: 'stylized' }
  return group
}

const SPORTS_DESIGN = Object.freeze({ width: 186, height: 12, depth: 100 })

// stadium 轮廓：两条直道接左右半圆；外圈逆时针、内孔顺时针供 Shape 挖洞。
function traceStadium(path, straightHalf, radius, clockwise = false) {
  if (!clockwise) {
    path.moveTo(-straightHalf, -radius)
    path.lineTo(straightHalf, -radius)
    path.absarc(straightHalf, 0, radius, -Math.PI / 2, Math.PI / 2, false)
    path.lineTo(-straightHalf, radius)
    path.absarc(-straightHalf, 0, radius, Math.PI / 2, Math.PI * 1.5, false)
  } else {
    path.moveTo(-straightHalf, -radius)
    path.absarc(-straightHalf, 0, radius, -Math.PI / 2, -Math.PI * 1.5, true)
    path.lineTo(straightHalf, radius)
    path.absarc(straightHalf, 0, radius, Math.PI / 2, -Math.PI / 2, true)
  }
  path.closePath()
  return path
}

function makeStadiumRing(THREE, material, {
  straightHalf, innerRadius, outerRadius, thickness = 0, name,
}) {
  const shape = traceStadium(new THREE.Shape(), straightHalf, outerRadius)
  const hole = traceStadium(new THREE.Path(), straightHalf, innerRadius, true)
  shape.holes.push(hole)
  const geometry = thickness > 0
    ? new THREE.ExtrudeGeometry(shape, { depth: thickness, bevelEnabled: false, curveSegments: 32 })
    : new THREE.ShapeGeometry(shape, 32)
  // Shape 的 XY 对应世界 XZ，挤出深度对应世界 Y。
  geometry.rotateX(-Math.PI / 2)
  const mesh = new THREE.Mesh(geometry, material)
  mesh.name = name
  return mesh
}

/**
 * 天工体育场：176×92m 八道 400m 跑道、105×68m 球场、带顶棚看台与 12m 旗杆。
 * 所有尺寸均为米制估算；跑道和标线是无碰撞贴地薄片，看台为实心阻挡体。
 */
export function createSportsField(THREE, dimensions) {
  const { width = 186, height = 12, depth = 100 } = dimensions || {}
  const group = new THREE.Group()
  group.name = 'campus-sports-field'

  const trackMaterial = new THREE.MeshStandardMaterial(std('#a74f42'))
  const lineMaterial = new THREE.MeshStandardMaterial(std('#f4f1e8', { side: THREE.DoubleSide }))
  const grassMaterial = new THREE.MeshStandardMaterial(std('#3f7f4b'))
  const standMaterial = new THREE.MeshStandardMaterial(std('#b9b7ae'))
  const roofMaterial = new THREE.MeshStandardMaterial(std('#58717b', { side: THREE.DoubleSide }))
  const metalMaterial = new THREE.MeshStandardMaterial(std('#e5e7e5', { metalness: 0.35, roughness: 0.55 }))
  const flagMaterial = new THREE.MeshStandardMaterial(std('#c93832', { side: THREE.DoubleSide }))

  const straightHalf = 42
  const outerRadius = 46
  const laneWidth = 1.15
  const innerRadius = outerRadius - laneWidth * 8
  const track = makeStadiumRing(THREE, trackMaterial, {
    straightHalf, innerRadius, outerRadius, thickness: 0.05, name: 'sports-track',
  })
  group.add(track)

  // 八条跑道有九条边界；窄环带略高于塑胶，避免深度冲突。
  for (let lane = 0; lane <= 8; lane += 1) {
    const radius = innerRadius + lane * laneWidth
    const line = makeStadiumRing(THREE, lineMaterial, {
      straightHalf,
      innerRadius: radius - 0.03,
      outerRadius: radius + 0.03,
      name: 'sports-lane-line',
    })
    line.position.y = 0.056
    group.add(line)
  }

  const pitch = new THREE.Mesh(new THREE.BoxGeometry(105, 0.04, 68), grassMaterial)
  pitch.name = 'sports-pitch'
  pitch.position.y = 0.07
  group.add(pitch)

  const addPitchLine = (lineWidth, lineDepth, x, z) => {
    const line = new THREE.Mesh(new THREE.BoxGeometry(lineWidth, 0.006, lineDepth), lineMaterial)
    line.name = 'sports-pitch-line'
    line.position.set(x, 0.094, z)
    group.add(line)
  }
  addPitchLine(105, 0.12, 0, -34)
  addPitchLine(105, 0.12, 0, 34)
  addPitchLine(0.12, 68, -52.5, 0)
  addPitchLine(0.12, 68, 52.5, 0)
  addPitchLine(0.12, 68, 0, 0)
  const centerCircle = new THREE.Mesh(new THREE.RingGeometry(9.08, 9.2, 64), lineMaterial)
  centerCircle.name = 'sports-pitch-line'
  centerCircle.rotation.x = -Math.PI / 2
  centerCircle.position.y = 0.098
  group.add(centerCircle)

  // 两个真实规格球门：7.32m 宽、2.44m 高，门框参与碰撞。
  for (const x of [-52.5, 52.5]) {
    for (const z of [-3.66, 3.66]) {
      const upright = new THREE.Mesh(new THREE.BoxGeometry(0.12, 2.44, 0.12), metalMaterial)
      upright.name = 'sports-goalpost'
      upright.position.set(x, 1.31, z)
      group.add(upright)
    }
    const crossbar = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.12, 7.44), metalMaterial)
    crossbar.name = 'sports-goalpost'
    crossbar.position.set(x, 2.53, 0)
    group.add(crossbar)
  }

  // 看台每排均为从地面起的实心体，避免角色沿低台阶登临；八排总宽 84m。
  for (let row = 0; row < 8; row += 1) {
    const rowHeight = 0.55 + row * 0.45
    const step = new THREE.Mesh(new THREE.BoxGeometry(84, rowHeight, 1.15), standMaterial)
    step.name = 'sports-stand-step'
    step.position.set(0, rowHeight / 2, -47.4 - row * 1.15)
    group.add(step)
  }
  for (const x of [-40, -20, 0, 20, 40]) {
    for (const z of [-47, -56]) {
      const support = new THREE.Mesh(new THREE.BoxGeometry(0.25, 8.5, 0.25), metalMaterial)
      support.name = 'sports-stand-step-support'
      support.position.set(x, 4.25, z)
      group.add(support)
    }
  }
  const standRoof = new THREE.Mesh(new THREE.BoxGeometry(88, 0.25, 12), roofMaterial)
  standRoof.name = 'sports-stand-roof'
  standRoof.position.set(0, 8.625, -51.5)
  group.add(standRoof)
  const platform = new THREE.Mesh(new THREE.BoxGeometry(12, 0.5, 1.5), standMaterial)
  platform.name = 'sports-stand-step-platform'
  platform.position.set(0, 3.95, -56.2)
  group.add(platform)

  const flagpole = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 12, 10), metalMaterial)
  flagpole.name = 'sports-flagpole'
  flagpole.position.set(0, 6, -58.5)
  group.add(flagpole)
  const flag = new THREE.Mesh(new THREE.BoxGeometry(2.6, 1.4, 0.04), flagMaterial)
  flag.name = 'sports-flag'
  flag.position.set(1.3, 11.2, -58.5)
  group.add(flag)

  // 非设计尺寸输入同样烘焙进几何，避免 root.scale 破坏碰撞声明。
  const kx = width / SPORTS_DESIGN.width
  const ky = height / SPORTS_DESIGN.height
  const kz = depth / SPORTS_DESIGN.depth
  if (kx !== 1 || ky !== 1 || kz !== 1) {
    group.traverse(object => {
      if (!object.isMesh) return
      object.geometry.scale(kx, ky, kz)
      object.position.set(object.position.x * kx, object.position.y * ky, object.position.z * kz)
    })
  }

  group.userData.sceneAsset = { category: 'campus', objectType: 'sports-field', visualStyle: 'stylized' }
  return group
}

const ZHIYUAN_DESIGN = Object.freeze({ width: 80, height: 21, depth: 16 })

// 单 Mesh 的倒置 U 形课桌：两侧支板 + 桌面，避免每张桌子产生多个碰撞部件。
function makeClassroomDeskGeometry(THREE) {
  const profile = new THREE.Shape()
  profile.moveTo(-0.25, 0)
  profile.lineTo(-0.19, 0)
  profile.lineTo(-0.19, 0.67)
  profile.lineTo(0.19, 0.67)
  profile.lineTo(0.19, 0)
  profile.lineTo(0.25, 0)
  profile.lineTo(0.25, 0.75)
  profile.lineTo(-0.25, 0.75)
  profile.closePath()
  const geometry = new THREE.ExtrudeGeometry(profile, { depth: 1.2, bevelEnabled: false })
  geometry.rotateY(Math.PI / 2)
  geometry.translate(-0.6, 0, 0)
  return geometry
}

/**
 * 致远楼：80×21×16m（估算）五层板楼。两翼与二至五层实心；
 * 中央一楼开放，含门洞、走廊、三间有家具的教室与六根灯管（光源由适配层接线）。
 */
export function createZhiyuanBuilding(THREE, dimensions) {
  const { width = 80, height = 21, depth = 16 } = dimensions || {}
  const group = new THREE.Group()
  group.name = 'campus-zhiyuan-building'

  const brickMaterial = new THREE.MeshStandardMaterial(std('#9b5545'))
  const wallMaterial = new THREE.MeshStandardMaterial(std('#ded8ca'))
  const whiteMaterial = new THREE.MeshStandardMaterial(std('#ece9df'))
  const darkMaterial = new THREE.MeshStandardMaterial(std('#3f4b50'))
  const floorMaterial = new THREE.MeshStandardMaterial(std('#aaa99f'))
  const woodMaterial = new THREE.MeshStandardMaterial(std('#9b7650'))
  const chairMaterial = new THREE.MeshStandardMaterial(std('#596b70'))
  const blackboardMaterial = new THREE.MeshStandardMaterial(std('#173c32'))
  const glassMaterial = new THREE.MeshStandardMaterial(std('#7fa6b2', {
    transparent: true, opacity: 0.42, roughness: 0.25, side: THREE.DoubleSide,
  }))
  const tubeMaterial = new THREE.MeshBasicMaterial({ color: '#f4f8ff' })

  const addBox = (name, boxWidth, boxHeight, boxDepth, x, y, z, material) => {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(boxWidth, boxHeight, boxDepth), material)
    mesh.name = name
    mesh.position.set(x, y, z)
    group.add(mesh)
    return mesh
  }

  // 红砖端翼（含一楼）与中央上层都是实心阻挡体，不提供楼梯或上层内部。
  for (const x of [-29, 29]) {
    addBox('zhiyuan-wing', 22, 21, 16, x, 10.5, 0, brickMaterial)
  }
  addBox('zhiyuan-upper', 36, 17.1, 16, 0, 12.45, 0, wallMaterial)
  addBox('zhiyuan-solid-ceiling', 36, 0.3, 16, 0, 3.75, 0, whiteMaterial)
  addBox('zhiyuan-floor', 36, 0.2, 16, 0, -0.1, 0, floorMaterial)

  // 带真实窗洞的外墙：0.9m 窗下墙、2m 玻璃窗、1m 上梁与竖向窗间柱。
  const addWindowWall = (xMin, xMax, z, bays) => {
    const bayWidth = (xMax - xMin) / bays
    for (let index = 0; index <= bays; index += 1) {
      addBox('zhiyuan-wall', 0.6, 3.9, 0.3, xMin + index * bayWidth, 1.95, z, whiteMaterial)
    }
    for (let index = 0; index < bays; index += 1) {
      const centerX = xMin + (index + 0.5) * bayWidth
      const clearWidth = bayWidth - 0.6
      addBox('zhiyuan-wall', clearWidth, 0.9, 0.3, centerX, 0.45, z, wallMaterial)
      addBox('zhiyuan-wall', clearWidth, 1, 0.3, centerX, 3.4, z, wallMaterial)
      addBox('zhiyuan-window-glass', clearWidth, 2, 0.04, centerX, 1.9, z, glassMaterial)
    }
  }
  addWindowWall(-18, -1.5, 8, 4)
  addWindowWall(1.5, 18, 8, 4)
  addWindowWall(-18, 18, -8, 8)
  // 主入口 3m 宽、2.6m 高，门洞内无 Mesh 与碰撞体。
  addBox('zhiyuan-wall', 3, 1.3, 0.3, 0, 3.25, 8, whiteMaterial)

  // 白色柱廊在入口两侧；中央 6m 范围不放落地柱，保持主路线畅通。
  for (const x of [-18, -15, -12, -9, -6, -3, 3, 6, 9, 12, 15, 18]) {
    addBox('zhiyuan-colonnade', 0.35, 21, 0.45, x, 10.5, 8.35, whiteMaterial)
  }
  for (const x of [-4, 4]) {
    addBox('zhiyuan-colonnade', 0.25, 3.3, 0.25, x, 1.65, 9.4, whiteMaterial)
  }
  addBox('zhiyuan-glass-canopy', 8, 0.18, 2, 0, 3.4, 8.8, glassMaterial)

  // 上层深色横窗带与端翼窗面仅作外观，窗玻璃不参与碰撞。
  for (let floor = 0; floor < 4; floor += 1) {
    const y = 5.9 + floor * 3.9
    for (const z of [-8.02, 8.02]) {
      addBox('zhiyuan-window-glass', 34, 1.8, 0.04, 0, y, z, glassMaterial)
    }
  }
  for (const x of [-29, 29]) {
    for (let floor = 0; floor < 5; floor += 1) {
      addBox('zhiyuan-window-glass', 17, 1.7, 0.04, x, 2 + floor * 3.9, 8.03, darkMaterial)
    }
  }

  const classroomCenters = [-13.5, -4.5, 4.5]
  for (const x of [-9, 0, 9]) {
    addBox('zhiyuan-partition', 0.2, 3.6, 7, x, 1.8, -2.5, wallMaterial)
  }
  // 教室门前是 z=1…3.4 的走廊；前侧仅中央 3m 通道连接主入口。
  addBox('zhiyuan-corridor-wall', 16.5, 3.6, 0.2, -9.75, 1.8, 3.4, wallMaterial)
  addBox('zhiyuan-corridor-wall', 16.5, 3.6, 0.2, 9.75, 1.8, 3.4, wallMaterial)
  // 第四开间为一楼未开放设备区，避免形成没有门与用途的空房间。
  addBox('zhiyuan-solid-utility', 9, 3.6, 7, 13.5, 1.8, -2.5, darkMaterial)

  const deskGeometry = makeClassroomDeskGeometry(THREE)
  for (const centerX of classroomCenters) {
    // 教室净尺寸 9×7m（z=-6…1），后墙兼教学墙；朝走廊墙面留 1.2m 门洞。
    addBox('zhiyuan-partition', 9, 3.6, 0.2, centerX, 1.8, -6, wallMaterial)
    addBox('zhiyuan-partition', 3.9, 3.6, 0.2, centerX - 2.7, 1.8, 1, wallMaterial)
    addBox('zhiyuan-partition', 3.9, 3.6, 0.2, centerX + 2.7, 1.8, 1, wallMaterial)
    addBox('zhiyuan-partition', 1.2, 1.2, 0.2, centerX, 3, 1, wallMaterial)

    addBox('zhiyuan-blackboard', 4, 1.2, 0.05, centerX, 1.8, -5.87, blackboardMaterial)
    addBox('zhiyuan-podium', 1.6, 0.9, 0.8, centerX - 2.8, 0.45, -4.9, woodMaterial)

    // 四列课桌形成 1.5m 中央过道，容半径 0.55m 的玩家通过。
    for (const offsetX of [-3.2, -1.35, 1.35, 3.2]) {
      for (const rowZ of [-3.6, -1.9, -0.2]) {
        const desk = new THREE.Mesh(deskGeometry.clone(), woodMaterial)
        desk.name = 'zhiyuan-desk'
        desk.position.set(centerX + offsetX, 0, rowZ)
        group.add(desk)
        addBox('zhiyuan-chair', 0.45, 0.45, 0.45, centerX + offsetX, 0.225, rowZ + 0.65, chairMaterial)
      }
    }
    for (const lampZ of [-3.6, -0.2]) {
      addBox('zhiyuan-lamptube', 1.2, 0.06, 0.12, centerX, 3.2, lampZ, tubeMaterial)
    }
    // 真实光源不在生成器中打 componentId，由适配层统一编号并接环境总开关。
    const light = new THREE.PointLight('#f4f8ff', 1.6, 9, 1.8)
    light.name = 'zhiyuan-light'
    light.position.set(centerX, 3.1, -2.5)
    light.castShadow = false
    group.add(light)
  }

  // 路由锚点为空 Group，适配层只标 Mesh；固定 id 与 none 策略由生成器直接赋予。
  for (const name of ['zhiyuan-route-main', 'zhiyuan-route-classroom']) {
    const anchor = new THREE.Group()
    anchor.name = name
    anchor.userData.componentId = `campus-zhiyuan-building-${name}`
    anchor.userData.collisionPolicy = 'none'
    group.add(anchor)
  }

  const kx = width / ZHIYUAN_DESIGN.width
  const ky = height / ZHIYUAN_DESIGN.height
  const kz = depth / ZHIYUAN_DESIGN.depth
  if (kx !== 1 || ky !== 1 || kz !== 1) {
    group.traverse(object => {
      if (object.isMesh) {
        object.geometry.scale(kx, ky, kz)
        object.position.set(object.position.x * kx, object.position.y * ky, object.position.z * kz)
      } else if (object.name.startsWith('zhiyuan-route-')) {
        object.scale.set(kx, ky, kz)
      } else if (object.isLight) {
        object.position.set(object.position.x * kx, object.position.y * ky, object.position.z * kz)
      }
    })
  }

  group.userData.sceneAsset = { category: 'campus', objectType: 'zhiyuan-building', visualStyle: 'stylized' }
  return group
}
