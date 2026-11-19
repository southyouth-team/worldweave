import { createHash, randomBytes } from 'node:crypto';
import { Injectable, Logger } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { Request, Response } from 'express';

export const SESSION_COOKIE_NAME = 'ncgxy_session';
export const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export interface AuthUser {
  id: string;
  username: string;
  displayName: string;
  email: string | null;
  role: 'admin' | 'member';
  status: 'active' | 'disabled';
  mustChangePassword: boolean;
}

export interface ResolvedSession {
  user: AuthUser;
  sessionId: string;
}

export function readCookie(request: Request, name: string): string {
  const header = request.headers?.cookie;
  if (!header) return '';
  for (const part of header.split(';')) {
    const index = part.indexOf('=');
    if (index < 0) continue;
    if (part.slice(0, index).trim() !== name) continue;
    try {
      return decodeURIComponent(part.slice(index + 1).trim());
    } catch {
      return part.slice(index + 1).trim();
    }
  }
  return '';
}

export function setSessionCookie(response: Response, token: string, maxAge = SESSION_TTL_MS): void {
  response.cookie(SESSION_COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge,
  });
}

export function clearSessionCookie(response: Response): void {
  response.clearCookie(SESSION_COOKIE_NAME, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
  });
}

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export function requestIp(request: Request): string {
  const forwarded = String(request.headers?.['x-forwarded-for'] || '').split(',')[0].trim();
  return (forwarded || request.ip || request.socket?.remoteAddress || '').slice(0, 64);
}

@Injectable()
export class SessionService {
  private readonly logger = new Logger(SessionService.name);

  constructor(private readonly dataSource: DataSource) {}

  async create(userId: string, request: Request): Promise<string> {
    const token = randomBytes(32).toString('base64url');
    const expiresAt = new Date(Date.now() + SESSION_TTL_MS);
    await this.dataSource.query(
      `INSERT INTO auth_session (user_id, token_hash, expires_at, user_agent, ip)
       VALUES ($1,$2,$3,$4,$5)`,
      [
        userId,
        hashToken(token),
        expiresAt,
        String(request.headers?.['user-agent'] || '').slice(0, 300) || null,
        requestIp(request) || null,
      ],
    );
    return token;
  }

  async resolve(token: string): Promise<ResolvedSession | null> {
    if (!token) return null;
    const rows = await this.dataSource.query(
      `SELECT s.id AS session_id, s.expires_at,
              u.id, u.username, u.display_name, u.email, u.role, u.status, u.must_change_password
       FROM auth_session s JOIN app_user u ON u.id = s.user_id
       WHERE s.token_hash = $1`,
      [hashToken(token)],
    );
    const row = rows[0];
    if (!row) return null;
    if (new Date(row.expires_at).getTime() <= Date.now()) {
      await this.dataSource.query('DELETE FROM auth_session WHERE id = $1', [row.session_id]);
      return null;
    }
    if (row.status !== 'active') {
      await this.dataSource.query('DELETE FROM auth_session WHERE id = $1', [row.session_id]);
      return null;
    }
    // 限制 last_seen 写入频率，避免每个请求都写库。
    this.dataSource
      .query(
        `UPDATE auth_session SET last_seen_at = now()
         WHERE id = $1 AND last_seen_at < now() - interval '5 minutes'`,
        [row.session_id],
      )
      .catch((error) => this.logger.warn('更新会话活跃时间失败：' + (error?.message || error)));
    return {
      sessionId: String(row.session_id),
      user: {
        id: String(row.id),
        username: String(row.username),
        displayName: String(row.display_name || row.username),
        email: row.email ? String(row.email) : null,
        role: row.role === 'admin' ? 'admin' : 'member',
        status: row.status === 'active' ? 'active' : 'disabled',
        mustChangePassword: Boolean(row.must_change_password),
      },
    };
  }

  async destroy(token: string): Promise<void> {
    if (!token) return;
    await this.dataSource.query('DELETE FROM auth_session WHERE token_hash = $1', [hashToken(token)]);
  }

  async destroyOthers(userId: string, keepSessionId: string | null): Promise<void> {
    if (keepSessionId) {
      await this.dataSource.query('DELETE FROM auth_session WHERE user_id = $1 AND id <> $2', [
        userId,
        keepSessionId,
      ]);
      return;
    }
    await this.dataSource.query('DELETE FROM auth_session WHERE user_id = $1', [userId]);
  }
}
