import { describe, expect, it, vi } from 'vitest'
import {
  createEmailSettingsClient,
  normalizeEmailSettingsForm,
} from './emailSettings.js'

const BASE = 'http://api.local/api/v1'
const json = (body, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { 'content-type': 'application/json' },
})

describe('邮件通知设置客户端', () => {
  it('读取、保存、测试和日志都走管理员邮件配置路径', async () => {
    const fetchImpl = vi.fn(async () => json({ ok: true }))
    const client = createEmailSettingsClient({ baseUrl: BASE, fetchImpl })
    const payload = {
      enabled: true,
      host: 'smtp.example.com',
      port: 587,
      secure: false,
      username: 'mailer',
      password: '',
      fromName: 'Worldweave',
      fromEmail: 'noreply@example.com',
      adminRecipients: 'admin@example.com',
      notifyJoinApplication: true,
      notifyPublishRequest: true,
      notifyReviewResult: true,
    }

    await client.load()
    await client.save(payload)
    await client.test('me@example.com')
    await client.log()

    expect(fetchImpl.mock.calls.map(([url]) => url)).toEqual([
      `${BASE}/admin/email-settings`,
      `${BASE}/admin/email-settings`,
      `${BASE}/admin/email-settings/test`,
      `${BASE}/admin/email-settings/log`,
    ])
    expect(fetchImpl.mock.calls[0][1]).toMatchObject({ method: 'GET', credentials: 'include' })
    expect(fetchImpl.mock.calls[1][1]).toMatchObject({ method: 'PUT', credentials: 'include' })
    expect(JSON.parse(fetchImpl.mock.calls[1][1].body)).toEqual(payload)
    expect(JSON.parse(fetchImpl.mock.calls[2][1].body)).toEqual({ recipient: 'me@example.com' })
  })

  it('保存失败时透传服务端 message', async () => {
    const fetchImpl = vi.fn(async () => json({ message: 'SMTP 主机不能为空' }, 400))
    const client = createEmailSettingsClient({ baseUrl: BASE, fetchImpl })

    await expect(client.save({ enabled: true })).rejects.toThrow('SMTP 主机不能为空')
  })

  it('表单归一化会拆分收件人并保留密码占位状态', () => {
    expect(normalizeEmailSettingsForm({
      emailSettings: {
        enabled: true,
        host: ' smtp.example.com ',
        port: '465',
        secure: true,
        fromName: ' 织界 ',
        fromEmail: 'NOREPLY@example.com ',
        adminRecipients: 'a@example.com; b@example.com',
      },
      password: '',
      passwordConfigured: true,
    })).toMatchObject({
      enabled: true,
      host: 'smtp.example.com',
      port: 465,
      secure: true,
      fromName: '织界',
      fromEmail: 'noreply@example.com',
      adminRecipients: 'a@example.com; b@example.com',
      password: '',
      passwordConfigured: true,
    })
  })
})
