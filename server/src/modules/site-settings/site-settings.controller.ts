import { Body, Controller, Delete, Get, Put, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { SessionAuthGuard } from '../auth/session-auth.guard';
import { SiteSettingsService } from './site-settings.service';

@ApiTags('site-settings')
@Controller('site-settings')
export class SiteSettingsController {
  constructor(private readonly service: SiteSettingsService) {}

  @Get()
  @ApiOperation({ summary: '读取全局站点品牌配置（公开）' })
  load() {
    return this.service.load();
  }

  @Put()
  @UseGuards(SessionAuthGuard, RolesGuard)
  @Roles('admin')
  @ApiOperation({ summary: '保存全局站点品牌配置（仅管理员）' })
  save(@Body('settings') settings: unknown) {
    return this.service.save(settings);
  }

  @Delete()
  @UseGuards(SessionAuthGuard, RolesGuard)
  @Roles('admin')
  @ApiOperation({ summary: '重置全局站点品牌配置为默认值（仅管理员）' })
  reset() {
    return this.service.reset();
  }
}
