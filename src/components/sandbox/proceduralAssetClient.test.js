import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  MAX_PROCEDURAL_SOURCE_LENGTH,
  createProceduralAssetClient,
} from './proceduralAssetClient.js'

const BASE_URL = 'http://localhost:3001/api/v1'

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

function createClient(fetchMock) {
  return createProceduralAssetClient({
    baseUrl: BASE_URL,
    devUserId: 'u1',
    fetchImpl: fetchMock,
  })
}

const validInput = () => ({
  name: '我的模型',
  category: 'sandbox-model',
  objectType: '独立 3D 模型',
  sourceCode: 'export function createModel() {}',
  manifest: { version: 1, capabilities: {} },
  parameters: [],
  parts: [],
  environmentBindings: [],
})

describe('createProceduralAssetClient 请求契约', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('listAssets 发 GET 到资产库路径并携带开发身份头，返回值直通 JSON', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse([{ assetId: 'a1' }]))
    const client = createClient(fetchMock)

    const result = await client.listAssets()

    expect(result).toEqual([{ assetId: 'a1' }])
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, options] = fetchMock.mock.calls[0]
    expect(url).toBe(`${BASE_URL}/assets/procedural-assets`)
    expect(options.method).toBe('GET')
    expect(options.headers['X-Dev-User-Id']).toBe('u1')
    expect(options.headers['Content-Type']).toBe('application/json')
  })

  it('saveAsset 发 POST，请求体与入参一致', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ assetId: 'a1' }))
    const client = createClient(fetchMock)
    const input = validInput()

    await client.saveAsset(input)

    const [url, options] = fetchMock.mock.calls[0]
    expect(url).toBe(`${BASE_URL}/assets/procedural-assets`)
    expect(options.method).toBe('POST')
    expect(JSON.parse(options.body)).toEqual(input)
  })

  it('getAsset/renameAsset/removeAsset 分别发 GET :id、PUT :id、DELETE :id', async () => {
    // 每次调用返回全新 Response，Body 只能消费一次
    const fetchMock = vi.fn().mockImplementation(async () => jsonResponse({ ok: true }))
    const client = createClient(fetchMock)

    await client.getAsset('id-1')
    await client.renameAsset('id-1', '新名字')
    await client.removeAsset('id-1')

    expect(fetchMock.mock.calls.map(call => [call[0], call[1].method])).toEqual([
      [`${BASE_URL}/assets/procedural-assets/id-1`, 'GET'],
      [`${BASE_URL}/assets/procedural-assets/id-1`, 'PUT'],
      [`${BASE_URL}/assets/procedural-assets/id-1`, 'DELETE'],
    ])
    expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toEqual({ name: '新名字' })
  })

  it('未注入 fetchImpl 时回退使用 globalThis.fetch', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse([]))
    vi.stubGlobal('fetch', fetchMock)
    const client = createProceduralAssetClient({ baseUrl: BASE_URL, devUserId: 'u1' })

    await client.listAssets()

    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('非 2xx 响应优先透传服务端 message，缺失时抛带 HTTP 状态码的中文错误', async () => {
    const withMessage = vi.fn().mockResolvedValue(jsonResponse({ message: '服务器炸了' }, 500))
    await expect(createClient(withMessage).listAssets()).rejects.toThrow('服务器炸了')

    const noMessage = vi.fn().mockResolvedValue(jsonResponse({}, 404))
    await expect(createClient(noMessage).getAsset('missing')).rejects.toThrow(/HTTP 404/)
  })

  it('源码超过 120KB 或为空时前置拒绝且不发起请求', async () => {
    const fetchMock = vi.fn()
    const client = createClient(fetchMock)

    expect(MAX_PROCEDURAL_SOURCE_LENGTH).toBe(120000)
    const oversizedError = await client
      .saveAsset({ ...validInput(), sourceCode: 'a'.repeat(120001) })
      .catch(error => error)
    expect(oversizedError).toBeInstanceOf(RangeError)
    expect(oversizedError.message).toContain('120 KB')
    await expect(client.saveAsset({ ...validInput(), sourceCode: '' })).rejects.toThrow('为空')
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
