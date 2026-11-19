import { BadRequestException, Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { SiteSettingsService } from '../site-settings/site-settings.service';
import {
  normalizeEmailSettings,
  parseEmailList,
  type EmailSettings,
} from './email-notifications.policy';
import { EmailSettingsDto } from './dto/email-settings.dto';

const SETTINGS_ID = 'default';

interface EmailSettingsRow {
  enabled: boolean;
  host: string;
  port: number;
  secure: boolean;
  username: string;
  password: string;
  from_name: string;
  from_email: string;
  admin_recipients: string;
  notify_join_application: boolean;
  notify_publish_request: boolean;
  notify_review_result: boolean;
  updated_by: string | null;
  updated_at: Date | string | null;
}

@Injectable()
export class EmailSettingsService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly siteSettings: SiteSettingsService,
  ) {}

  async load(): Promise<EmailSettings> {
    await this.ensureRow();
    const rows = await this.dataSource.query(
      `SELECT enabled, host, port, secure, username, password, from_name, from_email,
              admin_recipients, notify_join_application, notify_publish_request,
              notify_review_result, updated_by, updated_at
       FROM email_settings WHERE id = $1 LIMIT 1`,
      [SETTINGS_ID],
    );
    const row = rows[0] as EmailSettingsRow | undefined;
    if (!row) return normalizeEmailSettings({});
    let adminRecipients = String(row.admin_recipients || '');
    if (!adminRecipients.trim() && !row.updated_by) {
      // 兼容旧站点设置里的单个通知邮箱，首次打开新页面时作为管理员收件人。
      try {
        const legacy = await this.siteSettings.load();
        adminRecipients = String(legacy.settings.notificationEmail || '');
      } catch {
        adminRecipients = '';
      }
    }
    return {
      enabled: Boolean(row.enabled),
      host: String(row.host || ''),
      port: Number(row.port) || 587,
      secure: Boolean(row.secure),
      username: String(row.username || ''),
      password: String(row.password || ''),
      fromName: String(row.from_name || 'Worldweave'),
      fromEmail: String(row.from_email || ''),
      adminRecipients,
      notifyJoinApplication: row.notify_join_application !== false,
      notifyPublishRequest: row.notify_publish_request !== false,
      notifyReviewResult: row.notify_review_result !== false,
    };
  }

  async getPublic() {
    const settings = await this.load();
    const { password, ...safe } = settings;
    return {
      settings: {
        ...safe,
        adminRecipients: this.safeRecipientString(settings.adminRecipients),
        passwordConfigured: Boolean(password),
      },
      updatedAt: await this.updatedAt(),
    };
  }

  async save(input: EmailSettingsDto, adminId: string) {
    if (!input || typeof input !== 'object' || Array.isArray(input)) {
      throw new BadRequestException('邮件配置必须是对象');
    }
    const current = await this.load();
    let normalized: EmailSettings;
    try {
      normalized = normalizeEmailSettings(input as any, current);
    } catch (error: any) {
      throw new BadRequestException(error?.message || '邮件配置无效');
    }
    await this.dataSource.query(
      `INSERT INTO email_settings
         (id, enabled, host, port, secure, username, password, from_name, from_email,
          admin_recipients, notify_join_application, notify_publish_request,
          notify_review_result, updated_by, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,now())
       ON CONFLICT (id) DO UPDATE
         SET enabled = EXCLUDED.enabled,
             host = EXCLUDED.host,
             port = EXCLUDED.port,
             secure = EXCLUDED.secure,
             username = EXCLUDED.username,
             password = EXCLUDED.password,
             from_name = EXCLUDED.from_name,
             from_email = EXCLUDED.from_email,
             admin_recipients = EXCLUDED.admin_recipients,
             notify_join_application = EXCLUDED.notify_join_application,
             notify_publish_request = EXCLUDED.notify_publish_request,
             notify_review_result = EXCLUDED.notify_review_result,
             updated_by = EXCLUDED.updated_by,
             updated_at = now()`,
      [
        SETTINGS_ID,
        normalized.enabled,
        normalized.host,
        normalized.port,
        normalized.secure,
        normalized.username,
        normalized.password,
        normalized.fromName,
        normalized.fromEmail,
        normalized.adminRecipients,
        normalized.notifyJoinApplication,
        normalized.notifyPublishRequest,
        normalized.notifyReviewResult,
        adminId,
      ],
    );
    return this.getPublic();
  }

  async validateRecipient(value: unknown): Promise<string> {
    const parsed = parseEmailList(value ? String(value) : '', 1);
    if (!parsed.length) throw new BadRequestException('请填写测试收件邮箱');
    return parsed[0];
  }

  async listLog() {
    const rows = await this.dataSource.query(
      `SELECT id, kind, recipient, subject, status, error, created_at
       FROM email_delivery_log ORDER BY created_at DESC LIMIT 30`,
    );
    return rows.map((row: Record<string, any>) => ({
      id: String(row.id),
      kind: String(row.kind),
      recipient: row.recipient || '',
      subject: row.subject || '',
      status: String(row.status),
      error: row.error || '',
      createdAt: row.created_at ? new Date(row.created_at).toISOString() : null,
    }));
  }

  async updatedAt(): Promise<string | null> {
    const rows = await this.dataSource.query(
      'SELECT updated_at FROM email_settings WHERE id = $1 LIMIT 1',
      [SETTINGS_ID],
    );
    const value = rows[0]?.updated_at;
    return value ? new Date(value).toISOString() : null;
  }

  private async ensureRow(): Promise<void> {
    await this.dataSource.query(
      `INSERT INTO email_settings (id) VALUES ($1) ON CONFLICT (id) DO NOTHING`,
      [SETTINGS_ID],
    );
  }

  private safeRecipientString(value: string): string {
    try {
      return parseEmailList(value).join(', ');
    } catch {
      return '';
    }
  }
}
