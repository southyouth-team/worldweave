import { Body, Controller, Get, Post, Req, Res, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Request, Response } from 'express';
import { AuthService } from './auth.service';
import { ChangePasswordDto, CreateJoinApplicationDto, LoginDto } from './dto/auth.dto';
import {
  AuthedRequest,
  SessionAuthGuard,
} from './session-auth.guard';
import {
  SESSION_COOKIE_NAME,
  SessionService,
  clearSessionCookie,
  readCookie,
  setSessionCookie,
} from './session.service';

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly sessions: SessionService,
  ) {}

  @Post('login')
  @ApiOperation({ summary: '用户名密码登录，写入 httpOnly 会话 Cookie' })
  async login(
    @Body() dto: LoginDto,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    const result = await this.auth.login(dto.username, dto.password, request);
    setSessionCookie(response, result.token);
    return { user: result.user };
  }

  @Post('logout')
  @ApiOperation({ summary: '退出登录并销毁服务端会话' })
  async logout(@Req() request: Request, @Res({ passthrough: true }) response: Response) {
    const token = readCookie(request, SESSION_COOKIE_NAME);
    await this.sessions.destroy(token);
    clearSessionCookie(response);
    return { ok: true };
  }

  @Get('me')
  @UseGuards(SessionAuthGuard)
  @ApiOperation({ summary: '读取当前登录账号' })
  me(@Req() request: AuthedRequest) {
    return { user: request.user };
  }

  @Post('change-password')
  @UseGuards(SessionAuthGuard)
  @ApiOperation({ summary: '修改当前账号密码，并注销其他会话' })
  async changePassword(@Req() request: AuthedRequest, @Body() dto: ChangePasswordDto) {
    await this.auth.changePassword(request.user.id, request.sessionId || null, dto);
    return { ok: true };
  }

  @Post('join-applications')
  @ApiOperation({ summary: '提交加入沙盒团队的申请（公开）' })
  createJoinApplication(@Body() dto: CreateJoinApplicationDto) {
    return this.auth.createJoinApplication(dto);
  }
}
