import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DataSource } from 'typeorm';
import { hashPassword } from '../../common/password';

/**
 * 首次启动时确保至少有一个管理员账号。
 * 开发环境未配置 ADMIN_PASSWORD 时使用一次性默认密码，并强制首次登录改密；
 * 生产环境必须显式配置 ADMIN_USERNAME / ADMIN_PASSWORD。
 */
@Injectable()
export class AuthBootstrapService implements OnModuleInit {
  private readonly logger = new Logger(AuthBootstrapService.name);

  constructor(
    private readonly dataSource: DataSource,
    private readonly config: ConfigService,
  ) {}

  async onModuleInit(): Promise<void> {
    try {
      await this.dataSource.query('DELETE FROM auth_session WHERE expires_at < now()');
      const admins = await this.dataSource.query(
        "SELECT count(*)::int AS count FROM app_user WHERE role = 'admin'",
      );
      if (Number(admins[0]?.count || 0) > 0) return;

      const nodeEnv = this.config.get<string>('NODE_ENV', 'development');
      const username = String(this.config.get<string>('ADMIN_USERNAME', 'admin') || 'admin').trim();
      let password = String(this.config.get<string>('ADMIN_PASSWORD', '') || '').trim();
      let usingDefault = false;
      if (!password) {
        if (nodeEnv === 'production') {
          this.logger.error('未配置 ADMIN_USERNAME / ADMIN_PASSWORD，无法创建初始管理员账号');
          return;
        }
        password = 'Admin@12345';
        usingDefault = true;
      }
      if (password.length < 8) {
        this.logger.error('ADMIN_PASSWORD 至少需要 8 个字符，未创建初始管理员');
        return;
      }
      const displayName = String(this.config.get<string>('ADMIN_DISPLAY_NAME', '管理员') || '管理员').trim();
      const existing = await this.dataSource.query(
        'SELECT id FROM app_user WHERE lower(username) = lower($1) LIMIT 1',
        [username],
      );
      if (existing.length) {
        await this.dataSource.query(
          `UPDATE app_user
           SET role = 'admin', status = 'active', password_hash = $2,
               must_change_password = true, updated_at = now()
           WHERE id = $1`,
          [existing[0].id, hashPassword(password)],
        );
      } else {
        await this.dataSource.query(
          `INSERT INTO app_user (username, display_name, password_hash, role, status, must_change_password)
           VALUES ($1,$2,$3,'admin','active',true)`,
          [username, displayName, hashPassword(password)],
        );
      }
      this.logger.warn(
        '已创建初始管理员账号 "' + username + '"' +
        (usingDefault ? '，开发环境临时密码：' + password : '') +
        '；首次登录后请立即修改密码',
      );
    } catch (error: any) {
      this.logger.error('初始化管理员账号失败：' + (error?.message || error));
    }
  }
}
