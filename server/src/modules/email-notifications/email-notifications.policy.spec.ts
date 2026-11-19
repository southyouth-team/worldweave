import {
  buildJoinApplicationAdminEmail,
  buildJoinReviewEmail,
  buildPublishRequestAdminEmail,
  buildPublishReviewEmail,
  isValidEmail,
  normalizeEmailSettings,
  parseEmailList,
} from './email-notifications.policy';

describe('email notification policy', () => {
  it('parses and deduplicates recipient lists', () => {
    expect(parseEmailList('a@example.com, b@example.com\nA@example.com; c@example.com')).toEqual([
      'a@example.com',
      'b@example.com',
      'c@example.com',
    ]);
    expect(isValidEmail('not-an-email')).toBe(false);
    expect(isValidEmail('  user@example.com  ')).toBe(true);
    expect(() => parseEmailList('ok@example.com, bad')).toThrow();
    expect(() => parseEmailList(Array.from({ length: 21 }, (_, i) => `u${i}@example.com`).join(','))).toThrow();
  });

  it('normalizes SMTP settings and keeps the existing password when left blank', () => {
    const existing = { password: 'secret' };
    expect(normalizeEmailSettings({ enabled: true, host: ' smtp.example.com ', port: 587, fromEmail: 'noreply@example.com' }, existing)).toMatchObject({
      enabled: true,
      host: 'smtp.example.com',
      port: 587,
      fromEmail: 'noreply@example.com',
      password: 'secret',
      fromName: 'Worldweave',
      notifyJoinApplication: true,
    });
    expect(normalizeEmailSettings({ password: '' }, existing).password).toBe('secret');
    expect(normalizeEmailSettings({ clearPassword: true }, existing).password).toBe('');
    expect(normalizeEmailSettings({ password: ' new-secret ' }, existing).password).toBe('new-secret');
    expect(() => normalizeEmailSettings({ enabled: true, host: '', fromEmail: 'noreply@example.com' })).toThrow('SMTP 主机');
    expect(() => normalizeEmailSettings({ enabled: true, host: 'smtp.example.com', fromEmail: 'bad' })).toThrow('发件邮箱');
  });

  it('builds an admin notification for a new join application', () => {
    const message = buildJoinApplicationAdminEmail({
      brandName: 'Worldweave',
      application: { name: '小林', desiredUsername: 'lin', email: 'lin@example.com', contact: '微信 lin', reason: '负责北区' },
    });
    expect(message.subject).toContain('加入申请');
    expect(message.text).toContain('小林');
    expect(message.text).toContain('lin@example.com');
    expect(message.text).toContain('负责北区');
    expect(message.html).toContain('lin@example.com');
  });

  it('builds approval and rejection emails for the applicant', () => {
    const approved = buildJoinReviewEmail({
      brandName: 'Worldweave',
      application: { name: '小林', desiredUsername: 'lin' },
      status: 'approved',
      temporaryPassword: 'Temp@12345',
      username: 'lin',
    });
    expect(approved.subject).toContain('通过');
    expect(approved.text).toContain('Temp@12345');
    expect(approved.text).toContain('lin');

    const rejected = buildJoinReviewEmail({
      brandName: 'Worldweave',
      application: { name: '小林', desiredUsername: 'lin' },
      status: 'rejected',
      note: '请补充负责范围',
    });
    expect(rejected.subject).toContain('未通过');
    expect(rejected.text).toContain('请补充负责范围');
  });

  it('builds publish request and review emails with escaped HTML', () => {
    const request = buildPublishRequestAdminEmail({
      brandName: 'Worldweave',
      requester: '小林',
      note: '<script>alert(1)</script>',
      modelCount: 8,
      chunkCount: 3,
    });
    expect(request.subject).toContain('发布申请');
    expect(request.text).toContain('8');
    expect(request.html).not.toContain('<script>alert(1)</script>');
    expect(request.html).toContain('&lt;script&gt;');

    const rejected = buildPublishReviewEmail({
      brandName: 'Worldweave',
      requester: '小林',
      status: 'rejected',
      note: '缩略图不清晰',
    });
    expect(rejected.subject).toContain('未通过');
    expect(rejected.text).toContain('缩略图不清晰');
  });
});
