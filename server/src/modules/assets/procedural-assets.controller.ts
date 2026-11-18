import {
  Body, Controller, Delete, Get, Param, Post, Put, Req, UseGuards,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Request } from 'express';
import { DevIdentityGuard } from '../../common/dev-identity.guard';
import { AssetsService } from './assets.service';

type DevRequest = Request & { user: { id: string } };

@ApiTags('campus-visual-assets')
@Controller('assets/procedural-assets')
@UseGuards(DevIdentityGuard)
export class ProceduralAssetsController {
  constructor(private readonly service: AssetsService) {}

  @Post()
  @ApiOperation({ summary: '保存 AI 程序化模型源码资产（服务端只存储不执行）' })
  saveAsset(@Req() req: DevRequest, @Body() input: Record<string, unknown>) {
    return this.service.saveProceduralAsset(req.user.id, input);
  }

  @Get()
  @ApiOperation({ summary: '列出当前用户的程序化模型资产（仅元数据，不含源码）' })
  listAssets(@Req() req: DevRequest) {
    return this.service.listProceduralAssets(req.user.id);
  }

  @Get(':assetId')
  @ApiOperation({ summary: '读取单条程序化模型资产（含源码与能力清单）' })
  getAsset(@Req() req: DevRequest, @Param('assetId') assetId: string) {
    return this.service.getProceduralAsset(req.user.id, assetId);
  }

  @Put(':assetId')
  @ApiOperation({ summary: '重命名程序化模型资产' })
  renameAsset(
    @Req() req: DevRequest,
    @Param('assetId') assetId: string,
    @Body() input: Record<string, unknown>,
  ) {
    return this.service.renameProceduralAsset(req.user.id, assetId, input?.name);
  }

  @Delete(':assetId')
  @ApiOperation({ summary: '删除程序化模型资产记录与磁盘文件（幂等）' })
  removeAsset(@Req() req: DevRequest, @Param('assetId') assetId: string) {
    return this.service.deleteProceduralAsset(req.user.id, assetId);
  }
}
