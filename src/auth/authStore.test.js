import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const fetchMock = vi.fn()
vi.stubGlobal('fetch', fetchMock)

const store = await import('./authStore.js')
function jsonResponse(body, status = 200) {
  return {
    status,
    ok: status >= 200 && status < 300,
    json: async () => body,
  }
}

describe('authStore', () => {
  beforeEach(() => {
    fetchMock.mockReset()
    store.authState.user = null
    store.authState.error = ''
    store.authState.loading = true
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.stubGlobal('fetch', fetchMock)
  })

  it('登录成功后写入当前用户并带 Cookie 凭证', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ user: { username: 'admin', role: 'admin', mustChangePassword: true } }))
    const user = await store.login('admin', 'secret')
    expect(user.role).toBe('admin')
    expect(store.isAdmin.value).toBe(true)
    expect(store.isAuthenticated.value).toBe(true)
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining('/auth/login'),
      expect.objectContaining({ method: 'POST', credentials: 'include' }),
    )
  })

  it('401 时清空当前用户并抛出错误信息', async () => {
    store.authState.user = { username: 'member', role: 'member' }
    fetchMock.mockResolvedValueOnce(jsonResponse({ message: '用户名或密码不正确' }, 401))
    await expect(store.login('member', 'wrong')).rejects.toThrow('用户名或密码不正确')
    expect(store.isAuthenticated.value).toBe(false)
  })

  it('读取当前用户、登出和管理员接口封装正常', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ user: { username: 'm1', role: 'member' } }))
    const loaded = await store.loadCurrentUser()
    expect(loaded.username).toBe('m1')
    expect(store.isAdmin.value).toBe(false)

    fetchMock.mockResolvedValueOnce(jsonResponse({ ok: true }))
    await store.logout()
    expect(store.isAuthenticated.value).toBe(false)
    expect(fetchMock).toHaveBeenLastCalledWith(
      expect.stringContaining('/auth/logout'),
      expect.objectContaining({ method: 'POST', credentials: 'include' }),
    )

    fetchMock.mockResolvedValueOnce(jsonResponse([{ id: 'a1' }]))
    const users = await store.adminListUsers()
    expect(users).toEqual([{ id: 'a1' }])
    expect(fetchMock).toHaveBeenLastCalledWith(expect.stringContaining('/admin/users'), expect.anything())
  })

  it('加入申请提交到公开接口', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ ok: true, application: { id: 'j1' } }, 201))
    const result = await store.submitJoinApplication({
      name: '张三',
      contact: 'zhangsan@example.com',
      desiredUsername: 'zhangsan',
      reason: '编辑东区',
    })
    expect(result.ok).toBe(true)
    const [, options] = fetchMock.mock.calls[0]
    expect(options.method).toBe('POST')
    expect(JSON.parse(options.body)).toMatchObject({ desiredUsername: 'zhangsan' })
  })

  it('驳回、通过、改角色、重置密码走对应管理员接口', async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ ok: true }))
      .mockResolvedValueOnce(jsonResponse({ ok: true, user: { username: 'z' }, temporaryPassword: 'Tmp12345' }))
      .mockResolvedValueOnce(jsonResponse({ role: 'admin' }))
      .mockResolvedValueOnce(jsonResponse({ temporaryPassword: 'New12345' }))
    await store.adminRejectApplication('j1', '资料不完整')
    await store.adminApproveApplication('j2')
    await store.adminUpdateUser('u1', { role: 'admin' })
    await store.adminResetPassword('u1')
    const paths = fetchMock.mock.calls.map(call => call[0])
    expect(paths[0]).toContain('/join-applications/j1/reject')
    expect(paths[1]).toContain('/join-applications/j2/approve')
    expect(paths[2]).toContain('/admin/users/u1')
    expect(paths[3]).toContain('/admin/users/u1/reset-password')
  })

  it('登录后跳转地址只接受站内路径', () => {
    const originalLocation = globalThis.location
    try {
      globalThis.location = { pathname: '/login', search: '' }
      expect(store.loginRedirectTarget()).toBe('/')
      globalThis.location = { pathname: '/login', search: '?next=/world-sandbox-mvp' }
      expect(store.loginRedirectTarget()).toBe('/world-sandbox-mvp')
      globalThis.location = { pathname: '/login', search: '?next=https://evil.example.com' }
      expect(store.loginRedirectTarget()).toBe('/')
      globalThis.location = { pathname: '/login', search: '?next=//evil.example.com' }
      expect(store.loginRedirectTarget()).toBe('/')
    } finally {
      globalThis.location = originalLocation
    }
  })

  it('默认落地页按角色区分：成员进编辑器，管理员进后台，待改密先进改密页', () => {
    const originalLocation = globalThis.location
    try {
      globalThis.location = { pathname: '/login', search: '' }
      expect(store.defaultLanding(null)).toBe('/login')
      expect(store.defaultLanding({ role: 'admin', mustChangePassword: true })).toBe('/change-password')
      expect(store.defaultLanding({ role: 'admin', mustChangePassword: false })).toBe('/admin')
      expect(store.defaultLanding({ role: 'member', mustChangePassword: true })).toBe('/change-password')
      expect(store.defaultLanding({ role: 'member', mustChangePassword: false })).toBe('/world-sandbox-mvp')
      globalThis.location = { pathname: '/login', search: '?next=/world-sandbox-mvp' }
      // 管理员始终进后台；成员支持安全的站内回跳
      expect(store.defaultLanding({ role: 'admin', mustChangePassword: false })).toBe('/admin')
      expect(store.defaultLanding({ role: 'member', mustChangePassword: false })).toBe('/world-sandbox-mvp')
      globalThis.location = { pathname: '/login', search: '?next=/admin?view=settings' }
      expect(store.defaultLanding({ role: 'admin', mustChangePassword: false })).toBe('/admin?view=settings')
      globalThis.location = { pathname: '/login', search: '?next=https://evil.example.com' }
      expect(store.defaultLanding({ role: 'member', mustChangePassword: false })).toBe('/world-sandbox-mvp')
    } finally {
      globalThis.location = originalLocation
    }
  })
})
