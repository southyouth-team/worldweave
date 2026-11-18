import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Request } from 'express';
import { AuthUser, SESSION_COOKIE_NAME, SessionService, readCookie } from './session.service';

export type AuthedRequest = Request & { user: AuthUser; sessionId?: string; sessionToken?: string };

/** 从 httpOnly Cookie 解析服务端会话；本 guard 是真实身份的唯一入口。 */
@Injectable()
export class SessionAuthGuard implements CanActivate {
  constructor(private readonly sessions: SessionService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AuthedRequest>();
    const token = readCookie(request, SESSION_COOKIE_NAME);
    if (!token) throw new UnauthorizedException('请先登录');
    const resolved = await this.sessions.resolve(token);
    if (!resolved) throw new UnauthorizedException('登录已过期，请重新登录');
    request.user = resolved.user;
    request.sessionId = resolved.sessionId;
    request.sessionToken = token;
    return true;
  }
}
