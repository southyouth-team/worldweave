import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Query, Req, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { AuthedRequest, SessionAuthGuard } from '../auth/session-auth.guard';
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { CreatePublishRequestDto, RejectPublishRequestDto } from './dto/publish-request.dto';
import { PublishRequestsService } from './publish-requests.service';

@ApiTags('publish-requests')
@Controller('publish-requests')
@UseGuards(SessionAuthGuard)
export class PublishRequestsController {
  constructor(private readonly service: PublishRequestsService) {}

  @Post()
  @ApiOperation({ summary: '成员提交发布申请（冻结当前沙盒快照）' })
  create(@Req() request: AuthedRequest, @Body() dto: CreatePublishRequestDto) {
    return this.service.create(request.user.id, dto);
  }

  @Get('mine')
  @ApiOperation({ summary: '查看自己的发布申请记录' })
  mine(@Req() request: AuthedRequest) {
    return this.service.listMine(request.user.id);
  }

  @Get(':id/snapshot')
  @ApiOperation({ summary: '查看自己的某次发布快照' })
  snapshot(@Req() request: AuthedRequest, @Param('id', ParseUUIDPipe) id: string) {
    return this.service.getSnapshot(id, request.user.id, request.user.role);
  }
}

@ApiTags('admin')
@Controller('admin/publish-requests')
@UseGuards(SessionAuthGuard, RolesGuard)
@Roles('admin')
export class AdminPublishRequestsController {
  constructor(private readonly service: PublishRequestsService) {}

  @Get()
  @ApiOperation({ summary: '管理员查看发布申请（pending/approved/rejected/stale/all）' })
  list(@Query('status') status?: string) {
    return this.service.listForAdmin(status || 'pending');
  }

  @Get(':id/snapshot')
  @ApiOperation({ summary: '管理员查看待审核的冻结快照' })
  snapshot(@Req() request: AuthedRequest, @Param('id', ParseUUIDPipe) id: string) {
    return this.service.getSnapshot(id, request.user.id, request.user.role);
  }

  @Post(':id/approve')
  @ApiOperation({ summary: '通过发布申请并写入首页' })
  approve(@Req() request: AuthedRequest, @Param('id', ParseUUIDPipe) id: string) {
    return this.service.approve(id, request.user.id);
  }

  @Post(':id/reject')
  @ApiOperation({ summary: '驳开发布申请' })
  reject(
    @Req() request: AuthedRequest,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: RejectPublishRequestDto,
  ) {
    return this.service.reject(id, request.user.id, dto.note);
  }
}

@ApiTags('published-homepage')
@Controller('published-homepage')
export class PublishedHomepageController {
  constructor(private readonly service: PublishRequestsService) {}

  @Get()
  @ApiOperation({ summary: '读取当前已发布到首页的全局快照（公开）' })
  load() {
    return this.service.loadPublished();
  }
}
