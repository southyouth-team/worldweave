import { EmailSettingsService } from './email-settings.service';

function createFakeDataSource() {
  const calls: Array<{ sql: string; params: any[] }> = [];
  const row = {
    enabled: true,
    host: 'smtp.example.com',
    port: 465,
    secure: true,
    username: 'mailer',
    password: 'secret',
    from_name: 'Worldweave',
    from_email: 'noreply@example.com',
    admin_recipients: 'admin@example.com',
    notify_join_application: true,
    notify_publish_request: true,
    notify_review_result: true,
    updated_at: new Date('2026-11-19T10:00:00Z'),
  };
  return {
    calls,
    dataSource: {
      query: async (sql: string, params: any[] = []) => {
        calls.push({ sql, params });
        if (sql.includes('INSERT INTO email_settings (id)')) return [];
        if (sql.includes('SELECT enabled, host')) return [row];
        if (sql.includes('SELECT updated_at')) return [{ updated_at: row.updated_at }];
        return [];
      },
    } as any,
  };
}

describe('EmailSettingsService', () => {
  it('writes host/port in the same order as the SQL columns and masks the password', async () => {
    const { dataSource, calls } = createFakeDataSource();
    const siteSettings = { load: async () => ({ settings: { notificationEmail: '' } }) } as any;
    const service = new EmailSettingsService(dataSource, siteSettings);

    const saved = await service.save({
      enabled: true,
      host: 'smtp.example.com',
      port: 465,
      secure: true,
      username: 'mailer',
      password: 'new-secret',
      fromName: 'Worldweave',
      fromEmail: 'noreply@example.com',
      adminRecipients: 'admin@example.com',
      notifyJoinApplication: true,
      notifyPublishRequest: false,
      notifyReviewResult: true,
    }, 'admin-id');

    const upsert = calls.find((call) => call.sql.includes('INSERT INTO email_settings\n'));
    expect(upsert).toBeTruthy();
    expect(upsert!.params).toEqual([
      'default',
      true,
      'smtp.example.com',
      465,
      true,
      'mailer',
      'new-secret',
      'Worldweave',
      'noreply@example.com',
      'admin@example.com',
      true,
      false,
      true,
      'admin-id',
    ]);
    expect(saved.settings).not.toHaveProperty('password');
    expect(saved.settings.passwordConfigured).toBe(true);
  });

  it('falls back to the legacy site notification email before separate recipients are saved', async () => {
    const { dataSource } = createFakeDataSource();
    dataSource.query = async (sql: string) => {
      if (sql.includes('SELECT enabled, host')) {
        return [{
          enabled: false, host: '', port: 587, secure: false, username: '', password: '',
          from_name: 'Worldweave', from_email: '', admin_recipients: '',
          notify_join_application: true, notify_publish_request: true, notify_review_result: true,
          updated_at: null,
        }];
      }
      return [];
    };
    const siteSettings = { load: async () => ({ settings: { notificationEmail: 'legacy@example.com' } }) } as any;
    const service = new EmailSettingsService(dataSource, siteSettings);
    expect((await service.load()).adminRecipients).toBe('legacy@example.com');
  });
});
