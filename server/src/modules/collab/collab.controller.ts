import { Body, Controller, Get, Post, Req, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { AuthedRequest, SessionAuthGuard } from '../auth/session-auth.guard';
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { CollabService } from './collab.service';
import {
  AcquireLocksDto,
  ForceUnlockDto,
  HeartbeatLocksDto,
  PresenceDto,
  ReleaseLocksDto,
  SaveWorkspaceDto,
} from './dto/collab.dto';

@ApiTags('collab')
@Controller('collab')
@UseGuards(SessionAuthGuard)
export class CollabController {
  constructor(private readonly service: CollabService) {}

  @Get('workspace')
  @ApiOperation({ summary: '读取共享世界快照、地块版本、锁与在线成员' })
  workspace() {
    return this.service.getWorkspace();
  }

  @Get('status')
  @ApiOperation({ summary: '只读取协作状态，不返回完整快照（用于轮询）' })
  status() {
    return this.service.getStatus();
  }

  @Post('presence')
  @ApiOperation({ summary: '上报当前在线状态与正在查看的地块' })
  presence(@Req() request: AuthedRequest, @Body() dto: PresenceDto) {
    return this.service.touchPresence(request.user, request.sessionId || null, dto);
  }

  @Post('locks')
  @ApiOperation({ summary: '获取地块租约锁，冲突时返回 409' })
  acquire(@Req() request: AuthedRequest, @Body() dto: AcquireLocksDto) {
    return this.service.acquireLocks(request.user, request.sessionId || null, dto);
  }

  @Post('locks/heartbeat')
  @ApiOperation({ summary: '续租当前成员持有的地块锁' })
  heartbeat(@Req() request: AuthedRequest, @Body() dto: HeartbeatLocksDto) {
    return this.service.heartbeatLocks(request.user, request.sessionId || null, dto);
  }

  @Post('locks/release')
  @ApiOperation({ summary: '主动释放地块锁（关闭页面时也会自动过期）' })
  release(@Req() request: AuthedRequest, @Body() dto: ReleaseLocksDto) {
    return this.service.releaseLocks(request.user, request.sessionId || null, dto);
  }

  @Post('workspace')
  @ApiOperation({ summary: '按改动地块保存共享世界，版本不一致返回 409' })
  save(@Req() request: AuthedRequest, @Body() dto: SaveWorkspaceDto) {
    return this.service.saveWorkspace(request.user, dto);
  }
}

@ApiTags('admin')
@Controller('admin/collab')
@UseGuards(SessionAuthGuard, RolesGuard)
@Roles('admin')
export class AdminCollabController {
  constructor(private readonly service: CollabService) {}

  @Post('force-unlock')
  @ApiOperation({ summary: '管理员强制释放地块锁并写审计日志' })
  forceUnlock(@Req() request: AuthedRequest, @Body() dto: ForceUnlockDto) {
    return this.service.forceUnlock(request.user, dto);
  }
}
