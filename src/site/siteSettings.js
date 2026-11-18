import { reactive } from 'vue'

// 站点品牌配置：全局一份，后端持久化；前端缓存一份用于后端不可用时继续显示。
// 这里只处理展示数据，不执行 logo 或配置里的任何代码。
export const SITE_SETTINGS_STORAGE_KEY = 'worldweave-site-settings:v1'
export const MAX_LOGO_BYTES = 512 * 1024

export const DEFAULT_SITE_SETTINGS = Object.freeze({
  brandName: 'Worldweave',
  brandSubtitle: '织界 · 源码公开的 AI 世界构建器',
  sandboxBrandName: 'Worldweave',
  sandboxBrandSubtitle: '织界 · AI 三维世界构建与协作',
  homepageTitle: 'Worldweave · 织界',
  sandboxTitle: 'Worldweave · 世界编辑器',
  settingsTitle: '站点设置',
  description: 'Worldweave（织界）是源码公开的 AI 世界构建器：等距地块编辑、AI 模型生成、发布审核与团队协作。',
  keywords: 'Worldweave,织界,AI 世界构建器,三维世界沙盒,等距世界,AI 建模',
  author: 'Worldweave contributors',
  ogTitle: 'Worldweave · 织界',
  ogDescription: '源码公开的 AI 世界构建器：等距地块编辑、AI 模型生成、发布审核与团队协作。',
  themeColor: '#e8f0ea',
  logoDataUrl: null,
})

export const SITE_SETTING_TEXT_LIMITS = Object.freeze({
  brandName: 60,
  brandSubtitle: 120,
  sandboxBrandName: 60,
  sandboxBrandSubtitle: 120,
  homepageTitle: 120,
  sandboxTitle: 120,
  settingsTitle: 60,
  description: 500,
  keywords: 300,
  author: 120,
  ogTitle: 120,
  ogDescription: 500,
})

const TEXT_FIELDS = Object.keys(SITE_SETTING_TEXT_LIMITS)
const REQUIRED_FIELDS = ['brandName', 'homepageTitle', 'sandboxTitle']
const LOGO_PATTERN = /^data:image\/(svg\+xml|png|jpeg|webp);base64,/i
const HEX_COLOR_PATTERN = /^#[0-9a-fA-F]{6}$/

export const siteSettings = reactive({ ...DEFAULT_SITE_SETTINGS })

export function dataUrlByteLength(dataUrl) {
  if (typeof dataUrl !== 'string') return 0
  const base64 = dataUrl.slice(dataUrl.indexOf(',') + 1).replace(/\s+/g, '')
  if (!base64) return 0
  if (typeof Buffer !== 'undefined') return Buffer.from(base64, 'base64').length
  try {
    return atob(base64).length
  } catch {
    return Math.floor(base64.length * 0.75)
  }
}

export function isValidLogoDataUrl(value) {
  if (typeof value !== 'string' || !LOGO_PATTERN.test(value)) return false
  return dataUrlByteLength(value) <= MAX_LOGO_BYTES
}

export function normalizeSiteSettings(input = {}) {
  const result = { ...DEFAULT_SITE_SETTINGS }
  if (!input || typeof input !== 'object' || Array.isArray(input)) return result
  for (const field of TEXT_FIELDS) {
    const value = input[field]
    if (typeof value !== 'string') continue
    result[field] = value.trim().slice(0, SITE_SETTING_TEXT_LIMITS[field])
  }
  if (typeof input.themeColor === 'string' && HEX_COLOR_PATTERN.test(input.themeColor)) {
    result.themeColor = input.themeColor.toLowerCase()
  }
  if (input.logoDataUrl === null || input.logoDataUrl === '') {
    result.logoDataUrl = null
  } else if (isValidLogoDataUrl(input.logoDataUrl)) {
    result.logoDataUrl = input.logoDataUrl
  }
  return result
}

export function validateSiteSettings(input) {
  const errors = {}
  for (const field of REQUIRED_FIELDS) {
    if (!String(input?.[field] || '').trim()) errors[field] = '不能为空'
  }
  if (!HEX_COLOR_PATTERN.test(String(input?.themeColor || ''))) {
    errors.themeColor = '需要 #RRGGBB 格式'
  }
  if (input?.logoDataUrl && !isValidLogoDataUrl(input.logoDataUrl)) {
    errors.logoDataUrl = 'logo 必须是 512 KB 以内的 SVG/PNG/JPEG/WebP'
  }
  return errors
}

export function resolveDocumentTitle(settings = siteSettings, pathname = typeof location !== 'undefined' ? location.pathname : '/') {
  const path = String(pathname || '/').replace(/\/+$/, '') || '/'
  if (path === '/world-sandbox-mvp' || path === '/sandbox') return settings.sandboxTitle || settings.brandName
  return settings.homepageTitle || settings.brandName
}

export function applyDocumentBranding(pathname) {
  if (typeof document === 'undefined') return
  document.title = resolveDocumentTitle(siteSettings, pathname)
  setNamedMeta('description', siteSettings.description)
  setNamedMeta('keywords', siteSettings.keywords)
  setNamedMeta('author', siteSettings.author)
  setNamedMeta('theme-color', siteSettings.themeColor)
  setPropertyMeta('og:title', siteSettings.ogTitle || siteSettings.homepageTitle)
  setPropertyMeta('og:description', siteSettings.ogDescription || siteSettings.description)
  let icon = document.head.querySelector('link[rel="icon"]')
  if (!icon) {
    icon = document.createElement('link')
    icon.setAttribute('rel', 'icon')
    icon.setAttribute('type', 'image/svg+xml')
    document.head.appendChild(icon)
  }
  icon.setAttribute('href', siteSettings.logoDataUrl || '/brand-logo.png')
}

function setNamedMeta(name, content) {
  if (!content) return
  let element = document.head.querySelector('meta[name="' + name + '"]')
  if (!element) {
    element = document.createElement('meta')
    element.setAttribute('name', name)
    document.head.appendChild(element)
  }
  element.setAttribute('content', content)
}

function setPropertyMeta(property, content) {
  if (!content) return
  let element = document.head.querySelector('meta[property="' + property + '"]')
  if (!element) {
    element = document.createElement('meta')
    element.setAttribute('property', property)
    document.head.appendChild(element)
  }
  element.setAttribute('content', content)
}

function readLocalCache() {
  try {
    if (typeof localStorage === 'undefined') return null
    const raw = localStorage.getItem(SITE_SETTINGS_STORAGE_KEY)
    if (!raw) return null
    return normalizeSiteSettings(JSON.parse(raw))
  } catch {
    return null
  }
}

function writeLocalCache(settings) {
  try {
    if (typeof localStorage === 'undefined') return
    localStorage.setItem(SITE_SETTINGS_STORAGE_KEY, JSON.stringify(settings))
  } catch {
    // 忽略存储空间不足或被禁用的浏览器
  }
}

export async function loadSiteSettings({ apiBase = '', fetchImpl = typeof fetch !== 'undefined' ? fetch : null } = {}) {
  let settings = null
  if (apiBase && typeof fetchImpl === 'function') {
    try {
      const response = await fetchImpl(String(apiBase).replace(/\/+$/, '') + '/site-settings', {
        headers: { Accept: 'application/json' },
        credentials: 'include',
      })
      if (response?.ok) {
        const payload = await response.json().catch(() => ({}))
        settings = normalizeSiteSettings(payload?.settings || payload)
      }
    } catch {
      // 后端不可用时走本地缓存
    }
  }
  if (!settings) settings = readLocalCache()
  if (!settings) settings = { ...DEFAULT_SITE_SETTINGS }
  Object.assign(siteSettings, settings)
  if (!readLocalCache()) writeLocalCache(siteSettings)
  applyDocumentBranding()
  return { ...siteSettings }
}

export async function saveSiteSettings(input, { apiBase = '', userId = '', fetchImpl = typeof fetch !== 'undefined' ? fetch : null } = {}) {
  const errors = validateSiteSettings(input)
  const firstError = Object.values(errors)[0]
  if (firstError) throw new Error(firstError)
  const normalized = normalizeSiteSettings(input)
  let warning = ''
  let remote = false
  let response = null
  if (apiBase && typeof fetchImpl === 'function') {
    try {
      response = await fetchImpl(String(apiBase).replace(/\/+$/, '') + '/site-settings', {
        method: 'PUT',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
          ...(userId ? { 'X-Dev-User-Id': userId } : {}),
        },
        body: JSON.stringify({ settings: normalized }),
      })
    } catch (error) {
      // 网络错误回退到本地缓存；HTTP 校验错误在下面直接抛出。
      warning = '后端暂不可用，已保存到本地：' + (error?.message || '网络异常')
    }
  }
  if (response) {
    if (!response.ok) {
      const payload = await response.json().catch(() => ({}))
      throw new Error(payload?.message || ('保存失败：HTTP ' + (response.status || '未知')))
    }
    const payload = await response.json().catch(() => ({}))
    if (payload?.settings) Object.assign(normalized, normalizeSiteSettings(payload.settings))
    remote = true
  }
  writeLocalCache(normalized)
  Object.assign(siteSettings, normalized)
  applyDocumentBranding()
  return { settings: { ...siteSettings }, remote, warning }
}

export async function resetSiteSettings({ apiBase = '', userId = '', fetchImpl = typeof fetch !== 'undefined' ? fetch : null } = {}) {
  let warning = ''
  let remote = false
  let response = null
  if (apiBase && typeof fetchImpl === 'function') {
    try {
      response = await fetchImpl(String(apiBase).replace(/\/+$/, '') + '/site-settings', {
        method: 'DELETE',
        credentials: 'include',
        headers: userId ? { 'X-Dev-User-Id': userId } : {},
      })
    } catch (error) {
      warning = '后端暂不可用，已重置本地缓存：' + (error?.message || '网络异常')
    }
  }
  if (response) {
    if (!response.ok) {
      const payload = await response.json().catch(() => ({}))
      throw new Error(payload?.message || ('重置失败：HTTP ' + (response.status || '未知')))
    }
    remote = true
  }
  try {
    if (typeof localStorage !== 'undefined') localStorage.removeItem(SITE_SETTINGS_STORAGE_KEY)
  } catch {
    // ignore
  }
  Object.assign(siteSettings, DEFAULT_SITE_SETTINGS)
  applyDocumentBranding()
  return { settings: { ...siteSettings }, remote, warning }
}
