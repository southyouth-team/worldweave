import { describe, expect, it, vi } from 'vitest'
import { BUILTIN_CATEGORY_LABELS, listBuiltinAssets } from '../../three/sandbox/builtinAssetAdapter.js'
import { isStretchableRoadModel as isStretchableRoadModelFromEngine } from '../../three/sandbox/roadEndpointMath.js'
import {
  buildProceduralAssetPayload,
  canArchiveSandboxModel,
  createRoadEditPersistence,
  getSelectedModelState,
  groupBuiltinAssetsByCategory,
  isStretchableRoadModel,
} from './assetLibraryUi.js'

function fakeModel(userData) {
  return { name: '场景模型', userData: { ...userData } }
}

describe('canArchiveSandboxModel', () => {
  it('带非空源码字符串的 AI 模型可入库', () => {
    const model = fakeModel({ proceduralModelSource: 'export function createModel() {}' })
    expect(canArchiveSandboxModel(model)).toBe(true)
  })

  it('内置素材（null）、空串、旧快照遗留（undefined）均不可入库', () => {
    expect(canArchiveSandboxModel(fakeModel({ proceduralModelSource: null }))).toBe(false)
    expect(canArchiveSandboxModel(fakeModel({ proceduralModelSource: '   ' }))).toBe(false)
    expect(canArchiveSandboxModel(fakeModel({}))).toBe(false)
    expect(canArchiveSandboxModel(undefined)).toBe(false)
    expect(canArchiveSandboxModel(null)).toBe(false)
  })
})

describe('buildProceduralAssetPayload', () => {
  it('完整 userData 时字段一一对应，sourceCode 与原源码严格相等', () => {
    const source = 'export function createModel() { return new Group() }'
    const manifest = { version: 1, capabilities: { spatial: { colliders: [] } } }
    const model = fakeModel({
      proceduralModelSource: source,
      proceduralModelConfig: { objectType: '自定义岗亭' },
      proceduralModelCapabilityManifest: manifest,
      proceduralModelParameters: [{ key: 'width' }],
      proceduralModelParts: [{ componentId: 'p1' }],
      proceduralModelEnvironmentBindings: [{ target: 'ground' }],
    })

    const payload = buildProceduralAssetPayload(model, '我的岗亭')

    expect(payload).toEqual({
      name: '我的岗亭',
      category: 'sandbox-model',
      objectType: '自定义岗亭',
      sourceCode: source,
      manifest,
      parameters: [{ key: 'width' }],
      parts: [{ componentId: 'p1' }],
      environmentBindings: [{ target: 'ground' }],
    })
    expect(payload.sourceCode).toBe(source)
  })

  it('userData 全缺时归一化输出，不抛异常', () => {
    const payload = buildProceduralAssetPayload(fakeModel({ proceduralModelSource: 'src' }), '未命名模型')
    expect(payload.objectType).toBe('独立 3D 模型')
    expect(payload.manifest).toEqual({ version: 1, capabilities: {} })
    expect(payload.parameters).toEqual([])
    expect(payload.parts).toEqual([])
    expect(payload.environmentBindings).toEqual([])
    expect(payload.name).toBe('未命名模型')
  })
})

describe('getSelectedModelState', () => {
  it('带非空源码的 AI 模型：editable 与 canArchive 同时为 true', () => {
    const state = getSelectedModelState(fakeModel({ proceduralModelSource: 'export default {}' }))
    expect(state).toEqual({ editable: true, canArchive: true })
  })

  it('内置素材（null）、旧快照遗留（undefined）、空选择：两者均为 false', () => {
    expect(getSelectedModelState(fakeModel({ proceduralModelSource: null })))
      .toEqual({ editable: false, canArchive: false })
    expect(getSelectedModelState(fakeModel({})))
      .toEqual({ editable: false, canArchive: false })
    expect(getSelectedModelState(null))
      .toEqual({ editable: false, canArchive: false })
    expect(getSelectedModelState(undefined))
      .toEqual({ editable: false, canArchive: false })
  })

  it('纯空白源码：editable 沿用既有 Boolean(source) 语义为 true，但入库资格为 false', () => {
    const state = getSelectedModelState(fakeModel({ proceduralModelSource: '   ' }))
    expect(state.editable).toBe(true)
    expect(state.canArchive).toBe(false)
  })
})

describe('isStretchableRoadModel', () => {
  function roadModel(roadOverrides = {}, refOverrides = {}) {
    return {
      userData: {
        proceduralRoad: {
          version: 1,
          objectType: 'asphalt-road',
          length: 24,
          width: 6,
          ...roadOverrides,
        },
        builtinAssetRef: {
          category: 'road',
          objectType: 'asphalt-road',
          ...refOverrides,
        },
      },
    }
  }

  it('UI 入口与引擎道路资格判断共用同一个实现', () => {
    expect(isStretchableRoadModel).toBe(isStretchableRoadModelFromEngine)
  })

  it('四种道路的完整参数均可进入端点编辑', () => {
    for (const objectType of ['asphalt-road', 'concrete-road', 'brick-walkway', 'stone-path']) {
      const model = roadModel({ objectType }, { objectType })
      expect(isStretchableRoadModel(model)).toBe(true)
    }
  })

  it('拒绝空选择和损坏的道路参数', () => {
    expect(isStretchableRoadModel(null)).toBe(false)
    expect(isStretchableRoadModel(undefined)).toBe(false)
    expect(isStretchableRoadModel(roadModel({ version: 2 }))).toBe(false)
    expect(isStretchableRoadModel(roadModel({ objectType: 'unknown-road' }), { objectType: 'unknown-road' })).toBe(false)
    expect(isStretchableRoadModel(roadModel({ length: 1.99 }))).toBe(false)
    expect(isStretchableRoadModel(roadModel({ length: 120.01 }))).toBe(false)
    expect(isStretchableRoadModel(roadModel({ length: Number.NaN }))).toBe(false)
    expect(isStretchableRoadModel(roadModel({ width: 0 }))).toBe(false)
    expect(isStretchableRoadModel(roadModel({}, { category: 'building' }))).toBe(false)
    expect(isStretchableRoadModel(roadModel({}, { objectType: 'concrete-road' }))).toBe(false)
    expect(isStretchableRoadModel({ userData: { proceduralRoad: roadModel().userData.proceduralRoad } })).toBe(false)
  })
})

describe('createRoadEditPersistence', () => {
  it('committed 时先同步列表再保存一次，并返回保存结果', () => {
    const order = []
    const sync = vi.fn(() => order.push('sync'))
    const save = vi.fn(() => {
      order.push('save')
      return true
    })
    const persist = createRoadEditPersistence({ save, sync })

    const result = persist({ phase: 'committed', id: 'road-1', length: 26 })

    expect(result).toBe(true)
    expect(order).toEqual(['sync', 'save'])
    expect(sync).toHaveBeenCalledTimes(1)
    expect(save).toHaveBeenCalledTimes(1)
  })

  it('dragging、blocked、cancelled 和未知状态不触发同步或保存', () => {
    const sync = vi.fn()
    const save = vi.fn(() => true)
    const persist = createRoadEditPersistence({ save, sync })

    for (const phase of ['dragging', 'blocked', 'cancelled', undefined]) {
      expect(persist({ phase, id: 'road-1', length: 26 })).toBeNull()
    }

    expect(sync).not.toHaveBeenCalled()
    expect(save).not.toHaveBeenCalled()
  })

  it('保存失败时返回 false，且不产生额外保存或移除动作', () => {
    const sync = vi.fn()
    const save = vi.fn(() => false)
    const persist = createRoadEditPersistence({ save, sync })
    const payload = { phase: 'committed', id: 'road-1', length: 26 }

    const result = persist(payload)

    expect(result).toBe(false)
    expect(sync).toHaveBeenCalledTimes(1)
    expect(save).toHaveBeenCalledTimes(1)
    expect(payload).toEqual({ phase: 'committed', id: 'road-1', length: 26 })
  })
})

describe('groupBuiltinAssetsByCategory', () => {
  it('按 BUILTIN_CATEGORY_LABELS 顺序输出 7 个非空分组，常规道路在末位，条目总数 22', () => {
    const groups = groupBuiltinAssetsByCategory(listBuiltinAssets())
    expect(groups.map(group => group.category)).toEqual(Object.keys(BUILTIN_CATEGORY_LABELS))
    expect(groups.map(group => group.label)).toEqual(Object.values(BUILTIN_CATEGORY_LABELS))
    expect(groups).toHaveLength(7)
    expect(groups.at(-1).category).toBe('road')
    expect(groups.at(-1).label).toBe('常规道路')
    expect(groups.every(group => group.items.length > 0)).toBe(true)
    expect(groups.flatMap(group => group.items)).toHaveLength(22)
  })

  it('目录 note 原样透传到分组条目，无 note 的旧素材保持 undefined', () => {
    const items = groupBuiltinAssetsByCategory(listBuiltinAssets()).flatMap(group => group.items)
    expect(items.find(item => item.objectType === 'east-gate').note)
      .toBe('古典三重檐门楼，中央拱门可穿行')
    expect(items.find(item => item.objectType === 'tree').note).toBeUndefined()
  })

  it('未知类别条目被忽略而不是塞进未命名分组', () => {
    const groups = groupBuiltinAssetsByCategory([
      { category: 'vegetation', objectType: 'tree', label: '乔木' },
      { category: 'mystery', objectType: 'ufo', label: '不明物体' },
    ])
    expect(groups).toHaveLength(7)
    expect(groups[0].items).toEqual([{ category: 'vegetation', objectType: 'tree', label: '乔木' }])
    expect(groups.flatMap(group => group.items).some(item => item.category === 'mystery')).toBe(false)
  })
})
