/**
 * 选址吸附：把鼠标落点吸附到「能放下模型的区域」内，并方便贴边摆放。
 *
 * 规则（单轴）：
 * 1. 先夹取到可放置区间 [limitMin, limitMax]（保证模型完整落在世界内）。
 * 2. 靠近区间边界 PLACEMENT_EDGE_SNAP 以内时直接贴边（道路/围栏贴地块边缘）。
 * 3. 其余情况按 PLACEMENT_GRID_STEP 网格取整（方便道路首尾对齐）。
 */
export const PLACEMENT_GRID_STEP = 0.5
export const PLACEMENT_EDGE_SNAP = 1.1

export function snapPlacementAxis(rawValue, limitMin, limitMax, options = {}) {
  const grid = Number(options.grid) > 0 ? Number(options.grid) : PLACEMENT_GRID_STEP
  const edgeSnap = Number(options.edgeSnap) >= 0 ? Number(options.edgeSnap) : PLACEMENT_EDGE_SNAP
  const min = Math.min(limitMin, limitMax)
  const max = Math.max(limitMin, limitMax)
  if (!Number.isFinite(rawValue)) return min
  const clamped = Math.min(Math.max(rawValue, min), max)
  const range = max - min
  // 可放置区间太窄时直接居中，避免两侧吸附互相打架。
  if (range <= edgeSnap * 2) return (min + max) / 2
  if (Math.abs(clamped - min) <= edgeSnap) return min
  if (Math.abs(clamped - max) <= edgeSnap) return max
  return Math.min(Math.max(Math.round(clamped / grid) * grid, min), max)
}

// 同时吸附 x/z 两轴；limits 均以「模型中心可移动范围」表达。
export function snapPlacementCenter({ x, z, limitMinX, limitMaxX, limitMinZ, limitMaxZ }, options = {}) {
  return {
    x: snapPlacementAxis(Number(x), limitMinX, limitMaxX, options),
    z: snapPlacementAxis(Number(z), limitMinZ, limitMaxZ, options),
  }
}
