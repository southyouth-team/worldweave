const API_BASE = import.meta.env.VITE_API_BASE_URL || 'http://localhost:3001/api/v1'

async function request(path, options = {}) {
  const headers = {
    ...(options.body ? { 'Content-Type': 'application/json' } : {}),
    ...(options.headers || {}),
  }
  const response = await fetch(API_BASE + path, {
    credentials: 'include',
    ...options,
    headers,
  })
  const payload = await response.json().catch(() => ({}))
  if (!response.ok) {
    const detail = Array.isArray(payload?.message) ? payload.message.join('；') : payload?.message
    throw new Error(detail || '请求失败：HTTP ' + response.status)
  }
  return payload
}

export async function submitPublishRequest({ snapshot, note = '', thumbnailDataUrl = null }) {
  return request('/publish-requests', {
    method: 'POST',
    body: JSON.stringify({ snapshot, note, thumbnailDataUrl }),
  })
}

export async function listMyPublishRequests() {
  return request('/publish-requests/mine')
}

export async function adminListPublishRequests(status = 'pending') {
  return request('/admin/publish-requests?status=' + encodeURIComponent(status))
}

export async function adminFetchPublishSnapshot(id) {
  return request('/admin/publish-requests/' + encodeURIComponent(id) + '/snapshot')
}

export async function adminApprovePublishRequest(id) {
  return request('/admin/publish-requests/' + encodeURIComponent(id) + '/approve', {
    method: 'POST',
    body: JSON.stringify({}),
  })
}

export async function adminRejectPublishRequest(id, note = '') {
  return request('/admin/publish-requests/' + encodeURIComponent(id) + '/reject', {
    method: 'POST',
    body: JSON.stringify({ note }),
  })
}

export async function fetchPublishedHomepage() {
  return request('/published-homepage')
}
