import { computed, reactive } from 'vue'

const API_BASE = import.meta.env.VITE_API_BASE_URL || 'http://localhost:3001/api/v1'

export const authState = reactive({
  user: null,
  loading: true,
  error: '',
})

export const currentUser = computed(() => authState.user)
export const isAdmin = computed(() => authState.user?.role === 'admin')
export const isAuthenticated = computed(() => Boolean(authState.user))

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
    if (response.status === 401) authState.user = null
    const detail = Array.isArray(payload?.message) ? payload.message.join('；') : payload?.message
    throw new Error(detail || '请求失败：HTTP ' + response.status)
  }
  return payload
}

export async function loadCurrentUser() {
  authState.loading = true
  try {
    const payload = await request('/auth/me')
    authState.user = payload?.user || null
    authState.error = ''
  } catch {
    authState.user = null
  } finally {
    authState.loading = false
  }
  return authState.user
}

export async function login(username, password) {
  const payload = await request('/auth/login', {
    method: 'POST',
    body: JSON.stringify({ username, password }),
  })
  authState.user = payload?.user || null
  authState.error = ''
  return authState.user
}

export async function logout() {
  try {
    await request('/auth/logout', { method: 'POST' })
  } catch {
    // 即使网络失败也清空本地状态
  }
  authState.user = null
}

export async function changePassword(currentPassword, newPassword) {
  await request('/auth/change-password', {
    method: 'POST',
    body: JSON.stringify({ currentPassword, newPassword }),
  })
  if (authState.user) authState.user = { ...authState.user, mustChangePassword: false }
}

export async function submitJoinApplication(payload) {
  return request('/auth/join-applications', {
    method: 'POST',
    body: JSON.stringify(payload),
  })
}

export async function adminListApplications(status = 'pending') {
  return request('/admin/join-applications?status=' + encodeURIComponent(status))
}

export async function adminApproveApplication(id, payload = {}) {
  return request('/admin/join-applications/' + encodeURIComponent(id) + '/approve', {
    method: 'POST',
    body: JSON.stringify(payload),
  })
}

export async function adminRejectApplication(id, note = '') {
  return request('/admin/join-applications/' + encodeURIComponent(id) + '/reject', {
    method: 'POST',
    body: JSON.stringify({ note }),
  })
}

export async function adminListUsers() {
  return request('/admin/users')
}

export async function adminUpdateUser(id, payload) {
  return request('/admin/users/' + encodeURIComponent(id), {
    method: 'PATCH',
    body: JSON.stringify(payload),
  })
}

export async function adminResetPassword(id) {
  return request('/admin/users/' + encodeURIComponent(id) + '/reset-password', {
    method: 'POST',
    body: JSON.stringify({}),
  })
}

export function loginRedirectTarget() {
  return safeInternalNext() || '/'
}

function safeInternalNext() {
  if (typeof location === 'undefined') return ''
  const next = new URLSearchParams(location.search).get('next')
  return next && next.startsWith('/') && !next.startsWith('//') ? next : ''
}

// 登录后的默认落地页：成员直接进沙盒编辑器，管理员直接进后台管理。
export function defaultLanding(user) {
  if (!user) return '/login'
  if (user.mustChangePassword) return '/change-password'
  const next = safeInternalNext()
  if (user.role === 'admin') return next.startsWith('/admin') ? next : '/admin'
  return next || '/world-sandbox-mvp'
}

export function goToLogin(next = typeof location !== 'undefined' ? location.pathname + location.search : '/') {
  if (typeof location === 'undefined') return
  window.location.assign('/login?next=' + encodeURIComponent(next))
}
