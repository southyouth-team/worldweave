const DEFAULT_API_BASE = import.meta.env?.VITE_API_BASE_URL || 'http://localhost:3001/api/v1'

export const WORLD_LOCK_KEY = '__world__'
const DEFAULT_CHUNK_WIDTH = 54
const DEFAULT_CHUNK_DEPTH = 42

function chunkSize(world) {
  return {
    width: Math.max(1, Number(world?.chunkSize?.width) || DEFAULT_CHUNK_WIDTH),
    depth: Math.max(1, Number(world?.chunkSize?.depth) || DEFAULT_CHUNK_DEPTH),
  }
}

function readPosition(model) {
  const position = model?.object?.object?.position ?? model?.object?.position
  if (Array.isArray(position)) {
    return { x: Number(position[0]) || 0, z: Number(position[2]) || 0 }
  }
  return { x: Number(position?.x) || 0, z: Number(position?.z) || 0 }
}

export function modelChunkKey(model, world) {
  const size = chunkSize(world)
  const { x, z } = readPosition(model)
  return Math.floor((x + size.width / 2) / size.width)
    + ':' + Math.floor((z + size.depth / 2) / size.depth)
}

export function presenceChunkForModel(snapshot, modelId, fallback = '0:0') {
  const models = Array.isArray(snapshot?.models) ? snapshot.models : []
  const selected = models.find(model => String(model.id) === String(modelId))
  return selected ? modelChunkKey(selected, snapshot?.world) : fallback
}

function stableJson(value) {
  return JSON.stringify(value ?? null)
}

export function diffSnapshotChunks(previous, next) {
  const before = new Map()
  const after = new Map()
  for (const model of previous?.models || []) {
    if (model?.id !== undefined && model?.id !== null) before.set(String(model.id), model)
  }
  for (const model of next?.models || []) {
    if (model?.id !== undefined && model?.id !== null) after.set(String(model.id), model)
  }
  const world = next?.world || previous?.world
  const added = []
  const removed = []
  const modified = []
  const chunks = new Set()

  for (const [id, model] of after) {
    const old = before.get(id)
    if (!old) {
      added.push(id)
      chunks.add(modelChunkKey(model, world))
      continue
    }
    if (stableJson(old) === stableJson(model)) continue
    modified.push(id)
    chunks.add(modelChunkKey(old, world))
    chunks.add(modelChunkKey(model, world))
  }
  for (const [id, model] of before) {
    if (after.has(id)) continue
    removed.push(id)
    chunks.add(modelChunkKey(model, world))
  }

  const worldChanged = stableJson(previous?.world) !== stableJson(next?.world)
  const environmentChanged = stableJson(previous?.environment) !== stableJson(next?.environment)
  if (worldChanged || environmentChanged) chunks.add(WORLD_LOCK_KEY)

  return {
    chunks: Array.from(chunks).sort(),
    modelChanges: { added: added.sort(), removed: removed.sort(), modified: modified.sort() },
    worldChanged,
    environmentChanged,
  }
}

export class CollabRequestError extends Error {
  constructor(message, { status = 0, code = '', payload = null } = {}) {
    super(message)
    this.name = 'CollabRequestError'
    this.status = status
    this.code = code
    this.payload = payload
  }
}

export function createCollabClient({
  baseUrl = DEFAULT_API_BASE,
  fetchImpl = typeof fetch !== 'undefined' ? fetch : null,
} = {}) {
  const root = String(baseUrl || '').replace(/\/+$/, '')

  async function request(path, options = {}) {
    if (typeof fetchImpl !== 'function') throw new CollabRequestError('当前环境不支持网络请求')
    const response = await fetchImpl(root + path, {
      method: 'GET',
      credentials: 'include',
      ...options,
      headers: {
        ...(options.body ? { 'Content-Type': 'application/json' } : {}),
        ...(options.headers || {}),
      },
    })
    const payload = await response.json().catch(() => ({}))
    if (!response.ok) {
      const detail = Array.isArray(payload?.message) ? payload.message.join('；') : payload?.message
      throw new CollabRequestError(detail || '请求失败：HTTP ' + response.status, {
        status: response.status,
        code: payload?.code || '',
        payload,
      })
    }
    return payload
  }

  return {
    fetchWorkspace: () => request('/collab/workspace'),
    fetchStatus: () => request('/collab/status'),
    touchPresence: payload => request('/collab/presence', {
      method: 'POST',
      body: JSON.stringify(payload || {}),
    }),
    acquireLocks: payload => request('/collab/locks', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
    heartbeatLocks: payload => request('/collab/locks/heartbeat', {
      method: 'POST',
      body: JSON.stringify(payload || {}),
    }),
    releaseLocks: (payload = {}, { keepalive = false } = {}) => request('/collab/locks/release', {
      method: 'POST',
      body: JSON.stringify(payload),
      keepalive,
    }),
    saveWorkspace: payload => request('/collab/workspace', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
    forceUnlock: (payload = {}) => request('/admin/collab/force-unlock', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  }
}

export const collabClient = createCollabClient()
