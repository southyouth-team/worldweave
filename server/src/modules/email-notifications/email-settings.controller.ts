import { Body, Controller, Get, Post, Put, Req, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { AuthedRequest, SessionAuthGuard } from '../auth/session-auth.guard';
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { EmailSettingsDto, TestEmailDto } from './dto/email-settings.dto';
import { EmailSettingsService } from './email-settings.service';
import { EmailNotificationsService } from './email-notifications.service';

@ApiTags('admin')
@Controller('admin/email-settings')
@UseGuards(SessionAuthGuard, RolesGuard)
@Roles('admin')
export class EmailSettingsController {
  constructor(
    private readonly settings: EmailSettingsService,
    private readonly notifications: EmailNotificationsService,
  ) {}

  @Get()
  @ApiOperation({ summary: '读取邮件通知配置（不返回 SMTP 密码）' })
  load() {
    return this.settings.getPublic();
  }

  @Put()
  @ApiOperation({ summary: '保存 SMTP 与通知开关' })
  save(@Req() request: AuthedRequest, @Body() dto: EmailSettingsDto) {
    return this.settings.save(dto, request.user.id);
  }

  @Post('test')
  @ApiOperation({ summary: '发送测试邮件' })
  test(@Body() dto: TestEmailDto) {
    return this.notifications.sendTest(dto.recipient);
  }

  @Get('log')
  @ApiOperation({ summary: '最近邮件发送记录' })
  log() {
    return this.settings.listLog();
  }
}
