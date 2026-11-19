import { describe, expect, it, vi } from 'vitest'
import {
  createCollabClient,
  diffSnapshotChunks,
  modelChunkKey,
  presenceChunkForModel,
} from './sharedWorkspace.js'

function model(id, x, z, name = id) {
  return {
    id,
    name,
    object: { metadata: {}, object: { name, position: [x, 0, z] } },
  }
}

function snapshot(models, extra = {}) {
  return {
    version: 4,
    world: { version: 1, chunkSize: { width: 54, depth: 42 }, chunks: [{ x: 0, z: 0 }] },
    environment: { time: 12, weather: 'clear' },
    models,
    ...extra,
  }
}

describe('共享世界快照差异', () => {
  it('按模型位置计算地块，并把世界与环境变化归到 __world__', () => {
    const before = snapshot([model('keep', 0, 0), model('move', 1, 1), model('edit', 30, 0)])
    const after = snapshot(
      [model('keep', 0, 0), model('move', -30, 1), model('edit', 30, 0, 'renamed'), model('new', 60, 0)],
      { environment: { time: 18, weather: 'clear' } },
    )

    expect(modelChunkKey(model('negative', -27.1, 0), before.world)).toBe('-1:0')
    const diff = diffSnapshotChunks(before, after)
    expect(diff.chunks).toEqual(['-1:0', '0:0', '1:0', '__world__'])
    expect(diff.modelChanges).toEqual({
      added: ['new'],
      removed: [],
      modified: ['edit', 'move'],
    })
  })

  it('没有差异时不产生待同步地块', () => {
    const value = snapshot([model('same', 0, 0)])
    expect(diffSnapshotChunks(value, structuredClone(value))).toMatchObject({
      chunks: [],
      worldChanged: false,
      environmentChanged: false,
    })
  })

  it('为选中的模型给出在线状态地块，没有模型时退回当前地块', () => {
    const value = snapshot([model('a', 0, 0)])
    expect(presenceChunkForModel(value, 'a')).toBe('0:0')
    expect(presenceChunkForModel(value, 'missing')).toBe('0:0')
    expect(presenceChunkForModel(value, 'missing', '3:4')).toBe('3:4')
  })
})

describe('协作 API 客户端', () => {
  const BASE = 'http://api.local/api/v1'
  const json = (body, status = 200) => new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })

  it('读取工作区与状态时使用 Cookie 会话', async () => {
    const fetchImpl = vi.fn(async () => json({ workspace: { revision: 1 } }))
    const client = createCollabClient({ baseUrl: BASE, fetchImpl })

    await client.fetchWorkspace()
    await client.fetchStatus()

    expect(fetchImpl.mock.calls.map(([url]) => url)).toEqual([
      `${BASE}/collab/workspace`,
      `${BASE}/collab/status`,
    ])
    expect(fetchImpl.mock.calls[0][1]).toMatchObject({ credentials: 'include', method: 'GET' })
  })

  it('保存时发送快照、改动地块与期望版本', async () => {
    const fetchImpl = vi.fn(async () => json({ ok: true, revision: 2, chunkVersions: { '0:0': 2 } }))
    const client = createCollabClient({ baseUrl: BASE, fetchImpl })
    const value = snapshot([model('a', 0, 0)])

    await client.saveWorkspace({
      snapshot: value,
      changedChunks: ['0:0', '__world__'],
      expectedVersions: { '0:0': 1, __world__: 3 },
    })

    const [url, options] = fetchImpl.mock.calls[0]
    expect(url).toBe(`${BASE}/collab/workspace`)
    expect(options.method).toBe('POST')
    expect(JSON.parse(options.body)).toMatchObject({
      snapshot: value,
      changedChunks: ['0:0', '__world__'],
      expectedVersions: { '0:0': 1, __world__: 3 },
    })
  })

  it('409 响应保留错误码、状态和冲突详情', async () => {
    const fetchImpl = vi.fn(async () => json({
      code: 'CHUNK_LOCKED',
      message: '地块 0:0 正由其他成员编辑',
      conflicts: [{ chunkKey: '0:0', displayName: '小林' }],
    }, 409))
    const client = createCollabClient({ baseUrl: BASE, fetchImpl })

    const error = await client.acquireLocks({ chunkKeys: ['0:0'] }).catch(value => value)
    expect(error).toMatchObject({
      name: 'CollabRequestError',
      status: 409,
      code: 'CHUNK_LOCKED',
      message: '地块 0:0 正由其他成员编辑',
    })
    expect(error.payload.conflicts[0].displayName).toBe('小林')
  })

  it('心跳和释放锁都发到对应路径', async () => {
    const fetchImpl = vi.fn(async () => json({ ok: true }))
    const client = createCollabClient({ baseUrl: BASE, fetchImpl })

    await client.heartbeatLocks({ chunkKeys: ['0:0'], currentChunk: '0:0' })
    await client.releaseLocks({ chunkKeys: ['0:0'] })
    await client.forceUnlock({ chunkKeys: ['0:0'] })

    expect(fetchImpl.mock.calls.map(([url]) => url)).toEqual([
      `${BASE}/collab/locks/heartbeat`,
      `${BASE}/collab/locks/release`,
      `${BASE}/admin/collab/force-unlock`,
    ])
  })
})
