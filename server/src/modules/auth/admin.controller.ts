import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { AuthService } from './auth.service';
import {
  ApproveJoinApplicationDto,
  RejectJoinApplicationDto,
  UpdateUserDto,
} from './dto/auth.dto';
import { Roles } from './roles.decorator';
import { RolesGuard } from './roles.guard';
import { AuthedRequest, SessionAuthGuard } from './session-auth.guard';

@ApiTags('admin')
@Controller('admin')
@UseGuards(SessionAuthGuard, RolesGuard)
@Roles('admin')
export class AdminController {
  constructor(private readonly auth: AuthService) {}

  @Get('join-applications')
  @ApiOperation({ summary: '查看加入申请（pending/approved/rejected/all）' })
  listApplications(@Query('status') status?: string) {
    return this.auth.listApplications(status || 'pending');
  }

  @Post('join-applications/:id/approve')
  @ApiOperation({ summary: '通过加入申请并创建成员账号，返回一次性临时密码' })
  approve(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ApproveJoinApplicationDto,
    @Req() request: AuthedRequest,
  ) {
    return this.auth.approveApplication(id, dto, request.user.id);
  }

  @Post('join-applications/:id/reject')
  @ApiOperation({ summary: '驳回加入申请' })
  reject(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: RejectJoinApplicationDto,
    @Req() request: AuthedRequest,
  ) {
    return this.auth.rejectApplication(id, dto, request.user.id);
  }

  @Get('users')
  @ApiOperation({ summary: '成员列表' })
  listUsers() {
    return this.auth.listUsers();
  }

  @Patch('users/:id')
  @ApiOperation({ summary: '启用/停用账号或调整角色' })
  updateUser(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateUserDto) {
    return this.auth.updateUser(id, dto);
  }

  @Post('users/:id/reset-password')
  @ApiOperation({ summary: '生成新的临时密码并注销该账号所有会话' })
  resetPassword(@Param('id', ParseUUIDPipe) id: string) {
    return this.auth.resetPassword(id);
  }
}
