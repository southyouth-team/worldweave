import { describe, expect, it } from 'vitest'
import { diffSnapshotModels, modelTransform } from './snapshotDiff.js'

function model(id, x, z, name = id, extra = {}) {
  return {
    id,
    name,
    object: {
      metadata: { version: 4.6 },
      object: {
        name,
        position: [x, 0, z],
        rotation: [0, 0, 0],
        scale: [1, 1, 1],
        ...extra,
      },
    },
  }
}

function snapshot(models) {
  return {
    version: 4,
    savedAt: '2026-11-19T10:00:00.000Z',
    world: { version: 1, chunkSize: { width: 54, depth: 42 }, chunks: [{ x: 0, z: 0 }] },
    environment: { time: 12, weather: 'clear' },
    models,
  }
}

describe('发布快照模型差异', () => {
  it('区分新增、修改、删除，并给出修改字段', () => {
    const base = snapshot([model('keep', 0, 0), model('move', 10, 0), model('gone', 60, 0)])
    const next = snapshot([
      model('keep', 0, 0),
      model('move', 12, 3, 'move-renamed', { rotation: [0, 1, 0] }),
      model('new', 30, 0),
    ])

    const diff = diffSnapshotModels(base, next)
    expect(diff.added.map(item => item.id)).toEqual(['new'])
    expect(diff.deleted.map(item => item.id)).toEqual(['gone'])
    expect(diff.modified.map(item => item.id)).toEqual(['move'])
    expect(diff.summary).toEqual({ added: 1, modified: 1, deleted: 1, unchanged: 1 })
    const move = diff.modified[0]
    expect(move.changes.map(item => item.field)).toEqual(expect.arrayContaining(['名称', '位置', '旋转']))
    expect(move.before.name).toBe('move')
    expect(move.after.name).toBe('move-renamed')
  })

  it('没有基准版本时把所有模型视为新增', () => {
    const next = snapshot([model('a', 0, 0), model('b', 60, 0)])
    const diff = diffSnapshotModels(null, next)
    expect(diff.added).toHaveLength(2)
    expect(diff.summary).toEqual({ added: 2, modified: 0, deleted: 0, unchanged: 0 })
  })

  it('忽略保存时间并识别几何/材质变化', () => {
    const base = snapshot([model('a', 0, 0)])
    const same = { ...snapshot([model('a', 0, 0)]), savedAt: '2026-11-20T00:00:00.000Z' }
    expect(diffSnapshotModels(base, same).summary).toEqual({ added: 0, modified: 0, deleted: 0, unchanged: 1 })

    const changed = snapshot([model('a', 0, 0, 'a', { geometry: { vertexCount: 42 } })])
    expect(diffSnapshotModels(base, changed).modified[0].changes.map(item => item.field)).toContain('模型内容')
  })

  it('忽略根节点由位置/旋转派生的 matrix 精度差异', () => {
    const base = snapshot([model('a', 2, 3)])
    const next = snapshot([model('a', 2, 3)])
    next.models[0].object.object.matrix = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 2.0000001, 0, 3.0000001, 1]
    expect(diffSnapshotModels(base, next).summary).toEqual({ added: 0, modified: 0, deleted: 0, unchanged: 1 })
  })

  it('读取模型根节点的位置、旋转和缩放', () => {
    expect(modelTransform(model('a', 2, 3))).toEqual({
      position: [2, 0, 3],
      rotation: [0, 0, 0],
      scale: [1, 1, 1],
    })
  })
})
