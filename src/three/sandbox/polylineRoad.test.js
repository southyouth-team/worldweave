import * as THREE from 'three'
import { describe, expect, it } from 'vitest'
import { createPolylineRoadModel } from './proceduralRoadGenerator.js'
import {
  areRoadPointsValid,
  getRoadEdgeHandles,
  getRoadEdgeStations,
  getRoadFootprint,
  getRoadPoints,
  getRoadStations,
  insertRoadBreakpointAt,
  insertRoadBreakpoints,
  insertRoadMidpoint,
  isPolylineRoadModel,
  mergeRoadPointSequences,
  pointsTotalLength,
  removeRoadPoint,
  smoothRoadEdgeStations,
  snapRoadPointToExisting,
  translateRoadStation,
} from './roadEndpointMath.js'

describe('折线道路控制点工具', () => {
  const points = [{ x: 0, z: 0 }, { x: 10, z: 0 }, { x: 10, z: 10 }]

  it('总长度等于各段长度之和', () => {
    expect(pointsTotalLength(points)).toBeCloseTo(20, 6)
  })

  it('在最长的线段中点插入控制点，返回新数组不改原数组', () => {
    const next = insertRoadMidpoint([{ x: 0, z: 0 }, { x: 4, z: 0 }, { x: 4, z: 10 }])
    expect(next).toHaveLength(4)
    // 第二段更长（10 > 4），中点应插在 (4, 5)
    expect(next[2]).toEqual({ x: 4, z: 5 })
    expect(points).toHaveLength(3)
  })

  it('删除控制点保持至少两个，且校验相邻距离', () => {
    expect(removeRoadPoint(points)).toEqual(points.slice(0, 2))
    expect(removeRoadPoint(points, 1)).toEqual([{ x: 0, z: 0 }, { x: 10, z: 10 }])
    expect(() => removeRoadPoint([{ x: 0, z: 0 }, { x: 5, z: 0 }])).toThrow()
    expect(areRoadPointsValid(points)).toBe(true)
    expect(areRoadPointsValid([{ x: 0, z: 0 }, { x: 0.2, z: 0 }])).toBe(false)
    expect(areRoadPointsValid([{ x: 0, z: 0 }])).toBe(false)
  })

  it('直线道路加断点一次给出四个控制点（两端 + 1/3、2/3），折线再加最长段中点', () => {
    const straight = [{ x: 0, z: 0 }, { x: 30, z: 0 }]
    const withFour = insertRoadBreakpoints(straight)
    expect(withFour).toHaveLength(4)
    expect(withFour[1].x).toBeCloseTo(10, 6)
    expect(withFour[2].x).toBeCloseTo(20, 6)
    // 已有四点时在最长段中点再加一个（最长段是 (4,10)-(4,14) 前的 10m 段，插入点 (4,5)）
    const more = insertRoadBreakpoints([{ x: 0, z: 0 }, { x: 4, z: 0 }, { x: 4, z: 10 }, { x: 4, z: 14 }])
    expect(more).toHaveLength(5)
    expect(more[2]).toEqual({ x: 4, z: 5 })
  })

  it('边缘点道路加断点时左右路缘各自插值，不退回居中对称', () => {
    const edges = [
      { lx: 0, lz: 3, rx: 0, rz: -3 },
      { lx: 20, lz: 6, rx: 20, rz: -3 },
    ]
    const next = insertRoadBreakpoints(edges)
    expect(next).toHaveLength(4)
    expect(next[1].lx).toBeCloseTo(20 / 3, 6)
    expect(next[1].lz).toBeCloseTo(4, 6)
    expect(next[1].rx).toBeCloseTo(20 / 3, 6)
    expect(next[1].rz).toBeCloseTo(-3, 6)
    expect(next[2].lx).toBeCloseTo(40 / 3, 6)
    expect(next[2].lz).toBeCloseTo(5, 6)
  })
})

describe('道路绘制吸附与自动接合', () => {
  it('新端点靠近已有道路控制点时吸附过去', () => {
    const snapped = snapRoadPointToExisting({ x: 9.6, z: 0.3 }, [{ x: 10, z: 0 }, { x: 30, z: 0 }])
    expect(snapped).toEqual({ x: 10, z: 0, snapped: true })
    const free = snapRoadPointToExisting({ x: 3, z: 3 }, [{ x: 10, z: 0 }])
    expect(free).toEqual({ x: 3, z: 3, snapped: false })
  })

  it('两条路端点重合时按顺序合并（四种首尾组合）', () => {
    const a = [{ x: 0, z: 0 }, { x: 10, z: 0 }]
    // 已有尾 + 新增首
    expect(mergeRoadPointSequences(a, [{ x: 10, z: 0 }, { x: 10, z: 10 }]))
      .toEqual([{ x: 0, z: 0 }, { x: 10, z: 0 }, { x: 10, z: 10 }])
    // 已有尾 + 新增尾：新增段反向接上
    expect(mergeRoadPointSequences(a, [{ x: 10, z: 10 }, { x: 10, z: 0 }]))
      .toEqual([{ x: 0, z: 0 }, { x: 10, z: 0 }, { x: 10, z: 10 }])
    // 已有首 + 新增尾
    expect(mergeRoadPointSequences(a, [{ x: -10, z: 0 }, { x: 0, z: 0 }]))
      .toEqual([{ x: -10, z: 0 }, { x: 0, z: 0 }, { x: 10, z: 0 }])
    // 已有首 + 新增首
    expect(mergeRoadPointSequences(a, [{ x: 0, z: 0 }, { x: -10, z: 0 }]))
      .toEqual([{ x: -10, z: 0 }, { x: 0, z: 0 }, { x: 10, z: 0 }])
  })

  it('端点不重合时返回 null，避免误合并', () => {
    expect(mergeRoadPointSequences(
      [{ x: 0, z: 0 }, { x: 10, z: 0 }],
      [{ x: 12, z: 0 }, { x: 20, z: 0 }],
    )).toBeNull()
  })
})

describe('道路弧度平滑', () => {
  const bend = [
    { left: { x: 0, z: 3 }, right: { x: 0, z: -3 } },
    { left: { x: 20, z: 3 }, right: { x: 20, z: -3 } },
    { left: { x: 23, z: 20 }, right: { x: 17, z: 20 } },
  ]

  it('三个以上控制点时左右路缘各自平滑取样，控制点本身保持不变', () => {
    const samples = smoothRoadEdgeStations(bend, { subdivisions: 8 })
    expect(samples).toHaveLength(17)
    expect(samples[0].left).toEqual({ x: 0, z: 3 })
    expect(samples[0].right).toEqual({ x: 0, z: -3 })
    expect(samples.at(-1).left).toEqual({ x: 23, z: 20 })
    expect(samples.at(-1).right).toEqual({ x: 17, z: 20 })
    // 第二段中点离开直角折线：左缘弧线偏出弦线中点
    const middle = samples[12]
    const chordMid = { x: 21.5, z: 11.5 }
    expect(Math.hypot(middle.left.x - chordMid.x, middle.left.z - chordMid.z)).toBeGreaterThan(0.1)
  })

  it('两个控制点不做细分，直线与单坡宽度保持原样', () => {
    const two = [
      { left: { x: 0, z: 3 }, right: { x: 0, z: -3 } },
      { left: { x: 12, z: 4 }, right: { x: 12, z: -3 } },
    ]
    expect(smoothRoadEdgeStations(two)).toEqual(two)
  })

  it('占地轮廓沿平滑路缘给出左右链（世界坐标）', () => {
    const model = createPolylineRoadModel(THREE, {
      objectType: 'asphalt-road',
      width: 4,
      points: [{ x: 0, z: 0 }, { x: 12, z: 0 }, { x: 12, z: 12 }],
    })
    const footprint = getRoadFootprint(model)
    expect(footprint.left).toHaveLength(17)
    expect(footprint.right).toHaveLength(17)
    expect(footprint.left[0]).toEqual({ x: 0, z: 2 })
    expect(footprint.left.at(-1)).toEqual({ x: 10, z: 12 })
    expect(footprint.right.at(-1)).toEqual({ x: 14, z: 12 })
  })

  it('折线道路移动/旋转后路缘与中心点跟随世界变换', () => {
    const model = createPolylineRoadModel(THREE, {
      objectType: 'asphalt-road',
      width: 6,
      points: [{ x: 0, z: 0 }, { x: 10, z: 0 }],
    })
    model.position.set(0, 0, 5)
    model.rotation.y = Math.PI / 2
    model.updateMatrixWorld(true)

    const handles = getRoadEdgeHandles(model)
    const xs = handles.map(handle => handle.x).sort((a, b) => a - b)
    const zs = handles.map(handle => handle.z).sort((a, b) => a - b)
    expect(xs[0]).toBeCloseTo(-3, 5)
    expect(xs.at(-1)).toBeCloseTo(3, 5)
    expect(zs[0]).toBeCloseTo(-5, 5)
    expect(zs.at(-1)).toBeCloseTo(5, 5)

    const stations = getRoadStations(model)
    expect(stations[0].x).toBeCloseTo(0, 5)
    expect(stations[0].z).toBeCloseTo(5, 5)
    expect(stations[1].x).toBeCloseTo(0, 5)
    expect(stations[1].z).toBeCloseTo(-5, 5)
  })

  it('柏油折线道路保留中间的黄色双线，随路面形状连续', () => {
    const model = createPolylineRoadModel(THREE, {
      objectType: 'asphalt-road',
      width: 6,
      points: [{ x: 0, z: 0 }, { x: 16, z: 0 }, { x: 16, z: 16 }],
    })
    const yellow = model.children.find(mesh => mesh.name === 'asphalt-road-polyline-yellow')
    expect(yellow).toBeTruthy()
    // 2 段控制边 × 8 细分 × 两条黄线 × 每段 2 三角 × 3 顶点
    expect(yellow.geometry.attributes.position.count).toBe(2 * 8 * 2 * 6)
    const yellowBounds = new THREE.Box3().setFromObject(yellow)
    const roadBounds = new THREE.Box3().setFromObject(model)
    expect(yellowBounds.min.y).toBeGreaterThan(0.08)
    expect(yellowBounds.min.x).toBeGreaterThanOrEqual(roadBounds.min.x - 0.05)
    expect(yellowBounds.max.x).toBeLessThanOrEqual(roadBounds.max.x + 0.05)
    expect(yellowBounds.min.z).toBeGreaterThanOrEqual(roadBounds.min.z - 0.05)
    expect(yellowBounds.max.z).toBeLessThanOrEqual(roadBounds.max.z + 0.05)

    const concrete = createPolylineRoadModel(THREE, {
      objectType: 'concrete-road',
      width: 4,
      points: [{ x: 0, z: 0 }, { x: 10, z: 0 }],
    })
    expect(concrete.children.some(mesh => mesh.name.includes('yellow'))).toBe(false)
  })

  it('拖动一侧路缘只改变这一侧曲线，对面路缘逐点不变', () => {
    const bend = 3 * Math.SQRT1_2
    const stations = [
      { left: { x: 0, z: 3 }, right: { x: 0, z: -3 } },
      { left: { x: 10 - bend, z: bend }, right: { x: 10 + bend, z: -bend } },
      { left: { x: 7, z: 10 }, right: { x: 13, z: 10 } },
    ]
    const before = smoothRoadEdgeStations(stations)
    const dragged = stations.map((station, index) => (index === 1
      ? { left: { x: 10 - bend, z: bend + 4 }, right: station.right }
      : station))
    const after = smoothRoadEdgeStations(dragged)
    before.forEach((station, index) => {
      expect(after[index].right.x).toBeCloseTo(station.right.x, 10)
      expect(after[index].right.z).toBeCloseTo(station.right.z, 10)
    })
    // 被拖的那一侧确实变了
    expect(after[4].left.z).not.toBeCloseTo(before[4].left.z, 3)
  })

  it('转弯处路缘不超出控制点范围，不会鼓到路外', () => {
    const road = createPolylineRoadModel(THREE, {
      objectType: 'concrete-road',
      width: 6,
      points: [{ x: 0, z: 0 }, { x: 20, z: 0 }, { x: 20, z: 20 }],
    })
    const smooth = smoothRoadEdgeStations(getRoadEdgeStations(road))
    const xs = smooth.flatMap(station => [station.left.x, station.right.x])
    const zs = smooth.flatMap(station => [station.left.z, station.right.z])
    expect(Math.max(...xs)).toBeLessThanOrEqual(23 + 1e-6)
    expect(Math.min(...zs)).toBeGreaterThanOrEqual(-3 - 1e-6)
    expect(Math.max(...zs)).toBeLessThanOrEqual(20 + 1e-6)
  })

  it('按点击位置插入单个断点，而不是固定中点或一对断点', () => {
    const straight = [{ x: 0, z: 0 }, { x: 30, z: 0 }]
    const next = insertRoadBreakpointAt(straight, { x: 6, z: 2 })
    expect(next).toHaveLength(3)
    expect(next[1].x).toBeCloseTo(6, 6)
    expect(next[1].z).toBeCloseTo(0, 6)

    const bent = [{ x: 0, z: 0 }, { x: 10, z: 0 }, { x: 10, z: 10 }]
    const inserted = insertRoadBreakpointAt(bent, { x: 9, z: 8 })
    expect(inserted).toHaveLength(4)
    expect(inserted[2].x).toBeCloseTo(10, 6)
    expect(inserted[2].z).toBeCloseTo(8, 6)

    const edges = [{ lx: 0, lz: 3, rx: 0, rz: -3 }, { lx: 12, lz: 3, rx: 12, rz: -3 }]
    const edgeInserted = insertRoadBreakpointAt(edges, { x: 3, z: 0 })
    expect(edgeInserted).toHaveLength(3)
    expect(edgeInserted[1]).toMatchObject({ lx: 3, lz: 3, rx: 3, rz: -3 })
  })

  it('平移动控制截面时宽度保持不变，且不改原数组', () => {
    const stations = [
      { left: { x: 0, z: 3 }, right: { x: 0, z: -3 } },
      { left: { x: 12, z: 3 }, right: { x: 12, z: -3 } },
    ]
    const moved = translateRoadStation(stations, 1, { x: 2, z: 4 })
    expect(moved[0]).toEqual(stations[0])
    expect(moved[1].left).toEqual({ x: 14, z: 7 })
    expect(moved[1].right).toEqual({ x: 14, z: 1 })
    expect(stations[1].left).toEqual({ x: 12, z: 3 })
  })

  it('折线道路渲染按平滑曲线细分，存储的控制点保持原样', () => {
    const model = createPolylineRoadModel(THREE, {
      objectType: 'asphalt-road',
      width: 6,
      points: [{ x: 0, z: 0 }, { x: 16, z: 0 }, { x: 16, z: 16 }],
    })
    expect(model.userData.proceduralRoad.points).toHaveLength(3)
    const surface = model.children.find(mesh => mesh.userData.roadFeature)
    expect(surface.userData.roadFeature.segments).toBe(16)
  })
})

describe('createPolylineRoadModel', () => {
  it('两点折线等价于一条直线道路：尺寸与包围盒正确', () => {
    const model = createPolylineRoadModel(THREE, {
      objectType: 'asphalt-road',
      width: 6,
      points: [{ x: 0, z: 0 }, { x: 24, z: 0 }],
    })
    expect(isPolylineRoadModel(model)).toBe(true)
    const road = model.userData.proceduralRoad
    expect(road).toMatchObject({ version: 4, objectType: 'asphalt-road', width: 6 })
    // v4 存储左右边缘点：(0,±3) 与 (24,±3)
    expect(road.points).toHaveLength(2)
    expect(road.points[0].lz).toBeCloseTo(3, 3)
    expect(road.points[0].rz).toBeCloseTo(-3, 3)
    expect(road.points[1].lx).toBeCloseTo(24, 3)
    const bounds = new THREE.Box3().setFromObject(model)
    const size = bounds.getSize(new THREE.Vector3())
    expect(size.x).toBeCloseTo(24, 1)
    expect(size.z).toBeCloseTo(6, 1)
    expect(bounds.min.y).toBeGreaterThanOrEqual(-0.001)
  })

  it('三点折线能拐弯：包围盒覆盖两段，控制点可从模型读回', () => {
    const model = createPolylineRoadModel(THREE, {
      objectType: 'concrete-road',
      width: 4,
      points: [{ x: 0, z: 0 }, { x: 20, z: 0 }, { x: 20, z: 20 }],
    })
    const bounds = new THREE.Box3().setFromObject(model)
    // 第二段沿 z 到 (20,20)，宽度沿 x 展开到 22；路端到点为止。
    expect(bounds.max.x).toBeGreaterThanOrEqual(21)
    expect(bounds.max.z).toBeGreaterThanOrEqual(19.9)
    const worldPoints = getRoadPoints(model)
    expect(worldPoints).toHaveLength(3)
    expect(worldPoints[2].x).toBeCloseTo(20, 6)
    expect(worldPoints[2].z).toBeCloseTo(20, 6)
  })

  it('无效输入抛错：少于两点、相邻过近、未知类型', () => {
    expect(() => createPolylineRoadModel(THREE, { objectType: 'asphalt-road', width: 6, points: [{ x: 0, z: 0 }] })).toThrow()
    expect(() => createPolylineRoadModel(THREE, {
      objectType: 'asphalt-road', width: 6, points: [{ x: 0, z: 0 }, { x: 0.3, z: 0 }],
    })).toThrow()
    expect(() => createPolylineRoadModel(THREE, {
      objectType: 'lava-road', width: 6, points: [{ x: 0, z: 0 }, { x: 5, z: 0 }],
    })).toThrow()
  })

  it('折线道路可被 ObjectLoader 序列化往返（存档兼容）', () => {
    const model = createPolylineRoadModel(THREE, {
      objectType: 'brick-walkway',
      width: 2.4,
      points: [{ x: 0, z: 0 }, { x: 8, z: 0 }, { x: 8, z: 8 }],
    })
    const json = model.toJSON()
    const restored = new THREE.ObjectLoader().parse(json)
    expect(isPolylineRoadModel(restored)).toBe(true)
    expect(restored.userData.proceduralRoad.points).toHaveLength(3)
  })
})
