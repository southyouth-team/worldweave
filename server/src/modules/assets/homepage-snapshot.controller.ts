import { Body, Controller, Delete, Get, Put, Req, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Request } from 'express';
import { DevIdentityGuard } from '../../common/dev-identity.guard';
import { HomepageSnapshotService } from './homepage-snapshot.service';

type DevRequest = Request & { user: { id: string } };

@ApiTags('homepage-snapshot')
@Controller('assets/homepage-snapshot')
@UseGuards(DevIdentityGuard)
export class HomepageSnapshotController {
  constructor(private readonly service: HomepageSnapshotService) {}

  @Put()
  @ApiOperation({ summary: '保存沙盒发布到首页的快照（服务端只存储不执行）' })
  save(@Req() req: DevRequest, @Body('snapshot') snapshot: unknown) {
    return this.service.save(req.user.id, snapshot);
  }

  @Get()
  @ApiOperation({ summary: '读取当前用户发布到首页的快照' })
  load(@Req() req: DevRequest) {
    return this.service.load(req.user.id);
  }

  @Delete()
  @ApiOperation({ summary: '清除当前用户发布到首页的快照' })
  clear(@Req() req: DevRequest) {
    return this.service.clear(req.user.id);
  }
}
