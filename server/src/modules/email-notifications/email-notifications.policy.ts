const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MAX_EMAIL_LENGTH = 254;
const MAX_RECIPIENTS = 20;

export interface EmailSettings {
  enabled: boolean;
  host: string;
  port: number;
  secure: boolean;
  username: string;
  password: string;
  fromName: string;
  fromEmail: string;
  adminRecipients: string;
  notifyJoinApplication: boolean;
  notifyPublishRequest: boolean;
  notifyReviewResult: boolean;
}

export interface EmailMessage {
  subject: string;
  text: string;
  html: string;
}

export interface JoinApplicationData {
  name?: string;
  desiredUsername?: string;
  email?: string;
  contact?: string;
  reason?: string;
}

export interface PublishRequestData {
  requester?: string;
  note?: string;
  modelCount?: number;
  chunkCount?: number;
}

export function isValidEmail(value: unknown): boolean {
  if (typeof value !== 'string') return false;
  const email = value.trim();
  return email.length > 3 && email.length <= MAX_EMAIL_LENGTH && EMAIL_PATTERN.test(email);
}

export function parseEmailList(input: unknown, max = MAX_RECIPIENTS): string[] {
  if (input === undefined || input === null || input === '') return [];
  const raw = Array.isArray(input) ? input.join(',') : String(input);
  const entries = raw.split(/[,;\n]+/).map((item) => item.trim().toLowerCase()).filter(Boolean);
  if (entries.length > max) throw new Error('最多配置 ' + max + ' 个收件邮箱');
  const unique: string[] = [];
  const seen = new Set<string>();
  for (const email of entries) {
    if (!isValidEmail(email)) throw new Error('收件邮箱格式无效：' + email);
    if (seen.has(email)) continue;
    seen.add(email);
    unique.push(email);
  }
  return unique;
}

function bool(value: unknown, fallback: boolean): boolean {
  if (value === undefined || value === null) return fallback;
  if (typeof value === 'string') return !['false', '0', 'off', 'no'].includes(value.trim().toLowerCase());
  return Boolean(value);
}

export function normalizeEmailSettings(
  input: Partial<EmailSettings> & { clearPassword?: boolean },
  current: Partial<EmailSettings> = {},
): EmailSettings {
  const source = input || {};
  const result: EmailSettings = {
    enabled: bool(source.enabled, bool(current.enabled, false)),
    host: String(source.host ?? current.host ?? '').trim(),
    port: Number(source.port ?? current.port ?? 587),
    secure: bool(source.secure, bool(current.secure, false)),
    username: String(source.username ?? current.username ?? '').trim(),
    password: String(current.password ?? ''),
    fromName: String(source.fromName ?? current.fromName ?? 'Worldweave').trim() || 'Worldweave',
    fromEmail: String(source.fromEmail ?? current.fromEmail ?? '').trim().toLowerCase(),
    adminRecipients: source.adminRecipients !== undefined
      ? parseEmailList(source.adminRecipients).join(', ')
      : String(current.adminRecipients ?? '').trim(),
    notifyJoinApplication: bool(source.notifyJoinApplication, bool(current.notifyJoinApplication, true)),
    notifyPublishRequest: bool(source.notifyPublishRequest, bool(current.notifyPublishRequest, true)),
    notifyReviewResult: bool(source.notifyReviewResult, bool(current.notifyReviewResult, true)),
  };
  if (source.clearPassword) result.password = '';
  else if (source.password !== undefined && String(source.password).trim() !== '') {
    result.password = String(source.password).trim();
  }
  if (!Number.isInteger(result.port) || result.port < 1 || result.port > 65535) {
    throw new Error('SMTP 端口需要在 1-65535 之间');
  }
  if (result.enabled && !result.host) throw new Error('启用邮件通知时必须填写 SMTP 主机');
  if (result.fromEmail && !isValidEmail(result.fromEmail)) throw new Error('发件邮箱格式无效');
  if (result.enabled && !result.fromEmail) throw new Error('启用邮件通知时必须填写发件邮箱');
  if (result.adminRecipients) result.adminRecipients = parseEmailList(result.adminRecipients).join(', ');
  return result;
}

export function escapeHtml(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function layout(title: string, bodyHtml: string): string {
  return '<!doctype html><html><body style="margin:0;padding:24px;background:#eef5f1;color:#0f2e26;font-family:-apple-system,BlinkMacSystemFont,\'Segoe UI\',sans-serif">'
    + '<div style="max-width:560px;margin:0 auto;padding:24px;border:1px solid #d7e6df;border-radius:16px;background:#ffffff">'
    + '<h1 style="margin:0 0 16px;font-size:20px">' + escapeHtml(title) + '</h1>'
    + bodyHtml
    + '<p style="margin:24px 0 0;color:#7e9586;font-size:12px">此邮件由 Worldweave（织界）自动发送，请勿直接回复。</p>'
    + '</div></body></html>';
}

export function buildJoinApplicationAdminEmail(input: {
  brandName?: string;
  application: JoinApplicationData;
}): EmailMessage {
  const brand = input.brandName || 'Worldweave';
  const app = input.application || {};
  const name = app.name || '未填写姓名';
  const username = app.desiredUsername || '未填写';
  const subject = '【' + brand + '】新的加入申请：' + name + '（@' + username + '）';
  const text = [
    '收到一条新的加入申请。',
    '',
    '姓名：' + name,
    '期望用户名：@' + username,
    '邮箱：' + (app.email || '未填写'),
    '联系方式：' + (app.contact || '未填写'),
    '申请说明：' + (app.reason || '未填写'),
    '',
    '请登录管理后台审核。',
  ].join('\n');
  const html = layout(subject, [
    '<p>收到一条新的加入申请。</p>',
    '<table style="width:100%;border-collapse:collapse;font-size:14px">',
    row('姓名', name),
    row('期望用户名', '@' + username),
    row('邮箱', app.email || '未填写'),
    row('联系方式', app.contact || '未填写'),
    row('申请说明', app.reason || '未填写'),
    '</table>',
    '<p style="margin-top:16px">请登录管理后台审核。</p>',
  ].join(''));
  return { subject, text, html };
}

export function buildJoinReviewEmail(input: {
  brandName?: string;
  application: JoinApplicationData;
  status: 'approved' | 'rejected';
  note?: string;
  temporaryPassword?: string;
  username?: string;
}): EmailMessage {
  const brand = input.brandName || 'Worldweave';
  const app = input.application || {};
  const name = app.name || app.desiredUsername || '你好';
  const approved = input.status === 'approved';
  const subject = '【' + brand + '】加入申请' + (approved ? '已通过' : '未通过');
  const lines = [
    name + '，你好：',
    '',
    approved ? '你的加入申请已通过，团队成员账号已经创建。' : '你的加入申请未通过。',
  ];
  if (approved) {
    lines.push('', '用户名：@' + (input.username || app.desiredUsername || ''), '临时密码：' + (input.temporaryPassword || ''), '', '首次登录后系统会要求修改密码。');
  }
  if (input.note) lines.push('', '审核说明：' + input.note);
  lines.push('', '—— ' + brand);
  const html = layout(subject, [
    '<p>' + escapeHtml(name) + '，你好：</p>',
    '<p>' + (approved ? '你的加入申请已通过，团队成员账号已经创建。' : '你的加入申请未通过。') + '</p>',
    approved
      ? '<p>用户名：<b>@' + escapeHtml(input.username || app.desiredUsername || '') + '</b><br>临时密码：<b>' + escapeHtml(input.temporaryPassword || '') + '</b></p><p>首次登录后系统会要求修改密码。</p>'
      : '',
    input.note ? '<p>审核说明：' + escapeHtml(input.note) + '</p>' : '',
  ].join(''));
  return { subject, text: lines.join('\n'), html };
}

export function buildPublishRequestAdminEmail(input: {
  brandName?: string;
  requester?: string;
  note?: string;
  modelCount?: number;
  chunkCount?: number;
}): EmailMessage {
  const brand = input.brandName || 'Worldweave';
  const requester = input.requester || '成员';
  const subject = '【' + brand + '】新的发布申请：' + requester;
  const text = [
    requester + ' 提交了一条新的发布申请。',
    '',
    '模型数量：' + Number(input.modelCount || 0),
    '地块数量：' + Number(input.chunkCount || 0),
    '说明：' + (input.note || '未填写'),
    '',
    '请登录管理后台查看 3D 预览并审核。',
  ].join('\n');
  const html = layout(subject, [
    '<p>' + escapeHtml(requester) + ' 提交了一条新的发布申请。</p>',
    '<table style="width:100%;border-collapse:collapse;font-size:14px">',
    row('模型数量', String(Number(input.modelCount || 0))),
    row('地块数量', String(Number(input.chunkCount || 0))),
    row('说明', input.note || '未填写'),
    '</table>',
    '<p style="margin-top:16px">请登录管理后台查看 3D 预览并审核。</p>',
  ].join(''));
  return { subject, text, html };
}

export function buildPublishReviewEmail(input: {
  brandName?: string;
  requester?: string;
  status: 'approved' | 'rejected' | 'stale';
  note?: string;
}): EmailMessage {
  const brand = input.brandName || 'Worldweave';
  const approved = input.status === 'approved';
  const subject = '【' + brand + '】发布申请' + (approved ? '已通过' : input.status === 'stale' ? '已过期' : '未通过');
  const title = approved
    ? '你提交的沙盒版本已通过审核并发布到首页。'
    : input.status === 'stale'
      ? '你提交的发布申请已过期，请基于最新共享世界重新提交。'
      : '你提交的发布申请未通过审核。';
  const text = [title];
  if (input.note) text.push('', '审核说明：' + input.note);
  text.push('', '—— ' + brand);
  const html = layout(subject, [
    '<p>' + escapeHtml(title) + '</p>',
    input.note ? '<p>审核说明：' + escapeHtml(input.note) + '</p>' : '',
  ].join(''));
  return { subject, text: text.join('\n'), html };
}

function row(label: string, value: string): string {
  return '<tr><td style="padding:6px 8px;color:#5d7a6c;white-space:nowrap;vertical-align:top">' + escapeHtml(label)
    + '</td><td style="padding:6px 8px;white-space:pre-wrap">' + escapeHtml(value) + '</td></tr>';
}
