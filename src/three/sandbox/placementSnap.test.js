import { describe, expect, it } from 'vitest'
import { PLACEMENT_EDGE_SNAP, PLACEMENT_GRID_STEP, snapPlacementAxis, snapPlacementCenter } from './placementSnap.js'

describe('选址吸附', () => {
  it('靠近可放置区边界时贴边，保证紧贴地块边缘', () => {
    // 区间 [-27, 27]，靠近下边界 0.8m → 直接贴到 -27
    expect(snapPlacementAxis(-26.2, -27, 27)).toBe(-27)
    // 靠近上边界 → 贴到 27
    expect(snapPlacementAxis(26.4, -27, 27)).toBe(27)
    // 边界外 → 夹取到边界
    expect(snapPlacementAxis(-40, -27, 27)).toBe(-27)
    expect(snapPlacementAxis(99, -27, 27)).toBe(27)
  })

  it('中间区域按 0.5m 网格取整，方便道路首尾对齐', () => {
    expect(PLACEMENT_GRID_STEP).toBeCloseTo(0.5, 6)
    expect(snapPlacementAxis(3.24, -27, 27)).toBe(3)
    expect(snapPlacementAxis(3.26, -27, 27)).toBe(3.5)
    expect(snapPlacementAxis(-8.1, -27, 27)).toBe(-8)
  })

  it('可放置区间过窄时居中放置，避免两侧吸附来回跳', () => {
    expect(snapPlacementAxis(0.05, 0, 1)).toBe(0.5)
  })

  it('非法输入回落到区间下界', () => {
    expect(snapPlacementAxis(Number.NaN, -10, 10)).toBe(-10)
    expect(snapPlacementAxis(undefined, 2, 8)).toBe(2)
  })

  it('双轴吸附同时生效，且贴边阈值可配置', () => {
    const center = snapPlacementCenter({ x: 26.5, z: -26.0, limitMinX: -27, limitMaxX: 27, limitMinZ: -21, limitMaxZ: 21 })
    expect(center.x).toBe(27)
    expect(center.z).toBe(-21)
    // 缩小贴边阈值后，同样的点会走网格吸附
    const relaxed = snapPlacementCenter(
      { x: 26.5, z: 5.2, limitMinX: -27, limitMaxX: 27, limitMinZ: -21, limitMaxZ: 21 },
      { edgeSnap: PLACEMENT_EDGE_SNAP * 0.1 },
    )
    expect(relaxed.x).toBe(26.5)
    expect(relaxed.z).toBe(5)
  })
})
