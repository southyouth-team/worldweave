import { describe, expect, it } from 'vitest'
import { BUILTIN_CATEGORY_LABELS, listBuiltinAssets } from '../../three/sandbox/builtinAssetAdapter.js'
import {
  buildProceduralAssetPayload,
  canArchiveSandboxModel,
  getSelectedModelState,
  groupBuiltinAssetsByCategory,
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

describe('groupBuiltinAssetsByCategory', () => {
  it('按 BUILTIN_CATEGORY_LABELS 顺序输出 5 个非空分组，条目总数 13', () => {
    const groups = groupBuiltinAssetsByCategory(listBuiltinAssets())
    expect(groups.map(group => group.category)).toEqual(Object.keys(BUILTIN_CATEGORY_LABELS))
    expect(groups.map(group => group.label)).toEqual(Object.values(BUILTIN_CATEGORY_LABELS))
    expect(groups).toHaveLength(5)
    expect(groups.every(group => group.items.length > 0)).toBe(true)
    expect(groups.flatMap(group => group.items)).toHaveLength(13)
  })

  it('未知类别条目被忽略而不是塞进未命名分组', () => {
    const groups = groupBuiltinAssetsByCategory([
      { category: 'vegetation', objectType: 'tree', label: '乔木' },
      { category: 'mystery', objectType: 'ufo', label: '不明物体' },
    ])
    expect(groups).toHaveLength(5)
    expect(groups[0].items).toEqual([{ category: 'vegetation', objectType: 'tree', label: '乔木' }])
    expect(groups.flatMap(group => group.items).some(item => item.category === 'mystery')).toBe(false)
  })
})
