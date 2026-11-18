import {
  BadRequestException,
  ConflictException,
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { DataSource } from 'typeorm';
import { Request } from 'express';
import { generateTemporaryPassword, hashPassword, verifyPassword } from '../../common/password';
import {
  ApproveJoinApplicationDto,
  ChangePasswordDto,
  CreateJoinApplicationDto,
  RejectJoinApplicationDto,
  UpdateUserDto,
} from './dto/auth.dto';
import { requestIp, SessionService } from './session.service';

const MAX_LOGIN_FAILURES = 5;
const LOGIN_WINDOW_MS = 10 * 60 * 1000;

export interface PublicUser {
  id: string;
  username: string;
  displayName: string;
  role: 'admin' | 'member';
  status: 'active' | 'disabled';
  mustChangePassword: boolean;
  createdAt?: string;
  lastLoginAt?: string | null;
}

function toPublicUser(row: Record<string, any>): PublicUser {
  return {
    id: String(row.id),
    username: String(row.username),
    displayName: String(row.display_name || row.username),
    role: row.role === 'admin' ? 'admin' : 'member',
    status: row.status === 'active' ? 'active' : 'disabled',
    mustChangePassword: Boolean(row.must_change_password),
    createdAt: row.created_at ? new Date(row.created_at).toISOString() : undefined,
    lastLoginAt: row.last_login_at ? new Date(row.last_login_at).toISOString() : null,
  };
}

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);
  private readonly loginFailures = new Map<string, { count: number; firstAt: number }>();

  constructor(
    private readonly dataSource: DataSource,
    private readonly sessions: SessionService,
  ) {}

  async login(usernameInput: string, password: string, request: Request): Promise<{ user: PublicUser; token: string }> {
    const username = String(usernameInput || '').trim();
    const rateKey = (requestIp(request) || 'unknown') + '|' + username.toLowerCase();
    this.assertLoginAllowed(rateKey);
    const rows = await this.dataSource.query(
      `SELECT id, username, display_name, password_hash, role, status, must_change_password
       FROM app_user WHERE lower(username) = lower($1) LIMIT 1`,
      [username],
    );
    const row = rows[0];
    if (!row || !verifyPassword(String(password || ''), String(row.password_hash || ''))) {
      this.recordLoginFailure(rateKey);
      throw new UnauthorizedException('用户名或密码不正确');
    }
    if (row.status !== 'active') {
      throw new UnauthorizedException('账号已被停用，请联系管理员');
    }
    this.loginFailures.delete(rateKey);
    await this.dataSource.query('UPDATE app_user SET last_login_at = now() WHERE id = $1', [row.id]);
    const token = await this.sessions.create(String(row.id), request);
    return { user: toPublicUser(row), token };
  }

  async changePassword(
    userId: string,
    sessionId: string | null,
    dto: ChangePasswordDto,
  ): Promise<{ ok: true }> {
    const rows = await this.dataSource.query(
      'SELECT id, password_hash FROM app_user WHERE id = $1 LIMIT 1',
      [userId],
    );
    const row = rows[0];
    if (!row) throw new NotFoundException('账号不存在');
    if (!verifyPassword(dto.currentPassword, String(row.password_hash || ''))) {
      throw new BadRequestException('当前密码不正确');
    }
    if (dto.currentPassword === dto.newPassword) {
      throw new BadRequestException('新密码不能与当前密码相同');
    }
    await this.dataSource.query(
      `UPDATE app_user SET password_hash = $2, must_change_password = false, updated_at = now()
       WHERE id = $1`,
      [userId, hashPassword(dto.newPassword)],
    );
    await this.sessions.destroyOthers(userId, sessionId);
    return { ok: true };
  }

  async createJoinApplication(dto: CreateJoinApplicationDto): Promise<{ ok: true; application: Record<string, any> }> {
    const desiredUsername = dto.desiredUsername.trim();
    const existingUser = await this.dataSource.query(
      'SELECT 1 FROM app_user WHERE lower(username) = lower($1) LIMIT 1',
      [desiredUsername],
    );
    if (existingUser.length) throw new ConflictException('该用户名已被使用');
    const pending = await this.dataSource.query(
      `SELECT 1 FROM join_application
       WHERE lower(desired_username) = lower($1) AND status = 'pending' LIMIT 1`,
      [desiredUsername],
    );
    if (pending.length) throw new ConflictException('该用户名已有待审核的申请');
    const rows = await this.dataSource.query(
      `INSERT INTO join_application (name, contact, desired_username, reason)
       VALUES ($1,$2,$3,$4)
       RETURNING id, name, contact, desired_username, reason, status, created_at`,
      [dto.name.trim(), dto.contact.trim(), desiredUsername, String(dto.reason || '').trim()],
    );
    return { ok: true, application: rows[0] };
  }

  async listApplications(statusInput = 'pending'): Promise<Record<string, any>[]> {
    const status = ['pending', 'approved', 'rejected', 'all'].includes(statusInput) ? statusInput : 'pending';
    const where = status === 'all' ? '' : 'WHERE a.status = $1';
    const params = status === 'all' ? [] : [status];
    return this.dataSource.query(
      `SELECT a.id, a.name, a.contact, a.desired_username, a.reason, a.status,
              a.review_note, a.reviewed_at, a.created_at,
              u.username AS reviewed_by_username
       FROM join_application a
       LEFT JOIN app_user u ON u.id = a.reviewed_by
       ${where}
       ORDER BY CASE WHEN a.status = 'pending' THEN 0 ELSE 1 END, a.created_at DESC
       LIMIT 200`,
      params,
    );
  }

  async approveApplication(
    id: string,
    dto: ApproveJoinApplicationDto,
    adminId: string,
  ): Promise<{ ok: true; user: PublicUser; temporaryPassword: string }> {
    const runner = this.dataSource.createQueryRunner();
    await runner.connect();
    await runner.startTransaction();
    try {
      const applications = await runner.query(
        'SELECT * FROM join_application WHERE id = $1 FOR UPDATE',
        [id],
      );
      const application = applications[0];
      if (!application) throw new NotFoundException('申请不存在');
      if (application.status !== 'pending') throw new ConflictException('该申请已经处理过');
      const existing = await runner.query(
        'SELECT 1 FROM app_user WHERE lower(username) = lower($1) LIMIT 1',
        [application.desired_username],
      );
      if (existing.length) throw new ConflictException('该用户名已被占用，请先修改申请');
      const temporaryPassword = String(dto.password || '').trim() || generateTemporaryPassword();
      const displayName = String(dto.displayName || '').trim() || String(application.name);
      const users = await runner.query(
        `INSERT INTO app_user (username, display_name, password_hash, role, status, must_change_password)
         VALUES ($1,$2,$3,'member','active',true)
         RETURNING id, username, display_name, role, status, must_change_password, created_at, last_login_at`,
        [application.desired_username, displayName, hashPassword(temporaryPassword)],
      );
      await runner.query(
        `UPDATE join_application
         SET status = 'approved', reviewed_by = $2, reviewed_at = now(), review_note = $3
         WHERE id = $1`,
        [id, adminId, String(dto.note || '').trim() || null],
      );
      await runner.commitTransaction();
      return { ok: true, user: toPublicUser(users[0]), temporaryPassword };
    } catch (error: any) {
      await runner.rollbackTransaction();
      if (error?.code === '23505') throw new ConflictException('用户名或申请状态冲突，请刷新后重试');
      throw error;
    } finally {
      await runner.release();
    }
  }

  async rejectApplication(
    id: string,
    dto: RejectJoinApplicationDto,
    adminId: string,
  ): Promise<{ ok: true }> {
    const rows = await this.dataSource.query(
      'SELECT id, status FROM join_application WHERE id = $1 LIMIT 1',
      [id],
    );
    if (!rows.length) throw new NotFoundException('申请不存在');
    if (rows[0].status !== 'pending') throw new ConflictException('该申请已经处理过');
    await this.dataSource.query(
      `UPDATE join_application
       SET status = 'rejected', reviewed_by = $2, reviewed_at = now(), review_note = $3
       WHERE id = $1`,
      [id, adminId, String(dto.note || '').trim() || null],
    );
    return { ok: true };
  }

  async listUsers(): Promise<PublicUser[]> {
    const rows = await this.dataSource.query(
      `SELECT id, username, display_name, role, status, must_change_password, created_at, last_login_at
       FROM app_user
       ORDER BY CASE WHEN role = 'admin' THEN 0 ELSE 1 END, created_at`,
    );
    return rows.map(toPublicUser);
  }

  async updateUser(id: string, dto: UpdateUserDto): Promise<PublicUser> {
    const rows = await this.dataSource.query(
      'SELECT id, username, display_name, role, status, must_change_password, created_at, last_login_at FROM app_user WHERE id = $1 LIMIT 1',
      [id],
    );
    const user = rows[0];
    if (!user) throw new NotFoundException('账号不存在');
    const nextRole = dto.role || user.role;
    const nextStatus = dto.status || user.status;
    if (user.role === 'admin' && (nextRole !== 'admin' || nextStatus !== 'active')) {
      const admins = await this.dataSource.query(
        "SELECT count(*)::int AS count FROM app_user WHERE role = 'admin' AND status = 'active'",
      );
      if (Number(admins[0]?.count || 0) <= 1) {
        throw new BadRequestException('至少需要保留一个启用的管理员');
      }
    }
    const updated = await this.dataSource.query(
      `UPDATE app_user
       SET display_name = COALESCE($2, display_name),
           role = COALESCE($3, role),
           status = COALESCE($4, status),
           updated_at = now()
       WHERE id = $1
       RETURNING id, username, display_name, role, status, must_change_password, created_at, last_login_at`,
      [
        id,
        dto.displayName !== undefined ? String(dto.displayName).trim() : null,
        dto.role || null,
        dto.status || null,
      ],
    );
    return toPublicUser(updated[0]);
  }

  async resetPassword(id: string): Promise<{ ok: true; user: PublicUser; temporaryPassword: string }> {
    const rows = await this.dataSource.query(
      `SELECT id, username, display_name, role, status, must_change_password, created_at, last_login_at
       FROM app_user WHERE id = $1 LIMIT 1`,
      [id],
    );
    const user = rows[0];
    if (!user) throw new NotFoundException('账号不存在');
    const temporaryPassword = generateTemporaryPassword();
    await this.dataSource.query(
      `UPDATE app_user SET password_hash = $2, must_change_password = true, updated_at = now()
       WHERE id = $1`,
      [id, hashPassword(temporaryPassword)],
    );
    await this.sessions.destroyOthers(id, null);
    return { ok: true, user: toPublicUser(user), temporaryPassword };
  }

  private assertLoginAllowed(key: string): void {
    const entry = this.loginFailures.get(key);
    if (!entry) return;
    if (Date.now() - entry.firstAt > LOGIN_WINDOW_MS) {
      this.loginFailures.delete(key);
      return;
    }
    if (entry.count >= MAX_LOGIN_FAILURES) {
      throw new HttpException('登录尝试次数过多，请 10 分钟后再试', HttpStatus.TOO_MANY_REQUESTS);
    }
  }

  private recordLoginFailure(key: string): void {
    const now = Date.now();
    const entry = this.loginFailures.get(key);
    if (!entry || now - entry.firstAt > LOGIN_WINDOW_MS) {
      this.loginFailures.set(key, { count: 1, firstAt: now });
    } else {
      entry.count += 1;
    }
    if (this.loginFailures.size > 2000) {
      for (const [storedKey, value] of this.loginFailures) {
        if (now - value.firstAt > LOGIN_WINDOW_MS) this.loginFailures.delete(storedKey);
      }
    }
  }
}
