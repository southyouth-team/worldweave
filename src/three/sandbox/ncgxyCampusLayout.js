/**
 * 南昌工学院示例校园布局：只用内置素材拼出一个可辨认的校区。
 *
 * 坐标约定与引擎一致：+x 向东、+z 向南、北为 -z；单位米。
 * 目标世界约 270×210（东/西各扩 2 列、南/北各扩 2 行），
 * 布局元素均落在 x∈[-125,125]、z∈[-100,100] 的安全范围内。
 *
 * 结构：
 * - 南侧正中：南工东大门（拱门沿 z 轴通行）
 * - 中轴：沥青主入口大道从大门向北延伸到广场
 * - 西侧：致远楼（教学楼，正面朝南）+ 楼前石径
 * - 东侧：天工体育场（400m 操场），旁设篮球架
 * - 东西向水泥主路连接教学楼与操场
 * - 沿路乔木、路灯、长椅、花坛、指示牌、垃圾桶
 */
export const CAMPUS_WORLD_MIN_SIZE = Object.freeze({ width: 250, depth: 190 })

const HALF_PI = Math.PI / 2

export const NCGXY_CAMPUS_LAYOUT = Object.freeze([
  // ---- 地标 ----
  { category: 'campus', objectType: 'east-gate', name: '南工东大门', x: 0, z: 92, ry: 0 },
  { category: 'campus', objectType: 'zhiyuan-building', name: '致远楼（教学楼）', x: -80, z: 62, ry: 0 },
  { category: 'campus', objectType: 'sports-field', name: '天工体育场（操场）', x: 40, z: -32, ry: 0 },

  // ---- 道路 ----
  // 中轴沥青大道（沿 z 轴，分段铺设）
  { category: 'road', objectType: 'asphalt-road', name: '主入口大道', x: 0, z: 68, ry: HALF_PI, parameters: { length: 48 } },
  { category: 'road', objectType: 'asphalt-road', name: '主入口大道', x: 0, z: 20, ry: HALF_PI, parameters: { length: 48 } },
  // 东西向水泥主路
  { category: 'road', objectType: 'concrete-road', name: '东西主路', x: -52, z: 42, ry: 0, parameters: { length: 100 } },
  { category: 'road', objectType: 'concrete-road', name: '东西主路', x: 52, z: 42, ry: 0, parameters: { length: 100 } },
  // 校前广场与楼前石径
  { category: 'road', objectType: 'brick-walkway', name: '校前广场步道', x: 0, z: 84, ry: 0, parameters: { length: 16 } },
  { category: 'road', objectType: 'stone-path', name: '致远楼前石径', x: -80, z: 48, ry: HALF_PI, parameters: { length: 18 } },

  // ---- 沿中轴绿化与设施 ----
  { category: 'vegetation', objectType: 'tree', name: '行道树', x: -12, z: 74, ry: 0 },
  { category: 'vegetation', objectType: 'tree', name: '行道树', x: 12, z: 74, ry: 0 },
  { category: 'vegetation', objectType: 'tree', name: '行道树', x: -12, z: 56, ry: 0 },
  { category: 'vegetation', objectType: 'tree', name: '行道树', x: 12, z: 56, ry: 0 },
  { category: 'vegetation', objectType: 'tree', name: '行道树', x: -12, z: 38, ry: 0 },
  { category: 'vegetation', objectType: 'tree', name: '行道树', x: 12, z: 38, ry: 0 },
  { category: 'facility', objectType: 'lamp', name: '主道路灯', x: -7, z: 78, ry: 0 },
  { category: 'facility', objectType: 'lamp', name: '主道路灯', x: 7, z: 78, ry: 0 },
  { category: 'facility', objectType: 'lamp', name: '主道路灯', x: -7, z: 50, ry: 0 },
  { category: 'facility', objectType: 'lamp', name: '主道路灯', x: 7, z: 50, ry: 0 },
  { category: 'facility', objectType: 'lamp', name: '主道路灯', x: -7, z: 24, ry: 0 },
  { category: 'facility', objectType: 'lamp', name: '主道路灯', x: 7, z: 24, ry: 0 },
  { category: 'facility', objectType: 'bench', name: '广场长椅', x: -10, z: 50, ry: 0 },
  { category: 'facility', objectType: 'bench', name: '广场长椅', x: 10, z: 50, ry: Math.PI },
  { category: 'facility', objectType: 'sign', name: '校园指示牌', x: 14, z: 80, ry: 0 },
  { category: 'facility', objectType: 'bin', name: '垃圾桶', x: 9, z: 72, ry: 0 },
  { category: 'decoration', objectType: 'flowerbed', name: '门前花坛', x: -22, z: 86, ry: 0 },
  { category: 'decoration', objectType: 'flowerbed', name: '门前花坛', x: 22, z: 86, ry: 0 },
  { category: 'vegetation', objectType: 'shrub', name: '灌木', x: -18, z: 46, ry: 0 },
  { category: 'vegetation', objectType: 'shrub', name: '灌木', x: 18, z: 46, ry: 0 },
  { category: 'vegetation', objectType: 'flower', name: '花丛', x: -24, z: 78, ry: 0 },
  { category: 'vegetation', objectType: 'flower', name: '花丛', x: 24, z: 78, ry: 0 },

  // ---- 教学楼周边 ----
  { category: 'vegetation', objectType: 'tree', name: '楼前乔木', x: -108, z: 46, ry: 0 },
  { category: 'vegetation', objectType: 'tree', name: '楼前乔木', x: -52, z: 46, ry: 0 },
  { category: 'decoration', objectType: 'rock', name: '景观石', x: -108, z: 78, ry: 0 },
  { category: 'structure', objectType: 'pavilion', name: '凉亭', x: -112, z: -68, ry: 0 },
  { category: 'structure', objectType: 'pergola', name: '廊架', x: -40, z: -66, ry: 0 },

  // ---- 操场周边 ----
  { category: 'sports', objectType: 'basketball-hoop', name: '篮球架', x: 118, z: 32, ry: -HALF_PI },
  { category: 'sports', objectType: 'basketball-hoop', name: '篮球架', x: 118, z: 20, ry: -HALF_PI },
  { category: 'vegetation', objectType: 'tree', name: '操场边乔木', x: 122, z: -20, ry: 0 },
  { category: 'vegetation', objectType: 'tree', name: '操场边乔木', x: 122, z: 0, ry: 0 },
  { category: 'facility', objectType: 'bench', name: '操场长椅', x: 8, z: 12, ry: HALF_PI },
])

// 世界需要扩到的最小尺寸；已有更大世界时不缩不回。
// 返回四个方向各需扩多少块（expandWorld 以东/西加列、南/北加行的方式扩展）。
export function planCampusWorldExpansion(currentBounds) {
  const width = Math.max(0, Number(currentBounds?.maxX) - Number(currentBounds?.minX))
  const depth = Math.max(0, Number(currentBounds?.maxZ) - Number(currentBounds?.minZ))
  const chunkWidth = 54
  const chunkDepth = 42
  const extraColumns = Math.max(0, Math.ceil((CAMPUS_WORLD_MIN_SIZE.width - width) / chunkWidth))
  const extraRows = Math.max(0, Math.ceil((CAMPUS_WORLD_MIN_SIZE.depth - depth) / chunkDepth))
  return {
    east: Math.ceil(extraColumns / 2),
    west: Math.floor(extraColumns / 2),
    north: Math.ceil(extraRows / 2),
    south: Math.floor(extraRows / 2),
    width,
    depth,
  }
}
