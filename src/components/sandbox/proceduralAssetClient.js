// 程序化模型资产库 HTTP 客户端：所有请求带开发身份头，错误消息中文化。
// fetchImpl 可注入以便单测；生产路径缺省取 globalThis.fetch。
export const MAX_PROCEDURAL_SOURCE_LENGTH = 120000

const ROUTE = 'assets/procedural-assets'

export function createProceduralAssetClient({ baseUrl, devUserId, fetchImpl } = {}) {
  if (!baseUrl || typeof baseUrl !== 'string') {
    throw new TypeError('createProceduralAssetClient 需要 baseUrl')
  }
  if (!devUserId || typeof devUserId !== 'string') {
    throw new TypeError('createProceduralAssetClient 需要 devUserId')
  }
  const fetch = fetchImpl || globalThis.fetch
  if (typeof fetch !== 'function') {
    throw new TypeError('当前环境没有可用的 fetch 实现')
  }

  async function request(path, { method = 'GET', body, fallbackMessage } = {}) {
    let response
    try {
      response = await fetch(baseUrl.replace(/\/$/, '') + path, {
        method,
        headers: {
          'Content-Type': 'application/json',
          'X-Dev-User-Id': devUserId,
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      })
    } catch (error) {
      throw new Error(`${fallbackMessage}：网络请求失败（${error?.message || '未知错误'}）`)
    }
    if (response.ok) {
      return response.json()
    }
    let serverMessage = ''
    try {
      const payload = await response.json()
      serverMessage = typeof payload?.message === 'string' ? payload.message : ''
    } catch {
      // 非 JSON 错误响应时退回状态码消息
    }
    throw new Error(serverMessage || `${fallbackMessage}：HTTP ${response.status}`)
  }

  return {
    async saveAsset(input) {
      const sourceCode = input?.sourceCode
      if (typeof sourceCode !== 'string' || !sourceCode.trim()) {
        throw new RangeError('模型源码缺失或为空，无法存入资产库')
      }
      if (sourceCode.length > MAX_PROCEDURAL_SOURCE_LENGTH) {
        throw new RangeError('模型源码超过 120 KB，无法存入资产库')
      }
      return request(`/${ROUTE}`, { method: 'POST', body: input, fallbackMessage: '资产入库失败' })
    },
    listAssets() {
      return request(`/${ROUTE}`, { fallbackMessage: '资产库加载失败' })
    },
    getAsset(assetId) {
      return request(`/${ROUTE}/${encodeURIComponent(assetId)}`, { fallbackMessage: '资产读取失败' })
    },
    renameAsset(assetId, name) {
      return request(`/${ROUTE}/${encodeURIComponent(assetId)}`, {
        method: 'PUT',
        body: { name },
        fallbackMessage: '资产重命名失败',
      })
    },
    removeAsset(assetId) {
      return request(`/${ROUTE}/${encodeURIComponent(assetId)}`, {
        method: 'DELETE',
        fallbackMessage: '资产删除失败',
      })
    },
  }
}
