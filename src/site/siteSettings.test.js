import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  DEFAULT_SITE_SETTINGS,
  SITE_SETTINGS_STORAGE_KEY,
  dataUrlByteLength,
  isValidLogoDataUrl,
  loadSiteSettings,
  normalizeSiteSettings,
  resetSiteSettings,
  resolveDocumentTitle,
  saveSiteSettings,
  siteSettings,
  validateSiteSettings,
} from './siteSettings.js'

function installLocalStorage(initial = {}) {
  const store = new Map(Object.entries(initial))
  vi.stubGlobal('localStorage', {
    getItem: key => (store.has(key) ? store.get(key) : null),
    setItem: (key, value) => { store.set(key, String(value)) },
    removeItem: key => { store.delete(key) },
  })
  return store
}

const API = 'http://api.local/api/v1'
const LOGO = 'data:image/png;base64,' + Buffer.from('logo').toString('base64')

beforeEach(() => {
  vi.unstubAllGlobals()
  Object.assign(siteSettings, DEFAULT_SITE_SETTINGS)
})

describe('站点品牌配置', () => {
  it('规范化文本、颜色与 logo', () => {
    const settings = normalizeSiteSettings({
      brandName: '  测试大学  ',
      homepageTitle: '测试大学 · 三维校园',
      themeColor: '#ABCDEF',
      logoDataUrl: LOGO,
      unknown: 'ignored',
    })
    expect(settings.brandName).toBe('测试大学')
    expect(settings.themeColor).toBe('#abcdef')
    expect(settings.logoDataUrl).toBe(LOGO)
    expect(settings).not.toHaveProperty('unknown')
  })

  it('非法颜色、超大 logo 回退到默认值', () => {
    const settings = normalizeSiteSettings({
      themeColor: 'red',
      logoDataUrl: 'data:image/png;base64,' + Buffer.alloc(513 * 1024).toString('base64'),
    })
    expect(settings.themeColor).toBe(DEFAULT_SITE_SETTINGS.themeColor)
    expect(settings.logoDataUrl).toBeNull()
    expect(dataUrlByteLength(LOGO)).toBeGreaterThan(0)
    expect(isValidLogoDataUrl(LOGO)).toBe(true)
  })

  it('校验必填项与颜色', () => {
    const errors = validateSiteSettings({ brandName: '', homepageTitle: '', sandboxTitle: '', themeColor: 'oops' })
    expect(errors.brandName).toBeTruthy()
    expect(errors.homepageTitle).toBeTruthy()
    expect(errors.sandboxTitle).toBeTruthy()
    expect(errors.themeColor).toBeTruthy()
    expect(validateSiteSettings({ ...DEFAULT_SITE_SETTINGS })).toEqual({})
  })

  it('按路由解析文档标题', () => {
    expect(resolveDocumentTitle(DEFAULT_SITE_SETTINGS, '/')).toBe(DEFAULT_SITE_SETTINGS.homepageTitle)
    expect(resolveDocumentTitle(DEFAULT_SITE_SETTINGS, '/world-sandbox-mvp')).toBe(DEFAULT_SITE_SETTINGS.sandboxTitle)
    expect(resolveDocumentTitle(DEFAULT_SITE_SETTINGS, '/unknown-route')).toBe(DEFAULT_SITE_SETTINGS.homepageTitle)
  })

  it('优先读取后端，后端不可用时使用本地缓存', async () => {
    installLocalStorage()
    const remote = { ...DEFAULT_SITE_SETTINGS, brandName: '远程大学' }
    const fetchImpl = vi.fn(async () => ({ ok: true, json: async () => ({ settings: remote }) }))
    const loaded = await loadSiteSettings({ apiBase: API, fetchImpl })
    expect(loaded.brandName).toBe('远程大学')
    expect(siteSettings.brandName).toBe('远程大学')

    Object.assign(siteSettings, DEFAULT_SITE_SETTINGS)
    const fallback = await loadSiteSettings({ apiBase: API, fetchImpl: vi.fn(async () => { throw new Error('offline') }) })
    expect(fallback.brandName).toBe('远程大学')
  })

  it('后端网络失败时保存到本地并给出提示', async () => {
    installLocalStorage()
    const fetchImpl = vi.fn(async () => { throw new Error('offline') })
    const result = await saveSiteSettings({ ...DEFAULT_SITE_SETTINGS, brandName: '离线大学' }, {
      apiBase: API,
      userId: 'user-a',
      fetchImpl,
    })
    expect(result.remote).toBe(false)
    expect(result.warning).toContain('本地')
    expect(siteSettings.brandName).toBe('离线大学')
    expect(JSON.parse(localStorage.getItem(SITE_SETTINGS_STORAGE_KEY)).brandName).toBe('离线大学')
  })

  it('后端校验失败时直接报错，不静默保存', async () => {
    const fetchImpl = vi.fn(async () => ({
      ok: false,
      status: 400,
      json: async () => ({ message: 'themeColor 必须是 #RRGGBB 格式' }),
    }))
    await expect(saveSiteSettings({ ...DEFAULT_SITE_SETTINGS, brandName: '坏配置' }, {
      apiBase: API,
      userId: 'user-a',
      fetchImpl,
    })).rejects.toThrow('themeColor')
    expect(siteSettings.brandName).toBe(DEFAULT_SITE_SETTINGS.brandName)
  })

  it('重置恢复默认值并清除本地缓存', async () => {
    installLocalStorage({ [SITE_SETTINGS_STORAGE_KEY]: JSON.stringify({ ...DEFAULT_SITE_SETTINGS, brandName: '旧配置' }) })
    Object.assign(siteSettings, { brandName: '旧配置' })
    const fetchImpl = vi.fn(async () => ({ ok: true, json: async () => ({ ok: true }) }))
    const result = await resetSiteSettings({ apiBase: API, userId: 'user-a', fetchImpl })
    expect(result.remote).toBe(true)
    expect(siteSettings.brandName).toBe(DEFAULT_SITE_SETTINGS.brandName)
    expect(localStorage.getItem(SITE_SETTINGS_STORAGE_KEY)).toBeNull()
  })
})
