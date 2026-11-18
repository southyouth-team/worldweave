import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  SESSION_COOKIE_NAME,
  SessionService,
  readCookie,
} from '../modules/auth/session.service';

/**
 * 兼容层：优先使用真实登录会话；开发环境保留 X-Dev-User-Id 以便脚本/测试。
 * 生产环境只接受有效会话，不再信任任何请求头身份。
 */
@Injectable()
export class DevIdentityGuard implements CanActivate {
  constructor(
    private readonly config: ConfigService,
    private readonly sessions: SessionService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const token = readCookie(request, SESSION_COOKIE_NAME);
    if (token) {
      const resolved = await this.sessions.resolve(token);
      if (resolved) {
        request.user = resolved.user;
        request.sessionId = resolved.sessionId;
        request.sessionToken = token;
        return true;
      }
    }
    const allowDevHeader =
      this.config.get<string>('NODE_ENV') !== 'production' &&
      this.config.get<string>('AUTH_ALLOW_DEV_HEADER', 'true') !== 'false';
    if (allowDevHeader) {
      const userId = request.headers['x-dev-user-id'];
      if (typeof userId === 'string' && userId.trim()) {
        request.user = { id: userId.trim() };
        return true;
      }
      throw new UnauthorizedException('开发环境请登录，或提供 X-Dev-User-Id 请求头');
    }
    throw new UnauthorizedException('请先登录');
  }
}
