import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  clearPublishedSandboxSnapshot,
  clearSnapshotOnServer,
  HOMEPAGE_SNAPSHOT_KEY,
  loadHomepagePublishedSnapshot,
  loadPublishedSandboxSnapshot,
  loadSnapshotFromServer,
  publishSandboxSnapshot,
  publishSnapshotToServer,
} from './homepageSnapshot.js'

function installLocalStorage(initial = {}) {
  const store = new Map(Object.entries(initial))
  vi.stubGlobal('localStorage', {
    getItem: key => (store.has(key) ? store.get(key) : null),
    setItem: (key, value) => { store.set(key, String(value)) },
    removeItem: key => { store.delete(key) },
  })
  return store
}

beforeEach(() => {
  vi.unstubAllGlobals()
})

describe('首页发布快照', () => {
  it('只读取显式发布的快照，并带上发布时间', () => {
    const store = installLocalStorage()
    expect(loadPublishedSandboxSnapshot()).toBeNull()
    publishSandboxSnapshot({ version: 4, models: [{ id: 'a', name: 'A', object: {} }] })
    const raw = JSON.parse(store.get(HOMEPAGE_SNAPSHOT_KEY))
    expect(raw.models).toHaveLength(1)
    expect(typeof raw.publishedAt).toBe('string')
    expect(loadPublishedSandboxSnapshot()).toMatchObject({ version: 4 })
  })

  it('拒绝无效快照，且清除后首页恢复默认数据', () => {
    installLocalStorage()
    expect(() => publishSandboxSnapshot(null)).toThrow()
    expect(() => publishSandboxSnapshot({ models: 'bad' })).toThrow()
    publishSandboxSnapshot({ version: 4, models: [] })
    expect(clearPublishedSandboxSnapshot()).toBe(true)
    expect(loadPublishedSandboxSnapshot()).toBeNull()
  })

  it('存储内容损坏时返回 null 而不是抛错', () => {
    installLocalStorage({ [HOMEPAGE_SNAPSHOT_KEY]: '{broken json' })
    expect(loadPublishedSandboxSnapshot()).toBeNull()
  })

  it('服务端发布/读取/清除，首页优先使用服务端数据', async () => {
    installLocalStorage()
    const store = { snapshot: null }
    const fetchImpl = vi.fn(async (url, options = {}) => {
      const method = options.method || 'GET'
      if (method === 'PUT') {
        const body = JSON.parse(options.body)
        store.snapshot = body.snapshot
        return { ok: true, json: async () => ({ ok: true, models: body.snapshot.models.length }) }
      }
      if (method === 'DELETE') {
        store.snapshot = null
        return { ok: true, json: async () => ({ ok: true }) }
      }
      return { ok: true, json: async () => ({ snapshot: store.snapshot }) }
    })
    const options = { apiBase: 'http://api.local/api/v1', userId: 'user-a', fetchImpl }

    const saved = await publishSnapshotToServer({ version: 4, models: [{ id: 'a' }] }, options)
    expect(saved.models).toBe(1)
    expect(fetchImpl).toHaveBeenCalledWith(
      'http://api.local/api/v1/assets/homepage-snapshot',
      expect.objectContaining({ method: 'PUT', headers: expect.objectContaining({ 'X-Dev-User-Id': 'user-a' }) }),
    )

    // 首页优先读服务端，即使本地也有旧发布数据
    publishSandboxSnapshot({ version: 4, models: [{ id: 'local' }] })
    const preferred = await loadHomepagePublishedSnapshot(options)
    expect(preferred.models[0].id).toBe('a')

    expect(await clearSnapshotOnServer(options)).toBe(true)
    expect(await loadSnapshotFromServer(options)).toBeNull()
    // 服务端没有时退回本地发布数据
    const fallback = await loadHomepagePublishedSnapshot(options)
    expect(fallback.models[0].id).toBe('local')
  })

  it('服务端不可用时返回 null，不阻塞首页', async () => {
    const fetchImpl = vi.fn(async () => { throw new Error('offline') })
    expect(await loadSnapshotFromServer({ apiBase: 'http://api.local', userId: 'u', fetchImpl })).toBeNull()
    expect(await clearSnapshotOnServer({ apiBase: 'http://api.local', userId: 'u', fetchImpl })).toBe(false)
  })
})
