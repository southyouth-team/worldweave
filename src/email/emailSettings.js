const DEFAULT_API_BASE = import.meta.env?.VITE_API_BASE_URL || 'http://localhost:3001/api/v1'

export function normalizeEmailSettingsForm(payload = {}) {
  const source = payload.settings || payload.emailSettings || payload
  return {
    enabled: Boolean(source.enabled),
    host: String(source.host || '').trim(),
    port: Number(source.port) || 587,
    secure: Boolean(source.secure),
    username: String(source.username || '').trim(),
    password: String(payload.password || ''),
    clearPassword: false,
    fromName: String(source.fromName || 'Worldweave').trim() || 'Worldweave',
    fromEmail: String(source.fromEmail || '').trim().toLowerCase(),
    adminRecipients: String(source.adminRecipients || '').trim(),
    notifyJoinApplication: source.notifyJoinApplication !== false,
    notifyPublishRequest: source.notifyPublishRequest !== false,
    notifyReviewResult: source.notifyReviewResult !== false,
    passwordConfigured: Boolean(source.passwordConfigured || payload.passwordConfigured),
    updatedAt: payload.updatedAt || null,
  }
}

export function createEmailSettingsClient({
  baseUrl = DEFAULT_API_BASE,
  fetchImpl = typeof fetch !== 'undefined' ? fetch : null,
} = {}) {
  const root = String(baseUrl || '').replace(/\/+$/, '')

  async function request(path, options = {}) {
    if (typeof fetchImpl !== 'function') throw new Error('当前环境不支持网络请求')
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
      throw new Error(detail || '请求失败：HTTP ' + response.status)
    }
    return payload
  }

  return {
    load: () => request('/admin/email-settings'),
    save: settings => request('/admin/email-settings', {
      method: 'PUT',
      body: JSON.stringify(settings),
    }),
    test: recipient => request('/admin/email-settings/test', {
      method: 'POST',
      body: JSON.stringify({ recipient: recipient || '' }),
    }),
    log: () => request('/admin/email-settings/log'),
  }
}

export const emailSettingsClient = createEmailSettingsClient()
