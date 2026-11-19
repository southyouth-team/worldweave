import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { DataSource } from 'typeorm';
import * as nodemailer from 'nodemailer';
import { SiteSettingsService } from '../site-settings/site-settings.service';
import { EmailSettingsService } from './email-settings.service';
import {
  buildJoinApplicationAdminEmail,
  buildJoinReviewEmail,
  buildPublishRequestAdminEmail,
  buildPublishReviewEmail,
  isValidEmail,
  parseEmailList,
  type EmailMessage,
  type EmailSettings,
  type JoinApplicationData,
} from './email-notifications.policy';

type DeliveryStatus = 'sent' | 'skipped' | 'failed';

@Injectable()
export class EmailNotificationsService {
  private readonly logger = new Logger(EmailNotificationsService.name);

  constructor(
    private readonly dataSource: DataSource,
    private readonly settings: EmailSettingsService,
    private readonly siteSettings: SiteSettingsService,
  ) {}

  async notifyJoinApplication(application: JoinApplicationData): Promise<void> {
    const settings = await this.settings.load();
    if (!settings.enabled || !settings.notifyJoinApplication) return;
    const recipients = await this.adminRecipients(settings);
    if (!recipients.length) {
      await this.log('join-application', null, '新的加入申请', 'skipped', '没有可用的管理员收件邮箱');
      return;
    }
    const brandName = await this.brandName();
    const message = buildJoinApplicationAdminEmail({ brandName, application });
    await this.deliver('join-application', recipients, message);
  }

  async notifyJoinReview(
    application: JoinApplicationData,
    result: { status: 'approved' | 'rejected'; note?: string; temporaryPassword?: string; username?: string },
  ): Promise<void> {
    const settings = await this.settings.load();
    if (!settings.enabled || !settings.notifyReviewResult) return;
    if (!isValidEmail(application.email)) {
      await this.log('join-review', null, '加入申请审核结果', 'skipped', '申请人没有有效邮箱');
      return;
    }
    const brandName = await this.brandName();
    const message = buildJoinReviewEmail({
      brandName,
      application,
      status: result.status,
      note: result.note,
      temporaryPassword: result.temporaryPassword,
      username: result.username,
    });
    await this.deliver('join-review', [String(application.email).trim().toLowerCase()], message);
  }

  async notifyPublishRequest(input: {
    requester?: string;
    note?: string;
    modelCount?: number;
    chunkCount?: number;
  }): Promise<void> {
    const settings = await this.settings.load();
    if (!settings.enabled || !settings.notifyPublishRequest) return;
    const recipients = await this.adminRecipients(settings);
    if (!recipients.length) {
      await this.log('publish-request', null, '新的发布申请', 'skipped', '没有可用的管理员收件邮箱');
      return;
    }
    const brandName = await this.brandName();
    const message = buildPublishRequestAdminEmail({ brandName, ...input });
    await this.deliver('publish-request', recipients, message);
  }

  async notifyPublishReview(input: {
    requester?: string;
    email?: string;
    status: 'approved' | 'rejected' | 'stale';
    note?: string;
  }): Promise<void> {
    const settings = await this.settings.load();
    if (!settings.enabled || !settings.notifyReviewResult) return;
    if (!isValidEmail(input.email)) {
      await this.log('publish-review', null, '发布申请审核结果', 'skipped', '申请人没有有效邮箱');
      return;
    }
    const brandName = await this.brandName();
    const message = buildPublishReviewEmail({ brandName, ...input });
    await this.deliver('publish-review', [String(input.email).trim().toLowerCase()], message);
  }

  async sendTest(recipientInput?: string) {
    const settings = await this.settings.load();
    this.assertSendable(settings);
    const recipients = recipientInput
      ? await this.settings.validateRecipient(recipientInput)
      : (await this.adminRecipients(settings)).join(', ');
    if (!recipients) throw new BadRequestException('请先配置管理员收件邮箱或填写测试收件人');
    const brandName = await this.brandName();
    const message: EmailMessage = {
      subject: '【' + brandName + '】邮件通知测试',
      text: '这是一封来自 ' + brandName + ' 的测试邮件。收到它说明 SMTP 配置可用。',
      html: '<p>这是一封来自 <b>' + brandName + '</b> 的测试邮件。</p><p>收到它说明 SMTP 配置可用。</p>',
    };
    try {
      const info = await this.send(settings, recipients, message);
      await this.log('test', recipients, message.subject, 'sent', null);
      return { ok: true, messageId: info.messageId || '', recipient: recipients };
    } catch (error: any) {
      await this.log('test', recipients, message.subject, 'failed', error?.message || String(error));
      throw new BadRequestException('测试邮件发送失败：' + (error?.message || 'SMTP 连接失败'));
    }
  }

  private async deliver(kind: string, recipients: string[], message: EmailMessage): Promise<void> {
    const settings = await this.settings.load();
    const to = recipients.join(', ');
    try {
      const info = await this.send(settings, to, message);
      await this.log(kind, to, message.subject, 'sent', null);
      this.logger.log('邮件已发送：' + kind + ' -> ' + to + ' (' + (info.messageId || 'no-id') + ')');
    } catch (error: any) {
      await this.log(kind, to, message.subject, 'failed', error?.message || String(error));
      this.logger.warn('邮件发送失败：' + kind + ' -> ' + to + '：' + (error?.message || error));
    }
  }

  private async send(settings: EmailSettings, to: string, message: EmailMessage) {
    this.assertSendable(settings);
    const transporter = nodemailer.createTransport({
      host: settings.host,
      port: settings.port,
      secure: settings.secure,
      auth: settings.username
        ? { user: settings.username, pass: settings.password }
        : undefined,
      connectionTimeout: 10_000,
      greetingTimeout: 10_000,
      socketTimeout: 20_000,
    });
    return transporter.sendMail({
      from: {
        name: settings.fromName || 'Worldweave',
        address: settings.fromEmail,
      },
      to,
      subject: message.subject,
      text: message.text,
      html: message.html,
    });
  }

  private assertSendable(settings: EmailSettings) {
    if (!settings.enabled) throw new BadRequestException('邮件通知尚未启用');
    if (!settings.host) throw new BadRequestException('请先填写 SMTP 主机');
    if (!isValidEmail(settings.fromEmail)) throw new BadRequestException('请先填写合法的发件邮箱');
  }

  private async adminRecipients(settings: EmailSettings): Promise<string[]> {
    const recipients = new Set<string>();
    try {
      for (const email of parseEmailList(settings.adminRecipients)) recipients.add(email);
    } catch {
      // 配置保存时已校验；历史脏数据直接忽略。
    }
    const rows = await this.dataSource.query(
      `SELECT email FROM app_user
       WHERE role = 'admin' AND status = 'active' AND email IS NOT NULL AND email <> ''
       ORDER BY created_at`,
    );
    for (const row of rows as Array<{ email?: string }>) {
      if (isValidEmail(row.email)) recipients.add(String(row.email).trim().toLowerCase());
    }
    return Array.from(recipients);
  }

  private async brandName(): Promise<string> {
    try {
      const loaded = await this.siteSettings.load();
      return loaded.settings.brandName || 'Worldweave';
    } catch {
      return 'Worldweave';
    }
  }

  private async log(
    kind: string,
    recipient: string | null,
    subject: string,
    status: DeliveryStatus,
    error: string | null,
  ): Promise<void> {
    try {
      await this.dataSource.query(
        `INSERT INTO email_delivery_log (kind, recipient, subject, status, error)
         VALUES ($1,$2,$3,$4,$5)`,
        [kind, recipient ? recipient.slice(0, 254) : null, subject.slice(0, 300), status, error ? error.slice(0, 2000) : null],
      );
    } catch (failure: any) {
      this.logger.warn('写入邮件发送日志失败：' + (failure?.message || failure));
    }
  }
}
