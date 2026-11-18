// 「发布到首页」：沙盒把当前快照另存到独立键，首页只读取这份发布数据，
// 不会受沙盒日常自动保存的影响。

export const HOMEPAGE_SNAPSHOT_KEY = 'world-sandbox-mvp:homepage:v1'

export function publishSandboxSnapshot(snapshot) {
  if (!snapshot || !Array.isArray(snapshot.models)) throw new Error('沙盒快照无效，无法发布到首页')
  const published = { ...snapshot, publishedAt: new Date().toISOString() }
  localStorage.setItem(HOMEPAGE_SNAPSHOT_KEY, JSON.stringify(published))
  return published
}

export function loadPublishedSandboxSnapshot() {
  try {
    const raw = localStorage.getItem(HOMEPAGE_SNAPSHOT_KEY)
    if (!raw) return null
    const snapshot = JSON.parse(raw)
    if (!snapshot || !Array.isArray(snapshot.models)) return null
    return snapshot
  } catch {
    return null
  }
}

export function clearPublishedSandboxSnapshot() {
  try {
    localStorage.removeItem(HOMEPAGE_SNAPSHOT_KEY)
    return true
  } catch {
    return false
  }
}

// ---- 服务端持久化（localStorage 空间不足时的正式存储） ----
export const HOMEPAGE_API_PATH = '/assets/homepage-snapshot'

export async function publishSnapshotToServer(snapshot, { apiBase, userId, fetchImpl = fetch } = {}) {
  const response = await fetchImpl(apiBase + HOMEPAGE_API_PATH, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', 'X-Dev-User-Id': userId },
    body: JSON.stringify({ snapshot }),
  })
  if (!response.ok) {
    const payload = await response.json().catch(() => ({}))
    throw new Error(payload.message || '发布失败：HTTP ' + response.status)
  }
  return response.json().catch(() => ({}))
}

export async function loadSnapshotFromServer({ apiBase, userId, fetchImpl = fetch } = {}) {
  try {
    const response = await fetchImpl(apiBase + HOMEPAGE_API_PATH, {
      headers: { 'X-Dev-User-Id': userId },
    })
    if (!response.ok) return null
    const payload = await response.json().catch(() => ({}))
    const snapshot = payload?.snapshot
    return snapshot && Array.isArray(snapshot.models) ? snapshot : null
  } catch {
    return null
  }
}

export async function clearSnapshotOnServer({ apiBase, userId, fetchImpl = fetch } = {}) {
  try {
    const response = await fetchImpl(apiBase + HOMEPAGE_API_PATH, {
      method: 'DELETE',
      headers: { 'X-Dev-User-Id': userId },
    })
    return response.ok
  } catch {
    return false
  }
}

/** 首页读取发布数据：优先服务端，失败再退回本地存储。 */
export async function loadHomepagePublishedSnapshot({ apiBase, userId, fetchImpl = fetch } = {}) {
  if (apiBase && userId) {
    const remote = await loadSnapshotFromServer({ apiBase, userId, fetchImpl })
    if (remote) return remote
  }
  return loadPublishedSandboxSnapshot()
}

/**
 * 首页读取管理员审核通过的全局发布版本。
 * 这是新的正式来源；没有全局版本时退回本地发布数据/空快照。
 */
export async function loadGlobalPublishedSnapshot({ apiBase, fetchImpl = fetch } = {}) {
  if (apiBase) {
    try {
      const response = await fetchImpl(String(apiBase).replace(/\/+$/, '') + '/published-homepage', {
        headers: { Accept: 'application/json' },
        credentials: 'include',
      })
      if (response.ok) {
        const payload = await response.json().catch(() => ({}))
        const snapshot = payload?.snapshot
        if (snapshot && Array.isArray(snapshot.models)) return snapshot
      }
    } catch {
      // 后端不可用时走本地发布数据
    }
  }
  return loadPublishedSandboxSnapshot()
}
